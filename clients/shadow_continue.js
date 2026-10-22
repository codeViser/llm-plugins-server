// TypingMind extension: send the open chat into a configured shadow flow.
// The base URL and bearer stay in localStorage. This file has no host and no token.
(() => {
  const EXTENSION_ID = "shadowContinue";
  const URL_KEY = `typingmind.extension.${EXTENSION_ID}.baseUrl`;
  const TOKEN_KEY = `typingmind.extension.${EXTENSION_ID}.token`;
  const FLOWS_PATH = "/shadow/v1/flows";
  const RUNS_PATH = "/shadow/v1/runs";
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
    const split = splitUnanswered(kept);
    return {
      path: chat && chat.folderID ? folderPath(folders, chat.folderID) : "(root)",
      starred: Boolean(chat && chat.favoritedAt != null),
      history: split.history,
      query: split.query,
      messages: kept,
      attachments
    };
  }

  function splitUnanswered(kept) {
    if (!kept.length || kept[kept.length - 1].role !== "user") {
      return { history: kept, query: "" };
    }
    return { history: kept.slice(0, -1), query: kept[kept.length - 1].text || "" };
  }

  const api = { folderPath, scrapeChat, readContent, splitUnanswered };
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

  function addStyles() {
    if (document.getElementById("shadow-continue-styles")) return;
    const style = document.createElement("style");
    style.id = "shadow-continue-styles";
    style.textContent = `
      #shadowContinue-panel {
        position: fixed; top: 4.2rem; right: 1rem; z-index: 80;
        width: min(22rem, 92vw); display: none;
        background: #2d3748; color: #e2e8f0;
        border: 1px solid #4a5568; border-radius: 8px;
        padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      #shadowContinue-panel.is-open { display: grid; gap: 8px; }
      #shadowContinue-panel h3 { margin: 0 0 4px; font-size: 14px; font-weight: 650; }
      #shadowContinue-panel label { display: grid; gap: 4px; font-size: 12px; color: #e2e8f0; }
      #shadowContinue-panel input, #shadowContinue-panel select {
        width: 100%; box-sizing: border-box; padding: 8px 10px;
        border: 1px solid #4a5568; border-radius: 4px;
        background: #1a202c; color: #f8fafc;
        font-size: 14px; font-family: ui-monospace, monospace;
      }
      #shadowContinue-panel .row { display: flex; gap: 6px; justify-content: flex-end; }
      #shadowContinue-panel button {
        min-width: 2.2rem; padding: 6px 10px; border-radius: 4px; cursor: pointer;
        border: 1px solid #4a5568; background: #4a5568; color: #e2e8f0;
        font-size: 16px; line-height: 1;
      }
      #shadowContinue-panel button.primary { background: #38a169; border-color: #2f855a; color: #f0fff4; }
      #shadowContinue-panel [data-note] { margin: 0; min-height: 1.1rem; font-size: 12px; color: #a0aec0; }
    `;
    document.head.appendChild(style);
  }

  function panel() {
    addStyles();
    let node = document.getElementById("shadowContinue-panel");
    if (node) return node;
    node = document.createElement("form");
    node.id = "shadowContinue-panel";
    node.innerHTML = `
      <h3>Shadow continuation</h3>
      <label>Base URL <input name="base" type="url" autocomplete="off" spellcheck="false"></label>
      <label>Bearer <input name="token" type="password" autocomplete="off" spellcheck="false"></label>
      <div class="row"><button type="button" data-auth title="Authenticate" aria-label="Authenticate">⚿</button></div>
      <label>Flow <select name="flow"></select></label>
      <label>Mode <select name="mode"></select></label>
      <p data-note></p>
      <div class="row">
        <button type="button" data-close title="Close" aria-label="Close">✕</button>
        <button class="primary" type="submit" title="Start" aria-label="Start">▶</button>
      </div>`;
    node.addEventListener("click", (event) => event.stopPropagation());
    node.querySelector("[data-close]").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      node.classList.remove("is-open");
    });
    node.querySelector("[data-auth]").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      loadFlows(node);
    });
    node.addEventListener("submit", (event) => {
      event.preventDefault();
      start(node);
    });
    document.body.appendChild(node);
    return node;
  }

  async function readJson(response) {
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      throw new Error("The service returned a page instead of JSON. Check the base URL, then authenticate again.");
    }
    return JSON.parse(text);
  }

  async function loadFlows(form) {
    const note = form.querySelector("[data-note]");
    localStorage.setItem(URL_KEY, form.base.value.trim());
    localStorage.setItem(TOKEN_KEY, form.token.value);
    const origin = baseUrl();
    const bearer = token();
    form.flow.innerHTML = "";
    form.mode.innerHTML = "";
    if (!origin || !bearer) {
      note.textContent = "Enter the base URL and bearer, then authenticate.";
      return;
    }
    note.textContent = "Loading flows.";
    try {
      const response = await fetch(origin + FLOWS_PATH, { headers: { authorization: "Bearer " + bearer } });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || "flows failed");
      const flows = body.flows || [];
      const flowNames = [...new Set(flows.map((item) => item.flow))];
      const modes = [...new Set(flows.map((item) => item.specialization))];
      form.flow.innerHTML = flowNames.map((name) => `<option value="${name}">${name}</option>`).join("");
      form.mode.innerHTML = modes.map((name) => `<option value="${name}">${name}</option>`).join("");
      note.textContent = flows.length ? "Flows ready." : "No flows returned.";
    } catch (err) {
      note.textContent = err.message;
    }
  }

  async function start(form) {
    const note = form.querySelector("[data-note]");
    const origin = baseUrl();
    const bearer = token();
    if (!origin || !bearer || !form.flow.value || !form.mode.value) {
      note.textContent = "Authenticate to load flows before starting.";
      return;
    }
    note.textContent = "Reading this chat.";
    try {
      const chat = await openChat();
      const scraped = scrapeChat(chat, folders());
      if (!scraped.query) {
        note.textContent = "The chat has no unanswered user message to send.";
        return;
      }
      const attachments = [];
      for (const file of scraped.attachments) attachments.push(await withBytes(file));
      const response = await fetch(origin + RUNS_PATH, {
        method: "POST",
        headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
        body: JSON.stringify({
          task: scraped.query,
          flow: form.flow.value,
          specialization: form.mode.value,
          all_workers: form.flow.value === "adhoc",
          context: { messages: scraped.history, attachments }
        })
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || "run failed");
      const ids = body.runs ? body.runs.map((item) => item.run_id).join(", ") : (body.run_id || "run");
      note.textContent = "Started " + ids;
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
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const form = panel();
      form.base.value = baseUrl();
      form.token.value = token();
      form.classList.toggle("is-open");
    });
    const anchor = more.closest("[data-headlessui-state]") || more;
    anchor.parentNode.insertBefore(button, anchor);
  }

  inject();
  new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: true });
})();
