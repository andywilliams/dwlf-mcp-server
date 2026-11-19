# The Block profile on the Block API: design (WP4 step 4, B4, DWLF-876)

*19-Nov-2026. The Block 3-layer design §1.4 and §2 step 4 (approved 12-Nov), Andy's Q10 ("one server, product
profiles"), the launch set (DWLF-852) and the release gate (`block-eval.md` §0). It answers the questions the WP7
charter handed to WP4 (`ARCHITECTURE.md`, *Handed to other packages*). Docs only.*

## 1 · What changes, and what doesn't yet

Today `--profile block` calls SPT `/v2` with `DWLF_API_KEY`. After the cut it calls **the Block API**
(`api.block.dwlf.co.uk`) and offers only the launch set:
- `dwlf_get_conditions`, `dwlf_get_events`, `dwlf_describe_onchain_events`, `dwlf_explain_event`;
- `dwlf_get_series` (new);
- an account tool, which arrives with keys.

This work does that in steps that each ship dark, so nothing a Block user sees changes until **the cut release**.
The cut is a separate PR and a separate tap: it flips the default, removes the 35 tools and bumps the version.

| Block API route (live 19-Nov) | Auth | What it gives |
|---|---|---|
| `/public/v1/conditions`, `/events`, `/series/{id}`, `/catalogue` | none | the Free view: events last 30 days, series last 365, Block-plan families locked |
| `/v1/…` (the same four, plus `me`, `terms`, `keys`, `billing`) | `Authorization: Bearer` | the account's plan view. Today a 15-minute identity token; a personal key (`dwlfk_…`) "works on the API and the MCP" once the keys release ships (`/v1/keys`, in the OpenAPI since 19-Nov) |

## 2 · Decisions

**D1 · Dark until the cut: an opt-in backend.**
- `DWLF_BLOCK_BACKEND=block-api` (or `--block-backend block-api`) makes `--profile block` use the Block API. The
  default stays `spt` until the cut release flips it.
- An unknown value is a startup error, never a silent fallback, as an unknown profile already is.
- *Why:* each step can merge and even publish without changing what today's Block users get, and the release gate
  can record and pin the new backend before anyone depends on it.
- **Rejected:** a big-bang cut, which is unreviewable and leaves no rollback short of a revert release.
- **Rejected:** a third profile name. The charter keeps `block` as the name, and a temporary profile would leak into
  install docs.

**D2 · Which tools, on each backend.**
- On `block-api`, the profile offers the launch set above, minus the account tool, which needs a key (D6).
- `dwlf_get_series` exists only on `block-api`.
- The `spt` backend is unchanged (39 tools) until the cut.

**D3 · A separate client and separate registrations, never a branch inside a shared handler.**
- `src/block/client.ts`, `BlockApiClient`:
  - base `BLOCK_API_URL`, default `https://api.block.dwlf.co.uk`;
  - a key from `DWLF_BLOCK_KEY` or a constructor option;
  - with no key it reads `/public/v1/*`; with one, `/v1/*` with `Bearer <key>`. One client per caller, as
    `DWLFClient` already allows, which is the seam the hosted endpoint uses (D7).
- `src/block/tools.ts` registers the Block-API versions of the launch-set tools under the **same `dwlf_*` names**,
  with their own descriptions written for the envelope.
- The profile view registers exactly one implementation per name, chosen by the backend. `full` never sees the
  Block versions.
- *Why the same names:* an agent sees one profile in a session, so a name never means two shapes at once. The
  eval cases, `passthrough.json` and the install docs keep their names. **How an agent tells the shapes apart:**
  every Block-API result is the envelope (`responseVersion`, `summary`, `items`, `definitions`, `pricingUrl`); no
  SPT shape has `pricingUrl`.
  - *The cost, accepted:* outside a session (the README, registry listings, Academy), a name like
    `dwlf_explain_event` has two signatures: `type` + `since` on `full`, `eventType` + `from`/`to` on `block`.
  - The cut PR documents each launch-set tool's Block signature in `docs/BLOCK.md` and the registry listing,
    marked "Block profile". Docs about `full` keep theirs.
  - Distinct names (`block_*`) would avoid this. They were rejected because every Block install doc, eval case and
    agent prompt written since 4-Nov already uses `dwlf_*`.

