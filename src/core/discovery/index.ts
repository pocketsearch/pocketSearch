import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { buildProviders } from './providers/index.js';
import { Orchestrator, type OrchestratorEngine } from './orchestrator.js';

export { Orchestrator } from './orchestrator.js';
export type { OrchestratorEngine, SearchOptions } from './orchestrator.js';
export type * from './types.js';
export { classifyQuery } from './classify.js';
export { expandQuery } from './expand.js';

export interface CreateOrchestratorOptions {
  engine: OrchestratorEngine;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

/**
 * Build the discovery orchestrator — the single layer that guarantees every
 * non-empty query yields at least one useful, renderable result by cascading
 * through local index → web providers → query expansion → archives → entity
 * pivots → related material → query suggestions.
 */
export function createOrchestrator(
  config: Config,
  options: CreateOrchestratorOptions,
): Orchestrator {
  return new Orchestrator({
    engine: options.engine,
    providers: buildProviders({
      engine: options.engine,
      config,
      fetchImpl: options.fetchImpl,
    }),
    logger: options.logger,
    userAgent: config.crawlUserAgent,
    fetchImpl: options.fetchImpl,
    crawlAndIndex: config.discovery.crawlAndIndex,
    allowPrivateHosts: config.answer.allowPrivateHosts,
    normalBudgetMs: config.discovery.normalBudgetMs,
    deepBudgetMs: config.discovery.deepBudgetMs,
  });
}
