# M2 Spike — Decision

**Date:** 2026-05-14
**Spike report:** [`./SPIKE-REPORT.md`](./SPIKE-REPORT.md)
**Plan that produced this:** [`docs/superpowers/plans/2026-05-14-husk-m2-spike-lightpanda-audit.md`](../../plans/2026-05-14-husk-m2-spike-lightpanda-audit.md)
**Next plan:** Plan #3 (M2 real engine work) to be written immediately after this decision, against the locked scope below.

## Verdict

**Selected path: A — Upstream is rich enough. v0 ships with zero engine patches.**

## Rationale

The spike conclusively demonstrated (T7) that we can drive lightpanda end-to-end producing spec-§5.2-shaped JSON-LD snapshots with 89.1% compression using *only* upstream's existing CDP methods (`Target.createTarget`, `Target.attachToTarget`, `Accessibility.getFullAXTree`) and ~80 lines of Node adapter code. The key enabler is that lightpanda implements WAI-ARIA accessible-name computation production-quality in `AXNode.getName()` (T3), exposes the full a11y tree via standard CDP `Accessibility.getFullAXTree` (T4), and ships prebuilt binaries that eliminate the local V8/Xcode build blocker (T7).

The only true gap is `landmark_path` (absent, ~150 lines to add upstream). For v0 we use `xpath` as the disambiguator within stable_id computation — already validated by the T7 PoC. Adding landmark_path is a v0.1 enhancement, not a v0 blocker.

The biggest scope-shrinking finding: lightpanda's built-in MCP server (T6) already exposes 20 tools (`goto`, `click`, `fill`, `scroll`, `semantic_tree`, etc.). Our `@husk/mcp` package becomes a watchdog-aware proxy over upstream MCP rather than a from-scratch implementation.

## Implications for Plan #3 (the real M2 work)

**Original M2 scope (per spec §5.1-§5.2):** Build four engine patches in Zig:
- `Snapshot` CDP domain
- `SemanticId` CDP domain
- Mutation-observer aggregator
- A11y tree builder hooks

**Revised M2 scope (per this decision):** **Zero engine patches.** Plan #3 instead ships:

- **A `lightpanda-runtime` orchestrator submodule** that:
  - Embeds or installs the prebuilt lightpanda binary (download via release tarball or accept a `LIGHTPANDA_BIN` env var)
  - Manages lightpanda subprocess lifecycle (start, healthcheck, kill)
  - Owns the CDP WebSocket connection
- **A `snapshot-adapter`** that takes upstream's `Accessibility.getFullAXTree` output and emits spec-§5.2 JSON-LD with:
  - `stable_id = blake3(role || name_norm || xpath)[:16]` for v0 (landmark_path deferred to v0.1)
  - Passthrough-role pruning (`none`, `generic`, `StaticText`, `InlineTextBox`)
  - State flags via the disabled-as-absent-focusable rule
  - Brotli on the wire
