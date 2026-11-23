import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BLOCK_DESCRIPTIONS, BLOCK_SCHEMAS, BLOCK_HANDLERS } from './blockDescriptions.js';
import { withHypotheticalNote } from './caveats.js';

/**
 * Tool profiles (DWLF-621). `full` (the default) registers every tool, exactly as before. `block` registers the
 * curated subset for Bitcoin users of block.dwlf: conditions, on-chain events, custom events, alerts and the
 * academy (no strategy signals, strategies or backtests: DWLF-835). A Block user's agent then doesn't see ~100 retail and metals tools.
 *
 * Selected by `--profile <name>` or `DWLF_TOOL_PROFILE`; the flag wins. An unknown name is a startup error, never a
 * silent fallback to `full`: an agent configured for Block must not quietly get the whole catalogue.
 *
 * A profile HIDES tools and, for `block`, rewords some (description, input schema, and the node catalogue's answer:
 * src/blockDescriptions.ts, DWLF-835). Every request still goes through the same API key and the same backend
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
  'dwlf_get_support_resistance',
  'dwlf_get_cycle_setups',
  // The divergence scan (DWLF-791/797/798): dated events with confluence layers; the API gates it as the cycles family.
  'dwlf_get_divergences',
  // dwlf_get_intelligence is not here: it is a DWLF retail read (any symbol, families mixed), and a Block account's key
  // is refused it (SPT block/keyRoutePolicy, 403 NOT_ON_BLOCK; tier matrix decision D). dwlf_get_conditions covers BTC.
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
  // NOT in Block (Andy, 12-Nov-2026 17:53, DWLF-835): strategy signals, strategies and backtests, with their
  // signal/entry/exit vocabulary. Block describes conditions, never calls; they stay in `full` and are revisited for
  // Block with the builder in v1.1.
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
    'into buy, sell or hold recommendations. Nothing here is scored as a predictor. ' +
    'PLANS: a plan reads some event families in full (which ones: https://api.dwlf.co.uk/v2/public/block/pricing, ' +
    '`families` and each plan\'s `families`; fetch it if you can). Below ' +
    'that plan an event row is `{ eventType, date, …, locked: true, lockedFamily, requiredPlan, upgradeUrl, pricingUrl }` (what fired and when; no price, levels, values or meaning), a conditions section is ' +
    '`{ locked: true, lockedFamily, requiredPlan, upgradeUrl, pricingUrl }`, and a state read of that family fails with HTTP 403 ' +
    'naming `[PLAN_REQUIRED; family=…; requiredPlan=…; upgradeUrl=…; pricingUrl=…]`. Tell your human what is locked and ' +
    'which plan unlocks it, and give them `upgradeUrl` (the plans page); `pricingUrl` is the price list for a program, ' +
    'not a page for a person. Never guess a locked value.',
};

/**
 * The Block profile's backend (DWLF-876, docs/design/block-repoint.md D1): `spt` (today's default, SPT /v2) or
 * `block-api` (the Block API, the launch set only). The cut release flips the default. `block-api` is published (the
 * README's keyless set-up) and is accepted for good; `spt` stays one minor release after the cut as the
 * rollback, then goes.
 */
export type BlockBackend = 'spt' | 'block-api';

/** The tools `--profile block` offers on the `block-api` backend (the launch set as it lands; D2). */
export const BLOCK_API_TOOLS: ReadonlySet<string> = new Set(['dwlf_get_conditions', 'dwlf_get_events', 'dwlf_get_series',
  'dwlf_describe_onchain_events', 'dwlf_explain_event']);

/** The production DWLF Block site. */
export const PRODUCTION_BLOCK_SITE = 'https://block.dwlf.co.uk';

/**
 * The DWLF Block site of the stage a Block API base URL belongs to: `https://api.<site>` → `https://<site>` for a DWLF
 * Block site (`block.dwlf.co.uk`, `block-staging.dwlf.co.uk`, …), so a staging view sends a person to staging's pages.
 * Anything else (a loopback stand-in, another host) gets production's, where real accounts are made. Built here only
 * because the success envelope names no keys, support or terms page (DWLF-899 asks the Block API to).
 */
export function blockSiteFor(apiBase: string): string {
  try {
    const u = new URL(apiBase);
    const site = u.protocol === 'https:' && !u.port ? /^api\.(block(?:-[a-z0-9]+)*\.dwlf\.co\.uk)$/.exec(u.hostname)?.[1] : undefined;
    return site ? `https://${site}` : PRODUCTION_BLOCK_SITE;
  } catch { return PRODUCTION_BLOCK_SITE; }
}

/** The keys page of `apiBase`'s stage: where a person creates a free DWLF Block account's API key. */
export const keysPageFor = (apiBase: string): string => `${blockSiteFor(apiBase)}/account/`;

