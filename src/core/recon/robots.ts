import { fetchWithTimeout } from '../http.js';
import type { RobotsInfo } from './types.js';

export interface RobotsOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  userAgent: string;
}

async function getText(url: string, opts: RobotsOptions): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'user-agent': opts.userAgent },
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
      parentSignal: opts.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Count `<url>` / `<sitemap>` elements without a full XML parse. */
function countSitemapEntries(xml: string): number | null {
  if (!xml.includes('<')) return null;
  const urls = xml.match(/<url\b/gi)?.length ?? 0;
  const nested = xml.match(/<sitemap\b/gi)?.length ?? 0;
  const total = urls + nested;
  return total > 0 ? total : null;
}

/**
 * Read the target's `robots.txt` and first `sitemap.xml`. Both are files sites
 * publish specifically for crawlers, so reading them is not intrusive; the
 * `Disallow` list often points at admin / staging paths worth noting.
 */
export async function inspectRobots(baseUrl: string, opts: RobotsOptions): Promise<RobotsInfo> {
  const root = baseUrl.replace(/\/+$/, '');
  const result: RobotsInfo = {
    robotsFound: false,
    disallow: [],
    sitemaps: [],
    sitemapUrlCount: null,
  };

  const robotsTxt = await getText(`${root}/robots.txt`, opts);
  if (robotsTxt !== null && /(user-agent|disallow|sitemap)\s*:/i.test(robotsTxt)) {
    result.robotsFound = true;
    for (const line of robotsTxt.split(/\r?\n/)) {
      const trimmed = line.trim();
      const disallow = /^disallow:\s*(.+)$/i.exec(trimmed);
      if (disallow?.[1]) result.disallow.push(disallow[1].trim());
      const sitemap = /^sitemap:\s*(\S+)/i.exec(trimmed);
      if (sitemap?.[1]) result.sitemaps.push(sitemap[1].trim());
    }
  }
  result.disallow = [...new Set(result.disallow)].slice(0, 100);

  const sitemapUrl = result.sitemaps[0] ?? `${root}/sitemap.xml`;
  const sitemapXml = await getText(sitemapUrl, opts);
  if (sitemapXml) {
    result.sitemapUrlCount = countSitemapEntries(sitemapXml);
    if (result.sitemapUrlCount !== null && !result.sitemaps.includes(sitemapUrl)) {
      result.sitemaps.push(sitemapUrl);
    }
  }
  result.sitemaps = [...new Set(result.sitemaps)];

  return result;
}
