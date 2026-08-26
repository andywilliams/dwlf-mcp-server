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
 *
 * ⚠️ CHARTER NOTE (invariant 2 — "responses are passed through, not
 * re-enveloped"). Row-level, this complies: `project()` spreads the backend
 * row and adds derived fields alongside, so a field the transitions job adds
 * later reaches agents without an edit here.
 *
 * Top-level it necessarily does NOT: this call merges FIVE backend responses,
 * so there is no single envelope to preserve — grouping them is the entire
 * reason the tool exists. Recorded as a deliberate exception rather than
 * drift. If a future backend endpoint returns all five types in one response,
 * this wrapper should be deleted in favour of passing that through.
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

/** Verified 26-Aug-2026 against live `/events`: `{ events, cursor, countTruncated }`. */
const asArray = (data: unknown): EventRow[] => {
  if (Array.isArray(data)) return data as EventRow[];
  if (data && typeof data === 'object') {
    const events = (data as Record<string, unknown>).events;
    if (Array.isArray(events)) return events as EventRow[];
  }
  return [];
};

const cursorOf = (data: unknown): string | null => {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const c = (data as Record<string, unknown>).cursor;
    if (typeof c === 'string' && c) return c;
  }
  return null;
};

/**
 * Charter invariant 2 — responses are passed through, not re-enveloped:
 * spread the backend row and add derived fields ALONGSIDE it, so a field the
 * transitions job adds later reaches agents without an edit here.
 *
 * `date` is normalised because the two candidate fields carry DIFFERENT
 * precision — verified on live rows: `date: "2026-08-26"` (day) vs
 * `eventTimestamp: "2026-08-26T06:00:00.000Z"` (instant).
 *
 * The SORT key prefers `eventTimestamp`, the display `date` prefers `date`.
 * That asymmetry is deliberate: sorting on the day-precision field collapses
 * every same-day row to midnight, so "newest first" stops ordering within a
 * day — which is most of what this tool returns, since the job writes one
 * batch per morning.
 */
const project = (e: EventRow) => ({
  ...e,
  date: e.date ?? e.eventTimestamp,
});

/** Kept OUT of `project` so it never reaches the agent-facing payload. */
const sortKey = (e: EventRow): number => toTime(e.eventTimestamp ?? e.date);

function toTime(v: unknown): number {
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v ?? ''));
  return Number.isNaN(t) ? 0 : t;
}

