import { spawnLightpanda, type LightpandaProcess } from "../engine/lifecycle.js";
import { CdpClient } from "../engine/cdp-client.js";
import { waitForPageReady } from "./page-ready.js";
import { transformAxTree } from "../snapshot/adapter.js";
import { diffSnapshots } from "../snapshot/poller.js";
import type { AXNode, Snapshot, SnapshotDiff, SnapshotNode } from "../snapshot/types.js";
import { computeSignature, type AxLite } from "../snapshot/signature.js";
import { extractMeta } from "../snapshot/meta.js";
import { extractForms } from "../snapshot/forms.js";
import { summarize } from "../snapshot/summary.js";
import { NetworkBuffer } from "./network-buffer.js";
import { ConsoleBuffer, type ConsoleLevel } from "./console-buffer.js";
import { HistoryBuffer } from "./history-buffer.js";
import { locateLightpanda } from "../engine/binary.js";
import type { SiteGraphCache } from "../cache/site-graph.js";
import { Watchdog } from "../watchdog/watchdog.js";
import { dispatchClick, dispatchType, dispatchScroll, dispatchPress, type ScrollDirection } from "./actions.js";
import { runExtract, type ExtractQuery } from "./extract.js";
import { runPaginate, type PaginateResult } from "./paginate.js";
import { runWaitFor, type WaitForCondition, type WaitForResult } from "./wait.js";
import { runUpload, type UploadResult } from "./upload.js";
import type { RejectionEnvelope, Warning, PolicyDocument } from "../watchdog/types.js";
import { VaultStore } from "../vault/store.js";
import { captureCookies } from "../vault/capture.js";
import { restoreCookies } from "../vault/restore.js";
import { performLogin, type LoginInput, type LoginResult } from "../auth/login-flow.js";
import { totpCode } from "../auth/totp.js";
import type { EngineHandle } from "../engine/pool.js";
import { runFind, type FindCandidate } from "./find.js";
import { runScrollUntil, type ScrollUntilResult } from "./scroll-until.js";
import type { WatchBus } from "../watch/sse.js";
import type { WatchEvent } from "../watch/events.js";
import { filterVisible } from "../snapshot/visible.js";
import { captureScreenshot } from "../snapshot/screenshot.js";
import { deriveApiHints } from "../snapshot/api-hints.js";
import { DialogHandler } from "./dialog-handler.js";
import { enrichWithShadow } from "../snapshot/shadow-walker.js";
import type { ResumeCookie } from "../hitl/types.js";

export interface SessionOptions {
  /** Override binary path. Defaults to LIGHTPANDA_BIN env / PATH discovery. */
  binary?: string;
  /** Pass through to lifecycle manager. */
  readinessTimeoutMs?: number;
  /** Logger for engine stderr/stdout. Defaults to no-op. */
  log?: (line: string) => void;
  /** Optional cache the session writes observations to after every snapshot. */
  siteGraph?: SiteGraphCache;
  /** Vault store to capture/restore cookies. Required for `profile` to work. */
  vault?: VaultStore | null;
  /** Profile name. When supplied with `vault`, cookies are restored on create
   *  and captured on close. */
  profile?: string;
  /** Pre-acquired engine handle from a pool. If supplied, Session.create
   *  uses this instead of spawning a fresh lightpanda. The handle's release()
   *  is invoked on Session.close(). */
  engine?: EngineHandle | null;
  /** Optional watch event bus. When provided, the session emits navigation,
   *  snapshot, action, rejection, and find events to the bus under its id. */
  watchBus?: WatchBus;
  /** The session id to use when emitting to the watch bus. Set by SessionManager. */
  watchSessionId?: string;
  /**
   * Callback that returns the sibling session ids (other tabs in the same tab
   * group). Injected by SessionManager so snapshot() can include sibling_sessions
   * without a circular reference to the manager. Absent for sessions created
   * outside a manager (e.g. fromInjected in tests).
   */
  getSiblings?: () => string[];
}

/**
 * High-level Husk session.
 *
 * Lifecycle:
 *   1. `Session.create(opts)` — spawns lightpanda, opens a CDP WebSocket,
 *      creates and attaches to a fresh target. Returns a ready session.
 *   2. `session.goto(url)` — navigates the target.
 *   3. `session.snapshot()` — returns a spec-§5.2 `Snapshot`.
 *   4. `session.snapshotDiff()` — returns a `SnapshotDiff` vs the prior snapshot,
 *      or `null` if there is no prior. The current snapshot becomes the new baseline.
 *   5. `session.close()` — disconnects and kills the subprocess.
 */
export type ActionResult = { ok: true; warnings: Warning[]; diff: SnapshotDiff | null } | RejectionEnvelope;

/**
 * Target specifier for action methods. Callers pass EITHER:
 *   • `{ stable_id }` — exact id from a snapshot (bypasses find(), fastest path)
 *   • `{ intent }`   — natural language (e.g. "sign in button"), resolved via
 *                      the deterministic AX-scoring find() resolver
 *
 * For scroll, `stable_id` may be null to request window-level scroll.
 */
export type Target = { stable_id?: string | null; intent?: string };

/** Extended action result that also covers intent-resolution failures. */
export type ActionResultWithIntent =
  | ActionResult
  | { ok: false; reason: "no_match" | "ambiguous_intent" | "missing_target"; candidates: FindCandidate[] };

/** Any action result (including intent failures) optionally widened with post-action snapshot. */
export type ActionResultWithSnapshot<T> = T & { snapshot?: Snapshot };

/** Normalize CDP console.type / Log.level strings to our ConsoleLevel enum. */
function normalizeConsoleLevel(t?: string): ConsoleLevel {
  switch (t) {
    case "error": case "assert": return "error";
    case "warning": case "warn": return "warn";
    case "info": return "info";
    case "debug": case "trace": return "debug";
    default: return "log";
  }
}

export class Session {
  private lastSnapshotAt = 0;
  private lastSnapshotMode: "full" | "terse" | "visible" = "full";
  private dialogHandler?: DialogHandler;
  /** networkIdleMs passed to waitForPageReady. Production default: 500.
   *  fromInjected sets this to 0 so unit tests don't pay the idle penalty. */
  private networkIdleMs = 500;
  /** HITL pause state. When non-null, all action methods are gated. Snapshot still works. */
  private paused: { token: string; handoff_url: string | null } | null = null;
  /** Ring buffer of recent CDP Network events. Populated after Session.create(). */
  private networkBuffer = new NetworkBuffer(100);
  /** Ring buffer of recent console messages (Runtime + Log CDP events). */
  private consoleBuffer = new ConsoleBuffer(50);
  /** Ring buffer of recent session actions (click, type, etc). */
  private historyBuffer = new HistoryBuffer(10);

  private constructor(
    private readonly engine: LightpandaProcess,
    private readonly cdp: CdpClient,
    private readonly sessionId: string,
    private currentUrl: string,
    private lastSnapshot: Snapshot | null = null,
    private readonly siteGraph: SiteGraphCache | null = null,
    private readonly watchdog: Watchdog,
    private readonly vault: VaultStore | null = null,
    private profile: string | null = null,
    private readonly engineHandle: EngineHandle | null = null,
    private readonly watchBus: WatchBus | null = null,
    private readonly watchId: string | null = null,
    private readonly getSiblings: (() => string[]) | null = null
  ) {}

