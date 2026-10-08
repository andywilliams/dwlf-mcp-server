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
      '⚠️ `verification.state: "under-forward-test"`: stages are CONTEXT, not a trading signal, and their predictive ' +
      'claims are being tested forward (DWLF-384). Evidence so far: Stage 1 (base) has underperformed and mature ' +
      'Stage 2 outperformed, both modestly; fresh breakouts into Stage 2 did NOT hold up. Say so rather than ' +
      'presenting a stage as a buy/sell call. Like any trend read it confirms late — most of a move has ' +
      'happened by the time a stage changes.',
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
      try {
        const given = [symbol, symbols, group].filter((v) => v !== undefined).length;
        if (given > 1) {
          throw new Error('pass one of symbol, symbols or group');
        }
        const data = symbol
          ? await client.get(`/stages/${encodeURIComponent(normalizeSymbol(symbol))}`)
          : await client.get('/stages', {
              ...(symbols ? { symbols: symbols.map(normalizeSymbol).join(',') } : {}),
              ...(group ? { group } : {}),
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
