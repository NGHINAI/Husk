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

/** M14: Forward-declared types for new Snapshot envelope fields (T2-T10). */
export interface SnapshotNetwork {
  /** Recent network requests captured via CDP (ring buffer, last 100 per session). */
  recent: import("../session/network-buffer.js").NetworkEntry[];
  // likely_api_endpoints added in T10
}
export type FormSchema = import("./forms.js").FormSchema;
export type FormField = import("./forms.js").FormField;
export type SnapshotMeta = import("./meta.js").SnapshotMeta;
export type HistoryEntry = import("../session/history-buffer.js").HistoryEntry;

export interface Snapshot {
  /** Snapshot format version (spec §5.2 reserves 0 for stub, 1 for v0). */
  v: 1;
  /** URL of the page snapshotted. */
  url: string;
  /** Total number of nodes after pruning. */
  count: number;
  /** Root of the snapshot tree. */
  root: SnapshotNode;
  /**
   * Internal-only side-channel: stable_id → backend DOM node id (CDP DOM.NodeId).
   * Populated by `transformAxTree`. The HTTP layer strips it before responses
   * are returned to agents. Used by Session.click/Session.type/etc. to resolve
   * a stable_id to a clickable bounding box. Optional because deserialized
   * snapshots (e.g. from disk in tests) lack it.
   */
  _resolver?: import("./resolver.js").SelectorResolver;

  // ----- M14 Snapshot envelope (T1-T10, all optional for back-compat) -----

  /** T1: State signature — dom_hash + network_fingerprint. */
  signature?: {
    dom_hash: string;
    network_fingerprint: string;
    url: string;
  };

  /** T4: Snapshot metadata (title, viewport, timing, etc.). */
  meta?: SnapshotMeta;

  /** T5: Form definitions discovered on the page. */
  forms?: FormSchema[];

  /** T2 + T10: Network activity log. */
  network?: SnapshotNetwork;

  /** T3: Console messages captured. */
  console?: import("../session/console-buffer.js").ConsoleMessage[];

  /** T7: One-line summary of page purpose. */
  summary?: string;

  /** T9: Navigation/action history for this session. */
  session_history?: HistoryEntry[];

  /** T8: Optional page image (base64 PNG, only when include_image=true). */
  image_b64?: string;
}

// ----- Diff types for mutation poller (Task 7) -----

export interface SnapshotDiff {
  added: SnapshotNode[];
  removed: string[]; // stable_ids no longer present
  changed: Array<{ id: string; before: SnapshotNode; after: SnapshotNode }>;
}
