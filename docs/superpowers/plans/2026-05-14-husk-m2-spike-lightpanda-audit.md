# Husk Milestone 2 — Spike: Lightpanda Audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the upstream lightpanda submodule (pinned at `2f3a426f`) to discover exactly what it already provides — a11y/semantic tree builder, CDP coverage, MCP support, snapshot facilities, mutation observers, DOM commit hooks — so that Plan #3 (the real M2 engine patches) can be written against verified upstream APIs instead of assumed ones. The deliverable is *knowledge plus a small proof-of-concept*, not production code.

**Architecture:** Pure investigation. We do not modify upstream lightpanda code, do not write production patches, do not change the orchestrator/SDKs. Output is three artifacts: a detailed audit report, a working Zig proof-of-concept that demonstrates we can drive lightpanda end-to-end, and a decision document that locks Plan #3's scope to one of three paths.

**Tech Stack:** Zig 0.13 (engine), the lightpanda submodule, ripgrep / find for source navigation. No new TypeScript or Python work.

**Source spec:** `docs/superpowers/specs/2026-05-13-husk-design.md` (Section 5.1–5.3 = the patches we *planned*; this spike validates which planned patches are still needed vs. already-shipped upstream)

**Pre-spike intel** (discovered during plan-writing):
- Upstream `src/` already contains `SemanticTree.zig` — strongly suggests partial or full a11y/semantic-tree implementation already exists
- `main_snapshot_creator.zig` — dedicated snapshot binary entrypoint
- `cdp/` — CDP server module
- `mcp.zig` + `mcp/` — upstream already implements Model Context Protocol (this may obsolete our `@husk/mcp` plans wholesale; flag in DECISION.md)
- `html5ever` — Servo's HTML parser is the underlying HTML engine
- `vendor/` — vendored Zig dependencies

If upstream genuinely ships all four spec'd "novel" patches (Snapshot domain, SemanticId, mutation observer, a11y hooks), then M2's production scope shrinks from "build engine patches" to "wire orchestrator to existing engine endpoints." That is a substantial design simplification and needs to be flagged immediately if confirmed.

**Branch:** `m2-spike` (already created — verify with `git branch --show-current` returns `m2-spike` before starting Task 1)

**Prerequisites:**
- Zig 0.13 installed locally (`zig version` returns `0.13.0`). If missing: `brew install zig` (Homebrew formula tracks a specific Zig version — confirm 0.13 explicitly; if Homebrew has only 0.14, install 0.13 via `asdf` or download from ziglang.org/download/0.13.0).
- ripgrep installed (`rg --version`). If missing: `brew install ripgrep`.
- The lightpanda submodule is initialized (`ls engine/upstream/src/SemanticTree.zig` returns a file). M1's Task 7 set this up.

---

## File Structure

This spike produces a folder of artifacts plus a small Zig PoC. The artifacts are *permanent* (committed for posterity); the PoC is also committed but explicitly scoped as throwaway code.

### Audit / decision artifacts (permanent record)

- Create: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md`
  - The detailed findings document. Grows incrementally over Tasks 2–7.
- Create: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/DECISION.md`
  - Short verdict written in Task 8 based on the audit. Locks Plan #3's scope.

### Proof-of-concept (committed but scoped throwaway)

- Create: `engine/spike/snapshot-poc.zig`
  - A minimal Zig program that drives lightpanda end-to-end on a fixed local HTML page and emits *something* semantic. Demonstrates that we have a working end-to-end path through the engine, even if the final design is different.
- Create: `engine/spike/README.md`
  - Explains that this directory is throwaway scaffold work for the M2 spike. Files here may be deleted or restructured when Plan #3 is written.
- Create: `engine/spike/fixture.html`
  - A fixed test page used by the PoC. Plain HTML with three buttons, a form, and some text — enough to exercise a11y extraction.

### Reference / scratch (not committed)

- `engine/spike/.scratch/` (gitignored by `.gitignore` rule we will add) — any temporary build artifacts, captured CDP traces, etc., produced during investigation but not part of the permanent record.

---

## Tasks

### Task 1: Verify local build of lightpanda upstream

**Goal:** Confirm we can build the upstream submodule locally — this is the entry condition for everything else. If `zig build` fails, the spike can't proceed without first resolving build prereqs.

**Files:**
- Create: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md` (with the "Build environment" section as initial content)

- [ ] **Step 1: Verify Zig 0.13 and ripgrep are installed**

```sh
zig version
rg --version | head -1
```

Expected:
- `zig version` prints `0.13.0` (any patch version of 0.13.x is fine; 0.14+ may have breaking changes lightpanda hasn't adopted)
- `rg --version` prints `ripgrep 14.x` or similar

If either is missing: install before continuing (`brew install zig` and/or `brew install ripgrep`). If Homebrew installs Zig 0.14+, use `asdf install zig 0.13.0 && asdf local zig 0.13.0` or download the 0.13.0 binary from https://ziglang.org/download/.

- [ ] **Step 2: Verify the lightpanda submodule is checked out**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
test -f engine/upstream/src/SemanticTree.zig && echo "submodule OK" || echo "MISSING — run: git submodule update --init --recursive"
```

