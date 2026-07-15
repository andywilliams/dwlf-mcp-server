import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * Symbol TAG tools. Tags are the groups the markets chart's right-hand panel
 * organises symbols into (crypto, metals, tech, macro, …); an UNTAGGED symbol
 * falls into the catch-all "Others" bucket. These let the agent read the
 * existing groups and (re)assign a symbol so it lands in the right place
 * instead of "Others". Backed by the existing /v2/symbols/tags API.
 */
export function registerSymbolTagTools(server: McpServer, client: DWLFClient) {
  // 1. List all distinct tags (the chart's right-hand groups)
  server.tool(
    'dwlf_list_symbol_tags',
    'List every distinct symbol TAG. Tags are the groups the markets chart\'s right-hand ' +
      'panel organises symbols into (e.g. crypto, metals, tech, macro); an untagged symbol falls ' +
      'into the catch-all "Others" bucket. Call this FIRST to see the existing group names before ' +
      'adding a symbol to one (reuse a name to drop it in that group).',
    {},
    async () => {
      try {
        const data = await client.get('/tags');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error listing tags: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 2. Get one symbol's tags (which group(s) it's in)
  server.tool(
    'dwlf_get_symbol_tags',
    'Get the tags currently assigned to one symbol — i.e. which chart group(s) it belongs to ' +
      '(empty ⇒ it shows under "Others"). Handy to verify before/after (re)tagging.',
    {
      symbol: z
        .string()
        .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers like AAPL, TSLA'),
    },
    async ({ symbol }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const data = await client.get('/symbol-tags', { symbol: sym });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching tags for ${symbol}: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 3. Add a tag to a symbol
  server.tool(
    'dwlf_add_symbol_tag',
    'Tag a symbol so it lands in the right group on the markets chart\'s right-hand panel instead ' +
      'of "Others". Reuse an existing tag (from dwlf_list_symbol_tags) to add it to that group, or ' +
      'pass a new tag name to create a group. A symbol can carry multiple tags. Example: tag STRC ' +
      'as "crypto", GDX as "metals".',
    {
      symbol: z
        .string()
        .describe('Trading symbol to tag — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers'),
      tag: z.string().describe('The tag / group name, e.g. "crypto", "metals", "tech", "macro"'),
    },
    async ({ symbol, tag }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const data = await client.post('/symbols/tags', { symbol: sym, tag });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error tagging ${symbol} as "${tag}": ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 4. Remove a tag from a symbol
  server.tool(
    'dwlf_remove_symbol_tag',
    'Remove a tag from a symbol — re-categorise it, or (if it has no other tags) drop it back to ' +
      'the "Others" bucket.',
    {
      symbol: z
        .string()
        .describe('Trading symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or stock tickers'),
      tag: z.string().describe('The tag / group name to remove'),
    },
    async ({ symbol, tag }) => {
      try {
        const sym = normalizeSymbol(symbol);
        const data = await client.deleteWithBody('/symbols/tags', { symbol: sym, tag });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error removing tag "${tag}" from ${symbol}: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
