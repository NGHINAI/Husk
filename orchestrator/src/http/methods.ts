import type { SessionManager } from "../session/manager.js";
import type { Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { InvalidUrlError } from "./errors.js";

/** Per-request context the methods need. Wired in by the JSON-RPC dispatcher. */
export interface MethodContext {
  sessions: SessionManager;
  /** Husk version string (mirrored from package.json / orchestrator/src/version.ts). */
  version: string;
}

/** Result of `health` — confirms the server is up and reports session count. */
export interface HealthResult {
  ok: true;
  version: string;
  activeSessions: number;
}

/** Result of `create_session`. */
export interface CreateSessionResult {
  session_id: string;
}

/** Result of `goto`. */
export interface GotoResult {
  ok: true;
}

/** Result of `close_session`. Also returned when the id was unknown (idempotent). */
export interface CloseSessionResult {
  ok: true;
}

/**
 * All v0 JSON-RPC method handlers. Add new methods here as flat
 * exports; the dispatcher in jsonrpc.ts routes by name via this map.
 */
export const METHODS = {
  async health(_params: unknown, ctx: MethodContext): Promise<HealthResult> {
    return { ok: true, version: ctx.version, activeSessions: ctx.sessions.activeCount() };
  },

  async create_session(_params: unknown, ctx: MethodContext): Promise<CreateSessionResult> {
    const session_id = await ctx.sessions.create();
    return { session_id };
  },

  async goto(
    params: { session_id: string; url: string },
    ctx: MethodContext
  ): Promise<GotoResult> {
    if (typeof params.url !== "string") throw new InvalidUrlError(String(params.url));
    try {
      // eslint-disable-next-line no-new
      new URL(params.url);
    } catch {
      throw new InvalidUrlError(params.url);
    }
    const session = ctx.sessions.get(params.session_id);
    await session.goto(params.url);
    return { ok: true };
  },

  async snapshot(
    params: { session_id: string },
    ctx: MethodContext
  ): Promise<Snapshot> {
    const session = ctx.sessions.get(params.session_id);
    return session.snapshot();
  },

  async snapshot_diff(
    params: { session_id: string },
    ctx: MethodContext
  ): Promise<SnapshotDiff | null> {
    const session = ctx.sessions.get(params.session_id);
    return session.snapshotDiff();
  },

  async close_session(
    params: { session_id: string },
    ctx: MethodContext
  ): Promise<CloseSessionResult> {
    await ctx.sessions.close(params.session_id);
    return { ok: true };
  },

  async click(
    params: { session_id: string; stable_id: string },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.click(params.stable_id);
  },

  async type(
    params: { session_id: string; stable_id: string; text: string },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.type(params.stable_id, params.text);
  },

  async scroll(
    params: { session_id: string; stable_id: string | null; direction: "up" | "down" | "left" | "right" | "into_view"; amount: number },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.scroll(params.stable_id, params.direction, params.amount);
  },

  async press_key(
    params: { session_id: string; key: string },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.press_key(params.key);
  },

  async set_policy(
    params: { session_id: string; policy_yaml: string | null },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    if (params.policy_yaml === null) {
      session.setPolicy(null);
      return { ok: true };
    }
    const { parsePolicy } = await import("../watchdog/policy.js");
    const parsed = parsePolicy(params.policy_yaml);
    session.setPolicy(parsed);
    return { ok: true };
  },
} as const;

/** Type-level enumeration of all method names. */
export type MethodName = keyof typeof METHODS;
