import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGY_NODES, getStrategyNodeByType } from '../dist/data/strategyNodeMetadata.js';

// DWLF-341: the chandelier trailing stop is described once, with the one
// parameter the executor honours.
test('every nodeType is listed once', () => {
  const types = STRATEGY_NODES.map((n) => n.nodeType);
  assert.equal(new Set(types).size, types.length);
});

test('sl_chandelier: a stop-loss node whose multiplier (default 3) is honoured', () => {
  const node = getStrategyNodeByType('sl_chandelier');
  assert.equal(node?.category, 'stopLoss');
  const multiplier = node.params.find((p) => p.name === 'multiplier');
  assert.equal(multiplier.default, 3);
  assert.equal(multiplier.honoredByExecutor, true);
  assert.equal(node.params.find((p) => p.name === 'atrPeriod').honoredByExecutor, false);
});
