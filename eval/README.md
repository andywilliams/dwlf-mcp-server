# The Block agent eval (DWLF-804, WP7)

A fresh agent with only this MCP server (`--profile block`) answers three questions per tool, one of them a trap. The answer passes only if:
- the deterministic grader passes (`grade.mjs`): a non-empty answer; on a trap, the call refused in so many words AND the data named for what it is (an event, a condition or a reading); the required tools called and facts mentioned. Call-like phrases and the shared wording list are flagged to the judge, which reads them in context;
- AND the LLM judge finds it correct, sourced and not advisory.

- `npm run eval`: replays `eval/fixtures/`. Needs `ANTHROPIC_API_KEY` (or an `ant auth login` profile); no DWLF credential.
- `node eval/run.mjs --record`: runs against the real APIs and (re)writes the fixtures. The upstream is chosen per route family: Block API paths (`/v1/…`, `/public/v1/…`) go to `BLOCK_UPSTREAM` (default `https://api.block.dwlf.co.uk`), the rest to `DWLF_UPSTREAM` (SPT). Block's public routes need no key; signed-in Block paths need `BLOCK_API_KEY` (Bearer) and SPT paths `DWLF_API_KEY`. A request whose key wasn't given is refused and listed in `summary.refusedNoKey`. Keys go upstream only and are never written to disk. Review the fixture diff before committing it.
- **Check 4 at record time:** each Block data-route body (catalogue, conditions, events, series) is checked against the `required` lists in the Block API's own `/public/v1/openapi.json` and against the `knowableAt` rules (`envelope.mjs`). A body that fails is not saved and fails its question (`summary.blockContractFailures`). Each failure says its source: `required by the Block API's OpenAPI` is the Block API's own rule (a regression there: raise it with WP2); `knowableAt rule (eval/envelope.mjs)` is this repo's copy of DWLF-853, so check first whether the Block API changed the meaning (then edit `envelope.mjs` in the recording PR) before treating it as a regression; a saved one stores the OpenAPI version and sha256, and `summary.olderSchemaRecordings` lists recordings checked against an older OpenAPI than the newest.
- **Check 4 in `npm test`:** every tool in `passthrough.json` is replayed through the built server and must keep its one Block API body whole (containment: extra keys allowed, nothing dropped or rewritten). Empty until WP4 re-points the profile; `cutPending` holds the launch-set data tools until then. In the eval, a call that reaches a Block API path from a tool not in `tools` fails its question.
- `--case <name>` runs one case file. `EVAL_MODEL` / `EVAL_JUDGE_MODEL` override the models (default `claude-opus-5-5`).
- Transcripts and `summary.json` are written to `eval/transcripts/<version>/` (gitignored). Until the publish gate is wired (a later PR), attach them to the release by hand.
- A request with no recording fails the question it happened in. Recordings older than 30 days, or undated, are listed in `summary.staleFixtures`. When recording, upstream 401/408/429/5xx answers are not saved (`summary.unsavedUpstreamFailures`).
- The Academy tools fetch a CDN that replay can't stand in for, so a case for them is refused until they take a base-URL override.

To add a tool: write `eval/cases/<name>.json` (`{ tool, questions: [{ id, q, trap?, expect?: { mustCall?, mustMention? } }] }`), record its fixtures, and run it.
**Check 7, the wording gate** (`test/wording.test.mjs`): every Block description and the Block instructions pass block-site's `ops/wording-banned.json`, read by dwlf-block-api's `bannedWordIn`. Both are vendored in `wording/` and pinned in `wording/SOURCES.json`. `npm run wording:sync` refreshes them from each repo's main (needs `gh`); `npm run wording:sync -- --check` fails when either source has moved on (run it in the release checklist). Never edit the vendored files; a dispute with the list is settled in block-site.

## Release checklist (until the publish gate, plan step 4, runs the eval in CI)

1. `npm run wording:sync -- --check`: the wording list and port are the sources' current ones. If not, sync in its own PR first.
2. `npm run eval` on the release candidate; attach `eval/transcripts/<version>/` to the release.
