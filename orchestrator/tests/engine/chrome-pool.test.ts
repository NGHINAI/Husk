import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChromePool, computeChromeMaxParallel } from "../../src/engine/chrome-pool.js";

describe("computeChromeMaxParallel", () => {
  it("scales with free memory (500MB per Chrome session)", () => {
    expect(computeChromeMaxParallel({ freeMb: 8000 })).toBe(16);
    expect(computeChromeMaxParallel({ freeMb: 16000 })).toBe(32);
    expect(computeChromeMaxParallel({ freeMb: 2000 })).toBe(4);
  });

  it("caps at 50 even on huge machines", () => {
    expect(computeChromeMaxParallel({ freeMb: 100_000 })).toBe(50);
  });

  it("floor of 1 even on small machines", () => {
    expect(computeChromeMaxParallel({ freeMb: 100 })).toBe(1);
    expect(computeChromeMaxParallel({ freeMb: 0 })).toBe(1);
  });
});

describe("ChromePool", () => {
  // Use a mock spawnChromeEngine so tests don't spawn real Chrome
  const mockHandle = () => ({
    cdp: { send: vi.fn(), close: vi.fn() } as any,
    port: 9000 + Math.floor(Math.random() * 100),
    profileDir: "/tmp/mock-profile-" + Math.random(),
    child: { kill: vi.fn() } as any,
    kill: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  });

  it("acquire spins up a handle when pool is empty", async () => {
    const spawnSpy = vi.fn().mockImplementation(async () => mockHandle());
    const pool = new ChromePool({
      maxParallel: 4,
      minWarm: 0,  // no pre-warm for this test
      idleShrinkMs: 60_000,
      spawn: spawnSpy,
    });
    const handle = await pool.acquire("session-1");
    expect(spawnSpy).toHaveBeenCalledOnce();
    expect(handle).toBeDefined();
    await pool.close();
  });

  it("releaseToPool returns the handle to the pool for reuse (if under maxParallel)", async () => {
    const spawnSpy = vi.fn().mockImplementation(async () => mockHandle());
    const pool = new ChromePool({
      maxParallel: 4,
      minWarm: 0,
      idleShrinkMs: 60_000,
      spawn: spawnSpy,
    });
    const h1 = await pool.acquire("s1");
    await pool.releaseToPool(h1);
    const h2 = await pool.acquire("s2");
    // Reuse — spawn should NOT have been called again
    expect(spawnSpy).toHaveBeenCalledOnce();
    expect(h2).toBe(h1);
    await pool.close();
  });

  it("acquire blocks (queues a waiter) when maxParallel is reached", async () => {
    const spawnSpy = vi.fn().mockImplementation(async () => mockHandle());
    const pool = new ChromePool({
      maxParallel: 1,
      minWarm: 0,
      idleShrinkMs: 60_000,
      spawn: spawnSpy,
    });
    const h1 = await pool.acquire("s1");
    let h2: any = null;
    const acquire2 = pool.acquire("s2").then((h) => { h2 = h; });
    await new Promise((r) => setTimeout(r, 20));
    expect(h2).toBeNull();  // still queued
    // Release h1, h2 should resolve
    await pool.releaseToPool(h1);
    await acquire2;
    expect(h2).toBeDefined();
    await pool.close();
  });

  it("close kills all in-pool handles", async () => {
    const handles = [mockHandle(), mockHandle()];
    let i = 0;
    const spawnSpy = vi.fn().mockImplementation(async () => handles[i++]);
    const pool = new ChromePool({
      maxParallel: 2, minWarm: 0, idleShrinkMs: 60_000, spawn: spawnSpy,
    });
    const h1 = await pool.acquire("s1");
    const h2 = await pool.acquire("s2");
    await pool.releaseToPool(h1);
    // h2 is still busy
    await pool.close();
    expect(handles[0].release).toHaveBeenCalled();
    expect(handles[1].release).toHaveBeenCalled();
  });

  it("idle reaper kills handles that exceed idleShrinkMs", async () => {
    const handle = mockHandle();
    const spawnSpy = vi.fn().mockResolvedValue(handle);
    const pool = new ChromePool({
      maxParallel: 2,
      minWarm: 0,
      idleShrinkMs: 50,  // 50ms idle threshold for test
      spawn: spawnSpy,
    });
    const h = await pool.acquire("s1");
    await pool.releaseToPool(h);
    await new Promise((r) => setTimeout(r, 150));
    // Reaper should have run and reaped the idle handle
    expect(handle.release).toHaveBeenCalled();
    await pool.close();
  });

  it("ready() pre-warms minWarm handles", async () => {
    const spawnSpy = vi.fn().mockImplementation(async () => mockHandle());
    const pool = new ChromePool({
      maxParallel: 4, minWarm: 2, idleShrinkMs: 60_000, spawn: spawnSpy,
    });
    await pool.ready();
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    await pool.close();
  });
});
