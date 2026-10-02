import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLatestMovingAverages, MA_TYPES } from '../dist/tools/indicators.js';

// DWLF-329: dwlf_get_indicators passes the backend response through and adds
// the newest value per stored moving average.

test('adds the newest finite value per average and lists the missing ones', () => {
  const data = {
    symbol: 'BTC/USD',
    combined: true,
    indicators: [
      { type: 'sma50', data: [{ date: '2026-09-30', value: 77295.59 }, { date: '2026-10-01', value: 77723.59 }] },
      { type: 'sma50', data: [{ date: '2026-09-29', value: 76895.12 }] },
      { type: 'ema200', data: [{ date: '2026-10-01', value: 70100.1 }] },
      { type: 'sma10', data: [{ date: '2026-10-01', value: null }] },
    ],
  };
  const out = withLatestMovingAverages(data);
  assert.deepEqual(out.latest, {
    sma50: { date: '2026-10-01', value: 77723.59 },
    ema200: { date: '2026-10-01', value: 70100.1 },
  });
  assert.equal(out.missing.length, MA_TYPES.length - 2);
  assert.ok(out.missing.includes('sma10'));
  assert.equal(out.indicators, data.indicators, 'backend rows pass through');
  assert.equal(out.symbol, 'BTC/USD');
});

test('an unexpected response shape is an error, not "no averages"', () => {
  assert.throws(() => withLatestMovingAverages({ success: true, data: {} }), /no indicators array/);
  assert.throws(() => withLatestMovingAverages(null), /no indicators array/);
});

test('MA_TYPES are the ten stored averages', () => {
  assert.deepEqual([...MA_TYPES].sort(), ['ema10', 'ema100', 'ema20', 'ema200', 'ema50', 'sma10', 'sma100', 'sma20', 'sma200', 'sma50']);
});
