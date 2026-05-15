import { describe, expect, it } from "vitest";
import { isRoleVerbCompatible, type Verb } from "../../src/watchdog/role-verb-table.js";

describe("role-verb compatibility", () => {
  it("allows click on interactive widget roles", () => {
    const roles = ["button", "link", "menuitem", "checkbox", "radio", "tab", "option", "switch"];
    for (const r of roles) {
      expect(isRoleVerbCompatible(r, "click"), `click ${r}`).toBe(true);
    }
  });

  it("allows type on editable text roles", () => {
    for (const r of ["textbox", "combobox", "searchbox"]) {
      expect(isRoleVerbCompatible(r, "type"), `type ${r}`).toBe(true);
    }
  });

  it("rejects click on non-interactive roles", () => {
    for (const r of ["heading", "paragraph", "img", "main"]) {
      expect(isRoleVerbCompatible(r, "click"), `click ${r}`).toBe(false);
    }
  });

  it("allows scroll and press_key on any role (window-level)", () => {
    const verbs: Verb[] = ["scroll", "press_key"];
    for (const v of verbs) {
      expect(isRoleVerbCompatible("paragraph", v)).toBe(true);
      expect(isRoleVerbCompatible("button", v)).toBe(true);
    }
  });
});
