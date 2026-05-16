export interface ExtractSingle {
  /** CSS selector. Single-selector mode. */
  css: string;
  selectors?: never;
}

export interface ExtractMulti {
  /** Map of key to CSS selector. Multi-selector mode returns {key: text | null}. */
  selectors: Record<string, string>;
  css?: never;
}

export type ExtractQuery = ExtractSingle | ExtractMulti;

export interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/**
 * Build a JavaScript IIFE that safely extracts multiple selectors in one pass.
 * Each selector is wrapped in try/catch to isolate errors.
 * Returns a map of key -> textContent (trimmed) or null.
 */
export function buildCaptureExpr(selectors: Record<string, string>): string {
  const entries = Object.entries(selectors).map(([k, v]) =>
    `${JSON.stringify(k)}: (() => { try { const el = document.querySelector(${JSON.stringify(v)}); if (!el) return null; const text = (el.textContent || '').trim(); return text === '' ? null : text; } catch { return null; } })()`
  );
  return `(() => ({ ${entries.join(", ")} }))()`;
}

/**
 * Run `Runtime.evaluate` with a snippet that finds selector(s) and
 * returns `textContent` (trimmed). Returns null if no element matches.
 *
 * Two modes:
 *   - { css: string } → returns string | null (single selector, existing behavior)
 *   - { selectors: Record<string, string> } → returns Record<string, string | null> (multi-selector, one round-trip)
 *
 * The selector(s) are embedded via `JSON.stringify` so quotes can't break out.
 */
export async function runExtract(
  cdp: CdpLike,
  sessionId: string,
  query: ExtractQuery
): Promise<string | null | Record<string, string | null>> {
  if (query.selectors) {
    // Multi-selector mode
    const expression = buildCaptureExpr(query.selectors);
    const res = (await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sessionId
    )) as { result?: { value?: Record<string, string | null> } };
    return res.result?.value ?? {};
  } else {
    // Single-selector mode (existing behavior)
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
}
