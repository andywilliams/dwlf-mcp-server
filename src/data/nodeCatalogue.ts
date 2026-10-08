// DWLF-370: the condition nodes come from the API's one node catalogue,
// GET /v2/node-types (SPT), instead of a hand list here. This module loads that
// body (cached, as the Academy manifest is), turns it into this tool's
// StrategyNode shape — deliberately reshaped so it merges with the structural
// nodes still described locally (strategyNodeMetadata.ts), keeping the
// catalogue's own category as `catalogueCategory` — and builds the tool's answer.
import type { NodeParam, StrategyNode } from './strategyNodeMetadata.js';

type CatalogueParam = { name?: unknown; type?: unknown; enum?: unknown; default?: unknown; description?: unknown };
type CatalogueNode = {
  id?: unknown; label?: unknown; category?: unknown; description?: unknown; direction?: unknown;
  parameters?: unknown; timeframes?: unknown;
};
type UnsupportedRule = { id?: unknown; prefix?: unknown; reason?: unknown };

export type CatalogueStrategyNode = StrategyNode & {
  label?: string;
  direction?: string;
  timeframes?: string[];
  catalogueCategory?: string;
  engineIgnored?: string;
  source: 'catalogue';
};

export type LoadedCatalogue = {
  nodes: CatalogueStrategyNode[];
  unsupported: UnsupportedRule[];
  error?: string;
};

// Structural categories this tool already describes locally.
const LOCAL_CATEGORIES = new Set(['logic', 'output']);
const TTL_MS = 15 * 60 * 1000;

const asString = (v: unknown) => (typeof v === 'string' ? v : undefined);

const toParam = (p: CatalogueParam): NodeParam | null => {
  const name = asString(p?.name);
  if (!name) {return null;}
  const values = Array.isArray(p.enum)
    ? p.enum.filter((v): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v))
    : [];
  const isEnum = values.length > 0;
  return {
    name,
    type: isEnum ? 'enum' : (['number', 'string', 'boolean'].includes(String(p.type)) ? p.type as NodeParam['type'] : 'string'),
    default: p.default,
    description: asString(p.description) ?? '',
    ...(isEnum ? { enumValues: values } : {}),
    // Not verified here: SPT proves an advertised parameter reaches the
    // compiled strategy (DWLF-347), not that the executor's run uses it.
    honoredByExecutor: null,
  };
};

/** Why the engine ignores this node type, from the catalogue's id / dot-prefix rules, or undefined. */
export const engineIgnoredReason = (unsupported: UnsupportedRule[], nodeType: string): string | undefined => {
  const rule = unsupported.find((r) => (typeof r?.id === 'string' && r.id === nodeType)
    || (typeof r?.prefix === 'string' && nodeType.startsWith(r.prefix)));
  return rule ? (asString(rule.reason) ?? 'not evaluated by the strategy engine') : undefined;
};

/** The catalogue's condition nodes in this tool's shape; null for a value that is not a catalogue. */
export const catalogueConditionNodes = (body: unknown): CatalogueStrategyNode[] | null => {
  const nodes = (body as { nodeTypes?: unknown })?.nodeTypes;
  if (!Array.isArray(nodes)) {return null;}
  const unsupported = Array.isArray((body as { unsupported?: unknown })?.unsupported) ? (body as { unsupported: UnsupportedRule[] }).unsupported : [];
  return (nodes as CatalogueNode[])
    .filter((n) => typeof n?.id === 'string' && n.id !== '' && !LOCAL_CATEGORIES.has(String(n.category)))
    .map((n) => {
      const nodeType = n.id as string;
      const ignored = engineIgnoredReason(unsupported, nodeType);
      return {
        nodeType,
        category: 'condition' as const,
        description: asString(n.description) ?? '',
        params: (Array.isArray(n.parameters) ? n.parameters : []).map(toParam).filter((p): p is NodeParam => p !== null),
        label: asString(n.label),
        direction: asString(n.direction),
        timeframes: Array.isArray(n.timeframes) ? n.timeframes.filter((t): t is string => typeof t === 'string') : undefined,
        catalogueCategory: asString(n.category),
        ...(ignored ? { engineIgnored: ignored } : {}),
        source: 'catalogue' as const,
      };
    });
};

