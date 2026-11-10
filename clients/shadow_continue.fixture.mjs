import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { folderPath, scrapeChat, continuationTask, blobIsUsable, blobFromLocalValue, blobFromStoredRecord, localCacheKeys, chatIdFromLocation, findOpenChat } = require("./shadow_continue.js");

const folders = [
  { id: "root-a", title: "AdHocPlans", parentID: null, depth: 0, children: [] },
  { id: "mid", title: "TestFolder", parentID: "root-a", depth: 1, children: [] },
  { id: "leaf", title: "AnotherSubfolder", parentID: "mid", depth: 2, children: [] }
];

assert.equal(folderPath(folders, "leaf"), "AdHocPlans/TestFolder/AnotherSubfolder");
assert.equal(folderPath(folders, null), "(root)");

const nested = scrapeChat({ chatTitle: "TestNestedChat", folderID: "leaf", favoritedAt: new Date(), messages: [] }, folders);
const regular = scrapeChat({ chatTitle: "RegularChat", folderID: "leaf", messages: [] }, folders);
assert.equal(nested.starred, true);
assert.equal(regular.starred, false);
assert.equal(nested.path, regular.path);

const comb = scrapeChat({
  chatTitle: "Find Clamping Comb For Spiky Hair",
  folderID: null,
  messages: [
    { role: "user", uuid: "u1", content: [{ type: "text", text: "hello" }] },
    { role: "assistant", uuid: "a1", content: [{ type: "text", text: "world" }] }
  ]
}, []);
assert.equal(comb.path, "(root)");
assert.equal(comb.messages.length, 2);
assert.equal(comb.query, "");
assert.equal(continuationTask(comb), "Summarize the conversation context.");
assert.equal(comb.messages[0].text, "hello");
assert.equal(comb.attachments.length, 0);

const pending = scrapeChat({
  chatTitle: "pending",
  folderID: null,
  messages: [
    { role: "assistant", uuid: "a", content: "earlier" },
    { role: "user", uuid: "u", content: [{ type: "text", text: "unanswered ask" }] }
  ]
}, []);
assert.equal(pending.query, "unanswered ask");
assert.equal(continuationTask(pending), "unanswered ask");
assert.equal(continuationTask({ query: "", history: [] }), "");
assert.equal(pending.history.length, 1);
assert.equal(pending.history[0].text, "earlier");

const windows = scrapeChat({
  chatTitle: "WindowsAB-4",
  folderID: "leaf",
  messages: [
    {
      role: "user",
      uuid: "file-msg",
      content: [
        { type: "text", text: "see file" },
        {
          type: "tm_blob_file",
          text: "[File Attachment: WindowsAB-3.pdf]",
          metadata: { name: "WindowsAB-3.pdf", type: "application/pdf", size: 1773701, fileFormat: "pdf", localBlobID: null },
          sync: { url: "/api/sync-v2/blobs/example" }
        }
      ]
    },
    {
      type: "tm_context_summary",
      uuid: "sum",
      contextSummary: { content: "SUMMARY_MARK", contextCutOffAtUUID: "file-msg", summarizedMessagesCount: 1 }
    },
    { role: "assistant", uuid: "cleared", content: "hidden", contextClearedAt: new Date() }
  ]
}, folders);
assert.equal(windows.messages.length, 2);
assert.equal(windows.messages[0].role, "summary");
assert.equal(windows.messages[0].text, "SUMMARY_MARK");
assert.equal(windows.messages[1].role, "files");
assert.equal(windows.messages[1].text.includes("WindowsAB-3.pdf"), true);
assert.equal(windows.messages[1].text.includes("Pre-context summarization documents"), true);
assert.equal(windows.query, "");
assert.equal(windows.attachments.length, 1);
assert.equal(windows.attachments[0].name, "WindowsAB-3.pdf");
assert.equal(windows.attachments[0].onQuery, false);
assert.equal(continuationTask(windows), "Summarize the conversation context.");

