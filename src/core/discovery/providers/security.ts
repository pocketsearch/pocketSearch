import { tokenize } from '../../text.js';
import { fetchJson } from './base.js';
import { lexicalRelevance, makeResult } from '../result.js';
import type { ProviderContext, SearchProvider, UnifiedResult } from '../types.js';

const VULN_ID_RE = /\b(cve-\d{4}-\d{4,7}|ghsa-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})\b/i;
const SECURITY_HINT_RE =
  /\b(cve|vulnerability|vulnerabilities|exploit|exploited|advisory|advisories|rce|lfi|ssrf|xss|sqli|csrf|0day|zero-day|patch|cwe|malware|backdoor|proof.of.concept|poc)\b/i;

function vulnId(query: string, ctx: ProviderContext): string | null {
  if (ctx.classification.type === 'cve') return ctx.classification.value.toUpperCase();
  return VULN_ID_RE.exec(query)?.[1]?.toUpperCase() ?? null;
}

function isSecurityQuery(query: string, ctx: ProviderContext): boolean {
  return (
    ctx.classification.type === 'cve' ||
    VULN_ID_RE.test(query) ||
    SECURITY_HINT_RE.test(query)
  );
}

// --- OSV.dev ---------------------------------------------------------------

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  severity?: Array<{ type: string; score: string }>;
  references?: Array<{ type?: string; url: string }>;
}

/**
 * OSV.dev — the open vulnerability database (Google). No key. Resolves a
 * CVE / GHSA / OSV id to its record: summary, severity, aliases and references.
 */
export class OsvProvider implements SearchProvider {
  readonly name = 'OSV.dev';
  readonly category = 'infrastructure' as const;
  readonly priority = 3;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = ['cve', 'text', 'phrase'] as const;
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const id = vulnId(query, ctx);
    if (!id) return [];
    const terms = tokenize(query);
    const vuln = await fetchJson<OsvVuln>(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });
    if (!vuln?.id) return [];
    const severity = vuln.severity?.map((s) => `${s.type} ${s.score}`).join(', ');
    const advisory = vuln.references?.find((r) => r.type === 'ADVISORY')?.url;
    return [
      makeResult({
        title: `${vuln.id}${vuln.aliases?.length ? ` (${vuln.aliases.join(', ')})` : ''}`,
        url: advisory ?? `https://osv.dev/vulnerability/${vuln.id}`,
        snippet: [vuln.summary, severity ? `Severity: ${severity}` : null, vuln.details?.slice(0, 300)]
          .filter(Boolean)
          .join(' · '),
        provider: this.name,
        origin: 'web',
        source: 'osv.dev',
        tags: ['vulnerability', 'osv'],
        score: 0.8 + 0.15 * lexicalRelevance(`${vuln.id} ${vuln.summary ?? ''}`, terms),
        archivedDate: vuln.published,
        terms,
      }),
    ];
  }
}

// --- GitHub Security Advisories ------------------------------------------

interface GhsaAdvisory {
  ghsa_id: string;
  cve_id?: string | null;
  summary?: string;
  description?: string;
  severity?: string;
  html_url: string;
  published_at?: string;
  cvss?: { score?: number | null; vector_string?: string | null };
}

/**
 * GitHub's global security advisory database. No token needed for the public
 * `GET /advisories` endpoint (rate-limited). Looked up by CVE or GHSA id.
 */
export class GitHubAdvisoriesProvider implements SearchProvider {
  readonly name = 'GitHub Advisories';
  readonly category = 'infrastructure' as const;
  readonly priority = 3;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = ['cve', 'text', 'phrase'] as const;
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 6000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const id = vulnId(query, ctx);
    if (!id) return [];
    const terms = tokenize(query);
    const param = id.startsWith('GHSA-') ? `ghsa_id=${id}` : `cve_id=${id}`;
    const rows = await fetchJson<GhsaAdvisory[]>(
      `https://api.github.com/advisories?${param}&per_page=5`,
      {
        timeoutMs: this.timeoutMs,
        signal: ctx.signal,
        fetchImpl: this.opts.fetchImpl,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'BeaconSearchBot/1.0 (discovery)',
          'x-github-api-version': '2022-11-28',
        },
      },
    );
    return (Array.isArray(rows) ? rows : []).map((adv) => {
      const cvss = adv.cvss?.score ? `CVSS ${adv.cvss.score}` : null;
      return makeResult({
        title: `${adv.ghsa_id}${adv.cve_id ? ` / ${adv.cve_id}` : ''}${
          adv.severity ? ` — ${adv.severity}` : ''
        }`,
        url: adv.html_url,
        snippet: [adv.summary, cvss, adv.description?.slice(0, 240)].filter(Boolean).join(' · '),
        provider: this.name,
        origin: 'web',
        source: 'github.com',
        tags: ['vulnerability', 'advisory', 'ghsa'],
        score: 0.78 + 0.15 * lexicalRelevance(`${adv.ghsa_id} ${adv.summary ?? ''}`, terms),
        archivedDate: adv.published_at,
        terms,
      });
    });
  }
}

// --- NVD ------------------------------------------------------------------

interface NvdResponse {
  vulnerabilities?: Array<{
    cve: {
      id: string;
      published?: string;
      descriptions?: Array<{ lang: string; value: string }>;
      metrics?: {
        cvssMetricV31?: Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>;
        cvssMetricV30?: Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>;
      };
    };
  }>;
}

