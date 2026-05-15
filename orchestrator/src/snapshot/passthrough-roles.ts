/**
 * Roles whose nodes are *skipped through* during snapshot tree pruning.
 *
 * The pruner walks the AXNode tree; when it hits a passthrough role, it
 * descends into the node's children but does NOT emit a SnapshotNode for
 * the passthrough node itself. The children become direct children of
 * the passthrough's parent in the output tree.
 *
 * Sourced from the T7 spike PoC findings (M2 spike, 2026-05-14):
 *   - `none` and `generic`: AX equivalents of layout-only divs/spans
 *   - `StaticText` and `InlineTextBox`: text leaves that bubble up to
 *     their parent's name
 *
 * Adding more roles here is a v0.1 tuning concern.
 */
export const PASSTHROUGH_ROLES: ReadonlySet<string> = new Set([
  "none",
  "generic",
  "StaticText",
  "InlineTextBox",
]);

export function isPassthroughRole(role: string | undefined): boolean {
  return role !== undefined && PASSTHROUGH_ROLES.has(role);
}

/**
 * Roles whose nodes (AND their entire subtrees) are DROPPED in `mode: 'terse'`.
 * These are page chrome — nav bars, banners, footers, sidebars — that have no
 * actionable content for typical agent tasks.
 *
 * Different from PASSTHROUGH_ROLES: passthrough keeps the descendants in the
 * output (parented to the passthrough's parent). Skip drops the whole subtree.
 */
export const SKIP_ROLES_TERSE: ReadonlySet<string> = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
]);

export function isSkipRoleTerse(role: string | undefined): boolean {
  return role !== undefined && SKIP_ROLES_TERSE.has(role);
}
