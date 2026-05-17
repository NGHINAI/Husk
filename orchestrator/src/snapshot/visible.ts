/**
 * Visible-only snapshot filter (M14 T6).
 *
 * Walks a SnapshotNode tree and removes any nodes whose bounding box does not
 * intersect the current viewport. Visibility is determined via
 * `DOM.getBoxModel` for nodes that carry a `backendNodeId`.
 *
 * Rules:
 *   1. If a node has no `backendNodeId` we cannot prove it is off-screen, so
 *      we keep it (conservative / safe-by-default).
 *   2. If `DOM.getBoxModel` throws or returns no content quad, the node is
 *      treated as off-screen (degenerate / invisible elements).
 *   3. A node is kept if it is in-view **or** if any of its descendants
 *      survived (ancestor-retention rule — prevents orphaning visible children).
 */

export interface AxNode {
  i: string;
  r: string;
  n: string;
  backendNodeId?: number;
  c?: AxNode[];
  [k: string]: unknown;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface CdpLike {
  send(method: string, params: unknown): Promise<unknown>;
}

/**
 * Determine whether a CDP content quad (8-element flat array of x/y pairs)
 * intersects an axis-aligned viewport rectangle.
 *
 * CDP returns the quad in the order: top-left, top-right, bottom-right,
 * bottom-left — i.e. [x0,y0, x1,y1, x2,y2, x3,y3].  We derive an
 * axis-aligned bounding box and use standard AABB intersection.
 */
function bboxIntersectsViewport(content: number[], v: Viewport): boolean {
  const xs = [content[0], content[2], content[4], content[6]];
  const ys = [content[1], content[3], content[5], content[7]];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  // Standard AABB intersect: both intervals must overlap.
  return maxX > 0 && minX < v.width && maxY > 0 && minY < v.height;
}

/**
 * Filter an AX-style snapshot tree to only nodes visible in `viewport`.
 *
 * @param cdp      CDP-like client (only `send` is used — no session id needed).
 * @param root     Root snapshot node (mutated via spread — original not altered).
 * @param viewport Viewport dimensions (typically from `Page.getLayoutMetrics`).
 * @returns        A new root node with off-screen subtrees pruned.
 */
export async function filterVisible(
  cdp: CdpLike,
  root: AxNode,
  viewport: Viewport,
): Promise<AxNode> {
  const walk = async (n: AxNode): Promise<AxNode | null> => {
    // 1. Recurse into children first (depth-first post-order).
    const children = n.c
      ? (await Promise.all(n.c.map(walk))).filter((x): x is AxNode => x !== null)
      : undefined;

    // 2. Determine this node's own visibility.
    //    Nodes without a backendNodeId cannot be queried — keep them (rule 1).
    let inView = true;
    if (typeof n.backendNodeId === "number") {
      inView = false;
      try {
        const r = (await cdp.send("DOM.getBoxModel", { backendNodeId: n.backendNodeId })) as
          | { model?: { content?: number[] } }
          | null;
        const content = r?.model?.content;
        if (content && content.length === 8) {
          inView = bboxIntersectsViewport(content, viewport);
        }
        // If content is missing / wrong length → stays false (rule 2).
      } catch {
        // DOM.getBoxModel threw (e.g. engine doesn't support it, or node was
        // detached) → treat as off-screen (rule 2).
        inView = false;
      }
    }

    // 3. Emit this node if it is in-view OR at least one descendant survived.
    if (inView) {
      return children !== undefined ? { ...n, c: children } : { ...n };
    }
    if (children && children.length > 0) {
      // Ancestor-retention: keep the wrapper so visible children are not
      // orphaned, but replace its children with the filtered set.
      return { ...n, c: children };
    }
    return null;
  };

  const result = await walk(root);
  // The root itself should always survive (it has no backendNodeId in practice
  // — it is RootWebArea).  If everything is pruned, return an empty root.
  return result ?? { ...root, c: [] };
}
