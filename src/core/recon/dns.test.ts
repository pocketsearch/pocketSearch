import { describe, expect, it, vi } from 'vitest';
import { lookupDns } from './dns.js';

function dohResponder(map: Record<number, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const type = Number(url.searchParams.get('type'));
    const name = url.searchParams.get('name') ?? '';
    if (name.startsWith('_dmarc.')) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ name, type: 16, data: '"v=DMARC1; p=reject"' }] }));
    }
    const body = map[type] ?? { Status: 0, Answer: [] };
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
}

describe('lookupDns', () => {
  it('collects records by type and extracts SPF + DMARC', async () => {
    const fetchImpl = dohResponder({
      1: { Status: 0, Answer: [{ name: 'x', type: 1, data: '93.184.216.34' }] },
      15: { Status: 0, Answer: [{ name: 'x', type: 15, data: '10 mail.example.com.' }] },
      16: {
        Status: 0,
        Answer: [
          { name: 'x', type: 16, data: '"v=spf1 include:_spf.example.com -all"' },
          { name: 'x', type: 16, data: '"google-site-verification=abc"' },
        ],
      },
    });
    const records = await lookupDns('example.com', { timeoutMs: 1000, fetchImpl });
    expect(records.A).toEqual(['93.184.216.34']);
    expect(records.MX).toEqual(['10 mail.example.com']);
    expect(records.SPF).toEqual(['v=spf1 include:_spf.example.com -all']);
    expect(records.DMARC[0]).toMatch(/p=reject/);
    expect(records.nxdomain).toBe(false);
  });

  it('flags NXDOMAIN when every type returns status 3', async () => {
    const fetchImpl = dohResponder({
      1: { Status: 3 },
      2: { Status: 3 },
      5: { Status: 3 },
      6: { Status: 3 },
      15: { Status: 3 },
      16: { Status: 3 },
      28: { Status: 3 },
    });
    const records = await lookupDns('nope.invalid', { timeoutMs: 1000, fetchImpl });
    expect(records.nxdomain).toBe(true);
  });
});
