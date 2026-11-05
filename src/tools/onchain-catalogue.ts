import { publicText, publicEntry } from '../data/publicText.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';
import { createCatalogueLoader } from '../data/nodeCatalogue.js';
import {
  ONCHAIN_EVENTS, ONCHAIN_PACKS, ONCHAIN_CATALOGUE_AS_OF, ONCHAIN_CATALOGUE_BRK_VERSION, type OnchainEventEntry,
} from '../data/onchainCatalogue.js';

/**
 * What each Bitcoin on-chain event type means (DWLF-621; live since DWLF-646).
 *
 * The definitions come from the LIVE API: one read of GET /v2/events/explain, whose `typeSummaries` carries a line per
 * type (SPT #747), cached 15 minutes, and GET /v2/events/{type}/explain for one type in full. So a catalogue change
 * reaches agents without a release, and the engine's own types (which the bundle lacks) are covered too. Whether a
 * type is in the engine comes from the same API.
 *
 * The catalogue bundled with this package (`src/data/onchainCatalogue.ts`, generated from the onchain-packs docs) is
 * the OFFLINE FALLBACK: used when the index can't be read, or the API is older than `typeSummaries`; then engine state
 * comes from the node catalogue (GET /v2/node-types; null when unreadable). Every answer says which
 * (`definitionSource`), and both name the engine's types `engine` (the bundle's `costBasis` is an alias).
 * test/onchainCatalogue.test.mjs checks the bundle against what SPT serves (test/fixtures/spt-explain-index.json).
 */

type ApiTypeLine = {
  type: string;
  pack: { id: string; title?: string } | null;
  label: string | null;
  meaning: string;
  inEngine: boolean;
  estimated: boolean;
  revisionClass?: string;
};
type ApiPack = { id: string; title: string; summary: string; types: string[] };
export type ExplainIndex = { packs: ApiPack[]; typeSummaries: ApiTypeLine[]; catalogueAsOf?: string; brkVersion?: string };
export type ExplainIndexLoader = (now?: number) => Promise<{ index: ExplainIndex } | { error: string }>;

const TTL_MS = 15 * 60 * 1000;
/** A failed or too-old read is remembered this long, so the fallback answers at once instead of re-trying each call. */
const NEGATIVE_TTL_MS = 2 * 60 * 1000;
/** The pseudo-pack for the types the engine itself evaluates (the API gives them no pack). */
const ENGINE_PACK = 'engine';
/** The bundle's name for the engine's cost-basis types, kept as an alias so older prompts still work. */
const BUNDLE_ENGINE_PACK = 'costBasis';
const PACK_ALIASES: Record<string, string> = { [BUNDLE_ENGINE_PACK]: ENGINE_PACK };

const isIndex = (body: unknown): body is ExplainIndex => {
  const b = body as Partial<ExplainIndex> | null;
  return Boolean(b) && Array.isArray(b!.typeSummaries) && Array.isArray(b!.packs) && b!.typeSummaries!.length > 0
    && b!.typeSummaries!.every((t) => typeof t?.type === 'string' && typeof t?.meaning === 'string');
};

/**
 * A loader for the explain index: a good read is cached 15 minutes; a failure, or an API without per-type lines, for 2
 * (so the offline copy answers at once meanwhile, and the live index is picked up soon after it appears). Once there
 * has been a good read, a failed refresh keeps serving it (stale beats a release-old bundle) and retries after 2
 * minutes; the bundle answers only when no good read has happened yet.
 */
