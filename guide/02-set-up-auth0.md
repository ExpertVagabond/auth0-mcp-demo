# Step 2: Set up Auth0

Create everything the server needs in your tenant: two APIs, a role, a login application and a token-exchange application. About 15 minutes.

The [verification log](../docs/VERIFICATION.md) records earlier Auth0 tenant runs with a saved-token client. The canonical endpoint below also passes a fresh-client OAuth flow against the local issuer. Each sub-step links to the relevant Auth0 setup docs.

## What you'll create

| # | In Auth0 | Why | Goes in `.env` |
|---|---|---|---|
| 2.1 | Two tenant settings | The MCP spec requires the `resource` parameter | — |
| 2.2 | API: the MCP server | Tokens for the tools | `MCP_RESOURCE` |
| 2.3 | API: the reports API | Tokens for the backend | `REPORTS_AUDIENCE` |
| 2.4 | A role with two permissions | Decides who can call which tool | — |
| 2.5 | A login application | Signs the user in | `LOGIN_CLIENT_ID` |
| 2.6 | A token-exchange application | Lets the server call the backend for the user | `TOKEN_EXCHANGE_CLIENT_ID`, `TOKEN_EXCHANGE_CLIENT_SECRET` |

Start your `.env` now and fill it in as you go:

```bash
cp .env.example .env
```

Set `AUTH0_DOMAIN` (for example `my-tenant.us.auth0.com`) and `AUTH0_ISSUER` (the same with `https://` and a trailing slash).

> **Use the same endpoint for `MCP_URL`, `MCP_RESOURCE`, and the Auth0 MCP API identifier.** The loopback example is `http://localhost:3000/mcp`. For a remote deployment, use your public HTTPS endpoint ending in `/mcp`. The reports API needs a separate identifier. A tenant already configured with the older fixture identifier can still use the saved-token flow. Set up a matching API identifier and exchange binding to test fresh-client discovery.

## 2.1 Tenant settings

In your tenant's advanced settings, turn on:

- **Resource Parameter Compatibility Profile**. MCP clients send `resource`, and without this profile Auth0 ignores it.
- **Include Issuer in Authorization Responses**.

Docs: [Enable Resource Parameter Compatibility Profile](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile)

## 2.2 The MCP server API

Register an API:

| Setting | Value |
|---|---|
| Identifier | `http://localhost:3000/mcp` |
| Signing algorithm | RS256 |
| Permissions | `read:reports`, `read:github` |
| RBAC | On, with **Add Permissions in the Access Token** on |
| Token dialect | `rfc9068_profile_authz`, so tokens carry a `permissions` claim |

For the RBAC tokens in this guide, the server checks that a permission appears in both the `scope` and `permissions` claims ([why](../docs/FRICTION.md#5-auth0-puts-permissions-in-a-different-claim-than-my-first-build-assumed-confirmed-from-docs-fixed-in-code)).

Docs: [Register APIs](https://auth0.com/docs/get-started/auth0-overview/set-up-apis) · [Enable RBAC for APIs](https://auth0.com/docs/get-started/apis/enable-role-based-access-control-for-apis) · [Authorization for Your MCP Server](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server)

## 2.3 The reports API

Register a second API:

| Setting | Value |
|---|---|
| Identifier | `https://reports-backend.demo.test/` |
| Permissions | `read:reports` |
| Allow Skipping User Consent for Verifiable First-Party Clients | On |

The token exchange fails without the consent setting, and the error points at this API rather than at the client.

Docs: [User consent and third-party applications](https://auth0.com/docs/get-started/applications/third-party-applications/user-consent-and-third-party-applications)

## 2.4 A role for your user

1. Create a role, for example **Report Reader**, with `read:reports` and `read:github` from the MCP server API.
2. Assign it to the user you'll sign in with.

A role assigned after a login only appears in the next token, so sign in again after changing roles.

Docs: [Create roles](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/roles/create-roles) · [Assign roles to users](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/rbac-users/assign-roles-to-users)

## 2.5 A login application

Create a first-party application for `npm run login`:

| Setting | Value |
|---|---|
| Type | Native |
| Allowed Callback URLs | `http://localhost:8080/callback` |
| Grant types | Authorization Code (with PKCE) |
| Connections | The login you'll use, for example Google or GitHub |

Put its client ID in `.env` as `LOGIN_CLIENT_ID`.

Create this application ahead of time rather than relying on dynamic client registration. Dynamically registered clients are third-party and can't use social connections ([details](../docs/FRICTION.md#12-dynamically-registered-clients-cant-use-social-connections-confirmed-live-2026-10-21)).

## 2.6 The token-exchange application (on-behalf-of)

The MCP server uses this application to exchange the user's token for one issued to the reports API.

| Setting | Value |
|---|---|
| `app_type` | `resource_server` |
| `resource_server_identifier` | `http://localhost:3000/mcp`: the **MCP server's** identifier, not the reports API's |
| Token exchange | `allow_any_profile_of_type: ["on_behalf_of_token_exchange"]` |

Then create a client grant from this application to `https://reports-backend.demo.test/` for `read:reports`, with `subject_type: user`.

Put its client ID and secret in `.env` as `TOKEN_EXCHANGE_CLIENT_ID` and `TOKEN_EXCHANGE_CLIENT_SECRET`. Never commit the secret.

Docs: [On-Behalf-Of Token Exchange](https://auth0.com/docs/secure/call-apis-on-users-behalf/on-behalf-of-token-exchange) · [Call first-party APIs on a user's behalf](https://auth0.com/ai/docs/mcp/get-started/call-your-apis-on-users-behalf)

## Check your `.env`

At this point these values are filled in:

```bash
AUTH0_DOMAIN=my-tenant.us.auth0.com
AUTH0_ISSUER=https://my-tenant.us.auth0.com/
MCP_RESOURCE=http://localhost:3000/mcp
MCP_URL=http://localhost:3000/mcp
REPORTS_AUDIENCE=https://reports-backend.demo.test/
TOKEN_EXCHANGE_CLIENT_ID=...
TOKEN_EXCHANGE_CLIENT_SECRET=...
LOGIN_CLIENT_ID=...
```

Next: [Step 3: Run against Auth0](03-run-against-auth0.md)
