import { describe, expect, it } from "vitest";
import { Session } from "../../src/session/session.js";
import { EnginePool } from "../../src/engine/pool.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startFixtureServer } from "./fixture-server.js";

const integrationOrSkip = await (async () => {
  try { await locateLightpanda(); return describe; } catch { return describe.skip; }
})();

integrationOrSkip("parallel — 50 concurrent sessions", () => {
  it("can run 50 concurrent goto+snapshot operations without deadlocks", async () => {
    const binary = await locateLightpanda();
    const fixture = await startFixtureServer();
    const N = 50;
    const pool = new EnginePool({
      minWarm: 4,
      maxParallel: N,
      spawnOptions: { binary, readinessTimeoutMs: 15_000 },
    });
    await pool.ready();

    const start = Date.now();
    let succeeded = 0;
    try {
      await Promise.all(Array.from({ length: N }, async () => {
        const engine = await pool.acquire();
        const session = await Session.create({ engine });
        try {
          await session.goto(fixture.url);
          const snap = await session.snapshot();
          if (snap.count > 0) succeeded++;
        } finally {
          await session.close();
        }
      }));
    } finally {
      await pool.close();
      await fixture.close();
    }
    const elapsed = Date.now() - start;
    expect(succeeded).toBe(N);
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);

  it("pool stats reflect 50 busy then drain to <= minWarm after release", async () => {
    const binary = await locateLightpanda();
    const N = 50;
    const pool = new EnginePool({
      minWarm: 4,
      maxParallel: N,
      idleShrinkMs: 100,
      spawnOptions: { binary, readinessTimeoutMs: 15_000 },
    });
    await pool.ready();
    try {
      const engines = await Promise.all(Array.from({ length: N }, () => pool.acquire()));
      expect(pool.stats().busy).toBe(N);
      await Promise.all(engines.map((e) => e.release()));
      await new Promise((r) => setTimeout(r, 200));
      pool.forceTickReaper();
      expect(pool.stats().warm).toBeLessThanOrEqual(4);
    } finally {
      await pool.close();
    }
  }, 120_000);
});
