#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { locateLightpanda } from "./binary.js";
import { startOrchestrator } from "./orchestrator.js";
import { HuskRpcClient } from "./client.js";
import { runMcpStdio } from "./proxy.js";

const VERSION = "0.0.0";

const args = process.argv.slice(2);
const cmd = args[0] ?? "serve";

switch (cmd) {
  case "version":
  case "--version":
    console.log(`husk-mcp v${VERSION}`);
    break;
  case "help":
  case "--help":
    console.log(`husk-mcp v${VERSION}

The Husk MCP server. Routes Husk-branded tools (husk_goto, husk_snapshot,
husk_click, etc.) through the Husk orchestrator so they're watchdog-protected.

Usage:
  husk-mcp                Start the MCP server on stdio (default).
  husk-mcp serve          Same as above.
  husk-mcp version        Print version.
  husk-mcp help           Print this help.

Configure in Claude Desktop's claude_desktop_config.json:
  {
    "mcpServers": {
      "husk": {
        "command": "node",
        "args": ["/absolute/path/to/husk/mcp/dist/index.js"]
      }
    }
  }`);
    break;
  case "serve":
  default: {
    void main();
  }
}

async function main(): Promise<void> {
  const lightpandaBin = await locateLightpanda();
  const orchestratorScript =
    process.env.HUSK_ORCHESTRATOR ||
    resolveSiblingOrchestrator();

  const orch = await startOrchestrator({
    orchestratorScript,
    lightpandaBin,
    readyTimeoutMs: 30_000,
    log: (line) => process.stderr.write(line),
  });

  const client = new HuskRpcClient({ baseUrl: orch.baseUrl });

  const shutdown = async () => {
    try { await orch.stop(); } finally { process.exit(0); }
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await runMcpStdio(client);
  await orch.stop();
}

function resolveSiblingOrchestrator(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "orchestrator", "dist", "index.js");
}
