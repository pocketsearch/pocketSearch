/**
 * Passive reconnaissance types. Every field here is derived from information a
 * host publishes to anyone: DNS, RDAP/WHOIS, the TLS certificate it serves,
 * certificate-transparency logs, and the `robots.txt` / `sitemap.xml` files it
 * offers to crawlers. No port scanning, no authentication, no vulnerability
 * probing.
 */

export type ReconTargetKind = 'domain' | 'ip' | 'url';

export interface ReconTarget {
  /** Exactly what the caller passed. */
  input: string;
  kind: ReconTargetKind;
  /** Bare hostname or IP literal. */
  host: string;
  /** Registrable domain (eTLD+1) when {@link kind} is `domain` or `url`. */
  registrableDomain?: string;
  /** `https://host/` — the URL the HTTP / robots checks probe. */
  url: string;
}

export type ReconGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type ReconFindingStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface ReconFinding {
  id: string;
  label: string;
  status: ReconFindingStatus;
  detail: string;
}

export interface DnsRecords {
  A: string[];
  AAAA: string[];
  MX: string[];
  NS: string[];
  TXT: string[];
  CNAME: string[];
  SOA: string[];
  /** `v=spf1 …` records pulled out of TXT. */
  SPF: string[];
  /** TXT records at `_dmarc.<domain>`. */
  DMARC: string[];
  /** The name does not resolve at all. */
  nxdomain: boolean;
}

export interface RegistrationInfo {
  available: boolean;
  source: 'rdap' | 'whois' | null;
  registrar?: string;
  registrarIanaId?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  statuses: string[];
  nameServers: string[];
  registrantOrg?: string;
  registrantCountry?: string;
  dnssec?: boolean;
  /** Raw `whois` output, only when that path was used. */
  raw?: string;
}

export interface TlsInfo {
  available: boolean;
  error?: string;
  subject?: string;
  issuer?: string;
  altNames: string[];
  validFrom?: string;
  validTo?: string;
  daysUntilExpiry?: number;
  protocol?: string;
  keyType?: string;
  serialNumber?: string;
}

export interface SecurityHeaderReport {
  grade: ReconGrade;
  present: number;
  total: number;
  headers: Record<string, string | null>;
  missing: string[];
}

export interface HttpInfo {
  available: boolean;
  error?: string;
  finalUrl?: string;
  status?: number;
  server?: string;
  poweredBy?: string;
  redirected: boolean;
  securityHeaders: SecurityHeaderReport;
  technologies: string[];
}

export interface RobotsInfo {
  robotsFound: boolean;
  disallow: string[];
  sitemaps: string[];
  sitemapUrlCount: number | null;
}

export interface SubdomainInfo {
  available: boolean;
  source: string;
  subdomains: string[];
  totalFound: number;
}

export interface IpGeoInfo {
  available: boolean;
  error?: string;
  ip?: string;
  source?: string;
  ipType?: 'IPv4' | 'IPv6';
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  postal?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  asn?: string;
  org?: string;
  isp?: string;
  isEuMember?: boolean;
}

export interface ReconOptions {
  /** RDAP / `whois` registration lookup (domains only). Default true. */
  includeRegistration?: boolean;
  /** TLS certificate inspection. Default true. */
  includeTls?: boolean;
  /** Fetch the site for header grading + tech fingerprint. Default true. */
  includeHttp?: boolean;
  /** `robots.txt` + `sitemap.xml`. Default true. */
  includeRobots?: boolean;
  /** crt.sh certificate-transparency subdomain enumeration. Default true. */
  includeSubdomains?: boolean;
  /** IP geolocation for the target (or its resolved addresses). Default true. */
  includeIpGeo?: boolean;
}

export interface ReconReport {
  target: ReconTarget;
  checkedAt: string;
  tookMs: number;
  resolvedIps: string[];
  dns: DnsRecords | null;
  registration: RegistrationInfo | null;
  tls: TlsInfo | null;
  http: HttpInfo | null;
  robots: RobotsInfo | null;
  subdomains: SubdomainInfo | null;
  ipGeo: IpGeoInfo[];
  findings: ReconFinding[];
  summary: {
    headline: string;
    facts: string[];
    pass: number;
    warn: number;
    fail: number;
  };
  sources: string[];
  errors: Array<{ check: string; message: string }>;
}
