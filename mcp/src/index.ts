#!/usr/bin/env node
/**
 * Husk MCP bridge — Model Context Protocol server that exposes Husk's
 * JSON-RPC orchestrator as MCP tools.
 *
 * Milestone 1 placeholder. Real MCP server implementation lands in
 * Milestone 6 (after the JSON-RPC protocol is defined).
 */

const VERSION = "0.0.0";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

switch (cmd) {
  case "version":
  case "--version":
    console.log(`husk-mcp v${VERSION}`);
    break;
  case "help":
  case "--help":
  default:
    console.log(`husk-mcp v${VERSION}

The Husk MCP bridge will expose the Husk browser-engine orchestrator to
Model Context Protocol clients (Claude Desktop, Cursor, Continue,
Windsurf, etc.).

Full implementation lands in Milestone 6. Today this binary only prints
its version. To monitor progress, see:
docs/superpowers/plans/`);
    break;
}
