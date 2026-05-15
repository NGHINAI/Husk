import type { Snapshot, SnapshotNode } from "../snapshot/types.js";
import type { RejectionReason, Verb } from "./types.js";
import { isRoleVerbCompatible } from "./role-verb-table.js";

export type SanityResult =
  | { ok: true; node: SnapshotNode | null }
  | { ok: false; reason: RejectionReason; node: SnapshotNode | null };

/**
 * Pre-action sanity rules (spec §5.3 Layer 1). Pure function — no I/O.
 *
 * Verb-specific shortcuts:
 *   - `press_key` is focus-level; no stable_id needed and no element lookup runs.
 *   - `scroll` allows `stable_id == null` (window scroll); when supplied it must exist
 *     but its role need not be "interactive".
 */
export function runPreActionSanity(
  snapshot: Snapshot,
  verb: Verb,
  stableId: string | null
): SanityResult {
  if (verb === "press_key") return { ok: true, node: null };
  if (verb === "scroll" && stableId == null) return { ok: true, node: null };

  if (stableId == null) {
    return { ok: false, reason: "element_not_found", node: null };
  }

  const node = findById(snapshot.root, stableId);
  if (!node) {
    return { ok: false, reason: "element_not_found", node: null };
  }
  if (!node.s.includes("v")) {
    return { ok: false, reason: "element_not_visible", node };
  }
  // `type` on textbox/combobox/searchbox doesn't require `e` — read-only is
  // expressed via `aria-readonly` which the adapter surfaces as `d`.
  const isTypeOnText = verb === "type";
  if (node.s.includes("d")) {
    return { ok: false, reason: "element_disabled", node };
  }
  if (!isTypeOnText && !node.s.includes("e")) {
    return { ok: false, reason: "element_disabled", node };
  }
  if (!isRoleVerbCompatible(node.r, verb)) {
    return { ok: false, reason: "wrong_role_for_action", node };
  }
  return { ok: true, node };
}

/** Tree-walk helper. Used by sanity + diff logic. O(n) per call. */
export function findById(node: SnapshotNode, id: string): SnapshotNode | null {
  if (node.i === id) return node;
  for (const c of node.c ?? []) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return null;
}
