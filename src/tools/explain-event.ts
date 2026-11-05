import { publicEntry } from '../data/publicText.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { z } from 'zod';
import { DWLFClient } from '../client.js';
import { ONCHAIN_EVENTS, ONCHAIN_CATALOGUE_AS_OF, ONCHAIN_CATALOGUE_BRK_VERSION } from '../data/onchainCatalogue.js';

/**
 * "Explain this event" (DWLF-646). The definition comes from the API (GET /v2/events/{type}/explain, generated from
 * the onchain-packs catalogue and the trust pack's revision classes), so a catalogue change reaches agents without
 * a release. The API decides which types exist (a 404 tagged `UNKNOWN_EVENT_TYPE` is a usage error). Only an
 * untagged 404, an API without the route, falls back to the catalogue bundled with this package, and
 * `definitionSource` says which was used; any other failure is an error. Occurrences (one day, what changed since a
 * date, or the latest five) come from GET /v2/events/{type}/explain/occurrences for engine types; never bundled.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
type Json = Record<string, unknown>;

const statusOf = (error: unknown): number | null => (axios.isAxiosError(error) ? error.response?.status ?? null : null);
// SPT tags "no such type" (DWLF-646); a 404 without it is a route this API lacks (its /v2 catch-all).
// Read in either envelope (top-level `code`, or the `{ error: { code } }` shape the backend is standardising on).
const isUnknownType = (error: unknown) => {
  if (!axios.isAxiosError(error)) return false;
  const data = error.response?.data as { code?: unknown; error?: { code?: unknown } } | undefined;
  return data?.code === 'UNKNOWN_EVENT_TYPE' || data?.error?.code === 'UNKNOWN_EVENT_TYPE';
};
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
/** With `since`, rows listed per bucket unless the caller asks (DWLF-685: 50 rows ran to 60-65k characters). */
export const SINCE_ROWS_DEFAULT = 10;