const registry = {
  "ref-1": {
    id: "ref-1",
    type: "tm_blob_file",
    text: "[File Attachment: sample.pdf]",
    metadata: { name: "sample.pdf", type: "application/pdf", size: 241219, localBlobID: null }
  }
};
const filed = scrapeChat({
  chatTitle: "Find Clamping Comb For Spiky Hair",
  folderID: null,
  attachmentRegistry: registry,
  messages: [
    {
      role: "user",
      uuid: "old",
      content: [
        { type: "text", text: "older note" },
        { type: "tm_blob_file", text: "[File Attachment: notes.txt]", metadata: { name: "notes.txt", type: "text/plain", localBlobID: "note-blob" } }
      ]
    },
    { role: "assistant", uuid: "a", content: [{ type: "thinking", thinking: "hidden thought" }, { type: "text", text: "visible answer" }] },
    {
      role: "user",
      uuid: "ask",
      content: [
        { type: "text", text: "Does this file help" },
        { type: "tm_attachment_ref", id: "ref-1" }
      ]
    }
  ]
}, []);
assert.equal(filed.query, "Does this file help\n[File Attachment: sample.pdf]");
assert.equal(filed.history[0].text.includes("[File Attachment: notes.txt]"), true);
assert.equal(filed.history.length, 2);
assert.equal(filed.history[1].text, "visible answer");
assert.equal(filed.history[1].text.includes("hidden thought"), false);
assert.equal(filed.attachments.length, 2);
assert.equal(filed.attachments[0].name, "notes.txt");
assert.equal(filed.attachments[0].onQuery, false);
assert.equal(filed.attachments[0].blobId, "note-blob");
assert.equal(filed.attachments[1].name, "sample.pdf");
assert.equal(filed.attachments[1].mime, "application/pdf");
assert.equal(filed.attachments[1].onQuery, true);
assert.equal(filed.attachments[1].blobId, "ref-1");
assert.equal(continuationTask(filed), "Does this file help\n[File Attachment: sample.pdf]");

const fileOnly = scrapeChat({
  attachmentRegistry: registry,
  messages: [{ role: "user", uuid: "only", content: [{ type: "tm_attachment_ref", id: "ref-1" }] }]
}, []);
assert.equal(fileOnly.query, "[File Attachment: sample.pdf]");
assert.equal(fileOnly.attachments[0].onQuery, true);
assert.equal(continuationTask(fileOnly), "[File Attachment: sample.pdf]");

