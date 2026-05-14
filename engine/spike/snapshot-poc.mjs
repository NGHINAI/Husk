// snapshot-poc.mjs — M2 spike proof-of-concept.
//
// Goal: connect to a running lightpanda CDP server, navigate to our
// fixture.html, call Accessibility.getFullAXTree, and emit a
// spec-§5.2-style JSON-LD snapshot.
//
// This is exploratory — the final v0 design lives in the orchestrator,
// not here. This PoC proves we can drive the engine and get useful
// data out using ONLY upstream's existing CDP methods (no engine patches).
//
// Lightpanda's AX tree (from Accessibility.getFullAXTree) encodes state as:
//   - role:    n.role.value   (e.g. "button", "textbox", "checkbox")
//   - name:    n.name.value   (accessible name)
//   - xpath:   not in AX tree — must be derived from SemanticTree or DOM
//   - disabled: absence of "focusable" property on normally-interactive roles
//   - checked:  n.properties[].name==="checked" → value.value
//
// The companion `fetch --dump semantic_tree` path also works end-to-end and
// includes xpath + isDisabled directly in each node. Both paths confirmed.

import WebSocket from "ws";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// CDP target — lightpanda's --port (default 9222)
const CDP_HOST = process.env.LIGHTPANDA_HOST ?? "127.0.0.1";
const CDP_PORT = process.env.LIGHTPANDA_PORT ?? "9222";
const FIXTURE_URL = process.env.FIXTURE_URL ?? `http://127.0.0.1:8765/fixture.html`;

// Compute a Husk-spec-§5.1-style stable_id from role + name.
// Final impl uses blake3; this PoC uses SHA-256/base64url slice as a stand-in.
function stableId(role, name) {
  const h = createHash("sha256")
    .update(`${role}\0${name}`)
    .digest("base64url");
  return `${role}:${h.slice(0, 12)}`;
}

// Roles that are interactive by nature and use focusable to indicate enabled state.
const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio", "combobox",
  "listbox", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
  "slider", "spinbutton", "switch", "tab", "treeitem",
]);

// Roles that add no semantic value and should be skipped (but their subtrees traversed).
const PASSTHROUGH_ROLES = new Set(["InlineTextBox", "none", "generic", "StaticText"]);

// Collect semantic children by skipping-through passthrough roles.
// This prevents wrapper elements like <html>, <div>, <span> from being
// emitted while still surfacing their meaningful descendants.
function collectSemanticChildren(axNode, allNodesById) {
  const result = [];
  for (const cid of axNode.childIds ?? []) {
    const child = allNodesById.get(cid);
    if (!child) continue;
    const childRole = child.role?.value ?? "generic";
    if (PASSTHROUGH_ROLES.has(childRole)) {
      // Skip this node but recurse through it
      result.push(...collectSemanticChildren(child, allNodesById));
    } else {
      result.push(transformNode(child, allNodesById));
    }
  }
  return result;
}

// Transform a CDP AXNode into spec-§5.2 short-key object.
// State flags: "e"=enabled, "d"=disabled, "c"=checked, "f"=focusable
function transformNode(axNode, allNodesById) {
  const role = axNode.role?.value ?? "generic";
  const name = axNode.name?.value ?? "";
  const id = stableId(role, name);

  const state = [];
  const focusable = axNode.properties?.find(p => p.name === "focusable")?.value?.value;
  const checkedProp = axNode.properties?.find(p => p.name === "checked")?.value?.value;

  if (INTERACTIVE_ROLES.has(role)) {
    // Disabled = interactive role but no focusable property
    state.push(focusable ? "e" : "d");
  }
  if (focusable) state.push("f");
  if (checkedProp === true || checkedProp === "true") state.push("c");

  const out = { i: id, r: role };
  if (name) out.n = name;
  if (state.length) out.s = state;

  const children = collectSemanticChildren(axNode, allNodesById);
  if (children.length) out.c = children;
  return out;
}

