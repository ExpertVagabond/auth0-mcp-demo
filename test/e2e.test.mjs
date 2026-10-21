// End-to-end: a mock OAuth issuer signs RS256 access tokens, the MCP server validates them,
// and a real MCP client calls the tools. Run with: npm test

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpApp } from "../server.mjs";

const ISSUER_PORT = 4101;
const MCP_PORT = 4102;
const ISSUER = `http://localhost:${ISSUER_PORT}/`;
const RESOURCE = "https://reports.demo.test/";
const MCP_URL = `http://localhost:${MCP_PORT}/mcp`;

let privateKey;
let publicJwk;
let issuerServer;
let mcpServer;

before(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };

  issuerServer = createServer((req, res) => {
    if (req.url === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => issuerServer.listen(ISSUER_PORT, r));

  mcpServer = createMcpApp({ issuer: ISSUER, resource: RESOURCE, port: MCP_PORT });
  await new Promise((r) => mcpServer.listen(MCP_PORT, r));
});

after(async () => {
  await new Promise((r) => mcpServer.close(r));
  await new Promise((r) => issuerServer.close(r));
});

async function sign({ scope = "", permissions, aud = RESOURCE, iss = ISSUER, sub = "auth0|demo-user", expiresIn = "5m" } = {}) {
  return new SignJWT(permissions ? { scope, permissions } : { scope })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

async function connect(token) {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "e2e-test", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

async function rawPost(headers = {}) {
  return fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } } }),
  });
}

test("protected-resource metadata names the resource and issuer", async () => {
  const res = await fetch(`http://localhost:${MCP_PORT}/.well-known/oauth-protected-resource`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.resource, RESOURCE);
  assert.deepEqual(body.authorization_servers, [ISSUER]);
  assert.deepEqual(body.scopes_supported, ["read:reports"]);
});

test("no token: 401 with a resource_metadata challenge", async () => {
  const res = await rawPost();
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate");
  assert.match(challenge, /^Bearer resource_metadata="http:\/\/localhost:4102\/\.well-known\/oauth-protected-resource"$/);
});

test("wrong audience is rejected", async () => {
  const token = await sign({ aud: "https://someone-else.test/" });
  const res = await rawPost({ authorization: `Bearer ${token}` });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate"), /invalid_token/);
});

test("wrong issuer is rejected", async () => {
  const token = await sign({ iss: "https://evil.test/" });
  const res = await rawPost({ authorization: `Bearer ${token}` });
  assert.equal(res.status, 401);
});

test("expired token is rejected", async () => {
  const token = await sign({ expiresIn: "-1m" });
  const res = await rawPost({ authorization: `Bearer ${token}` });
  assert.equal(res.status, 401);
});

test("valid token without read:reports: whoami works, read_report is refused", async () => {
  const client = await connect(await sign({ scope: "openid profile" }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["read_report", "whoami"]);

  const who = await client.callTool({ name: "whoami", arguments: {} });
  const parsed = JSON.parse(who.content[0].text);
  assert.equal(parsed.sub, "auth0|demo-user");
  assert.deepEqual(parsed.scopes, ["openid", "profile"]);

  const report = await client.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
  assert.equal(report.isError, true);
  assert.match(report.content[0].text, /insufficient_scope: requires read:reports/);
  await client.close();
});

test("valid token with read:reports: read_report returns the report", async () => {
  const client = await connect(await sign({ scope: "openid read:reports" }));
  const report = await client.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
  assert.notEqual(report.isError, true);
  assert.match(report.content[0].text, /Report for 2026-W43/);
  await client.close();
});

test("permission must be in both scope and permissions claims when both are present", async () => {
  // Granted by the client (scope) and held by the user (permissions): allowed.
  const both = await connect(await sign({ scope: "read:reports", permissions: ["read:reports"] }));
  const ok = await both.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
  assert.notEqual(ok.isError, true);
  await both.close();

  // User holds it but the client was not granted it: refused.
  const userOnly = await connect(await sign({ scope: "openid", permissions: ["read:reports"] }));
  const refused = await userOnly.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
  assert.equal(refused.isError, true);
  await userOnly.close();
});

test("permissions claim without a scope claim grants nothing (fails closed)", async () => {
  const client = await connect(await sign({ permissions: ["read:reports"] }));
  const report = await client.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
  assert.equal(report.isError, true);
  await client.close();
});

test("malformed JSON with a valid token: 400 parse error, server keeps running", async () => {
  const token = await sign({ scope: "read:reports" });
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: "{not json",
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32700);

  const client = await connect(token);
  const who = await client.callTool({ name: "whoami", arguments: {} });
  assert.match(who.content[0].text, /auth0\|demo-user/);
  await client.close();
});

test("oversized body with a valid token: 413, server keeps running", async () => {
  const token = await sign({ scope: "read:reports" });
  const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_report", arguments: { week: "x".repeat(2 * 1024 * 1024) } } });
  // The server answers 413 and closes the socket while the client is still sending,
  // so the client may see a broken pipe instead of the response. Either is acceptable.
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: big,
    });
    assert.equal(res.status, 413);
  } catch (err) {
    assert.match(String(err.cause?.message ?? err.message), /EPIPE|ECONNRESET|socket/i);
  }

  const client = await connect(token);
  const report = await client.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
  assert.match(report.content[0].text, /Report for 2026-W43/);
  await client.close();
});
