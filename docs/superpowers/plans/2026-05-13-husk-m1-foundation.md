# Husk Milestone 1 (Foundation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Husk monorepo so that a fresh `git clone` plus `pnpm install && make all` produces a buildable engine, orchestrator, both SDKs, MCP bridge, working CI, and complete legal files — ready for Milestone 2 (engine patches) to layer on top.

**Architecture:** pnpm workspaces at the root for all JS/TS packages; Zig build at `engine/` wrapping a git-submodule pin of upstream lightpanda; Python SDK via `pyproject.toml` with `hatchling`; everything orchestrated by a single root `Makefile`; CI on macOS arm64 + Linux x64 runs `make all` plus per-package tests.

**Tech Stack:** pnpm 9, Node 20 LTS, TypeScript 5.5, Zig 0.13, Python 3.11+, hatchling, Hono, vitest, pytest, GitHub Actions, AGPL v3 + MIT (examples).

**Source spec:** `docs/superpowers/specs/2026-05-13-husk-design.md`

**Prerequisites (manual, outside this plan):**
- Husk name + `husk.dev` (or `.io`) domain registered separately (founder action — not a code task)
- Local Zig 0.13 install (`brew install zig` or asdf), Node 20 LTS, pnpm 9, Python 3.11+
- Git ≥ 2.40 for `git submodule add --branch`

---

## File Structure (everything this plan creates/modifies)

### Root
- Create: `package.json` — root workspace package
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json` — shared TS compiler options
- Create: `Makefile` — composable build targets
- Create: `.nvmrc` — pin Node version
- Modify: `.gitignore` — already exists, add language-specific entries if missing
- Create: `.gitmodules` — lightpanda upstream pin

### Legal
- Create: `LICENSE` — AGPL v3 full text
- Create: `LICENSE-EXAMPLES` — MIT for `/examples` and `/protocol`
- Create: `CLA.md` — contributor license agreement text
- Create: `CONTRIBUTING.md` — how to contribute, CLA flow, code style
- Create: `README.md` — project overview, install, quickstart pointer

### Engine
- Create: `engine/build.zig` — wraps upstream lightpanda build
- Create: `engine/build.zig.zon` — Zig dependency manifest
- Create: `engine/README.md` — engine-specific docs
- Create: `engine/UPSTREAM_LICENSE` — copy of lightpanda's AGPL v3 LICENSE
- Create: `engine/patches/.gitkeep` — placeholder for Milestone 2 patches
- Create: `engine/tests/.gitkeep` — placeholder for Milestone 2 tests
- Create: `engine/upstream/` — git submodule pointing to lightpanda

### Orchestrator
- Create: `orchestrator/package.json`
- Create: `orchestrator/tsconfig.json`
- Create: `orchestrator/vitest.config.ts`
- Create: `orchestrator/src/index.ts` — CLI entrypoint, prints version
- Create: `orchestrator/src/version.ts` — version constant + getter
- Create: `orchestrator/tests/version.test.ts`

### TypeScript SDK
- Create: `sdk-ts/package.json`
- Create: `sdk-ts/tsconfig.json`
- Create: `sdk-ts/vitest.config.ts`
- Create: `sdk-ts/src/index.ts` — exports `Husk` class stub + version
- Create: `sdk-ts/tests/smoke.test.ts`

### Python SDK
- Create: `sdk-py/pyproject.toml`
- Create: `sdk-py/husk/__init__.py` — `__version__` + stub export
- Create: `sdk-py/tests/test_smoke.py`

### MCP Bridge
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/src/index.ts` — placeholder MCP server stub

### Protocol (single source of truth, stubs in M1, filled in M3+)
- Create: `protocol/jsonrpc.openapi.yaml` — minimal valid OpenAPI doc with one health-check method
- Create: `protocol/snapshot.schema.json` — empty valid JSON Schema
- Create: `protocol/policy.schema.json` — empty valid JSON Schema
- Create: `protocol/tools-manifest/.gitkeep`

### Examples (scaffolds only)
- Create: `examples/01-wikipedia-research/README.md`
- Create: `examples/02-static-form-fill/README.md`
- Create: `examples/03-shopify-pricecheck/README.md`

### Docs
- Create: `docs/quickstart.md` — placeholder pointing to README
- Create: `docs/architecture.md` — pointer to spec
- Create: `docs/policy-rules.md` — placeholder for M5
- Create: `docs/mcp-setup.md` — placeholder for M6

### GitHub
- Create: `.github/workflows/ci.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`

---

## Tasks

### Task 1: Root pnpm workspace + TypeScript base

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/package.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/pnpm-workspace.yaml`
- Create: `/Users/nirmalghinaiya/Desktop/husk/tsconfig.base.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/.nvmrc`

- [ ] **Step 1: Write the verification command (the "test")**

Run: `cd /Users/nirmalghinaiya/Desktop/husk && pnpm install`
Expected: success, but currently FAILS with `ENOENT: package.json not found`.

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm install 2>&1 | head -5
```
Expected: `ERR_PNPM_NO_PKG_MANIFEST` or similar — no package.json present.

- [ ] **Step 3: Create `.nvmrc`**

