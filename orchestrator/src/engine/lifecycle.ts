import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface LightpandaSpawnOptions {
  /** Absolute path to the lightpanda binary. */
  binary: string;
  /** Extra args passed to the binary instead of the default `serve` flags. Optional override. */
  args?: string[];
  /** Host the binary binds to. Defaults to 127.0.0.1. */
  host?: string;
  /**
   * Port to bind. If omitted, an OS-allocated ephemeral port is used.
   * Note: the binary itself reopens the port, so there is a tiny race
   * window between port discovery and binary startup. Acceptable for
   * dev; v0.3 cloud milestone will use a port broker.
   */
  port?: number;
  /** Maximum wall-clock time to wait for /json/list to respond. Defaults to 10s. */
  readinessTimeoutMs?: number;
  /** Optional stderr/stdout logger. Defaults to no-op. */
  log?: (line: string) => void;
}

export interface LightpandaProcess {
  /** The bound port, useful for the CDP client. */
  port: number;
  /** The base URL of the CDP HTTP endpoint. */
  cdpBaseUrl: string;
  /** The underlying child process (escape hatch for advanced use). */
  child: ChildProcess;
  /** Terminate the subprocess. SIGTERM, then SIGKILL after 5s. */
  close(): Promise<void>;
}

/**
 * Spawn lightpanda as a subprocess in CDP-server mode and wait for it to
 * start serving /json/list.
 *
 * Returns once the readiness probe succeeds, or rejects if the binary
 * exits early / times out / fails to bind.
 */
export async function spawnLightpanda(opts: LightpandaSpawnOptions): Promise<LightpandaProcess> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? (await pickEphemeralPort());
  const readinessTimeoutMs = opts.readinessTimeoutMs ?? 10_000;
  const log = opts.log ?? (() => {});

  const args = opts.args ?? ["serve", "--host", host, "--port", String(port)];

  const child = spawn(opts.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  let exited = false;
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  let spawnError: Error | null = null;
  child.on("error", (err) => {
    exited = true;
    spawnError = err;
    exitInfo = { code: null, signal: null };
  });
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });
  child.stdout?.on("data", (chunk: Buffer) => log(`[lightpanda stdout] ${chunk.toString().trimEnd()}`));
  child.stderr?.on("data", (chunk: Buffer) => log(`[lightpanda stderr] ${chunk.toString().trimEnd()}`));

  const cdpBaseUrl = `http://${host}:${port}`;
  await waitForReadiness(cdpBaseUrl, readinessTimeoutMs, () => exited, () => exitInfo, () => spawnError, child);

  return {
    port,
    cdpBaseUrl,
    child,
    close: () => terminateChild(child),
  };
}

async function pickEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("Failed to pick ephemeral port"));
      }
    });
  });
}

async function waitForReadiness(
  cdpBaseUrl: string,
  timeoutMs: number,
  exited: () => boolean,
  exitInfo: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  spawnError: () => Error | null,
  child: ChildProcess
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (exited()) {
      const err = spawnError();
      if (err) {
        throw new Error(`lightpanda exited before becoming ready: ${err.message}`);
      }
      const info = exitInfo();
      throw new Error(
        `lightpanda exited before becoming ready (code=${info?.code ?? "?"} signal=${info?.signal ?? "?"})`
      );
    }
    try {
      const res = await fetch(`${cdpBaseUrl}/json/list`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return;
    } catch {
      // Not ready yet — try again
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`lightpanda readiness timeout after ${timeoutMs}ms`);
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGTERM");
  const killHard = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 5_000);
  await exited;
  clearTimeout(killHard);
}
