import type { Cookie } from "./types.js";

interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/**
 * Push cookies into the session via CDP `Network.setCookies`. Strips any
 * `undefined` optional fields because lightpanda's CDP layer rejects unknown
 * keys (per M2 spike) when their values are `undefined`.
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
      expires: c.expires,
      size: c.size,
      httpOnly: c.httpOnly,
      secure: c.secure,
      session: c.session,
    };
    if (c.sameSite !== undefined) out.sameSite = c.sameSite;
    if (c.url !== undefined) out.url = c.url;
    return out;
  });
  await cdp.send("Network.setCookies", { cookies: sanitised }, sessionId);
}
