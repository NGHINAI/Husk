/**
 * Rule-based page summary for M14 Task 7.
 *
 * Produces a one-line descriptor of page purpose using only the data
 * already present in the snapshot envelope (meta, forms, URL).
 * Pure rules — no LLM, no ML, no external services (Decision M).
 *
 * Detection priority:
 *   1. Login  — password field present in any form
 *   2. Product — JSON-LD @type=Product
 *   3. Article — JSON-LD @type=Article | BlogPosting | NewsArticle
 *   4. Checkout/Cart — URL or title contains checkout/cart/payment keywords
 *   5. Search results — URL path contains /search or title matches "search results"
 *   6. Generic fallback — title + node count, or raw URL if no title
 */

import type { SnapshotMeta } from "./meta.js";
import type { FormSchema } from "./forms.js";

export interface SummaryInput {
  url: string;
  meta: SnapshotMeta;
  forms: FormSchema[];
  nodes_count: number;
}

/**
 * Return the first JSON-LD node whose @type matches `typeName` (string or
 * string[]).  Returns null when no match is found.
 */
function findJsonld(jsonld: unknown[], typeName: string): Record<string, unknown> | null {
  for (const j of jsonld) {
    if (typeof j === "object" && j !== null) {
      const t = (j as Record<string, unknown>)["@type"];
      if (t === typeName) return j as Record<string, unknown>;
      if (Array.isArray(t) && t.includes(typeName)) return j as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Compute a one-line summary describing what the page is.
 *
 * @param s - Inputs derived from the current snapshot (url, meta, forms, nodes_count).
 * @returns  A short, human-readable string such as:
 *   "Login page — Sign in to your account; form fields: email, password"
 *   "Product page — Widget; price 19.99"
 *   "Article — Why Husk Matters"
 *   "Checkout/cart page — Cart — Shop"
 *   "Search results — Search results for husk"
 *   "Random Page — 120 AX nodes; URL https://example.com/random"
 *   "https://example.com/no-title — 5 AX nodes"
 */
export function summarize(s: SummaryInput): string {
  // ── 1. Login detection — any form with a password-type field ──────────────
  const hasPassword = s.forms.some((f) => f.fields.some((fld) => fld.type === "password"));
  if (hasPassword) {
    const fieldNames = s.forms
      .flatMap((f) => f.fields)
      .filter((fld) => fld.type !== "submit" && fld.type !== "hidden")
      .map((fld) => fld.name || fld.type)
      .filter((n) => n);
    return `Login page — ${s.meta.title ?? s.url}; form fields: ${fieldNames.join(", ")}`;
  }

  // ── 2. JSON-LD Product ────────────────────────────────────────────────────
  const product = findJsonld(s.meta.jsonld, "Product");
  if (product) {
    const name = (product.name as string | undefined) ?? s.meta.title ?? "(no name)";
    const price = (() => {
      const offers = product.offers;
      if (offers && typeof offers === "object" && !Array.isArray(offers)) {
        return (offers as Record<string, unknown>).price as string | undefined;
      }
      return undefined;
    })();
    return `Product page — ${name}${price ? `; price ${price}` : ""}`;
  }

  // ── 3. JSON-LD Article / BlogPosting / NewsArticle ────────────────────────
  const article =
    findJsonld(s.meta.jsonld, "Article") ??
    findJsonld(s.meta.jsonld, "BlogPosting") ??
    findJsonld(s.meta.jsonld, "NewsArticle");
  if (article) {
    const headline = (article.headline as string | undefined) ?? s.meta.title ?? s.url;
    return `Article — ${headline}`;
  }

  // ── 4. Checkout / Cart ────────────────────────────────────────────────────
  const checkoutHint = /\b(checkout|cart|payment|order[- ]review)\b/i.test(
    `${s.url} ${s.meta.title ?? ""}`,
  );
  if (checkoutHint) {
    return `Checkout/cart page — ${s.meta.title ?? s.url}`;
  }

  // ── 5. Search results ─────────────────────────────────────────────────────
  // Match /search in the URL path (not just the query string fragment), or a
  // title that explicitly says "search results".
  const urlPathSearchHint = /[/?]search\b/i.test(s.url);
  const titleSearchHint = /search results?/i.test(s.meta.title ?? "");
  if (urlPathSearchHint || titleSearchHint) {
    return `Search results — ${s.meta.title ?? s.url}`;
  }

  // ── 6. Generic fallback ───────────────────────────────────────────────────
  if (s.meta.title) {
    return `${s.meta.title} — ${s.nodes_count} AX nodes; URL ${s.url}`;
  }
  return `${s.url} — ${s.nodes_count} AX nodes`;
}
