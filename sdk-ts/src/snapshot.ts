import type { Snapshot, SnapshotNode } from "./types.js";

export interface FindCriteria {
  role?: string;
  /** Regex tested against node.n (the accessible name). */
  nameMatches?: RegExp;
  /** Substring tested against node.n (case-insensitive). */
  name?: string;
}

function matches(node: SnapshotNode, criteria: FindCriteria): boolean {
  if (criteria.role && node.r !== criteria.role) return false;
  if (criteria.nameMatches && !criteria.nameMatches.test(node.n)) return false;
  if (criteria.name && !node.n.toLowerCase().includes(criteria.name.toLowerCase())) return false;
  return true;
}

/** Depth-first search; returns the first match or null. */
export function findInSnapshot(snapshot: Snapshot, criteria: FindCriteria): SnapshotNode | null {
  return walkFind(snapshot.root, criteria);
}

function walkFind(node: SnapshotNode, c: FindCriteria): SnapshotNode | null {
  if (matches(node, c)) return node;
  for (const child of node.c ?? []) {
    const hit = walkFind(child, c);
    if (hit) return hit;
  }
  return null;
}

/** Depth-first search; returns all matches in document order. */
export function findAllInSnapshot(snapshot: Snapshot, criteria: FindCriteria): SnapshotNode[] {
  const out: SnapshotNode[] = [];
  walkAll(snapshot.root, criteria, out);
  return out;
}

function walkAll(node: SnapshotNode, c: FindCriteria, out: SnapshotNode[]): void {
  if (matches(node, c)) out.push(node);
  for (const child of node.c ?? []) walkAll(child, c, out);
}
