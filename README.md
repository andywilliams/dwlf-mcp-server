# @dwlf/mcp-server

MCP (Model Context Protocol) server for the [DWLF](https://www.dwlf.co.uk) market analysis platform. Exposes DWLF's market data, technical indicators, trade signals, and watchlist as tools that AI assistants can use.

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
| `dwlf_get_market_data` | Get OHLCV candle data for a symbol (supports 1h, 4h, 1d intervals) |
| `dwlf_list_symbols` | List all available trading symbols with metadata |
| `dwlf_get_support_resistance` | Get support and resistance levels for a symbol |
| `dwlf_get_events` | Get indicator events (crossovers, breakouts, divergences) |

### Technical Indicators

| Tool | Description |
|------|-------------|
| `dwlf_get_indicators` | Get computed indicators (RSI, MACD, moving averages, Bollinger Bands, etc.) |
| `dwlf_get_trendlines` | Get automatically detected trendlines |

### Trade Signals

| Tool | Description |
|------|-------------|
| `dwlf_get_active_signals` | Get currently active trade signals |
| `dwlf_get_recent_signals` | Get recent signal history with P&L |
| `dwlf_get_signal_stats` | Get signal performance statistics (win rate, avg P&L) |

### Watchlist

| Tool | Description |
|------|-------------|
| `dwlf_get_watchlist` | Get the user's watchlist |
| `dwlf_add_to_watchlist` | Add a symbol to the watchlist |

### Resources

| Resource | URI | Description |
|----------|-----|-------------|
| Symbols | `dwlf://symbols` | Full symbol list with metadata |

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

## Example Prompts

Once connected, try asking your AI assistant:

- "What are the current support and resistance levels for BTC?"
- "Show me the RSI and MACD for AAPL on the 4h chart"
- "What active trade signals do we have?"
- "How are our signals performing? Show me the stats"
- "Add GOLD to my watchlist"
- "What symbols are available on DWLF?"

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
