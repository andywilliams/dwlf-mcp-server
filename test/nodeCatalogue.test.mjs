import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogueConditionNodes, mergeNodes, createCatalogueLoader, describeNodes, needsCatalogue, engineIgnoredReason,
} from '../dist/data/nodeCatalogue.js';
import { STRATEGY_NODES } from '../dist/data/strategyNodeMetadata.js';

// DWLF-370: condition nodes come from GET /v2/node-types, merged with the
// structural nodes this server describes itself.
const body = {
  nodeTypes: [
    { id: 'cycle.low.confirmed', label: 'Cycle Low', category: 'cycles', description: 'c', direction: 'bullish', timeframes: ['weekly', 'daily'],
      parameters: [{ name: 'timeframe', type: 'string', enum: ['weekly', 'daily'], default: 'weekly', description: 'tf' }] },
    { id: 'ema.cross.above', category: 'trend', parameters: [{ name: 'length', type: 'number', enum: [10, 50, 200], default: 50 }, { name: 'x', enum: [] }] },
    { id: 'trendline_break_bullish', category: 'trendlines', description: 'from the catalogue', parameters: [] },
    { id: 'supplyDemand.zone.tested.demand', category: 'momentum' },
    { id: 'and_gate', category: 'logic', description: 'gate' },
    { id: 'fire_event', category: 'output' },
    { id: '', category: 'x' },
  ],
  unsupported: [{ prefix: 'supplyDemand.', reason: 'zones are not evaluated' }],
};

test('maps catalogue condition nodes, keeping the catalogue category, leaving out gates, outputs and nameless entries', () => {
  const nodes = catalogueConditionNodes(body);
  assert.deepEqual(nodes.map((n) => n.nodeType), ['cycle.low.confirmed', 'ema.cross.above', 'trendline_break_bullish', 'supplyDemand.zone.tested.demand']);
  const cycle = nodes[0];
  assert.equal(cycle.category, 'condition');
  assert.equal(cycle.catalogueCategory, 'cycles');
  assert.deepEqual(cycle.timeframes, ['weekly', 'daily']);
  assert.deepEqual(cycle.params[0], { name: 'timeframe', type: 'enum', default: 'weekly', description: 'tf', enumValues: ['weekly', 'daily'], honoredByExecutor: null });
});

test('numeric enums keep their values; an empty enum is not an enum', () => {
  const ema = catalogueConditionNodes(body).find((n) => n.nodeType === 'ema.cross.above');
  assert.deepEqual(ema.params[0].enumValues, [10, 50, 200]);
  assert.equal(ema.params[1].type, 'string');
  assert.equal(ema.params[1].enumValues, undefined);
});

test('a node the engine ignores says so, by exact id or dot-prefix', () => {
  const sd = catalogueConditionNodes(body).find((n) => n.nodeType === 'supplyDemand.zone.tested.demand');
  assert.equal(sd.engineIgnored, 'zones are not evaluated');
  assert.equal(engineIgnoredReason([{ id: 'a.b', reason: 'r' }], 'a.b'), 'r');
  assert.equal(engineIgnoredReason([{ id: 'a.b', reason: 'r' }], 'a.bc'), undefined);
});

test('a value that is not a catalogue maps to null', () => {
  for (const value of [null, {}, { nodeTypes: 'x' }, [1]]) {
    assert.equal(catalogueConditionNodes(value), null);
  }
});

test('local nodes win over the catalogue for the same type, and the rest are added', () => {
  const merged = mergeNodes(STRATEGY_NODES, catalogueConditionNodes(body));
  const breaks = merged.filter((n) => n.nodeType === 'trendline_break_bullish');
  assert.equal(breaks.length, 1);
  assert.notEqual(breaks[0].source, 'catalogue');
  assert.equal(merged.length, STRATEGY_NODES.length + 3);
});

test('the loader caches a good read until it expires', async () => {
  let calls = 0;
  const load = createCatalogueLoader(async () => { calls += 1; return body; }, 1000);
  assert.equal((await load(0)).nodes.length, 4);
  await load(999);
  assert.equal(calls, 1);
  await load(1000);
  assert.equal(calls, 2);
});

test('the loader reports, without caching, a failed or empty read', async () => {
  let fail = true;
  const load = createCatalogueLoader(async () => { if (fail) {throw new Error('timeout');} return body; });
  assert.match((await load(0)).error, /GET \/node-types failed: timeout/);
  fail = false;
  assert.equal((await load(1)).nodes.length, 4);
  assert.match((await createCatalogueLoader(async () => ({ nodeTypes: [] }))(0)).error, /no condition nodes/);
  assert.match((await createCatalogueLoader(async () => ({ message: 'x' }))(0)).error, /no condition nodes/);
});

test('only requests the local file cannot answer wait for the catalogue', () => {
  assert.equal(needsCatalogue({ nodeType: 'sl_atr', local: STRATEGY_NODES }), false);
  assert.equal(needsCatalogue({ nodeType: 'cycle.low.confirmed', local: STRATEGY_NODES }), true);
  assert.equal(needsCatalogue({ category: 'stopLoss', local: STRATEGY_NODES }), false);
  assert.equal(needsCatalogue({ category: 'condition', local: STRATEGY_NODES }), true);
  assert.equal(needsCatalogue({ local: STRATEGY_NODES }), true);
});

test('describeNodes: a catalogue node by type, the condition category, and the ignore rules', async () => {
  const catalogue = await createCatalogueLoader(async () => body)(0);
  assert.equal(describeNodes({ local: STRATEGY_NODES, catalogue, nodeType: 'cycle.low.confirmed' }).result.nodes[0].label, 'Cycle Low');
  const conditions = describeNodes({ local: STRATEGY_NODES, catalogue, category: 'condition' }).result.nodes.map((n) => n.nodeType);
  assert.ok(conditions.includes('cycle.low.confirmed') && conditions.includes('trendline_break_bullish'));
  assert.deepEqual(describeNodes({ local: STRATEGY_NODES, catalogue }).result.engineIgnores, body.unsupported);
});

test('describeNodes: an unknown type while the catalogue is down says the catalogue is down', () => {
  const down = { nodes: [], unsupported: [], error: 'GET /node-types failed: timeout' };
  const { error } = describeNodes({ local: STRATEGY_NODES, catalogue: down, nodeType: 'cycle.low.confirmed' });
  assert.equal(error.catalogueError, down.error);
  assert.match(error.hint, /could not be read/);
  const { result } = describeNodes({ local: STRATEGY_NODES, catalogue: down });
  assert.equal(result.catalogueError, down.error);
  assert.equal(result.count, STRATEGY_NODES.length);
});
