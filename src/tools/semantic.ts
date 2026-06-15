import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';
import { normalizeSymbol } from '../client.js';

export function registerSemanticTools(server: McpServer, client: DWLFClient) {
  // 1. Get market regime classification
  server.tool(
    'dwlf_get_regime',
    'Get current market regime classification for a symbol — trend, cycle, momentum, volatility, and confidence score. Optionally retrieve full regime history.',
    {
      symbol: z.string().describe('Symbol to query (e.g. BTC, ETH, AAPL)'),
      history: z
        .boolean()
        .optional()
        .describe('If true, return full regime history instead of just current'),
    },
    async ({ symbol, history }) => {
      try {
        const normalized = normalizeSymbol(symbol);
        const params = history ? { history: true } : {};
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
    'Get the full semantic snapshot for a symbol — current price, active events, FSM state, market regime, support/resistance levels, and signal quality. This is the preferred single-call way to get structured market context for a symbol.',
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
      'trend+cycle, cycleAlignment composite, active-signal count, openTrade, and `flags`) plus the ' +
      'full cross-asset block (sectorSentiment + triggerThemes + alignmentThemes) and a `drilldown` ' +
      'block. The overview is sized to stay within a single response across a large watchlist + ' +
      'briefing list — START HERE for the universe-wide read, then drill into symbols that matter. ' +
      'Three tiers: view:"overview" (default, one-glance) → view:"summary" (compact per-symbol: ' +
      'nearest S/R, trendline state, truncated events, SMC digest) → view:"full" (every field — ' +
      'pivots, trendline touch-points, fibLevels, annotations). summary/full across the whole ' +
      'watchlist can exceed response limits, so SCOPE them with `symbols`. `drilldown.flaggedSymbols` ' +
      'and per-symbol `flags` mark notable structure — drill those proactively (view:"summary"/' +
      '"full" scoped, or dwlf_get_price_picture / dwlf_get_trendlines / dwlf_get_support_resistance ' +
      '/ dwlf_get_events). Use `symbols` to extend coverage beyond your watchlist + briefing list.',
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
    },
    async ({ symbols, view }) => {
      try {
        const params: Record<string, unknown> = {};
        if (symbols && symbols.length > 0) {
          params.symbols = symbols.map((s) => normalizeSymbol(s)).join(',');
        }
        // Default to the one-glance overview so a large watchlist + briefing
        // list never blows the response size; callers opt into the heavier
        // summary/full views explicitly (and should scope them with `symbols`).
        params.view = view === 'full' || view === 'summary' ? view : 'overview';
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
    'Programmatically register a new DWLF account — no browser or Google OAuth required. Returns an API key immediately. Email verification unlocks compute features (backtests, evaluations). Useful for onboarding flows where an agent registers itself.',
    {
      email: z.string().email().describe('Email address for the new account'),
      agentId: z
        .string()
        .optional()
        .describe('Optional agent identifier to associate with this account'),
      purpose: z
        .string()
        .optional()
        .describe('Optional description of what this account will be used for'),
    },
    async ({ email, agentId, purpose }) => {
      try {
        const body: Record<string, string> = { email };
        if (agentId) body.agentId = agentId;
        if (purpose) body.purpose = purpose;
        const data = await client.post('/agent/register', body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error registering agent: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
