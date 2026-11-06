import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * The conditions check (DWLF-602). Backed by GET /v2/conditions/{asset}, `btc` today. Pass-through: the backend
 * assembles the legs and applies the licensing and point-in-time rules; this tool computes nothing. A second asset
 * is a new enum value, not a new tool.
 */
export const CONDITIONS_ASSETS = ['btc'] as const;

// The symbols the route answers for, in the dash form it is sent in. BTCOC is a KNOWN_PAIRED base now (client.ts); the
// local mapping below is kept as a belt-and-braces for this route's two-symbol check.
const CONDITIONS_SYMBOLS = new Set(['BTC-USD', 'BTCOC-USD']);
const toConditionsSymbol = (input: string): string => {
  const s = normalizeSymbol(input);
  return s === 'BTCOC' || s === 'BTCOCUSD' ? 'BTCOC-USD' : s;
};

export function registerConditionsTools(server: McpServer, client: DWLFClient) {
  server.tool(
    'dwlf_get_conditions',
    'What are an asset\'s conditions right now? Bitcoin today (`asset: "btc"`). ONE call returning: the regime (daily and weekly trend, momentum, ' +
      'volatility; the Weinstein weekly stage; and the on-chain bands: MVRV below 1 / above 3.5, supply in profit ' +
      'below 50 %, 7-day STH-SOPR below 1); the COST-BASIS LADDER (price above or below the realised, ' +
      'short-term-holder and long-term-holder realised price, and since when); the stored weekly and daily cycle ' +
      'windows with today\'s `position` against their dates; every event on the symbol in the last `days` (price, ' +
      'cycle, CFTC positioning `cot.*`, on-chain `onchain.*`); and provenance. For BITCOIN, call this first, ' +
      'instead of stitching dwlf_get_regime, dwlf_get_stage, dwlf_get_cycle_windows and dwlf_get_events together. ' +
      'It carries what dwlf_get_intelligence does not: the on-chain cost basis, the on-chain bands, the cycle ' +
      'windows and CFTC positioning. Use dwlf_get_intelligence for any other symbol, and for BTC\'s S/R levels, ' +
      'FSM state and signal quality.\n\n' +
      'SHAPE (responseVersion 1; the response carries `responseVersion`, so check it): `{ kind: "conditions", ' +
      'asset, responseVersion, framing, symbol, asOf, price, regime: { daily, weekly, stage, onchain: ' +
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
      asset: z
        .enum(CONDITIONS_ASSETS)
        .optional()
        .describe('The asset (default btc; the only one today).'),
      symbol: z
        .string()
        .optional()
        .describe('BTC/USD (default; the exchange price) or BTCOC/USD (DWLF\'s own on-chain BTC price). Any spelling: BTC, BTCUSD, BTC-USD, BTCOC, BTCOCUSD, BTCOC-USD.'),
      days: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe('Recent-events window in days (default 14).'),
    },
    async ({ asset, symbol, days }) => {
      try {
        const params: Record<string, string | number> = {};
        if (symbol) {
          // Dash form, which the route reads back as slash form (BTC-USD → BTC/USD).
          const s = toConditionsSymbol(symbol);
          if (!CONDITIONS_SYMBOLS.has(s)) {
            return {
              content: [{ type: 'text', text: `Usage: symbol must be BTC/USD or BTCOC/USD for asset btc (got "${symbol}").` }],
              isError: true,
            };
          }
          params.symbol = s;
        }
        if (days !== undefined) params.days = days;
        const data = await client.get(`/conditions/${asset || 'btc'}`, params);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // An API older than this tool answers 404 for the route: say so, so an agent does not read it as "no data".
        // Keyed on the response status, never the message text (axios only narrows the error; the request is the client's).
        const hint = axios.isAxiosError(error) && error.response?.status === 404
          ? ' The conditions route is not available on this DWLF API yet; nothing about the market follows from this.'
          : '';
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching ${asset || 'btc'} conditions: ${message}.${hint}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
