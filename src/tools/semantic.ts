import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';
import { normalizeSymbol } from '../client.js';

export function registerSemanticTools(server: McpServer, client: DWLFClient) {
  // 1. Get market regime classification
  server.tool(
    'dwlf_get_regime',
    'Get current market regime classification for a symbol — trend, cycle, momentum, volatility, and confidence score. Optionally retrieve full regime history.',
    {
      symbol: z.string().describe('Symbol to query (e.g. BTC, ETH, AAPL)'),
      history: z
        .boolean()
        .optional()
        .describe('If true, return full regime history instead of just current'),
    },
    async ({ symbol, history }) => {
      try {
        const normalized = normalizeSymbol(symbol);
        const params = history ? { history: true } : {};
        const data = await client.get(`/regime/${normalized}`, params);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching regime for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 2. Get full semantic snapshot (intelligence)
  server.tool(
    'dwlf_get_intelligence',
    'Get the full semantic snapshot for a symbol — current price, active events, FSM state, market regime, support/resistance levels, and signal quality. This is the preferred single-call way to get structured market context for a symbol.',
    {
      symbol: z.string().describe('Symbol to query (e.g. BTC, ETH, AAPL)'),
    },
    async ({ symbol }) => {
      try {
        const normalized = normalizeSymbol(symbol);
        const data = await client.get(`/intelligence/${normalized}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching intelligence for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 3. Get daily cross-asset briefing
  server.tool(
    'dwlf_get_daily_briefing',
    'Get the cross-asset daily briefing across your full watchlist. Returns per-symbol price, regime, key levels, active events, and recent state transitions. Also includes sector sentiment analysis. Note: this endpoint can be slow as it computes data serially per symbol.',
    {},
    async () => {
      try {
        const data = await client.get('/briefing/daily');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching daily briefing: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 4. Register agent account (public endpoint, no auth needed)
  server.tool(
    'dwlf_register_agent',
    'Programmatically register a new DWLF account — no browser or Google OAuth required. Returns an API key immediately. Email verification unlocks compute features (backtests, evaluations). Useful for onboarding flows where an agent registers itself.',
    {
      email: z.string().email().describe('Email address for the new account'),
      agentId: z
        .string()
        .optional()
        .describe('Optional agent identifier to associate with this account'),
      purpose: z
        .string()
        .optional()
        .describe('Optional description of what this account will be used for'),
    },
    async ({ email, agentId, purpose }) => {
      try {
        const body: Record<string, string> = { email };
        if (agentId) body.agentId = agentId;
        if (purpose) body.purpose = purpose;
        const data = await client.post('/agent/register', body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error registering agent: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
