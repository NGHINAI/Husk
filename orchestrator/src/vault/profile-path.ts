import { join } from "node:path";

/**
 * Profile names map 1:1 to `{vaultDir}/{profile}.db` files. We restrict to a
 * conservative charset to keep filesystem semantics predictable across
 * macOS / Linux / Windows and to block path traversal.
 */
const PROFILE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export function isValidProfileName(name: string): boolean {
  if (!name) return false;
  if (name === "." || name === "..") return false;
  return PROFILE_NAME_RE.test(name);
}

export function resolveProfilePath(vaultDir: string, profile: string): string {
  if (!isValidProfileName(profile)) {
    throw new Error(`Invalid profile name: ${JSON.stringify(profile)}`);
  }
  return join(vaultDir, `${profile}.db`);
}
