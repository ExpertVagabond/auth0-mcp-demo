# MCP authorization spec check

How this server lines up with the [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization) (version 2026-07-28), checked on 2026-11-10 against the server's actual responses.

## The server (resource server)

| The spec says | This repo | Status |
|---|---|---|
| Servers **MUST** implement Protected Resource Metadata (RFC 9728) | `GET /.well-known/oauth-protected-resource` returns `resource`, `authorization_servers`, `scopes_supported`, `bearer_methods_supported` | ✅ |
| The 401 **SHOULD** carry `resource_metadata` and the `scope` to request | `Bearer resource_metadata="…", scope="read:reports read:github"` | ✅ (scope added 2026-11-10) |
| Servers **MUST** validate that tokens were issued for them (audience, RFC 8707) | Issuer, signature, audience and expiry are checked against the issuer's JWKS. Demo step 2 shows a wrong-audience token refused | ✅ |
| Invalid or expired tokens **MUST** get a 401 | 401 with `error="invalid_token"` | ✅ |
| Insufficient scope **SHOULD** get a 403 with `error="insufficient_scope"`, `scope` and `resource_metadata` | `Bearer error="insufficient_scope", scope="read:reports", resource_metadata="…"`. Demo step 3 | ✅ |
| Servers **MUST NOT** accept or transit any other tokens | The user's token is never forwarded. The server exchanges it (on-behalf-of) and the reports API refuses the original (demo step 5, live 401 on 2026-11-10) | ✅ |
| Tokens go in the `Authorization` header only, never the query string | Header only (`bearer_methods_supported: ["header"]`) | ✅ |
| Bad requests get clear status codes | 400 for malformed JSON, 413 for oversized bodies (demo step 6) | ✅ |
| `offline_access` **SHOULD NOT** appear in `scopes_supported` or the challenge | Not present | ✅ |

## The sign-in helper (`scripts/login-check.mjs`, a client)

| The spec says | This repo | Status |
|---|---|---|
| Clients **MUST** use PKCE | Authorization code + PKCE (S256) | ✅ |
| Clients **MUST** send `resource` on authorization and token requests (RFC 8707) | Sends `resource` by default (`AUTH_PARAM=audience` switches to Auth0's older parameter) | ✅ |
| Client registration: Client ID Metadata Documents **SHOULD**, pre-registration allowed, Dynamic Client Registration deprecated | Uses a pre-registered first-party app. Dynamic registration is avoided because registered clients can't use social logins ([FRICTION.md item 12](FRICTION.md#12-dynamically-registered-clients-cant-use-social-connections-confirmed-live-2026-10-21)) | ✅ allowed; CIMD is the natural next step |
| Clients **MUST** record the issuer from validated metadata and check `iss` in the authorization response (RFC 9207) | The helper reads the tenant's metadata before redirecting. A present `iss` must match exactly. A missing `iss` is rejected when the tenant advertises `authorization_response_iss_parameter_supported`. Tested 2026-11-10 against the live tenant with forged callbacks: wrong `iss` rejected, missing `iss` rejected, correct `iss` accepted | ✅ (added 2026-11-10) |

## Choices worth knowing

- **Trailing slash.** The spec says implementations **SHOULD** use the canonical URI without a trailing slash, unless the slash is significant. The identifiers here (`https://reports.demo.test/`) keep one, following the Auth0 quickstart's convention. Both are valid URIs; the important thing is that the same string is used everywhere.
- **Scope in the 401.** The 401 names every scope in `scopes_supported`. The spec also allows naming only what the current request needs. Per-tool scopes are named precisely in the 403.
