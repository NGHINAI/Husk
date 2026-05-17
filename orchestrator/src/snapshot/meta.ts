/**
 * Extract page metadata (title, canonical, OpenGraph, JSON-LD) via Runtime.evaluate.
 * This module implements M14 Task 4: Page metadata snapshot envelope field.
 */

export interface SnapshotMeta {
  title: string | null;
  canonical: string | null;
  og: Record<string, string>;
  jsonld: unknown[];
}

const DEFAULT_META: SnapshotMeta = {
  title: null,
  canonical: null,
  og: {},
  jsonld: [],
};

/**
 * Expression to evaluate in the browser context.
 * Extracts:
 *   - document.title
 *   - <link rel="canonical" href="..." />
 *   - <meta property="og:*" content="..." /> (all og: properties)
 *   - <script type="application/ld+json">...</script> (all JSON-LD blocks)
 *
 * Returns null on any error to allow safe fallback.
 */
const EXTRACT_EXPR = `(() => {
  try {
    const og = {};
    for (const m of document.querySelectorAll('meta[property^="og:"]')) {
      og[m.getAttribute("property").slice(3)] = m.getAttribute("content") || "";
    }
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || null;
    const jsonld = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { jsonld.push(JSON.parse(s.textContent || "null")); } catch (e) { /* ignore malformed */ }
    }
    return { title: document.title || null, canonical, og, jsonld };
  } catch (e) {
    return null;
  }
})()`;

/**
 * Extract page metadata via CDP Runtime.evaluate.
 *
 * @param cdp CDP client with send(method, params) signature.
 * @param _sid Session ID (unused, provided for logging consistency).
 * @returns SnapshotMeta with title, canonical, og, and jsonld fields.
 *          Falls back to safe defaults (all nulls/empty) on any error.
 */
export async function extractMeta(
  cdp: {
    send(method: string, params: unknown): Promise<{ result?: { value?: SnapshotMeta | null } }>;
  },
  _sid: string,
): Promise<SnapshotMeta> {
  try {
    const result = await cdp.send("Runtime.evaluate", {
      expression: EXTRACT_EXPR,
      returnByValue: true,
    });
    return (result.result?.value as SnapshotMeta) ?? DEFAULT_META;
  } catch {
    // Lightpanda or other CDP implementations may not support Runtime.evaluate.
    // Return safe defaults without logging to avoid noise.
    return DEFAULT_META;
  }
}
