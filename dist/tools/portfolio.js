import { z } from 'zod';
export function registerPortfolioTools(server, client) {
    // 1. List portfolios
    server.tool('dwlf_list_portfolios', "List the user's portfolios.", {}, async () => {
        try {
            const data = await client.get('/portfolios');
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
    // 2. Get portfolio details
    server.tool('dwlf_get_portfolio', 'Get portfolio details including holdings.', {
        portfolioId: z.string().describe('Portfolio ID'),
    }, async ({ portfolioId }) => {
        try {
            const data = await client.get(`/portfolios/${portfolioId}`);
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
    // 3. Get portfolio holdings with details
    server.tool('dwlf_get_holdings', 'Get detailed holdings for a portfolio with current values and P&L.', {
        portfolioId: z.string().describe('Portfolio ID'),
    }, async ({ portfolioId }) => {
        try {
            const data = await client.get(`/portfolios/${portfolioId}/holdings/details`);
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
    // 4. Get portfolio snapshots
    server.tool('dwlf_get_portfolio_snapshots', 'Get historical snapshots for a portfolio — shows value over time.', {
        portfolioId: z.string().describe('Portfolio ID'),
    }, async ({ portfolioId }) => {
        try {
            const data = await client.get(`/portfolios/${portfolioId}/snapshots`);
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
//# sourceMappingURL=portfolio.js.map