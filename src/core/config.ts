import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  indexFile: string;
  webDir: string;
  logLevel: string;
  logPretty: boolean;
  corsOrigin: string | boolean;
  persistDebounceMs: number;
  crawlUserAgent: string;
  crawlMaxPages: number;
  crawlConcurrency: number;
  crawlTimeoutMs: number;
  crawlDelayMs: number;
  crawlAllowPrivateHosts: boolean;
  maxBodyBytes: number;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

/**
 * Resolve runtime configuration from environment variables, applying safe
 * defaults so the app runs with zero configuration in any environment.
 */
export function loadConfig(overrides: Partial<Config> = {}): Config {
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, readString('BEACON_DATA_DIR', 'data'));
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  const base: Config = {
    host: readString('BEACON_HOST', '0.0.0.0'),
    port: readInt('BEACON_PORT', readInt('PORT', 7700)),
    dataDir,
    indexFile: path.resolve(cwd, readString('BEACON_INDEX_FILE', path.join(dataDir, 'index.json'))),
    webDir: path.resolve(cwd, readString('BEACON_WEB_DIR', 'web/dist')),
    logLevel: readString('BEACON_LOG_LEVEL', nodeEnv === 'test' ? 'silent' : 'info'),
    logPretty: readBool('BEACON_LOG_PRETTY', nodeEnv === 'development'),
    corsOrigin: readString('BEACON_CORS_ORIGIN', '') || true,
    persistDebounceMs: readInt('BEACON_PERSIST_DEBOUNCE_MS', 750),
    crawlUserAgent: readString(
      'BEACON_CRAWL_USER_AGENT',
      'BeaconSearchBot/1.0 (+https://github.com/abbieymatthews030-star/abeaconsearch)',
    ),
    crawlMaxPages: readInt('BEACON_CRAWL_MAX_PAGES', 50),
    crawlConcurrency: readInt('BEACON_CRAWL_CONCURRENCY', 4),
    crawlTimeoutMs: readInt('BEACON_CRAWL_TIMEOUT_MS', 15_000),
    crawlDelayMs: readInt('BEACON_CRAWL_DELAY_MS', 150),
    crawlAllowPrivateHosts: readBool('BEACON_CRAWL_ALLOW_PRIVATE', false),
    maxBodyBytes: readInt('BEACON_MAX_BODY_BYTES', 8 * 1024 * 1024),
  };

  return { ...base, ...overrides };
}
