import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerSymbolActivationTools(
  server: McpServer,
  client: DWLFClient
) {
  // ─── Custom Event Symbol Activation ───────────────────────────────

  // 1. Activate symbols for a custom event (bulk enable)
  server.tool(
    'dwlf_activate_event_symbols',
    'Activate (enable) one or more symbols for a custom event. The event will only fire for symbols that are activated. ⚠️ This MUST be called after creating a custom event — events do NOT fire until symbols are activated.',
    {
      eventId: z.string().describe('Custom event ID'),
      symbols: z
        .array(z.string())
        .describe(
          'Array of symbols to activate (e.g. ["BTC-USD", "ETH-USD", "NVDA"])'
        ),
    },
    async ({ eventId, symbols }) => {
      try {
        const normalized = symbols.map(normalizeSymbol);
        const data = await client.post(
          `/custom-event-symbols/${eventId}/enable-all`,
          { symbols: normalized } as unknown as Record<string, unknown>
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 2. Get active symbols for a custom event
  server.tool(
    'dwlf_get_event_symbols',
    'Get the list of symbols currently activated for a custom event.',
    {
      eventId: z.string().describe('Custom event ID'),
    },
    async ({ eventId }) => {
      try {
        const data = await client.get(
          `/custom-event-symbols/event/${eventId}`
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 3. Deactivate symbols for a custom event (bulk disable)
  server.tool(
    'dwlf_deactivate_event_symbols',
    'Deactivate (disable) one or more symbols for a custom event. The event will stop firing for these symbols.',
    {
      eventId: z.string().describe('Custom event ID'),
      symbols: z
        .array(z.string())
        .describe('Array of symbols to deactivate'),
    },
    async ({ eventId, symbols }) => {
      try {
        const normalized = symbols.map(normalizeSymbol);
        const data = await client.post(
          `/custom-event-symbols/${eventId}/disable-all`,
          { symbols: normalized } as unknown as Record<string, unknown>
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── Strategy Symbol Activation ───────────────────────────────────

  // 4. Activate symbols for a strategy (bulk enable)
  server.tool(
    'dwlf_activate_strategy_symbols',
    'Activate (enable) one or more symbols for a strategy. The strategy will only generate signals for symbols that are activated. ⚠️ This MUST be called after creating a strategy — strategies do NOT generate signals until symbols are activated.',
    {
      strategyId: z.string().describe('Strategy ID'),
      symbols: z
        .array(z.string())
        .describe(
          'Array of symbols to activate (e.g. ["BTC-USD", "ETH-USD", "NVDA"])'
        ),
    },
    async ({ strategyId, symbols }) => {
      try {
        const normalized = symbols.map(normalizeSymbol);
        const data = await client.post(
          `/strategy-symbols/${strategyId}/enable-all`,
          { symbols: normalized } as unknown as Record<string, unknown>
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 5. Get active symbols for a strategy
  server.tool(
    'dwlf_get_strategy_symbols',
    'Get the list of symbols currently activated for a strategy.',
    {
      strategyId: z.string().describe('Strategy ID'),
    },
    async ({ strategyId }) => {
      try {
        const data = await client.get(
          `/strategy-symbols/strategy/${strategyId}`
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 6. Deactivate symbols for a strategy (bulk disable)
  server.tool(
    'dwlf_deactivate_strategy_symbols',
    'Deactivate (disable) one or more symbols for a strategy. The strategy will stop generating signals for these symbols.',
    {
      strategyId: z.string().describe('Strategy ID'),
      symbols: z
        .array(z.string())
        .describe('Array of symbols to deactivate'),
    },
    async ({ strategyId, symbols }) => {
      try {
        const normalized = symbols.map(normalizeSymbol);
        const data = await client.post(
          `/strategy-symbols/${strategyId}/disable-all`,
          { symbols: normalized } as unknown as Record<string, unknown>
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── List all symbol activations ──────────────────────────────────

  // 7. List all user's event AND strategy symbol associations
  server.tool(
    'dwlf_list_all_symbol_activations',
    "List all the user's symbol activations across both custom events and strategies. Shows which symbols are active for which events/strategies.",
    {
      activeOnly: z
        .boolean()
        .optional()
        .describe('If true, only return active associations (default: true)'),
    },
    async ({ activeOnly }) => {
      try {
        const onlyActive = activeOnly !== false;
        const [eventSymbols, strategySymbols] = await Promise.all([
          client.get('/custom-event-symbols', {
            activeOnly: onlyActive,
          }),
          client.get('/strategy-symbols', { activeOnly: onlyActive }),
        ]);
        const result = {
          eventSymbols,
          strategySymbols,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
