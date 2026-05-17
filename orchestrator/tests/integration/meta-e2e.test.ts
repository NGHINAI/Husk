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

integrationOrSkip("metadata extraction with real lightpanda", () => {
  it("extracts title from fixture page, returns null/empty for missing og/canonical/jsonld", async () => {
    const fixture = await startFixtureServer();
    let session: Session | undefined;
    try {
      session = await Session.create({ readinessTimeoutMs: 15_000 });
      await session.goto(fixture.url);
      const snap = await session.snapshot();
      
      // Fixture page has title but no canonical, og, or JSON-LD
      expect(snap.meta).toBeDefined();
      expect(snap.meta?.title).toBe("Husk M2 E2E Fixture");
      expect(snap.meta?.canonical).toBeNull();
      expect(snap.meta?.og).toEqual({});
      expect(snap.meta?.jsonld).toEqual([]);
    } finally {
      await session?.close();
      await fixture.close();
    }
  }, 30_000);
});
