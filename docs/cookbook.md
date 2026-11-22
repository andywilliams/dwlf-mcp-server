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
   symbol: "BTC", timeframe: "daily", limit: 30
   → 30 daily candles for trend context

3. dwlf_get_indicators
   symbol: "BTC"
   → latest daily SMA/EMA 10/20/50/100/200 (moving averages only; DSS and
     Bollinger signals come from dwlf_get_events, the trend/momentum read from
     dwlf_get_regime)

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
- **Momentum:** DSS crosses and overbought/oversold events, plus the regime's momentum read
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
   → Creates the event definition and compiles it (a graph that will not compile is refused with 400)

5. dwlf_activate_event_symbols
   eventId: "<returned id>", symbols: ["BTC-USD", "ETH-USD", "SOL-USD"]
   → REQUIRED: an event with no activated symbols never evaluates

6. dwlf_evaluate_custom_event
   eventId: "<returned id>"
   → Fills its history; poll dwlf_get_evaluation_status, then read fires with dwlf_get_events (type `custom_event`)

7. dwlf_get_event_symbols
   eventId: "<returned id>"
   → Its `health` line says whether it is really running (from the nightly coverage check)
```

### Key concepts

- **THEN gate:** First condition must be true, then second condition triggers the event. Perfect for "exits oversold" patterns (was below threshold, now crosses up).
- **AND gate:** All conditions must be true simultaneously.
- **OR gate:** Any condition triggers.
- **No separate compile step:** saving compiles. `dwlf_compile_custom_event` only recompiles a legacy event (activation answers 422 `EVENT_NOT_COMPILED`). **Activation is required**: the event won't evaluate until symbols are activated.
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

## 5. Save What You're Waiting For (Theses)

A thesis is what a user is waiting for on one symbol, in their own words: ordered steps of conditions DWLF detects itself, optional invalidations, their context and next step. DWLF checks it once a night after the close and tells the user when a step is met or the thesis is challenged.

**What it saves the user:** deciding once, after the close, instead of re-checking charts every day; being told when it happens (Telegram digest if set up, an in-app notification, the fires feed); honest timing (each event says when DWLF could first know it, and nothing known before saving counts). **Limits:** end of day, not intraday; information, not advice.

### Tool sequence

```
1. dwlf_thesis_guide                         → what, benefits, limits, rules, four worked examples
2. dwlf_list_thesis_condition_types          → the seven types, their fields and where each may go (only these exist)
3. dwlf_create_thesis { ..., dryRun: true }  → read every restatement in `checks` back to the user
4. dwlf_create_thesis { ... }                → save what the user confirmed
5. dwlf_list_theses { includeProgress: true } → how close each is; `closest` to sort by
6. dwlf_list_thesis_fires { cursor }         → what happened since you last looked (keep the cursor)
7. dwlf_review_thesis { answer }             → the user's answer to a challenged thesis: keep / revise / close
8. dwlf_revise_thesis { ..., dryRun: true } → a change, checked first: only the changed conditions are judged
9. dwlf_get_thesis_story { thesisId }        → the thesis told in beats: what happened, where it stands, what it needs
10. dwlf_get_thesis_story { thesisId, replay: true } → once a step is met: the plan as drawn against what happened
```

### Voided by time: window_closes

A thesis that waits for a cycle window and has no price that would prove it wrong (gold and the miners, typically) can be voided by time, only when the user asks for it: an invalidation `window_closes` on the window's timeframe and side. It is checked against the STORED window's close date (the window measured from the last pivot when saved), decided 28 days (weekly) or 7 days (daily) after the closing bar, once a late-published confirmation can no longer arrive; a pivot confirmed after the close does not count. It is an invalidation only (the schema refuses it in a step), and progress gives `windowCloses`, `windowEnds` and `closesInDays`. Never invent a price level for such a thesis. (eval: `eval/theses`, the window_closes scenario)

### Telling a thesis's story

`dwlf_get_thesis_story` returns the beats (chosen by rule: saved, revisions, the windows, the engine events the conditions name, the fires; then now; then what each unmet step needs), each with a plain `sentence`, `knowableAt`, `checkedAs` and `means`, plus the plan as drawn when the revision was saved and a `deepLink` to the same story on the site. `dwlf_list_theses { includeStory: true }` gives one line per thesis (`storySummary`).

Tell it from the beats' own facts: what happened, and what the thesis needs next. A needs-next beat says what would meet a step, never that it will happen; don't add prices the story doesn't hold. For a GOOG thesis on 20 Nov (its challenge: a daily close below the latest confirmed daily low, set 20 Nov): *"It is waiting: no step met yet. The 5 Nov daily cycle low (known 11 Nov) failed on 19 Nov with a daily close below it; that came before the challenge was set, so it does not count against the thesis. GOOG is inside its weekly cycle low window (opened 26 Oct, closes about 4 Jan; the dates are engine estimates, unverified). Step 1 needs the next confirmed daily cycle low; then step 2 needs a higher daily low or a bullish daily trend-line break. A daily close below the latest confirmed daily low from here would challenge it."* (eval: `eval/thesis-story`)

**Illustrated routes.** `current.routes` holds one route that meets the remaining steps and one per way the thesis could be challenged, both or none (`current.routeNote` says why none). They are illustrations drawn from the conditions and the symbol's past cycles, never forecasts: describe them by what each leg was drawn from (`legs[].basis`: a window edge, a depth-band percentile, the condition's level), quote `illustration.disclaimer.text`, never present a vertex's price as a level price will reach, and never rank the routes. For GOOG: *"As an illustration, not a forecast: one shape that meets step 1 is a low near the daily window's centre (about 7 Jan), within the range past daily lows fell to; one way it could be challenged is a daily close below that next low."*

**Replay.** Once a step is met or the thesis has an outcome, `dwlf_get_thesis_story { thesisId, replay: true }` adds `replay`: the plan as drawn told against what happened. `met[]` puts the date each step was met beside the date its plan had illustrated it; `windows[]` sets each window as drawn beside today's (`redrawn`); `beats[]` runs the save, each fire (with its checkpoint, the plan just after it) and revision, then the outcome. `replaySummary` (always present) is one sentence of facts to quote. Tell it as two dates side by side, never as a difference, and never score the illustration (no right, wrong, early or late: it was never a forecast). Say "reconstructed after the fact" when `replay.asDrawn.reconstructed` is true, and say so when a beat notes no plan or no checkpoint was captured. For MSTR: *"Saved 18 Nov. Step 1 met 19 Nov (a daily close below $90). Complete after 1 day. The plan it is replayed against was reconstructed on 21 Nov, not captured at the time."*

### Worked example: the next confirmed daily low, then a higher low or a trend-line break

The user: *"Tell me when GOOG puts in its next confirmed daily low after the 5 Nov one, and after that either a higher daily low or a bullish daily trend-line break. If the weekly low breaks, I want to know."*

```json
{
  "symbol": "GOOG",
  "title": "GOOG: the next confirmed daily cycle low, then a higher daily low or a bullish daily trend-line break",
  "context": "The 5 Nov daily low failed on 19 Nov. I want the next daily low confirmed first, then a sign the decline is over.",
  "steps": [
    { "match": "any", "conditions": [
      { "type": "pivot_confirmed", "timeframe": "daily", "side": "low", "after": "2026-11-05", "label": "Next confirmed daily cycle low (any price)" } ] },
    { "match": "any", "conditions": [
      { "type": "engine_event", "timeframe": "daily", "eventType": "cycle.low.higher_low", "label": "A higher daily cycle low" },
      { "type": "trendline_break", "timeframe": "daily", "direction": "bullish", "label": "Daily bullish trend-line break" } ] }
  ],
  "invalidation": [
    { "type": "engine_event", "timeframe": "weekly", "eventType": "cycle.low.break", "label": "The latest confirmed weekly cycle low breaks" }
  ]
}
```

- `after` makes step 1 "the next pivot after the one I already know of".
- The invalidation is `cycle.low.break`, not "a close below the new low": that low doesn't exist yet when the thesis is saved.
- Every label says exactly what its fields check. DWLF checks the fields, never the label.

More examples (a level-based one, and watching QQQ for a CNX1 thesis) are in `dwlf_thesis_guide`.

## Tips

- **Start with AI summaries** (`dwlf_ai_dashboard`, `dwlf_ai_symbol_brief`) — they're designed to give agents maximum context in minimum tokens.
- **Always compile** after creating or updating strategies: they won't execute until compiled. Custom events compile when saved; activate their symbols.
- **Backtests are async** — `dwlf_run_backtest` returns immediately. Poll `dwlf_get_backtest_results` until status is `"complete"`.
- **Use the academy** when you need to understand a concept. The agent can read lessons and apply what it learns to build strategies and events.
- **Symbol format** is flexible — `BTC`, `BTC/USD`, `BTC-USD`, `BTCUSD` all work. The server normalizes automatically.
