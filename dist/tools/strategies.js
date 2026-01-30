import { z } from 'zod';
export function registerStrategyTools(server, client) {
    // 1. List strategies
    server.tool('dwlf_list_strategies', "List the user's visual trading strategies with names, descriptions, and associated symbols.", {}, async () => {
        try {
            const data = await client.get('/visual-strategies');
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
    // 2. Get strategy details
    server.tool('dwlf_get_strategy', 'Get full details of a specific strategy including signal definitions, nodes, and edges.', {
        strategyId: z.string().describe('Strategy ID'),
    }, async ({ strategyId }) => {
        try {
            const data = await client.get(`/visual-strategies/${strategyId}`);
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
    // 3. Create strategy
    server.tool('dwlf_create_strategy', 'Create a new visual trading strategy. Provide name, description, and signal definitions.', {
        name: z.string().describe('Strategy name'),
        description: z.string().optional().describe('Strategy description'),
        bodyJson: z.string().optional().describe('Full strategy body as JSON string (nodes, edges, signals). Parse before sending.'),
    }, async ({ name, description, bodyJson }) => {
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
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });
    // 4. List public strategies
    server.tool('dwlf_list_public_strategies', 'List community-shared public strategies that can be used as inspiration or cloned.', {}, async () => {
        try {
            const data = await client.get('/visual-strategies/public');
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
//# sourceMappingURL=strategies.js.map