If MISSING: `git submodule update --init --recursive` to fetch.

- [ ] **Step 3: Attempt upstream's own build**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
zig build 2>&1 | tee /tmp/lightpanda-build.log | tail -40
echo "Exit: $?"
```

Possible outcomes:
- **Exit 0**: build succeeded. Note the produced binary path (likely `zig-out/bin/lightpanda` or `zig-out/bin/lightpanda_snapshot_creator`). Record in SPIKE-REPORT.
- **Compilation error**: read the error. Most likely causes: Zig version mismatch (verify 0.13), missing system dep (e.g., libcurl headers — check `flake.nix` for the dependency list). Document the error in SPIKE-REPORT and proceed to Step 4 with the failure recorded.
- **Long compile time**: lightpanda compiles V8 from source; this can take 5-30 minutes on first build. Be patient.

- [ ] **Step 4: Create the SPIKE-REPORT.md with build-environment section**

```sh
mkdir -p /Users/nirmalghinaiya/Desktop/husk/docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit
```

Then create `/Users/nirmalghinaiya/Desktop/husk/docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md` with this initial content. (Use triple-backtick fences in the actual file; the four-backtick wrappers in this prompt are for display.)

````markdown
# M2 Spike — Lightpanda Audit Report

> **Status:** In progress. Sections appended task-by-task during the M2 spike.
> **Submodule pin:** `engine/upstream` at lightpanda commit `2f3a426f` (tag `beta-5126-g2f3a426f`).
> **Plan:** [`docs/superpowers/plans/2026-05-14-husk-m2-spike-lightpanda-audit.md`](../../plans/2026-05-14-husk-m2-spike-lightpanda-audit.md)
> **Decision:** [`./DECISION.md`](./DECISION.md) (written last)

## 1. Build Environment

- **Zig version used:** <fill from `zig version` output, e.g., `0.13.0`>
- **OS:** <`uname -srm`, e.g., `Darwin 24.6.0 arm64`>
- **Build command:** `cd engine/upstream && zig build`
- **Build result:** <"success" or summarize the error>
- **First-build duration:** <wall-clock time if measured>
- **Produced binaries:** <list any `zig-out/bin/*` produced, or "none" if build failed>
- **Notes:** <anything surprising — missing deps, warnings, etc.>

(Subsequent sections appended by later tasks.)
````

Fill in the angle-bracket placeholders with actual values from Step 3's output. If the build failed, write the verbatim error message in the "Build result" field plus a "Failure analysis" sub-bullet.

- [ ] **Step 5: Commit the initial report**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md
git commit -m "spike(m2): record lightpanda build-environment audit"
```

---

### Task 2: Survey lightpanda's source layout

**Goal:** Get a top-down map of where the relevant modules live, so the deeper-dive tasks (3–6) know where to look. Output: a "Source map" section in SPIKE-REPORT.md listing each top-level module and its apparent responsibility.

**Files:**
- Modify: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md` (append "Source Map" section)

- [ ] **Step 1: List src/ structure with directory sizes**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
echo "=== Top-level src/ files ==="
ls -la src/ | grep -v "^total"
echo ""
echo "=== src/ subdirectory sizes ==="
du -sh src/*/ 2>/dev/null | sort -hr
echo ""
echo "=== Line counts of top-level Zig files ==="
wc -l src/*.zig 2>/dev/null | sort -rn | head -20
```

- [ ] **Step 2: Identify each top-level module's apparent purpose**

Open each non-trivial top-level file and read the first 30-50 lines (or doc comments at the top). Specifically check:
- `lightpanda.zig` — likely the public library entry point
- `main.zig` — the main browser binary entrypoint
- `main_snapshot_creator.zig` — what does this binary do? Read top comment + main function.
- `App.zig` — application-level container
- `Server.zig` — likely the CDP server top-level
- `Config.zig` — configuration shape
- `SemanticTree.zig` — **CRITICAL**: this is likely the a11y/semantic structure we're auditing. Read it in full to understand its shape.
- `cli.zig` — command-line interface
- `mcp.zig` — MCP top-level

For subdirectories, list their contents:
```sh
for d in src/browser src/cdp src/mcp src/network src/storage src/data src/sys src/html5ever src/telemetry; do
  [ -d "$d" ] || continue
  echo "=== $d ==="
  ls "$d" | head -20
done
```

- [ ] **Step 3: Append "Source Map" section to SPIKE-REPORT.md**

Add this section to the existing SPIKE-REPORT.md (under the Build Environment section):

````markdown

## 2. Source Map (Upstream)

### Top-level src/ files (purpose-by-purpose)

| File | LOC | Apparent purpose |
|---|---|---|
| `lightpanda.zig` | <fill> | <fill from reading top comment> |
| `main.zig` | <fill> | <fill> |
| `main_snapshot_creator.zig` | <fill> | <fill — this is high-priority intel> |
| `App.zig` | <fill> | <fill> |
| `Server.zig` | <fill> | <fill> |
| `SemanticTree.zig` | <fill> | <fill — CRITICAL audit target> |
| `cli.zig` | <fill> | <fill> |
| `Config.zig` | <fill> | <fill> |
| `mcp.zig` | <fill> | <fill — relevant to our M6 obsolescence question> |
| `cookies.zig` | <fill> | <fill — relevant to v0.2 auth pillar> |
| (others as relevant) | <fill> | <fill> |

### Subdirectories

| Directory | Top-level contents | Apparent purpose |
|---|---|---|
| `src/browser/` | <fill> | <fill> |
| `src/cdp/` | <fill> | <fill> |
| `src/mcp/` | <fill> | <fill> |
| `src/network/` | <fill> | <fill> |
| `src/storage/` | <fill> | <fill> |
| `src/data/` | <fill> | <fill> |
| `src/sys/` | <fill> | <fill> |
| `src/html5ever/` | <fill> | <fill — is this a binding to Servo's html5ever?> |
| `src/telemetry/` | <fill> | <fill> |
| `vendor/` | <fill> | <fill — what's vendored?> |

### Observations

<2-3 sentences on anything surprising — modules that are bigger than expected, modules that overlap with our planned patches, modules whose presence changes our planning>
````

Fill in all angle-bracket placeholders.

- [ ] **Step 4: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md
git commit -m "spike(m2): map lightpanda upstream source layout"
```

---

### Task 3: Audit `SemanticTree.zig` (highest priority — this determines spec Section 5.1 viability)

**Goal:** Read `src/SemanticTree.zig` and any files it imports/exports to determine *exactly* what semantic information lightpanda exposes. This is the single most important audit task because spec Section 5.1's `stable_id = blake3(role, name_norm, landmark_path, ordinal, context_window)` depends on every one of those fields being available.

**Files:**
- Modify: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md` (append "SemanticTree Audit" section)

- [ ] **Step 1: Read the full source of SemanticTree.zig**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
cat engine/upstream/src/SemanticTree.zig | wc -l
cat engine/upstream/src/SemanticTree.zig
```

Read it completely. Take notes on:
- The data structure(s) defined (struct types, fields, methods)
- Any public functions for building/walking the tree
- How elements are identified (by ID? pointer? handle?)
- What semantic attributes are available per node (role? accessible_name? state? landmark? ordinal?)
- How it's connected to the DOM module (likely in `src/browser/`)
- How it's exposed via CDP (likely in `src/cdp/`)

- [ ] **Step 2: Cross-reference with WAI-ARIA accessible-name spec needs**

The spec's stable-ID algorithm requires the *computed accessible name* per WAI-ARIA (precedence: `aria-labelledby` > `aria-label` > textContent > `placeholder` > `title`). Check whether SemanticTree (or related code) computes this or just exposes raw attributes. Search for accessible-name-related code:

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
rg -i 'accessible.?name|aria.?label|computed_name|accname' src/ | head -30
```

If you find a function like `computeAccessibleName` or similar, read it in full. If you find NO accessible-name computation, that's a critical gap — spec Section 5.1 step "Accessible name" cannot be implemented as-is.

- [ ] **Step 3: Cross-reference with ARIA landmark roles**

Check whether landmark roles (`main`, `navigation`, `search`, `form`, `dialog`, `banner`, `contentinfo`, `region`, `complementary`) are recognized:

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
rg -i 'landmark|"main"|"navigation"|"contentinfo"' src/ | head -30
```

The spec needs `landmark_path` — the chain of ARIA landmarks from root to element. If landmark roles aren't tracked at all, our stable-ID computation must either add this layer ourselves or descope.

- [ ] **Step 4: Append "SemanticTree Audit" section**

````markdown

## 3. SemanticTree Audit (spec §5.1 viability)

### File stats
- `src/SemanticTree.zig`: <line count> lines
- Other related files: <list, e.g., `src/browser/dom/*`>

### Data shape (what each semantic-tree node carries)

| Spec §5.1 requirement | Available in upstream? | Notes |
|---|---|---|
| Role | <yes/no/partial> | <which roles? full ARIA role set or a subset?> |
| Accessible name (WAI-ARIA computed) | <yes/no/partial> | <which precedence rules?> |
| Landmark path | <yes/no/partial> | <are landmarks tagged? is the path constructed?> |
| Ordinal (position among siblings of same role in landmark) | <yes/no/partial> | <derivable from existing structure?> |
| Context window (5 words before + 5 after) | <yes/no/partial> | <is text node order preserved?> |
| State (enabled, visible, checked, etc.) | <yes/no/partial> | <what states are tracked?> |
| Bounding rect (for click coordinates) | <yes/no/partial> | <is layout computed without paint?> |

### Public API surface

<List the public functions / types from SemanticTree.zig and anything reachable from CDP. Quote the function signatures exactly.>

### Gaps for spec §5.1

<For each "no" or "partial" above, explain what we'd need to add. This feeds directly into the DECISION.md path selection.>

### Verdict

<One of:>
- ✅ **Sufficient as-is** — full stable-ID hashing per spec §5.1 is implementable without upstream patches.
- ⚠️ **Partial** — descope to a smaller stable-ID surface (e.g., `role + accessible_name + raw_xpath`). Specify which fields drop.
- ❌ **Insufficient** — must add accessible-name computation / landmark tracking ourselves before stable-ID is possible. Estimate complexity.
````

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md
git commit -m "spike(m2): audit SemanticTree.zig vs spec §5.1 stable-ID needs"
```

---

### Task 4: Audit CDP domain coverage (spec §4 + §5.2)

**Goal:** Determine which Chrome DevTools Protocol domains and methods lightpanda already implements, with focus on the ones our orchestrator and snapshot-emission patches depend on.

**Files:**
- Modify: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md` (append "CDP Coverage" section)

- [ ] **Step 1: Survey the cdp/ directory**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream/src/cdp
ls
echo "=== File line counts ==="
wc -l *.zig 2>/dev/null | sort -rn
```

Each file likely corresponds to one CDP domain (Page.zig, DOM.zig, Runtime.zig, Network.zig, Input.zig, Accessibility.zig, …) or to support infrastructure.

- [ ] **Step 2: For each CDP domain we depend on, list implemented methods**

Spec §4 calls out these required CDP domains (orchestrator → engine boundary): `Page`, `DOM`, `Runtime`, `Network`, `Input`, plus our planned custom domains `Snapshot` and `SemanticId`. Plus `Accessibility` is relevant for stable-ID work.

For each, read the file and list method handlers. A typical pattern in CDP server code is a method dispatcher with explicit case branches per CDP method name. Look for strings like `"Page.navigate"`, `"DOM.getDocument"`, `"Input.dispatchMouseEvent"`, etc.

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
rg 'method.*"(Page|DOM|Runtime|Network|Input|Accessibility|Snapshot|SemanticId)\.' src/cdp/ -o | sort -u | head -50
```

- [ ] **Step 3: Look for an Accessibility domain specifically**

Spec §5.1's stable-ID work depends on accessibility tree exposure. CDP has a standard `Accessibility` domain (`Accessibility.getFullAXTree`, `Accessibility.getPartialAXTree`, `Accessibility.queryAXTree`). Check if lightpanda implements any of these:

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
rg '"Accessibility\.' src/ | head
ls src/cdp/ | grep -i acc
```

- [ ] **Step 4: Check for snapshot-related CDP methods**

The spec proposes a custom `Snapshot` CDP domain. CDP also has standard methods like `DOMSnapshot.captureSnapshot` and `Page.captureSnapshot`. Check if these are upstreamed:

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
rg '"(DOMSnapshot|Page\.captureSnapshot|Snapshot\.)' src/ | head
```

- [ ] **Step 5: Append "CDP Coverage" section**

````markdown

## 4. CDP Coverage (spec §4 transport boundary)

### Files in `src/cdp/`

| File | LOC | Domain handled |
|---|---|---|
| <each .zig file> | <LOC> | <domain name e.g. Page/DOM/Runtime/etc.> |

### Domain-by-domain coverage table

| CDP Domain | Spec §4 dependency | Upstream implementation | Methods implemented | Methods stubbed | Methods missing |
|---|---|---|---|---|---|
| `Page` | Required (navigation, lifecycle) | <yes/partial/no> | <list> | <list> | <list> |
| `DOM` | Required (read DOM state) | <yes/partial/no> | <list> | <list> | <list> |
| `Runtime` | Required (JS evaluation) | <yes/partial/no> | <list> | <list> | <list> |
| `Network` | Required (cookies/headers) | <yes/partial/no> | <list> | <list> | <list> |
| `Input` | Required (click/type/key) | <yes/partial/no> | <list> | <list> | <list> |
| `Accessibility` | Helpful for §5.1 stable-IDs | <yes/partial/no> | <list> | <list> | <list> |
| `DOMSnapshot` | Helpful for §5.2 snapshots | <yes/partial/no> | <list> | <list> | <list> |
| `Snapshot` (custom in spec) | Spec'd as our addition | n/a (custom) | — | — | — |
| `SemanticId` (custom in spec) | Spec'd as our addition | n/a (custom) | — | — | — |

### Verdict

<Pick one:>
- ✅ **All required CDP coverage exists in upstream** — orchestrator can be wired directly to existing methods; our custom `Snapshot`/`SemanticId` domains may not even be necessary (a built-in `Accessibility.getFullAXTree` may be sufficient).
- ⚠️ **Most coverage exists but some methods are stubs** — list the stubs.
- ❌ **Missing coverage for required ops** — list and estimate.
````

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md
git commit -m "spike(m2): audit CDP domain coverage in upstream"
```

---

### Task 5: Audit snapshot facilities (spec §5.2)

**Goal:** Determine what snapshot-producing code already exists in lightpanda. `main_snapshot_creator.zig` is a strong signal that a snapshot binary already ships; understand what it produces and how its output compares to our planned JSON-LD format.

**Files:**
- Modify: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md` (append "Snapshot Facilities" section)

- [ ] **Step 1: Read main_snapshot_creator.zig in full**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
cat engine/upstream/src/main_snapshot_creator.zig
```

Understand: what does this binary do? Does it take a URL and emit a snapshot file? What format (JSON, JSON-LD, custom)? What semantic depth (DOM only, or includes accessibility)?

- [ ] **Step 2: Try running the snapshot creator binary (if Task 1's build succeeded)**

If `zig-out/bin/lightpanda_snapshot_creator` (or similar) was produced:

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
ls zig-out/bin/
# Try with --help first
./zig-out/bin/lightpanda_snapshot_creator --help 2>&1 | head
# Or whatever the actual binary is named
```

If a help message is available, capture it. Then try a minimal invocation against a known URL like `https://example.com`:

```sh
./zig-out/bin/lightpanda_snapshot_creator https://example.com 2>&1 | head -100
# Capture the output to a file
./zig-out/bin/lightpanda_snapshot_creator https://example.com > /tmp/snapshot-example.json 2>&1
wc -l /tmp/snapshot-example.json
head -50 /tmp/snapshot-example.json
```

(Adjust the invocation pattern based on whatever help/usage text the binary emits.)

If the build failed in Task 1, skip this step and document "snapshot binary not run due to build failure."

- [ ] **Step 3: Compare upstream snapshot format to spec §5.2 JSON-LD format**

The spec §5.2 specifies:

```json
{ "i": "btn:abc123", "r": "button", "n": "Submit Application",
  "s": ["e","v"], "b": [432, 1240, 120, 40] }
```

Compare to what main_snapshot_creator actually emits. Note the schema differences (key names, nesting, whether stable_ids exist, whether bounding boxes are included, whether state flags exist).

- [ ] **Step 4: Look for mutation observers / diff capabilities**

Spec §5.2 step 5 calls for diff emission via a mutation observer. Check upstream:

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
rg -i 'mutation.?observer|MutationObserver|mutation_record|domchange' src/ | head -30
```

- [ ] **Step 5: Append "Snapshot Facilities" section**

````markdown

## 5. Snapshot Facilities (spec §5.2)

### Existing snapshot binary

- **Binary:** `<path, e.g., zig-out/bin/lightpanda_snapshot_creator>` (or "not built" if Task 1 build failed)
- **Invocation pattern:** `<from --help output>`
- **Output format:** <JSON / JSON-LD / custom>
- **Example output size on example.com:** <bytes> (raw), <bytes> brotli'd (estimate)
- **Schema sample (first 50 lines of /tmp/snapshot-example.json):**

```
<paste>
```

### Spec §5.2 alignment

| Spec §5.2 element | Present in upstream snapshot? | Notes |
|---|---|---|
| Stable IDs per element | <yes/no> | <details> |
| Role per element | <yes/no> | <details> |
| Accessible name | <yes/no> | <details> |
| State flags (enabled/visible/etc) | <yes/no> | <details> |
| Bounding rect | <yes/no> | <details> |
| Diff emission (incremental) | <yes/no> | <details> |
| Text content (preserved in full) | <yes/no> | <details> |

### Mutation observer / DOM change tracking

<What exists in upstream for tracking DOM mutations? Is there a public API or just internal?>

### Verdict

<Pick one:>
- ✅ **Upstream snapshot facility is fit for purpose** — our `Snapshot` CDP domain may be unnecessary; we can use upstream's directly with minor format adaptation in orchestrator.
- ⚠️ **Format diverges but data is there** — we need a thin adapter layer (orchestrator-side, not engine patch) to reshape upstream snapshots into our JSON-LD format.
- ❌ **Snapshot facility lacks required data** — list missing data and complexity of adding.
````

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md
git commit -m "spike(m2): audit snapshot facilities vs spec §5.2"
```

---

### Task 6: Audit MCP, cookies, and ancillary facilities (forward-looking)

**Goal:** Quick audit of facilities that affect *future* milestones (M6 MCP, v0.2 auth, etc.). This is not blocking for Plan #3 but flagging it now prevents us from re-doing work in M6.

**Files:**
- Modify: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md` (append "Ancillary Audit" section)

- [ ] **Step 1: Audit upstream MCP support**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
cat engine/upstream/src/mcp.zig | head -100
ls engine/upstream/src/mcp/
```

Read enough to answer:
- Does upstream lightpanda ship an MCP server? If so, what tools does it expose?
- Does our planned `@husk/mcp` bridge become obsolete?
- If upstream MCP exists but doesn't expose the watchdog, do we still need to build a bridge that wraps engine MCP + orchestrator policy?

- [ ] **Step 2: Audit cookies/storage facilities (relevant for v0.2 auth pillar)**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
cat engine/upstream/src/cookies.zig | head -50
ls engine/upstream/src/storage/
```

Quick read on what's available — full audit is a v0.2 concern but flagging now.

- [ ] **Step 3: Look for any prior-art on "watchdog"-like safety hooks**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream
rg -i 'watchdog|sanity.?check|policy|allowlist|denylist|forbidden' src/ | head
```

The orchestrator's watchdog (spec §5.3) is intentionally in the orchestrator, not the engine. But if upstream has similar concepts already, we might align names or even contribute back.

- [ ] **Step 4: Append "Ancillary Audit" section**

````markdown

## 6. Ancillary Audit (forward-looking)

### Upstream MCP support

- `src/mcp.zig` LOC: <fill>
- `src/mcp/` contents: <fill>
- Exposes a server? <yes/no, with what tools/methods?>
- **Impact on our M6:** <one of:>
  - ✅ Upstream MCP is sufficient and exposes everything an agent needs — our `@husk/mcp` package becomes a thin re-export or is dropped entirely.
  - ⚠️ Upstream MCP exists but misses watchdog integration — we still need a bridge but it's smaller than originally planned.
  - ❌ Upstream MCP doesn't fit our orchestrator's protocol — we build our own as planned.

### Cookies / storage

- `src/cookies.zig` shape: <brief>
- `src/storage/` modules: <list>
- **Impact on our v0.2 auth pillar:** <brief>

### Prior-art on safety / policy

<List any matches from rg search. Most likely zero or small. Note for future cross-reference.>
````

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md
git commit -m "spike(m2): audit ancillary facilities (MCP, cookies, safety)"
```

---

### Task 7: Build a working proof-of-concept

**Goal:** Demonstrate end-to-end that we can drive lightpanda from a small Zig program and extract *something* semantic about a page. This is the working-software deliverable of the spike. It does not have to match the final spec design — it just has to prove "we can drive the engine and get meaningful semantic data back."

**Files:**
- Create: `engine/spike/README.md`
- Create: `engine/spike/fixture.html`
- Create: `engine/spike/snapshot-poc.zig`
- Modify: `.gitignore` (add `engine/spike/.scratch/`)

- [ ] **Step 1: Create the spike directory and fixture HTML**

```sh
mkdir -p /Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch
```

Create `/Users/nirmalghinaiya/Desktop/husk/engine/spike/fixture.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Husk M2 Spike Fixture</title>
</head>
<body>
  <header role="banner">
    <h1>Husk Spike Fixture Page</h1>
  </header>
  <nav role="navigation" aria-label="Main">
    <a href="#section1">Section 1</a>
    <a href="#section2">Section 2</a>
  </nav>
  <main role="main">
    <section id="section1">
      <h2>Form Demo</h2>
      <form>
        <label for="username">Username</label>
        <input id="username" type="text" placeholder="Enter username">

        <label for="email">Email</label>
        <input id="email" type="email" placeholder="you@example.com">

        <label>
          <input type="checkbox" id="agree"> I agree to the terms
        </label>

        <button type="submit">Submit Application</button>
        <button type="button" disabled>Disabled Button</button>
      </form>
    </section>

    <section id="section2">
      <h2>Article Text</h2>
      <p>Albert Einstein was a German-born theoretical physicist. He developed the theory of relativity, one of the two pillars of modern physics.</p>
      <p>His mass-energy equivalence formula, E = mc^2, is one of the most famous equations in science.</p>
    </section>
  </main>
  <footer role="contentinfo">
    <p>Spike fixture — not a real page.</p>
  </footer>
</body>
</html>
```

This fixture exercises: a `<header role=banner>`, a `<nav>` with two links, a `<main>` with a form containing two labeled inputs, a checkbox, an enabled submit button, a disabled button, an article-like text section, and a `<footer role=contentinfo>`. Plenty to test a11y extraction against.

- [ ] **Step 2: Create the spike README.md explaining throwaway scope**

`/Users/nirmalghinaiya/Desktop/husk/engine/spike/README.md`:

```markdown
# engine/spike/

**THROWAWAY DIRECTORY** — this code exists only to support the M2 spike
([plan](../../docs/superpowers/plans/2026-05-14-husk-m2-spike-lightpanda-audit.md),
[report](../../docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md)).

Once Plan #3 (the real M2 engine patches) lands, this directory will be
deleted or restructured. Do not depend on any file here for production
work.

## Contents

- `fixture.html` — a static test page used by the proof-of-concept
- `snapshot-poc.zig` — minimal Zig program that drives lightpanda
  against `fixture.html` and prints what semantic info we can extract
- `.scratch/` — gitignored scratch space (build artifacts, captured
  outputs, etc.)

## Running

The exact invocation depends on what we discover about lightpanda's
public Zig API during the spike. See `snapshot-poc.zig`'s top comment
for the current state.
```

- [ ] **Step 3: Add gitignore entry for the scratch dir**

Modify `/Users/nirmalghinaiya/Desktop/husk/.gitignore` — append at the end:

```
# M2 spike scratch (build artifacts, captured outputs)
engine/spike/.scratch/
```

- [ ] **Step 4: Write the proof-of-concept Zig program**

Create `/Users/nirmalghinaiya/Desktop/husk/engine/spike/snapshot-poc.zig`. The exact API to use depends entirely on what Tasks 2-5 revealed about lightpanda's public Zig surface. There are three possible shapes; pick whichever matches reality:

**Shape A — if lightpanda exposes a programmatic Zig API:**

```zig
// snapshot-poc.zig — M2 spike proof-of-concept.
//
// Goal: load engine/spike/fixture.html in a lightpanda browser context
// and print whatever semantic info we can extract (a11y tree, DOM
// outline, etc). The exact output shape is intentionally loose — this
// is exploration, not the final design.
//
// Usage: zig run snapshot-poc.zig
//
// Adjust the imports below to match the upstream public Zig API
// discovered during Tasks 2-5. The pattern that works in upstream's
// own tests should work here too.

const std = @import("std");
const lightpanda = @import("lightpanda"); // adjust to actual import name

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const fixture_path = "engine/spike/fixture.html";
    const fixture_url = try std.fmt.allocPrint(allocator, "file://{s}", .{fixture_path});
    defer allocator.free(fixture_url);

    // Replace with the actual init pattern from upstream's tests.
    var browser = try lightpanda.Browser.init(allocator, .{});
    defer browser.deinit();

    try browser.navigate(fixture_url);
    try browser.waitForLoad();

    // Whatever the actual a11y / semantic tree API is — call it here.
    const tree = try browser.getSemanticTree();
    try std.json.stringify(tree, .{ .whitespace = .indent_2 }, std.io.getStdOut().writer());
}
```

**Shape B — if lightpanda only exposes a CLI binary, use that binary as a subprocess:**

Skip writing Zig code, instead make `snapshot-poc.zig` a shell-like driver that invokes `zig-out/bin/lightpanda_snapshot_creator file://engine/spike/fixture.html` and pretty-prints the output. Or just write a `snapshot-poc.sh`:

```sh
#!/bin/bash
set -e
cd "$(dirname "$0")/../.."
BIN=engine/upstream/zig-out/bin/lightpanda_snapshot_creator  # adjust to actual
FIXTURE="$(pwd)/engine/spike/fixture.html"
$BIN "file://$FIXTURE" | head -200
```

**Shape C — if lightpanda only runs CDP via WebSocket:**

Write a small Node script `snapshot-poc.mjs` that starts `lightpanda` (which presumably opens a CDP port), connects via `chrome-remote-interface` or raw WebSocket, sends a few CDP method calls, and prints the responses.

Pick whichever shape matches what you found in Tasks 2-5 and write the PoC accordingly. **You must produce at least *some* working PoC** — even if it's "navigate to URL and print HTML" with no semantic processing, that proves the engine pipeline works end-to-end.

- [ ] **Step 5: Run the PoC and capture its output**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
# Run via whichever entry-point matches your Shape A/B/C choice
# Example for Shape A:
cd engine/spike && zig run snapshot-poc.zig
# Example for Shape B:
./engine/spike/snapshot-poc.sh
# Capture output to scratch for reference
./engine/spike/snapshot-poc.sh > engine/spike/.scratch/run-output.txt 2>&1
head -50 engine/spike/.scratch/run-output.txt
```

If the PoC fails to run (compilation errors, missing API, etc.), document the failure in detail in the next step's commit message and SPIKE-REPORT.md — this is itself a finding.

- [ ] **Step 6: Append a "Proof-of-Concept" section to SPIKE-REPORT.md**

````markdown

## 7. Proof-of-Concept Outcome

- **Shape chosen:** <A: programmatic Zig API / B: CLI subprocess / C: CDP WebSocket>
- **Reasoning:** <why this shape matched upstream's actual surface>
- **PoC file:** `engine/spike/snapshot-poc.zig` (or `.sh` / `.mjs`)
- **Did it run successfully?** <yes/no, with details>
- **First 30 lines of output:**

```
<paste>
```

- **What it demonstrates:** <one sentence>
- **What it does NOT demonstrate:** <list — e.g., "doesn't compute stable IDs, doesn't emit diff snapshots, doesn't include bounding rects">
````

- [ ] **Step 7: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add engine/spike/ .gitignore docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md
git commit -m "spike(m2): proof-of-concept driving lightpanda end-to-end"
```

---

### Task 8: Write DECISION.md (the spike verdict)

**Goal:** Synthesize Tasks 1-7's findings into one short, decisive document that locks Plan #3's scope to one of three pre-defined paths.

**Files:**
- Create: `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/DECISION.md`

- [ ] **Step 1: Re-read SPIKE-REPORT.md end-to-end with fresh eyes**

```sh
cat /Users/nirmalghinaiya/Desktop/husk/docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md
```

Focus on each section's "Verdict" line. The DECISION.md aggregates these.

- [ ] **Step 2: Create DECISION.md**

Pick exactly ONE of three paths. Be decisive — vague decisions force the human reader to re-do the analysis.

Path A — "Upstream is rich enough." Take this path if the SemanticTree audit was ✅ and the CDP/Snapshot audits were ✅ or ⚠️ with minor adapter work in orchestrator. Plan #3 becomes mostly orchestrator wiring, not engine patches.

Path B — "Upstream is partial; descope SemanticId to a smaller surface." Take this if SemanticTree audit was ⚠️ (some fields missing). Plan #3 builds the orchestrator + a thin engine patch for the missing fields. Stable IDs become `role + name + xpath` triples rather than full hashes.

Path C — "Upstream is insufficient; we must add accessibility builder ourselves." Take this if SemanticTree audit was ❌. Plan #3 grows into a multi-week engine patch project including computed accessible name + landmark tracking. Realistic v0 timeline extends to 12+ weeks.

Write `/Users/nirmalghinaiya/Desktop/husk/docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/DECISION.md`:

````markdown
# M2 Spike — Decision

**Date:** 2026-05-14
**Spike report:** [`./SPIKE-REPORT.md`](./SPIKE-REPORT.md)
**Plan that produced this:** [`docs/superpowers/plans/2026-05-14-husk-m2-spike-lightpanda-audit.md`](../../plans/2026-05-14-husk-m2-spike-lightpanda-audit.md)
**Next plan:** Plan #3 (M2 engine work) to be written immediately after this decision.

## Verdict

**Selected path:** <ONE of A, B, or C — fill in>

## Rationale

<3-5 sentences referencing specific sections of SPIKE-REPORT.md. Cite concrete file/line evidence where possible.>

## Implications for Plan #3 (M2 engine patches)

- **Scope:** <what Plan #3 will and will not include given this decision>
- **Estimated duration:** <weeks>
- **Tasks anticipated:** <bullet list of the major M2 work units — this becomes the skeleton for Plan #3>
- **Spec sections affected:** <list spec §s that need amendment if any, and how>

## Knock-on effects

- **M6 (MCP package):** <does upstream MCP obsolete our `@husk/mcp` plans? if yes, Plan #6 shrinks>
- **v0.2 (auth pillar):** <does upstream cookies.zig give us a head start?>
- **v0 timeline:** <does this push the v0 ship date out, in, or unchanged?>

## Open questions for the human reader

<Any decisions the controller (human or AI) needs to make before Plan #3 can be written. Default: empty if the spike was conclusive.>

## Spec amendments required

<If any spec §s need updating to reflect spike findings, list them with the proposed edit. Default: empty if no amendments needed.>
````

Fill in every angle-bracket placeholder. Be decisive — DECISION.md is the spike's output to the rest of the project. Vague language here means the spike didn't actually decide anything.

- [ ] **Step 3: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/DECISION.md
git commit -m "spike(m2): lock decision — <path A/B/C summary>"
```

(Substitute the path summary into the commit message — for example, `spike(m2): lock decision — Path A: upstream rich enough, Plan #3 is orchestrator wiring`.)

---

### Task 9: Tag the spike completion and prepare for Plan #3

**Goal:** Mark the spike as complete in git, summarize the findings to the controller, and indicate what Plan #3 will contain.

- [ ] **Step 1: Verify all artifacts are present**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
ls -la docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/
ls -la engine/spike/
git log --oneline m1-foundation..HEAD  # show only spike commits if m1-foundation was tagged
```

Expected:
- `SPIKE-REPORT.md` exists and is non-trivial (>200 lines after Tasks 1-7 appended their sections)
- `DECISION.md` exists with verdict locked
- `engine/spike/fixture.html`, `snapshot-poc.zig` (or `.sh` / `.mjs`), `README.md` exist
- 7-8 spike commits in git log

- [ ] **Step 2: Re-run the M1 test suite to confirm no regression**

The spike should NOT have broken anything in the main repo. Verify:

```sh
cd /Users/nirmalghinaiya/Desktop/husk
make test
```

Expected: 11/11 tests pass (same as M1's Definition of Done). If any test fails, that's a regression introduced by the spike — investigate and fix before tagging.

- [ ] **Step 3: Tag the spike completion**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git tag -a v0.0.1-m2-spike -m "M2 spike complete — lightpanda audit; see docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/DECISION.md"
```

- [ ] **Step 4: Print summary for the controller**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
echo "=== Spike commits ==="
git log --oneline m1-foundation..HEAD 2>/dev/null || git log --oneline -10
echo ""
echo "=== DECISION ==="
cat docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/DECISION.md
echo ""
echo "=== Next ==="
echo "Plan #3 (M2 real engine work) to be written next, sized against the locked decision."
```

The controller (human or AI orchestrator) reads the output and routes to Plan #3 authoring.

---

## Spike Definition of Done

- [ ] `SPIKE-REPORT.md` has all 7 sections filled in (Build, Source Map, SemanticTree, CDP, Snapshot, Ancillary, PoC) with no `<fill>` placeholders remaining
- [ ] `DECISION.md` has an explicit Path A / B / C verdict and a concrete "Plan #3 scope" paragraph
- [ ] At least one PoC executable artifact runs (Zig program, shell driver, or Node script) and produces *some* output from the fixture HTML
- [ ] `make test` from M1 still passes 11/11 (no regression)
- [ ] All work committed on branch `m2-spike` (8-9 commits total)
- [ ] Tag `v0.0.1-m2-spike` created
- [ ] No production code in `orchestrator/`, `sdk-ts/`, `sdk-py/`, or `mcp/` has been touched (this is a pure-investigation spike)

If any DoD checkbox fails, the spike is not complete; address the gap before treating it as ready for Plan #3.

---

## What's NOT in this spike (explicitly out of scope)

- Writing the actual M2 engine patches (`Snapshot` CDP domain, `SemanticId` CDP domain, mutation observer aggregator, a11y tree hooks) — those land in Plan #3
- Modifying upstream lightpanda source — this is a read-only audit
- Implementing the orchestrator's CDP client (Plan #4)
- Writing the snapshot decoder/diff applier in orchestrator (Plan #4)
- Spec amendments — if the spike reveals spec changes are needed, DECISION.md flags them but does not edit the spec; the controller commits spec edits separately

When this spike ships, the next plan is **Plan #3 (M2 engine work)** — written against the locked decision. If Path A or B is chosen, Plan #3 will be relatively short. If Path C is chosen, Plan #3 will be longer and may itself be split into sub-plans.
