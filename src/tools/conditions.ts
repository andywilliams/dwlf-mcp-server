import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * The BTC conditions check (DWLF-602). Backed by GET /v2/conditions/btc. Pass-through: the backend assembles the
 * legs and applies the licensing and point-in-time rules; this tool computes nothing.
 */
export const CONDITIONS_SYMBOLS = ['BTC/USD', 'BTCOC/USD'] as const;

export function registerConditionsTools(server: McpServer, client: DWLFClient) {
  server.tool(
    'dwlf_get_btc_conditions',
    'What are Bitcoin\'s conditions right now? ONE call returning: the regime (daily and weekly trend, momentum, ' +
      'volatility; the Weinstein weekly stage; and the on-chain bands: MVRV below 1 / above 3.5, supply in profit ' +
      'below 50 %, 7-day STH-SOPR below 1); the COST-BASIS LADDER (price above or below the realised, ' +
      'short-term-holder and long-term-holder realised price, and since when); the stored weekly and daily cycle ' +
      'windows with today\'s `position` against their dates; every event on the symbol in the last `days` (price, ' +
      'cycle, CFTC positioning `cot.*`, on-chain `onchain.*`); and provenance. Use it as the first step before ' +
      'reasoning about Bitcoin, instead of stitching dwlf_get_regime, dwlf_get_stage, dwlf_get_cycle_windows and ' +
      'dwlf_get_events together.\n\n' +
      'SHAPE: `{ kind, responseVersion, framing, symbol, asOf, price, regime: { daily, weekly, stage, onchain: ' +
      '{ status, bands[] } }, costBasisLadder: { status, onchainSymbol, sideBasis, levelsPending, rungs: [{ key, ' +
      'side, level, distancePct, since }], counts }, cycleWindows: { weekly, daily }, recentEvents: { days, ' +
      'truncated, events: [{ eventType, date, family, onchain?, cot? }] }, provenance: { sources, methodVersions, ' +
      'brkVersion, scoring, unavailable } }`. A rung\'s `side` comes from its latest on-chain cross event; ' +
      '`level`/`distancePct` need the stored on-chain day (`levelsPending: true` until then). On-chain readings ' +
      'are read from the own-data BTC symbol (`onchainSymbol`), whose price is DWLF\'s own BRK oracle close.\n\n' +
      '⚠️ Read before you report:\n' +
      '- `framing`: these are CONDITIONS, NOT CALLS. Describe the state ("price is below the STH realised price ' +
      'since 20-Oct"); never turn it into a buy/sell/hold recommendation. `provenance.scoring` is `unscored`: no ' +
      'reading is a validated predictor.\n' +
      '- `status: "pending"` means the on-chain events are not ingested yet, not that the market is neutral. ' +
      'Say so rather than inferring a side.\n' +
      '- `provenance.unavailable` lists legs that failed or timed out (those fields are null). Never fill them ' +
      'from memory.\n' +
      '- `asOf` holds the price bar date and the on-chain day, block height and `confirmedAt`. Quote them, so ' +
      'staleness is visible.\n' +
      '- `price.withheld: true` means this API key may not receive the vendor\'s raw close (data licensing). ' +
      'Sides and states are unaffected; do not ask for the close another way.\n' +
      '- Cycle windows carry `verification` (currently unverified): treat them as rough timing, not a forecast.',
    {
      symbol: z
        .string()
        .optional()
        .describe('BTC/USD (default; the exchange price) or BTCOC/USD (DWLF\'s own on-chain BTC price). Also accepts BTC, BTCUSD, BTC-USD.'),
      days: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe('Recent-events window in days (default 14).'),
    },
    async ({ symbol, days }) => {
      try {
        const params: Record<string, string | number> = {};
        if (symbol) {
          // normalizeSymbol maps BTC → BTC-USD and BTC/USD → BTC-USD, which the route reads back as BTC/USD.
          params.symbol = normalizeSymbol(symbol);
        }
        if (days !== undefined) params.days = days;
        const data = await client.get('/conditions/btc', params);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching BTC conditions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
