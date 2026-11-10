# Auth0 MCP Demo

[![Tests](https://github.com/ExpertVagabond/auth0-mcp-demo/actions/workflows/test.yml/badge.svg)](https://github.com/ExpertVagabond/auth0-mcp-demo/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ExpertVagabond/auth0-mcp-demo)

An MCP server for AI agents, protected by Auth0. It shows who can call which tool, and how everything else is refused:

- Every access token is checked: issuer, signature, audience, expiry, and a permission per tool.
- To call a backend for the user, the server **exchanges** the user's token (on-behalf-of) instead of forwarding it.
- It reaches GitHub through **Token Vault**, so the user's GitHub token never leaves the server.

Run the whole story locally in two minutes with no account, then connect the same server to a real Auth0 tenant. It was verified live on 2026-10-21 and rechecked end to end on 2026-11-10.

![The six-step demo running in a terminal](docs/demo.gif)

## Related content

- [Auth for MCP](https://auth0.com/ai/docs/mcp/overview): how Auth0 secures MCP servers.
- [On-Behalf-Of Token Exchange](https://auth0.com/docs/secure/call-apis-on-users-behalf/on-behalf-of-token-exchange): calling your own APIs for the user.
- [Token Vault](https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault): calling third-party APIs for the user.
- [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization): what MCP clients and servers must do.

## Steps

| Step | Guide | What you get |
|---|---|---|
| 0 | [Prerequisites](guide/00-prerequisites.md) | Node.js and git; an Auth0 account for steps 2 to 4 |
| 1 | [Run the demo locally](guide/01-run-locally.md) | Six requests, five refused with a named reason, one allowed. No account |
| 2 | [Set up Auth0](guide/02-set-up-auth0.md) | Two APIs, a role, a login app and a token-exchange app in your tenant |
| 3 | [Run against Auth0](guide/03-run-against-auth0.md) | Real sign-in, a live on-behalf-of exchange, and passthrough refused |
| 4 | [Add GitHub through Token Vault](guide/04-token-vault.md) | The GitHub tools, with the GitHub token kept on the server |
| 5 | [Present it live](guide/05-present-it-live.md) | A five-minute script: what to type, what appears, what to say |

Stuck? See [Troubleshooting](guide/troubleshooting.md).

## Requirements

- [Node.js](https://nodejs.org/en/download) 22 or later, and npm
- [git](https://git-scm.com)
- An [Auth0](https://auth0.com/signup) account and tenant (from step 2)
- A [GitHub OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) you own (step 4 only)

Step 1 only needs Node.js and git.

## Download and run

```bash
git clone https://github.com/ExpertVagabond/auth0-mcp-demo.git
cd auth0-mcp-demo
npm install
npm run doctor           # preflight: checks Node, dependencies and (later) your Auth0 settings
npm run demo -- --step
```

Or open it in [GitHub Codespaces](https://codespaces.new/ExpertVagabond/auth0-mcp-demo) and run `npm run demo -- --step` there.

**Using a coding agent?** Point it at [AGENTS.md](AGENTS.md). It has exact commands and success criteria, and `npm run demo -- --json` gives a machine-readable result.

Press **Enter** to move through the six steps:

| # | What it tries | Result | What it proves |
|---|---|---|---|
| 1 | No token | **401** + where to log in | A client can discover the authorization server itself |
| 2 | A real token, issued for another API | **401** | Signed isn't enough; it must be issued for *this* server |
| 3 | Valid token, missing `read:reports` | **403**, names the scope | Known user, not allowed, told exactly what's missing |
| 4 | Valid token with `read:reports` | **200** after a token exchange | The backend gets its own token for the same user |
| 5 | The user's token sent straight to the backend | **401** | No token passthrough, no confused deputy |
| 6 | Broken JSON, then a body over 1 MB | **400**, **413** | Clean errors, and the server keeps running |

Run the tests with `npm test` (23 tests).

## How it works

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Client as MCP client (agent)
    participant Auth0
    participant MCP as MCP server
    participant API as Reports API
    participant Vault as Token Vault (Auth0)
    User->>Client: sign in
    Client->>Auth0: authorization code + PKCE, resource = MCP server
    Auth0-->>Client: access token (aud = MCP server)
    Client->>MCP: tools/call read_report, Bearer token
    MCP->>MCP: check issuer, signature, audience, expiry, scope
    alt no token or wrong audience
        MCP-->>Client: 401 + WWW-Authenticate (metadata URL)
    else token lacks read:reports
        MCP-->>Client: 403 insufficient_scope (names the scope)
    else allowed
        MCP->>Auth0: token exchange (RFC 8693, on-behalf-of), aud = reports API
        Auth0-->>MCP: exchanged token (aud = reports API, same user)
        MCP->>API: GET /reports/{week}, exchanged token
        API-->>MCP: 200 report
        MCP-->>Client: tool result
    end
    Note over MCP,API: The user's own token is never forwarded. The reports API answers 401 to it.
    Client->>MCP: tools/call github_profile
    MCP->>Vault: exchange the user's token for the linked GitHub token
    Vault-->>MCP: GitHub access token (stays on the server)
    MCP-->>Client: GitHub login only
```

## Tools

| Tool | Requires | Returns |
|---|---|---|
| `whoami` | A valid token | The token's subject and scopes |
| `read_report(week)` | `read:reports` | The week's report, fetched from the reports API with an exchanged token. `week` is `YYYY-Www` |
| `github_profile` | `read:github`, a linked GitHub account | The linked GitHub login, through Token Vault |
| `github_open_prs` | `read:github`, a linked GitHub account | The user's open pull requests on public repositories |

The GitHub tools appear only when token exchange is configured.

## Repository layout

| Path | What it is |
|---|---|
| `server.mjs` | The MCP server: token checks, per-tool permissions, token exchange, Token Vault tools |
| `reports-api.mjs` | The backend the MCP server calls for the user |
| `scripts/walkthrough.mjs` | The six-step demo (`npm run demo`, `--step` to present, `--json` for agents) |
| `scripts/doctor.mjs` | Preflight (`npm run doctor`): what's ready, what's missing, and how to fix it |
| `AGENTS.md` | Instructions and success criteria for coding agents |
| `scripts/login-check.mjs`, `live-check.mjs`, `connect-github.mjs` | Sign-in, tool check and account linking against a real tenant |
| `test/` | The test suite, and the stand-in issuer shared with the demo |
| `guide/` | Step-by-step guide, steps 0 to 5 |
| `docs/` | [MCP spec check](docs/MCP-SPEC-CHECK.md), [developer-experience findings](docs/FRICTION.md), the [docs review](docs/DOCS-REVIEW.md), the [verification log](docs/VERIFICATION.md), and a saved demo run |
| `.env.example` | Every setting for steps 3 and 4, explained |
| `.devcontainer/`, `.nvmrc` | A reproducible Node 22 environment (Codespaces or VS Code) |
| `log-receiver/` | A Cloudflare Worker that receives the tenant's log stream |

## Security

This repository contains no tenant credentials, client secrets or tokens. Settings go in `.env` and tokens in `.tokens/`, and git ignores both. The `.demo.test` identifiers and every credential in the tests are non-production fixtures.

## License

[MIT](LICENSE)
