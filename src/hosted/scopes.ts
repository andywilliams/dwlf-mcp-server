import { BLOCK_TOOLS } from '../profiles.js';

/**
 * What each hosted tool needs (DWLF-622; docs/HOSTED-MCP.md §4.3). These are the PUBLIC OAuth scopes Andy chose
 * (§9.6): `block:read`, `block:build`, `block:alerts`. The authorization server (SPT `src/oauth/scopes.js`) expands
 * each to SPT permissions when it mints the managed key, so a client never sees or holds an SPT permission name.
 * Each inner list is a set of alternatives; every requirement must be met by one of them.
 *
 * `test/hostedUnits.test.mjs` reads each tool's source for the routes it calls and checks them against SPT's route
 * table and public-scope map (`test/fixtures/spt-routes.json`, generated from SPT by `scripts/gen-spt-routes.mjs`): a
 * tool whose scopes, expanded, don't cover a route it calls fails the build. The MCP checks this table BEFORE calling
 * SPT, so the step-up challenge names the scope up front; SPT still enforces the key's permissions, so this table is
 * never the security boundary.
 */
export type ScopeRequirement = readonly string[];

const READ = ['block:read'] as const;
const BUILD = ['block:build'] as const;
const ALERTS = ['block:alerts'] as const;

export const TOOL_SCOPES: Readonly<Record<string, readonly ScopeRequirement[]>> = {
  // Public reads (the node catalogue and the academy CDN): any valid token.
  dwlf_describe_onchain_events: [],
  dwlf_describe_strategy_nodes: [],
  dwlf_search_academy: [],
  dwlf_list_academy_tracks: [],
  dwlf_get_academy_lesson: [],
  // Read: conditions, events, custom events, strategies, backtests, signals, usage.
  dwlf_get_conditions: [READ],
  dwlf_get_regime: [READ],
  dwlf_get_stage: [READ],
  dwlf_get_cycle_windows: [READ],
  dwlf_get_quote: [READ],
  dwlf_get_intelligence: [READ],
  dwlf_get_support_resistance: [READ],
  dwlf_get_cycle_setups: [READ],
  dwlf_get_events: [READ],
  dwlf_get_price_picture: [READ],
  dwlf_explain_event: [READ],
  dwlf_list_custom_events: [READ],
  dwlf_get_custom_event: [READ],
  dwlf_preflight_custom_event: [READ],
  dwlf_get_event_symbols: [READ],
  dwlf_get_custom_event_notifications: [READ],
  dwlf_get_evaluation_status: [READ],
  dwlf_list_strategies: [READ],
  dwlf_get_strategy: [READ],
  dwlf_get_strategy_symbols: [READ],
  dwlf_get_backtest_results: [READ],
  dwlf_get_backtest_summary: [READ],
  dwlf_list_backtests: [READ],
  dwlf_get_recent_signals: [READ],
  dwlf_get_quotas: [READ],
  // Build: create, change and delete custom events and strategies; run backtests and evaluations.
  dwlf_create_custom_event: [BUILD],
  dwlf_update_custom_event: [BUILD],
  dwlf_compile_custom_event: [BUILD],
  dwlf_delete_custom_event: [BUILD],
  dwlf_activate_event_symbols: [BUILD],
  dwlf_deactivate_event_symbols: [BUILD],
  dwlf_evaluate_custom_event: [BUILD],
  dwlf_create_strategy: [BUILD],
  dwlf_update_strategy: [BUILD],
  dwlf_compile_strategy: [BUILD],
  dwlf_delete_strategy: [BUILD],
  dwlf_activate_strategy_symbols: [BUILD],
  dwlf_deactivate_strategy_symbols: [BUILD],
  dwlf_run_backtest: [BUILD],
  dwlf_cancel_backtest: [BUILD],
  dwlf_delete_backtest: [BUILD],
  dwlf_evaluate_strategy: [BUILD],
  // Alerts: subscriptions (SPT gates them by settings:*).
  dwlf_list_subscriptions: [ALERTS],
  dwlf_create_subscription: [ALERTS],
  dwlf_update_subscription: [ALERTS],
  dwlf_delete_subscription: [ALERTS],
};

/**
 * Block tools the hosted endpoint does NOT serve, and why. Everything else in the Block profile is served.
 */
export const HOSTED_EXCLUDED: Readonly<Record<string, string>> = {
  // A hosted caller is already a signed-in account; registering another from inside it makes no sense.
  dwlf_register_agent: 'creates a new account; a hosted caller already has one',
  // Raw OHLCV is owner-only (SPT denies every other API key: data licensing), so a hosted client could never use it.
  dwlf_get_market_data: 'raw candles are owner-only (data licensing); every other key is refused',
};

/** The tools the hosted endpoint registers: the Block profile, less the exclusions. */
export const HOSTED_TOOLS: ReadonlySet<string> = new Set([...BLOCK_TOOLS].filter((t) => !Object.hasOwn(HOSTED_EXCLUDED, t)));

/** Every scope a hosted tool can need: the Protected Resource Metadata's `scopes_supported`. */
export const HOSTED_SCOPES: readonly string[] = [
  ...new Set([...HOSTED_TOOLS].flatMap((t) => (TOOL_SCOPES[t] ?? []).flat())),
].sort();

/**
 * The scopes `granted` lacks for `tool`: one per unmet requirement (its first alternative, the one the challenge
 * asks for). Empty when the tool may run. An unknown tool needs nothing here: the server answers it as unknown.
 */
export function missingScopes(tool: string, granted: ReadonlySet<string>): string[] {
  if (!Object.hasOwn(TOOL_SCOPES, tool)) return [];
  return TOOL_SCOPES[tool].filter((alternatives) => !alternatives.some((s) => granted.has(s))).map((alts) => alts[0]);
}
