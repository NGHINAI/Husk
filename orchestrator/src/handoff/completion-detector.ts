const LOGIN_PATTERNS = [
  /\/login\b/i,
  /\/signin\b/i,
  /\/sign-in\b/i,
  /\/auth\b/i,
  /\/oauth\b/i,
  /\/2fa\b/i,
  /\/challenge\b/i,
  /\/verify\b/i,
  /\/checkpoint\b/i,
];

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isOnLoginPath(url: string): boolean {
  const u = tryParseUrl(url);
  if (!u) return false;
  return LOGIN_PATTERNS.some((re) => re.test(u.pathname));
}

function stripWww(host: string): string {
  return host.replace(/^www\./i, "");
}

/**
 * Compares two URLs' hostnames at the eTLD+1 level (approximately).
 * Either host being a subdomain of the other counts as "same domain".
 * Note: doesn't use the Public Suffix List — co.uk-style suffixes may
 * give false-positives. Acceptable for v1.
 */
export function sameDomain(targetUrl: string, observedUrl: string): boolean {
  const t = tryParseUrl(targetUrl);
  const o = tryParseUrl(observedUrl);
  if (!t || !o) return false;
  const th = stripWww(t.hostname.toLowerCase());
  const oh = stripWww(o.hostname.toLowerCase());
  if (th === oh) return true;
  // subdomain match — either way
  return oh.endsWith("." + th) || th.endsWith("." + oh);
}

/**
 * "User has finished the login flow" heuristic:
 *  - observed URL is on the same domain (or its subdomain) as the target login URL
 *  - AND observed URL is NOT on a login-y path
 *
 * Returns false on OAuth bounces (different domain) — the caller waits for
 * the URL to come back to the target domain.
 */
export function detectCompletion(targetUrl: string, observedUrl: string): boolean {
  if (!sameDomain(targetUrl, observedUrl)) return false;
  if (isOnLoginPath(observedUrl)) return false;
  return true;
}

/**
 * Build the JS source string for a tiny overlay button that POSTs to Husk's
 * /handoff/:token/seamless-done when clicked. Injected via Page.addScriptToEvaluateOnNewDocument.
 *
 * Token + port are embedded as JSON-encoded literals, so they can't break out
 * of the string boundary (XSS-safe even if the token contains quotes).
 */
export function buildOverlayScript(token: string, huskPort: number): string {
  // JSON.stringify gives us escaped string literals; numbers we pass as-is after Number coercion.
  // We encode the token at build time so the full endpoint path is a literal in the script
  // (making it easy to inspect) and so no raw token characters can break the JS string context.
  const safeToken = encodeURIComponent(String(token));
  const portJson = String(Number(huskPort));
  const endpointJson = JSON.stringify(`/handoff/${safeToken}/seamless-done`);
  return `(() => {
  if (document.getElementById("__husk_done_btn")) return;
  const btn = document.createElement("button");
  btn.id = "__husk_done_btn";
  btn.textContent = "✓ I'm done — return to agent";
  btn.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;padding:12px 20px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3)";
  btn.addEventListener("click", () => {
    fetch("http://127.0.0.1:" + ${portJson} + ${endpointJson}, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then(() => {
      btn.textContent = "✓ Returning to agent…";
      btn.disabled = true;
    }).catch((e) => {
      btn.textContent = "Husk error: " + e.message;
      btn.style.background = "#f85149";
      btn.style.color = "#fff";
    });
  });
  document.documentElement.appendChild(btn);
})();`;
}
