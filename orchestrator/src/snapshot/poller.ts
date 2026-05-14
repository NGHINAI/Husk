import type { Snapshot, SnapshotDiff, SnapshotNode } from "./types.js";

/**
 * Compute a flat diff between two snapshots.
 *
 * The shape:
 *   - added: nodes present in `after` but not `before` (by stable_id)
 *   - removed: stable_ids present in `before` but not `after`
 *   - changed: stable_ids in both, where the node payload differs (e.g.
 *     state flags flipped, name changed without changing stable_id)
 *
 * Note: when an element's accessible name or role changes such that its
 * stable_id also changes, it appears as both a `removed` (old id) and
 * `added` (new id). The diff has no way to know they're the "same"
 * element. Agents that need cross-id linking can use position-based
 * heuristics on top of this output.
 *
 * Cost: O(N) on the size of the new snapshot, plus O(N) on the size of
 * the old. Trees are walked once each, indexed into Maps.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const beforeMap = flatten(before.root);
  const afterMap = flatten(after.root);

  const added: SnapshotNode[] = [];
  const removed: string[] = [];
  const changed: SnapshotDiff["changed"] = [];

  for (const [id, n] of afterMap) {
    const prior = beforeMap.get(id);
    if (!prior) {
      added.push(n);
    } else if (!nodesEqual(prior, n)) {
      changed.push({ id, before: prior, after: n });
    }
  }
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) removed.push(id);
  }

  return { added, removed, changed };
}

function flatten(root: SnapshotNode): Map<string, SnapshotNode> {
  const out = new Map<string, SnapshotNode>();
  const walk = (n: SnapshotNode): void => {
    out.set(n.i, n);
    for (const c of n.c ?? []) walk(c);
  };
  walk(root);
  return out;
}

function nodesEqual(a: SnapshotNode, b: SnapshotNode): boolean {
  // Compare scalar fields. We do NOT compare children: a parent's payload
  // doesn't change just because a grandchild was added — that's captured
  // separately as the grandchild's add/remove.
  if (a.r !== b.r) return false;
  if (a.n !== b.n) return false;
  if (a.t !== b.t) return false;
  if (!sameFlags(a.s, b.s)) return false;
  return true;
}

function sameFlags(a: SnapshotNode["s"], b: SnapshotNode["s"]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const f of b) if (!setA.has(f)) return false;
  return true;
}
