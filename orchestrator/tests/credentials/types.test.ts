import { describe, expect, it } from "vitest";
import type { Credential, CredentialKey } from "../../src/credentials/types.js";
import { isValidCredentialKey } from "../../src/credentials/types.js";

describe("isValidCredentialKey", () => {
  it("accepts host-style identifiers", () => {
    expect(isValidCredentialKey("github.com")).toBe(true);
    expect(isValidCredentialKey("login.aetna.com")).toBe(true);
    expect(isValidCredentialKey("app.work.io")).toBe(true);
  });

  it("rejects path separators and traversal", () => {
    expect(isValidCredentialKey("../etc")).toBe(false);
    expect(isValidCredentialKey("foo/bar")).toBe(false);
    expect(isValidCredentialKey("")).toBe(false);
  });

  it("Credential type has the required fields", () => {
    const c: Credential = {
      key: "github.com",
      username: "demo",
      password: "secret",
    };
    expect(c.totp_secret).toBeUndefined();
  });
});
