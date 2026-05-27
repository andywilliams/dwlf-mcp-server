import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerMarketDataTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. Get OHLCV candle data
  server.tool(
    'dwlf_get_market_data',
    'Get OHLCV candle data for a trading symbol. Returns open, high, low, close, volume over time. ' +
      '⚠️ Returns 403 for external API-key callers — raw candles are JWT-only (Twelve Data licensing). ' +
      'If you hit a 403, use `dwlf_get_price_picture(symbol, days)` for a pivot-based price narrative, ' +
      'or `dwlf_get_events(symbol, timeframe="1d", days=N)` filtered to cycle pivots / swing points / MA crosses / S&R levels — ' +
      'each event carries the price at its date and together they reconstruct price action without raw bars. ' +
      'Reach for this tool only when you genuinely need bar-by-bar resolution (e.g. "did price touch $X intra-day on date D").',
    {
      symbol: z
        .string()
        .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
      interval: z
        .enum(['1d', '4h', '1h'])
        .optional()
        .describe('Candle interval (default: 1d)'),
      limit: z
        .number()
        .optional()
        .describe('Number of candles to return (default: 50)'),
    },
    async ({ symbol, interval, limit }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const data = await client.get(`/market-data/${sym}`, {
          interval,
          limit,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching market data for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 2. List all symbols
  server.tool(
    'dwlf_list_symbols',
    'List all available trading symbols with metadata. Use this to discover what symbols are available on DWLF.',
    {},
    async () => {
      try {
        const data = await client.get('/market-data/symbols');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching symbols: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 3. Get support/resistance levels
  server.tool(
    'dwlf_get_support_resistance',
    'Get support and resistance levels for a trading symbol. These are key price levels where buying/selling pressure is expected.',
    {
      symbol: z
        .string()
        .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
    },
    async ({ symbol }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const data = await client.get(`/support-resistance/${sym}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching support/resistance for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 4. Get indicator events
  server.tool(
    'dwlf_get_events',
    'Get indicator events (cycle lows/highs, crossovers, breakouts, divergences, etc.). ' +
      'Filter by a single `symbol` or a `symbols` watchlist, by `type` (e.g. `cycle.low.confirmed`), ' +
      'by `timeframe` (1d / 4h / 1h — without this the response is dominated by hourly noise), ' +
      'and by time window via `days` or explicit `fromDate` / `toDate`. ' +
      '💡 For accounts without raw OHLC access (most API-key callers), this is the canonical way to reconstruct price action: ' +
      'cycle pivots, swing points, MA/EMA crosses, S&R level fires and trendline breaks each carry the price at the event date. ' +
      'For a single-call summary across all those types, use `dwlf_get_price_picture` instead.',
    {
      symbol: z
        .string()
        .optional()
        .describe('Filter by a single trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers'),
      symbols: z
        .array(z.string())
        .optional()
        .describe(
          'Filter by multiple symbols at once. Each accepts the same shapes as `symbol`. ' +
            'Use this for watchlist queries (e.g. "what cycle lows fired across my watchlist today").'
        ),
      type: z
        .string()
        .optional()
        .describe(
          'Filter by event type (e.g. `cycle.low.confirmed`, `cycle.high.confirmed`, ' +
            '`bullish_reversal`, `dss_breakout`).'
        ),
      timeframe: z
        .enum(['1w', '1d', '4h', '1h'])
        .optional()
        .describe(
          'Filter by candle timeframe. Strongly recommended — without it the API returns ' +
            'mostly hourly events and daily-bar fires get truncated past the limit. ' +
            'Use `1w` to query weekly cycle events (e.g. for multi-timeframe DCL analysis).'
        ),
      days: z
        .number()
        .optional()
        .describe('Restrict to events fired in the last N days (e.g. `5` for the last 5 days).'),
      fromDate: z
        .string()
        .optional()
        .describe('Inclusive lower bound on event date, ISO `YYYY-MM-DD`. Mutually useful with `toDate`.'),
      toDate: z
        .string()
        .optional()
        .describe('Inclusive upper bound on event date, ISO `YYYY-MM-DD`.'),
      uniquePerSymbol: z
        .boolean()
        .optional()
        .describe('If true, return only the most recent event per symbol (useful for "latest fire" snapshots).'),
      limit: z
        .number()
        .optional()
        .describe('Number of events to return (default: 20).'),
      customEventId: z
        .string()
        .optional()
        .describe(
          'Filter to fires of a specific custom event by its event definition ID. ' +
            'Only honoured when `type` is `custom_event`. Combine with `symbol` / `symbols` ' +
            'to scope to a single asset, or omit to see fires across the watchlist.'
        ),
      eventName: z
        .string()
        .optional()
        .describe(
          'Filter custom event fires by their human-readable name (e.g. `bullish_reversal_1`). ' +
            'Only honoured when `type` is `custom_event`. Useful when you know the name but not the ID.'
        ),
    },
    async ({ symbol, symbols, type, timeframe, days, fromDate, toDate, uniquePerSymbol, limit, customEventId, eventName }) => {
      try {
        const sym = symbol ? normalizeSymbol(symbol) : undefined;
        const symsCsv =
          symbols && symbols.length > 0
            ? symbols.map((s) => normalizeSymbol(s)).join(',')
            : undefined;

        const data = await client.get('/events', {
          symbol: sym,
          symbols: symsCsv,
          type,
          timeframe,
          days,
          fromDate,
          toDate,
          // Backend reads `uniquePerSymbol === 'true'`, so serialise to string.
          uniquePerSymbol: uniquePerSymbol === undefined ? undefined : String(uniquePerSymbol),
          limit,
          customEventId,
          eventName,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching events: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 5. Get a chronological price picture from indicator events.
  //
  // Designed as the agent-friendly alternative to raw candle data for callers who
  // can't access `/market-data` (API-key auth is denied raw OHLC). Aggregates the
  // price-meaningful event types — cycle pivots, swing points, MA/EMA crosses,
  // S&R level fires, trendline breaks, bollinger breaks — into a single
  // chronological narrative with date + price + label per row.
  //
  // Rationale: most agent questions ("is BTC trending up?", "where are recent
  // supports?", "did the strategy's entry conditions exist?") are answered better
  // by structural pivots than by raw bars. A 6-line pivot summary is more useful
  // than 60 raw daily candles for narrative context, and we already have the data.
  server.tool(
    'dwlf_get_price_picture',
    'Aggregate the price-meaningful indicator events for a symbol into a chronological narrative — ' +
      'cycle pivots, swing points, MA/EMA crosses, S&R level fires, trendline breaks, bollinger breaks. ' +
      'Each row carries date + price (or level) + a human-readable label. ' +
      'Use this when you need structural price context for a symbol but do not have raw OHLC access, ' +
      'or when you want a clean one-call summary instead of stitching together multiple `dwlf_get_events` queries. ' +
      'Returns events sorted newest-first.',
    {
      symbol: z
        .string()
        .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
      days: z
        .number()
        .optional()
        .describe('How many days back to include (default: 90). Smaller = tighter narrative; larger = longer-term structural view.'),
      timeframe: z
        .enum(['1w', '1d', '4h', '1h'])
        .optional()
        .describe('Timeframe of events to include (default: 1d). Use 1w for weekly structural pivots only.'),
      limit: z
        .number()
        .optional()
        .describe('Max events to return (default: 50). Most useful narratives fit in 20-40 rows.'),
    },
    async ({ symbol, days, timeframe, limit }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const tf = timeframe ?? '1d';
        const lookback = days ?? 90;
        const cap = limit ?? 50;

        // Single events fetch — we filter to the price-meaningful types client-side
        // so we don't need N round-trips. Use a generous backend limit so we don't
        // lose newer events behind noise from intermediate dates.
        const data: any = await client.get('/events', {
          symbol: sym,
          timeframe: tf,
          days: lookback,
          limit: 500,
        });

        const PRICE_MEANINGFUL_TYPES = new Set([
          // Cycle pivots — the most structurally meaningful events
          'cycle.low.confirmed',
          'cycle.high.confirmed',
          'cycle.low.higher_low',
          'cycle.low.lower_low',
          'cycle.high.higher_high',
          'cycle.high.lower_high',
          // Swing structure
          'higher_low',
          'lower_low',
          'higher_high',
          'lower_high',
          // Swing breaks/sweeps — for stop-runs and structural shifts
          'swing_low_break',
          'swing_low_sweep',
          'swing_high_break',
          'swing_high_sweep',
          // MA / EMA crosses — price-tagged trend changes
          'sma.cross.above',
          'sma.cross.below',
          'ema.cross.above',
          'ema.cross.below',
          // Bollinger band breaks
          'bollinger.break.aboveUpper',
          'bollinger.break.belowLower',
          // Support / resistance levels (carry `level` not `price`)
          'supportResistance.support.level',
          'supportResistance.resistance.level',
          // Trendline breaks
          'trendline_break_bullish',
          'trendline_break_bearish',
          'trendline_breach_bullish',
          'trendline_breach_bearish',
        ]);

        const events: Array<Record<string, any>> = Array.isArray(data?.events) ? data.events : [];

        const narrative = events
          .filter((e) => PRICE_MEANINGFUL_TYPES.has(String(e.eventType ?? '')))
          .map((e) => {
            const eventType = String(e.eventType ?? '');
            const price = e.price ?? e.level ?? null;
            // Pick a useful label per category — keeps the row scannable.
            let label = eventType;
            if (eventType.startsWith('cycle.')) {
              // Handles cycle.low.* AND cycle.high.* symmetrically (both lows and
              // highs carry the same totalScore field). Earlier version checked
              // `cycle.low` only and silently dropped the score annotation on
              // cycle highs — flagged by bugbot in the PR review.
              label = e.totalScore ? `${eventType} (score ${e.totalScore})` : eventType;
            } else if (eventType.startsWith('sma.cross') || eventType.startsWith('ema.cross')) {
              // sortKey usually contains the length, e.g. "2026-05-22#sma.cross.below#length=50"
              const lengthMatch = String(e.sortKey ?? '').match(/length=(\d+)/);
              label = lengthMatch ? `${eventType}(${lengthMatch[1]})` : eventType;
            } else if (eventType.startsWith('supportResistance')) {
              // Be precise with the dotted segments — both event types share the
              // "supportResistance" prefix which itself contains the substring
              // "support", so a naive `.includes('support')` is true for BOTH
              // and silently mislabels resistance events as support. Flagged by
              // bugbot in PR#33.
              label = eventType.includes('.support.') ? 'support level' : 'resistance level';
            } else if (eventType.startsWith('swing_')) {
              label = e.swingType ? `${eventType} (${e.swingType})` : eventType;
            }
            return {
              date: e.date ?? null,
              eventType,
              label,
              price: price !== null && price !== undefined ? Number(price) : null,
              timeframe: e.timeframe ?? tf,
            };
          })
          .sort((a, b) => {
            // newest first; fall back to string compare if either date missing.
            const dateA = String(a.date ?? '');
            const dateB = String(b.date ?? '');
            return dateA > dateB ? -1 : dateA < dateB ? 1 : 0;
          })
          .slice(0, cap);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  symbol: sym,
                  timeframe: tf,
                  days: lookback,
                  count: narrative.length,
                  narrative,
                  agentHints: {
                    interpretation:
                      'Read top-to-bottom for recent-to-older. Cycle pivots (cycle.low.confirmed / cycle.high.confirmed) anchor the structural narrative. Higher/lower lows-and-highs describe trend shape. MA crosses tag trend regime changes. S&R levels are static price magnets. Swing sweeps mark stop-runs / liquidity events. Trendline breaks mark structural inflection.',
                    limitations:
                      'This is a pivot-based summary — it cannot tell you intra-day movement, exact bar closes, or volume. For those you need raw OHLC via dwlf_get_market_data (JWT-only).',
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching price picture for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
