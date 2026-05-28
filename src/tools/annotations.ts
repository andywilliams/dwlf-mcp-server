import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

/**
 * Annotation types the backend accepts. MUST stay in sync with VALID_TYPES in
 * serverless-portfolio-tracker/src/db/annotationsService.js — the backend 400s
 * on anything outside that list. Keep this the single source of truth on the
 * MCP side and reference it from every tool that takes a `type`.
 */
const ANNOTATION_TYPES = [
  'hline', 'text', 'vline', 'ray', 'trendline', 'channel', 'rectangle',
  'fib_retracement', 'fib_extension', 'pitchfork', 'measure',
  'arrow', 'brush', 'icon', 'note', 'price_alert',
  'crossline', 'timerange', 'emoji', 'fibRetracement', 'alert_line',
  'long_position', 'short_position',
] as const;

const ANNOTATION_ORIGINS = ['user', 'ai', 'system'] as const;

/**
 * Per-type `data` field reference, appended to the create/bulk tool docs so an
 * agent can build a valid annotation in one shot instead of reverse-engineering
 * shapes from list_annotations. All `time*` fields are unix-ms timestamps; all
 * `price*` fields are chart prices. `color` is a hex string (e.g. "#22c55e"),
 * `lineStyle` is one of "solid"|"dashed"|"dotted", `lineWidth` is a number.
 * visible / locked / zIndex / groupId are TOP-LEVEL fields (not inside `data`).
 */
const DATA_SHAPES = [
  'DATA SHAPES BY TYPE (times = unix-ms, prices = chart price):',
  '• hline — {price, color, lineStyle, lineWidth, showPrice, label?}: horizontal price level.',
  '• vline — {time, color, lineStyle, lineWidth, showTime, label?}: vertical time marker.',
  '• text — {time, price, text, fontSize, color, backgroundColor?}: free text box anchored at a point. Use \\n inside `text` for multi-line — long single-line text renders too wide to read, so break it up.',
  '• arrow — {time1, price1, time2, price2, text, fontSize, color, lineStyle, lineWidth}: callout/speech-bubble. The text box sits at (time1,price1); the arrowhead points to (time2,price2). Use this to label a level or zone with a pointer.',
  '• trendline — {time1, price1, time2, price2, color, lineStyle, lineWidth, label?, extendLeft?, extendRight?}: line through two points.',
  '• ray — {time1, price1, time2, price2, color, lineStyle, lineWidth, label?}: half-line from point 1 through point 2.',
  '• rectangle — {time1, price1, time2, price2, color, fillOpacity, lineStyle, lineWidth, label?}: shaded zone between two opposite corners.',
  '• channel — {time1, price1, time2, price2, priceOffset, color, lineStyle, lineWidth, fillOpacity, label?, extendLeft?, extendRight?}: parallel channel; the second rail runs priceOffset above (+) / below (−) the base line.',
  '• crossline — {time, price, color, lineStyle, lineWidth, showPrice, showTime, label?}: crosshair marker at one point.',
  '• emoji — {time, price, emoji, size}: emoji marker (e.g. emoji "🦊").',
  '• timerange — {time1, time2, color, fillOpacity, lineStyle, lineWidth, label?}: vertical time band.',
  '• fibRetracement / measure — {time1, price1, time2, price2, levels:number[], showExtensions, extendRight, color, lineStyle, lineWidth, fillOpacity, label?}: fib/measure between two swing points.',
  '• fib_extension — {time1, price1, time2, price2, color, lineStyle, lineWidth, label?}: extension projection.',
  '• alert_line — {price, color, lineStyle, lineWidth, showPrice, direction:"above"|"below", label?}: price-alert line.',
  '• long_position / short_position — {time1, time2, entryPrice, stopPrice, targetPrice, label?}: renders an entry line, stop+target zones and a live R:R badge.',
  'ALIASES (same storage — prefer the first of each pair): text over note; emoji over icon; alert_line over price_alert; fibRetracement over fib_retracement.',
  'TIP: copy an existing shape via dwlf_list_annotations if unsure.',
].join('\n');