  /** Emit an event to the watch bus if one is wired. No-op otherwise. */
  private emitWatch(event: WatchEvent): void {
    if (this.watchBus && this.watchId) {
      this.watchBus.emit(this.watchId, event);
    }
  }

  static async create(opts: SessionOptions = {}): Promise<Session> {
    let engineProcess: LightpandaProcess;
    let engineHandle: EngineHandle | null = null;

    if (opts.engine) {
      engineHandle = opts.engine;
      engineProcess = opts.engine.process;
    } else {
      const binary = opts.binary ?? (await locateLightpanda());
      engineProcess = await spawnLightpanda({
        binary,
        readinessTimeoutMs: opts.readinessTimeoutMs,
        log: opts.log,
      });
    }

    // Discover the CDP WebSocket.
    // lightpanda returns an empty /json/list until a target is created, so we
    // fall back to /json/version which always carries the browser-level WS URL.
    const wsUrl = await resolveBrowserWsUrl(engineProcess.cdpBaseUrl);
    if (!wsUrl) {
      if (engineHandle) {
        await engineHandle.release();
      } else {
        await engineProcess.close();
      }
      throw new Error("Session.create: could not discover CDP WebSocket URL from /json/list or /json/version");
    }
    const cdp = new CdpClient(wsUrl);
    await cdp.ready;

    // Create a fresh target and attach to it (sessionId for subsequent calls).
    const sessionId = await cdp.createAndAttachTarget("about:blank");
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Accessibility.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Log.enable", {}, sessionId).catch(() => {});  // some engines don't have Log domain

    const wd = new Watchdog({ cache: opts.siteGraph ?? null });
    const inst = new Session(
      engineProcess, cdp, sessionId, "about:blank", null,
      opts.siteGraph ?? null, wd,
      opts.vault ?? null,
      opts.profile ?? null,
      engineHandle,
      opts.watchBus ?? null,
      opts.watchSessionId ?? null,
      opts.getSiblings ?? null
    );

    // Wire CDP Network events into the ring buffer.
    // CDP timestamps are fractional seconds — multiply by 1000 to get ms.
    cdp.on("Network.requestWillBeSent", (params: unknown) => {
      const p = params as { requestId?: string; request?: { url?: string; method?: string }; timestamp?: number };
      if (!p.requestId) return;
      inst.networkBuffer.onRequest(p.requestId, {
        url: p.request?.url ?? "",
        method: p.request?.method ?? "GET",
        startedAt: (p.timestamp ?? 0) * 1000,
      });
    });
    cdp.on("Network.responseReceived", (params: unknown) => {
      const p = params as { requestId?: string; response?: { status?: number; mimeType?: string }; timestamp?: number };
      if (!p.requestId) return;
      inst.networkBuffer.onResponse(p.requestId, {
        status: p.response?.status ?? 0,
        mimeType: p.response?.mimeType ?? "",
        completedAt: (p.timestamp ?? 0) * 1000,
      });
    });
    cdp.on("Network.loadingFailed", (params: unknown) => {
      const p = params as { requestId?: string; timestamp?: number };
      if (!p.requestId) return;
      inst.networkBuffer.onFailed(p.requestId, {
        completedAt: (p.timestamp ?? 0) * 1000,
      });
    });

    // Wire CDP Runtime.consoleAPICalled events into the console buffer.
    // CDP timestamps are fractional seconds — multiply by 1000 to get ms.
    cdp.on("Runtime.consoleAPICalled", (params: unknown) => {
      const p = params as { type?: string; args?: Array<{ value?: unknown; description?: string }>; timestamp?: number };
      const text = (p.args ?? [])
        .map((a) => (typeof a.value === "string" ? a.value : a.description ?? JSON.stringify(a.value ?? null)))
        .join(" ");
      const level = normalizeConsoleLevel(p.type);
      inst.consoleBuffer.add({ level, text, ts: (p.timestamp ?? 0) * 1000 });
    });

    // Wire CDP Log.entryAdded events into the console buffer.
    // Log.entryAdded timestamps are already in ms per CDP spec.
    cdp.on("Log.entryAdded", (params: unknown) => {
      const p = params as { entry?: { level?: string; text?: string; timestamp?: number } };
      const e = p.entry;
      if (!e) return;
      inst.consoleBuffer.add({
        level: normalizeConsoleLevel(e.level),
        text: e.text ?? "",
        ts: e.timestamp ?? 0,
      });
    });

    // Wire JS dialog auto-handler. Auto-dismisses after 100ms by default to
    // prevent pages from deadlocking on alert/confirm/prompt/beforeunload.
    inst.dialogHandler = new DialogHandler(
      { send: (method, params) => cdp.send(method, params as Record<string, unknown>, sessionId) },
      { autoDismissMs: 100 }
    );
    cdp.on("Page.javascriptDialogOpening", (params: unknown) => {
      const p = params as { type: string; message: string; url: string };
      // CDP type values: "alert", "confirm", "prompt", "beforeunload" — matches our union.
      inst.dialogHandler?.onDialog(p as { type: "alert" | "confirm" | "prompt" | "beforeunload"; message: string; url: string });
    });

    if (opts.profile && opts.vault) {
      await inst.restoreFromVault();
    }
    return inst;
  }

  async goto(url: string, opts: { include_snapshot?: boolean } = {}): Promise<{ ok: true; snapshot?: Snapshot } | { ok: false; reason: "session_paused"; token: string; handoff_url: string | null }> {
    if (this.paused) {
      return { ok: false, reason: "session_paused", token: this.paused.token, handoff_url: this.paused.handoff_url };
    }
    await this.cdp.send("Page.navigate", { url }, this.sessionId);
    this.currentUrl = url;
    // Track goto in history (no target_name for navigation)
    this.historyBuffer.add({
      verb: "goto",
      target_name: null,
      ok: true,
      ts: Date.now(),
      url_after: url,
    });
    // Emit navigation event.
    this.emitWatch({ kind: "navigation", ts: Date.now(), url });
    // Wait for the page to reach a network-idle state instead of a fixed delay.
    // Resolves when Page.loadEventFired fires AND in-flight requests are gone for
    // 500 ms, or after a hard 8-second cap (max_wait fallback).
    // Requires Page.enable + Network.enable to be called during session init.
    await waitForPageReady(this.cdp, { networkIdleMs: this.networkIdleMs, maxWaitMs: 8000 });
    // Eager snapshot: cache lastSnapshot so the agent's next snapshot() call is instant.
    // Use force:true so navigation always fetches a fresh AX tree (not a stale cache).
    // Best-effort: don't fail goto if AX capture has a transient issue.
    try {
      await this.snapshot({ force: true });
    } catch {
      // best-effort
    }
    // Post-goto snapshot: include_snapshot defaults to true for goto.
    // The eager snapshot above already cached the result, so this is a free cache hit.
    const doSnap = opts.include_snapshot !== false;
    return this.withSnapshot({ ok: true as const }, doSnap);
  }