const exploring = scrapeChat({
  chatTitle: "Exploring Extension",
  attachmentRegistry: {
    "post-pdf": {
      type: "tm_blob_file",
      text: "[File Attachment: schowdharyMTProposalHS26Draft.pdf]",
      metadata: { name: "schowdharyMTProposalHS26Draft.pdf", type: "application/pdf", size: 472351 }
    }
  },
  messages: [
    {
      role: "user",
      uuid: "old-a",
      content: [
        { type: "text", text: "early" },
        {
          type: "tm_blob_file",
          text: "[File Attachment: ML Research Core Principles.pdf]",
          metadata: { name: "ML Research Core Principles.pdf", type: "application/pdf", size: 192894 }
        }
      ]
    },
    {
      role: "user",
      uuid: "old-b",
      content: [{
        type: "tm_blob_file",
        text: "[File Attachment: Early Empirical Study.PDF.pdf]",
        metadata: { name: "Early Empirical Study.PDF.pdf", type: "application/pdf", size: 441111 }
      }]
    },
    {
      role: "user",
      uuid: "mid",
      content: [{
        type: "tm_blob_file",
        text: "[File Attachment: ImbalanceStudy.PDF.pdf]",
        metadata: { name: "ImbalanceStudy.PDF.pdf", type: "application/pdf", size: 273831 }
      }]
    },
    {
      type: "tm_context_summary",
      uuid: "real",
      contextSummary: {
        content: "<CONVERSATION_SUMMARY>\nREAL_SUMMARY\n</CONVERSATION_SUMMARY>",
        contextCutOffAtUUID: "mid",
        summarizedMessagesCount: 3
      }
    },
    { role: "assistant", uuid: "after", content: "kept answer" },
    {
      type: "tm_context_summary",
      uuid: "empty",
      contextSummary: {
        content: "<CONVERSATION_SUMMARY>\n\n</CONVERSATION_SUMMARY>",
        contextCutOffAtUUID: "after",
        summarizedMessagesCount: 4
      }
    },
    {
      role: "user",
      uuid: "ask",
      content: [
        { type: "text", text: "continue" },
        { type: "tm_attachment_ref", id: "post-pdf" }
      ]
    }
  ]
}, []);
assert.equal(exploring.messages.filter((message) => message.role === "summary").length, 1);
assert.equal(exploring.messages[0].text.includes("REAL_SUMMARY"), true);
assert.equal(exploring.messages[0].text.includes("</CONVERSATION_SUMMARY>\n\n</CONVERSATION_SUMMARY>"), false);
assert.equal(exploring.history.some((message) => message.text === "kept answer"), true);
assert.equal(exploring.query.includes("continue"), true);
assert.equal(exploring.query.includes("schowdharyMTProposalHS26Draft.pdf"), true);
const note = exploring.history.find((message) => message.role === "files");
assert.ok(note);
assert.equal(note.text.includes("ML Research Core Principles.pdf"), true);
assert.equal(note.text.includes("Early Empirical Study.PDF.pdf"), true);
assert.equal(note.text.includes("ImbalanceStudy.PDF.pdf"), true);
assert.equal(note.text.includes("schowdharyMTProposalHS26Draft.pdf"), false);
assert.equal(exploring.attachments.map((file) => file.name).join("|"), [
  "ML Research Core Principles.pdf",
  "Early Empirical Study.PDF.pdf",
  "ImbalanceStudy.PDF.pdf",
  "schowdharyMTProposalHS26Draft.pdf"
].join("|"));
assert.equal(exploring.attachments.filter((file) => file.onQuery).map((file) => file.name).join(","), "schowdharyMTProposalHS26Draft.pdf");
assert.equal(exploring.attachments[0].record.metadata.name, "ML Research Core Principles.pdf");

assert.equal(blobIsUsable("application/pdf", 241219, 241219, "%PDF-"), true);
assert.equal(blobIsUsable("text/html", 1752298, 241219, ""), false);
assert.equal(blobIsUsable("application/pdf", 97, 241219, "%PDF-"), false);
assert.equal(blobIsUsable("application/pdf", 241219, 241219, "XXXXX"), false);
assert.equal(blobIsUsable("text/markdown", 31557, 31557, ""), true);
assert.equal(blobIsUsable("text/html;charset=utf-8", 31557, 31557, ""), true);
assert.equal(blobIsUsable("application/json", 40, 40, ""), true);
assert.equal(blobIsUsable("text/html", 1752298, 241219, "", "application/pdf"), false);
assert.equal(blobIsUsable("text/plain", 20, 20, ""), true);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]).toString("latin1");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]).toString("latin1");
assert.equal(blobIsUsable("image/jpeg", 1200, 1200, jpeg, "image/jpeg"), true);
assert.equal(blobIsUsable("image/jpeg", 1200, 1200, "XXXXX", "image/jpeg"), false);
assert.equal(blobIsUsable("image/png", 800, 800, png, "image/png"), true);
assert.equal(blobIsUsable("application/zip", 900, 900, "PK\u0003\u0004\u0000", "application/zip"), true);
assert.equal(blobFromLocalValue({ rawText: "not-a-pdf" }, "application/pdf"), null);
assert.equal(blobIsUsable("application/octet-stream", 241219, 241219, "XXXXX", "application/pdf"), false);
assert.equal(blobIsUsable("application/octet-stream", 241219, 241219, "%PDF-", "application/pdf"), true);

