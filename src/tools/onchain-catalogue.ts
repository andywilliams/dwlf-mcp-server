import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { z } from 'zod';
import { DWLFClient } from '../client.js';
import { createCatalogueLoader } from '../data/nodeCatalogue.js';
import {
  ONCHAIN_EVENTS, ONCHAIN_PACKS, ONCHAIN_CATALOGUE_AS_OF, ONCHAIN_CATALOGUE_BRK_VERSION, type OnchainEventEntry,
} from '../data/onchainCatalogue.js';

/**
 * What each Bitcoin on-chain event type means (DWLF-621; live since DWLF-646).
 *
 * The definitions come from the LIVE API: one read of GET /v2/events/explain, whose `types[]` carries a line per type
 * (SPT #747), cached 15 minutes, and GET /v2/events/{type}/explain for one type in full. So a catalogue change
 * reaches agents without a release, and the engine's own types (which the bundle lacks) are covered too. Whether a
 * type is in the engine comes from the same API.
 *
 * The catalogue bundled with this package (`src/data/onchainCatalogue.ts`, generated from the onchain-packs docs) is
 * the OFFLINE FALLBACK: used when the index can't be read, or the API is older than `types[]`. Then engine state is
 * read from the node catalogue (GET /v2/node-types), as before. Every answer says which (`definitionSource`).
 * test/onchainCatalogue.test.mjs checks the bundle against what SPT serves (test/fixtures/spt-explain-index.json).
 */

type CatalogueLoader = ReturnType<typeof createCatalogueLoader>;

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
export type ExplainIndex = { packs: ApiPack[]; types: ApiTypeLine[]; catalogueAsOf?: string; brkVersion?: string };
export type ExplainIndexLoader = (now?: number) => Promise<{ index: ExplainIndex } | { error: string }>;

const TTL_MS = 15 * 60 * 1000;
/** The pseudo-pack for the types the engine itself evaluates (the API gives them no pack). */
const ENGINE_PACK = 'engine';
/** The bundle's name for the engine's cost-basis types, kept as an alias so older prompts still work. */
const PACK_ALIASES: Record<string, string> = { costBasis: ENGINE_PACK };

const isIndex = (body: unknown): body is ExplainIndex => {
  const b = body as Partial<ExplainIndex> | null;
  return Boolean(b) && Array.isArray(b!.types) && Array.isArray(b!.packs) && b!.types!.length > 0
    && b!.types!.every((t) => typeof t?.type === 'string' && typeof t?.meaning === 'string');
};

