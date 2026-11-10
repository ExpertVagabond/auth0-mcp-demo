// Backend reports API. Callers present an access token issued for this API (via on-behalf-of token
// exchange). The API verifies the token against the issuer's JWKS, checks its audience, and requires the
// read:reports permission. Auth0 puts that permission in the `permissions` claim of exchanged tokens.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";

const REPORT_PERMISSION = "read:reports";

const REPORTS = {
  "2026-W42": { week: "2026-W42", build: "passed", tickets_closed: ["AUTH-101", "AUTH-102"] },
  "2026-W43": { week: "2026-W43", build: "passed", tickets_closed: ["AUTH-103"] },
};

export function createReportsApi({ issuer, audience }) {
  if (!issuer || !audience) throw new Error("issuer and audience are required");
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));

  function send(res, status, body) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  async function authorize(req) {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return { status: 401, error: "unauthorized" };
    let payload;
    try {
      ({ payload } = await jwtVerify(header.slice(7), jwks, { issuer, audience, requiredClaims: ["exp", "sub"] }));
      if (typeof payload.sub !== "string" || !payload.sub.trim()) return { status: 401, error: "invalid_token" };
    } catch {
      return { status: 401, error: "invalid_token" };
    }
    const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
    if (!permissions.includes(REPORT_PERMISSION)) return { status: 403, error: "insufficient_scope" };
    return { ok: true };
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://reports.local");
    } catch {
      send(res, 400, { error: "bad_request" });
      return;
    }

    if (url.pathname === "/health") {
      send(res, 200, { ok: true });
      return;
    }

    const match = url.pathname.match(/^\/reports\/(\d{4}-W\d{2})$/);
    if (!match) {
      send(res, 404, { error: "not_found" });
      return;
    }
    if (req.method !== "GET") {
      send(res, 405, { error: "method_not_allowed" });
      return;
    }

    const auth = await authorize(req);
    if (!auth.ok) {
      res.setHeader("www-authenticate", `Bearer error="${auth.error}"`);
      send(res, auth.status, { error: auth.error });
      return;
    }

    const report = REPORTS[match[1]];
    if (!report) {
      send(res, 404, { error: "no_report_for_week" });
      return;
    }
    send(res, 200, report);
  }

  return createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error("reports request failed:", err);
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    }
  });
}

// Run directly: AUTH0_ISSUER, REPORTS_AUDIENCE and PORT come from the environment.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issuer = process.env.AUTH0_ISSUER;
  const audience = process.env.REPORTS_AUDIENCE;
  const port = Number(process.env.PORT ?? 3100);
  if (!issuer || !audience) {
    console.error("Set AUTH0_ISSUER and REPORTS_AUDIENCE (the backend API identifier).");
    process.exit(1);
  }
  // Local by default. Set HOST=0.0.0.0 only behind a proxy or in a container.
  createReportsApi({ issuer, audience }).listen(port, process.env.HOST ?? "127.0.0.1", () => {
    console.log(`Reports API on http://localhost:${port}/reports/{week}, audience ${audience}`);
  });
}
