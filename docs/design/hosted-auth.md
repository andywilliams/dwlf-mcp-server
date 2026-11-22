# Hosted MCP sign-in: design (DWLF-622, hosted-auth step 1)

*20-Nov-2026. Andy decided the sign-in at 09:56: **(a) OAuth as the primary path** (Claude.ai and ChatGPT connectors:
click connect, sign in to Block, approve; per-app grants he can revoke, on DWLF's identity service), and **(b) a pasted
Block API key as the fallback** for local clients (Claude Code, Cursor), now that the account keys page exists
(block-site #71). This note turns that into a design, the contract each repo builds against, and PR-sized steps. It
amends `docs/HOSTED-MCP.md` (4-Nov) where that design assumed SPT and a managed upstream key, and it answers
`block-repoint.md` D7. Docs only: nothing is built or deployed by this PR.*

> **22-Nov-2026: Andy's answers (11:20, through Jenna).** They change the plan below where it disagrees:
> - **The pasted key comes first; one-click sign-in (OAuth) comes later.** The hosted endpoint launches with (b) only
>   (steps 2a, 2b, 3, a key-only step 8, then 9). The OAuth steps (4–7) follow as their own launch. Until they ship,
>   there's no authorization server to name, so the no-credential `401` (§4) carries no `resource_metadata` and the
>   RFC 9728 document isn't served. Both arrive with step 7.
> - **Q2: yes.** No credential gets a clear `401` that says where to get a key (§4).
> - **Q4: the hosted server's code lives in a private repo** (working name `dwlf-mcp-hosted`), not here. This
>   replaces H7 and H10. This repo publishes a library entry, `@dwlf/mcp-server/block` (`createBlockServer`, the
>   H11 recorder and a catalogue-cache seam; step 2a), so the tools stay one codebase. The private repo pins a
>   published version, and holds the HTTP entry, the CDK stacks and the deploy workflow (steps 2b and 3).
> - **DNS isn't a blocker.** The `dwlf.co.uk` zone's limit has been 10,000 records since 18-Nov (50 used). Q5 (the
>   name) is still open.
> - Still open: Q1 and Q3 (before step 5), and Q5 (before step 3 deploys).

## 0 · What exists (checked read-only, 20-Nov)

| Where | Has | Lacks |
|---|---|---|
| dwlf-identity | Signed, audience-scoped ES256 tokens (15 min) and JWKS. **Personal tokens** (`dwlfk_…`): create, list and revoke, exchange on the machine API `id-svc`, revoke by the email's link, a per-product kill switch. All built, with **the switches closed** (DWLF-782 6a/6b). Machine callers bound role → product in reviewed code (`machineCallers.runtime`). | **Any OAuth.** No authorize, token, PKCE, DCR, CIMD or RFC 8414 metadata. Its charter's 16-Nov decision ends "no renew route and **no OAuth in v1**". Its pages rule: static bytes, no reflected input, **sets and reads no cookie**. |
| dwlf-block-api | Keys (#42–#44): create, list and revoke through identity, a per-plan count (`apiKeysMax`) and scope (`keyScope`), `Bearer dwlfk_` exchanged at identity, the plan's allowance (`429 QUOTA_EXCEEDED`). **It already accepts delegated (`act`) tokens presented directly** (`src/auth/identity.ts`: "Block's buyers are agents"). | Anything about OAuth clients or consent. |
| block-site | `/account/` keys page: list, create (shown once), revoke, every refusal worded (#71, on staging). | A consent page; connected apps. |
| this repo | The stdio key path (`DWLF_BLOCK_KEY`, B4 D6). The local transport spike (`spike/hosted-http.mjs`: stateless Streamable HTTP, 401 + RFC 9728 metadata, Origin, body cap). | A shipped HTTP entry, infrastructure, OAuth verification. |
| DNS | `block.dwlf.co.uk` names live inside the `dwlf.co.uk` zone. It was full (50 of 50 rrsets) on 16-Nov, and its limit has been 10,000 since 18-Nov. | The 2 rrsets `mcp.block.dwlf.co.uk` needs (an alias record, the certificate's validation record). There's room. |
| SDK | `@modelcontextprotocol/sdk`: this repo locks 1.32.1; the latest on npm, 1.32.2, still speaks up to 2025-11-25. Its stateless mode already matches the 2026-07-28 shape (HOSTED-MCP §2). | 2026-07-28's header mirroring. That's taken when it ships, before any listing. |

## 1 · Shape

- **Endpoint:** `https://mcp.block.dwlf.co.uk/mcp` (staging: `https://mcp.block-staging.dwlf.co.uk/mcp`). Stateless
  Streamable HTTP, POST only, JSON responses (HOSTED-MCP §2–§3). **The URI is also the OAuth resource and token
  audience**, so it's permanent once the first grant exists. Step 3 makes the name live before any grant is
  issued. If Block ever moves domain, identity registers a second resource for `block`, the old URI keeps answering
  (or redirects), and old grants run out with their keys.
- **What it serves:** the Block profile on the **`block-api` backend only** (`BLOCK_API_TOOLS`, B4). It never calls
  SPT. So HOSTED-MCP §3's "what it calls: `api.dwlf.co.uk/v2`" and §5's SPT tier limits are replaced: the Block API
  is Block's complete surface (its charter), and its per-account allowance and plan checks apply to every call.
- **Runtime:** one Lambda per stage, from a CDK stack in the private hosted repo (22-Nov, Q4). A fresh `McpServer`
  and `BlockApiClient` are built per request from that request's credential, by `createBlockServer` from this
  repo's published `@dwlf/mcp-server/block`. **Nothing read with a credential is shared
  between callers.** Every hosted caller is signed in, and `/v1/catalogue` is the account's plan view, so the
  catalogue cache is keyed by the credential's SHA-256 (bounded, least recently used first). It's never
  process-wide, so a Free caller can't get a paid caller's view. On the hosted entry it lasts **60 seconds**, not
  stdio's 15 minutes: a cache hit makes no Block API call, so it can outlive a revocation by its own lifetime, and
  60 s keeps the revocation bound at about 16 minutes (H11) while still covering an agent's burst. This replaces HOSTED-MCP §3's shared loader, which
  assumed a public catalogue.
- **The edge:** CloudFront in front, with identity's shared web ACL `dwlf-edge`. AWS WAF can't attach to an API
  Gateway HTTP API, so CloudFront is how the endpoint gets per-IP rate rules. Adding the host's rules is a PR in
  dwlf-identity (that ACL's owner, DWLF-780).
- **Two credentials, both `Authorization: Bearer`, told apart by prefix.** `dwlfk` → a key; `eyJ` → a JWT; anything
  else → `401 invalid_token`. The prefix is a contract identity keeps (§10). The MCP doesn't parse either one beyond
  that; the Block API and identity are the validators.

| Credential | Who uses it | What the MCP does with it |
|---|---|---|
| `dwlfk_…` (a pasted personal key, **b**) | Claude Code (`claude mcp add --transport http dwlf-block https://mcp.block.dwlf.co.uk/mcp --header "Authorization: Bearer …"`), Cursor, any client that sets headers | Forwards it unchanged to the Block API, which exchanges it at identity (exactly what the stdio package does with `DWLF_BLOCK_KEY`) |
| an identity access token with `aud = https://mcp.block.dwlf.co.uk/mcp` (**a**) | Claude.ai and ChatGPT connectors, after OAuth | Verifies it locally (JWKS), **exchanges it at identity** for the normal `aud = block` delegated token, and calls the Block API with that |
| none | any client's first request | `401` with `WWW-Authenticate: Bearer resource_metadata="…"`, so connectors start OAuth (§4) |

## 2 · (b) The pasted key

- **Why this isn't the token passthrough HOSTED-MCP §2 forbids.** The spec's rule is about OAuth tokens: an MCP
  server must not accept a token the authorization server issued for another audience and forward it. A `dwlfk_` key
  isn't an OAuth token, and the MCP never treats it as its own credential. It's a Block API key the person created
  for an agent to use, and the hosted MCP only carries it to the Block API, the same as the stdio process on the
  person's machine does. The Block API validates it, through identity's exchange, on every call.
- **What it costs:**
  - the key crosses DWLF's endpoint on every request. TLS only, never logged (the log line holds a hash), never
    stored, held only for the request;
  - it isn't directory-eligible (ChatGPT bars API-key auth; Claude's directory wants OAuth). It's for local clients.
- **What the person does:** create a key on `block.dwlf.co.uk/account/`, then paste it into the client's header
  setting. The keys page's help text (block-site, step 6) shows both commands.
- **What stays the same:** the npm package with `DWLF_BLOCK_KEY` is still the other local route, and needs no hosted
  endpoint at all.
- **How "only a key, only to the Block API" is held mechanically:**
  - one function routes the credential, and the only place a forwarded value goes is the `BlockApiClient`, whose base
    URL is fixed by the stack's configuration, never by the request;
  - a test sends a JWT, a junk value and a key through the hosted entry against the fixture server, and fails if
    anything but the key appears in an outbound `Authorization`, or if the key reaches any host but the Block API;
  - logs hold the credential's SHA-256, never the value, with a test over the log lines. Identity's `dwlf-edge` ACL
    keeps metrics only, with no sampled requests (identity charter, 13-Nov: samples would expose `Authorization`).

## 3 · (a) OAuth: identity is the authorization server

### 3.1 The flow

```
client ──1 POST /mcp (no token)────────────────────▶ MCP: 401 + resource_metadata
client ──2 GET  /.well-known/oauth-protected-resource/mcp ─▶ MCP: { resource, authorization_servers: [id.dwlf.co.uk], scopes }
client ──3 GET  id.dwlf.co.uk/.well-known/oauth-authorization-server ─▶ identity (RFC 8414)
client ──4 (DCR, or a CIMD client_id URL)
browser ─5 GET  id.dwlf.co.uk/oauth/authorize?…PKCE S256…&resource=…/mcp ─▶ identity: checks client + redirect_uri,
                                                                        stores the request, 302 ▶
browser ─6 block.dwlf.co.uk/connect/?request=<id>  (the Block site: a fresh sign-in, then the consent screen)
site ────7 POST api.block…/v1/connect/requests/<id>/approve ─▶ Block API: plan count + scope ─▶ identity (SigV4 + the
                                                                        person's token): grant created ▶ redirect URL
browser ─8 302 to the client's redirect_uri ?code&state&iss
client ──9 POST id.dwlf.co.uk/oauth/token (code + verifier + resource) ─▶ access token (aud = …/mcp, 15 min) + refresh
client ─10 POST /mcp (Bearer) ─▶ MCP: verify ▶ id-svc exchange (SigV4) ▶ aud=block token (cached) ▶ Block API
```

### 3.2 Decisions

**H1 · An OAuth grant is a personal token of kind `oauth` (proposed to identity; identity's own design decides).**
This repo depends only on H2's contract (the access token's claims and the exchange route). If identity chooses a
separate grant record instead, this repo doesn't change; the Block API's listing and the site's connected apps
would. The proposal: it's created at consent as a personal token whose
secret is never issued: the client holds a refresh token instead. It records the client's name, `client_id` and
redirect host. Everything identity and the Block API already do for keys then applies with no second system:
- it appears in the keys list (the site shows it under "Connected apps") and is revoked the same way, by the person,
  by the email's link, by staff, or by the product's switch;
- the creation email, audit (`created`, `revoked`, `used` hourly), identity's caps (10 live, 10 an hour) and the 15-min
  revocation bound;
- the Block plan's key count and scope (`apiKeysMax`, `keyScope`). Whether a connection counts toward the plan's
  key count is question Q1 (§9).

*Why not HOSTED-MCP §4.2's managed upstream key:* that design minted a real key per grant and stored it
KMS-encrypted in the MCP stack, because SPT had no exchange. Identity now has one. A grant-backed exchange leaves
the MCP holding no secret at rest, and revoking the grant is one action in one place.

**H2 · The MCP exchanges, never forwards, an OAuth token.**
- It checks the access token locally first, only to fail fast with the right `401`: the standard JWT checks
  (ES256 against identity's JWKS, the pinned issuer, `aud` equal to its canonical resource URI exactly, the expiry),
  and no scope (H4). It uses a public JWT library, not `@andywilliams/dwlf-authz`, which is private and stays
  out of this public repo (block-repoint D7). **Identity's exchange is the authoritative check:** it re-verifies the
  token and owns every identity-specific claim rule (`act`, the grant, revocation). So a change to those rules can't
  be missed here: an exchange this repo can't use fails with identity's error, and step 8's staging run covers it.
- Then it calls identity's machine route (new, on `id-svc`, SigV4-signed by the MCP's runtime role, which identity
  binds to product `block` in `machineCallers`). It gets back the token a key exchange returns: `aud = block`,
  `act: { sub: key_… }`, permissions = the grant's ∩ the person's current ones ∩ `delegable`, 15 min, no refresh.
- It caches that token by the access token's SHA-256 until 60 s before either one expires, then calls the Block API.
- *Why the MCP exchanges, not the Block API:* the Block API accepting a token issued for the MCP and exchanging it
  itself would be the passthrough the spec forbids, moved one hop: a token for one audience accepted by another.
- This makes identity's `id-svc` the MCP's **third authenticated outbound host** (after SPT and the Block API), with
  its own sole signer (SigV4). `hosted/` is inside invariant 3's scope (people run it). The invariant ("the second
  and last authenticated client") is rewritten when the exchange lands (step 7) to drop "last": **one authenticated
  client per outbound host, each the only code that sets `Authorization` or signs for that host, and a new host is a
  charter change with an *Interfaces* row.** The JWKS fetch is unauthenticated and joins *Interfaces* too.
- **The MCP's runtime role is created once and kept** (H8).

**H3 · Consent is the Block site's page, approval goes through the Block API, and identity serves no page.**
- Identity's `GET /oauth/authorize` validates the client and the exact redirect URI, requires PKCE S256 and a
  registered `resource`, stores the request (single use, 5 min) and **302s** to the product's consent page. A
  redirect isn't a page, so identity's pages rule holds.
- An invalid redirect URI or client gets a plain `400` from identity, never a redirect (RFC 6749 §4.1.2.1).
- The Block site signs the person in, fresh, and shows **the client's name and the redirect host verbatim**, the
  permissions in words, and Approve / Deny.
- Approve goes to the Block API, which applies the plan's count and scope as it does for key create. Then it calls
  identity's machine route with SigV4 plus the person's token: for product `block`, not delegated, a sign-in within
  10 minutes. Identity creates the grant and answers with the redirect URL (`code`, `state`, `iss`, RFC 9207).
- *Why through the Block API:* the plan rules for keys live there (`src/apikeys/policy.ts`). A second path that skips
  them would let a Free account hold unlimited agents.

**H4 · Scopes are Block's permission names, and the Block API applies them.** `scopes_supported` lists what
the launch tools need: `data:read` (plus `account:read` when the account tool lands). A broader request is capped
to the plan's `keyScope`. **The MCP keeps no tool → scope map.** A challenge is sent only when a step-up can work:
- **OAuth, and the Block API says the permission is one the plan allows but the token lacks:** `403` with
  `error="insufficient_scope"` and that permission as `scope="…"` (HOSTED-MCP §4.3), so the client steps up;
- **the plan doesn't allow it** (`PLAN_REQUIRED`): a tool result with the Block API's body and `upgradeUrl`. A
  re-authorization would be capped to the same scope and loop, so no challenge is sent (HOSTED-MCP §4.3's "a
  step-up never loops" stays true);
- **a pasted key:** a tool result with the Block API's body, never a challenge. A key's scope is fixed, and a
  challenge with `resource_metadata` would invite the client to start OAuth in place of the header the person set.
- This needs the Block API's refusal to tell those two cases apart and name the permission (a contract ask, §10).

**H5 · Client registration (HOSTED-MCP §4.4, unchanged):** CIMD first, with the fetch guards (HTTPS only, no
private or link-local addresses after resolution, ≤ 5 KB, 5 s, cached at most 24 h). DCR as the fallback, for public
clients only (`token_endpoint_auth_method: none`), rate-limited per IP, with unused registrations expiring after 30
days. Pre-registered ids for directories that issue fixed ones.

**H6 · Tokens:**
- Access token: ES256, `aud` = the resource, `sub`, `account`, `act.sub` = the grant's key id, `client_id`, `scope`,
  15 minutes.
- Refresh token: one per grant and client, rotated on every use. Reuse of a spent one revokes the grant. It lives as
  long as the grant does (at most identity's 365-day key lifetime).
- This is identity's first refresh token for a delegated grant. Its charter says delegated tokens get no refresh;
  identity's design records the exception.

**H7 · The hosted entry never reaches the npm package.** *(Superseded 22-Nov by Q4's answer: the hosted entry lives
in the private repo, so it can't reach the tarball at all. What carries over: the npm package's files and runtime
dependencies don't change (`test/blockServer.test.mjs` pins `files`); the hosted repo's runtime libraries are its own
production dependencies, audited there; and it gets the tools only through `@dwlf/mcp-server/block`.)* It lives in `hosted/` (its own tsconfig, bundled for the
Lambda), outside `src/`, so `dist/` and the published tarball don't change. `hosted/` is **its own private package**
(`hosted/package.json`, `"private": true`, its own lockfile). Its runtime libraries (JWT verification, SigV4, the AWS
SDK) are that package's production `dependencies`, so `npm audit --omit=dev` there and a Dependabot entry for
`/hosted` treat a flaw in them as production. The npm package's runtime dependencies stay
`@modelcontextprotocol/sdk`, `axios` and `zod`. It imports the tool registration (`registerForProfile`) from
`src/`, so the tools stay one codebase. A test pins that the root `package.json` `dependencies` and `files` are
unchanged by the hosted entry.

**H8 · The MCP's runtime role is a lasting identity.** Identity binds it by its unique role id, so a re-created role
(even under the same name) is refused, and every OAuth call fails while pasted keys keep working, which would hide
the outage. So, as Block's invariant 17 does:
- the role lives in its own small stack (`DwlfMcpHostedRuntime-<stage>`), never redeployed for a rollback, with a
  retain policy and a test pinning its construct id and name;
- only the hosted Lambda may assume it, under a fixed session name;
- step 3 adds the matching charter invariant: re-creating or renaming it needs an identity PR first.

**H9 · Limits without a store.** The stack holds nothing at rest. A Lambda instance runs one request at a time and
concurrent requests land on other instances, so an in-memory counter limits nothing. (In-memory *caches* still
help: a warm instance serves a client's next requests, and an agent's calls come in bursts. They're an
optimisation, never a limit, and nothing depends on their hit rate.) Instead:
- **Per credential:** a WAF rate rule on the MCP's host, keyed on the `Authorization` header (the shape `/v1` already
  uses at the Block API). It works the same on both paths, since the MCP can't see the account behind a pasted key.
- **Per source IP:** a rate rule on the MCP's host keyed on the client's IP, as on every DWLF host. On the
  pasted-key path the `Authorization` value is whatever the caller sends, so a flood with a fresh random
  `dwlfk_…` per request would get a fresh per-credential bucket each time. The per-IP rule bounds it before it
  reaches the MCP's egress. A junk key costs identity nothing, fresh or repeated: every key is created through
  the Block API, which keeps the id of each one it created, and a key carries its id (`dwlfk_<key id>_…`). So the
  Block API refuses an id it never created without asking identity (identity's personal-tokens design, T4: "the
  product refuses unknown ids locally"). Only a real key id with a wrong secret reaches the exchange, and that's
  identity's per-key limit and wrong-secret alarm.
- **Overall:** the function's reserved concurrency.
- **The plan's allowance** stays the Block API's, per account, and it bounds what an agent loop costs.
- **Deferred:** HOSTED-MCP §6's loop guard and §5's per-account concurrency cap. Both need shared state. If step 8's
  staging traffic shows they're needed, they come with a small table, and the "nothing at rest" line in the charter
  changes in the same PR.
- **Egress:** all hosted traffic leaves from the MCP's Lambda, so the Block API's per-IP backstop on `/v1` (12,000
  per 5 minutes, beside the per-key 1,200, in identity's `dwlf-edge`) could throttle every hosted user at once.
  That's a contract ask (§10), sized from step 8's traffic before launch.
- **Identity's exchange limit:** with a cold cache, every OAuth request is one exchange, counted against identity's
  per-product limit for `block`. That's the bucket the Block API's own key exchanges use, so a burst of hosted
  traffic could refuse Block's API-key callers. That's a contract ask (§10): the MCP's caller gets its own bucket,
  sized from step 8.

**H10 · Deploying from a public repo.** *(Superseded 22-Nov by Q4's answer. In the private repo the same rules
carry over, with that repo's own release in place of this repo's tag: deploys only from its published tags,
staging automatically and production by hand with Andy's approval, through a GitHub OIDC role per stage; its
`package.json` pins an exact `@dwlf/mcp-server` version, and the deploy checks that version is on npm with a
`gitHead` on this repo's master. A tool change reaches hosted by an npm release here, then a pin bump there. The
dispatch from `publish.yml` below isn't built.)* The CDK code is reviewable here, but nothing deployable is committed: the
account, region and the identity binding come from CI environment variables and SSM. Deploys run only from
published `v*` tags, through a GitHub OIDC role per stage trusted for that stage's environment alone, and fork
PRs can't reach either: **staging** deploys automatically on each tag (`hosted-staging`, tag refs only, no
approval); **production** deploys by hand from a tag (`hosted-production`, tag refs only, Andy's approval).
*Automatically* means `publish.yml`, after it pushes the tag, starts the deploy with `gh workflow run
deploy-hosted.yml --ref v<version>`. A tag pushed with `GITHUB_TOKEN` (as `publish.yml` does) starts no
`on: push: tags` workflow, but `workflow_dispatch` is exempt from that rule. That step needs `actions: write` added
to the publish job's permissions (today it has only `contents` and `id-token`), and it runs only after npm and the
tag are done, so a failed dispatch can't undo a release. A test of the workflow files pins both the call and the
permission, so staging can't silently stop following releases.
- **The deploy checks the tag is a release** before it deploys, on both stages: the tag's commit is on `master`,
  `package.json` at that commit names the tag's version, and `npm view @dwlf/mcp-server@<version> gitHead` (the
  commit npm recorded at publish) equals that commit. A hand-pushed tag on any other commit fails there, approval
  or not. *Not taken:* a private deploy repo importing
this code (one more repo to keep in step with the tools, for a gain that's only obscurity) (Q4).
- **A hosted deploy is a release.** The workflow deploys only a published version: it takes a `v<version>` tag
  (the one `publish.yml` creates after `npm test` passes and npm accepts the version), checks it out and runs
  both suites again: the root `npm test` and `hosted/`'s own tests (credential routing, log hashing), from both
  lockfiles. The PR workflow runs both suites too. So hosted and npm always run the same tool code, and master between bumps never goes live.
  Changing only `hosted/` or `infra/` still needs a version bump (invariant 7) to deploy. That's a patch release
  with no change for npm users, which is accepted: one version names one deployable thing. Staging deploys on each
  published tag automatically; production waits for the environment's approval, so hosted can trail npm by one
  approval, never lead it. `serverInfo.version` says which version answered. *Accepted:* an npm outage delays a
  hosted fix (no tag, no deploy). The break-glass meanwhile is closing the switch.

## 4 · Errors an agent can act on

Every refusal says what happened and the next step, in words, plus the machine-readable field.

| Case | Answer |
|---|---|
| No credential (key-only launch, 22-Nov) | `401`, `WWW-Authenticate: Bearer realm="DWLF Block"`, body `{ error: "unauthorized", message, getKey }`. `message`: "This server needs a DWLF Block API key. Create one at https://block.dwlf.co.uk/account/ and send it as `Authorization: Bearer <key>`." `getKey`: that URL. |
| No credential (once OAuth ships, step 7) | `401`, `WWW-Authenticate: Bearer resource_metadata="https://mcp.block.dwlf.co.uk/.well-known/oauth-protected-resource/mcp"`, body `{ error: "unauthorized", message, connect }`. `message`: "Sign in to DWLF Block to use this server." `connect` names both ways in: in Claude or ChatGPT, add the connector and sign in; in Claude Code or Cursor, create a key at https://block.dwlf.co.uk/account/ and send it as `Authorization: Bearer <key>`. |
| A token that fails verification, or expired | `401` with `error="invalid_token"` in the challenge (the client refreshes or re-runs OAuth). Never `403` (Claude's directory rule). |
| A key or grant that's revoked or expired (the Block API's or identity's 401) | `401`: "This key or connection no longer works. Create a new key at …, or reconnect the app." |
| Not enough scope (OAuth, grantable; H4) | `403`, `error="insufficient_scope"`, `scope="…"`. |
| Identity's exchange throttled | `503` with `Retry-After`, never `401`. A `401` would make the connector refresh or re-run OAuth, and every retry would need another exchange: a refresh storm against the bucket that's throttling. |
| Identity's exchange unreachable | `503`: "Sign-in checks are unavailable for a moment; try again shortly." |
| The plan's limit, quota or a locked family | A tool result with `isError`, carrying the Block API's body whole (`PLAN_REQUIRED`, `QUOTA_EXCEEDED` with `resetsAt` and `upgradeUrl`). The agent tells its person. |
| Switch closed (before launch) | `503`, body: "DWLF Block's hosted MCP isn't open yet. Use the npm package: `npx -y @dwlf/mcp-server --profile block`." |

The wording follows the shared banned-terms list (the release gate's T2 runs over these strings too).

**How a refusal inside a tool call becomes an HTTP status (H11).** A revoked pasted key or a missing permission
shows up only when a tool calls the Block API. By then, `failure()` has turned it into tool text, and
`initialize` and `tools/list` succeeded. So:
- `BlockApiClient` takes an optional per-request **upstream recorder** (in `src/`, shared; the stdio server passes
  none, so its output doesn't change). *(Built in step 2a with status, Block's `code`, and whether the body was Block's own. The
  permission named comes with step 7, once the Block API's refusal names it, §10.)* The client notes each Block API refusal on it: status, Block's `code`, the
  permission named (H4), and whether the answer was Block's own body or the edge's.
- After the handler returns, the hosted entry reads the recorder. A Block API `401` replaces the JSON-RPC answer
  with the §4 HTTP `401`. A permission refusal replaces it with `403` `insufficient_scope` **only under H4's rule**:
  on the OAuth path, when the Block API says the plan allows the permission. A `PLAN_REQUIRED` refusal, and any
  refusal on the pasted-key path, stays a tool result with the Block API's body. The request is stateless, so
  replacing the answer loses nothing. Every other refusal stays a tool result.
- On the OAuth path, identity's exchange runs **before** dispatch (it's needed for any Block call), so a revoked
  grant answers `401` before any tool runs at its next exchange. A cached exchanged token keeps working until it
  expires, and a cached catalogue for up to 60 s more (§1), so revocation takes effect within about 16 minutes:
  identity's 15-minute bound, the same as for keys, plus the catalogue cache.
- Tests: a revoked key on `tools/call` gives HTTP `401` with the challenge; on OAuth, a grantable permission refusal
  gives `403` with `scope`; a `PLAN_REQUIRED` refusal, and a permission refusal on a pasted key, give a tool result
  and no challenge; a stdio run with the same recordings gives today's tool text.

## 5 · Alarms

The OAuth path can fail while the key path stays healthy (a re-created role, a throttled exchange), and only
detection catches that. Each goes to the same alerts address as DWLF's other stacks:
- **exchange refused or throttled:** the MCP logs each failed exchange by kind (`exchange-refused` with identity's
  code, `exchange-throttled`, `exchange-unreachable`), and a metric alarm fires on any of them over a few minutes.
  Identity's own alarms (refusals, an unmapped caller) see the same failure from its side;
- **5xx and function errors** on the hosted Lambda;
- **upstream failures:** a Block API failure is usually an HTTP-200 tool result, invisible to a 5xx alarm. So the
  hosted entry logs each one from H11's recorder by kind: `upstream-edge-refused` (a 403 or 429 without Block's body,
  meaning the edge's rate rules, such as H9's per-IP backstop, refused the shared egress), `upstream-5xx`,
  `upstream-unreachable`. A metric alarm fires on those. An account's own `QUOTA_EXCEEDED` or `PLAN_REQUIRED` is
  logged, not alarmed: that's the plan working;
- **the switch unreadable** (SSM): the MCP answers closed and alarms, so it fails closed and loud;
- an external check on `/.well-known/oauth-protected-resource/mcp` once it's live, since an outage that never
  reaches the Lambda (DNS, certificate) produces no 5xx (identity's accepted debt, same mitigation).

## 6 · Dark until launch, and the stops

- **The MCP's switch:** SSM `/dwlf-mcp-server/hosted/<stage>/open`, read with a 60-second cache. Closed means every
  request gets the `503` above. The stack ships closed.
- **Identity's switches:** the per-product personal-tokens switch (already built) also stops every OAuth grant,
  since a grant is a personal token. Identity adds an OAuth switch for authorize and token.
- **To stop one agent:** revoke its connection or key (the person, the email's link, or staff).
- **Rollback:** close the switch (about a minute), or redeploy the previous app stack (never the role's stack, H8).
  Nothing is migrated.

## 7 · Threats (beyond HOSTED-MCP §6)

| Threat | Control |
|---|---|
| Consent phishing: an attacker starts the flow with their own client and sends the victim the consent link | The consent screen shows the redirect host verbatim. The grant goes to the person who approves, and the code goes to the attacker's redirect host only if the person approves that host. The creation email names the client, with a one-click revoke. |
| A stolen access token | 15 minutes, `aud` bound to the MCP, so it's useless at the Block API directly. |
| A stolen refresh token | Rotation with reuse detection revokes the grant. The person can revoke it on the keys page. |
| A stolen pasted key | The same as any key: revoke, 15-min bound, the creation email. The MCP never logs or stores it. |
| A compromised MCP host, OAuth path | It can exchange only tokens issued for the MCP, only for `block`, for at most each grant's permissions, each for 15 minutes. It holds no secrets at rest. Identity's exchange is limited per product. |
| A compromised MCP host, pasted-key path | **Worse, and the cost of (b):** it sees each key in flight and could replay it until the key is revoked (up to 365 days). What bounds it: a key carries only the plan's delegable permissions, and it never creates keys or spends money (identity's ceiling); the creation email and revocation; identity's audit of use. The docs steer anyone whose client supports OAuth to OAuth, and the npm package keeps the key on the person's own machine. |
| An agent looping | The Block API's allowance, and H9's per-credential rate rule. |

## 8 · Steps

Each step is one PR unless noted. Every merge, deploy and switch flip needs a tap.

| # | Repo (owner) | What | Rough effort |
|---|---|---|---|
| 1 | this repo | This design, HOSTED-MCP amended, the charter lines, the contract asks (§10) | 1 day |
| 2a | this repo | The library entry `@dwlf/mcp-server/block`: `createBlockServer` (the Block profile on `block-api`, signed in with the caller's key), H11's upstream recorder on `BlockApiClient`, a catalogue-cache seam the host keys by credential. A minor release. | ½ day |
| 2b | the private hosted repo (new) | The HTTP entry: the pasted-key path, the `401` that says where to get a key, Origin, body cap, the 24 s deadline, the per-credential 60 s catalogue cache, the §4 errors with H11's recorder, the closed switch, credential routing and log hashing tests. Local tests only. | 2 days |
| 3 | the private hosted repo, plus dwlf-identity for the edge ACL | CDK stacks (the role's, H8; the app's: Lambda, HTTP API, CloudFront, domain, alarms, switch, reserved concurrency), the deploy workflow (H10) and the role invariant. Deploy to staging, closed. | 2 days |
| 4 | dwlf-identity (identity session) | Charter and design for OAuth (it reverses "no OAuth in v1"), then the build: RFC 8414 metadata; authorize; token with rotation; CIMD and DCR; the request-read and approve/deny machine routes; the MCP's exchange route and caller binding; revocation (RFC 7009); WAF rules for `/oauth/*`; the OAuth switch | ~2 weeks, **the critical path** |
| 5 | dwlf-block-api (WP2/keys) | `/v1/connect/requests/{id}` read, approve, deny; grants in `GET /v1/keys` as connected apps; OpenAPI | 2–3 days |
| 6 | block-site (WP6) | `/connect/` consent page; connected apps on `/account/`; the paste-a-key help | 2 days |
| 7 | the private hosted repo (and this repo if `createBlockServer` needs a seam) | The OAuth path: verify, exchange, cache, `insufficient_scope`; invariant 3 amended | 2 days |
| 8 | all | Staging end to end: a Claude.ai custom connector, a ChatGPT connector, the MCP Inspector, Claude Code and Cursor with a key; a revoke stops access within about 16 min (H11). An independent security pass on `/oauth/*`. | 2–3 days |
| 9 | both | Launch: switches open, `server.json` gains `remotes`, `docs/BLOCK.md`, a version bump. Directory listings are later, each a separate decision for Andy (Claude's policy §4A on crypto). | ½ day |

- **Order (22-Nov):** 1, 2a, 2b, 3, then step 8 for the pasted key alone, then 9: the key-only launch. Then 4 (identity),
  5, 6 and 7, step 8 again for OAuth, and OAuth's own launch. The pasted key (b) works on staging after step 3, with
  no identity work.
- **Before launch:** the keys release (identity's keys switch and Block's keys on in production), B4's cut at or
  before launch, and §10's limit asks answered and sized from step 8 (the egress backstop
  and the MCP's exchange bucket, H9).

## 9 · Questions for Andy (Q2 and Q4 answered 22-Nov; Q5 before step 3 deploys; Q1 and Q3 before step 5)

1. **Does a connected app count toward the plan's key limit?** Recommended: yes. One list, "keys and connected
   apps", and otherwise a Free account could connect unlimited agents.
2. **Answered 22-Nov: yes, with a clear `401` that says where to get a key.** **The hosted endpoint answers `401` to a request with no credential**, which is what makes Claude and ChatGPT start
   OAuth. The keyless Free view stays in the npm package. Recommended: yes.
3. **Approving a connection needs a fresh sign-in** (identity's 10-minute step-up, as for creating a key).
   Recommended: yes.
4. **Answered 22-Nov: no, a private repo** (see the note at the top). **The hosted stack's CDK code and the `hosted/` package live in this public repo** (H7, H10: nothing deployable
   committed; deploys only from published tags, staging automatically, production by hand with his approval).
   Recommended: yes.
5. **The domain is `mcp.block.dwlf.co.uk`** (HOSTED-MCP §9 Q3's recommendation), and it becomes a permanent token
   audience. It needs 2 rrsets in the `dwlf.co.uk` zone, which has room (its limit has been 10,000 since 18-Nov).
   Recommended: yes. **Identity registers the resource only after step 3 has the name live**, so
   no grant names a host that can't be served.

## 10 · The contract asks

Each owner reviews its part before building. Nothing here is decided for another repo; each records its own
decisions in its own charter.

- **dwlf-identity:**
  - RFC 8414 metadata at `https://id.dwlf.co.uk/.well-known/oauth-authorization-server`, with the issuer that signs
    the tokens;
  - `GET /oauth/authorize` and `POST /oauth/token` as H3 and H6 describe, PKCE S256 only, `resource` required and
    registered (`https://mcp.block.dwlf.co.uk/mcp` → product `block`, and the staging resource → `block-staging`),
    each only once its host is live (Q5);
  - CIMD and DCR (H5);
  - a grant as a personal token of kind `oauth` (H1);
  - machine routes on `id-svc` for the Block API: read a pending request (client name, redirect host, scope), and
    approve or deny it (SigV4 plus the person's token);
  - a machine route for the MCP: exchange an MCP access token for the `aud = block` delegated token (H2), with the
    MCP's runtime role in `machineCallers`;
  - RFC 7009 revocation; an OAuth switch; WAF rules for `/oauth/*`, and the MCP's host with a rate rule keyed on
    `Authorization` (H9);
  - the hosted egress and `/v1`'s per-IP backstop (H9): an exemption for the MCP, or a ceiling that fits, before
    launch (the ACL is identity's; the Block API's charter records the route contract);
  - the MCP's exchanges in their own limit bucket, not the Block API's (H9);
  - **the key prefix stays a contract:** every personal key starts `dwlfk` (any format version, `dwlfk<n>_`, as
    `PERSONAL_TOKEN_PATTERN` matches), and no identity JWT can (a JWT starts `eyJ`). The MCP routes on it (§1).
    Asked: a test in authz pinning that every format version starts `dwlfk`, so a new version goes red there first.
    The MCP's answer to an unknown prefix says it isn't a DWLF key or token, so a miss is legible.
- **dwlf-block-api:** a permission refusal names the missing permission and says whether the plan allows it
  (grantable: step-up) or not (`PLAN_REQUIRED`) (H4); read, approve and deny routes for a
  pending request, applying the key policy; grants listed with
  keys (kind, client name, redirect host); the OpenAPI; and Q1's answer applied to `apiKeysMax`.
- **block-site:** `/connect/` (fresh sign-in, client name, redirect host, permissions in words, approve and deny);
  connected apps with revoke on `/account/`; help text for pasting a key into Claude Code and Cursor.
