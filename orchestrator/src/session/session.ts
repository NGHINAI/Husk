import { spawnLightpanda, type LightpandaProcess } from "../engine/lifecycle.js";
import { CdpClient } from "../engine/cdp-client.js";
import { transformAxTree } from "../snapshot/adapter.js";
import { diffSnapshots } from "../snapshot/poller.js";
import type { AXNode, Snapshot, SnapshotDiff } from "../snapshot/types.js";
import { locateLightpanda } from "../engine/binary.js";

export interface SessionOptions {
  /** Override binary path. Defaults to LIGHTPANDA_BIN env / PATH discovery. */
  binary?: string;
  /** Pass through to lifecycle manager. */
  readinessTimeoutMs?: number;
  /** Logger for engine stderr/stdout. Defaults to no-op. */
  log?: (line: string) => void;
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
export class Session {
  private constructor(
    private readonly engine: LightpandaProcess,
    private readonly cdp: CdpClient,
    private readonly sessionId: string,
    private currentUrl: string,
    private lastSnapshot: Snapshot | null = null
  ) {}

  static async create(opts: SessionOptions = {}): Promise<Session> {
    const binary = opts.binary ?? (await locateLightpanda());
    const engine = await spawnLightpanda({
      binary,
      readinessTimeoutMs: opts.readinessTimeoutMs,
      log: opts.log,
    });

    // Discover the CDP WebSocket via /json/list and open a connection.
    const listRes = await fetch(`${engine.cdpBaseUrl}/json/list`);
    const targets = (await listRes.json()) as Array<{ webSocketDebuggerUrl?: string }>;
    if (!targets[0]?.webSocketDebuggerUrl) {
      await engine.close();
      throw new Error("Session.create: lightpanda /json/list returned no usable target");
    }
    const cdp = new CdpClient(targets[0].webSocketDebuggerUrl);
    await cdp.ready;

    // Create a fresh target and attach to it (sessionId for subsequent calls).
    const sessionId = await cdp.createAndAttachTarget("about:blank");
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Accessibility.enable", {}, sessionId);

    return new Session(engine, cdp, sessionId, "about:blank");
  }

  async goto(url: string): Promise<void> {
    await this.cdp.send("Page.navigate", { url }, this.sessionId);
    this.currentUrl = url;
    // Crude wait — sufficient for v0. M5 will hook Page.loadEventFired.
    await new Promise((r) => setTimeout(r, 1000));
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
    return snap;
  }

  async snapshotDiff(): Promise<SnapshotDiff | null> {
    const prior = this.lastSnapshot;
    const current = await this.snapshot();
    if (!prior) return null;
    return diffSnapshots(prior, current);
  }

  async close(): Promise<void> {
    await this.cdp.close();
    await this.engine.close();
  }
}
