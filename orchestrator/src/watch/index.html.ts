export const WATCH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Husk · Watch</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --border: #30363d;
    --fg: #c9d1d9; --dim: #8b949e; --accent: #58a6ff;
    --ok: #3fb950; --bad: #f85149; --warn: #d29922;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--mono); font-size: 13px; line-height: 1.5; }
  header { padding: 10px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  header h1 { font-size: 13px; margin: 0; color: var(--accent); font-weight: 600; letter-spacing: 0.02em; }
  header .meta { color: var(--dim); }
  header input { background: var(--panel); border: 1px solid var(--border); color: var(--fg); padding: 4px 8px; border-radius: 4px; font-family: var(--mono); width: 260px; font-size: 12px; outline: none; }
  header input:focus { border-color: var(--accent); }
  main { display: grid; grid-template-columns: 1fr 380px; height: calc(100vh - 51px); }
  #tree { padding: 12px 16px; overflow: auto; }
  #log  { padding: 12px; border-left: 1px solid var(--border); overflow: auto; background: var(--panel); }
  .node { padding: 1px 0; white-space: nowrap; }
  .node .role { color: var(--accent); }
  .node .name { color: var(--fg); }
  .node .id   { color: var(--dim); font-size: 11px; margin-left: 6px; }
  .node.hl    { background: rgba(88, 166, 255, 0.16); border-left: 2px solid var(--accent); padding-left: 6px; margin-left: -8px; }
  .node.bad   { background: rgba(248, 81, 73, 0.16); border-left: 2px solid var(--bad); padding-left: 6px; margin-left: -8px; }
  .ev { padding: 8px 10px; margin-bottom: 8px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); }
  .ev .kind { color: var(--accent); font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; }
  .ev .kind.action     { color: var(--ok); }
  .ev .kind.rejection  { color: var(--bad); }
  .ev .kind.find       { color: var(--warn); }
  .ev .kind.navigation { color: var(--accent); }
  .ev .ts { color: var(--dim); font-size: 11px; margin-left: 8px; }
  .ev pre { margin: 6px 0 0 0; color: var(--fg); white-space: pre-wrap; word-break: break-word; font-size: 11px; }
  .status { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
  .status.live { background: var(--ok); color: #0d1117; }
  .status.idle { background: var(--warn); color: #0d1117; }
  .status.dead { background: var(--bad); color: #fff; }
  .status.paused { background: var(--warn); color: #0d1117; }
  .status.question { background: var(--accent); color: #0d1117; }
  .tab-list { display: inline-flex; gap: 6px; margin-left: 12px; }
  .tab-chip { padding: 2px 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 3px; font-size: 11px; color: var(--dim); text-decoration: none; }
  .tab-chip.current { color: var(--accent); border-color: var(--accent); }
  .tab-chip:hover { color: var(--fg); }
  .banner { padding: 12px 16px; border-radius: 4px; margin: 0 16px 16px; }
  .banner.question { background: rgba(88, 166, 255, 0.08); border: 1px solid var(--accent); border-left: 3px solid var(--accent); }
  .banner.handoff { background: rgba(210, 153, 34, 0.08); border: 1px solid var(--warn); border-left: 3px solid var(--warn); }
  .banner button { margin-top: 6px; padding: 6px 12px; background: var(--accent); color: #0d1117; border: none; border-radius: 4px; cursor: pointer; font-family: var(--mono); font-size: 12px; font-weight: 600; }
  .banner textarea { width: 100%; min-height: 60px; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-family: var(--mono); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>husk · /watch</h1>
  <input id="sessionId" placeholder="paste session_id…" autocomplete="off" spellcheck="false">
  <span class="meta">events: <span id="evCount">0</span></span>
  <span class="meta">url: <span id="curUrl">—</span></span>
  <span class="status idle" id="status">disconnected</span>
  <span id="tabList" class="tab-list"></span>
</header>
<div id="questionBanner" class="banner question" style="display:none"></div>
<div id="handoffBanner" class="banner handoff" style="display:none"></div>
<main>
  <section id="tree"><div class="meta">enter a session_id to begin streaming.</div></section>
  <aside id="log"></aside>
</main>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const tree = $("#tree"); const log = $("#log");
  const status = $("#status"); const evCount = $("#evCount"); const curUrl = $("#curUrl");
  let es = null; let count = 0; let lastNodes = [];
  let currentQuestion = null;
  let currentHandoff = null;

  const setStatus = (s, cls) => { status.textContent = s; status.className = "status " + cls; };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function showQuestionBanner(data) {
    currentQuestion = data;
    const banner = document.getElementById("questionBanner");
    let html = '<div><strong>Agent asks:</strong> ' + escapeHtml(data.question) + '</div>';
    if (data.options && data.options.length > 0) {
      html += '<div style="margin-top:8px">';
      data.options.forEach((opt, i) => {
        html += '<button class="opt-btn" data-token="' + escapeHtml(data.token) + '" data-index="' + i + '">' + escapeHtml(opt) + '</button> ';
      });
      html += '</div>';
    } else {
      html += '<div style="margin-top:8px"><textarea id="ans-' + escapeHtml(data.token) + '" placeholder="Type your answer…"></textarea><br><button class="answer-btn" data-token="' + escapeHtml(data.token) + '">Send answer</button></div>';
    }
    banner.innerHTML = html;
    banner.style.display = "block";
    banner.querySelectorAll(".opt-btn").forEach(btn => {
      btn.addEventListener("click", () => answerQuestion(btn.dataset.token, undefined, parseInt(btn.dataset.index, 10)));
    });
    banner.querySelectorAll(".answer-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const ta = document.getElementById("ans-" + btn.dataset.token);
        const text = ta ? ta.value : "";
        answerQuestion(btn.dataset.token, text);
      });
    });
  }

  function hideQuestionBanner() {
    currentQuestion = null;
    const b = document.getElementById("questionBanner");
    b.style.display = "none";
    b.innerHTML = "";
  }

  function showHandoffBanner(data) {
    currentHandoff = data;
    const banner = document.getElementById("handoffBanner");
    banner.innerHTML = '<div><strong>Agent needs your help:</strong> ' + escapeHtml(data.reason) + '</div>' +
      (data.suggested_action ? '<div style="margin-top:4px;color:var(--dim)">' + escapeHtml(data.suggested_action) + '</div>' : '') +
      (data.handoff_url ? '<div style="margin-top:8px"><a href="' + escapeHtml(data.handoff_url) + '" target="_blank">Open handoff page →</a></div>' : '');
    banner.style.display = "block";
  }

  function hideHandoffBanner() {
    currentHandoff = null;
    const b = document.getElementById("handoffBanner");
    b.style.display = "none";
    b.innerHTML = "";
  }

  async function answerQuestion(token, answer, index) {
    const body = {};
    if (answer !== undefined) body.answer = answer;
    if (index !== undefined) body.index = index;
    await fetch("/ask/" + encodeURIComponent(token) + "/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function renderTabList(currentSid, siblings) {
    const list = document.getElementById("tabList");
    if (!siblings || siblings.length === 0) { list.innerHTML = ""; return; }
    const all = [currentSid, ...siblings];
    list.innerHTML = all.map(id => {
      const isCurrent = id === currentSid;
      return '<a href="?s=' + encodeURIComponent(id) + '" class="tab-chip' + (isCurrent ? ' current' : '') + '">' + escapeHtml(id.slice(0, 8)) + '</a>';
    }).join(" ");
  }

  const renderTree = (nodes, highlight) => {
    tree.innerHTML = "";
    if (!nodes || nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = "(no nodes — waiting for snapshot)";
      tree.appendChild(empty);
      return;
    }
    for (const n of nodes) {
      const row = document.createElement("div");
      row.className = "node" + (n.i === highlight ? " hl" : "");
      const role = document.createElement("span");
      role.className = "role"; role.textContent = n.r || "";
      const name = document.createElement("span");
      name.className = "name"; name.textContent = " " + (n.n || "");
      const id = document.createElement("span");
      id.className = "id"; id.textContent = n.i || "";
      row.appendChild(role); row.appendChild(name); row.appendChild(id);
      tree.appendChild(row);
    }
  };

  const addEvent = (ev) => {
    count++; evCount.textContent = count;
    const row = document.createElement("div");
    row.className = "ev";
    const cls = ev.kind === "rejection" ? "rejection"
              : ev.kind === "action"   ? "action"
              : ev.kind === "find"     ? "find"
              : ev.kind === "navigation" ? "navigation"
              : "";
    const kind = document.createElement("span");
    kind.className = "kind " + cls; kind.textContent = ev.kind;
    const ts = document.createElement("span");
    ts.className = "ts"; ts.textContent = new Date(ev.ts).toLocaleTimeString();
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(ev, null, 2);
    row.appendChild(kind); row.appendChild(ts); row.appendChild(pre);
    log.prepend(row);
    while (log.children.length > 100) log.lastChild.remove();
    if (ev.kind === "navigation") curUrl.textContent = ev.url;
    if (ev.kind === "action") renderTree(lastNodes, ev.stable_id);
  };

  const fetchSnapshot = (sid) => {
    fetch("/v1/jsonrpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "snapshot", params: { session_id: sid, max_age_ms: 0 } }),
    })
      .then((r) => r.json())
      .then((s) => {
        if (s.result && s.result.root) {
          lastNodes = flatten(s.result.root);
          renderTree(lastNodes);
          const siblings = s.result.sibling_sessions || [];
          renderTabList(sid, siblings);
        }
      })
      .catch(() => {});
  };

  const flatten = (root) => {
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (n.i) out.push({ i: n.i, r: n.r, n: n.n });
      if (n.c) for (const child of n.c) walk(child);
    };
    walk(root);
    return out;
  };

  const connect = (sessionId) => {
    if (es) es.close();
    setStatus("connecting…", "idle");
    es = new EventSource("/watch/stream/" + encodeURIComponent(sessionId));
    es.onopen = () => setStatus("live", "live");
    es.onerror = () => setStatus("disconnected", "dead");
    for (const kind of ["snapshot", "action", "rejection", "navigation", "find"]) {
      es.addEventListener(kind, (e) => {
        const data = JSON.parse(e.data);
        addEvent(data);
        if (kind === "snapshot") fetchSnapshot(sessionId);
      });
    }
    es.addEventListener("pending_question", (e) => {
      const data = JSON.parse(e.data);
      showQuestionBanner(data);
      setStatus("needs answer", "question");
    });
    es.addEventListener("pending_handoff", (e) => {
      const data = JSON.parse(e.data);
      showHandoffBanner(data);
      setStatus("paused (handoff)", "paused");
    });
    es.addEventListener("resolved", (e) => {
      const data = JSON.parse(e.data);
      if (data.kind_resolved === "question") hideQuestionBanner();
      if (data.kind_resolved === "handoff") hideHandoffBanner();
      if (!currentQuestion && !currentHandoff) setStatus("live", "live");
    });
  };

  $("#sessionId").addEventListener("change", (e) => connect(e.target.value.trim()));
  const fromUrl = new URLSearchParams(location.search).get("s");
  if (fromUrl) { $("#sessionId").value = fromUrl; connect(fromUrl); }
})();
</script>
</body>
</html>`;
