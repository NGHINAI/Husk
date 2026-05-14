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
