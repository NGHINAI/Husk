import type { Verb } from "./types.js";

export type { Verb } from "./types.js";

/**
 * Spec §5.3 sanity check `interactive`: each verb maps to the ARIA roles it can
 * legitimately operate on. `scroll` and `press_key` are window/focus-level and
 * accept any role (the watchdog still requires the element to exist for
 * `scroll(stable_id)` form; `press_key` skips the existence check entirely).
 */
const CLICK_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "checkbox",
  "radio",
  "tab",
  "option",
  "switch",
  "treeitem",
]);

const TYPE_ROLES = new Set(["textbox", "combobox", "searchbox"]);

export function isRoleVerbCompatible(role: string, verb: Verb): boolean {
  switch (verb) {
    case "click":
      return CLICK_ROLES.has(role);
    case "type":
      return TYPE_ROLES.has(role);
    case "scroll":
    case "press_key":
      return true;
  }
}
