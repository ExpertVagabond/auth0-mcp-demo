// End-to-end: a mock OAuth issuer signs RS256 access tokens and runs token exchange, the MCP server
// validates the user's token and exchanges it, the reports API validates the exchanged token,
// and a real MCP client calls the tools. Run with: npm test
// The mock issuer lives in ./mock-issuer.mjs so scripts/walkthrough.mjs can reuse it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpApp } from "../server.mjs";
import { createReportsApi } from "../reports-api.mjs";
import {
  createMockIssuer,
  createGithubStub,
  closeServer,
  RESOURCE,
  REPORTS_AUD,
  OBO_CLIENT_ID,
  OBO_CLIENT_SECRET,
} from "./mock-issuer.mjs";

const ISSUER_PORT = 4101;
const MCP_PORT = 4102;
const REPORTS_PORT = 4103;
const GITHUB_STUB_PORT = 4104;
const ISSUER = `http://localhost:${ISSUER_PORT}/`;
const MCP_URL = `http://localhost:${MCP_PORT}/mcp`;

let mockIssuer;
let sign;
let mcpServer;
let reportsServer;
let githubStub;

before(async () => {
  mockIssuer = await createMockIssuer({ port: ISSUER_PORT });
  sign = mockIssuer.sign;
  await mockIssuer.start();

  reportsServer = createReportsApi({ issuer: ISSUER, audience: REPORTS_AUD });
  await new Promise((r) => reportsServer.listen(REPORTS_PORT, r));

  // Stands in for api.github.com: accepts only tokens that Token Vault issued in these tests.
  githubStub = createGithubStub();
  await new Promise((r) => githubStub.listen(GITHUB_STUB_PORT, r));

  mcpServer = createMcpApp({
    issuer: ISSUER,
    resource: RESOURCE,
    port: MCP_PORT,
    reports: { url: `http://localhost:${REPORTS_PORT}` },
    exchange: {
      tokenUrl: new URL("oauth/token", ISSUER).href,
      clientId: OBO_CLIENT_ID,
      clientSecret: OBO_CLIENT_SECRET,
      audience: REPORTS_AUD,
    },
    github: { connection: "github", apiUrl: `http://localhost:${GITHUB_STUB_PORT}` },
  });
  await new Promise((r) => mcpServer.listen(MCP_PORT, r));
});

after(async () => {
  for (const server of [mcpServer, reportsServer, githubStub]) await closeServer(server);
  await mockIssuer.stop();
});

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
  assert.deepEqual(body.scopes_supported, ["read:reports", "read:github"]);
});

test("no token: 401 with a resource_metadata challenge", async () => {
  const res = await rawPost();
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate");
  assert.match(challenge, /^Bearer resource_metadata="http:\/\/localhost:4102\/\.well-known\/oauth-protected-resource", scope="read:reports read:github"$/);
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
  assert.deepEqual(tools.map((t) => t.name).sort(), ["github_open_prs", "github_profile", "read_report", "whoami"]);

  const who = await client.callTool({ name: "whoami", arguments: {} });
  const parsed = JSON.parse(who.content[0].text);
  assert.equal(parsed.sub, "auth0|demo-user");
  assert.deepEqual(parsed.scopes, ["openid", "profile"]);

  // The SDK surfaces the HTTP 403 as a thrown error; the status and challenge are checked in their own test.
  await assert.rejects(client.callTool({ name: "read_report", arguments: { week: "2026-W43" } }));
  await client.close();
});

test("valid token with read:reports: read_report returns the report through token exchange", async () => {
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

  // User holds it but the client was not granted it: refused before any exchange.
  const userOnly = await connect(await sign({ scope: "openid", permissions: ["read:reports"] }));
  await assert.rejects(userOnly.callTool({ name: "read_report", arguments: { week: "2026-W43" } }));
  await userOnly.close();
});

test("permissions claim without a scope claim grants nothing (fails closed)", async () => {
  const client = await connect(await sign({ permissions: ["read:reports"] }));
  await assert.rejects(client.callTool({ name: "read_report", arguments: { week: "2026-W43" } }));
  await client.close();
});

test("tool call without read:reports gets HTTP 403 with an insufficient_scope challenge", async () => {
  const token = await sign({ scope: "openid" });
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "read_report", arguments: { week: "2026-W43" } } }),
  });
  assert.equal(res.status, 403);
  assert.match(res.headers.get("www-authenticate"), /error="insufficient_scope", scope="read:reports", resource_metadata=/);
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

