// MCP server protected by an OAuth 2.0 authorization server (Auth0 in production).
// Tokens are validated locally against the issuer's JWKS. The server never sees a password.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const REPORT_SCOPE = "read:reports";
const MAX_BODY_BYTES = 1024 * 1024;

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export function createMcpApp({ issuer, resource, port, publicBase }) {
  // issuer must end with "/" to match Auth0's iss claim exactly.
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));
  const base = publicBase ?? `http://localhost:${port}`;
  const metadataUrl = `${base}/.well-known/oauth-protected-resource`;

  async function authenticate(req) {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return { error: "missing" };
    try {
      const { payload } = await jwtVerify(header.slice(7), jwks, {
        issuer,
        audience: resource,
      });
      return {
        auth: {
          sub: payload.sub,
          scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
          audience: payload.aud,
        },
      };
    } catch (err) {
      return { error: "invalid_token", detail: err.code ?? err.message };
    }
  }

  function buildServer(auth) {
    const server = new McpServer({ name: "auth0-mcp-demo", version: "0.1.0" });

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
        inputSchema: { week: z.string().describe("ISO week, e.g. 2026-W43") },
      },
      async ({ week }) => {
        if (!auth.scopes.includes(REPORT_SCOPE)) {
          return {
            isError: true,
            content: [{ type: "text", text: `insufficient_scope: requires ${REPORT_SCOPE}` }],
          };
        }
        return {
          content: [{ type: "text", text: `Report for ${week}: build passed, two tickets closed.` }],
        };
      },
    );

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
          scopes_supported: [REPORT_SCOPE],
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
      const challenge =
        result.error === "missing"
          ? `Bearer resource_metadata="${metadataUrl}"`
          : `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`;
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

// Run directly: AUTH0_ISSUER, MCP_RESOURCE and PORT come from the environment.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issuer = process.env.AUTH0_ISSUER;
  const resource = process.env.MCP_RESOURCE;
  const port = Number(process.env.PORT ?? 3000);
  if (!issuer || !resource) {
    console.error("Set AUTH0_ISSUER (e.g. https://YOUR-TENANT.us.auth0.com/) and MCP_RESOURCE (API identifier).");
    process.exit(1);
  }
  createMcpApp({ issuer, resource, port }).listen(port, () => {
    console.log(`MCP server on http://localhost:${port}/mcp, issuer ${issuer}, resource ${resource}`);
  });
}
