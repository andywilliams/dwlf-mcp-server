# Testing API Key Authentication

## Manual Verification

To verify that API key authentication works correctly and ensures account consistency between REST API and MCP:

### Step 1: Register a Test Account

```bash
curl -X POST https://api.dwlf.co.uk/v2/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test-agent@example.com",
    "agentId": "test-bot",
    "purpose": "Testing account linking"
  }' | jq '.'
```

Save the returned API key.

### Step 2: Create Strategy via REST API

```bash
export DWLF_API_KEY="dwlf_sk_..."  # Use the key from Step 1

curl -X POST https://api.dwlf.co.uk/v2/visual-strategies \
  -H "Authorization: ApiKey $DWLF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Strategy via REST",
    "description": "Testing account linking"
  }' | jq '.'
```

Note the strategy ID.

### Step 3: Configure MCP with Same API Key

Edit your MCP client config (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dwlf": {
      "command": "npx",
      "args": ["-y", "@dwlf/mcp-server"],
      "env": {
        "DWLF_API_KEY": "dwlf_sk_..."
      }
    }
  }
}
```

Restart your MCP client.

### Step 4: Verify via MCP

In Claude Desktop (or your MCP client), ask:

```
"List my DWLF strategies"
```

You should see "Test Strategy via REST" in the list.

### Step 5: Create Strategy via MCP

In your MCP client:

```
"Create a new DWLF strategy called 'Test Strategy via MCP'"
```

Note the returned strategy ID.

### Step 6: Verify via REST API

```bash
curl https://api.dwlf.co.uk/v2/visual-strategies \
  -H "Authorization: ApiKey $DWLF_API_KEY" | jq '.'
```

You should see both:
- "Test Strategy via REST" (created in Step 2)
- "Test Strategy via MCP" (created in Step 5)

### Expected Result

✅ Both strategies appear in both REST API and MCP queries
✅ Same account ID is used for both
✅ No "empty results" or missing strategies

## Automated Testing

To run automated verification:

```bash
#!/bin/bash
set -e

echo "Step 1: Register test account..."
RESPONSE=$(curl -s -X POST https://api.dwlf.co.uk/v2/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test-'$(date +%s)'@example.com",
    "agentId": "test-bot",
    "purpose": "Automated testing"
  }')

API_KEY=$(echo $RESPONSE | jq -r '.apiKey')
echo "✓ Got API key: ${API_KEY:0:20}..."

echo ""
echo "Step 2: Create strategy via REST..."
REST_RESPONSE=$(curl -s -X POST https://api.dwlf.co.uk/v2/visual-strategies \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "REST Test Strategy",
    "description": "Created via REST API"
  }')

REST_STRATEGY_ID=$(echo $REST_RESPONSE | jq -r '.id // .strategyId')
echo "✓ Created strategy: $REST_STRATEGY_ID"

echo ""
echo "Step 3: Verify strategy exists..."
LIST_RESPONSE=$(curl -s https://api.dwlf.co.uk/v2/visual-strategies \
  -H "Authorization: ApiKey $API_KEY")

if echo $LIST_RESPONSE | jq -e ".[] | select(.id == \"$REST_STRATEGY_ID\" or .strategyId == \"$REST_STRATEGY_ID\")" > /dev/null; then
  echo "✓ Strategy found in list"
else
  echo "✗ Strategy NOT found in list"
  exit 1
fi

echo ""
echo "Step 4: Get strategy details..."
DETAIL_RESPONSE=$(curl -s https://api.dwlf.co.uk/v2/visual-strategies/$REST_STRATEGY_ID \
  -H "Authorization: ApiKey $API_KEY")

if echo $DETAIL_RESPONSE | jq -e '.name == "REST Test Strategy"' > /dev/null; then
  echo "✓ Strategy details match"
else
  echo "✗ Strategy details don't match"
  exit 1
fi

echo ""
echo "✅ All tests passed!"
echo ""
echo "To test MCP, add this to your MCP config:"
echo "  DWLF_API_KEY: $API_KEY"
```

Save as `test-auth.sh` and run:

```bash
chmod +x test-auth.sh
./test-auth.sh
```

## Common Issues

### Issue: "401 Unauthorized"

**Cause**: API key not set or incorrect format.

**Fix**: Ensure `DWLF_API_KEY` is set correctly in environment or MCP config.

### Issue: "Strategies don't appear in REST API"

**Cause**: Using different API keys for MCP and REST.

**Fix**: Verify both are using the same key.

### Issue: "Warning: DWLF_API_KEY not set"

**Cause**: Environment variable not configured in MCP client.

**Fix**: Add `DWLF_API_KEY` to your MCP config's `env` section.

## Notes

- The MCP server uses **API key authentication only** (no OAuth, no default account)
- The API key determines which account is used
- Same API key = same account across REST and MCP
- No additional account linking step is needed
