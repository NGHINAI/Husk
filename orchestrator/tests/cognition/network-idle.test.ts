/**
 * network-idle.test.ts — M22 Phase E Task 4.
 *
 * Verifies the debounced network-idle detector (wireNetworkIdle).
 * Uses vi.useFakeTimers() for deterministic timer control.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CognitionBus } from "../../src/cognition/cognition-bus.js";
import { wireNetworkIdle, type NetworkIdleSession } from "../../src/cognition/event-emitters.js";
import type { CognitionEvent } from "../../src/cognition/events.js";

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/**
 * Minimal stub that satisfies NetworkIdleSession.
 * `inFlightCount` is set via the `inflight` property.
 * `triggerResponseComplete()` manually fires all registered listeners.
 */
function makeStubSession(id = "sess-1", site = "example.com"): NetworkIdleSession & {
  inflight: number;
  triggerResponseComplete(): void;
} {
  const listeners: Array<() => void> = [];
  let inflight = 0;
  return {
    id,
    currentSite: () => site,
    get inflight(): number { return inflight; },
    set inflight(v: number) { inflight = v; },
    networkBuffer: {
      inFlightCount: () => inflight,
      onResponseComplete: (fn: () => void) => {
        listeners.push(fn);
        return () => {
          const idx = listeners.indexOf(fn);
          if (idx !== -1) listeners.splice(idx, 1);
        };
      },
    },
    triggerResponseComplete() {
      for (const fn of [...listeners]) fn();
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wireNetworkIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires network_idle after debounce when in-flight count is 0", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("network_idle", {}, (e) => received.push(e));

    const session = makeStubSession();
    session.inflight = 0; // no more in-flight requests

    const cleanup = wireNetworkIdle(bus, session, 500);

    // Simulate a response completing with 0 in-flight remaining.
    session.triggerResponseComplete();

    // Timer hasn't fired yet.
    expect(received).toHaveLength(0);

    // Advance past the debounce window.
    vi.advanceTimersByTime(500);

    expect(received).toHaveLength(1);
    const ev = received[0];
    expect(ev.type).toBe("network_idle");
    expect(ev.session_id).toBe("sess-1");
    expect(ev.site).toBe("example.com");
    expect(ev.payload).toMatchObject({ in_flight_count: 0 });

    cleanup();
  });

  it("does not fire when in-flight count is > 0 after response", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("network_idle", {}, (e) => received.push(e));

    const session = makeStubSession();
    session.inflight = 2; // still requests in flight

    const cleanup = wireNetworkIdle(bus, session, 500);

    // Response complete, but 2 still in-flight.
    session.triggerResponseComplete();

    vi.advanceTimersByTime(1000);

    // No event — network is not idle.
    expect(received).toHaveLength(0);

    cleanup();
  });

  it("coalesces rapid response completes into a single network_idle event", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("network_idle", {}, (e) => received.push(e));

    const session = makeStubSession();
    session.inflight = 0;

    const cleanup = wireNetworkIdle(bus, session, 500);

    // Three rapid response completes before the debounce window expires.
    session.triggerResponseComplete();
    vi.advanceTimersByTime(100); // 100ms in — timer not fired yet
    session.triggerResponseComplete();
    vi.advanceTimersByTime(100); // 200ms in — timer not fired yet
    session.triggerResponseComplete();
    vi.advanceTimersByTime(100); // 300ms in — timer not fired yet

    // Only the last timer should be pending. Advance to fire it.
    vi.advanceTimersByTime(500);

    // Exactly one event, not three.
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("network_idle");

    cleanup();
  });

  it("cancels pending event when a new request starts before timer fires", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("network_idle", {}, (e) => received.push(e));

    const session = makeStubSession();

    const cleanup = wireNetworkIdle(bus, session, 500);

    // Response completes, in-flight drops to 0 — timer starts.
    session.inflight = 0;
    session.triggerResponseComplete();
    vi.advanceTimersByTime(200); // partially through debounce

    // A new request starts — in-flight goes to 1.
    session.inflight = 1;

    // Timer fires at 500ms mark, but in-flight is now 1 — no event emitted.
    vi.advanceTimersByTime(300);

    expect(received).toHaveLength(0);

    cleanup();
  });
});
