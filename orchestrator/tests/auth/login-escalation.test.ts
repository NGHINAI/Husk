/**
 * login-escalation.test.ts
 *
 * Tests the self-healing escalation path in the `login` method handler.
 * The escalation fires when:
 *   1. Automated login returns ok:false
 *   2. The post-fail snapshot shows bot-block markers
 *   3. ctx.chromePool exists + ctx.host === "127.0.0.1" + ctx.portRef is set
 *
 * All Chrome/handoff I/O is mocked — no real browser spawned.
 */

import { describe, it, expect, vi } from "vitest";
import { METHODS } from "../../src/http/methods.js";

// ---------------------------------------------------------------------------
// Mock the handoff module (no real Chrome)
// ---------------------------------------------------------------------------
vi.mock("../../src/handoff/index.js", async () => ({
  findChrome: () => "/mock/chrome",
  spawnChrome: vi.fn(),
  connectToChrome: vi.fn(),
  createHandoffProfileDir: vi.fn().mockResolvedValue("/tmp/mock-handoff"),
  runSeamlessHandoff: vi.fn().mockImplementation(async (opts: any) => {
    opts.onManualDoneHandle?.(() => {});
    return { resumed: true, cookies_imported: 8, ms_paused: 3500 };
  }),
}));

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

/** A snapshot that looks like a bot-block (sparse LinkedIn login page, no form). */
function botBlockSnap(url = "https://www.linkedin.com/login") {
  return {
    v: 1, url,
    count: 4,
    root: { i: "r", r: "RootWebArea", n: "Ha habido un problema", s: [], c: [
      { i: "x", r: "heading", n: "Ha habido un problema", s: [], c: [] },
      { i: "y", r: "button", n: "Reintentar", s: [], c: [] },
    ]},
    sibling_sessions: [],
    signature: { dom_hash: "a", network_fingerprint: "b", url },
    meta: { title: null, canonical: null, og: {}, jsonld: [] },
    forms: [],
    network: { recent: [], likely_api_endpoints: [] },
    console: [],
    summary: "Bot block page",
    session_history: [],
  };
}

/** A snapshot that looks like a real cred-failure (login form still there). */
function credFailSnap(url = "https://example.com/login") {
  return {
    v: 1, url,
    count: 20,
    root: {
      i: "r", r: "RootWebArea", n: "Sign in — incorrect credentials",
      s: [], c: Array(18).fill({ i: "x", r: "text", n: "normal content", s: [], c: [] }),
    },
    sibling_sessions: [],
    signature: { dom_hash: "c", network_fingerprint: "d", url },
    meta: { title: null, canonical: null, og: {}, jsonld: [] },
    forms: [{
      stable_id: null, action: "/auth", method: "POST", submit_text: "Sign in",
      fields: [
        { name: "email", type: "email", label: "Email", required: true, placeholder: null },
        { name: "password", type: "password", label: "Password", required: true, placeholder: null },
      ],
    }],
    network: { recent: [], likely_api_endpoints: [] },
    console: [],
    summary: "Login page",
    session_history: [],
  };
}

/** A snapshot that looks like a successful post-login dashboard. */
function dashboardSnap() {
  return {
    v: 1, url: "https://www.linkedin.com/feed",
    count: 50,
    root: { i: "r", r: "RootWebArea", n: "LinkedIn Feed", s: [], c: Array(48).fill({ i: "x", r: "text", n: "post", s: [], c: [] }) },
    sibling_sessions: [],
    signature: { dom_hash: "e", network_fingerprint: "f", url: "https://www.linkedin.com/feed" },
    meta: { title: "LinkedIn", canonical: null, og: { title: "Feed" }, jsonld: [] },
    forms: [],
    network: { recent: [], likely_api_endpoints: [] },
    console: [],
    summary: "Feed",
    session_history: [],
  };
}

// ---------------------------------------------------------------------------
// Session stub factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal session stub. The `login` method handler calls:
 *   session.login(...)       — automated attempt
 *   session.snapshot(...)    — fresh snapshot after failure (bot-block detection)
 *   session.snapshot(...)    — post-handoff verification
 */
function makeSession(opts: {
  loginResult: { ok: boolean; reason?: string; url_before?: string; url_after?: string };
  snapshots: object[];
}) {
  let snapIdx = 0;
  return {
    login: vi.fn().mockResolvedValue({ ...opts.loginResult, snapshot: undefined }),
    snapshot: vi.fn().mockImplementation(async () => opts.snapshots[Math.min(snapIdx++, opts.snapshots.length - 1)]),
    importCookies: vi.fn().mockResolvedValue(8),
  };
}

// ---------------------------------------------------------------------------
// Context stub factory
// ---------------------------------------------------------------------------

