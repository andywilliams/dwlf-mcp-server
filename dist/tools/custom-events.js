import { z } from 'zod';
export function registerCustomEventTools(server, client) {
    // 1. List custom events
    server.tool('dwlf_list_custom_events', "List the user's custom event definitions — user-created indicator-based events.", {}, async () => {
        try {
            const data = await client.get('/custom-events');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
    // 2. Get custom event details
    server.tool('dwlf_get_custom_event', 'Get details of a specific custom event including conditions and trigger history.', {
        eventId: z.string().describe('Custom event ID'),
    }, async ({ eventId }) => {
        try {
            const data = await client.get(`/custom-events/${eventId}`);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
    // 3. Create custom event
    server.tool('dwlf_create_custom_event', 'Create a new custom event definition. Custom events fire when indicator conditions are met.', {
        name: z.string().describe('Event name'),
        bodyJson: z.string().describe('Full event definition body as JSON string (conditions, parameters). Parse before sending.'),
    }, async ({ name, bodyJson }) => {
        try {
            const extra = JSON.parse(bodyJson);
            const data = await client.post('/custom-events', { name, ...extra });
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=custom-events.js.map