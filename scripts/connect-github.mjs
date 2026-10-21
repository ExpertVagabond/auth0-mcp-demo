// Links a GitHub account to the signed-in user for Token Vault (Auth0 connected accounts).
// Needs a My Account API token with create:me:connected_accounts. Run: node scripts/connect-github.mjs
// Config: AUTH0_DOMAIN, ME_TOKEN_FILE.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";

const domain = process.env.AUTH0_DOMAIN;
const meToken = readFileSync(process.env.ME_TOKEN_FILE, "utf8").trim();
const redirectUri = "http://localhost:8080/callback";
const state = randomBytes(16).toString("base64url");
const api = `https://${domain}/me/v1/connected-accounts`;

async function post(path, body) {
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${meToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${json.error ?? ""} ${json.error_description ?? json.message ?? ""}`);
  return json;
}

const started = await post("/connect", { connection: "github", redirect_uri: redirectUri, state });
const connectUrl = new URL(started.connect_uri);
connectUrl.searchParams.set("ticket", started.connect_params.ticket);

const finished = new Promise((resolve, reject) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost:8080");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get("connect_code");
    if (url.searchParams.get("state") !== state || !code) {
      res.writeHead(400).end("state mismatch or no connect_code");
      server.close();
      reject(new Error("callback rejected: state mismatch or missing connect_code"));
      return;
    }
    try {
      await post("/complete", { auth_session: started.auth_session, connect_code: code, redirect_uri: redirectUri });
      res.writeHead(200, { "content-type": "text/html" }).end("<h1>GitHub linked. You can close this tab.</h1>");
      resolve();
    } catch (err) {
      res.writeHead(500).end("link failed");
      reject(err);
    } finally {
      server.close();
    }
  });
  server.listen(8080, () => {
    console.log("opening GitHub consent; waiting for the callback on http://localhost:8080/callback");
    execFile("open", [connectUrl.toString()]);
  });
  setTimeout(() => reject(new Error("timed out waiting for GitHub consent")), 10 * 60 * 1000).unref();
});

await finished;
const accounts = await fetch(`${api}/accounts`, { headers: { authorization: `Bearer ${meToken}` } }).then((r) => r.json());
console.log("connected accounts:", (accounts.accounts ?? accounts).map((a) => a.connection));
