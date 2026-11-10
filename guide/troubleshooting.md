# Troubleshooting

Every error below was hit while building and verifying this project. The **Details** column links to the full write-up in [`docs/FRICTION.md`](../docs/FRICTION.md).

| You see | Cause | Fix | Details |
|---|---|---|---|
| Every tool call refused with `insufficient_scope` | The token has `permissions` but no `scope`, or the reverse | Set the API's token dialect to `rfc9068_profile_authz` and request the scopes at login | [5](../docs/FRICTION.md#5-auth0-puts-permissions-in-a-different-claim-than-my-first-build-assumed-confirmed-from-docs-fixed-in-code), [8](../docs/FRICTION.md#8-exchanged-tokens-have-no-scope-claim-confirmed-live) |
| `permissions: []` after `npm run login` | The role was assigned after the token was issued | Assign the role (step 2.4), then sign in again | [9](../docs/FRICTION.md#9-setting-up-a-user-login-takes-four-separate-auth0-steps-confirmed-live) |
| `token exchange failed: The user is not found` | A machine-to-machine token was used; on-behalf-of needs a user | Sign in with `npm run login` and use that token | — |
| `Invalid subject_token_type.` | The exchange app is bound to the reports API | Set its `resource_server_identifier` to the MCP server's identifier (step 2.6) | [7](../docs/FRICTION.md#7-the-exchange-fails-with-two-unrelated-looking-errors-confirmed-live) |
| `...only valid for "resource_server" application type` | The exchange app was created as a regular application | Create it with `app_type: resource_server` (step 2.6) | [6](../docs/FRICTION.md#6-on-behalf-of-needs-a-specific-application-type-and-the-error-messages-dont-say-so-confirmed-live) |
| `The API must have "Allow Skipping User Consent..."` | The consent setting is off on the reports API | Turn it on (step 2.3) | [7](../docs/FRICTION.md#7-the-exchange-fails-with-two-unrelated-looking-errors-confirmed-live) |
| `github does not exist or is not a domain connection` | The client registered itself dynamically | Use the pre-created login application (step 2.5) | [12](../docs/FRICTION.md#12-dynamically-registered-clients-cant-use-social-connections-confirmed-live-2026-10-21) |
| `The connect flow cannot be used with dev keys.` | The GitHub connection uses Auth0's development keys | Use your own GitHub OAuth app (step 4.1) | [10](../docs/FRICTION.md#10-token-vault-needs-your-own-github-oauth-app-dev-keys-stop-at-the-link-step-confirmed-live-2026-10-21) |
| `The userinfo audience is not allowed for third party clients` | Resource Parameter Compatibility Profile is off | Turn it on (step 2.1) | [Auth0 support](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0) |
| `Set AUTH0_DOMAIN, LOGIN_CLIENT_ID, MCP_RESOURCE, TOKEN_OUT.` | `.env` is missing or incomplete | `cp .env.example .env` and fill it in (step 2) | — |
| `npm run demo` fails to start | Dependencies aren't installed | `npm install`, then try again | — |
