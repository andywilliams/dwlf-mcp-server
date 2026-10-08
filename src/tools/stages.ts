import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * Weinstein weekly stages (DWLF-382). Backed by GET /v2/stages and /v2/stages/{symbol}.
 * Pass-through: the backend applies the library's one read rule, and so does this tool.
 */
export function registerStageTools(server: McpServer, client: DWLFClient) {
  server.tool(
    'dwlf_get_stage',
    'What stage of its market cycle is this symbol (or sector) in, on the WEEKLY chart? Returns the Weinstein ' +
      'stage — 1 base, 2 advance, 3 top, 4 decline — derived from the 30-week average, with `weeksInStage`, ' +
      '`since` (when the stage became knowable) and the recent transitions. Use it for "is X basing or ' +
      'advancing?", "how long has X been in Stage 2?" and, with `group` or several `symbols`, for sector breadth ' +
      '("what share of metals are in Stage 2?"). This is the platform\'s market-cycle stage read: prefer it ' +
      'over `regime.cycle` (accumulation/markup/…) from dwlf_get_regime when describing where an asset is in ' +
      'its cycle.\n\n' +
      'SHAPE (one symbol): `{ symbol, stage, stageName, weeksInStage, since, rulesVersion, verification, ' +
      'history: [{ to, from, baseline, knowableFrom, close }] }`. `stage: null` with `reason: "no-stage"` = too ' +
      'little weekly history. SHAPE (many): `{ verification, stages: { SYM: … }, unavailable: [{ symbol, reason }], ' +
      'breadth: { counted, withoutStage, share: { base, advance, top, decline } } }` — shares are over symbols ' +
      'WITH a stage.\n\n' +
      'With no arguments, returns every staged symbol plus universe breadth (a large response).\n\n' +
      '⚠️ Stages are CONTEXT, not a trading signal: report the response\'s `verification` (state + reason) with ' +
      'the stage rather than presenting it as a buy/sell call. Like any trend read a stage confirms late — much ' +
      'of a move has happened by the time a stage changes.',
    {
      symbol: z
        .string()
        .min(1)
        .optional()
        .describe('One symbol — accepts BTC, BTC/USD, BTC-USD, BTCUSD, or tickers like PHAU, SPY'),
      symbols: z
        .array(z.string().min(1))
        .min(1)
        .max(150)
        .optional()
        .describe('Several symbols: returns each stage plus breadth over them'),
      group: z
        .string()
        .min(1)
        .optional()
        .describe('A named group, e.g. metals, gold_miners, mag7, crypto_spot, btc_mining — stages plus breadth'),
    },
    async ({ symbol, symbols, group }) => {
      // A blank selector is a mistake (an unfilled value), never a request for the whole universe.
      const one = symbol?.trim();
      const many = symbols?.map((s) => s.trim());
      const named = group?.trim();
      const blank = one === '' || named === '' || (many !== undefined && (!many.length || many.some((s) => !s)));
      const given = [one, many, named].filter((v) => v !== undefined).length;
      if (blank) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Usage: a selector was blank. Give a symbol (e.g. SPY), symbols (e.g. ["SPY","QQQ"]) or a group (e.g. metals).' }],
        };
      }
      if (given > 1) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Usage: pass ONE of symbol, symbols or group (or none, for every staged symbol).' }],
        };
      }
      try {
        const data = one
          ? await client.get(`/stages/${encodeURIComponent(normalizeSymbol(one))}`)
          : await client.get('/stages', {
              ...(many ? { symbols: many.map(normalizeSymbol).join(',') } : {}),
              ...(named ? { group: named } : {}),
            });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error fetching Weinstein stage: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
