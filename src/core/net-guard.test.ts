import { describe, expect, it } from 'vitest';
import { addressIsPrivate, hostIsPrivate } from './net-guard.js';

describe('addressIsPrivate', () => {
  it('flags loopback, private and link-local IPv4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.4', '169.254.169.254']) {
      expect(addressIsPrivate(ip)).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
      expect(addressIsPrivate(ip)).toBe(false);
    }
  });

  it('flags IPv6 loopback and unique-local', () => {
    expect(addressIsPrivate('::1')).toBe(true);
    expect(addressIsPrivate('fd00::1')).toBe(true);
    expect(addressIsPrivate('fe80::1')).toBe(true);
  });

  it('treats unparseable input as private (fail closed)', () => {
    expect(addressIsPrivate('not-an-ip')).toBe(true);
  });
});

describe('hostIsPrivate', () => {
  it('flags localhost by name', async () => {
    expect(await hostIsPrivate('localhost')).toBe(true);
    expect(await hostIsPrivate('foo.localhost')).toBe(true);
  });

  it('flags literal private IPs without DNS', async () => {
    expect(await hostIsPrivate('127.0.0.1')).toBe(true);
    expect(await hostIsPrivate('169.254.169.254')).toBe(true);
  });

  it('fails closed for hosts that do not resolve', async () => {
    expect(await hostIsPrivate('this-domain-should-not-resolve.invalid')).toBe(true);
  });
});
