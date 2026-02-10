import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient } from '../client.js';

export function registerCustomEventTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. List custom events
  server.tool(
    'dwlf_list_custom_events',
    "List the user's custom event definitions — user-created indicator-based events.",
    {},
    async () => {
      try {
        const data = await client.get('/custom-events');
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

  // 2. Get custom event notifications (recent fires)
  server.tool(
    'dwlf_get_custom_event_notifications',
    'Get all recently fired custom events where the user has notifications enabled. Returns fires across ALL symbols in one call — the most efficient way to check what custom events have triggered. The eventName field contains the human-readable name (e.g. "wcl_confirmed"). The eventType field is always "custom_event" — use eventName to distinguish events.',
    {
      days: z.number().optional().default(7).describe('How many days back to look (default 7)'),
    },
    async ({ days }) => {
      try {
        const data = await client.get(`/custom-events/notifications?days=${days}`);
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

  // 3. Get custom event details
  server.tool(
    'dwlf_get_custom_event',
    'Get details of a specific custom event including conditions and trigger history.',
    {
      eventId: z.string().describe('Custom event ID'),
    },
    async ({ eventId }) => {
      try {
        const data = await client.get(`/custom-events/${eventId}`);
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

  // 3. Compile custom event
  server.tool(
    'dwlf_compile_custom_event',
    'Compile a custom event into an executable event definition. Must be called after creating or updating a custom event.',
    {
      eventId: z.string().describe('Custom event ID to compile'),
    },
    async ({ eventId }) => {
      try {
        const data = await client.post(`/custom-events/${eventId}/compile`, {});
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

  // 4. Create custom event
  server.tool(
    'dwlf_create_custom_event',
    'Create a new custom event definition. Custom events fire when indicator conditions are met. ⚠️ IMPORTANT: After creation, the event will NOT fire until you activate it for specific symbols using dwlf_activate_event_symbols. Always ask the user which symbols to activate for, then call that tool.',
    {
      name: z.string().describe('Event name'),
      bodyJson: z.string().describe('Full event definition body as JSON string (conditions, parameters). Parse before sending.'),
    },
    async ({ name, bodyJson }) => {
      try {
        const extra = JSON.parse(bodyJson);
        const data = await client.post('/custom-events', { name, ...extra });
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
