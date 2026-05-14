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
