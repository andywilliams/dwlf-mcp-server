import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DWLFClient } from '../client.js';

export function registerAccountTools(
  server: McpServer,
  client: DWLFClient
) {
  server.tool(
    'dwlf_get_quotas',
    'Get the current user\'s plan tier, resource usage (custom events, strategies, FSMs, on-demand evals), limits, and custom event policy limits including fast/async path constraints (max nodes, max OR fanout, max nesting depth, etc.). Use this to understand what the user\'s plan allows before building complex events.',
    {},
    async () => {
      try {
        const data = await client.get('/quotas/my');
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
