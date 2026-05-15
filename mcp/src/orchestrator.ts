import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface OrchestratorOptions {
  /** Path to the built orchestrator JS entry (orchestrator/dist/index.js). */
  orchestratorScript: string;
  /** Path to the lightpanda binary. */
  lightpandaBin: string;
  /** Max ms to wait for the orchestrator to come up. */
  readyTimeoutMs?: number;
  /** Optional log sink for stderr; defaults to /dev/null. */
  log?: (line: string) => void;
}

export interface OrchestratorHandle {
  port: number;
  baseUrl: string;
  stop(): Promise<void>;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        s.close(() => resolve(port));
      } else {
        s.close();
        reject(new Error("Could not allocate free port"));
      }
    });
    s.on("error", reject);
  });
}

async function healthOk(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "health", params: {} }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: { ok?: boolean } };
    return !!body.result?.ok;
  } catch { return false; }
}

/**
 * Spawn `husk start` as a child process and wait for it to be ready.
 * Used by the MCP server to bring up the orchestrator on demand.
 */
export async function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    "node",
    [opts.orchestratorScript, "start", "--port", String(port), "--log-level", "silent"],
    {
      env: { ...process.env, LIGHTPANDA_BIN: opts.lightpandaBin },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stderr?.on("data", (chunk) => opts.log?.(chunk.toString()));

  const exitState = { info: null as { code: number | null; signal: NodeJS.Signals | null } | null };
  child.once("exit", (code, signal) => { exitState.info = { code, signal }; });

  const deadline = Date.now() + (opts.readyTimeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    if (exitState.info) {
      const { code, signal } = exitState.info;
      child.kill("SIGTERM");
      throw new Error(`Orchestrator exited early: code=${code} signal=${signal}`);
    }
    if (await healthOk(baseUrl)) {
      return {
        port,
        baseUrl,
        stop: () =>
          new Promise<void>((resolve) => {
            if (child.exitCode != null) return resolve();
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
          }),
      };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  child.kill("SIGTERM");
  throw new Error(`Orchestrator at ${baseUrl} did not become ready within ${opts.readyTimeoutMs ?? 15_000}ms`);
}
