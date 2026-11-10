# Instructions for coding agents

You can reproduce the whole local demo unattended. The Auth0 steps need a person for two things: creating settings in the Auth0 tenant, and signing in through a browser.

## Reproduce the demo (no account, no human)

```bash
git clone https://github.com/ExpertVagabond/auth0-mcp-demo.git
cd auth0-mcp-demo
npm ci
npm run doctor          # preflight: exit 0 means ready
npm test                # expect: tests 23, pass 23, fail 0
npm run demo -- --json  # machine-readable result
```

**Success** is all of:

1. `npm run doctor` exits 0. Without a `.env` it reports `INFO .env not found`, which is expected.
2. `npm test` exits 0 with `fail 0`.
3. `npm run demo -- --json` exits 0 and prints `"ok": true, "passed": 6, "total": 6`. The step statuses, in order, are `401, 401, 403, 200, 401, "400 and 413"`.

Requirements: Node.js 22 or later (see `.nvmrc`) and npm. No network access is needed after `npm ci`. The demo uses free local ports and stops its own servers.

Don't use `npm run demo -- --step` unattended. It waits for Enter between steps.

## Reproduce against a real Auth0 tenant (needs a person)

Follow [guide/02-set-up-auth0.md](guide/02-set-up-auth0.md) and [guide/03-run-against-auth0.md](guide/03-run-against-auth0.md). Then:

| Step | Command | Who |
|---|---|---|
| Create the APIs, role and applications | (Auth0 Dashboard or CLI, guide step 2) | A person, or an agent with Auth0 Management API access |
| Fill in settings | `cp .env.example .env`, then edit | Agent, with values from the person |
| Check settings | `npm run doctor`. Every Auth0 check should be `PASS` | Agent |
| Start the backend | `npm run start:api` (long-running, port 3100) | Agent, in the background |
| Start the MCP server | `npm start` (long-running, port 3000) | Agent, in the background |
| Sign in | `LOGIN_NO_BROWSER=1 npm run login`, then give the person the printed URL | **Person** signs in. The script waits up to 10 minutes and exits 0 when the token is saved |
| Call every tool | `npm run check` | Agent |
| Check no passthrough | `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat .tokens/user-token)" http://localhost:3100/reports/2026-W43` returns `401` | Agent |

**Live success** means `npm run check` prints a report for `read_report` (proof of the on-behalf-of exchange), and the passthrough check returns `401`. The GitHub tools also need [guide step 4](guide/04-token-vault.md).

Stop both servers when you're done.

## Rules

- **Never commit `.env` or `.tokens/`.** Git ignores both. Don't print secrets or tokens. The scripts save tokens without printing them, and so should you.
- **Never print a full Auth0 application object.** Application objects can include signing keys.
- The identifiers `https://reports.demo.test/` and `https://reports-backend.demo.test/` are fixtures. A user's tenant may use others. Read them from `.env`.
- If something fails, check [guide/troubleshooting.md](guide/troubleshooting.md) first. It maps each real error to its fix.

## Map of the repo

| Path | Purpose |
|---|---|
| `server.mjs` | MCP server: token validation, per-tool permissions, token exchange, Token Vault |
| `reports-api.mjs` | Backend that only accepts exchanged tokens |
| `scripts/walkthrough.mjs` | The six-step demo (`npm run demo`) |
| `scripts/doctor.mjs` | Preflight (`npm run doctor`) |
| `scripts/login-check.mjs`, `live-check.mjs`, `connect-github.mjs` | Live-tenant sign-in, tool check and account linking |
| `test/` | Test suite and the stand-in issuer |
| `guide/` | Human step-by-step guide |
| `docs/` | Findings, verification log, MCP spec check |
