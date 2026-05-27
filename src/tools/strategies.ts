import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';
import {
  STRATEGY_NODES,
  getStrategyNodeByType,
  getStrategyNodesByCategory,
  type StrategyNode,
} from '../data/strategyNodeMetadata.js';

export function registerStrategyTools(
  server: McpServer,
  client: DWLFClient
) {
  // 0. Describe visual-strategy node types — local static catalog, no API call.
  //
  // Exists so an agent (or a user) can answer "what does this SL/TP/logic
  // node actually do at runtime?" without reading engine code. Each entry
  // documents the node's params + defaults + whether the executor honours
  // per-instance overrides (most don't yet — flagged via honoredByExecutor).
  server.tool(
    'dwlf_describe_strategy_nodes',
    'Describe the visual-strategy node types and their (currently-implicit) runtime parameters. ' +
      'Use this to understand what an SL/TP/logic node will actually do at backtest/live time, ' +
      'including the engine defaults that are NOT visible in the visual graph today. ' +
      'Optional `nodeType` filters to a single node (e.g. `sl_below_recent_low`); optional `category` ' +
      'filters to a class (`stopLoss` / `takeProfit` / `signal` / `logic` / `cancellation` / `exit`). ' +
      'When `honoredByExecutor: false` on a param, the listed `default` is the only value the engine uses today ' +
      'regardless of what the visual node\'s data field says — this is what the SL-resolver bug in PR#220 exposed.',
    {
      nodeType: z
        .string()
        .optional()
        .describe('Return only this one node (e.g. `sl_below_recent_low`).'),
      category: z
        .enum(['signal', 'stopLoss', 'takeProfit', 'logic', 'cancellation', 'exit'])
        .optional()
        .describe('Return only nodes in this category.'),
    },
    async ({ nodeType, category }) => {
      try {
        let nodes: StrategyNode[];
        if (nodeType) {
          const single = getStrategyNodeByType(nodeType);
          if (!single) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                error: `Unknown nodeType: ${nodeType}`,
                hint: 'Call without args to see the full catalog of supported node types.',
              }, null, 2) }],
              isError: true,
            };
          }
          nodes = [single];
        } else if (category) {
          nodes = getStrategyNodesByCategory(category);
        } else {
          nodes = STRATEGY_NODES;
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({
            count: nodes.length,
            nodes,
          }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

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
    '⚠️ Create a new strategy. CRITICAL WORKFLOW: 1) Create strategy → 2) Compile → 3) MUST call dwlf_activate_strategy_symbols (or strategy will NEVER generate signals!) → 4) Run backtest. Without step 3, backtests return 0 trades. The strategy exists but is invisible to the evaluation engine until symbols are activated. Always activate symbols immediately after creation.',
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

  // 6. Delete strategy
  server.tool(
    'dwlf_delete_strategy',
    "Permanently delete a visual strategy. Hard delete — also removes the compiled executable and symbol activations. " +
      "⚠️ Past UserTradeSignal rows that referenced this strategy are NOT scrubbed (they remain as historical record), " +
      "but they will be filtered out of the chart's strategy dropdown going forward because the chart filters by " +
      "current live strategies. If you have an active subscription on this strategy, the subscription will keep " +
      "consuming events but the dispatcher's strategy lookup will fail — disable the subscription first via " +
      "`dwlf_update_subscription({ enabled: false })` or delete it via `dwlf_delete_subscription` to keep state clean.",
    {
      strategyId: z.string().describe('Strategy ID to delete'),
    },
    async ({ strategyId }) => {
      try {
        const data = await client.delete(`/visual-strategies/${strategyId}`);
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

  // 7. List public strategies
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
