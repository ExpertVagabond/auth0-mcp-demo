// Mock Auth0 tenant shared by the tests and scripts/walkthrough.mjs.
// It signs real RS256 access tokens, serves a JWKS, and implements two token-exchange grants:
// RFC 8693 on-behalf-of (user token -> token for the reports API) and Token Vault (user token -> stored GitHub token).
// A small stub stands in for api.github.com.

import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT, jwtVerify } from "jose";

export const RESOURCE = "https://reports.demo.test/";
export const REPORTS_AUD = "https://reports-backend.demo.test/";
export const OBO_CLIENT_ID = "obo-test-client";
export const OBO_CLIENT_SECRET = "obo-test-secret";
const FEDERATED_GRANT = "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token";

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server.address().port));
  });
}

// fetch keeps sockets alive, so close them first or server.close() never calls back.
export async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}

// Ask the OS for n free ports. There is a small window before they are reused; fine for a local demo.
export async function freePorts(n) {
  const servers = Array.from({ length: n }, () => createServer());
  const ports = await Promise.all(servers.map((s) => listen(s, 0)));
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  return ports;
}

export function createGithubStub() {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://github.stub");
    const authed = (req.headers.authorization ?? "").startsWith("Bearer gh-token-");
    if (!authed) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ message: "Bad credentials" }));
      return;
    }
    if (url.pathname === "/user") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ login: "test-user" }));
      return;
    }
    if (url.pathname === "/search/issues") {
      const q = url.searchParams.get("q") ?? "";
      const perPage = Number(url.searchParams.get("per_page") ?? 0);
      if (!q.includes("is:pr") || !q.includes("author:@me")) {
        res.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify({ message: "bad query" }));
        return;
      }
      const items = [
        { title: "Fix token refresh", html_url: "https://github.com/acme/api/pull/12", repository_url: "https://api.github.com/repos/acme/api", created_at: "2026-10-18T09:00:00Z" },
        { title: "Docs for webhooks", html_url: "https://github.com/acme/docs/pull/4", repository_url: "https://api.github.com/repos/acme/docs", created_at: "2026-10-19T09:00:00Z" },
      ].slice(0, perPage);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ total_count: items.length, items }));
      return;
    }
    res.writeHead(404).end();
  });
}

// Returns { issuer, exchanges, sign, start(), stop() }. `issuer` is the iss claim (with trailing slash).
// `exchanges` records each successful on-behalf-of exchange as { sub, audience }.
export async function createMockIssuer({ port }) {
  const issuer = `http://localhost:${port}/`;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const exchanges = [];

  // Mirrors Auth0's RFC 8693 on-behalf-of exchange closely enough for these tests:
  // the subject token must be valid for the MCP resource, the client must authenticate,
  // and the result is a token for the requested audience with the user's permissions and no scope claim.
  async function mockTokenEndpoint(form) {
    if (form.get("grant_type") === FEDERATED_GRANT) {
      return mockTokenVaultExchange(form);
    }
    if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:token-exchange") {
      return { status: 400, body: { error: "unsupported_grant_type" } };
    }
    if (form.get("client_id") !== OBO_CLIENT_ID || form.get("client_secret") !== OBO_CLIENT_SECRET) {
      return { status: 401, body: { error: "invalid_client" } };
    }
    let subject;
    try {
      ({ payload: subject } = await jwtVerify(form.get("subject_token"), publicKey, { issuer, audience: RESOURCE }));
    } catch {
      return { status: 400, body: { error: "invalid_request", error_description: "subject token is not valid for this resource" } };
    }
    if (form.get("audience") !== REPORTS_AUD) {
      return { status: 400, body: { error: "invalid_request", error_description: "unknown audience" } };
    }
    exchanges.push({ sub: subject.sub, audience: form.get("audience") });
    const permissions = Array.isArray(subject.permissions)
      ? subject.permissions
      : typeof subject.scope === "string"
        ? subject.scope.split(" ")
        : [];
    const access_token = await new SignJWT({ permissions })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(REPORTS_AUD)
      .setSubject(subject.sub)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    return { status: 200, body: { access_token, token_type: "Bearer", expires_in: 3600 } };
  }

  // Token Vault: returns the GitHub token stored for the user. A user with no linked GitHub account gets an error,
  // as Auth0 returns it.
  async function mockTokenVaultExchange(form) {
    if (form.get("client_id") !== OBO_CLIENT_ID || form.get("client_secret") !== OBO_CLIENT_SECRET) {
      return { status: 401, body: { error: "invalid_client" } };
    }
    let subject;
    try {
      ({ payload: subject } = await jwtVerify(form.get("subject_token"), publicKey, { issuer, audience: RESOURCE }));
    } catch {
      return { status: 400, body: { error: "invalid_request", error_description: "subject token is not valid for this resource" } };
    }
    if (form.get("connection") !== "github") {
      return { status: 400, body: { error: "invalid_request", error_description: "unknown connection" } };
    }
    if (subject.sub === "auth0|no-github") {
      return {
        status: 400,
        body: { error: "federated_connection_refresh_token_not_found", error_description: "There is no connected account for that user and connection." },
      };
    }
    return { status: 200, body: { access_token: `gh-token-${subject.sub}`, token_type: "Bearer", expires_in: 28791 } };
  }

  const server = createServer(async (req, res) => {
    if (req.url === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (req.url === "/oauth/token" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const { status, body } = await mockTokenEndpoint(form);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404).end();
  });

  async function sign({ scope = "", permissions, aud = RESOURCE, iss = issuer, sub = "auth0|demo-user", expiresIn = "5m" } = {}) {
    return new SignJWT(permissions ? { scope, permissions } : { scope })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(iss)
      .setAudience(aud)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  }

  return {
    issuer,
    exchanges,
    sign,
    start: () => listen(server, port),
    stop: () => closeServer(server),
  };
}