/** A loader for the explain index that caches a good read for 15 minutes; a failure is returned, never cached. */
export const createExplainIndexLoader = (get: (path: string) => Promise<unknown>, ttlMs = TTL_MS): ExplainIndexLoader => {
  let cached: { at: number; index: ExplainIndex } | null = null;
  return async (now = Date.now()) => {
    if (cached && now - cached.at < ttlMs) return { index: cached.index };
    try {
      const body = await get('/events/explain');
      if (!isIndex(body)) return { error: 'GET /events/explain has no per-type lines (an API older than this tool)' };
      cached = { at: now, index: body };
      return { index: body };
    } catch (error) {
      return { error: `GET /events/explain failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  };
};

const packOf = (t: ApiTypeLine) => t.pack?.id ?? ENGINE_PACK;
const lineOf = (t: ApiTypeLine) => ({
  id: t.type, pack: packOf(t), label: t.label, meaning: t.meaning, inEngine: t.inEngine, estimated: t.estimated,
  revisionClass: t.revisionClass ?? null,
});

const reply = (meta: object, body: object) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ ...meta, ...body }, null, 2) }] });
const usage = (text: string) => ({ content: [{ type: 'text' as const, text: `Usage: ${text}` }], isError: true });
const searchWords = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean);

export function registerOnchainCatalogueTools(
  server: McpServer,
  client: Pick<DWLFClient, 'get'>,
  // Per registration, unless a host passes its process-wide loaders (DWLF-622).
  loadCatalogue: CatalogueLoader = createCatalogueLoader((path) => client.get(path)),
  loadIndex: ExplainIndexLoader = createExplainIndexLoader((path) => client.get(path)),
) {
  server.tool(
    'dwlf_describe_onchain_events',
    'What does a Bitcoin on-chain event mean? Describes the `onchain.*` event types: the plain-English condition, ' +
      'the inputs and threshold, the history start, how often it has fired, the method version and the caveats. ' +
      `Packs: \`${ENGINE_PACK}\` (the types DWLF's engine evaluates: cost-basis crosses, MVRV, supply in profit, ` +
      `STH-SOPR, cohorts, dormancy, CDD, whale transfers) and the onchain-packs (${Object.keys(ONCHAIN_PACKS).filter((p) => p !== 'costBasis').map((p) => `\`${p}\``).join(', ')}). ` +
      'No arguments → the packs with their summaries. `pack` → that pack\'s types. `eventType` → one type in full. ' +
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
      pack: z.string().optional().describe(`One pack: ${ENGINE_PACK}, ${Object.keys(ONCHAIN_PACKS).filter((p) => p !== 'costBasis').join(', ')}`),
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
    const lines = index.types;
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
      try {
        const definition = await client.get<Record<string, unknown>>(`/events/${encodeURIComponent(id)}/explain`);
        return reply(meta, { event: { ...definition, id, pack: packOf(line) }, packState: packState(packOf(line)) });
      } catch (error) {
        // The one-line summary still answers; say the full definition could not be read.
        const message = axios.isAxiosError(error) || error instanceof Error ? error.message : String(error);
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
      const hits = lines.filter((t) => words.every((w) => `${t.type} ${t.meaning} ${t.label ?? ''}`.toLowerCase().includes(w)));
      return reply(meta, { search, count: hits.length, events: hits.slice(0, 50).map(lineOf), truncated: hits.length > 50 });
    }
    return reply(meta, { packs: packIds.map(packState), total: lines.length });
  }

  /** The offline fallback: the bundled catalogue, with engine state read from the node catalogue (as before). */
  async function fromBundle({ pack, eventType, search }: { pack?: string; eventType?: string; search?: string }, apiError: string) {
    const meta = {
      definitionSource: 'bundled', asOf: ONCHAIN_CATALOGUE_AS_OF, brkVersion: ONCHAIN_CATALOGUE_BRK_VERSION, apiError, framing: 'Conditions, not calls.',
    };
    const engineTypes = async (): Promise<Set<string> | null> => {
      const loaded = await loadCatalogue();
      return loaded.error ? null : new Set(loaded.nodes.filter((n) => !n.engineIgnored).map((n) => n.nodeType));
    };
    // Each type carries its OWN engine state; a pack can be partly in the engine.
    const summary = (e: OnchainEventEntry, inEngine: Set<string> | null) => ({
      id: e.id, pack: e.pack, meaning: e.meaning, inEngine: inEngine === null ? null : inEngine.has(e.id),
    });
    const withPackState = (id: string, inEngine: Set<string> | null) => ({
      pack: id, ...ONCHAIN_PACKS[id],
      inEngine: inEngine === null ? null : ONCHAIN_EVENTS.some((e) => e.pack === id && inEngine.has(e.id)),
    });

    if (eventType !== undefined) {
      const id = eventType.trim().split('#')[0];
      const entry = ONCHAIN_EVENTS.find((e) => e.id === id);
      if (!entry) return usage(`no on-chain event type "${id}" in this package's offline copy. Search with { search: "…" } or list a pack.`);
      const inEngine = await engineTypes();
      return reply(meta, { event: { ...entry, inEngine: inEngine === null ? null : inEngine.has(entry.id) }, packState: withPackState(entry.pack, inEngine) });
    }
    if (pack !== undefined) {
      const id = pack.trim() === ENGINE_PACK ? 'costBasis' : pack.trim();
      if (!Object.hasOwn(ONCHAIN_PACKS, id)) return usage(`unknown pack "${pack.trim()}"; one of ${Object.keys(ONCHAIN_PACKS).join(', ')}.`);
      const inEngine = await engineTypes();
      return reply(meta, { packState: withPackState(id, inEngine), events: ONCHAIN_EVENTS.filter((e) => e.pack === id).map((e) => summary(e, inEngine)) });
    }
    if (search !== undefined) {
      const words = searchWords(search);
      if (!words.length) return usage('search is blank.');
      const hits = ONCHAIN_EVENTS.filter((e) => words.every((w) => `${e.id} ${e.meaning}`.toLowerCase().includes(w)));
      const inEngine = await engineTypes();
      return reply(meta, { search, count: hits.length, events: hits.slice(0, 50).map((e) => summary(e, inEngine)), truncated: hits.length > 50 });
    }
    const inEngine = await engineTypes();
    return reply(meta, { packs: Object.keys(ONCHAIN_PACKS).map((p) => withPackState(p, inEngine)), total: ONCHAIN_EVENTS.length });
  }
}
