// Static catalog of visual-strategy output node types — what each one does,
// what (currently-implicit) parameters drive its behaviour, and what the
// engine defaults to when those parameters aren't set.
//
// Source of truth for the runtime behaviour: dwlf-scheduled-jobs
//   src/services/visualStrategyExecutor.js (calculateStopLoss /
//   calculateTakeProfit / calculateRecentLowStopLoss). Today the executor
//   reads most of its parameters from a static `supportedNodes` map that
//   doesn't carry per-instance overrides, which is why the defaults
//   listed here are effectively hard-coded for every strategy.
//
// This catalog exists so an agent (or a user) can ask "what does this
// SL node actually do at runtime?" without having to read engine code.
// It is INTENTIONALLY informational — when the executor learns to honour
// per-node overrides, update this file to match.

export type NodeParam = {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'enum';
  default: unknown;
  description: string;
  enumValues?: string[];
  // Whether the executor currently honours an override on this param.
  // false = the value listed in `default` is the only value the engine
  // will ever use today, regardless of what's in the visual node's data.
  honoredByExecutor: boolean;
};

export type StrategyNode = {
  nodeType: string;
  category: 'signal' | 'stopLoss' | 'takeProfit' | 'logic' | 'cancellation' | 'exit';
  description: string;
  params: NodeParam[];
  notes?: string;
};

