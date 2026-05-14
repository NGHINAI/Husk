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