const cloudRegistry = {
  "ref-md": {
    type: "tm_blob_file",
    text: "[File Attachment: notes.md]",
    metadata: { name: "notes.md", type: "text/markdown", size: 1200, localBlobID: null }
  }
};
const clearedTail = scrapeChat({
  attachmentRegistry: cloudRegistry,
  messages: [
    { role: "assistant", uuid: "a", content: "hidden", contextClearedAt: "2026-01-01T00:00:00.000Z", tool_calls: [{ id: "c1", function: { name: "search", arguments: "{}" } }] },
    { role: "tool", uuid: "t", type: "tool-response", content: "result", contextClearedAt: "2026-01-01T00:00:00.000Z", tool_call_id: "c1" },
    { role: "user", uuid: "u1", content: "one" },
    { role: "user", uuid: "u2", content: [{ type: "text", text: "two" }, { type: "tm_attachment_ref", id: "ref-md" }] },
    { role: "user", uuid: "u3", content: "three", contextClearedAt: "2026-01-02T00:00:00.000Z" },
    { role: "user", uuid: "u4", content: "four" }
  ]
}, []);
assert.equal(clearedTail.messages.filter((message) => message.role === "user").length, 3);
assert.equal(clearedTail.messages.filter((message) => message.role === "assistant").length, 0);
assert.equal(clearedTail.messages.filter((message) => message.role === "tool").length, 0);
assert.equal(clearedTail.query, "four");
assert.equal(clearedTail.attachments.map((file) => file.name).join(","), "notes.md");
assert.equal(clearedTail.attachments[0].onQuery, false);
assert.equal(clearedTail.attachments[0].mime, "text/markdown");
assert.equal(clearedTail.attachments[0].blobId, "ref-md");

const blocked = scrapeChat({
  attachmentRegistry: cloudRegistry,
  messages: [
    { role: "user", uuid: "old", content: [{ type: "text", text: "before" }, { type: "tm_attachment_ref", id: "ref-md" }] },
    { type: "clear-context", uuid: "cut" },
    { role: "assistant", uuid: "kept-a", content: "after" },
    { role: "user", uuid: "kept-u", content: "continue" }
  ]
}, []);
assert.equal(blocked.messages.map((message) => message.role).join(","), "assistant,user");
assert.equal(blocked.attachments.length, 0);
assert.equal(blocked.query, "continue");

const shot = scrapeChat({
  messages: [{
    role: "user",
    uuid: "img",
    content: [{
      type: "tm_image_file",
      text: "[Image Attachment: shot.jpg]",
      metadata: { name: "shot.jpg", type: "image/jpeg", size: 1200, thumbnailBase64: "tiny" }
    }]
  }]
}, []);
assert.equal(shot.attachments.length, 1);
assert.equal(shot.attachments[0].mime, "image/jpeg");
assert.equal(shot.attachments[0].size, 1200);
assert.equal(shot.attachments[0].inline, "");
assert.equal(shot.query.includes("[Image Attachment: shot.jpg]"), true);
assert.equal(shot.query.includes("tiny"), false);

const body = "plain-text-attachment-body-0123456789";
const pasted = scrapeChat({
  messages: [{
    role: "user",
    uuid: "txt",
    content: [{ type: "tm_text_file", text: body, metadata: { name: "note.txt" } }]
  }]
}, []);
assert.equal(pasted.attachments.length, 1);
assert.equal(pasted.attachments[0].mime, "text/plain");
assert.equal(pasted.attachments[0].inline, body);
assert.equal(pasted.attachments[0].size, Buffer.byteLength(body));
assert.equal(pasted.query.includes(body), false);
assert.equal(pasted.query.includes("note.txt"), true);

