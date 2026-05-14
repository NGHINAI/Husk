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
