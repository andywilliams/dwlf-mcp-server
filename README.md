# @dwlf/mcp-server

MCP server for the [DWLF](https://www.dwlf.co.uk) market analysis platform. 43 tools that turn market noise into semantic data that AI agents can reason about — candles, indicators, support/resistance, events, strategies, backtests, portfolios, trade journals, and more.

Works with Claude Desktop, Cursor, VS Code, and any MCP-compatible client.

## Quick Start

```bash
# Clone and build
git clone https://github.com/dwlf-ai/dwlf-mcp-server.git
cd dwlf-mcp-server
npm install
npm run build

# Run
DWLF_API_KEY=dwlf_sk_your_key_here node dist/index.js
```

Or for development:

```bash
DWLF_API_KEY=dwlf_sk_your_key_here npm run dev
```

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `DWLF_API_KEY` | Yes | — | Your DWLF API key (starts with `dwlf_sk_`) |
| `DWLF_API_URL` | No | `https://api.dwlf.co.uk` | DWLF API base URL |

## Available Tools

### Market Data

| Tool | Description |
|------|-------------|
| `dwlf_get_market_data` | Get OHLCV candle data for a symbol (1h, 4h, 1d intervals) |
| `dwlf_list_symbols` | List all available trading symbols with metadata |
| `dwlf_get_support_resistance` | Get support and resistance levels with confidence scores |
| `dwlf_get_events` | Get indicator events — crossovers, breakouts, divergences, candlestick patterns |

### Technical Indicators

| Tool | Description |
|------|-------------|
| `dwlf_get_indicators` | Get computed indicators (RSI, MACD, EMA, Bollinger Bands, DSS, Ichimoku, etc.) |
| `dwlf_get_trendlines` | Get auto-detected trendlines with slope and touch points |

### Trade Signals

| Tool | Description |
|------|-------------|
| `dwlf_get_active_signals` | Get currently active signals (open positions / pending entries) |
| `dwlf_get_recent_signals` | Get signal history with entry/exit prices and P&L |
| `dwlf_get_signal_stats` | Get signal performance — win rate, avg P&L, total signals |

### Strategies

| Tool | Description |
|------|-------------|
| `dwlf_list_strategies` | List your visual trading strategies |
| `dwlf_get_strategy` | Get full strategy details — signal definitions, nodes, edges |
| `dwlf_create_strategy` | Create a new visual trading strategy |
| `dwlf_update_strategy` | Update an existing strategy |
| `dwlf_compile_strategy` | Compile a strategy into an executable trade signal |
| `dwlf_list_public_strategies` | Browse community-shared public strategies |

### Backtesting

| Tool | Description |
|------|-------------|
| `dwlf_run_backtest` | Run a backtest (async — returns requestId) |
| `dwlf_get_backtest_results` | Get results for a backtest by requestId |
| `dwlf_list_backtests` | List all backtests with status and summary |
| `dwlf_get_backtest_summary` | Get aggregated performance stats across backtests |

### Portfolio

| Tool | Description |
|------|-------------|
| `dwlf_list_portfolios` | List your portfolios |
| `dwlf_get_portfolio` | Get portfolio details including holdings |
| `dwlf_get_holdings` | Get detailed holdings with current values and P&L |
| `dwlf_get_portfolio_snapshots` | Get historical portfolio value over time |

### Trade Journal

| Tool | Description |
|------|-------------|
| `dwlf_list_trades` | List trades, filter by status (open/closed) or symbol |
| `dwlf_get_trade` | Get full trade details — notes, executions, events |
| `dwlf_create_trade` | Log a new trade (symbol, direction, entry, stop, TP) |
| `dwlf_close_trade` | Close an open trade with exit price |
| `dwlf_add_trade_note` | Add a note to a trade — observations, adjustments, lessons |
| `dwlf_get_trade_notes` | Get all notes for a trade |
| `dwlf_list_trade_plans` | List reusable trade plan templates |
| `dwlf_get_trade_state` | Get current trade state — execution history and adjustments |

### Custom Events

| Tool | Description |
|------|-------------|
| `dwlf_list_custom_events` | List your custom event definitions |
| `dwlf_get_custom_event` | Get event details including conditions and trigger history |
| `dwlf_create_custom_event` | Create a new custom event (indicator-based triggers) |
| `dwlf_compile_custom_event` | Compile a custom event into an executable definition |

### AI Summaries

| Tool | Description |
|------|-------------|
| `dwlf_ai_dashboard` | Full account overview — watchlist, signals, trades, portfolios, strategies, events |
| `dwlf_ai_symbol_brief` | Condensed single-symbol view — price, indicators, S/R, events, signals |
| `dwlf_ai_strategy_performance` | All strategies with signal stats, win rates, and P&L breakdowns |

### Academy

| Tool | Description |
|------|-------------|
| `dwlf_list_academy_tracks` | List all educational tracks and lessons |
| `dwlf_get_academy_lesson` | Get full lesson content (markdown) by slug |
| `dwlf_search_academy` | Search academy content by keyword |

### Resources

| Resource | URI | Description |
|----------|-----|-------------|
| Symbols | `dwlf://symbols` | Full symbol list with metadata |

## Example Prompts

Once connected, try asking your AI assistant:

```
# Market analysis
"How's BTC looking right now?"
"Show me the RSI and MACD for AAPL on the 4h chart"
"What are the support and resistance levels for TSLA?"
"What events have fired for ETH recently?"

# Signals & strategies
"What active trade signals do we have?"
"How are our signals performing? Show me the win rate"
"List my strategies and their performance"
"Browse public strategies for inspiration"

# Strategy building
"Create a Golden Cross strategy using EMA 50/200"
"Backtest my Trend Momentum strategy on NVDA over the last year"
"Show me the backtest results — what's the Sharpe ratio?"

# Portfolio & trades
"Show me my portfolio holdings and P&L"
"Log a long on ETH at 3,200 with a stop at 3,050"
"Add a note to my last BTC trade: 'Held through consolidation, thesis intact'"
"Close my TSLA trade at 285"

# Custom events
"Create a custom event that fires when DSS exits oversold with a bullish cross"
"List my custom events and their recent triggers"

# Academy
"What does the academy teach about composability?"
"Show me the lesson on custom events"
"Search the academy for DSS indicator content"
```

## Cookbook

For end-to-end multi-step workflows, see **[docs/cookbook.md](docs/cookbook.md)**.

Quick summary of what's covered:

1. **Analyze a Symbol** — full technical breakdown from candles to AI summary
2. **Build a Custom Event** — learn from academy, create, compile, deploy
3. **Create and Backtest a Strategy** — build → compile → test → iterate
4. **Daily Trading Workflow** — dashboard → signals → trades → journal

## Client Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "node",
      "args": ["/path/to/dwlf-mcp-server/dist/index.js"],
      "env": {
        "DWLF_API_KEY": "dwlf_sk_your_key_here"
      }
    }
  }
}
```

### Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "node",
      "args": ["/path/to/dwlf-mcp-server/dist/index.js"],
      "env": {
        "DWLF_API_KEY": "dwlf_sk_your_key_here"
      }
    }
  }
}
```

### VS Code

Add to your VS Code settings or `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "dwlf": {
        "command": "node",
        "args": ["/path/to/dwlf-mcp-server/dist/index.js"],
        "env": {
          "DWLF_API_KEY": "dwlf_sk_your_key_here"
        }
      }
    }
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in dev mode (with tsx)
npm run dev

# Test MCP handshake
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}},"id":1}' | DWLF_API_KEY=test node dist/index.js
```

## License

MIT
