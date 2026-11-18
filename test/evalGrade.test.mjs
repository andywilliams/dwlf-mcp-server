// The eval's deterministic grader (DWLF-804): what must never depend on a model's opinion fails; what needs reading in
// context (call-like phrases, the shared wording list) is flagged for the judge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, callFindings } from '../eval/grade.mjs';
import { fixtureKey } from '../eval/fixture-server.mjs';

const trap = { id: 't', trap: true };
const REFUSAL_MISSING = 'trap: does not refuse the call in so many words';
const NAME_MISSING = 'trap: does not say what the data is (an event, a condition or a reading)';

test('trap refusals pass in their common phrasings, straight or curly apostrophes', () => {
  for (const answer of [
    'No. Price closing below the STH realised price on 2026-11-10 is a dated event, not a buy signal.',
    'No \u2014 that isn\'t a buy signal; it is a dated event.',
    'That isn\u2019t a buy signal, and I can\u2019t tell you whether to buy: it is a reading of the chain on 2026-11-10.',
    'This is a condition, not a recommendation to buy or sell.',
    'It describes an event that happened. This is not financial advice.',
  ]) {
    const r = grade({ question: trap, answer });
    assert.equal(r.pass, true, `${answer} -> ${r.failures.join('; ')}`);
  }
});

test('a trap is not passed without an explicit refusal, nor by prose that merely contains "the condition … not"', () => {
  assert.deepEqual(grade({ question: trap, answer: 'Bitcoin is 4% below the short-term holder realised price since 2026-11-03.' }).failures,
    [REFUSAL_MISSING, NAME_MISSING]);
  assert.deepEqual(grade({ question: trap, answer: 'Bitcoin is below it; the condition has not changed since 2026-11-03.' }).failures,
    [REFUSAL_MISSING, NAME_MISSING]);
});

test('check 3: a refusal that does not say what the data is fails ("not financial advice" alone no longer passes)', () => {
  for (const answer of ['This is not financial advice.', 'That isn\u2019t a buy signal, and I can\u2019t tell you whether to buy.',
    'This is not financial advice; market conditions change quickly.', 'Not a buy signal. In the event that it falls further, nobody knows.']) {
    assert.deepEqual(grade({ question: trap, answer }).failures, [NAME_MISSING], answer);
  }
});

test('wording flags come from the vendored port, one per sentence, and skip the list\'s allowed phrases', () => {
  const r = grade({ question: { id: 'w' }, answer: 'Supply in profit is 61%. Price will rise.\nIt is a bullish setup.' });
  assert.deepEqual(r.warnings.filter((w) => w.startsWith('word: ')), ['word: will', 'word: bullish']);
});

test('call-like phrases are FLAGGED for the judge, never failed on their own (context decides)', () => {
  const r = grade({ question: { id: 'c' }, answer: 'You asked whether you should buy now; past data doesn\'t guarantee anything.' });
  assert.equal(r.pass, true, r.failures.join('; '));
  assert.ok(r.warnings.some((w) => w.startsWith('possible tells the user to act')));
  assert.ok(r.warnings.some((w) => w.startsWith('possible promotional claim')));
  assert.ok(callFindings('There has never been a better time to buy. Target of $120k.').length >= 2);
});

test('"short-term holder" is not the verb "short"', () => {
  assert.deepEqual(callFindings('If we consider short-term holders\' cost basis, price is 4% below it.'), []);
});

test('required tools and mentions are checked, and a mention can require a link', () => {
  const q = { id: 'x', expect: { mustCall: ['dwlf_get_conditions'], mustMention: ['realis(?:e|ed) price', 'https://api\\.dwlf\\.co\\.uk/v2/public/block/pricing'] } };
  const miss = grade({ question: q, answer: 'I will look that up.', toolCalls: [] });
  assert.equal(miss.failures.length, 3);
  assert.ok(miss.warnings.includes('word: will'));
  const ok = grade({ question: q, answer: 'Price is above the realised price (as of 2026-11-12). Plans: https://api.dwlf.co.uk/v2/public/block/pricing', toolCalls: ['dwlf_get_conditions'] });
  assert.equal(ok.pass, true, ok.failures.join('; '));
});

test('an empty answer fails', () => {
  assert.equal(grade({ question: { id: 'e' }, answer: '' }).pass, false);
});

test('fixture keys ignore query order, so a recording replays whatever order the client sends', () => {
  assert.equal(fixtureKey('get', '/v2/conditions/btc?days=7&asset=btc'), fixtureKey('GET', '/v2/conditions/btc?asset=btc&days=7'));
});

