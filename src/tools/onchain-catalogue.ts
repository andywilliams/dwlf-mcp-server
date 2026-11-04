import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ONCHAIN_EVENTS, ONCHAIN_PACKS, ONCHAIN_CATALOGUE_AS_OF, ONCHAIN_CATALOGUE_BRK_VERSION, type OnchainEventEntry,
} from '../data/onchainCatalogue.js';

/**
 * What each Bitcoin on-chain event type means (DWLF-621), answered from the catalogue bundled with this package
 * (generated from the onchain-packs docs: scripts/gen-onchain-catalogue.mjs). No API call: an agent can learn the
 * vocabulary before it has a key, and the answer is the same everywhere.
 *
 * Which packs are actually ingested into DWLF is stated per pack (`ingested`), so an agent does not go looking
 * for rows that do not exist yet. TODO(DWLF-593 and the packs' ingest ticket): flip a pack here when its rows are
 * verified live in EventsTable.
 */
const INGESTED_PACKS: ReadonlySet<string> = new Set([]);

const packLine = (id: string) => `${ONCHAIN_PACKS[id].title} (\`${id}\`, ${ONCHAIN_PACKS[id].count})`;
const PACK_LIST = Object.keys(ONCHAIN_PACKS).map(packLine).join('; ');

const summary = (e: OnchainEventEntry) => ({ id: e.id, pack: e.pack, meaning: e.meaning });
const withPackState = (pack: string) => ({ pack, ...ONCHAIN_PACKS[pack], ingested: INGESTED_PACKS.has(pack) });

export function registerOnchainCatalogueTools(server: McpServer) {
  server.tool(
    'dwlf_describe_onchain_events',
    'What does a Bitcoin on-chain event mean? Describes the `onchain.*` event types: the plain-English condition, ' +
      'the inputs and threshold, the history start, how often it has fired, the method version and the caveats. ' +
      `Packs: ${PACK_LIST}. ` +
      'No arguments → the packs with their summaries. `pack` → that pack\'s types. `eventType` → one type in full. ' +
      '`search` → types whose id or meaning contains the words.\n\n' +
      '⚠️ Read `ingested` on each pack: only an ingested pack has rows in DWLF, which you read with dwlf_get_events or ' +
      'dwlf_get_conditions. A pack that is not ingested is a documented condition with its history measured on ' +
      'DWLF\'s own node, but not yet queryable. Every type describes a CONDITION on the chain, not advice. ' +
      '`estimated: true` marks types built on an attribution or a proxy (mining-pool attribution, the fee-backlog proxy): read their caveats. And `confirmedAt` on a row is when it ' +
      'became knowable. Frequencies are historical counts, not predictions.',
    {
      pack: z.string().optional().describe(`One pack: ${Object.keys(ONCHAIN_PACKS).join(', ')}`),
      eventType: z.string().optional().describe('One event type id, e.g. onchain.mining.hash_ribbon.capitulation.enter'),
      search: z.string().optional().describe('Words to find in an id or meaning, e.g. "hash rate" or "consolidation"'),
    },
    async ({ pack, eventType, search }) => {
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
        return reply({ event: entry, packState: withPackState(entry.pack) });
      }
      if (pack !== undefined) {
        const id = pack.trim();
        if (!ONCHAIN_PACKS[id]) return usage(`unknown pack "${id}"; one of ${Object.keys(ONCHAIN_PACKS).join(', ')}.`);
        return reply({ packState: withPackState(id), events: ONCHAIN_EVENTS.filter((e) => e.pack === id).map(summary) });
      }
      if (search !== undefined) {
        const words = search.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return usage('search is blank.');
        const hits = ONCHAIN_EVENTS.filter((e) => words.every((w) => `${e.id} ${e.meaning}`.toLowerCase().includes(w)));
        return reply({ search, count: hits.length, events: hits.slice(0, 50).map(summary), truncated: hits.length > 50 });
      }
      return reply({ packs: Object.keys(ONCHAIN_PACKS).map(withPackState), total: ONCHAIN_EVENTS.length });
    }
  );
}
