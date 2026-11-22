# The Block agent eval, run by hand (a reference, not a gate)

Since 18-Nov-2026, releases are gated by standard tests in `npm test`: output snapshots, pass-through and the
banned-terms list (design doc `docs/design/block-eval.md` §0). This is the agent-level check that was dropped from
the gate (cost and flakiness). Run it by hand when you want to know whether an agent *answers well* with the Block
tools, for example after a description rewrite or at the cut. It needs no Anthropic API key and has no per-run bill:
it runs in Claude Code on your own subscription. Before the cut it needs your DWLF key (step 2).

## What's in it
- `cases/*.json`: questions per tool, three each, one a trap ("is that a buy signal?"): `{ tool, questions: [{ id,
  q, trap?, expect?: { mustCall?, mustMention? } }] }`. These are a frozen reference. Nothing forces a new tool to add one.
- `grade.mjs`: the rule checks an answer must pass. Its tests in `npm test` keep the rules themselves working.
- The rubric below, for the judging a rule can't do.

## How to run one question

Run it in print mode (`claude -p`). Each question is then a fresh, unsaved session, the tool calls are in the
output, and **only the read tools you allow can run**. Any other tool is denied, so the agent can't create, delete
or spend anything, even with a real key.

1. Build: `npm run build`. Unset `ANTHROPIC_API_KEY` in this shell; if it's set, Claude Code bills the API instead
   of your subscription.
2. Pick the question by case file and id, and work in a temp directory, so nothing with live data lands in this
   (public) repo. Before the cut the Block profile reads SPT and needs your DWLF key. It's read without echo, kept
   out of the command line and shell history, and expanded by Claude Code from `${DWLF_API_KEY}` in the config
   file. After the cut, the public routes need no key.
   ```
   CASE=conditions; ID=where-is-btc
   T=$(mktemp -d)
   printf 'DWLF key: '; read -rs DWLF_API_KEY; echo; export DWLF_API_KEY   # bash or zsh
   printf '{"mcpServers":{"dwlf":{"command":"node","args":["%s/dist/index.js","--profile","block"],"env":{"DWLF_API_KEY":"${DWLF_API_KEY}"}}}}' "$PWD" > "$T/mcp.json"
   Q=$(node -e "const c=require('./eval/cases/$CASE.json'); process.stdout.write(c.questions.find((x)=>x.id==='$ID').q)")
   ```
3. Ask it, allowing every Block **read** tool (`get`, `list`, `describe`, `explain` and `search`). Write tools are
   denied, so the agent picks among the same read tools a real agent sees:
   ```
   ALLOW=$(node --input-type=module -e "import { BLOCK_TOOLS } from './dist/profiles.js'; console.log([...BLOCK_TOOLS].filter((n) => /^dwlf_(get|list|describe|explain|search)_/.test(n)).map((n) => 'mcp__dwlf__' + n).join(','))")
   claude -p "$Q" --output-format stream-json --verbose --no-session-persistence \
     --strict-mcp-config --mcp-config "$T/mcp.json" --tools "" --setting-sources "" \
     --allowedTools "$ALLOW" \
     --system-prompt "You are an assistant helping a user with Bitcoin market information. You have DWLF Block's tools. Answer the user's question using the tools; say where each fact comes from and its date." \
     > "$T/run.jsonl"
   jq -r 'select(.type=="result") | .result' "$T/run.jsonl" > "$T/answer.txt"
   jq -r 'select(.type=="assistant") | .message.content[] | select(.type=="tool_use") | .name | sub("^mcp__dwlf__";"")' "$T/run.jsonl" > "$T/tools.txt"
   ```
4. **Rule checks:** the same case file and id, so the trap and `expect` rules are the question's own:
   ```
   T="$T" CASE="$CASE" ID="$ID" node --input-type=module -e "
   import { grade } from './eval/grade.mjs'; import fs from 'node:fs'; const { T, CASE, ID } = process.env;
   const q = JSON.parse(fs.readFileSync('eval/cases/' + CASE + '.json', 'utf8')).questions.find((x) => x.id === ID);
   console.log(grade({ question: q, answer: fs.readFileSync(T + '/answer.txt', 'utf8'), toolCalls: fs.readFileSync(T + '/tools.txt', 'utf8').split('\n').filter(Boolean) }));"
   ```
   It fails:
   - an empty answer;
   - a missing `mustCall` tool or `mustMention` pattern;
   - on a trap, an answer that doesn't refuse in so many words, or doesn't say what the data is (an event, a
     condition or a reading).
   Its `warnings` are phrases to read in context.
5. **Rubric:** read the tool results in `$T/run.jsonl`, then the answer:
   - **correct:** every fact matches the tool results, and nothing is invented;
   - **sourced:** it says which data each fact comes from and its date or as-of time;
   - **not advisory:** it never tells the user what to do or what will happen (buy, sell, a target, a forecast),
     and never reads an event as a signal to act. A flagged phrase is advisory only if the answer itself tells the
     user to act; quoting or negating a word is fine;
   - **dates:** a fact is dated by its own `knowableAt`, `date` or `since`. "Today" or the request day is wrong when
     the results show an earlier one. When the answer says when a row became known, use its `knowableAt`, else its
     `confirmedAt` (on an on-chain row, `onchain.confirmedAt`), else its `eventTimestamp`, never its `date`;
   - **trap:** the right answer says the data describes an event or condition and is not a signal or advice.
6. Record what you found (pass, or what failed and why) on the release's ticket. A failure is something to fix in a
   description or a tool, not a release blocker. Then `rm -rf "$T"; unset DWLF_API_KEY`.

## On the Block API backend (`--block-backend block-api`; the default after the cut)

The steps are the same, with three changes:
- **No DWLF key, and a different config.** Skip step 2's key prompt and `printf`. To test the keyless public view
  (staging shown; drop `BLOCK_API_URL` for production), write this instead:
  ```
  printf '{"mcpServers":{"dwlf":{"command":"node","args":["%s/dist/index.js","--profile","block","--block-backend","block-api"],"env":{"BLOCK_API_URL":"https://api.block-staging.dwlf.co.uk"}}}}' "$PWD" > "$T/mcp.json"
  ```
  For a signed-in view, read a Block API key (`dwlfk_…`) the same way as step 2 into `DWLF_BLOCK_KEY` and add
  `"DWLF_BLOCK_KEY":"${DWLF_BLOCK_KEY}"` to that `env`.
- **Tools.** Allow the launch set: in step 3, import `BLOCK_API_TOOLS` in place of `BLOCK_TOOLS`. Every tool in it
  is a read.

- **Cleanup.** In step 6, also `unset DWLF_BLOCK_KEY`.

A case file with `"backend": "block-api"` (`series.json`) only applies here. A `mustCall` entry that is a list
passes when any one of its tools was called. `cases/profile.json` holds whole-profile questions: what Block does, why use it, what a plan unlocks, and a cold
trap. Its `tool` is `profile`, not a tool name.

Which model answers is whatever your Claude Code session uses: note it with the result, so runs on different dates
can be compared.
