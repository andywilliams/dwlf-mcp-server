/**
 * The hypothetical-performance note (retail readiness audit, 23-Nov, item 3). Every tool whose answer can carry a
 * simulated figure (a backtest, a strategy's recorded fires, a replayed skip) ends its description with this
 * sentence, so an agent never reports one as actual trading. The API's own `hypotheticalLegend` (SPT
 * `performanceCaveats.js`, DWLF-534) is the text to show beside the figures where a response carries it.
 * `test/caveats.test.mjs` checks that every tool in HYPOTHETICAL_TOOLS carries the note, and that no other tool
 * describes win rates, P&L or replays without being listed here or in its known-actual list.
 */
export const HYPOTHETICAL_NOTE =
  'Any simulated figure here (a backtest, a strategy\'s recorded fires, a replayed skip) is hypothetical: worked out ' +
  'on past data, not actual trading. Say so whenever you report one, and pass on `hypotheticalLegend` when the ' +
  'response carries it.';

/** The tools whose answers can carry simulated performance figures. */
export const HYPOTHETICAL_TOOLS: ReadonlySet<string> = new Set([
  'dwlf_get_recent_signals', 'dwlf_get_signal_stats', 'dwlf_ai_strategy_performance', 'dwlf_get_backtest_results',
  'dwlf_get_backtest_summary', 'dwlf_get_skip_outcomes', 'dwlf_get_decision_stats',
]);
