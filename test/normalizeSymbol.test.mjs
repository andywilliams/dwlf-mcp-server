import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol } from '../dist/client.js';

// BTCOC/USD (DWLF's own on-chain BTC price) in every spelling an agent uses, for every tool (the Block TA tools above all).
test('BTCOC in any spelling is BTCOC-USD; existing pairs and stocks unchanged', () => {
  for (const s of ['BTCOC', 'btcoc', 'BTCOCUSD', 'BTCOC/USD', 'BTCOC-USD']) { assert.equal(normalizeSymbol(s), 'BTCOC-USD', s); }
  assert.equal(normalizeSymbol('BTC'), 'BTC-USD');
  assert.equal(normalizeSymbol('BTCUSD'), 'BTC-USD');
  assert.equal(normalizeSymbol('AAPL'), 'AAPL');
});
