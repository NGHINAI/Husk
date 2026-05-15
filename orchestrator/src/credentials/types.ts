/**
 * One stored credential. Keyed by `key` (typically a hostname like
 * "github.com"); a single profile may hold many credentials for different
 * sites.
 */
export interface Credential {
  /** Site key — hostname or arbitrary stable id. */
  key: string;
  username: string;
  password: string;
  /** Base32-encoded TOTP secret (RFC 6238). When set, login() can supply
   *  a 6-digit code into a 2FA prompt. */
  totp_secret?: string;
}

export type CredentialKey = string;

const KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export function isValidCredentialKey(key: string): boolean {
  if (!key) return false;
  if (key === "." || key === "..") return false;
  return KEY_RE.test(key);
}
