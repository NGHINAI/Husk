# Example 03 — Shopify Price-Check Agent

Demonstrates Husk's semantic stable IDs + per-site graph cache across
multi-page navigation on a simple Shopify storefront.

## What it does

Navigates to three product pages in sequence on a known Shopify-style
storefront, extracts prices, prints comparison.

## What it tests in Husk

- Semantic stable IDs work consistently across multiple navigations on
  the same domain (same role + name + landmark → same stable ID)
- Site graph cache: first visit computes IDs, subsequent visits reuse
- Snapshot in `text_mode: "labels-only"` mode (small footprint)

## Status

Stub — full implementation lands in Milestone 6.

## License

MIT (this directory is covered by `LICENSE-EXAMPLES`).
