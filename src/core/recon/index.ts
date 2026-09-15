import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { slugify } from '../text.js';
import type { DocumentInput } from '../types.js';
import { ReconRunner } from './recon.js';
import type { ReconReport } from './types.js';

export * from './types.js';
export { parseReconTarget, looksLikeBareTarget, registrableDomain } from './target.js';
export { ReconRunner } from './recon.js';
export { lookupDns } from './dns.js';
export { geolocateIp } from './ipgeo.js';
export { gradeSecurityHeaders, fingerprintTech, probeHttp } from './http.js';

/** Build a {@link ReconRunner} from runtime config. */
export function createReconRunner(
  config: Pick<Config, 'recon' | 'crawlUserAgent'>,
  deps: { logger?: Logger; fetchImpl?: typeof fetch } = {},
): ReconRunner {
  return new ReconRunner({
    timeoutMs: config.recon.timeoutMs,
    userAgent: config.crawlUserAgent,
    allowPrivateHosts: config.recon.allowPrivateHosts,
    allowWhois: config.recon.whois,
    maxGeoIps: config.recon.maxGeoIps,
    logger: deps.logger,
    fetchImpl: deps.fetchImpl,
  });
}

/** Render a completed recon report as a searchable document for the index. */
export function reconReportToDocument(report: ReconReport): DocumentInput {
  const { target } = report;
  const lines = [
    `Target: ${target.host} (${target.kind})`,
    `Result: ${report.summary.headline}`,
    '',
    ...report.summary.facts,
    '',
    ...report.findings.map((x) => `[${x.status.toUpperCase()}] ${x.label}: ${x.detail}`),
  ];
  if (report.resolvedIps.length) lines.push('', `Addresses: ${report.resolvedIps.join(', ')}`);
  if (report.subdomains?.subdomains.length) {
    lines.push('', `Subdomains: ${report.subdomains.subdomains.slice(0, 50).join(', ')}`);
  }

  const tags = ['recon', `recon:${target.kind}`];
  if (report.http?.securityHeaders.grade) tags.push(`headers:${report.http.securityHeaders.grade}`);
  for (const tech of report.http?.technologies ?? []) tags.push(`tech:${slugify(tech)}`);
  const geo = report.ipGeo.find((g) => g.available && g.countryCode);
  if (geo?.countryCode) tags.push(`country:${geo.countryCode.toLowerCase()}`);

  return {
    id: `recon-${slugify(target.host)}`,
    title: `Recon — ${target.host}`,
    body: lines.join('\n'),
    url: target.kind === 'ip' ? undefined : target.url,
    tags,
    source: 'recon',
  };
}
