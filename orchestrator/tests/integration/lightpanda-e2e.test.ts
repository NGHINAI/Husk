import { describe, expect, it } from "vitest";
import { Session } from "../../src/session/session.js";
import { startFixtureServer } from "./fixture-server.js";
import { locateLightpanda } from "../../src/engine/binary.js";

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

integrationOrSkip("end-to-end with prebuilt lightpanda", () => {
  it("produces a valid spec-§5.2 snapshot of the fixture page", async () => {
    const fixture = await startFixtureServer();
    let session: Session | undefined;
    try {
      session = await Session.create({ readinessTimeoutMs: 15_000 });
      await session.goto(fixture.url);
      const snap = await session.snapshot();
      expect(snap.v).toBe(1);
      expect(snap.url).toBe(fixture.url);
      expect(snap.count).toBeGreaterThan(0);
      const found = findById(snap.root, (n) => n.r === "button" && n.n.includes("Submit"));
      expect(found).toBeTruthy();
    } finally {
      await session?.close();
      await fixture.close();
    }
  }, 30_000);
});

function findById(
  node: import("../../src/snapshot/types.js").SnapshotNode,
  pred: (n: import("../../src/snapshot/types.js").SnapshotNode) => boolean
): import("../../src/snapshot/types.js").SnapshotNode | null {
  if (pred(node)) return node;
  for (const c of node.c ?? []) {
    const r = findById(c, pred);
    if (r) return r;
  }
  return null;
}
