import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

// The moving averages calculateSMAIndicators stores nightly (dwlf-scheduled-jobs).
export const MA_TYPES = [10, 20, 50, 100, 200].flatMap((p) => [`sma${p}`, `ema${p}`]);

type MaPoint = { date: string; value: number };

// Shapes /chart-indicators?combine=true into `latest` per average plus an
// optional newest-first series, dropping storage fields agents don't need.
export function summariseMovingAverages(data: any, days: number) {
  const rows: any[] = Array.isArray(data?.indicators) ? data.indicators : [];
  const byType = new Map<string, MaPoint[]>();
  for (const row of rows) {
    const points: MaPoint[] = (Array.isArray(row?.data) ? row.data : [])
      .filter((p: any) => p && typeof p.date === 'string' && Number.isFinite(p.value));
    byType.set(row.type, [...(byType.get(row.type) ?? []), ...points]);
  }
  const latest: Record<string, MaPoint> = {};
  const series: Record<string, MaPoint[]> = {};
  for (const type of MA_TYPES) {
    const points = (byType.get(type) ?? []).sort((a, b) => b.date.localeCompare(a.date)).slice(0, days);
    if (points.length === 0) {
      continue;
    }
    latest[type] = points[0];
    if (days > 1) {
      series[type] = points;
    }
  }
  return {
    symbol: data?.symbol,
    timeframe: '1d',
    latest,
    ...(days > 1 ? { series } : {}),
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
      '(computed nightly from daily closes). Returns `latest` (the most recent value of each, with its date) and, ' +
      'when `days` > 1, a `series` of recent values per average, newest first. ' +
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
        .describe('Daily values to return per average, newest first (default 1 = latest only; max 250).'),
    },
    async ({ symbol, days }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const perType = days ?? 1;
        const data: any = await client.get(`/chart-indicators/${sym}`, {
          types: MA_TYPES.join(','),
          limit: perType,
          combine: 'true',
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(summariseMovingAverages(data, perType), null, 2) }],
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
