# Step 6: Build on it

Use this repository as a starting point for your own MCP server. Each recipe names the files to change and the Auth0 setting to match. After any change, run `npm run verify`. It should still print `VERIFIED`.

| Recipe | You want to | Main change |
|---|---|---|
| [1](#1-add-your-own-protected-tool) | Add a tool that only some users can call | `server.mjs`: one map entry and one tool |
| [2](#2-call-your-own-api-for-the-user) | Call your own backend for the signed-in user | Swap `reports-api.mjs` for your API |
| [3](#3-reach-another-third-party-api-through-token-vault) | Act in another SaaS account the user has (Google, Slack, ...) | A second Token Vault connection |
| [4](#4-connect-a-standard-mcp-client) | Use the server from a real MCP client | No code change |
| [5](#5-run-it-beyond-localhost) | Deploy it at a public URL | Three settings that must match |
| [6](#6-where-to-take-it-next) | Go further with Auth0 for AI agents | FGA, async authorization, CIMD |

## 1. Add your own protected tool

**In `server.mjs`:**

1. Give the tool a permission in `TOOL_SCOPES` ([line 16](../server.mjs#L16)). This one map drives the protected-resource metadata (`scopes_supported`), the scopes named in the 401, and the 403 that names the missing scope.

   ```js
   const TOOL_SCOPES = { read_report: REPORT_SCOPE, github_profile: GITHUB_SCOPE, github_open_prs: GITHUB_SCOPE,
     list_invoices: "read:invoices" };
   ```

2. Register the tool inside `buildServer(auth)` ([line 110](../server.mjs#L110)), next to `whoami` and `read_report`. `auth.sub` is the user, and `auth.scopes` is what they may do:

   ```js
   server.registerTool(
     "list_invoices",
     { description: "List the user's invoices. Requires read:invoices.", inputSchema: {} },
     async () => {
       if (!auth.scopes.includes("read:invoices")) {
         return { isError: true, content: [{ type: "text", text: "insufficient_scope: requires read:invoices" }] };
       }
       return { content: [{ type: "text", text: `invoices for ${auth.sub}` }] };
     },
   );
   ```

**In Auth0:** add the permission `read:invoices` to the MCP server API (guide step 2.2), and add it to the role (step 2.4). Add it to `LOGIN_SCOPE` in `.env`, then sign in again so the new token carries it.

**Test it:** copy a scope test from `test/e2e.test.mjs` (search for `insufficient_scope`). Then check both a token without the permission (expect 403) and one with it (expect the tool result).

## 2. Call your own API for the user

`read_report` shows the pattern: the server never forwards the user's token. It exchanges the token for one issued to the backend ([line 142](../server.mjs#L142)).

1. **Your API checks the exchanged token.** Copy the check from [`reports-api.mjs`](../reports-api.mjs#L30): signature and issuer against the tenant's JWKS, `aud` equal to *your API's* identifier, `exp` and `sub` present, and the permission in `permissions`. Exchanged tokens have no `scope` claim.
2. **In Auth0:** register your API (guide step 2.3) and create a client grant from the token-exchange application to it, with `subject_type: user` (step 2.6).
3. **In `.env`:** point `REPORTS_API_URL` at your API and set `REPORTS_AUDIENCE` to its identifier.
4. **Keep the refusal.** Send the user's own token straight to your API. It must answer 401, as in demo request 5.

Docs: [Call first-party APIs on a user's behalf](https://auth0.com/ai/docs/mcp/get-started/call-your-apis-on-users-behalf)

## 3. Reach another third-party API through Token Vault

The GitHub tools exchange the user's token for their GitHub token inside Token Vault (`exchangeForGithub`, [line 102](../server.mjs#L102)). The MCP client gets the tool result, never the provider credential.

1. **In Auth0:** set up the provider's social connection with your own OAuth app, and turn on Token Vault (connected accounts) for it. See guide step 4.
2. **In `server.mjs`:** copy `exchangeForGithub` with the new connection name (for example `google-oauth2`), and add a tool that calls the provider's API with the returned token. Give the tool its own permission (recipe 1).
3. **Link an account:** `scripts/connect-github.mjs` hardcodes `connection: "github"` ([line 27](../scripts/connect-github.mjs#L27)). Copy it and change the connection name.

Docs: [Token Vault](https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault) · [Connected accounts](https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault/connected-accounts-for-token-vault)

## 4. Connect a standard MCP client

The server speaks standard MCP over streamable HTTP with bearer tokens. A client that supports that transport and a protocol version the bundled SDK implements (up to `2025-11-25`) can use it. With both servers running (guide step 3) and a saved token, try the official [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) from the command line:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http \
  --header "Authorization: Bearer $(cat .tokens/user-token)" --method tools/list
```

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http \
  --header "Authorization: Bearer $(cat .tokens/user-token)" \
  --method tools/call --tool-name read_report --tool-arg week=2026-W43
```

The first lists `whoami`, `read_report`, `github_profile` and `github_open_prs`. The second returns the report through the on-behalf-of exchange. Both were checked against a live tenant on 2026-11-10.

For a client that signs users in by itself, register it with Auth0 ahead of time, as the login application in guide step 2.5 is. Dynamically registered clients can't use social logins ([FRICTION.md item 12](../docs/FRICTION.md#12-dynamically-registered-clients-cant-use-social-connections-confirmed-live-2026-10-21)).

## 5. Run it beyond localhost

Three values must be the same string: `MCP_URL`, `MCP_RESOURCE`, and the Auth0 MCP API identifier. Use your public HTTPS endpoint ending in `/mcp`, for example `https://mcp.example.com/mcp`. The server derives the metadata URL it advertises from `MCP_URL`. Run `npm run doctor` afterwards: it warns when `MCP_RESOURCE` and `MCP_URL` differ.

The reports API keeps its own identifier. Never reuse the MCP server's.

Both servers listen on `127.0.0.1` by default, as the MCP transport spec recommends for local servers. Behind a reverse proxy or in a container, set `HOST=0.0.0.0`. The MCP server rejects any request whose `Origin` header isn't its own (403, to block DNS rebinding). If a browser-based client calls it from another origin, list that origin in `ALLOWED_ORIGINS` (comma-separated).

This repository is a reference implementation. Before production, add what it deliberately leaves out: persistent storage for the exchange cache (it's in memory), rate limiting, structured audit logs, and your real data in place of the fixtures.

## 6. Where to take it next

| Idea | What it adds | Auth0 docs |
|---|---|---|
| Fine-grained authorization | Per-document or per-record checks, beyond per-tool permissions | [Control access to MCP tools with FGA](https://auth0.com/ai/docs/mcp/get-started/secure-mcp-server-with-auth0-fga) · [Authorization for RAG](https://auth0.com/ai/docs/intro/authorization-for-rag) |
| Asynchronous authorization | A person approves a risky tool call on another device before it runs | [Asynchronous authorization](https://auth0.com/ai/docs/intro/asynchronous-authorization) · [CIBA flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/client-initiated-backchannel-authentication-flow) |
| Client ID Metadata Documents | Clients identify themselves with a hosted document instead of pre-registration. The MCP spec now prefers this over dynamic registration | [Register your MCP client application](https://auth0.com/ai/docs/mcp/guides/registering-your-mcp-client-application) |

For a step-by-step workshop on per-tool permissions and CIMD, see Auth0's [mcp-workshop](https://github.com/auth0-samples/mcp-workshop).

Back to the [guide](README.md).
