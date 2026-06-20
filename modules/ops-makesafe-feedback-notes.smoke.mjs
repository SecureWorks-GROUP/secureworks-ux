// Standalone smoke test for the MakeSafe Draft Pack / Revise Pack feedback module.
// Run: node modules/ops-makesafe-feedback-notes.smoke.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "ops-makesafe-feedback-notes.js");
const code = readFileSync(SRC, "utf8");

let failures = 0;
function check(name, cond) {
  if (cond) console.log("  ok  - " + name);
  else {
    console.log("  FAIL - " + name);
    failures++;
  }
}

const calls = { opsPost: [], opsFetch: [], toasts: [], hidden: [] };
function makeEl() {
  return {
    _html: "",
    style: {},
    disabled: false,
    textContent: "",
    value: "",
    set innerHTML(v) {
      this._html = v;
    },
    get innerHTML() {
      return this._html;
    },
  };
}
const elements = {};
const documentStub = { getElementById: (id) => (elements[id] ||= makeEl()) };
const behaviour = {
  fetchResult: { notes: [] },
  postResult: { note: { id: "n1" } },
  postResults: null,
};
function seedJob9Cache() {
  sandbox._msReportingCache["job-9"] = {
    job_id: "job-9",
    source_docs: [
      { kind: "image", url: "https://example.com/keep.jpg", label: "Keep" },
      { kind: "image", url: "https://example.com/hide.jpg", label: "Hide" },
    ],
  };
  sandbox._msPhotoApprovalState["job-9"] = {
    approved: { "https://example.com/keep.jpg": true },
  };
}
const sandbox = {
  document: documentStub,
  opsFetch: (action, params) => {
    calls.opsFetch.push({ action, params });
    return Promise.resolve(behaviour.fetchResult);
  },
  opsPost: (action, body) => {
    calls.opsPost.push({ action, body });
    if (Array.isArray(behaviour.postResults) && behaviour.postResults.length) {
      return Promise.resolve(behaviour.postResults.shift());
    }
    return Promise.resolve(behaviour.postResult);
  },
  showToast: (msg, kind) => calls.toasts.push({ msg, kind }),
  _msReportingHideJobFromActiveList: (jobId, reason) => {
    calls.hidden.push({ jobId, reason });
    delete sandbox._msReportingCache[jobId];
  },
  escapeHtml: (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;"),
  escapeAttr: (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;"),
  _msReportingCache: {
    "job-9": {
      job_id: "job-9",
      source_docs: [
        { kind: "image", url: "https://example.com/keep.jpg", label: "Keep" },
        { kind: "image", url: "https://example.com/hide.jpg", label: "Hide" },
      ],
    },
  },
  _msGetAllPhotos: (d) =>
    d.source_docs.map((p) => ({ url: p.url, label: p.label })),
  _msPhotoApprovalState: {
    "job-9": { approved: { "https://example.com/keep.jpg": true } },
  },
  module: undefined,
  console,
};
seedJob9Cache();

const exposed = [
  "loadMsNotes",
  "addMsNote",
  "addMsNoteAndRerun",
  "triggerMsRerun",
  "renderMsNotesPanel",
  "renderMsNote",
  "_msSelectedPhotoUrlsForFeedback",
];
const wrapped = '"use strict";\n' + code + "\nreturn { " +
  exposed.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`)
    .join(", ") +
  " };";

let mod;
try {
  mod = new Function(...Object.keys(sandbox), wrapped)(
    ...Object.values(sandbox),
  );
} catch (e) {
  console.log("  FAIL - module evaluates without throwing: " + e.message);
  process.exit(1);
}

console.log("MakeSafe feedback-notes smoke test");
check("defines loadMsNotes", typeof mod.loadMsNotes === "function");
check("defines addMsNote", typeof mod.addMsNote === "function");
check("defines addMsNoteAndRerun", typeof mod.addMsNoteAndRerun === "function");
check("defines triggerMsRerun", typeof mod.triggerMsRerun === "function");
check(
  "defines renderMsNotesPanel",
  typeof mod.renderMsNotesPanel === "function",
);
check("defines renderMsNote", typeof mod.renderMsNote === "function");

const humanNote = {
  role: "human",
  author: "Marnin",
  body: "fix the invoice costing",
  created_at: "2026-06-17T02:00:00Z",
};
const agentNote = {
  role: "agent",
  author: "MAKESAFE_AGENT",
  body: "MAKESAFE_AGENT_REPLY | Revise Pack requested",
  created_at: "2026-06-17T02:05:00Z",
};
const humanHtml = mod.renderMsNote(humanNote);
const agentHtml = mod.renderMsNote(agentNote);
function bgOf(html) {
  const m = html.match(/background:(#[0-9A-Fa-f]{3,6})/);
  return m ? m[1].toLowerCase() : null;
}
check(
  "renderMsNote produces different backgrounds for human vs agent",
  bgOf(humanHtml) !== bgOf(agentHtml),
);
check(
  "agent reply prefix renders inline",
  agentHtml.includes("MAKESAFE_AGENT_REPLY |"),
);
check("agent notes are tagged", agentHtml.includes("(agent)"));

const panel = mod.renderMsNotesPanel("job-1", [humanNote, agentNote], {
  showRerunButton: true,
});
check(
  "panel uses Revise Pack naming",
  panel.includes("Revise Pack feedback") &&
    panel.includes("Save feedback + Revise Pack"),
);
check(
  "panel contains natural language guidance",
  panel.includes("Write it like chat") && panel.includes("rule update"),
);
check(
  "panel contains Revise Pack now button",
  panel.includes("Revise Pack now") &&
    panel.includes("triggerMsRerun('job-1')"),
);
check(
  "panel contains add-note textarea",
  panel.includes("<textarea") && panel.includes("msNoteInput-job-1"),
);

behaviour.fetchResult = { notes: [humanNote, agentNote] };
await mod.loadMsNotes("job-7", "msNotesPanel-job-7");
const listCall = calls.opsFetch.find((c) => c.action === "list_draft_notes");
check("loadMsNotes calls list_draft_notes", !!listCall);
check(
  "loadMsNotes passes job_id",
  listCall && listCall.params.job_id === "job-7",
);
check(
  "loadMsNotes renders the thread",
  (elements["msNotesPanel-job-7"]._html || "").includes(
    "fix the invoice costing",
  ),
);

elements["msNoteInput-job-9"] = makeEl();
elements["msNoteInput-job-9"].value =
  "please add 1 labour hour and hide the blurry photo";
await mod.addMsNote("job-9");
const addCall = calls.opsPost.find((c) => c.action === "add_draft_note");
check("addMsNote calls add_draft_note", !!addCall);
check(
  "add_draft_note body carries role=human",
  addCall && addCall.body.role === "human",
);
check(
  "add_draft_note body carries draft_kind=makesafe_report",
  addCall && addCall.body.draft_kind === "makesafe_report",
);
check(
  "add_draft_note body carries textarea note",
  addCall && addCall.body.note_body.includes("labour hour"),
);

behaviour.postResult = { rerun: true, addressed_count: 1 };
await mod.triggerMsRerun("job-9");
const rerunCall = calls.opsPost.find((c) => c.action === "rerun_draft_report");
check("triggerMsRerun calls rerun_draft_report", !!rerunCall);
check(
  "rerun_draft_report body carries job_id",
  rerunCall && rerunCall.body.job_id === "job-9",
);
check(
  "rerun_draft_report carries selected_photo_urls only for included photos",
  rerunCall && rerunCall.body.selected_photo_urls.length === 1 &&
    rerunCall.body.selected_photo_urls[0] === "https://example.com/keep.jpg",
);
check(
  "successful Revise Pack request hides the job from the active review queue",
  calls.hidden.some((h) => h.jobId === "job-9" && /fresh draft/i.test(h.reason || "")),
);

seedJob9Cache();
calls.opsPost = [];
calls.hidden = [];
behaviour.postResults = [
  { note: { id: "n2" } },
  { rerun: true, addressed_count: 1 },
];
elements["msNoteInput-job-9"] = makeEl();
elements["msNoteInput-job-9"].value = "combined note with photo selection";
elements["msReviseBtn-job-9"] = makeEl();
await mod.addMsNoteAndRerun("job-9");
const combinedRerunCall = calls.opsPost.find((c) =>
  c.action === "rerun_draft_report"
);
check(
  "Save feedback + Revise Pack preserves selected photos before hiding the card",
  combinedRerunCall &&
    combinedRerunCall.body.selected_photo_urls.length === 1 &&
    combinedRerunCall.body.selected_photo_urls[0] ===
      "https://example.com/keep.jpg",
);
check(
  "Save feedback + Revise Pack hides only after a queued revise pass",
  calls.hidden.length === 1 && calls.hidden[0].jobId === "job-9",
);

seedJob9Cache();
calls.opsPost = [];
calls.hidden = [];
behaviour.postResults = null;
behaviour.postResult = { skipped: true };
await mod.triggerMsRerun("job-9");
check(
  "skipped Revise Pack response does not hide the active review card",
  calls.hidden.length === 0,
);

console.log("");
if (failures) {
  console.log("SMOKE FAILED: " + failures + " check(s) failed.");
  process.exit(1);
} else {
  console.log("SMOKE PASSED: all checks ok.");
  process.exit(0);
}
