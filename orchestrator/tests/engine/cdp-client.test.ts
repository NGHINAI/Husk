import { describe, expect, it, afterEach } from "vitest";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import { CdpClient } from "../../src/engine/cdp-client.js";
import { AddressInfo } from "node:net";

interface MockServer {
  url: string;
  server: WebSocketServer;
  socket: NodeWebSocket | null;
  received: any[];
  close: () => Promise<void>;
}

function startMockCdp(handler: (msg: any) => any | Promise<any>): Promise<MockServer> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const received: any[] = [];
    let socket: NodeWebSocket | null = null;
    server.on("connection", (s) => {
      socket = s;
      s.on("message", async (data) => {
        const msg = JSON.parse(data.toString());
        received.push(msg);
        const result = await handler(msg);
        if (result !== undefined) s.send(JSON.stringify(result));
      });
    });
    server.on("listening", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${addr.port}/devtools/page/test`,
        server,
        socket,
        received,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("CdpClient", () => {
  let mock: MockServer;
  let client: CdpClient;

  afterEach(async () => {
    await client?.close();
    await mock?.close();
  });

  it("connects, sends a request, and resolves with the response", async () => {
    mock = await startMockCdp((msg) => ({ id: msg.id, result: { value: 42 } }));
    client = new CdpClient(mock.url);
    await client.ready;
    const result = await client.send("Test.method", { foo: "bar" });
    expect(result).toEqual({ value: 42 });
    expect(mock.received[0]).toMatchObject({ method: "Test.method", params: { foo: "bar" } });
  });

  it("rejects when the server returns a JSON-RPC error", async () => {
    mock = await startMockCdp((msg) => ({
      id: msg.id,
      error: { code: -32000, message: "Server error" },
    }));
    client = new CdpClient(mock.url);
    await client.ready;
    await expect(client.send("Test.broken")).rejects.toThrow(/-32000.*Server error/);
  });

  it("passes sessionId through when provided", async () => {
    mock = await startMockCdp((msg) => ({ id: msg.id, sessionId: msg.sessionId, result: {} }));
    client = new CdpClient(mock.url);
    await client.ready;
    await client.send("Test.method", {}, "session-abc");
    expect(mock.received[0].sessionId).toBe("session-abc");
  });

  it("close() ends the connection", async () => {
    mock = await startMockCdp((msg) => ({ id: msg.id, result: {} }));
    client = new CdpClient(mock.url);
    await client.ready;
    await client.close();
    await expect(client.send("Test.method")).rejects.toThrow();
  });

  it("creates and attaches to a target in one helper call", async () => {
    mock = await startMockCdp((msg) => {
      if (msg.method === "Target.createTarget") {
        return { id: msg.id, result: { targetId: "target-xyz" } };
      }
      if (msg.method === "Target.attachToTarget") {
        return { id: msg.id, result: { sessionId: "session-xyz" } };
      }
      return { id: msg.id, result: {} };
    });
    client = new CdpClient(mock.url);
    await client.ready;
    const sessionId = await client.createAndAttachTarget("about:blank");
    expect(sessionId).toBe("session-xyz");
  });
});
