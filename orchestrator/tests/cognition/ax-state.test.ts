import { describe, it, expect } from "vitest";
import { runVerify } from "../../src/cognition/verify-runner.js";
import type { VerifyCheck, VerifyContext } from "../../src/cognition/verify-runner.js";

function nodeWithState(role: string, name: string, states: Array<{ name: string; value: unknown }>) {
  return {
    url: "https://x.com/",
    snapshot: {
      url: "https://x.com/",
      root: {
        i: "r", r: "main", n: "",
        c: [{ i: "n1", r: role, n: name, s: states.map(s => ({ name: s.name, value: { value: s.value } })) }],
      },
    },
  } as unknown as VerifyContext;
}

describe("ax_state verify check", () => {
  it("passes when expected state is true", () => {
    const ctx = nodeWithState("button", "Send", [{ name: "disabled", value: true }]);
    const ev = runVerify({ type: "ax_state", role: "button", name: "Send", state: "disabled", description: "send disabled" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(true);
    expect(ev.source).toBe("ax");
  });

  it("fails when expected=true but state is false", () => {
    const ctx = nodeWithState("button", "Send", [{ name: "disabled", value: false }]);
    const ev = runVerify({ type: "ax_state", role: "button", name: "Send", state: "disabled", description: "send disabled" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(false);
  });

  it("passes with expected=false when state is absent (treated as false)", () => {
    const ctx = nodeWithState("button", "Send", []);
    const ev = runVerify({ type: "ax_state", role: "button", name: "Send", state: "disabled", expected: false, description: "not disabled" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(true);
  });

  it("returns node_not_found when role+name don't match", () => {
    const ctx = nodeWithState("button", "Send", [{ name: "checked", value: true }]);
    const ev = runVerify({ type: "ax_state", role: "button", name: "Ghost", state: "checked", description: "ghost" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(false);
    expect((ev.observed_value as { reason: string }).reason).toBe("node_not_found");
  });

  it("matches without name (any node with role+state)", () => {
    const ctx = nodeWithState("checkbox", "First", [{ name: "checked", value: true }]);
    const ev = runVerify({ type: "ax_state", role: "checkbox", state: "checked", description: "any checked" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(true);
  });

  it("name match is case-insensitive", () => {
    const ctx = nodeWithState("button", "Send Invite", [{ name: "disabled", value: true }]);
    const ev = runVerify({ type: "ax_state", role: "button", name: "send invite", state: "disabled", description: "ci" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(true);
  });
});
