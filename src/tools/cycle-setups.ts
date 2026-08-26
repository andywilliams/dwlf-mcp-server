import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * Cycle Setup Screener stage transitions (`cycle.setup.*`).
 *
 * The scheduled `cycleSetupTransitions` job classifies the universe daily at
 * 04:12 UTC and writes ONE event row per stage change. Writing the row IS
 * publishing the API — the raw transitions are already reachable via
 * `dwlf_get_events`. What that does not give you is a single call: the events
 * endpoint filters ONE `type` per request, so a caller wanting the whole
 * picture burns five round-trips and then has to group them by hand. The
 * morning brief does exactly that, every day.
 *
 * This tool is the thin wrapper: five parallel fetches, merged, pre-grouped
 * into entered / downgraded / left, newest first.
 */

/** Stage-entry events, ranked best → worst (mirrors STAGE_RANK in the job). */
const ENTERED_TYPES = [
  'cycle.setup.confirmed',      // confirmed_setup — weekly window open x fresh daily cycle low
  'cycle.setup.forming',        // awaiting_confirmation — daily pivot still provisional
  'cycle.setup.window_open',    // window_open — weekly window open, no daily pivot yet
] as const;

const DOWNGRADED_TYPE = 'cycle.setup.downgraded';   // stage FELL, window still open
const LEFT_TYPE = 'cycle.setup.window_closed';      // row gone — the weekly window shut

const ALL_TYPES = [...ENTERED_TYPES, DOWNGRADED_TYPE, LEFT_TYPE];

type EventRow = Record<string, unknown>;

const asArray = (data: unknown): EventRow[] => {
  if (Array.isArray(data)) return data as EventRow[];
  if (data && typeof data === 'object') {
    const events = (data as Record<string, unknown>).events;
    if (Array.isArray(events)) return events as EventRow[];
  }
  return [];
};

/** Compact a raw row to the fields a triage decision actually needs. */
const project = (e: EventRow) => ({
  symbol: e.symbol,
  eventType: e.eventType,
  date: e.date ?? e.eventTimestamp,
  side: e.side,
  fromStage: e.fromStage,
  toStage: e.toStage,
  // The screener row at transition time — enough to triage without re-querying.
  window: e.window,
  windowQuantile: e.windowQuantile,
  weeklyDaysSincePivot: e.weeklyDaysSincePivot,
  weeklyMedianCycleDays: e.weeklyMedianCycleDays,
  weeklyStatus: e.weeklyStatus,
  dailyStatus: e.dailyStatus,
  confidencePct: e.confidencePct,
  pivotPrice: e.pivotPrice,
  pivotTime: e.pivotTime,
  daysSinceConfirm: e.daysSinceConfirm,
  ...(e.seeded ? { seeded: true } : {}),
});

const newestFirst = (a: ReturnType<typeof project>, b: ReturnType<typeof project>) =>
  String(b.date ?? '').localeCompare(String(a.date ?? ''));

export function registerCycleSetupTools(server: McpServer, client: DWLFClient) {
  server.tool(
    'dwlf_get_setup_transitions',
    'Cycle Setup Screener stage transitions in ONE call — the five `cycle.setup.*` event types ' +
      'merged and pre-grouped into `entered` / `downgraded` / `left`, newest first. ' +
      'Use this instead of five separate `dwlf_get_events` calls (that endpoint filters one `type` per request). ' +
      '💡 This is the delta feed: what CHANGED stage, not what currently sits in the screener — ' +
      'for the current standing list use `dwlf_get_cycle_setups`. ' +
      '⚠️ SEEDED ROWS ARE EXCLUDED BY DEFAULT. The first live run of the transitions job seeds the ' +
      'entire current state as `seeded: true` rows (≈34 of them on 27-Aug-2026); they are bookkeeping, ' +
      'not news, and SPT’s dispatcher does not deliver them either. Counting them as transitions would ' +
      'report a flood of false “new setups”. `suppressedSeeded` tells you how many were hidden. ' +
      'Pass `includeSeeded: true` only when auditing the seed itself. ' +
      '📅 Transitions are written by the 04:12 UTC job, so the freshest data appears after that.',
    {
      days: z
        .number()
        .optional()
        .describe(
          'Look-back window in days. Defaults to 7. The transitions job runs once daily, so `days: 1` ' +
            'may return nothing if today’s 04:12 run has not happened yet — prefer 2+ for "what changed recently".'
        ),
      symbol: z
        .string()
        .optional()
        .describe('Restrict to one symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers.'),
      side: z
        .enum(['long', 'short'])
        .optional()
        .describe('Restrict to one side. Omit for both.'),
      includeSeeded: z
        .boolean()
        .optional()
        .describe(
          'Include first-run seed rows (`seeded: true`). Defaults to FALSE — they are current-state ' +
            'bookkeeping, not stage changes. Set true only to audit what the seed wrote.'
        ),
    },
    async ({ days, symbol, side, includeSeeded }) => {
      try {
        const sym = symbol ? normalizeSymbol(symbol) : undefined;
        const effectiveDays = days ?? 7;

        // One request per type — the events endpoint filters a single `type`
        // per call. Run them concurrently; this is the whole point of the tool.
        const results = await Promise.all(
          ALL_TYPES.map(async (type) => {
            const data = await client.get('/events', {
              type,
              symbol: sym,
              days: effectiveDays,
              limit: 500,
            });
            return { type, rows: asArray(data) };
          })
        );

        const buckets: Record<string, ReturnType<typeof project>[]> = {
          entered: [],
          downgraded: [],
          left: [],
        };
        let suppressedSeeded = 0;
        let total = 0;

        for (const { type, rows } of results) {
          for (const raw of rows) {
            if (side && raw.side !== side) continue;
            if (!includeSeeded && raw.seeded) {
              suppressedSeeded += 1;
              continue;
            }
            total += 1;
            const bucket =
              type === DOWNGRADED_TYPE ? 'downgraded' : type === LEFT_TYPE ? 'left' : 'entered';
            buckets[bucket].push(project(raw));
          }
        }
        for (const key of Object.keys(buckets)) buckets[key].sort(newestFirst);

        const byEventType: Record<string, number> = {};
        for (const { type, rows } of results) {
          byEventType[type] = rows.filter(
            (r) => (includeSeeded || !r.seeded) && (!side || r.side === side)
          ).length;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  transitions: buckets,
                  counts: { total, byEventType },
                  suppressedSeeded,
                  ...(suppressedSeeded > 0
                    ? {
                        seededHint:
                          `${suppressedSeeded} seed row(s) hidden — first-run current-state bookkeeping, ` +
                          'not stage changes. Pass includeSeeded: true to audit them.',
                      }
                    : {}),
                  filtersApplied: {
                    days: effectiveDays,
                    ...(days === undefined ? { defaulted: { days: true } } : {}),
                    ...(sym ? { symbol: sym } : {}),
                    ...(side ? { side } : {}),
                    includeSeeded: Boolean(includeSeeded),
                    types: ALL_TYPES,
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
              text: `Error fetching setup transitions: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );
}