const source = readFileSync(new URL("./shadow_continue.js", import.meta.url), "utf8");
assert.equal(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(source), false);
assert.equal(/bearer\s+[A-Za-z0-9]{8,}/i.test(source), false);
assert.equal(source.includes("BLOB_"), true);
assert.equal(source.includes('"View "'), true);
assert.equal(source.includes("onViewAttachment"), true);
assert.equal(source.includes("text/"), true);
assert.equal(source.includes('mime === "text/html"'), false);
assert.equal(source.includes("tm_attachment_ref"), true);
assert.equal(source.includes("tm_image_file"), true);
assert.equal(source.includes("tm_text_file"), true);
assert.equal(source.includes("sync-v2"), false);
assert.equal(/attachment\s*\.\s*sync/.test(source), false);
assert.equal(source.includes("presign"), false);
assert.equal(source.includes("Download attachment"), true);
assert.equal(source.includes("Download image"), true);
assert.equal(source.includes("Close image viewer"), true);
assert.equal(source.includes("Close attachment panel"), true);
assert.equal(source.includes("response.clone"), true);
assert.equal(source.includes("response.url"), false);
assert.equal(source.includes("arguments[0]"), false);
assert.equal(source.includes("window.fetch ="), true);
assert.equal(source.includes("CLIENT_CACHE_attachment-"), true);
assert.equal(source.includes("shadow-continue-local"), true);
assert.equal(source.includes("navigator.share"), true);
assert.equal(source.includes("webkitIndexedDB"), true);
assert.equal(source.includes("oncomplete"), true);

const payload = "markdown-local-copy-0123456789-abcdef";
const rebuilt = blobFromStoredRecord({ mime: "text/markdown", bytes: new TextEncoder().encode(payload) }, "text/plain");
assert.equal(rebuilt.size, Buffer.byteLength(payload));
assert.equal(rebuilt.type, "text/markdown");
const dataUrl = "data:text/markdown;base64," + Buffer.from(payload).toString("base64");
const cached = blobFromLocalValue({
  expireAt: 1,
  cacheGroup: "attachment_preview",
  value: { base64: dataUrl, rawText: "short", text: "wrapped" }
}, "text/markdown");
assert.equal(cached.size, Buffer.byteLength(payload));
assert.equal(cached.type, "text/markdown");
const raw = blobFromLocalValue({ rawText: payload }, "text/markdown");
assert.equal(raw.size, Buffer.byteLength(payload));
const keys = localCacheKeys({ blobId: "id-1", record: { id: "id-1", metadata: { localBlobID: null } } });
assert.equal(keys.includes("BLOB_id-1"), true);
assert.equal(keys.includes("CLIENT_CACHE_attachment-id-1"), true);
assert.equal(keys.includes("CLIENT_CACHE_attachment-id-1-full-text"), true);
assert.equal(keys.some((key) => key.includes("sync")), false);
assert.equal(source.includes("clear-context"), true);
assert.equal(source.includes("chatIdFromLocation"), true);

const productTitle = "TypingMind — Advanced chat UI for AI models";
const stored = [
  { chatID: "other", id: "row-other", chatTitle: "RegularChat", messages: [], updatedAt: "2020-01-01T00:00:00.000Z" },
  { chatID: "chat-untitled", id: "row-new", chatTitle: "", messages: [{ role: "user" }], updatedAt: "2026-10-25T11:01:52.850Z" },
  { chatID: "chat-untitled", id: "row-old", chatTitle: "Old copy", messages: [{ role: "user" }], deletedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-24T00:00:00.000Z" }
];
assert.equal(chatIdFromLocation("https://www.typingmind.com/#chat=chat-untitled"), "chat-untitled");
assert.equal(chatIdFromLocation("https://www.typingmind.com/"), "");
assert.equal(findOpenChat(stored, productTitle, "chat-untitled").id, "row-new");
assert.equal(findOpenChat(stored, productTitle, ""), null);
assert.equal(findOpenChat(stored, "RegularChat - TypingMind.com", "").chatID, "other");


const placeholders = [
  { chatID: "a", id: "row-a", chatTitle: "New Chat", messages: [{ role: "user" }], updatedAt: "2026-01-01T00:00:00.000Z" },
  { chatID: "b", id: "row-b", chatTitle: "New Chat", messages: [{ role: "user" }], updatedAt: "2026-02-01T00:00:00.000Z" }
];
assert.equal(findOpenChat(placeholders, "New Chat - TypingMind.com", ""), null);
assert.equal(findOpenChat(placeholders, "New Chat", "b").chatID, "b");
assert.equal(findOpenChat(placeholders, productTitle, "a").chatID, "a");

console.log("shadow_continue scrape fixtures passed");
