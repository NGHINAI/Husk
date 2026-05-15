import type { Cookie } from "./types.js";

interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/**
 * Snapshot every cookie visible to the session via CDP `Network.getAllCookies`.
 * Includes cookies for every origin the session has visited.
 */
export async function captureCookies(cdp: CdpLike, sessionId: string): Promise<Cookie[]> {
  const res = (await cdp.send("Network.getAllCookies", {}, sessionId)) as { cookies?: Cookie[] };
  return res.cookies ?? [];
}