- **A `mutation-poller`** that periodically re-fetches the a11y tree and diffs orchestrator-side (since upstream MutationObserver isn't wired to CDP; polling is v0, real CDP MutationObserver event wiring is v0.1)
- **Engine tests** that verify the prebuilt binary boots, accepts CDP, and `Accessibility.getFullAXTree` returns expected shape (per the T7 PoC pattern)

**Estimated duration:** 2-3 weeks (down from 3-4 weeks). All work is TypeScript / Node — no Zig learning curve required for v0.

**Tasks anticipated for Plan #3:**

1. Embed lightpanda binary distribution (decide: bundle vs download-on-install vs system-install)
2. Subprocess lifecycle manager (`orchestrator/src/engine/lifecycle.ts`)
3. CDP WebSocket client (`orchestrator/src/engine/cdp-client.ts`)
4. Snapshot adapter (`orchestrator/src/snapshot/adapter.ts`) — port the T7 PoC adapter
5. Stable-ID computation (`orchestrator/src/snapshot/stable-id.ts`) — blake3 + xpath rule
6. Mutation poller (`orchestrator/src/snapshot/poller.ts`)
7. Integration tests against the prebuilt binary
8. Update README + quickstart to reflect orchestrator-only-Node setup

## Spec amendments required

These spec edits should be made before Plan #3 begins (committed in a separate `docs: amend spec post-M2-spike` commit on `main` after this spike merges):

| Spec section | Current text | Proposed amendment |
|---|---|---|
| §1 metadata table | `Tech stack: Zig (engine) · TypeScript/Node (orchestrator + canonical SDK) · Python (shim SDK)` | Add note: "v0 requires Zig only for optional engine extensions in v0.1+; v0 ships with prebuilt lightpanda binary and pure Node/TS adapter." |
| §1 metadata table | `Engine basis: Fork of lightpanda (AGPL v3)` | Change to: "Engine basis: Consumes lightpanda (AGPL v3) as a binary dependency for v0. Fork remains as `engine/upstream` for v0.1+ patches." |
| §5.1 algorithm | `blake3(role, name_norm, landmark_path, ordinal, context_window)[:16]` | Add v0 simplification: "For v0: `blake3(role, name_norm, xpath)[:16]`. The landmark_path + ordinal + context_window fields are deferred to v0.1 (require ~150 lines of upstream patches for landmark tracking; xpath provides sufficient disambiguation for v0 within a single page navigation)." |
| §5.2 pipeline | "Mutation observer batches DOM changes per microtask, emits diffs as `{op, path, value}` deltas" | Add v0 simplification: "For v0: orchestrator polls `Accessibility.getFullAXTree` after each action and diffs in TypeScript. Real CDP MutationObserver event wiring (engine patch) is v0.1." |
| §10 prerequisites | `Zig 0.13 (`brew install zig`)` | Change to: "Zig 0.15.2 if you want to build the engine from source (rarely needed; M2 work consumes prebuilt binary). The lightpanda upstream submodule pins to `0.15.2`+ regardless." |
| §9 dependencies table | Add row | "lightpanda binary \| engine \| AGPL v3 \| release 0.3.0+ \| Consumed as prebuilt; built from `engine/upstream` only when needed" |
| §10 risks #1 | "Lightpanda's a11y tree builder is incomplete" | Replace with: "M2 spike resolved this risk — see [`docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/DECISION.md`](../../spikes/2026-05-14-m2-lightpanda-audit/DECISION.md). Outcome: Path A (upstream rich enough)." |

## Knock-on effects on future milestones

- **M3 (orchestrator skeleton):** **Mostly unchanged.** Gains an additional subsystem: the lightpanda subprocess lifecycle manager + CDP client. ~1 week added.
- **M4 (snapshot pipeline + site graph):** **Smaller than spec'd.** The snapshot adapter is ~80 lines (per T7), not a multi-week engine integration. Site graph (per-domain stable_id → selector cache) is unchanged.
- **M5 (watchdog):** **Unchanged.** Fully orchestrator-side; no upstream coordination needed (T6 confirmed zero overlap).
- **M6 (SDKs + MCP + examples):** **MCP package shrinks dramatically.** `@husk/mcp` becomes a watchdog-aware proxy over upstream's stdio MCP server (~200-400 lines). The 18 tools we get for free (`goto`, `click`, `fill`, `scroll`, etc.) plus our 2 Husk-native additions (`snapshot`, `stable_id`) form the full surface.
- **v0.1 (DOM-drift router):** Adds a small upstream Zig patch (`landmark_path` threading in `walk()`, ~150 lines) + the orchestrator-side cross-deploy resolver. Total scope unchanged.
- **v0.2 (auth pillar):** **One flagged gap:** lightpanda doesn't implement IndexedDB. Auth libraries using IndexedDB (Firebase, Auth0 SPA, AWS Amplify) will silently fail. Either contribute IndexedDB upstream (multi-week) or document the limitation explicitly in v0.2.
- **v0.3 (cloud-hosted Husk):** Lightpanda's `TelemetryT(comptime P: type)` compile-time slot can be used for engine-side metrics. Otherwise no impact.
- **v2.0 (hybrid engine — stripped Chromium):** Now framed as "add a second engine backend for sites lightpanda can't handle (Gmail/Salesforce)" rather than "replace lightpanda." More realistic positioning.

## v0 timeline impact

**Original estimate:** 6-8 weeks (M2 was 2-3 weeks of engine patches; M2 spike was projected as 3-5 days).

**Revised estimate:** **5-6 weeks total to v0 ship.** M2 spike consumed ~1 day; M2 production (Plan #3) is now 2 weeks of TypeScript work instead of 3-4 weeks split between Zig + TypeScript. M6's MCP package shrinks from 1 week to 2-3 days. Net savings: ~1.5-2 weeks.

## Open questions for the human reader

None — the spike was conclusive. Plan #3 can be written immediately against this decision.

## Spec amendments process

The spec amendments listed above are intentionally NOT applied in this spike's commit history. They should be a separate commit on `main` after this spike branch merges. Suggested commit message: `docs: amend spec post-M2-spike — v0 ships orchestrator-only, no engine patches`.