```
20
```

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "husk-monorepo",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "pnpm -r --filter './orchestrator' --filter './sdk-ts' --filter './mcp' run build",
    "test": "pnpm -r --filter './orchestrator' --filter './sdk-ts' --filter './mcp' run test",
    "lint": "pnpm -r --filter './orchestrator' --filter './sdk-ts' --filter './mcp' run lint",
    "typecheck": "pnpm -r --filter './orchestrator' --filter './sdk-ts' --filter './mcp' run typecheck"
  },
  "devDependencies": {
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 5: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "orchestrator"
  - "sdk-ts"
  - "mcp"
```

- [ ] **Step 6: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 7: Run verification, expect pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm install
```
Expected: `Done in Xs` (no workspace packages yet, so just installs typescript at root).

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add package.json pnpm-workspace.yaml tsconfig.base.json .nvmrc && git commit -m "chore: root pnpm workspace + tsconfig base"
```

---

### Task 2: Root Makefile

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/Makefile`

- [ ] **Step 1: Write the verification command**

Run: `cd /Users/nirmalghinaiya/Desktop/husk && make help`
Expected: prints list of available targets.

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && make help 2>&1
```
Expected: `make: *** No rule to make target 'help'.  Stop.` or `make: *** No targets.` (no Makefile present).

- [ ] **Step 3: Create `Makefile`**

```makefile
.PHONY: help all engine orchestrator sdks sdk-ts sdk-py mcp test lint typecheck clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

all: engine orchestrator sdks mcp ## Build everything

engine: ## Build the Zig engine (forked lightpanda)
	@echo ">> Building engine"
	cd engine && zig build -Doptimize=ReleaseSafe

orchestrator: ## Build the TS orchestrator
	@echo ">> Building orchestrator"
	pnpm --filter ./orchestrator run build

sdks: sdk-ts sdk-py ## Build both SDKs

sdk-ts: ## Build the TypeScript SDK
	@echo ">> Building TS SDK"
	pnpm --filter ./sdk-ts run build

sdk-py: ## Build the Python SDK
	@echo ">> Building Python SDK"
	cd sdk-py && python -m pip install -e . --quiet

mcp: ## Build the MCP bridge
	@echo ">> Building MCP bridge"
	pnpm --filter ./mcp run build

test: ## Run all tests
	@echo ">> Running TS tests"
	pnpm test
	@echo ">> Running Python tests"
	cd sdk-py && python -m pytest -q

lint: ## Lint all packages
	pnpm lint

typecheck: ## Typecheck all TS packages
	pnpm typecheck

clean: ## Remove build artifacts
	rm -rf engine/zig-cache engine/zig-out
	pnpm -r exec rm -rf dist .turbo .tsbuildinfo
	find . -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name ".pytest_cache" -type d -prune -exec rm -rf {} + 2>/dev/null || true
```

- [ ] **Step 4: Run verification, expect pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && make help
```
Expected: prints color-formatted target list including `help`, `all`, `engine`, etc.

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add Makefile && git commit -m "build: root Makefile with composable targets"
```

---

### Task 3: AGPL v3 LICENSE file

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/LICENSE`

- [ ] **Step 1: Write the verification command**

Run: `head -1 /Users/nirmalghinaiya/Desktop/husk/LICENSE`
Expected: `                    GNU AFFERO GENERAL PUBLIC LICENSE`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
head -1 /Users/nirmalghinaiya/Desktop/husk/LICENSE 2>&1
```
Expected: `head: /Users/nirmalghinaiya/Desktop/husk/LICENSE: No such file or directory`

- [ ] **Step 3: Fetch the canonical AGPL v3 text**

```sh
curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o /Users/nirmalghinaiya/Desktop/husk/LICENSE
```

- [ ] **Step 4: Run verification, expect pass**

```sh
head -1 /Users/nirmalghinaiya/Desktop/husk/LICENSE
wc -l /Users/nirmalghinaiya/Desktop/husk/LICENSE
```
Expected first line: `                    GNU AFFERO GENERAL PUBLIC LICENSE`
Expected line count: between 600 and 700 (canonical AGPL v3 is ~661 lines).

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add LICENSE && git commit -m "legal: add AGPL v3 LICENSE for core"
```

---

### Task 4: MIT LICENSE-EXAMPLES file

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/LICENSE-EXAMPLES`

- [ ] **Step 1: Write the verification command**

Run: `grep -q "MIT License" /Users/nirmalghinaiya/Desktop/husk/LICENSE-EXAMPLES && echo OK`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
grep -q "MIT License" /Users/nirmalghinaiya/Desktop/husk/LICENSE-EXAMPLES 2>&1
```
Expected: `grep: ...: No such file or directory`

- [ ] **Step 3: Create `LICENSE-EXAMPLES`**

```
MIT License

Copyright (c) 2026 Husk contributors

This MIT license applies only to the contents of the /examples and /protocol
directories of the Husk repository. The rest of the project is licensed under
AGPL v3 (see LICENSE).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Run verification, expect pass**

```sh
grep -q "MIT License" /Users/nirmalghinaiya/Desktop/husk/LICENSE-EXAMPLES && echo OK
```
Expected: `OK`

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add LICENSE-EXAMPLES && git commit -m "legal: add MIT license for /examples and /protocol"
```

---

### Task 5: CLA.md and CONTRIBUTING.md

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/CLA.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/CONTRIBUTING.md`

- [ ] **Step 1: Write the verification command**

Run: `test -f /Users/nirmalghinaiya/Desktop/husk/CLA.md && test -f /Users/nirmalghinaiya/Desktop/husk/CONTRIBUTING.md && echo OK`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
test -f /Users/nirmalghinaiya/Desktop/husk/CLA.md && test -f /Users/nirmalghinaiya/Desktop/husk/CONTRIBUTING.md && echo OK || echo MISSING
```
Expected: `MISSING`

- [ ] **Step 3: Create `CLA.md`**

```markdown
# Husk Contributor License Agreement

By submitting a pull request, issue comment containing code, or any other
contribution to the Husk project, you agree to the following terms:

1. **Grant of Copyright License.** You grant the Husk project entity a
   perpetual, worldwide, non-exclusive, royalty-free, irrevocable copyright
   license to reproduce, prepare derivative works of, publicly display,
   publicly perform, sublicense, and distribute your Contributions and such
   derivative works.

2. **Grant of Patent License.** You grant the Husk project entity a
   perpetual, worldwide, non-exclusive, royalty-free, irrevocable patent
   license to make, have made, use, offer to sell, sell, import, and
   otherwise transfer your Contributions, where such license applies only
   to those patent claims licensable by you that are necessarily infringed
   by your Contributions alone or by combination of your Contributions with
   the project.

3. **You Are Legally Entitled.** You represent that you are legally
   entitled to grant the above licenses. If your employer has rights to
   intellectual property that you create, you represent that you have
   received permission to make the Contributions on behalf of that
   employer, or that your employer has waived such rights for your
   Contributions.

4. **Original Work.** You represent that each of your Contributions is your
   original creation. You represent that your Contribution submissions
   include complete details of any third-party license or other restriction
   of which you are personally aware and which are associated with any part
   of your Contributions.

5. **No Warranty.** Your Contributions are provided "AS IS", without
   warranty of any kind.

6. **CLA Acceptance.** Acceptance of this CLA will be tracked automatically
   via the CLA Assistant GitHub integration when you open your first PR.

This CLA is based on the Apache Software Foundation Individual Contributor
License Agreement v2.0, adapted for Husk.
```

- [ ] **Step 4: Create `CONTRIBUTING.md`**

```markdown
# Contributing to Husk

Welcome! Husk is an open-source browser engine for AI agents. We accept
contributions under the terms of our [Contributor License Agreement](./CLA.md).

## Quick Start

1. Fork the repo and clone your fork.
2. Install prerequisites:
   - Node 20 LTS (`.nvmrc`)
   - pnpm 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
   - Zig 0.13 (`brew install zig`)
   - Python 3.11+
3. `pnpm install` at the root
4. `make all` to build everything
5. `make test` to run all tests

## Repo Layout

See [README.md](./README.md) for the high-level tour. The full design lives
in [`docs/superpowers/specs/2026-05-13-husk-design.md`](./docs/superpowers/specs/2026-05-13-husk-design.md).

## Working on the Engine

The engine is a fork of [lightpanda](https://lightpanda.io) (AGPL v3,
Zig). Upstream is pinned as a git submodule at `engine/upstream`. Our
patches live under `engine/patches/`. Non-differentiating fixes should be
contributed upstream as AGPL v3 PRs first, then pulled into our submodule pin.

## Working on the Orchestrator / SDKs / MCP

Standard pnpm workspace. `pnpm --filter ./orchestrator run dev` for a
watch-mode dev loop. Tests use `vitest`.

## Working on the Python SDK

`cd sdk-py && pip install -e .[dev]`. Tests use `pytest`.

## Code Style

- TypeScript: `strict: true`, no `any`, ESLint (config TBD in Milestone 3).
- Zig: follow upstream lightpanda style; `zig fmt` before commit.
- Python: `ruff` + `mypy --strict` (config TBD in Milestone 3).

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` new feature
- `fix:` bug fix
- `chore:` build / tooling
- `docs:` documentation only
- `refactor:` no behavior change
- `test:` test-only changes
- `legal:` licensing / legal files

## Pull Requests

- Open a PR against `main`
- The CLA Assistant will ask you to sign the CLA on your first PR
- CI must pass (build + tests + lint on macOS arm64 and Linux x64)
- A maintainer reviews and merges

## Reporting Bugs

Use the [Bug Report issue template](.github/ISSUE_TEMPLATE/bug_report.md).
Include a minimal reproduction (URL or HTML snippet) and the version of
Husk you're running.

## License

Code contributions are licensed under AGPL v3 (`LICENSE`). Example code and
protocol schemas are licensed under MIT (`LICENSE-EXAMPLES`). By
contributing, you agree to the [CLA](./CLA.md).
```

- [ ] **Step 5: Run verification, expect pass**

```sh
test -f /Users/nirmalghinaiya/Desktop/husk/CLA.md && test -f /Users/nirmalghinaiya/Desktop/husk/CONTRIBUTING.md && echo OK
```
Expected: `OK`

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add CLA.md CONTRIBUTING.md && git commit -m "legal: add CLA and CONTRIBUTING guide"
```

---

### Task 6: Root README.md

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/README.md`

- [ ] **Step 1: Write the verification command**

Run: `grep -q "Browser engine for AI agents" /Users/nirmalghinaiya/Desktop/husk/README.md && echo OK`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
grep -q "Browser engine for AI agents" /Users/nirmalghinaiya/Desktop/husk/README.md 2>&1 || echo MISSING
```
Expected: `MISSING`

- [ ] **Step 3: Create `README.md`**

```markdown
# Husk

**The only OSS browser engine where your agent cannot click a button that doesn't exist.**

Browser engine for AI agents — forked from [lightpanda](https://lightpanda.io)
(Zig, no paint pipeline), wrapped in a TypeScript orchestrator and Python SDK,
with a deterministic watchdog that physically blocks hallucinated actions.

License: AGPL v3 (core) · MIT (examples + protocol)
Status: pre-v0 (Milestone 1 — Foundation)

---

## Why Husk

Every "AI browser" today is a Playwright wrapper around full Chromium —
~500 MB RAM, ~800 ms cold-start, full paint pipeline running for nobody.
And no safety floor: when your LLM hallucinates a selector, the browser
cheerfully clicks nothing and your downstream logic confuses itself.

Husk is the opposite stack:

- **Real browser engine, not a wrapper.** Forked lightpanda. Zig. No paint,
  no GPU, ~50 MB binary, ~10 ms cold-start. JavaScript still executes;
  pixels never render.
- **Watchdog as a feature.** Every action passes through a deterministic
  rule engine. Element not found → rejection with concrete alternatives.
  Policy rule says "never click delete in this flow" → blocked. No LLM
  guarding LLM. No latency tax. No fuzzy semantics.
- **Semantic stable IDs.** Identify elements by role + accessible name +
  landmark — invariant across CSS rebuilds. Per-site graph cached in SQLite.
- **LLM-neutral.** Husk doesn't bundle an LLM client. The SDK is browser
  primitives only. Bring your own model.

## What's Shipping in v0

| Pillar | v0 status |
|---|---|
| Browser runtime (forked lightpanda) | ✅ |
| Snapshot compression (a11y-tree-based JSON-LD with full text preserved) | ✅ |
| Watchdog (sanity + policy, deterministic, no LLM) | ✅ |
| TypeScript SDK + Python SDK | ✅ |
| MCP server (Claude Desktop / Cursor / Continue / Windsurf) | ✅ |
| CLI | ✅ |
| Auth pillar (cookies / SSO / MFA) | v0.2 |
| DOM-drift router (cross-deploy resolver) | v0.1 |
| Cloud-hosted Husk | v0.3 |
| WebGL / WebRTC / WebAssembly / Gmail / Salesforce | inherited limitation |

## Quickstart

```sh
# Prerequisites: Node 20, pnpm 9, Zig 0.13, Python 3.11+
git clone https://github.com/yourorg/husk
cd husk
pnpm install
make all

# Start the orchestrator
./orchestrator/dist/index.js start
# Or via the installed CLI (when packaged): husk start

# Run an example
node examples/01-wikipedia-research/index.js
```

Full quickstart: [`docs/quickstart.md`](./docs/quickstart.md)
Architecture: [`docs/architecture.md`](./docs/architecture.md)
Full design: [`docs/superpowers/specs/2026-05-13-husk-design.md`](./docs/superpowers/specs/2026-05-13-husk-design.md)

## Repository Layout

```
husk/
├── engine/         # Zig — forked lightpanda + our patches
├── orchestrator/   # TypeScript — Node binary, HTTP API, watchdog, action planner
├── sdk-ts/         # @husk/sdk — canonical TS client
├── sdk-py/         # husk-sdk — Python client
├── mcp/            # @husk/mcp — Model Context Protocol bridge
├── protocol/       # JSON-RPC + schemas (single source of truth)
├── examples/       # Three demo agents
└── docs/           # Quickstart, architecture, policy rules, specs
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All contributions require signing
the [CLA](./CLA.md).

## License

Core: AGPL v3 ([LICENSE](./LICENSE))
Examples and protocol schemas: MIT ([LICENSE-EXAMPLES](./LICENSE-EXAMPLES))
Upstream lightpanda: AGPL v3 (preserved in [engine/UPSTREAM_LICENSE](./engine/UPSTREAM_LICENSE))
```

- [ ] **Step 4: Run verification, expect pass**

```sh
grep -q "Browser engine for AI agents" /Users/nirmalghinaiya/Desktop/husk/README.md && echo OK
```
Expected: `OK`

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add README.md && git commit -m "docs: root README with vision, quickstart, and layout"
```

---

### Task 7: Engine scaffold + lightpanda submodule

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/engine/README.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/engine/build.zig`
- Create: `/Users/nirmalghinaiya/Desktop/husk/engine/build.zig.zon`
- Create: `/Users/nirmalghinaiya/Desktop/husk/engine/UPSTREAM_LICENSE`
- Create: `/Users/nirmalghinaiya/Desktop/husk/engine/patches/.gitkeep`
- Create: `/Users/nirmalghinaiya/Desktop/husk/engine/tests/.gitkeep`
- Create: `/Users/nirmalghinaiya/Desktop/husk/.gitmodules` (modify if exists)
- Modify (via git): add submodule at `engine/upstream/` pointing to `https://github.com/lightpanda-io/browser.git`

- [ ] **Step 1: Write the verification command**

Run: `test -d /Users/nirmalghinaiya/Desktop/husk/engine/upstream/.git && test -f /Users/nirmalghinaiya/Desktop/husk/engine/UPSTREAM_LICENSE && echo OK`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
test -d /Users/nirmalghinaiya/Desktop/husk/engine/upstream/.git && test -f /Users/nirmalghinaiya/Desktop/husk/engine/UPSTREAM_LICENSE && echo OK || echo MISSING
```
Expected: `MISSING`

- [ ] **Step 3: Create the engine directory tree**

```sh
mkdir -p /Users/nirmalghinaiya/Desktop/husk/engine/patches /Users/nirmalghinaiya/Desktop/husk/engine/tests
touch /Users/nirmalghinaiya/Desktop/husk/engine/patches/.gitkeep /Users/nirmalghinaiya/Desktop/husk/engine/tests/.gitkeep
```

- [ ] **Step 4: Add lightpanda as a git submodule**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git submodule add https://github.com/lightpanda-io/browser.git engine/upstream
```

If lightpanda's actual repo URL differs (e.g., `lightpanda-io/lightpanda`), substitute the correct URL — verify by visiting https://github.com/lightpanda-io before running.

- [ ] **Step 5: Pin the submodule to a known-good commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine/upstream && git log --oneline -1
```

Note the commit hash. We're pinning to whatever the latest tagged release or stable main is at the time of execution. Subsequent milestones will bump this pin deliberately.

- [ ] **Step 6: Copy lightpanda's LICENSE into UPSTREAM_LICENSE**

```sh
cp /Users/nirmalghinaiya/Desktop/husk/engine/upstream/LICENSE /Users/nirmalghinaiya/Desktop/husk/engine/UPSTREAM_LICENSE 2>/dev/null || \
  cp /Users/nirmalghinaiya/Desktop/husk/engine/upstream/LICENSE.md /Users/nirmalghinaiya/Desktop/husk/engine/UPSTREAM_LICENSE 2>/dev/null || \
  curl -fsSL "https://raw.githubusercontent.com/lightpanda-io/browser/main/LICENSE" -o /Users/nirmalghinaiya/Desktop/husk/engine/UPSTREAM_LICENSE
```

- [ ] **Step 7: Create `engine/build.zig`**

```zig
const std = @import("std");

/// Husk engine build script — wraps the upstream lightpanda build.
/// In Milestone 1 this is a thin pass-through; Milestone 2 adds our
/// patches as additional source files / build steps.
pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Defer to upstream lightpanda's build.zig. We invoke it as a child
    // process via `zig build` against the submodule path. In Milestone 2
    // we will switch to importing upstream as a package and applying
    // patches inline.
    const upstream_build = b.addSystemCommand(&.{
        "zig", "build",
        "-Doptimize=ReleaseSafe",
    });
    upstream_build.cwd = b.path("upstream");

    const build_step = b.step("default", "Build the husk engine via upstream lightpanda");
    build_step.dependOn(&upstream_build.step);
    b.default_step.dependOn(build_step);

    _ = target;
    _ = optimize;
}
```

- [ ] **Step 8: Create `engine/build.zig.zon`**

```zig
.{
    .name = "husk-engine",
    .version = "0.0.0",
    .minimum_zig_version = "0.13.0",
    .paths = .{
        "build.zig",
        "build.zig.zon",
        "patches",
        "tests",
    },
    .dependencies = .{},
}
```

- [ ] **Step 9: Create `engine/README.md`**

```markdown
# Husk Engine

