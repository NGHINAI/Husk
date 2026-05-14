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
