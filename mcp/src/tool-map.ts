/**
 * Bidirectional mapping between upstream lightpanda MCP tool names and
 * Husk-branded names that agents see.
 *
 * The full list of 20 upstream tools comes from the M2 spike audit
 * (T6 — see docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md §6).
 *
 * Naming policy:
 *   - Most tools: prepend `husk_` (e.g., goto → husk_goto)
 *   - camelCase upstream names: convert to snake_case + husk_ prefix
 *     (e.g., nodeDetails → husk_node_details)
 *   - One semantic rename: `semantic_tree → husk_snapshot`
 *     (consistent with spec §5.2 "snapshot" terminology)
 *   - Aliases (goto/navigate, evaluate/eval) are preserved as
 *     distinct husk_* entries so users who learned the upstream alias
 *     can find the Husk equivalent.
 */
export const UPSTREAM_TO_HUSK: Record<string, string> = {
  goto: "husk_goto",
  navigate: "husk_navigate",
  evaluate: "husk_evaluate",
  eval: "husk_eval",
  markdown: "husk_markdown",
  links: "husk_links",
  semantic_tree: "husk_snapshot",
  nodeDetails: "husk_node_details",
  interactiveElements: "husk_interactive_elements",
  structuredData: "husk_structured_data",
  detectForms: "husk_detect_forms",
  click: "husk_click",
  fill: "husk_fill",
  scroll: "husk_scroll",
  waitForSelector: "husk_wait_for_selector",
  hover: "husk_hover",
  press: "husk_press",
  selectOption: "husk_select_option",
  setChecked: "husk_set_checked",
  findElement: "husk_find_element",
};

export const HUSK_TO_UPSTREAM: Record<string, string> = Object.fromEntries(
  Object.entries(UPSTREAM_TO_HUSK).map(([upstream, husk]) => [husk, upstream])
);

/**
 * Translate a Husk-prefixed tool name back to its upstream form for
 * forwarding to lightpanda. If the name has no mapping, return it
 * unchanged (forward-as-is).
 */
export function upstreamNameOf(huskOrUnknown: string): string {
  return HUSK_TO_UPSTREAM[huskOrUnknown] ?? huskOrUnknown;
}

/**
 * Translate an upstream tool name to its Husk-branded form for display
 * to agents. If the name has no mapping, return it unchanged.
 */
export function huskNameOf(upstreamOrUnknown: string): string {
  return UPSTREAM_TO_HUSK[upstreamOrUnknown] ?? upstreamOrUnknown;
}
