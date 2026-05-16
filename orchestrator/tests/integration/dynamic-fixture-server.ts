import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Fixture server for the M13 dynamic-workflows integration test.
 *
 * Routes:
 *   /                    — static page with a sign-in button, product info
 *   /dynamic-form.html   — same page (aliased for explicit URL form)
 *
 * Behaviour:
 *   The "Sign in" button click is handled entirely in client-side JS:
 *   it reveals the hidden form and after 800 ms flips the banner to "Welcome!".
 *   This exercises wait_for(text), click(intent), extract(multi), and upload.
 */
const DYNAMIC_FORM_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><title>Husk Dynamic Form Fixture</title></head>
<body>
  <h1 id="title">Dynamic Form Fixture</h1>
  <main>
    <button id="signin" aria-label="Sign in">Sign in</button>
    <form id="form" style="display:none">
      <input type="email" id="email" aria-label="Email">
      <input type="password" id="password" aria-label="Password">
      <input type="file" id="resume" aria-label="Resume">
      <button type="submit" id="submit">Submit</button>
    </form>
    <section id="banner" aria-label="Loading...">Loading...</section>
    <article>
      <h2 id="product-title">Acme Widget</h2>
      <span class="price">$19.99</span>
      <span class="stock">In stock</span>
    </article>
  </main>
  <script>
    document.getElementById('signin').addEventListener('click', function() {
      document.getElementById('form').style.display = '';
      setTimeout(function() {
        var banner = document.getElementById('banner');
        banner.textContent = 'Welcome!';
        banner.setAttribute('aria-label', 'Welcome!');
      }, 800);
    });
  </script>
</body>
</html>`;

export interface DynamicFixtureServer {
  /** Base URL, e.g. http://127.0.0.1:PORT */
  url: string;
  /** Convenience: url + /dynamic-form.html */
  formUrl: string;
  close(): Promise<void>;
}

export async function startDynamicFixtureServer(): Promise<DynamicFixtureServer> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(DYNAMIC_FORM_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  return {
    url: base,
    formUrl: `${base}/dynamic-form.html`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
