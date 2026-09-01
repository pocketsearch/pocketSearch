import type { MotSummary, VehicleRecord } from '../types.js';

export interface ProviderResult<T> {
  ok: boolean;
  /** 'unconfigured' when credentials are absent — treated as "skipped", not an error. */
  reason?: 'unconfigured' | 'not_found' | 'rate_limited' | 'error';
  message?: string;
  data?: T;
}

export interface VehicleProvider {
  readonly name: string;
  readonly configured: boolean;
  lookup(normalizedPlate: string, signal?: AbortSignal): Promise<ProviderResult<VehicleRecord>>;
}

export interface MotProvider {
  readonly name: string;
  readonly configured: boolean;
  lookup(normalizedPlate: string, signal?: AbortSignal): Promise<ProviderResult<MotSummary>>;
}
