import { describe, it, expect } from "vitest";
import { waitForPageReady } from "../../src/session/page-ready.js";

describe("waitForPageReady", () => {
  it("resolves on Page.loadEventFired before network-idle window", async () => {
    const cdp = makeFakeCdp();
    const p = waitForPageReady(cdp, { networkIdleMs: 200, maxWaitMs: 5000 });
    cdp.emit("Page.loadEventFired", { timestamp: Date.now() });
    await new Promise((r) => setTimeout(r, 250));
    const r = await p;
    expect(r.reason).toBe("network_idle");
  });

  it("resolves after maxWaitMs even if requests never stop", async () => {
    const cdp = makeFakeCdp();
    cdp.startInflight("req1"); // never finishes
    const r = await waitForPageReady(cdp, { networkIdleMs: 200, maxWaitMs: 500 });
    expect(r.reason).toBe("max_wait");
  });

  it("network-idle requires N ms of zero in-flight requests", async () => {
    const cdp = makeFakeCdp();
    const p = waitForPageReady(cdp, { networkIdleMs: 300, maxWaitMs: 5000 });
    cdp.emit("Page.loadEventFired", {});
    cdp.startInflight("a");
    setTimeout(() => cdp.finishInflight("a"), 100);
    const r = await p;
    expect(r.reason).toBe("network_idle");
    expect(r.waitedMs).toBeGreaterThanOrEqual(400);
  });
});

function makeFakeCdp() {
  const handlers = new Map<string, Array<(p: unknown) => void>>();
  const inflight = new Set<string>();
  return {
    on(event: string, fn: (p: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(fn);
    },
    off(event: string, fn: (p: unknown) => void) {
      handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== fn));
    },
    emit(event: string, payload: unknown) {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    startInflight(id: string) {
      inflight.add(id);
      this.emit("Network.requestWillBeSent", { requestId: id });
    },
    finishInflight(id: string) {
      inflight.delete(id);
      this.emit("Network.loadingFinished", { requestId: id });
    },
    inflightCount() { return inflight.size; },
  };
}
