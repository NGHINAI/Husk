/**
 * Tests for the confidence engine — Task 5 of M18 Phase A.
 *
 * All math is locked:
 *   - new transition: 0.5
 *   - success: +0.05, capped at 0.99
 *   - failure: -0.10, floored at 0.05
 *   - weekly decay: -0.01 per week (integer floor), floored at 0.05
 *   - reliability (Laplace-smoothed): success_count / (success_count + failure_count + 2)
 */

import { describe, it, expect } from "vitest";
import {
  newTransitionConfidence,
  applySuccess,
  applyFailure,
  decay,
  reliability,
} from "../../src/cognition/confidence.js";

// ---------------------------------------------------------------------------
// newTransitionConfidence
// ---------------------------------------------------------------------------

describe("newTransitionConfidence", () => {
  it("returns exactly 0.5", () => {
    expect(newTransitionConfidence()).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// applySuccess
// ---------------------------------------------------------------------------

describe("applySuccess", () => {
  it("adds 0.05 to the current confidence", () => {
    expect(applySuccess(0.5)).toBeCloseTo(0.55, 5);
  });

  it("caps at 0.99 when input is 0.97", () => {
    expect(applySuccess(0.97)).toBe(0.99);
  });

  it("caps at 0.99 when input is already 0.99", () => {
    expect(applySuccess(0.99)).toBe(0.99);
  });

  it("handles low values correctly", () => {
    expect(applySuccess(0.05)).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------
// applyFailure
// ---------------------------------------------------------------------------

describe("applyFailure", () => {
  it("subtracts 0.10 from the current confidence", () => {
    expect(applyFailure(0.5)).toBeCloseTo(0.4, 5);
  });

  it("floors at 0.05 when input is 0.10", () => {
    expect(applyFailure(0.10)).toBe(0.05);
  });

  it("floors at 0.05 when input is already 0.05", () => {
    expect(applyFailure(0.05)).toBe(0.05);
  });

  it("handles high values correctly", () => {
    expect(applyFailure(0.99)).toBeCloseTo(0.89, 5);
  });
});

// ---------------------------------------------------------------------------
// decay
// ---------------------------------------------------------------------------

describe("decay", () => {
  it("returns current unchanged when last_used_at === now_at", () => {
    const now = 1000;
    expect(decay(0.5, now, now)).toBe(0.5);
  });

  it("decays by 0.01 when exactly 1 week (7 days * 24 * 60 * 60 * 1000 ms) has elapsed", () => {
    const last_used_at = 0;
    const one_week_ms = 7 * 24 * 60 * 60 * 1000;
    const now_at = last_used_at + one_week_ms;
    expect(decay(0.5, last_used_at, now_at)).toBeCloseTo(0.49, 5);
  });

  it("decays by 0.10 when exactly 10 weeks have elapsed", () => {
    const last_used_at = 0;
    const ten_weeks_ms = 10 * 7 * 24 * 60 * 60 * 1000;
    const now_at = last_used_at + ten_weeks_ms;
    expect(decay(0.5, last_used_at, now_at)).toBeCloseTo(0.4, 5);
  });

  it("floors result at 0.05 when decay would go below", () => {
    const last_used_at = 0;
    // Start at 0.08, decay 0.10 (or more over weeks), should floor at 0.05
    const ten_weeks_ms = 10 * 7 * 24 * 60 * 60 * 1000;
    const now_at = last_used_at + ten_weeks_ms;
    expect(decay(0.08, last_used_at, now_at)).toBe(0.05);
  });

  it("does not decay for partial weeks (e.g. 3 days) — integer floor", () => {
    const last_used_at = 0;
    const three_days_ms = 3 * 24 * 60 * 60 * 1000;
    const now_at = last_used_at + three_days_ms;
    expect(decay(0.5, last_used_at, now_at)).toBe(0.5);
  });

  it("does not decay for 6 days (partial week) — integer floor", () => {
    const last_used_at = 0;
    const six_days_ms = 6 * 24 * 60 * 60 * 1000;
    const now_at = last_used_at + six_days_ms;
    expect(decay(0.5, last_used_at, now_at)).toBe(0.5);
  });

  it("returns current unchanged when last_used_at > now_at (negative time)", () => {
    expect(decay(0.5, 2000, 1000)).toBe(0.5);
  });

  it("floors at 0.05 even with massive elapsed time (52 weeks)", () => {
    const last_used_at = 0;
    const fifty_two_weeks_ms = 52 * 7 * 24 * 60 * 60 * 1000;
    const now_at = last_used_at + fifty_two_weeks_ms;
    expect(decay(0.5, last_used_at, now_at)).toBe(0.05);
  });
});

// ---------------------------------------------------------------------------
// reliability
// ---------------------------------------------------------------------------

describe("reliability", () => {
  it("returns 0 for a new transition (0/0 case) via Laplace smoothing", () => {
    expect(reliability({ success_count: 0, failure_count: 0 })).toBe(0);
  });

  it("returns 10/12 for pure success (10/0)", () => {
    expect(reliability({ success_count: 10, failure_count: 0 })).toBeCloseTo(10 / 12, 5);
  });

  it("returns 0/12 for pure failure (0/10)", () => {
    expect(reliability({ success_count: 0, failure_count: 10 })).toBe(0);
  });

  it("returns 5/12 for mixed (5/5)", () => {
    expect(reliability({ success_count: 5, failure_count: 5 })).toBeCloseTo(5 / 12, 5);
  });

  it("applies Laplace smoothing +2 in denominator only", () => {
    // 0/(0+10+2) = 0/12
    expect(reliability({ success_count: 0, failure_count: 10 })).toBeCloseTo(0 / 12, 5);
    // 1/(1+0+2) = 1/3
    expect(reliability({ success_count: 1, failure_count: 0 })).toBeCloseTo(1 / 3, 5);
  });

  it("ranks high-confidence (99/100) above low-confidence (1/0)", () => {
    const high_confidence = reliability({ success_count: 99, failure_count: 1 });
    const low_confidence = reliability({ success_count: 1, failure_count: 0 });
    expect(high_confidence).toBeGreaterThan(low_confidence);
  });

  it("verifies 100 successes / 0 failures ranks higher than 1 success / 0 failures", () => {
    const many_successes = reliability({ success_count: 100, failure_count: 0 });
    const one_success = reliability({ success_count: 1, failure_count: 0 });
    expect(many_successes).toBeGreaterThan(one_success);
  });
});
