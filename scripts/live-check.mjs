// Live check against a real tenant: calls the running MCP server with an access token issued by Auth0.
// Usage: MCP_URL=http://localhost:3000/mcp TOKEN_FILE=/path/to/token node scripts/live-check.mjs

import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const token = readFileSync(process.env.TOKEN_FILE, "utf8").trim();

const client = new Client({ name: "live-check", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const who = await client.callTool({ name: "whoami", arguments: {} });
console.log("whoami:", who.content[0].text);

const report = await client.callTool({ name: "read_report", arguments: { week: "2026-W43" } });
console.log("read_report:", report.isError ? `ERROR ${report.content[0].text}` : report.content[0].text);

await client.close();
