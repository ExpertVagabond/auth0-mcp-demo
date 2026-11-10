# Step 5: Present it live

About five minutes. One terminal, one command, six requests. Each request on screen has the same four lines: **Try** (what we're about to do), **Send** (the request), **Result** (status and PASS), **Why** (what it proves). Read them top to bottom.

## Before the call (5 minutes, once)

1. Clone and install, so nothing downloads live:

   ```bash
   git clone https://github.com/ExpertVagabond/mcp-agent-identity-auth0.git
   cd mcp-agent-identity-auth0
   npm install
   ```

2. Do one full practice run: `npm run demo`. It should end with `All 6 requests matched their expected status.`
3. Make the terminal font large (about 18 pt) and the window wide enough that lines don't wrap.
4. Clear the screen: `clear`.
5. Keep two browser tabs ready: this repo's [README](../README.md), which has the request-flow diagram, and the [guide](README.md).
6. Share the terminal **window**, not the whole screen.

## Run of show

### Open (20 seconds)

> "An agent calls tools on an MCP server. The question this answers is: who's allowed to call what, and how is everything else refused? Everything runs locally. A stand-in for Auth0 signs real RS256 tokens, and the server checks them exactly as it would against an Auth0 tenant. I've also run this against a live tenant."

Type:

```bash
npm run demo -- --step
```

You'll see the three services and one line: *requests 1-3 and 5-6 should be refused; request 4 is the one allowed path.*

> "Five ways to be refused, one way to get in. Let's try to break it."

Press **Enter**.

### Request 1: No token (expect 401)

You'll see `401 Unauthorized` and a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource`.

> "No token, so a 401. The useful part is the header. It tells the client where to find the metadata, and from there the authorization server, and it names the scopes to ask for. That's what the current MCP spec asks for, so a client can work out how to log in on its own."

Point at: the `resource_metadata` value. Press **Enter**.

### Request 2: Wrong audience (expect 401)

You'll see `401 Unauthorized   error="invalid_token"`.

> "This token is real and correctly signed, but it was issued for a different API. Signed isn't enough. It has to be issued for this server, otherwise a token for one service could be replayed against another."

Point at: `aud = https://someone-else.test/`. Press **Enter**.

### Request 3: Missing permission (expect 403)

You'll see `403 Forbidden   error="insufficient_scope"   scope="read:reports"`.

> "Now a valid token for this server, but without the permission for this tool. That's a 403, not a 401. We know who you are, you just aren't allowed. And the response names the missing scope, so the client knows exactly what to ask for."

Point at: `scope="read:reports"`. Press **Enter**.

### Request 4: Allowed, with on-behalf-of exchange (expect 200)

You'll see the three numbered lines under **Send**, then `200 OK` and the report text.

> "Same call, now with the permission. Watch the three numbered lines. One: the server checks the token. Two: it doesn't forward the user's token. It exchanges it with Auth0 for a new token, issued for the reports API, for the same user. That's on-behalf-of token exchange, RFC 8693. Three: it calls the backend with that new token. The backend sees a token meant for it, with the user's identity intact."

Point at: `new audience https://reports-backend.demo.test/` and `same user: auth0|demo-user`. Press **Enter**.

### Request 5: Token passthrough blocked (expect 401)

You'll see `401 Unauthorized   {"error":"invalid_token"}`.

> "What if someone skips the MCP server and sends the user's token straight to the backend? Refused. The backend only accepts tokens issued for it. That's what stops token passthrough and the confused-deputy problem."

Press **Enter**.

### Request 6: Bad input (expect 400 and 413)

You'll see `400 Bad Request`, `413 Payload Too Large`, then `whoami answered: server still up`.

> "Last, garbage in: broken JSON gets a clean 400, a body over the limit gets a 413, and the server is still answering afterwards. No mystery failures."

### Close (20 seconds)

The summary table shows six ticks.

> "Six requests, five refusals with a named reason, one allowed path that never forwards the user's token. The same server also reaches GitHub through Token Vault, so the GitHub token never leaves the server. Building it gave me a friction list for Auth0's docs and errors, which is in the repo under docs."

If there's time, switch to the README tab and show the request-flow diagram.

## Likely questions

| They ask | Short answer |
|---|---|
| Is this real Auth0? | The demo uses a local issuer so it runs anywhere. The same server runs against a live Auth0 tenant. I verified it on Oct 21 and again on Nov 10: browser login, on-behalf-of exchange, Token Vault, passthrough refused. Guide steps 2 and 3 have the setup. |
| Why exchange instead of forwarding the token? | A forwarded token's audience is the MCP server, so the backend can't trust it and shouldn't. Exchange gives the backend a token issued for it, for the same user, with narrower reach. The MCP spec forbids passthrough. |
| 401 vs 403? | 401: we don't know who you are, or the token isn't for us. 403: we know who you are, you lack the permission, and we name the one you need. |
| How does Token Vault fit? | The GitHub tool exchanges the user's token for the linked GitHub token inside the server. The agent gets the result, never the GitHub credential. |
| What would you improve in Auth0? | [docs/FRICTION.md](../docs/FRICTION.md). Two examples: on-behalf-of errors that don't name the misconfigured client binding, and dynamically registered clients that can't use social logins. |
| Does it follow the latest MCP spec? | Checked against the 2026-07-28 authorization spec in [docs/MCP-SPEC-CHECK.md](../docs/MCP-SPEC-CHECK.md). Every server MUST and SHOULD passes. The sign-in helper does PKCE, sends `resource`, and validates `iss` per RFC 9207. The next step is moving from a pre-registered client to a Client ID Metadata Document, since dynamic registration is now deprecated. |
| How would you teach this? | This exact sequence as a workshop: one allowed call and five refusals, each with a named reason, then the same build against a real tenant. |

## If something breaks

- **A step shows FAIL:** say what it expected, keep going, and show the saved run afterwards: [`docs/walkthrough-output.txt`](../docs/walkthrough-output.txt).
- **`npm run demo` won't start:** run `npm install` again, then retry. `npm test` (23 tests) proves the same behaviour.
- **Port or network issues:** the demo picks free local ports and needs no internet once installed.
- **Out of time:** run `npm run demo` without `--step`. It finishes in a few seconds and the summary table says it all.