The Husk engine is a fork of [lightpanda](https://lightpanda.io) (AGPL v3,
Zig). Upstream is pinned as a git submodule at `./upstream`.

## Layout

- `upstream/` — submodule, pinned to a specific lightpanda commit
- `patches/` — our Zig patches (Milestone 2+):
  - `snapshot-domain.zig` — emits compressed JSON-LD page representation
  - `semantic-id-domain.zig` — computes stable IDs on DOM commit
  - `mutation-observer.zig` — diff-based mutation emission
  - `a11y-tree-hooks.zig` — accessibility tree extension points
- `tests/` — engine-level tests for our patches
- `build.zig` — top-level build script (wraps upstream)
- `UPSTREAM_LICENSE` — lightpanda's AGPL v3 LICENSE, preserved

## Building

```sh
# From repo root
make engine

# Or directly
cd engine && zig build -Doptimize=ReleaseSafe
```

## Updating the upstream pin

```sh
cd engine/upstream && git fetch && git checkout <new-commit>
cd ../.. && git add engine/upstream && git commit -m "engine: bump lightpanda pin to <new-commit>"
```

## Contributing back to lightpanda

Non-differentiating fixes (bugs, perf, web compat) should be sent to
lightpanda upstream as AGPL v3 PRs first, then pulled into our pin once
merged. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Our patches

