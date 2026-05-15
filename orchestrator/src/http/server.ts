import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import pino, { type Logger } from "pino";
import { dispatch } from "./jsonrpc.js";
import { JSONRPC_ERROR_CODES } from "./errors.js";
import type { MethodContext } from "./methods.js";
import type { SessionManager } from "../session/manager.js";
import type { VaultStore } from "../vault/store.js";

export interface HuskServerOptions {
  port: number;
  host: string;
  sessions: SessionManager;
  /** Version surfaced via health responses. */
  version: string;
  vault: VaultStore;
  /** Pino log level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent". */
  logLevel?: string;
}

export interface HuskServer {
  /** Resolved bound port (useful when caller passed 0). */
  port: number;
  /** Underlying logger so the caller can emit its own structured logs. */
  log: Logger;
  /** Stop accepting new connections and close the listening socket. */
  stop(): Promise<void>;
}

/**
 * Start the Husk HTTP server. Resolves once the listening socket is
 * bound. v0 binds to 127.0.0.1 only; no TLS, no auth.
 */
export async function createHuskServer(opts: HuskServerOptions): Promise<HuskServer> {
  const log = pino({ level: opts.logLevel ?? "info", name: "husk-orchestrator" });
  const app = new Hono();

  const ctx: MethodContext = { sessions: opts.sessions, version: opts.version, vault: opts.vault };

  app.post("/v1/jsonrpc", async (c) => {
    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: JSONRPC_ERROR_CODES.PARSE_ERROR, message: "Invalid JSON in request body" },
        },
        200
      );
    }
    const response = await dispatch(parsed, ctx);
    log.debug({ method: (parsed as { method?: string })?.method, id: response.id }, "jsonrpc");
    return c.json(response, 200);
  });

  // Method-not-allowed for non-POST
  app.all("/v1/jsonrpc", (c) => c.text("Method Not Allowed", 405));

  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host }, (info) => {
      log.info({ port: info.port, host: opts.host }, "husk http server listening");
      resolve(s);
    });
  });

  const addr = (server as { address?: () => unknown }).address?.();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundPort = typeof addr === "object" && addr !== null ? (addr as any).port : opts.port;

  return {
    port: boundPort,
    log,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (server as any).close((err?: Error) => (err ? reject(err) : resolve()));
      }),
  };
}