  async snapshot(opts: { maxAgeMs?: number; force?: boolean; mode?: "full" | "terse" | "visible"; include_image?: boolean; full_page?: boolean } = {}): Promise<Snapshot> {
    const maxAge = opts.maxAgeMs ?? 500;
    const mode = opts.mode ?? "full";
    // When include_image is true, bypass the cache (always get fresh)
    const bypassCacheForImage = opts.include_image === true;
    const fresh =
      !opts.force &&
      !bypassCacheForImage &&
      this.lastSnapshot &&
      Date.now() - this.lastSnapshotAt < maxAge &&
      this.lastSnapshotMode === mode;
    if (fresh) return this.lastSnapshot!;
    const tree = (await this.cdp.send(
      "Accessibility.getFullAXTree", {}, this.sessionId
    )) as { nodes: AXNode[] };
    const root = tree.nodes.find((n) => !n.parentId) ?? tree.nodes[0];
    if (!root) throw new Error("snapshot: Accessibility.getFullAXTree returned no nodes");
    // Visible mode: build the full AX tree first, then filter via viewport bbox.
    const axMode = mode === "visible" ? "full" : mode;
    const snap = transformAxTree(tree.nodes, root.nodeId, this.currentUrl, { mode: axMode });

    // M14 T6: Visible-only post-processing — filter to viewport-intersecting nodes.
    if (mode === "visible") {
      try {
        const metrics = (await this.cdp.send(
          "Page.getLayoutMetrics", {}, this.sessionId
        )) as { layoutViewport?: { clientWidth?: number; clientHeight?: number }; cssLayoutViewport?: { clientWidth?: number; clientHeight?: number } } | null;
        // Page.getLayoutMetrics shape varies slightly across engines.
        const vw =
          metrics?.layoutViewport?.clientWidth ??
          metrics?.cssLayoutViewport?.clientWidth ??
          1280;
        const vh =
          metrics?.layoutViewport?.clientHeight ??
          metrics?.cssLayoutViewport?.clientHeight ??
          800;
        const cdpProxy = {
          send: (method: string, params: unknown) =>
            this.cdp.send(method, params as Record<string, unknown>, this.sessionId),
        };
        snap.root = (await filterVisible(cdpProxy, snap.root as any, { width: vw, height: vh })) as unknown as typeof snap.root;
        // Recount nodes after filtering.
        let cnt = 0;
        const recount = (n: typeof snap.root) => {
          cnt += 1;
          for (const c of n.c ?? []) recount(c);
        };
        recount(snap.root);
        snap.count = cnt;
      } catch {
        // Graceful degrade: Page.getLayoutMetrics or DOM.getBoxModel unavailable.
        // Return the full (unfiltered) tree rather than throwing.
      }
    }

    // M15 T3: Shadow DOM piercing — enrich generic/Unknown/none nodes that may
    // be custom-element shadow hosts. Engine-dependent; graceful no-op on
    // lightpanda (DOM.describeNode returns quickly with no shadow roots).
    // Must run BEFORE computeSignature so the signature reflects the enriched tree.
    try {
      const cdpProxy = {
        send: (method: string, params: unknown) =>
          this.cdp.send(method, params as Record<string, unknown>, this.sessionId),
      };
      snap.root = (await enrichWithShadow(cdpProxy, snap.root as any)) as unknown as typeof snap.root;
    } catch {
      // Graceful degrade: any unexpected error leaves the tree unchanged.
    }

    // M14 T2 + T10: Attach network ring buffer and derived API hints to snapshot.
    const networkRecent = this.networkBuffer.recent();
    snap.network = {
      recent: networkRecent,
      likely_api_endpoints: deriveApiHints(networkRecent),
    };

    // M14 T3: Attach console buffer to snapshot.
    snap.console = this.consoleBuffer.recent();

    // M14 T1+T2: Compute state signature with actual network URLs.
    snap.signature = computeSignature({
      root: snap.root as unknown as AxLite,
      url: snap.url,
      networkUrls: this.networkBuffer.urls(),
    });

    // M14 T4: Extract page metadata (title, canonical, og, jsonld).
    snap.meta = await extractMeta(this.cdp as any, this.sessionId);

    // M14 T5: Extract form definitions (fields, labels, submit_text).
    snap.forms = await extractForms(this.cdp as any, this.sessionId);

    // M14 T7: Compute rule-based one-line page summary.
    snap.summary = summarize({
      url: snap.url,
      meta: snap.meta ?? { title: null, canonical: null, og: {}, jsonld: [] },
      forms: snap.forms ?? [],
      nodes_count: countAxNodes(snap.root),
    });

    // M14 T9: Attach session history buffer to snapshot.
    snap.session_history = this.historyBuffer.recent();

    // M15 T1: Attach sibling session ids (tab group). Always present (empty for solo sessions).
    snap.sibling_sessions = this.getSiblings ? this.getSiblings() : [];

    // M15 T2: Attach pending dialog (only when one is actually open — keeps snapshot lean).
    const pendingDialog = this.dialogHandler?.pending();
    if (pendingDialog) snap.dialog = pendingDialog;

    // M14 T8: Optionally attach base64 PNG screenshot.
    if (opts.include_image) {
      snap.image_b64 = (await captureScreenshot(this.cdp as any, { fullPage: opts.full_page })) ?? undefined;
    }

    this.lastSnapshot = snap;
    this.lastSnapshotAt = Date.now();
    this.lastSnapshotMode = mode;
    this.siteGraph?.observe(snap);
    // Emit snapshot event on cache miss only (not on freshness-cache hits).
    this.emitWatch({ kind: "snapshot", ts: this.lastSnapshotAt, url: snap.url, node_count: snap.count, mode });
    return snap;
  }

  async snapshotDiff(): Promise<SnapshotDiff | null> {
    const prior = this.lastSnapshot;
    const current = await this.snapshot();
    if (!prior) return null;
    return diffSnapshots(prior, current);
  }

  setPolicy(policy: PolicyDocument | null): void {
    this.watchdog.setPolicy(policy);
  }

  // ---------------------------------------------------------------------------
  // HITL pause/resume primitives (M15 T4)
  // ---------------------------------------------------------------------------

  /** Pause the session. All action methods will return {ok:false, reason:"session_paused"} until resume(). Snapshot is NOT gated. */
  pause(handoffInfo: { token: string; handoff_url: string | null }): void {
    this.paused = handoffInfo;
  }

  /** Ungate action methods — session returns to normal operation. */
  resume(): void {
    this.paused = null;
  }

  /** Returns the current pause state, or null when not paused. */
  isPaused(): { token: string; handoff_url: string | null } | null {
    return this.paused;
  }

  /** Best-effort current URL — used by handoff payload. */
  getCurrentUrl(): string | null {
    return this.currentUrl ?? null;
  }

