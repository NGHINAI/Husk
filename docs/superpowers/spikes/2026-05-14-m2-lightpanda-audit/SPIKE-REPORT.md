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
