// Live check against a real tenant using a saved Auth0 access token.
// Run: npm run check, or npm run check -- --github to require the Token Vault tools.

import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const token = readFileSync(process.env.TOKEN_FILE, "utf8").trim();
const checkGithub = process.argv.includes("--github");
const client = new Client({ name: "live-check", version: "0.1.0" });

async function checkTool(name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    const message = result.content[0]?.text;
    if (result.isError || !message) {
      console.error(`${name}: ERROR ${message ?? "empty tool response"}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${name}: ${message}`);
  } catch (err) {
    console.error(`${name}: ERROR ${err.message}`);
    process.exitCode = 1;
  }
}

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  const { tools } = await client.listTools();
  console.log("tools:", tools.map((tool) => tool.name).join(", "));
  await checkTool("whoami", {});
  await checkTool("read_report", { week: "2026-W43" });
  if (checkGithub) {
    await checkTool("github_profile", {});
    await checkTool("github_open_prs", { limit: 5 });
  }
} catch (err) {
  console.error(`MCP connection or discovery failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