  /**
   * Import cookies into the session via CDP Network.setCookies.
   * Handles both structured ResumeCookie objects and raw `name=value` strings.
   * Degrades gracefully if Network.setCookies is unavailable.
   * Returns the number of cookies actually imported.
   */
  async importCookies(cookies: ResumeCookie[]): Promise<number> {
    type CdpCookieParam = { name: string; value: string; domain?: string; path: string; expires?: number };
    const cdpCookies: CdpCookieParam[] = [];
    for (const c of cookies) {
      if (c.raw) {
        const eq = c.raw.indexOf("=");
        if (eq < 1) continue;
        const name = c.raw.slice(0, eq).trim();
        const value = c.raw.slice(eq + 1).trim();
        if (!name) continue;
        cdpCookies.push({ name, value, domain: c.domain, path: c.path ?? "/" });
      } else {
        if (!c.name) continue;
        cdpCookies.push({ name: c.name, value: c.value, domain: c.domain, path: c.path ?? "/", expires: c.expires });
      }
    }
    if (cdpCookies.length === 0) return 0;
    try {
      await this.cdp.send("Network.setCookies", { cookies: cdpCookies }, this.sessionId);
      return cdpCookies.length;
    } catch {
      return 0;
    }
  }

  /**
   * Resolve a Target to a concrete stable_id.
   *
   * If `stable_id` is present (even null for window-level scroll), returns it
   * immediately without touching the AX tree.
   *
   * If `intent` is provided, fetches the current snapshot, flattens the tree,
   * runs the deterministic find() scorer, and applies ambiguity detection:
   *   - top candidate is clear (score gap ≥ 0.05 vs #2)  → ok:true
   *   - top-2 are within 0.05 of each other              → ambiguous_intent
   *   - no candidates above threshold                     → no_match
   */
  private async resolveTarget(t: Target): Promise<
    | { ok: true; stable_id: string | null }
    | { ok: false; reason: "no_match" | "ambiguous_intent" | "missing_target"; candidates: FindCandidate[] }
  > {
    if (t.stable_id !== undefined) return { ok: true, stable_id: t.stable_id ?? null };
    if (!t.intent) return { ok: false, reason: "missing_target", candidates: [] };

    const snap = await this.snapshot();
    const flatNodes = flattenSnapshot(snap.root);
    const domain = (() => {
      try { return new URL(this.currentUrl).hostname; } catch { return undefined; }
    })();
    const r = await runFind({
      snapshot: { nodes: flatNodes },
      cache: null,
      siteGraphCache: this.siteGraph ?? undefined,
      domain,
    }, { intent: t.intent });
    // Emit find event — both on success and failure (read-only, before action attempts).
    this.emitWatch({ kind: "find", ts: Date.now(), intent: t.intent, candidates: r.candidates });
    if (!r.ok) return { ok: false, reason: "no_match", candidates: r.candidates };
    if (
      r.candidates.length >= 2 &&
      r.candidates[0].score - r.candidates[1].score < 0.05
    ) {
      return { ok: false, reason: "ambiguous_intent", candidates: r.candidates };
    }
    return { ok: true, stable_id: r.candidates[0].stable_id };
  }

  // Extracts the accessible name of a node by stable_id from a snapshot.
  private getTargetName(snapshot: Snapshot, stable_id: string | null): string | null {
    if (!stable_id) return null;
    const findNode = (node: SnapshotNode): SnapshotNode | null => {
      if (node.i === stable_id) return node;
      for (const child of node.c ?? []) {
        const found = findNode(child);
        if (found) return found;
      }
      return null;
    };
    const node = findNode(snapshot.root);
    return node?.n ?? null;
  }

  // ---------------------------------------------------------------------------
  // Internal perform* methods — take a resolved stable_id, run watchdog, dispatch.
  // ---------------------------------------------------------------------------

