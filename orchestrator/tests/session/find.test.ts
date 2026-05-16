import { describe, it, expect } from "vitest";
import { runFind } from "../../src/session/find.js";

describe("runFind", () => {
  const snapshot = {
    url: "https://example.com/",
    nodes: [
      { i: "h1", r: "button", n: "Sign in" },
      { i: "h2", r: "button", n: "Sign up" },
      { i: "h3", r: "link",   n: "Forgot password?" },
      { i: "h4", r: "textbox", n: "Email" },
      { i: "h5", r: "textbox", n: "Password" },
    ],
  };

  it("matches 'sign in button' to the button, not the link", async () => {
    const r = await runFind({ snapshot, cache: null }, { intent: "sign in button" });
    expect(r.candidates[0].stable_id).toBe("h1");
    expect(r.candidates[0].score).toBeGreaterThan(0.85);
  });

  it("returns up to top 3 candidates ranked by score", async () => {
    const r = await runFind({ snapshot, cache: null }, { intent: "sign" });
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    expect(r.candidates[0].score).toBeGreaterThanOrEqual(r.candidates[1].score);
  });

  it("filters by role hint if provided in intent", async () => {
    const r = await runFind({ snapshot, cache: null }, { intent: "email textbox" });
    expect(r.candidates[0].stable_id).toBe("h4");
    expect(r.candidates[0].role).toBe("textbox");
  });

  it("returns ok:false when nothing scores above threshold (0.5)", async () => {
    const r = await runFind({ snapshot, cache: null }, { intent: "checkout cart total" });
    expect(r.ok).toBe(false);
    expect(r.candidates).toEqual([]);
  });

  it("completes in under 5ms for snapshot of 200 nodes", async () => {
    const big = {
      url: "/",
      nodes: Array.from({ length: 200 }, (_, i) => ({
        i: `n${i}`, r: i % 2 ? "button" : "link", n: `Item ${i} label`,
      })),
    };
    const t0 = performance.now();
    await runFind({ snapshot: big, cache: null }, { intent: "item 137 label" });
    expect(performance.now() - t0).toBeLessThan(5);
  });
});
