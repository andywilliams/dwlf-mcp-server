# The Block agent eval (DWLF-804, WP7)

A fresh agent with only this MCP server (`--profile block`) answers three questions per tool, one of them a trap. The answer passes only if:
- the deterministic grader passes (`grade.mjs`): a non-empty answer, the trap refused in so many words, the required tools called. Call-like phrases and the shared wording list are flagged to the judge, which reads them in context;
- AND the LLM judge finds it correct, sourced and not advisory.

- `npm run eval`: replays `eval/fixtures/`. Needs `ANTHROPIC_API_KEY` (or an `ant auth login` profile); no DWLF credential.
- `DWLF_API_KEY=<read-only Block test key> node eval/run.mjs --record`: runs against the real API and (re)writes the fixtures. The key goes upstream only and is never written to disk. Review the fixture diff before committing it.
- `--case <name>` runs one case file. `EVAL_MODEL` / `EVAL_JUDGE_MODEL` override the models (default `claude-opus-5-5`).
- Transcripts and `summary.json` are written to `eval/transcripts/<version>/` (gitignored). Until the publish gate is wired (a later PR), attach them to the release by hand.
- A request with no recording fails the question it happened in. Recordings older than 30 days, or undated, are listed in `summary.staleFixtures`. When recording, upstream 401/408/429/5xx answers are not saved (`summary.unsavedUpstreamFailures`).
- The Academy tools fetch a CDN that replay can't stand in for, so a case for them is refused until they take a base-URL override.

To add a tool: write `eval/cases/<name>.json` (`{ tool, questions: [{ id, q, trap?, expect?: { mustCall?, mustMention? } }] }`), record its fixtures, and run it.
The wording list is block-site's `ops/wording-banned.json`; refresh the vendored copy when it changes.
