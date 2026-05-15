import { spawnLightpanda, type LightpandaProcess } from "../engine/lifecycle.js";
import { CdpClient } from "../engine/cdp-client.js";
import { transformAxTree } from "../snapshot/adapter.js";
import { diffSnapshots } from "../snapshot/poller.js";
import type { AXNode, Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { locateLightpanda } from "../engine/binary.js";
import type { SiteGraphCache } from "../cache/site-graph.js";
import { Watchdog } from "../watchdog/watchdog.js";
import { dispatchClick, dispatchType, dispatchScroll, dispatchPress, type ScrollDirection } from "./actions.js";
import type { RejectionEnvelope, Warning, PolicyDocument } from "../watchdog/types.js";
import { VaultStore } from "../vault/store.js";
import { captureCookies } from "../vault/capture.js";
import { restoreCookies } from "../vault/restore.js";
import { performLogin, type LoginInput, type LoginResult } from "../auth/login-flow.js";
import { totpCode } from "../auth/totp.js";

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
export type ActionResult = { ok: true; warnings: Warning[] } | RejectionEnvelope;

export class Session {
  private constructor(
    private readonly engine: LightpandaProcess,
    private readonly cdp: CdpClient,
    private readonly sessionId: string,
    private currentUrl: string,
    private lastSnapshot: Snapshot | null = null,
    private readonly siteGraph: SiteGraphCache | null = null,
    private readonly watchdog: Watchdog,
    private readonly vault: VaultStore | null = null,
    private profile: string | null = null
  ) {}

  static async create(opts: SessionOptions = {}): Promise<Session> {
    const binary = opts.binary ?? (await locateLightpanda());
    const engine = await spawnLightpanda({
      binary,
      readinessTimeoutMs: opts.readinessTimeoutMs,
      log: opts.log,
    });

    // Discover the CDP WebSocket.
    // lightpanda returns an empty /json/list until a target is created, so we
    // fall back to /json/version which always carries the browser-level WS URL.
    const wsUrl = await resolveBrowserWsUrl(engine.cdpBaseUrl);
    if (!wsUrl) {
      await engine.close();
      throw new Error("Session.create: could not discover CDP WebSocket URL from /json/list or /json/version");
    }
    const cdp = new CdpClient(wsUrl);
    await cdp.ready;

    // Create a fresh target and attach to it (sessionId for subsequent calls).
    const sessionId = await cdp.createAndAttachTarget("about:blank");
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Accessibility.enable", {}, sessionId);

    const wd = new Watchdog({ cache: opts.siteGraph ?? null });
    const inst = new Session(
      engine, cdp, sessionId, "about:blank", null,
      opts.siteGraph ?? null, wd,
      opts.vault ?? null,
      opts.profile ?? null
    );
    if (opts.profile && opts.vault) {
      await inst.restoreFromVault();
    }
    return inst;
  }

  async goto(url: string): Promise<void> {
    await this.cdp.send("Page.navigate", { url }, this.sessionId);
    this.currentUrl = url;
    // Crude wait — sufficient for v0. M5 will hook Page.loadEventFired.
    // Bumped from 1000ms to 1500ms to match the M2 spike PoC's working timing.
    await new Promise((r) => setTimeout(r, 1500));
  }

  async snapshot(): Promise<Snapshot> {
    const tree = (await this.cdp.send(
      "Accessibility.getFullAXTree",
      {},
      this.sessionId
    )) as { nodes: AXNode[] };
    const root = tree.nodes.find((n) => !n.parentId) ?? tree.nodes[0];
    if (!root) throw new Error("snapshot: Accessibility.getFullAXTree returned no nodes");
    const snap = transformAxTree(tree.nodes, root.nodeId, this.currentUrl);
    this.lastSnapshot = snap;
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
    const after = await this.snapshot();
    return {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "click", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
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
    const after = await this.snapshot();
    return {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "type", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
    };
  }

  async scroll(stable_id: string | null, direction: ScrollDirection, amount: number): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "scroll", stable_id);
    if (!pre.ok) return pre.envelope;
    const urlBefore = this.currentUrl;
    await dispatchScroll(this.cdp, this.sessionId, pre.backendNodeId, direction, amount);
    await waitForMutationWindow();
    const after = await this.snapshot();
    return {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "scroll", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
    };
  }

  async press_key(key: string): Promise<ActionResult> {
    const before = await this.snapshot();
    const pre = this.watchdog.evaluatePre(before, "press_key", null);
    if (!pre.ok) return pre.envelope;
    const urlBefore = this.currentUrl;
    await dispatchPress(this.cdp, this.sessionId, key);
    await waitForMutationWindow();
    const after = await this.snapshot();
    return {
      ok: true,
      warnings: this.watchdog.evaluatePost({
        verb: "press_key", before, after, urlBefore, urlAfter: this.currentUrl,
      }),
    };
  }

  async login(input: LoginInput & { totp_secret?: string }): Promise<LoginResult> {
    const code = input.totp_code ?? (input.totp_secret ? totpCode(input.totp_secret) : undefined);
    return await performLogin(
      {
        snapshot: () => this.snapshot(),
        type: (id, text) => this.type(id, text),
        click: (id) => this.click(id),
        pressKey: (key) => this.press_key(key),
      },
      { username: input.username, password: input.password, totp_code: code }
    );
  }

  async close(): Promise<void> {
    try { await this.captureToVault(); } catch { /* best-effort */ }
    await this.cdp.close();
    await this.engine.close();
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
  const fakeCdp = { ...i.cdp, close: i.cdp.close ?? (async () => {}) };
  // Build a minimal watchdog-like object that satisfies Watchdog's interface
  const fakeWatchdog = {
    evaluatePre: () => ({ ok: true as const, backendNodeId: null }),
    evaluatePost: () => [],
    setPolicy: () => {},
  } as unknown as Watchdog;

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
