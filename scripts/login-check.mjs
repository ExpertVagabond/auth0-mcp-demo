// Browser login (authorization code + PKCE) against the tenant. Saves the user's access token to a
// private file for scripts/live-check.mjs. The token is never printed. Run: node scripts/login-check.mjs
// Config: AUTH0_DOMAIN, LOGIN_CLIENT_ID, MCP_RESOURCE, TOKEN_OUT.

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execFile } from "node:child_process";

const domain = process.env.AUTH0_DOMAIN;
const clientId = process.env.LOGIN_CLIENT_ID;
const audience = process.env.MCP_RESOURCE;
const tokenOut = process.env.TOKEN_OUT;
const redirectUri = "http://localhost:8080/callback";
const clientSecret = process.env.LOGIN_CLIENT_SECRET;
// LOGIN_CONNECTION (for example "github") sends the user straight to that identity provider.
const loginConnection = process.env.LOGIN_CONNECTION;

if (!domain || !clientId || !audience || !tokenOut) {
  console.error("Set AUTH0_DOMAIN, LOGIN_CLIENT_ID, MCP_RESOURCE, TOKEN_OUT.");
  process.exit(1);
}

const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("base64url");

// AUTH_PARAM selects how the API is named in the request: "audience" (default) or "resource"
// (the MCP resource identifier, which needs the Resource Parameter Compatibility Profile).
const targetParam = process.env.AUTH_PARAM === "resource" ? "resource" : "audience";

const authorize = new URL(`https://${domain}/authorize`);
authorize.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: process.env.LOGIN_SCOPE ?? "openid profile email read:reports",
  [targetParam]: audience,
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
}).toString();
if (loginConnection) authorize.searchParams.set("connection", loginConnection);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8080");
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get("state") !== state || !url.searchParams.get("code")) {
    res.writeHead(400, { "content-type": "text/plain" }).end("state mismatch or no code");
    console.error("callback rejected: state mismatch or missing code");
    server.close();
    process.exit(1);
  }
  try {
    const tokenRes = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: url.searchParams.get("code"),
        code_verifier: verifier,
        redirect_uri: redirectUri,
        // Confidential clients (Token Vault) also authenticate with their secret.
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      }),
    });
    const t = await tokenRes.json();
    if (!t.access_token) throw new Error(`token exchange failed: ${t.error} ${t.error_description}`);
    writeFileSync(tokenOut, t.access_token, { mode: 0o600 });
    const p = JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url").toString());
    console.log("token saved (not printed). claims:", JSON.stringify({ sub: p.sub, aud: p.aud, scope: p.scope, permissions: p.permissions }));
    res.writeHead(200, { "content-type": "text/html" }).end("<h1>Login done. You can close this tab.</h1>");
  } catch (err) {
    console.error(err.message);
    res.writeHead(500).end("token exchange failed");
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(8080, () => {
  console.log("waiting for login on http://localhost:8080/callback (10 minute limit)");
  execFile("open", [authorize.toString()]);
});

setTimeout(() => {
  console.error("timed out waiting for login");
  process.exit(1);
}, 10 * 60 * 1000).unref();
