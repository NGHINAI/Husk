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
import { EnginePool } from "./engine/pool.js";
import { locateLightpanda } from "./engine/binary.js";
import { WatchBus } from "./watch/sse.js";
import { HumanIOBus } from "./hitl/bus.js";

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
  case "login":
    await runLogin(args.slice(1));
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
  husk login --profile <p> --key <k>      Store a credential (username/password/totp)
                                          from stdin (3 lines: user, pass, totp?)
  husk login --list [--profile <p>]       List stored credentials (no passwords)
  husk login --remove --profile <p> --key <k>
                                          Delete a credential

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

  const lightpandaBin = await locateLightpanda();
  const pool = new EnginePool({
    minWarm: parseInt(process.env.HUSK_POOL_MIN_WARM ?? "4", 10),
    maxParallel: process.env.HUSK_POOL_MAX_PARALLEL
      ? parseInt(process.env.HUSK_POOL_MAX_PARALLEL, 10)
      : undefined, // defaults to computeMaxParallel()
    spawnOptions: { binary: lightpandaBin, readinessTimeoutMs: 15_000 },
  });
  await pool.ready();

  // Watch event bus: per-session in-memory pub/sub for the /watch/stream SSE route.
  const watchBus = new WatchBus();

  // Human-in-the-loop bus: coordinates ask_human / handoff primitives.
  const humanIO = new HumanIOBus();

  const sessions = new SessionManager(async (opts) => {
    const engineHandle = await pool.acquire();
    try {
      const session = await Session.create({
        log: (l) => process.stderr.write(l + "\n"),
        siteGraph,
        vault,
        profile: opts?.profile,
        engine: engineHandle,
        watchBus: opts?.watchBus,
        watchSessionId: opts?.watchSessionId,
      });
      if (defaultPolicy) session.setPolicy(defaultPolicy);
      return session;
    } catch (e) {
      // If Session.create fails, release the handle back to the pool.
      await engineHandle.release();
      throw e;
    }
  }, watchBus);

  const server = await createHuskServer({
    port: args.port,
    host: args.host,
    sessions,
    version: getVersion(),
    logLevel: args.logLevel,
    vault,
    credentials,
    watchBus,
    humanIO,
  });

  // Graceful shutdown on SIGINT / SIGTERM
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    server.log.info({ signal }, "husk: shutting down");
    await sessions.closeAll();
    await pool.close();
    siteGraph.close();
    vault.close();
    credentials.close();
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  // Parent-death watchdog. When the orchestrator is spawned as a child of
  // another process (e.g. the husk-mcp server), Claude Desktop sometimes
  // SIGKILLs the MCP without giving it a chance to clean up. In that case
  // signal handlers never run and we'd leak a long-lived orchestrator + a
  // lightpanda subprocess.
  //
  // Strategy: record the parent PID at startup; if it ever changes (the
  // process got reparented to init/launchd after the original parent died)
  // OR if the parent stops existing, shut down. Cost: one syscall/sec.
  const startupParent = process.ppid;
  if (startupParent && startupParent > 1) {
    const interval = setInterval(() => {
      const currentParent = process.ppid;
      if (currentParent === 1 || currentParent !== startupParent) {
        clearInterval(interval);
        server.log.info(
          { startupParent, currentParent },
          "husk: parent died, shutting down"
        );
        void shutdown("SIGTERM");
      }
    }, 1000);
    interval.unref();
  }
}

async function runLogin(rest: string[]): Promise<void> {
  const loginArgs = parseLoginArgs(rest);
  const credentialsDir = process.env.HUSK_CREDENTIALS_DIR ?? pathJoin(homedir(), ".husk", "credentials");
  const store = new CredentialsStore({
    credentialsDir,
    encryptionKey: process.env.HUSK_VAULT_KEY,
  });
  try {
    if (loginArgs.list) {
      const profile = loginArgs.profile ?? "default";
      const rows = store.list(profile);
      if (rows.length === 0) {
        console.log(`No credentials in profile "${profile}".`);
      } else {
        for (const row of rows) {
          console.log(`${row.key}\t${row.username}`);
        }
      }
      return;
    }
    if (loginArgs.remove) {
      if (!loginArgs.profile || !loginArgs.key) {
        console.error("Usage: husk login --remove --profile <p> --key <k>");
        process.exit(1);
      }
      store.remove(loginArgs.profile, loginArgs.key);
      console.log(`Removed ${loginArgs.key} from ${loginArgs.profile}.`);
      return;
    }
    if (!loginArgs.profile || !loginArgs.key) {
      console.error("Usage: husk login --profile <p> --key <k>");
      process.exit(1);
    }
    const lines = await readStdinLines(3);
    const [username, password, totp_secret_raw] = lines;
    const totp_secret = totp_secret_raw && totp_secret_raw.trim() ? totp_secret_raw.trim() : undefined;
    if (!username || !password) {
      console.error("husk login: username and password required");
      process.exit(1);
    }
    store.set(loginArgs.profile, { key: loginArgs.key, username, password, totp_secret });
    console.log(`Stored credential for ${loginArgs.key} in profile ${loginArgs.profile}.`);
  } finally {
    store.close();
  }
}

interface LoginCliArgs {
  profile?: string;
  key?: string;
  list?: boolean;
  remove?: boolean;
}

function parseLoginArgs(rest: string[]): LoginCliArgs {
  const out: LoginCliArgs = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--profile") out.profile = rest[++i];
    else if (a === "--key") out.key = rest[++i];
    else if (a === "--list") out.list = true;
    else if (a === "--remove") out.remove = true;
    else { console.error(`husk login: unknown arg ${a}`); process.exit(1); }
  }
  return out;
}

async function readStdinLines(maxLines: number): Promise<string[]> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c.toString()));
    process.stdin.on("end", () => {
      const all = chunks.join("");
      const lines = all.split(/\r?\n/);
      resolve(lines.slice(0, maxLines));
    });
  });
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