  private async performClick(stable_id: string): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "click", stable_id);
    if (!pre.ok) {
      this.emitWatch({ kind: "rejection", ts: Date.now(), verb: "click", reason: pre.envelope.reason, candidates: pre.envelope.candidates });
      const envelope = pre.envelope;
      // Track rejection in history
      this.historyBuffer.add({
        verb: "click",
        target_name: this.getTargetName(before, stable_id),
        ok: false,
        ts: Date.now(),
      });
      // Record reliability outcome.
      if (this.siteGraph) {
        try {
          const domain = new URL(this.currentUrl).hostname;
          this.siteGraph.recordFailure(domain, stable_id);
        } catch { /* ignore */ }
      }
      return envelope;
    }
    if (pre.backendNodeId == null) {
      this.emitWatch({ kind: "rejection", ts: Date.now(), verb: "click", reason: "element_not_found", candidates: [] });
      const envelope: RejectionEnvelope = {
        ok: false,
        reason: "element_not_found",
        verb: "click",
        stable_id_attempted: stable_id,
        candidates: [],
        snapshot_at_attempt: before,
      };
      // Track rejection in history
      this.historyBuffer.add({
        verb: "click",
        target_name: this.getTargetName(before, stable_id),
        ok: false,
        ts: Date.now(),
      });
      // Record reliability outcome.
      if (this.siteGraph) {
        try {
          const domain = new URL(this.currentUrl).hostname;
          this.siteGraph.recordFailure(domain, stable_id);
        } catch { /* ignore */ }
      }
      return envelope;
    }
    const urlBefore = this.currentUrl;
    await dispatchClick(this.cdp, this.sessionId, pre.backendNodeId);
    await waitForMutationWindow();
    const after = await this.snapshot({ force: true });
    const result: ActionResult = {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "click", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
      diff: diffSnapshots(before, after),
    };
    this.emitWatch({ kind: "action", ts: Date.now(), verb: "click", stable_id, ok: true, diff: result.diff ? { added: result.diff.added.length, removed: result.diff.removed.length, changed: result.diff.changed.length } : undefined });
    // Track success in history
    this.historyBuffer.add({
      verb: "click",
      target_name: this.getTargetName(before, stable_id),
      ok: true,
      ts: Date.now(),
      url_after: this.currentUrl,
    });
    // Record reliability outcome in site-graph cache.
    if (this.siteGraph) {
      try {
        const domain = new URL(this.currentUrl).hostname;
        this.siteGraph.recordSuccess(domain, stable_id);
      } catch { /* ignore parse errors */ }
    }
    return result;
  }

  private async performType(stable_id: string, text: string): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "type", stable_id);
    if (!pre.ok) {
      this.emitWatch({ kind: "rejection", ts: Date.now(), verb: "type", reason: pre.envelope.reason, candidates: pre.envelope.candidates });
      const envelope = pre.envelope;
      // Track rejection in history
      this.historyBuffer.add({
        verb: "type",
        target_name: this.getTargetName(before, stable_id),
        ok: false,
        ts: Date.now(),
      });
      if (this.siteGraph) {
        try { this.siteGraph.recordFailure(new URL(this.currentUrl).hostname, stable_id); } catch { /* ignore */ }
      }
      return envelope;
    }
    if (pre.backendNodeId == null) {
      this.emitWatch({ kind: "rejection", ts: Date.now(), verb: "type", reason: "element_not_found", candidates: [] });
      const envelope: RejectionEnvelope = {
        ok: false,
        reason: "element_not_found",
        verb: "type",
        stable_id_attempted: stable_id,
        candidates: [],
        snapshot_at_attempt: before,
      };
      // Track rejection in history
      this.historyBuffer.add({
        verb: "type",
        target_name: this.getTargetName(before, stable_id),
        ok: false,
        ts: Date.now(),
      });
      if (this.siteGraph) {
        try { this.siteGraph.recordFailure(new URL(this.currentUrl).hostname, stable_id); } catch { /* ignore */ }
      }
      return envelope;
    }
    const urlBefore = this.currentUrl;
    await dispatchType(this.cdp, this.sessionId, pre.backendNodeId, text);
    await waitForMutationWindow();
    const after = await this.snapshot({ force: true });
    const result: ActionResult = {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "type", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
      diff: diffSnapshots(before, after),
    };
    this.emitWatch({ kind: "action", ts: Date.now(), verb: "type", stable_id, ok: true, diff: result.diff ? { added: result.diff.added.length, removed: result.diff.removed.length, changed: result.diff.changed.length } : undefined });
    // Track success in history
    this.historyBuffer.add({
      verb: "type",
      target_name: this.getTargetName(before, stable_id),
      ok: true,
      ts: Date.now(),
      url_after: this.currentUrl,
    });
    if (this.siteGraph) {
      try { this.siteGraph.recordSuccess(new URL(this.currentUrl).hostname, stable_id); } catch { /* ignore */ }
    }
    return result;
  }

  private async performScroll(stable_id: string | null, direction: ScrollDirection, amount: number): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "scroll", stable_id);
    if (!pre.ok) {
      this.emitWatch({ kind: "rejection", ts: Date.now(), verb: "scroll", reason: pre.envelope.reason, candidates: pre.envelope.candidates });
      const envelope = pre.envelope;
      // Track rejection in history
      this.historyBuffer.add({
        verb: "scroll",
        target_name: this.getTargetName(before, stable_id),
        ok: false,
        ts: Date.now(),
      });
      if (this.siteGraph && stable_id) {
        try { this.siteGraph.recordFailure(new URL(this.currentUrl).hostname, stable_id); } catch { /* ignore */ }
      }
      return envelope;
    }
    const urlBefore = this.currentUrl;
    await dispatchScroll(this.cdp, this.sessionId, pre.backendNodeId, direction, amount);
    await waitForMutationWindow();
    const after = await this.snapshot({ force: true });
    const result: ActionResult = {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "scroll", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
      diff: diffSnapshots(before, after),
    };
    this.emitWatch({ kind: "action", ts: Date.now(), verb: "scroll", stable_id, ok: true, diff: result.diff ? { added: result.diff.added.length, removed: result.diff.removed.length, changed: result.diff.changed.length } : undefined });
    // Track success in history
    this.historyBuffer.add({
      verb: "scroll",
      target_name: this.getTargetName(before, stable_id),
      ok: true,
      ts: Date.now(),
      url_after: this.currentUrl,
    });
    if (this.siteGraph && stable_id) {
      try { this.siteGraph.recordSuccess(new URL(this.currentUrl).hostname, stable_id); } catch { /* ignore */ }
    }
    return result;
  }

  private async performUpload(
    stable_id: string,
    fileSpec: { file_path?: string; content_base64?: string; filename?: string }
  ): Promise<UploadResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "upload", stable_id);
    if (!pre.ok) {
      this.emitWatch({ kind: "rejection", ts: Date.now(), verb: "upload", reason: pre.envelope.reason, candidates: pre.envelope.candidates });
      // Track rejection in history
      this.historyBuffer.add({
        verb: "upload",
        target_name: this.getTargetName(before, stable_id),
        ok: false,
        ts: Date.now(),
      });
      if (this.siteGraph) {
        try { this.siteGraph.recordFailure(new URL(this.currentUrl).hostname, stable_id); } catch { /* ignore */ }
      }
      // TODO(M14): mirror click/type and return the full RejectionEnvelope (candidates + snapshot_at_attempt)
      return { ok: false, reason: pre.envelope.reason };
    }
    if (pre.backendNodeId == null) {
      this.emitWatch({ kind: "rejection", ts: Date.now(), verb: "upload", reason: "element_not_found", candidates: [] });
      // Track rejection in history
      this.historyBuffer.add({
        verb: "upload",
        target_name: this.getTargetName(before, stable_id),
        ok: false,
        ts: Date.now(),
      });
      if (this.siteGraph) {
        try { this.siteGraph.recordFailure(new URL(this.currentUrl).hostname, stable_id); } catch { /* ignore */ }
      }
      return { ok: false, reason: "element_not_found" };
    }
    const result = await runUpload({
      cdp: {
        send: (method: string, params: unknown) =>
          this.cdp.send(method as string, params as Record<string, unknown>, this.sessionId),
      },
      resolveBackendNodeId: async (_sid: string) => pre.backendNodeId!,
    }, { stable_id, ...fileSpec });
    this.emitWatch({ kind: "action", ts: Date.now(), verb: "upload", stable_id, ok: result.ok });
    // Track result in history
    this.historyBuffer.add({
      verb: "upload",
      target_name: this.getTargetName(before, stable_id),
      ok: result.ok,
      ts: Date.now(),
      url_after: this.currentUrl,
    });
    // Record reliability outcome.
    if (this.siteGraph) {
      try {
        const domain = new URL(this.currentUrl).hostname;
        if (result.ok) this.siteGraph.recordSuccess(domain, stable_id);
        else this.siteGraph.recordFailure(domain, stable_id);
      } catch { /* ignore */ }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helper — attach post-action snapshot to any result.
  // ---------------------------------------------------------------------------

  /**
   * Attach a post-action snapshot to `result` unless `include_snapshot` is false.
   * Uses force:false (M9 cache) — typically free since the action already called
   * snapshot({ force: true }) and cached the result. Graceful degrade on error.
   */
  private async withSnapshot<T extends object>(
    result: T,
    include: boolean
  ): Promise<T & { snapshot?: Snapshot }> {
    if (!include) return result;
    try {
      const snap = await this.snapshot({ force: false });
      return { ...result, snapshot: snap };
    } catch {
      return result;
    }
  }

  // ---------------------------------------------------------------------------
  // Public action methods — accept Target (stable_id | intent) or plain string.
  // ---------------------------------------------------------------------------

  /**
   * Click an element. Pass `{ stable_id }` (exact, from snapshot) OR
   * `{ intent }` (natural language like "sign in button", resolved via
   * deterministic AX scoring).
   *
   * Also accepts a bare `string` for backwards-compatible call sites
   * (e.g. internal login-flow). All new call sites should pass a Target object.
   *
   * Pass `include_snapshot: false` to opt out of the post-action snapshot
   * (saves tokens when you don't need post-state).
   */
  async click(target: (Target & { include_snapshot?: boolean }) | string): Promise<ActionResultWithSnapshot<ActionResultWithIntent>> {
    if (this.paused) {
      return { ok: false, reason: "session_paused" as any, token: this.paused.token, handoff_url: this.paused.handoff_url } as any;
    }
    const t: Target & { include_snapshot?: boolean } = typeof target === "string" ? { stable_id: target } : target;
    const { include_snapshot, ...tTarget } = t as { include_snapshot?: boolean } & Target;
    const doSnap = include_snapshot !== false;
    const resolved = await this.resolveTarget(tTarget);
    if (!resolved.ok) {
      return this.withSnapshot({ ok: false as const, reason: resolved.reason, candidates: resolved.candidates }, doSnap);
    }
    // resolved.stable_id is string | null; click always requires a real id.
    if (resolved.stable_id == null) {
      return this.withSnapshot({ ok: false as const, reason: "missing_target" as const, candidates: [] }, doSnap);
    }
    const result = await this.performClick(resolved.stable_id);
    return this.withSnapshot(result, doSnap);
  }

  /**
   * Type into a text field. Pass `{ stable_id }` or `{ intent }` as the target.
   *
   * Also accepts a bare `string` stable_id for backwards compatibility.
   *
   * Pass `include_snapshot: false` to opt out of the post-action snapshot.
   */
  async type(target: (Target & { include_snapshot?: boolean }) | string, text: string): Promise<ActionResultWithSnapshot<ActionResultWithIntent>> {
    if (this.paused) {
      return { ok: false, reason: "session_paused" as any, token: this.paused.token, handoff_url: this.paused.handoff_url } as any;
    }
    const t: Target & { include_snapshot?: boolean } = typeof target === "string" ? { stable_id: target } : target;
    const { include_snapshot, ...tTarget } = t as { include_snapshot?: boolean } & Target;
    const doSnap = include_snapshot !== false;
    const resolved = await this.resolveTarget(tTarget);
    if (!resolved.ok) {
      return this.withSnapshot({ ok: false as const, reason: resolved.reason, candidates: resolved.candidates }, doSnap);
    }
    if (resolved.stable_id == null) {
      return this.withSnapshot({ ok: false as const, reason: "missing_target" as const, candidates: [] }, doSnap);
    }
    const result = await this.performType(resolved.stable_id, text);
    return this.withSnapshot(result, doSnap);
  }

  /**
   * Scroll the page or an element. Pass `{ stable_id }` (may be null for
   * window scroll), `{ intent }`, or a bare `string | null`.
   *
   * Pass `until` to scroll until a condition is met (scroll-until mode).
   * In this mode `direction` and `amount` default to "down" / 800px and
   * the method loops internally, returning {ok, scrolls, condition_met?, snapshot}.
   *
   * Pass `include_snapshot: false` to opt out of the post-action snapshot.
   */
  async scroll(
    target: (Target & { include_snapshot?: boolean }) | string | null,
    direction: ScrollDirection,
    amount: number,
    opts?: { until?: WaitForCondition; max_scrolls?: number; scroll_amount_px?: number; include_snapshot?: boolean },
  ): Promise<ActionResultWithSnapshot<ActionResultWithIntent> | ActionResultWithSnapshot<ScrollUntilResult>>;
  async scroll(
    target: (Target & { include_snapshot?: boolean }) | string | null,
    direction?: ScrollDirection,
    amount?: number,
    opts?: { until?: WaitForCondition; max_scrolls?: number; scroll_amount_px?: number; include_snapshot?: boolean },
  ): Promise<ActionResultWithSnapshot<ActionResultWithIntent> | ActionResultWithSnapshot<ScrollUntilResult>> {
    if (this.paused) {
      return { ok: false, reason: "session_paused" as any, token: this.paused.token, handoff_url: this.paused.handoff_url } as any;
    }
    // Scroll-until mode: delegate to runScrollUntil.
    if (opts?.until) {
      const doSnap = opts.include_snapshot !== false;
      const r = await runScrollUntil(
        {
          snapshot: async (o) => {
            const snap = await this.snapshot(o);
            return { url: snap.url, nodes: flattenSnapshot(snap.root) };
          },
          runtimeEval: async (expr: string) => {
            const res = await this.cdp.send(
              "Runtime.evaluate",
              { expression: expr, returnByValue: true },
              this.sessionId,
            ) as { result?: { value?: unknown } };
            return res.result?.value;
          },
          scroll: (_t, _d, a) => this.performScroll(null, "down", a),
        },
        { until: opts.until, max_scrolls: opts.max_scrolls, scroll_amount_px: opts.scroll_amount_px ?? amount },
      );
      return this.withSnapshot(r, doSnap);
    }

    // Normal pixel-based scroll path (unchanged).
    let raw: (Target & { include_snapshot?: boolean }) | null;
    if (target === null) {
      raw = { stable_id: null };
    } else if (typeof target === "string") {
      raw = { stable_id: target };
    } else {
      raw = target;
    }
    const { include_snapshot, ...tTarget } = (raw ?? { stable_id: null }) as { include_snapshot?: boolean } & Target;
    const doSnap = include_snapshot !== false;
    const resolved = await this.resolveTarget(tTarget);
    if (!resolved.ok) {
      return this.withSnapshot({ ok: false as const, reason: resolved.reason, candidates: resolved.candidates }, doSnap);
    }
    const result = await this.performScroll(resolved.stable_id, direction ?? "down", amount ?? 800);
    return this.withSnapshot(result, doSnap);
  }

  /**
   * Press a key. Pass `include_snapshot: false` to opt out of the post-action snapshot.
   */
  async press_key(key: string, opts: { include_snapshot?: boolean } = {}): Promise<ActionResultWithSnapshot<ActionResult>> {
    if (this.paused) {
      return { ok: false, reason: "session_paused" as any, token: this.paused.token, handoff_url: this.paused.handoff_url } as any;
    }
    const doSnap = opts.include_snapshot !== false;
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "press_key", null);
    if (!pre.ok) {
      this.emitWatch({ kind: "rejection", ts: Date.now(), verb: "press_key", reason: pre.envelope.reason, candidates: pre.envelope.candidates });
      const envelope = pre.envelope;
      // Track rejection in history (no target for keyboard action)
      this.historyBuffer.add({
        verb: "press_key",
        target_name: null,
        ok: false,
        ts: Date.now(),
      });
      return this.withSnapshot(envelope, doSnap);
    }
    const urlBefore = this.currentUrl;
    await dispatchPress(this.cdp, this.sessionId, key);
    await waitForMutationWindow();
    const after = await this.snapshot({ force: true });
    const result: ActionResult = {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "press_key", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
      diff: diffSnapshots(before, after),
    };
    this.emitWatch({ kind: "action", ts: Date.now(), verb: "press_key", stable_id: null, ok: true, diff: result.diff ? { added: result.diff.added.length, removed: result.diff.removed.length, changed: result.diff.changed.length } : undefined });
    // Track success in history
    this.historyBuffer.add({
      verb: "press_key",
      target_name: null,
      ok: true,
      ts: Date.now(),
      url_after: this.currentUrl,
    });
    return this.withSnapshot(result, doSnap);
  }

  /**
   * Upload a file to an `<input type="file">` element.
   * Pass `{ stable_id }` or `{ intent }` to target the file input.
   * File contents come from EITHER `{ file_path }` (path on disk) OR
   * `{ content_base64, filename }` (base64-encoded bytes with a suggested name).
   * Routes through the M5 watchdog — rejects if the element is not found or
   * is disabled.
   *
   * Pass `include_snapshot: false` to opt out of the post-action snapshot.
   */
  async upload(
    target: (Target & { include_snapshot?: boolean }) | string,
    fileSpec: { file_path?: string; content_base64?: string; filename?: string },
  ): Promise<ActionResultWithSnapshot<UploadResult & { candidates?: FindCandidate[] }>> {
    if (this.paused) {
      return { ok: false, reason: "session_paused" as any, token: this.paused.token, handoff_url: this.paused.handoff_url } as any;
    }
    const t: Target & { include_snapshot?: boolean } = typeof target === "string" ? { stable_id: target } : target;
    const { include_snapshot, ...tTarget } = t as { include_snapshot?: boolean } & Target;
    const doSnap = include_snapshot !== false;
    const resolved = await this.resolveTarget(tTarget);
    if (!resolved.ok) {
      return this.withSnapshot({ ok: false as const, reason: resolved.reason, candidates: resolved.candidates }, doSnap);
    }
    if (resolved.stable_id == null) {
      return this.withSnapshot({ ok: false as const, reason: "missing_target" as const, candidates: [] }, doSnap);
    }
    const result = await this.performUpload(resolved.stable_id, fileSpec);
    return this.withSnapshot(result, doSnap);
  }

  async login(input: LoginInput & { totp_secret?: string; include_snapshot?: boolean }): Promise<ActionResultWithSnapshot<LoginResult>> {
    if (this.paused) {
      return { ok: false, reason: "session_paused" as any, token: this.paused.token, handoff_url: this.paused.handoff_url } as any;
    }
    const doSnap = input.include_snapshot !== false;
    const code = input.totp_code ?? (input.totp_secret ? totpCode(input.totp_secret) : undefined);
    const result = await performLogin(
      {
        snapshot: () => this.snapshot(),
        type: (id, text) => this.type(id, text),
        click: (id) => this.click(id),
        pressKey: (key) => this.press_key(key),
      },
      { username: input.username, password: input.password, totp_code: code }
    );

    // Fallback: some browsers (e.g. lightpanda) assign role="none" to
    // type="password" inputs, hiding them from the accessibility tree and
    // causing performLogin to return login_form_not_found. Try a CDP
    // JavaScript-based form fill when that happens.
    if (!result.ok && result.reason === "login_form_not_found") {
      const jsResult = await this.jsFormLogin(input.username, input.password);
      if (jsResult !== null) {
        // Track login success in history
        this.historyBuffer.add({
          verb: "login",
          target_name: null,
          ok: true,
          ts: Date.now(),
          url_after: this.currentUrl,
        });
        return this.withSnapshot(jsResult, doSnap);
      }
    }

    // Track login result in history (after all fallbacks)
    this.historyBuffer.add({
      verb: "login",
      target_name: null,
      ok: result.ok,
      ts: Date.now(),
      url_after: this.currentUrl,
    });

    return this.withSnapshot(result, doSnap);
  }

  /**
   * JavaScript-based form fill fallback for engines where password inputs are
   * not exposed in the accessibility tree. Uses Runtime.evaluate to set input
   * values and calls form.submit(). Returns null when JS evaluation is
   * unavailable or the form cannot be located.
   */
  private async jsFormLogin(username: string, password: string): Promise<LoginResult | null> {
    const urlBefore = this.currentUrl;
    try {
      // Collect cookies before submit to detect newly added ones.
      let cookiesBefore: Array<{ name: string; value: string }> = [];
      try {
        const res = (await this.cdp.send("Network.getCookies", {}, this.sessionId)) as {
          cookies: Array<{ name: string; value: string }>;
        };
        cookiesBefore = res.cookies;
      } catch { /* Network.getCookies unavailable; proceed without cookie check */ }

      // Fill username and password by CSS attribute selectors.
      const fillExpr = `
        (function() {
          const usernameField =
            document.querySelector('input[type="text"]') ||
            document.querySelector('input[type="email"]') ||
            document.querySelector('input[name*="user"]') ||
            document.querySelector('input[name*="email"]') ||
            document.querySelector('input[name*="login"]');
          const passwordField = document.querySelector('input[type="password"]');
          const form = document.querySelector('form');
          if (!usernameField || !passwordField || !form) return "MISSING_FIELDS";
          usernameField.value = ${JSON.stringify(username)};
          passwordField.value = ${JSON.stringify(password)};
          return JSON.stringify({ action: form.action });
        })()
      `;
      const fillRes = (await this.cdp.send(
        "Runtime.evaluate",
        { expression: fillExpr, returnByValue: true },
        this.sessionId
      )) as { result: { type: string; value: unknown } };

      if (fillRes.result.value === "MISSING_FIELDS") return null;

      // Submit the form.
      await this.cdp.send(
        "Runtime.evaluate",
        { expression: "document.querySelector('form').submit(); undefined", returnByValue: true },
        this.sessionId
      );

      // Wait for the navigation to settle.
      await new Promise((r) => setTimeout(r, 1500));

      // Check for newly added cookies — presence of new cookies indicates
      // the server accepted the credentials and established a session.
      let newCookies: Array<{ name: string; value: string }> = [];
      try {
        const res = (await this.cdp.send("Network.getCookies", {}, this.sessionId)) as {
          cookies: Array<{ name: string; value: string }>;
        };
        newCookies = res.cookies.filter(
          (c) => !cookiesBefore.some((b) => b.name === c.name && b.value === c.value)
        );
      } catch { /* ignore */ }

      // Try to get the actual URL the browser landed on after form submit.
      let urlAfter = this.currentUrl;
      try {
        const locRes = (await this.cdp.send(
          "Runtime.evaluate",
          { expression: "window.location.href", returnByValue: true },
          this.sessionId
        )) as { result: { type: string; value: unknown } };
        if (typeof locRes.result.value === "string" && locRes.result.value) {
          urlAfter = locRes.result.value;
        }
      } catch { /* ignore */ }

      if (newCookies.length > 0) {
        return { ok: true, url_before: urlBefore, url_after: urlAfter };
      }

      // No new cookies — login likely failed.
      return { ok: false, reason: "login_did_not_advance" };
    } catch {
      // Runtime.evaluate or Network.getCookies not supported.
      return null;
    }
  }

  async extract(query: ExtractQuery): Promise<string | null | Record<string, string | null> | PaginateResult> {
    if (this.paused) {
      return null;
    }
    // Paginate mode: when paginate option is present, run the click-next loop.
    if (query.paginate) {
      const paginateOpts = query.paginate;
      // Build a session-like object for runPaginate using this session's methods.
      const paginateSession = {
        extractOnce: async () => {
          if ("selectors" in query && query.selectors) {
            return runExtract(this.cdp, this.sessionId, { selectors: query.selectors });
          }
          if ("css" in query && query.css) {
            return runExtract(this.cdp, this.sessionId, { css: query.css });
          }
          throw new Error("extract with paginate requires either css or selectors");
        },
        click: (target: { stable_id?: string; intent?: string }) =>
          this.click({ ...target, include_snapshot: false }),
        waitFor: (c: WaitForCondition) => this.waitFor(c),
      };
      const result = await runPaginate(paginateSession, paginateOpts);
      this.historyBuffer.add({
        verb: "extract",
        target_name: null,
        ok: true,
        ts: Date.now(),
        url_after: this.currentUrl,
      });
      return result;
    }

    // Single-page extract (existing behavior).
    const result = await runExtract(this.cdp, this.sessionId, query);
    // Track extract in history (success is determined by result not being null)
    const ok = result !== null;
    this.historyBuffer.add({
      verb: "extract",
      target_name: null,
      ok,
      ts: Date.now(),
      url_after: this.currentUrl,
    });
    return result;
  }

  async waitFor(c: WaitForCondition): Promise<WaitForResult> {
    return runWaitFor({
      snapshot: async (o) => {
        const snap = await this.snapshot(o);
        return { url: snap.url, nodes: flattenSnapshot(snap.root) };
      },
      runtimeEval: async (expr: string) => {
        const r = await this.cdp.send(
          "Runtime.evaluate",
          { expression: expr, returnByValue: true },
          this.sessionId
        ) as { result?: { value?: unknown } };
        return r.result?.value;
      },
    }, c);
  }

  /**
   * Manually accept or dismiss a pending JS dialog (alert/confirm/prompt/beforeunload).
   * Cancels the auto-dismiss timer. No-op when no dialog is open (doesn't throw).
   *
   * NOTE: Auto-dismiss handles 99% of cases — this method exists for the rare
   * case where the agent needs to accept a confirm/prompt and provide a text response.
   * Exposed via JSON-RPC `dialog` method; NOT in the MCP tool surface.
   */
  async handleDialog(action: "accept" | "dismiss", text?: string): Promise<void> {
    if (!this.dialogHandler) return;
    await this.dialogHandler.manualHandle(action, text);
  }

  async close(): Promise<void> {
    try { await this.captureToVault(); } catch { /* best-effort */ }
    await this.cdp.close();
    if (this.engineHandle) {
      await this.engineHandle.release();
    } else {
      await this.engine.close();
    }
  }

  async restoreFromVault(): Promise<void> {
    if (!this.vault || !this.profile) return;
    await this.cdp.send("Network.enable", {}, this.sessionId);
    const stored = this.vault.list(this.profile);
    await restoreCookies(this.cdp, this.sessionId, stored);
  }

  async captureToVault(): Promise<void> {
    if (!this.vault || !this.profile) return;
    const cookies = await captureCookies(this.cdp, this.sessionId);
    this.vault.put(this.profile, cookies);
  }

  getProfile(): string | null {
    return this.profile;
  }

  setProfile(profile: string | null): void {
    this.profile = profile;
  }
}

