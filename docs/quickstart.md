# Husk Quickstart

This guide gets you to a working `husk demo` invocation against a real
URL using the prebuilt lightpanda binary.

## Prerequisites

- Node 20 LTS
- pnpm 9
- Python 3.11+
- A prebuilt `lightpanda` binary (see "Install lightpanda" below). Zig is
  NOT required for v0; the engine is consumed as a prebuilt binary.

## Install lightpanda

Download the prebuilt binary for your platform from
https://github.com/lightpanda-io/browser/releases (latest at time of
writing: `0.3.0`):

```sh
# Pick the asset that matches your platform:
#   - lightpanda-aarch64-macos   (Apple Silicon)
#   - lightpanda-x86_64-macos    (Intel Mac)
#   - lightpanda-aarch64-linux
#   - lightpanda-x86_64-linux
mkdir -p ~/.husk/bin
ASSET="lightpanda-$(uname -m | sed 's/x86_64/x86_64/;s/arm64/aarch64/')-$(uname -s | tr A-Z a-z)"
curl -fsSL -o ~/.husk/bin/lightpanda \
  "https://github.com/lightpanda-io/browser/releases/download/0.3.0/$ASSET"
chmod +x ~/.husk/bin/lightpanda
```

Either add `~/.husk/bin` to your `PATH` or export `LIGHTPANDA_BIN`:

```sh
export LIGHTPANDA_BIN=~/.husk/bin/lightpanda
```

Verify:

```sh
$LIGHTPANDA_BIN --version
```

## Build Husk

```sh
git clone https://github.com/NGHINAI/Husk
cd Husk
pnpm install
make all
```

## Verify

```sh
make test                  # runs all package tests
./orchestrator/dist/index.js version   # should print: husk v0.0.0
```

## Demo

The `husk demo` subcommand drives lightpanda against any URL and prints
the resulting spec-§5.2 snapshot:

```sh
node ./orchestrator/dist/index.js demo https://example.com | head -40
```

Output is a JSON tree of pruned, stable-id-tagged accessibility nodes —
this is what your AI agent will consume in production.

## Known limitations (v0)

- `file://` URLs are not supported by lightpanda. Use HTTP/HTTPS or
  start a local server (`python3 -m http.server`) and point at it.
- Sites requiring IndexedDB will fail (Firebase Auth, Auth0 SPA SDK,
  AWS Amplify). Tracked for v0.2.
- Sites that depend on WebGL, WebRTC, or WebAssembly will not render.
  Tracked for v2.0 (hybrid engine with stripped Chromium fallback).

## Next

- [Architecture overview](./architecture.md)
- [Full design spec](./superpowers/specs/2026-05-13-husk-design.md)
- [Contributing guide](../CONTRIBUTING.md)
- [M2 spike findings](./superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md)
