# Guide

Work through the steps in order. Steps 0 and 1 need only Node.js and git and run entirely on your machine. Steps 2 to 4 connect the same server to a real Auth0 tenant. Step 5 is the script for presenting the demo live.

| Step | Guide | You need | Time |
|---|---|---|---|
| 0 | [Prerequisites](00-prerequisites.md) | — | 2 min |
| 1 | [Run the demo locally](01-run-locally.md) | Node.js 22+, git | 2 min |
| 2 | [Set up Auth0](02-set-up-auth0.md) | A free Auth0 account | 15 min |
| 3 | [Run against Auth0](03-run-against-auth0.md) | Step 2 | 5 min |
| 4 | [Add GitHub through Token Vault](04-token-vault.md) (optional) | Step 3 and a GitHub OAuth app | 10 min |
| 5 | [Present it live](05-present-it-live.md) | Step 1 | 5 min |

Stuck? See [Troubleshooting](troubleshooting.md). It lists every real error hit while building this, with the fix.

## The big picture

```
                       1. sign in (code + PKCE)
   User ──► MCP client ─────────────────────────► Auth0
               │        ◄──── access token ──────  │   aud = the MCP server
               │                                   │
               │ 2. Bearer token                   │ 4. token exchange (on-behalf-of)
               ▼                                   │    aud = the reports API, same user
          MCP server ──────────────────────────────┘
   3. checks issuer, signature,     │
      audience, expiry, permission  │ 5. Bearer exchanged token
                                    ▼
                               Reports API   (refuses the user's own token: 401)
```

- **Steps 1 and 3:** the server refuses a missing token or a token for another API (401), and a known user without the tool's permission (403, naming the scope).
- **Step 3:** for the allowed call, the server exchanges the user's token for one issued to the reports API, instead of forwarding it.
- **Step 4:** the GitHub tools reach GitHub through Token Vault. The GitHub token never leaves the server.

## One configuration file

Steps 3 and 4 read a single `.env` file (ignored by git). Every value is explained in [`.env.example`](../.env.example):

```bash
cp .env.example .env
```

| Command | What it runs |
|---|---|
| `npm run doctor` | Preflight: what's ready, what's missing, and the fix for each |
| `npm run demo` | The six-step local demo (no `.env` needed). `-- --step` to present, `-- --json` for a machine-readable result |
| `npm test` | The test suite (no `.env` needed) |
| `npm run start:api` | The reports API on port 3100 |
| `npm start` | The MCP server on port 3000 |
| `npm run login` | Browser sign-in; saves your access token to `.tokens/` |
| `npm run check` | Calls every tool on the running server with that token |
| `npm run connect:github` | Links a GitHub account for Token Vault (step 4) |
