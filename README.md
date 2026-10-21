# auth0-mcp-demo

An MCP server that requires an OAuth 2.0 access token. Tokens are validated locally against the authorization server's JWKS. The server checks the issuer, the audience (the MCP resource identifier), and expiry. Tools can require a scope.

Status: **verified against a local issuer** (`npm test`, 7 tests). **Not yet run against a live Auth0 tenant.**

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
- `read_report(week)`: requires `read:reports`. Without it, the tool returns an error result with `insufficient_scope`.

## Files

- `server.mjs`: the server, and the only application code.
- `test/e2e.test.mjs`: the test suite, including the mock issuer.
- `FRICTION.md`: developer-experience notes from building this.
