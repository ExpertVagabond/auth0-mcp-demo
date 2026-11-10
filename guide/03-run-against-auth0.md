# Step 3: Run against Auth0

Start both servers against your tenant, sign in, and call the core tools with a real Auth0 token. About five minutes. You need a filled-in `.env` from [step 2](02-set-up-auth0.md).

## 0. Check your settings

```bash
npm run doctor
```

Required checks should pass and the output should end with `Ready.` Review any warnings, especially a mismatch between the advertised resource and client endpoint. It checks that `.env` has no placeholders left, that the issuer is formatted correctly, that your tenant is reachable and supports token exchange, and that ports 3000, 3100 and 8080 are free. Each failure tells you the fix.

## 1. Start the reports API

Terminal 1:

```bash
npm run start:api
```

```
Reports API on http://localhost:3100/reports/{week}, audience https://reports-backend.demo.test/
```

## 2. Start the MCP server

Terminal 2:

```bash
npm start
```

```
MCP server on http://localhost:3000/mcp, issuer https://my-tenant.us.auth0.com/, resource http://localhost:3000/mcp
```

Check that it advertises your tenant:

```bash
curl http://localhost:3000/.well-known/oauth-protected-resource/mcp
```

```json
{"resource":"http://localhost:3000/mcp","authorization_servers":["https://my-tenant.us.auth0.com/"],"scopes_supported":["read:reports","read:github"],"bearer_methods_supported":["header"]}
```

## 3. Sign in

Terminal 3:

```bash
npm run login
```

The browser opens the Auth0 sign-in page. If it doesn't, open the URL the script prints. Set `LOGIN_NO_BROWSER=1` to skip opening a browser altogether, for example in a container. Sign in with the user who has the role from step 2.4.

```
waiting for login on http://localhost:8080/callback (10 minute limit)
issuer check: expecting iss "https://my-tenant.us.auth0.com/" (tenant advertises iss)
sign in here if no browser opens:
https://my-tenant.us.auth0.com/authorize?response_type=code&...
token saved (not printed). claims: {"sub":"...","aud":["http://localhost:3000/mcp", ...],"scope":"openid profile email read:reports","permissions":["read:github","read:reports"]}
```

The script checks the `iss` in Auth0's response against your tenant before using the code (RFC 9207, as the MCP spec requires). Then it saves the access token to `.tokens/user-token` (ignored by git) without printing it, and prints the token's claims.

`permissions` should list `read:reports`. If it's empty, assign the role and sign in again.

## 4. Call the tools

```bash
npm run check
```

```
tools: whoami, read_report, github_profile, github_open_prs
whoami: {"sub":"...","scopes":["read:reports"]}
read_report: Report for 2026-W43: build passed; tickets closed: AUTH-103
```

`npm run check` exits nonzero if either core tool fails. Use `npm run check -- --github` to require both GitHub tools after step 4.

`read_report` succeeding means the on-behalf-of path worked. The server validated your token, exchanged it with Auth0 for a reports-API token, and the reports API accepted it.

## 5. Prove there's no passthrough

Send your own token straight to the reports API:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $(cat .tokens/user-token)" \
  http://localhost:3100/reports/2026-W43
```

Expected: `401`. The reports API accepts only tokens issued for it, so only the exchanged token works.

Stop both servers with **Ctrl-C** when you're done.

Next: [Step 4: Add GitHub through Token Vault](04-token-vault.md) (optional), or [Step 5: Present it live](05-present-it-live.md).
