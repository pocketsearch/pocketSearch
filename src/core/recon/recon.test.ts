import { describe, expect, it, vi } from 'vitest';
import { ReconRunner } from './recon.js';

function makeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const { hostname, pathname, searchParams } = url;

    if (hostname === 'cloudflare-dns.com') {
      const type = Number(searchParams.get('type'));
      const name = searchParams.get('name') ?? '';
      if (name.startsWith('_dmarc.')) return new Response(JSON.stringify({ Status: 0, Answer: [] }));
      if (type === 1) {
        return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }));
      }
      if (type === 2) {
        return new Response(
          JSON.stringify({ Status: 0, Answer: [{ type: 2, data: 'ns1.example.net.' }] }),
        );
      }
      return new Response(JSON.stringify({ Status: 0, Answer: [] }));
    }

    if (hostname === 'rdap.org') {
      return new Response(
        JSON.stringify({
          events: [{ eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' }],
          status: ['client transfer prohibited'],
          nameservers: [{ ldhName: 'A.IANA-SERVERS.NET' }],
          entities: [
            {
              roles: ['registrar'],
              vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar LLC']]],
              publicIds: [{ type: 'IANA Registrar ID', identifier: '376' }],
            },
          ],
          secureDNS: { delegationSigned: true },
        }),
      );
    }

    if (hostname === 'crt.sh') {
      return new Response(
        JSON.stringify([
          { name_value: 'www.example.com\nexample.com' },
          { name_value: '*.dev.example.com' },
        ]),
      );
    }

    if (hostname === 'ipwho.is') {
      return new Response(
        JSON.stringify({
          ip: '93.184.216.34',
          success: true,
          type: 'IPv4',
          country: 'United States',
          country_code: 'US',
          city: 'Norwalk',
          connection: { asn: 15133, org: 'Edgecast', isp: 'Edgecast' },
          timezone: { id: 'America/New_York' },
        }),
      );
    }

    if (pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /admin/\nSitemap: https://example.com/sitemap.xml');
    }
    if (pathname === '/sitemap.xml') {
      return new Response('<urlset><url><loc>https://example.com/</loc></url></urlset>');
    }

    // the page probe
    return new Response('<html><head><meta name="generator" content="Acme"></head></html>', {
      status: 200,
      headers: { server: 'ECS', 'x-content-type-options': 'nosniff' },
    });
  }) as unknown as typeof fetch;
}

const runner = (fetchImpl: typeof fetch) =>
  new ReconRunner({
    timeoutMs: 1000,
    userAgent: 'test-agent',
    allowPrivateHosts: true,
    allowWhois: false,
    fetchImpl,
  });

describe('ReconRunner', () => {
  it('assembles a full report for a domain', async () => {
    const fetchImpl = makeFetch();
    const report = await runner(fetchImpl).run('example.com', { includeTls: false });

    expect(report.target).toMatchObject({ kind: 'domain', host: 'example.com' });
    expect(report.resolvedIps).toContain('93.184.216.34');
    expect(report.registration?.registrar).toBe('Example Registrar LLC');
    expect(report.registration?.dnssec).toBe(true);
    expect(report.subdomains?.subdomains).toEqual(expect.arrayContaining(['www.example.com', 'dev.example.com']));
    expect(report.robots?.disallow).toEqual(['/admin/']);
    expect(report.ipGeo[0]).toMatchObject({ available: true, country: 'United States' });
    expect(report.http?.technologies).toContain('Acme');

    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain('spf'); // no SPF record -> a finding exists
    expect(ids).toContain('dns-resolve');
    expect(report.summary.headline).toMatch(/example\.com/);
  });

  it('isolates a failing check into errors[] without aborting the run', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.hostname === 'crt.sh') throw new Error('crt.sh down');
      if (url.hostname === 'cloudflare-dns.com') {
        return new Response(JSON.stringify({ Status: 0, Answer: [] }));
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runner(fetchImpl).run('example.com', {
      includeTls: false,
      includeIpGeo: false,
    });
    // enumerateSubdomains swallows its own error and returns available:false
    expect(report.subdomains?.available).toBe(false);
    expect(report.findings).toBeDefined();
  });

  it('refuses private targets unless allowed', async () => {
    const r = new ReconRunner({
      timeoutMs: 500,
      userAgent: 't',
      allowPrivateHosts: false,
      allowWhois: false,
      fetchImpl: makeFetch(),
    });
    await expect(r.run('127.0.0.1')).rejects.toThrow(/private or reserved/);
  });

  it('rejects a malformed target', async () => {
    await expect(runner(makeFetch()).run('this is not a target')).rejects.toThrow();
  });
});
