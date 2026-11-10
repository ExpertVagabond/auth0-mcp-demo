// Narrated walkthrough of the MCP authorization behaviour, with no Auth0 tenant needed.
// Starts a mock issuer, the reports API and the MCP server on free local ports, then runs six steps
// against them and checks each status. Exit code is non-zero if any step differs from what is expected.
//
//   npm run demo            run straight through
//   npm run demo -- --step  wait for Enter between steps

import http from "node:http";
import net from "node:net";
import readline from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpApp } from "../server.mjs";
import { createReportsApi } from "../reports-api.mjs";
import { createMockIssuer, closeServer, freePorts, RESOURCE, REPORTS_AUD, OBO_CLIENT_ID, OBO_CLIENT_SECRET } from "../test/mock-issuer.mjs";

const stepMode = process.argv.includes("--step");
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const red = paint("31");
const cyan = paint("36");

const out = (line = "") => process.stdout.write(`${line}\n`);

let servers = [];
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.allSettled(servers.map((s) => (s.stop ? s.stop() : closeServer(s))));
  servers = [];
}

process.on("SIGINT", async () => {
  out(`\n${dim("Interrupted. Shutting down servers.")}`);
  await shutdown();
  process.exit(130);
});

// Raw POST with node:http so a 413 is readable even when the server closes the socket mid-upload.
function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

// One readline interface for the whole run, so piped input and EOF behave: each line is one Enter,
// and once stdin ends the remaining steps run straight through.
let rl;
let stdinEnded = false;
const queuedLines = [];
const waiting = [];

