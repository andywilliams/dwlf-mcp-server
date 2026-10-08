// DWLF-370: the condition nodes come from the API's one node catalogue,
// GET /v2/node-types (SPT), instead of a hand list here. This module turns that
// body into this tool's StrategyNode shape and merges it with the structural
// nodes still described locally (strategyNodeMetadata.ts: signals, stops,
// targets, gates, cancellation, exits, plus richer notes on a few conditions).
import type { NodeParam, StrategyNode } from './strategyNodeMetadata.js';

type CatalogueParam = { name?: unknown; type?: unknown; enum?: unknown; default?: unknown; description?: unknown };
type CatalogueNode = {
  id?: unknown; label?: unknown; category?: unknown; description?: unknown; direction?: unknown;
  parameters?: unknown; timeframes?: unknown;
};
export type NodeCatalogue = { nodeTypes: CatalogueNode[]; unsupported?: unknown };

export type CatalogueStrategyNode = StrategyNode & {
  label?: string;
  direction?: string;
  timeframes?: string[];
  source: 'catalogue';
};

// Structural categories this tool already describes locally.
const LOCAL_CATEGORIES = new Set(['logic', 'output']);

const asString = (v: unknown) => (typeof v === 'string' ? v : undefined);

const toParam = (p: CatalogueParam): NodeParam | null => {
  const name = asString(p?.name);
  if (!name) {return null;}
  const enumValues = Array.isArray(p.enum) ? p.enum.filter((v): v is string => typeof v === 'string') : undefined;
  return {
    name,
    type: enumValues ? 'enum' : (['number', 'string', 'boolean'].includes(String(p.type)) ? p.type as NodeParam['type'] : 'string'),
    default: p.default,
    description: asString(p.description) ?? '',
    ...(enumValues ? { enumValues } : {}),
    // SPT's parameter-parity test proves every advertised parameter reaches the
    // compiled strategy (DWLF-347), so an advertised one is honoured.
    honoredByExecutor: true,
  };
};

/** The catalogue's condition nodes in this tool's shape; null for a value that is not a catalogue. */
export const catalogueConditionNodes = (body: unknown): CatalogueStrategyNode[] | null => {
  const nodes = (body as NodeCatalogue)?.nodeTypes;
  if (!Array.isArray(nodes)) {return null;}
  return nodes
    .filter((n) => typeof n?.id === 'string' && n.id !== '' && !LOCAL_CATEGORIES.has(String(n.category)))
    .map((n) => ({
      nodeType: n.id as string,
      category: 'condition' as const,
      description: asString(n.description) ?? '',
      params: (Array.isArray(n.parameters) ? n.parameters : []).map(toParam).filter((p): p is NodeParam => p !== null),
      label: asString(n.label),
      direction: asString(n.direction),
      timeframes: Array.isArray(n.timeframes) ? n.timeframes.filter((t): t is string => typeof t === 'string') : undefined,
      source: 'catalogue' as const,
    }));
};

/**
 * Local nodes first (they carry engine notes the catalogue does not), then the
 * catalogue's condition nodes the local list does not already describe.
 */
export const mergeNodes = (local: StrategyNode[], catalogue: CatalogueStrategyNode[]): (StrategyNode | CatalogueStrategyNode)[] => {
  const known = new Set(local.map((n) => n.nodeType));
  return [...local, ...catalogue.filter((n) => !known.has(n.nodeType))];
};
