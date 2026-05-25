import { describe, it, expect } from "vitest";
import type {
  SiteState,
  Transition,
  Predicate,
  ActionStep,
  Observation,
  StateId,
} from "../../src/cognition/types.js";

describe("cognition types", () => {
  it("StateId is a string (format: site::state_name)", () => {
    const id: StateId = "linkedin.com::home_feed";
    expect(id).toContain("::");
  });

  it("Predicate is a discriminated union usable in switch", () => {
    const p: Predicate = { type: "url_pattern", regex: "/login" };
    if (p.type === "url_pattern") {
      expect(typeof p.regex).toBe("string");
    }
  });

  it("Predicate covers all 9 type discriminants at compile time", () => {
    const types: Predicate["type"][] = [
      "url_pattern",
      "ax_role_name",
      "ax_text_match",
      "network_recent",
      "cookies_contain",
      "forms_present",
      "and",
      "or",
      "not",
    ];
    expect(types).toHaveLength(9);
  });

  it("SiteState shape is well-formed", () => {
    const s: SiteState = {
      site: "linkedin.com",
      state_id: "linkedin.com::home_feed",
      identify_by: { type: "url_pattern", regex: "/feed" },
      affordances: ["search", "navigate_profile"],
      observed_count: 5,
      confidence: 0.85,
      last_seen_at: Date.now(),
    };
    expect(s.state_id).toContain("home_feed");
    expect(s.affordances).toHaveLength(2);
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThanOrEqual(1);
  });

  it("Transition + ActionStep[] shape is well-formed", () => {
    const t: Transition = {
      site: "linkedin.com",
      from_state: "linkedin.com::profile_page",
      to_state: "linkedin.com::connect_modal",
      action_sequence: [
        { verb: "click", intent: "Connect button" } as ActionStep,
        {
          verb: "wait_for",
          predicate: { type: "ax_role_name", role: "dialog", name: "Add a note" },
        } as ActionStep,
      ],
      success_count: 12,
      failure_count: 1,
      avg_duration_ms: 420,
      confidence: 0.92,
      last_used_at: Date.now(),
    };
    expect(t.action_sequence).toHaveLength(2);
    expect(t.success_count).toBe(12);
    expect(t.avg_duration_ms).toBe(420);
  });

  it("ActionStep covers all 7 verb discriminants", () => {
    const steps: ActionStep[] = [
      { verb: "navigate", url: "https://example.com" },
      { verb: "click", intent: "Submit" },
      { verb: "click_stable_id", stable_id: "btn:abc123" },
      { verb: "type", intent: "Search box", text_arg: "hello" },
      { verb: "press_key", key: "Enter" },
      { verb: "wait_for", predicate: { type: "url_pattern", regex: "/done" } },
      { verb: "snapshot" },
    ];
    expect(steps).toHaveLength(7);
    const verbs = steps.map((s) => s.verb);
    expect(verbs).toContain("navigate");
    expect(verbs).toContain("click");
    expect(verbs).toContain("click_stable_id");
    expect(verbs).toContain("type");
    expect(verbs).toContain("press_key");
    expect(verbs).toContain("wait_for");
    expect(verbs).toContain("snapshot");
  });

  it("ActionStep wait_for has optional timeout_ms", () => {
    const step: ActionStep = {
      verb: "wait_for",
      predicate: { type: "url_pattern", regex: "/done" },
      timeout_ms: 5000,
    };
    expect(step.verb).toBe("wait_for");
    if (step.verb === "wait_for") {
      expect(step.timeout_ms).toBe(5000);
    }
  });

  it("Observation shape is well-formed with null prev_state", () => {
    const obs: Observation = {
      site: "linkedin.com",
      ts: Date.now(),
      prev_state: null,
      current_state: "linkedin.com::login_form",
      url: "https://linkedin.com/login",
      snapshot_summary: "Login page with email + password fields",
      action_taken: null,
    };
    expect(obs.prev_state).toBeNull();
    expect(obs.action_taken).toBeNull();
  });

  it("Observation action_taken can hold an ActionStep", () => {
    const obs: Observation = {
      site: "linkedin.com",
      ts: Date.now(),
      prev_state: "linkedin.com::login_form",
      current_state: "linkedin.com::home_feed",
      url: "https://linkedin.com/feed",
      snapshot_summary: "Home feed loaded",
      action_taken: { verb: "click", intent: "Sign in button" },
    };
    expect(obs.action_taken?.verb).toBe("click");
  });
});
