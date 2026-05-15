#!/usr/bin/env node
import { getVersion } from "./version.js";
import { Session } from "./session/session.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

switch (cmd) {
  case "version":
  case "--version":
  case "-v":
    console.log(`husk v${getVersion()}`);
    break;
  case "demo": {
    const url = args[1];
    if (!url) {
      console.error("Usage: husk demo <url>");
      process.exit(1);
    }
    await runDemo(url);
    break;
  }
  case "help":
  case "--help":
  case "-h":
    console.log(`husk v${getVersion()}

Usage:
  husk version            Print version
  husk help               Print this help
  husk demo <url>         Drive lightpanda against URL and print the spec-§5.2 snapshot

Coming in later milestones:
  husk start              Start the orchestrator (M3)
  husk run <example>      Run an example agent (M6)
  husk inspect <id>       Inspect a live session (M6)`);
    break;
  default:
    console.error(`Unknown command: ${cmd}. Try 'husk help'.`);
    process.exit(1);
}

async function runDemo(url: string): Promise<void> {
  let session: Session | undefined;
  try {
    session = await Session.create({ log: (l) => console.error(l) });
    await session.goto(url);
    const snap = await session.snapshot();
    console.log(JSON.stringify(snap, null, 2));
  } catch (err) {
    console.error("[husk demo] FAILED:", (err as Error).message);
    process.exitCode = 1;
  } finally {
    await session?.close();
  }
}
