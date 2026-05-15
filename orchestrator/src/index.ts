#!/usr/bin/env node
import { getVersion } from "./version.js";
import { Session } from "./session/session.js";
import { SessionManager } from "./session/manager.js";
import { createHuskServer } from "./http/server.js";
import { VaultStore } from "./vault/store.js";
import { CredentialsStore } from "./credentials/store.js";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
import { readFile } from "node:fs/promises";
import { SiteGraphCache } from "./cache/site-graph.js";
import type { PolicyDocument } from "./watchdog/types.js";

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
  case "start":
    await runServer(parseStartArgs(args.slice(1)));
    break;
  case "vault":
    await runVault(args.slice(1));
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(`husk v${getVersion()}

Usage:
  husk version                            Print version
  husk help                               Print this help
  husk demo <url>                         One-shot: drive lightpanda against URL,
                                          print the spec-§5.2 snapshot, exit
  husk start [--port N] [--host H] [--log-level L]
                                          Start the HTTP/JSON-RPC server on the
                                          given port (default 7777) and host
                                          (default 127.0.0.1). Runs until killed.
  husk vault list                         List saved cookie profiles
  husk vault clear <profile>              Clear all cookies in a profile

Coming in later milestones:
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

interface StartArgs {
  port: number;
  host: string;
  logLevel: string;
  policy?: string; // path to policy.yaml
}

function parseStartArgs(rest: string[]): StartArgs {
  const out: StartArgs = { port: 7777, host: "127.0.0.1", logLevel: "info" };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--port" && rest[i + 1]) {
      out.port = Number(rest[++i]);
      if (!Number.isFinite(out.port) || out.port < 0) {
        console.error("husk start: --port must be a non-negative integer");
        process.exit(1);
      }
    } else if (a === "--host" && rest[i + 1]) {
      out.host = rest[++i];
    } else if (a === "--log-level" && rest[i + 1]) {
      out.logLevel = rest[++i];
    } else if (a === "--policy" && rest[i + 1]) {
      out.policy = rest[++i];
    } else {
      console.error(`husk start: unknown arg ${a}`);
      process.exit(1);
    }
  }
  return out;
}

async function runServer(args: StartArgs): Promise<void> {
  // The SessionManager's factory calls Session.create(), which itself locates
  // the lightpanda binary. If the binary is missing the first create_session
  // call will reject with a structured BinaryNotFoundError; the server stays
  // up so callers see the error rather than a connection refusal.
  const cacheDir = process.env.HUSK_CACHE_DIR ?? pathJoin(homedir(), ".husk", "site-graph");
  const siteGraph = new SiteGraphCache({ cacheDir });

  const vaultDir = process.env.HUSK_VAULT_DIR ?? pathJoin(homedir(), ".husk", "vault");
  const vault = new VaultStore({
    vaultDir,
    encryptionKey: process.env.HUSK_VAULT_KEY,
  });

  const credentialsDir = process.env.HUSK_CREDENTIALS_DIR ?? pathJoin(homedir(), ".husk", "credentials");
  const credentials = new CredentialsStore({
    credentialsDir,
    encryptionKey: process.env.HUSK_VAULT_KEY,
  });

  // Load policy YAML once at startup if --policy was passed.
  let defaultPolicy: PolicyDocument | null = null;
  if (args.policy) {
    const { parsePolicy } = await import("./watchdog/policy.js");
    const yaml = await readFile(args.policy, "utf8");
    defaultPolicy = parsePolicy(yaml);
  }

  const sessions = new SessionManager(async (opts) => {
    const session = await Session.create({
      log: (l) => process.stderr.write(l + "\n"),
      siteGraph,
      vault,
      profile: opts?.profile,
    });
    if (defaultPolicy) session.setPolicy(defaultPolicy);
    return session;
  });

  const server = await createHuskServer({
    port: args.port,
    host: args.host,
    sessions,
    version: getVersion(),
    logLevel: args.logLevel,
    vault,
    credentials,
  });

  // Graceful shutdown on SIGINT / SIGTERM
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    server.log.info({ signal }, "husk: shutting down");
    await sessions.closeAll();
    siteGraph.close();
    vault.close();
    credentials.close();
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

async function runVault(rest: string[]): Promise<void> {
  const sub = rest[0];
  const vaultDir = process.env.HUSK_VAULT_DIR ?? pathJoin(homedir(), ".husk", "vault");
  const vault = new VaultStore({
    vaultDir,
    encryptionKey: process.env.HUSK_VAULT_KEY,
  });
  try {
    if (sub === "list") {
      const profiles = vault.listProfiles();
      if (profiles.length === 0) {
        console.log("No profiles.");
      } else {
        for (const p of profiles) {
          const n = vault.list(p).length;
          console.log(`${p}\t${n} cookie${n === 1 ? "" : "s"}`);
        }
      }
    } else if (sub === "clear") {
      const profile = rest[1];
      if (!profile) {
        console.error("Usage: husk vault clear <profile>");
        process.exit(1);
      }
      vault.clear(profile);
      console.log(`Cleared ${profile}.`);
    } else {
      console.error("Usage: husk vault list | husk vault clear <profile>");
      process.exit(1);
    }
  } finally {
    vault.close();
  }
}
