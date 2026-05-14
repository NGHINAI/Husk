import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { runProxy } from "../src/proxy.js";

interface Captured {
  upstreamStdinLines: string[];
  agentStdoutLines: string[];
}

async function runScenario(
  agentInputLines: string[],
  upstreamResponses: (line: string) => string | undefined,
  opts: { lightpandaVersion: string }
): Promise<Captured> {
  const agentIn = new PassThrough();
  const agentOut = new PassThrough();
  const upstreamIn = new PassThrough();
  const upstreamOut = new PassThrough();

  const captured: Captured = { upstreamStdinLines: [], agentStdoutLines: [] };

  upstreamIn.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) {
        captured.upstreamStdinLines.push(line);
        const reply = upstreamResponses(line);
        if (reply !== undefined) upstreamOut.write(reply + "\n");
      }
    }
  });
  agentOut.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) captured.agentStdoutLines.push(line);
    }
  });

  const proxyPromise = runProxy(agentIn, agentOut, upstreamIn, upstreamOut, opts);

  for (const line of agentInputLines) {
    agentIn.write(line + "\n");
  }
  await new Promise((r) => setTimeout(r, 50));
  agentIn.end();
  await proxyPromise.catch(() => {});
  return captured;
}

describe("runProxy", () => {
  it("rewrites a tools/call request before forwarding to upstream", async () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "husk_goto", arguments: { url: "https://example.com" } },
    });
    const captured = await runScenario(
      [request],
      (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "tools/call") {
          return JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } });
        }
        return undefined;
      },
      { lightpandaVersion: "0.3.0" }
    );
    expect(captured.upstreamStdinLines).toHaveLength(1);
    const upstreamMsg = JSON.parse(captured.upstreamStdinLines[0]);
    expect(upstreamMsg.params.name).toBe("goto");
  });

  it("rewrites a tools/list response before forwarding to agent", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const captured = await runScenario(
      [request],
      (_line) =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            tools: [
              { name: "goto", description: "Navigate." },
              { name: "semantic_tree", description: "Return the page." },
            ],
          },
        }),
      { lightpandaVersion: "0.3.0" }
    );
    expect(captured.agentStdoutLines).toHaveLength(1);
    const out = JSON.parse(captured.agentStdoutLines[0]);
    const names = out.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("husk_goto");
    expect(names).toContain("husk_snapshot");
    expect(names).toContain("husk_version");
    expect(names).not.toContain("goto");
  });

  it("handles husk_version locally without forwarding to upstream", async () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "husk_version", arguments: {} },
    });
    const captured = await runScenario(
      [request],
      (_line) => undefined,
      { lightpandaVersion: "0.3.0-test" }
    );
    expect(captured.upstreamStdinLines).toHaveLength(0);
    expect(captured.agentStdoutLines).toHaveLength(1);
    const out = JSON.parse(captured.agentStdoutLines[0]);
    expect(out.id).toBe(5);
    const payload = JSON.parse(out.result.content[0].text);
    expect(payload.husk).toBeDefined();
    expect(payload.lightpanda).toBe("0.3.0-test");
  });

  it("passes through unknown methods unchanged", async () => {
    const request = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" });
    const captured = await runScenario(
      [request],
      (line) => {
        const m = JSON.parse(line);
        return JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { pong: true } });
      },
      { lightpandaVersion: "0.3.0" }
    );
    expect(captured.upstreamStdinLines).toHaveLength(1);
    expect(JSON.parse(captured.upstreamStdinLines[0]).method).toBe("ping");
    expect(captured.agentStdoutLines).toHaveLength(1);
    expect(JSON.parse(captured.agentStdoutLines[0]).result.pong).toBe(true);
  });
});
