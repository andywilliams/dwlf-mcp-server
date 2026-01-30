# DWLF MCP Cookbook

Multi-step AI workflows using the DWLF MCP tools. Each example shows the sequence of tool calls an agent would make, with key parameters. These work in Claude Desktop, Cursor, or any MCP client.

---

## 1. Analyze a Symbol

Full technical breakdown for a trading symbol — from raw candles to a synthesized market view.

**Goal:** "Give me a complete analysis of BTC"

### Tool sequence

```
1. dwlf_ai_symbol_brief
   symbol: "BTC"
   → Quick overview: price, change, key indicators, S/R, recent events

2. dwlf_get_market_data
   symbol: "BTC", interval: "1d", limit: 30
   → 30 daily candles for trend context

3. dwlf_get_indicators
   symbol: "BTC", interval: "4h"
   → RSI, MACD, EMA alignment, Bollinger Bands, DSS on the 4h

4. dwlf_get_support_resistance
   symbol: "BTC"
   → Key levels with confidence scores

5. dwlf_get_trendlines
   symbol: "BTC"
   → Auto-detected trendlines — direction, slope, touch points

6. dwlf_get_events
   symbol: "BTC", limit: 10
   → Recent crossovers, breakouts, divergences

7. dwlf_get_active_signals
   → Check if any strategies have active signals on BTC
```

### What the agent synthesizes

The AI now has everything to produce a market view:
- **Trend:** Multi-timeframe direction from candles + trendlines
- **Momentum:** RSI, MACD, DSS state (overbought/oversold, crossing)
- **Structure:** Where price sits relative to S/R levels
- **Events:** What's happened recently (breakouts, divergences)
- **Signals:** Whether any strategies are positioning

The `dwlf_ai_symbol_brief` (step 1) often covers enough for a quick answer. Steps 2–7 add depth when the user wants a full breakdown.

---

## 2. Build a Custom Event

Learn from the academy, then create and deploy a custom event that fires on specific indicator conditions.

**Goal:** "Create an event that fires when DSS exits oversold with a bullish cross"

### Tool sequence

```
1. dwlf_search_academy
   query: "custom events"
   → Find the relevant academy lesson

2. dwlf_get_academy_lesson
   slug: "custom-events"
   → Read the full lesson — learn condition types, gates, structure

3. dwlf_list_custom_events
   → See existing events for reference

4. dwlf_create_custom_event
   name: "DSS Bullish Exit Oversold"
   bodyJson: {
     "description": "Fires when DSS exits oversold zone with bullish cross",
     "conditions": {
       "gate": "THEN",
       "items": [
         {
           "type": "indicator_threshold",
           "indicator": "dss",
           "field": "stochastic",
           "operator": "lt",
           "value": 20
         },
         {
           "type": "indicator_cross",
           "indicator": "dss",
           "crossType": "bullish"
         }
       ]
     },
     "symbols": ["BTC-USD", "ETH-USD", "SOL-USD"]
   }
   → Creates the event definition

5. dwlf_compile_custom_event
   eventId: "<returned id>"
   → Compiles into executable form — validates conditions, ready to evaluate

6. dwlf_get_custom_event
   eventId: "<returned id>"
   → Verify the compiled event looks correct
```

### Key concepts

- **THEN gate:** First condition must be true, then second condition triggers the event. Perfect for "exits oversold" patterns (was below threshold, now crosses up).
- **AND gate:** All conditions must be true simultaneously.
- **OR gate:** Any condition triggers.
- **Compile step** is required — the event won't evaluate until compiled.
- Custom events can be used as building blocks in strategies.

---

## 3. Create and Backtest a Strategy

Build a visual trading strategy, compile it, backtest on historical data, and iterate.

**Goal:** "Create a Golden Cross strategy and see how it performs on BTC"

### Tool sequence

