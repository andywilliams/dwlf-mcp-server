export function registerSymbolsResource(server, client) {
    server.resource('symbols', 'dwlf://symbols', async (uri) => {
        const symbols = await client.get('/market-data/symbols');
        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify(symbols, null, 2),
                },
            ],
        };
    });
}
//# sourceMappingURL=symbols.js.map