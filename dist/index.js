#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DWLFClient } from './client.js';
import { registerMarketDataTools } from './tools/market-data.js';
import { registerIndicatorTools } from './tools/indicators.js';
import { registerSignalTools } from './tools/signals.js';
import { registerWatchlistTools } from './tools/watchlist.js';
import { registerSymbolsResource } from './resources/symbols.js';
const server = new McpServer({
    name: 'dwlf',
    version: '0.1.0',
});
const client = new DWLFClient();
// Register all tools
registerMarketDataTools(server, client);
registerIndicatorTools(server, client);
registerSignalTools(server, client);
registerWatchlistTools(server, client);
// Register resources
registerSymbolsResource(server, client);
// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map