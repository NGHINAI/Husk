import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { locateLightpanda } from "../../src/binary.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUSK_MCP_BIN = resolve(__dirname, "../../dist/index.js");

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

integrationOrSkip("husk-mcp end-to-end against real lightpanda", () => {
  it("tools/list returns Husk-branded tool names and includes husk_version", async () => {
    const child = spawn("node", [HUSK_MCP_BIN, "serve"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      // eslint-disable-next-line no-console
      console.error("[stderr]", chunk.toString().trim());
    });

    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");

    const start = Date.now();
    while (Date.now() - start < 10_000) {
      if (stdoutBuffer.includes("\n")) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    child.stdin.end();
    child.kill("SIGTERM");

    const firstLine = stdoutBuffer.split("\n").find((l) => l.trim());
    expect(firstLine).toBeTruthy();
    const response = JSON.parse(firstLine!);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.result?.tools).toBeInstanceOf(Array);
    const names = response.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("husk_goto");
    expect(names).toContain("husk_snapshot");
    expect(names).toContain("husk_version");
    expect(names).not.toContain("goto");
    expect(names).not.toContain("semantic_tree");
  }, 30_000);
});
