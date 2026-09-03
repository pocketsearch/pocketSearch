import { fetchWithTimeout } from '../http.js';
import { addressIsPrivate } from '../net-guard.js';
import type { IpGeoInfo } from './types.js';

export interface IpGeoOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface IpWhoIsResponse {
  ip?: string;
  success?: boolean;
  message?: string;
  type?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  postal?: string;
  latitude?: number;
  longitude?: number;
  is_eu?: boolean;
  connection?: { asn?: number; org?: string; isp?: string };
  timezone?: { id?: string };
}

interface IpApiCoResponse {
  ip?: string;
  error?: boolean;
  reason?: string;
  version?: string;
  country_name?: string;
  country_code?: string;
  region?: string;
  city?: string;
  postal?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  asn?: string;
  org?: string;
  in_eu?: boolean;
}

async function fromIpWhoIs(ip: string, opts: IpGeoOptions): Promise<IpGeoInfo | null> {
  const res = await fetchWithTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    headers: { accept: 'application/json' },
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
    parentSignal: opts.signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as IpWhoIsResponse;
  if (data.success === false) return { available: false, ip, source: 'ipwho.is', error: data.message };
  return {
    available: true,
    ip: data.ip ?? ip,
    source: 'ipwho.is',
    ipType: data.type === 'IPv6' ? 'IPv6' : 'IPv4',
    country: data.country,
    countryCode: data.country_code,
    region: data.region,
    city: data.city,
    postal: data.postal,
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone?.id,
    asn: data.connection?.asn ? `AS${data.connection.asn}` : undefined,
    org: data.connection?.org,
    isp: data.connection?.isp,
    isEuMember: data.is_eu,
  };
}

async function fromIpApiCo(ip: string, opts: IpGeoOptions): Promise<IpGeoInfo | null> {
  const res = await fetchWithTimeout(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
    headers: { accept: 'application/json' },
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
    parentSignal: opts.signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as IpApiCoResponse;
  if (data.error) return { available: false, ip, source: 'ipapi.co', error: data.reason };
  return {
    available: true,
    ip: data.ip ?? ip,
    source: 'ipapi.co',
    ipType: data.version === 'IPv6' ? 'IPv6' : 'IPv4',
    country: data.country_name,
    countryCode: data.country_code,
    region: data.region,
    city: data.city,
    postal: data.postal,
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone,
    asn: data.asn,
    org: data.org,
    isEuMember: data.in_eu,
  };
}

/**
 * Geolocate a public IP with no API key: ipwho.is first, ipapi.co as a fallback.
 * Private / loopback / reserved addresses are refused before any request.
 */
export async function geolocateIp(ip: string, opts: IpGeoOptions): Promise<IpGeoInfo> {
  if (addressIsPrivate(ip)) {
    return { available: false, ip, error: 'address is private / reserved' };
  }
  for (const provider of [fromIpWhoIs, fromIpApiCo]) {
    try {
      const result = await provider(ip, opts);
      if (result?.available) return result;
    } catch {
      // try the next provider
    }
  }
  return { available: false, ip, error: 'no geolocation provider returned data' };
}
