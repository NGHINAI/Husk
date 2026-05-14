# M2 Spike — Lightpanda Audit Report

> **Status:** In progress. Sections appended task-by-task during the M2 spike.
> **Submodule pin:** `engine/upstream` at lightpanda commit `2f3a426f` (tag `beta-5126-g2f3a426f`).
> **Plan:** [`docs/superpowers/plans/2026-05-14-husk-m2-spike-lightpanda-audit.md`](../../plans/2026-05-14-husk-m2-spike-lightpanda-audit.md)
> **Decision:** [`./DECISION.md`](./DECISION.md) (written last)

## 1. Build Environment

- **Zig version used:** `0.15.2` (installed via `brew install zig@0.15`)
  - Note: the plan specified Zig 0.13.0, but `build.zig.zon` at commit `2f3a426f` declares `minimum_zig_version = "0.15.2"`. Zig 0.13.0 would have been rejected at compile time. Zig 0.15.2 was installed to match.
- **OS:** `Darwin 24.6.0 arm64`
- **Build command:** `cd engine/upstream && zig build`
- **Build result:** **FAILED** — V8 compilation aborted; Xcode (full IDE) required but only Command Line Tools are installed.
  - **Failure analysis:**
    - The build invoked `depot_tools` + `gclient` to fetch and compile V8 14.0.365.4 from source.
    - V8's GN build system calls `python3 build/config/apple/sdk_info.py macosx`, which in turn runs `xcodebuild -version`.
    - `xcodebuild` is only available in the full Xcode app, not in Command Line Tools alone.
    - Exact error: `xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance`
    - GN exited with code 1, causing the entire build to fail at the `build_v8_core` step (50/57 steps succeeded before the failure).
    - No binaries were produced (`zig-out/bin/` does not exist).
- **First-build duration:** ~4 minutes 16 seconds (16:38:32 → 16:42:48); most time was spent cloning the V8 repo (~1.26 GiB) and running `gclient` hooks before the Xcode error halted compilation.
- **Produced binaries:** none (build failed before any Zig compilation of lightpanda itself occurred)
- **Notes:**
  - ripgrep `14.1.1` is available (`rg --version`).
  - Zig 0.13.0 binary was downloaded from ziglang.org but is the wrong version for this submodule pin; `zig@0.15` from Homebrew is the correct toolchain.
  - The V8 bootstrap downloads ~1.26 GiB of V8 source into `engine/upstream/.lp-cache/v8-14.0.365.4/`. This cache persists and will not need to be re-cloned on subsequent attempts.
  - The immediate blocker is the absence of full Xcode. Fix: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (requires Xcode.app to be installed). If Xcode is not installed, run `xcodebuild` or install from the App Store / Apple Developer Portal.
  - Alternative path: use the `prebuilt_v8_path` build option (`zig build -Dprebuilt_v8_path=...`) if a pre-compiled `libc_v8.a` for arm64 is available, which would bypass V8 source compilation entirely.

(Subsequent sections appended by later tasks.)

## 2. Source Map (Upstream)

### Top-level src/ files (purpose-by-purpose)

