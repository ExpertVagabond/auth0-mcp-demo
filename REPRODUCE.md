# Reproduce the demo

Two paths. **Path A** runs everything locally against a mock issuer in about two minutes, with no account. **Path B** runs the same server against a real Auth0 tenant: browser login, on-behalf-of token exchange, and Token Vault.

Path A was rerun on 2026-11-10. The Path B settings are the ones that worked in the live run on 2026-10-21 (see the README status and `FRICTION.md`).

## Prerequisites

| For | You need |
|---|---|
| Both paths | [Node.js](https://nodejs.org/en/download) 22 or later (CI runs on 22), `git`, a terminal |
| Path B | A free [Auth0 account](https://auth0.com/signup) and a development tenant |
| Path B, optional | The [Auth0 CLI](https://auth0.github.io/auth0-cli/) (the official MCP quickstarts use it) |
| Path B, Token Vault step | A GitHub account and a [GitHub OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) you own. Auth0's development keys don't work for linking accounts (`FRICTION.md` item 10) |

Background reading, if you want the why: the [MCP authorization spec](https://modelcontextprotocol.io/specification/latest/basic/authorization), [Auth for MCP](https://auth0.com/ai/docs/mcp/overview), [RFC 8693 token exchange](https://www.rfc-editor.org/rfc/rfc8693), [RFC 9728 protected-resource metadata](https://www.rfc-editor.org/rfc/rfc9728) and [RFC 8707 resource indicators](https://www.rfc-editor.org/rfc/rfc8707).

## Path A: local, no account (about 2 minutes)

1. Clone and install:

       git clone https://github.com/ExpertVagabond/auth0-mcp-demo.git
       cd auth0-mcp-demo
       npm install

2. Run the walkthrough:

       npm run demo

   Add `-- --step` to pause between steps (`npm run demo -- --step`). Each step prints the request, the status and why it matters. The run ends with `All 6 steps matched their expected status.` and exits 0. Compare it with `docs/walkthrough-output.txt`.

3. Run the tests:

       npm test

   Expected: `tests 23`, `pass 23`, `fail 0`.

| Step | What it sends | Expected |
|---|---|---|
| 1 | No token | 401, `WWW-Authenticate` points at `/.well-known/oauth-protected-resource` |
| 2 | Token for another audience | 401 `invalid_token` |
| 3 | Valid token without `read:reports` | 403 `insufficient_scope`, `scope="read:reports"` |
| 4 | Valid token with `read:reports` | The server exchanges it (on-behalf-of), the reports API returns 200 |
| 5 | The user's MCP token sent straight to the reports API | 401 (no token passthrough) |
| 6 | Malformed JSON, then a body over 1 MB | 400, then 413, and the server still answers |

## Path B: against a real Auth0 tenant

Throughout, these values must match exactly, trailing slash included (`DOCS-REVIEW.md` item 5):

- MCP server identifier: `https://reports.demo.test/`
- Reports API identifier: `https://reports-backend.demo.test/`

You can use your own identifiers. Keep them absolute URIs and use the same strings everywhere below.

### 1. Tenant settings

In the tenant's advanced settings, turn on **Resource Parameter Compatibility Profile** and **Include Issuer in Authorization Responses**. The MCP spec requires clients to send `resource`, and without the profile Auth0 ignores it.
Docs: [Enable Resource Parameter Compatibility Profile](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile) · [Tenant settings](https://auth0.com/docs/get-started/tenant-settings)

### 2. The MCP server API

Register an API with:
- identifier `https://reports.demo.test/`, signing algorithm RS256
- permissions `read:reports` and `read:github`
- RBAC on, with permissions added to the access token
- token dialect `rfc9068_profile_authz`, so tokens carry a `permissions` claim. The server grants a permission only when it is in both `scope` and `permissions` (`FRICTION.md` item 5)

Docs: [Register APIs](https://auth0.com/docs/get-started/auth0-overview/set-up-apis) · [Enable RBAC for APIs](https://auth0.com/docs/get-started/apis/enable-role-based-access-control-for-apis) · [Authorization for Your MCP Server](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server)

### 3. The reports API

Register a second API with identifier `https://reports-backend.demo.test/` and permission `read:reports`. Turn on **Allow Skipping User Consent for Verifiable First-Party Clients**. The exchange fails without it, and the error points at this API rather than the client (`FRICTION.md` item 7).
Docs: [User consent and third-party applications](https://auth0.com/docs/get-started/applications/third-party-applications/user-consent-and-third-party-applications)

### 4. A role for the user

Create a role (this repo used "Report Reader") with `read:reports` on the MCP server API, plus `read:github` for the Token Vault tools, and assign it to your test user. Then sign in again: a role assigned after login only shows up in a new token (`FRICTION.md` item 9).
Docs: [Create roles](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/roles/create-roles) · [Assign roles to users](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/rbac-users/assign-roles-to-users)

### 5. A login application

Create a first-party application for `scripts/login-check.mjs`:
- Allowed Callback URL `http://localhost:8080/callback`
- the authorization-code grant
- your login connection enabled (Google or GitHub was used here)

Use a pre-registered app, not dynamic client registration. Registered clients are third-party and can't use social connections (`FRICTION.md` item 12).

### 6. The token-exchange application (on-behalf-of)

Create the application the MCP server uses to call the reports API for the user:
- `app_type`: `resource_server`
- `resource_server_identifier`: `https://reports.demo.test/` (the MCP server's identifier, not the reports API's)
- token exchange: `allow_any_profile_of_type: ["on_behalf_of_token_exchange"]`

Then create a client grant from this application to `https://reports-backend.demo.test/` for `read:reports`, with `subject_type: user`. Keep its client secret out of the repo.
Docs: [On-Behalf-Of Token Exchange](https://auth0.com/docs/secure/call-apis-on-users-behalf/on-behalf-of-token-exchange) · [Call first-party APIs on a user's behalf (MCP quickstart)](https://auth0.com/ai/docs/mcp/get-started/call-your-apis-on-users-behalf)

### 7. Run the reports API and the MCP server

Terminal 1:

    AUTH0_ISSUER=https://YOUR-TENANT.us.auth0.com/ \
    REPORTS_AUDIENCE=https://reports-backend.demo.test/ \
    PORT=3100 node reports-api.mjs

Terminal 2:

    AUTH0_ISSUER=https://YOUR-TENANT.us.auth0.com/ \
    MCP_RESOURCE=https://reports.demo.test/ \
    REPORTS_API_URL=http://localhost:3100 \
    REPORTS_AUDIENCE=https://reports-backend.demo.test/ \
    TOKEN_EXCHANGE_CLIENT_ID=... TOKEN_EXCHANGE_CLIENT_SECRET=... \
    node server.mjs

`AUTH0_ISSUER` ends with a slash. Check the metadata at `http://localhost:3000/.well-known/oauth-protected-resource`.

### 8. Sign in and call the tools

Terminal 3:

    AUTH0_DOMAIN=YOUR-TENANT.us.auth0.com LOGIN_CLIENT_ID=... \
    MCP_RESOURCE=https://reports.demo.test/ \
    TOKEN_OUT=$HOME/.auth0-mcp-demo/user-token \
    node scripts/login-check.mjs

On macOS the browser opens by itself (the script calls `open`; on other systems, open the authorize URL yourself). Sign in, and the script saves the access token to `TOKEN_OUT` without printing it, then prints the token's `sub`, `aud`, `scope` and `permissions`. `permissions` should include `read:reports`. If it's empty, see step 4.

    MCP_URL=http://localhost:3000/mcp TOKEN_FILE=$HOME/.auth0-mcp-demo/user-token \
    node scripts/live-check.mjs

`live-check.mjs` calls `whoami` and `read_report`, plus the GitHub tools when the token carries `read:github` and an account is linked (step 9). `read_report` succeeding means the on-behalf-of exchange worked and the reports API accepted the exchanged token.

### 9. Token Vault: link GitHub (optional)

1. Create a GitHub OAuth app. Its callback URL is the one Auth0 shows for your tenant's GitHub connection.
2. Configure the tenant's GitHub connection with that app's client ID and secret, and turn on Token Vault (connected accounts) for it.
3. Get a My Account API token with `create:me:connected_accounts`. The login needs a client grant to the My Account API with subject type `user`, not `client` (`FRICTION.md` item 11).
4. Link the account:

       AUTH0_DOMAIN=YOUR-TENANT.us.auth0.com ME_TOKEN_FILE=$HOME/.auth0-mcp-demo/me-token \
       node scripts/connect-github.mjs

5. Restart the MCP server. With token exchange configured, `github_profile` and `github_open_prs` are registered and return the linked GitHub login and the user's open public pull requests. The GitHub token itself never leaves the server.

Docs: [Token Vault](https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault) · [Connected accounts for Token Vault](https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault/connected-accounts-for-token-vault) · [My Account API](https://auth0.com/docs/manage-users/my-account-api) · [GitHub social connection](https://marketplace.auth0.com/integrations/github-social-connection)

## When something fails

| Symptom | Likely cause | See |
|---|---|---|
| Every tool call is refused with `insufficient_scope` | The token has `permissions` but no `scope`, or the reverse | `FRICTION.md` 5, 8 |
| `permissions: []` after login | Role assigned after the token was issued. Sign in again | `FRICTION.md` 9 |
| `Invalid subject_token_type.` | The exchange app is bound to the reports API instead of the MCP server | `FRICTION.md` 7 |
| `...only valid for "resource_server" application type` | The exchange app was created as a regular app | `FRICTION.md` 6 |
| `Allow Skipping User Consent...` | Turn that on for the reports API (step 3) | `FRICTION.md` 7 |
| `github does not exist or is not a domain connection` | A dynamically registered client. Use the pre-registered app | `FRICTION.md` 12 |
| `The connect flow cannot be used with dev keys.` | The GitHub connection needs your own OAuth app | `FRICTION.md` 10 |
| `The userinfo audience is not allowed for third party clients` | Resource Parameter Compatibility Profile is off (step 1) | [Auth0 support article](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0) |