function makeCtx(session: object, overrides: Record<string, unknown> = {}) {
  return {
    sessions: { get: () => session },
    credentials: { get: vi.fn() },
    host: "127.0.0.1",
    portRef: { value: 7777 },
    chromePool: { acquire: vi.fn() }, // presence enables escalation path
    seamlessTriggers: new Map<string, () => void>(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("login method — happy path (automated success)", () => {
  it("returns ok:true immediately when automated login succeeds (no escalation)", async () => {
    const session = makeSession({
      loginResult: { ok: true, url_before: "https://example.com/login", url_after: "https://example.com/dashboard" },
      snapshots: [],
    });
    const ctx = makeCtx(session);

    const r = await METHODS.login({ session_id: "s1", username: "user", password: "pass" }, ctx as any);

    expect(r.ok).toBe(true);
    expect((r as any).escalated_via).toBeUndefined();
    // snapshot() must NOT have been called — no escalation branch entered
    expect(session.snapshot).not.toHaveBeenCalled();
  });
});

describe("login method — bot-block escalation", () => {
  it("escalates via seamless handoff when bot-block detected", async () => {
    // Automated login fails; post-fail snap shows bot-block; post-handoff snap is dashboard
    const session = makeSession({
      loginResult: { ok: false, reason: "login_form_not_found" },
      snapshots: [botBlockSnap(), dashboardSnap()],
    });
    const ctx = makeCtx(session);

    const r = await METHODS.login({ session_id: "s1", username: "user", password: "pass" }, ctx as any);

    expect(r.ok).toBe(true);
    expect((r as any).escalated_via).toBe("seamless_handoff");
    expect((r as any).cookies_imported).toBe(8);
    expect(typeof (r as any).ms_paused).toBe("number");
    expect(Array.isArray((r as any).escalation_reasons)).toBe(true);
    expect((r as any).url_after).toBe("https://www.linkedin.com/feed");
  });

  it("returns ok:false with login_verification_failed when still on login URL post-handoff", async () => {
    // Automated login fails; post-fail snap = bot-block; post-handoff snap = STILL on login
    const session = makeSession({
      loginResult: { ok: false, reason: "login_form_not_found" },
      snapshots: [botBlockSnap(), botBlockSnap()], // still on login after handoff
    });
    const ctx = makeCtx(session);

    const r = await METHODS.login({ session_id: "s1", username: "user", password: "pass" }, ctx as any);

    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("login_verification_failed");
    expect((r as any).escalated_via).toBe("seamless_handoff");
    expect((r as any).cookies_imported).toBe(8);
  });
});

describe("login method — real credential failure (no escalation)", () => {
  it("does NOT escalate when post-fail snapshot shows an intact login form", async () => {
    // Bot-block conditions NOT met: cred failure page has a real form
    const session = makeSession({
      loginResult: { ok: false, reason: "login_did_not_advance" },
      snapshots: [credFailSnap()],
    });
    const ctx = makeCtx(session);

    const r = await METHODS.login({ session_id: "s1", username: "user", password: "wrong" }, ctx as any);

    expect(r.ok).toBe(false);
    expect((r as any).escalated_via).toBeUndefined();
    // snapshot() was called once for bot-block detection, but no handoff
    expect(session.snapshot).toHaveBeenCalledTimes(1);
  });
});

describe("login method — escalation unavailable", () => {
  it("does NOT escalate when chromePool is absent", async () => {
    const session = makeSession({
      loginResult: { ok: false, reason: "login_form_not_found" },
      snapshots: [botBlockSnap()],
    });
    // No chromePool → escalation path skipped entirely
    const ctx = makeCtx(session, { chromePool: undefined });

    const r = await METHODS.login({ session_id: "s1", username: "user", password: "pass" }, ctx as any);

    expect(r.ok).toBe(false);
    expect((r as any).escalated_via).toBeUndefined();
    expect(session.snapshot).not.toHaveBeenCalled();
  });

  it("does NOT escalate when host is not 127.0.0.1", async () => {
    const session = makeSession({
      loginResult: { ok: false, reason: "login_form_not_found" },
      snapshots: [botBlockSnap()],
    });
    const ctx = makeCtx(session, { host: "0.0.0.0" });

    const r = await METHODS.login({ session_id: "s1", username: "user", password: "pass" }, ctx as any);

    expect(r.ok).toBe(false);
    expect((r as any).escalated_via).toBeUndefined();
    expect(session.snapshot).not.toHaveBeenCalled();
  });

  it("does NOT escalate when portRef is absent", async () => {
    const session = makeSession({
      loginResult: { ok: false, reason: "login_form_not_found" },
      snapshots: [botBlockSnap()],
    });
    const ctx = makeCtx(session, { portRef: undefined });

    const r = await METHODS.login({ session_id: "s1", username: "user", password: "pass" }, ctx as any);

    expect(r.ok).toBe(false);
    expect((r as any).escalated_via).toBeUndefined();
    expect(session.snapshot).not.toHaveBeenCalled();
  });
});

describe("login method — Mode A credential lookup (profile+key)", () => {
  it("escalates via handoff when Mode A credentials fail with a bot-block", async () => {
    const session = makeSession({
      loginResult: { ok: false, reason: "login_form_not_found" },
      snapshots: [botBlockSnap(), dashboardSnap()],
    });
    const ctx = makeCtx(session, {
      credentials: {
        get: vi.fn().mockReturnValue({ username: "u", password: "p", totp_secret: undefined }),
      },
    });

    const r = await METHODS.login({ session_id: "s1", profile: "myprofile", key: "linkedin" }, ctx as any);

    expect(r.ok).toBe(true);
    expect((r as any).escalated_via).toBe("seamless_handoff");
  });

  it("returns credential_not_found when key missing (no escalation)", async () => {
    const session = makeSession({
      loginResult: { ok: false, reason: "login_form_not_found" },
      snapshots: [],
    });
    const ctx = makeCtx(session, {
      credentials: { get: vi.fn().mockReturnValue(null) },
    });

    const r = await METHODS.login({ session_id: "s1", profile: "myprofile", key: "missing" }, ctx as any);

    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("credential_not_found");
    expect(session.snapshot).not.toHaveBeenCalled();
  });
});
