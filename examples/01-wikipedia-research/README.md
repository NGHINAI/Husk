# Example 01 — Wikipedia Research Agent

Demonstrates Husk's snapshot quality + full-text-preservation mode on a
text-heavy page.

## What it does

Navigates to a Wikipedia article, captures a `text_mode: "full"`
snapshot, hands it to a Claude (or any) LLM with the prompt "summarize
this article in 200 words," prints the summary.

## What it tests in Husk

- Snapshot compression on a large text-heavy page (~25K words)
- Full text content preservation (`text_mode: "full"` correctly includes
  every paragraph)
- No watchdog rejections on a read-only navigation flow

## Status

Stub — full implementation lands in Milestone 6.

## License

MIT (this directory is covered by `LICENSE-EXAMPLES`).
