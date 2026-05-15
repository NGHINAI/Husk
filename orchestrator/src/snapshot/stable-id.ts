import { blake3 } from "@noble/hashes/blake3";

/**
 * Normalize an accessible name for stable-ID hashing:
 *   1. Lowercase
 *   2. Trim leading/trailing whitespace
 *   3. Collapse internal whitespace runs to single spaces
 */
export function normalizeName(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Compute a Husk v0 stable ID:
 *
 *   stable_id = `${role}:${base64url(blake3(role + ' ' + name_norm + ' ' + xpath)[:16])}`
 *
 * The `role:` prefix is for human readability in logs / agent error
 * messages. The hash is 16 bytes (128 bits) of blake3 output, encoded
 * as URL-safe base64 without padding (22 characters).
 *
 * @param role   CDP-emitted ARIA role (e.g. "button", "textbox")
 * @param name   Raw accessible name (we normalize internally)
 * @param xpath  Synthetic a11y-tree path (for v0; real DOM xpath comes in v0.1)
 */
export function stableId(role: string, name: string, xpath: string): string {
  const nameNorm = normalizeName(name);
  const input = new TextEncoder().encode(`${role} ${nameNorm} ${xpath}`);
  const hashBytes = blake3(input, { dkLen: 16 });
  const hash = bytesToBase64Url(hashBytes);
  return `${role}:${hash}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
