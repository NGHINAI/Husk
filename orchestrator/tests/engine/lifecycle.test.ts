import { describe, expect, it, beforeAll } from "vitest";
import { writeFileSync, chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnLightpanda } from "../../src/engine/lifecycle.js";

function makeFakeBinary(): string {
  const tmp = mkdtempSync(join(tmpdir(), "husk-lp-fake-"));
  const path = join(tmp, "fake-lightpanda");
  const script = `#!/usr/bin/env node
const port = (process.argv.find(a => a.startsWith("--port=")) || "").split("=")[1] ||
             process.argv[process.argv.indexOf("--port") + 1];
const { createServer } = require("node:http");
const srv = createServer((req, res) => {
  if (req.url === "/json/list") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
  } else {
    res.writeHead(404);
    res.end();
  }
});
srv.listen(Number(port), "127.0.0.1");
process.on("SIGTERM", () => { srv.close(); process.exit(0); });
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("spawnLightpanda", () => {
  let fakeBin: string;
  beforeAll(() => {
    fakeBin = makeFakeBinary();
  });

  it("spawns the binary on a discoverable port and reports readiness", async () => {
    const proc = await spawnLightpanda({ binary: fakeBin });
    expect(proc.port).toBeGreaterThan(0);
    expect(proc.cdpBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${proc.cdpBaseUrl}/json/list`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    await proc.close();
  });

  it("close() terminates the subprocess", async () => {
    const proc = await spawnLightpanda({ binary: fakeBin });
    await proc.close();
    await expect(fetch(`${proc.cdpBaseUrl}/json/list`)).rejects.toThrow();
  });

  it("rejects if readiness times out", async () => {
    await expect(
      spawnLightpanda({ binary: "/bin/sleep", args: ["10"], readinessTimeoutMs: 500 })
    ).rejects.toThrow(/readiness timeout/i);
  });

  it("rejects if the binary exits before readiness", async () => {
    await expect(spawnLightpanda({ binary: "/bin/true" })).rejects.toThrow(/exited before/i);
  });
});
