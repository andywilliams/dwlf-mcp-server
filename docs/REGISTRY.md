# Listing in the official MCP Registry (for Andy; not done)

The package is ready for the [official MCP Registry](https://modelcontextprotocol.io/registry/quickstart):
`package.json` carries `mcpName` and `server.json` sits at the repo root (schema 2025-12-11). **Nothing has been
submitted.** Listing is external and permanent: versions are immutable and cannot be unpublished. Andy decides when.

## The one decision: the namespace

`mcpName` / `server.json` `name` is **`uk.co.dwlf/mcp-server`**, the reverse-DNS form of dwlf.co.uk. That needs
domain proof (a DNS TXT record, or `https://dwlf.co.uk/.well-known/mcp-registry-auth`). The alternative is GitHub
proof with `io.github.andywilliams/dwlf-mcp-server`: no DNS change, but the name carries the personal GitHub handle.
To switch, change both files in one commit (a test pins them equal) and publish a new npm version first.

## Steps, in order

1. **Publish an npm version that contains `mcpName`.** The registry checks the published package, not the repo.
   Merging this PR to master publishes `0.61.0` through `.github/workflows/publish.yml`.
2. **Prove the namespace (DNS):**
   ```bash
   openssl genpkey -algorithm Ed25519 -out key.pem   # keep key.pem out of the repo
   PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
   echo "dwlf.co.uk. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
   ```
   Add that TXT record to dwlf.co.uk, then:
   ```bash
   PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
   mcp-publisher login dns --domain dwlf.co.uk --private-key "${PRIVATE_KEY}"
   ```
3. **Publish the metadata:** `mcp-publisher publish` from the repo root.
4. **Verify:** `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=uk.co.dwlf/mcp-server"`.

## Keeping it in step

- Every release bumps `server.json` `version` and `packages[0].version` with `package.json`. `test/profiles.test.mjs`
  fails otherwise.
- The registry is a preview: re-read the quickstart before publishing, in case the schema moved.
- A later step can automate publishing from CI ([registry GitHub Actions guide](https://modelcontextprotocol.io/registry/github-actions)).
  It isn't done here, because each listing is Andy's decision.
- `remotes` (a hosted endpoint) comes with the hosted MCP (DWLF-622, `docs/HOSTED-MCP.md`).