| File | LOC | Apparent purpose |
|---|---|---|
| `lightpanda.zig` | 281 | Public library entry point; re-exports App, Network, Server, Config, Browser, Page, Frame, Session, SemanticTree, CDPNode, cookies, mcp, and all browser sub-modules. The single import surface for every binary and test. |
| `main.zig` | 247 | Binary entrypoint for the `lightpanda` daemon. Sets up GPA/c_allocator, arena, signal handler, then delegates to `run()` which parses CLI config and starts the CDP server. |
| `main_snapshot_creator.zig` | 47 | Standalone tool that initialises the V8 `Platform`, creates a JS `Snapshot` (V8 startup blob), and writes it to a file or stdout. Run at build time to embed the snapshot; not part of the browser binary itself. |
| `App.zig` | 122 | Application-level container: owns `Network`, `Storage`, `Platform`, `Snapshot`, `Telemetry`, `ArenaPool`, and `Config`. Initialised once; passed by pointer everywhere. |
| `Server.zig` | 698 | CDP WebSocket server loop: accepts TCP connections, spawns per-connection `CDP` goroutine-equivalents, manages thread lifecycle, and routes CDP messages via `CDP.zig`. |
| `SemanticTree.zig` | 772 | **CRITICAL audit target.** Walks the live DOM and emits a pruned accessibility/semantic tree (JSON or text). Computes role, name, value, xpath, interactivity, visibility, and pointer-events per node. Exposes `prune`, `interactive_only`, and `max_depth` modes. Already does exactly what Husk's AI-agent content extraction plan describes. |
| `cli.zig` | 680 | Comptime CLI builder. Declarative command-descriptor approach that generates a tagged-union parser. Handles snake_case / kebab-case aliasing, multiple-value flags, positional args, and custom validators. |
| `Config.zig` | 841 | All runtime configuration fields: CDP address/port, keepalive tuning, max message sizes, log filter scopes, dump/MCP/cookie/storage paths, storage backend, network options (cache, robots, bot-auth). |
| `mcp.zig` | 10 | Thin facade: re-exports `mcp/protocol.zig`, `mcp/router.zig`, and `mcp/Server.zig`. Actual logic lives in the `src/mcp/` subdirectory. |
| `cookies.zig` | 166 | Loads cookies from a JSON file (Puppeteer/Playwright CDP Network.Cookie format) into the session cookie jar. Relevant to v0.2 auth pillar. |
| `datetime.zig` | 2151 | Full RFC-compliant datetime parsing/formatting/arithmetic library; largest single file in the repo by a wide margin. Self-contained. |
| `slab.zig` | 862 | Generic slab allocator / object pool. Used across the codebase for DOM node pooling. |
| `Notification.zig` | 518 | Async notification/event bus used to signal page-load stages (load, domcontentloaded, networkidle) to waiters. |
| `ArenaPool.zig` | 371 | Pool of reusable arena allocators sized small/medium/large; avoids GC pressure on per-request arenas. |
| `string.zig` | 470 | Interned/small-string type (`String`), whitespace utilities, and related helpers. |

### Subdirectories

