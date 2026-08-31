import { loadConfig } from '../core/config.js';
import { loadDotEnv } from '../core/env.js';
import { createLogger } from '../core/logger.js';

loadDotEnv();
import { PersistentEngine } from '../core/store.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const engine = new PersistentEngine({
    indexFile: config.indexFile,
    debounceMs: config.persistDebounceMs,
    logger,
  });
  await engine.load();

  const app = await buildApp({ config, engine, logger });
  await app.listen({ host: config.host, port: config.port });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error({ err: error }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', error);
  process.exit(1);
});
