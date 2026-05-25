import { describe, it, expect } from "vitest";
import { classifyError, recoveryStrategy } from "../../src/cognition/failure-taxonomy.js";

describe("failure-taxonomy", () => {
  it("classifies 429 errors as rate_limited", () => {
    expect(classifyError(new Error("HTTP 429 Too Many Requests")).reason).toBe("rate_limited");
  });

  it("classifies 2FA errors", () => {
    expect(classifyError(new Error("two-factor authentication required")).reason).toBe("two_factor_required");
  });

  it("classifies bot challenges", () => {
    expect(classifyError(new Error("captcha challenge detected")).reason).toBe("bot_challenge");
  });

  it("classifies timeouts", () => {
    expect(classifyError(new Error("operation timed out after 5000ms")).reason).toBe("timeout");
  });

  it("classifies network failures", () => {
    expect(classifyError(new Error("fetch failed: ECONNRESET")).reason).toBe("network_failure");
  });

  it("classifies element-not-found", () => {
    expect(classifyError(new Error("no such element in snapshot")).reason).toBe("element_not_found");
  });

  it("falls back to unknown_error", () => {
    expect(classifyError(new Error("something obscure")).reason).toBe("unknown_error");
  });

  it("handles non-Error throws", () => {
    expect(classifyError("string error").reason).toBe("unknown_error");
    expect(classifyError(null).reason).toBe("unknown_error");
  });

  it("recoveryStrategy returns non-empty strings for all reasons", () => {
    const sample: Array<"rate_limited" | "bot_challenge" | "no_path_to_target" | "unknown_error"> = [
      "rate_limited", "bot_challenge", "no_path_to_target", "unknown_error",
    ];
    for (const r of sample) {
      expect(recoveryStrategy(r).length).toBeGreaterThan(0);
    }
  });
});
