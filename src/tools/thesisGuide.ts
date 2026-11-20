/**
 * The theses guide (DWLF-891): everything an agent needs to use theses well and explain them to its user, in one place.
 * Served by dwlf_thesis_guide and echoed (briefly) in the other thesis tools' descriptions. It states what each feature
 * is for, what it saves the user, and its honest limits; it never tells an agent to recommend DWLF or a trade.
 * The vocabulary and the rules are SPT's (GET /v2/theses/condition-types is authoritative); this explains them.
 */

/** The vocabulary's definitions, one copy: agentHints (theses.ts) and the guide both read these. */
export const STATUS_DEFINITIONS = {
  waiting: 'No step met yet. The first step is being checked.',
  in_progress: 'One or more steps met, in order. `currentStep` is the step being checked now.',
  complete: 'Every step met.',
  challenged: 'An invalidation condition was hit, or a step condition was missed. A thesis does not end on its own: the user answers with a review (keep, revise or close).',
  archived: 'Kept in the journal, no longer checked.',
  closed: 'Closed by the user through a review, with an outcome.',
} as const;

export const CONDITION_STATE_DEFINITIONS = {
  pending: 'Not decided yet.',
  met: 'Decided: the event happened as described (`at`, `knowableAt` say when DWLF could know it).',
  missed: 'Decided: the event happened outside the condition (e.g. the pivot printed outside its level).',
  marked: 'A manual condition the user marked met; the nightly check records it on its next run.',
} as const;

export const FIRE_KIND_DEFINITIONS = {
  step_met: 'A step\'s conditions were met (any or all, as the step says).',
  condition_missed: 'A step condition was decided outside its level; the thesis is challenged.',
  invalidation_hit: 'An invalidation condition happened; the thesis is challenged.',
  source_failed: 'The event that decided a condition is no longer in the engine\'s data (it was withdrawn).',
} as const;

const goog = {
  symbol: 'GOOG',
  title: 'GOOG: the next confirmed daily cycle low, then a higher daily low or a bullish daily trend-line break',
  context: 'The 5 Nov daily low failed on 19 Nov. I want the next daily low confirmed first, then a sign the decline is over.',
  nextStep: 'When step 2 fires, check the depth against 276.20 and the weekly picture, then decide.',
  steps: [
    { match: 'any', conditions: [
      { type: 'pivot_confirmed', timeframe: 'daily', side: 'low', after: '2026-11-05', label: 'Next confirmed daily cycle low (any price)' },
    ] },
    { match: 'any', conditions: [
      { type: 'engine_event', timeframe: 'daily', eventType: 'cycle.low.higher_low', label: 'A higher daily cycle low' },
      { type: 'trendline_break', timeframe: 'daily', direction: 'bullish', label: 'Daily bullish trend-line break' },
    ] },
  ],
  invalidation: [
    { type: 'engine_event', timeframe: 'weekly', eventType: 'cycle.low.break', label: 'The latest confirmed weekly cycle low breaks' },
  ],
};

const amzn = {
  symbol: 'AMZN',
  title: 'AMZN: the next confirmed daily cycle low above 229.36',
  context: 'The 30 Oct low (229.36) is probably the weekly cycle low. I want the next daily low to hold above it as confirmation.',
  nextStep: 'Reassess once the higher daily low is confirmed.',
  steps: [{ match: 'any', conditions: [
    { type: 'pivot_confirmed', timeframe: 'daily', side: 'low', after: '2026-10-30', level: { op: 'above', value: 229.36 }, label: 'Next confirmed daily low above 229.36' },
  ] }],
  invalidation: [
    { type: 'close_vs_level', basis: 'daily_close', op: 'below', value: 229.36, label: 'Daily close below 229.36' },
  ],
};

