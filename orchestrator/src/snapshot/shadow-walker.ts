interface AxLite {
  i: string;
  r: string;
  n: string;
  backendNodeId?: number;
  c?: AxLite[];
  [k: string]: unknown;
}

interface CdpLike {
  send(method: string, params: unknown): Promise<any>;
}

interface CdpAxNode {
  nodeId?: string;
  role?: { value?: string };
  name?: { value?: string };
}

/**
 * Discover shadow roots attached to this node and merge their AX nodes into the
 * node's children. Engine-dependent — silently no-op on engines that don't
 * support DOM.describeNode or Accessibility.getPartialAXTree.
 */
export async function walkWithShadow(cdp: CdpLike, node: AxLite): Promise<AxLite> {
  if (typeof node.backendNodeId !== "number") return node;

  let shadowChildren: AxLite[] = [];
  try {
    const desc = await cdp.send("DOM.describeNode", { backendNodeId: node.backendNodeId });
    const roots: Array<{ backendNodeId?: number }> = desc?.node?.shadowRoots ?? [];
    if (roots.length === 0) return node;

    for (const root of roots) {
      if (typeof root.backendNodeId !== "number") continue;
      try {
        const ax = await cdp.send("Accessibility.getPartialAXTree", { backendNodeId: root.backendNodeId });
        const nodes: CdpAxNode[] = ax?.nodes ?? [];
        for (const n of nodes) {
          shadowChildren.push({
            i: `shadow-${n.nodeId ?? Math.random().toString(36).slice(2, 10)}`,
            r: n.role?.value ?? "generic",
            n: n.name?.value ?? "",
          });
        }
      } catch {
        // Per-root error; continue with others
      }
    }
  } catch {
    // Engine doesn't support DOM.describeNode — graceful no-op
    return node;
  }

  if (shadowChildren.length === 0) return node;
  return { ...node, c: [...(node.c ?? []), ...shadowChildren] };
}

const SHADOW_HOST_ROLES = new Set(["generic", "Unknown", "none"]);

/**
 * Post-pass: recursively walk the AX tree and probe likely shadow hosts
 * (generic/Unknown/none roles with no children) for shadow roots.
 * Only calls walkWithShadow on candidate nodes to keep CDP traffic bounded.
 */
export async function enrichWithShadow(cdp: CdpLike, root: AxLite): Promise<AxLite> {
  const walk = async (n: AxLite): Promise<AxLite> => {
    const children = n.c ? await Promise.all(n.c.map(walk)) : undefined;
    let enriched: AxLite = children !== undefined ? { ...n, c: children } : n;
    // Only probe likely shadow hosts to keep CDP traffic bounded
    if (typeof n.backendNodeId === "number" && SHADOW_HOST_ROLES.has(n.r) && (!n.c || n.c.length === 0)) {
      enriched = await walkWithShadow(cdp, enriched);
    }
    return enriched;
  };
  return walk(root);
}
