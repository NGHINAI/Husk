import { describe, expect, it } from "vitest";
import { parsePolicy, PolicyParseError } from "../../src/watchdog/policy.js";

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
