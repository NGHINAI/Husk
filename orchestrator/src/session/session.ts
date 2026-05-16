import { spawnLightpanda, type LightpandaProcess } from "../engine/lifecycle.js";
import { CdpClient } from "../engine/cdp-client.js";
import { waitForPageReady } from "./page-ready.js";
import { transformAxTree } from "../snapshot/adapter.js";
import { diffSnapshots } from "../snapshot/poller.js";
import type { AXNode, Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { locateLightpanda } from "../engine/binary.js";
import type { SiteGraphCache } from "../cache/site-graph.js";
import { Watchdog } from "../watchdog/watchdog.js";
import { dispatchClick, dispatchType, dispatchScroll, dispatchPress, type ScrollDirection } from "./actions.js";
import { runExtract, type ExtractQuery } from "./extract.js";
import type { RejectionEnvelope, Warning, PolicyDocument } from "../watchdog/types.js";
import { VaultStore } from "../vault/store.js";
import { captureCookies } from "../vault/capture.js";
import { restoreCookies } from "../vault/restore.js";
import { performLogin, type LoginInput, type LoginResult } from "../auth/login-flow.js";
import { totpCode } from "../auth/totp.js";
import type { EngineHandle } from "../engine/pool.js";

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

export class Session {
  private lastSnapshotAt = 0;
  private lastSnapshotMode: "full" | "terse" = "full";

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
    private readonly engineHandle: EngineHandle | null = null
  ) {}

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

    const wd = new Watchdog({ cache: opts.siteGraph ?? null });
    const inst = new Session(
      engineProcess, cdp, sessionId, "about:blank", null,
      opts.siteGraph ?? null, wd,
      opts.vault ?? null,
      opts.profile ?? null,
      engineHandle
    );
    if (opts.profile && opts.vault) {
      await inst.restoreFromVault();
    }
    return inst;
  }

  async goto(url: string): Promise<void> {
    await this.cdp.send("Page.navigate", { url }, this.sessionId);
    this.currentUrl = url;
    // Wait for the page to reach a network-idle state instead of a fixed delay.
    // Resolves when Page.loadEventFired fires AND in-flight requests are gone for
    // 500 ms, or after a hard 8-second cap (max_wait fallback).
    // Requires Page.enable + Network.enable to be called during session init.
    await waitForPageReady(this.cdp, { networkIdleMs: 500, maxWaitMs: 8000 });
    // Eager snapshot: cache lastSnapshot so the agent's next snapshot() call is instant.
    // Use force:true so navigation always fetches a fresh AX tree (not a stale cache).
    // Best-effort: don't fail goto if AX capture has a transient issue.
    try {
      await this.snapshot({ force: true });
    } catch {
      // best-effort
    }
  }

  async snapshot(opts: { maxAgeMs?: number; force?: boolean; mode?: "full" | "terse" } = {}): Promise<Snapshot> {
    const maxAge = opts.maxAgeMs ?? 500;
    const mode = opts.mode ?? "full";
    const fresh =
      !opts.force &&
      this.lastSnapshot &&
      Date.now() - this.lastSnapshotAt < maxAge &&
      this.lastSnapshotMode === mode;
    if (fresh) return this.lastSnapshot!;
    const tree = (await this.cdp.send(
      "Accessibility.getFullAXTree", {}, this.sessionId
    )) as { nodes: AXNode[] };
    const root = tree.nodes.find((n) => !n.parentId) ?? tree.nodes[0];
    if (!root) throw new Error("snapshot: Accessibility.getFullAXTree returned no nodes");
    const snap = transformAxTree(tree.nodes, root.nodeId, this.currentUrl, { mode });
    this.lastSnapshot = snap;
    this.lastSnapshotAt = Date.now();
    this.lastSnapshotMode = mode;
    this.siteGraph?.observe(snap);
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

  async click(stable_id: string): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "click", stable_id);
    if (!pre.ok) return pre.envelope;
    if (pre.backendNodeId == null) {
      return {
        ok: false,
        reason: "element_not_found",
        verb: "click",
        stable_id_attempted: stable_id,
        candidates: [],
        snapshot_at_attempt: before,
      };
    }
    const urlBefore = this.currentUrl;
    await dispatchClick(this.cdp, this.sessionId, pre.backendNodeId);
    await waitForMutationWindow();
    const after = await this.snapshot({ force: true });
    return {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "click", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
      diff: diffSnapshots(before, after),
    };
  }

  async type(stable_id: string, text: string): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "type", stable_id);
    if (!pre.ok) return pre.envelope;
    if (pre.backendNodeId == null) {
      return {
        ok: false,
        reason: "element_not_found",
        verb: "type",
        stable_id_attempted: stable_id,
        candidates: [],
        snapshot_at_attempt: before,
      };
    }
    const urlBefore = this.currentUrl;
    await dispatchType(this.cdp, this.sessionId, pre.backendNodeId, text);
    await waitForMutationWindow();
    const after = await this.snapshot({ force: true });
    return {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "type", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
      diff: diffSnapshots(before, after),
    };
  }

  async scroll(stable_id: string | null, direction: ScrollDirection, amount: number): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "scroll", stable_id);
    if (!pre.ok) return pre.envelope;
    const urlBefore = this.currentUrl;
    await dispatchScroll(this.cdp, this.sessionId, pre.backendNodeId, direction, amount);
    await waitForMutationWindow();
    const after = await this.snapshot({ force: true });
    return {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "scroll", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
      diff: diffSnapshots(before, after),
    };
  }

  async press_key(key: string): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "press_key", null);
    if (!pre.ok) return pre.envelope;
    const urlBefore = this.currentUrl;
    await dispatchPress(this.cdp, this.sessionId, key);
    await waitForMutationWindow();
    const after = await this.snapshot({ force: true });
    return {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "press_key", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
      diff: diffSnapshots(before, after),
    };
  }

  async login(input: LoginInput & { totp_secret?: string }): Promise<LoginResult> {
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
      if (jsResult !== null) return jsResult;
    }

    return result;
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

  async extract(query: ExtractQuery): Promise<string | null> {
    return await runExtract(this.cdp, this.sessionId, query);
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

  return new (Session as unknown as new (
    engine: unknown,
    cdp: unknown,
    sessionId: string,
    url: string,
    lastSnapshot: null,
    siteGraph: null,
    watchdog: Watchdog,
    vault: VaultStore | null,
    profile: string | null
  ) => Session)(
    i.engine,
    fakeCdp,
    i.sessionId,
    i.url ?? "about:blank",
    null,
    null,
    fakeWatchdog,
    i.vault ?? null,
    i.profile ?? null
  );
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
