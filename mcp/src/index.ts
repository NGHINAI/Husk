#!/usr/bin/env node
import { spawn } from "node:child_process";
import { locateLightpanda } from "./binary.js";
import { runProxy } from "./proxy.js";

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

The Husk MCP server. Wraps lightpanda's stdio MCP behind Husk-branded
tools (husk_goto, husk_snapshot, husk_click, etc.) and adds the
husk_version native tool.

Usage:
  husk-mcp                Start the MCP server on stdio (default).
                          Use this in your Claude Desktop / Cursor config.
  husk-mcp serve          Same as above (explicit form).
  husk-mcp version        Print Husk MCP version.
  husk-mcp help           Print this help.

Configure in Claude Desktop's claude_desktop_config.json:
  {
    "mcpServers": {
      "husk": {
        "command": "node",
        "args": ["/absolute/path/to/husk/mcp/dist/index.js"]
      }
    }
  }

Or via npx after publish (M7):
  { "mcpServers": { "husk": { "command": "npx", "args": ["-y", "@husk/mcp"] } } }

Requires a prebuilt lightpanda binary discoverable via LIGHTPANDA_BIN
env var or "lightpanda" on PATH. See docs/mcp-setup.md.`);
    break;
  case "serve":
  default:
    await runServer();
    break;
}

async function runServer(): Promise<void> {
  let binary: string;
  try {
    binary = await locateLightpanda();
  } catch (err) {
    process.stderr.write(`[husk-mcp] ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Spawn lightpanda's mcp subcommand. The subprocess speaks JSON-RPC 2.0
  // newline-delimited on its stdin/stdout. We proxy between it and our
  // own stdin/stdout.
  const child = spawn(binary, ["mcp"], {
    stdio: ["pipe", "pipe", "inherit"], // stderr goes through to our stderr for debugging
  });

  // Best-effort upstream version string. For v0 we report the binary
  // basename + "(version unknown)" — we don't shell out to `lightpanda
  // --version` yet (v0.1 will). We deliberately avoid leaking the full
  // filesystem path through agent-visible responses.
  const lightpandaVersion = `${binary.split("/").pop() ?? "lightpanda"} (version unknown)`;

  child.on("exit", (code, signal) => {
    process.stderr.write(`[husk-mcp] lightpanda exited (code=${code} signal=${signal})\n`);
    process.exit(code ?? 1);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  await runProxy(process.stdin, process.stdout, child.stdin!, child.stdout!, {
    lightpandaVersion,
    log: (line) => process.stderr.write(line + "\n"),
  });

  // If the proxy returns (agent stdin EOF), shut down lightpanda cleanly.
  child.kill("SIGTERM");
}
