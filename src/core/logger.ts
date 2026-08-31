import { pino, type Logger as PinoLogger } from 'pino';
import type { Config } from './config.js';

/**
 * The minimal logging surface used across the core modules. Both a Pino logger
 * and Fastify's `app.log` satisfy this, so callers can pass either.
 */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export function createLogger(config: Pick<Config, 'logLevel' | 'logPretty'>): PinoLogger {
  if (config.logPretty) {
    return pino({
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }
  return pino({ level: config.logLevel });
}
