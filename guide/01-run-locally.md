# Step 1: Run the demo locally

Run the whole authorization story on your machine in about two minutes, with no account. The demo starts three services:

| Service | Role |
|---|---|
| Issuer | Stands in for Auth0. Signs real RS256 tokens and performs the token exchange |
| MCP server | The agent's tools (`server.mjs`), protected by those tokens |
| Reports API | A backend the MCP server calls for the user (`reports-api.mjs`) |

The MCP server and reports API are the same code you run against Auth0 in step 3. Only the issuer is a stand-in.

## 1. Download and install

```bash
git clone https://github.com/ExpertVagabond/mcp-agent-identity-auth0.git
cd mcp-agent-identity-auth0
npm ci
npm run doctor
```

`npm run doctor` should end with `Ready.` Without a `.env` it shows `INFO .env not found`, which is expected for this step.

## 2. Run the demo

```bash
npm run demo -- --step
```

Press **Enter** to start, then after each request. Without `-- --step` it runs straight through in a few seconds.

Every request prints the same four lines:

| Line | Meaning |
|---|---|
| **Try** | What the request is about to attempt |
| **Send** | The request that goes out |
| **Result** | The status code, and `PASS` if it matched what was expected |
| **Why** | What the result proves |

## 3. What you should see

| # | Request | Expected result | What it proves |
|---|---|---|---|
| 1 | No token | **401**, with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource/mcp` and naming the scopes | A client can discover the authorization server and what to request by itself |
| 2 | Wrong audience | **401** `invalid_token` | A signed token is refused unless it was issued for this server |
| 3 | Missing permission | **403** `insufficient_scope`, `scope="read:reports"` | Known user, not allowed, and told which scope is missing |
| 4 | Allowed, with on-behalf-of exchange | **200** and the report | The server exchanges the user's token instead of forwarding it |
| 5 | Token passthrough | **401** | The backend refuses the user's own token |
| 6 | Bad input | **400**, then **413**, then the server still answers | Clean errors, and the server keeps running |

The run ends with a summary table and:

```
All 6 requests matched their expected status.
```

The exit code is 0 when every request matches. A full saved run is in [`docs/walkthrough-output.txt`](../docs/walkthrough-output.txt), and a recording is at the top of the [README](../README.md).

## 4. Run the tests

```bash
npm test
```

Expect zero failures. The suite includes an MCP client that discovers OAuth and signs in with PKCE from a clean state. It also runs the six-request walkthrough.

## 5. Or verify everything at once

```bash
npm run verify
```

```
PASS  doctor  ready
PASS  tests   28/28 passing
PASS  demo    6/6 requests matched
VERIFIED: the local demo reproduces on this machine.
```

Next: [Step 2: Set up Auth0](02-set-up-auth0.md), or skip to [Step 5: Present it live](05-present-it-live.md).
