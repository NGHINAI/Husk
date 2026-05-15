import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/session/session.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startFixtureServer } from "./fixture-server.js";

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

integrationOrSkip("site graph cache — real lightpanda → snapshot → cache", () => {
  it("writes per-domain DB and queryable rows after Session.snapshot()", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "husk-sg-e2e-"));
    const cache = new SiteGraphCache({ cacheDir });
    const fixture = await startFixtureServer();
    let session: Session | undefined;

    try {
      session = await Session.create({ readinessTimeoutMs: 15_000, siteGraph: cache });
      await session.goto(fixture.url);
      const snap = await session.snapshot();
      expect(snap.count).toBeGreaterThan(0);

      // Fixture URL is http://127.0.0.1:N/ — normalized domain is "127.0.0.1"
      const rows = cache.query("127.0.0.1", { role: "button" });
      expect(rows.length).toBeGreaterThan(0);
      const submit = rows.find((r) => r.name_norm.includes("submit"));
      expect(submit).toBeDefined();
      expect(submit?.stable_id).toMatch(/^button:/);
    } finally {
      await session?.close();
      await fixture.close();
      cache.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 30_000);
});
