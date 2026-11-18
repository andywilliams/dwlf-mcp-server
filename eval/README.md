# `eval/`: the Block profile's release checks (DWLF-804, WP7)

Since 18-Nov-2026 (design doc `docs/design/block-eval.md` §0) releases are gated by **standard tests in `npm test`**
(no model calls, no secrets). `publish.yml` runs them before every publish. The agent-level eval is a reference you
run by hand: see [`MANUAL.md`](MANUAL.md).

- **Pass-through (check 4, `npm test`):** every tool in `passthrough.json` is replayed through the built server and
  must keep its Block API body whole (containment: extra keys allowed, nothing dropped or rewritten). The list is
  empty until WP4 re-points the profile; `cutPending` holds the launch-set data tools until then.
- **Recordings (`fixture-server.mjs`):** replay serves `fixtures/`, and under replay no other host is reachable
  (`replayEnv`). Recording forwards GETs only, never writes a key to disk, and picks the upstream by route family
  (`/v1/…` and `/public/v1/…` go to the Block API, everything else to SPT). Each Block data-route body is checked
  against the Block API's own OpenAPI and the `knowableAt` rules (`envelope.mjs`) before it's saved. A failure
  names its source: `required by the Block API's OpenAPI` (raise it with WP2) or `knowableAt rule
  (eval/envelope.mjs)` (this repo's copy of DWLF-853: check whether the Block API changed the meaning; never loosen
  the copy to fit a refused body).
- **The gate (`snapshot.mjs`, run by `test/snapshots.test.mjs`):** for each `calls/<tool>.json` (`{ tool, calls: [{ id,
  args }] }`), the built server replays each call and must match `snapshots/<tool>.<id>.json` (only the MCP's own layer:
  what it adds, rewrites or selects). Every sentence in the output passes the banned-terms list, and a Block API
  request from a tool not in `passthrough.json` `tools` fails. `node eval/snapshot.mjs --update` rewrites the
  snapshots (read the diff). `--record` first records from the Block API's public routes (no key; SPT is never
  recorded). `fixture-lint.mjs` refuses a recording with a price on any symbol but `BTCOC/USD`.
- **Fixtures go into a public repo:** read every fixture diff for vendor-derived or personal values before
  committing it (design doc §0 T3).

**Check 7, the wording gate** (`test/wording.test.mjs`): every Block description and the Block instructions pass block-site's `ops/wording-banned.json`, read by dwlf-block-api's `bannedWordIn`. Both are vendored in `wording/` and pinned in `wording/SOURCES.json`. `npm run wording:sync` refreshes them from each repo's main (needs `gh`); `npm run wording:sync -- --check` fails when either source has moved on (run it in the release checklist). Never edit the vendored files; a dispute with the list is settled in block-site.

## Release checklist

1. `npm run wording:sync -- --check`: the wording list and port are the sources' current ones. If not, sync in its own PR first.
2. Optional: the manual agent check ([`MANUAL.md`](MANUAL.md)) when descriptions or tool shapes changed; note the result on the release's ticket.
