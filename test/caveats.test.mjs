// Retail readiness audit (23-Nov, item 3): every tool whose answer can carry a simulated figure says it is
// hypothetical, with one shared sentence, and a new tool that describes win rates, P&L or replays must be listed
// here as hypothetical or as known-actual. Reads what an agent is sent: the registered descriptions, per profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerForProfile } from '../dist/register.js';
import { HYPOTHETICAL_NOTE, HYPOTHETICAL_TOOLS } from '../dist/caveats.js';

// Figures about the user's own real positions and trades: actual, not simulated.
const KNOWN_ACTUAL = new Set(['dwlf_get_holdings', 'dwlf_list_trades']);
// Name a replay or the scorecard without reporting a figure: a thesis's `replaySummary` (facts), confirm reasons that
// feed the scorecard, and a note about replaying a fire through the dispatcher.
const MENTIONS_ONLY = new Set(['dwlf_list_theses', 'dwlf_get_thesis_story', 'dwlf_confirm_trade', 'dwlf_evaluate_strategy']);
const PERFORMANCE = /win rate|winRate|P&L|average return|counterfactual|replay|backtest results|aggregated performance/i;

const descriptions = (profile) => {
  const server = new McpServer({ name: 't', version: '0' });
  registerForProfile(server, profile, 'spt');
  return Object.fromEntries(Object.entries(server._registeredTools).map(([name, t]) => [name, t.description ?? '']));
};

test('every hypothetical tool ends its description with the shared note, on every profile it is in', () => {
  for (const profile of ['full', 'block']) {
    const d = descriptions(profile);
    for (const name of HYPOTHETICAL_TOOLS) {
      if (profile === 'full') assert.ok(name in d, `${name} is not a tool`);
      if (name in d) assert.ok(d[name].endsWith(HYPOTHETICAL_NOTE), `${profile}/${name} lacks the hypothetical note`);
    }
  }
});

test('no other tool describes win rates, P&L or replays unless it is known to report actual figures', () => {
  const d = descriptions('full');
  const unlisted = Object.entries(d)
    .filter(([name, text]) => PERFORMANCE.test(text.replace(HYPOTHETICAL_NOTE, '')) && !HYPOTHETICAL_TOOLS.has(name) && !KNOWN_ACTUAL.has(name) && !MENTIONS_ONLY.has(name))
    .map(([name]) => name);
  assert.deepEqual(unlisted, [], 'list each in HYPOTHETICAL_TOOLS (src/caveats.ts), or here in KNOWN_ACTUAL or MENTIONS_ONLY');
});
