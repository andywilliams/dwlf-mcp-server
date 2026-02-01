import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerAnnotationTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. List annotations
  server.tool(
    'dwlf_list_annotations',
    'List annotations for a symbol. Optionally filter by timeframe (e.g. daily, weekly, hourly).',
    {
      symbol: z.string().describe('Trading symbol (e.g. BTC, TSLA)'),
      timeframe: z.string().optional().describe('Timeframe filter (e.g. "daily", "weekly", "hourly")'),
    },
    async ({ symbol, timeframe }) => {
      try {
        const params: Record<string, unknown> = {
          symbol: normalizeSymbol(symbol),
        };
        if (timeframe) params.timeframe = timeframe;

        const data = await client.get('/annotations', params);
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

  // 2. Create annotation
  server.tool(
    'dwlf_create_annotation',
    'Create a chart annotation (horizontal line, text, trendline, rectangle, or channel) for a symbol.',
    {
      symbol: z.string().describe('Trading symbol (e.g. BTC, TSLA)'),
      timeframe: z.string().describe('Timeframe (e.g. "daily", "weekly", "hourly")'),
      type: z.enum(['hline', 'text', 'trendline', 'rectangle', 'channel']).describe('Annotation type'),
      data: z.record(z.string(), z.unknown()).describe('Annotation data — varies by type (e.g. {price, color, label, lineStyle, lineWidth, showPrice} for hline)'),
      origin: z.string().optional().describe('Origin of the annotation (default: "user")'),
    },
    async ({ symbol, timeframe, type, data, origin }) => {
      try {
        const body: Record<string, unknown> = {
          symbol: normalizeSymbol(symbol),
          timeframe,
          type,
          data,
        };
        if (origin) body.origin = origin;

        const result = await client.post('/annotations', body);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 3. Update annotation
  server.tool(
    'dwlf_update_annotation',
    'Update an existing annotation by ID. Merge partial data into the annotation.',
    {
      annotationId: z.string().describe('Annotation ID'),
      data: z.record(z.string(), z.unknown()).optional().describe('Partial annotation data to merge'),
    },
    async ({ annotationId, data }) => {
      try {
        const body: Record<string, unknown> = {};
        if (data) body.data = data;

        const result = await client.put(`/annotations/${annotationId}`, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 4. Delete annotation
  server.tool(
    'dwlf_delete_annotation',
    'Delete an annotation by ID.',
    {
      annotationId: z.string().describe('Annotation ID'),
    },
    async ({ annotationId }) => {
      try {
        const data = await client.delete(`/annotations/${annotationId}`);
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

  // 5. Bulk create annotations
  server.tool(
    'dwlf_bulk_create_annotations',
    'Create multiple annotations at once. Each annotation follows the same shape as dwlf_create_annotation.',
    {
      annotations: z.array(z.object({
        symbol: z.string().describe('Trading symbol'),
        timeframe: z.string().describe('Timeframe'),
        type: z.enum(['hline', 'text', 'trendline', 'rectangle', 'channel']).describe('Annotation type'),
        data: z.record(z.string(), z.unknown()).describe('Annotation data'),
        origin: z.string().optional().describe('Origin of the annotation'),
      })).describe('Array of annotation objects to create'),
    },
    async ({ annotations }) => {
      try {
        const normalized = annotations.map((a) => ({
          ...a,
          symbol: normalizeSymbol(a.symbol),
        }));

        const result = await client.post('/annotations/bulk', { annotations: normalized } as unknown as Record<string, unknown>);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