/**
 * Server instructions for `--profile block` on the `block-api` backend, read against the Block API at `apiBase`, with
 * or without a key (`signedIn`): they say which, so an agent never infers it, and name that stage's keys, support
 * and terms pages (`blockSiteFor`). Both arguments are required, so no caller can name pages that don't match the API
 * it reads. Worded within the shared banned-terms list.
 */
export const blockApiInstructions = (apiBase: string, signedIn: boolean): string =>
  (signedIn
    ? 'This connection reads DWLF Block with an API key: what it reads follows that key\'s plan. '
    : 'This connection has no API key: it reads DWLF Block\'s public view, recent history only. ') +
  'DWLF Block: Bitcoin conditions, not calls. Start with dwlf_get_conditions for where Bitcoin is now, then ' +
  'dwlf_get_events for what happened and when, and dwlf_get_series for one measure over time. Find an event type or ' +
  'series with dwlf_describe_onchain_events, and read one event type with dwlf_explain_event. Every answer is the ' +
  'Block envelope: lead with its `summary`, give each item\'s `why` and `chartUrl`, and date each fact by its ' +
  '`knowableAt`. An item with `locked: true` is of a family this view does not read: tell your human what it is, ' +
  'when it happened and which plan reads it (`requiredPlan`), and give them `upgradeUrl` (the plans page); `pricingUrl` ' +
  'is the price list for a program, not a page for a person. Never guess a locked value. A `summary` ' +
  'that says "Recent history only" means this view has no key. Tell your human what that summary says about the ' +
  'rest, and offer nothing it doesn\'t: only when it offers a free account, a free DWLF Block account\'s API key, from ' +
  `${keysPageFor(apiBase)}, reads the full history. Help: ${blockSiteFor(apiBase)}/support; the terms: ` +
  `${blockSiteFor(apiBase)}/legal/#terms (an error's \`supportUrl\` and \`termsUrl\` name the same pages). ` +
  'Call each item an event, a condition or a reading. Describe ' +
  'states and conditions; never turn them into buy, sell or hold recommendations. Nothing here is scored as a predictor.';

/**
 * The backend named by `--block-backend X` / `--block-backend=X`, else `DWLF_BLOCK_BACKEND`, else `spt`. Throws on an
 * unknown value, and on a non-default backend for any profile but `block` (it would otherwise be silently ignored).
 */
export function resolveBlockBackend(argv: readonly string[], env: Record<string, string | undefined>, profile: ProfileName): BlockBackend {
  let named: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--block-backend') {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error('--block-backend needs a value (spt or block-api).');
      named = argv[i + 1];
    } else if (argv[i].startsWith('--block-backend=')) named = argv[i].slice('--block-backend='.length);
  }
  const fromEnv = env.DWLF_BLOCK_BACKEND?.trim() ? env.DWLF_BLOCK_BACKEND : undefined;
  const raw = (named ?? fromEnv ?? 'spt').trim().toLowerCase();
  if (raw !== 'spt' && raw !== 'block-api') throw new Error(`Unknown Block backend "${raw}". Use one of: spt, block-api.`);
  if (raw === 'block-api' && profile !== 'block') throw new Error('The block-api backend applies to --profile block only.');
  return raw;
}

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
 * A shared tool's registration as the Block profile sends it (DWLF-835): its Block description, input schema and
 * handler where it has them. Registrations are `server.tool(name, description, shape, handler)`; any other form is
 * refused here rather than passed through unchanged, so an override can never be silently skipped.
 */
function blockArgs(name: string, args: unknown[]): unknown[] {
  const text = BLOCK_DESCRIPTIONS[name];
  const schema = BLOCK_SCHEMAS[name];
  const handler = BLOCK_HANDLERS[name];
  if (text === undefined && schema === undefined && handler === undefined) return args;
  if (args.length !== 4 || typeof args[1] !== 'string' || typeof args[2] !== 'object' || typeof args[3] !== 'function') {
    throw new Error(`${name}: has Block wording, but is not registered as tool(name, description, shape, handler)`);
  }
  const [, description, shape, fn] = args as [string, string, Record<string, never>, (...a: never[]) => unknown];
  return [
    name,
    typeof text === 'function' ? text(description) : (text ?? description),
    schema ? schema(shape) : shape,
    handler ? handler(fn as never) : fn,
  ];
}

/**
 * A view of `server` that registers only the profile's tools, for `block` sends their Block wording (blockArgs), and on
 * every profile appends the hypothetical note to the tools listed for it (`withHypotheticalNote`). Resources, prompts and everything else pass
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
          return (target.tool as (...a: unknown[]) => unknown).apply(target, withHypotheticalNote(name, profile === 'block' ? blockArgs(name, args) : args));
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
