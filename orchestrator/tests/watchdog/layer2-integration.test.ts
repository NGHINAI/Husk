import { describe, expect, it } from "vitest";
import { Watchdog } from "../../src/watchdog/watchdog.js";
import { parsePolicy } from "../../src/watchdog/policy.js";
import { SelectorResolver } from "../../src/snapshot/resolver.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function snap(url: string, n: { i: string; r: string; n: string; s?: ("v"|"e"|"c"|"f"|"d")[] }[]): Snapshot {
  const [root, ...rest] = n;
  const r = new SelectorResolver();
  rest.forEach((x, i) => r.set(x.i, 100 + i));
  return {
    v: 1, url, count: n.length,
    root: { ...root, s: root.s ?? ["v"], c: rest.map((x) => ({ ...x, s: x.s ?? ["v", "e"] })) },
    _resolver: r,
  };
}

describe("Watchdog Layer 2 (policy)", () => {
  it("rejects clicks on policy-forbidden buttons even when sanity passes", () => {
    const wd = new Watchdog();
    wd.setPolicy(parsePolicy(`
forbidden:
  - role: button
    name_matches: "(?i)delete"
    severity: hard
    message: "Delete blocked by policy"
`));
    const s = snap("https://x.test/", [
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "button:del", r: "button", n: "Delete account", s: ["v", "e"] },
    ]);
    const res = wd.evaluatePre(s, "click", "button:del");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.envelope.reason).toBe("policy_forbidden");
      expect(res.envelope.message).toBe("Delete blocked by policy");
    }
  });

  it("allows clicks on non-forbidden buttons when policy is set", () => {
    const wd = new Watchdog();
    wd.setPolicy(parsePolicy(`
forbidden:
  - role: button
    name_matches: "(?i)delete"
    severity: hard
`));
    const s = snap("https://x.test/", [
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "button:ok", r: "button", n: "Save", s: ["v", "e"] },
    ]);
    const res = wd.evaluatePre(s, "click", "button:ok");
    expect(res.ok).toBe(true);
  });

  it("denies clicks on disallowed domains", () => {
    const wd = new Watchdog();
    wd.setPolicy(parsePolicy(`
allow_domains: ["*.geico.com"]
deny_domains: ["*"]
`));
    const s = snap("https://aetna.com/", [
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "button:b", r: "button", n: "OK", s: ["v", "e"] },
    ]);
    const res = wd.evaluatePre(s, "click", "button:b");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.envelope.reason).toBe("policy_domain_denied");
  });

  it("clearing policy reverts to Layer 1 only", () => {
    const wd = new Watchdog();
    wd.setPolicy(parsePolicy(`
forbidden:
  - role: button
    name_matches: "(?i)delete"
    severity: hard
`));
    wd.setPolicy(null);
    const s = snap("https://x.test/", [
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "button:del", r: "button", n: "Delete account", s: ["v", "e"] },
    ]);
    const res = wd.evaluatePre(s, "click", "button:del");
    expect(res.ok).toBe(true);
  });
});
