/**
 * Snapshot type definitions for Husk's spec-§5.2 representation.
 *
 * We have three layers:
 *   - `AXNode` — what lightpanda's `Accessibility.getFullAXTree` emits (raw CDP shape)
 *   - `SnapshotNode` — what we emit to agents (compressed JSON-LD with short keys)
 *   - `Snapshot` — the top-level envelope (root node + metadata)
 */

// ----- Raw CDP a11y tree shape -----

/** A CDP-style typed value, e.g. `{ type: "string", value: "Submit" }`. */
export interface CdpTypedValue {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

export interface AXNodeProperty {
  name: string;
  value: CdpTypedValue;
}

/** A single accessibility-tree node as emitted by CDP. */
export interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: CdpTypedValue;
  name?: CdpTypedValue;
  description?: CdpTypedValue;
  value?: CdpTypedValue;
  properties?: AXNodeProperty[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

// ----- Husk's compressed snapshot shape (spec §5.2) -----

/** State flags compressed to single letters: `e`=enabled, `v`=visible, `c`=checked, `f`=focused, `d`=disabled. */
export type SnapshotStateFlag = "e" | "v" | "c" | "f" | "d";

/** A single node in our compressed JSON-LD snapshot tree. */
export interface SnapshotNode {
  /** Stable ID — blake3(role || name_norm || xpath)[:16] (URL-safe base64, 22 chars no padding). */
  i: string;
  /** ARIA role. */
  r: string;
  /** Accessible name (raw, not normalized). */
  n: string;
  /** State flags. */
  s: SnapshotStateFlag[];
  /** Optional raw text content (only for `r === "text"` nodes). */
  t?: string;
  /** Children. */
  c?: SnapshotNode[];
}

export interface Snapshot {
  /** Snapshot format version (spec §5.2 reserves 0 for stub, 1 for v0). */
  v: 1;
  /** URL of the page snapshotted. */
  url: string;
  /** Total number of nodes after pruning. */
  count: number;
  /** Root of the snapshot tree. */
  root: SnapshotNode;
}

// ----- Diff types for mutation poller (Task 7) -----

export interface SnapshotDiff {
  added: SnapshotNode[];
  removed: string[]; // stable_ids no longer present
  changed: Array<{ id: string; before: SnapshotNode; after: SnapshotNode }>;
}
