import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerStrategyTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. List strategies
  server.tool(
    'dwlf_list_strategies',
    "List the user's visual trading strategies with names, descriptions, and associated symbols.",
    {},
    async () => {
      try {
        const data = await client.get('/visual-strategies');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 2. Get strategy details
  server.tool(
    'dwlf_get_strategy',
    'Get full details of a specific strategy including signal definitions, nodes, and edges.',
    {
      strategyId: z.string().describe('Strategy ID'),
    },
    async ({ strategyId }) => {
      try {
        const data = await client.get(`/visual-strategies/${strategyId}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 3. Create strategy
  server.tool(
    'dwlf_create_strategy',
    'Create a new visual trading strategy. Provide name, description, and signal definitions. ⚠️ IMPORTANT: After creation, the strategy will NOT generate signals until you activate it for specific symbols using dwlf_activate_strategy_symbols. Always ask the user which symbols to activate for, then call that tool.',
    {
      name: z.string().describe('Strategy name'),
      description: z.string().optional().describe('Strategy description'),
      bodyJson: z.string().optional().describe('Full strategy body as JSON string (nodes, edges, signals). Parse before sending.'),
    },
    async ({ name, description, bodyJson }) => {
      try {
        const extra = bodyJson ? JSON.parse(bodyJson) : {};
        const data = await client.post('/visual-strategies', {
          name,
          description,
          ...extra,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 4. Update strategy
  server.tool(
    'dwlf_update_strategy',
    'Update an existing visual trading strategy. Provide the strategy ID and updated fields.',
    {
      strategyId: z.string().describe('Strategy ID to update'),
      name: z.string().optional().describe('Updated strategy name'),
      description: z.string().optional().describe('Updated description'),
      bodyJson: z.string().optional().describe('Updated strategy body as JSON string (nodes, edges, metadata). Parse before sending.'),
    },
    async ({ strategyId, name, description, bodyJson }) => {
      try {
        const extra = bodyJson ? JSON.parse(bodyJson) : {};
        const body: Record<string, unknown> = { ...extra };
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;

        const data = await client.put(`/visual-strategies/${strategyId}`, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 5. Compile strategy
  server.tool(
    'dwlf_compile_strategy',
    'Compile a visual strategy into an executable trade signal. Must be called after creating or updating a strategy before it can be evaluated or generate signals.',
    {
      strategyId: z.string().describe('Strategy ID to compile'),
    },
    async ({ strategyId }) => {
      try {
        const data = await client.post(`/visual-strategies/${strategyId}/compile`, {});
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 6. List public strategies
  server.tool(
    'dwlf_list_public_strategies',
    'List community-shared public strategies that can be used as inspiration or cloned.',
    {},
    async () => {
      try {
        const data = await client.get('/visual-strategies/public');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