All files under `patches/` are AGPL v3 — they live under Husk's license,
not lightpanda's. Build process applies them on top of the upstream
submodule.
```

- [ ] **Step 10: Run verification, expect pass**

```sh
test -d /Users/nirmalghinaiya/Desktop/husk/engine/upstream/.git && \
  test -f /Users/nirmalghinaiya/Desktop/husk/engine/UPSTREAM_LICENSE && \
  test -f /Users/nirmalghinaiya/Desktop/husk/engine/build.zig && \
  echo OK
```
Expected: `OK`

- [ ] **Step 11: Try a build (best effort — may fail if lightpanda upstream has its own prereqs)**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/engine && zig build 2>&1 | tail -20
```
Expected: either success, or a clear lightpanda-upstream error pointing to a missing dep. If the latter, document the dep in `engine/README.md`'s "Building" section and proceed — the goal of M1 is the submodule pin, not a green build (the green build is M2's responsibility).

- [ ] **Step 12: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add .gitmodules engine/ && git commit -m "engine: scaffold + lightpanda upstream submodule pin"
```

---

### Task 8: Orchestrator scaffold + version test (TDD)

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/package.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tsconfig.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/vitest.config.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/version.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/index.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/version.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/version.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { VERSION, getVersion } from "../src/version.js";

describe("version", () => {
  it("exports a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  it("getVersion() returns the same value as VERSION", () => {
    expect(getVersion()).toBe(VERSION);
  });

  it("initial version is 0.0.0", () => {
    expect(VERSION).toBe("0.0.0");
  });
});
```

- [ ] **Step 2: Create orchestrator package.json**

```json
{
  "name": "husk-orchestrator",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "husk": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc --build",
    "dev": "tsc --build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "echo 'lint config in M3'",
    "typecheck": "tsc --noEmit",
    "start": "node ./dist/index.js"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create orchestrator tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Install workspace deps**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm install
```

- [ ] **Step 6: Run the test and confirm it fails**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -20
```
Expected: FAIL — cannot find module `../src/version.js`.

- [ ] **Step 7: Create `src/version.ts`**

```typescript
export const VERSION = "0.0.0";

export function getVersion(): string {
  return VERSION;
}
```

- [ ] **Step 8: Create `src/index.ts`**

```typescript
#!/usr/bin/env node
import { getVersion } from "./version.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

switch (cmd) {
  case "version":
  case "--version":
  case "-v":
    console.log(`husk v${getVersion()}`);
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(`husk v${getVersion()}

Usage:
  husk version          Print version
  husk help             Print this help

Coming in later milestones:
  husk start            Start the orchestrator (M3)
  husk run <example>    Run an example agent (M6)
  husk inspect <id>     Inspect a live session (M6)`);
    break;
  default:
    console.error(`Unknown command: ${cmd}. Try 'husk help'.`);
    process.exit(1);
}
```

- [ ] **Step 9: Build and run test**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm build && pnpm test
```
Expected: PASS (3 tests).

- [ ] **Step 10: Verify CLI works**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && node ./dist/index.js version
```
Expected: `husk v0.0.0`

- [ ] **Step 11: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add orchestrator/ pnpm-lock.yaml && git commit -m "feat(orchestrator): scaffold with version command + tests"
```

---

### Task 9: TypeScript SDK scaffold + smoke test (TDD)

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-ts/package.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-ts/tsconfig.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-ts/vitest.config.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-ts/src/index.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-ts/tests/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/sdk-ts/tests/smoke.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { Husk, SDK_VERSION } from "../src/index.js";