// Minimal CDP browser-level client.
// Lightpanda uses a flat multiplex model: create target → attach → sessionId.
function newBrowserClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const browserPending = new Map();
  const sessionPending = new Map(); // sessionId → Map<id, {resolve,reject}>

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.sessionId) {
      const sp = sessionPending.get(msg.sessionId);
      if (sp && msg.id != null && sp.has(msg.id)) {
        const { resolve, reject } = sp.get(msg.id);
        sp.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : resolve(msg.result);
      }
      // Session events are silently dropped in this PoC
    } else if (msg.id != null && browserPending.has(msg.id)) {
      const { resolve, reject } = browserPending.get(msg.id);
      browserPending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : resolve(msg.result);
    }
  });

  const ready = new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });

  return {
    ready,
    send: (method, params) => {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params: params ?? {} }));
      return new Promise((ok, err) => browserPending.set(id, { resolve: ok, reject: err }));
    },
    sendSession: (sessionId, method, params) => {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params: params ?? {}, sessionId }));
      if (!sessionPending.has(sessionId)) sessionPending.set(sessionId, new Map());
      return new Promise((ok, err) => sessionPending.get(sessionId).set(id, { resolve: ok, reject: err }));
    },
    close: () => ws.close(),
  };
}

async function main() {
  const wsUrl = `ws://${CDP_HOST}:${CDP_PORT}/`;
  console.log("[poc] connecting to lightpanda CDP:", wsUrl);

  const cdp = newBrowserClient(wsUrl);
  await cdp.ready;
  console.log("[poc] connected");

  // Create a fresh page target
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  console.log("[poc] created target:", targetId);

  // Attach to it — this gives us a sessionId for multiplexed commands
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  console.log("[poc] session:", sessionId);

  // Enable CDP domains
  await cdp.sendSession(sessionId, "Page.enable");
  await cdp.sendSession(sessionId, "Accessibility.enable");
  console.log("[poc] domains enabled");

  // Navigate to fixture
  console.log("[poc] navigating to", FIXTURE_URL);
  const navResult = await cdp.sendSession(sessionId, "Page.navigate", { url: FIXTURE_URL });
  console.log("[poc] navigation frameId:", navResult.frameId, "loaderId:", navResult.loaderId);

  // Wait for page load (crude but sufficient for PoC — real impl uses Page.loadEventFired)
  await new Promise(r => setTimeout(r, 1500));

  // Fetch the full accessibility tree
  console.log("[poc] calling Accessibility.getFullAXTree...");
  const { nodes } = await cdp.sendSession(sessionId, "Accessibility.getFullAXTree");
  const rawBytes = JSON.stringify({ nodes }).length;
  console.log(`[poc] raw AXTree: ${nodes.length} nodes, ${rawBytes} bytes`);

  // Build lookup map by nodeId
  const byId = new Map(nodes.map(n => [n.nodeId, n]));

  // Find root (no parentId)
  const root = nodes.find(n => !n.parentId) ?? nodes[0];

  // Transform to spec-§5.2 shape
  const snapshot = {
    "@context": "https://schema.husk.dev/semantic-snapshot/v0",
    "@type": "SemanticSnapshot",
    "url": FIXTURE_URL,
    "capturedAt": new Date().toISOString(),
    "engine": "lightpanda/0.3.0",
    "method": "CDP/Accessibility.getFullAXTree",
    "note": "PoC — stable_id uses SHA-256 substr, not blake3; no bounding rects; no landmark_path",
    "tree": transformNode(root, byId),
  };

  const snapshotBytes = JSON.stringify(snapshot).length;
  const compressionRatio = ((1 - snapshotBytes / rawBytes) * 100).toFixed(1);
  console.log(`[poc] spec-§5.2 snapshot: ${snapshotBytes} bytes (${compressionRatio}% smaller than raw)`);
  console.log("\n[poc] === SNAPSHOT OUTPUT ===");
  console.log(JSON.stringify(snapshot, null, 2));

  cdp.close();
}

main().catch((err) => {
  console.error("[poc] FAILED:", err.message);
  console.error(err.stack);
  process.exitCode = 1;
});
