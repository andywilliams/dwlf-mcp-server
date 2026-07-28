import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * Range / level context tools — the read side of the range detection layer.
 * Backed by GET /v2/ranges (list) and /v2/ranges/:symbol.
 */
export function registerRangeTools(server: McpServer, client: DWLFClient) {
  server.tool(
    'dwlf_get_ranges',
    'Range / support-resistance CONTEXT derived from cycle pivots — answers "where in a range are we?". ' +
      'Pass a `symbol` for that symbol\'s current daily + weekly ranges, or OMIT it to list every symbol ' +
      'currently in a range (optionally filtered by `timeframe` / `state`). ' +
      'Each range carries: bounds (floor/ceiling/touches/since); a `live` block — livePosition (0 = floor, ' +
      '1 = ceiling) and liveState (near_floor | mid_range | near_ceiling | above | below), recomputed from the ' +
      'latest price = WHERE PRICE IS NOW; and a `snapshot` block — the weekly lifecycle narrative (state ' +
      'broke_out_up / broke_down / retesting_* + brokeDaysAgo + ageDays), which can be up to a week old. ' +
      'Use it for the classic reads: "at the BOTTOM of a range" (near_floor — significant alongside a daily ' +
      'cycle low), "at the TOP of the range — think twice about entering here", "broke out of the range", ' +
      '"retesting an edge". IMPORTANT: "not in a range" is a first-class, common answer — a symbol with no ' +
      'clear current range simply is not returned in the list, or returns inRange:false. Prefer `live` for ' +
      'current location and `snapshot` for the lifecycle narrative. NOTE: this is context, not a trade signal.',
    {
      symbol: z
        .string()
        .optional()
        .describe(
          'A symbol to get that symbol\'s current ranges (daily + weekly). Accepts BTC, BTC/USD, BTC-USD, or ' +
            'stock tickers like AAPL. Omit to LIST every symbol currently in a range.'
        ),
      timeframe: z
        .enum(['daily', 'weekly'])
        .optional()
        .describe('List mode only (no symbol): restrict to one timeframe.'),
      state: z
        .enum(['near_floor', 'mid_range', 'near_ceiling', 'above', 'below'])
        .optional()
        .describe(
          'List mode only (no symbol): filter by LIVE position state. NB this is the live location, not the ' +
            'stored lifecycle state (broke_out_up etc.).'
        ),
    },
    async ({ symbol, timeframe, state }) => {
      try {
        let data: unknown;
        if (symbol) {
          data = await client.get(`/ranges/${normalizeSymbol(symbol)}`);
        } else {
          const params: Record<string, string> = {};
          if (timeframe) params.timeframe = timeframe;
          if (state) params.state = state;
          data = await client.get('/ranges', params);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching ranges${symbol ? ` for ${symbol}` : ''}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
