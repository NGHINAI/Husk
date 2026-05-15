import { describe, expect, it } from "vitest";
import { parsePolicy, PolicyParseError } from "../../src/watchdog/policy.js";
import { evaluatePolicy, globMatches } from "../../src/watchdog/policy.js";
import type { Snapshot } from "../../src/snapshot/types.js";

describe("parsePolicy", () => {
  it("parses a minimal valid policy", () => {
    const p = parsePolicy(`
flow: insurance_quote
forbidden:
  - role: button
    name_matches: "(?i)delete"
    severity: hard
`);
    expect(p.flow).toBe("insurance_quote");
    expect(p.forbidden?.length).toBe(1);
    expect(p.forbidden?.[0].severity).toBe("hard");
  });

  it("parses required_before with prereq list", () => {
    const p = parsePolicy(`
required_before:
  - action: submit_form
    prereq:
      - role: checkbox
        name_matches: "(?i)i agree"
        state: checked
`);
    expect(p.required_before?.[0].action).toBe("submit_form");
    expect(p.required_before?.[0].prereq.length).toBe(1);
    expect(p.required_before?.[0].prereq[0].state).toBe("checked");
  });

  it("parses allow_domains / deny_domains glob lists", () => {
    const p = parsePolicy(`
allow_domains:
  - "*.geico.com"
  - "*.state-farm.com"
deny_domains:
  - "*"
`);
    expect(p.allow_domains).toEqual(["*.geico.com", "*.state-farm.com"]);
    expect(p.deny_domains).toEqual(["*"]);
  });

  it("throws PolicyParseError on invalid YAML", () => {
    expect(() => parsePolicy("forbidden: [unclosed")).toThrow(PolicyParseError);
  });

  it("throws PolicyParseError on missing required `severity` on forbidden rule", () => {
    expect(() => parsePolicy(`
forbidden:
  - role: button
    name_matches: "x"
`)).toThrow(/severity/);
  });

  it("throws PolicyParseError on unknown severity", () => {
    expect(() => parsePolicy(`
forbidden:
  - role: button
    name_matches: "x"
    severity: kinda-hard
`)).toThrow(/severity must be 'hard' or 'warn'/);
  });

  it("rejects a forbidden rule with neither role+name_matches NOR selector", () => {
    expect(() => parsePolicy(`
forbidden:
  - severity: hard
`)).toThrow(/role.*name_matches.*selector/);
  });
});

function snap(url: string, nodes: Array<{ i: string; r: string; n: string; s?: ("v"|"e"|"c"|"f"|"d")[] }>): Snapshot {
  const [root, ...rest] = nodes;
  return {
    v: 1, url, count: nodes.length,
    root: {
      ...root, s: root.s ?? ["v"],
      c: rest.map((n) => ({ ...n, s: n.s ?? ["v", "e"] })),
    },
  };
}

describe("globMatches", () => {
  it("matches plain '*' against any host", () => {
    expect(globMatches("*", "example.com")).toBe(true);
  });
  it("matches '*.foo.com' against 'a.foo.com'", () => {
    expect(globMatches("*.foo.com", "a.foo.com")).toBe(true);
    expect(globMatches("*.foo.com", "foo.com")).toBe(false);
    expect(globMatches("*.foo.com", "x.bar.com")).toBe(false);
  });
});

describe("evaluatePolicy — forbidden", () => {
  const target = snap("https://geico.com/account", [
    { i: "RootWebArea:r", r: "RootWebArea", n: "Account" },
    { i: "button:del", r: "button", n: "Delete account", s: ["v", "e"] },
  ]);

  it("returns hard rejection when verb + role + name_matches match", () => {
    const res = evaluatePolicy(
      { forbidden: [{ role: "button", name_matches: "(?i)delete", severity: "hard" }] },
      { verb: "click", node: target.root.c![0], snapshot: target }
    );
    expect(res.outcome).toBe("rejected");
    if (res.outcome === "rejected") {
      expect(res.reason).toBe("policy_forbidden");
    }
  });

  it("returns warning when severity=warn", () => {
    const res = evaluatePolicy(
      { forbidden: [{ role: "button", name_matches: "(?i)delete", severity: "warn", message: "danger" }] },
      { verb: "click", node: target.root.c![0], snapshot: target }
    );
    expect(res.outcome).toBe("warned");
    if (res.outcome === "warned") expect(res.warnings[0].message).toBe("danger");
  });

  it("respects `on:` verb scope", () => {
    const res = evaluatePolicy(
      { forbidden: [{ role: "button", name_matches: "(?i)delete", on: "type", severity: "hard" }] },
      { verb: "click", node: target.root.c![0], snapshot: target }
    );
    expect(res.outcome).toBe("allowed");
  });
});

describe("evaluatePolicy — allow/deny domains", () => {
  const target = snap("https://aetna.com/x", [
    { i: "RootWebArea:r", r: "RootWebArea", n: "Aetna" },
    { i: "button:b", r: "button", n: "OK", s: ["v", "e"] },
  ]);

  it("rejects when domain is not in allow_domains", () => {
    const res = evaluatePolicy(
      { allow_domains: ["*.geico.com"], deny_domains: ["*"] },
      { verb: "click", node: target.root.c![0], snapshot: target }
    );
    expect(res.outcome).toBe("rejected");
    if (res.outcome === "rejected") expect(res.reason).toBe("policy_domain_denied");
  });

  it("allows when domain is in allow_domains (hard wins, but allow override is by listing)", () => {
    const res = evaluatePolicy(
      { allow_domains: ["*.aetna.com", "aetna.com"], deny_domains: ["*"] },
      { verb: "click", node: target.root.c![0], snapshot: target }
    );
    expect(res.outcome).toBe("allowed");
  });
});

describe("evaluatePolicy — required_before", () => {
  it("rejects click when checkbox prereq isn't checked", () => {
    const target = snap("https://x.test/", [
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "checkbox:agree", r: "checkbox", n: "I agree", s: ["v", "e"] },
      { i: "button:submit", r: "button", n: "Submit", s: ["v", "e"] },
    ]);
    const res = evaluatePolicy(
      { required_before: [{ action: "click", prereq: [{ role: "checkbox", name_matches: "(?i)agree", state: "checked" }] }] },
      { verb: "click", node: target.root.c![1], snapshot: target }
    );
    expect(res.outcome).toBe("rejected");
    if (res.outcome === "rejected") expect(res.reason).toBe("policy_required_before");
  });

  it("allows click when checkbox is checked", () => {
    const target = snap("https://x.test/", [
      { i: "RootWebArea:r", r: "RootWebArea", n: "Page" },
      { i: "checkbox:agree", r: "checkbox", n: "I agree", s: ["v", "e", "c"] },
      { i: "button:submit", r: "button", n: "Submit", s: ["v", "e"] },
    ]);
    const res = evaluatePolicy(
      { required_before: [{ action: "click", prereq: [{ role: "checkbox", name_matches: "(?i)agree", state: "checked" }] }] },
      { verb: "click", node: target.root.c![1], snapshot: target }
    );
    expect(res.outcome).toBe("allowed");
  });
});
