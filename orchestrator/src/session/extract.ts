export interface ExtractQuery {
  /** CSS selector. Required in v1. Future: role+name semantic query. */
  css: string;
}

export interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/**
 * Run `Runtime.evaluate` with a tiny snippet that finds `query.css` and
 * returns `textContent` (trimmed). Returns null if no element matches.
 * The selector is embedded via `JSON.stringify` so quotes can't break out.
 */
export async function runExtract(
  cdp: CdpLike,
  sessionId: string,
  query: ExtractQuery
): Promise<string | null> {
  const expression = `(() => {
    const el = document.querySelector(${JSON.stringify(query.css)});
    if (!el) return null;
    return (el.textContent || '').trim();
  })()`;
  const res = (await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true },
    sessionId
  )) as { result?: { value?: string | null } };
  const raw = res.result?.value;
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
