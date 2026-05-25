import { describe, it, expect, vi } from "vitest";
import { createEngineRouter } from "../../src/engine/engine-router.js";

const makeMockPool = (kind: "lightpanda" | "chrome") => ({
  acquire: vi.fn().mockImplementation(async (_sessionId?: string) => ({
    kind,
    cdp: { send: vi.fn(), close: vi.fn() } as unknown,
    release: vi.fn().mockResolvedValue(undefined),
    port: 9000,
    profileDir: `/tmp/mock-${kind}`,
  })),
  releaseToPool: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
});

describe("EngineRouter.acquireForCapability", () => {
  it("trivial requirement picks lightpanda (cheapest engine)", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({
      lightpandaPool: lightpanda as never,
      chromePool: chrome as never,
    });
    const h = await router.acquireForCapability({}, "sess-1");
    expect(h).not.toBeNull();
    expect(h!.kind).toBe("lightpanda");
    expect(lightpanda.acquire).toHaveBeenCalledOnce();
    expect(chrome.acquire).not.toHaveBeenCalled();
  });

  it("features:['webrtc'] requirement picks chrome", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({
      lightpandaPool: lightpanda as never,
      chromePool: chrome as never,
    });
    const h = await router.acquireForCapability({ features: ["webrtc"] }, "sess-2");
    expect(h).not.toBeNull();
    expect(h!.kind).toBe("chrome");
    expect(chrome.acquire).toHaveBeenCalledOnce();
    expect(lightpanda.acquire).not.toHaveBeenCalled();
  });

  it("impossible requirement (no engine matches) returns null", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({
      lightpandaPool: lightpanda as never,
      chromePool: chrome as never,
    });
    // max_latency:"fast" excludes chrome (medium); features:["webrtc"] excludes lightpanda
    const h = await router.acquireForCapability(
      { features: ["webrtc"], max_latency: "fast" },
      "sess-3",
    );
    expect(h).toBeNull();
    expect(lightpanda.acquire).not.toHaveBeenCalled();
    expect(chrome.acquire).not.toHaveBeenCalled();
  });

  it("cookieInventory is forwarded to pickEngine and can influence selection", async () => {
    const lightpanda = makeMockPool("lightpanda");
    const chrome = makeMockPool("chrome");
    const router = createEngineRouter({
      lightpandaPool: lightpanda as never,
      chromePool: chrome as never,
    });
    // cookies_for requires chrome cookie in inventory; with correct inventory chrome wins
    const inv = new Set(["chrome:example.com"]);
    const h = await router.acquireForCapability(
      { cookies_for: ["example.com"] },
      "sess-4",
      inv,
    );
    expect(h).not.toBeNull();
    expect(h!.kind).toBe("chrome");
    expect(chrome.acquire).toHaveBeenCalledOnce();
  });
});
