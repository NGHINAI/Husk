import type { SessionManager } from "../session/manager.js";
import type { Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { InvalidUrlError } from "./errors.js";
import type { VaultStore } from "../vault/store.js";
import type { CredentialsStore } from "../credentials/store.js";
import { batchVisit, type BatchVisitParams, type BatchVisitItem } from "./batch.js";
import type { WaitForCondition, WaitForResult } from "../session/wait.js";
import type { PaginateOpts } from "../session/paginate.js";

/** Per-request context the methods need. Wired in by the JSON-RPC dispatcher. */
export interface MethodContext {
  sessions: SessionManager;
  /** Husk version string (mirrored from package.json / orchestrator/src/version.ts). */
  version: string;
  vault: VaultStore;
  credentials: CredentialsStore;
  /**
   * The host the server is bound to (e.g. "127.0.0.1" or "0.0.0.0").
   * When "127.0.0.1", create_session returns a watch_url.
   */
  host?: string;
  /**
   * Mutable reference cell for the bound port. Updated after the server
   * socket resolves the ephemeral port (port 0 → actual port).
   */
  portRef?: { value: number };
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
  /** Present and non-null when the server is bound to 127.0.0.1 (loopback-only). */
  watch_url: string | null;
}

/** Result of `goto`. */
export interface GotoResult {
  ok: true;
  snapshot?: import("../snapshot/types.js").Snapshot;
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
    const watch_url =
      ctx.host === "127.0.0.1" && ctx.portRef != null
        ? `http://127.0.0.1:${ctx.portRef.value}/watch?s=${encodeURIComponent(session_id)}`
        : null;
    return { session_id, watch_url };
  },

  async goto(
    params: { session_id: string; url: string; include_snapshot?: boolean },
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
    return session.goto(params.url, { include_snapshot: params.include_snapshot });
  },

  async snapshot(
    params: { session_id: string; max_age_ms?: number; mode?: "full" | "terse" | "visible"; include_image?: boolean; full_page?: boolean },
    ctx: MethodContext
  ): Promise<Snapshot> {
    const session = ctx.sessions.get(params.session_id);
    return await session.snapshot({ maxAgeMs: params.max_age_ms, mode: params.mode, include_image: params.include_image, full_page: params.full_page });
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
    params: { session_id: string; stable_id?: string; intent?: string; include_snapshot?: boolean },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.click({ stable_id: params.stable_id, intent: params.intent, include_snapshot: params.include_snapshot });
  },

  async type(
    params: { session_id: string; stable_id?: string; intent?: string; text: string; include_snapshot?: boolean },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.type({ stable_id: params.stable_id, intent: params.intent, include_snapshot: params.include_snapshot }, params.text);
  },

  async scroll(
    params: {
      session_id: string;
      stable_id?: string | null;
      intent?: string;
      direction?: "up" | "down" | "left" | "right" | "into_view";
      amount?: number;
      include_snapshot?: boolean;
      until?: WaitForCondition;
      max_scrolls?: number;
      scroll_amount_px?: number;
    },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.scroll(
      { stable_id: params.stable_id, intent: params.intent, include_snapshot: params.include_snapshot },
      (params.direction ?? "down") as "up" | "down" | "left" | "right" | "into_view",
      params.amount ?? 800,
      { until: params.until, max_scrolls: params.max_scrolls, scroll_amount_px: params.scroll_amount_px, include_snapshot: params.include_snapshot },
    );
  },

  async press_key(
    params: { session_id: string; key: string; include_snapshot?: boolean },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.press_key(params.key, { include_snapshot: params.include_snapshot });
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
    params: { session_id: string; css?: string; selectors?: Record<string, string>; paginate?: PaginateOpts },
    ctx: MethodContext
  ): Promise<{ text?: string | null; result?: Record<string, string | null>; pages?: unknown[]; total_pages?: number; stopped_reason?: string }> {
    const session = ctx.sessions.get(params.session_id);
    if (params.selectors) {
      if (params.paginate) {
        const paginateResult = await session.extract({ selectors: params.selectors, paginate: params.paginate });
        return paginateResult as { pages: unknown[]; total_pages: number; stopped_reason: string };
      }
      const result = await session.extract({ selectors: params.selectors });
      return { result: result as Record<string, string | null> };
    }
    if (params.css) {
      if (params.paginate) {
        const paginateResult = await session.extract({ css: params.css, paginate: params.paginate });
        return paginateResult as { pages: unknown[]; total_pages: number; stopped_reason: string };
      }
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
      include_snapshot?: boolean;
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
        include_snapshot: params.include_snapshot,
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
        include_snapshot: params.include_snapshot,
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
      include_snapshot?: boolean;
    },
    ctx: MethodContext
  ) {
    const session = ctx.sessions.get(params.session_id);
    return session.upload(
      { stable_id: params.stable_id, intent: params.intent, include_snapshot: params.include_snapshot },
      { file_path: params.file_path, content_base64: params.content_base64, filename: params.filename }
    );
  },
} as const;

/** Type-level enumeration of all method names. */
export type MethodName = keyof typeof METHODS;
