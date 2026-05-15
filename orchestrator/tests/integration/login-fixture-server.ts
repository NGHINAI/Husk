import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parse as parseQuery } from "node:querystring";

export interface LoginFixtureServer {
  url: string;
  close(): Promise<void>;
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Login Fixture</title></head>
<body>
  <main role="main">
    <h1>Sign in</h1>
    <form method="POST" action="/login">
      <label>Username <input type="text" name="user" /></label>
      <label>Password <input type="password" name="pass" /></label>
      <button type="submit">Sign in</button>
    </form>
  </main>
</body></html>`;

const PROTECTED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Welcome</title></head>
<body>
  <main role="main">
    <h1>Welcome back</h1>
    <p>You are signed in as <span id="user">demo</span>.</p>
  </main>
</body></html>`;

const UNAUTHORIZED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Unauthorized</title></head>
<body><main role="main"><h1>Please sign in</h1></main></body></html>`;

export async function startLoginFixture(): Promise<LoginFixtureServer> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/login" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        const fields = parseQuery(body);
        if (fields.user === "demo" && fields.pass === "secret") {
          res.setHeader("set-cookie", "husk_demo_session=valid; Path=/; HttpOnly");
          res.writeHead(303, { Location: "/protected" });
          res.end();
        } else {
          res.writeHead(401, { "content-type": "text/html" });
          res.end(`<!DOCTYPE html><html><body><h1>Wrong credentials</h1></body></html>`);
        }
      });
      return;
    }
    if (req.url === "/protected") {
      const cookie = (req.headers.cookie ?? "");
      if (cookie.includes("husk_demo_session=valid")) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(PROTECTED_HTML);
      } else {
        res.writeHead(401, { "content-type": "text/html" });
        res.end(UNAUTHORIZED_HTML);
      }
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(LOGIN_HTML);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