function waitForMutationWindow(): Promise<void> {
  return new Promise((r) => setTimeout(r, 500));
}

/**
 * Count all AX nodes in the snapshot tree (root included).
 * Used by summarize() to include a node-count in generic fallback summaries.
 */
function countAxNodes(root: SnapshotNode): number {
  let n = 0;
  const count = (node: SnapshotNode) => {
    n++;
    if (node.c) for (const child of node.c) count(child);
  };
  count(root);
  return n;
}

/**
 * Flatten a snapshot tree into the { i, r, n } node array that runFind expects.
 * Shared between resolveTarget() and waitFor().
 */
function flattenSnapshot(root: SnapshotNode): Array<{ i: string; r: string; n: string }> {
  const nodes: Array<{ i: string; r: string; n: string }> = [];
  const walk = (node: SnapshotNode) => {
    nodes.push({ i: node.i, r: node.r, n: node.n });
    for (const child of node.c ?? []) walk(child);
  };
  walk(root);
  return nodes;
}

/**
 * Resolve the browser-level CDP WebSocket URL.
 *
 * lightpanda returns an empty /json/list until a target is created, so we
 * try /json/list first (standard Chrome behaviour) and fall back to
 * /json/version which always carries webSocketDebuggerUrl in lightpanda.
 */
