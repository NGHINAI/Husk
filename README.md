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
| Browser runtime (consumes prebuilt lightpanda binary) | ✅ |
| Snapshot compression (a11y-tree-based JSON-LD with full text preserved) | ✅ |
| Watchdog (sanity + policy, deterministic, no LLM) | ✅ |
| TypeScript SDK + Python SDK | ✅ |
| MCP server (Claude Desktop / Cursor / Continue / Windsurf) | ✅ |
| CLI | ✅ |
| Auth pillar (cookies / SSO / MFA) | v0.2 |
| DOM-drift router (cross-deploy resolver) | v0.1 |
| Cloud-hosted Husk | v0.3 |
| WebGL / WebRTC / WebAssembly / Gmail / Salesforce | inherited limitation |
| IndexedDB (affects Firebase Auth, Auth0 SPA, AWS Amplify) | inherited limitation; flagged in v0.2 |

## Quickstart

```sh
# Prerequisites: Node 20, pnpm 9, Python 3.11+
git clone https://github.com/NGHINAI/Husk
cd Husk

# Install lightpanda binary (M2: consume prebuilt; no Zig build needed for v0)
mkdir -p ~/.husk/bin
curl -fsSL -o ~/.husk/bin/lightpanda \
  https://github.com/lightpanda-io/browser/releases/download/0.3.0/lightpanda-$(uname -m | sed 's/x86_64/x86_64/;s/arm64/aarch64/')-$(uname -s | tr A-Z a-z)
chmod +x ~/.husk/bin/lightpanda
export LIGHTPANDA_BIN=~/.husk/bin/lightpanda

# Build husk
pnpm install
make all

# Smoke test
make test

# Demo: drive lightpanda end-to-end
node ./orchestrator/dist/index.js demo https://example.com | head -50

# Or run the full HTTP/JSON-RPC server (M3 — runs until you Ctrl-C)
node ./orchestrator/dist/index.js start --port 7777

# In another terminal — drive Husk over HTTP
curl -s -X POST http://127.0.0.1:7777/v1/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_session"}'
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
