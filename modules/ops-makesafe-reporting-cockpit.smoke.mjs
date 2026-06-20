// Standalone smoke test for the MakeSafe Reporting cockpit module.
//
// The ops dashboard has no JS test runner; the intake cockpit ships a manual
// console-smoke comment only. This is a stricter, automated smoke for the
// MONEY/COMMS-critical reporting cockpit: it evals the module in a stubbed
// browser-ish global scope and asserts the gate-critical wiring WITHOUT a real
// browser, real DOM, or real network.
//
// Run:  node modules/ops-makesafe-reporting-cockpit.smoke.mjs
// Exit code 0 == pass, 1 == fail.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "ops-makesafe-reporting-cockpit.js");
const code = readFileSync(SRC, "utf8");

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log("  ok  - " + name);
  } else {
    console.log("  FAIL - " + name);
    failures++;
  }
}

// ── 1. Capture the recorded opsPost call + toasts via a stubbed global scope ──
const calls = { opsPost: [], opsFetch: [], toasts: [], confirms: [] };

// A minimal DOM stub: getElementById returns a recording element; the approve
// button element lets us drive the disabled/textContent path.
function makeEl() {
  return {
    _html: "",
    style: {},
    disabled: false,
    textContent: "",
    set innerHTML(v) {
      this._html = v;
    },
    get innerHTML() {
      return this._html;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}
const elements = {};
const documentStub = {
  getElementById: (id) => (elements[id] ||= makeEl()),
  querySelector: () => null,
};

// Mutable behaviour holders so the test can swap what opsFetch returns AFTER
// the module has closed over the stub (the module captures these wrappers by
// reference; the wrappers delegate to the holder, which the test can repoint).
const behaviour = {
  fetchResult: { drafts: [] },
  postResult: {
    success: true,
    sent: true,
    closed: true,
    invoice_number: "INV-1234",
    photo_followup: { sent: true, photo_count: 1 },
  },
  confirmReturns: true,
};
// The carousel renderer + global state live in ops.html. The module reuses them
// at runtime; here we provide a faithful-enough stub so showMsReportingDetail
// exercises its real carousel-feed path. The stub mirrors the entry shape
// ({label,url,kind}) and emits the urls into the panel so the doc assertions hold.
const _msafeDocViewer = { docs: [], idx: 0 };
function renderMakesafeDocViewerInner() {
  return _msafeDocViewer.docs.map((d) => {
    if (d.kind === "pdf") {
      return '<iframe src="' + d.url + '" title="' + d.label + '"></iframe>';
    }
    return '<img src="' + d.url + '" alt="' + d.label + '">';
  }).join("");
}
const sandbox = {
  document: documentStub,
  opsFetch: (action, params) => {
    calls.opsFetch.push({ action, params });
    return Promise.resolve(behaviour.fetchResult);
  },
  opsPost: (action, body) => {
    calls.opsPost.push({ action, body });
    return Promise.resolve(behaviour.postResult);
  },
  showToast: (msg, kind) => {
    calls.toasts.push({ msg, kind });
  },
  confirm: (msg) => {
    calls.confirms.push(msg);
    return behaviour.confirmReturns;
  },
  escapeHtml: (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;"),
  escapeAttr: (s) =>
    String(s == null ? "" : s).replace(/"/g, "&quot;").replace(/&/g, "&amp;"),
  _msafeDocViewer,
  renderMakesafeDocViewerInner,
  module: undefined,
  console,
};

// Eval the module body inside the sandbox, exposing its top-level functions by
// returning them. We append a return-map so the IIFE hands them back.
const exposed = [
  "loadMakesafeReportingCockpit",
  "renderMsReportingCard",
  "showMsReportingDetail",
  "showMsReportingDetailEmpty",
  "approveMakesafeReportPack",
  "finishMakesafeCloseOut",
  "resolveMakesafeSendState",
  "resetMakesafeFailedPack",
  "refreshMsReportingBadge",
  "_msReportingHideJobFromActiveList",
  "_msSwitchDocTab",
  "_msReportingSubjectHasReviewMarker",
  "_msTogglePhotoApproval",
];
const wrapped = '"use strict";\n' + code + "\nreturn { " +
  exposed.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`)
    .join(", ") +
  ', _msReportingCache: typeof _msReportingCache !== "undefined" ? _msReportingCache : undefined, _msPhotoApprovalState: typeof _msPhotoApprovalState !== "undefined" ? _msPhotoApprovalState : undefined };';

const argNames = Object.keys(sandbox);
const argVals = argNames.map((k) => sandbox[k]);
let mod;
try {
  // eslint-disable-next-line no-new-func
  mod = new Function(...argNames, wrapped)(...argVals);
} catch (e) {
  console.log("  FAIL - module evaluates without throwing: " + e.message);
  process.exit(1);
}

console.log("MakeSafe Reporting cockpit smoke test");

// ── 2. Key functions exist ──
check(
  "defines loadMakesafeReportingCockpit",
  typeof mod.loadMakesafeReportingCockpit === "function",
);
check(
  "defines renderMsReportingCard",
  typeof mod.renderMsReportingCard === "function",
);
check(
  "defines showMsReportingDetail",
  typeof mod.showMsReportingDetail === "function",
);
check(
  "defines approveMakesafeReportPack",
  typeof mod.approveMakesafeReportPack === "function",
);
check(
  "defines refreshMsReportingBadge",
  typeof mod.refreshMsReportingBadge === "function",
);

// ── 4. The detail renderer references photos + line items + BOTH pdf urls ──
const fixture = {
  job_id: "job-1",
  job_number: "MS-100",
  builder: "MLB Constructions",
  external_ref: "MLB-25248",
  client_name: "Jane Homeowner",
  site_address: "12 Smith Street, Joondalup",
  site_suburb: "Joondalup",
  recipient_email: "accounts@mlb.com.au",
  invoice: {
    invoice_number: "INV-1234",
    status: "DRAFT",
    total_ex_gst: 100,
    total_inc_gst: 110,
    lines: [{
      description: "Temp fence hire",
      quantity: 2,
      unit_price: 50,
      line_total: 100,
    }],
    lines_unavailable: false,
  },
  report_pdf_url: "https://example.com/report.pdf",
  invoice_pdf_url: "https://example.com/invoice.pdf",
  cc: ["ses@secureworkswa.com.au"],
  resume_action: "send",
  draft_docs: [
    {
      label: "Make safe report",
      url: "https://example.com/report.pdf",
      kind: "pdf",
      created_at: "2026-06-20T01:00:00.000Z",
    },
    {
      label: "Draft invoice",
      url: "https://example.com/invoice.pdf",
      kind: "pdf",
      created_at: "2026-06-20T01:05:00.000Z",
    },
  ],
  source_docs: [
    {
      label: "Raw Trade Report",
      url: "",
      kind: "html",
      received_at: "2026-06-20T02:00:00.000Z",
      created_at: "2026-06-20T01:50:00.000Z",
      raw_report: {
        status: "submitted",
        checklist_json: {
          labour_hours: 3,
          trade_count: 1,
          work_done: "Made safe and propped wall.",
        },
        notes: "Raw note from trade",
        submitted_at: "2026-06-20T02:00:00.000Z",
      },
    },
    {
      label: "Trade Report PDF",
      url: "https://example.com/trade-report.pdf",
      kind: "pdf",
      received_at: "2026-06-20T02:00:00.000Z",
      created_at: "2026-06-20T01:50:00.000Z",
    },
    {
      label: "Work order",
      url: "https://example.com/wo.pdf",
      kind: "pdf",
      received_at: "2026-06-19T08:30:00.000Z",
      created_at: "2026-06-19T08:30:00.000Z",
    },
    { label: "front", url: "https://example.com/p1.jpg", kind: "image", received_at: "2026-06-20T02:10:00.000Z" },
    { label: "hallway", url: "https://example.com/p2.jpg", kind: "image", received_at: "2026-06-20T02:11:00.000Z" },
  ],
  photos: [
    {
      url: "https://example.com/p1.jpg",
      thumbnail_url: "https://example.com/p1t.jpg",
      label: "front",
    },
    {
      url: "https://example.com/p2.jpg",
      thumbnail_url: "https://example.com/p2t.jpg",
      label: "hallway",
    },
  ],
  default_subject:
    "Make Safe Completion - MLB-25248 - 12 Smith Street, Joondalup",
  default_html_body: "<p>hello builder</p>",
};
// ── 3. loadMakesafeReportingCockpit calls the read endpoint AND populates the
//    module's internal cache (load reassigns the cache var, so we seed THROUGH
//    load by stubbing opsFetch to return our fixture, then render from cache). ──
behaviour.fetchResult = { drafts: [fixture] };
await mod.loadMakesafeReportingCockpit();
check(
  "loadMakesafeReportingCockpit calls opsFetch(makesafe_report_drafts)",
  calls.opsFetch.some((c) => c.action === "makesafe_report_drafts"),
);
check(
  "a card is rendered into the list body for the loaded pack",
  (elements["msReportingListBody"]._html || "").includes("Major Loss Builders"),
);

mod.showMsReportingDetail("job-1");
const detailHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "detail carousel renders the source photo url",
  detailHtml.includes("https://example.com/p1"),
);
check(
  "detail renders all submitted photos selected by default",
  detailHtml.includes("2 of 2 photos approved") &&
    mod._msPhotoApprovalState["job-1"].approved["https://example.com/p1.jpg"] &&
    mod._msPhotoApprovalState["job-1"].approved["https://example.com/p2.jpg"],
);
mod._msTogglePhotoApproval("job-1", "https://example.com/p2.jpg");
check(
  "clicking a photo excludes it from the selected set",
  !mod._msPhotoApprovalState["job-1"].approved["https://example.com/p2.jpg"],
);
check(
  "detail carousel renders the work-order url",
  detailHtml.includes("https://example.com/wo.pdf"),
);
check(
  "detail click-through tabs include the raw trade report",
  detailHtml.includes("Raw Trade Report"),
);
mod._msSwitchDocTab("job-1", 2, "msReportingDetailPanel");
check(
  "raw trade report tab renders the trade-submitted source body",
  (elements["msDocStage_job_1"]._html || "").includes("Made safe and propped wall"),
);
check(
  "detail click-through tabs include the trade report PDF",
  detailHtml.includes("Trade Report PDF") &&
    detailHtml.includes("https://example.com/trade-report.pdf#view=Fit"),
);
check(
  "detail click-through tabs include the insurer/builder work order",
  detailHtml.includes("Work Order") &&
    detailHtml.includes("https://example.com/wo.pdf#view=Fit"),
);
check(
  "detail renders received timestamp metadata for source documents",
  detailHtml.includes("Received") && detailHtml.includes("20 June 2026"),
);
check(
  "detail renders the invoice line item description",
  detailHtml.includes("Temp fence hire"),
);
check(
  "detail carousel renders the report PDF url in an iframe",
  detailHtml.includes("https://example.com/report.pdf") &&
    detailHtml.includes("<iframe"),
);
check(
  "PDF viewer opens in whole-page mode, not fit-width mode",
  detailHtml.includes("https://example.com/report.pdf#view=Fit") &&
    detailHtml.includes("whole page") &&
    !detailHtml.includes("#view=FitH"),
);
check(
  "PDF viewer stage is capped for large monitors",
  detailHtml.includes("max-width:980px"),
);
check(
  "detail carousel renders the invoice PDF url",
  detailHtml.includes("https://example.com/invoice.pdf#view=Fit"),
);
check(
  "detail shows the recipient email",
  detailHtml.includes("accounts@mlb.com.au"),
);
check(
  "detail shows the CC recipient",
  detailHtml.includes("ses@secureworkswa.com.au"),
);
check("detail shows the inc-GST total", detailHtml.includes("$110.00"));
check(
  "detail has an Approve & send pack button (live send mode)",
  detailHtml.includes("Approve &amp; send pack") ||
    detailHtml.includes("Approve & send pack"),
);
check(
  "detail explains the live authorise/send + JPEG photo follow-up",
  /Authorises the invoice in Xero/i.test(detailHtml) &&
    /approved photos as a JPEG follow-up/i.test(detailHtml),
);

// ── 5. Approve fires makesafe_send_pack in live mode with selected photos ──
await mod.approveMakesafeReportPack("job-1");
const sendCall = calls.opsPost.find((c) => c.action === "makesafe_send_pack");
check("approve calls opsPost(makesafe_send_pack)", !!sendCall);
check("approve confirms before sending", calls.confirms.length > 0);
if (sendCall) {
  check(
    "send body carries the recipient_email",
    sendCall.body.recipient_email === "accounts@mlb.com.au",
  );
  check("send body carries pack_kind=main", sendCall.body.pack_kind === "main");
  check(
    "send body carries a subject + html_body",
    !!sendCall.body.subject && !!sendCall.body.html_body,
  );
  check(
    "send body does not carry canary_mode",
    Object.prototype.hasOwnProperty.call(sendCall.body, "canary_mode") === false,
  );
  check(
    "send body carries approved_photos only for selected photos",
    Array.isArray(sendCall.body.approved_photos) &&
      sendCall.body.approved_photos.length === 1 &&
      sendCall.body.approved_photos[0].url === "https://example.com/p1.jpg",
  );
}
check(
  "success toast says photo follow-up was sent",
  calls.toasts.some((t) => /Photo follow-up sent/i.test(t.msg || "")),
);

// ── 6. GATE ANTIDOTE - the composer refuses a review-marker subject ──
const REVIEW_MARKERS = [
  "TEST",
  "ROUND",
  "DRAFT",
  "REVIEW",
  "INTERNAL",
  "PREVIEW",
];
let markerCaught = true;
for (const marker of REVIEW_MARKERS) {
  if (
    !mod._msReportingSubjectHasReviewMarker(
      "Make Safe " + marker + " Completion",
    )
  ) markerCaught = false;
}
check("subject marker guard catches every review marker token", markerCaught);
// A clean subject is allowed; a substring (PROTESTING) is not a whole token.
check(
  "subject marker guard allows a clean subject",
  !mod._msReportingSubjectHasReviewMarker("Make Safe Completion - MLB-25248"),
);
check(
  "subject marker guard ignores substrings (PROTESTING != TEST)",
  !mod._msReportingSubjectHasReviewMarker("PROTESTING site works"),
);

// A marker-laden subject must NOT reach opsPost. Seed job-2 THROUGH load (the
// cache var is reassigned by load, so a direct cache poke would miss it).
calls.opsPost.length = 0;
calls.toasts.length = 0;
const job2 = Object.assign({}, fixture, {
  job_id: "job-2",
  default_subject: "Make Safe DRAFT Completion",
});
behaviour.fetchResult = { drafts: [job2] };
await mod.loadMakesafeReportingCockpit();
await mod.approveMakesafeReportPack("job-2");
check(
  "approve REFUSES to send a review-marker subject (no opsPost)",
  !calls.opsPost.some((c) => c.action === "makesafe_send_pack"),
);
check(
  "approve surfaces an error toast on the refusal",
  calls.toasts.some((t) => t.kind === "error"),
);

// ── 7. The module source never hard-codes a review-marker filename/subject ──
// (defence: nothing in the composer emits a literal marker into a name/subject)
const offending = [
  '"TEST',
  'TEST"',
  '"DRAFT',
  '"REVIEW',
  '"PREVIEW',
  '"INTERNAL',
  '"ROUND',
];
check(
  "module source does not hardcode a review-marker literal in copy",
  !offending.some((s) => code.includes(s)),
);

// ── 8. STATE-AWARE RESUME ACTIONS (Phase 1b) ──────────────────────────────
// 8a. finish_send keeps the UNCHANGED makesafe_send_pack call (re-emails once).
calls.opsPost.length = 0;
calls.confirms.length = 0;
const jobFinishSend = Object.assign({}, fixture, {
  job_id: "job-fs",
  resume_action: "finish_send",
});
behaviour.fetchResult = { drafts: [jobFinishSend] };
await mod.loadMakesafeReportingCockpit();
const fsHtml = (() => {
  mod.showMsReportingDetail("job-fs");
  return elements["msReportingDetailPanel"]._html || "";
})();
check(
  "finish_send renders the live finish-send button",
  fsHtml.includes("Finish send"),
);
await mod.approveMakesafeReportPack("job-fs");
check(
  "finish_send still calls makesafe_send_pack",
  calls.opsPost.some((c) => c.action === "makesafe_send_pack"),
);
check(
  "finish_send confirm mentions JPEG follow-up and no re-authorise",
  calls.confirms.some((m) =>
    /already authorised/i.test(m) && /JPEG follow-up/i.test(m)
  ),
);

// 8b. finish_close_out -> makesafe_resume_close (NO send_pack).
calls.opsPost.length = 0;
calls.confirms.length = 0;
const jobClose = Object.assign({}, fixture, {
  job_id: "job-cl",
  resume_action: "finish_close_out",
});
behaviour.fetchResult = { drafts: [jobClose] };
await mod.loadMakesafeReportingCockpit();
const clHtml = (() => {
  mod.showMsReportingDetail("job-cl");
  return elements["msReportingDetailPanel"]._html || "";
})();
check(
  'finish_close_out renders a "Finish close-out" button',
  clHtml.includes("Finish close-out"),
);
await mod.finishMakesafeCloseOut("job-cl");
check(
  "finish_close_out calls opsPost(makesafe_resume_close)",
  calls.opsPost.some((c) => c.action === "makesafe_resume_close"),
);
check(
  "finish_close_out NEVER calls makesafe_send_pack",
  !calls.opsPost.some((c) => c.action === "makesafe_send_pack"),
);

// 8c. resolve_send_state -> two explicit choices; both go via makesafe_send_pack
//     WITH sending_resolution, never auto-picked.
calls.opsPost.length = 0;
calls.confirms.length = 0;
const jobResolve = Object.assign({}, fixture, {
  job_id: "job-rs",
  resume_action: "resolve_send_state",
  pack_status: {
    status: "authorised_not_sent",
    send_started_at: new Date(Date.now() - 600000).toISOString(),
    in_flight_stale: true,
  },
});
behaviour.fetchResult = { drafts: [jobResolve] };
await mod.loadMakesafeReportingCockpit();
const rsHtml = (() => {
  mod.showMsReportingDetail("job-rs");
  return elements["msReportingDetailPanel"]._html || "";
})();
check(
  "resolve_send_state shows the Sent-Items-first verify prompt",
  /Sent Items/i.test(rsHtml),
);
check(
  "resolve_send_state offers BOTH explicit choices",
  /WAS sent/i.test(rsHtml) && /was NOT sent/i.test(rsHtml),
);
await mod.resolveMakesafeSendState("job-rs", "confirmed_sent");
const resolveCall = calls.opsPost.find((c) =>
  c.action === "makesafe_send_pack"
);
check(
  "resolve(confirmed_sent) calls makesafe_send_pack with sending_resolution",
  !!resolveCall && resolveCall.body.sending_resolution === "confirmed_sent",
);

// The re-send branch is a real send, so it must preserve the photo approval gate.
calls.opsPost.length = 0;
calls.confirms.length = 0;
mod._msTogglePhotoApproval("job-rs", "https://example.com/p2.jpg");
await mod.resolveMakesafeSendState("job-rs", "confirmed_not_sent");
const resendResolveCall = calls.opsPost.find((c) =>
  c.action === "makesafe_send_pack"
);
check(
  "resolve(confirmed_not_sent) carries approved_photos only for selected photos",
  !!resendResolveCall &&
    resendResolveCall.body.sending_resolution === "confirmed_not_sent" &&
    Array.isArray(resendResolveCall.body.approved_photos) &&
    resendResolveCall.body.approved_photos.length === 1 &&
    resendResolveCall.body.approved_photos[0].url === "https://example.com/p1.jpg",
);

// 8d. failed pack -> blocked state, NO send button, optional reset action.
calls.opsPost.length = 0;
calls.confirms.length = 0;
const jobFailed = Object.assign({}, fixture, {
  job_id: "job-fail",
  resume_action: undefined,
  pack_status: {
    status: "failed",
    failed_step: "authorise_invoice",
    error_detail: "Xero 400",
  },
});
behaviour.fetchResult = { drafts: [jobFailed] };
await mod.loadMakesafeReportingCockpit();
const failHtml = (() => {
  mod.showMsReportingDetail("job-fail");
  return elements["msReportingDetailPanel"]._html || "";
})();
check(
  "failed pack shows a blocked/needs-ops state",
  /Blocked/i.test(failHtml) && /needs ops/i.test(failHtml),
);
check(
  "failed pack has NO send/approve primary button",
  !/Approve (&amp;|&) send pack/.test(failHtml) &&
    !/Finish send/.test(failHtml),
);
await mod.resetMakesafeFailedPack("job-fail");
check(
  "reset calls opsPost(makesafe_reset_failed_pack)",
  calls.opsPost.some((c) => c.action === "makesafe_reset_failed_pack"),
);

const jobFailedPortal = Object.assign({}, fixture, {
  job_id: "job-fail-portal",
  builder: "Western Building",
  requesting_company_name: "Western Building",
  requesting_company_slug: "western-building",
  external_ref: "WB-26080",
  recipient_email: null,
  resume_action: undefined,
  pack_status: {
    status: "failed",
    failed_step: "portal_prepare",
    error_detail: "portal prep failed",
  },
});
const failedPortalCard = mod.renderMsReportingCard(jobFailedPortal);
behaviour.fetchResult = { drafts: [jobFailedPortal] };
await mod.loadMakesafeReportingCockpit();
const failedPortalHtml = (() => {
  mod.showMsReportingDetail("job-fail-portal");
  return elements["msReportingDetailPanel"]._html || "";
})();
check(
  "failed portal-builder card shows BLOCKED before portal-ready state",
  failedPortalCard.includes("BLOCKED") && !failedPortalCard.includes("READY TO SUBMIT"),
);
check(
  "failed portal-builder panel blocks portal submit action",
    /Blocked/i.test(failedPortalHtml) &&
    /needs ops/i.test(failedPortalHtml) &&
    !/Ready to submit on portal/i.test(failedPortalHtml) &&
    !/Mark as portal submitted/i.test(failedPortalHtml) &&
    !/Submit the pack manually/i.test(failedPortalHtml) &&
    /Portal pack blocked/i.test(failedPortalHtml),
);

// ── 9. needs_money_review HOOK — DEFENSIVE ────────────────────────────────
// 9a. Flagged: amber card chip + highlighted invoice line.
const jobMoney = Object.assign({}, fixture, {
  job_id: "job-mr",
  needs_money_review: true,
  money_review: {
    needs_money_review: true,
    reason: "Unit price above rate card",
    flagged_lines: [{
      line_index: 0,
      description: "Temp fence hire",
      confidence: 0.82,
      note: "check rate",
    }],
  },
});
const moneyCardHtml = mod.renderMsReportingCard(jobMoney);
check(
  "money-review card renders the CHECK PRICING chip",
  moneyCardHtml.includes("CHECK PRICING"),
);
behaviour.fetchResult = { drafts: [jobMoney] };
await mod.loadMakesafeReportingCockpit();
const moneyDetail = (() => {
  mod.showMsReportingDetail("job-mr");
  return elements["msReportingDetailPanel"]._html || "";
})();
check(
  "money-review panel shows the pricing-flagged banner",
  /Pricing flagged/i.test(moneyDetail),
);
check(
  "money-review panel shows the flagged line note",
  moneyDetail.includes("check rate"),
);

const nestedOnlyMoney = Object.assign({}, fixture, {
  job_id: "job-mr-nested",
  needs_money_review: false,
  money_review: {
    needs_money_review: true,
    reason: "one or more invoice lines have $0 pricing",
    flagged_lines: [{ line_index: 0, description: "Labour", flag: "zero_unit_price" }],
  },
});
check(
  "nested money_review.needs_money_review renders CHECK PRICING chip",
  mod.renderMsReportingCard(nestedOnlyMoney).includes("CHECK PRICING"),
);
behaviour.fetchResult = { drafts: [nestedOnlyMoney] };
await mod.loadMakesafeReportingCockpit();
const nestedMoneyDetail = (() => {
  mod.showMsReportingDetail("job-mr-nested");
  return elements["msReportingDetailPanel"]._html || "";
})();
check(
  "nested money_review.needs_money_review renders pricing banner",
  /Pricing flagged/i.test(nestedMoneyDetail),
);
check(
  "nested money_review.needs_money_review blocks approve/send action",
  /Fix pricing before send/i.test(nestedMoneyDetail),
);

// 9b. Defensive: absent needs_money_review -> NO chip, no banner.
const cleanCard = mod.renderMsReportingCard(fixture);
check(
  "absent needs_money_review -> NO card chip",
  !cleanCard.includes("CHECK PRICING"),
);
behaviour.fetchResult = { drafts: [fixture] };
await mod.loadMakesafeReportingCockpit();
const cleanDetail = (() => {
  mod.showMsReportingDetail("job-1");
  return elements["msReportingDetailPanel"]._html || "";
})();
check(
  "absent needs_money_review -> NO panel pricing banner",
  !/Pricing flagged/i.test(cleanDetail),
);

const mlbCard = mod.renderMsReportingCard({
  ...fixture,
  job_id: "job-mlb",
  builder: "ML Builders",
  requesting_company_name: "ML Builders",
  external_ref: "MLB-26003",
});
check(
  "ML Builders legacy label renders as Major Loss Builders for MLB refs",
  mlbCard.includes("Major Loss Builders") && !mlbCard.includes(">ML Builders<"),
);

mod._msReportingHideJobFromActiveList("job-1", "Revision requested");
check(
  "revision-in-flight hides the job from the active reporting list",
  (elements["msReportingListBody"]._html || "").includes("No report drafts waiting for your tick") &&
    (elements["msReportingDetailPanel"]._html || "").includes("Revision handed back"),
);

console.log("");
if (failures) {
  console.log("SMOKE FAILED: " + failures + " check(s) failed.");
  process.exit(1);
} else {
  console.log("SMOKE PASSED: all checks ok.");
  process.exit(0);
}
