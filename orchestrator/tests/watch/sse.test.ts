import { describe, it, expect } from "vitest";
import { WatchBus } from "../../src/watch/sse.js";

describe("WatchBus", () => {
  it("delivers events to subscribed listeners for a session", () => {
    const bus = new WatchBus();
    const got: unknown[] = [];
    const off = bus.subscribe("sess1", (e) => got.push(e));
    bus.emit("sess1", { kind: "snapshot", ts: 1, url: "/", node_count: 5, mode: "full" });
    bus.emit("sess2", { kind: "snapshot", ts: 2, url: "/", node_count: 5, mode: "full" });
    expect(got).toHaveLength(1);
    expect((got[0] as { ts: number }).ts).toBe(1);
    off();
  });

  it("does not deliver after unsubscribe", () => {
    const bus = new WatchBus();
    const got: unknown[] = [];
    const off = bus.subscribe("s", (e) => got.push(e));
    off();
    bus.emit("s", { kind: "navigation", ts: 3, url: "/x" });
    expect(got).toHaveLength(0);
  });

  it("supports multiple subscribers per session", () => {
    const bus = new WatchBus();
    const a: unknown[] = []; const b: unknown[] = [];
    bus.subscribe("s", (e) => a.push(e));
    bus.subscribe("s", (e) => b.push(e));
    bus.emit("s", { kind: "navigation", ts: 1, url: "/" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("emit to a session with no subscribers is a no-op", () => {
    const bus = new WatchBus();
    expect(() => bus.emit("ghost", { kind: "navigation", ts: 1, url: "/" })).not.toThrow();
  });

  it("listener throwing does not break subsequent listeners", () => {
    const bus = new WatchBus();
    const got: unknown[] = [];
    bus.subscribe("s", () => { throw new Error("boom"); });
    bus.subscribe("s", (e) => got.push(e));
    expect(() => bus.emit("s", { kind: "navigation", ts: 1, url: "/" })).not.toThrow();
    expect(got).toHaveLength(1);
  });
});
