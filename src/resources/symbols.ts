import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DWLFClient } from '../client.js';

export function registerSymbolsResource(
  server: McpServer,
  client: DWLFClient
) {
  server.resource(
    'symbols',
    'dwlf://symbols',
    async (uri) => {
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
    }
  );
}
