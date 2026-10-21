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
My first server read only the `scope` claim. The Auth0 quickstart says permissions come in a `permissions` claim when the resource server uses the `rfc9068_profile_authz` token dialect. A developer following the OAuth shape would get `insufficient_scope` with no clue why. The server now grants a permission only when both the `scope` and `permissions` claims carry it. A token without a `scope` claim is denied everything. That is the safe default, but it means a live tenant whose tokens lack a `scope` claim will fail every tool call. The first live run must confirm that both claims are present.
**Would help:** a note in the Auth0 MCP quickstart that scopes must appear in the access token, plus a sample decoded token.

## Next step for this log
Create a free tenant, set `AUTH0_ISSUER` and `MCP_RESOURCE`, and run a real login. Items 3 to 5 should be confirmed or struck by that run.
