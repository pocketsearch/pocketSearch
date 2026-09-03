import { fetchWithTimeout } from '../http.js';
import type { HttpInfo, ReconGrade, SecurityHeaderReport } from './types.js';

const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
] as const;

const TECH_SIGNATURES: Array<[string, string[]]> = [
  ['WordPress', ['wp-content', 'wp-includes', '/wp-json/']],
  ['Drupal', ['sites/all/', 'drupal.js', 'X-Generator: Drupal']],
  ['Joomla', ['/media/jui/', 'com_content', 'joomla']],
  ['Shopify', ['cdn.shopify.com', 'shopify.theme', 'x-shopify-stage']],
  ['Wix', ['wix.com', 'wixstatic.com', 'x-wix-']],
  ['Squarespace', ['squarespace.com', 'static1.squarespace.com']],
  ['Webflow', ['webflow.io', 'wf-', 'data-wf-page']],
  ['Ghost', ['ghost.io', 'content="Ghost']],
  ['Next.js', ['/_next/static/', '__next_data__', 'x-powered-by: next.js']],
  ['Nuxt', ['/_nuxt/', '__nuxt']],
  ['React', ['__react_devtools', 'data-reactroot', 'react-dom']],
  ['Vue.js', ['__vue__', 'data-v-', 'vue.js']],
  ['Angular', ['ng-version', 'angular.min.js']],
  ['Svelte', ['svelte-', '__svelte']],
  ['jQuery', ['jquery.min.js', 'jquery.js', '/jquery-']],
  ['Bootstrap', ['bootstrap.min.css', 'bootstrap.bundle']],
  ['Tailwind CSS', ['tailwindcss', '--tw-']],
  ['Cloudflare', ['cf-ray', '__cf_bm', 'cloudflare']],
  ['Fastly', ['x-served-by: cache', 'fastly']],
  ['Akamai', ['x-akamai', 'akamai']],
  ['Vercel', ['x-vercel-', 'server: vercel']],
  ['Netlify', ['x-nf-request-id', 'server: netlify']],
  ['Google Analytics', ['google-analytics.com', 'gtag(', "ga('create'"]],
  ['Google Tag Manager', ['googletagmanager.com']],
  ['reCAPTCHA', ['recaptcha']],
  ['Cloudflare Turnstile', ['challenges.cloudflare.com/turnstile']],
  ['PHP', ['x-powered-by: php', '.php?', 'phpsessid']],
  ['ASP.NET', ['x-powered-by: asp.net', 'x-aspnet-version', '.aspx', 'asp.net_sessionid']],
  ['Nginx', ['server: nginx']],
  ['Apache', ['server: apache']],
  ['Caddy', ['server: caddy']],
  ['LiteSpeed', ['server: litespeed']],
];

function grade(present: number, total: number): ReconGrade {
  const ratio = present / total;
  if (ratio >= 1) return 'A';
  if (ratio >= 0.66) return 'B';
  if (ratio >= 0.5) return 'C';
  if (ratio >= 0.25) return 'D';
  return 'F';
}

export function gradeSecurityHeaders(headers: Headers): SecurityHeaderReport {
  const present: Record<string, string | null> = {};
  let count = 0;
  for (const name of SECURITY_HEADERS) {
    const value = headers.get(name);
    present[name] = value;
    if (value) count += 1;
  }
  return {
    grade: grade(count, SECURITY_HEADERS.length),
    present: count,
    total: SECURITY_HEADERS.length,
    headers: present,
    missing: SECURITY_HEADERS.filter((h) => !present[h]),
  };
}

export function fingerprintTech(headers: Headers, html: string): string[] {
  const headerBlob = [...headers.entries()].map(([k, v]) => `${k}: ${v}`).join(' ');
  const haystack = `${headerBlob} ${html}`.toLowerCase();
  const detected = new Set<string>();
  for (const [name, signatures] of TECH_SIGNATURES) {
    if (signatures.some((sig) => haystack.includes(sig.toLowerCase()))) detected.add(name);
  }
  const generator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (generator?.[1]) detected.add(generator[1].trim());
  return [...detected].sort((a, b) => a.localeCompare(b));
}

export interface HttpProbeOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  userAgent: string;
  maxHtmlBytes?: number;
}

/**
 * Fetch the target once with a normal browser-style GET, then grade its
 * security headers and fingerprint the stack from the response headers + a
 * bounded slice of the HTML. One request, no probing.
 */
export async function probeHttp(url: string, opts: HttpProbeOptions): Promise<HttpInfo> {
  const emptyGrade = gradeSecurityHeaders(new Headers());
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'user-agent': opts.userAgent, accept: 'text/html,*/*' },
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
      parentSignal: opts.signal,
      redirect: 'follow',
    });

    const limit = opts.maxHtmlBytes ?? 512 * 1024;
    let html = '';
    try {
      const full = await res.text();
      html = full.slice(0, limit);
    } catch {
      html = '';
    }

    return {
      available: true,
      finalUrl: res.url || url,
      status: res.status,
      server: res.headers.get('server') ?? undefined,
      poweredBy: res.headers.get('x-powered-by') ?? undefined,
      redirected: res.redirected || (res.url !== '' && res.url !== url),
      securityHeaders: gradeSecurityHeaders(res.headers),
      technologies: fingerprintTech(res.headers, html),
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      redirected: false,
      securityHeaders: emptyGrade,
      technologies: [],
    };
  }
}
