import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * In-process HTTP server that serves a single fixture page on /.
 * Required because lightpanda doesn't accept file:// URLs (per T7 spike finding).
 */
export const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Husk M2 E2E Fixture</title></head>
<body>
  <main role="main">
    <h1>Hello Husk</h1>
    <button type="submit">Submit Application</button>
    <button type="button" disabled>Disabled Button</button>
    <label><input type="checkbox" id="agree"> I agree</label>
  </main>
</body>
</html>`;

export interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
