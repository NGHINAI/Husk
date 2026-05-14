#!/usr/bin/env node
import { getVersion } from "./version.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

switch (cmd) {
  case "version":
  case "--version":
  case "-v":
    console.log(`husk v${getVersion()}`);
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(`husk v${getVersion()}

Usage:
  husk version          Print version
  husk help             Print this help

Coming in later milestones:
  husk start            Start the orchestrator (M3)
  husk run <example>    Run an example agent (M6)
  husk inspect <id>     Inspect a live session (M6)`);
    break;
  default:
    console.error(`Unknown command: ${cmd}. Try 'husk help'.`);
    process.exit(1);
}
