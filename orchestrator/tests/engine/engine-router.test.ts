import { describe, it, expect, vi } from "vitest";
import { createEngineRouter, type EngineHandle } from "../../src/engine/engine-router.js";

const makeMockPool = (kind: "lightpanda" | "chrome") => ({
  acquire: vi.fn().mockImplementation(async (sessionId?: string) => ({
    kind,
    cdp: { send: vi.fn(), close: vi.fn() } as any,
    release: vi.fn().mockResolvedValue(undefined),
    port: 9000,
    profileDir: `/tmp/mock-${kind}`,
  })),
  releaseToPool: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
});

describe("createEngineRouter", () => {
  it("acquire('lightpanda') returns a handle from the lightpanda pool", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({ lightpandaPool: lightpanda as any, chromePool: chrome as any });
    const h = await router.acquire("lightpanda", "sess-1");
    expect(h.kind).toBe("lightpanda");
    expect(lightpanda.acquire).toHaveBeenCalledOnce();
    expect(chrome.acquire).not.toHaveBeenCalled();
  });

  it("acquire('chrome') returns a handle from the chrome pool", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({ lightpandaPool: lightpanda as any, chromePool: chrome as any });
    const h = await router.acquire("chrome", "sess-1");
    expect(h.kind).toBe("chrome");
    expect(chrome.acquire).toHaveBeenCalledOnce();
    expect(lightpanda.acquire).not.toHaveBeenCalled();
  });

  it("acquire('auto') starts with lightpanda (fallback happens later in goto)", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({ lightpandaPool: lightpanda as any, chromePool: chrome as any });
    const h = await router.acquire("auto", "sess-1");
    expect(h.kind).toBe("lightpanda");
    expect(lightpanda.acquire).toHaveBeenCalledOnce();
  });

  it("handle.release routes back to the correct pool", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({ lightpandaPool: lightpanda as any, chromePool: chrome as any });

    const lpHandle = await router.acquire("lightpanda", "s1");
    await lpHandle.release();
    expect(lightpanda.releaseToPool).toHaveBeenCalledOnce();

    const chHandle = await router.acquire("chrome", "s2");
    await chHandle.release();
    expect(chrome.releaseToPool).toHaveBeenCalledOnce();
  });

  it("close shuts down both pools", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({ lightpandaPool: lightpanda as any, chromePool: chrome as any });
    await router.close();
    expect(lightpanda.close).toHaveBeenCalledOnce();
    expect(chrome.close).toHaveBeenCalledOnce();
  });

  it("acquire(invalid kind) throws", async () => {
    const router = createEngineRouter({
      lightpandaPool: makeMockPool("lightpanda") as any,
      chromePool: makeMockPool("chrome") as any,
    });
    await expect(router.acquire("invalid" as any, "s1")).rejects.toThrow();
  });
});
