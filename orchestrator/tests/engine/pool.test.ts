import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EnginePool } from "../../src/engine/pool.js";
import type { LightpandaProcess } from "../../src/engine/lifecycle.js";

function fakeProcess(): LightpandaProcess & { closed: boolean } {
  return {
    cdpBaseUrl: "http://127.0.0.1:0",
    pid: 1,
    closed: false,
    close: async function () { this.closed = true; },
  } as LightpandaProcess & { closed: boolean };
}

describe("EnginePool", () => {
  let pool: EnginePool;
  let spawnCalls = 0;
  let spawned: ReturnType<typeof fakeProcess>[] = [];

  const fakeSpawn = async () => {
    spawnCalls++;
    const p = fakeProcess();
    spawned.push(p);
    return p;
  };

  beforeEach(() => {
    spawnCalls = 0;
    spawned = [];
  });

  afterEach(async () => {
    await pool?.close();
  });

  it("pre-warms K processes at construction", async () => {
    pool = new EnginePool({ minWarm: 4, maxParallel: 10, spawn: fakeSpawn });
    await pool.ready();
    expect(spawnCalls).toBe(4);
  });

  it("acquire() returns one of the warm processes without spawning", async () => {
    pool = new EnginePool({ minWarm: 4, maxParallel: 10, spawn: fakeSpawn });
    await pool.ready();
    const before = spawnCalls;
    const handle = await pool.acquire();
    expect(handle.process).toBeDefined();
    expect(spawnCalls).toBe(before);
    await handle.release();
  });

  it("expands beyond minWarm up to maxParallel under concurrent demand", async () => {
    pool = new EnginePool({ minWarm: 2, maxParallel: 10, spawn: fakeSpawn });
    await pool.ready();
    const handles = await Promise.all(Array.from({ length: 10 }, () => pool.acquire()));
    expect(handles.length).toBe(10);
    expect(spawnCalls).toBe(10);
    for (const h of handles) await h.release();
  });

  it("throws when demand exceeds maxParallel and acquire timeout exceeded", async () => {
    pool = new EnginePool({ minWarm: 1, maxParallel: 2, spawn: fakeSpawn, acquireTimeoutMs: 100 });
    await pool.ready();
    const h1 = await pool.acquire();
    const h2 = await pool.acquire();
    await expect(pool.acquire()).rejects.toThrow(/timed out/i);
    await h1.release();
    await h2.release();
  });

  it("release() returns process to pool when under minWarm; kills it when over", async () => {
    pool = new EnginePool({ minWarm: 2, maxParallel: 10, spawn: fakeSpawn });
    await pool.ready();
    const handles = await Promise.all(Array.from({ length: 5 }, () => pool.acquire()));
    await Promise.all(handles.map((h) => h.release()));
    const killed = spawned.filter((p) => p.closed).length;
    expect(killed).toBe(3);
  });

  it("idle reaper kills excess warm processes after idle window", async () => {
    pool = new EnginePool({
      minWarm: 2,
      maxParallel: 10,
      spawn: fakeSpawn,
      idleShrinkMs: 50,
    });
    await pool.ready();
    const handles = await Promise.all(Array.from({ length: 5 }, () => pool.acquire()));
    for (const h of handles) await h.release();
    await new Promise((r) => setTimeout(r, 120));
    pool.forceTickReaper();
    const stats = pool.stats();
    expect(stats.warm).toBeLessThanOrEqual(2);
  });

  it("stats() reports warm + busy counts accurately", async () => {
    pool = new EnginePool({ minWarm: 4, maxParallel: 10, spawn: fakeSpawn });
    await pool.ready();
    const h1 = await pool.acquire();
    const h2 = await pool.acquire();
    const stats = pool.stats();
    expect(stats.busy).toBe(2);
    expect(stats.warm).toBe(2);
    await h1.release();
    await h2.release();
  });

  it("close() terminates all warm processes", async () => {
    pool = new EnginePool({ minWarm: 4, maxParallel: 10, spawn: fakeSpawn });
    await pool.ready();
    await pool.close();
    expect(spawned.every((p) => p.closed)).toBe(true);
  });

  it("computeMaxParallel returns min(50, freeMb/30) by default", async () => {
    const { computeMaxParallel } = await import("../../src/engine/pool.js");
    expect(computeMaxParallel({ freeMb: 30 })).toBe(1);
    expect(computeMaxParallel({ freeMb: 300 })).toBe(10);
    expect(computeMaxParallel({ freeMb: 3000 })).toBe(50);
  });

  it("acquire() waits for a free slot instead of spawning when at maxParallel", async () => {
    pool = new EnginePool({ minWarm: 0, maxParallel: 2, spawn: fakeSpawn, acquireTimeoutMs: 500 });
    await pool.ready();
    const h1 = await pool.acquire();
    const h2 = await pool.acquire();
    const acquired = pool.acquire();
    setTimeout(() => { void h1.release(); }, 50);
    const h3 = await acquired;
    expect(h3).toBeDefined();
    await h2.release();
    await h3.release();
  });
});
