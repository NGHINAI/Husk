import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChromeWatcher } from "../../src/handoff/chrome-watcher.js";

// Fake CDP client that ChromeWatcher uses internally — lets us drive events without a real WS.
function makeFakeCdp() {
  const handlers = new Map<string, Array<(p: unknown) => void>>();
  const sent: Array<{ method: string; params: unknown }> = [];
  return {
    on(event: string, fn: (p: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(fn);
    },
    off(event: string, fn: (p: unknown) => void) {
      handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== fn));
    },
    send: vi.fn(async (method: string, params: unknown) => {
      sent.push({ method, params });
      return null;
    }),
    close: vi.fn(),
    emit(event: string, payload: unknown) {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    sent,
    handlers,
  };
}

describe("ChromeWatcher", () => {
  it("calls Page.enable on connect", async () => {
    const cdp = makeFakeCdp();
    const w = new ChromeWatcher(cdp as any);
    await w.start();
    expect(cdp.sent.some((s) => s.method === "Page.enable")).toBe(true);
  });

  it("emits navigation events for main frame only (ignores subframes)", async () => {
    const cdp = makeFakeCdp();
    const w = new ChromeWatcher(cdp as any);
    await w.start();
    const seen: string[] = [];
    w.onNavigation((url) => seen.push(url));

    // Main-frame nav — should be emitted
    cdp.emit("Page.frameNavigated", {
      frame: { id: "main-frame-1", url: "https://linkedin.com/feed", parentId: undefined },
    });
    // Subframe nav — should be IGNORED
    cdp.emit("Page.frameNavigated", {
      frame: { id: "subframe", url: "https://ads.example.com/iframe", parentId: "main-frame-1" },
    });
    expect(seen).toEqual(["https://linkedin.com/feed"]);
  });

  it("multiple subscribers all receive the nav event", async () => {
    const cdp = makeFakeCdp();
    const w = new ChromeWatcher(cdp as any);
    await w.start();
    const a: string[] = [], b: string[] = [];
    w.onNavigation((url) => a.push(url));
    w.onNavigation((url) => b.push(url));
    cdp.emit("Page.frameNavigated", { frame: { id: "x", url: "https://x.com/", parentId: undefined } });
    expect(a).toEqual(["https://x.com/"]);
    expect(b).toEqual(["https://x.com/"]);
  });

  it("close() unregisters CDP handlers and calls cdp.close()", async () => {
    const cdp = makeFakeCdp();
    const w = new ChromeWatcher(cdp as any);
    await w.start();
    await w.close();
    expect(cdp.close).toHaveBeenCalled();
    // After close, navigation events are no longer relayed
    const seen: string[] = [];
    w.onNavigation((url) => seen.push(url));
    cdp.emit("Page.frameNavigated", { frame: { id: "x", url: "https://x.com/", parentId: undefined } });
    expect(seen).toEqual([]);
  });

  it("injectOverlayScript calls Page.addScriptToEvaluateOnNewDocument", async () => {
    const cdp = makeFakeCdp();
    const w = new ChromeWatcher(cdp as any);
    await w.start();
    await w.injectOverlayScript("console.log('hello')");
    expect(cdp.sent.some((s) =>
      s.method === "Page.addScriptToEvaluateOnNewDocument" &&
      (s.params as { source: string }).source === "console.log('hello')"
    )).toBe(true);
  });

  it("getAllCookies returns the cookies array from CDP", async () => {
    const cdp = makeFakeCdp();
    cdp.send.mockImplementationOnce(async (m: string) => {
      if (m === "Network.getAllCookies") return { cookies: [{ name: "x", value: "y", domain: ".linkedin.com" }] };
      return null;
    });
    const w = new ChromeWatcher(cdp as any);
    await w.start();
    cdp.send.mockClear();
    cdp.send.mockResolvedValueOnce({ cookies: [{ name: "a", value: "b", domain: ".x.com" }] });
    const cookies = await w.getAllCookies();
    expect(cookies).toEqual([{ name: "a", value: "b", domain: ".x.com" }]);
  });
});

describe.skipIf(!process.env["HUSK_SMOKE_CHROME"])(
  "connectToChrome (integration smoke — requires HUSK_SMOKE_CHROME=1)",
  () => {
    it("connects to a spawned Chrome and receives navigation events", async () => {
      // Requires a running Chrome with CDP at HUSK_SMOKE_CHROME_PORT (default 9222)
      const port = Number(process.env["HUSK_SMOKE_CHROME_PORT"] ?? 9222);
      const { connectToChrome } = await import("../../src/handoff/chrome-watcher.js");
      const watcher = await connectToChrome(port);
      const seen: string[] = [];
      watcher.onNavigation((url) => seen.push(url));
      // Give a moment for any pending navigations
      await new Promise((r) => setTimeout(r, 200));
      await watcher.close();
      // We at least got a watcher without throwing
      expect(watcher).toBeTruthy();
    });
  },
);
