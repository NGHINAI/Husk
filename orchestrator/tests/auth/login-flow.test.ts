import { describe, expect, it, vi } from "vitest";
import { performLogin, type LoginInput } from "../../src/auth/login-flow.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function loginSnap(): Snapshot {
  return {
    v: 1, url: "https://x.test/login", count: 4,
    root: {
      i: "root:1", r: "RootWebArea", n: "Sign in", s: ["v"],
      c: [
        { i: "tb:u", r: "textbox", n: "Email", s: ["v", "e"] },
        { i: "tb:p", r: "textbox", n: "Password", s: ["v", "e"] },
        { i: "btn:s", r: "button", n: "Sign in", s: ["v", "e"] },
      ],
    },
  };
}

function postLoginSnap(): Snapshot {
  return {
    v: 1, url: "https://x.test/dashboard", count: 2,
    root: {
      i: "root:2", r: "RootWebArea", n: "Welcome", s: ["v"],
      c: [{ i: "h:1", r: "heading", n: "Welcome back", s: ["v"] }],
    },
  };
}

function fakeSession(snaps: Snapshot[]) {
  let calls = 0;
  const log: Array<{ method: string; args: unknown[] }> = [];
  return {
    log,
    snapshot: async () => snaps[Math.min(calls++, snaps.length - 1)],
    type: vi.fn(async (id: string, text: string) => {
      log.push({ method: "type", args: [id, text] });
      return { ok: true, warnings: [] };
    }),
    click: vi.fn(async (id: string) => {
      log.push({ method: "click", args: [id] });
      return { ok: true, warnings: [] };
    }),
    pressKey: vi.fn(async () => ({ ok: true, warnings: [] })),
  };
}

describe("performLogin", () => {
  it("types username + password and clicks submit", async () => {
    const session = fakeSession([loginSnap(), postLoginSnap()]);
    const input: LoginInput = { username: "demo@x.test", password: "secret" };
    const r = await performLogin(session as any, input);
    expect(r.ok).toBe(true);
    expect(session.log).toEqual([
      { method: "type", args: ["tb:u", "demo@x.test"] },
      { method: "type", args: ["tb:p", "secret"] },
      { method: "click", args: ["btn:s"] },
    ]);
  });

  it("returns ok=false when login fields not found", async () => {
    const blank: Snapshot = { v: 1, url: "https://x.test/", count: 1, root: { i: "r", r: "RootWebArea", n: "Empty", s: ["v"] } };
    const session = fakeSession([blank, blank]);
    const r = await performLogin(session as any, { username: "u", password: "p" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("login_form_not_found");
  });

  it("includes TOTP code when totp field + secret are present", async () => {
    const totpSnap: Snapshot = {
      v: 1, url: "https://x.test/2fa", count: 3,
      root: {
        i: "r", r: "RootWebArea", n: "2FA", s: ["v"],
        c: [
          { i: "tb:c", r: "textbox", n: "One-time code", s: ["v", "e"] },
          { i: "btn:v", r: "button", n: "Verify", s: ["v", "e"] },
        ],
      },
    };
    const session = fakeSession([loginSnap(), totpSnap, postLoginSnap()]);
    const r = await performLogin(session as any, {
      username: "demo", password: "x", totp_code: "123456",
    });
    expect(r.ok).toBe(true);
    expect(session.log.find((c) => c.method === "type" && c.args[0] === "tb:c")?.args[1]).toBe("123456");
  });

  it("returns ok=false when post-login snapshot still shows password field", async () => {
    const session = fakeSession([loginSnap(), loginSnap()]);
    const r = await performLogin(session as any, { username: "u", password: "bad" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("login_did_not_advance");
  });

  it("returns ok=false when click rejected by watchdog", async () => {
    const session = {
      ...fakeSession([loginSnap()]),
      click: vi.fn(async () => ({
        ok: false, reason: "element_not_found", verb: "click",
        stable_id_attempted: "btn:s", candidates: [],
        snapshot_at_attempt: loginSnap(),
      })),
    };
    const r = await performLogin(session as any, { username: "u", password: "p" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("watchdog_rejected");
  });

  it("URL change counts as success even if a password-named field exists post-login", async () => {
    const dashWithChangePw: Snapshot = {
      v: 1, url: "https://x.test/dashboard", count: 3,
      root: {
        i: "r", r: "RootWebArea", n: "Dashboard", s: ["v"],
        c: [
          { i: "h", r: "heading", n: "Welcome", s: ["v"] },
          { i: "tb:p", r: "textbox", n: "Current password (to change)", s: ["v", "e"] },
        ],
      },
    };
    const session = fakeSession([loginSnap(), dashWithChangePw]);
    const r = await performLogin(session as any, { username: "u", password: "p" });
    expect(r.ok).toBe(true);
  });
});
