import { randomUUID } from "node:crypto";
import type { SessionManager } from "../session/manager.js";
import type { Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { InvalidUrlError } from "./errors.js";
import type { VaultStore } from "../vault/store.js";
import type { CredentialsStore } from "../credentials/store.js";
import { batchVisit, type BatchVisitParams, type BatchVisitItem } from "./batch.js";
import type { WaitForCondition, WaitForResult } from "../session/wait.js";
import type { PaginateOpts } from "../session/paginate.js";
import type { HumanIOBus } from "../hitl/bus.js";
import type { WatchBus } from "../watch/sse.js";
import type { ChromePool } from "../engine/chrome-pool.js";
import type { CapabilityRequirement } from "../engine/capability-types.js";
import { pickEngine } from "../engine/capability-router.js";
import { ALL_ENGINES } from "../engine/engine-capabilities.js";
import type { CognitionBus } from "../cognition/cognition-bus.js";
import type { EventType } from "../cognition/events.js";

/** All valid cognition event types (kept in sync with EventType union). */
const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "state_change",
  "network_idle",
  "error_appeared",
  "captcha_detected",
  "user_intervention_required",
]);

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
  /** Human-in-the-loop bus for ask_human / handoff primitives. */
  humanIO?: HumanIOBus;
  /** Watch event bus — needed so ask_human can emit pending_question events. */
  watchBus?: WatchBus;
  /**
   * Manual-done triggers for in-flight seamless handoffs, keyed by token.
   * Shared between methods.ts (writer) and hitl-routes.ts (caller).
   */
  seamlessTriggers?: Map<string, () => void>;
  /**
   * M17 T6: Chrome pool — exposed to goto so it can pass to fallbackToChrome.
   * Absent when Chrome is not available on this machine.
   */
  chromePool?: ChromePool;
  /**
   * M22 T8: Cognition event bus — needed for subscribe / unsubscribe methods.
   * The same singleton instance must be shared with the SSE route (T7) and
   * session emitters (T3–T6).
   */
  cognitionBus?: CognitionBus;
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
export type GotoResult =
  | { ok: true; snapshot?: import("../snapshot/types.js").Snapshot }
  | { ok: false; reason: "session_paused"; token: string; handoff_url: string | null };

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
    params: { profile?: string; parent_session_id?: string; engine?: "lightpanda" | "chrome" | "auto"; capability?: CapabilityRequirement } | undefined,
    ctx: MethodContext
  ): Promise<CreateSessionResult | { ok: false; reason: "engine_unsupported"; detail: string }> {
    // Phase D M21: when capability is supplied, pre-resolve it to a concrete engine kind.
    // If no engine satisfies the requirement, return engine_unsupported.
    let resolvedEngine: "lightpanda" | "chrome" | "auto" | undefined = params?.engine ?? "auto";
    if (params?.capability) {
      const engineName = pickEngine(ALL_ENGINES, params.capability);
      if (!engineName) {
        return {
          ok: false,
          reason: "engine_unsupported",
          detail: "no available engine satisfies the requested capability requirement",
        };
      }
      resolvedEngine = engineName as "lightpanda" | "chrome";
    }

    const session_id = await ctx.sessions.create({
      profile: params?.profile,
      parent_session_id: params?.parent_session_id,
      engine: resolvedEngine,
    });
    const watch_url =
      ctx.host === "127.0.0.1" && ctx.portRef != null
        ? `http://127.0.0.1:${ctx.portRef.value}/watch?s=${encodeURIComponent(session_id)}`
        : null;
    return { session_id, watch_url };
  },

  async goto(
    params: { session_id: string; url: string; include_snapshot?: boolean },
    ctx: MethodContext
  ): Promise<GotoResult & { engine?: string; fellback_from?: string; fallback_reasons?: string[]; fallback_failed?: { reason: string; attempted_reasons: string[] } }> {
    if (typeof params.url !== "string") throw new InvalidUrlError(String(params.url));
    try {
      // eslint-disable-next-line no-new
      new URL(params.url);
    } catch {
      throw new InvalidUrlError(params.url);
    }
    const session = ctx.sessions.get(params.session_id);
    const result = await session.goto(params.url, { include_snapshot: params.include_snapshot });

    // M17 T6: Auto page-health check — only when:
    //  1. The session was created with engine: "auto"
    //  2. It is currently on lightpanda (hasn't already fallen back)
    //  3. A Chrome pool is available in this context
    if (
      result.ok &&
      session.requestedEngine === "auto" &&
      session.currentEngine === "lightpanda" &&
      ctx.chromePool
    ) {
      const { detectPageHealth } = await import("../engine/page-health.js");
      const { fallbackToChrome } = await import("../engine/fallback.js");
      const snap = (result as { snapshot?: Snapshot }).snapshot ?? await session.snapshot();
      const verdict = detectPageHealth(snap);
      if (verdict.should_fallback) {
        const fb = await fallbackToChrome(session as any, ctx.chromePool, params.session_id);
        if (fb.ok) {
          // Re-snapshot from the new engine (post-goto snapshot already navigated via fallback).
          const newSnap = await session.snapshot({ force: true });
          return {
            ...result,
            ok: true as const,
            snapshot: newSnap,
            engine: "chrome",
            fellback_from: "lightpanda",
            fallback_reasons: verdict.reasons,
          };
        }
        // Fallback failed — return original result with a flag.
        return {
          ...result,
          fallback_failed: { reason: fb.reason ?? "unknown", attempted_reasons: verdict.reasons },
        };
      }
    }

    return result;
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

    let result: Awaited<ReturnType<typeof session.login>> | undefined;

    // Mode B: inline credentials supplied → use them directly, never touch the store.
    if (params.username !== undefined && params.password !== undefined) {
      result = await session.login({
        username: params.username,
        password: params.password,
        totp_secret: params.totp_secret,
        include_snapshot: params.include_snapshot,
      });
    } else if (params.profile && params.key) {
      // Mode A: profile+key lookup from the credentials store.
      const cred = ctx.credentials.get(params.profile, params.key);
      if (!cred) {
        return { ok: false, reason: "credential_not_found", key: params.key };
      }
      result = await session.login({
        username: cred.username,
        password: cred.password,
        totp_secret: cred.totp_secret,
        include_snapshot: params.include_snapshot,
      });
    } else {
      // Neither mode supplied — caller error.
      return {
        ok: false,
        reason: "invalid_login_params",
        message: "login requires either {profile, key} or {username, password}",
      };
    }

    // Happy path — automated login succeeded.
    if (result.ok) return result;

    // ── Bot-block escalation ──────────────────────────────────────────────────
    // Conditions required for escalation:
    //   1. Automated login failed
    //   2. A Chrome pool is available (Chrome installed on this machine)
    //   3. The server is bound to 127.0.0.1 (local; seamless handoff is loopback-only)
    //   4. A portRef is wired (needed to compute huskPort for the overlay script)
    if (
      !result.ok &&
      ctx.chromePool &&
      ctx.host === "127.0.0.1" &&
      ctx.portRef != null
    ) {
      const { detectLoginBotBlock } = await import("../auth/bot-block-detector.js");
      const snap = await session.snapshot({ maxAgeMs: 0 }); // fresh snapshot
      const verdict = detectLoginBotBlock(snap);

      if (verdict.is_blocked) {
        // Escalate — open the user's real Chrome at the login URL, block until done.
        ctx.seamlessTriggers ??= new Map();

        const {
          findChrome,
          spawnChrome,
          connectToChrome,
          createHandoffProfileDir,
          runSeamlessHandoff,
        } = await import("../handoff/index.js");

        const { rm } = await import("node:fs/promises");
        const token = `login-${params.session_id}-${Date.now()}`;

        const handoff = await runSeamlessHandoff({
          session,
          targetUrl: verdict.login_url,
          timeoutMs: 600_000,
          token,
          huskPort: ctx.portRef.value,
          findChrome,
          spawnChrome,
          connectToChrome,
          createProfileDir: createHandoffProfileDir,
          cleanupProfileDir: async (dir) => {
            await rm(dir, { recursive: true, force: true }).catch(() => {});
          },
          onManualDoneHandle: (trigger) => {
            ctx.seamlessTriggers!.set(token, trigger);
          },
        });

        ctx.seamlessTriggers.delete(token);

        if (!handoff.resumed) {
          return {
            ok: false as const,
            reason: "handoff_failed" as const,
            handoff_reason: handoff.reason,
            escalation_reasons: verdict.reasons,
          };
        }

        // NEW: Swap to Chrome before verifying — the session's current engine
        // (likely lightpanda) is the one that bot-blocked us in the first place;
        // verifying on the same engine would re-trigger the same render failure.
        // Only attempt when cookies actually came back (a real login occurred) and
        // the session is still on lightpanda.
        if (handoff.cookies_imported > 0 && ctx.chromePool && session.currentEngine === "lightpanda") {
          const { fallbackToChrome } = await import("../engine/fallback.js");
          try {
            await fallbackToChrome(session as any, ctx.chromePool, params.session_id);
          } catch {
            // Best-effort — if fallback fails we still try to verify on lightpanda;
            // worst case we report ok:false and the agent can retry
          }
        }

        // Verify we're no longer on a login path after the handoff.
        const { LOGIN_URL_PATTERNS } = await import("../auth/bot-block-detector.js");
        await session.goto(verdict.login_url, {});
        const postSnap = await session.snapshot({ maxAgeMs: 0 });
        const stillOnLogin = LOGIN_URL_PATTERNS.some((re) => re.test(postSnap.url ?? ""));

        if (stillOnLogin) {
          return {
            ok: false as const,
            reason: "login_verification_failed" as const,
            escalated_via: "seamless_handoff" as const,
            engine_after: session.currentEngine,
            cookies_imported: handoff.cookies_imported,
            ms_paused: handoff.ms_paused,
            escalation_reasons: verdict.reasons,
          };
        }

        return {
          ok: true as const,
          escalated_via: "seamless_handoff" as const,
          engine_after: session.currentEngine,
          cookies_imported: handoff.cookies_imported,
          ms_paused: handoff.ms_paused,
          escalation_reasons: verdict.reasons,
          url_before: snap.url,
          url_after: postSnap.url,
          snapshot: (params.include_snapshot !== false) ? postSnap : undefined,
        };
      }
    }

    // Real credential failure or escalation unavailable — return original result.
    return result;
  },

  async batch_visit(
    params: BatchVisitParams,
    ctx: MethodContext
  ): Promise<{ results: BatchVisitItem[] }> {
    const results = await batchVisit(ctx, params);
    return { results };
  },

  /**
   * Handle a pending JS dialog (alert/confirm/prompt/beforeunload).
   *
   * Exposed via JSON-RPC only — NOT in the MCP tool surface (see mcp/src/tool-surface.ts).
   * Auto-dismiss handles 99% of cases; this method exists for the rare case where
   * the agent needs to explicitly accept/respond to a dialog.
   */
  async dialog(
    params: { session_id: string; action: "accept" | "dismiss"; text?: string },
    ctx: MethodContext
  ): Promise<{ ok: true }> {
    const session = ctx.sessions.get(params.session_id);
    await session.handleDialog(params.action, params.text);
    return { ok: true };
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

  /**
   * Ask the human a question — NON-BLOCKING. Returns immediately with a token
   * + watch_url + surface metadata. The agent should relay surface.question
   * (and surface.options if present) to the user in its next chat message.
   * Either chat reply or Watch UI button click resolves the token.
   */
  /**
   * Pause the session and hand off to the human.
   *
   * Two modes:
   *
   * mode:"seamless" (BLOCKING) — Spawns Chrome at target_url, waits for the
   *   user to log in (URL change or overlay button), syncs cookies back, then
   *   returns the final result inline.  Only engages when host==="127.0.0.1".
   *   Falls back to paste mode if Chrome is not found or host is remote.
   *   Returns: { ok, mode:"seamless", cookies_imported, ms_paused, reason? }
   *
   * mode:"paste" (NON-BLOCKING, M15 default) — Returns immediately with
   *   {pending: true, token, handoff_url, surface}. The agent polls or accepts
   *   a Watch UI resolve to continue.
   *
   * Default mode: "seamless" when need_cookies_back:true + host==="127.0.0.1";
   * "paste" otherwise.
   */
  async handoff(
    ctxOrParams:
      | MethodContext
      | {
          session_id: string;
          reason: string;
          suggested_action?: string;
          need_cookies_back?: boolean;
          mode?: "seamless" | "paste";
          target_url?: string;
          timeout_ms?: number;
        },
    paramsOrCtx:
      | {
          session_id: string;
          reason: string;
          suggested_action?: string;
          need_cookies_back?: boolean;
          mode?: "seamless" | "paste";
          target_url?: string;
          timeout_ms?: number;
        }
      | MethodContext,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasHumanIOOrSessions = (v: any): v is MethodContext =>
      v != null && typeof v === "object" && ("humanIO" in v || "sessions" in v);
    const ctx = hasHumanIOOrSessions(ctxOrParams)
      ? ctxOrParams
      : (paramsOrCtx as MethodContext);
    const params = hasHumanIOOrSessions(ctxOrParams)
      ? (paramsOrCtx as {
          session_id: string;
          reason: string;
          suggested_action?: string;
          need_cookies_back?: boolean;
          mode?: "seamless" | "paste";
          target_url?: string;
          timeout_ms?: number;
        })
      : (ctxOrParams as {
          session_id: string;
          reason: string;
          suggested_action?: string;
          need_cookies_back?: boolean;
          mode?: "seamless" | "paste";
          target_url?: string;
          timeout_ms?: number;
        });

    if (!params.reason?.trim()) {
      throw new Error("handoff requires a non-empty reason");
    }

    const session = ctx.sessions.get(params.session_id);
    const current_url = session.getCurrentUrl?.() ?? null;
    const timeoutMs = params.timeout_ms ?? 600_000;

    // Decide effective mode: seamless only on loopback, never for explicit "paste"
    const wantsSeamless =
      params.mode === "seamless" ||
      (params.mode === undefined && params.need_cookies_back === true);
    const isLoopback = ctx.host === "127.0.0.1";

    if (wantsSeamless && isLoopback) {
      // ── SEAMLESS (BLOCKING) ──────────────────────────────────────────────
      const target_url = params.target_url ?? current_url;
      if (!target_url) {
        throw new Error(
          "seamless handoff requires target_url or a current session URL",
        );
      }

      const token = randomUUID();
      session.pause({ token, handoff_url: null });

      // Emit pending_handoff to Watch UI (with mode:"seamless" indicator)
      ctx.watchBus?.emit(params.session_id, {
        kind: "pending_handoff",
        ts: Date.now(),
        token,
        reason: params.reason,
        suggested_action: params.suggested_action,
        current_url: target_url,
        handoff_url: null,
        need_cookies_back: true,
        mode: "seamless",
      });

      // Ensure the triggers map exists
      ctx.seamlessTriggers ??= new Map();

      // Lazy-import the handoff module so tests can vi.mock it
      const {
        findChrome,
        spawnChrome,
        connectToChrome,
        createHandoffProfileDir,
        runSeamlessHandoff,
      } = await import("../handoff/index.js");

      const { rm } = await import("node:fs/promises");

      const result = await runSeamlessHandoff({
        session,
        targetUrl: target_url,
        timeoutMs,
        token,
        huskPort: ctx.portRef!.value,
        findChrome,
        spawnChrome,
        connectToChrome,
        createProfileDir: createHandoffProfileDir,
        cleanupProfileDir: async (dir) => {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        },
        onManualDoneHandle: (trigger) => {
          ctx.seamlessTriggers!.set(token, trigger);
        },
      });

      ctx.seamlessTriggers.delete(token);
      session.resume();

      // Emit resolved event so Watch UI clears the handoff widget
      ctx.watchBus?.emit(params.session_id, {
        kind: "resolved",
        ts: Date.now(),
        token,
        kind_resolved: "handoff",
      });

      return {
        ok: result.resumed,
        mode: "seamless" as const,
        cookies_imported: result.cookies_imported,
        ms_paused: result.ms_paused,
        ...(result.reason ? { reason: result.reason } : {}),
      };
    }

    // ── PASTE (NON-BLOCKING, M15 behavior) ─────────────────────────────────
    if (!ctx.humanIO) {
      throw new Error("handoff is not available: humanIO bus not initialised");
    }

    const { token, promise } = ctx.humanIO.startHandoff(
      params.session_id,
      {
        reason: params.reason,
        suggested_action: params.suggested_action,
        current_url: current_url ?? undefined,
        need_cookies_back: params.need_cookies_back,
      },
      timeoutMs,
    );

    const handoff_url =
      ctx.host === "127.0.0.1" && ctx.portRef != null
        ? `http://${ctx.host}:${ctx.portRef.value}/handoff/${token}`
        : null;

    // Pause the session AFTER we have the handoff_url so we can embed it in the pause state
    session.pause({ token, handoff_url });

    // Emit pending_handoff to Watch UI
    ctx.watchBus?.emit(params.session_id, {
      kind: "pending_handoff",
      ts: Date.now(),
      token,
      reason: params.reason,
      suggested_action: params.suggested_action,
      current_url: current_url ?? undefined,
      handoff_url,
      need_cookies_back: params.need_cookies_back,
      mode: "paste",
    });

    // Fire-and-forget: when the bus resolves (via Watch UI POST or via husk_resume in T7),
    // import cookies and unpause the session.
    void promise.then(async (resolved) => {
      if (resolved.resumed && resolved.cookies && resolved.cookies.length > 0) {
        try { await session.importCookies(resolved.cookies); } catch { /* swallow */ }
      }
      session.resume();
      // Emit resolved event
      ctx.watchBus?.emit(params.session_id, {
        kind: "resolved",
        ts: Date.now(),
        token,
        kind_resolved: "handoff",
      });
    }).catch(() => {
      // If something blew up, still unpause so the agent isn't stuck forever
      session.resume();
    });

    return {
      pending: true as const,
      token,
      handoff_url,
      surface: {
        reason: params.reason,
        ...(params.suggested_action ? { suggested_action: params.suggested_action } : {}),
        ...(current_url ? { current_url } : {}),
      },
    };
  },

  /**
   * Agent-side resume entry — resolves a pending question or unpauses a
   * handoff when the human answered in chat rather than the Watch UI.
   *
   * NOTE: This method accepts (ctx, params) when called directly (e.g. from
   * tests or SDK wrappers) and also works when the JSON-RPC dispatcher calls
   * it as (params, ctx) — the implementation detects which ordering is in use
   * by checking which argument contains `humanIO`.
   */
  async resume(
    ctxOrParams: MethodContext | {
      token: string;
      answer?: string;
      index?: number;
      cookies?: Array<{ name: string; value: string; domain?: string; raw?: string }>;
      note?: string;
    },
    paramsOrCtx: {
      token: string;
      answer?: string;
      index?: number;
      cookies?: Array<{ name: string; value: string; domain?: string; raw?: string }>;
      note?: string;
    } | MethodContext
  ): Promise<
    | { ok: true; kind: "question" | "handoff" }
    | { ok: false; reason: "unknown_token" }
  > {
    // Detect argument order: ctx always has `humanIO`; params always has `token`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasHumanIO = (v: any): v is MethodContext => v != null && typeof v === "object" && "humanIO" in v;
    const ctx = hasHumanIO(ctxOrParams) ? ctxOrParams : (paramsOrCtx as MethodContext);
    const params = hasHumanIO(ctxOrParams)
      ? (paramsOrCtx as { token: string; answer?: string; index?: number; cookies?: Array<{ name: string; value: string; domain?: string; raw?: string }>; note?: string })
      : (ctxOrParams as { token: string; answer?: string; index?: number; cookies?: Array<{ name: string; value: string; domain?: string; raw?: string }>; note?: string });

    const question = ctx.humanIO?.getQuestion(params.token) ?? null;
    if (question) {
      ctx.humanIO!.answerQuestion(params.token, { answer: params.answer, index: params.index });
      ctx.watchBus?.emit(question.session_id, {
        kind: "resolved",
        ts: Date.now(),
        token: params.token,
        kind_resolved: "question",
      });
      return { ok: true, kind: "question" };
    }
    const handoff = ctx.humanIO?.getHandoff(params.token) ?? null;
    if (handoff) {
      ctx.humanIO!.resumeHandoff(params.token, {
        cookies: params.cookies,
        note: params.note,
      });
      // The handoff promise resolver (set up in the handoff method) handles
      // importCookies + session.resume + emits resolved — no need to emit here.
      return { ok: true, kind: "handoff" };
    }
    return { ok: false, reason: "unknown_token" };
  },

  async ask_human(
    params: {
      session_id: string;
      question: string;
      options?: string[];
      timeout_ms?: number;
    },
    ctx: MethodContext
  ) {
    if (!params.question?.trim()) {
      throw new Error("ask_human requires a non-empty question");
    }
    if (!ctx.humanIO) {
      throw new Error("ask_human is not available: humanIO bus not initialised");
    }
    const timeoutMs = params.timeout_ms ?? 300_000;
    const { token, promise } = ctx.humanIO.askQuestion(
      params.session_id,
      { question: params.question, options: params.options },
      timeoutMs,
    );
    // Fire-and-forget: the promise resolves when the question is answered or
    // times out. We just prevent unhandled-rejection warnings on timeout.
    void promise.catch(() => {});

    // Emit pending_question so the Watch UI can surface the question.
    ctx.watchBus?.emit(params.session_id, {
      kind: "pending_question",
      ts: Date.now(),
      token,
      question: params.question,
      options: params.options,
    });

    const watch_url =
      ctx.host === "127.0.0.1" && ctx.portRef != null
        ? `http://${ctx.host}:${ctx.portRef.value}/watch?s=${encodeURIComponent(params.session_id)}`
        : null;

    return {
      pending: true,
      token,
      watch_url,
      surface: {
        question: params.question,
        ...(params.options !== undefined ? { options: params.options } : {}),
      },
    };
  },

  /**
   * M22 T8: Register a subscription on the CognitionBus.
   *
   * Validates event_type, registers a placeholder (no-op) subscription, and
   * returns the subscription_id + the SSE URL the agent should open.
   * The SSE endpoint (T7) replaces the no-op handler when the agent connects.
   */
  async subscribe(
    params: {
      event_type: EventType;
      session_id?: string;
      site?: string;
      debounce_ms?: number;
    },
    ctx: MethodContext,
  ): Promise<{ subscription_id: string; stream_url: string }> {
    if (!VALID_EVENT_TYPES.has(params.event_type as string)) {
      const valid = Array.from(VALID_EVENT_TYPES).join(", ");
      throw new Error(
        `Invalid event_type "${params.event_type}". Must be one of: ${valid}`,
      );
    }
    const bus = ctx.cognitionBus;
    if (!bus) {
      throw new Error("subscribe is not available: cognitionBus not initialised");
    }
    const filter = {
      ...(params.session_id !== undefined ? { session_id: params.session_id } : {}),
      ...(params.site !== undefined ? { site: params.site } : {}),
      ...(params.debounce_ms !== undefined ? { debounce_ms: params.debounce_ms } : {}),
    };
    // Register a placeholder no-op handler; the SSE endpoint replaces it via
    // bus.setHandler() when the agent opens the stream.
    const subscription_id = bus.subscribe(params.event_type, filter, () => {});
    return {
      subscription_id,
      stream_url: `/stream/cognition?subscription_id=${subscription_id}`,
    };
  },

  /**
   * M22 T8: Remove a subscription from the CognitionBus.
   */
  async unsubscribe(
    params: { subscription_id: string },
    ctx: MethodContext,
  ): Promise<{ removed: boolean }> {
    const bus = ctx.cognitionBus;
    if (!bus) {
      throw new Error("unsubscribe is not available: cognitionBus not initialised");
    }
    const removed = bus.unsubscribe(params.subscription_id);
    return { removed };
  },

  /**
   * M19 Phase B T8: Execute a named intention against the session's current page.
   *
   * Looks up the intention from the SQLite store (keyed by site + intention_name),
   * compiles and executes it via IntentionCompiler, and returns an Outcome envelope.
   * Never throws — all failures are captured in Outcome.reason.
   */
  async intend(
    params: {
      session_id: string;
      intention_name: string;
      args?: Record<string, unknown>;
      site?: string;
      /** Optional capability declaration (Phase D M21). Plumbed through for future enforcement. */
      capability?: CapabilityRequirement;
    },
    ctx: MethodContext,
  ) {
    const session = ctx.sessions.get(params.session_id);
    return await session.intend({
      intention_name: params.intention_name,
      args: params.args,
      site: params.site,
    });
  },
} as const;

/** Type-level enumeration of all method names. */
export type MethodName = keyof typeof METHODS;
