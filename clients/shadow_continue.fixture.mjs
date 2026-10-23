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

const source = readFileSync(new URL("./shadow_continue.js", import.meta.url), "utf8");
assert.equal(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(source), false);
assert.equal(/bearer\s+[A-Za-z0-9]{8,}/i.test(source), false);
assert.equal(source.includes("BLOB_"), true);
assert.equal(source.includes('"View "'), true);
assert.equal(source.includes("onViewAttachment"), true);
assert.equal(source.includes("text/html"), true);
assert.equal(source.includes("tm_attachment_ref"), true);
assert.equal(source.includes("sync-v2"), false);

console.log("shadow_continue scrape fixtures passed");