// Streams a body of `bytes` in 16 KB chunks over a plain socket and returns the first status line the server sends.
// The server answers 413 and closes while the client is still uploading, so a normal client can lose the response
// to a connection reset. Reading as we write, and stopping at the first reply, makes the result repeatable.
function postOversized(url, headers, bytes) {
  const { hostname, port, pathname } = new URL(url);
  return new Promise((resolve) => {
    const socket = net.connect(Number(port), hostname);
    let received = "";
    let done = false;
    const finish = (status, why) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ status, why });
    };
    socket.on("data", (d) => {
      received += d.toString("latin1");
      const m = received.match(/^HTTP\/1\.1 (\d{3})/);
      if (m) finish(Number(m[1]));
    });
    let lastError = "closed";
    socket.on("error", (err) => { lastError = err.code ?? err.message; });
    socket.on("close", () => finish(`no response (${lastError})`));
    const head = [`POST ${pathname} HTTP/1.1`, `host: ${hostname}:${port}`, `content-length: ${bytes}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), "", ""].join("\r\n");
    socket.write(head);
    const chunk = Buffer.alloc(16 * 1024, "x");
    let sent = 0;
    const pump = () => {
      if (done) return;
      if (sent >= bytes) return;
      sent += chunk.length;
      socket.write(chunk, () => setImmediate(pump));
    };
    pump();
  });
}

function waitForEnter() {
  if (!stepMode || stdinEnded) return Promise.resolve();
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin });
    rl.on("line", () => (waiting.length ? waiting.shift()() : queuedLines.push(1)));
    rl.on("close", () => {
      stdinEnded = true;
      while (waiting.length) waiting.shift()();
    });
  }
  process.stdout.write(dim("  [Enter for the next step] "));
  if (queuedLines.length) {
    queuedLines.shift();
    out("");
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

const results = [];

const RULE = "─".repeat(72);
// One labelled line; continuation lines line up under the value.
const field = (label, value) => value.split("\n").forEach((v, i) => out(`  ${i ? " ".repeat(9) : dim(label.padEnd(9))}${v}`));

// Each step prints the same four parts, so a presenter can read it top to bottom:
// Try (what we're about to do), Send (the request), Result (status + PASS/FAIL), Why (one line on what it proves).
async function step(n, title, run) {
  out("");
  out(cyan(RULE));
  out(bold(cyan(` STEP ${n} of 6 · ${title}`)));
  out(cyan(RULE));
  let outcome;
  try {
    outcome = await run();
  } catch (err) {
    outcome = { ok: false, try: "(step threw)", send: "", result: `error: ${err.message}`, status: "error", expected: "n/a", why: "" };
  }
  field("Try:", outcome.try);
  field("Send:", outcome.send);
  const mark = outcome.ok ? green("PASS") : red(`FAIL (expected ${outcome.expected}, got ${outcome.status})`);
  const [first, ...rest] = outcome.result.split("\n");
  field("Result:", [`${bold(first)}   ${mark}`, ...rest].join("\n"));
  field("Why:", outcome.why);
  results.push({ n, title, ok: outcome.ok, status: outcome.status });
  if (n < 6) await waitForEnter();
}

async function main() {
  const [issuerPort, mcpPort, reportsPort] = await freePorts(3);
  const mock = await createMockIssuer({ port: issuerPort });
  const issuer = mock.issuer;
  const mcpUrl = `http://localhost:${mcpPort}/mcp`;
  const reportsUrl = `http://localhost:${reportsPort}`;

  const reportsServer = createReportsApi({ issuer, audience: REPORTS_AUD });
  const mcpServer = createMcpApp({
    issuer,
    resource: RESOURCE,
    port: mcpPort,
    reports: { url: reportsUrl },
    exchange: { tokenUrl: new URL("oauth/token", issuer).href, clientId: OBO_CLIENT_ID, clientSecret: OBO_CLIENT_SECRET, audience: REPORTS_AUD },
  });
  servers = [mock, reportsServer, mcpServer];
  await mock.start();
  await new Promise((r) => reportsServer.listen(reportsPort, r));
  await new Promise((r) => mcpServer.listen(mcpPort, r));

  out(bold("Auth0 MCP demo: who can call what, and what gets refused"));
  out("");
  out(`  Three local services are running:`);
  out(`    ${bold("issuer")}       stands in for Auth0 and signs real RS256 tokens   ${dim(issuer)}`);
  out(`    ${bold("MCP server")}   the agent's tools, protected by those tokens      ${dim(mcpUrl)}`);
  out(`    ${bold("reports API")}  a backend the MCP server calls for the user       ${dim(reportsUrl)}`);
  out("");
  out(`  Six requests follow. Steps 1-3 and 5-6 should be refused; step 4 is the one allowed path.`);
  if (stepMode) out(dim("  Press Enter to start, then Enter after each step."));
  await waitForEnter();

  const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "walkthrough", version: "0" } } });
  const mcpHeaders = (token) => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  const callTool = (id, name, args) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  // Show headers with the local origin removed, so lines stay short on a shared screen.
  const local = (s) => s.replaceAll(`http://localhost:${mcpPort}`, "").replaceAll(`http://localhost:${reportsPort}`, "");

  // 1. No token.
  await step(1, "No token", async () => {
    const res = await post(mcpUrl, mcpHeaders(), initialize);
    const challenge = res.headers["www-authenticate"] ?? "(none)";
    const ok = res.status === 401 && /resource_metadata="[^"]*\/\.well-known\/oauth-protected-resource"/.test(challenge);
    return {
      ok, status: res.status, expected: 401,
      try: "Call the MCP server with no access token at all.",
      send: "POST /mcp   (no Authorization header)",
      result: `${res.status} Unauthorized\nWWW-Authenticate: ${local(challenge)}`,
      why: "The 401 points the client at the metadata and names the scopes to ask for, so it can log in by itself.",
    };
  });

  // 2. Wrong audience.
  await step(2, "Wrong audience", async () => {
    const token = await mock.sign({ aud: "https://someone-else.test/", scope: "read:reports" });
    const res = await post(mcpUrl, mcpHeaders(token), initialize);
    const challenge = res.headers["www-authenticate"] ?? "(none)";
    return {
      ok: res.status === 401 && /invalid_token/.test(challenge), status: res.status, expected: 401,
      try: "Send a real, correctly signed token that was issued for a different API.",
      send: "POST /mcp   Bearer <token>   aud = https://someone-else.test/",
      result: `${res.status} Unauthorized   error="invalid_token"`,
      why: "Signed isn't enough: the token must be issued for this server, so it can't be replayed here.",
    };
  });

  // 3. Valid token, missing scope.
  await step(3, "Missing permission", async () => {
    const token = await mock.sign({ scope: "openid profile" });
    const res = await post(mcpUrl, mcpHeaders(token), callTool(2, "read_report", { week: "2026-W43" }));
    const challenge = res.headers["www-authenticate"] ?? "(none)";
    const named = /scope="([^"]+)"/.exec(challenge)?.[1] ?? "(none)";
    return {
      ok: res.status === 403 && /error="insufficient_scope", scope="read:reports"/.test(challenge), status: res.status, expected: 403,
      try: "Send a valid token for this server, but without read:reports, and call read_report.",
      send: `tools/call read_report {week: "2026-W43"}   Bearer <token>   scope = "openid profile"`,
      result: `${res.status} Forbidden   error="insufficient_scope"   scope="${named}"`,
      why: "Known user, not allowed. The 403 names the missing scope, so the client knows what to ask for.",
    };
  });

  // 4. Valid token with scope: OBO exchange.
  await step(4, "Allowed: on-behalf-of token exchange", async () => {
    const token = await mock.sign({ scope: "openid read:reports", permissions: ["read:reports"], sub: "auth0|demo-user" });
    const before = mock.exchanges.length;
    const client = new Client({ name: "walkthrough", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const result = await client.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
    await client.close();
    const text = result.content?.[0]?.text ?? "";
    const exchange = mock.exchanges[mock.exchanges.length - 1];
    const exchanged = mock.exchanges.length - before === 1 && exchange?.audience === REPORTS_AUD;
    const ok = result.isError !== true && /Report for 2026-W43/.test(text) && exchanged;
    return {
      ok, status: ok ? 200 : "failed", expected: 200,
      try: "The same call, now with read:reports. Watch what the MCP server does for the user.",
      send: [
        `tools/call read_report {week: "2026-W43"}   Bearer <token>   aud = ${RESOURCE}`,
        `1. MCP server checks issuer, signature, audience, expiry and the read:reports permission`,
        `2. MCP server -> issuer: token exchange (RFC 8693), new audience ${exchange?.audience ?? "(none)"}`,
        `   same user: ${exchange?.sub ?? "(none)"}`,
        `3. MCP server -> reports API: GET /reports/2026-W43 with the exchanged token`,
      ].join("\n"),
      result: `200 OK   "${text}"`,
      why: "The user's token is never forwarded. The backend gets a token issued for it, for the same user.",
    };
  });

  // 5. User's MCP token straight to the reports API.
  await step(5, "Token passthrough blocked", async () => {
    const token = await mock.sign({ scope: "read:reports", permissions: ["read:reports"], aud: RESOURCE });
    const res = await fetch(`${reportsUrl}/reports/2026-W43`, { headers: { authorization: `Bearer ${token}` } });
    return {
      ok: res.status === 401, status: res.status, expected: 401,
      try: "Skip the MCP server: send the user's MCP token straight to the reports API.",
      send: `GET /reports/2026-W43 (reports API)   Bearer <token>   aud = ${RESOURCE}, has read:reports`,
      result: `${res.status} Unauthorized   ${await res.text()}`,
      why: "Only the exchanged token works. No token passthrough, no confused deputy.",
    };
  });

  // 6. Malformed JSON and oversized body.
  await step(6, "Bad input", async () => {
    const token = await mock.sign({ scope: "read:reports" });
    const bad = await post(mcpUrl, mcpHeaders(token), "{not json");
    const big = await postOversized(mcpUrl, mcpHeaders(token), 1024 * 1024 + 16 * 1024);
    const client = new Client({ name: "walkthrough", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const who = await client.callTool({ name: "whoami", arguments: {} });
    await client.close();
    const stillUp = /auth0\|demo-user/.test(who.content?.[0]?.text ?? "");
    return {
      ok: bad.status === 400 && big.status === 413 && stillUp,
      status: `${bad.status} and ${big.status}`, expected: "400 and 413",
      try: "Send broken JSON, then a body over the 1 MB limit, then check the server still answers.",
      send: [`POST /mcp   body "{not json"`, `POST /mcp   body of 1 MB + 16 KB`, `whoami on a fresh connection`].join("\n"),
      result: [`${bad.status} Bad Request   (JSON-RPC parse error)`, `${big.status} Payload Too Large`, stillUp ? "whoami answered: server still up" : "whoami: no answer"].join("\n"),
      why: "Clean, named errors, and the server keeps serving.",
    };
  });

  out("");
  out(cyan(RULE));
  out(bold(" SUMMARY"));
  for (const r of results) out(`  ${r.ok ? green("✓") : red("✗")}  ${String(r.n)}  ${r.title.padEnd(40)}${r.status}`);
  out(cyan(RULE));
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) out(bold(green(`All ${results.length} steps matched their expected status.`)));
  else out(bold(red(`${failed.length} of ${results.length} steps did not match: ${failed.map((r) => r.n).join(", ")}`)));
  return failed.length === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error("walkthrough failed:", err);
} finally {
  await shutdown();
}
rl?.close();
process.exit(code);
