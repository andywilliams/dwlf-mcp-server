import { BLOCK_TOOLS } from '../profiles.js';

/**
 * What each hosted tool needs (DWLF-622; docs/HOSTED-MCP.md §4.3). OAuth scopes ARE SPT's API-key permissions, so
 * one vocabulary does both jobs: a tool's entry is the permissions SPT checks on the routes it calls. Each inner list
 * is a set of alternatives (SPT's `requireAnyPermission`); every requirement must be met by one of them.
 *
 * `test/hostedUnits.test.mjs` reads each tool's source for the routes it calls and checks them against SPT's route
 * table (`test/fixtures/spt-routes.json`, generated from SPT by `scripts/gen-spt-routes.mjs`): a tool that calls a route this table doesn't cover fails the
 * build. The MCP checks the table BEFORE calling SPT, so the step-up challenge names the scope up front; SPT still
 * enforces it on the managed key, so this table is never the security boundary.
 */
export type ScopeRequirement = readonly string[];

export const TOOL_SCOPES: Readonly<Record<string, readonly ScopeRequirement[]>> = {
  // Public reads (the node catalogue and the academy CDN): any valid token.
  dwlf_describe_onchain_events: [],
  dwlf_describe_strategy_nodes: [],
  dwlf_search_academy: [],
  dwlf_list_academy_tracks: [],
  dwlf_get_academy_lesson: [],
  // Conditions and context
  dwlf_get_conditions: [['markets:read']],
  dwlf_get_regime: [['markets:read']],
  dwlf_get_stage: [['markets:read']],
  dwlf_get_cycle_windows: [['markets:read']],
  dwlf_get_quote: [['markets:read']],
  dwlf_get_intelligence: [['markets:read']],
  dwlf_get_support_resistance: [['markets:read']],
  dwlf_get_cycle_setups: [['markets:read']],
  dwlf_get_events: [['events:read']],
  dwlf_get_price_picture: [['events:read']],
  // Explain this event (DWLF-646): the definition is public, the occurrences need events:read.
  dwlf_explain_event: [['events:read']],
  // Custom events
  dwlf_list_custom_events: [['events:read']],
  dwlf_get_custom_event: [['events:read']],
  dwlf_preflight_custom_event: [['events:read']],
  dwlf_get_event_symbols: [['events:read']],
  dwlf_get_custom_event_notifications: [['events:read']],
  dwlf_create_custom_event: [['events:write']],
  dwlf_update_custom_event: [['events:write']],
  dwlf_compile_custom_event: [['events:write']],
  dwlf_delete_custom_event: [['events:write']],
  dwlf_activate_event_symbols: [['events:write']],
  dwlf_deactivate_event_symbols: [['events:write']],
  dwlf_evaluate_custom_event: [['evaluations:write', 'strategies:write']],
  dwlf_get_evaluation_status: [['evaluations:read', 'strategies:read']],
  // Strategies and backtests
  dwlf_list_strategies: [['strategies:read']],
  dwlf_get_strategy: [['strategies:read']],
  dwlf_get_strategy_symbols: [['strategies:read']],
  dwlf_get_backtest_results: [['strategies:read']],
  dwlf_get_backtest_summary: [['strategies:read']],
  dwlf_list_backtests: [['strategies:read']],
  dwlf_create_strategy: [['strategies:write']],
  dwlf_update_strategy: [['strategies:write']],
  dwlf_compile_strategy: [['strategies:write']],
  dwlf_delete_strategy: [['strategies:write']],
  dwlf_activate_strategy_symbols: [['strategies:write']],
  dwlf_deactivate_strategy_symbols: [['strategies:write']],
  dwlf_run_backtest: [['strategies:write']],
  dwlf_cancel_backtest: [['strategies:write']],
  dwlf_delete_backtest: [['strategies:write']],
  dwlf_evaluate_strategy: [['evaluations:write', 'strategies:write']],
  dwlf_get_recent_signals: [['signals:read']],
  // Alerts
  dwlf_list_subscriptions: [['settings:read']],
  dwlf_create_subscription: [['settings:write']],
  dwlf_update_subscription: [['settings:write']],
  dwlf_delete_subscription: [['settings:write']],
  // Account
  dwlf_get_quotas: [['quotas:my:read']],
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
