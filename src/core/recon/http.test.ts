import { describe, expect, it } from 'vitest';
import { fingerprintTech, gradeSecurityHeaders, probeHttp } from './http.js';

describe('gradeSecurityHeaders', () => {
  it('grades A when every header is present', () => {
    const h = new Headers({
      'strict-transport-security': 'max-age=63072000',
      'content-security-policy': "default-src 'self'",
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'geolocation=()',
    });
    const report = gradeSecurityHeaders(h);
    expect(report.grade).toBe('A');
    expect(report.present).toBe(6);
    expect(report.missing).toEqual([]);
  });

  it('grades F with nothing set and lists what is missing', () => {
    const report = gradeSecurityHeaders(new Headers());
    expect(report.grade).toBe('F');
    expect(report.missing).toContain('content-security-policy');
  });
});

describe('fingerprintTech', () => {
  it('detects stacks from headers and body', () => {
    const headers = new Headers({ server: 'nginx', 'x-powered-by': 'PHP/8.2' });
    const html = '<html><head><meta name="generator" content="WordPress 6.5"></head><body>wp-content</body></html>';
    const tech = fingerprintTech(headers, html);
    expect(tech).toEqual(expect.arrayContaining(['Nginx', 'PHP', 'WordPress', 'WordPress 6.5']));
  });

  it('returns an empty list for an unremarkable page', () => {
    expect(fingerprintTech(new Headers(), '<html><body>hello</body></html>')).toEqual([]);
  });
});

describe('probeHttp', () => {
  it('summarises a normal response', async () => {
    const fetchImpl = (async () =>
      new Response('<html>data-reactroot</html>', {
        status: 200,
        headers: { server: 'cloudflare', 'x-content-type-options': 'nosniff' },
      })) as unknown as typeof fetch;
    const info = await probeHttp('https://example.com/', {
      timeoutMs: 1000,
      fetchImpl,
      userAgent: 'test',
    });
    expect(info.available).toBe(true);
    expect(info.status).toBe(200);
    expect(info.server).toBe('cloudflare');
    expect(info.technologies).toContain('React');
    expect(info.securityHeaders.present).toBe(1);
  });

  it('reports the error on a network failure without throwing', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const info = await probeHttp('https://example.com/', { timeoutMs: 1000, fetchImpl, userAgent: 't' });
    expect(info.available).toBe(false);
    expect(info.error).toMatch(/ECONNREFUSED/);
  });
});
