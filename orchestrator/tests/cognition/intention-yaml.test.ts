import { describe, it, expect } from "vitest";
import { parseIntentionYaml, interpolate } from "../../src/cognition/intention-yaml.js";

describe("intention-yaml", () => {
  const yamlSrc = `
name: send_connect
description: Send a connection request
args_schema:
  type: object
  properties:
    person: { type: string }
  required: [person]
requires_state: profile_page
steps:
  - verb: click
    target: { button: Connect }
  - verb: click
    target: { button: Send without a note }
verify:
  - type: network
    method: POST
    url_pattern: /voyager/api/relationships/sentInvitationViewsV2
    status_min: 200
    status_max: 299
    description: invite POST returned 2xx
failure_modes:
  - reason: rate_limited
    match:
      type: network
      url_pattern: /voyager
      status_min: 429
      status_max: 429
      description: 429 from voyager
`;

  it("parses a complete intention YAML", () => {
    const i = parseIntentionYaml(yamlSrc, "linkedin.com");
    expect(i.name).toBe("send_connect");
    expect(i.steps).toHaveLength(2);
    expect(i.verify).toHaveLength(1);
    expect(i.failure_modes).toHaveLength(1);
    expect(i.requires_state).toBe("profile_page");
  });

  it("rejects YAML without a name", () => {
    expect(() => parseIntentionYaml("steps: []", "site")).toThrow(/name/);
  });

  it("rejects YAML without steps", () => {
    expect(() => parseIntentionYaml("name: x", "site")).toThrow(/steps/);
  });

  it("rejects steps with invalid verbs", () => {
    expect(() => parseIntentionYaml("name: x\nsteps:\n  - verb: yodel", "site")).toThrow(/invalid verb/);
  });

  it("rejects verify with invalid type", () => {
    const src = `name: x\nsteps: []\nverify:\n  - type: spurious`;
    expect(() => parseIntentionYaml(src, "site")).toThrow(/invalid type/);
  });

  it("interpolate replaces {{args.X}}", () => {
    expect(interpolate("hello {{args.name}}", { name: "world" })).toBe("hello world");
  });

  it("interpolate throws on missing arg", () => {
    expect(() => interpolate("hi {{args.missing}}", {})).toThrow(/missing arg/);
  });

  it("interpolate handles non-string args", () => {
    expect(interpolate("count={{args.n}}", { n: 42 })).toBe("count=42");
  });
});