test("read_report exchanges the user's token once and reuses the result", async () => {
  const token = await sign({ scope: "read:reports", permissions: ["read:reports"], sub: "auth0|cache-check" });
  const client = await connect(token);
  const before = mockIssuer.exchanges.length;
  await client.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
  await client.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
  assert.equal(mockIssuer.exchanges.length - before, 1);
  await client.close();
});

test("reports API refuses a missing token, a token for the wrong audience, and one without the permission", async () => {
  const url = `http://localhost:${REPORTS_PORT}/reports/2026-W43`;
  assert.equal((await fetch(url)).status, 401);

  const wrongAud = await sign({ aud: RESOURCE, permissions: ["read:reports"] });
  assert.equal((await fetch(url, { headers: { authorization: `Bearer ${wrongAud}` } })).status, 401);

  const noPermission = await sign({ aud: REPORTS_AUD, scope: "openid" });
  assert.equal((await fetch(url, { headers: { authorization: `Bearer ${noPermission}` } })).status, 403);
});

test("reports API returns the week for a token with the permission, and 404 for an unknown week", async () => {
  const good = await sign({ aud: REPORTS_AUD, permissions: ["read:reports"] });
  const headers = { authorization: `Bearer ${good}` };
  const ok = await fetch(`http://localhost:${REPORTS_PORT}/reports/2026-W43`, { headers });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).tickets_closed, ["AUTH-103"]);
  const missing = await fetch(`http://localhost:${REPORTS_PORT}/reports/2026-W01`, { headers });
  assert.equal(missing.status, 404);
});

test("read_report with an unknown but well-formed week returns a tool error", async () => {
  const client = await connect(await sign({ scope: "read:reports" }));
  const report = await client.callTool({ name: "read_report", arguments: { week: "2026-W01" } });
  assert.equal(report.isError, true);
  assert.match(report.content[0].text, /no report for 2026-W01/);
  await client.close();
});

test("read_report rejects a week that is not in ISO format", async () => {
  const client = await connect(await sign({ scope: "read:reports" }));
  // Schema validation fails before the handler runs. The SDK may report that as an error result or a thrown error.
  const result = await client.callTool({ name: "read_report", arguments: { week: "../admin" } }).catch((err) => ({ isError: true, err }));
  assert.equal(result.isError, true);
  await client.close();
});

test("github_profile without read:github gets HTTP 403 with a challenge naming that scope", async () => {
  const token = await sign({ scope: "read:reports" });
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "github_profile", arguments: {} } }),
  });
  assert.equal(res.status, 403);
  assert.match(res.headers.get("www-authenticate"), /scope="read:github"/);
});

test("github_profile returns the linked GitHub login through Token Vault and never the token", async () => {
  const client = await connect(await sign({ scope: "read:github", permissions: ["read:github"], sub: "github|216808416" }));
  const result = await client.callTool({ name: "github_profile", arguments: {} });
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { github_login: "test-user" });
  assert.doesNotMatch(result.content[0].text, /gh-token-/);
  await client.close();
});

test("github_profile reports a user with no linked GitHub account as a tool error", async () => {
  const client = await connect(await sign({ scope: "read:github", permissions: ["read:github"], sub: "auth0|no-github" }));
  const result = await client.callTool({ name: "github_profile", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /token exchange failed: There is no connected account/);
  await client.close();
});

test("github_open_prs lists the user's open pull requests through Token Vault", async () => {
  const client = await connect(await sign({ scope: "read:github", permissions: ["read:github"], sub: "github|216808416" }));
  const result = await client.callTool({ name: "github_open_prs", arguments: { limit: 1 } });
  assert.notEqual(result.isError, true);
  const parsed = JSON.parse(result.content[0].text);
  assert.deepEqual(parsed.open_prs, [
    { title: "Fix token refresh", url: "https://github.com/acme/api/pull/12", repo: "acme/api", created_at: "2026-10-18T09:00:00Z" },
  ]);
  assert.doesNotMatch(result.content[0].text, /gh-token-/);
  await client.close();
});

test("github_open_prs without read:github gets HTTP 403", async () => {
  const token = await sign({ scope: "read:reports" });
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "github_open_prs", arguments: {} } }),
  });
  assert.equal(res.status, 403);
});
