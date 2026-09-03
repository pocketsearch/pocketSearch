import { hostIsPrivate } from '../net-guard.js';
import type { Logger } from '../logger.js';
import { lookupDns } from './dns.js';
import { geolocateIp } from './ipgeo.js';
import { probeHttp } from './http.js';
import { lookupRegistration } from './registration.js';
import { inspectRobots } from './robots.js';
import { enumerateSubdomains } from './subdomains.js';
import { parseReconTarget } from './target.js';
import { inspectTls } from './tls.js';
import type {
  DnsRecords,
  HttpInfo,
  IpGeoInfo,
  ReconFinding,
  ReconOptions,
  ReconReport,
  RegistrationInfo,
  RobotsInfo,
  SubdomainInfo,
  TlsInfo,
} from './types.js';

export interface ReconRunnerOptions {
  /** Per-check base timeout (ms). Slower sources get a buffer on top. */
  timeoutMs: number;
  userAgent: string;
  /** Allow targets that resolve to private / loopback addresses. */
  allowPrivateHosts: boolean;
  /** Permit the system `whois` fallback when RDAP is empty. */
  allowWhois: boolean;
  /** Max resolved IPs to geolocate for a domain target. */
  maxGeoIps?: number;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

const SENSITIVE_PATH_RE = /admin|login|wp-admin|staging|dev|test|backup|config|\.git|private|internal/i;

async function guarded<T>(
  check: string,
  errors: ReconReport['errors'],
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    errors.push({ check, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Runs the full passive-recon suite for a domain, IP, or URL. Every check is
 * isolated: a failure is recorded in `errors[]` and the rest of the report is
 * still returned. Nothing here probes the target beyond ordinary DNS lookups,
 * one HTTPS handshake, and standard GET requests for `robots.txt` / the page.
 */
export class ReconRunner {
  constructor(private readonly opts: ReconRunnerOptions) {}

  get capabilities(): { whois: boolean; allowPrivateHosts: boolean } {
    return { whois: this.opts.allowWhois, allowPrivateHosts: this.opts.allowPrivateHosts };
  }

  async run(rawTarget: string, options: ReconOptions = {}): Promise<ReconReport> {
    const started = Date.now();
    const target = parseReconTarget(rawTarget);
    const errors: ReconReport['errors'] = [];

    if (!this.opts.allowPrivateHosts && (await hostIsPrivate(target.host))) {
      throw new Error(
        `recon target "${target.host}" resolves to a private or reserved address ` +
          '(set BEACON_RECON_ALLOW_PRIVATE=1 to allow)',
      );
    }

    const t = this.opts.timeoutMs;
    const want = {
      registration: options.includeRegistration !== false && target.kind !== 'ip',
      tls: options.includeTls !== false,
      http: options.includeHttp !== false,
      robots: options.includeRobots !== false,
      subdomains: options.includeSubdomains !== false && target.kind !== 'ip',
      ipGeo: options.includeIpGeo !== false,
    };
    const lookupName = target.registrableDomain ?? target.host;

    const [dns, registration, tls, http, robots, subdomains] = await Promise.all([
      target.kind === 'ip'
        ? Promise.resolve<DnsRecords | null>(null)
        : guarded('dns', errors, () =>
            lookupDns(target.host, { timeoutMs: t, fetchImpl: this.opts.fetchImpl }),
          ),
      want.registration
        ? guarded<RegistrationInfo | null>('registration', errors, () =>
            lookupRegistration(lookupName, {
              timeoutMs: t + 4000,
              fetchImpl: this.opts.fetchImpl,
              allowWhoisFallback: this.opts.allowWhois,
            }),
          )
        : Promise.resolve(null),
      want.tls
        ? guarded<TlsInfo | null>('tls', errors, () => inspectTls(target.host, { timeoutMs: t }))
        : Promise.resolve(null),
      want.http
        ? guarded<HttpInfo | null>('http', errors, () =>
            probeHttp(target.url, {
              timeoutMs: t + 2000,
              fetchImpl: this.opts.fetchImpl,
              userAgent: this.opts.userAgent,
            }),
          )
        : Promise.resolve(null),
      want.robots
        ? guarded<RobotsInfo | null>('robots', errors, () =>
            inspectRobots(target.url, {
              timeoutMs: t,
              fetchImpl: this.opts.fetchImpl,
              userAgent: this.opts.userAgent,
            }),
          )
        : Promise.resolve(null),
      want.subdomains
        ? guarded<SubdomainInfo | null>('subdomains', errors, () =>
            enumerateSubdomains(lookupName, { timeoutMs: t + 6000, fetchImpl: this.opts.fetchImpl }),
          )
        : Promise.resolve(null),
    ]);

    const resolvedIps =
      target.kind === 'ip'
        ? [target.host]
        : [...(dns?.A ?? []), ...(dns?.AAAA ?? [])];

    let ipGeo: IpGeoInfo[] = [];
    if (want.ipGeo && resolvedIps.length) {
      const targets = resolvedIps.slice(0, this.opts.maxGeoIps ?? 3);
      ipGeo = (
        await Promise.all(
          targets.map((ip) =>
            guarded<IpGeoInfo | null>(`ipGeo:${ip}`, errors, () =>
              geolocateIp(ip, { timeoutMs: t, fetchImpl: this.opts.fetchImpl }),
            ),
          ),
        )
      ).filter((r): r is IpGeoInfo => r !== null);
    }

    const findings = buildFindings({ target, dns, registration, tls, http, robots, subdomains });
    const pass = findings.filter((f) => f.status === 'pass').length;
    const warn = findings.filter((f) => f.status === 'warn').length;
    const fail = findings.filter((f) => f.status === 'fail').length;

    const sources = new Set<string>();
    if (dns) sources.add('DNS-over-HTTPS (Cloudflare)');
    if (registration?.available) sources.add(registration.source === 'whois' ? 'whois' : 'RDAP');
    if (tls?.available) sources.add('TLS certificate');
    if (http?.available) sources.add('HTTP response');
    if (robots?.robotsFound) sources.add('robots.txt / sitemap.xml');
    if (subdomains?.available) sources.add('crt.sh');
    for (const g of ipGeo) if (g.available && g.source) sources.add(g.source);

    this.opts.logger?.info(
      { target: target.host, kind: target.kind, tookMs: Date.now() - started, errors: errors.length },
      'recon complete',
    );

    return {
      target,
      checkedAt: new Date().toISOString(),
      tookMs: Date.now() - started,
      resolvedIps,
      dns,
      registration,
      tls,
      http,
      robots,
      subdomains,
      ipGeo,
      findings,
      summary: {
        headline: headline({ target, dns, tls, http, fail, warn }),
        facts: facts({ target, dns, registration, tls, http, subdomains, ipGeo }),
        pass,
        warn,
        fail,
      },
      sources: [...sources],
      errors,
    };
  }
}

interface FindingInputs {
  target: ReconReport['target'];
  dns: DnsRecords | null;
  registration: RegistrationInfo | null;
  tls: TlsInfo | null;
  http: HttpInfo | null;
  robots: RobotsInfo | null;
  subdomains: SubdomainInfo | null;
}

function buildFindings(x: FindingInputs): ReconFinding[] {
  const f: ReconFinding[] = [];
  const add = (id: string, label: string, status: ReconFinding['status'], detail: string) =>
    f.push({ id, label, status, detail });

  if (x.dns) {
    if (x.dns.nxdomain) {
      add('dns-resolve', 'DNS resolution', 'fail', 'The domain does not resolve (NXDOMAIN).');
    } else if (x.dns.A.length === 0 && x.dns.AAAA.length === 0) {
      add(
        'dns-resolve',
        'DNS resolution',
        x.dns.NS.length ? 'info' : 'warn',
        x.dns.NS.length
          ? 'Delegated (NS records present) but no A/AAAA records.'
          : 'No address or nameserver records found.',
      );
    } else {
      add(
        'dns-resolve',
        'DNS resolution',
        'pass',
        `Resolves to ${[...x.dns.A, ...x.dns.AAAA].slice(0, 4).join(', ')}.`,
      );
    }

    if (x.target.kind !== 'ip') {
      add(
        'spf',
        'SPF record',
        x.dns.SPF.length ? 'pass' : 'warn',
        x.dns.SPF.length ? x.dns.SPF[0]! : 'No SPF record — sender policy not published.',
      );
      const dmarc = x.dns.DMARC[0];
      if (!dmarc) {
        add('dmarc', 'DMARC record', 'warn', 'No DMARC record at _dmarc — no reporting/enforcement.');
      } else {
        const policy = /p=(\w+)/i.exec(dmarc)?.[1]?.toLowerCase();
        add(
          'dmarc',
          'DMARC record',
          policy === 'reject' || policy === 'quarantine' ? 'pass' : 'info',
          `Policy: ${policy ?? 'unspecified'}.`,
        );
      }
    }
  }

  if (x.registration?.available) {
    if (x.registration.dnssec !== undefined) {
      add(
        'dnssec',
        'DNSSEC',
        x.registration.dnssec ? 'pass' : 'info',
        x.registration.dnssec ? 'Delegation is signed.' : 'Delegation is not signed.',
      );
    }
    if (x.registration.expiresAt) {
      const days = Math.round((new Date(x.registration.expiresAt).getTime() - Date.now()) / 86_400_000);
      if (Number.isFinite(days)) {
        add(
          'registration-expiry',
          'Registration expiry',
          days < 30 ? 'warn' : 'info',
          `Registration expires ${x.registration.expiresAt.slice(0, 10)} (${days} days).`,
        );
      }
    }
  }

  if (x.tls) {
    if (!x.tls.available) {
      add('tls', 'HTTPS / TLS', 'warn', `No usable TLS on :443 — ${x.tls.error ?? 'handshake failed'}.`);
    } else {
      const days = x.tls.daysUntilExpiry;
      if (typeof days === 'number' && days < 0) {
        add('tls', 'TLS certificate', 'fail', `Certificate expired ${-days} days ago.`);
      } else if (typeof days === 'number' && days < 15) {
        add('tls', 'TLS certificate', 'warn', `Certificate expires in ${days} days.`);
      } else {
        add(
          'tls',
          'TLS certificate',
          'pass',
          `Valid until ${x.tls.validTo?.slice(0, 10) ?? 'unknown'}${
            x.tls.issuer ? `, issued by ${shortIssuer(x.tls.issuer)}` : ''
          }.`,
        );
      }
      if (x.target.kind !== 'ip' && x.tls.altNames.length && !certCoversHost(x.tls.altNames, x.target.host)) {
        add('tls-san', 'Certificate hostname', 'warn', `SANs do not cover ${x.target.host}.`);
      }
    }
  }

  if (x.http?.available) {
    const g = x.http.securityHeaders;
    add(
      'security-headers',
      'Security headers',
      g.grade === 'A' ? 'pass' : g.grade === 'B' || g.grade === 'C' ? 'info' : 'warn',
      `Grade ${g.grade} — ${g.present}/${g.total} present${
        g.missing.length ? `; missing ${g.missing.join(', ')}` : ''
      }.`,
    );
    if (x.http.technologies.length) {
      add('tech', 'Technology fingerprint', 'info', x.http.technologies.join(', '));
    }
  }

  if (x.robots?.robotsFound) {
    const sensitive = x.robots.disallow.filter((p) => SENSITIVE_PATH_RE.test(p));
    if (sensitive.length) {
      add(
        'robots-sensitive',
        'robots.txt disallow list',
        'info',
        `Disallows notable paths: ${sensitive.slice(0, 8).join(', ')}.`,
      );
    }
  }

  if (x.subdomains?.available && x.subdomains.totalFound > 0) {
    add(
      'subdomains',
      'Certificate-transparency subdomains',
      'info',
      `${x.subdomains.totalFound} hostname(s) seen in CT logs.`,
    );
  }

  return f;
}

function certCoversHost(sans: string[], host: string): boolean {
  return sans.some((san) => {
    const s = san.toLowerCase();
    if (s === host) return true;
    if (s.startsWith('*.')) return host.endsWith(s.slice(1)) && host.split('.').length === s.split('.').length;
    return false;
  });
}

function shortIssuer(issuer: string): string {
  return /(?:^|,\s*)(?:O|CN)=([^,]+)/.exec(issuer)?.[1]?.trim() ?? issuer;
}

function headline(x: {
  target: ReconReport['target'];
  dns: DnsRecords | null;
  tls: TlsInfo | null;
  http: HttpInfo | null;
  fail: number;
  warn: number;
}): string {
  if (x.dns?.nxdomain) return `${x.target.host} does not resolve`;
  const bits: string[] = [];
  if (x.target.kind === 'ip') bits.push('IP address');
  else if (x.dns) bits.push(x.dns.A.length || x.dns.AAAA.length ? 'resolves' : 'no A/AAAA');
  if (x.tls?.available) {
    const d = x.tls.daysUntilExpiry;
    bits.push(typeof d === 'number' && d < 0 ? 'TLS expired' : 'HTTPS');
  } else if (x.tls) bits.push('no HTTPS');
  if (x.http?.available) bits.push(`headers ${x.http.securityHeaders.grade}`);
  const tail = x.fail ? `${x.fail} failed` : x.warn ? `${x.warn} to review` : 'no issues flagged';
  return `${x.target.host} — ${bits.join(', ')} · ${tail}`;
}

function facts(x: {
  target: ReconReport['target'];
  dns: DnsRecords | null;
  registration: RegistrationInfo | null;
  tls: TlsInfo | null;
  http: HttpInfo | null;
  subdomains: SubdomainInfo | null;
  ipGeo: IpGeoInfo[];
}): string[] {
  const out: string[] = [];
  if (x.registration?.registrar) out.push(`Registrar: ${x.registration.registrar}`);
  if (x.registration?.createdAt) out.push(`Registered: ${x.registration.createdAt.slice(0, 10)}`);
  if (x.dns?.NS.length) out.push(`Nameservers: ${x.dns.NS.slice(0, 3).join(', ')}`);
  // MX rdata is "<priority> <host>"; show just the hosts, and treat RFC 7505
  // "null MX" (`0 .` / `0`) as no mail.
  const mx = (x.dns?.MX ?? [])
    .map((r) => r.trim().replace(/^\d+\s+/, '').replace(/\.$/, ''))
    .filter((host) => host && host !== '');
  if (mx.length) out.push(`Mail: ${mx.slice(0, 2).join(', ')}`);
  else if (x.dns?.MX.length) out.push('Mail: none (null MX)');
  if (x.http?.server) out.push(`Server: ${x.http.server}`);
  if (x.tls?.issuer) out.push(`TLS issuer: ${shortIssuer(x.tls.issuer)}`);
  const geo = x.ipGeo.find((g) => g.available);
  if (geo) {
    out.push(
      `Hosted: ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ')}` +
        (geo.org ? ` (${geo.org})` : ''),
    );
  }
  if (x.subdomains?.totalFound) out.push(`Known subdomains: ${x.subdomains.totalFound}`);
  return out;
}
