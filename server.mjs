// MCP server protected by an OAuth 2.0 authorization server (Auth0 in production).
// Tokens are validated locally against the issuer's JWKS. The server never sees a password.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const REPORT_SCOPE = "read:reports";
const GITHUB_SCOPE = "read:github";
// Which scope each tool needs. A call without it gets HTTP 403 before the tool runs.
// Which permission each tool needs. Adding a protected tool starts here: the metadata, the 401 and the 403 all read this map.
const TOOL_SCOPES = { read_report: REPORT_SCOPE, github_profile: GITHUB_SCOPE, github_open_prs: GITHUB_SCOPE };
const ALL_SCOPES = [...new Set(Object.values(TOOL_SCOPES))];
const MAX_BODY_BYTES = 1024 * 1024;

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export function createMcpApp({ issuer, resource, port, publicBase, reports, exchange, github }) {
  // issuer must end with "/" to match Auth0's iss claim exactly.
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));
  const base = publicBase ?? `http://localhost:${port}`;
  const metadataUrl = `${base}/.well-known/oauth-protected-resource/mcp`;

  async function authenticate(req) {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return { error: "missing" };
    try {
      const { payload } = await jwtVerify(header.slice(7), jwks, {
        issuer,
        audience: resource,
        requiredClaims: ["exp", "sub"],
      });
      if (typeof payload.sub !== "string" || !payload.sub.trim()) return { error: "invalid_token" };
      // `scope` is what the client was granted. `permissions` (Auth0 RBAC) is what the user holds.
      // When both claims are present, a permission must be in both. Without `scope`, nothing is granted.
      const granted = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
      const held = Array.isArray(payload.permissions)
        ? payload.permissions.filter((p) => typeof p === "string")
        : null;
      const scopes = held ? granted.filter((s) => held.includes(s)) : granted;
      return {
        auth: {
          sub: payload.sub,
          scopes,
          audience: payload.aud,
          token: header.slice(7),
        },
      };
    } catch (err) {
      return { error: "invalid_token", detail: err.code ?? err.message };
    }
  }

  // Token exchanges (RFC 8693) for a subject token, cached until shortly before they expire.
  // "api": an access token whose audience is the reports API (on-behalf-of).
  // "github": the user's GitHub token from Token Vault (federated connection access token).
  const exchangeCache = new Map();

  async function cachedExchange(kind, subjectToken, params) {
    const key = `${kind}:${createHash("sha256").update(subjectToken).digest("hex")}`;
    const cached = exchangeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const res = await fetch(exchange.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...params,
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        client_id: exchange.clientId,
        client_secret: exchange.clientSecret,
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) {
      throw new Error(`token exchange failed: ${body.error_description ?? body.error ?? res.status}`);
    }
    const now = Date.now();
    for (const [k, entry] of exchangeCache) if (entry.expiresAt <= now) exchangeCache.delete(k);
    exchangeCache.set(key, { token: body.access_token, expiresAt: now + ((body.expires_in ?? 60) - 60) * 1000 });
    return body.access_token;
  }

  function exchangeToken(subjectToken) {
    return cachedExchange("api", subjectToken, {
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: exchange.audience,
    });
  }

  function exchangeForGithub(subjectToken) {
    return cachedExchange("github", subjectToken, {
      grant_type: "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token",
      requested_token_type: "http://auth0.com/oauth/token-type/federated-connection-access-token",
      connection: github.connection,
    });
  }

  function buildServer(auth) {
    const server = new McpServer({ name: "mcp-agent-identity-auth0", version: "0.1.0" });

    server.registerTool(
      "whoami",
      {
        description: "Return the authenticated subject and granted scopes.",
        inputSchema: {},
      },
      async () => ({
        content: [{ type: "text", text: JSON.stringify({ sub: auth.sub, scopes: auth.scopes }) }],
      }),
    );

    server.registerTool(
      "read_report",
      {
        description: `Return the weekly report. Requires the ${REPORT_SCOPE} scope.`,
        inputSchema: { week: z.string().regex(/^\d{4}-W\d{2}$/).describe("ISO week, e.g. 2026-W43") },
      },
      async ({ week }) => {
        const fail = (text) => ({ isError: true, content: [{ type: "text", text }] });
        if (!auth.scopes.includes(REPORT_SCOPE)) {
          return fail(`insufficient_scope: requires ${REPORT_SCOPE}`);
        }
        if (!reports || !exchange) {
          return fail("reports API or token exchange is not configured");
        }
        // The user's token is never forwarded as-is (the MCP spec forbids token passthrough).
        // It is exchanged for a token whose audience is the reports API.
        let apiToken;
        try {
          apiToken = await exchangeToken(auth.token);
        } catch (err) {
          return fail(err.message);
        }
        let res;
        try {
          res = await fetch(`${reports.url}/reports/${week}`, {
            headers: { authorization: `Bearer ${apiToken}` },
          });
        } catch {
          return fail("reports API is unreachable");
        }
        if (res.status === 404) return fail(`no report for ${week}`);
        if (res.status === 401 || res.status === 403) return fail(`reports API refused the token: ${res.status}`);
        if (!res.ok) return fail(`reports API returned ${res.status}`);
        const report = await res.json();
        return {
          content: [
            {
              type: "text",
              text: `Report for ${report.week}: build ${report.build}; tickets closed: ${report.tickets_closed.join(", ")}`,
            },
          ],
        };
      },
    );

    if (github) {
      server.registerTool(
        "github_profile",
        {
          description: `Return the GitHub login linked to this user through Token Vault. Requires the ${GITHUB_SCOPE} scope.`,
          inputSchema: {},
        },
        async () => {
          const fail = (text) => ({ isError: true, content: [{ type: "text", text }] });
          if (!auth.scopes.includes(GITHUB_SCOPE)) {
            return fail(`insufficient_scope: requires ${GITHUB_SCOPE}`);
          }
          if (!exchange) {
            return fail("token exchange is not configured");
          }
          // The GitHub token is used here and never returned to the client.
          let githubToken;
          try {
            githubToken = await exchangeForGithub(auth.token);
          } catch (err) {
            return fail(err.message);
          }
          let res;
          try {
            res = await fetch(`${github.apiUrl}/user`, {
              headers: { authorization: `Bearer ${githubToken}`, accept: "application/vnd.github+json" },
            });
          } catch {
            return fail("GitHub API is unreachable");
          }
          if (!res.ok) return fail(`GitHub API returned ${res.status}`);
          const user = await res.json();
          return { content: [{ type: "text", text: JSON.stringify({ github_login: user.login }) }] };
        },
      );

      server.registerTool(
        "github_open_prs",
        {
          description: `List the user's open pull requests on GitHub, newest first (public repositories, through Token Vault). Requires the ${GITHUB_SCOPE} scope.`,
          inputSchema: { limit: z.number().int().min(1).max(20).default(10).describe("How many to return, 1 to 20") },
        },
        async ({ limit }) => {
          const fail = (text) => ({ isError: true, content: [{ type: "text", text }] });
          if (!auth.scopes.includes(GITHUB_SCOPE)) {
            return fail(`insufficient_scope: requires ${GITHUB_SCOPE}`);
          }
          if (!exchange) {
            return fail("token exchange is not configured");
          }
          let githubToken;
          try {
            githubToken = await exchangeForGithub(auth.token);
          } catch (err) {
            return fail(err.message);
          }
          const query = encodeURIComponent("is:pr is:open author:@me sort:created-desc");
          let res;
          try {
            res = await fetch(`${github.apiUrl}/search/issues?q=${query}&per_page=${limit}`, {
              headers: { authorization: `Bearer ${githubToken}`, accept: "application/vnd.github+json" },
            });
          } catch {
            return fail("GitHub API is unreachable");
          }
          if (!res.ok) return fail(`GitHub API returned ${res.status}`);
          const found = await res.json();
          const prs = (found.items ?? []).map((item) => ({
            title: item.title,
            url: item.html_url,
            repo: String(item.repository_url ?? "").split("/repos/")[1] ?? null,
            created_at: item.created_at,
          }));
          return { content: [{ type: "text", text: JSON.stringify({ open_prs: prs }) }] };
        },
      );
    }

    return server;
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        throw httpError(413, -32600, "request body too large");
      }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      throw httpError(400, -32700, "parse error");
    }
  }

  const httpServer = createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      console.error("request failed:", err);
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    }
  });

  async function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url, base);
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resource,
          authorization_servers: [issuer],
          scopes_supported: ALL_SCOPES,
          bearer_methods_supported: ["header"],
        }),
      );
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    const result = await authenticate(req);
    if (result.error) {
      // The MCP authorization spec (Scope Selection Strategy) says the 401 SHOULD name the scopes to request.
      const scopes = `scope="${ALL_SCOPES.join(" ")}"`;
      const challenge =
        result.error === "missing"
          ? `Bearer resource_metadata="${metadataUrl}", ${scopes}`
          : `Bearer error="invalid_token", resource_metadata="${metadataUrl}", ${scopes}`;
      res.writeHead(401, { "www-authenticate": challenge, "content-type": "application/json" });
      res.end(JSON.stringify({ error: result.error, detail: result.detail }));
      return;
    }

    let body;
    try {
      body = req.method === "POST" ? await readBody(req) : undefined;
    } catch (err) {
      res.writeHead(err.status, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: err.code, message: err.message }, id: null }));
      return;
    }
    // The MCP spec says a token without the scope for the request gets HTTP 403, not only a tool error.
    const requestedTool = body?.method === "tools/call" ? body.params?.name : undefined;
    const requiredScope = TOOL_SCOPES[requestedTool];
    if (requiredScope && !result.auth.scopes.includes(requiredScope)) {
      res.writeHead(403, {
        "content-type": "application/json",
        "www-authenticate": `Bearer error="insufficient_scope", scope="${requiredScope}", resource_metadata="${metadataUrl}"`,
      });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: `insufficient_scope: requires ${requiredScope}` }, id: body.id ?? null }));
      return;
    }

    const server = buildServer(result.auth);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  return httpServer;
}

