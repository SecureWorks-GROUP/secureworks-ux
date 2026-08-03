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

const calls = { opsPost: [], opsPostJwt: [], opsFetch: [], toasts: [], hidden: [], reloads: [], detail: [], sesReloads: [] };
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
  opsPostJwt: (action, body) => {
    calls.opsPostJwt.push({ action, body });
    return Promise.resolve(behaviour.postJwtResult || { feedback: { id: 1 } });
  },
  _msSesPackCache: {},
  _msSesReloadDetail: (jobId) => calls.sesReloads.push(jobId),
  showToast: (msg, kind) => calls.toasts.push({ msg, kind }),
  _msReportingHideJobFromActiveList: (jobId, reason) => {
    calls.hidden.push({ jobId, reason });
    delete sandbox._msReportingCache[jobId];
  },
  loadMakesafeReportingCockpit: async () => {
    calls.reloads.push({});
    seedJob9Cache();
    return 1;
  },
  showMsReportingDetail: (jobId) => calls.detail.push(jobId),
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
  _msActiveDocTab: {},
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
check(
  "renderMsNote marks agent notes with the agent class",
  humanHtml.includes('class="msr-fb-note"') &&
    agentHtml.includes('class="msr-fb-note agent"') &&
    !humanHtml.includes('class="msr-fb-note agent"'),
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
check(
  "successful Revise Pack request reloads the reporting feed",
  calls.reloads.length >= 1,
);
check(
  "successful Revise Pack request reopens the fresh detail when returned by feed",
  calls.detail.includes("job-9"),
);
check(
  "successful Revise Pack request reports fresh PDFs",
  calls.toasts.some((t) => /fresh PDFs/i.test(t.msg || "")),
);

seedJob9Cache();
calls.opsPost = [];
calls.hidden = [];
calls.reloads = [];
calls.detail = [];
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
calls.reloads = [];
calls.detail = [];
behaviour.postResults = null;
behaviour.postResult = { skipped: true };
await mod.triggerMsRerun("job-9");
check(
  "skipped Revise Pack response does not hide the active review card",
  calls.hidden.length === 0,
);

// ── SES MODE — feedback records on the exact docket revision ────────────────
// A job whose detail rendered from the SES cockpit has a _msSesPackCache entry.
const SES_JOB = "job-ses";
const SES_REV = "11111111-1111-1111-1111-111111111111";
sandbox._msSesPackCache[SES_JOB] = {
  jobId: SES_JOB,
  docketRevisionId: SES_REV,
  reviewState: "needs_review",
};

// Panel rendering in SES mode: no Revise Pack controls, a Record feedback
// composer, and SES guidance copy.
const sesPanel = mod.renderMsNotesPanel(SES_JOB, [], {
  showRerunButton: false,
  sesMode: true,
});
check(
  "SES panel uses Review feedback naming",
  sesPanel.includes("Review feedback") &&
    !sesPanel.includes("Revise Pack feedback"),
);
check(
  "SES panel hides BOTH Revise Pack buttons",
  !sesPanel.includes("Revise Pack now") &&
    !sesPanel.includes("Save feedback + Revise Pack") &&
    !sesPanel.includes("triggerMsRerun"),
);
check(
  "SES panel offers the Record feedback composer",
  sesPanel.includes("Record feedback") && sesPanel.includes("<textarea"),
);
check(
  "SES panel explains the readiness invalidation",
  /invalidates the pack/i.test(sesPanel) && /revised pack/i.test(sesPanel),
);

// loadMsNotes in SES mode still reads the legacy thread but hides the rerun
// button, and merges this session's docket-recorded echoes.
behaviour.fetchResult = { notes: [humanNote] };
await mod.loadMsNotes(SES_JOB, "msNotesPanel-" + SES_JOB);
const sesLoadHtml = elements["msNotesPanel-" + SES_JOB]._html || "";
check(
  "SES loadMsNotes renders the legacy thread without the rerun button",
  sesLoadHtml.includes("fix the invoice costing") &&
    !sesLoadHtml.includes("Revise Pack now"),
);

// Saving in SES mode posts record_ses_review_feedback via opsPostJwt (never
// add_draft_note), bound to the exact docket revision.
calls.opsPost = [];
calls.opsPostJwt = [];
calls.sesReloads = [];
elements["msNoteInput-" + SES_JOB] = makeEl();
elements["msNoteInput-" + SES_JOB].value =
  "costing is off — add 1 extra labour hour";
await mod.addMsNote(SES_JOB);
const sesFeedbackCall = calls.opsPostJwt.find((c) =>
  c.action === "record_ses_review_feedback"
);
check(
  "SES save calls opsPostJwt(record_ses_review_feedback)",
  !!sesFeedbackCall,
);
check(
  "SES save NEVER calls add_draft_note",
  !calls.opsPost.some((c) => c.action === "add_draft_note"),
);
check(
  "SES feedback body binds the exact docket revision + job",
  !!sesFeedbackCall &&
    sesFeedbackCall.body.docket_revision_id === SES_REV &&
    sesFeedbackCall.body.job_id === SES_JOB,
);
check(
  "SES feedback body carries a change_type and the note in after",
  !!sesFeedbackCall &&
    typeof sesFeedbackCall.body.change_type === "string" &&
    sesFeedbackCall.body.change_type.trim().length > 0 &&
    !!sesFeedbackCall.body.after &&
    /labour hour/.test(sesFeedbackCall.body.after.note || ""),
);
check(
  "SES save echoes the recorded note into the rendered thread",
  (elements["msNotesPanel-" + SES_JOB]._html || "").includes(
    "costing is off",
  ) &&
    (elements["msNotesPanel-" + SES_JOB]._html || "").includes(
      "recorded on the SES docket",
    ),
);
check(
  "SES save reloads the cockpit detail (readiness was invalidated)",
  calls.sesReloads.includes(SES_JOB),
);
check(
  "SES save toast names the readiness invalidation",
  calls.toasts.some((t) =>
    t.kind === "success" && /readiness/i.test(t.msg || "")
  ),
);

// The echo survives a thread reload (SES feedback has no read-back action).
await mod.loadMsNotes(SES_JOB, "msNotesPanel-" + SES_JOB);
check(
  "SES echo persists across thread reloads",
  (elements["msNotesPanel-" + SES_JOB]._html || "").includes("costing is off"),
);

// A signed-off pack (no docket revision in the queue) cannot take feedback:
// the composer is replaced by an honest note and the save refuses.
const SIGNED_JOB = "job-signed";
sandbox._msSesPackCache[SIGNED_JOB] = {
  jobId: SIGNED_JOB,
  docketRevisionId: null,
  reviewState: "signed_off",
};
const signedPanel = mod.renderMsNotesPanel(SIGNED_JOB, [], {
  showRerunButton: false,
  sesMode: true,
});
check(
  "signed-off SES pack replaces the composer with an honest note",
  signedPanel.includes("already passed Docs Ready review") &&
    !signedPanel.includes("<textarea"),
);
calls.opsPostJwt = [];
calls.toasts = [];
await mod.addMsNote(SIGNED_JOB, "too late");
check(
  "SES save on a signed-off pack refuses without calling the backend",
  calls.opsPostJwt.length === 0 &&
    calls.toasts.some((t) =>
      t.kind === "error" && /already passed Docs Ready review/i.test(t.msg || "")
    ),
);

// addMsNoteAndRerun in SES mode degrades to the record-only save.
calls.opsPostJwt = [];
calls.opsPost = [];
elements["msNoteInput-" + SES_JOB] = makeEl();
elements["msNoteInput-" + SES_JOB].value = "second SES note";
await mod.addMsNoteAndRerun(SES_JOB);
check(
  "addMsNoteAndRerun in SES mode records feedback and NEVER reruns",
  calls.opsPostJwt.some((c) => c.action === "record_ses_review_feedback") &&
    !calls.opsPost.some((c) => c.action === "rerun_draft_report"),
);

console.log("");
if (failures) {
  console.log("SMOKE FAILED: " + failures + " check(s) failed.");
  process.exit(1);
} else {
  console.log("SMOKE PASSED: all checks ok.");
  process.exit(0);
}
