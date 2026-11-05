import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';
import { normalizeSymbol } from '../client.js';
import { registrationBody, describeRegistration, disclaimerFromError } from './registration.js';

export function registerSemanticTools(
  server: McpServer,
  client: DWLFClient,
  options: { defaultProduct?: 'block' | 'dwlf' } = {},
) {
  // 1. Get market regime classification
  server.tool(
    'dwlf_get_regime',
    'Get the market regime classification for a symbol on one timeframe (daily by default) — trend, ' +
      'momentum, volatility and a confidence score, plus `insufficientHistory` (true when the symbol has too ' +
      'little history on that timeframe: the fields are then placeholders, not a reading). With `history`, returns a dated regime series, newest ' +
      'first. It carries no cycle phase: for where an asset is in its market cycle, use dwlf_get_stage (weekly ' +
      'Weinstein stage).',
    {
      symbol: z.string().describe('Symbol to query (e.g. BTC, ETH, AAPL)'),
      timeframe: z
        .enum(['daily', 'weekly', 'hourly'])
        .optional()
        .describe('Candle timeframe to classify (default: daily). Hourly only for symbols with 1h data.'),
      history: z
        .boolean()
        .optional()
        .describe('If true, return the dated regime series (newest first) instead of just the current regime'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('History entries to return when `history` is true (default 90).'),
    },
    async ({ symbol, timeframe, history, limit }) => {
      try {
        const normalized = normalizeSymbol(symbol);
        const params: Record<string, string | number | boolean> = {};
        if (timeframe) params.timeframe = timeframe;
        if (history) params.history = true;
        if (history && limit) params.limit = limit;
        const data = await client.get(`/regime/${normalized}`, params);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching regime for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 2. Get full semantic snapshot (intelligence)
  server.tool(
    'dwlf_get_intelligence',
    'Get the full semantic snapshot for a symbol — current price, active events, FSM state, market regime, the weekly Weinstein `stage` object (`stage`, `stageName`, `weeksInStage`, `since`, `verification`; context, not a signal — see dwlf_get_stage), support/resistance levels, and signal quality. This is the preferred single-call way to get structured market context for a symbol. For BITCOIN\'s on-chain cost basis, cycle windows and positioning in one call, use dwlf_get_conditions first.',
    {
      symbol: z.string().describe('Symbol to query (e.g. BTC, ETH, AAPL)'),
    },
    async ({ symbol }) => {
      try {
        const normalized = normalizeSymbol(symbol);
        const data = await client.get(`/intelligence/${normalized}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching intelligence for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 3. Get daily cross-asset briefing
  server.tool(
    'dwlf_get_daily_briefing',
    'Get the cross-asset daily briefing (covers the watchlist UNION the briefing list). Returns a ' +
      'TOP-LEVEL OVERVIEW by default: one headline line per symbol (price/%chg/ribbon, regime ' +
      'trend + `cycle`, the weekly cycle FSM\'s setup state (bottoming/rising/topping/declining; not the ' +
      'cycle read — that is `stage`), weekly Weinstein `stage` number + `stageWeeks` (weeks in stage; context, not a signal), cycleAlignment composite, active-signal count, openTrade, and `flags`) plus the ' +
      'full cross-asset block (sectorSentiment + triggerThemes + alignmentThemes) and a `drilldown` ' +
      'block. The overview is sized to stay within a single response across a large watchlist + ' +
      'briefing list — START HERE for the universe-wide read, then drill into symbols that matter. ' +
      'Three tiers: view:"overview" (default, one-glance) → view:"summary" (compact per-symbol: ' +
      'nearest S/R, trendline state, truncated events, SMC digest) → view:"full" (every field — ' +
      'pivots, trendline touch-points, fibLevels, annotations). summary/full across the whole ' +
      'watchlist can exceed response limits, so SCOPE them with `symbols`. `drilldown.flaggedSymbols` ' +
      'and per-symbol `flags` mark notable structure — drill those proactively (view:"summary"/' +
      '"full" scoped, or dwlf_get_price_picture / dwlf_get_trendlines / dwlf_get_support_resistance ' +
      '/ dwlf_get_events). Use `symbols` to extend coverage beyond your watchlist + briefing list. ' +
      'Pass depth:true for crossAsset.depth: each symbol\'s weekly cycle window depth band ' +
      '(where the last close sits in the move past cycles made; lead with in-zone).',
    {
      symbols: z
        .array(z.string())
        .optional()
        .describe(
          'Optional additional symbols to include alongside your watchlist + briefing list for this ' +
            'call only. Useful when Telegram alerts fire for symbols outside your curated lists and you ' +
            'want the structural read on them. Each accepts BTC / BTC/USD / BTC-USD / stock-ticker ' +
            'shapes. Does NOT modify your stored lists.'
        ),
      view: z
        .enum(['overview', 'summary', 'full'])
        .optional()
        .describe(
          "'overview' (default) = one headline line per symbol + full crossAsset; fits one response " +
            "across a large watchlist. 'summary' = compact per-symbol detail (heavier; scope with " +
            "`symbols`). 'full' = every per-symbol field (heaviest — scope with `symbols`). Drill into " +
            'flagged symbols with summary/full or the per-symbol tools.'
        ),
      depth: z
        .boolean()
        .optional()
        .describe(
          'true adds crossAsset.depth = {readings, read, failed, failedSymbols, symbolLimit, omitted, ' +
            "omittedSymbols}: each symbol's current weekly low and high window depth reading, for the " +
            'watchlist + briefing list (+ symbols). read/failed count windows (symbol x side); ' +
            'failedSymbols lists the symbols with a failed window. Only the first symbolLimit symbols ' +
            'are read; omitted counts the rest and omittedSymbols lists them. Read a failed or omitted ' +
            'symbol with dwlf_get_cycle_windows depth:true, one symbol per call. In ' +
            'overview/summary each reading is compact {symbol, side, position, movePct, price, anchor, ' +
            'typical: {p25, p75}, n, ...} with not-reached left out; view:"full" carries the whole band ' +
            'as dwlf_get_cycle_windows depth:true does. position: shallow / in-zone (25th-75th ' +
            'percentile of past cycles) / deep / beyond. ' +
            'Costs 10 compute units. Historical context, not a target.'
        ),
    },
    async ({ symbols, view, depth }) => {
      try {
        const params: Record<string, unknown> = {};
        if (symbols && symbols.length > 0) {
          params.symbols = symbols.map((s) => normalizeSymbol(s)).join(',');
        }
        // Default to the one-glance overview so a large watchlist + briefing
        // list never blows the response size; callers opt into the heavier
        // summary/full views explicitly (and should scope them with `symbols`).
        params.view = view === 'full' || view === 'summary' ? view : 'overview';
        if (depth) {
          params.depth = '1';
        }
        const data = await client.get('/briefing/daily', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching daily briefing: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 4. Register agent account (public endpoint, no auth needed)
  server.tool(
    'dwlf_register_agent',
    'Sign your user up for a DWLF account by email (no browser needed), and get its API key. Two steps, because the ' +
      'user must accept the DWLF disclaimer themselves:\n' +
      '  1. Call with `email` only. You get the disclaimer text and its version back: show the text to your user.\n' +
      '  2. Only if they accept, call again with `disclaimerAccepted: true` and that `disclaimerVersion`. Never accept ' +
      'on their behalf.\n' +
      'The result has `apiKey` (shown once: tell the user to keep it) and `activationStatus: pending_activation`. The key ' +
      'refuses every call (403 ACCOUNT_NOT_ACTIVATED) until the user clicks the activation link DWLF emails them. Then ' +
      'it goes in this server\'s DWLF_API_KEY setting. `product: "block"` makes a free DWLF Block account (the default ' +
      'under the Block profile). To re-send the activation email, call again with the same email, disclaimerAccepted ' +
      'and disclaimerVersion (the disclaimer is checked first); it never makes a second key.',
    {
      email: z.string().email().describe('Your user\'s email address (the activation link is sent there).'),
      disclaimerAccepted: z
        .boolean()
        .optional()
        .describe('true ONLY after your user has read the disclaimer text (from step 1) and said they accept it.'),
      disclaimerVersion: z
        .string()
        .optional()
        .describe('The disclaimer version from step 1. Required with disclaimerAccepted.'),
      product: z
        .enum(['block', 'dwlf'])
        .optional()
        .describe('`block`: a DWLF Block account. `dwlf`: a classic DWLF account. Default: this server\'s profile.'),
      agentId: z.string().optional().describe('Your agent or client name, e.g. claude-desktop.'),
      purpose: z.string().optional().describe('What the account is for, in a few words.'),
    },
    async ({ email, disclaimerAccepted, disclaimerVersion, product, agentId, purpose }) => {
      const body = registrationBody({ email, disclaimerAccepted, disclaimerVersion, product, agentId, purpose }, options.defaultProduct);
      try {
        const data = await client.post('/agent/register', body);
        return { content: [{ type: 'text', text: describeRegistration(data) }] };
      } catch (error) {
        const disclaimer = disclaimerFromError(error);
        if (disclaimer) {
          return { content: [{ type: 'text', text: disclaimer }] };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Error registering: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
