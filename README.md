# auth0-mcp-demo

An MCP server that requires an OAuth 2.0 access token. Tokens are validated locally against the authorization server's JWKS. The server checks the issuer, the audience (the MCP resource identifier), and expiry. Tools can require a scope.

Status:
- **Verified against a local issuer** (`npm test`, 15 tests).
- **Verified against a live Auth0 tenant** on 2026-10-21, with a machine-to-machine token from `dev-pimpusbqkepr5gdl.us.auth0.com`. `scripts/live-check.mjs` ran `whoami` and `read_report` through the real server and reports API.
- **Not yet verified:** a user login through the authorization-code flow. The live check used a client-credentials token.

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

`reports-api.mjs` is a separate backend. It serves `GET /reports/{week}` and needs the header `x-service-key`.

- Only the MCP server calls it. The user's access token is never forwarded. The MCP spec forbids passing a token through to another API, and the reports API would reject it anyway, because the token's audience is the MCP server.
- `REPORTS_API_KEY` is a local secret shared between the two processes. Generate it with `openssl rand -hex 32`. It is not an Auth0 credential and it isn't stored in the repo.
- The MCP server enforces the user's `read:reports` scope before it calls the API. The reports API trusts the service key alone.
- The real delegation step, where the MCP server exchanges the user's token for a token to the reports API, needs an Auth0 client secret from your tenant. That's the next step after the live check.

Run it:

    REPORTS_API_KEY=$(openssl rand -hex 32) PORT=3100 node reports-api.mjs

Then start the MCP server with `REPORTS_API_URL=http://localhost:3100` and the same `REPORTS_API_KEY`.

## Files

- `server.mjs`: the MCP server.
- `reports-api.mjs`: the backend reports API.
- `test/e2e.test.mjs`: the test suite, including the mock issuer and the reports API.
- `FRICTION.md`, `DOCS-REVIEW.md`: developer-experience notes from building this.
