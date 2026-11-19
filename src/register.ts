import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DWLFClient } from './client.js';
import { BlockApiClient } from './block/client.js';
import { registerBlockApiTools } from './block/tools.js';
import { profiledServer, type ProfileName, type BlockBackend } from './profiles.js';
import { registerMarketDataTools } from './tools/market-data.js';
import { registerRangeTools } from './tools/ranges.js';
import { registerCycleSetupTools } from './tools/cycle-setups.js';
import { registerCycleWindowTools } from './tools/cycle-windows.js';
import { registerDivergenceTools } from './tools/divergences.js';
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
import { registerThesisTools } from './tools/theses.js';
import { registerSymbolsResource } from './resources/symbols.js';

import { registerOnchainCatalogueTools } from './tools/onchain-catalogue.js';
import { registerExplainEventTools } from './tools/explain-event.js';

/** Registers every tool module and resource on `server` (which may be a profile's filtered view). */
export function registerAll(server: McpServer, client: DWLFClient): void {
  // Register all tools — Phase 1 (read)
  registerMarketDataTools(server, client);
  registerRangeTools(server, client);
  registerCycleSetupTools(server, client);
  registerCycleWindowTools(server, client);
  registerDivergenceTools(server, client);
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
  registerSemanticTools(server, client);

  // Register all tools — Phase 6 (Account — quotas, plan, policy limits)
  registerAccountTools(server, client);

  // Register all tools — Phase 7 (Subscription CRUD — pairs event sources with delivery channels)
  registerSubscriptionTools(server, client);

  // Register all tools — Phase 8 (Thesis alerts, "Waiting for": DWLF-855; full profile only)
  registerThesisTools(server, client);

  // Register resources
  registerSymbolsResource(server, client);

  // Block: the on-chain event catalogue (DWLF-621/646): definitions live from /v2/events/explain; bundled copy as the offline fallback
  registerOnchainCatalogueTools(server, client);
  registerExplainEventTools(server, client);
}

/**
 * The one place a server gets its tools, for the stdio entry point and any per-request host (DWLF-876 D3/D7): on the
 * Block profile's `block-api` backend, the Block API tools through `blockClient` and nothing else; otherwise every
 * module through the profile's view. Each client is built by the caller, so a host passes one per request.
 */
export function registerForProfile(server: McpServer, profile: ProfileName, backend: BlockBackend,
  clients: { dwlf?: () => DWLFClient; block?: () => BlockApiClient } = {}): void {
  if (backend === 'block-api') {
    registerBlockApiTools(server, (clients.block ?? (() => new BlockApiClient()))());
    return;
  }
  registerAll(profiledServer(server, profile), (clients.dwlf ?? (() => new DWLFClient()))());
}