type Bucketed = { row: ReturnType<typeof project>; ms: number };
const newestFirst = (a: Bucketed, b: Bucketed) => b.ms - a.ms;

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
      '📅 Transitions are written by the 04:12 UTC job, so the freshest data appears after that. ' +
      '📑 Each type is paginated to completeness (cursor-followed, 10-page cap). If a type hits the cap the ' +
      'response carries `truncated: true` + `truncatedTypes` and the counts are PARTIAL — narrow with a ' +
      'smaller `days` or a `symbol`. A per-type fetch failure sets `partial: true` + `failedTypes` rather ' +
      'than failing the whole call.',
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
      maxRows: z
        .number()
        .optional()
        .describe(
          'Max rows returned PER bucket (default 200). `counts` are always complete — this caps only ' +
            'what is rendered, newest first, and reports `rowsOmitted`.'
        ),
      includeSeeded: z
        .boolean()
        .optional()
        .describe(
          'Include first-run seed rows (`seeded: true`). Defaults to FALSE — they are current-state ' +
            'bookkeeping, not stage changes. Set true only to audit what the seed wrote.'
        ),
    },
    async ({ days, symbol, side, includeSeeded, maxRows }) => {
      try {
        const sym = symbol ? normalizeSymbol(symbol) : undefined;
        const effectiveDays = days ?? 7;

        // One request per type — the endpoint filters a single `type` per
        // call. Run them concurrently; that is the whole point of the tool.
        //
        // `allSettled`, not `all`: with `all`, a transient 500 on one type
        // discards the four successful responses, which is strictly worse
        // than the five separate calls this tool replaces. Partial results
        // degrade visibly via `failedTypes` instead.
        const PAGE_CAP = 10;
        const settled = await Promise.allSettled(
          ALL_TYPES.map(async (type) => {
            // Follow the cursor. A hard limit with no follow silently drops
            // rows AND makes `counts` confidently wrong rather than obviously
            // partial — the undercount class `dwlf_get_events` was fixed for.
            const rows: EventRow[] = [];
            let cursor: string | undefined;
            let pages = 0;
            let truncated = false;
            do {
              const data = await client.get('/events', {
                type,
                symbol: sym,
                days: effectiveDays,
                limit: 500,
                cursor,
              });
              rows.push(...asArray(data));
              cursor = cursorOf(data) ?? undefined;
              pages += 1;
              if (cursor && pages >= PAGE_CAP) {
                truncated = true;
                break;
              }
            } while (cursor);
            return { type, rows, truncated, pages };
          })
        );

        const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
        const failedTypes = settled.flatMap((s, i) =>
          s.status === 'rejected'
            ? [{ type: ALL_TYPES[i], error: String((s.reason as Error)?.message ?? s.reason) }]
            : []
        );
        const truncatedTypes = results.filter((r) => r.truncated).map((r) => r.type);

        const buckets: Record<string, Bucketed[]> = {
          entered: [],
          downgraded: [],
          left: [],
        };
        // Tallied in the SAME pass as the buckets — a second filtered pass
        // drifts from this one the moment the suppression rule changes, and
        // then byEventType silently stops summing to total.
        // A failed type must NOT read as "0 rows" — that is indistinguishable
        // from a successful empty query. null says "unknown, this one failed".
        const failedSet = new Set(failedTypes.map((f) => f.type));
        const byEventType: Record<string, number | null> = Object.fromEntries(
          ALL_TYPES.map((t) => [t, failedSet.has(t) ? null : 0])
        );
        let suppressedSeeded = 0;
        let total = 0;

        for (const { type, rows } of results) {
          for (const raw of rows) {
            // `side` lives under `setup` — SPT's mapEventItem nests the
            // screener snapshot there (the flat top-level fields the job
            // writes are stripped by the mapper's allow-list). `seeded`
            // stays top-level: it is row provenance, not part of the
            // snapshot. Getting this wrong is silent in both directions —
            // side filters everything out, or seed suppression no-ops.
            const setup = (raw.setup ?? {}) as Record<string, unknown>;
            if (side && setup.side !== side) continue;
            if (!includeSeeded && raw.seeded) {
              suppressedSeeded += 1;
              continue;
            }
            total += 1;
            byEventType[type] = (byEventType[type] ?? 0) + 1;
            const bucket =
              type === DOWNGRADED_TYPE ? 'downgraded' : type === LEFT_TYPE ? 'left' : 'entered';
            buckets[bucket].push({ row: project(raw), ms: sortKey(raw) });
          }
        }
        for (const key of Object.keys(buckets)) buckets[key].sort(newestFirst);

        // Context ceiling. 10 pages x 500 rows x 5 types could dump thousands
        // of rows into an agent's context. `counts` are computed BEFORE this,
        // so they stay truthful; only the returned rows are capped.
        const cap = maxRows ?? 200;
        let rowsOmitted = 0;
        const output: Record<string, ReturnType<typeof project>[]> = {};
        for (const [key, list] of Object.entries(buckets)) {
          rowsOmitted += Math.max(0, list.length - cap);
          output[key] = list.slice(0, cap).map((b) => b.row);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  transitions: output,
                  counts: { total, byEventType },
                  suppressedSeeded,
                  ...(rowsOmitted > 0
                    ? {
                        rowsOmitted,
                        rowsOmittedHint:
                          `${rowsOmitted} row(s) beyond the ${cap}-per-bucket display cap were omitted ` +
                          '(newest kept). `counts` are complete; raise `maxRows` or narrow the query.',
                      }
                    : {}),
                  ...(failedTypes.length > 0
                    ? {
                        failedTypes,
                        partial: true,
                        partialHint:
                          `${failedTypes.length} of ${ALL_TYPES.length} type queries failed — ` +
                          'the results below are INCOMPLETE. Counts exclude the failed types.',
                      }
                    : {}),
                  ...(truncatedTypes.length > 0
                    ? {
                        truncated: true,
                        truncatedTypes,
                        truncatedHint:
                          `Hit the ${PAGE_CAP}-page cap on: ${truncatedTypes.join(', ')}. ` +
                          'Counts are PARTIAL — narrow with a smaller `days` or a `symbol`.',
                      }
                    : {}),
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
                    maxRows: cap,
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
        // isError so a 401/500/timeout is not delivered to the client as a
        // *successful* result whose text merely starts with "Error…".
        return {
          isError: true,
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
