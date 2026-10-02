import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

// The moving averages calculateSMAIndicators stores nightly (dwlf-scheduled-jobs).
export const MA_TYPES = [10, 20, 50, 100, 200].flatMap((p) => [`sma${p}`, `ema${p}`]);

type MaPoint = { date: string; value: number };

const isMaPoint = (p: unknown): p is MaPoint =>
  typeof p === 'object' && p !== null
  && typeof (p as MaPoint).date === 'string' && Number.isFinite((p as MaPoint).value);

// Adds `latest` (newest value per average) and `missing` alongside the backend's
// /chart-indicators?combine=true response, which passes through unchanged.
// Throws on a response without an `indicators` array, so an unexpected shape is
// an error rather than "no stored averages".
export function withLatestMovingAverages(data: unknown) {
  const rows = (data as { indicators?: unknown })?.indicators;
  if (!Array.isArray(rows)) {
    throw new Error('unexpected /chart-indicators response: no indicators array');
  }
  const latest: Record<string, MaPoint> = {};
  for (const row of rows) {
    const type = (row as { type?: unknown })?.type;
    const points = (row as { data?: unknown })?.data;
    if (typeof type !== 'string' || !Array.isArray(points)) {
      continue;
    }
    for (const p of points.filter(isMaPoint)) {
      if (!latest[type] || p.date > latest[type].date) {
        latest[type] = p;
      }
    }
  }
  return {
    ...(data as object),
    latest,
    missing: MA_TYPES.filter((t) => !latest[t]),
  };
}

export function registerIndicatorTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. Daily moving averages
  server.tool(
    'dwlf_get_indicators',
    'Get the stored DAILY moving averages for a symbol: SMA and EMA at 10, 20, 50, 100 and 200 periods ' +
      '(computed nightly from daily closes). `latest` holds the most recent value of each, with its date; ' +
      '`missing` lists any average with no stored value. ' +
      'The backend response (`indicators`: rows grouped by average, each with its daily `data` points) is returned as is, ' +
      'with `latest` and `missing` added. ' +
      'This is the only indicator data stored as values: there is no RSI, MACD or Bollinger value series, and ' +
      'there is no 4h/1h data. For momentum, band and cross signals use dwlf_get_events (e.g. `dss.cross.*`, ' +
      '`bollinger.break.*`, `ema.cross.*`), or dwlf_get_regime for the trend/momentum/volatility read.',
    {
      symbol: z
        .string()
        .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
      days: z
        .number()
        .int()
        .min(1)
        .max(250)
        .optional()
        .describe('Daily values to return per average (default 1 = latest only; max 250).'),
    },
    async ({ symbol, days }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const data = await client.get(`/chart-indicators/${sym}`, {
          types: MA_TYPES.join(','),
          limit: days ?? 1,
          combine: 'true',
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(withLatestMovingAverages(data), null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching moving averages for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 2. Get detected trendlines
  server.tool(
    'dwlf_get_trendlines',
    'Get the automatically detected trendlines for a symbol on one timeframe (daily by default; weekly; ' +
      'hourly only for symbols with 1h data). Each line carries its type (support/resistance), its two anchors ' +
      '(date + price), slope and whether it is still active. Breaks of these lines are the ' +
      '`trendline_break_*` / `trendline_breach_*` events in dwlf_get_events.',
    {
      symbol: z
        .string()
        .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
      timeframe: z
        .enum(['daily', 'weekly', 'hourly'])
        .optional()
        .describe('Which trendlines (default: daily). Hourly exists only for symbols with 1h data.'),
    },
    async ({ symbol, timeframe }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const tf = timeframe ?? 'daily';
        const data = tf === 'weekly'
          ? await client.get(`/trendlines/weekly/${sym}`)
          : await client.get(`/trendlines/${sym}`, { timeframe: tf });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching trendlines for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
