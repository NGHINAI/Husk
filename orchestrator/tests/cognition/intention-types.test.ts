import { describe, it, expect } from "vitest";
import type { Intention, Outcome, FailureReason, IntentionStep, VerifyCheck } from "../../src/cognition/intention-types.js";

describe("intention types", () => {
  it("Intention conforms to the spec shape", () => {
    const i: Intention = {
      site: "linkedin.com",
      name: "send_connect",
      args_schema: { type: "object", properties: { person: { type: "string" } } },
      requires_state: "profile_page",
      steps: [
        { verb: "click", target: { button: "Connect" } },
        { verb: "click", target: { button: "Send without a note" } },
      ],
      verify: [
        { type: "network", method: "POST", url_pattern: "/voyager/api/relationships/sentInvitationViewsV2", status_min: 200, status_max: 299, description: "invite POST returned 2xx" },
      ],
      failure_modes: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    expect(i.name).toBe("send_connect");
    expect(i.steps[0].verb).toBe("click");
  });

  it("Outcome carries evidence + steps_observed", () => {
    const o: Outcome = {
      ok: true,
      intention: "send_connect",
      args: { person: "Vikash" },
      state_before: "profile_page",
      state_after: "profile_page_pending",
      evidence: [{ predicate: "POST returned 200", passed: true }],
      duration_ms: 1234,
      steps_observed: [],
    };
    expect(o.evidence.length).toBe(1);
  });

  it("FailureReason includes all 30 reasons", () => {
    const reasons: FailureReason[] = [
      "unknown_site","unknown_state","no_path_to_target","state_drift_mid_execution","verify_failed",
      "element_not_found","element_not_interactive","watchdog_rejected","timeout",
      "network_failure","network_timeout","network_throttled","rate_limited",
      "account_locked","bot_challenge","two_factor_required","permission_denied","content_not_found","feature_unavailable",
      "needs_human","needs_credentials","needs_2fa_code","needs_payment_confirmation","human_declined","human_timeout",
      "engine_unsupported","engine_crashed","out_of_memory","pool_exhausted",
      "unknown_error",
    ];
    expect(reasons.length).toBe(30);
  });
});
