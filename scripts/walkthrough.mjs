// Narrated walkthrough of the MCP authorization behaviour, with no Auth0 tenant needed.
// Starts a mock issuer, the reports API and the MCP server on free local ports, then runs six steps
// against them and checks each status. Exit code is non-zero if any step differs from what is expected.
//
//   npm run demo            run straight through
//   npm run demo -- --step  wait for Enter between steps

import http from "node:http";
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

async function step(n, title, run) {
  out("");
  out(bold(cyan(`Step ${n}: ${title}`)));
  let outcome;
  try {
    outcome = await run();
  } catch (err) {
    outcome = { ok: false, lines: [`error: ${err.message}`], status: "error", expected: "n/a" };
  }
  for (const line of outcome.lines) out(`  ${line}`);
  const mark = outcome.ok ? green("PASS") : red("FAIL");
  out(`  ${mark}  expected ${outcome.expected}, got ${outcome.status}`);
  out(`  ${dim("Why it matters: " + outcome.why)}`);
  results.push({ n, title, ok: outcome.ok });
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

  out(bold("Auth0 MCP demo walkthrough (local, mock issuer, no tenant needed)"));
  out(dim(`  mock issuer  ${issuer}`));
  out(dim(`  MCP server   ${mcpUrl}   (resource ${RESOURCE})`));
  out(dim(`  reports API  ${reportsUrl}   (audience ${REPORTS_AUD})`));
  out(dim("  Tokens are real RS256 JWTs. The servers verify them against the mock issuer's JWKS, as they would against Auth0's."));
  if (stepMode) out(dim("  Step mode: press Enter to move on."));
  await waitForEnter();

  const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "walkthrough", version: "0" } } });
  const mcpHeaders = (token) => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  const callTool = (id, name, args) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const shortToken = (t) => `${t.slice(0, 18)}...`;

  // 1. No token.
  await step(1, "no token", async () => {
    const res = await post(mcpUrl, mcpHeaders(), initialize);
    const challenge = res.headers["www-authenticate"] ?? "(none)";
    const ok = res.status === 401 && /resource_metadata="[^"]*\/\.well-known\/oauth-protected-resource"/.test(challenge);
    return {
      ok, status: res.status, expected: 401,
      lines: [`request:  POST ${mcpUrl}   (no Authorization header)`, `response: ${res.status}`, `WWW-Authenticate: ${challenge}`],
      why: "The challenge tells a client where the protected-resource metadata is, so it can find the authorization server on its own.",
    };
  });

  // 2. Wrong audience.
  await step(2, "token for the wrong audience", async () => {
    const token = await mock.sign({ aud: "https://someone-else.test/", scope: "read:reports" });
    const res = await post(mcpUrl, mcpHeaders(token), initialize);
    const challenge = res.headers["www-authenticate"] ?? "(none)";
    return {
      ok: res.status === 401 && /invalid_token/.test(challenge), status: res.status, expected: 401,
      lines: [`request:  POST ${mcpUrl}   Bearer ${shortToken(token)}  (aud = https://someone-else.test/)`, `response: ${res.status}`, `WWW-Authenticate: ${challenge}`],
      why: "A validly signed token is still refused unless it was issued for this server, so a token meant for another API can't be replayed here.",
    };
  });

  // 3. Valid token, missing scope.
  await step(3, "valid token without read:reports", async () => {
    const token = await mock.sign({ scope: "openid profile" });
    const res = await post(mcpUrl, mcpHeaders(token), callTool(2, "read_report", { week: "2026-W43" }));
    const challenge = res.headers["www-authenticate"] ?? "(none)";
    return {
      ok: res.status === 403 && /error="insufficient_scope", scope="read:reports"/.test(challenge), status: res.status, expected: 403,
      lines: [`request:  tools/call read_report {week: "2026-W43"}   Bearer ${shortToken(token)}  (scope = "openid profile")`, `response: ${res.status}`, `WWW-Authenticate: ${challenge}`],
      why: "The user is authenticated but not authorized for this tool. The 403 names the missing scope so a client can ask for it.",
    };
  });

  // 4. Valid token with scope: OBO exchange.
  await step(4, "valid token with read:reports, on-behalf-of exchange", async () => {
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
      lines: [
        `request:  tools/call read_report {week: "2026-W43"}   Bearer ${shortToken(token)}  (aud = ${RESOURCE})`,
        `MCP server -> issuer: RFC 8693 token exchange, audience ${exchange?.audience ?? "(none)"} for ${exchange?.sub ?? "(none)"}`,
        `MCP server -> reports API: GET /reports/2026-W43 with the exchanged token; it answered 200 (the report below came from it)`,
        `result:   ${text}`,
      ],
      why: "The server swaps the user's token for one scoped to the reports API instead of forwarding it, so the backend sees a token meant for it.",
    };
  });

  // 5. User's MCP token straight to the reports API.
  await step(5, "the user's MCP token sent straight to the reports API", async () => {
    const token = await mock.sign({ scope: "read:reports", permissions: ["read:reports"], aud: RESOURCE });
    const res = await fetch(`${reportsUrl}/reports/2026-W43`, { headers: { authorization: `Bearer ${token}` } });
    return {
      ok: res.status === 401, status: res.status, expected: 401,
      lines: [`request:  GET ${reportsUrl}/reports/2026-W43   Bearer ${shortToken(token)}  (aud = ${RESOURCE}, holds read:reports)`, `response: ${res.status}  ${await res.text()}`],
      why: "The backend rejects a token whose audience is the MCP server, so no token passthrough and no confused deputy: only the exchanged token works.",
    };
  });

  // 6. Malformed JSON and oversized body.
  await step(6, "malformed JSON and an oversized body", async () => {
    const token = await mock.sign({ scope: "read:reports" });
    const bad = await post(mcpUrl, mcpHeaders(token), "{not json");
    const big = await post(mcpUrl, mcpHeaders(token), callTool(3, "read_report", { week: "x".repeat(1.5 * 1024 * 1024) })).catch((err) => ({ status: `no response (${err.code ?? err.message})` }));
    const client = new Client({ name: "walkthrough", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const who = await client.callTool({ name: "whoami", arguments: {} });
    await client.close();
    const stillUp = /auth0\|demo-user/.test(who.content?.[0]?.text ?? "");
    return {
      ok: bad.status === 400 && big.status === 413 && stillUp,
      status: `${bad.status} and ${big.status}`, expected: "400 and 413",
      lines: [
        `request:  POST ${mcpUrl}  body "{not json"  ->  ${bad.status}  ${bad.text}`,
        `request:  POST ${mcpUrl}  body of 1.5 MB (limit is 1 MB)  ->  ${big.status}`,
        `follow-up: whoami on a fresh connection  ->  ${stillUp ? "server still up, answered" : "no answer"}`,
      ],
      why: "Bad input gets a clean error and the server keeps serving; it doesn't crash or buffer an unbounded body.",
    };
  });

  out("");
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
