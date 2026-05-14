import { describe, expect, it } from "vitest";
import { HUSK_NATIVE_TOOLS, callHuskNativeTool, isHuskNativeTool } from "../src/husk-tools.js";

describe("HUSK_NATIVE_TOOLS", () => {
  it("declares husk_version as a tool", () => {
    const v = HUSK_NATIVE_TOOLS.find((t) => t.name === "husk_version");
    expect(v).toBeDefined();
    expect(v?.description).toMatch(/husk/i);
    expect(v?.inputSchema).toMatchObject({ type: "object" });
  });
});

describe("isHuskNativeTool", () => {
  it("recognizes husk_version", () => {
    expect(isHuskNativeTool("husk_version")).toBe(true);
  });

  it("rejects upstream-wrapped tools", () => {
    expect(isHuskNativeTool("husk_goto")).toBe(false);
    expect(isHuskNativeTool("husk_snapshot")).toBe(false);
  });

  it("rejects unknown tools", () => {
    expect(isHuskNativeTool("not_a_tool")).toBe(false);
  });
});

describe("callHuskNativeTool", () => {
  it("returns Husk + lightpanda + protocol versions for husk_version", async () => {
    const res = await callHuskNativeTool("husk_version", {}, { lightpandaVersion: "0.3.0-test" });
    expect(res.content).toBeInstanceOf(Array);
    expect(res.content[0].type).toBe("text");
    const parsed = JSON.parse((res.content[0].text ?? "") as string);
    expect(parsed.husk).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.lightpanda).toBe("0.3.0-test");
    expect(parsed.protocol).toBe("2024-11-05");
  });

  it("returns an error result for unknown native tools", async () => {
    const res = await callHuskNativeTool("not_native", {}, { lightpandaVersion: "x" });
    expect(res.isError).toBe(true);
  });
});
