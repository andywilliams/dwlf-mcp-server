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
    "List the account's custom events: conditions the user defined (indicator and event condition nodes joined by and/or/not/then gates), each with its id and name. An event's definition is dwlf_get_custom_event; its fires are dwlf_get_events with type `custom_event` and its `customEventId` (pass a wide `days`); the symbols it runs on, and whether it is really running, are dwlf_get_event_symbols.",
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
    'Get one custom event: its name, its condition graph (`visual`: nodes and edges), its settings and its compiled status. Its fires are not here: read them with dwlf_get_events (type `custom_event`, `customEventId` = this id, a wide `days`). Which symbols it runs on, and its last-night health, are dwlf_get_event_symbols.',
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
    'Recompile a LEGACY custom event. Saving already compiles: dwlf_create_custom_event, and every dwlf_update_custom_event that changes the definition, compile in the same request and refuse (400) a graph that will not compile, so this is needed only when activating symbols answers 422 `EVENT_NOT_COMPILED` (an older event never compiled, or one whose saved definition is not what would run). A 409 means the event changed while it compiled: reload it and retry.',
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

  // 4. Preflight validate custom event
  server.tool(
    'dwlf_preflight_custom_event',
    'Validate a custom event graph WITHOUT saving it. Returns execution tier (fast/async/reject), complexity score with breakdown, graph metrics, plan policy limits, errors, warnings, and suggested fixes. Call this BEFORE creating or updating a complex event to check whether it will be accepted and which execution tier it will land in.',
    {
      bodyJson: z.string().describe('Full event body as JSON string with name, visual (nodes + edges), and optionally description, metadata, version'),
    },
    async ({ bodyJson }) => {
      try {
        const body = JSON.parse(bodyJson);
        const data = await client.post('/custom-events/preflight', body);
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

  // 5. Create custom event
  server.tool(
    'dwlf_create_custom_event',
    '⚠️ Create a new custom event. CRITICAL WORKFLOW: 1) Create event (saving compiles it; a graph that will not compile is refused with 400) → 2) MUST call dwlf_activate_event_symbols (or event will NEVER fire!) → 3) Trigger evaluation. Without step 2, backtests return 0 trades. The event exists but is invisible to the evaluation engine until symbols are activated. Always activate symbols immediately after creation.',
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

  // 6. Update custom event — partial update (PUT). Accepts any subset
  // of {name, description, visual, metadata, version, notifyOnFire}.
  // The most useful application is flipping notifyOnFire to true after
  // creation so future fires appear in dwlf_get_custom_event_notifications.
  // Saving compiles (SPT): a definition change compiles in the same request.
  server.tool(
    'dwlf_update_custom_event',
    'Update an existing custom event. Accepts any subset of {name, description, visual, metadata, version, notifyOnFire} via bodyJson. Most common use: flip notifyOnFire to true after creation so future fires surface in dwlf_get_custom_event_notifications. A change to `visual` or a condition compiles in the same request (a graph that will not compile is refused with 400): no separate compile call is needed.',
    {
      eventId: z.string().describe('Custom event ID to update'),
      bodyJson: z.string().describe('Partial update body as JSON string. Any subset of name, description, visual, metadata, version, notifyOnFire.'),
    },
    async ({ eventId, bodyJson }) => {
      try {
        const body = JSON.parse(bodyJson);
        const data = await client.put(`/custom-events/${eventId}`, body);
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

  // 7. Delete custom event. Hard delete — also removes the compiled
  // executable, symbol activations, and watermark state.
  server.tool(
    'dwlf_delete_custom_event',
    'Delete a custom event permanently. Hard delete — also removes the compiled executable, symbol activations, and watermark state. Past fires already written to EventsTable are NOT deleted (they remain as historical record).',
    {
      eventId: z.string().describe('Custom event ID to delete'),
    },
    async ({ eventId }) => {
      try {
        const data = await client.delete(`/custom-events/${eventId}`);
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
