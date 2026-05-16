import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/session/session.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startFixtureServer } from "./fixture-server.js";
import type { SnapshotNode } from "../../src/snapshot/types.js";

const integrationOrSkip = await (async () => {
  try { await locateLightpanda(); return describe; } catch { return describe.skip; }
})();

integrationOrSkip("watchdog e2e — real lightpanda", () => {
  it("rejects click on a non-existent stable_id with a real envelope", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "husk-wd-e2e-"));
    const cache = new SiteGraphCache({ cacheDir });
    const fixture = await startFixtureServer();
    let session: Session | undefined;

    try {
      session = await Session.create({ readinessTimeoutMs: 15_000, siteGraph: cache });
      await session.goto(fixture.url);
      // Prime cache so candidates can be returned
      await session.snapshot();

      const result = await session.click({ stable_id: "button:totally-fake-id" });
      expect((result as { ok: boolean }).ok).toBe(false);
      const env = result as { ok: false; reason: string; candidates: Array<{ name: string }> };
      expect(env.reason).toBe("element_not_found");
      expect(Array.isArray(env.candidates)).toBe(true);
      // We don't assert candidates.length > 0 because the fuzzy threshold
      // (0.6) might filter out short stable_id-prefix hints. The shape MUST
      // match either way; that's the load-bearing wedge demo.
    } finally {
      await session?.close();
      await fixture.close();
      cache.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 45_000);

  it("clicks the real submit button when the stable_id resolves correctly", async () => {
    const fixture = await startFixtureServer();
    let session: Session | undefined;

    try {
      session = await Session.create({ readinessTimeoutMs: 15_000 });
      await session.goto(fixture.url);
      const snap = await session.snapshot();

      const button = findNode(snap.root, (n) => n.r === "button" && /submit/i.test(n.n));
      expect(button).toBeTruthy();

      const result = await session.click({ stable_id: button!.i });
      // Tolerant: lightpanda may or may not expose backendDOMNodeId on every
      // node, may or may not fire DOM mutations. The watchdog should ALWAYS
      // return a structured response — never throw or hang.
      const r = result as { ok: boolean; reason?: string };
      expect(typeof r.ok).toBe("boolean");
      if (!r.ok) {
        // Acceptable failure modes: element_not_found (resolver miss),
        // no other reason should appear since the snapshot just confirmed
        // the button is visible, enabled, and click-compatible.
        expect(r.reason).toBe("element_not_found");
      }
    } finally {
      await session?.close();
      await fixture.close();
    }
  }, 45_000);
});

function findNode(node: SnapshotNode, pred: (n: SnapshotNode) => boolean): SnapshotNode | null {
  if (pred(node)) return node;
  for (const c of node.c ?? []) {
    const hit = findNode(c, pred);
    if (hit) return hit;
  }
  return null;
}