**D4 · Pass-through (invariant 2; WP7's "never unwrapped").**
- **Conditions, events, series:** the response body, verbatim as JSON text. Events is one page: the Block API has
  no cursor, and no tool merges pages (WP4's open question stays open until custom events return). Parameters map
  one to one: `types` (comma-separated, at most 20), `from`/`to`, a series `id` and `from`.
- **The catalogue tools** keep the scoped exception the charter already gives them, narrowed: `/catalogue` is
  355 KB (578 items), too big to hand an agent whole.
  - **`dwlf_describe_onchain_events`** gives the catalogue envelope with its top-level fields unchanged and `items`
    narrowed to whole items matching the agent's filter (`family`, `search`, `eventType`). With no filter it gives
    no items, only a count per family, computed from the catalogue and added as its own key.
  - **Interim, and asked of WP2:** filtering and counting are computing the Block API should own, as its product
    surface. Ask: `/catalogue?family=&search=&type=` plus a per-family summary. When WP2 serves them, these tools
    pass that answer through and their local filter goes.
  - **`dwlf_explain_event`** gives the catalogue envelope narrowed to that one type, plus `occurrences`: the
    `/events?types=<type>` envelope, verbatim and whole.
  - The release gate's snapshot pins exactly this layer: the selection, the added counts, and the nested body by
    reference (`block-eval.md` §0 T1).
  - **What the SPT versions had that the Block API doesn't serve, and so goes at the cut:**
    - `dwlf_explain_event`'s `since` buckets (fired / published late / restated), its `revision` and
      `measuredHistory`, and its bundled offline definitions;
    - `dwlf_describe_onchain_events`' packs (`engine`, `quantum`, …), which become the catalogue's `family`.
    - Its parameters become `eventType` plus `from`/`to` for the occurrences window. The eval's `since-november`
      question then has no tool that answers it. That's recorded on its case, not hidden.
- **Locked items pass through as they come** (what and when, `requiredPlan`, `pricingUrl`). The descriptions tell
  the agent to say an item is locked and which plan reads it, and never to guess its value.

**D5 · The eval and the gate.**
- Under replay, `replayEnv` points `BLOCK_API_URL` at the fixture origin. The fixture server already sends
  `/public/v1` and `/v1` to the Block upstream.
- Each tool lands with:
  - its recording from the public routes (keyless, DWLF's own data);
  - an `eval/calls/` file and its snapshot;
  - a move from `passthrough.json` `cutPending` to `tools` (B14's coverage rule).

**D6 · Keys: what this does now, and what waits.**
- **Now:** the stdio client sends `DWLF_BLOCK_KEY` as `Bearer` when it's set; that's all. Before the keys release
  the Block API refuses a `dwlfk_` key. The tool returns that 401 body as the error, unchanged.
- **The account tool** (`/v1/me`, `/v1/terms/status`) arrives with the keys release, with a recording made from a
  Block **test** account's key.
- **The install migration at the cut:** a `--profile block` client holding only `DWLF_API_KEY` gets the keyless
  Free view and keeps working. On the `block-api` backend `DWLF_API_KEY` is ignored, with one stderr line saying
  so. `server.json` declares no required variable for the Block profile.

**D7 · The key-taking hosted endpoint: a decision for Andy, not made here; nothing hosted is built in this work.**
- `docs/HOSTED-MCP.md` (DWLF-622) is the hosted design in force. It puts OAuth 2.1 in front, a managed upstream key
  behind (§4.2), and **forbids token passthrough** (§2). A hosted endpoint that takes a person's `dwlfk_` key in
  `Authorization` and forwards it would contradict it. So the choice is Andy's, made there (§4.1, §9), with two
  options:
  - **A · HOSTED-MCP as written.** OAuth sign-in. The hosted MCP mints a managed key for the account through the
    Block API's keys route (`POST /v1/keys`, scoped to the client's grant) and calls the Block API with it. This is
    what the directories (Claude's, ChatGPT's) need, and it needs identity's OAuth surface first.
  - **B · Key-taking.** A person pastes their own `dwlfk_` key into a client that supports headers (Claude Code,
    Cursor). The MCP forwards it to the Block API, which exchanges it with identity. It's simple and has parity
    with stdio, but it isn't directory-eligible and it's the passthrough §2 forbids. It would need HOSTED-MCP
    amended, by Andy.
  - **Recommendation:** A for the hosted endpoint, the directory path, v1.1 as DWLF-622 plans. Until then, the
    key-taking path is **stdio**: `DWLF_BLOCK_KEY` on the person's own machine (D6), which needs no hosted
    endpoint and no passthrough.
- **The stub this work leaves:** `BlockApiClient` takes its key per instance (D3), so either option builds one
  client per request. No key-shape check lives here: the Block API refuses a malformed or unknown key with its own
  401, and the tool passes that through. That keeps `@andywilliams/dwlf-authz`, a private package, out of this
  public one.
- For WP2, whichever option is chosen: its per-IP limit on `/v1` (1,200 per 5 min) is below what one hosted egress
  IP sends for many accounts. Key it on `Authorization`, or exempt the hosted egress (`wp2-block-api.md`).

**D8 · Charter lines.**
- Rewritten now (by this note's PR):
  - *Depends on* (the Block API, behind D1's opt-in);
  - *Tool profiles* (`block` has two backends);
  - invariant 3 (`BlockApiClient` is the second authenticated client, for the `block-api` backend only);
  - invariant 6 (Block-API tools are a third wiring point, `registerBlockApiTools`).
  So PRs 2–4 land against a charter that already allows them.
- Rewritten at the cut: *Purpose*, *Not for*, invariants 1, 5 and 8, and the stdio decision's Block clause.
  The *Handed to WP4* list is answered here, item by item:
  - names (D3);
  - install migration and `server.json` (D6);
  - unwrapping (D4);
  - the key variable and client (D3, D6);
  - shared tools are registered once per backend, not branched (D3).

## 3 · Plan: one PR each, `npm test` only, no version bump until the cut

1. **This note** and the charter lines (docs only). `lgtm arch`.
2. **The client and three tools.** `BlockApiClient`, the `block-api` backend (D1), and `dwlf_get_conditions`,
   `dwlf_get_events` and `dwlf_get_series` on public routes, with recordings, calls and snapshots, and
   `replayEnv`. The three move into `passthrough.json` `tools`.
3. **The catalogue tools** (D4), with their recordings and snapshots.
4. **The cut release** (separate tap, timed with Andy and Jenna):
   - the default becomes `block-api`;
   - the 35 tools leave the profile;
   - `docs/BLOCK.md` and `server.json` are updated;
   - the charter lines in D8 rewritten;
   - version 0.69.0.

   The account tool follows the keys release.
