import type { SessionManager } from "../session/manager.js";
import type { Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { InvalidUrlError } from "./errors.js";
import type { VaultStore } from "../vault/store.js";
import type { CredentialsStore } from "../credentials/store.js";
import { batchVisit, type BatchVisitParams, type BatchVisitItem } from "./batch.js";
import type { WaitForCondition, WaitForResult } from "../session/wait.js";

/** Per-request context the methods need. Wired in by the JSON-RPC dispatcher. */
export interface MethodContext {
  sessions: SessionManager;
  /** Husk version string (mirrored from package.json / orchestrator/src/version.ts). */
  version: string;
  vault: VaultStore;
  credentials: CredentialsStore;
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

  async create_session(
    params: { profile?: string } | undefined,
    ctx: MethodContext
  ): Promise<CreateSessionResult> {
    const session_id = await ctx.sessions.create({ profile: params?.profile });
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
    params: { session_id: string; max_age_ms?: number; mode?: "full" | "terse" },
    ctx: MethodContext
  ): Promise<Snapshot> {
    const session = ctx.sessions.get(params.session_id);
    return await session.snapshot({ maxAgeMs: params.max_age_ms, mode: params.mode });
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
    params: { session_id: string; stable_id?: string; intent?: string },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.click({ stable_id: params.stable_id, intent: params.intent });
  },

  async type(
    params: { session_id: string; stable_id?: string; intent?: string; text: string },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.type({ stable_id: params.stable_id, intent: params.intent }, params.text);
  },

  async scroll(
    params: { session_id: string; stable_id?: string | null; intent?: string; direction: "up" | "down" | "left" | "right" | "into_view"; amount: number },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.scroll({ stable_id: params.stable_id, intent: params.intent }, params.direction, params.amount);
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

  async vault_list_profiles(_params: unknown, ctx: MethodContext) {
    return { profiles: ctx.vault.listProfiles() };
  },

  async vault_list_cookies(params: { profile: string }, ctx: MethodContext) {
    return { cookies: ctx.vault.list(params.profile) };
  },

  async vault_clear(params: { profile: string }, ctx: MethodContext) {
    ctx.vault.clear(params.profile);
    return { ok: true };
  },

  async vault_remove_cookie(
    params: { profile: string; name: string; domain: string; path: string },
    ctx: MethodContext
  ) {
    ctx.vault.remove(params.profile, { name: params.name, domain: params.domain, path: params.path });
    return { ok: true };
  },

  async credentials_set(
    params: { profile: string; key: string; username: string; password: string; totp_secret?: string },
    ctx: MethodContext
  ) {
    ctx.credentials.set(params.profile, {
      key: params.key,
      username: params.username,
      password: params.password,
      totp_secret: params.totp_secret,
    });
    return { ok: true };
  },

  async credentials_remove(params: { profile: string; key: string }, ctx: MethodContext) {
    ctx.credentials.remove(params.profile, params.key);
    return { ok: true };
  },

  async credentials_list(params: { profile: string }, ctx: MethodContext) {
    return { credentials: ctx.credentials.list(params.profile) };
  },

  async credentials_list_profiles(_params: unknown, ctx: MethodContext) {
    return { profiles: ctx.credentials.listProfiles() };
  },

  async extract(
    params: { session_id: string; css?: string; selectors?: Record<string, string> },
    ctx: MethodContext
  ): Promise<{ text?: string | null; result?: Record<string, string | null> }> {
    const session = ctx.sessions.get(params.session_id);
    if (params.selectors) {
      const result = await session.extract({ selectors: params.selectors });
      return { result: result as Record<string, string | null> };
    }
    if (params.css) {
      const text = await session.extract({ css: params.css });
      return { text: text as string | null };
    }
    throw new Error("extract requires either 'css' or 'selectors'");
  },

  async login(
    params: {
      session_id: string;
      // Mode A — look up stored credential
      profile?: string;
      key?: string;
      // Mode B — inline (ephemeral; not persisted)
      username?: string;
      password?: string;
      totp_secret?: string;
    },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);

    // Mode B: inline credentials supplied → use them directly, never touch the store.
    if (params.username !== undefined && params.password !== undefined) {
      return await session.login({
        username: params.username,
        password: params.password,
        totp_secret: params.totp_secret,
      });
    }

    // Mode A: profile+key lookup from the credentials store.
    if (params.profile && params.key) {
      const cred = ctx.credentials.get(params.profile, params.key);
      if (!cred) {
        return { ok: false, reason: "credential_not_found", key: params.key };
      }
      return await session.login({
        username: cred.username,
        password: cred.password,
        totp_secret: cred.totp_secret,
      });
    }

    // Neither mode supplied — caller error.
    return {
      ok: false,
      reason: "invalid_login_params",
      message: "login requires either {profile, key} or {username, password}",
    };
  },

  async batch_visit(
    params: BatchVisitParams,
    ctx: MethodContext
  ): Promise<{ results: BatchVisitItem[] }> {
    const results = await batchVisit(ctx, params);
    return { results };
  },

  async wait_for(
    params: { session_id: string } & WaitForCondition,
    ctx: MethodContext
  ): Promise<WaitForResult> {
    const session = ctx.sessions.get(params.session_id);
    const { session_id: _sid, ...cond } = params;
    return session.waitFor(cond);
  },

  async upload(
    params: {
      session_id: string;
      stable_id?: string;
      intent?: string;
      file_path?: string;
      content_base64?: string;
      filename?: string;
    },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return session.upload(
      { stable_id: params.stable_id, intent: params.intent },
      { file_path: params.file_path, content_base64: params.content_base64, filename: params.filename }
    );
  },
} as const;

/** Type-level enumeration of all method names. */
export type MethodName = keyof typeof METHODS;
