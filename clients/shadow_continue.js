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
    const inline = record.type === "tm_text_file" && typeof record.text === "string" && !isPlaceholder(record.text) ? record.text : "";
    let size = Number(meta.size || 0);
    if (!size && inline) size = new Blob([inline]).size;
    const mime = String(meta.type || (record.type === "tm_text_file" ? "text/plain" : record.type === "tm_image_file" ? "image/jpeg" : "application/octet-stream"));
    return {
      name: String(name),
      mime,
      text: isPlaceholder(record.text) ? String(record.text) : "",
      inline,
      blobId: String(meta.localBlobID || refId || record.id || ""),
      size,
      record
    };
  }

  function mimeOf(type) {
    return String(type || "").split(";")[0].trim().toLowerCase();
  }

  function blobIsUsable(type, size, expectedSize, magic, expectedType) {
    const declared = checkedMime(type, expectedType);
    if (!size) return false;
    if (expectedSize && size !== expectedSize) return false;
    if (!expectedSize && size <= 32) return false;
    if (!prefixOk(declared, magic)) return false;
    return true;
  }

  function checkedMime(type, expectedType) {
    const mime = mimeOf(type);
    const expected = mimeOf(expectedType);
    if (mime && mime !== "application/octet-stream") return mime;
    return expected || mime;
  }

  function binaryMime(mime) {
    const kind = mimeOf(mime);
    return kind === "application/pdf" || kind.indexOf("image/") === 0 || kind === "application/zip" || kind === "application/x-zip-compressed" || kind.indexOf("officedocument") >= 0;
  }

  function prefixOk(mime, magic) {
    const kind = mimeOf(mime);
    if (!kind || kind.indexOf("text/") === 0 || kind === "application/json" || kind === "application/xml" || kind.slice(-5) === "+json" || kind.slice(-4) === "+xml") return true;
    if (!magic) return !binaryMime(kind);
    const b0 = magic.charCodeAt(0);
    const b1 = magic.charCodeAt(1);
    if (kind === "application/pdf") return magic.indexOf("%PDF-") === 0;
    if (kind === "image/jpeg" || kind === "image/jpg") return b0 === 255 && b1 === 216;
    if (kind === "image/png") return b0 === 137 && magic.slice(1, 4) === "PNG";
    if (kind === "image/gif") return magic.indexOf("GIF8") === 0;
    if (kind === "image/webp") return magic.indexOf("RIFF") === 0;
    if (kind === "application/zip" || kind === "application/x-zip-compressed" || kind.indexOf("officedocument") >= 0) return magic.indexOf("PK") === 0;
    return true;
  }

  function isPlaceholder(text) {
    return typeof text === "string" && (text.indexOf("[File Attachment:") === 0 || text.indexOf("[Image Attachment") === 0);
  }

  function blobFromDataUrl(value) {
    if (typeof value !== "string") return null;
    const comma = value.indexOf(",");
    if (!value.startsWith("data:") || comma < 0) return null;
    const meta = value.slice(5, comma);
    const body = value.slice(comma + 1);
    const mime = meta.split(";")[0] || "application/octet-stream";
    let binary = "";
    try {
      binary = meta.includes("base64") ? atob(body) : decodeURIComponent(body);
    } catch (err) {
      return null;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 255;
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  function blobFromLocalValue(value, mime) {
    if (value == null) return null;
    if (typeof Blob === "function" && value instanceof Blob) return value;
    if (typeof value === "string") {
      if (value.startsWith("data:")) return blobFromDataUrl(value);
      if (binaryMime(mime)) return null;
      return new Blob([value], { type: mime || "text/plain" });
    }
    if (typeof value !== "object") return null;
    if (value.value !== undefined && (Object.prototype.hasOwnProperty.call(value, "expireAt") || Object.prototype.hasOwnProperty.call(value, "cacheGroup"))) {
      return blobFromLocalValue(value.value, mime);
    }
    if (typeof value.base64 === "string") {
      const decoded = blobFromDataUrl(value.base64);
      if (decoded) return decoded;
    }
    if (typeof value.rawText === "string" && value.rawText && !binaryMime(mime)) return new Blob([value.rawText], { type: mime || "text/plain" });
    return null;
  }

  function blobFromStoredRecord(stored, mime) {
    if (stored == null) return null;
    if (typeof Blob === "function" && stored instanceof Blob) return stored;
    const bytes = stored && stored.bytes !== undefined ? stored.bytes : null;
    const type = (stored && stored.mime) || mime || "application/octet-stream";
    if (bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes)) return new Blob([bytes], { type });
    return null;
  }

  function localCacheKeys(file) {
    const ids = [];
    const add = (id) => {
      const text = id == null ? "" : String(id);
      if (text && !ids.includes(text)) ids.push(text);
    };
    add(file && file.blobId);
    add(file && file.record && file.record.id);
    add(file && file.record && file.record.metadata && file.record.metadata.localBlobID);
    const keys = [];
    ids.forEach((id) => {
      keys.push("BLOB_" + id);
      keys.push("CLIENT_CACHE_attachment-" + id);
      keys.push("CLIENT_CACHE_attachment-" + id + "-full-text");
    });
    return keys;
  }

  function attachmentPlaceholder(file) {
    if (file.text && isPlaceholder(file.text)) return file.text;
    if (mimeOf(file.mime).indexOf("image/") === 0) return "[Image Attachment: " + file.name + "]";
    return "[File Attachment: " + file.name + "]";
  }

  function fileFromPart(part, registry) {
    if (!part || typeof part !== "object") return null;
    if (part.type === "tm_blob_file" || part.type === "tm_image_file" || part.type === "tm_text_file") return fileRecord(part, part.id);
    if (part.type === "tm_attachment_ref" && registry && registry[part.id]) return fileRecord(registry[part.id], part.id);
    return null;
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
      const file = fileFromPart(part, registry);
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
      const file = fileFromPart(part, registry);
      if (file) files.push(file);
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

  function summaryText(message) {
    const text = message && message.contextSummary && message.contextSummary.content;
    return typeof text === "string" ? text : "";
  }

  function summaryHasBody(text) {
    return text.replace(/<\/?CONVERSATION_SUMMARY>/g, "").trim().length > 0;
  }

  function lastUsableSummary(messages) {
    let chosen = null;
    messages.forEach((message) => {
      if (!message || message.type !== "tm_context_summary") return;
      if (summaryHasBody(summaryText(message))) chosen = message;
    });
    return chosen;
  }

  function preContextNote(files) {
    const lines = files.map((file) => "- " + file.name);
    return {
      role: "files",
      text: [
        "Pre-context summarization documents.",
        "These files were attached before the last context summary. Their original turns are not repeated.",
        lines.join("\n")
      ].join("\n"),
      tool_calls: [],
      tool_call_id: "",
      files: []
    };
  }

  function lastClearContextIndex(messages) {
    let index = -1;
    messages.forEach((message, i) => {
      if (message && message.type === "clear-context") index = i;
    });
    return index;
  }

  function scrapeChat(chat, folders) {
    const messages = (chat && chat.messages) || [];
    const registry = chat && chat.attachmentRegistry;
    const summary = lastUsableSummary(messages);
    const clearIndex = lastClearContextIndex(messages);
    const kept = [];
    const summarizedFiles = [];
    const blocked = (index) => clearIndex >= 0 && index <= clearIndex;
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
      messages.forEach((message, index) => {
        if (!message || message.type === "tm_context_summary" || message.type === "clear-context") return;
        if (blocked(index)) {
          if (message.uuid === cutoff || message.id === cutoff) passed = true;
          return;
        }
        if (!passed) {
          summarizedFiles.push(...composeMessage(message, registry).files);
          if (message.uuid === cutoff || message.id === cutoff) passed = true;
          return;
        }
        if (message.contextClearedAt) return;
        pushMessage(kept, message, registry);
      });
    } else {
      messages.forEach((message, index) => {
        if (!message || message.type === "tm_context_summary" || message.type === "clear-context") return;
        if (blocked(index) || message.contextClearedAt) return;
        pushMessage(kept, message, registry);
      });
    }
    const unanswered = Boolean(kept.length) && kept[kept.length - 1].role === "user";
    if (summarizedFiles.length) {
      const note = preContextNote(summarizedFiles);
      if (unanswered) kept.splice(kept.length - 1, 0, note);
      else kept.push(note);
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

  function runsReady(flowCount) {
    return Number(flowCount) > 0;
  }

  function parse(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch (err) { return value; }
  }

  function chatIdFromLocation(href) {
    const match = String(href || "").match(/[#?&/]chat=([^&#/]+)/);
    if (!match) return "";
    try { return decodeURIComponent(match[1]); } catch (err) { return match[1]; }
  }

  function newestChat(list) {
    return list.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
  }

  function findOpenChat(rows, title, chatId) {
    const chats = [];
    for (const raw of rows || []) {
      const chat = parse(raw);
      if (!chat || typeof chat !== "object" || Array.isArray(chat)) continue;
      if (!chat.chatID && !chat.messages && chat.chatTitle == null) continue;
      chats.push(chat);
    }
    const wanted = String(chatId || "");
    if (wanted) {
      const byChatId = chats.filter((chat) => String(chat.chatID || "") === wanted && !chat.deletedAt);
      if (byChatId.length) return newestChat(byChatId);
      const byId = chats.filter((chat) => String(chat.id || "") === wanted && !chat.deletedAt);
      if (byId.length) return newestChat(byId);
    }
    const stripped = String(title || "").replace(/ - TypingMind\.com$/, "").trim();
    // "New Chat" is TypingMind's placeholder before title generation. It is not unique.
    if (!stripped || stripped === "New Chat" || stripped === "Chat" || stripped === "TypingMind" || stripped.startsWith("TypingMind —") || stripped.startsWith("TypingMind - Advanced")) {
      return null;
    }
    const titled = chats.filter((chat) => chat.chatTitle === stripped && !chat.deletedAt && chat.chatTitle !== "New Chat");
    return titled.length === 1 ? titled[0] : null;
  }

  const api = { folderPath, scrapeChat, readContent, splitUnanswered, continuationTask, blobIsUsable, blobFromLocalValue, blobFromStoredRecord, localCacheKeys, formatStartSummary, runsReady, chatIdFromLocation, findOpenChat };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document === "undefined") return;

  function idbFactory() {
    return indexedDB || window.webkitIndexedDB || window.mozIndexedDB || null;
  }

  function idbGet(key) {
    return new Promise((resolve, reject) => {
      const factory = idbFactory();
      if (!factory) { reject(new Error("indexedDB unavailable")); return; }
      const request = factory.open("keyval-store");
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
      const factory = idbFactory();
      if (!factory) { reject(new Error("indexedDB unavailable")); return; }
      const request = factory.open("keyval-store");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const get = request.result.transaction("keyval", "readonly").objectStore("keyval").getAll();
        get.onsuccess = () => resolve(get.result || []);
        get.onerror = () => reject(get.error);
      };
    });
  }

  async function openChat() {
    const rows = await idbAll();
    const chat = findOpenChat(rows, document.title, chatIdFromLocation(location.href));
    if (!chat) throw new Error("open chat was not found");
    return chat;
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

  function labeled(label) {
    const nodes = document.querySelectorAll("[aria-label]");
    for (let i = 0; i < nodes.length; i += 1) {
      if ((nodes[i].getAttribute("aria-label") || "") === label) return nodes[i];
    }
    return null;
  }

  function viewButton(name) {
    return labeled("View " + name);
  }

  function downloadButton() {
    return labeled("Download attachment") || labeled("Download file") || labeled("Save attachment") || labeled("Download image");
  }

  function closeViewer() {
    const panel = labeled("Close attachment panel") || labeled("Close image viewer");
    if (panel && typeof panel.click === "function") panel.click();
    const button = labeled("Close");
    if (button && !button.closest("#shadowContinue-panel") && typeof button.click === "function") button.click();
  }

  function viewerOpener() {
    const nodes = document.querySelectorAll("[aria-label]");
    let button = null;
    for (let i = 0; i < nodes.length; i += 1) {
      const label = nodes[i].getAttribute("aria-label") || "";
      if (label.startsWith("View ") && label !== "View assistant") { button = nodes[i]; break; }
    }
    if (!button) return null;
    const fiberKey = Object.keys(button).find((key) => key.startsWith("__reactFiber"));
    let node = fiberKey ? button[fiberKey] : null;
    let guard = 0;
    while (node && guard < 80) {
      const props = node.memoizedProps;
      if (props && typeof props.onViewAttachment === "function") return props.onViewAttachment;
      node = node.return;
      guard += 1;
    }
    return null;
  }

  async function blobMagic(blob) {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    return String.fromCharCode(...head);
  }

  // Public file. No cloud key, host, or file URL is read or stored.
  // A click lets this page load the attachment. The body that arrives is copied
  // into a local Blob and kept on this device. The request address is ignored.
  async function observeBlobs(action, file) {
    const seen = [];
    const named = [];
    const pending = [];
    let last = null;
    const originalCreate = URL.createObjectURL;
    const originalFetch = window.fetch;
    const webkit = window.webkitURL;
    const originalWebkit = webkit && webkit.createObjectURL !== URL.createObjectURL ? webkit.createObjectURL : null;
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalShare = navigator.share;
    const originalOpen = window.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const note = (blob, name) => {
      if (!blob) return;
      last = blob;
      seen.push(blob);
      if (name) named.push({ name: String(name), blob });
    };
    URL.createObjectURL = function (blob) {
      note(blob, "");
      return originalCreate.call(URL, blob);
    };
    if (originalWebkit) {
      webkit.createObjectURL = function (blob) {
        note(blob, "");
        return originalWebkit.call(webkit, blob);
      };
    }
    window.fetch = function () {
      return Promise.resolve(originalFetch.apply(this, arguments)).then((response) => {
        try {
          if (response && response.type !== "opaque" && typeof response.clone === "function") {
            pending.push(response.clone().blob().then((blob) => {
              if (blob && blob.size) note(blob, "");
            }).catch(() => {}));
          }
        } catch (err) { /* the page still receives its response */ }
        return response;
      });
    };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", () => {
        try {
          const body = this.response;
          if (typeof Blob === "function" && body instanceof Blob) note(body, "");
          else if (body instanceof ArrayBuffer) note(new Blob([body]), "");
        } catch (err) { /* ignore a body the page did not expose */ }
      });
      return originalSend.apply(this, arguments);
    };
    HTMLAnchorElement.prototype.click = function () {
      if (last) named.push({ name: this.download || "", blob: last });
      const href = String(this.href || "");
      if (href.startsWith("blob:") || href.startsWith("data:") || this.download) return undefined;
      return originalClick.call(this);
    };
    window.open = function (url) {
      const text = typeof url === "string" ? url : "";
      if (text.indexOf("blob:") === 0 || text.indexOf("data:") === 0) {
        pending.push(originalFetch(text).then((response) => response.blob()).then((blob) => {
          if (blob) note(blob, "");
        }).catch(() => {}));
      }
      return null;
    };
    if (typeof originalShare === "function") {
      const wrapped = function (data) {
        const files = data && data.files;
        if (files && typeof files.length === "number") {
          for (let i = 0; i < files.length; i += 1) note(files[i], files[i] && files[i].name);
        }
        return Promise.resolve();
      };
      try { navigator.share = wrapped; } catch (err) { /* leave the page share intact */ }
    }
    async function displayedLocalBlobs() {
      const nodes = document.querySelectorAll("img, video, audio, source");
      for (let i = 0; i < nodes.length; i += 1) {
        const src = nodes[i].currentSrc || nodes[i].src || "";
        if (typeof src !== "string") continue;
        if (src.indexOf("data:") === 0) {
          const blob = blobFromDataUrl(src);
          if (blob) note(blob, "");
        } else if (src.indexOf("blob:") === 0) {
          try {
            const response = await originalFetch(src);
            const blob = await response.blob();
            if (blob) note(blob, "");
          } catch (err) { /* a revoked local object is skipped */ }
        }
      }
    }
    try {
      action();
      const started = Date.now();
      while (Date.now() - started < 8000) {
        await Promise.all(pending.splice(0, pending.length));
        await displayedLocalBlobs();
        if (file && (await namedDownload(file, named) || await firstUsable(file, seen))) break;
        if (!pending.length && Date.now() - started > 6000) break;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      await Promise.all(pending.splice(0, pending.length));
      return { seen, named };
    } finally {
      URL.createObjectURL = originalCreate;
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.send = originalSend;
      if (originalWebkit) webkit.createObjectURL = originalWebkit;
      HTMLAnchorElement.prototype.click = originalClick;
      window.open = originalOpen;
      if (typeof originalShare === "function") {
        try { navigator.share = originalShare; } catch (err) { /* already restored */ }
      }
    }
  }

  async function firstUsable(file, blobs) {
    let fallback = null;
    for (const blob of blobs) {
      if (!blob) continue;
      const magic = wantsHeader(blob, file) ? await blobMagic(blob) : "";
      if (!blobIsUsable(blob.type, blob.size, file.size, magic, file.mime)) continue;
      if (mimeOf(blob.type) && mimeOf(blob.type) === mimeOf(file.mime)) return blob;
      if (!fallback) fallback = blob;
    }
    return fallback;
  }

  function wantsHeader(blob, file) {
    return binaryMime(blob && blob.type) || binaryMime(file && file.mime);
  }

  async function ensureViewerOpener() {
    const ready = viewerOpener();
    if (ready) return ready;
    const scroller = document.querySelector(".flex-grow.overflow-y-auto");
    if (!scroller) return null;
    const start = scroller.scrollTop;
    const step = Math.max(240, Math.floor(scroller.clientHeight * 0.7) || 400);
    let top = 0;
    for (let guard = 0; guard < 40; guard += 1) {
      scroller.scrollTop = top;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const opened = viewerOpener();
      if (opened) {
        scroller.scrollTop = start;
        return opened;
      }
      if (top >= scroller.scrollHeight) break;
      top += step;
    }
    scroller.scrollTop = start;
    return null;
  }

  async function namedDownload(file, named) {
    const match = (named || []).find((item) => item && item.name === file.name && item.blob);
    if (!match) return null;
    const magic = wantsHeader(match.blob, file) ? await blobMagic(match.blob) : "";
    return blobIsUsable(match.blob.type, match.blob.size, file.size, magic, file.mime) ? match.blob : null;
  }

  async function revealControl(label) {
    const ready = labeled(label);
    if (ready) return ready;
    const scroller = document.querySelector(".flex-grow.overflow-y-auto");
    if (!scroller) return null;
    const step = Math.max(240, Math.floor(scroller.clientHeight * 0.7) || 400);
    let top = 0;
    for (let guard = 0; guard < 50; guard += 1) {
      scroller.scrollTop = top;
      await new Promise((resolve) => setTimeout(resolve, 120));
      const found = labeled(label);
      if (found) return found;
      if (top >= scroller.scrollHeight) break;
      top += step;
    }
    return null;
  }

  async function captureByView(file) {
    let found = null;
    const button = await revealControl("View " + file.name);
    if (button) {
      const viewed = await observeBlobs(() => button.click(), file);
      found = await firstUsable(file, viewed.seen);
      if (!found) {
        const download = downloadButton();
        if (download) {
          const saved = await observeBlobs(() => download.click(), file);
          found = await namedDownload(file, saved.named);
          if (!found && !saved.named.length) found = await firstUsable(file, saved.seen);
        }
      }
    }
    if (!found) {
      const open = await ensureViewerOpener();
      if (open && file.record) {
        const opened = await observeBlobs(() => open({ attachment: file.record }), file);
        found = await firstUsable(file, opened.seen);
      }
    }
    closeViewer();
    return found;
  }

  function localDb() {
    return new Promise((resolve, reject) => {
      const factory = idbFactory();
      if (!factory) { reject(new Error("indexedDB unavailable")); return; }
      const request = factory.open("shadow-continue-local", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  function localId(file) {
    return String((file && file.record && file.record.id) || (file && file.blobId) || "");
  }

  async function usableBlob(file, blob) {
    if (!blob || typeof blob.arrayBuffer !== "function") return null;
    const magic = wantsHeader(blob, file) ? await blobMagic(blob) : "";
    return blobIsUsable(blob.type, blob.size, file.size, magic, file.mime) ? blob : null;
  }

  async function rememberedBlob(file) {
    const id = localId(file);
    if (!id) return null;
    try {
      const db = await localDb();
      const stored = await new Promise((resolve, reject) => {
        const get = db.transaction("files", "readonly").objectStore("files").get(id);
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => reject(get.error);
      });
      db.close();
      return usableBlob(file, blobFromStoredRecord(stored, file.mime) || stored);
    } catch (err) {
      return null;
    }
  }

  async function bytesOf(blob) {
    try {
      if (typeof blob.arrayBuffer === "function") return await blob.arrayBuffer();
    } catch (err) { /* FileReader below */ }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  async function rememberLocal(file, blob) {
    const id = localId(file);
    if (!id || !blob) return;
    const bytes = await bytesOf(blob);
    const record = { mime: blob.type || file.mime || "application/octet-stream", bytes };
    const db = await localDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("aborted"));
        tx.objectStore("files").put(record, id);
      });
    } finally {
      db.close();
    }
  }

  async function storedBlob(file) {
    const remembered = await rememberedBlob(file);
    if (remembered) return remembered;
    for (const key of localCacheKeys(file)) {
      let stored = null;
      try { stored = await idbGet(key); } catch (err) { stored = null; }
      if (!stored) continue;
      const blob = typeof stored.arrayBuffer === "function" ? stored : blobFromLocalValue(stored, file.mime);
      const usable = await usableBlob(file, blob);
      if (usable) return usable;
    }
    return null;
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
    let blob = await storedBlob(file);
    const fromStore = Boolean(blob);
    if (!blob && file && file.inline) {
      blob = await usableBlob(file, new Blob([file.inline], { type: file.mime || "text/plain" }));
    }
    if (!blob) blob = await captureByView(file);
    if (blob && !fromStore) {
      try { await rememberLocal(file, blob); } catch (err) { /* the send can still use this copy */ }
    }
    const data = blob ? await blobToBase64(blob) : "";
    return {
      name: file.name,
      mime: file.mime,
      text: file.text || attachmentPlaceholder(file),
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
      #shadowContinue-panel button.primary:disabled {
        background: #1a202c; border-color: #2d3748; color: #718096;
        cursor: not-allowed; pointer-events: none; opacity: 0.72;
      }
      #shadowContinue-panel [data-connection-toggle] { width: 100%; text-align: left; font-size: 11px; min-width: 0; }
      #shadowContinue-panel [data-connection]:not([hidden]) { display: grid; gap: 6px; }
      #shadowContinue-panel [data-connection][hidden],
      #shadowContinue-panel [data-connection].is-collapsed { display: none !important; }
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
    if (block) {
      block.hidden = !open;
      block.classList.toggle("is-collapsed", !open);
    }
    if (toggle) {
      toggle.textContent = open ? "Connection ▾" : "Connection ▸";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    try { localStorage.setItem(CONNECTION_KEY, open ? "1" : "0"); } catch (err) { /* private mode */ }
  }

  function setRunsReady(form, ready) {
    const button = form.querySelector("[data-start]");
    if (!button) return;
    button.disabled = !ready;
    button.title = ready ? "Start" : "Authenticate before starting a run";
    button.setAttribute("aria-disabled", ready ? "false" : "true");
  }

  function lockRuns(form) {
    form.flow.innerHTML = "";
    form.mode.innerHTML = "";
    setRunsReady(form, false);
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
        <button class="primary" type="submit" data-start disabled title="Authenticate before starting a run" aria-label="Start" aria-disabled="true">▶</button>
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
    node.base.addEventListener("input", () => lockRuns(node));
    node.token.addEventListener("input", () => lockRuns(node));
    setRunsReady(node, false);
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
    lockRuns(form);
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
      const ready = runsReady(flows.length);
      setRunsReady(form, ready);
      note.textContent = ready ? "Flows ready." : "No flows returned.";
      if (ready) setConnection(form, false);
    } catch (err) {
      setRunsReady(form, false);
      note.textContent = err && err.message === "Failed to fetch"
        ? "The browser could not reach the service. Check the base URL, then authenticate again."
        : err.message;
    }
  }

  async function start(form) {
    const note = form.querySelector("[data-note]");
    const runButton = form.querySelector("[data-start]");
    if (!runButton || runButton.disabled) {
      note.textContent = "Authenticate before starting a run.";
      return;
    }
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
