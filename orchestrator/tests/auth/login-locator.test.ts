import { describe, expect, it } from "vitest";
import { locateLoginFields } from "../../src/auth/login-locator.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function snap(rootKids: Array<{ i: string; r: string; n: string; s?: ("v"|"e"|"c"|"f"|"d")[] }>): Snapshot {
  return {
    v: 1, url: "https://x.test/", count: rootKids.length + 1,
    root: {
      i: "root:1", r: "RootWebArea", n: "Sign in", s: ["v"],
      c: rootKids.map((n) => ({ ...n, s: n.s ?? ["v", "e"] })),
    },
  };
}

describe("locateLoginFields", () => {
  it("finds username/password/submit on a vanilla form", () => {
    const s = snap([
      { i: "tb:u", r: "textbox", n: "Username" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:s", r: "button", n: "Sign in" },
    ]);
    const r = locateLoginFields(s);
    expect(r.username?.i).toBe("tb:u");
    expect(r.password?.i).toBe("tb:p");
    expect(r.submit?.i).toBe("btn:s");
  });

  it("recognises 'Email' as a username synonym", () => {
    const s = snap([
      { i: "tb:e", r: "textbox", n: "Email" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:s", r: "button", n: "Log in" },
    ]);
    const r = locateLoginFields(s);
    expect(r.username?.i).toBe("tb:e");
    expect(r.submit?.i).toBe("btn:s");
  });

  it("recognises searchbox/combobox as username field types", () => {
    const s = snap([
      { i: "cb:u", r: "combobox", n: "Username" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:s", r: "button", n: "Submit" },
    ]);
    expect(locateLoginFields(s).username?.i).toBe("cb:u");
  });

  it("returns null fields when not found", () => {
    const s = snap([
      { i: "h:1", r: "heading", n: "Not a login page" },
    ]);
    const r = locateLoginFields(s);
    expect(r.username).toBeNull();
    expect(r.password).toBeNull();
    expect(r.submit).toBeNull();
  });

  it("requires the password textbox to have a name matching /password/i", () => {
    const s = snap([
      { i: "tb:u", r: "textbox", n: "Email" },
      { i: "tb:x", r: "textbox", n: "Birthday" },
      { i: "btn:s", r: "button", n: "Submit" },
    ]);
    const r = locateLoginFields(s);
    expect(r.password).toBeNull();
  });

  it("totp field heuristic finds 'One-time code' / '2FA' / 'Verification'", () => {
    const s = snap([
      { i: "tb:c", r: "textbox", n: "One-time code" },
      { i: "btn:s", r: "button", n: "Verify" },
    ]);
    const r = locateLoginFields(s);
    expect(r.totp?.i).toBe("tb:c");
    expect(r.submit?.i).toBe("btn:s");
  });

  it("submit fallback uses /verify|continue/i when /sign in|log in|submit/i absent", () => {
    const s = snap([
      { i: "tb:u", r: "textbox", n: "Username" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:s", r: "button", n: "Continue" },
    ]);
    expect(locateLoginFields(s).submit?.i).toBe("btn:s");
  });

  it("prefers visible enabled buttons over disabled ones", () => {
    const s = snap([
      { i: "tb:u", r: "textbox", n: "Username" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:d", r: "button", n: "Sign in", s: ["v", "d"] },
      { i: "btn:e", r: "button", n: "Sign in" },
    ]);
    expect(locateLoginFields(s).submit?.i).toBe("btn:e");
  });
});