const reply = (body: Json) => ({ content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] });
const usage = (text: string) => ({ content: [{ type: 'text' as const, text: `Usage: ${text}` }], isError: true });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function registerExplainEventTools(server: McpServer, client: Pick<DWLFClient, 'get'>) {
  server.tool(
    'dwlf_explain_event',
    'Explain one Bitcoin on-chain event type (`onchain.*`) and, for the types the engine evaluates, its occurrences. ' +
      'Returns the DEFINITION: meaning, method and version, inputs, threshold, history start, caveats, `revision` ' +
      '(can this event\'s history change under you, and why: immutable / oracle / model / estimated), ' +
      '`measuredHistory` (how often it fired on DWLF\'s node, by year, dated) and `inEngine`. With `inEngine: true` ' +
      'it also returns OCCURRENCES: `date` = that day\'s occurrence (or the nearest days either side); `since` = what ' +
      'changed, as three disjoint buckets placed by the day a row became knowable (`onchain.confirmedAt`; an on-chain row ' +
      'dated D is confirmed on D+1): `fired` (knowable on or after `since`), `published` (knowable before `since` but ' +
      'first served on or after it, e.g. a backfill: new to you, NOT a firing) and `revised` (served before `since`, ' +
      'restated on or after it). Each bucket is { count, firstDated, lastDated, rows (the newest; `rows` sets how many, ' +
      'default 10), truncated }: quote ' +
      '`count`, not the rows listed. Neither = the 5 most recent. A `date` with nothing on it gives `occurrence: null` and the nearest days. Every occurrence answer carries `history` { count, first, last, ' +
      'methodVersions } from the live table. Use dwlf_describe_onchain_events to browse or search the types.\n\n' +
      '⚠️ Read before you report:\n' +
      '- These are CONDITIONS on the chain, not calls. Describe them; never turn one into a buy/sell/hold.\n' +
      '- `definitionSource: "bundled"` means this API does not serve explain yet and the definition is this package\'s copy, ' +
      'dated by `bundledAsOf`: say so. A bundled definition has no `revision` or `measuredHistory` (null = UNKNOWN, ' +
      'not "cannot change") and no occurrences.\n' +
      '- `occurrencesUnavailable` says why there are none (not in the engine, or the read failed). Never infer ' +
      '"it has not fired" from it.\n' +
      '- `priceWithheld: true` on a row means this key may not receive the close (data licensing): do not ask for it ' +
      'another way.\n' +
      '- `revised` rows changed after they were first served: quote the revision, and `revision.why`.\n' +
      '- `published` rows are history DWLF served late (a backfill): never report them as recent firings.\n' +
      '- Check `occurrences.responseVersion`. 2 = the bucket shape above. MISSING = an older DWLF API, where `fired` ' +
      'and `revised` are plain arrays and `fired` mixes real firings with late-published history (a backfill): then ' +
      'report as firings only the `fired` rows whose `onchain.confirmedAt` (else `date`) is on or after `since`, the same ' +
      'rule as version 2, and say that the API is older.',
    {
      eventType: z.string().describe('An onchain.* event type id, e.g. onchain.sth_sopr.lose (a `#…` row-key suffix is ignored)'),
      date: z.string().optional().describe('YYYY-MM-DD: explain the occurrence on this day'),
      since: z.string().optional().describe('YYYY-MM-DD: what fired, was first published, or was restated on or after this day'),
      rows: z.number().int().min(1).max(50).optional()
        .describe('With since: how many rows each bucket lists, the newest (default 10, max 50). Counts are always whole.'),
    },
    async ({ eventType, date, since, rows }) => {
      try {
        return await explain({ eventType, date, since, rows });
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Error explaining ${eventType}: ${messageOf(error)}` }], isError: true };
      }
    }
  );

  async function explain({ eventType, date, since, rows }: { eventType: string; date?: string; since?: string; rows?: number }) {
    // A row key's suffix (e.g. `#cohort=2019-01-01:weekly`) names a row, not a type: explain the type.
    const type = eventType.trim().split('#')[0];
    if (!type.startsWith('onchain.')) return usage(`eventType must be an onchain.* type (got "${type}").`);
    if (date !== undefined && since !== undefined) return usage('pass date (one occurrence) or since (what changed), not both.');
    for (const [name, v] of [['date', date], ['since', since]] as const) {
      if (v !== undefined && !DAY.test(v)) return usage(`${name} must be YYYY-MM-DD (got "${v}").`);
    }
    const path = `/events/${encodeURIComponent(type)}/explain`;

    let definition: Json;
    try {
      const got = await client.get<unknown>(path);
      if (!isObject(got)) throw new Error('the explain route answered with no definition');
      definition = got;
    } catch (error) {
      // The API is the authority on which types exist; only a route this API lacks falls back to the bundle. Any
      // other failure (auth, rate limit, 5xx, timeout, a malformed answer) is the tool's error.
      if (isUnknownType(error)) return usage(`no on-chain event type "${type}". Browse with dwlf_describe_onchain_events.`);
      if (statusOf(error) !== 404) throw error;
      const bundled = ONCHAIN_EVENTS.find((e) => e.id === type);
      if (!bundled) return usage(`no on-chain event type "${type}". Browse with dwlf_describe_onchain_events.`);
      return reply({
        definitionSource: 'bundled',
        bundledAsOf: ONCHAIN_CATALOGUE_AS_OF,
        bundledBrkVersion: ONCHAIN_CATALOGUE_BRK_VERSION,
        apiError: messageOf(error),
        definition: { ...publicEntry(bundled), revision: null, measuredHistory: null, inEngine: null },
        framing: 'Conditions, not calls.',
        occurrencesUnavailable: 'this DWLF API does not serve explain yet, so occurrences cannot be read here',
      });
    }

    const out: Json = { definitionSource: 'api', definition, framing: 'Conditions, not calls.' };
    if (definition.inEngine === false) {
      out.occurrencesUnavailable = 'not in the engine: documented and measured on DWLF\'s node, not yet in /v2/events';
      return reply(out);
    }
    const params: Record<string, string> = {};
    if (date !== undefined) params.date = date;
    if (since !== undefined) {
      params.since = since;
      params.rows = String(rows ?? SINCE_ROWS_DEFAULT);
    }
    try {
      out.occurrences = await client.get<Json>(`${path}/occurrences`, params);
    } catch (error) {
      out.occurrencesUnavailable = `the occurrences read failed: ${messageOf(error)}`;
    }
    return reply(out);
  }
}
