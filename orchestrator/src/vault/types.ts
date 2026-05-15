/**
 * One cookie. Wire format matches CDP `Network.Cookie` (Chromium DevTools
 * Protocol). Husk stores cookies in this shape verbatim so they can be
 * pushed back to `Network.setCookies` without translation.
 */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix epoch seconds. -1 for session cookies. */
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  /** "Strict" | "Lax" | "None" (CDP capitalisation). */
  sameSite?: "Strict" | "Lax" | "None";
  /** Source URL used when restoring via setCookies. Optional in storage. */
  url?: string;
}

/** Profile identifier — a short readable string. Validated via profile-path.ts. */
export type Profile = string;
