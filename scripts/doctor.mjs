// Preflight for people and agents: checks everything the demo and the Auth0 steps need, and says how to fix what's missing.
// Exit code is 1 if any check FAILs. The local demo needs only the first three checks; the rest apply once .env exists.
//
//   npm run doctor            human-readable
//   npm run doctor -- --json  machine-readable

import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";

const jsonMode = process.argv.includes("--json");
const root = fileURLToPath(new URL("..", import.meta.url));
const checks = [];
const add = (status, name, detail, fix) => checks.push({ status, name, detail, ...(fix ? { fix } : {}) });

const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });

// 1. Node version
const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) add("PASS", "node", `Node ${process.versions.node}`);
else add("FAIL", "node", `Node ${process.versions.node}`, "Install Node.js 22 or later: https://nodejs.org/en/download");

// 2. Dependencies
const deps = ["@modelcontextprotocol/sdk", "jose", "zod"].filter((d) => !existsSync(`${root}node_modules/${d}/package.json`));
if (deps.length === 0) add("PASS", "dependencies", "installed");
else add("FAIL", "dependencies", `missing: ${deps.join(", ")}`, "Run: npm install");

// 3. Local demo needs nothing else
add("INFO", "local demo", "ready once the two checks above pass", "Run: npm run demo");

// 4+. Auth0 steps. Load .env here too, so `node scripts/doctor.mjs` works without npm's --env-file.
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);
if (!existsSync(`${root}.env`)) {
  add("INFO", ".env", "not found. Only needed for guide steps 3 and 4 (a real Auth0 tenant)", "Run: cp .env.example .env, then follow guide/02-set-up-auth0.md");
} else {
  const e = process.env;
  const required = ["AUTH0_DOMAIN", "AUTH0_ISSUER", "MCP_RESOURCE", "REPORTS_AUDIENCE", "REPORTS_API_URL", "TOKEN_EXCHANGE_CLIENT_ID", "TOKEN_EXCHANGE_CLIENT_SECRET", "LOGIN_CLIENT_ID", "TOKEN_OUT", "TOKEN_FILE"];
  const missing = required.filter((k) => !e[k] || /^your-|your-tenant/.test(e[k]));
  if (missing.length === 0) add("PASS", ".env", "all required values set");
  else add("FAIL", ".env", `still empty or placeholder: ${missing.join(", ")}`, "Fill these in from guide/02-set-up-auth0.md");

  if (e.AUTH0_DOMAIN && e.AUTH0_ISSUER) {
    if (e.AUTH0_ISSUER === `https://${e.AUTH0_DOMAIN}/`) add("PASS", "issuer format", e.AUTH0_ISSUER);
    else add("FAIL", "issuer format", `AUTH0_ISSUER is "${e.AUTH0_ISSUER}"`, `Set AUTH0_ISSUER=https://${e.AUTH0_DOMAIN}/ (https and a trailing slash)`);
  }

  for (const k of ["MCP_RESOURCE", "REPORTS_AUDIENCE"]) {
    if (e[k] && !/^https?:\/\/[^\s#]+$/.test(e[k])) add("FAIL", k, `"${e[k]}" is not an absolute URI`, "Use the API identifier exactly as created in Auth0, e.g. https://reports.demo.test/");
  }
  if (e.MCP_RESOURCE && e.MCP_RESOURCE === e.REPORTS_AUDIENCE) {
    add("FAIL", "identifiers", "MCP_RESOURCE and REPORTS_AUDIENCE are the same", "They are two different APIs (guide steps 2.2 and 2.3)");
  }

  if (e.AUTH0_DOMAIN && !missing.includes("AUTH0_DOMAIN")) {
    try {
      const res = await fetch(`https://${e.AUTH0_DOMAIN}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
      const meta = await res.json();
      if (meta.issuer === e.AUTH0_ISSUER) add("PASS", "tenant", `reachable, issuer ${meta.issuer}`);
      else add("FAIL", "tenant", `reachable, but its issuer is ${meta.issuer}`, "Set AUTH0_ISSUER to that value");
      const exchange = (meta.grant_types_supported ?? []).some((g) => g.includes("token-exchange"));
      add(exchange ? "PASS" : "WARN", "token exchange", exchange ? "advertised by the tenant" : "not listed in the tenant's grant types", exchange ? undefined : "See guide step 2.6");
      add(meta.authorization_response_iss_parameter_supported ? "PASS" : "WARN", "iss in responses",
        meta.authorization_response_iss_parameter_supported ? "the tenant sends iss (RFC 9207)" : "the tenant doesn't advertise iss",
        meta.authorization_response_iss_parameter_supported ? undefined : "Turn on Include Issuer in Authorization Responses (guide step 2.1)");
    } catch (err) {
      add("FAIL", "tenant", `can't reach https://${e.AUTH0_DOMAIN}/ (${err.cause?.code ?? err.name})`, "Check AUTH0_DOMAIN and your network");
    }
  }

  for (const [port, what] of [[3000, "MCP server"], [3100, "reports API"], [8080, "login callback"]]) {
    if (await portFree(port)) add("PASS", `port ${port}`, `free for the ${what}`);
    else add("WARN", `port ${port}`, `in use. Fine if the ${what} is already running; otherwise stop whatever holds it`);
  }

  if (e.TOKEN_FILE && existsSync(`${root}${e.TOKEN_FILE}`)) {
    try {
      const p = JSON.parse(Buffer.from(readFileSync(`${root}${e.TOKEN_FILE}`, "utf8").trim().split(".")[1], "base64url").toString());
      const mins = Math.round((p.exp * 1000 - Date.now()) / 60000);
      if (mins > 0) add("PASS", "saved token", `expires in ${mins} min, permissions ${JSON.stringify(p.permissions ?? [])}`);
      else add("WARN", "saved token", "expired", "Run: npm run login");
    } catch {
      add("WARN", "saved token", "unreadable", "Run: npm run login");
    }
  } else {
    add("INFO", "saved token", "none yet", "Run: npm run login (needs a person to sign in)");
  }
}

const failed = checks.filter((c) => c.status === "FAIL").length;
if (jsonMode) {
  process.stdout.write(`${JSON.stringify({ ok: failed === 0, checks }, null, 2)}\n`);
} else {
  for (const c of checks) {
    console.log(`${c.status.padEnd(5)} ${c.name.padEnd(17)} ${c.detail}`);
    if (c.fix && c.status !== "PASS") console.log(`${" ".repeat(24)}→ ${c.fix}`);
  }
  console.log(failed === 0 ? "\nReady." : `\n${failed} check(s) failed. Fix them and run npm run doctor again.`);
}
process.exit(failed === 0 ? 0 : 1);