export function registerAnnotationTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. List annotations
  server.tool(
    'dwlf_list_annotations',
    'List annotations for a symbol. Optionally filter by timeframe (e.g. daily, weekly, hourly). Returns each annotation with its annotationId, type, timeframe and full data — copy a data shape from here when you are unsure how to build a new one.',
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
    'Create a chart annotation. `type` selects the shape; `data` carries the type-specific fields documented below. Note `arrow` is the callout/bubble-with-pointer and `text` is a plain text box — for commentary that points at a level, use `arrow`.\n\n' + DATA_SHAPES,
    {
      symbol: z.string().describe('Trading symbol (e.g. BTC, TSLA)'),
      timeframe: z.string().describe('Timeframe (e.g. "daily", "weekly", "hourly")'),
      type: z.enum(ANNOTATION_TYPES).describe('Annotation type — see the data-shape reference in the tool description for the fields each one needs.'),
      data: z.record(z.string(), z.unknown()).describe('Type-specific fields. See DATA SHAPES BY TYPE in the tool description. Max 4KB serialized.'),
      origin: z.enum(ANNOTATION_ORIGINS).optional().describe('Who created it: "user" (default), "ai" (agent-generated — use this for your own annotations), or "system".'),
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
    'Update an existing annotation. symbol + timeframe are REQUIRED (the backend needs them to locate the row). `data` is merged field-by-field into the existing data — pass only the fields you want to change (e.g. {label: "..."} or {price: 56}); sibling fields are preserved. visible/locked/zIndex/groupId can also be patched.',
    {
      annotationId: z.string().describe('Annotation ID (e.g. ann_d604ba96a697)'),
      symbol: z.string().describe('Trading symbol the annotation belongs to — required to address the row'),
      timeframe: z.string().describe('Annotation timeframe (e.g. "daily", "weekly", "hourly") — required to address the row'),
      data: z.record(z.string(), z.unknown()).optional().describe('Partial data fields to merge (not a full replacement). E.g. {label: "Reclaim ~56"} or {color: "#ef4444"}.'),
      visible: z.boolean().optional().describe('Show/hide the annotation'),
      locked: z.boolean().optional().describe('Lock the annotation against edits'),
      zIndex: z.number().optional().describe('Stacking order'),
      groupId: z.string().nullable().optional().describe('Annotation group/workspace id'),
    },
    async ({ annotationId, symbol, timeframe, data, visible, locked, zIndex, groupId }) => {
      try {
        // Backend reads symbol+timeframe off the body to build the sort key,
        // then treats every other top-level field as the patch.
        const body: Record<string, unknown> = {
          symbol: normalizeSymbol(symbol),
          timeframe,
        };
        if (data !== undefined) body.data = data;
        if (visible !== undefined) body.visible = visible;
        if (locked !== undefined) body.locked = locked;
        if (zIndex !== undefined) body.zIndex = zIndex;
        if (groupId !== undefined) body.groupId = groupId;

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
    'Delete an annotation by ID. symbol + timeframe are required (the backend needs them to locate the row).',
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
    'Create multiple annotations in one call (max 25). Each entry follows the same shape as dwlf_create_annotation — see its data-shape reference. Returns a per-item results array; an individual item can fail without aborting the rest.',
    {
      annotations: z.array(z.object({
        symbol: z.string().describe('Trading symbol'),
        timeframe: z.string().describe('Timeframe'),
        type: z.enum(ANNOTATION_TYPES).describe('Annotation type'),
        data: z.record(z.string(), z.unknown()).describe('Type-specific fields — see dwlf_create_annotation'),
        origin: z.enum(ANNOTATION_ORIGINS).optional().describe('Origin (default "user")'),
      })).min(1).max(25).describe('Annotations to create (1-25)'),
    },
    async ({ annotations }) => {
      try {
        // Backend /annotations/bulk takes { operations: [{action, ...}] }, not a
        // bare annotations array. Wrap each as a create operation.
        const operations = annotations.map((a) => ({
          action: 'create',
          annotation: {
            symbol: normalizeSymbol(a.symbol),
            timeframe: a.timeframe,
            type: a.type,
            data: a.data,
            ...(a.origin ? { origin: a.origin } : {}),
          },
        }));

        const result = await client.post('/annotations/bulk', { operations } as unknown as Record<string, unknown>);
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
