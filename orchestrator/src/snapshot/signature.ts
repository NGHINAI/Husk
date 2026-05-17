import { createHash } from "node:crypto";

/**
 * Lightweight representation of a SnapshotNode for signature computation.
 * Only includes the stable ID field (i) and recursively processes children.
 */
export interface AxLite {
  i: string;
  r: string;
  n: string;
  c?: AxLite[];
}

/**
 * Input to computeSignature: the DOM tree and network activity.
 */
export interface SignatureInput {
  root: AxLite;
  url: string;
  networkUrls: string[];
}

/**
 * Output of computeSignature: dom hash + network fingerprint + url.
 */
export interface Signature {
  dom_hash: string;
  network_fingerprint: string;
  url: string;
}

/**
 * Walk the AX tree and collect all node IDs in document order.
 * Used to compute a stable hash of the DOM structure.
 */
function walkIds(n: AxLite, out: string[]): void {
  out.push(n.i);
  if (n.c) {
    for (const c of n.c) {
      walkIds(c, out);
    }
  }
}

/**
 * Compute a signature for a snapshot.
 *
 * The signature contains:
 *   - dom_hash: SHA256 of all node IDs in tree order (first 16 chars)
 *   - network_fingerprint: SHA256 of sorted network URLs (first 16 chars)
 *   - url: the page URL
 *
 * Both hashes are deterministic and order-independent where appropriate
 * (network URLs are sorted internally).
 */
export function computeSignature(input: SignatureInput): Signature {
  // Collect all node IDs in document order
  const ids: string[] = [];
  walkIds(input.root, ids);

  // Hash the ID sequence
  const dom_hash = createHash("sha256")
    .update(ids.join("|"))
    .digest("hex")
    .slice(0, 16);

  // Hash the sorted network URLs (order-independent)
  const network_fingerprint = createHash("sha256")
    .update([...input.networkUrls].sort().join("|"))
    .digest("hex")
    .slice(0, 16);

  return { dom_hash, network_fingerprint, url: input.url };
}
