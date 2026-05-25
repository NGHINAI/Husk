import { describe, it, expect } from "vitest";
import { METHODS, type MethodContext } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import { CognitionBus } from "../../src/cognition/cognition-bus.js";

function buildCtx(cognitionBus?: CognitionBus): MethodContext {
  const mgr = new SessionManager(async () => {
    throw new Error("no sessions in subscribe tests");
  });
  return {
    sessions: mgr,
    version: "0.0.0-test",
    vault: {
      listProfiles: () => [],
      list: () => [],
      clear: () => {},
      remove: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    credentials: {
      listProfiles: () => [],
      list: () => [],
      get: () => null,
      set: () => {},
      remove: () => {},
      close: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    cognitionBus,
  };
}

describe("subscribe", () => {
  it("returns subscription_id and stream_url for a valid event_type", async () => {
    const bus = new CognitionBus();
    const ctx = buildCtx(bus);

    const result = await METHODS.subscribe(
      { event_type: "state_change", session_id: "s1" },
      ctx,
    );

    expect(typeof result.subscription_id).toBe("string");
    expect(result.subscription_id.length).toBeGreaterThan(0);
    expect(result.stream_url).toBe(
      `/stream/cognition?subscription_id=${result.subscription_id}`,
    );

    // Subscription must actually be registered on the bus.
    const subs = bus.listSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].event_type).toBe("state_change");
    expect(subs[0].filter.session_id).toBe("s1");
  });

  it("throws a helpful error for an invalid event_type", async () => {
    const bus = new CognitionBus();
    const ctx = buildCtx(bus);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      METHODS.subscribe({ event_type: "bogus" as any }, ctx),
    ).rejects.toThrow(/invalid event_type.*bogus/i);
  });
});

describe("unsubscribe", () => {
  it("returns removed:true for a known subscription_id and removed:false for unknown", async () => {
    const bus = new CognitionBus();
    const ctx = buildCtx(bus);

    // Register a subscription via subscribe so the id is real.
    const { subscription_id } = await METHODS.subscribe(
      { event_type: "network_idle" },
      ctx,
    );

    const removed = await METHODS.unsubscribe({ subscription_id }, ctx);
    expect(removed).toEqual({ removed: true });

    // Second call with same id → already gone.
    const removedAgain = await METHODS.unsubscribe({ subscription_id }, ctx);
    expect(removedAgain).toEqual({ removed: false });
  });
});
