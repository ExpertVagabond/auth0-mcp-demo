# auth0-mcp-demo

An MCP server that requires an OAuth 2.0 access token. Tokens are validated locally against the authorization server's JWKS. The server checks the issuer, the audience (the MCP resource identifier), and expiry. Tools can require a scope.

Status (tenant `dev-pimpusbqkepr5gdl.us.auth0.com`, checked 2026-10-21):
- **Local:** `npm test`, 16 tests, all passing. They use a mock issuer that signs RS256 tokens and runs token exchange.
- **Live, machine-to-machine token:** `scripts/live-check.mjs` called `whoami` and `read_report`.
- **Live, browser login:** `scripts/login-check.mjs` ran the authorization-code flow with PKCE. The user signed in with Google and got the Report Reader role. `live-check.mjs` then passed with that user's token.
- **Live, on-behalf-of token exchange:** the MCP server exchanges the user's token for one whose audience is the reports API. The reports API accepts the exchanged token (200) and refuses the user's own MCP token (401).

## Run the tests

    npm install
    npm test

The tests start a mock issuer that signs real RS256 tokens, start the server, and call it with an MCP client.

## Run against Auth0

Environment variables:

- `AUTH0_ISSUER`: the tenant issuer, with a trailing slash, for example `https://YOUR-TENANT.us.auth0.com/`
- `MCP_RESOURCE`: the API identifier you create in Auth0. The server accepts only tokens whose audience matches this value.
- `PORT`: optional, defaults to 3000

Then:

    AUTH0_ISSUER=https://YOUR-TENANT.us.auth0.com/ MCP_RESOURCE=https://reports.demo.test/ node server.mjs

In Auth0 you need an API whose identifier equals `MCP_RESOURCE`, with a `read:reports` scope and role-based access control enabled so the scope appears in the access token. Check the current Auth0 docs for where these settings live. This README doesn't give click-paths because they haven't been checked against a live tenant.

## Endpoints

- `GET /.well-known/oauth-protected-resource`: protected-resource metadata (RFC 9728), pointing clients at the issuer.
- `POST /mcp`: MCP over streamable HTTP. Requires `Authorization: Bearer <token>`. A missing or invalid token gets a 401 with a `WWW-Authenticate` challenge that points at the metadata.

## Tools

- `whoami`: returns the token's subject and scopes. No scope required.
- `read_report(week)`: requires `read:reports`. Without it, the tool returns an error result with `insufficient_scope`. With it, the tool fetches the week from the reports API. The week must match `YYYY-Www`.

## Reports API

`reports-api.mjs` is a separate backend. It serves `GET /reports/{week}`. Callers send `Authorization: Bearer <token>`, and the API accepts only tokens that:
- are signed by the issuer and have audience `REPORTS_AUDIENCE` (`https://reports-backend.demo.test/`), and
- carry `read:reports` in the `permissions` claim.

The user's own token is never forwarded. The MCP spec forbids token passthrough. Instead, the MCP server exchanges the user's token (RFC 8693, Auth0 on-behalf-of) for one whose audience is the reports API. The exchange result is cached until shortly before it expires.

Auth0 setup for the exchange:
- A `resource_server` application whose `resource_server_identifier` is the MCP resource (`https://reports.demo.test/`), with on-behalf-of token exchange enabled. Its client secret is the `TOKEN_EXCHANGE_CLIENT_SECRET`. Keep it out of the repo.
- A client grant from that application to the reports API, for `read:reports`.
- The reports API has "Allow Skipping User Consent for Verifiable First-Party Clients" enabled, because the exchange client is first-party.

Exchanged tokens carry `permissions` but no `scope` claim.

Run it:

    AUTH0_ISSUER=https://YOUR-TENANT.us.auth0.com/ REPORTS_AUDIENCE=https://reports-backend.demo.test/ PORT=3100 node reports-api.mjs

Then start the MCP server with `REPORTS_API_URL=http://localhost:3100`, `REPORTS_AUDIENCE=https://reports-backend.demo.test/`, and `TOKEN_EXCHANGE_CLIENT_ID` and `TOKEN_EXCHANGE_CLIENT_SECRET` set from the exchange application.

## Files

- `server.mjs`: the MCP server.
- `reports-api.mjs`: the backend reports API.
- `test/e2e.test.mjs`: the test suite, including the mock issuer and the reports API.
- `FRICTION.md`, `DOCS-REVIEW.md`: developer-experience notes from building this.
