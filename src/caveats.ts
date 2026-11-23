/**
 * The hypothetical-performance note. Every tool whose answer can carry a
 * simulated figure (a backtest, a strategy's recorded fires, a replayed skip) ends its description with this
 * sentence, so an agent never reports one as actual trading. It is applied from HYPOTHETICAL_TOOLS in one place
 * (`withHypotheticalNote`, called by `profiledServer` for every profile), as READING_NOTE is from NOTED_TOOLS. The API's own `hypotheticalLegend` (SPT
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
  'dwlf_get_active_signals', 'dwlf_get_recent_signals', 'dwlf_get_signal_stats', 'dwlf_ai_strategy_performance',
  'dwlf_ai_dashboard', 'dwlf_ai_symbol_brief', 'dwlf_get_backtest_results', 'dwlf_get_backtest_summary',
  'dwlf_get_skip_outcomes', 'dwlf_get_decision_stats',
]);

/**
 * A `server.tool(name, description, …)` registration with the note appended when `name` is listed. A listed tool
 * registered in any other form is refused, so the note can never be silently skipped.
 */
export function withHypotheticalNote(name: string, args: unknown[]): unknown[] {
  if (!HYPOTHETICAL_TOOLS.has(name)) return args;
  if (typeof args[1] !== 'string') throw new Error(`${name}: needs the hypothetical note, but has no description string`);
  return [args[0], `${args[1]} ${HYPOTHETICAL_NOTE}`, ...args.slice(2)];
}
