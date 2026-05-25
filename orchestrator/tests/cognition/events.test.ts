import { describe, it, expect } from "vitest";
import type { CognitionEvent, EventFilter } from "../../src/cognition/events.js";

describe("cognition events", () => {
  it("each event type compiles with required payload", () => {
    const events: CognitionEvent[] = [
      { id: "e1", ts: 1, session_id: "s", type: "state_change", payload: { from_state: null, to_state: "home" } },
      { id: "e2", ts: 2, session_id: "s", type: "network_idle", payload: { idle_since: 100, in_flight_count: 0 } },
      { id: "e3", ts: 3, session_id: "s", type: "error_appeared", payload: { kind: "banner", text: "Error" } },
      { id: "e4", ts: 4, session_id: "s", type: "captcha_detected", payload: { kind: "recaptcha", reasons: [] } },
      { id: "e5", ts: 5, session_id: "s", type: "user_intervention_required", payload: { reason: "ask_human" } },
    ];
    expect(events).toHaveLength(5);
  });

  it("EventFilter supports session_id, site, debounce_ms", () => {
    const f: EventFilter = { session_id: "s1", site: "linkedin.com", debounce_ms: 500 };
    expect(f.debounce_ms).toBe(500);
  });
});
