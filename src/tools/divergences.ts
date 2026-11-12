import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * The divergence scan (DWLF-791, with DWLF-797 confluence, DWLF-798 timeframes and DWLF-818 the fib layer): one read of
 * `GET /v2/screener/divergences`, passed through as the API answers (charter invariant 2). The API composes every
 * item's `summary`, `chartUrl`, `why` and the `definitions`, so the wording an agent quotes is the same the DWLF pages
 * show. This tool only maps its arguments onto the query.
 */
export const CONFLUENCE_LAYERS = ['cycle', 'smc', 'tl', 'weekly', 'fib'] as const;
export const DEFAULT_LIMIT = 50;

export function registerDivergenceTools(server: McpServer, client: DWLFClient): void {
  server.tool(
    'dwlf_get_divergences',
    'Recent price/oscillator DIVERGENCES across every symbol DWLF tracks: dated events that happened, not signals. ' +
      'A divergence compares two consecutive confirmed cycle pivots: a `regular` one is price making a lower low (or a ' +
      'higher high) while RSI(14) or DSS does not; a `hidden` one is the reverse, a pullback inside the trend. ' +
      'Bullish = measured at lows, bearish = at highs.\n\n' +
      'FILTERS: `days` (1-365, default 30) windows the later pivot\'s date; `oscillator` (rsi | dss), `kind` (regular | ' +
      'hidden), `direction` (bullish | bearish), `symbols` (restrict to these), `limit` (1-500; this tool sends ' +
      `${DEFAULT_LIMIT} unless you set it), \`timeframe\` (daily, the default | weekly | all), \`includeRetired\` (also ` +
      'return divergences whose pivot the cycle ledger later superseded; by default they are left out and counted in ' +
      '`retiredOmitted`).\n' +
      'CONFLUENCE: `confluence` names the layers to check around each divergence: `cycle` (a confirmed daily cycle low ' +
      'or high near the pivot, and whether it sits in the weekly window), `smc` (Smart Money Concepts events), `tl` (a ' +
      'trendline break), `weekly` (a weekly divergence agrees), `fib` (a cycle fib level). `confluenceDays` (1-30 bars, ' +
      'default 10) is the window; `minLayers` keeps only items matching at least that many layers (filtered by the API). ' +
      'Each item then carries `confluence: { matched, layers, … }`: a layer not requested is null, requested and absent ' +
      'is `{ matched: false }`, and a matched layer lists its dated events and a one-line `why`. Passing `timeframe` or ' +
      '`confluence` returns `responseVersion: 2`, which always includes `definitions` (stable wording you can quote); ' +
      '`explain: true` adds them to the plain read.\n\n' +
      'READING IT: each item has `summary` (one plain sentence, the DWLF page\'s own wording: use it), both pivots\' ' +
      'dates, prices and oscillator readings, `knowableAt` (when it could first be known: never imply it was visible ' +
      'earlier) and `chartUrl`. When the user wants to see one, give them its `chartUrl`. `cyclePivot.ledgerState` ' +
      '`unknown` or `missing` means the pivot is unverified, not confirmed. A divergence is something that happened on ' +
      'the chart, not a recommendation: never present one, or a confluence of layers, as a reason to buy or sell. ' +
      '`truncated: true` means more matched than were returned. A key whose plan lacks the cycles family gets a teaser ' +
      '(`locked: true`, `newThisWeek`, `requiredPlan`, `pricingUrl`) and no items: tell your human what unlocks it.',
    {
      days: z.number().int().min(1).max(365).optional().describe('Window on the later pivot\'s date, in days (default 30).'),
      oscillator: z.enum(['rsi', 'dss']).optional().describe('RSI(14) or DSS.'),
      kind: z.enum(['regular', 'hidden']).optional().describe('`regular` (against the move) or `hidden` (a pullback inside the trend).'),
      direction: z.enum(['bullish', 'bearish']).optional().describe('Bullish = measured at lows; bearish = at highs.'),
      symbols: z.array(z.string()).optional().describe('Restrict to these symbols (any spelling, e.g. "BTC/USD", "aapl").'),
      limit: z.number().int().min(1).max(500).optional().describe(`How many items at most (default ${DEFAULT_LIMIT} here).`),
      timeframe: z.enum(['daily', 'weekly', 'all']).optional().describe('Daily pivots (default), weekly, or both.'),
      confluence: z.array(z.enum(CONFLUENCE_LAYERS)).optional().describe('Layers to check around each divergence.'),
      confluenceDays: z.number().int().min(1).max(30).optional().describe('The confluence window in bars (weekly: weeks); default 10.'),
      minLayers: z.number().int().min(0).max(CONFLUENCE_LAYERS.length).optional()
        .describe('Keep only items matching at least this many of the requested layers. Needs `confluence`.'),
      includeRetired: z.boolean().optional().describe('Also return divergences on pivots the cycle ledger later superseded.'),
      explain: z.boolean().optional().describe('Add `definitions` to a plain (version 1) read; version 2 always has them.'),
    },
    async (args) => {
      const layers = [...new Set(args.confluence ?? [])];
      if (args.minLayers !== undefined && args.minLayers > layers.length) {
        return { isError: true, content: [{ type: 'text', text: layers.length
          ? `minLayers (${args.minLayers}) is more than the ${layers.length} distinct layer(s) requested in \`confluence\`.`
          : 'minLayers needs `confluence`: name the layers to count.' }] };
      }
      const params: Record<string, string> = { limit: String(args.limit ?? DEFAULT_LIMIT) };
      if (args.days !== undefined) params.days = String(args.days);
      if (args.oscillator) params.oscillator = args.oscillator;
      if (args.kind) params.kind = args.kind;
      if (args.direction) params.direction = args.direction;
      if (args.symbols && args.symbols.length) params.symbols = args.symbols.map((s) => normalizeSymbol(s)).join(',');
      if (args.timeframe) params.timeframe = args.timeframe;
      if (layers.length) params.confluence = layers.join(',');
      if (args.confluenceDays !== undefined) params.confluenceDays = String(args.confluenceDays);
      if (args.minLayers !== undefined) params.minLayers = String(args.minLayers);
      if (args.includeRetired !== undefined) params.includeRetired = String(args.includeRetired);
      if (args.explain !== undefined) params.explain = String(args.explain);
      try {
        const data = await client.get('/screener/divergences', params);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error fetching divergences: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    }
  );
}
