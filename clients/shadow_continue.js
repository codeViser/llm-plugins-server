// TypingMind extension: send the open chat into a configured shadow flow.
// The base URL and bearer stay in localStorage. This file has no host and no token.
(() => {
  const EXTENSION_ID = "shadowContinue";
  const URL_KEY = `typingmind.extension.${EXTENSION_ID}.baseUrl`;
  const TOKEN_KEY = `typingmind.extension.${EXTENSION_ID}.token`;
  const FLOWS_PATH = "/v1/flows";
  const RUNS_PATH = "/v1/runs";
  const ATTR = "data-shadow-continue";

  function folderPath(folders, folderId) {
    if (!folderId) return "(root)";
    const byId = new Map((folders || []).filter((item) => item && item.id).map((item) => [item.id, item]));
    const names = [];
    let current = byId.get(folderId);
    let guard = 0;
    while (current && guard < 8) {
      names.unshift(current.title || "?");
      current = current.parentID ? byId.get(current.parentID) : null;
      guard += 1;
    }
    return names.join("/");
  }

  function toolCalls(message) {
    return (message.tool_calls || []).map((call) => {
      const fn = call.function || {};
      return {
        id: call.id || "",
        name: fn.name || "",
        arguments: fn.arguments || ""
      };
    });
  }

  function readContent(content) {
    if (typeof content === "string") return { text: content, files: [] };
    if (!Array.isArray(content)) return { text: "", files: [] };
    const texts = [];
    const files = [];
    content.forEach((part) => {
      if (!part || typeof part !== "object") return;
      if (part.type === "text" && part.text) texts.push(String(part.text));
      if (part.type === "tm_blob_file" && part.metadata && part.metadata.name) {
        files.push({
          name: String(part.metadata.name),
          mime: String(part.metadata.type || "application/octet-stream"),
          text: typeof part.text === "string" ? part.text : "",
          syncUrl: part.sync && part.sync.url ? String(part.sync.url) : ""
        });
      }
    });
    return { text: texts.join("\n"), files };
  }

  function pushMessage(out, message) {
    const read = readContent(message.content);
    const calls = toolCalls(message);
    const text = read.text || (typeof message.pluginResponse === "string" ? message.pluginResponse : "");
    if (!text && !calls.length && message.role !== "tool") return;
    out.push({
      role: message.role || message.type || "message",
      text,
      tool_calls: calls,
      tool_call_id: message.tool_call_id || ""
    });
  }

  function scrapeChat(chat, folders) {
    const messages = (chat && chat.messages) || [];
    let summary = null;
    messages.forEach((message) => {
      if (message && message.type === "tm_context_summary") summary = message;
    });
    const attachments = [];
    messages.forEach((message) => {
      readContent(message && message.content).files.forEach((file) => attachments.push(file));
    });
    const kept = [];
    if (summary && summary.contextSummary && summary.contextSummary.content) {
      kept.push({
        role: "summary",
        text: String(summary.contextSummary.content),
        tool_calls: [],
        tool_call_id: ""
      });
      const cutoff = summary.contextSummary.contextCutOffAtUUID;
      let passed = !cutoff;
      messages.forEach((message) => {
        if (!message || message.type === "tm_context_summary") return;
        if (!passed) {
          if (message.uuid === cutoff || message.id === cutoff) passed = true;
          return;
        }
        if (message.contextClearedAt) return;
        pushMessage(kept, message);
      });
    } else {
      messages.forEach((message) => {
        if (!message || message.type === "tm_context_summary" || message.contextClearedAt) return;
        pushMessage(kept, message);
      });
    }
    return {
      path: chat && chat.folderID ? folderPath(folders, chat.folderID) : "(root)",
      starred: Boolean(chat && chat.favoritedAt != null),
      messages: kept,
      attachments
    };
  }

  const api = { folderPath, scrapeChat, readContent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document === "undefined") return;

  function idbGet(key) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const get = request.result.transaction("keyval", "readonly").objectStore("keyval").get(key);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
    });
  }

  function idbAll() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const get = request.result.transaction("keyval", "readonly").objectStore("keyval").getAll();
        get.onsuccess = () => resolve(get.result || []);
        get.onerror = () => reject(get.error);
      };
    });
  }

  function parse(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch (err) { return value; }
  }

  async function openChat() {
    const title = document.title.replace(/ - TypingMind\.com$/, "");
    const rows = await idbAll();
    for (const raw of rows) {
      const chat = parse(raw);
      if (chat && chat.chatTitle === title) return chat;
    }
    throw new Error("open chat was not found");
  }

  function folders() {
    const raw = parse(localStorage.getItem("TM_useFolderList"));
    return Array.isArray(raw) ? raw : [];
  }

  function baseUrl() {
    return (localStorage.getItem(URL_KEY) || "").replace(/\/$/, "");
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  async function captureBlob(file) {
    const button = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").includes(file.name));
    if (!button) return "";
    let captured = null;
    const originalCreate = URL.createObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (blob) {
      captured = blob;
      return originalCreate.call(URL, blob);
    };
    HTMLAnchorElement.prototype.click = function () {
      if (String(this.href || "").startsWith("blob:")) return undefined;
      return originalClick.call(this);
    };
    try {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return captured ? await blobToBase64(captured) : "";
    } catch (err) {
      return captured ? await blobToBase64(captured) : "";
    } finally {
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "");
        resolve(text.includes(",") ? text.split(",")[1] : "");
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  }

  async function withBytes(file) {
    const data = await captureBlob(file);
    return { name: file.name, mime: file.mime, text: file.text, data_base64: data };
  }

  function panel() {
    let node = document.getElementById(`${EXTENSION_ID}-panel`);
    if (node) return node;
    node = document.createElement("form");
    node.id = `${EXTENSION_ID}-panel`;
    node.hidden = true;
    node.style.cssText = "position:fixed;top:4.5rem;right:1rem;z-index:80;width:min(22rem,92vw);background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:12px;padding:0.8rem;display:grid;gap:0.45rem;";
    node.innerHTML = `
      <strong>Shadow continuation</strong>
      <label>Base URL <input name="base" type="url" autocomplete="off"></label>
      <label>Bearer <input name="token" type="password" autocomplete="off"></label>
      <label>Flow <select name="flow"></select></label>
      <label>Mode <select name="mode"></select></label>
      <p data-note style="margin:0;color:#94a3b8;font-size:0.8rem;"></p>
      <div style="display:flex;gap:0.4rem;justify-content:flex-end;">
        <button type="button" data-close>Close</button>
        <button type="submit">Start</button>
      </div>`;
    node.querySelector("[data-close]").addEventListener("click", () => { node.hidden = true; });
    node.addEventListener("submit", (event) => { event.preventDefault(); start(node); });
    document.body.appendChild(node);
    return node;
  }

  async function loadFlows(form) {
    const note = form.querySelector("[data-note]");
    const origin = baseUrl();
    const bearer = token();
    form.base.value = origin;
    form.token.value = bearer;
    form.flow.innerHTML = "";
    form.mode.innerHTML = "";
    if (!origin || !bearer) {
      note.textContent = "Save a base URL and bearer first.";
      return;
    }
    try {
      const response = await fetch(origin + FLOWS_PATH, { headers: { authorization: "Bearer " + bearer } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "flows failed");
      const flows = body.flows || [];
      const flowNames = [...new Set(flows.map((item) => item.flow))];
      const modes = [...new Set(flows.map((item) => item.specialization))];
      form.flow.innerHTML = flowNames.map((name) => `<option>${name}</option>`).join("");
      form.mode.innerHTML = modes.map((name) => `<option>${name}</option>`).join("");
      note.textContent = flows.length ? "Flows loaded from the service." : "No flows returned.";
    } catch (err) {
      note.textContent = err.message;
    }
  }

  async function start(form) {
    const note = form.querySelector("[data-note]");
    localStorage.setItem(URL_KEY, form.base.value.trim());
    localStorage.setItem(TOKEN_KEY, form.token.value);
    const origin = baseUrl();
    const bearer = token();
    if (!origin || !bearer) {
      note.textContent = "Base URL and bearer are required.";
      return;
    }
    note.textContent = "Reading this chat.";
    try {
      const chat = await openChat();
      const scraped = scrapeChat(chat, folders());
      const attachments = [];
      for (const file of scraped.attachments) attachments.push(await withBytes(file));
      const response = await fetch(origin + RUNS_PATH, {
        method: "POST",
        headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
        body: JSON.stringify({
          task: "Continue from the verbatim chat context.",
          flow: form.flow.value,
          specialization: form.mode.value,
          context: { messages: scraped.messages, attachments }
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "run failed");
      note.textContent = "Started " + (body.run_id || "run");
    } catch (err) {
      note.textContent = err.message;
    }
  }

  function inject() {
    if (document.querySelector(`[${ATTR}]`)) return;
    const header = document.querySelector('[data-element-id="chat-space-beginning-part"]');
    if (!header) return;
    const more = header.querySelector('[data-tooltip-content="More actions"]');
    if (!more) return;
    const button = document.createElement("button");
    button.setAttribute(ATTR, "1");
    button.type = "button";
    button.title = "Shadow continuation";
    button.textContent = "S";
    button.addEventListener("click", async () => {
      const form = panel();
      form.hidden = !form.hidden;
      if (!form.hidden) await loadFlows(form);
    });
    const anchor = more.closest("[data-headlessui-state]") || more;
    anchor.parentNode.insertBefore(button, anchor);
  }

  inject();
  new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: true });
})();
