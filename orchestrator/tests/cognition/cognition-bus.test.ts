import { describe, it, expect, vi } from "vitest";
import { CognitionBus } from "../../src/cognition/cognition-bus.js";
import type { CognitionEvent } from "../../src/cognition/events.js";

function makeEvent(overrides: Partial<CognitionEvent> = {}): CognitionEvent {
  return {
    id: "id",
    ts: Date.now(),
    session_id: "s1",
    type: "state_change",
    payload: { from_state: null, to_state: "home" },
    ...overrides,
  } as CognitionEvent;
}

describe("CognitionBus", () => {
  it("delivers events to matching subscribers", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "s1" }, h);
    bus.publish(makeEvent());
    expect(h).toHaveBeenCalledOnce();
  });

  it("filters by event type", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("network_idle", {}, h);
    bus.publish(makeEvent({ type: "state_change" }));
    expect(h).not.toHaveBeenCalled();
  });

  it("filters by session_id (exact)", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "s2" }, h);
    bus.publish(makeEvent({ session_id: "s1" }));
    expect(h).not.toHaveBeenCalled();
  });

  it("session_id=* matches all sessions", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "*" }, h);
    bus.publish(makeEvent({ session_id: "s1" }));
    bus.publish(makeEvent({ session_id: "s2" }));
    expect(h).toHaveBeenCalledTimes(2);
  });

  it("filters by site", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { site: "linkedin.com" }, h);
    bus.publish(makeEvent({ site: "github.com" }));
    bus.publish(makeEvent({ site: "linkedin.com" }));
    expect(h).toHaveBeenCalledOnce();
  });

  it("debounce coalesces same-session events", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "s1", debounce_ms: 100 }, h);
    const t0 = 1000;
    bus.publish(makeEvent({ ts: t0 }));
    bus.publish(makeEvent({ ts: t0 + 50 }));   // within debounce window — dropped
    bus.publish(makeEvent({ ts: t0 + 150 }));  // outside window — fires
    expect(h).toHaveBeenCalledTimes(2);
  });

  it("debounce is per-session_id", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "*", debounce_ms: 100 }, h);
    const t0 = 1000;
    bus.publish(makeEvent({ session_id: "s1", ts: t0 }));
    bus.publish(makeEvent({ session_id: "s2", ts: t0 + 50 })); // different session — fires
    expect(h).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops further delivery", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    const id = bus.subscribe("state_change", {}, h);
    bus.publish(makeEvent());
    bus.unsubscribe(id);
    bus.publish(makeEvent());
    expect(h).toHaveBeenCalledOnce();
  });

  it("handler errors do not break the bus", () => {
    const bus = new CognitionBus();
    const h1 = vi.fn(() => { throw new Error("boom"); });
    const h2 = vi.fn();
    bus.subscribe("state_change", {}, h1);
    bus.subscribe("state_change", {}, h2);
    bus.publish(makeEvent());
    expect(h2).toHaveBeenCalledOnce();
  });

  it("listSubscriptions excludes handler reference", () => {
    const bus = new CognitionBus();
    bus.subscribe("state_change", { session_id: "s1" }, () => {});
    const subs = bus.listSubscriptions();
    expect(subs).toHaveLength(1);
    expect((subs[0] as Record<string, unknown>)["handler"]).toBeUndefined();
  });

  it("setHandler replaces handler and old handler is not called", () => {
    const bus = new CognitionBus();
    const oldH = vi.fn();
    const newH = vi.fn();
    const id = bus.subscribe("state_change", {}, oldH);

    const result = bus.setHandler(id, newH);
    expect(result).toBe(true);

    bus.publish(makeEvent());
    expect(newH).toHaveBeenCalledOnce();
    expect(oldH).not.toHaveBeenCalled();
  });

  it("setHandler returns false for unknown subscription_id", () => {
    const bus = new CognitionBus();
    const result = bus.setHandler("nonexistent-id", () => {});
    expect(result).toBe(false);
  });
});
