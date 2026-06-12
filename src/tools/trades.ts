import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DWLFClient, normalizeSymbol } from '../client.js';

export function registerTradeTools(
  server: McpServer,
  client: DWLFClient
) {
  // 1. List trades
  server.tool(
    'dwlf_list_trades',
    'List trades from the trade journal. Filter by status or symbol. Statuses: ' +
      '`open` (live position), `closed` (exited, has P&L), `planned` (confirm-mode signal awaiting confirm/skip), ' +
      '`skipped` (passed signal — carries skipReasons[]/skipNote). Omit `status` to get ALL statuses. ' +
      'Use `status: "skipped"` to review the skip journal (which signals you passed and why).',
    {
      status: z
        .enum(['open', 'closed', 'planned', 'skipped'])
        .optional()
        .describe('Filter by trade status. Omit for all. planned/skipped are served from the base table (they lack entryAt so aren\'t in the StatusIndex GSI).'),
      symbol: z.string().optional().describe('Filter by symbol (e.g. BTC, TSLA)'),
    },
    async ({ status, symbol }) => {
      try {
        const params: Record<string, unknown> = {};
        if (status) params.status = status;
        if (symbol) params.symbol = normalizeSymbol(symbol);

        const data = await client.get('/trades', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 2. Get trade details
  server.tool(
    'dwlf_get_trade',
    'Get full details for a specific trade including notes, executions, and events.',
    {
      tradeId: z.string().describe('Trade ID'),
    },
    async ({ tradeId }) => {
      try {
        const data = await client.get(`/trades/${tradeId}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 3. Create trade
  server.tool(
    'dwlf_create_trade',
    'Log a new trade in the journal. Specify symbol, direction, entry price, and optional stop loss / take profit.',
    {
      symbol: z.string().describe('Trading symbol (e.g. BTC, TSLA, RIOT)'),
      direction: z.enum(['long', 'short']).describe('Trade direction'),
      entryPrice: z.number().describe('Entry price'),
      positionSize: z.number().optional().describe('Position size (quantity)'),
      initialStop: z.number().optional().describe('Stop loss price'),
      initialTakeProfit: z.number().optional().describe('Take profit price'),
      timeframe: z.string().optional().describe('Timeframe (e.g. 1d, 4h, 1h)'),
      reasonText: z.string().optional().describe('Trade reasoning / thesis'),
      isPaperTrade: z.boolean().optional().describe('Whether this is a paper trade (default: false)'),
      assetType: z.enum(['crypto', 'equity', 'forex']).optional().describe('Asset type'),
    },
    async ({ symbol, direction, entryPrice, positionSize, initialStop, initialTakeProfit, timeframe, reasonText, isPaperTrade, assetType }) => {
      try {
        const body: Record<string, unknown> = {
          assetSymbol: normalizeSymbol(symbol),
          direction,
          entryPrice,
          entryAt: new Date().toISOString(),
        };
        if (positionSize !== undefined) body.positionSize = positionSize;
        if (initialStop !== undefined) body.initialStop = initialStop;
        if (initialTakeProfit !== undefined) body.initialTakeProfit = initialTakeProfit;
        if (timeframe) body.timeframe = timeframe;
        if (reasonText) body.reasonText = reasonText;
        if (isPaperTrade !== undefined) body.isPaperTrade = isPaperTrade;
        if (assetType) body.assetType = assetType;

        const data = await client.post('/trades', body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 4. Close trade
  server.tool(
    'dwlf_close_trade',
    'Close an open trade by specifying the exit price.',
    {
      tradeId: z.string().describe('Trade ID to close'),
      exitPrice: z.number().describe('Exit price'),
      exitAt: z.string().optional().describe('Exit timestamp (ISO 8601, defaults to now)'),
    },
    async ({ tradeId, exitPrice, exitAt }) => {
      try {
        const body: Record<string, unknown> = { exitPrice };
        if (exitAt) body.exitAt = exitAt;

        const data = await client.post(`/trades/${tradeId}/close`, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 5. Add trade note
  server.tool(
    'dwlf_add_trade_note',
    'Add a note to an existing trade — observations, adjustments, lessons learned.',
    {
      tradeId: z.string().describe('Trade ID'),
      content: z.string().describe('Note content'),
    },
    async ({ tradeId, content }) => {
      try {
        // Backend tradeNotesHandler.createNote requires `text` (see
        // serverless-portfolio-tracker src/handlers/tradeNotesHandler.js).
        // The MCP-facing parameter is `content` for consumer-friendliness
        // (matches MCP convention for note bodies elsewhere); map on the
        // wire to avoid breaking callers of this tool.
        const data = await client.post(`/trades/${tradeId}/notes`, { text: content });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 6. Get trade notes
  server.tool(
    'dwlf_get_trade_notes',
    'Get all notes for a trade — observations, updates, and lessons recorded during the trade.',
    {
      tradeId: z.string().describe('Trade ID'),
    },
    async ({ tradeId }) => {
      try {
        const data = await client.get(`/trades/${tradeId}/notes`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 7. List trade plans
  server.tool(
    'dwlf_list_trade_plans',
    'List trade plan templates — reusable frameworks for entering trades.',
    {},
    async () => {
      try {
        const data = await client.get('/trade-plans');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 7. Update trade
  server.tool(
    'dwlf_update_trade',
    'Update an existing trade by ID. All fields except tradeId are optional (partial update).',
    {
      tradeId: z.string().describe('Trade ID'),
      symbol: z.string().optional().describe('Trading symbol'),
      direction: z.enum(['long', 'short']).optional().describe('Trade direction'),
      entryPrice: z.number().optional().describe('Entry price'),
      stopLoss: z.number().optional().describe('Stop loss price'),
      takeProfit: z.number().optional().describe('Take profit price'),
      quantity: z.number().optional().describe('Position size'),
      notes: z.string().optional().describe('Trade notes'),
      tags: z.array(z.string()).optional().describe('Tags for the trade'),
      isPaperTrade: z.boolean().optional().describe('Whether this is a paper trade'),
    },
    async ({ tradeId, symbol, direction, entryPrice, stopLoss, takeProfit, quantity, notes, tags, isPaperTrade }) => {
      try {
        const body: Record<string, unknown> = {};
        if (symbol) body.symbol = normalizeSymbol(symbol);
        if (direction) body.direction = direction;
        if (entryPrice !== undefined) body.entryPrice = entryPrice;
        if (stopLoss !== undefined) body.stopLoss = stopLoss;
        if (takeProfit !== undefined) body.takeProfit = takeProfit;
        if (quantity !== undefined) body.quantity = quantity;
        if (notes) body.notes = notes;
        if (tags) body.tags = tags;
        if (isPaperTrade !== undefined) body.isPaperTrade = isPaperTrade;

        const data = await client.put(`/trades/${tradeId}`, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 8. Delete trade
  server.tool(
    'dwlf_delete_trade',
    'Delete a trade by ID.',
    {
      tradeId: z.string().describe('Trade ID'),
    },
    async ({ tradeId }) => {
      try {
        const data = await client.delete(`/trades/${tradeId}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 9. Position size calculator
  server.tool(
    'dwlf_position_size',
    'Calculate recommended position size based on account size, risk percentage, entry price, and stop loss.',
    {
      accountSize: z.number().describe('Total account size in currency'),
      riskPercent: z.number().describe('Risk percentage (e.g. 1 for 1%)'),
      entryPrice: z.number().describe('Planned entry price'),
      stopLoss: z.number().describe('Stop loss price'),
      symbol: z.string().optional().describe('Trading symbol for context'),
    },
    async ({ accountSize, riskPercent, entryPrice, stopLoss, symbol }) => {
      try {
        const body: Record<string, unknown> = {
          accountSize,
          riskPercent,
          entryPrice,
          stopLoss,
        };
        if (symbol) body.symbol = normalizeSymbol(symbol);

        const data = await client.post('/tools/position-size', body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 10. Get trade state
  server.tool(
    'dwlf_get_trade_state',
    'Get the current state of a trade — including execution history and adjustments.',
    {
      tradeId: z.string().describe('Trade ID'),
    },
    async ({ tradeId }) => {
      try {
        const data = await client.get(`/trades/${tradeId}/state`);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 11. Counterfactual scorecard for skipped trades
  server.tool(
    'dwlf_get_skip_outcomes',
    'The Counterfactual scorecard: what would have happened had each SKIPPED trade been ' +
      'taken. Every skip is replayed against daily candles from its signal date using the ' +
      'decision-time-frozen entry/SL/TP (pre-registered — no hindsight bias). Per outcome: ' +
      'status (`would_be_stopped` capped at exactly -1R / `would_hit_target` / `running` = open ' +
      'mark), `counterfactualR`, `savedR` (= -R: positive means the skip SAVED money), move %, ' +
      'MFE/MAE in R, skip reasons + note. Aggregates: per-skip-reason and per-strategy rollups ' +
      'plus the cumulative saved-R series ("is the discretionary overlay adding edge"). ' +
      'Assumes MECHANICAL execution of the planned levels — no discretionary management; ' +
      'same-bar stop+target counts the stop first (flagged `ambiguousBar`). ' +
      'Pairs with dwlf_list_trades(status:"skipped") and dwlf_skip_trade. ' +
      'UI equivalent: https://www.dwlf.co.uk/trades/counterfactual',
    {},
    async () => {
      try {
        const data = await client.get('/trades/skip-outcomes');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 12. Decision-quality ledger (takes + skips judged together)
  server.tool(
    'dwlf_get_decision_stats',
    'The decision-quality ledger: TAKES (confirmed trades, judged by actual outcomes — ' +
      'closed realized R, open marks vs initial risk) and SKIPS (judged by the counterfactual ' +
      'replay) joined into one record. Returns: the 2x2 decision `matrix` (tookRight/tookWrong/' +
      'skipRight/skipWrong, with open takes and running skips as unjudged open counts), ' +
      '`byStrategy` records (W/L, net realized R, net open R, skips + saved R), and per-reason ' +
      'hit rates for BOTH vocabularies (`byConfirmReason`, `bySkipReason`) — use these to tell ' +
      'the user which of their stated reasons carry alpha (e.g. "your regime_risk_off skips ' +
      'are 3-for-3, +3R saved"). Honesty: only resolved outcomes are judged; paper trades ' +
      'excluded; legacy trades without a genuine numeric R are judged by P&L sign and counted ' +
      'in `rUnknown` (they contribute no R magnitude). ' +
      'UI equivalent: https://www.dwlf.co.uk/trades/decisions',
    {},
    async () => {
      try {
        const data = await client.get('/trades/decision-stats');
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 12. Confirm (take) a planned trade
  server.tool(
    'dwlf_confirm_trade',
    'Confirm (take) a confirm-mode PLANNED trade — turns it into an OPEN position. ' +
      'Only trades with status "planned" can be confirmed. By default it opens at the ' +
      'planned entryPrice / positionSize and stamps entryAt=now; override any of them to ' +
      'reflect your actual fill. STRONGLY RECOMMENDED: pass confirmReasons[] — WHY the ' +
      'trade is being taken (the symmetric twin of skip reasons; feeds the Counterfactual ' +
      'scorecard / 2x2 decision analytics). Valid confirmReasons: fresh_cycle_entry, ' +
      'trendline_break_confirmed, cluster_confluence, regime_aligned, ' +
      'risk_reward_attractive, adding_to_winner, other. confirmNote is required when a ' +
      'reason is "other". Reasons are optional (untagged confirms still work) but every ' +
      'untagged confirm is decision-analytics data lost. Pair with dwlf_skip_trade to ' +
      'pass instead. Find planned trades via dwlf_list_trades(status: "planned").',
    {
      tradeId: z.string().describe('Planned trade ID to confirm/take'),
      entryPrice: z.number().optional().describe('Actual entry/fill price (defaults to the planned entryPrice)'),
      positionSize: z.number().optional().describe('Actual position size / quantity (defaults to the planned size)'),
      entryAt: z.string().optional().describe('Entry timestamp, ISO 8601 (defaults to now)'),
      confirmReasons: z
        .array(z.string())
        .optional()
        .describe('WHY the trade is taken (multi-select; see tool description for the valid set). First = primary.'),
      confirmNote: z.string().optional().describe('Entry rationale note (max 500 chars). Required when a reason is "other".'),
    },
    async ({ tradeId, entryPrice, positionSize, entryAt, confirmReasons, confirmNote }) => {
      try {
        const body: Record<string, unknown> = {};
        if (entryPrice !== undefined) body.entryPrice = entryPrice;
        if (positionSize !== undefined) body.positionSize = positionSize;
        if (entryAt) body.entryAt = entryAt;
        if (confirmReasons && confirmReasons.length) body.confirmReasons = confirmReasons;
        if (confirmNote) body.confirmNote = confirmNote;

        const data = await client.post(`/trades/${tradeId}/confirm`, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // 13. Skip (pass on) a planned trade
  server.tool(
    'dwlf_skip_trade',
    'Skip (pass on) a confirm-mode PLANNED trade, recording WHY. Moves it to status ' +
      '"skipped" with skipReasons[] + an optional skipNote — this feeds the skip journal / ' +
      'scorecard (dwlf_list_trades(status: "skipped")). Only planned trades can be skipped. ' +
      'Valid skipReasons: entry_extended_from_anchor, risk_reward_poor, thesis_already_played_out, ' +
      'low_conviction_signal, regime_risk_off, correlated_exposure, account_drawdown_pause, ' +
      'broker_access, other. skipNote is REQUIRED when a reason is "other". The first reason is ' +
      'treated as primary. Pair with dwlf_confirm_trade to take it instead.',
    {
      tradeId: z.string().describe('Planned trade ID to skip'),
      skipReasons: z
        .array(z.string())
        .min(1)
        .describe('One or more skip reason codes (see tool description for the valid set). First = primary.'),
      skipNote: z.string().optional().describe('Free-text rationale (max 500 chars). Required when a reason is "other".'),
    },
    async ({ tradeId, skipReasons, skipNote }) => {
      try {
        const body: Record<string, unknown> = { skipReasons };
        if (skipNote) body.skipNote = skipNote;

        const data = await client.post(`/trades/${tradeId}/skip`, body);
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
