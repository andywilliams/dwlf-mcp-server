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
    'Create a chart annotation. Supported types: hline, text, trendline, rectangle, channel, long_position, short_position. The position types render an entry line, stop and target zones, and a live R:R badge — data shape: {time1, time2, entryPrice, stopPrice, targetPrice, label?}.',
    {
      symbol: z.string().describe('Trading symbol (e.g. BTC, TSLA)'),
      timeframe: z.string().describe('Timeframe (e.g. "daily", "weekly", "hourly")'),
      type: z.enum(['hline', 'text', 'trendline', 'rectangle', 'channel', 'long_position', 'short_position']).describe('Annotation type'),
      data: z.record(z.string(), z.unknown()).describe('Annotation data — varies by type. hline: {price, color, label, lineStyle, lineWidth, showPrice}. long_position/short_position: {time1, time2, entryPrice, stopPrice, targetPrice, label?} where times are unix-ms timestamps.'),
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
    'Delete an annotation by ID. Backend requires the annotation\'s symbol and timeframe alongside the ID.',
    {
      annotationId: z.string().describe('Annotation ID'),
      symbol: z.string().describe('Trading symbol the annotation belongs to (e.g. BTC, TSLA, GDXJ)'),
      timeframe: z.string().describe('Annotation timeframe (e.g. "daily", "weekly", "hourly")'),
    },
    async ({ annotationId, symbol, timeframe }) => {
      try {
        const data = await client.delete(`/annotations/${annotationId}`, {
          symbol: normalizeSymbol(symbol),
          timeframe,
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

  // 5. Bulk create annotations
  server.tool(
    'dwlf_bulk_create_annotations',
    'Create multiple annotations at once. Each annotation follows the same shape as dwlf_create_annotation.',
    {
      annotations: z.array(z.object({
        symbol: z.string().describe('Trading symbol'),
        timeframe: z.string().describe('Timeframe'),
        type: z.enum(['hline', 'text', 'trendline', 'rectangle', 'channel', 'long_position', 'short_position']).describe('Annotation type'),
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
