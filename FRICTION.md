# Friction log: building an MCP server behind an OAuth provider

Written while building this server. Each entry says what got in the way and what would help. Entries marked **provisional** were found against a local mock issuer, not a live Auth0 tenant. Confirm them before reporting them.

## 1. Getting an account to build against is the first step (confirmed)
There is no Auth0 tenant on this machine, so the server can't be checked against the real service yet. The fastest path to a live check is a free tenant, and the free-tier limits were hard to confirm (see 2).
**Would help:** a sandbox tenant that doesn't need a credit card, or a published local dev issuer for MCP auth.

## 2. Free-tier limits are unclear from the public pages (confirmed)
Searching for the free developer tier turned up conflicting figures: a monthly-active-user cap of 100 on Okta Developer Edition, a 25,000 MAU claim from a third-party tracker, and a deactivation notice on Developer Edition orgs. Auth0's entity-limit page lists free-tenant object counts but not the MAU cap.
**Would help:** one page that states the free tier, its MAU cap, and whether Developer Edition signups are open.

## 3. The challenge format for a 401 has to be assembled by hand (provisional)
The MCP authorization flow depends on the `WWW-Authenticate` header carrying `resource_metadata`, which points the client at the protected-resource metadata. I built that header from the spec text. The SDKs in the reference examples do this for you, but a developer writing a server in a plain HTTP framework has nothing to copy.
**Would help:** a copy-paste challenge example in the MCP auth docs for a plain Node HTTP server.

## 4. `resource` and `audience` are easy to mix up (provisional)
The MCP spec uses a `resource` identifier. OAuth APIs have traditionally used `audience`. The code has to check the audience claim against the resource identifier. Auth0's changelog says it accepts `resource`, but I haven't confirmed that against a live token.
**Would help:** one example token showing the `aud` claim produced from a `resource` request.

## 5. Auth0 puts permissions in a different claim than my first build assumed (confirmed from docs, fixed in code)
My first server read only the `scope` claim. The Auth0 quickstart says permissions come in a `permissions` claim when the resource server uses the `rfc9068_profile_authz` token dialect. A developer following the OAuth shape would get `insufficient_scope` with no clue why. The server now grants a permission only when both the `scope` and `permissions` claims carry it. A token without a `scope` claim is denied everything. That is the safe default, but it means a live tenant whose tokens lack a `scope` claim will fail every tool call. **Live result (2026-10-21):** a client-credentials token from the tenant carried both `scope` and `permissions`, both set to `read:reports`, so the server accepted it. A user login token may differ and still needs checking.
**Would help:** a note in the Auth0 MCP quickstart that scopes must appear in the access token, plus a sample decoded token.

## 6. On-behalf-of needs a specific application type, and the error messages don't say so (confirmed live)
Creating the exchange client with the on-behalf-of profile as a regular app fails with: `Token exchange profile type "on_behalf_of_token_exchange" is only valid for "resource_server" application type.` The docs say the same thing, but a developer who starts from the quickstart won't see it first.
**Would help:** put the application type in the on-behalf-of setup step, before the flags.

## 7. The exchange fails with two unrelated-looking errors (confirmed live)
- `Invalid subject_token_type.` This appeared on the first attempt, when the exchange client was bound to the backend API. The second attempt bound it to the MCP resource, which is the audience of the incoming user token, and added `requested_token_type`. The error went away. I changed two things at once, so I haven't isolated which one fixed it. The message doesn't name the client binding, so a developer would have to guess.
- `The API must have "Allow Skipping User Consent for Verifiable First-Party Clients" enabled.` This is on the downstream API, which is not the client, so it's easy to miss.
**Would help:** the error for the first should name the client binding, and the setup steps should list the consent setting on the target API.

## 8. Exchanged tokens have no `scope` claim (confirmed live)
A user token from the login flow has `scope` and `permissions`. The exchanged token has `permissions` only. An API that checks `scope` will refuse every exchanged token, and nothing in the quickstart says so. The reports API checks `permissions` for this reason.
**Would help:** say which claim each token type carries, in a table.

## 9. Setting up a user login takes four separate Auth0 steps (confirmed live)
A signed-in user has no role until one is assigned. A role assigned after login only shows up in a new token. The first token had `permissions: []`. The fix was: assign the role, then log in again. I didn't find the second login in the docs I read.
**Would help:** a note after role assignment saying tokens must be reissued.

## Next step for this log
The on-behalf-of flow and browser login are now verified live (see README). Items 6 to 9 come from that run. Items 3 to 5 are still provisional: the 401 challenge format and the `resource` claim value need a check against a token from the authorization-code flow with the `resource` parameter.