| Directory | Top-level contents | Apparent purpose |
|---|---|---|
| `src/browser/` (5.9 MB) | `Browser.zig`, `Page.zig`, `Frame.zig`, `Session.zig`, `actions.zig`, `interactive.zig`, `links.zig`, `forms.zig`, `dump.zig`, `markdown.zig`, `structured_data.zig`, `HttpClient.zig`, `Runner.zig`, `ScriptManager.zig`, `EventManager.zig`, `Factory.zig`, `StyleManager.zig`, + `js/`, `webapi/` (84 files), `parser/`, `css/` | Core browser engine. `webapi/` contains the full W3C Web API surface (Document, Element, Window, fetch, crypto, canvas, CSS, events, etc.). `js/` wraps V8 (Platform, Isolate, Context, Snapshot, Inspector, Module, …). `parser/` bridges to html5ever. |
| `src/cdp/` (444 KB) | `CDP.zig`, `Node.zig`, `AXNode.zig`, `id.zig`, `testing.zig`, `domains/` (20 domain handlers) | Chrome DevTools Protocol implementation. `domains/` has handlers for accessibility, dom, network, page, runtime, input, emulation, fetch, console, storage, security, screenshot, etc. `AXNode.zig` computes WAI-ARIA role/name from DOM nodes — feeds directly into `SemanticTree.zig`. |
| `src/mcp/` (88 KB) | `protocol.zig`, `router.zig`, `Server.zig`, `tools.zig`, `resources.zig` | Model Context Protocol server implementation. `tools.zig` exposes `goto`, `navigate`, `markdown`, `links`, `evaluate`, `eval`, `semantic_tree`, and `nodeDetails` as MCP tools. This is a full MCP server built into lightpanda — directly relevant to the M6 obsolescence question: lightpanda already ships an MCP layer. |
| `src/network/` (244 KB) | `Network.zig`, `http.zig`, `WsConnection.zig`, `WebBotAuth.zig`, `IpFilter.zig`, `Robots.zig`, `cache/` (Cache.zig, FsCache.zig), `layer/` (CacheLayer, Forward, InterceptionLayer, RobotsLayer, WebBotAuthLayer) | HTTP/WS networking stack. Layered architecture: interceptors for caching, robots.txt, bot-auth, and request forwarding. IP filtering and `robots.txt` enforcement built in. |
| `src/storage/` (40 KB) | `Storage.zig`, `Blackhole.zig`, `sqlite/` (Pool.zig, Sqlite.zig, migrations.zig) | Persistent storage backend. SQLite pool for cookie/storage persistence; `Blackhole.zig` is a no-op backend for ephemeral sessions. |
| `src/data/` (340 KB) | `public_suffix_list.zig`, `public_suffix_list_gen.go` | Compiled-in Mozilla Public Suffix List for cookie/origin scoping. The `.go` file is the generator; the `.zig` file is the generated data. |
| `src/sys/` (52 KB) | `idna.zig`, `libcrypto.zig`, `libcurl.zig` | FFI bindings to system libraries: IDNA (via libidn2), OpenSSL/libcrypto, and libcurl. |
| `src/html5ever/` (64 KB) | `Cargo.toml`, `Cargo.lock`, `lib.rs`, `sink.rs`, `types.rs` | Rust crate that wraps Servo's `html5ever` HTML5 parser and exposes a C ABI consumed by `src/browser/parser/html5ever.zig`. This is a cross-language boundary — Rust compiled to a static lib, then called from Zig. |
| `src/telemetry/` (16 KB) | `telemetry.zig`, `lightpanda.zig` | Usage telemetry: disabled in Debug/test mode or when `LIGHTPANDA_DISABLE_TELEMETRY` is set; sends anonymous metrics (UUID-based install ID) in release builds. |
| `vendor/` | `libidn2/` only | Single vendored C library: libidn2 (IDNA 2008 / TR46 hostname normalisation). Everything else is fetched by `build.zig.zon` or `gclient`. |

### Observations

`SemanticTree.zig` already implements the exact accessibility-tree extraction that Husk's AI-agent layer needs — including pruning modes, xpath generation, interactivity classification, and both JSON and text serialisers — meaning Husk does not need to build this from scratch, only wrap or extend it. The `src/mcp/` directory is a fully functioning MCP server built into lightpanda that already exposes `semantic_tree`, `markdown`, `links`, `evaluate`, and `goto` as MCP tools; this directly affects the M6 obsolescence question (our planned Husk MCP layer would largely duplicate what already exists). The `src/html5ever/` directory reveals a Rust/C-ABI boundary that is opaque to Zig tooling — any patches touching the HTML parser must account for a separate Rust build step, which adds cross-language build complexity beyond the V8 blocker already identified in Task 1.

## 3. SemanticTree Audit (spec §5.1 viability)

### File stats
- `src/SemanticTree.zig`: 772 lines
- Related files read in full:
  - `src/cdp/AXNode.zig`: 1,594 lines — WAI-ARIA role/name computation engine; fed directly into SemanticTree
  - `src/browser/interactive.zig`: 578 lines — interactivity classification, listener-target map
  - `src/mcp/tools.zig`: 1,243 lines — MCP tool dispatch layer that surfaces SemanticTree to callers
  - `src/browser/webapi/Element.zig` (excerpted) — `getBoundingClientRect` / `calculateDocumentPosition` faux-layout

### Data shape (what each semantic-tree node carries)

