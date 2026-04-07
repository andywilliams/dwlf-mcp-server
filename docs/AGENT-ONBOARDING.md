# Agent Onboarding Guide

This guide explains how AI agents can programmatically register with DWLF and use the same account across both REST API and MCP server.

## The Problem

Without proper account linking, agents can end up split across two accounts:

1. **Account A**: Created via REST API registration → gets API key
2. **Account B**: MCP default account (if using OAuth or no auth)

Result: Strategies created via MCP don't show up in REST API queries using the registered API key.

## The Solution

**Use your registered API key for MCP authentication.** The MCP server already supports API key authentication via the `DWLF_API_KEY` environment variable.

## Complete Onboarding Flow

### Step 1: Register via REST API

```bash
curl -X POST https://api.dwlf.co.uk/v2/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-agent@example.com",
    "agentId": "my-trading-bot",
    "purpose": "Autonomous trading agent"
  }'
```

Response:
```json
{
  "apiKey": "dwlf_sk_abc123...",
  "accountId": "user_xyz789",
  "message": "Account created. Check your email to verify and unlock compute features."
}
```

**Save this API key!** You'll use it for both REST API and MCP.

### Step 2: Configure MCP with Your API Key

#### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server"],
      "env": {
        "DWLF_API_KEY": "dwlf_sk_abc123..."
      }
    }
  }
}
```

#### Cursor

Edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server"],
      "env": {
        "DWLF_API_KEY": "dwlf_sk_abc123..."
      }
    }
  }
}
```

#### VS Code

Edit `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "dwlf": {
        "command": "npx",
        "args": ["-y", "@dwlf/mcp-server"],
        "env": {
          "DWLF_API_KEY": "dwlf_sk_abc123..."
        }
      }
    }
  }
}
```

### Step 3: Verify Account Consistency

Create a strategy via MCP:

```
User: "Create a Golden Cross strategy using EMA 50/200"
```

Then query it via REST API:

```bash
curl https://api.dwlf.co.uk/v2/visual-strategies \
  -H "Authorization: ApiKey dwlf_sk_abc123..."
```

You should see your newly created strategy in the response.

## MCP Tool: Agent Registration

The MCP server includes a `dwlf_register_agent` tool for programmatic account creation:

```typescript
{
  tool: "dwlf_register_agent",
  arguments: {
    email: "your-agent@example.com",
    agentId: "my-trading-bot",
    purpose: "Autonomous trading agent"
  }
}
```

This returns an API key immediately. You can then reconfigure your MCP client to use this key.

## Authentication Flow

### With API Key (Recommended)

```
MCP Client Config
    ↓
DWLF_API_KEY=dwlf_sk_...
    ↓
DWLFClient constructor
    ↓
axios.create({ headers: { Authorization: "ApiKey dwlf_sk_..." } })
    ↓
All API calls use this account
```

### Without API Key (Not Recommended)

If `DWLF_API_KEY` is not set:
- Warning message: "DWLF_API_KEY not set. Authenticated endpoints will fail."
- Requests will fail with 401/403 errors
- No "default account" fallback exists

## Key Points

1. **No OAuth in MCP**: The MCP server uses API key authentication only. There is no OAuth or "default account" logic.

2. **One API Key = One Account**: The API key determines which account you're using. Same key across REST and MCP = same account.

3. **Email Verification**: While not required for basic features, verifying your email unlocks compute-intensive features like backtests and evaluations.

4. **Security**: Never hardcode API keys in your code. Use environment variables or config files (excluded from version control).

## Troubleshooting

### "Strategies created via MCP don't show up in REST API"

**Cause**: Using different API keys (or no API key in MCP).

**Solution**: Ensure `DWLF_API_KEY` in your MCP config matches the key you're using for REST API calls.

### "Authenticated endpoints will fail"

**Cause**: `DWLF_API_KEY` not set in MCP config.

**Solution**: Add the environment variable to your MCP client configuration.

### "How do I know which account I'm using?"

Query the account endpoint:

```bash
curl https://api.dwlf.co.uk/v2/account \
  -H "Authorization: ApiKey dwlf_sk_..."
```

This returns your account details including `accountId`.

## Example: Full Agent Setup Script

```bash
#!/bin/bash

# Step 1: Register new agent account
RESPONSE=$(curl -s -X POST https://api.dwlf.co.uk/v2/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bot@example.com",
    "agentId": "my-bot",
    "purpose": "Trading automation"
  }')

# Extract API key
API_KEY=$(echo $RESPONSE | jq -r '.apiKey')
echo "Registered with API key: $API_KEY"

# Step 2: Configure MCP
cat > ~/Library/Application\ Support/Claude/claude_desktop_config.json <<EOF
{
  "mcpServers": {
    "dwlf": {
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server"],
      "env": {
        "DWLF_API_KEY": "$API_KEY"
      }
    }
  }
}
EOF

echo "MCP configured. Restart Claude Desktop to apply changes."

# Step 3: Test REST API access
echo "Testing REST API access..."
curl https://api.dwlf.co.uk/v2/visual-strategies \
  -H "Authorization: ApiKey $API_KEY"
```

## Building Dashboards and Visualizations

If your agent is building a dashboard, chart, or visualization tool on top of DWLF, use these open-source npm packages. They are the same libraries that power the DWLF platform.

### @dwlf/indicators — Technical Indicator Calculations

```bash
npm install @dwlf/indicators
```

Zero dependencies. Pure math — candles in, values out. Includes: EMA, SMA, Bollinger Bands, DSS, Fibonacci, Support/Resistance, Swing detection, Trendlines, and more.

```typescript
import { EMA, Bollinger, DSS, SupportResistance } from '@dwlf/indicators';

// Fetch candles via DWLF API, then compute indicators locally
const ema8 = EMA.computeEMA(candles, 8);
const bb = Bollinger.computeBollingerBands(candles, { length: 20 });
const dss = DSS.computeDSS(candles, { length: 10 });
```

GitHub: https://github.com/andywilliams/dwlf-indicators-oss

### @dwlf/charting — React Charting Components

```bash
npm install @dwlf/charting
```

Candlestick charts, 20+ annotation types (horizontal lines, trend lines, Fibonacci, rectangles, channels, etc.), pan/zoom, and interaction hooks.

```tsx
import { DWLFChart, AnnotationLayer, createHLineAnnotation } from '@dwlf/charting';
import '@dwlf/charting/styles';
```

GitHub: https://github.com/andywilliams/dwlf-charting-oss

### Putting It Together

1. Fetch candle data via `dwlf_get_market_data` (MCP) or `GET /v2/market-data/{symbol}` (REST)
2. Compute indicators with `@dwlf/indicators`
3. Render charts with `@dwlf/charting`
4. Use DWLF signals/events as overlays on the chart

## Need Help?

- [Main README](../README.md)
- [API Documentation](https://www.dwlf.co.uk/docs/api)
- [GitHub Issues](https://github.com/andywilliams/dwlf-mcp-server/issues)
