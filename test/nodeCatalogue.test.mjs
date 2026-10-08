import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueConditionNodes, mergeNodes } from '../dist/data/nodeCatalogue.js';
import { STRATEGY_NODES } from '../dist/data/strategyNodeMetadata.js';

// DWLF-370: condition nodes come from GET /v2/node-types, merged with the
// structural nodes this server describes itself.
const body = {
  nodeTypes: [
    { id: 'cycle.low.confirmed', label: 'Cycle Low', category: 'cycles', description: 'c', direction: 'bullish', timeframes: ['weekly', 'daily'],
      parameters: [{ name: 'timeframe', type: 'string', enum: ['weekly', 'daily'], default: 'weekly', description: 'tf' }] },
    { id: 'trendline_break_bullish', category: 'trendlines', description: 'from the catalogue', parameters: [] },
    { id: 'and_gate', category: 'logic', description: 'gate' },
    { id: 'fire_event', category: 'output' },
    { id: '', category: 'x' },
  ],
  unsupported: [{ prefix: 'supplyDemand.', reason: 'no' }],
};

test('maps catalogue condition nodes, leaving out gates, outputs and nameless entries', () => {
  const nodes = catalogueConditionNodes(body);
  assert.deepEqual(nodes.map((n) => n.nodeType), ['cycle.low.confirmed', 'trendline_break_bullish']);
  const cycle = nodes[0];
  assert.equal(cycle.category, 'condition');
  assert.deepEqual(cycle.timeframes, ['weekly', 'daily']);
  assert.deepEqual(cycle.params[0], { name: 'timeframe', type: 'enum', default: 'weekly', description: 'tf', enumValues: ['weekly', 'daily'], honoredByExecutor: true });
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
  assert.ok(merged.some((n) => n.nodeType === 'cycle.low.confirmed'));
  assert.equal(merged.length, STRATEGY_NODES.length + 1);
});
