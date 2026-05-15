import type { Cookie } from "./types.js";

interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/**
 * Push cookies into the session via CDP `Network.setCookies`. Translates
 * the stored shape (a `Network.Cookie` output shape from getAllCookies) into
 * the `Network.CookieParam` input shape setCookies expects:
 *   - `size` and `session` are output-only — must NOT be sent (CDP ignores
 *     or rejects unknown keys per M2 spike).
 *   - Session cookies (originally captured with `expires=-1`) must OMIT the
 *     `expires` field entirely; passing `-1` makes lightpanda treat it as
 *     "expired in 1969" and silently drop the cookie. CDP convention: no
 *     `expires` means "session cookie".
 *   - `undefined` optional fields are stripped.
 */
export async function restoreCookies(
  cdp: CdpLike,
  sessionId: string,
  cookies: Cookie[]
): Promise<void> {
  if (cookies.length === 0) return;
  const sanitised = cookies.map((c) => {
    const out: Record<string, unknown> = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
    };
    // Session cookies: omit expires entirely (CDP convention).
    // Persistent cookies: pass the future unix timestamp.
    if (!c.session && c.expires > 0) {
      out.expires = c.expires;
    }
    if (c.sameSite !== undefined) out.sameSite = c.sameSite;
    if (c.url !== undefined) out.url = c.url;
    return out;
  });
  await cdp.send("Network.setCookies", { cookies: sanitised }, sessionId);
}
