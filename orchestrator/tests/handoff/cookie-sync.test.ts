import { describe, it, expect, vi } from "vitest";
import { scopeCookies, eTldPlusOne, syncCookies } from "../../src/handoff/cookie-sync.js";
import type { CdpCookie } from "../../src/handoff/chrome-watcher.js";

const c = (overrides: Partial<CdpCookie>): CdpCookie => ({
  name: "x", value: "y", domain: "example.com", path: "/", ...overrides,
});

describe("eTldPlusOne", () => {
  it("returns the last 2 dotted parts", () => {
    expect(eTldPlusOne("linkedin.com")).toBe("linkedin.com");
    expect(eTldPlusOne("www.linkedin.com")).toBe("linkedin.com");
    expect(eTldPlusOne("accounts.linkedin.com")).toBe("linkedin.com");
    expect(eTldPlusOne("static.www.linkedin.com")).toBe("linkedin.com");
  });

  it("strips a leading dot (Chrome uses .linkedin.com as a domain)", () => {
    expect(eTldPlusOne(".linkedin.com")).toBe("linkedin.com");
  });

  it("single label returns itself (localhost)", () => {
    expect(eTldPlusOne("localhost")).toBe("localhost");
  });
});

describe("scopeCookies", () => {
  it("keeps cookies for the target eTLD+1 and its subdomains", () => {
    const cookies: CdpCookie[] = [
      c({ name: "li_at", domain: ".linkedin.com" }),
      c({ name: "JSESSIONID", domain: "www.linkedin.com" }),
      c({ name: "tracker", domain: "linkedin.com" }),
    ];
    expect(scopeCookies(cookies, "https://www.linkedin.com/feed")).toHaveLength(3);
  });

  it("drops cookies for unrelated domains (analytics, ads, third-party)", () => {
    const cookies: CdpCookie[] = [
      c({ name: "li_at", domain: ".linkedin.com" }),
      c({ name: "_ga", domain: ".google.com" }),
      c({ name: "_fbp", domain: ".facebook.com" }),
      c({ name: "DSID", domain: ".doubleclick.net" }),
    ];
    const scoped = scopeCookies(cookies, "https://linkedin.com/feed");
    expect(scoped).toHaveLength(1);
    expect(scoped[0].name).toBe("li_at");
  });

  it("drops look-alike domains that aren't actually subdomains", () => {
    // "linkedin-fake.com" must NOT match "linkedin.com"
    const cookies: CdpCookie[] = [
      c({ name: "real", domain: ".linkedin.com" }),
      c({ name: "fake", domain: ".linkedin-fake.com" }),
    ];
    const scoped = scopeCookies(cookies, "https://linkedin.com/login");
    expect(scoped.map((x) => x.name)).toEqual(["real"]);
  });

  it("returns empty when no cookies match", () => {
    const cookies: CdpCookie[] = [c({ name: "x", domain: ".other.com" })];
    expect(scopeCookies(cookies, "https://linkedin.com/")).toEqual([]);
  });

  it("returns empty on invalid target URL", () => {
    const cookies: CdpCookie[] = [c({ name: "x", domain: ".linkedin.com" })];
    expect(scopeCookies(cookies, "not-a-url")).toEqual([]);
  });
});

describe("syncCookies", () => {
  it("calls watcher.getAllCookies, scopes, calls session.importCookies, returns import count", async () => {
    const watcher = {
      getAllCookies: vi.fn().mockResolvedValue([
        c({ name: "li_at", domain: ".linkedin.com" }),
        c({ name: "_ga", domain: ".google.com" }),
        c({ name: "JSESSIONID", domain: "www.linkedin.com" }),
      ]),
    };
    const session = {
      importCookies: vi.fn().mockResolvedValue(2),
    };
    const count = await syncCookies(watcher as any, session as any, "https://linkedin.com/feed");
    expect(watcher.getAllCookies).toHaveBeenCalledOnce();
    expect(session.importCookies).toHaveBeenCalledOnce();
    // session.importCookies received only the 2 linkedin cookies
    const passed = session.importCookies.mock.calls[0][0] as CdpCookie[];
    expect(passed).toHaveLength(2);
    expect(passed.map((x) => x.name).sort()).toEqual(["JSESSIONID", "li_at"]);
    expect(count).toBe(2);
  });

  it("returns 0 when no cookies match target domain", async () => {
    const watcher = { getAllCookies: vi.fn().mockResolvedValue([c({ name: "x", domain: ".other.com" })]) };
    const session = { importCookies: vi.fn().mockResolvedValue(0) };
    const count = await syncCookies(watcher as any, session as any, "https://linkedin.com/");
    expect(count).toBe(0);
    // importCookies NOT called when scoped list is empty (avoids a no-op CDP round-trip)
  });

  it("propagates importCookies error gracefully (returns 0, doesn't crash)", async () => {
    const watcher = { getAllCookies: vi.fn().mockResolvedValue([c({ name: "x", domain: ".linkedin.com" })]) };
    const session = { importCookies: vi.fn().mockRejectedValue(new Error("CDP setCookies failed")) };
    const count = await syncCookies(watcher as any, session as any, "https://linkedin.com/");
    expect(count).toBe(0);
  });
});