/**
 * Local nodes first (they carry engine notes the catalogue does not), then the
 * catalogue's condition nodes the local list does not already describe.
 */
export const mergeNodes = (local: StrategyNode[], catalogue: CatalogueStrategyNode[]): (StrategyNode | CatalogueStrategyNode)[] => {
  const known = new Set(local.map((n) => n.nodeType));
  return [...local, ...catalogue.filter((n) => !known.has(n.nodeType))];
};

/**
 * A loader for GET /node-types that caches a good read for 15 minutes; a
 * failure is returned, not thrown, and not cached. Built once per registration,
 * so the cache lives in its closure.
 */
export const createCatalogueLoader = (get: (path: string) => Promise<unknown>, ttlMs = TTL_MS) => {
  let cached: { at: number; value: LoadedCatalogue } | null = null;
  return async (now = Date.now()): Promise<LoadedCatalogue> => {
    if (cached && now - cached.at < ttlMs) {return cached.value;}
    try {
      const body = await get('/node-types');
      const nodes = catalogueConditionNodes(body);
      if (!nodes || nodes.length === 0) {
        return { nodes: [], unsupported: [], error: 'GET /node-types returned no condition nodes' };
      }
      const unsupported = Array.isArray((body as { unsupported?: unknown })?.unsupported) ? (body as { unsupported: UnsupportedRule[] }).unsupported : [];
      const value = { nodes, unsupported };
      cached = { at: now, value };
      return value;
    } catch (error) {
      return { nodes: [], unsupported: [], error: `GET /node-types failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  };
};

/** Whether a request can be answered from the local file alone. */
export const needsCatalogue = ({ nodeType, category, local }: { nodeType?: string; category?: string; local: StrategyNode[] }) => {
  if (nodeType) {return !local.some((n) => n.nodeType === nodeType);}
  if (category) {return category === 'condition';}
  return true;
};

/** The tool's answer: `{ result }` to return, or `{ error }` for an unknown node type. */
export const describeNodes = ({ local, catalogue, nodeType, category }: {
  local: StrategyNode[]; catalogue: LoadedCatalogue | null; nodeType?: string; category?: string;
}): { result?: Record<string, unknown>; error?: Record<string, unknown> } => {
  const all = mergeNodes(local, catalogue?.nodes ?? []);
  const catalogueError = catalogue?.error;
  if (nodeType) {
    const single = all.find((n) => n.nodeType === nodeType);
    if (!single) {
      return { error: {
        error: `Unknown nodeType: ${nodeType}`,
        hint: catalogueError
          ? 'The node catalogue could not be read, so condition nodes are missing; retry, or call without args to see what is available.'
          : 'Call without args to see the full catalog of supported node types.',
        ...(catalogueError ? { catalogueError } : {}),
      } };
    }
    return { result: { count: 1, nodes: [single], ...(catalogueError ? { catalogueError } : {}) } };
  }
  // Unfiltered, a catalogue node is listed by name only (about a hundred of
  // them); ask for one by `nodeType`, or for `category: 'condition'`, for detail.
  const brief = (n: (typeof all)[number]) => ('source' in n && n.source === 'catalogue'
    ? { nodeType: n.nodeType, category: n.category, label: n.label, catalogueCategory: n.catalogueCategory, timeframes: n.timeframes, ...(n.engineIgnored ? { engineIgnored: n.engineIgnored } : {}), source: n.source }
    : n);
  const nodes = category ? all.filter((n) => n.category === category) : all.map(brief);
  return { result: {
    count: nodes.length,
    nodes,
    ...(catalogue && catalogue.unsupported.length ? { engineIgnores: catalogue.unsupported } : {}),
    ...(catalogueError ? { catalogueError } : {}),
  } };
};
