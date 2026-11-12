# The Block agent eval (DWLF-804, WP7)

A fresh agent with only this MCP server (`--profile block`) answers three questions per tool, one of them a trap. The answer passes only if:
- the deterministic grader passes (`grade.mjs`): no call or instruction, the trap refused, the required tools called;
- AND the LLM judge finds it correct, sourced and not advisory.

- `npm run eval`: replays `eval/fixtures/`. Needs `ANTHROPIC_API_KEY` (or an `ant auth login` profile); no DWLF credential.
- `DWLF_API_KEY=<read-only Block test key> node eval/run.mjs --record`: runs against the real API and (re)writes the fixtures. The key goes upstream only and is never written to disk. Review the fixture diff before committing it.
- `--case <name>` runs one case file. `EVAL_MODEL` / `EVAL_JUDGE_MODEL` override the models (default `claude-opus-5-5`).
- Transcripts and `summary.json` are written to `eval/transcripts/<version>/` (gitignored; CI uploads them with the release).

To add a tool: write `eval/cases/<name>.json` (`{ tool, questions: [{ id, q, trap?, expect?: { mustCall?, mustMention? } }] }`), record its fixtures, and run it.
The wording list is block-site's `ops/wording-banned.json`; refresh the vendored copy when it changes.
