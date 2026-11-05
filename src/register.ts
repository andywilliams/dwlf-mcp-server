import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DWLFClient } from './client.js';
import { registerMarketDataTools } from './tools/market-data.js';
import { registerRangeTools } from './tools/ranges.js';
import { registerCycleSetupTools } from './tools/cycle-setups.js';
import { registerCycleWindowTools } from './tools/cycle-windows.js';
import { registerStageTools } from './tools/stages.js';
import { registerConditionsTools } from './tools/conditions.js';
import { registerIndicatorTools } from './tools/indicators.js';
import { registerSignalTools } from './tools/signals.js';
import { registerWatchlistTools } from './tools/watchlist.js';
import { registerSymbolTagTools } from './tools/symbol-tags.js';
import { registerStrategyTools } from './tools/strategies.js';
import { registerBacktestTools } from './tools/backtests.js';
import { registerPortfolioTools } from './tools/portfolio.js';
import { registerTradeTools } from './tools/trades.js';
import { registerCustomEventTools } from './tools/custom-events.js';
import { registerEvaluationTools } from './tools/evaluations.js';
import { registerAISummaryTools } from './tools/ai-summary.js';
import { registerAcademyTools } from './tools/academy.js';
import { registerSymbolActivationTools } from './tools/symbol-activations.js';
import { registerAnnotationTools } from './tools/annotations.js';
import { registerTradePlanTools } from './tools/trade-plans.js';
import { registerSemanticTools } from './tools/semantic.js';
import { registerAccountTools } from './tools/account.js';
import { registerSubscriptionTools } from './tools/subscriptions.js';
import { registerSymbolsResource } from './resources/symbols.js';

import { registerOnchainCatalogueTools } from './tools/onchain-catalogue.js';
import { registerExplainEventTools } from './tools/explain-event.js';
import type { ProfileName } from './profiles.js';

/**
 * Registers every tool module and resource on `server` (which may be a profile's filtered view). `profile` sets what
 * dwlf_register_agent signs a user up for when the agent does not say (Block under `block`).
 */
export function registerAll(server: McpServer, client: DWLFClient, options: { profile?: ProfileName } = {}): void {
  // Register all tools — Phase 1 (read)
  registerMarketDataTools(server, client);
  registerRangeTools(server, client);
  registerCycleSetupTools(server, client);
  registerCycleWindowTools(server, client);
  registerStageTools(server, client);
  registerConditionsTools(server, client);
  registerIndicatorTools(server, client);
  registerSignalTools(server, client);
  registerWatchlistTools(server, client);
  registerSymbolTagTools(server, client);

  // Register all tools — Phase 2 (read + write)
  registerStrategyTools(server, client);
  registerBacktestTools(server, client);
  registerPortfolioTools(server, client);
  registerTradeTools(server, client);
  registerCustomEventTools(server, client);

  // Register all tools — Phase 2d (evaluations — on-demand evaluation triggering and polling)
  registerEvaluationTools(server, client);

  // Register all tools — Phase 2c (annotations & trade plans)
  registerAnnotationTools(server, client);
  registerTradePlanTools(server, client);

  // Register all tools — Phase 2b (symbol activation for events & strategies)
  registerSymbolActivationTools(server, client);

  // Register all tools — Phase 3 (AI summary endpoints)
  registerAISummaryTools(server, client);

  // Register all tools — Phase 4 (Academy — public CDN, no auth)
  registerAcademyTools(server);

  // Register all tools — Phase 5 (Semantic layer — regime, intelligence, briefing, agent registration)
  registerSemanticTools(server, client, { defaultProduct: options.profile === 'block' ? 'block' : 'dwlf' });

  // Register all tools — Phase 6 (Account — quotas, plan, policy limits)
  registerAccountTools(server, client);

  // Register all tools — Phase 7 (Subscription CRUD — pairs event sources with delivery channels)
  registerSubscriptionTools(server, client);

  // Register resources
  registerSymbolsResource(server, client);

  // Block: the on-chain event catalogue (DWLF-621/646): definitions live from /v2/events/explain; bundled copy as the offline fallback
  registerOnchainCatalogueTools(server, client);
  registerExplainEventTools(server, client);
}
