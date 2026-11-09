# DWLF Block: connect your agent

DWLF Block is Bitcoin conditions, not calls: on-chain cost basis, regime, cycle timing and events you can combine,
backtest and alert on. This server's `block` profile gives your agent just the tools for that.

You need a DWLF API key (`dwlf_sk_…`). An agent can get one itself with `dwlf_register_agent` (`POST
/v2/agent/register`), and the human confirms by email. Replace `dwlf_sk_your_key_here` below.

## Claude Code

```bash
claude mcp add dwlf -e DWLF_API_KEY=dwlf_sk_your_key_here -- npx -y @dwlf/mcp-server --profile block
```

## Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server", "--profile", "block"],
      "env": { "DWLF_API_KEY": "dwlf_sk_your_key_here" }
    }
  }
}
```

## Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server", "--profile", "block"],
      "env": { "DWLF_API_KEY": "dwlf_sk_your_key_here" }
    }
  }
}
```

## VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "dwlf": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server", "--profile", "block"],
      "env": { "DWLF_API_KEY": "dwlf_sk_your_key_here" }
    }
  }
}
```

## Three prompts to try

1. "What are Bitcoin's on-chain conditions today?"
2. "Alert me when price crosses the short-term-holder realised price."
3. "Backtest: price below the short-term-holder realised price AND inside a weekly cycle-low window."

## What the `block` profile includes

- **Conditions:** `dwlf_get_conditions` (one call: regime, cost-basis ladder, cycle windows, recent events,
  provenance), `dwlf_describe_onchain_events` (what each `onchain.*` event means, read live from the API's public
  explain routes, with this package's copy as the offline fallback; no key needed), `dwlf_explain_event` (one type in full from the API: method, revision class and why, measured
  history, and its occurrences: one day, what changed since a date, or the latest five), `dwlf_get_events`, `dwlf_get_regime`, `dwlf_get_stage`, `dwlf_get_cycle_windows`,
  `dwlf_get_cycle_setups`, `dwlf_get_support_resistance`, `dwlf_get_quote`,
  `dwlf_get_price_picture`, `dwlf_get_market_data` (raw candles only where the key is licensed for them).
- **Technical analysis (BTCOC/USD and the rest):** `dwlf_get_trendlines` (the engine's trend lines, daily; weekly lines
  for BTCOC/USD are not stored yet), `dwlf_get_indicators` (daily SMA/EMA 10–200 values), `dwlf_get_ranges` (where
  price sits in its range, from cycle pivots). The TA events themselves come through `dwlf_get_events`.
- **Build and test:** custom events, strategies (including `dwlf_evaluate_strategy` and `dwlf_get_recent_signals`)
  and backtests, with `dwlf_describe_strategy_nodes` for the node catalogue.
- **Alerts:** subscriptions (`dwlf_create_subscription` and friends).
- **Learning and account:** the academy, `dwlf_get_quotas`, `dwlf_register_agent`.

`dwlf_get_intelligence` is not in the profile: it is a DWLF retail read, and the API refuses it to a Block account's
key (403 `NOT_ON_BLOCK`). For Bitcoin, `dwlf_get_conditions` carries the same picture.

## What your plan reads

What a plan reads in full is its families (`GET https://api.dwlf.co.uk/v2/public/block/pricing`, `families`). Free reads
cost basis (realised prices, MVRV, SOPR, supply in profit) and simple TA. Block and Builder read everything: cycles,
levels, COT, whales and cohorts, quantum, mining, the computed regime, fee windows, DCA and blockspace. Below the plan:

- an event row comes back locked: `{ eventType, date, …, locked: true, lockedFamily, requiredPlan, pricingUrl }`, with
  no price, levels or values;
- a conditions section (`regime.daily`, `regime.weekly`, `regime.stage`, `cycleWindows`) is `{ locked: true, … }`;
- a state read of that family (stage, regime, cycle windows, levels, COT) is `403 PLAN_REQUIRED` with `family` and
  `requiredPlan`;
- an alert on that family is refused.

Your assistant is told to say what is locked and which plan unlocks it, never to guess a locked value. The profile
hides tools; the API decides what a plan reads.

The exact list is `BLOCK_TOOLS` in `src/profiles.ts`. Tests fail if any of them stops existing, or if a Block tool's description points to a tool the profile hides.

**Read the answers as conditions.** Nothing here is a recommendation to buy, sell or hold, and nothing is scored as
a predictor. Each on-chain reading carries `confirmedAt`, the moment it became knowable.
