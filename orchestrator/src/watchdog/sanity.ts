import type { Snapshot, SnapshotNode } from "../snapshot/types.js";
import type { RejectionReason, Verb, Warning } from "./types.js";
import { isRoleVerbCompatible } from "./role-verb-table.js";
import { diffSnapshots } from "../snapshot/poller.js";

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

export interface PostActionInput {
  verb: Verb;
  before: Snapshot;
  after: Snapshot;
  urlBefore: string;
  urlAfter: string;
}

const NEGATIVE_ALERT_RE = /\b(error|failed|fail|invalid|denied|forbidden|not allowed|reject)/i;

/**
 * Post-action assertions (spec §5.3 Layer 1). All warnings; never block the
 * caller. Spec semantics:
 *   - no_mutation_observed: returned when before and after snapshots are
 *     structurally identical. Warn-only because some click handlers genuinely
 *     no-op (toggle that was already in state).
 *   - error_alert_appeared: scans the `after` snapshot for new role=alert or
 *     role=status nodes whose name matches NEGATIVE_ALERT_RE.
 *   - unexpected_navigation: URL changed for non-nav verbs. Suppressed for
 *     `press_key` (Enter/Tab legitimately navigate) and pure `scroll`.
 */
export function runPostActionAssertions(input: PostActionInput): Warning[] {
  const warnings: Warning[] = [];

  const diff = diffSnapshots(input.before, input.after);
  const noChange =
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
  if (noChange && input.urlBefore === input.urlAfter) {
    warnings.push({
      reason: "no_mutation_observed",
      message: "No DOM mutation detected within the action window.",
    });
  }

  const newAlert = findAlertWithNegativeContent(input.after.root, input.before);
  if (newAlert) {
    warnings.push({
      reason: "error_alert_appeared",
      message: `New alert appeared: ${JSON.stringify(newAlert.n)}`,
    });
  }

  if (input.verb !== "press_key" && input.verb !== "scroll" && input.urlBefore !== input.urlAfter) {
    warnings.push({
      reason: "unexpected_navigation",
      message: `URL changed from ${input.urlBefore} to ${input.urlAfter} during a ${input.verb} action.`,
    });
  }

  return warnings;
}

function findAlertWithNegativeContent(node: SnapshotNode, before: Snapshot): SnapshotNode | null {
  if ((node.r === "alert" || node.r === "status") && NEGATIVE_ALERT_RE.test(node.n)) {
    if (!findById(before.root, node.i)) return node;
  }
  for (const c of node.c ?? []) {
    const hit = findAlertWithNegativeContent(c, before);
    if (hit) return hit;
  }
  return null;
}
