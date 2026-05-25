import { describe, it, expect } from "vitest";
import { intentRefToString, resolveIntentRef } from "../../src/cognition/intent-resolver.js";
import type { FindContext } from "../../src/session/find.js";

describe("intent-resolver", () => {
  it("converts IntentRef shapes to strings", () => {
    expect(intentRefToString({ button: "Connect" })).toBe("Connect button");
    expect(intentRefToString({ link: "Profile" })).toBe("Profile link");
    expect(intentRefToString({ textbox: "Email" })).toBe("Email textbox");
    expect(intentRefToString({ heading: "Login" })).toBe("Login heading");
    expect(intentRefToString({ role: "checkbox", name: "Remember me" })).toBe("Remember me checkbox");
  });

  it("resolves to the best-matching stable_id", async () => {
    const ctx: FindContext = {
      snapshot: {
        nodes: [
          { i: "a1", r: "button", n: "Connect" },
          { i: "a2", r: "button", n: "Cancel" },
        ],
      },
      cache: null,
    };
    const r = await resolveIntentRef({ button: "Connect" }, ctx);
    expect(r.stable_id).toBe("a1");
    expect(r.score).toBeGreaterThan(0.8);
  });

  it("returns null stable_id when nothing matches", async () => {
    const ctx: FindContext = {
      snapshot: { nodes: [{ i: "x", r: "textbox", n: "Search" }] },
      cache: null,
    };
    const r = await resolveIntentRef({ button: "Connect" }, ctx);
    expect(r.stable_id).toBeNull();
    expect(r.candidates).toHaveLength(0);
  });

  it("fuzzy-matches near-but-not-exact names", async () => {
    const ctx: FindContext = {
      snapshot: {
        nodes: [{ i: "n1", r: "button", n: "Send Invitation" }],
      },
      cache: null,
    };
    const r = await resolveIntentRef({ button: "Send" }, ctx);
    // fuzzy match should pick it up since "Send" overlaps with "Send Invitation"
    expect(r.stable_id).toBe("n1");
  });
});
