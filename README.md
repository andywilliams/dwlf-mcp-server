# @dwlf/mcp-server

MCP server for the [DWLF](https://www.dwlf.co.uk) market analysis platform. 45+ tools that turn market noise into semantic data AI agents can reason about — candles, indicators, support/resistance, events, strategies, backtests, portfolios, trade journals, symbol activations, and more.

Works with Claude Desktop, Cursor, VS Code, and any MCP-compatible client.

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

You'll need a `DWLF_API_KEY` environment variable. See [Getting an API Key](#getting-an-api-key) below.

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

1. Sign up at [dwlf.co.uk](https://www.dwlf.co.uk)
2. Go to **Settings → API Keys**
3. Create a new key — it starts with `dwlf_sk_`
4. Set it as `DWLF_API_KEY` in your MCP client config

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DWLF_API_KEY` | Yes | — | Your DWLF API key (`dwlf_sk_...`) |
| `DWLF_API_URL` | No | `https://api.dwlf.co.uk` | API base URL |

## Tools

### Market Data
Get OHLCV candles, list symbols, support/resistance levels, and indicator events (crossovers, breakouts, divergences, candlestick patterns).

### Technical Indicators
RSI, MACD, EMA, Bollinger Bands, DSS, Ichimoku, trendlines, and more.

### Trade Signals
Active signals, signal history with P&L, and performance stats (win rate, avg return).

### Strategies
Create, update, compile, and browse visual trading strategies. List public community strategies.

### Backtesting
Run backtests (async), get results with Sharpe ratios, and aggregate performance summaries.

### Portfolio & Trade Journal
Portfolio holdings with P&L, historical snapshots, trade logging, notes, and plan templates.

### Symbol Activations
Activate symbols for event detection and strategy signal generation. Manage which symbols are actively monitored.

### Custom Events
Create custom indicator-based triggers (e.g. "DSS exits oversold with bullish cross").

### AI Summaries
Full account dashboard, single-symbol briefs, and strategy performance overviews — pre-aggregated for AI consumption.

### Academy
Browse educational tracks, read lessons, and search academy content.

## Example Prompts

```
"How's BTC looking right now?"
"Show me RSI and MACD for AAPL on the 4h chart"
"What active trade signals do we have?"
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

## License

[MIT](LICENSE) — DWLF / Andy Williams
