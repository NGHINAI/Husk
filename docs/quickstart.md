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

## Run the HTTP server

The `husk start` subcommand runs the orchestrator's JSON-RPC server on
port 7777 (default) for use by non-CLI agents and SDK clients.

```sh
LIGHTPANDA_BIN=~/.husk/bin/lightpanda \
  node ./orchestrator/dist/index.js start --port 7777
```

The server stays up until you send SIGINT (Ctrl-C). It accepts
JSON-RPC 2.0 envelopes at POST `/v1/jsonrpc`. Six methods are available:

- `health` — server liveness + active session count
- `create_session` — start a lightpanda subprocess + open CDP, returns a `session_id`
- `goto` — navigate the session to a URL
- `snapshot` — return a spec-§5.2 JSON-LD snapshot
- `snapshot_diff` — return diff vs prior snapshot, or `null` if no prior
- `close_session` — tear down the session

Example flow:

```sh
RPC=http://127.0.0.1:7777/v1/jsonrpc

# 1. Create a session
SID=$(curl -s -X POST $RPC -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_session"}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['result']['session_id'])")

# 2. Navigate
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"goto\",\"params\":{\"session_id\":\"$SID\",\"url\":\"https://example.com/\"}}"

# 3. Snapshot
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"snapshot\",\"params\":{\"session_id\":\"$SID\"}}" \
  | head -40

# 4. Close
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"close_session\",\"params\":{\"session_id\":\"$SID\"}}"
```

The full OpenAPI spec is at
[`protocol/jsonrpc.openapi.yaml`](../protocol/jsonrpc.openapi.yaml).
SDKs in M6 will be generated against this spec.

## Where Husk stores per-domain observations

Every time the orchestrator captures a snapshot, it writes every node's
metadata (stable_id, role, accessible name, timestamp) into a
per-domain SQLite database at `~/.husk/site-graph/{domain}.db`. The
M5 watchdog will use this cache to generate candidate suggestions when
your agent references an element that no longer exists.

To use a different directory (e.g., for tests or isolated dev):

```sh
HUSK_CACHE_DIR=/tmp/my-husk-cache \
  node ./orchestrator/dist/index.js start --port 7777
```

To clear everything Husk has ever seen on a particular domain:

```sh
rm ~/.husk/site-graph/example.com.db
```

The cache is observation-only in v0 — it doesn't gate behavior. M5
(watchdog) reads from it for rejection-envelope candidate generation,
and M9 (DOM-drift router) will use it for cross-deploy stable-ID
resolution. v1.0 vertical recipes are pre-populated site graphs you'll
be able to ship alongside Husk.