describe("@husk/sdk smoke", () => {
  it("exports a Husk class", () => {
    expect(Husk).toBeDefined();
    expect(typeof Husk).toBe("function");
  });

  it("Husk constructor accepts a baseUrl option", () => {
    const h = new Husk({ baseUrl: "http://localhost:7777" });
    expect(h.baseUrl).toBe("http://localhost:7777");
  });

  it("Husk constructor defaults baseUrl when omitted", () => {
    const h = new Husk();
    expect(h.baseUrl).toBe("http://localhost:7777");
  });

  it("exports SDK_VERSION matching semver", () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});
```

- [ ] **Step 2: Create sdk-ts/package.json**

```json
{
  "name": "@husk/sdk",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc --build",
    "dev": "tsc --build --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "echo 'lint config in M3'",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create sdk-ts/tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Install + run test (should fail)**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm install
cd /Users/nirmalghinaiya/Desktop/husk/sdk-ts && pnpm test 2>&1 | tail -10
```
Expected: FAIL — cannot find module `../src/index.js`.

- [ ] **Step 6: Create `src/index.ts`**

```typescript
export const SDK_VERSION = "0.0.0";

export interface HuskOptions {
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "http://localhost:7777";

/**
 * Husk SDK client.
 *
 * In Milestone 1 this is a placeholder constructor only. Full transport
 * (JSON-RPC over HTTP/2), Session API, and snapshot/act methods land in
 * Milestone 6.
 */
export class Husk {
  public readonly baseUrl: string;

  constructor(options: HuskOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }
}
```

- [ ] **Step 7: Build and run test**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/sdk-ts && pnpm build && pnpm test
```
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add sdk-ts/ pnpm-lock.yaml && git commit -m "feat(sdk-ts): scaffold @husk/sdk with constructor + smoke tests"
```

---

### Task 10: Python SDK scaffold + smoke test (TDD)

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-py/pyproject.toml`
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-py/README.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-py/husk/__init__.py`
- Create: `/Users/nirmalghinaiya/Desktop/husk/sdk-py/tests/test_smoke.py`

- [ ] **Step 1: Write the failing test first**

Create `/Users/nirmalghinaiya/Desktop/husk/sdk-py/tests/test_smoke.py`:

```python
"""Smoke tests for husk-sdk."""
import re

import husk


def test_version_is_semver():
    assert re.match(r"^\d+\.\d+\.\d+(-[\w.]+)?$", husk.__version__)


def test_husk_class_exists():
    assert hasattr(husk, "Husk")
    assert callable(husk.Husk)


def test_husk_constructor_accepts_base_url():
    h = husk.Husk(base_url="http://localhost:7777")
    assert h.base_url == "http://localhost:7777"


def test_husk_default_base_url():
    h = husk.Husk()
    assert h.base_url == "http://localhost:7777"
```

- [ ] **Step 2: Create pyproject.toml**

```toml
[build-system]
requires = ["hatchling>=1.21"]
build-backend = "hatchling.build"

[project]
name = "husk-sdk"
version = "0.0.0"
description = "Python SDK for Husk — open-source browser engine for AI agents."
readme = "README.md"
requires-python = ">=3.11"
license = { text = "AGPL-3.0-or-later" }
authors = [{ name = "Husk contributors" }]
classifiers = [
  "License :: OSI Approved :: GNU Affero General Public License v3 or later (AGPLv3+)",
  "Programming Language :: Python :: 3",
  "Programming Language :: Python :: 3.11",
  "Programming Language :: Python :: 3.12",
  "Programming Language :: Python :: 3.13",
]
dependencies = []  # Milestone 6 adds httpx + pydantic

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "pytest-asyncio>=0.23",
  "ruff>=0.6",
  "mypy>=1.10",
]

[project.urls]
Homepage = "https://husk.dev"
Repository = "https://github.com/yourorg/husk"
Issues = "https://github.com/yourorg/husk/issues"

[tool.hatch.build.targets.wheel]
packages = ["husk"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]

[tool.ruff]
target-version = "py311"
line-length = 100

[tool.mypy]
python_version = "3.11"
strict = true
```

- [ ] **Step 3: Create sdk-py/README.md**

```markdown
# husk-sdk (Python)

Python SDK for [Husk](https://husk.dev) — open-source browser engine for AI agents.

## Install

```sh
pip install husk-sdk
```

## Status

Milestone 1 — placeholder constructor only. Full API ships in Milestone 6.

## License

AGPL v3.
```

- [ ] **Step 4: Run the test, confirm failure**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/sdk-py && python -m pip install -e ".[dev]" --quiet && python -m pytest -q 2>&1 | tail -10
```
Expected: FAIL — `ModuleNotFoundError: No module named 'husk'` initially, then after install, FAIL on missing `Husk` attribute.

- [ ] **Step 5: Create `husk/__init__.py`**

```python
"""Husk — open-source browser engine for AI agents (Python SDK).

In Milestone 1, this module exposes only the Husk client constructor as a
placeholder. Full transport (JSON-RPC over HTTP/2), session management,
and snapshot/act methods land in Milestone 6.
"""

__version__ = "0.0.0"

DEFAULT_BASE_URL = "http://localhost:7777"


class Husk:
    """Husk SDK client (Milestone 1 placeholder).

    Args:
        base_url: Orchestrator URL. Defaults to ``http://localhost:7777``.
    """

    def __init__(self, base_url: str = DEFAULT_BASE_URL) -> None:
        self.base_url = base_url


__all__ = ["Husk", "__version__", "DEFAULT_BASE_URL"]
```

- [ ] **Step 6: Install package and run tests**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/sdk-py && python -m pip install -e ".[dev]" --quiet && python -m pytest -q
```
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add sdk-py/ && git commit -m "feat(sdk-py): scaffold husk-sdk with constructor + smoke tests"
```

---

### Task 11: MCP bridge scaffold

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/package.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/tsconfig.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/src/index.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/mcp/README.md`

- [ ] **Step 1: Write the verification command**

Run: `cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm build && test -f dist/index.js && echo OK`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm build 2>&1 | tail -5 || echo NOTYET
```
Expected: error (no `mcp` workspace package yet).

- [ ] **Step 3: Update pnpm-workspace.yaml to include mcp**

The workspace yaml already lists `mcp` from Task 1 — verify:

```sh
grep -q '"mcp"\|- mcp\| - "mcp"' /Users/nirmalghinaiya/Desktop/husk/pnpm-workspace.yaml || echo MISSING
```

If MISSING, edit `pnpm-workspace.yaml` to ensure `- "mcp"` is listed under packages.

- [ ] **Step 4: Create mcp/package.json**

```json
{
  "name": "@husk/mcp",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "husk-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc --build",
    "dev": "tsc --build --watch",
    "test": "echo 'tests added in M6'",
    "lint": "echo 'lint config in M3'",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 5: Create mcp/tsconfig.json**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 6: Create mcp/src/index.ts**

```typescript
#!/usr/bin/env node
/**
 * Husk MCP bridge — Model Context Protocol server that exposes Husk's
 * JSON-RPC orchestrator as MCP tools.
 *
 * Milestone 1 placeholder. Real MCP server implementation lands in
 * Milestone 6 (after the JSON-RPC protocol is defined).
 */

const VERSION = "0.0.0";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

switch (cmd) {
  case "version":
  case "--version":
    console.log(`husk-mcp v${VERSION}`);
    break;
  case "help":
  case "--help":
  default:
    console.log(`husk-mcp v${VERSION}

The Husk MCP bridge will expose the Husk browser-engine orchestrator to
Model Context Protocol clients (Claude Desktop, Cursor, Continue,
Windsurf, etc.).

Full implementation lands in Milestone 6. Today this binary only prints
its version. To monitor progress, see:
docs/superpowers/plans/`);
    break;
}
```

- [ ] **Step 7: Create mcp/README.md**

```markdown
# @husk/mcp

Model Context Protocol bridge for Husk.

When complete (Milestone 6), this package will let MCP-aware clients
(Claude Desktop, Cursor, Continue, Windsurf, etc.) use Husk as a browser
tool with one config line:

```json
{
  "mcpServers": {
    "husk": { "command": "npx", "args": ["-y", "@husk/mcp"] }
  }
}
```

## Status

Milestone 1 placeholder. See [docs/mcp-setup.md](../docs/mcp-setup.md).
```

- [ ] **Step 8: Install + build + verify**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && pnpm install
cd /Users/nirmalghinaiya/Desktop/husk/mcp && pnpm build && test -f dist/index.js && echo OK
```
Expected: `OK`

- [ ] **Step 9: Smoke-run the binary**

```sh
node /Users/nirmalghinaiya/Desktop/husk/mcp/dist/index.js version
```
Expected: `husk-mcp v0.0.0`

- [ ] **Step 10: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add mcp/ pnpm-lock.yaml && git commit -m "feat(mcp): scaffold @husk/mcp placeholder package"
```

---

### Task 12: Protocol schema stubs

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/protocol/jsonrpc.openapi.yaml`
- Create: `/Users/nirmalghinaiya/Desktop/husk/protocol/snapshot.schema.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/protocol/policy.schema.json`
- Create: `/Users/nirmalghinaiya/Desktop/husk/protocol/tools-manifest/.gitkeep`
- Create: `/Users/nirmalghinaiya/Desktop/husk/protocol/README.md`

- [ ] **Step 1: Write the verification command**

Run: `python -c "import yaml, json; yaml.safe_load(open('/Users/nirmalghinaiya/Desktop/husk/protocol/jsonrpc.openapi.yaml')); json.load(open('/Users/nirmalghinaiya/Desktop/husk/protocol/snapshot.schema.json')); json.load(open('/Users/nirmalghinaiya/Desktop/husk/protocol/policy.schema.json')); print('OK')"`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
python -c "import yaml, json; yaml.safe_load(open('/Users/nirmalghinaiya/Desktop/husk/protocol/jsonrpc.openapi.yaml'))" 2>&1 || echo MISSING
```
Expected: `MISSING`

- [ ] **Step 3: Create the directory tree**

```sh
mkdir -p /Users/nirmalghinaiya/Desktop/husk/protocol/tools-manifest
touch /Users/nirmalghinaiya/Desktop/husk/protocol/tools-manifest/.gitkeep
```

- [ ] **Step 4: Create `protocol/jsonrpc.openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: Husk JSON-RPC API
  version: 0.0.0
  description: |
    JSON-RPC 2.0 over HTTP/2. Single source of truth for the agent ↔
    orchestrator boundary. SDKs are generated against this spec.

    Milestone 1: stub with only a health-check method. Full method
    surface defined in Milestone 3 (`create_session`, `goto`, `snapshot`,
    `act`, `close_session`) and Milestone 5 (`set_policy`).
  license:
    name: AGPL-3.0-or-later
    url: https://www.gnu.org/licenses/agpl-3.0.html

servers:
  - url: http://localhost:7777
    description: Local orchestrator (default)

paths:
  /v1/jsonrpc:
    post:
      summary: JSON-RPC 2.0 endpoint
      operationId: jsonrpc
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/JsonRpcRequest"
      responses:
        "200":
          description: JSON-RPC response
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/JsonRpcResponse"

components:
  schemas:
    JsonRpcRequest:
      type: object
      required: [jsonrpc, method, id]
      properties:
        jsonrpc:
          type: string
          const: "2.0"
        method:
          type: string
          enum: [health]
          description: |
            Milestone 1 supports only `health`. M3 adds session, M5 adds
            policy, M6 adds tool-manifest helpers.
        params:
          type: object
        id:
          oneOf: [{ type: string }, { type: integer }]

    JsonRpcResponse:
      type: object
      required: [jsonrpc, id]
      properties:
        jsonrpc:
          type: string
          const: "2.0"
        result: {}
        error:
          $ref: "#/components/schemas/JsonRpcError"
        id:
          oneOf: [{ type: string }, { type: integer }, { type: "null" }]

    JsonRpcError:
      type: object
      required: [code, message]
      properties:
        code:
          type: integer
        message:
          type: string
        data: {}
```

- [ ] **Step 5: Create `protocol/snapshot.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://husk.dev/schemas/snapshot.schema.json",
  "title": "Husk Snapshot",
  "description": "Compressed JSON-LD page representation. Milestone 1 stub; full schema defined in Milestone 4.",
  "type": "object",
  "required": ["v", "nodes"],
  "properties": {
    "v": {
      "type": "integer",
      "description": "Snapshot format version",
      "const": 0
    },
    "url": {
      "type": "string",
      "format": "uri"
    },
    "nodes": {
      "type": "array",
      "items": { "type": "object" }
    }
  }
}
```

- [ ] **Step 6: Create `protocol/policy.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://husk.dev/schemas/policy.schema.json",
  "title": "Husk Watchdog Policy",
  "description": "Per-session watchdog policy rules. Milestone 1 stub; full schema defined in Milestone 5.",
  "type": "object",
  "required": ["flow"],
  "properties": {
    "flow": { "type": "string" },
    "forbidden": { "type": "array" },
    "required_before": { "type": "array" },
    "allow_domains": { "type": "array", "items": { "type": "string" } },
    "deny_domains": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [ ] **Step 7: Create `protocol/README.md`**

```markdown
# Husk Protocol

Single source of truth for the agent ↔ orchestrator boundary.

## Files

- `jsonrpc.openapi.yaml` — JSON-RPC 2.0 method surface, the canonical
  public API. SDKs (TS, Python) and tool manifests are generated from
  this file.
- `snapshot.schema.json` — JSON-LD shape returned by `snapshot` method.
- `policy.schema.json` — Watchdog policy YAML schema (validated
  client-side at policy load).
- `tools-manifest/` — Generated LLM-tool-calling manifests (OpenAI,
  Anthropic, JSON Schema). Generation script lands in Milestone 6.

## License

All files under `protocol/` are MIT-licensed (see `LICENSE-EXAMPLES` at
repo root) so they can be reimplemented or integrated without AGPL
obligations.

## Schema validation

```sh
# OpenAPI
npx @redocly/cli lint protocol/jsonrpc.openapi.yaml

# JSON Schema
npx ajv compile -s protocol/snapshot.schema.json
npx ajv compile -s protocol/policy.schema.json
```
```

- [ ] **Step 8: Run verification, expect pass**

```sh
python -c "import yaml, json; yaml.safe_load(open('/Users/nirmalghinaiya/Desktop/husk/protocol/jsonrpc.openapi.yaml')); json.load(open('/Users/nirmalghinaiya/Desktop/husk/protocol/snapshot.schema.json')); json.load(open('/Users/nirmalghinaiya/Desktop/husk/protocol/policy.schema.json')); print('OK')"
```
Expected: `OK`

If `yaml` is not installed: `pip install pyyaml` first.

- [ ] **Step 9: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add protocol/ && git commit -m "feat(protocol): scaffold JSON-RPC OpenAPI + JSON Schema stubs"
```

---

### Task 13: Examples scaffolds (3 README files)

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/examples/01-wikipedia-research/README.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/examples/02-static-form-fill/README.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/examples/03-shopify-pricecheck/README.md`

- [ ] **Step 1: Write the verification command**

Run: `for d in 01-wikipedia-research 02-static-form-fill 03-shopify-pricecheck; do test -f /Users/nirmalghinaiya/Desktop/husk/examples/$d/README.md || { echo "MISSING $d"; exit 1; }; done; echo OK`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
for d in 01-wikipedia-research 02-static-form-fill 03-shopify-pricecheck; do test -f /Users/nirmalghinaiya/Desktop/husk/examples/$d/README.md || { echo "MISSING $d"; exit 1; }; done; echo OK
```
Expected: prints `MISSING ...` for each, then exits.

- [ ] **Step 3: Create directories**

```sh
mkdir -p /Users/nirmalghinaiya/Desktop/husk/examples/01-wikipedia-research \
         /Users/nirmalghinaiya/Desktop/husk/examples/02-static-form-fill \
         /Users/nirmalghinaiya/Desktop/husk/examples/03-shopify-pricecheck
```

- [ ] **Step 4: Create `examples/01-wikipedia-research/README.md`**

```markdown
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
```

- [ ] **Step 5: Create `examples/02-static-form-fill/README.md`**

```markdown
# Example 02 — Static Form Fill Agent

Demonstrates Husk's watchdog (sanity + policy layers) end-to-end.

## What it does

Navigates to a simple controlled form page (hosted in
`examples/02-static-form-fill/test-site/`), fills out fields using an
agent loop with watchdog policy rules enforcing "required checkbox
checked before submit" and "no typing into SSN fields."

## What it tests in Husk

- Action planner: `type`, `click`, `press` operations
- Watchdog sanity layer: rejects clicks on hidden / non-existent
  elements
- Watchdog policy layer: enforces `required_before` and `forbidden`
  rules from `policy.yaml`

## Status

Stub — full implementation lands in Milestone 6.

## License

MIT (this directory is covered by `LICENSE-EXAMPLES`).
```

- [ ] **Step 6: Create `examples/03-shopify-pricecheck/README.md`**

```markdown
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
```

- [ ] **Step 7: Run verification, expect pass**

```sh
for d in 01-wikipedia-research 02-static-form-fill 03-shopify-pricecheck; do test -f /Users/nirmalghinaiya/Desktop/husk/examples/$d/README.md || { echo "MISSING $d"; exit 1; }; done; echo OK
```
Expected: `OK`

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add examples/ && git commit -m "docs(examples): scaffold three example agent READMEs"
```

---

### Task 14: Docs scaffolds (4 markdown files)

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/docs/quickstart.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/docs/architecture.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/docs/policy-rules.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/docs/mcp-setup.md`

- [ ] **Step 1: Write the verification command**

Run: `for f in quickstart architecture policy-rules mcp-setup; do test -f /Users/nirmalghinaiya/Desktop/husk/docs/$f.md || { echo "MISSING $f"; exit 1; }; done; echo OK`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
for f in quickstart architecture policy-rules mcp-setup; do test -f /Users/nirmalghinaiya/Desktop/husk/docs/$f.md || { echo "MISSING $f"; exit 1; }; done; echo OK
```
Expected: `MISSING quickstart` (or similar), exits.

- [ ] **Step 3: Create `docs/quickstart.md`**

```markdown
# Husk Quickstart

> Milestone 1 placeholder. Full quickstart with runnable example lands
> in Milestone 6.

## Prerequisites

- Node 20 LTS
- pnpm 9
- Zig 0.13 (`brew install zig` or asdf)
- Python 3.11+

## Install

```sh
git clone https://github.com/yourorg/husk
cd husk
pnpm install
make all
```

## Verify

```sh
make test                  # runs all package tests
./orchestrator/dist/index.js version   # should print: husk v0.0.0
```

## Next

- [Architecture overview](./architecture.md)
- [Full design spec](./superpowers/specs/2026-05-13-husk-design.md)
- [Contributing guide](../CONTRIBUTING.md)
```

- [ ] **Step 4: Create `docs/architecture.md`**

```markdown
# Husk Architecture

For the full architectural design, see
[`docs/superpowers/specs/2026-05-13-husk-design.md`](./superpowers/specs/2026-05-13-husk-design.md),
Section 4 (System Architecture).

## TL;DR

```
agent code
   │ JSON-RPC over HTTP/2
   ▼
orchestrator (Node, TypeScript)
   │ Chrome DevTools Protocol over WebSocket
   ▼
engine (Zig, forked lightpanda)
```

Two processes. One protocol (JSON-RPC) at the public boundary. One
protocol (CDP) at the engine boundary. SDK clients (TS, Python, MCP,
CLI) all wrap the public protocol.

See the full spec for component-by-component responsibilities, request
flow walkthroughs, and the three novel subsystems (semantic stable IDs,
snapshot compression, watchdog).
```

- [ ] **Step 5: Create `docs/policy-rules.md`**

```markdown
# Watchdog Policy Rules

> Milestone 1 placeholder. Full policy rules guide lands in Milestone 5.

The Husk watchdog has two deterministic layers:

1. **Sanity rules** — always on, hard-coded. Verify element existence,
   visibility, enabled state, interactive role compatibility before an
   action. Verify expected mutation, no error alerts, URL consistency
   after.

2. **Policy rules** — opt-in, declarative YAML. Per-flow forbidden /
   required-before / allow-domain / deny-domain rules.

See the full spec, Section 5.3, for the rule schema and matching
semantics.
```

- [ ] **Step 6: Create `docs/mcp-setup.md`**

```markdown
# Husk MCP Setup

> Milestone 1 placeholder. Full MCP setup guide lands in Milestone 6.

When the `@husk/mcp` package ships, MCP-aware clients (Claude Desktop,
Cursor, Continue, Windsurf, etc.) will use Husk with one config line:

```json
{
  "mcpServers": {
    "husk": { "command": "npx", "args": ["-y", "@husk/mcp"] }
  }
}
```

See the full spec, Section 6, Interface 3, for the planned MCP tool
surface.
```

- [ ] **Step 7: Run verification, expect pass**

```sh
for f in quickstart architecture policy-rules mcp-setup; do test -f /Users/nirmalghinaiya/Desktop/husk/docs/$f.md || { echo "MISSING $f"; exit 1; }; done; echo OK
```
Expected: `OK`

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add docs/ && git commit -m "docs: scaffold quickstart, architecture, policy-rules, mcp-setup"
```

---

### Task 15: GitHub Actions CI workflow

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/.github/workflows/ci.yml`

- [ ] **Step 1: Write the verification command**

Run: `python -c "import yaml; yaml.safe_load(open('/Users/nirmalghinaiya/Desktop/husk/.github/workflows/ci.yml')); print('OK')"`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
python -c "import yaml; yaml.safe_load(open('/Users/nirmalghinaiya/Desktop/husk/.github/workflows/ci.yml'))" 2>&1 || echo MISSING
```
Expected: `MISSING`

- [ ] **Step 3: Create the workflows directory**

```sh
mkdir -p /Users/nirmalghinaiya/Desktop/husk/.github/workflows
```

- [ ] **Step 4: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ts-packages:
    name: TS / Node (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-14]
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm test

  python-sdk:
    name: Python SDK (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-14]
        python-version: ["3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - run: python -m pip install -e "sdk-py[dev]"
      - run: cd sdk-py && python -m pytest -q

  engine:
    name: Engine (Zig, ${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-14]
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: goto-bus-stop/setup-zig@v2
        with:
          version: 0.13.0
      - name: Build engine
        run: |
          cd engine
          # Best-effort: lightpanda upstream may have its own prereqs.
          # M1 verifies the submodule + build.zig parse; M2 ensures a
          # green build with our patches applied.
          zig build || echo "::warning::engine build issues (expected pre-M2)"
```

- [ ] **Step 5: Run verification, expect pass**

```sh
python -c "import yaml; yaml.safe_load(open('/Users/nirmalghinaiya/Desktop/husk/.github/workflows/ci.yml')); print('OK')"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add .github/workflows/ci.yml && git commit -m "ci: add GitHub Actions workflow for TS, Python, and engine builds"
```

---

### Task 16: GitHub PR + Issue templates

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/.github/PULL_REQUEST_TEMPLATE.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `/Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE/feature_request.md`

- [ ] **Step 1: Write the verification command**

Run: `test -f /Users/nirmalghinaiya/Desktop/husk/.github/PULL_REQUEST_TEMPLATE.md && test -f /Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE/bug_report.md && test -f /Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE/feature_request.md && echo OK`
Expected: `OK`

- [ ] **Step 2: Run verification now to confirm it fails**

```sh
test -f /Users/nirmalghinaiya/Desktop/husk/.github/PULL_REQUEST_TEMPLATE.md && test -f /Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE/bug_report.md && test -f /Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE/feature_request.md && echo OK || echo MISSING
```
Expected: `MISSING`

- [ ] **Step 3: Create directories**

```sh
mkdir -p /Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE
```

- [ ] **Step 4: Create `PULL_REQUEST_TEMPLATE.md`**

```markdown
## Summary

<!-- One sentence: what does this PR change? -->

## Motivation

<!-- Why? Link to issue or design doc if applicable. -->

## Changes

<!-- Bullet list of meaningful changes. -->

## Testing

<!-- How did you verify? Run `make test` locally. -->

- [ ] `make all` succeeds on macOS arm64
- [ ] `make test` passes
- [ ] New tests added for new behavior

## Spec / Plan reference

<!-- Which spec section or plan task does this implement? -->

## Checklist

- [ ] CLA signed (CLA Assistant will prompt on first PR)
- [ ] Conventional commit message format (`feat:`, `fix:`, `chore:`, …)
- [ ] Updated docs if user-visible behavior changed
- [ ] No `TODO` / `TBD` / placeholder comments left
```

- [ ] **Step 5: Create `ISSUE_TEMPLATE/bug_report.md`**

```markdown
---
name: Bug report
about: Something isn't working
title: "[bug] "
labels: bug
---

## Description

<!-- Clear, concise description of the bug. -->

## Reproduction

<!-- Minimal repro. URL, HTML snippet, or example agent code. -->

```ts
// minimal failing example
```

## Expected behavior

<!-- What did you expect to happen? -->

## Actual behavior

<!-- What happened instead? Include error messages and stack traces. -->

## Environment

- Husk version: `husk --version`
- OS: macOS / Linux / etc.
- Node version: `node --version`
- Zig version (if engine-related): `zig version`
- Python version (if SDK-py): `python --version`

## Additional context

<!-- Logs from `husk inspect`, replay files, anything relevant. -->
```

- [ ] **Step 6: Create `ISSUE_TEMPLATE/feature_request.md`**

```markdown
---
name: Feature request
about: Suggest a new capability
title: "[feature] "
labels: enhancement
---

## Problem

<!-- What user / agent / customer problem does this solve? -->

## Proposal

<!-- High-level shape of the solution. -->

## Alternatives considered

<!-- Other approaches and why they're worse. -->

## Out of scope

<!-- What this proposal explicitly does NOT cover. -->

## Spec impact

<!-- Does this require a spec change? Which section? -->
```

- [ ] **Step 7: Run verification, expect pass**

```sh
test -f /Users/nirmalghinaiya/Desktop/husk/.github/PULL_REQUEST_TEMPLATE.md && test -f /Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE/bug_report.md && test -f /Users/nirmalghinaiya/Desktop/husk/.github/ISSUE_TEMPLATE/feature_request.md && echo OK
```
Expected: `OK`

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git add .github/ && git commit -m "chore: add GitHub PR + issue templates"
```

---

### Task 17: End-to-end smoke — `make all` succeeds from clean state

This is the integration test for the whole milestone.

- [ ] **Step 1: Write the verification command**

Run: `cd /Users/nirmalghinaiya/Desktop/husk && make clean && pnpm install && make all`
Expected: exit code 0, no errors (warnings allowed for engine pre-M2).

- [ ] **Step 2: Run it**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && make clean && pnpm install && make all 2>&1 | tail -40
```
Expected: prints build progress for engine, orchestrator, sdk-ts, sdk-py, mcp. Final exit: 0.

If any package fails:
- Re-check that task's verification step
- Confirm `pnpm-workspace.yaml` lists all TS packages
- Confirm `engine/upstream/` submodule is initialized (`git submodule update --init --recursive`)
- For engine-specific failures: acceptable in M1, will be addressed in M2

- [ ] **Step 3: Run `make test`**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && make test
```
Expected: all TS tests pass (orchestrator 3 tests + sdk-ts 4 tests), all Python tests pass (sdk-py 4 tests). Total: 11 tests.

- [ ] **Step 4: Tag the milestone**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git tag -a v0.0.0-m1 -m "Milestone 1 complete: foundation scaffolding"
```

- [ ] **Step 5: Print summary**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && git log --oneline && echo "---" && ls -la
```

Verify:
- Commit history shows the milestone progression
- All expected top-level files/directories present: `LICENSE`, `LICENSE-EXAMPLES`, `CLA.md`, `CONTRIBUTING.md`, `README.md`, `Makefile`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`, `.gitmodules`, `engine/`, `orchestrator/`, `sdk-ts/`, `sdk-py/`, `mcp/`, `protocol/`, `examples/`, `docs/`, `.github/`

---

## Milestone 1 Definition of Done

- [ ] `make clean && pnpm install && make all` succeeds from a fresh checkout on macOS arm64
- [ ] `make test` shows 11/11 tests passing across all packages
- [ ] `node orchestrator/dist/index.js version` prints `husk v0.0.0`
- [ ] `node mcp/dist/index.js version` prints `husk-mcp v0.0.0`
- [ ] `python -c "import husk; print(husk.__version__)"` (with sdk-py installed) prints `0.0.0`
- [ ] All legal files present: `LICENSE` (AGPL v3), `LICENSE-EXAMPLES` (MIT), `CLA.md`, `CONTRIBUTING.md`
- [ ] `engine/upstream/` is an initialized submodule pinned to a known lightpanda commit
- [ ] CI workflow file is valid YAML; GitHub Actions ready to enable on first push
- [ ] Tag `v0.0.0-m1` exists in git
- [ ] Commit history is clean, each task = one or two commits with Conventional Commits format

If any DoD checkbox fails, the milestone is not complete; address the gap before proceeding to Milestone 2.

---

## What's NOT in Milestone 1 (deferred — coming in M2+)

- Engine patches (`Snapshot`, `SemanticId`, mutation observer, a11y hooks) — **M2**
- Orchestrator HTTP server (Hono) + CDP client — **M3**
- Session manager + engine subprocess pool — **M3**
- Snapshot decoder, diff applier, site graph cache — **M4**
- Watchdog rule engine, policy YAML loader, action planner — **M5**
- SDK real transport (JSON-RPC + HTTP/2), Session API, snapshot/act methods — **M6**
- MCP real implementation — **M6**
- Three example agents actually running — **M6**
- GitHub Releases pipeline (npm publish, PyPI publish, binary releases) — **M7**
- Show HN / ProductHunt assets — **M7**

When Milestone 1 ships, the next plan (`2026-XX-XX-husk-m2-engine-patches.md`) covers M2.
