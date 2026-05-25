import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve, type ServerType } from "@hono/node-server";
import pino, { type Logger } from "pino";
import { dispatch } from "./jsonrpc.js";
import { JSONRPC_ERROR_CODES } from "./errors.js";
import type { MethodContext } from "./methods.js";
import type { SessionManager } from "../session/manager.js";
import type { VaultStore } from "../vault/store.js";
import type { CredentialsStore } from "../credentials/store.js";
import type { WatchBus } from "../watch/sse.js";
import type { HumanIOBus } from "../hitl/bus.js";
import type { ChromePool } from "../engine/chrome-pool.js";
import { CognitionBus } from "../cognition/cognition-bus.js";
import { WATCH_HTML } from "../watch/index.html.js";
import { registerHitlRoutes } from "./hitl-routes.js";
import { handleCognitionSse } from "../stream/sse-cognition.js";

export interface HuskServerOptions {
  port: number;
  host: string;
  sessions: SessionManager;
  /** Version surfaced via health responses. */
  version: string;
  vault: VaultStore;
  credentials: CredentialsStore;
  /** Pino log level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent". */
  logLevel?: string;
  /** Watch event bus for the /watch/stream SSE route. Only registered when host === "127.0.0.1". */
  watchBus?: WatchBus;
  /** Human-in-the-loop bus for ask_human / handoff answer routes. Only registered when host === "127.0.0.1". */
  humanIO?: HumanIOBus;
  /** M17 T6: Chrome pool — passed to method context so goto can run page-health fallback. */
  chromePool?: ChromePool;
  /** M22 T7: Cognition event bus — enables the /stream/cognition SSE endpoint. Only registered when host === "127.0.0.1". */
  cognitionBus?: CognitionBus;
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

  // We resolve boundPort after the server starts; for create_session watch_url
  // we capture a reference cell updated once the port is known.
  const portRef = { value: opts.port };
  // Shared seamless trigger map — written by the handoff method, read by the
  // /handoff/:token/seamless-done HTTP route. Both get the same Map instance.
  const seamlessTriggers = new Map<string, () => void>();

  // M22 T8: singleton CognitionBus — use the one passed in, or create a fresh
  // one so subscribe/unsubscribe always have a bus available.
  const cognitionBus: CognitionBus = opts.cognitionBus ?? new CognitionBus();

  const ctx: MethodContext = {
    sessions: opts.sessions,
    version: opts.version,
    vault: opts.vault,
    credentials: opts.credentials,
    host: opts.host,
    portRef,
    humanIO: opts.humanIO,
    watchBus: opts.watchBus,
    seamlessTriggers,
    chromePool: opts.chromePool,
    cognitionBus,
  };

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

  // /watch and /watch/stream/:session_id — HTML viewer + SSE stream.
  // Only registered when the server is bound to 127.0.0.1 (loopback-only guard).
  if (opts.host === "127.0.0.1" && opts.watchBus) {
    app.get("/watch", (c) => c.html(WATCH_HTML));
    const watchBus = opts.watchBus;
    app.get("/watch/stream/:session_id", (c) => {
      const session_id = c.req.param("session_id");
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ data: "", event: "connected" });
        await new Promise<void>((resolve) => {
          let done = false;
          let off: (() => void) | null = null;
          const cleanup = () => {
            if (done) return;
            done = true;
            off?.();
            resolve();
          };
          off = watchBus.subscribe(session_id, (e) => {
            stream.writeSSE({ event: e.kind, data: JSON.stringify(e) }).catch(cleanup);
          });
          // Clean up when the client disconnects.
          c.req.raw.signal.addEventListener("abort", cleanup);
        });
      });
    });
  }

  // HITL answer routes — only registered when loopback + both buses are present.
  if (opts.host === "127.0.0.1" && opts.humanIO) {
    registerHitlRoutes(app, {
      humanIO: opts.humanIO,
      watchBus: opts.watchBus,
      host: opts.host,
      portRef,
      seamlessTriggers,
    });
  }

  // M22 T7+T8: /stream/cognition SSE endpoint — registered when loopback.
  // cognitionBus is always non-null here (created above if not supplied via opts).
  if (opts.host === "127.0.0.1") {
    app.get("/stream/cognition", (c) => handleCognitionSse(cognitionBus, c));
  }

  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host }, (info) => {
      log.info({ port: info.port, host: opts.host }, "husk http server listening");
      resolve(s);
    });
  });

  const addr = (server as { address?: () => unknown }).address?.();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundPort = typeof addr === "object" && addr !== null ? (addr as any).port : opts.port;
  // Update portRef so create_session can embed the correct port in watch_url.
  portRef.value = boundPort;

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
