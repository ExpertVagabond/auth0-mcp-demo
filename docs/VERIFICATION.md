# Verification log

What has been checked against a live Auth0 development tenant, and when. The tenant hostname and credentials are intentionally not committed.

## 2026-11-10: end-to-end recheck

| Check | Result |
|---|---|
| Browser sign-in (authorization code + PKCE, via GitHub) | Token issued with `read:reports` and `read:github` |
| `whoami` | Passed |
| `read_report` through a live on-behalf-of exchange | Passed: the reports API accepted the exchanged token |
| `github_profile` through Token Vault | Passed: returned the linked GitHub login |
| `github_open_prs` through Token Vault | Passed: returned the user's open public pull requests |
| The user's token sent straight to the reports API | Refused, 401 |
| A machine-to-machine token | `whoami` passed. The exchange refused it with `The user is not found`, as it should: on-behalf-of needs a user |
| Local suite and demo | 23 tests passing; all six demo steps matched; CI green |

## 2026-10-21: first live run

- **Machine-to-machine token:** `scripts/live-check.mjs` called `whoami` and `read_report`.
- **Browser login:** `scripts/login-check.mjs` ran the authorization-code flow with PKCE. The user signed in with Google and got the Report Reader role. `live-check.mjs` then passed with that user's token.
- **On-behalf-of token exchange:** the MCP server exchanged the user's token for one whose audience is the reports API. The reports API accepted the exchanged token (200) and refused the user's own MCP token (401).
- **Token Vault:** a GitHub account was linked through Connected Accounts, using a GitHub OAuth app owned by the developer. `github_profile` returned the linked login, and `github_open_prs` listed open public pull requests.
- **MCP client:** a first-party app created ahead of time logged users in with Google or GitHub, and its token worked for every tool. Dynamic client registration is off: registered clients are third-party and can't use social connections on this tenant ([FRICTION.md item 12](FRICTION.md#12-dynamically-registered-clients-cant-use-social-connections-confirmed-live-2026-10-21)).
- **Spec checks:** a token without the tool's scope gets HTTP 403 with a `WWW-Authenticate` challenge that names the scope. Clients send the `resource` parameter by default.
- **Log stream:** an HTTP log stream sent tenant events to a Cloudflare Worker (`log-receiver/`), which checks a bearer token and logs only event counts and types.
