export const HANDOFF_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Husk · Handoff</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --border: #30363d;
    --fg: #c9d1d9; --dim: #8b949e; --accent: #58a6ff;
    --ok: #3fb950; --bad: #f85149; --warn: #d29922;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font-family: var(--mono); font-size: 13px; line-height: 1.6; max-width: 720px; margin-left: auto; margin-right: auto; }
  h1 { font-size: 16px; color: var(--accent); margin: 0 0 16px; }
  .reason { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--warn); padding: 12px 16px; border-radius: 4px; margin-bottom: 24px; }
  .reason .label { color: var(--warn); text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; font-weight: 600; }
  .suggested { color: var(--dim); margin-top: 6px; }
  .primary-open { display: block; padding: 16px 20px; background: var(--accent); color: #0d1117; border-radius: 6px; text-decoration: none; margin: 0 0 32px 0; transition: filter 0.15s; }
  .primary-open:hover { filter: brightness(1.1); }
  .primary-open-label { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; }
  .primary-open-url { font-size: 12px; opacity: 0.85; margin-top: 4px; word-break: break-all; }
  .step-section { opacity: 0.85; }
  h2 { font-size: 13px; color: var(--fg); margin: 24px 0 8px; }
  .step { background: var(--panel); border: 1px solid var(--border); padding: 12px; border-radius: 4px; margin-bottom: 10px; }
  .step .num { font-size: 16px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: var(--accent); color: #0d1117; border-radius: 50%; margin-right: 10px; flex-shrink: 0; }
  .bookmarklet { display: inline-block; padding: 6px 12px; background: var(--ok); color: #0d1117; border-radius: 4px; text-decoration: none; font-weight: 600; cursor: grab; }
  textarea { width: 100%; min-height: 80px; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-family: var(--mono); font-size: 12px; }
  button { background: var(--ok); color: #0d1117; border: none; padding: 10px 20px; border-radius: 4px; font-family: var(--mono); font-weight: 600; cursor: pointer; font-size: 13px; }
  button:hover { filter: brightness(1.1); }
  button.secondary { background: var(--panel); color: var(--fg); border: 1px solid var(--border); }
  .status { padding: 8px 12px; border-radius: 4px; margin-top: 16px; font-size: 12px; }
  .status.success { background: rgba(63, 185, 80, 0.12); border-left: 3px solid var(--ok); }
  .status.error { background: rgba(248, 81, 73, 0.12); border-left: 3px solid var(--bad); }
  .meta { color: var(--dim); font-size: 11px; }
</style>
</head>
<body>
<h1>Husk · agent needs your help</h1>

<div class="reason">
  <div class="label">__REASON__</div>
  <div class="suggested">__SUGGESTED__</div>
</div>

<a class="primary-open" href="__CURRENT_URL__" target="_blank" rel="noopener">
  <div class="primary-open-label">① Open in your browser</div>
  <div class="primary-open-url">__CURRENT_URL__</div>
</a>

<div class="step-section">
  <h2>② After you've logged in / completed the action...</h2>

  <div class="step">
    <span class="num">A</span><strong>Bookmarklet (recommended)</strong> — drag this to your bookmarks bar:
    <br><br>
    <a class="bookmarklet" href='__BOOKMARKLET__'>Send cookies to Husk</a>
    <br><br>
    <span class="meta">Then: click the bookmarklet on the target site's tab. It POSTs document.cookie back to Husk and resumes the agent automatically.</span>
  </div>

  <div class="step">
    <span class="num">B</span><strong>Paste from devtools</strong> (for HttpOnly cookies):
    <br>
    <textarea id="paste" placeholder="Paste cookies here AFTER logging in (open devtools → Application → Cookies → select all → copy)"></textarea>
    <br><br>
    <button onclick="resumeWithPaste()">Send cookies back & resume agent</button>
    <br>
    <span class="meta"><i>Use this when the site has HttpOnly cookies (LinkedIn, GitHub, Gmail) — the bookmarklet won't work for those.</i></span>
  </div>

  <div class="step">
    <span class="num">C</span><strong>No cookies needed</strong> — just click below to resume the agent.
    <br><br>
    <button class="secondary" onclick="resumeNoCookies()">Resume agent (no cookie transfer)</button>
  </div>
</div>

<div id="status"></div>

<script>
(() => {
  const TOKEN = "__TOKEN__";
  const $ = (s) => document.querySelector(s);
  const status = $("#status");

  const setStatus = (msg, cls) => {
    status.className = "status " + cls;
    status.textContent = msg;
  };

  const parseCookies = (raw) => {
    if (!raw.trim()) return [];
    return raw.split(/\\n|;/).map(s => s.trim()).filter(Boolean).map(s => {
      const [name, ...rest] = s.split("=");
      return { name: name.trim(), value: rest.join("=").trim() };
    }).filter(c => c.name);
  };

  const post = async (body) => {
    try {
      const r = await fetch("/handoff/" + encodeURIComponent(TOKEN) + "/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.ok) setStatus("Resumed. You can close this tab.", "success");
      else setStatus("Error: " + (j.error || "unknown"), "error");
    } catch (e) {
      setStatus("Error: " + e.message, "error");
    }
  };

  window.resumeNoCookies = () => post({ note: "no cookies" });

  window.resumeWithPaste = () => {
    const cookies = parseCookies($("#paste").value);
    post({ cookies, note: "pasted cookies (" + cookies.length + ")" });
  };
})();
</script>
</body>
</html>`;

/**
 * Generate the bookmarklet href for a given token + orchestrator origin.
 * The bookmarklet runs on the page the user is on (NOT this handoff page).
 * It captures document.cookie for that domain and POSTs it back to Husk's handoff/resume endpoint.
 */
export function bookmarkletFor(token: string, origin: string): string {
  const script = `(function(){fetch("${origin}/handoff/${encodeURIComponent(token)}/resume",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({cookies:document.cookie.split(";").map(s=>{var i=s.indexOf("=");return{name:s.slice(0,i).trim(),value:s.slice(i+1).trim()}}),note:"from bookmarklet @ "+location.hostname})}).then(()=>{alert("Cookies sent to Husk. Agent resumed.")}).catch(e=>alert("Husk handoff error: "+e.message))})()`;
  return `javascript:${encodeURIComponent(script)}`;
}
