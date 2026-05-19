import type { AXNode, AXNodeProperty, Snapshot, SnapshotNode, SnapshotStateFlag } from "./types.js";
import { isPassthroughRole, isSkipRoleTerse } from "./passthrough-roles.js";
import { stableId } from "./stable-id.js";
import { SelectorResolver } from "./resolver.js";

/**
 * Transform an `Accessibility.getFullAXTree` response into a spec-§5.2
 * compressed JSON-LD `Snapshot`.
 *
 * Pruning: nodes with passthrough roles (see `passthrough-roles.ts`) are
 * skipped — their children are reparented to the closest non-passthrough
 * ancestor in the output tree.
 *
 * Stable ID: each surviving node gets a `stable_id` computed from
 * (role, accessible_name, xpath), where `xpath` is a synthetic
 * a11y-tree path of the form `/parent/[idx]` joined.
 *
 * State flags follow the T7 spike findings:
 *   - `e` (enabled) — when `focusable` property exists and is `true`
 *   - `d` (disabled) — when `focusable` is absent on an interactive role
 *   - `c` (checked) — when `checked` property is `true`
 *   - `f` (focused) — when `focused` property is `true`
 *   - `v` (visible) — always set for now; visibility comes from CDP DOM in v0.1
 */
export interface TransformAxOptions {
  /**
   * "full"    — emit the complete AX tree (default).
   * "terse"   — drop nav/banner/footer subtrees.
   * "visible" — not handled here; Session.snapshot post-processes a "full"
   *             tree through filterVisible() after transformAxTree returns.
   */
  mode?: "full" | "terse" | "visible";
}

export function transformAxTree(
  nodes: AXNode[],
  rootId: string,
  url: string,
  opts: TransformAxOptions = {}
): Snapshot {
  const byId = new Map<string, AXNode>();
  for (const n of nodes) byId.set(n.nodeId, n);
  const root = byId.get(rootId);
  if (!root) throw new Error(`transformAxTree: root id "${rootId}" not present in nodes`);

  let count = 0;
  const resolver = new SelectorResolver();
  const visit = (node: AXNode, parentXpath: string, indexInParent: number): SnapshotNode | SnapshotNode[] => {
    const role = node.role?.value ?? "generic";

    // Terse mode: drop nav/banner/footer/sidebar entirely (including subtree).
    if (opts.mode === "terse" && isSkipRoleTerse(role)) {
      return [];
    }

    // Walk through (don't emit) both: passthrough-role nodes AND `ignored: true`
    // nodes. Both mean "this node has no semantic value of its own — surface its
    // descendants." CDP marks layout wrappers (e.g., implicit body/div containers)
    // with `ignored: true`; we still want their descendants.
    if (node.ignored || isPassthroughRole(role)) {
      const childNodes = (node.childIds ?? [])
        .map((cid, i) => {
          const child = byId.get(cid);
          if (!child) return null;
          return visit(child, parentXpath, indexInParent + i);
        })
        .filter((x): x is SnapshotNode | SnapshotNode[] => x != null)
        .flat();
      return childNodes;
    }

    const xpath = `${parentXpath}/[${indexInParent}]`;
    const name = node.name?.value ?? "";
    const id = stableId(role, name, xpath);

    const flags = computeStateFlags(role, node.properties);

    const out: SnapshotNode = { i: id, r: role, n: name, s: flags };

    // Populate resolver: map stable_id → backendDOMNodeId for emitted nodes only.
    if (node.backendDOMNodeId != null) {
      resolver.set(id, node.backendDOMNodeId);
    }

    const children: SnapshotNode[] = [];
    let childIdx = 0;
    for (const cid of node.childIds ?? []) {
      const child = byId.get(cid);
      if (!child) continue;
      const transformed = visit(child, xpath, childIdx);
      if (Array.isArray(transformed)) {
        children.push(...transformed);
        childIdx += transformed.length;
      } else {
        children.push(transformed);
        childIdx += 1;
      }
    }
    if (children.length) out.c = children;

    count += 1;
    return out;
  };

  const result = visit(root, "", 0);
  // The root cannot be a passthrough role (it should always be RootWebArea
  // or similar); if it somehow is, surface that explicitly.
  if (Array.isArray(result)) {
    throw new Error("transformAxTree: root resolved to passthrough nodes only");
  }
  return { v: 1, url, count, root: result, _resolver: resolver, sibling_sessions: [] };
}

function computeStateFlags(
  role: string,
  properties: AXNodeProperty[] | undefined,
): SnapshotStateFlag[] {
  const flags: SnapshotStateFlag[] = [];
  flags.push("v"); // visibility default-true; v0.1 wires real CDP visibility

  // When properties is `undefined` (not provided by CDP), we have no explicit
  // focusability signal — treat the node as enabled by default.
  // When properties is an empty array `[]` (CDP provided the list, just empty),
  // the absence of a `focusable: true` entry is itself a signal that the
  // interactive node is not focusable, hence disabled.
  if (properties === undefined) {
    flags.push("e");
    return flags;
  }

  const focusableProp = properties.find((p) => p.name === "focusable");
  const focusable = focusableProp?.value?.value;
  const checked = properties.find((p) => p.name === "checked")?.value?.value;
  const focused = properties.find((p) => p.name === "focused")?.value?.value;

  if (isInteractiveRole(role)) {
    // `focusable: true` → enabled; absent from the list → disabled.
    if (focusable === true) flags.push("e");
    else flags.push("d");
  } else {
    flags.push("e");
  }
  if (checked === true) flags.push("c");
  if (focused === true) flags.push("f");
  return flags;
}

function isInteractiveRole(role: string): boolean {
  return (
    role === "button" ||
    role === "link" ||
    role === "textbox" ||
    role === "combobox" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "menuitem" ||
    role === "tab" ||
    role === "option" ||
    role === "switch" ||
    role === "slider"
  );
}