// Run directly: AUTH0_ISSUER, MCP_RESOURCE, PORT, and optionally MCP_URL and REPORTS_API_URL.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issuer = process.env.AUTH0_ISSUER;
  const resource = process.env.MCP_RESOURCE;
  const port = Number(process.env.PORT ?? 3000);
  const publicBase = new URL(process.env.MCP_URL ?? `http://localhost:${port}/mcp`).origin;
  if (!issuer || !resource) {
    console.error("Set AUTH0_ISSUER (e.g. https://YOUR-TENANT.us.auth0.com/) and MCP_RESOURCE (API identifier).");
    process.exit(1);
  }
  const reports = process.env.REPORTS_API_URL ? { url: process.env.REPORTS_API_URL } : undefined;
  const exchange =
    process.env.TOKEN_EXCHANGE_CLIENT_ID && process.env.TOKEN_EXCHANGE_CLIENT_SECRET && process.env.REPORTS_AUDIENCE
      ? {
          tokenUrl: new URL("oauth/token", issuer).href,
          clientId: process.env.TOKEN_EXCHANGE_CLIENT_ID,
          clientSecret: process.env.TOKEN_EXCHANGE_CLIENT_SECRET,
          audience: process.env.REPORTS_AUDIENCE,
        }
      : undefined;
  const github = exchange ? { connection: "github", apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com" } : undefined;
  createMcpApp({ issuer, resource, port, publicBase, reports, exchange, github }).listen(port, () => {
    console.log(`MCP server on http://localhost:${port}/mcp, issuer ${issuer}, resource ${resource}`);
  });
}