/**
 * NIST National Vulnerability Database. No key (anonymous quota is 5 requests /
 * 30 s — the circuit breaker backs off on 403/429). Handles a CVE id directly,
 * or a keyword search for explicitly security-flavoured queries.
 */
export class NvdProvider implements SearchProvider {
  readonly name = 'NVD';
  readonly category = 'infrastructure' as const;
  readonly priority = 4;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = ['cve', 'text', 'phrase'] as const;
  readonly configured = true;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const id = vulnId(query, ctx);
    const isCve = id?.startsWith('CVE-');
    if (!isCve && !isSecurityQuery(query, ctx)) return [];
    const terms = tokenize(query);
    const url = isCve
      ? `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(id as string)}`
      : `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(
          query,
        )}&resultsPerPage=${Math.min(Math.max(ctx.limit, 5), 15)}`;
    const body = await fetchJson<NvdResponse>(url, {
      timeoutMs: this.timeoutMs,
      signal: ctx.signal,
      fetchImpl: this.opts.fetchImpl,
    });
    return (body.vulnerabilities ?? []).map(({ cve }) => {
      const desc = cve.descriptions?.find((d) => d.lang === 'en')?.value ?? '';
      const metric =
        cve.metrics?.cvssMetricV31?.[0]?.cvssData ?? cve.metrics?.cvssMetricV30?.[0]?.cvssData;
      const sev = metric?.baseScore
        ? `CVSS ${metric.baseScore}${metric.baseSeverity ? ` (${metric.baseSeverity})` : ''}`
        : null;
      return makeResult({
        title: `${cve.id}${sev ? ` — ${sev}` : ''}`,
        url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
        snippet: [sev, desc.slice(0, 320)].filter(Boolean).join(' · '),
        provider: this.name,
        origin: 'web',
        source: 'nvd.nist.gov',
        tags: ['vulnerability', 'cve', 'nvd'],
        score:
          (isCve ? 0.85 : 0.55) +
          0.15 * lexicalRelevance(`${cve.id} ${desc}`, terms) +
          Math.min(0.15, (metric?.baseScore ?? 0) / 100),
        archivedDate: cve.published,
        terms,
      });
    });
  }
}

// --- CISA Known Exploited Vulnerabilities -------------------------------

interface KevCatalog {
  vulnerabilities?: Array<{
    cveID: string;
    vendorProject?: string;
    product?: string;
    vulnerabilityName?: string;
    dateAdded?: string;
    shortDescription?: string;
    requiredAction?: string;
    knownRansomwareCampaignUse?: string;
  }>;
}

/**
 * CISA's Known Exploited Vulnerabilities catalog — CVEs with confirmed
 * in-the-wild exploitation. No key. The catalog is one JSON file, fetched once
 * and cached in-process, then filtered by CVE id or keyword.
 */
export class CisaKevProvider implements SearchProvider {
  readonly name = 'CISA KEV';
  readonly category = 'infrastructure' as const;
  readonly priority = 2;
  readonly timeoutMs: number;
  readonly supportedQueryTypes = ['cve', 'text', 'phrase'] as const;
  readonly configured = true;

  private catalog: KevCatalog['vulnerabilities'] | null = null;
  private fetchedAt = 0;
  private static readonly TTL_MS = 6 * 60 * 60 * 1000;

  constructor(private readonly opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 9000;
  }

  private async load(signal: AbortSignal): Promise<NonNullable<KevCatalog['vulnerabilities']>> {
    if (this.catalog && Date.now() - this.fetchedAt < CisaKevProvider.TTL_MS) return this.catalog;
    const body = await fetchJson<KevCatalog>(
      'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      { timeoutMs: this.timeoutMs, signal, fetchImpl: this.opts.fetchImpl },
    );
    this.catalog = body.vulnerabilities ?? [];
    this.fetchedAt = Date.now();
    return this.catalog;
  }

  async search(query: string, ctx: ProviderContext): Promise<UnifiedResult[]> {
    const id = vulnId(query, ctx);
    if (!id?.startsWith('CVE-') && !isSecurityQuery(query, ctx)) return [];
    const terms = tokenize(query);
    const catalog = await this.load(ctx.signal);

    const matches = id?.startsWith('CVE-')
      ? catalog.filter((v) => v.cveID.toUpperCase() === id)
      : catalog
          .filter((v) => {
            const hay = `${v.cveID} ${v.vendorProject} ${v.product} ${v.vulnerabilityName} ${v.shortDescription}`.toLowerCase();
            return terms.length > 0 && terms.every((t) => hay.includes(t));
          })
          .slice(0, Math.min(Math.max(ctx.limit, 5), 15));

    return matches.map((v) =>
      makeResult({
        title: `${v.cveID} — ${v.vulnerabilityName ?? `${v.vendorProject} ${v.product}`} (exploited in the wild)`,
        url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${v.cveID}`,
        snippet: [
          v.shortDescription,
          v.dateAdded ? `Added to KEV ${v.dateAdded}` : null,
          v.knownRansomwareCampaignUse && v.knownRansomwareCampaignUse !== 'Unknown'
            ? `Ransomware: ${v.knownRansomwareCampaignUse}`
            : null,
          v.requiredAction ? `Action: ${v.requiredAction}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        provider: this.name,
        origin: 'web',
        source: 'cisa.gov',
        tags: ['vulnerability', 'kev', 'exploited-in-the-wild'],
        score: 0.9 + 0.08 * lexicalRelevance(`${v.cveID} ${v.shortDescription ?? ''}`, terms),
        archivedDate: v.dateAdded,
        terms,
      }),
    );
  }
}
