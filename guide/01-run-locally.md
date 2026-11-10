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
git clone https://github.com/ExpertVagabond/auth0-mcp-demo.git
cd auth0-mcp-demo
npm install
npm run doctor
```

`npm run doctor` should end with `Ready.` Without a `.env` it shows `INFO .env not found`, which is expected for this step.

## 2. Run the demo

```bash
npm run demo -- --step
```

Press **Enter** to start, then after each step. Without `-- --step` it runs straight through in a few seconds.

Every step prints the same four lines:

| Line | Meaning |
|---|---|
| **Try** | What the step is about to attempt |
| **Send** | The request that goes out |
| **Result** | The status code, and `PASS` if it matched what was expected |
| **Why** | What the result proves |

## 3. What you should see

| # | Step | Expected result | What it proves |
|---|---|---|---|
| 1 | No token | **401**, with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource` and naming the scopes | A client can discover the authorization server and what to request by itself |
| 2 | Wrong audience | **401** `invalid_token` | A signed token is refused unless it was issued for this server |
| 3 | Missing permission | **403** `insufficient_scope`, `scope="read:reports"` | Known user, not allowed, and told which scope is missing |
| 4 | Allowed, with on-behalf-of exchange | **200** and the report | The server exchanges the user's token instead of forwarding it |
| 5 | Token passthrough | **401** | The backend refuses the user's own token |
| 6 | Bad input | **400**, then **413**, then the server still answers | Clean errors, and the server keeps running |

The run ends with a summary table and:

```
All 6 steps matched their expected status.
```

The exit code is 0 when every step matches. A full saved run is in [`docs/walkthrough-output.txt`](../docs/walkthrough-output.txt), and a recording is at the top of the [README](../README.md).

## 4. Run the tests

```bash
npm test
```

Expected: `tests 23`, `pass 23`, `fail 0`. The last test runs the demo itself.

Next: [Step 2: Set up Auth0](02-set-up-auth0.md), or skip to [Step 5: Present it live](05-present-it-live.md).
