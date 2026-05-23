import type { Snapshot } from "../snapshot/types.js";

const FATAL_POLYFILL_PATTERNS = [
  /BroadcastChannel is not defined/i,
  /IndexedDB is not defined/i,
  /ServiceWorker is not defined/i,
  /customElements is not defined/i,
  /MutationObserver is not defined/i,
];

export const KNOWN_RICH_SITES = new Set([
  "linkedin.com",
  "gmail.com",
  "salesforce.com",
  "github.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "notion.so",
  "linear.app",
  "asana.com",
  "monday.com",
  "slack.com",
  "discord.com",
  "youtube.com",
  "docs.google.com",
  "drive.google.com",
  "outlook.com",
  "office.com",
  "zoom.us",
  "figma.com",
  "airtable.com",
  "atlassian.net",
  "trello.com",
]);

const ERROR_PATTERN = /\b(reintentar|try again|something went wrong|page not available|unavailable|please refresh)\b/i;

export interface PageHealthVerdict {
  should_fallback: boolean;
  reasons: string[];
}

interface AxNode { i: string; r: string; n: string; s: unknown[]; c?: unknown[] }

function countNodes(node: AxNode | undefined): number {
  if (!node) return 0;
  let n = 1;
  if (Array.isArray(node.c)) {
    for (const child of node.c) n += countNodes(child as AxNode);
  }
  return n;
}

function flattenText(node: AxNode | undefined): string {
  if (!node) return "";
  let s = node.n ?? "";
  if (Array.isArray(node.c)) {
    for (const child of node.c) s += " " + flattenText(child as AxNode);
  }
  return s;
}

function isKnownRichSite(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    for (const site of KNOWN_RICH_SITES) {
      if (host === site || host.endsWith("." + site)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function detectPageHealth(snapshot: Snapshot): PageHealthVerdict {
  const reasons: string[] = [];

  // Marker 1: polyfill-gap console errors
  const consoleErrors = (snapshot.console ?? []).filter((m) => m.level === "error");
  for (const err of consoleErrors) {
    for (const pat of FATAL_POLYFILL_PATTERNS) {
      if (pat.test(err.text)) {
        const name = pat.source.split(" ")[0];
        reasons.push(`polyfill_gap:${name}`);
        break;
      }
    }
  }

  const nodeCount = countNodes(snapshot.root as AxNode);
  const onRichSite = isKnownRichSite(snapshot.url);

  // Marker 2: empty AX on rich site
  if (onRichSite && nodeCount <= 5) {
    reasons.push("empty_ax_on_rich_site");
  }

  // Marker 3: only-error text content
  if (nodeCount <= 5) {
    const text = flattenText(snapshot.root as AxNode);
    if (ERROR_PATTERN.test(text)) {
      reasons.push("only_error_text");
    }
  }

  // Marker 4: minimal content + no metadata on a rich site
  const noMeta = !snapshot.meta?.jsonld?.length && Object.keys(snapshot.meta?.og ?? {}).length === 0;
  const noForms = !snapshot.forms?.length;
  if (onRichSite && noMeta && noForms && nodeCount < 20) {
    reasons.push("minimal_content_on_rich_site");
  }

  // Dedupe reasons
  const uniqueReasons = [...new Set(reasons)];
  return {
    should_fallback: uniqueReasons.length > 0,
    reasons: uniqueReasons,
  };
}
