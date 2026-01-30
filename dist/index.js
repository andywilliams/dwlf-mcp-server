#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DWLFClient } from './client.js';
import { registerMarketDataTools } from './tools/market-data.js';
import { registerIndicatorTools } from './tools/indicators.js';
import { registerSignalTools } from './tools/signals.js';
import { registerWatchlistTools } from './tools/watchlist.js';
import { registerStrategyTools } from './tools/strategies.js';
import { registerBacktestTools } from './tools/backtests.js';
import { registerPortfolioTools } from './tools/portfolio.js';
import { registerTradeTools } from './tools/trades.js';
import { registerCustomEventTools } from './tools/custom-events.js';
import { registerAISummaryTools } from './tools/ai-summary.js';
import { registerAcademyTools } from './tools/academy.js';
import { registerSymbolActivationTools } from './tools/symbol-activations.js';
import { registerSymbolsResource } from './resources/symbols.js';
const server = new McpServer({
    name: 'dwlf',
    version: '0.3.0',
});
const client = new DWLFClient();
// Register all tools — Phase 1 (read)
registerMarketDataTools(server, client);
registerIndicatorTools(server, client);
registerSignalTools(server, client);
registerWatchlistTools(server, client);
// Register all tools — Phase 2 (read + write)
registerStrategyTools(server, client);
registerBacktestTools(server, client);
registerPortfolioTools(server, client);
registerTradeTools(server, client);
registerCustomEventTools(server, client);
// Register all tools — Phase 2b (symbol activation for events & strategies)
registerSymbolActivationTools(server, client);
// Register all tools — Phase 3 (AI summary endpoints)
registerAISummaryTools(server, client);
// Register all tools — Phase 4 (Academy — public CDN, no auth)
registerAcademyTools(server);
// Register resources
registerSymbolsResource(server, client);
// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map