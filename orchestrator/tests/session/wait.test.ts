import { describe, it, expect } from "vitest";
import { runWaitFor } from "../../src/session/wait.js";

describe("runWaitFor", () => {
  it("resolves text condition when text appears in snapshot", async () => {
    const session = makeFakeSession({ snapshots: [
      { url: "https://x", nodes: [{ i: "a", r: "heading", n: "Login" }] },
      { url: "https://x", nodes: [{ i: "a", r: "heading", n: "Logged in" }] },
    ]});
    const r = await runWaitFor(session, { text: "Logged in", timeout_ms: 1000 });
    expect(r.ok).toBe(true);
    expect(r.condition_met).toBe("text");
  });

  it("resolves url_matches via regex", async () => {
    const session = makeFakeSession({ snapshots: [
      { url: "https://x/login", nodes: [] },
      { url: "https://x/dashboard", nodes: [] },
    ]});
    const r = await runWaitFor(session, { url_matches: "/dashboard$", timeout_ms: 1000 });
    expect(r.ok).toBe(true);
  });

  it("resolves role+name match", async () => {
    const session = makeFakeSession({ snapshots: [
      { url: "/", nodes: [{ i: "x", r: "button", n: "Cancel" }] },
      { url: "/", nodes: [{ i: "y", r: "button", n: "Submit" }] },
    ]});
    const r = await runWaitFor(session, {
      role: "button", name: "Submit", timeout_ms: 1000,
    });
    expect(r.ok).toBe(true);
    expect(r.stable_id).toBe("y");
  });

  it("resolves selector_visible via Runtime.evaluate", async () => {
    const session = makeFakeSession({ evalResults: [null, "visible"] });
    const r = await runWaitFor(session, { selector_visible: ".modal", timeout_ms: 1000 });
    expect(r.ok).toBe(true);
  });

  it("times out when condition never met", async () => {
    const session = makeFakeSession({ snapshots: [{ url: "/", nodes: [] }] });
    const r = await runWaitFor(session, { text: "never", timeout_ms: 200 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout");
  });

  it("rejects when no condition specified", async () => {
    const session = makeFakeSession({});
    await expect(runWaitFor(session, { timeout_ms: 1000 } as never)).rejects.toThrow(/condition/);
  });
});

function makeFakeSession(opts: {
  snapshots?: Array<{ url: string; nodes: Array<{ i: string; r: string; n: string }> }>;
  evalResults?: Array<unknown>;
}) {
  let snapIdx = 0;
  let evalIdx = 0;
  return {
    async snapshot() {
      const s = opts.snapshots?.[Math.min(snapIdx, (opts.snapshots?.length ?? 1) - 1)] ?? { url: "/", nodes: [] };
      snapIdx++;
      return s;
    },
    async runtimeEval(_expr: string) {
      const v = opts.evalResults?.[evalIdx];
      evalIdx++;
      return v;
    },
  };
}