| Spec §5.1 requirement | Available in upstream? | Notes / Evidence (file:line) |
|---|---|---|
| Role | **Yes** | `AXNode.getRole()` (`cdp/AXNode.zig:1277`) returns either the explicit `role=` attribute or an implicit role derived from a 60+ entry tag→AXRole enum (`cdp/AXNode.zig:637–793`). Covers full HTML semantics including landmark-adjacent tags (`nav`→`navigation`, `main`→`main`, `aside`→`complementary`, `header`→`banner`, `footer`→`contentinfo`, `section`→`region`, `dialog`→`dialog`, plus all form, table, heading, and text roles). ARIA role override respected. Known gap: `<header>`/`<footer>` inside sectioning content should map to `none` but unconditionally maps to `banner`/`contentinfo` (comment at `cdp/AXNode.zig:665,670`). `<section>` always maps to `region` even without an accessible name (comment at `cdp/AXNode.zig:675`). |
| Accessible name (WAI-ARIA computed) | **Yes — partial** | `AXNode.getName()` and `AXNode.writeName()` (`cdp/AXNode.zig:824,862`) implement the WAI-ARIA accname precedence chain: `aria-labelledby` (with multi-ID space-separated concatenation) → `aria-label` → `<label for=...>` / wrapping `<label>` → `alt` → tag-specific value fallback (button/submit/reset input uses `value`) → text-content fallback → `title` → `placeholder`. Source enum `AXSource` tracks which rule fired (`cdp/AXNode.zig:812`). **Gap 1:** text-content fallback (`writeAccessibleNameFallback`) recurses into children and handles inline `<img alt>` and SVG `<title>` but does **not** recursively resolve ARIA roles on children (not full accname spec §4.3). **Gap 2:** `writeName` contains `// TODO Check for <label>` comments for `<input type=text/password/etc>` (`cdp/AXNode.zig:953–955`) — label resolution is only implemented for labellable tags that pass `isLabellableTag` (button, meter, output, progress, select, textarea, input). In practice this covers most real-world cases. `getName()` returns `null` (not empty string) when no name resolves, which the stable-ID hasher would need to handle. |
| Landmark path | **No** | The words "landmark" and "landmark_path" appear **zero times** in the entire source tree (`rg -i landmark src/` returned no hits). Landmark roles (`navigation`, `main`, `banner`, `contentinfo`, `region`, `complementary`, `form`, `dialog`, `search`) are present as role values but there is no data structure tracking the chain of ancestor landmarks from root to element. The walk function in `SemanticTree.zig` passes `parent_name` down for StaticText deduplication but nothing equivalent for landmark ancestry. Deriving it would require: (a) walking each node's DOM ancestors at query time, (b) checking whether each ancestor's role is a landmark, and (c) concatenating them — feasible to add, but nothing exists today. |
| Ordinal (index among siblings of same role in landmark) | **Partial — derivable** | Within each `walk()` call (`SemanticTree.zig:266–280`), a `tag_counts` `StringArrayHashMap` is maintained per parent node — it counts how many children of each tag name have been seen before the current child, and the resulting 1-based `index` is passed to `appendXPathSegment()` to produce xpath like `/div[3]`. This gives index-among-same-tag-siblings, not index-among-same-**role**-siblings-within-a-landmark. Roles and tags are not the same (e.g., two `<a>` and one `<button>` would all count as separate tag groups but all have `button`/`link` roles). Computing role-based ordinal within a landmark scope requires landmark-path tracking (above) first, then a parallel counter per (landmark, role) pair. Not present; medium complexity to add. |
| Context window (5 words before + 5 after) | **No** | No concept of context window exists. The tree walk in `SemanticTree.zig:113–288` emits nodes but does not maintain a running text buffer of surrounding siblings or preceding/following text nodes. Text content is available on demand via `CData.Text.getWholeText()` and `Element.getInnerText()`, and the DOM's `childrenIterator()` / `nextSibling()` / `firstChild()` chain is walkable, so the raw ingredients are present. But extracting "5 words preceding + 5 following" requires: (a) collecting the flattened in-order text of the document, (b) locating the current node's text span within that sequence, and (c) slicing a 5-word window on either side. That computation does not exist anywhere in the codebase. |
| State (enabled, visible, checked, etc.) | **Yes** | Per-node `NodeData` struct (`SemanticTree.zig:92–104`) carries `interactive: bool`, `disabled: bool`, `checked: ?bool`. Visibility is enforced at walk time via `el.checkVisibilityCached()` (`SemanticTree.zig:133`) — invisible nodes are pruned before they reach the visitor, so all emitted nodes are implicitly visible. The AXNode property system (`cdp/AXNode.zig:280–465`) additionally computes: `disabled`, `focusable`, `editable`, `multiline`, `readonly`, `required`, `invalid`, `expanded`, `selected`, `checked`, `level`, `orientation`, `multiselectable`, `settable`, `hasPopup`. `aria-hidden` / `hidden` / `inert` / CSS `display:none` / `visibility:hidden` are all checked and cause node exclusion (`cdp/AXNode.zig:1138–1160`). |
| Bounding rect (for click coordinates) | **Partial — faux layout** | `Element.getBoundingClientRect()` exists (`browser/webapi/Element.zig:1196`) and is called. However the underlying `calculateDocumentPosition()` is a **faux-layout heuristic** (`Element.zig:1335`): it walks the DOM tree counting preceding nodes and multiplies by 5px/node for y, with a parallel sibling-count method for x. There is no CSS layout engine, no inline/block formatting context, no floats or flexbox. The comment explicitly describes this as "faux-layout" (`Element.zig:1161`). Bounding rects are not exposed through `SemanticTree.zig` or `NodeDetails` at all — the `NodeData` and `NodeDetails` structs have no `rect` field. For click dispatch lightpanda uses `actions.click()` which fires DOM events on the node directly without needing pixel coordinates. So: bounding rect **exists** as an API but is (a) faux, not real layout, and (b) not surfaced in the semantic tree output. |