export const createExplainIndexLoader = (get: (path: string) => Promise<unknown>, ttlMs = TTL_MS, negativeTtlMs = NEGATIVE_TTL_MS): ExplainIndexLoader => {
  let good: { at: number; index: ExplainIndex } | null = null;
  let failure: { at: number; error: string } | null = null;
  return async (now = Date.now()) => {
    if (good && now - good.at < ttlMs) return { index: good.index };
    if (failure && now - failure.at < negativeTtlMs) return good ? { index: good.index } : { error: failure.error };
    try {
      const body = await get('/events/explain');
      if (isIndex(body)) {
        good = { at: now, index: body };
        failure = null;
        return { index: body };
      }
      failure = { at: now, error: 'GET /events/explain has no per-type lines (an API older than this tool)' };
    } catch (error) {
      failure = { at: now, error: `GET /events/explain failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    return good ? { index: good.index } : { error: failure.error };
  };
};

const packOf = (t: ApiTypeLine) => t.pack?.id ?? ENGINE_PACK;
const lineOf = (t: ApiTypeLine) => ({
  id: t.type, pack: packOf(t), label: t.label, meaning: t.meaning, inEngine: t.inEngine, estimated: t.estimated,
  revisionClass: t.revisionClass ?? null,
});

/** The bundle's packs other than its engine group (which both paths call `engine`). */
const BUNDLE_PACKS = Object.keys(ONCHAIN_PACKS).filter((p) => p !== BUNDLE_ENGINE_PACK);

const reply = (meta: object, body: object) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ ...meta, ...body }, null, 2) }] });
const usage = (text: string) => ({ content: [{ type: 'text' as const, text: `Usage: ${text}` }], isError: true });
const searchWords = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Words people search with that the ids and meanings do not use (DWLF-685: "short-term holder", "STH cost basis" and
 * "capitulation" missed sth_sopr.lose and sth_realised_price.*). Each entry adds its words to the searchable text of
 * every type whose id contains the key, so a search still needs ALL its words to match.
 */
const SEARCH_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['sth', 'short-term holder short term holders sth'],
  ['lth', 'long-term holder long term holders lth'],
  ['realised_price', 'realized price cost basis on-chain cost'],
  ['sopr', 'spent output profit ratio'],
  ['sth_sopr.lose', 'capitulation selling at a loss'],
  ['sth_sopr.reclaim', 'profit taking selling at a profit'],
  ['mvrv', 'market value to realised value realized value valuation'],
  ['supply_in_profit', 'coins in profit supply in loss'],
  ['cohort.addr', 'whales whale addresses large holders'],
  ['dormant', 'old coins long dormant revived'],
  ['cdd', 'coin days destroyed'],
];
/** The text a search is matched against: id, meaning and label, plus the aliases for the id. */
const searchText = (id: string, meaning?: string | null, label?: string | null): string =>
  [id, meaning ?? '', label ?? '', ...SEARCH_ALIASES.filter(([key]) => id.includes(key)).map(([, words]) => words)]
    .join(' ').toLowerCase();

export function registerOnchainCatalogueTools(server: McpServer, client: Pick<DWLFClient, 'get'>) {
  // Per registration, cached in these closures.
  const loadCatalogue = createCatalogueLoader((path) => client.get(path));
  const loadIndex = createExplainIndexLoader((path) => client.get(path));
  server.tool(
    'dwlf_describe_onchain_events',
    'What does a Bitcoin on-chain event mean? Describes the `onchain.*` event types: the plain-English condition, ' +
      'the inputs and threshold, the history start, how often it has fired, the method version and the caveats. ' +
      `Packs: \`${ENGINE_PACK}\` (the types DWLF's engine evaluates: cost-basis crosses, MVRV, supply in profit, ` +
      `STH-SOPR, cohorts, dormancy, CDD, whale transfers) and the onchain-packs (${BUNDLE_PACKS.map((p) => `\`${p}\``).join(', ')}). ` +
      'No arguments → the packs with their summaries. `pack` → that pack\'s types. `eventType` → one type: `event` (its ' +
      'summary line) and `definition` (the full definition: inputs, threshold, caveats, history; `detailUnavailable` ' +
      'says why when it could not be read). ' +
      '`search` → types whose id or meaning contains the words. For one type\'s occurrences, use dwlf_explain_event.\n\n' +
      '⚠️ Read before you report:\n' +
      '- `definitionSource`: `api` = read live from DWLF; `bundled` = this package\'s offline copy (dated `asOf`), used ' +
      'only when the API could not be read (`apiError` says why). Say which when it matters.\n' +
      '- `inEngine` (per TYPE; a pack is `true` if ANY of its types is): `true` = the engine evaluates it and its rows ' +
      'can be read with dwlf_get_events, dwlf_get_conditions or dwlf_explain_event; `false` = a documented condition ' +
      'with its history measured on DWLF\'s own node, not yet queryable; `null` = unknown. Before building a custom ' +
      'event on a type, check that type\'s own `inEngine`.\n' +
      '- Every type describes a CONDITION on the chain, not advice. `estimated: true` marks types built on an ' +
      'attribution or a proxy: read their caveats. `confirmedAt` on a row is when it became knowable. Frequencies are ' +
      'historical counts, not predictions.',
    {
      pack: z.string().optional().describe(`One pack: ${[ENGINE_PACK, ...BUNDLE_PACKS].join(', ')}`),
      eventType: z.string().optional().describe('One event type id, e.g. onchain.mining.hash_ribbon.capitulation.enter'),
      search: z.string().optional().describe('Words to find in an id or meaning, e.g. "hash rate" or "consolidation"'),
    },
    async ({ pack, eventType, search }) => {
      try {
        if ([pack, eventType, search].filter((v) => v !== undefined).length > 1) return usage('pass one of pack, eventType or search.');
        const loaded = await loadIndex();
        return 'index' in loaded
          ? await fromApi(loaded.index, { pack, eventType, search })
          : await fromBundle({ pack, eventType, search }, loaded.error);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error describing on-chain events: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  /** Answers from the live index; one type in full from its own explain route. */
  async function fromApi(index: ExplainIndex, { pack, eventType, search }: { pack?: string; eventType?: string; search?: string }) {
    const meta = { definitionSource: 'api', asOf: index.catalogueAsOf ?? null, brkVersion: index.brkVersion ?? null, framing: 'Conditions, not calls.' };
    const lines = index.typeSummaries;
    const packState = (id: string) => {
      const members = lines.filter((t) => packOf(t) === id);
      const p = index.packs.find((x) => x.id === id);
      return {
        pack: id,
        title: p?.title ?? 'The engine\'s own on-chain events',
        summary: p?.summary ?? 'Evaluated by DWLF\'s engine on BTCOC/USD; their rows are served by /v2/events.',
        count: members.length,
        inEngine: members.some((t) => t.inEngine),
      };
    };
    const packIds = [ENGINE_PACK, ...index.packs.map((p) => p.id)];

    if (eventType !== undefined) {
      const id = eventType.trim().split('#')[0];
      const line = lines.find((t) => t.type === id);
      if (!line) return usage(`no on-chain event type "${id}". Search with { search: "…" } or list a pack.`);
      // `event` is the summary line (this tool's shape); `definition` is the API's, passed through unchanged.
      try {
        const definition = await client.get<Record<string, unknown>>(`/events/${encodeURIComponent(id)}/explain`);
        return reply(meta, { event: lineOf(line), definition, packState: packState(packOf(line)) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply(meta, { event: lineOf(line), detailUnavailable: `GET /events/${id}/explain failed: ${message}`, packState: packState(packOf(line)) });
      }
    }
    if (pack !== undefined) {
      const asked = pack.trim();
      const id = Object.hasOwn(PACK_ALIASES, asked) ? PACK_ALIASES[asked] : asked;
      if (!packIds.includes(id)) return usage(`unknown pack "${asked}"; one of ${packIds.join(', ')}.`);
      return reply(meta, {
        packState: packState(id),
        ...(id !== asked ? { aliasOf: `"${asked}" is now "${id}"` } : {}),
        events: lines.filter((t) => packOf(t) === id).map(lineOf),
      });
    }
    if (search !== undefined) {
      const words = searchWords(search);
      if (!words.length) return usage('search is blank.');
      const hits = lines.filter((t) => { const text = searchText(t.type, t.meaning, t.label); return words.every((w) => text.includes(w)); });
      return reply(meta, { search, count: hits.length, events: hits.slice(0, 50).map(lineOf), truncated: hits.length > 50 });
    }
    return reply(meta, { packs: packIds.map(packState), total: lines.length });
  }

  /**
   * The offline fallback: the bundled catalogue, engine state from the node catalogue (GET /v2/node-types; null when
   * unreadable). Its engine group is named `engine` here too, and says which engine types the offline copy lacks.
   */
  async function fromBundle({ pack, eventType, search }: { pack?: string; eventType?: string; search?: string }, apiError: string) {
    const meta = {
      definitionSource: 'bundled', asOf: ONCHAIN_CATALOGUE_AS_OF, brkVersion: ONCHAIN_CATALOGUE_BRK_VERSION, apiError, framing: 'Conditions, not calls.',
    };
    const engineTypes = async (): Promise<Set<string> | null> => {
      const loaded = await loadCatalogue();
      return loaded.error ? null : new Set(loaded.nodes.filter((n) => !n.engineIgnored).map((n) => n.nodeType));
    };
    const toPublicPack = (bundleName: string) => (bundleName === BUNDLE_ENGINE_PACK ? ENGINE_PACK : bundleName);
    const toBundlePack = (publicName: string) => (publicName === ENGINE_PACK ? BUNDLE_ENGINE_PACK : publicName);
    // Each type carries its OWN engine state; a pack can be partly in the engine.
    // The live summary line's shape (lineOf); the bundle has no label or revision class.
    const summary = (e: OnchainEventEntry, inEngine: Set<string> | null) => ({
      id: e.id, pack: toPublicPack(e.pack), label: null, meaning: publicText(e.meaning) ?? '', inEngine: inEngine === null ? null : inEngine.has(e.id),
      estimated: Boolean(e.estimated), revisionClass: null,
    });
    const withPackState = (id: string, inEngine: Set<string> | null) => ({
      pack: toPublicPack(id), ...ONCHAIN_PACKS[id],
      inEngine: inEngine === null ? null : ONCHAIN_EVENTS.some((e) => e.pack === id && inEngine.has(e.id)),
      ...(id === BUNDLE_ENGINE_PACK ? {
        missingFromOfflineCopy: 'the engine\'s cohort-supply, dormancy, CDD and whale-transfer types are described only by the live API',
      } : {}),
    });

    if (eventType !== undefined) {
      const id = eventType.trim().split('#')[0];
      const entry = ONCHAIN_EVENTS.find((e) => e.id === id);
      // Not a usage error: the type may well exist, and only the live API (unreadable now) would know.
      if (!entry) {
        return reply(meta, { event: null, detailUnavailable: `"${id}" is not in this package's offline copy, and the live API could not be read (apiError)` });
      }
      const inEngine = await engineTypes();
      // The same shape as the live answer: the summary line as `event`, the full entry as `definition`.
      return reply(meta, { event: summary(entry, inEngine), definition: { ...publicEntry(entry), pack: toPublicPack(entry.pack) }, packState: withPackState(entry.pack, inEngine) });
    }
    if (pack !== undefined) {
      const asked = pack.trim();
      const id = toBundlePack(Object.hasOwn(PACK_ALIASES, asked) ? PACK_ALIASES[asked] : asked);
      if (!Object.hasOwn(ONCHAIN_PACKS, id)) return usage(`unknown pack "${asked}"; one of ${[ENGINE_PACK, ...BUNDLE_PACKS].join(', ')}.`);
      const inEngine = await engineTypes();
      return reply(meta, {
        packState: withPackState(id, inEngine),
        ...(asked === BUNDLE_ENGINE_PACK ? { aliasOf: `"${asked}" is now "${ENGINE_PACK}"` } : {}),
        events: ONCHAIN_EVENTS.filter((e) => e.pack === id).map((e) => summary(e, inEngine)),
      });
    }
    if (search !== undefined) {
      const words = searchWords(search);
      if (!words.length) return usage('search is blank.');
      const hits = ONCHAIN_EVENTS.filter((e) => { const text = searchText(e.id, publicText(e.meaning)); return words.every((w) => text.includes(w)); });
      const inEngine = await engineTypes();
      return reply(meta, { search, count: hits.length, events: hits.slice(0, 50).map((e) => summary(e, inEngine)), truncated: hits.length > 50 });
    }
    const inEngine = await engineTypes();
    // The engine group first, as the live answer lists it.
    const order = [BUNDLE_ENGINE_PACK, ...BUNDLE_PACKS];
    return reply(meta, { packs: order.map((p) => withPackState(p, inEngine)), total: ONCHAIN_EVENTS.length });
  }
}