export const STRATEGY_NODES: StrategyNode[] = [
  // ── Entry signals ──────────────────────────────────────────────────
  {
    nodeType: 'long_signal',
    category: 'signal',
    description: 'Marks the entry pipeline as a long-side trade. Direction-only — no parameters.',
    params: [],
  },
  {
    nodeType: 'short_signal',
    category: 'signal',
    description: 'Marks the entry pipeline as a short-side trade. Direction-only — no parameters.',
    params: [],
  },

  // ── Stop loss ──────────────────────────────────────────────────────
  {
    nodeType: 'sl_below_recent_low',
    category: 'stopLoss',
    description:
      'Place SL below the most-recent confirmed swing low (long) or above the most-recent swing high (short). Reads the indicator pipeline\'s swingPoints (cycle.low.confirmed / cycle.high.confirmed) first; falls back to a 10-bar historical low if no swing data is available.',
    params: [
      {
        name: 'bufferPct',
        type: 'number',
        default: 1.0,
        description:
          'Distance below the swing low (above the swing high for short) as a percent. Engine currently hard-codes this as ×0.99 / ×1.01.',
        honoredByExecutor: false,
      },
      {
        name: 'swingSource',
        type: 'enum',
        enumValues: ['cycle_pivots', 'historical_low'],
        default: 'cycle_pivots',
        description:
          'Where the recent low/high comes from. Engine prefers cycle pivots when contextData.swingPoints is populated; falls back to a 10-bar historical low otherwise.',
        honoredByExecutor: false,
      },
      {
        name: 'lookbackBars',
        type: 'number',
        default: 10,
        description: 'Bars to scan for the historical fallback. Only relevant when swingSource = historical_low.',
        honoredByExecutor: false,
      },
    ],
    notes:
      'Post-PR#220 (2026-05-19), the swing-date filter uses `>` not `>=` so same-bar confirmations are no longer silently discarded — old SLs that resolved to deep historical lows are now correctly anchored to the most recent confirmed pivot.',
  },
  {
    nodeType: 'sl_below_recent_cycle_low',
    category: 'stopLoss',
    description:
      'Place SL 1% below the most recent CONFIRMED cycle pivot for the chosen timeframe (cycle.low.confirmed for long, cycle.high.confirmed for short). Strict DCL semantics — ignores generic swing lows that aren\'t cycle-classified, so mid-cycle bounces in strong uptrends don\'t tighten the stop. Returns null if no eligible pivot exists; caller then falls back to the strategy\'s default risk.',
    params: [
      {
        name: 'timeframe',
        type: 'enum',
        enumValues: ['daily', 'weekly', 'hourly', '1d', '1w', '1h'],
        default: 'daily',
        description:
          'Which cycle pivot timeframe to anchor on. Accepts either long ("daily") or short ("1d") form. Use "weekly" to anchor on Weekly Cycle Lows for swing/position-trade stops; use "daily" (default) for DCL-trade stops.',
        honoredByExecutor: true,
      },
      {
        name: 'bufferPct',
        type: 'number',
        default: 1.0,
        description:
          'Distance below the cycle low (above the cycle high for short) as a percent. Engine currently hard-codes this as ×0.99 / ×1.01.',
        honoredByExecutor: false,
      },
    ],
    notes:
      'Sibling to sl_below_recent_low. Use this when you specifically want DCL-anchored stops; the generic version uses bare swing lows which can include mid-cycle bounces.',
  },
  {
    nodeType: 'sl_percentage',
    category: 'stopLoss',
    description: 'Place SL at a fixed percent below entry (long) / above entry (short).',
    params: [
      {
        name: 'percentage',
        type: 'number',
        default: 2,
        description: 'Distance from entry as a percent.',
        honoredByExecutor: false,
      },
    ],
  },
  {
    nodeType: 'sl_atr',
    category: 'stopLoss',
    description: 'Place SL at N × ATR below entry (long) / above (short). Uses ATR-14 daily.',
    params: [
      {
        name: 'multiplier',
        type: 'number',
        default: 2,
        description: 'ATR multiplier.',
        honoredByExecutor: false,
      },
      {
        name: 'atrPeriod',
        type: 'number',
        default: 14,
        description: 'ATR lookback period. Engine reads from contextData.indicators.atr_14 — period is fixed.',
        honoredByExecutor: false,
      },
    ],
  },
  {
    nodeType: 'sl_fixed_amount',
    category: 'stopLoss',
    description: 'Place SL at a fixed dollar amount below entry (long) / above (short).',
    params: [
      {
        name: 'amount',
        type: 'number',
        default: 10,
        description: 'Dollar distance from entry.',
        honoredByExecutor: false,
      },
    ],
  },
  {
    nodeType: 'sl_support_level',
    category: 'stopLoss',
    description: 'Place SL at the most-recent support level (long) / resistance (short).',
    params: [
      {
        name: 'lookbackBars',
        type: 'number',
        default: 10,
        description: 'Bars to scan for the support/resistance level.',
        honoredByExecutor: false,
      },
    ],
  },

  // ── Take profit ────────────────────────────────────────────────────
  {
    nodeType: 'tp_1r',
    category: 'takeProfit',
    description: 'TP at 1× the risk distance (close + 1R for long). The R-multiple is the only param and IS read from the node name.',
    params: [{ name: 'ratio', type: 'number', default: 1, description: 'R-multiple.', honoredByExecutor: true }],
  },
  {
    nodeType: 'tp_2r',
    category: 'takeProfit',
    description: 'TP at 2× risk.',
    params: [{ name: 'ratio', type: 'number', default: 2, description: 'R-multiple.', honoredByExecutor: true }],
  },
  {
    nodeType: 'tp_3r',
    category: 'takeProfit',
    description: 'TP at 3× risk.',
    params: [{ name: 'ratio', type: 'number', default: 3, description: 'R-multiple.', honoredByExecutor: true }],
  },
  {
    nodeType: 'tp_5r',
    category: 'takeProfit',
    description: 'TP at 5× risk.',
    params: [{ name: 'ratio', type: 'number', default: 5, description: 'R-multiple.', honoredByExecutor: true }],
  },
  {
    nodeType: 'tp_10r',
    category: 'takeProfit',
    description: 'TP at 10× risk. Common for trend-following / DCL strategies aiming to ride breakouts.',
    params: [{ name: 'ratio', type: 'number', default: 10, description: 'R-multiple.', honoredByExecutor: true }],
  },
  {
    nodeType: 'tp_percentage',
    category: 'takeProfit',
    description: 'TP at a fixed percent above entry (long) / below (short).',
    params: [
      {
        name: 'percentage',
        type: 'number',
        default: 6,
        description: 'Distance from entry as a percent.',
        honoredByExecutor: false,
      },
    ],
  },
  {
    nodeType: 'tp_atr',
    category: 'takeProfit',
    description: 'TP at N × ATR above entry (long) / below (short). Uses ATR-14 daily.',
    params: [
      {
        name: 'multiplier',
        type: 'number',
        default: 3,
        description: 'ATR multiplier.',
        honoredByExecutor: false,
      },
      {
        name: 'atrPeriod',
        type: 'number',
        default: 14,
        description: 'ATR lookback period (fixed at 14 in current engine).',
        honoredByExecutor: false,
      },
    ],
  },
  {
    nodeType: 'tp_resistance_level',
    category: 'takeProfit',
    description: 'TP at the next resistance level above entry (long) / support below (short).',
    params: [],
  },
  {
    nodeType: 'tp_trailing_stop',
    category: 'takeProfit',
    description:
      '⚠️ Currently a placeholder (5% above entry for long, -5% for short). Full trailing-stop logic isn\'t wired — treat as not yet implemented.',
    params: [],
    notes: 'Engine returns a static 5% target instead of trailing the live high. Don\'t use this for real trades until the trailing logic is wired.',
  },

  // ── Logic gates ────────────────────────────────────────────────────
  {
    nodeType: 'and_gate',
    category: 'logic',
    description: 'Conditions joined with AND — all inputs must be true.',
    params: [],
  },
  {
    nodeType: 'or_gate',
    category: 'logic',
    description: 'Conditions joined with OR — any input true triggers.',
    params: [],
  },
  {
    nodeType: 'not_gate',
    category: 'logic',
    description: 'Inverts its single input.',
    params: [],
  },
  {
    nodeType: 'then_gate',
    category: 'logic',
    description: 'Sequential gate — input B must fire AFTER input A. Alias: sequence_gate.',
    params: [],
  },

  // ── Cancellation ───────────────────────────────────────────────────
  {
    nodeType: 'cancel_break_prev_low',
    category: 'cancellation',
    description: 'Cancel a pending entry if price breaks the previous bar\'s low before entry triggers.',
    params: [],
  },
  {
    nodeType: 'cancel_break_prev_high',
    category: 'cancellation',
    description: 'Cancel a pending entry if price breaks the previous bar\'s high before entry triggers.',
    params: [],
  },
  {
    nodeType: 'cancel_time_limit',
    category: 'cancellation',
    description: 'Cancel a pending entry if it hasn\'t triggered within N bars.',
    params: [
      {
        name: 'bars',
        type: 'number',
        default: 5,
        description: 'Bars to wait before cancellation.',
        honoredByExecutor: false,
      },
    ],
  },

  // ── Exit graph ─────────────────────────────────────────────────────
  {
    nodeType: 'exit_start',
    category: 'exit',
    description: 'Root of the exit pipeline. No parameters.',
    params: [],
  },
  {
    nodeType: 'close_position',
    category: 'exit',
    description: 'Close the open position when the gated exit conditions evaluate true.',
    params: [],
  },
];

export function getStrategyNodeByType(nodeType: string): StrategyNode | undefined {
  return STRATEGY_NODES.find((n) => n.nodeType === nodeType);
}

export function getStrategyNodesByCategory(category: StrategyNode['category']): StrategyNode[] {
  return STRATEGY_NODES.filter((n) => n.category === category);
}
