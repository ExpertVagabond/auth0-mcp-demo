// Backend reports API. Only the MCP server calls it, with a service key.
// The key is a local secret for that one hop. It is not an Auth0 credential.

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const REPORTS = {
  "2026-W42": { week: "2026-W42", build: "passed", tickets_closed: ["AUTH-101", "AUTH-102"] },
  "2026-W43": { week: "2026-W43", build: "passed", tickets_closed: ["AUTH-103"] },
};

export function createReportsApi({ apiKey }) {
  if (!apiKey) throw new Error("apiKey is required");
  const expected = Buffer.from(apiKey);

  function keyMatches(req) {
    const given = Buffer.from(req.headers["x-service-key"] ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  function send(res, status, body) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  return createServer((req, res) => {
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
    if (!keyMatches(req)) {
      send(res, 401, { error: "unauthorized" });
      return;
    }

    const report = REPORTS[match[1]];
    if (!report) {
      send(res, 404, { error: "no_report_for_week" });
      return;
    }
    send(res, 200, report);
  });
}

// Run directly: REPORTS_API_KEY and PORT come from the environment.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.REPORTS_API_KEY;
  const port = Number(process.env.PORT ?? 3100);
  if (!apiKey) {
    console.error("Set REPORTS_API_KEY (a local secret shared with the MCP server).");
    process.exit(1);
  }
  createReportsApi({ apiKey }).listen(port, () => {
    console.log(`Reports API on http://localhost:${port}/reports/{week}`);
  });
}
