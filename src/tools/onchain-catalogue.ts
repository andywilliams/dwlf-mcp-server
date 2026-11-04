import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';
import { createCatalogueLoader } from '../data/nodeCatalogue.js';
import {
  ONCHAIN_EVENTS, ONCHAIN_PACKS, ONCHAIN_CATALOGUE_AS_OF, ONCHAIN_CATALOGUE_BRK_VERSION, type OnchainEventEntry,
} from '../data/onchainCatalogue.js';

/**
 * What each Bitcoin on-chain event type means (DWLF-621). The MEANINGS come from the catalogue bundled with this
 * package (generated from the onchain-packs docs: scripts/gen-onchain-catalogue.mjs; dated by `asOf`). Whether a
 * pack is IN THE ENGINE is read live from the public node catalogue (GET /v2/node-types, cached 15 min), never
 * bundled, so a release does not freeze it: `inEngine` is true when the engine catalogues the pack's types, false
 * when it does not, null when the catalogue could not be read.
 * TODO(DWLF-646): serve the meanings from the API too (an /v2/node-types-style catalogue), so they stop being per-release.
 */

const packLine = (id: string) => `${ONCHAIN_PACKS[id].title} (\`${id}\`, ${ONCHAIN_PACKS[id].count})`;
const PACK_LIST = Object.keys(ONCHAIN_PACKS).map(packLine).join('; ');


export function registerOnchainCatalogueTools(server: McpServer, client: Pick<DWLFClient, 'get'>) {
  const loadCatalogue = createCatalogueLoader((path) => client.get(path));
  const engineTypes = async (): Promise<Set<string> | null> => {
    const loaded = await loadCatalogue();
    return loaded.error ? null : new Set(loaded.nodes.filter((n) => !n.engineIgnored).map((n) => n.nodeType));
  };
  // Each type carries its OWN engine state; a pack can be partly in the engine.
  const summary = (e: OnchainEventEntry, inEngine: Set<string> | null) => ({
    id: e.id, pack: e.pack, meaning: e.meaning, inEngine: inEngine === null ? null : inEngine.has(e.id),
  });
  const withPackState = (pack: string, inEngine: Set<string> | null) => ({
    pack, ...ONCHAIN_PACKS[pack],
    inEngine: inEngine === null ? null : ONCHAIN_EVENTS.some((e) => e.pack === pack && inEngine.has(e.id)),
  });

  server.tool(
    'dwlf_describe_onchain_events',
    'What does a Bitcoin on-chain event mean? Describes the `onchain.*` event types: the plain-English condition, ' +
      'the inputs and threshold, the history start, how often it has fired, the method version and the caveats. ' +
      `Packs: ${PACK_LIST}. ` +
      'No arguments → the packs with their summaries. `pack` → that pack\'s types. `eventType` → one type in full. ' +
      '`search` → types whose id or meaning contains the words.\n\n' +
      '⚠️ Read `inEngine` (live from the engine\'s node catalogue). It is given per TYPE, on every type returned, and ' +
      'per pack, where a pack is `true` if ANY of its types is in the engine: a pack can be partly in. Before building ' +
      'a custom event on a type, check that type\'s own `inEngine`. `true` = the engine evaluates it and its rows can ' +
      'be read with dwlf_get_events or dwlf_get_conditions; `false` = a documented condition with its history ' +
      'measured on DWLF\'s own node, not yet queryable; `null` = the catalogue could not be read, so it is unknown. Every type describes a CONDITION on the chain, not advice. ' +
      '`estimated: true` marks types built on an attribution or a proxy (mining-pool attribution, the fee-backlog proxy): read their caveats. And `confirmedAt` on a row is when it ' +
      'became knowable. Frequencies are historical counts, not predictions.',
    {
      pack: z.string().optional().describe(`One pack: ${Object.keys(ONCHAIN_PACKS).join(', ')}`),
      eventType: z.string().optional().describe('One event type id, e.g. onchain.mining.hash_ribbon.capitulation.enter'),
      search: z.string().optional().describe('Words to find in an id or meaning, e.g. "hash rate" or "consolidation"'),
    },
    async ({ pack, eventType, search }) => {
      try {
        return await answer({ pack, eventType, search });
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error describing on-chain events: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  async function answer({ pack, eventType, search }: { pack?: string; eventType?: string; search?: string }) {
    const meta = { asOf: ONCHAIN_CATALOGUE_AS_OF, brkVersion: ONCHAIN_CATALOGUE_BRK_VERSION, framing: 'Conditions, not calls.' };
    const reply = (body: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ ...meta, ...(body as object) }, null, 2) }] });
    const usage = (text: string) => ({ content: [{ type: 'text' as const, text: `Usage: ${text}` }], isError: true });

    if ([pack, eventType, search].filter((v) => v !== undefined).length > 1) {
      return usage('pass one of pack, eventType or search.');
    }
    if (eventType !== undefined) {
      const id = eventType.trim().split('#')[0];
      const entry = ONCHAIN_EVENTS.find((e) => e.id === id);
      if (!entry) return usage(`no on-chain event type "${id}". Search with { search: "…" } or list a pack.`);
      const inEngine = await engineTypes();
      // Per type, not per pack: a pack can be partly in the engine, or have one type the engine ignores.
      return reply({ event: { ...entry, inEngine: inEngine === null ? null : inEngine.has(entry.id) }, packState: withPackState(entry.pack, inEngine) });
    }
    if (pack !== undefined) {
      const id = pack.trim();
      if (!Object.hasOwn(ONCHAIN_PACKS, id)) return usage(`unknown pack "${id}"; one of ${Object.keys(ONCHAIN_PACKS).join(', ')}.`);
      const inEngine = await engineTypes();
      return reply({ packState: withPackState(id, inEngine), events: ONCHAIN_EVENTS.filter((e) => e.pack === id).map((e) => summary(e, inEngine)) });
    }
    if (search !== undefined) {
      const words = search.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return usage('search is blank.');
      const hits = ONCHAIN_EVENTS.filter((e) => words.every((w) => `${e.id} ${e.meaning}`.toLowerCase().includes(w)));
      const inEngine = await engineTypes();
      return reply({ search, count: hits.length, events: hits.slice(0, 50).map((e) => summary(e, inEngine)), truncated: hits.length > 50 });
    }
    const inEngine = await engineTypes();
    return reply({ packs: Object.keys(ONCHAIN_PACKS).map((p) => withPackState(p, inEngine)), total: ONCHAIN_EVENTS.length });
  }
}
