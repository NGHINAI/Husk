import { describe, it, expect, vi } from "vitest";
import { extractForms } from "../../src/snapshot/forms.js";

describe("extractForms", () => {
  it("returns form schemas with fields, labels, submit_text", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ result: { value: [{
      stable_id: null,
      action: "/login",
      method: "POST",
      fields: [
        { name: "email", type: "email", label: "Email address", required: true, placeholder: null },
        { name: "password", type: "password", label: "Password", required: true, placeholder: null },
      ],
      submit_text: "Sign in",
    }] } }) };
    const forms = await extractForms(cdp as any, "sess1");
    expect(forms).toHaveLength(1);
    expect(forms[0].action).toBe("/login");
    expect(forms[0].method).toBe("POST");
    expect(forms[0].fields).toHaveLength(2);
    expect(forms[0].fields[0]).toMatchObject({ name: "email", type: "email", label: "Email address", required: true });
    expect(forms[0].submit_text).toBe("Sign in");
  });

  it("returns empty array when no forms on page", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ result: { value: [] } }) };
    expect(await extractForms(cdp as any, "sess1")).toEqual([]);
  });

  it("returns empty array on CDP error", async () => {
    const cdp = { send: vi.fn().mockRejectedValue(new Error("eval failed")) };
    expect(await extractForms(cdp as any, "sess1")).toEqual([]);
  });

  it("safely handles forms with no submit button (submit_text null)", async () => {
    const cdp = { send: vi.fn().mockResolvedValue({ result: { value: [{
      stable_id: null, action: null, method: "GET",
      fields: [{ name: "q", type: "search", label: null, required: false, placeholder: "Search" }],
      submit_text: null,
    }] } }) };
    const forms = await extractForms(cdp as any, "sess1");
    expect(forms[0].submit_text).toBeNull();
    expect(forms[0].fields[0].placeholder).toBe("Search");
  });
});
