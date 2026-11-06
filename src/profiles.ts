import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Tool profiles (DWLF-621). `full` (the default) registers every tool, exactly as before. `block` registers the
 * curated subset for Bitcoin users of block.dwlf: conditions, on-chain events, custom events, strategies,
 * backtests, alerts and the academy. A Block user's agent then doesn't see ~100 retail and metals tools.
 *
 * Selected by `--profile <name>` or `DWLF_TOOL_PROFILE`; the flag wins. An unknown name is a startup error, never a
 * silent fallback to `full`: an agent configured for Block must not quietly get the whole catalogue.
 *
 * A profile only HIDES tools. Every request still goes through the same API key and the same backend
 * permissions, quotas and licensing, so a profile is never a security boundary.
 */
export type ProfileName = 'full' | 'block';

// Profile names are a published contract (server.json `choices`, client configs in docs/BLOCK.md): a name is never
// removed. A retired or split profile keeps its old name as an alias here, mapped to its successor.
const PROFILE_ALIASES: Record<string, ProfileName> = {};

export const BLOCK_TOOLS: ReadonlySet<string> = new Set([
  // Conditions and context
  'dwlf_get_conditions',
  'dwlf_describe_onchain_events',
  'dwlf_explain_event',
  'dwlf_get_events',
  'dwlf_get_regime',
  'dwlf_get_stage',
  'dwlf_get_cycle_windows',
  'dwlf_get_quote',
  'dwlf_get_price_picture',
  'dwlf_get_market_data',
  'dwlf_get_intelligence',
  'dwlf_get_support_resistance',
  'dwlf_get_cycle_setups',
  // Technical analysis reads, for BTCOC/USD above all (DWLF-722): trend lines with their anchors, the stored daily
  // moving averages, and range context from cycle pivots. What a plan may read is the API's decision, not this list's.
  'dwlf_get_trendlines',
  'dwlf_get_indicators',
  'dwlf_get_ranges',
  // Custom events: build, check, evaluate, activate
  'dwlf_describe_strategy_nodes',
  'dwlf_list_custom_events',
  'dwlf_get_custom_event',
  'dwlf_create_custom_event',
  'dwlf_update_custom_event',
  'dwlf_compile_custom_event',
  'dwlf_preflight_custom_event',
  'dwlf_evaluate_custom_event',
  'dwlf_get_evaluation_status',
  'dwlf_delete_custom_event',
  'dwlf_activate_event_symbols',
  'dwlf_deactivate_event_symbols',
  'dwlf_get_event_symbols',
  'dwlf_get_custom_event_notifications',
  // Strategies and backtests
  'dwlf_list_strategies',
  'dwlf_get_strategy',
  'dwlf_create_strategy',
  'dwlf_update_strategy',
  'dwlf_compile_strategy',
  'dwlf_delete_strategy',
  'dwlf_evaluate_strategy',
  'dwlf_get_recent_signals',
  'dwlf_activate_strategy_symbols',
  'dwlf_deactivate_strategy_symbols',
  'dwlf_get_strategy_symbols',
  'dwlf_run_backtest',
  'dwlf_get_backtest_results',
  'dwlf_get_backtest_summary',
  'dwlf_list_backtests',
  'dwlf_cancel_backtest',
  'dwlf_delete_backtest',
  // Alerts
  'dwlf_list_subscriptions',
  'dwlf_create_subscription',
  'dwlf_update_subscription',
  'dwlf_delete_subscription',
  // Learning, account, onboarding
  'dwlf_search_academy',
  'dwlf_list_academy_tracks',
  'dwlf_get_academy_lesson',
  'dwlf_get_quotas',
  'dwlf_register_agent',
]);

const PROFILES: Record<ProfileName, ReadonlySet<string> | null> = { full: null, block: BLOCK_TOOLS };

/** Server instructions sent at `initialize`, per profile (null = none, as before). */
export const PROFILE_INSTRUCTIONS: Record<ProfileName, string | null> = {
  full: null,
  block:
    'DWLF Block: Bitcoin conditions, not calls. Start with dwlf_get_conditions for the current state ' +
    '(regime, cost-basis ladder, cycle windows, recent events, provenance), and use dwlf_describe_onchain_events ' +
    'to find an on-chain event and dwlf_explain_event to learn what it means, whether its history can change and ' +
    'when it fired, before relying on it. Describe states and conditions; never turn them ' +
    'into buy, sell or hold recommendations. Nothing here is scored as a predictor.',
};

/** The profile named by `--profile X` / `--profile=X`, else `DWLF_TOOL_PROFILE`, else `full`. Throws on an unknown name. */
export function resolveProfile(argv: readonly string[], env: Record<string, string | undefined>): ProfileName {
  let named: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--profile') {
      // A flag with no value is a broken config, never "use the default".
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error('--profile needs a value (full or block).');
      named = argv[i + 1];
    } else if (argv[i].startsWith('--profile=')) named = argv[i].slice('--profile='.length);
  }
  // An empty env var is "unset" (client configs and installers often write optional variables as ""); an empty
  // --profile= is a broken flag and falls through to the unknown-name error.
  const fromEnv = env.DWLF_TOOL_PROFILE?.trim() ? env.DWLF_TOOL_PROFILE : undefined;
  const raw = (named ?? fromEnv ?? 'full').trim().toLowerCase();
  if (raw === 'full' || raw === 'block') return raw;
  if (Object.hasOwn(PROFILE_ALIASES, raw)) return PROFILE_ALIASES[raw];
  throw new Error(`Unknown DWLF tool profile "${raw}". Use one of: ${Object.keys(PROFILES).join(', ')}.`);
}

/**
 * A view of `server` that registers only the profile's tools. Resources, prompts and everything else pass
 * through unchanged. `registered` collects every tool name offered, including the hidden ones, so a test can
 * check that each profile tool exists.
 */
export function profiledServer(server: McpServer, profile: ProfileName, registered: Set<string> = new Set()): McpServer {
  const allowed = PROFILES[profile];
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'tool') {
        return (...args: unknown[]) => {
          const name = String(args[0]);
          registered.add(name);
          if (allowed && !allowed.has(name)) return undefined;
          return (target.tool as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
