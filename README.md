# @dwlf/mcp-server

MCP server for the [DWLF](https://www.dwlf.co.uk) market analysis platform. It gives AI agents dated events and conditions they can reason about: indicator events, support/resistance, market regime, cycle timing, on-chain readings, strategies, backtests, portfolios, trade journals, and more. It describes what happened and where things stand; it doesn't forecast prices or give trading advice.

Works with Claude Desktop, Cursor, VS Code, and any MCP-compatible client.

## Who can use it today (status 23 Nov 2026)

| You are | What works | Key |
|---|---|---|
| Anyone curious about Bitcoin | **DWLF Block, keyless:** `--profile block --block-backend block-api`. The 5 Block tools read Bitcoin conditions, events and on-chain series from the public Block API, recent history only. | None. Block accounts aren't open yet (live status: `accounts.open` in [the pricing document](https://api.block.dwlf.co.uk/public/v1/pricing)); once they are, a free account's key (`DWLF_BLOCK_KEY`, from [block.dwlf.co.uk/account](https://block.dwlf.co.uk/account/)) reads the full history. |
| A DWLF platform member | Every tool (`full`), or the larger `block` set on the default backend. | A `dwlf_sk_` key from your DWLF account. DWLF is in **private beta**: accounts are invite-only, and sign-up (including `dwlf_register_agent`) is closed for now. |

Set-up for DWLF Block, client by client: [docs/BLOCK.md](docs/BLOCK.md).

> **🤖 AI Agents:** To ensure strategies created via MCP are accessible via REST API, use the same API key for both. See [Agent Onboarding Guide](docs/AGENT-ONBOARDING.md).

## Quick Start

The fastest way to get running — no cloning needed:

```bash
npx -y @dwlf/mcp-server
```

Or install globally:

```bash
npm install -g @dwlf/mcp-server
dwlf-mcp-server
```

Without arguments it runs every tool and needs a `DWLF_API_KEY` (see [Getting an API Key](#getting-an-api-key)). For keyless DWLF Block:

```bash
npx -y @dwlf/mcp-server --profile block --block-backend block-api
```

The client examples below use a `dwlf_sk_` key; for keyless Block, put `"--profile", "block", "--block-backend", "block-api"` in `args` and leave out `env`.

## Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server"],
      "env": {
        "DWLF_API_KEY": "dwlf_sk_your_key_here"
      }
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server"],
      "env": {
        "DWLF_API_KEY": "dwlf_sk_your_key_here"
      }
    }
  }
}
```

## VS Code

Add to `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "dwlf": {
        "command": "npx",
        "args": ["-y", "@dwlf/mcp-server"],
        "env": {
          "DWLF_API_KEY": "dwlf_sk_your_key_here"
        }
      }
    }
  }
}
```

## Getting an API Key

**DWLF platform (`dwlf_sk_…`):** DWLF is in private beta, so accounts are invite-only. If you have one:

1. Sign in at [dwlf.co.uk](https://www.dwlf.co.uk)
2. Go to **Settings → API Keys**
3. Create a new key — it starts with `dwlf_sk_`
4. Set it as `DWLF_API_KEY` in your MCP client config

Programmatic registration (`POST https://api.dwlf.co.uk/v2/agent/register`, or the `dwlf_register_agent` tool) follows the same gate: while sign-up is closed it answers 403. When it opens, see the [Agent Onboarding Guide](docs/AGENT-ONBOARDING.md).

**DWLF Block (`dwlfk_…`):** the keyless view needs no key. Block accounts aren't open yet; once they are, create a free key at [block.dwlf.co.uk/account](https://block.dwlf.co.uk/account/) and set it as `DWLF_BLOCK_KEY`.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DWLF_API_KEY` | Yes, except with `--block-backend block-api` | — | Your DWLF API key (`dwlf_sk_...`) |
| `DWLF_API_URL` | No | `https://api.dwlf.co.uk` | API base URL |
| `DWLF_BLOCK_BACKEND` | No | unset | For `--profile block` only: `block-api` uses the Block API (5 tools, keyless or `DWLF_BLOCK_KEY`). Unset, `block` runs on the DWLF platform and needs `DWLF_API_KEY`. The `--block-backend block-api` flag does the same and wins. |
| `DWLF_BLOCK_KEY` | No | — | On `block-api`: a DWLF Block API key (`dwlfk_...`) for the full history. Without it, the public view (recent history). |
| `BLOCK_API_URL` | No | `https://api.block.dwlf.co.uk` | Block API base URL (e.g. staging). |
| `DWLF_TOOL_PROFILE` | No | `full` | Tool set: `full` (every tool) or `block` (the Bitcoin subset for DWLF Block). The `--profile <name>` flag does the same and wins. An unknown name stops the server with the reason. |

### Tool profiles

