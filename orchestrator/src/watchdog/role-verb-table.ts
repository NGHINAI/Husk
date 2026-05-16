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

// File inputs in the AX tree may appear as "textbox", "spinbutton", "unknown",
// or in some engines simply as a generic element. We accept any role for upload
// since lightpanda's AX representation of <input type="file"> is not guaranteed
// to produce a predictable role — the CDP DOM.setFileInputFiles path is the
// authoritative gate, and the element-existence check in the watchdog pre-sanity
// is sufficient to confirm the stable_id is valid.
const UPLOAD_ROLES_OPEN = true;

export function isRoleVerbCompatible(role: string, verb: Verb): boolean {
  switch (verb) {
    case "click":
      return CLICK_ROLES.has(role);
    case "type":
      return TYPE_ROLES.has(role);
    case "scroll":
    case "press_key":
      return true;
    case "upload":
      // Accept any role — lightpanda may expose <input type="file"> with varied
      // roles. The CDP DOM.setFileInputFiles call is the functional gate.
      void UPLOAD_ROLES_OPEN;
      return true;
  }
}
