// TypingMind extension: send the open chat into a configured shadow flow.
// The base URL and bearer stay in localStorage. This file has no host and no token.
(() => {
  const EXTENSION_ID = "shadowContinue";
  const URL_KEY = `typingmind.extension.${EXTENSION_ID}.baseUrl`;
  const TOKEN_KEY = `typingmind.extension.${EXTENSION_ID}.token`;
  const FLOWS_PATH = "/shadow/v1/flows";
  const RUNS_PATH = "/shadow/v1/runs";
  const CONNECTION_KEY = "shadowContinue.connectionOpen";
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

  function fileRecord(record, refId) {
    if (!record || typeof record !== "object") return null;
    const meta = record.metadata || {};
    const name = meta.name || record.name;
    if (!name) return null;
    return {
      name: String(name),
      mime: String(meta.type || "application/octet-stream"),
      text: typeof record.text === "string" ? record.text : "",
      blobId: String(meta.localBlobID || refId || record.id || ""),
      size: Number(meta.size || 0)
    };
  }

  function blobIsUsable(type, size, expectedSize, magic) {
    if (!size || size <= 32) return false;
    if (type === "text/html") return false;
    if (expectedSize && size !== expectedSize) return false;
    if (type === "application/pdf" && magic !== "%PDF-") return false;
    return true;
  }

  function attachmentPlaceholder(file) {
    if (file.text && file.text.startsWith("[File Attachment:")) return file.text;
    return "[File Attachment: " + file.name + "]";
  }

  function composeMessage(message, registry) {
    const content = message && message.content;
    const files = [];
    if (typeof content === "string") return { text: content, files };
    if (!Array.isArray(content)) {
      return { text: typeof message.pluginResponse === "string" ? message.pluginResponse : "", files };
    }
    const pieces = [];
    content.forEach((part) => {
      if (!part || typeof part !== "object") return;
      if (part.type === "text" && part.text) {
        pieces.push(String(part.text));
        return;
      }
      if (part.type === "thinking") return;
      let file = null;
      if (part.type === "tm_blob_file") file = fileRecord(part, part.id);
      else if (part.type === "tm_attachment_ref" && registry && registry[part.id]) file = fileRecord(registry[part.id], part.id);
      if (!file) return;
      files.push(file);
      pieces.push(attachmentPlaceholder(file));
    });
    let text = pieces.join("\n");
    if (!text && message && typeof message.pluginResponse === "string") text = message.pluginResponse;
    return { text, files };
  }

  function filesFromMessage(message, registry) {
    const content = message && message.content;
    if (!Array.isArray(content)) return [];
    const files = [];
    content.forEach((part) => {
      if (!part || typeof part !== "object") return;
      if (part.type === "tm_blob_file") {
        const file = fileRecord(part, part.id);
        if (file) files.push(file);
      } else if (part.type === "tm_attachment_ref" && registry && registry[part.id]) {
        const file = fileRecord(registry[part.id], part.id);
        if (file) files.push(file);
      }
    });
    return files;
  }

  function readContent(content) {
    if (typeof content === "string") return { text: content, files: [] };
    if (!Array.isArray(content)) return { text: "", files: [] };
    const texts = [];
    content.forEach((part) => {
      if (!part || typeof part !== "object") return;
      if (part.type === "text" && part.text) texts.push(String(part.text));
    });
    return { text: texts.join("\n"), files: filesFromMessage({ content }, null) };
  }

  function pushMessage(out, message, registry) {
    const read = composeMessage(message, registry);
    const files = read.files;
    const calls = toolCalls(message);
    const text = read.text;
    if (!text && !calls.length && !files.length && message.role !== "tool") return;
    out.push({
      role: message.role || message.type || "message",
      text,
      tool_calls: calls,
      tool_call_id: message.tool_call_id || "",
      files
    });
  }

  function scrapeChat(chat, folders) {
    const messages = (chat && chat.messages) || [];
    const registry = chat && chat.attachmentRegistry;
    let summary = null;
    messages.forEach((message) => {
      if (message && message.type === "tm_context_summary") summary = message;
    });
    const kept = [];
    const summarizedFiles = [];
    if (summary && summary.contextSummary && summary.contextSummary.content) {
      kept.push({
        role: "summary",
        text: String(summary.contextSummary.content),
        tool_calls: [],
        tool_call_id: "",
        files: []
      });
      const cutoff = summary.contextSummary.contextCutOffAtUUID;
      let passed = !cutoff;
      messages.forEach((message) => {
        if (!message || message.type === "tm_context_summary") return;
        if (!passed) {
          summarizedFiles.push(...composeMessage(message, registry).files);
          if (message.uuid === cutoff || message.id === cutoff) passed = true;
          return;
        }
        if (message.contextClearedAt) return;
        pushMessage(kept, message, registry);
      });
    } else {
      messages.forEach((message) => {
        if (!message || message.type === "tm_context_summary" || message.contextClearedAt) return;
        pushMessage(kept, message, registry);
      });
    }
    const split = splitUnanswered(kept);
    const queryIsLast = Boolean(kept.length) && split.history.length !== kept.length;
    const attachments = [];
    summarizedFiles.forEach((file) => attachments.push({ ...file, onQuery: false }));
    kept.forEach((message, index) => {
      const onQuery = queryIsLast && index === kept.length - 1;
      (message.files || []).forEach((file) => attachments.push({ ...file, onQuery }));
    });
    const strip = (message) => ({
      role: message.role,
      text: message.text,
      tool_calls: message.tool_calls,
      tool_call_id: message.tool_call_id
    });
    return {
      path: chat && chat.folderID ? folderPath(folders, chat.folderID) : "(root)",
      starred: Boolean(chat && chat.favoritedAt != null),
      history: split.history.map(strip),
      query: split.query,
      messages: kept.map(strip),
      attachments
    };
  }

  function splitUnanswered(kept) {
    if (!kept.length || kept[kept.length - 1].role !== "user") {
      return { history: kept, query: "" };
    }
    return { history: kept.slice(0, -1), query: kept[kept.length - 1].text || "" };
  }

  const SUMMARIZE_QUERY = "Summarize the conversation context.";

  function continuationTask(scraped) {
    if (scraped && scraped.query) return scraped.query;
    const attachments = scraped && scraped.attachments;
    if (Array.isArray(attachments) && attachments.some((file) => file && file.onQuery)) return "Use the attached files.";
    const history = scraped && scraped.history;
    if (Array.isArray(history) && history.length) return SUMMARIZE_QUERY;
    return "";
  }

  function formatStartSummary(scraped, ids, attachments) {
    const messages = (scraped && scraped.messages) || [];
    let user = 0;
    let assistant = 0;
    let tool = 0;
    let summary = 0;
    let calls = 0;
    messages.forEach((message) => {
      const role = message && message.role;
      if (role === "user") user += 1;
      else if (role === "assistant") assistant += 1;
      else if (role === "tool") tool += 1;
      else if (role === "summary") summary += 1;
      const listed = message && message.tool_calls;
      if (Array.isArray(listed)) calls += listed.length;
    });
    const files = Array.isArray(attachments) ? attachments : [];
    const fileLine = files.length
      ? files.map((file) => (file && file.name ? file.name : "file") + " · " + (file && file.bytes ? file.bytes + " bytes" : "not captured")).join("\n")
      : "No attachments";
    return [
      "Started " + (ids || "run"),
      user + " user · " + assistant + " assistant · " + tool + " tool · " + calls + " tool calls · " + summary + " summary",
      fileLine
    ].join("\n");
  }

  const api = { folderPath, scrapeChat, readContent, splitUnanswered, continuationTask, blobIsUsable, formatStartSummary };
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

  function viewButton(name) {
    return [...document.querySelectorAll("button")].find((el) => (el.getAttribute("aria-label") || "") === "View " + name);
  }

  function closeViewer() {
    const button = [...document.querySelectorAll("button")].find((el) => (el.getAttribute("aria-label") || "") === "Close");
    if (button) button.click();
  }

  async function blobMagic(blob) {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    return String.fromCharCode(...head);
  }

  async function captureByView(file) {
    let button = viewButton(file.name);
    if (!button) {
      const scroller = document.querySelector(".flex-grow.overflow-y-auto");
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 400));
        button = viewButton(file.name);
      }
    }
    if (!button) return null;
    const seen = [];
    const originalCreate = URL.createObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (blob) {
      seen.push(blob);
      return originalCreate.call(URL, blob);
    };
    HTMLAnchorElement.prototype.click = function () {
      if (String(this.href || "").startsWith("blob:")) return undefined;
      return originalClick.call(this);
    };
    try {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      for (const blob of seen) {
        const magic = blob && blob.type === "application/pdf" ? await blobMagic(blob) : "";
        if (blob && blobIsUsable(blob.type, blob.size, file.size, magic)) return blob;
      }
      return null;
    } finally {
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
      closeViewer();
    }
  }

  async function storedBlob(file) {
    if (!file.blobId) return null;
    const stored = await idbGet("BLOB_" + file.blobId);
    if (!stored || typeof stored.arrayBuffer !== "function") return null;
    const magic = stored.type === "application/pdf" ? await blobMagic(stored) : "";
    return blobIsUsable(stored.type || file.mime, stored.size, file.size, magic) ? stored : null;
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
    const blob = (await captureByView(file)) || (await storedBlob(file));
    const data = blob ? await blobToBase64(blob) : "";
    return {
      name: file.name,
      mime: file.mime,
      text: file.text,
      data_base64: data,
      bytes: blob ? blob.size : 0,
      on_query: Boolean(file.onQuery)
    };
  }

  function addStyles() {
    if (document.getElementById("shadow-continue-styles")) return;
    const style = document.createElement("style");
    style.id = "shadow-continue-styles";
    style.textContent = `
      #shadowContinue-panel {
        position: fixed; top: 3.4rem; right: 0.6rem; z-index: 80;
        width: min(18rem, 92vw); display: none;
        background: #2d3748; color: #e2e8f0;
        border: 1px solid #4a5568; border-radius: 8px;
        padding: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      #shadowContinue-panel.is-open { display: grid; gap: 6px; }
      #shadowContinue-panel h3 { margin: 0; font-size: 13px; font-weight: 650; }
      #shadowContinue-panel label { display: grid; gap: 3px; font-size: 11px; color: #e2e8f0; }
      #shadowContinue-panel input, #shadowContinue-panel select {
        width: 100%; box-sizing: border-box; padding: 6px 8px;
        border: 1px solid #4a5568; border-radius: 4px;
        background: #1a202c; color: #f8fafc;
        font-size: 12px; font-family: ui-monospace, monospace;
      }
      #shadowContinue-panel .row { display: flex; gap: 6px; justify-content: flex-end; }
      #shadowContinue-panel button {
        min-width: 2rem; padding: 5px 8px; border-radius: 4px; cursor: pointer;
        border: 1px solid #4a5568; background: #4a5568; color: #e2e8f0;
        font-size: 14px; line-height: 1;
      }
      #shadowContinue-panel button.primary { background: #38a169; border-color: #2f855a; color: #f0fff4; }
      #shadowContinue-panel [data-connection-toggle] { width: 100%; text-align: left; font-size: 11px; min-width: 0; }
      #shadowContinue-panel [data-connection] { display: grid; gap: 6px; }
      #shadowContinue-panel [data-note] { margin: 0; min-height: 1.1rem; font-size: 11px; color: #a0aec0; white-space: pre-line; }
    `;
    document.head.appendChild(style);
  }

  function connectionStoredOpen() {
    try { return localStorage.getItem(CONNECTION_KEY) !== "0"; } catch (err) { return true; }
  }

  function setConnection(form, open) {
    const block = form.querySelector("[data-connection]");
    const toggle = form.querySelector("[data-connection-toggle]");
    if (block) block.hidden = !open;
    if (toggle) toggle.textContent = open ? "Connection ▾" : "Connection ▸";
    try { localStorage.setItem(CONNECTION_KEY, open ? "1" : "0"); } catch (err) { /* private mode */ }
  }

  function panel() {
    addStyles();
    let node = document.getElementById("shadowContinue-panel");
    if (node) return node;
    node = document.createElement("form");
    node.id = "shadowContinue-panel";
    node.innerHTML = `
      <h3>Shadow continuation</h3>
      <button type="button" data-connection-toggle>Connection ▾</button>
      <div data-connection>
        <label>Base URL <input name="base" type="url" autocomplete="off" spellcheck="false"></label>
        <label>Bearer <input name="token" type="password" autocomplete="off" spellcheck="false"></label>
        <div class="row"><button type="button" data-auth title="Authenticate" aria-label="Authenticate">⚿</button></div>
      </div>
      <label>Flow <select name="flow"></select></label>
      <label>Mode <select name="mode"></select></label>
      <label>Instances <input name="instances" type="number" min="1" max="16" value="1"></label>
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
    node.querySelector("[data-connection-toggle]").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = node.querySelector("[data-connection]").hidden;
      setConnection(node, open);
    });
    node.querySelector("[data-auth]").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      loadFlows(node);
    });
    setConnection(node, connectionStoredOpen());
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
      if (flows.length) setConnection(form, false);
    } catch (err) {
      note.textContent = err && err.message === "Failed to fetch"
        ? "The browser could not reach the service. Check the base URL, then authenticate again."
        : err.message;
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
      const task = continuationTask(scraped);
      if (!task) {
        note.textContent = "This chat has no context to send.";
        return;
      }
      note.textContent = scraped.query ? "Reading this chat." : "Asking the flow to summarize this chat.";
      const attachments = [];
      for (const file of scraped.attachments) attachments.push(await withBytes(file));
      const response = await fetch(origin + RUNS_PATH, {
        method: "POST",
        headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
        body: JSON.stringify({
          task,
          flow: form.flow.value,
          specialization: form.mode.value,
          instances: Math.min(16, Math.max(1, Number(form.instances.value) || 1)),
          context: { messages: scraped.history, attachments }
        })
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || "run failed");
      const ids = body.runs ? body.runs.map((item) => item.run_id).join(", ") : (body.run_id || "run");
      note.textContent = formatStartSummary(scraped, ids, attachments);
    } catch (err) {
      note.textContent = err && err.message === "Failed to fetch"
        ? "The browser could not reach the service. Check the base URL, then authenticate again."
        : err.message;
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