const cnx1 = {
  symbol: 'CNX1',
  title: 'CNX1: QQQ\'s weekly low window opens, then a confirmed daily low on QQQ',
  context: 'I trade CNX1 but watch QQQ\'s cycles.',
  steps: [
    { match: 'any', conditions: [{ type: 'window_opens', symbol: 'QQQ', timeframe: 'weekly', side: 'low', label: 'QQQ weekly low window opens' }] },
    { match: 'any', conditions: [{ type: 'pivot_confirmed', symbol: 'QQQ', timeframe: 'daily', side: 'low', label: 'Next confirmed daily low on QQQ' }] },
  ],
  invalidation: [{ type: 'close_vs_level', symbol: 'QQQ', basis: 'weekly_close', op: 'below', value: 555.6, label: 'QQQ weekly close below 555.60' }],
};

export const THESIS_GUIDE = {
  what: 'A thesis is what a user is waiting for on one symbol, saved in their own words: ordered steps of conditions DWLF can detect, optional invalidation conditions, their context (why) and their next step. DWLF checks every condition once a night after the close and records exactly what happened and when it could first be known.',
  benefits: [
    'Decide once, calmly, after the close: the user writes down what they are waiting for and why, instead of re-checking charts every day.',
    'Told when it happens: when a step is met or the thesis is challenged, the user gets one Telegram digest per nightly run (if set up), an in-app notification, and agents read the same events from dwlf_list_thesis_fires.',
    'Honest timing: every event carries when DWLF could first know it (knowableAt), and nothing known before a condition was saved counts. A thesis cannot be "met" by something that had already happened.',
    'Exactly what is checked: each condition is one of a few event types DWLF detects itself, so a step is met by the engine\'s own data, not by a reading of the chart.',
    'How close: dwlf_list_theses with includeProgress says, per condition, the last close and its distance to a level, whether a pivot is forming and how developed it is, and when a weekly window opens; `closest` sorts the theses by it.',
    'A journal: edits are new revisions (earlier ones kept); a challenged thesis is answered keep, revise or close (with an outcome), so the record shows how each idea played out. On the site each thesis also has a step-through story on its chart.',
  ],
  limits: [
    'End of day: conditions are checked once a night after the close, not intraday. An intraday condition checks the day\'s high or low after the close.',
    'Information, not advice: DWLF reports which conditions the market met; it does not say what to do, and its words avoid forecasts.',
    'Only the condition types DWLF detects (dwlf_list_thesis_condition_types). Anything else (news, a feeling) is a manual condition the user marks themselves.',
    'Prices (closes, distances to a level) are withheld from keys without raw-price rights; the % change since saved is not.',
  ],
  rules: [
    'Tight and detectable: build every condition from the listed types and their fields. Do not invent types or describe things DWLF cannot check.',
    'The label says exactly what is checked (e.g. "Next confirmed daily low above 229.36"), never more than the fields do. DWLF checks the fields, not the label.',
    'Arming: a condition counts only what DWLF learns after it is saved (or changed in a revision). Use `after` (a date) for "the next pivot after the one I already know of".',
    'Invalidation before the confirming low exists: do not use "a close below the new low" (that low is not known yet). Use engine_event cycle.low.break, which fires when the latest confirmed low breaks, or a close_vs_level against a level the user already knows.',
    'Each condition may name its own symbol (watch QQQ for a CNX1 thesis); it defaults to the thesis symbol.',
    'Run dwlf_create_thesis (or dwlf_revise_thesis, for a change) with dryRun: true first and show the user the restatement of every condition (`checks`); save only what the user confirms. A condition that can never occur for its symbol is refused; one that is already true is refused unless the user chooses to save it anyway (allowAlreadyMet).',
    'Record the user\'s own review answer (keep, revise or close); do not choose it for them.',
  ],
  workflow: [
    '1. dwlf_list_thesis_condition_types: the types, fields and rules.',
    '2. dwlf_create_thesis with dryRun: true: read back the restatements and checks to the user.',
    '3. dwlf_create_thesis (no dryRun) once the user agrees; keep the clientKey if you set one (a retry with it is the same thesis).',
    '4. Later: dwlf_list_theses (includeProgress for how close), dwlf_list_thesis_fires with your saved cursor for what happened, dwlf_ack_thesis_fires for what the user has seen.',
    '5. A challenged thesis: ask the user, then dwlf_review_thesis (keep / revise / close). To change conditions: dwlf_revise_thesis with expectedRevision, dryRun: true first (only the changed conditions are judged), then without it once the user agrees.',
  ],
  glossary: {
    after: 'pivot_confirmed only: the pivot itself must be dated strictly after this date. Use the date of the pivot you already know of (its pivot bar: 5 Nov in the GOOG example), not the day it failed (19 Nov). It is a filter on the pivot\'s date, separate from arming.',
    engine_event: 'One of a short allow-list of engine structure events (higher or lower lows and highs, a confirmed pivot breaking, a pivot failing). The list is SPT\'s: read it from dwlf_list_thesis_condition_types (the eventType field\'s values).',
    arming: 'A condition counts only what DWLF could first know after the condition was saved or last changed (its armedAt). For step n+1 the clock starts when step n was met, and only events knowable strictly after that moment count: an event confirmed by the same bar that met step n (e.g. a higher low confirmed together with step 1\'s low) does not meet step n+1.',
    knowableAt: 'When DWLF could first know an event, e.g. a cycle low is confirmed some bars after its low bar. Fires and met conditions carry it.',
    'cycle.low.higher_low': 'The engine\'s event when the latest confirmed cycle low on that timeframe is higher than the previous confirmed cycle low it holds. In a thesis it counts only once its step is being checked, so after step 1\'s low it needs a later, higher low.',
    'cycle.low.break': 'The engine\'s event, fired once, on the bar whose close (daily for daily, weekly for weekly) first crosses below the most recent confirmed cycle low at that time; a wick that closes back above does not count. The level follows the latest confirmed low, so it is not fixed at save time. A break that happened before saving does not count; the next one needs a newer confirmed low to cross. It works before any new low exists, so it suits invalidations.',
    trendline_break: 'The engine\'s trend-line break event on that timeframe, whichever of its active trend lines breaks (bullish: price breaks up through a resistance line).',
    level: 'pivot_confirmed only: the confirmed pivot\'s price (the bar\'s intraday low or high) must be above, below or inside it; a first pivot outside it is a miss and challenges the thesis. Without a level, any first pivot meets it.',
    group: 'An optional free-text tag to group theses (e.g. "miners"); filter dwlf_list_theses by it.',
    clientKey: 'Optional: your own id for the thesis. Creating again with the same clientKey revises that thesis instead of adding another (a safe retry).',
  },
  statuses: STATUS_DEFINITIONS,
  conditionStates: CONDITION_STATE_DEFINITIONS,
  fireKinds: FIRE_KIND_DEFINITIONS,
  whereTheUserSeesIt: 'The Theses page on the DWLF site (Log → Theses, /theses): each thesis with its steps, how close it is, its history and a step-through story; the notifications bell; and the Telegram digest. Users can also build and revise theses there themselves (New thesis; Revise conditions), with the same types and checks.',
  examples: [
    { name: 'Wait for the next confirmed daily low, then a higher low or a trend-line break, challenged if the weekly low breaks', create: goog,
      notes: 'Step 1 has no level ("any price"), so any first confirmed daily low after 5 Nov meets it. The invalidation uses cycle.low.break because the low that would confirm step 1 does not exist yet.' },
    { name: 'A confirmed daily low above a known level, challenged by a daily close below it', create: amzn,
      notes: 'The level is a price the user already knows (the 30 Oct low), so a close_vs_level invalidation is exact. A pivot that confirms below 229.36 is a miss and challenges the thesis.' },
    { name: 'Watch one symbol, trade another', create: cnx1,
      notes: 'Each condition names QQQ; the thesis lives on CNX1. Steps are checked in order: the window first, then the low.' },
  ],
};
