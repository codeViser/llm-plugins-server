import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { folderPath, scrapeChat, formatStartSummary } = require("./shadow_continue.js");

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
assert.equal(windows.attachments.length, 1);
assert.equal(windows.attachments[0].name, "WindowsAB-3.pdf");
assert.equal(windows.attachments[0].mime, "application/pdf");
assert.equal(windows.attachments[0].text.startsWith("[File Attachment:"), true);

const source = readFileSync(new URL("./shadow_continue.js", import.meta.url), "utf8");
assert.equal(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(source), false);
assert.equal(/bearer\s+[A-Za-z0-9]{8,}/i.test(source), false);
assert.equal(source.includes("all_workers"), false);
assert.equal(source.includes('name="instances"'), true);

const summary = formatStartSummary(
  {
    messages: [
      { role: "summary", text: "earlier", tool_calls: [] },
      { role: "user", text: "ask", tool_calls: [] },
      { role: "assistant", text: "reply", tool_calls: [{ id: "c1" }, { id: "c2" }] },
      { role: "tool", text: "out", tool_calls: [] }
    ]
  },
  "abc123",
  [{ name: "note.pdf", bytes: 120 }, { name: "empty.txt", bytes: 0 }]
);
assert.equal(summary.includes("Started abc123"), true);
assert.equal(summary.includes("1 user · 1 assistant · 1 tool · 2 tool calls · 1 summary"), true);
assert.equal(summary.includes("note.pdf · 120 bytes"), true);
assert.equal(summary.includes("empty.txt · not captured"), true);

console.log("shadow_continue scrape fixtures passed");
