import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * The stored cycle WINDOW for one symbol — when its next cycle pivot is due.
 * Backed by GET /v2/cycles/windows (DWLF-272). Pass-through: this tool computes
 * nothing. The backend projects the window store and, with `depth` (DWLF-416),
 * derives each window's price zone at read time.
 */
export function registerCycleWindowTools(server: McpServer, client: DWLFClient) {
  server.tool(
    'dwlf_get_cycle_windows',
    'When is this symbol\'s next cycle LOW (or HIGH) due? Returns the STORED cycle timing window per side — ' +
      'the same edges the chart draws and the screener reads — for ONE symbol, whether or not the window is ' +
      'open yet. Use it for "when does X\'s next weekly-low window open?", "when is X\'s next DAILY low due?" and ' +
      '"how many weeks since X\'s last weekly low, against its usual gap?". Unlike `dwlf_get_cycle_setups`, which only lists symbols whose ' +
      'weekly window is already open (and adds `phase` / early-mid-late for them), this answers for any symbol ' +
      'but carries NO phase: to say whether a window is open, overdue or missed, compare today with the dated ' +
      'edges below.\n\n' +
      'SHAPE: `{ symbol, timeframe, generation, generationSource, verification, low, high }`. Each side is ' +
      '`null` when the store holds nothing for it, otherwise `{ symbolUsed, current, retiredAbove, history }`. ' +
      '`current` is the live window: `ruler` (the confirmed pivot the window counts from — `pivotDate`, ' +
      '`price`); dated edges in order `earliest` (the shortest gap on record; weekly and daily — a daily one is always an estimate, `extrapolated: true`; null when there is none) → `opens` (early ' +
      'bound) → `centre` (typical) → `closes` (late bound) → `hardMax` (the last bar by which the pivot must ' +
      'arrive or the window is a miss), each with `bars` counted from the ruler and `extrapolated: true` when it ' +
      'lies beyond the last candle; `gaps` (the gap statistics the band was drawn from, incl. `used` = the ' +
      'inter-pivot gaps in bars, `n`, `spreadPct`); `status` (the store row lifecycle: projected | closed — NOT ' +
      'the screener\'s phase); `calibration` (calibrated = the gap chain is long enough to mean anything); ' +
      '`provenance.projectionHash` — the versioned definition of how the edges are drawn; when it changes, the ' +
      'edges mean something new. Closed windows in `history` carry an `outcome` — where the pivot actually ' +
      'landed (`landedInside`, `daysFromOpen`, …) — which is how to judge how reliable THIS symbol\'s windows ' +
      'have been.\n\n' +
      '⚠️ Read `verification`: while it says `unverified` (it does for every window as long as the detection ' +
      'gate stands failed), treat the edges as rough timing, not a forecast. ⚠️ The store covers WEEKLY and DAILY ' +
      '(daily folded from the ledger\'s daily lows/highs); `timeframe: "1h"` answers with ' +
      'null sides rather than a computed substitute. On daily, `bars` are trading candles, and an extrapolated ' +
      'edge\'s date is an estimate from average bar spacing (it can fall on a non-trading day until real bars exist).\n\n' +
      'PRICE ZONE (`depth: true`, DWLF-416): each window also carries `depth`, DERIVED at read time: how far price ' +
      'MOVED into this side\'s past pivots (`pct` min/p25/median/p75/max, a fall into a low or a rise into a high, ' +
      'over the trailing `n` completed cycles; `thin` when few) and `zone` = that band as prices from the current ' +
      'cycle\'s `anchor`: the confirmed opposite pivot (`anchor.source: confirmed-pivot`, `pivotDate`; the highest ' +
      'high after a low ruler, the lowest low after a high ruler) or, when none has confirmed or price has gone ' +
      'beyond it, the cycle\'s extreme SO FAR (`running-extreme`, `barDate`, not yet a confirmed pivot). `zone` is ' +
      'null when there is no anchor (a pivots-only band — `anchorBasis: pivots`, e.g. candles not licensed or ' +
      'unavailable — before the opposite pivot confirms) or no completed cycles to measure (`pct` null). The CURRENT window also carries `reading`: `position` of the last weekly ' +
      'close in the band — `not-reached` (short of the smallest move on record: the band does not apply yet) | ' +
      '`shallow` | `in-zone` (inside p25–p75: the one to call out) | `deep` | `beyond` — plus `movePct`, `price` ' +
      'and `closeDate`. An API key without raw-candle rights gets `price`/`movePct` null (`priceWithheld: true`), ' +
      'the position kept, and a pivots-only band (`candlesUnavailable: not-licensed`). ⚠️ ' +
      '`depth.verification.state` is `context-only`: a distribution of past moves, NOT a target or forecast. Use ' +
      'it for "has X fallen far enough for a typical weekly low?", never as an entry level. A missing band says ' +
      'why in `depthUnavailable`. For many symbols at once, `dwlf_get_cycle_setups` with `depth: true` carries the ' +
      'same band on each open-window setup.',
    {
      symbol: z
        .string()
        .min(1)
        .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or tickers like PHAU, SPY'),
      timeframe: z
        .enum(['1w', '1d', '1h'])
        .optional()
        .describe('Cycle timeframe (default 1w). Weekly and daily windows are stored; hourly is not.'),
      side: z
        .enum(['low', 'high'])
        .optional()
        .describe('Omit for both sides. `low` = next cycle-low window (the entry timing); `high` = next top.'),
      history: z
        .number()
        .int()
        .min(0)
        .max(20)
        .optional()
        .describe(
          'How many windows OLDER than `current` to return, newest first (0-20, default 0). Use ~10 to see ' +
            'past outcomes and judge how often this symbol\'s lows landed inside the window.'
        ),
      depth: z
        .boolean()
        .optional()
        .describe(
          'Add each window\'s derived price zone (`depth`, DWLF-416): the typical move into this side\'s pivots, ' +
            'and as prices from the current cycle\'s anchor. Historical context, not a target.'
        ),
      generation: z
        .number()
        .int()
        .min(1)
        .max(99)
        .optional()
        .describe(
          'Detector generation to read. Omit — the API defaults to the one it stands behind ' +
            '(`generationSource` says which was used).'
        ),
    },
    async ({ symbol, timeframe, side, history, depth, generation }) => {
      try {
        const params: Record<string, string> = {
          symbol: normalizeSymbol(symbol),
          timeframe: timeframe ?? '1w',
        };
        if (side) params.side = side;
        if (history !== undefined) params.history = String(history);
        if (generation !== undefined) params.generation = String(generation);
        if (depth) params.depth = '1';
        const data = await client.get('/cycles/windows', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error fetching cycle windows for ${symbol}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}
