import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * The stored cycle WINDOW for one symbol — when its next cycle pivot is due.
 * Backed by GET /v2/cycles/windows (DWLF-272). Pass-through: the backend
 * projects the window store and computes nothing, and so does this tool.
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
      '`price`); dated edges in order `earliest` (weekly only — daily windows have none) → `opens` (early ' +
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
      '(daily since 24-Sep-2026, folded from the ledger\'s daily lows/highs); `timeframe: "1h"` answers with ' +
      'null sides rather than a computed substitute. On daily, `bars` are trading candles, and an extrapolated ' +
      'edge\'s date is an estimate from average bar spacing (it can fall on a non-trading day until real bars exist).',
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
    async ({ symbol, timeframe, side, history, generation }) => {
      try {
        const params: Record<string, string> = {
          symbol: normalizeSymbol(symbol),
          timeframe: timeframe ?? '1w',
        };
        if (side) params.side = side;
        if (history !== undefined) params.history = String(history);
        if (generation !== undefined) params.generation = String(generation);
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
