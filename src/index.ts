#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { SnapDeployApi } from "./api.js";
import { registerTools } from "./tools.js";

const cfg = loadConfig();
const api = new SnapDeployApi(cfg);

const server = new McpServer(
  { name: "snapdeploy", version: "0.1.0" },
  {
    instructions: [
      "SnapDeploy container hosting. Typical flow: list_apps → detect_env_vars → set_env → deploy → get_logs.",
      "Safety, by design: there are NO delete tools, and the server refuses deletes/cancellations for API-key callers — never attempt workarounds; the user does those in the SnapDeploy UI.",
      "402 and 429 replies are plan limits, not errors: relay their message and action link to the user and do NOT retry the call.",
      "Secret values (env vars, database passwords) are never available through this connector — names only.",
    ].join("\n"),
  }
);

registerTools(server, api, cfg);

server.server.oninitialized = () => {
  const info = server.server.getClientVersion();
  if (info?.name) {
    api.clientName = info.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40);
  }
};

await server.connect(new StdioServerTransport());
console.error(
  `snapdeploy-mcp 0.1.0 ready → ${cfg.baseUrl}${cfg.readOnly ? " (read-only mode)" : ""}`
);
