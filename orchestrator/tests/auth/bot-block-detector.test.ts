import { describe, it, expect } from "vitest";
import { detectLoginBotBlock } from "../../src/auth/bot-block-detector.js";
import type { Snapshot } from "../../src/snapshot/types.js";

// ---------------------------------------------------------------------------
// Snapshot factory — builds a minimal but valid Snapshot
// ---------------------------------------------------------------------------
function snap(overrides: Partial<Snapshot> & { url?: string }): Snapshot {
  return {
    v: 1,
    url: "https://example.com/",
    count: 1,
    root: { i: "r", r: "RootWebArea", n: "", s: [], c: [] },
    sibling_sessions: [],
    signature: { dom_hash: "x", network_fingerprint: "y", url: "" },
    meta: { title: null, canonical: null, og: {}, jsonld: [] },
    forms: [],
    network: { recent: [], likely_api_endpoints: [] },
    console: [],
    summary: "",
    session_history: [],
    ...overrides,
  } as unknown as Snapshot;
}

// ---------------------------------------------------------------------------
// Heuristic 1: login-block text patterns
// ---------------------------------------------------------------------------
describe("detectLoginBotBlock — block text patterns", () => {
  it("fires on 'Ha habido un problema' (LinkedIn bot-block, Spanish)", () => {
    const s = snap({
      url: "https://www.linkedin.com/login",
      root: { i: "r", r: "RootWebArea", n: "Ha habido un problema", s: [], c: [] } as any,
      forms: [],
    });
    const v = detectLoginBotBlock(s);
    expect(v.is_blocked).toBe(true);
    expect(v.reasons.some((r) => r.includes("block_text"))).toBe(true);
  });

  it("fires on 'Something went wrong'", () => {
    const s = snap({
      url: "https://example.com/login",
      root: { i: "r", r: "RootWebArea", n: "Something went wrong. Try again.", s: [], c: [] } as any,
    });
    expect(detectLoginBotBlock(s).is_blocked).toBe(true);
  });

  it("fires on 'verify your account'", () => {
    const s = snap({
      url: "https://example.com/verify",
      root: { i: "r", r: "RootWebArea", n: "We need you to verify your account", s: [], c: [] } as any,
    });
    expect(detectLoginBotBlock(s).is_blocked).toBe(true);
  });

  it("fires on 'unusual activity'", () => {
    const s = snap({
      url: "https://example.com/challenge",
      root: { i: "r", r: "RootWebArea", n: "We detected unusual activity on your account", s: [], c: [] } as any,
    });
    expect(detectLoginBotBlock(s).is_blocked).toBe(true);
  });

  it("fires on 'complete the captcha'", () => {
    const s = snap({
      url: "https://example.com/login",
      root: { i: "r", r: "RootWebArea", n: "Please complete the captcha to continue", s: [], c: [] } as any,
    });
    expect(detectLoginBotBlock(s).is_blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Heuristic 1 (M17 page-health markers) via console errors
// ---------------------------------------------------------------------------
describe("detectLoginBotBlock — M17 page-health markers", () => {
  it("fires on BroadcastChannel polyfill error (M17 marker)", () => {
    const s = snap({
      url: "https://www.linkedin.com/login",
      console: [{ level: "error" as const, text: "ReferenceError: BroadcastChannel is not defined", ts: 1 }],
    });
    const v = detectLoginBotBlock(s);
    expect(v.is_blocked).toBe(true);
    expect(v.reasons.some((r) => r.startsWith("page_health:"))).toBe(true);
  });

  it("fires on IndexedDB polyfill error", () => {
    const s = snap({
      url: "https://www.linkedin.com/login",
      console: [{ level: "error" as const, text: "ReferenceError: IndexedDB is not defined", ts: 1 }],
    });
    expect(detectLoginBotBlock(s).is_blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Heuristic 3: still on login URL with no form
// ---------------------------------------------------------------------------
describe("detectLoginBotBlock — login URL without form", () => {
  it("fires on /login path with no forms and sparse AX tree", () => {
    const s = snap({
      url: "https://example.com/login",
      forms: [],
      root: {
        i: "r", r: "RootWebArea", n: "Login", s: [], c: Array(10).fill({ i: "x", r: "text", n: "...", s: [], c: [] }),
      } as any,
    });
    const v = detectLoginBotBlock(s);
    expect(v.is_blocked).toBe(true);
    expect(v.reasons).toContain("login_url_no_form");
  });

  it("fires on /checkpoint path with no forms", () => {
    const s = snap({
      url: "https://www.linkedin.com/checkpoint/challenge/verify",
      forms: [],
      root: { i: "r", r: "RootWebArea", n: "Security verification", s: [], c: [] } as any,
    });
    expect(detectLoginBotBlock(s).is_blocked).toBe(true);
    expect(detectLoginBotBlock(s).reasons).toContain("login_url_no_form");
  });
});

// ---------------------------------------------------------------------------
// NOT blocked: real credential failure — login page re-renders with intact form
// ---------------------------------------------------------------------------
describe("detectLoginBotBlock — real credential failures (should NOT fire)", () => {
  it("does NOT fire on a normal login page with an actual form (password-wrong scenario)", () => {
    const s = snap({
      url: "https://example.com/login",
      forms: [
        {
          stable_id: null,
          action: "/auth",
          method: "POST",
          submit_text: "Sign in",
          fields: [
            { name: "email", type: "email", label: "Email", required: true, placeholder: null },
            { name: "password", type: "password", label: "Password", required: true, placeholder: null },
          ],
        },
      ] as any,
      root: {
        i: "r", r: "RootWebArea", n: "Sign in — incorrect password, please check your credentials", s: [],
        c: Array(20).fill({ i: "x", r: "text", n: "normal content", s: [], c: [] }),
      } as any,
    });
    const v = detectLoginBotBlock(s);
    expect(v.is_blocked).toBe(false);
  });

  it("does NOT fire on a regular content page (Wikipedia)", () => {
    const s = snap({
      url: "https://en.wikipedia.org/wiki/Husk",
      root: {
        i: "r", r: "RootWebArea", n: "Husk - Wikipedia", s: [],
        c: Array(80).fill({ i: "x", r: "text", n: "wiki content", s: [], c: [] }),
      } as any,
    });
    expect(detectLoginBotBlock(s).is_blocked).toBe(false);
  });

  it("does NOT fire on a successful dashboard page", () => {
    const s = snap({
      url: "https://app.example.com/dashboard",
      root: {
        i: "r", r: "RootWebArea", n: "Dashboard", s: [],
        c: Array(50).fill({ i: "x", r: "heading", n: "Welcome back", s: [], c: [] }),
      } as any,
    });
    expect(detectLoginBotBlock(s).is_blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// login_url field is always set to the snapshot URL
// ---------------------------------------------------------------------------
describe("detectLoginBotBlock — login_url field", () => {
  it("populates login_url from snapshot.url", () => {
    const s = snap({
      url: "https://linkedin.com/login",
      root: { i: "r", r: "RootWebArea", n: "Ha habido un problema", s: [], c: [] } as any,
    });
    expect(detectLoginBotBlock(s).login_url).toBe("https://linkedin.com/login");
  });
});
