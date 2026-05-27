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
        .describe(
          'Restrict to events fired in the last N days (e.g. `5` for the last 5 days). ' +
            '⚠️ DEFAULT IS 7 DAYS if omitted — anything older is silently hidden. ' +
            'For historical lookups (verifying old cycle pivots, debugging "where did that signal go") ' +
            'pass an explicit larger value like `days: 120` or use `fromDate`/`toDate` for a precise window. ' +
            'Hit this footgun multiple times across sessions; documenting loudly.'
        ),
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

        // Echo back the effective filter set so agents can see *what window
        // they actually got*. The 7-day default has bitten multiple sessions
        // ("where did that old fire go?") — surfacing it inline is cheaper
        // than tearing the default out and breaking existing callers.
        // `defaulted: true` flags fields where the backend supplied the
        // default; explicit caller values get `defaulted: false`.
        const noTimeWindow = days === undefined && !fromDate && !toDate;
        const filtersApplied: Record<string, unknown> = {};
        if (sym) filtersApplied.symbol = sym;
        if (symsCsv) filtersApplied.symbols = symsCsv.split(',');
        if (type) filtersApplied.type = type;
        if (timeframe) filtersApplied.timeframe = timeframe;
        if (days !== undefined) filtersApplied.days = days;
        if (fromDate) filtersApplied.fromDate = fromDate;
        if (toDate) filtersApplied.toDate = toDate;
        if (noTimeWindow) {
          filtersApplied.days = 7;
          filtersApplied.defaulted = { days: true };
          filtersApplied.hint = 'No fromDate/toDate/days supplied — the backend defaults to last 7 days. Older fires are silently hidden. Pass an explicit `days` or fromDate/toDate to widen.';
        }
        if (limit !== undefined) filtersApplied.limit = limit;
        if (uniquePerSymbol !== undefined) filtersApplied.uniquePerSymbol = uniquePerSymbol;
        if (customEventId) filtersApplied.customEventId = customEventId;
        if (eventName) filtersApplied.eventName = eventName;

        // Preserve the backend's existing top-level shape; just splice
        // filtersApplied alongside it. Keeps existing parsers working.
        //
        // `typeof [] === 'object'` in JS so a bare-array response (some
        // /events callers return one) would silently get spread into
        // `{ '0': item, '1': item, filtersApplied }` — numeric-keyed
        // object, no longer an array. Guard with Array.isArray first
        // and wrap arrays under `events:` so the data structure
        // survives. Per bugbot PR#39.
        const wrapped = Array.isArray(data)
          ? { events: data, filtersApplied }
          : (typeof data === 'object' && data !== null
            ? { ...data as Record<string, unknown>, filtersApplied }
            : { data, filtersApplied });

        return {
          content: [{ type: 'text', text: JSON.stringify(wrapped, null, 2) }],
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
          // NB: supportResistance.{support,resistance}.level events are intentionally
          // EXCLUDED here. They re-fire every cron run with the same level value, so
          // a 60-day window dumps ~120 duplicate rows that crowd out the actually
          // narrative-worthy events (cycle pivots, swing breaks, etc.) under the
          // limit cap. Use dwlf_get_support_resistance for current S&R levels.
          // Trendline breaks
          'trendline_break_bullish',
          'trendline_break_bearish',
          'trendline_breach_bullish',
          'trendline_breach_bearish',
        ]);

        const events: Array<Record<string, any>> = Array.isArray(data?.events) ? data.events : [];

        // Stage 1: project each event into a comparable row shape with a parsed
        // MA length so we can group cross events that share date + family +
        // direction in stage 2.
        type Row = {
          date: string | null;
          eventType: string;
          label: string;
          price: number | null;
          timeframe: any;
          // grouping metadata (not in final output)
          maGroupKey?: string;
          maLength?: number;
        };

        const projected: Row[] = events
          .filter((e) => PRICE_MEANINGFUL_TYPES.has(String(e.eventType ?? '')))
          .map((e) => {
            const eventType = String(e.eventType ?? '');
            const price = e.price ?? e.level ?? null;
            let label = eventType;
            let maGroupKey: string | undefined;
            let maLength: number | undefined;

            if (eventType.startsWith('cycle.')) {
              label = e.totalScore ? `${eventType} (score ${e.totalScore})` : eventType;
            } else if (eventType.startsWith('sma.cross') || eventType.startsWith('ema.cross')) {
              const lengthMatch = String(e.sortKey ?? '').match(/length=(\d+)/);
              maLength = lengthMatch ? Number(lengthMatch[1]) : NaN;
              label = lengthMatch ? `${eventType}(${lengthMatch[1]})` : eventType;
              // Group by date + family (sma/ema) + direction (above/below) so
              // same-day same-direction crosses on different MA lengths collapse
              // to a single row like `ema.cross.below(50,100)` instead of two
              // verbose rows. Cuts the same-day MA noise that was crowding out
              // older structural events under the limit cap.
              maGroupKey = `${e.date ?? ''}#${eventType}`;
            } else if (eventType.startsWith('swing_')) {
              label = e.swingType ? `${eventType} (${e.swingType})` : eventType;
            }
            return {
              date: e.date ?? null,
              eventType,
              label,
              price: price !== null && price !== undefined ? Number(price) : null,
              timeframe: e.timeframe ?? tf,
              maGroupKey,
              maLength,
            };
          });

        // Stage 2: collapse MA-cross groups. Within a (date, type) group, merge
        // the row to carry all MA lengths (`ema.cross.below(50,100)`). Keeps the
        // earliest-seen row's price; lengths sorted ascending for readability.
        const collapsed: Row[] = [];
        const maGroupIndex = new Map<string, number>();
        for (const row of projected) {
          if (!row.maGroupKey) {
            collapsed.push(row);
            continue;
          }
          const existingIdx = maGroupIndex.get(row.maGroupKey);
          if (existingIdx === undefined) {
            maGroupIndex.set(row.maGroupKey, collapsed.length);
            collapsed.push(row);
          } else {
            const existing = collapsed[existingIdx];
            const existingLengths = String(existing.label).match(/\(([\d,]+)\)/)?.[1].split(',').map(Number) ?? [];
            const allLengths = [...existingLengths, row.maLength].filter((n): n is number => Number.isFinite(n));
            const unique = Array.from(new Set(allLengths)).sort((a, b) => a - b);
            existing.label = `${row.eventType}(${unique.join(',')})`;
            // Keep the first price seen (events on same date should agree anyway).
          }
        }

        const narrative = collapsed
          .map(({ maGroupKey: _g, maLength: _m, ...row }) => row)
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
                      'Read top-to-bottom for recent-to-older. Cycle pivots (cycle.low.confirmed / cycle.high.confirmed) anchor the structural narrative. Higher/lower lows-and-highs describe trend shape. MA crosses tag trend regime changes (same-day same-direction crosses across multiple MA lengths are collapsed into one row, e.g. `ema.cross.below(50,100)`). Swing sweeps mark stop-runs / liquidity events. Trendline breaks mark structural inflection.',
                    limitations:
                      'This is a pivot-based summary — it cannot tell you intra-day movement, exact bar closes, or volume. For those you need raw OHLC via dwlf_get_market_data (JWT-only). Current support/resistance levels are also not included — call dwlf_get_support_resistance separately if you need them; including them here drowned out the structural events because the indicator re-emits the level every day.',
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