### Public API surface

**`SemanticTree.zig`** (struct `Self`):
```
// Constructor fields (set inline on struct literal):
dom_node: *Node
registry: *CDPNode.Registry
frame: *Frame
arena: std.mem.Allocator
prune: bool = true            // prune structural roles unless interactive/labelled
interactive_only: bool = false // emit only interactive + content roles with names
max_depth: u32 = maxInt(u32)-1

// Serializers:
pub fn jsonStringify(self, jw: *std.json.Stringify) error{WriteFailed}!void
pub fn textStringify(self, writer: *std.Io.Writer) error{WriteFailed}!void

// Per-node detail lookup (static):
pub fn getNodeDetails(arena, node, registry, frame) !NodeDetails
```

**`NodeDetails`** struct (returned by `getNodeDetails`):
```
backendNodeId: CDPNode.Id
tag_name: []const u8
role: []const u8
name: ?[]const u8
interactive: bool
disabled: bool
value: ?[]const u8
input_type: ?[]const u8
placeholder: ?[]const u8
href: ?[]const u8
id: ?[]const u8
class: ?[]const u8
checked: ?bool
options: ?[]OptionData

pub fn jsonStringify(self, jw) !void
```

**`cdp/AXNode.zig`** (struct `AXNode`):
```
pub fn fromNode(dom: *DOMNode) AXNode
pub fn getRole(self) ![]const u8         // returns ARIA role string
pub fn getName(self, frame, allocator) !?[]const u8   // WAI-ARIA computed name
```

**MCP tools layer** (`mcp/tools.zig`) — exposed over JSON-RPC 2.0:
- `semantic_tree` — text serialisation, optional `backendNodeId` root + `maxDepth`
- `nodeDetails` — per-node detail lookup by `backendNodeId`
- `interactiveElements` — flat list from `interactive.collectInteractiveElements()`
- `findElement` — filter by role and/or accessible name substring
- `click`, `fill`, `scroll`, `hover`, `press`, `selectOption`, `setChecked` — DOM mutation tools
- `goto`/`navigate`, `markdown`, `links`, `evaluate`/`eval`, `structuredData`, `detectForms`, `waitForSelector`

JSON output per node (from `JsonVisitor.visit`): `nodeId`, `backendDOMNodeId`, `nodeName`, `xpath`, `nodeType`, `isInteractive`, `isDisabled` (optional), `role`, `name` (optional), `value` (optional), `attributes` (all raw HTML attributes), `checked` (optional), `options` (optional), `children` (recursive array).

### Gaps for spec §5.1

