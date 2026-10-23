import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { folderPath, scrapeChat, continuationTask, blobIsUsable } = require("./shadow_continue.js");

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
assert.equal(windows.messages.length, 1);
assert.equal(windows.query, "");
assert.equal(windows.messages[0].role, "summary");
assert.equal(windows.messages[0].text, "SUMMARY_MARK");
assert.equal(windows.attachments.length, 0);
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
assert.equal(blobIsUsable("application/pdf", 241219, 241219, "%PDF-"), true);
assert.equal(blobIsUsable("text/html", 1752298, 241219, ""), false);
assert.equal(blobIsUsable("application/pdf", 97, 241219, "%PDF-"), false);
assert.equal(blobIsUsable("application/pdf", 241219, 241219, "XXXXX"), false);

const source = readFileSync(new URL("./shadow_continue.js", import.meta.url), "utf8");
assert.equal(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(source), false);
assert.equal(/bearer\s+[A-Za-z0-9]{8,}/i.test(source), false);
assert.equal(source.includes("BLOB_"), true);
assert.equal(source.includes('=== "View "'), true);
assert.equal(source.includes("text/html"), true);
assert.equal(source.includes("tm_attachment_ref"), true);
assert.equal(source.includes("sync-v2"), false);

console.log("shadow_continue scrape fixtures passed");