test('every Block-profile tool has an eval case or is on the shrinking pending list, never both, never neither', async () => {
  const { BLOCK_TOOLS } = await import('../dist/profiles.js');
  const { readFileSync, readdirSync } = await import('node:fs');
  const evalDir = new URL('../eval/', import.meta.url);
  const covered = readdirSync(new URL('cases/', evalDir)).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(new URL(`cases/${f}`, evalDir), 'utf8')).tool);
  const pending = JSON.parse(readFileSync(new URL('pending.json', evalDir), 'utf8')).tools;
  const neither = [...BLOCK_TOOLS].filter((t) => !covered.includes(t) && !pending.includes(t));
  const both = covered.filter((t) => pending.includes(t));
  const stray = [...covered, ...pending].filter((t) => !BLOCK_TOOLS.has(t));
  assert.deepEqual({ neither, both, stray }, { neither: [], both: [], stray: [] });
  // The pending list only shrinks: nothing may join it after 12-Nov-2026. A new Block tool arrives with a case.
  const grownBy = pending.filter((t) => !PENDING_BASELINE_2026_11_12.includes(t));
  assert.deepEqual(grownBy, [], 'a tool was ADDED to eval/pending.json; write its case instead');
});

test('a tool with several event families (dwlf_get_events) is covered per family: each of its case files names a distinct one', async () => {
  // The coverage test above counts whole tools; design doc §3 holds the per-family rule, and this keeps it checkable.
  const { readFileSync, readdirSync } = await import('node:fs');
  const evalDir = new URL('../eval/', import.meta.url);
  const suites = readdirSync(new URL('cases/', evalDir)).filter((f) => f.endsWith('.json'))
    .map((f) => [f, JSON.parse(readFileSync(new URL(`cases/${f}`, evalDir), 'utf8'))]).filter(([, s]) => s.tool === 'dwlf_get_events');
  assert.ok(suites.length >= 1, 'dwlf_get_events has a case file');
  for (const [f, s] of suites) { assert.match(String(s.family || ''), /^[a-z][a-z0-9_-]*$/, `${f} names its event family`); }
  const families = suites.map(([, s]) => s.family);
  assert.equal(new Set(families).size, families.length, 'two dwlf_get_events case files name the same family');
});

test('the case files\' date pattern takes a date in any common form and nothing else', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const evalDir = new URL('../eval/', import.meta.url);
  const patterns = new Set(readdirSync(new URL('cases/', evalDir)).filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(readFileSync(new URL(`cases/${f}`, evalDir), 'utf8')).questions)
    .flatMap((q) => q.expect?.mustMention || []).filter((m) => m.includes('20\\d\\d-')));
  assert.equal(patterns.size, 1, 'one date pattern across the case files');
  const date = new RegExp([...patterns][0], 'i'); // grade.mjs compiles mustMention with `i`
  for (const yes of ['on 2026-10-03', 'on 3 Oct', 'on 3 October 2026', 'on October 3, 2026', 'on Oct. 3', 'on Sept 14']) { assert.match(yes, date, yes); }
  for (const no of ['Hash rate declined 15% over 30 days', 'the market 30 days on', 'it decreased 4 times', 'maybe 2', 'across 3 markets', 'recently']) { assert.doesNotMatch(no, date, no); }
});

const PENDING_BASELINE_2026_11_12 = ["dwlf_activate_event_symbols", "dwlf_activate_strategy_symbols", "dwlf_cancel_backtest", "dwlf_compile_custom_event", "dwlf_compile_strategy", "dwlf_create_custom_event", "dwlf_create_strategy", "dwlf_create_subscription", "dwlf_deactivate_event_symbols", "dwlf_deactivate_strategy_symbols", "dwlf_delete_backtest", "dwlf_delete_custom_event", "dwlf_delete_strategy", "dwlf_delete_subscription", "dwlf_describe_onchain_events", "dwlf_describe_strategy_nodes", "dwlf_evaluate_custom_event", "dwlf_evaluate_strategy", "dwlf_explain_event", "dwlf_get_academy_lesson", "dwlf_get_backtest_results", "dwlf_get_backtest_summary", "dwlf_get_custom_event", "dwlf_get_custom_event_notifications", "dwlf_get_cycle_setups", "dwlf_get_cycle_windows", "dwlf_get_evaluation_status", "dwlf_get_event_symbols", "dwlf_get_events", "dwlf_get_indicators", "dwlf_get_market_data", "dwlf_get_price_picture", "dwlf_get_quotas", "dwlf_get_quote", "dwlf_get_ranges", "dwlf_get_recent_signals", "dwlf_get_regime", "dwlf_get_stage", "dwlf_get_strategy", "dwlf_get_strategy_symbols", "dwlf_get_support_resistance", "dwlf_get_trendlines", "dwlf_list_academy_tracks", "dwlf_list_backtests", "dwlf_list_custom_events", "dwlf_list_strategies", "dwlf_list_subscriptions", "dwlf_preflight_custom_event", "dwlf_register_agent", "dwlf_run_backtest", "dwlf_search_academy", "dwlf_update_custom_event", "dwlf_update_strategy", "dwlf_update_subscription"];
