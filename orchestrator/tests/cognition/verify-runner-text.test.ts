import { describe, it, expect } from "vitest";
import { runVerify } from "../../src/cognition/verify-runner.js";
import type { VerifyCheck, VerifyContext } from "../../src/cognition/verify-runner.js";

const snap = (text: string) => ({
  currentUrl: "https://x.com/",
  snapshot: {
    url: "https://x.com/",
    root: {
      i: "r",
      r: "main",
      n: "",
      c: [{ i: "a", r: "heading", n: text }],
    },
  },
} as unknown as VerifyContext);

describe("verify-runner text checks", () => {
  it("text_present passes when pattern matches in AX tree text", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "Welcome", description: "shows welcome" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(true);
    expect(ev.observed_value).toBe("Welcome");
    expect(ev.source).toBe("text");
  });

  it("text_present is case-insensitive by default", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "welcome", description: "shows welcome" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(true);
  });

  it("text_present fails when pattern not in tree", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "Error", description: "no error" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(false);
  });

  it("text_absent passes when pattern is absent", () => {
    const check: VerifyCheck = { type: "text_absent", pattern: "Error", description: "no error visible" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(true);
  });

  it("text_absent fails when pattern is present", () => {
    const check: VerifyCheck = { type: "text_absent", pattern: "Welcome", description: "no welcome" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(false);
  });

  it("invalid regex returns passed:false rather than throwing", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "[invalid(", description: "bad regex" };
    const ev = runVerify(check, snap("anything"));
    expect(ev.passed).toBe(false);
  });

  it("evidence carries ts + source", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "X", description: "x" };
    const ev = runVerify(check, snap("X"));
    expect(ev.ts).toBeGreaterThan(0);
    expect(ev.source).toBe("text");
  });
});
