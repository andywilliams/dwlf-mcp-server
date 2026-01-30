import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerWatchlistTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. Get watchlist
  server.tool(
    'dwlf_get_watchlist',
    "Get the user's watchlist — symbols they're actively monitoring.",
    {},
    async () => {
      try {
        const data = await client.get('/watchlist');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching watchlist: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 2. Add symbol to watchlist
  server.tool(
    'dwlf_add_to_watchlist',
    "Add a trading symbol to the user's watchlist for monitoring.",
    {
      symbol: z
        .string()
        .describe('Trading symbol to add — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
    },
    async ({ symbol }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const data = await client.post('/watchlist', { symbol: sym });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error adding ${symbol} to watchlist: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
