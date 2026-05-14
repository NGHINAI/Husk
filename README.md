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
Upstream lightpanda: MIT (preserved in [engine/UPSTREAM_LICENSE](./engine/UPSTREAM_LICENSE))
