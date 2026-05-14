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
