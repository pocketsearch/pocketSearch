import { describe, expect, it } from 'vitest';
import { looksLikeBareTarget, parseReconTarget, registrableDomain } from './target.js';

describe('parseReconTarget', () => {
  it('parses a bare domain', () => {
    const t = parseReconTarget('Example.COM');
    expect(t).toMatchObject({ kind: 'domain', host: 'example.com', registrableDomain: 'example.com' });
    expect(t.url).toBe('https://example.com/');
  });

  it('parses a subdomain and derives the registrable domain', () => {
    expect(parseReconTarget('mail.eng.example.co.uk').registrableDomain).toBe('example.co.uk');
    expect(parseReconTarget('a.b.example.com').registrableDomain).toBe('example.com');
  });

  it('parses a full URL down to its host', () => {
    const t = parseReconTarget('https://sub.example.org/path?x=1');
    expect(t).toMatchObject({ kind: 'url', host: 'sub.example.org' });
  });

  it('parses IPv4 and IPv6 literals', () => {
    expect(parseReconTarget('8.8.8.8')).toMatchObject({ kind: 'ip', host: '8.8.8.8' });
    expect(parseReconTarget('[2606:4700:4700::1111]')).toMatchObject({
      kind: 'ip',
      host: '2606:4700:4700::1111',
    });
  });

  it('strips a port and path from a bare host', () => {
    expect(parseReconTarget('example.com:8443/admin').host).toBe('example.com');
  });

  it('rejects non-targets', () => {
    expect(() => parseReconTarget('')).toThrow();
    expect(() => parseReconTarget('not a domain')).toThrow();
    expect(() => parseReconTarget('ftp://example.com')).toThrow(/scheme/);
    expect(() => parseReconTarget('localhostnodot')).toThrow();
  });
});

describe('registrableDomain', () => {
  it('handles common multi-label suffixes', () => {
    expect(registrableDomain('foo.bar.co.uk')).toBe('bar.co.uk');
    expect(registrableDomain('foo.bar.com.au')).toBe('bar.com.au');
    expect(registrableDomain('foo.bar.baz.com')).toBe('baz.com');
    expect(registrableDomain('example.com')).toBe('example.com');
  });
});

describe('looksLikeBareTarget', () => {
  it('accepts bare domains and IPs only', () => {
    expect(looksLikeBareTarget('example.com')).toBe(true);
    expect(looksLikeBareTarget('1.2.3.4')).toBe(true);
    expect(looksLikeBareTarget('how to configure nginx')).toBe(false);
    expect(looksLikeBareTarget('https://example.com')).toBe(false);
    expect(looksLikeBareTarget('cats')).toBe(false);
  });
});