- **`full`** (default): every tool, as before.
- **`block`** on the **`block-api`** backend (`--block-backend block-api`): 5 tools on the Block API: `dwlf_get_conditions`, `dwlf_get_events`, `dwlf_get_series`, `dwlf_describe_onchain_events` and `dwlf_explain_event`. Works without a key (recent history). This becomes the default for `block` at DWLF Block's launch.
- **`block`** without `--block-backend` (the DWLF platform): about 50 tools for Bitcoin users: the conditions check, on-chain event descriptions, events, custom events, alerts, the academy and quotas. Strategies, backtests, retail, portfolio, trade-journal and metals tools are hidden. Needs a `dwlf_sk_` key. A profile only hides tools: the key's permissions and quotas are the same either way.

Set-up for each client: [docs/BLOCK.md](docs/BLOCK.md).

## Tools

### Market Data
List symbols, support/resistance levels, and indicator events (crossovers, breakouts, divergences, candlestick patterns), each with the price on its date. Raw OHLCV candles (`dwlf_get_market_data`) are licensed for display, not redistribution, so they're served to the owner account only; other keys get a 403 that points to the events instead.

### Technical Indicators
Daily SMA/EMA values (10–200), trendlines (daily, weekly, hourly), market regime, and indicator events: DSS, Bollinger, EMA/SMA crosses, swing structure, SMC, VWAP, cycle pivots.

### Strategy fires
When your strategies' rules were met (recorded by the daily evaluator), with their statistics: win rate, average return. These figures are **hypothetical**: simulated on past data, not actual trading. Simulated results benefit from hindsight, may not reflect costs, slippage or liquidity, and past results don't indicate future results.

### Strategies
Create, update, compile, and browse visual trading strategies. List public community strategies.

### Backtesting
Run backtests (async), get results with Sharpe ratios, and aggregate performance summaries. Results are hypothetical, and each response carries a `hypotheticalLegend` to show with them.

### Portfolio & Trade Journal
Portfolio holdings with P&L, historical snapshots, trade logging, notes, and plan templates.

### Symbol Activations
Activate symbols for event detection and strategy signal generation. Manage which symbols are actively monitored.

### Custom Events
Create custom indicator-based triggers (e.g. "DSS exits oversold with bullish cross").

### Theses (thesis alerts)
Save, per symbol, what you are waiting for and why: ordered steps of conditions DWLF detects itself (a confirmed cycle pivot, a close beyond a level, a cycle window opening, a trend-line break, a structure event), optional invalidations, your context and next step. DWLF checks them once a night after the close and tells you when a step is met or the thesis is challenged (Telegram digest, in-app notification, and a fires feed agents read with a cursor). Every event says when DWLF could first know it, and nothing known before a condition was saved counts. `dwlf_list_theses` with `includeProgress` says how close each is and gives `closest` to sort by; `dwlf_get_thesis_story` tells one thesis in steps (what happened, where it stands, what it needs next), with the plan as drawn when it was saved and illustrated routes (one that meets the steps, one that challenges the thesis; each leg names the engine numbers it was drawn from; illustrations, never forecasts), a one-sentence `replaySummary`, and with `replay: true` the plan as drawn told against what happened (where each step was met beside where it was illustrated; facts only, nothing scored). Start with `dwlf_thesis_guide`: benefits, limits (end of day; information, not advice), the rules for exact, detectable theses, and worked examples. Cookbook: [Save what you're waiting for](docs/cookbook.md#5-save-what-youre-waiting-for-theses).

### AI Summaries
Full account dashboard, single-symbol briefs, and strategy performance overviews (hypothetical figures) — pre-aggregated for AI consumption.

### Academy
Browse educational tracks, read lessons, and search academy content.

## Example Prompts

```
"How's BTC looking right now?"
"What happened on-chain for Bitcoin this month?"            (keyless Block)
"Where is AAPL relative to its 50 and 200 day moving averages?"
"Which of my strategies fired this week?"
"Create a Golden Cross strategy using EMA 50/200"
"Backtest my strategy on NVDA over the last year"
"Log a long on ETH at 3,200 with stop at 3,050"
"Activate TSLA for my momentum strategy"
```

## Development

```bash
git clone https://github.com/andywilliams/dwlf-mcp-server.git
cd dwlf-mcp-server
npm install
npm run build
DWLF_API_KEY=dwlf_sk_your_key npm run start
```

For hot reload during development:

```bash
DWLF_API_KEY=dwlf_sk_your_key npm run dev
```

## Cookbook

For multi-step workflows, see [docs/cookbook.md](https://github.com/andywilliams/dwlf-mcp-server/blob/master/docs/cookbook.md).

## Open Source Libraries

Building a dashboard or visualization? Use the same libraries that power the DWLF platform:

| Package | Description | Install |
|---|---|---|
| [@dwlf/indicators](https://github.com/andywilliams/dwlf-indicators-oss) | Technical indicators (EMA, Bollinger, DSS, Fibonacci, S/R, Swing, Trendlines) — zero dependencies | `npm install @dwlf/indicators` |
| [@dwlf/charting](https://github.com/andywilliams/dwlf-charting-oss) | React charting library with candlestick charts, 20+ annotations, pan/zoom | `npm install @dwlf/charting` |

Compute indicators with `@dwlf/indicators` and render with `@dwlf/charting` on candles you're licensed to use (`dwlf_get_market_data` serves raw candles to the owner account only).

## License

[MIT](LICENSE) — DWLF / Andy Williams