```
1. dwlf_search_academy
   query: "strategies"
   → Find academy content on strategy building

2. dwlf_list_public_strategies
   → Browse community strategies for inspiration

3. dwlf_create_strategy
   name: "Golden Cross EMA"
   description: "Long when EMA-50 crosses above EMA-200, exit on death cross"
   bodyJson: {
     "signals": [
       {
         "name": "Golden Cross Entry",
         "direction": "long",
         "conditions": {
           "gate": "AND",
           "items": [
             {
               "type": "indicator_cross",
               "indicator": "ema",
               "params": { "fast": 50, "slow": 200 },
               "crossType": "bullish"
             }
           ]
         }
       }
     ],
     "symbols": ["BTC-USD"]
   }
   → Creates the strategy

4. dwlf_compile_strategy
   strategyId: "<returned id>"
   → Compiles into executable form

5. dwlf_run_backtest
   strategyId: "<returned id>", symbol: "BTC"
   startDate: "2024-01-01", endDate: "2025-01-01"
   → Kicks off async backtest, returns requestId

6. dwlf_get_backtest_results
   requestId: "<returned id>"
   → Poll until status is "complete"
   → Returns: win rate, Sharpe ratio, total P&L, drawdown, trade list

7. dwlf_get_backtest_summary
   → See how this compares to your other backtests
```

### Iterating

If the results aren't great, the agent can:

```
8. dwlf_update_strategy
   strategyId: "<id>"
   → Add a filter (e.g., require RSI > 40 to avoid entries in downtrends)

9. dwlf_compile_strategy
   strategyId: "<id>"

10. dwlf_run_backtest
    strategyId: "<id>", symbol: "BTC"
    → Re-run with the updated conditions
```

The create → compile → backtest → tweak loop is the core workflow for strategy development.

---

## 4. Daily Trading Workflow

Morning routine: check everything, act on signals, log trades, journal.

**Goal:** "What's going on with my portfolio and signals today?"

### Tool sequence

```
1. dwlf_ai_dashboard
   → Single call: watchlist prices, active signals, open trades,
     portfolios, strategies, recent events

2. dwlf_ai_strategy_performance
   → All strategies with win rates, P&L, signal counts

3. dwlf_get_active_signals
   → Detailed view of current signals — entry/exit levels, strategy source

4. dwlf_get_signal_stats
   → Performance breakdown: win rate, avg P&L, risk/reward

5. dwlf_list_trades
   status: "open"
   → Review open positions
```

### Acting on a signal

If a signal looks good and you want to take the trade:

```
6. dwlf_ai_symbol_brief
   symbol: "ETH"
   → Quick check on the symbol's current state

7. dwlf_create_trade
   symbol: "ETH", direction: "long", entryPrice: 3200
   initialStop: 3050, initialTakeProfit: 3600
   reasonText: "Golden Cross signal + RSI rising from 45"
   → Logs the trade

8. dwlf_add_trade_note
   tradeId: "<id>", content: "Entry based on Golden Cross signal.
   S/R at 3050 as stop. 4h RSI at 45 and rising."
   → Documents the thesis
```

### End-of-day review

```
9. dwlf_list_trades
   status: "closed"
   → Check today's closed trades

10. dwlf_get_trade
    tradeId: "<id>"
    → Review a specific trade's full history

11. dwlf_add_trade_note
    tradeId: "<id>", content: "Closed for +8%. Held through
    morning dip — thesis played out. DSS confirmed momentum."
    → Journal the outcome and lessons
```

### What makes this powerful

The AI dashboard (step 1) replaces 5–6 manual API calls. One tool call gives the agent enough context to brief you on your entire trading state. From there, deeper dives are surgical — check a specific signal, log a trade, add a note.

Over time, the trade journal becomes a dataset the agent can reference: "What happened last time I took a Golden Cross entry on ETH?" The notes and execution history are all there.

---

## Tips

- **Start with AI summaries** (`dwlf_ai_dashboard`, `dwlf_ai_symbol_brief`) — they're designed to give agents maximum context in minimum tokens.
- **Always compile** after creating or updating strategies and custom events. They won't execute until compiled.
- **Backtests are async** — `dwlf_run_backtest` returns immediately. Poll `dwlf_get_backtest_results` until status is `"complete"`.
- **Use the academy** when you need to understand a concept. The agent can read lessons and apply what it learns to build strategies and events.
- **Symbol format** is flexible — `BTC`, `BTC/USD`, `BTC-USD`, `BTCUSD` all work. The server normalizes automatically.
