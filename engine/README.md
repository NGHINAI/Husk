# Husk Engine

The Husk engine is a fork of [lightpanda](https://lightpanda.io) (AGPLv3,
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
- `UPSTREAM_LICENSE` — lightpanda's AGPLv3 LICENSE, preserved

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
lightpanda upstream as AGPLv3 PRs first, then pulled into our pin once
merged. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Our patches

All files under `patches/` are AGPL v3 — they live under Husk's license,
which is compatible with the upstream AGPLv3. Build process applies them
on top of the upstream submodule.