**`landmark_path` — absent (medium effort)**
Nothing in the codebase tracks the chain of ARIA landmark ancestors. Adding it requires:
1. Defining a `landmark_roles` static set (the ~9 ARIA landmarks — can reuse/extend the existing `isStructuralRole` or `isContentRole` maps in `interactive.zig`).
2. Modifying `SemanticTree.walk()` to thread an accumulated landmark-path slice down through recursive calls (similar to how `parent_name` is already threaded, but as a growable path string).
3. Making that path available on `NodeData` and emitting it in `JsonVisitor`/`TextVisitor`.
Estimated size: ~100–150 lines of Zig. Risk: low (additive change, no existing logic broken). This is a **small** patch.

**`ordinal` within landmark — absent (small-medium effort, depends on landmark_path)**
Once landmark path is available, ordinal requires tracking a `(landmark_path, role) → u32` counter map alongside `tag_counts` in `walk()`. The existing `tag_counts` pattern shows exactly how to do this; the landmark-scoped variant adds one extra grouping key. Estimated size: ~50 extra lines. However it cannot be done without `landmark_path` first.

**`context_window` — absent (medium effort)**
No flattened-text buffer exists. Options:
- Option A: In a pre-pass, walk the full DOM and build an ordered `[]TextSpan` slice (node pointer + text). Then in `walk()`, binary-search for the current node's position and slice ±5 words. Clean but requires a pre-pass allocating O(n) spans.
- Option B: In `walk()`, for each visited node use `node.nextSibling()` / `node.previousSibling()` to walk up to 5 text tokens in each direction on the fly. Cheaper but misses text across element boundaries correctly.
Neither option exists today. Estimated size: ~150–200 lines. Risk: medium (text tokenisation logic must be tested).

**Accessible name completeness — partial gaps (small effort)**
The two `// TODO` comments at `cdp/AXNode.zig:953–955` for `<input>` label resolution are the main outstanding gap. However `isLabellableTag` already includes `.input` so the gap is only for inputs that fall through the tag-switch and reach the `else` branch. In practice this means generic text/email/tel/url inputs without a `<label>` or `aria-label` may return `null` where a `<label>` exists. Fix: extend `isLabellableTag` handling in `writeName()` for those input types. Estimated size: ~20 lines.

**Bounding rect — faux (not fixable without a layout engine)**
The faux layout is documented as intentional — lightpanda has no CSS layout engine. For the stable-ID spec §5.1 this does not matter (bounding rect is not an input to the hash). For click dispatch the existing event-firing approach (`actions.click()` fires directly on the node) is sufficient. This gap is irrelevant for the stable-ID computation but relevant if any Husk feature needs pixel-accurate hit testing.

### Verdict

⚠️ **Partial** — descope to a smaller stable-ID surface.

Full spec §5.1 hashing (`role ‖ name_norm ‖ landmark_path ‖ ordinal ‖ context_window`) is **not** implementable without upstream patches, because `landmark_path`, `ordinal`, and `context_window` are entirely absent.

However, a descoped stable-ID of `blake3(role ‖ '\0' ‖ name_norm ‖ '\0' ‖ xpath)[:16]` is **immediately implementable** with zero upstream changes: `role` and `name` (WAI-ARIA computed) are already emitted per node in the JSON output, and `xpath` is already computed and emitted (`appendXPathSegment` at `SemanticTree.zig:327`). The xpath string (e.g. `/html[1]/body[1]/main[1]/section[2]/button[1]`) provides structural uniqueness almost equivalent to `landmark_path + ordinal` in most documents, with the advantage of being already present. Stability degrades only on dynamic pages where elements are inserted mid-list — the same class of instability that `landmark_path + ordinal` partially addresses.

The three missing inputs (`landmark_path`, `ordinal`, `context_window`) are additive — they can be patched into `SemanticTree.zig` and `NodeData` without changing any existing fields or callers. Total patch estimate: **~300–400 lines of Zig** across 2–3 files, 1–2 weeks of work. The landmark_path patch alone (~150 lines) would unlock both `landmark_path` and `ordinal` together. `context_window` is the largest and most optional of the three (it only improves disambiguation for near-duplicate elements).