// ---------------------------------------------------------------------------
// Test seam — injected constructor for unit tests.
// ---------------------------------------------------------------------------

/**
 * Shape of the injected dependencies used by `Session.fromInjected`.
 * Production code must use `Session.create()` instead.
 */
export interface SessionInjected {
  engine: { close: () => Promise<void> };
  cdp: { send: (m: string, p?: Record<string, unknown>, s?: string) => Promise<unknown>; close?: () => Promise<void> };
  sessionId: string;
  vault?: VaultStore | null;
  profile?: string;
  url?: string;
}

// Attach fromInjected as a static method so tests can call Session.fromInjected(...)
// without triggering the private constructor through normal TypeScript paths.
(Session as unknown as {
  fromInjected: (i: SessionInjected) => Session;
}).fromInjected = (i: SessionInjected): Session => {
  // Add no-op on/off stubs if the injected CDP doesn't have them, and fire
  // Page.loadEventFired immediately when registered so that waitForPageReady
  // resolves instantly in unit tests (no real browser, no real events).
  const injectedOnOff = "on" in i.cdp && typeof (i.cdp as { on?: unknown }).on === "function"
    ? {}
    : {
        on(event: string, fn: (p: unknown) => void) {
          if (event === "Page.loadEventFired") {
            // Simulate instant load by firing the event in the next microtask.
            Promise.resolve().then(() => fn({}));
          }
          // Network events: no-op — inflight stays 0, idle fires immediately after load.
        },
        off(_event: string, _fn: (p: unknown) => void) { /* no-op */ },
      };
  const fakeCdp = { ...i.cdp, close: i.cdp.close ?? (async () => {}), ...injectedOnOff };
  // Use a real Watchdog so that evaluatePre can resolve backendNodeId via the
  // snapshot's _resolver (populated by transformAxTree). Tests that need DOM
  // interactions (click, type) will work correctly as long as the CDP mock
  // returns a valid DOM.getBoxModel response.
  const fakeWatchdog = new Watchdog();

  const inst = new (Session as unknown as new (
    engine: unknown,
    cdp: unknown,
    sessionId: string,
    url: string,
    lastSnapshot: null,
    siteGraph: null,
    watchdog: Watchdog,
    vault: VaultStore | null,
    profile: string | null,
    watchBus: WatchBus | null,
    watchId: string | null
  ) => Session)(
    i.engine,
    fakeCdp,
    i.sessionId,
    i.url ?? "about:blank",
    null,
    null,
    fakeWatchdog,
    i.vault ?? null,
    i.profile ?? null,
    null,
    null
  );
  // fromInjected stubs fire Page.loadEventFired instantly with no inflight
  // requests, so the 500 ms idle window is unnecessary — opt into 0 ms so
  // unit tests using goto() don't pay the penalty per call.
  (inst as unknown as { networkIdleMs: number }).networkIdleMs = 0;
  return inst;
};

async function resolveBrowserWsUrl(cdpBaseUrl: string): Promise<string | null> {
  // 1. Try /json/list (standard Chrome DevTools convention)
  try {
    const res = await fetch(`${cdpBaseUrl}/json/list`);
    if (res.ok) {
      const targets = (await res.json()) as Array<{ webSocketDebuggerUrl?: string }>;
      if (targets[0]?.webSocketDebuggerUrl) return targets[0].webSocketDebuggerUrl;
    }
  } catch {
    // fall through
  }
  // 2. Fall back to /json/version (lightpanda exposes browser-level WS here)
  try {
    const res = await fetch(`${cdpBaseUrl}/json/version`);
    if (res.ok) {
      const info = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    }
  } catch {
    // fall through
  }
  return null;
}

export type { LoginInput, LoginResult } from "../auth/login-flow.js";
export type { ExtractQuery } from "./extract.js";
export type { WaitForCondition, WaitForResult } from "./wait.js";
export type { UploadResult } from "./upload.js";
