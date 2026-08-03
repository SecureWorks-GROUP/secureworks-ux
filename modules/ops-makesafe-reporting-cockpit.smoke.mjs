// Standalone smoke test for the MakeSafe Reporting cockpit module (SES wiring).
//
// The ops dashboard has no JS test runner; this is a stricter, automated smoke
// for the MONEY/COMMS-critical reporting cockpit: it evals the module in a
// stubbed browser-ish global scope and asserts the SES gate-critical wiring
// WITHOUT a real browser, real DOM, or real network:
//   - the list feed stays on makesafe_report_drafts and enriches each card's
//     chip from query_ses_review_cockpit;
//   - the detail panel reads query_ses_review_cockpit + get_ses_reviewable_pack
//     (resolved via list_ses_docs_ready_reviews) and renders the byte-exact
//     docs, the three exact routes, and the fixed photo set;
//   - APPROVE INVOICE runs approve_ses_invoice_revision (JWT) ->
//     execute_ses_invoice_revision; SEND IT runs sign_off_ses_docket (JWT,
//     hash-bound) -> prepare_ses_release_revision -> approve_ses_release_revision
//     (JWT) -> execute_ses_release_revision;
//   - the retired legacy actions (makesafe_send_pack, makesafe_resume_close,
//     makesafe_reset_failed_pack, makesafe_send_photo_followup) are never
//     called — at runtime or in source.
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
// Drain pending microtasks (the module's async loaders chain promise ticks).
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ── 1. Stubbed global scope ──────────────────────────────────────────────────
const calls = { opsPost: [], opsPostJwt: [], opsFetch: [], toasts: [], confirms: [] };

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

// Per-action behaviour maps; an Error value rejects.
const behaviour = {
  fetch: {},
  post: {},
  postJwt: {},
  confirmReturns: true,
};
function dispatch(map, action) {
  const r = map[action];
  if (r instanceof Error) return Promise.reject(r);
  return Promise.resolve(r === undefined ? {} : r);
}

const sandbox = {
  document: documentStub,
  opsFetch: (action, params) => {
    calls.opsFetch.push({ action, params });
    return dispatch(behaviour.fetch, action);
  },
  opsPost: (action, body) => {
    calls.opsPost.push({ action, body });
    return dispatch(behaviour.post, action);
  },
  opsPostJwt: (action, body) => {
    calls.opsPostJwt.push({ action, body });
    return dispatch(behaviour.postJwt, action);
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
  _opsUserEmail: "marnin@secureworkswa.com.au",
  module: undefined,
  console,
};

const exposed = [
  "loadMakesafeReportingCockpit",
  "renderMsReportingCard",
  "showMsReportingDetail",
  "showMsReportingDetailEmpty",
  "approveSesInvoice",
  "sendSesRelease",
  "refreshMsReportingBadge",
  "_msSesStatusChip",
  "_msSesActionBlock",
  "_msSesDocsFromArtifacts",
  "_msSesMapInvoice",
  "_msSesRenderRoutes",
  "_msSesRenderPhotos",
  "_msSesIsStale",
  "_msSwitchDocTab",
  "_msReportingHideJobFromActiveList",
  "_msGetAllPhotos",
  "_msIsPortalBuilder",
  // Legacy symbols that MUST be gone:
  "approveMakesafeReportPack",
  "finishMakesafeCloseOut",
  "resolveMakesafeSendState",
  "resetMakesafeFailedPack",
  "_msTogglePhotoApproval",
  "_msGetPhotoApprovalState",
  "_msGetReportPhotos",
  "_msReportingSubjectHasReviewMarker",
];
const wrapped = '"use strict";\n' + code + "\nreturn { " +
  exposed.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`)
    .join(", ") +
  ', _msSesPackCache: typeof _msSesPackCache !== "undefined" ? _msSesPackCache : undefined' +
  ', _msActiveDocTab: typeof _msActiveDocTab !== "undefined" ? _msActiveDocTab : undefined };';

let mod;
try {
  // eslint-disable-next-line no-new-func
  mod = new Function(...Object.keys(sandbox), wrapped)(...Object.values(sandbox));
} catch (e) {
  console.log("  FAIL - module evaluates without throwing: " + e.message);
  process.exit(1);
}

console.log("MakeSafe Reporting cockpit smoke test (SES wiring)");

// ── 2. Key functions exist; the legacy surface is gone ──────────────────────
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
  "defines approveSesInvoice",
  typeof mod.approveSesInvoice === "function",
);
check("defines sendSesRelease", typeof mod.sendSesRelease === "function");
check(
  "defines refreshMsReportingBadge",
  typeof mod.refreshMsReportingBadge === "function",
);
for (const gone of [
  "approveMakesafeReportPack",
  "finishMakesafeCloseOut",
  "resolveMakesafeSendState",
  "resetMakesafeFailedPack",
  "_msTogglePhotoApproval",
  "_msGetPhotoApprovalState",
  "_msGetReportPhotos",
  "_msReportingSubjectHasReviewMarker",
]) {
  check("legacy symbol retired: " + gone, mod[gone] === undefined);
}

// ── 3. The module source never calls the retired 410 actions ────────────────
for (const retired of [
  "makesafe_send_pack",
  "makesafe_send_photo_followup",
  "makesafe_resume_close",
  "makesafe_reset_failed_pack",
]) {
  const callSite = new RegExp(
    "ops(?:Post|Fetch|PostJwt)\\(\\s*['\"]" + retired + "['\"]",
  );
  check("source never calls retired action " + retired, !callSite.test(code));
}
// No multi-job release can be built from this surface: the only prepare call
// must bind exactly one job.
check(
  "prepare_ses_release_revision is wired single-job only",
  /prepare_ses_release_revision['"]\s*,\s*prepBody/.test(code) &&
    /prepBody\s*=\s*\{\s*job_ids:\s*\[jobId\]\s*\}/.test(code),
);

// ── 4. Fixtures ──────────────────────────────────────────────────────────────
const JOB = "job-1";
const DOCKET_REV = "11111111-1111-1111-1111-111111111111";
const HASH = "sha256:" + "a".repeat(64);
const PHOTO_HASH_1 = "sha256:" + "b".repeat(64);
const PHOTO_HASH_2 = "sha256:" + "c".repeat(64);
const REPORT_HASH = "sha256:" + "d".repeat(64);
const XERO_PDF_HASH = "sha256:" + "e".repeat(64);

const feedDraft = {
  job_id: JOB,
  job_number: "MS-100",
  builder: "MLB Constructions",
  external_ref: "MLB-25248",
  client_name: "Jane Homeowner",
  site_address: "12 Smith Street, Joondalup",
  site_suburb: "Joondalup",
  trade_notes: "Raw trade notes here",
  invoice: { total_inc_gst: 110 },
};

const proposal = {
  line_items: [{
    description: "Temp fence hire",
    quantity: 2,
    unit_price_ex_gst: 50,
    amount_ex_gst: 100,
  }],
  subtotal_ex_gst: 100,
  total_inc_gst: 110,
};

function cockpitSendReady() {
  return {
    schema: "secureworks.makesafe.ses-review-cockpit/v1",
    status: "SEND_READY",
    stale: false,
    sections: {
      status: { status: "SEND_READY", stale: false, reasons: [] },
      money: {
        local_invoice_proposal: proposal,
        xero: { invoice_number: "INV-1234", status: "AUTHORISED" },
      },
      email_drafts: [
        {
          route_kind: "report",
          recipients: ["accounts@mlb.com.au"],
          cc: ["ses@secureworkswa.com.au"],
          subject: "Make Safe Completion - MLB-25248",
          body: "Report body text",
          attachment_hashes: [REPORT_HASH],
          ready: true,
        },
        {
          route_kind: "photo",
          recipients: ["accounts@mlb.com.au"],
          cc: [],
          subject: "Photos - MLB-25248",
          body: "Photo body",
          attachment_hashes: [PHOTO_HASH_1],
          ready: true,
        },
        {
          route_kind: "invoice",
          recipients: ["accounts@mlb.com.au"],
          cc: [],
          subject: "MLB-25248 - Xero invoice INV-1234",
          body: "Invoice body",
          attachment_hashes: [XERO_PDF_HASH],
          ready: true,
        },
      ],
    },
    controls: {
      approve_invoice: {
        enabled: false,
        label: "APPROVE INVOICE",
        plan: "Create one Xero DRAFT for this exact obligation revision.",
      },
      send_it: {
        enabled: true,
        label: "SEND IT",
        plan: "Send the approved report, photo, and invoice routes for this exact release revision.",
      },
      captain_only: false,
    },
  };
}

const queueRow = {
  job_id: JOB,
  docket_revision_id: DOCKET_REV,
  docket_output_content_hash: HASH,
  review_state: "needs_review",
};

function reviewablePack() {
  return {
    review: {
      docket_revision_id: DOCKET_REV,
      review_state: "needs_review",
      docket_output_content_hash: HASH,
    },
    docket: {
      id: DOCKET_REV,
      output_content_hash: HASH,
      local_invoice_proposal: proposal,
      xero_binding: { invoice_number: "INV-1234", status: "AUTHORISED" },
    },
    artifacts: [
      {
        role: "supporting_report_pdf",
        object_key: "b/" + JOB + "/" + DOCKET_REV + "/Make Safe Report - MLB-25248.pdf",
        media_type: "application/pdf",
        content_hash: REPORT_HASH,
        signed_url: "https://example.com/report.pdf",
      },
      {
        role: "xero_invoice_pdf",
        object_key: "b/" + JOB + "/" + DOCKET_REV + "/Xero Invoice - INV-1234.pdf",
        media_type: "application/pdf",
        content_hash: XERO_PDF_HASH,
        signed_url: "https://example.com/xero-invoice.pdf",
      },
      {
        role: "swms_artifact",
        object_key: "b/" + JOB + "/" + DOCKET_REV + "/SWMS.pdf",
        media_type: "application/pdf",
        content_hash: "sha256:" + "f".repeat(64),
        signed_url: "https://example.com/swms.pdf",
      },
      {
        role: "source_attachment",
        object_key: "b/" + JOB + "/" + DOCKET_REV + "/work_order_MLB-25248.pdf",
        media_type: "application/pdf",
        content_hash: "sha256:" + "0".repeat(64),
        signed_url: "https://example.com/wo.pdf",
      },
      {
        role: "completion_photo",
        object_key: "b/" + JOB + "/" + DOCKET_REV + "/front.jpg",
        media_type: "image/jpeg",
        content_hash: PHOTO_HASH_1,
        metadata: { order: 0 },
        signed_url: "https://example.com/p1.jpg",
      },
      {
        role: "completion_photo",
        object_key: "b/" + JOB + "/" + DOCKET_REV + "/hallway.jpg",
        media_type: "image/jpeg",
        content_hash: PHOTO_HASH_2,
        metadata: { order: 1 },
        signed_url: "https://example.com/p2.jpg",
      },
    ],
    audit_trail: [],
  };
}

function seedSendReady() {
  behaviour.fetch = {
    makesafe_report_drafts: { drafts: [feedDraft] },
    list_ses_docs_ready_reviews: { dockets: [queueRow] },
    query_ses_review_cockpit: cockpitSendReady(),
    get_ses_reviewable_pack: reviewablePack(),
  };
  behaviour.post = {};
  behaviour.postJwt = {};
}

// ── 5. List load: legacy feed + SES queue refresh + badge enrichment ─────────
seedSendReady();
await mod.loadMakesafeReportingCockpit();
check(
  "load keeps the list feed on makesafe_report_drafts",
  calls.opsFetch.some((c) => c.action === "makesafe_report_drafts"),
);
check(
  "load refreshes the SES Docs Ready queue",
  calls.opsFetch.some((c) => c.action === "list_ses_docs_ready_reviews"),
);
check(
  "a card is rendered into the list body for the loaded pack",
  (elements["msReportingListBody"]._html || "").includes("Major Loss Builders"),
);
check(
  "the card chip starts neutral and carries the enrichment hook id",
  (elements["msReportingListBody"]._html || "").includes("msCardBadge_job_1"),
);
await flush();
check(
  "each card is enriched from query_ses_review_cockpit",
  calls.opsFetch.some((c) =>
    c.action === "query_ses_review_cockpit" && c.params.job_id === JOB
  ),
);
check(
  "the card chip lands on the SES cockpit status",
  elements["msCardBadge_job_1"].textContent === "SEND READY",
);

// ── 6. Detail: byte-exact pack, routes, fixed photos, invoice, controls ─────
calls.opsFetch.length = 0;
await mod.showMsReportingDetail(JOB);
const detailHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "detail reads the cockpit view for the job",
  calls.opsFetch.some((c) =>
    c.action === "query_ses_review_cockpit" && c.params.job_id === JOB
  ),
);
check(
  "detail fetches the byte-exact pack by docket_revision_id",
  calls.opsFetch.some((c) =>
    c.action === "get_ses_reviewable_pack" &&
    c.params.docket_revision_id === DOCKET_REV
  ),
);
check(
  "detail renders the three exact routes SEND IT releases",
  detailHtml.includes("the exact emails SEND IT releases") &&
    detailHtml.includes("Report email") &&
    detailHtml.includes("Photo email") &&
    detailHtml.includes("Invoice email"),
);
check(
  "detail states SEND IT sends all three routes at once",
  /all three routes at once/i.test(detailHtml),
);
check(
  "detail shows the route recipient, cc and subject",
  detailHtml.includes("accounts@mlb.com.au") &&
    detailHtml.includes("ses@secureworkswa.com.au") &&
    detailHtml.includes("Make Safe Completion - MLB-25248"),
);
check(
  "detail renders the fixed photo set (1 in the email, 1 evidence-only)",
  detailHtml.includes("fixed in the release revision") &&
    /1 photo in the photo email/.test(detailHtml) &&
    /1 kept as evidence only/.test(detailHtml),
);
check(
  "detail has NO include/exclude photo toggles (fixed set)",
  !detailHtml.includes("_msTogglePhotoApproval"),
);
check(
  "detail renders the invoice proposal lines + totals + Xero binding",
  detailHtml.includes("Temp fence hire") &&
    detailHtml.includes("$110.00") &&
    detailHtml.includes("INV-1234"),
);
check(
  "detail renders doc tabs from the pack artifacts",
  detailHtml.includes("Make Safe Report") &&
    detailHtml.includes("Xero Invoice") &&
    detailHtml.includes("SWMS") &&
    detailHtml.includes("Work Order"),
);
check(
  "detail opens the report PDF whole-page in the stage",
  detailHtml.includes("https://example.com/report.pdf#view=Fit") &&
    detailHtml.includes("<iframe") &&
    detailHtml.includes("whole page"),
);
check(
  "detail shows the raw trade notes from the live feed",
  detailHtml.includes("Raw trade notes here"),
);
check(
  "detail renders the per-job SEND IT button (never a send-all)",
  detailHtml.includes('id="msSesSendItBtn"') &&
    detailHtml.includes("sendSesRelease(&#x27;" + JOB) ||
    detailHtml.includes("sendSesRelease('" + JOB),
);
check(
  "detail does NOT render APPROVE INVOICE when the control is disabled",
  !detailHtml.includes('id="msSesApproveInvoiceBtn"'),
);
check(
  "detail shows the Docs Ready tick as not yet recorded, bound to the pack hash",
  /not yet recorded/.test(detailHtml) && detailHtml.includes("sha256:aaa"),
);
check(
  "detail never revives the legacy recipient/send copy",
  !detailHtml.includes("Pack will be emailed to") &&
    !detailHtml.includes("Approve &amp; send pack") &&
    !detailHtml.includes("Approve & send pack"),
);
check(
  "the pack context is cached with the exact hash + review state",
  mod._msSesPackCache[JOB] &&
    mod._msSesPackCache[JOB].outputHash === HASH &&
    mod._msSesPackCache[JOB].reviewState === "needs_review" &&
    mod._msSesPackCache[JOB].docketRevisionId === DOCKET_REV,
);

// ── 7. SEND IT: the full per-job release chain, hash-bound sign-off first ───
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.confirms.length = 0;
calls.toasts.length = 0;
behaviour.post["prepare_ses_release_revision"] = {
  release: { id: "rel-1", content_hash: "sha256:" + "1".repeat(64) },
};
behaviour.postJwt["approve_ses_release_revision"] = { approval: { id: "ap-1" } };
behaviour.postJwt["sign_off_ses_docket"] = { review: { review_state: "signed_off" } };
behaviour.post["execute_ses_release_revision"] = {
  state: "released",
  route_proofs: [{ route_kind: "report" }, { route_kind: "photo" }, { route_kind: "invoice" }],
};
await mod.sendSesRelease(JOB);
check("SEND IT confirms before acting", calls.confirms.length > 0);
check(
  "SEND IT confirm copy says all three routes + irreversible",
  calls.confirms.some((m) =>
    /ALL THREE routes/i.test(m) && /irreversible/i.test(m)
  ),
);
const signoffCall = calls.opsPostJwt.find((c) => c.action === "sign_off_ses_docket");
check(
  "SEND IT records the Docs Ready tick via JWT, bound to the displayed hash",
  !!signoffCall &&
    signoffCall.body.docket_revision_id === DOCKET_REV &&
    signoffCall.body.expected_output_content_hash === HASH,
);
const prepCall = calls.opsPost.find((c) => c.action === "prepare_ses_release_revision");
check(
  "SEND IT prepares the release for THIS job only",
  !!prepCall && Array.isArray(prepCall.body.job_ids) &&
    prepCall.body.job_ids.length === 1 && prepCall.body.job_ids[0] === JOB,
);
const approveRelCall = calls.opsPostJwt.find((c) =>
  c.action === "approve_ses_release_revision"
);
check(
  "SEND IT approves the release revision via JWT",
  !!approveRelCall && approveRelCall.body.release_revision_id === "rel-1",
);
const execRelCall = calls.opsPost.find((c) => c.action === "execute_ses_release_revision");
check(
  "SEND IT executes the exact release revision",
  !!execRelCall && execRelCall.body.release_revision_id === "rel-1",
);
check(
  "SEND IT chain order: sign_off -> prepare -> approve -> execute",
  signoffCall && prepCall && approveRelCall && execRelCall &&
    calls.opsPostJwt.indexOf(signoffCall) === 0 &&
    calls.opsPost[0] === prepCall &&
    calls.opsPostJwt[1] === approveRelCall &&
    calls.opsPost[1] === execRelCall,
);
check(
  "SEND IT never touches the retired combined send",
  !calls.opsPost.some((c) => c.action === "makesafe_send_pack") &&
    !calls.opsPostJwt.some((c) => c.action === "makesafe_send_pack"),
);
check(
  "SEND IT success toast reports the three routes",
  calls.toasts.some((t) =>
    t.kind === "success" && /3 routes sent/i.test(t.msg || "")
  ),
);

// ── 8. SEND IT skips sign-off when the tick is already recorded ─────────────
// A signed-off docket has dropped out of the needs_review queue: no pack fetch,
// tick copy flips, and the chain starts at prepare.
behaviour.fetch["list_ses_docs_ready_reviews"] = { dockets: [] };
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.opsFetch.length = 0;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const signedOffHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "signed-off docket is NOT re-fetched as a reviewable pack",
  !calls.opsFetch.some((c) => c.action === "get_ses_reviewable_pack"),
);
check(
  "signed-off detail says the Docs Ready tick is already recorded",
  /already recorded/.test(signedOffHtml),
);
check(
  "signed-off detail explains the byte-exact pack view has passed",
  signedOffHtml.includes("already passed Docs Ready review"),
);
check(
  "signed-off detail still renders routes + money from the cockpit",
  signedOffHtml.includes("Report email") && signedOffHtml.includes("Temp fence hire"),
);
await mod.sendSesRelease(JOB);
check(
  "SEND IT on an already-ticked pack skips sign_off_ses_docket",
  !calls.opsPostJwt.some((c) => c.action === "sign_off_ses_docket") &&
    calls.opsPost.some((c) => c.action === "prepare_ses_release_revision"),
);

// ── 9. A 409 stale_review anywhere aborts the chain and reloads ─────────────
seedSendReady();
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.toasts.length = 0;
calls.opsFetch.length = 0;
const staleErr = new Error("Reload the current review pack and tick its exact displayed hash.");
staleErr.status = 409;
staleErr.refusal = { code: "stale_review", fact: "stale" };
behaviour.postJwt["sign_off_ses_docket"] = { review: { review_state: "signed_off" } };
behaviour.post["prepare_ses_release_revision"] = { release: { id: "rel-2" } };
behaviour.postJwt["approve_ses_release_revision"] = staleErr;
await mod.sendSesRelease(JOB);
check(
  "a stale_review aborts BEFORE execute_ses_release_revision",
  !calls.opsPost.some((c) => c.action === "execute_ses_release_revision"),
);
check(
  "a stale_review surfaces an info toast (nothing was sent)",
  calls.toasts.some((t) => t.kind === "info" && /nothing was sent/i.test(t.msg || "")),
);
await flush();
check(
  "a stale_review reloads the fresh pack",
  calls.opsFetch.some((c) => c.action === "makesafe_report_drafts"),
);

// ── 10. APPROVE INVOICE: JWT approval -> Xero execute ────────────────────────
function cockpitInvoiceReady() {
  const c = cockpitSendReady();
  c.status = "INVOICE_CREATE_READY";
  c.sections.status.status = "INVOICE_CREATE_READY";
  c.sections.money.xero = null;
  c.controls.approve_invoice.enabled = true;
  c.controls.send_it.enabled = false;
  return c;
}
behaviour.fetch["query_ses_review_cockpit"] = cockpitInvoiceReady();
behaviour.fetch["list_ses_docs_ready_reviews"] = { dockets: [queueRow] };
// Pre-Xero: the pack carries the proposal but no xero_binding yet.
const preXeroPack = reviewablePack();
preXeroPack.docket.xero_binding = null;
preXeroPack.artifacts = preXeroPack.artifacts.filter((a) =>
  a.role !== "xero_invoice_pdf"
);
behaviour.fetch["get_ses_reviewable_pack"] = preXeroPack;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const invoiceHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "INVOICE_CREATE_READY renders the APPROVE INVOICE button",
  invoiceHtml.includes('id="msSesApproveInvoiceBtn"'),
);
check(
  "INVOICE_CREATE_READY does NOT render SEND IT",
  !invoiceHtml.includes('id="msSesSendItBtn"'),
);
check(
  "invoice review marks the proposal as not yet in Xero",
  invoiceHtml.includes("SES proposal (not yet in Xero)"),
);
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.toasts.length = 0;
behaviour.postJwt["approve_ses_invoice_revision"] = {
  approval: { invoice_obligation_revision_id: "obr-1" },
};
behaviour.post["execute_ses_invoice_revision"] = {
  state: "authorised_invoice_bound",
  invoice: { invoice_number: "INV-1234", status: "AUTHORISED" },
};
await mod.approveSesInvoice(JOB);
const invApproveCall = calls.opsPostJwt.find((c) =>
  c.action === "approve_ses_invoice_revision"
);
check(
  "APPROVE INVOICE records the JWT approval with includes_authorise",
  !!invApproveCall &&
    invApproveCall.body.job_id === JOB &&
    invApproveCall.body.includes_authorise === true,
);
const invExecCall = calls.opsPost.find((c) =>
  c.action === "execute_ses_invoice_revision"
);
check(
  "APPROVE INVOICE executes the approved obligation revision",
  !!invExecCall &&
    invExecCall.body.job_id === JOB &&
    invExecCall.body.invoice_obligation_revision_id === "obr-1",
);
check(
  "APPROVE INVOICE success toast names the invoice + the fresh tick requirement",
  calls.toasts.some((t) =>
    t.kind === "success" && /INV-1234/.test(t.msg || "") &&
    /fresh Docs Ready tick/i.test(t.msg || "")
  ),
);

// 10b. The obligation revision falls back to query_ses_invoice_obligation when
// the approval response does not carry it.
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.opsFetch.length = 0;
behaviour.postJwt["approve_ses_invoice_revision"] = { approval: {} };
behaviour.fetch["query_ses_invoice_obligation"] = { revisions: [{ id: "obr-9" }] };
await mod.approveSesInvoice(JOB);
check(
  "APPROVE INVOICE resolves the obligation revision via query_ses_invoice_obligation fallback",
  calls.opsFetch.some((c) => c.action === "query_ses_invoice_obligation") &&
    calls.opsPost.some((c) =>
      c.action === "execute_ses_invoice_revision" &&
      c.body.invoice_obligation_revision_id === "obr-9"
    ),
);

// ── 11. HOLD: blocker facts verbatim, no money/send action ──────────────────
const holdCockpit = cockpitSendReady();
holdCockpit.status = "HOLD";
holdCockpit.sections.status = {
  status: "HOLD",
  stale: false,
  reasons: ["The insurance work order is missing from this docket."],
};
holdCockpit.controls.approve_invoice.enabled = false;
holdCockpit.controls.send_it.enabled = false;
behaviour.fetch["query_ses_review_cockpit"] = holdCockpit;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const holdHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "HOLD renders the backend blocker facts verbatim",
  holdHtml.includes("The insurance work order is missing from this docket."),
);
check(
  "HOLD renders NO approve/send action",
  !holdHtml.includes('id="msSesSendItBtn"') &&
    !holdHtml.includes('id="msSesApproveInvoiceBtn"') &&
    /no approve\/send action is available/i.test(holdHtml),
);

// ── 12. No SES docket: the honest retired-path state ─────────────────────────
const noDocketJob = Object.assign({}, feedDraft, { job_id: "job-no-docket" });
behaviour.fetch["makesafe_report_drafts"] = { drafts: [noDocketJob] };
behaviour.fetch["query_ses_review_cockpit"] = new Error(
  "No current SES docket revision exists for this job.",
);
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
await mod.loadMakesafeReportingCockpit();
await flush();
check(
  "a job with no SES docket gets the honest NO SES PACK chip",
  elements["msCardBadge_job_no_docket"].textContent === "NO SES PACK",
);
await mod.showMsReportingDetail("job-no-docket");
const noDocketHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "a job with no SES docket renders the honest no-pack state",
  noDocketHtml.includes("No reviewable SES pack persisted yet") &&
    noDocketHtml.includes("410"),
);
check(
  "the no-pack state offers NO action buttons at all",
  !noDocketHtml.includes("msSesSendItBtn") &&
    !noDocketHtml.includes("msSesApproveInvoiceBtn") &&
    !noDocketHtml.includes("approveMakesafeReportPack"),
);

// ── 13. Signed URLs expire in 300s: a late tab switch re-fetches the pack ────
seedSendReady();
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
calls.opsFetch.length = 0;
mod._msSesPackCache[JOB].fetchedAt = Date.now() - 300000; // 5 min old
mod._msSwitchDocTab(JOB, 1, "msReportingDetailPanel");
await flush();
await flush();
check(
  "a tab switch past the signed-URL lifetime re-fetches the pack",
  calls.opsFetch.some((c) => c.action === "query_ses_review_cockpit") &&
    calls.opsFetch.some((c) => c.action === "get_ses_reviewable_pack"),
);
check(
  "the re-fetch preserves the clicked tab",
  mod._msActiveDocTab[JOB] === 1,
);
// A fresh pack switches locally without a network round-trip.
calls.opsFetch.length = 0;
mod._msSesPackCache[JOB].fetchedAt = Date.now();
mod._msSwitchDocTab(JOB, 2, "msReportingDetailPanel");
check(
  "a tab switch within the signed-URL lifetime stays local",
  !calls.opsFetch.some((c) => c.action === "query_ses_review_cockpit") &&
    mod._msActiveDocTab[JOB] === 2,
);

// ── 14. Status chip vocabulary + stale error classification ──────────────────
check(
  "the status chip maps the four SES cockpit statuses",
  mod._msSesStatusChip("SEND_READY").label === "SEND READY" &&
    mod._msSesStatusChip("INVOICE_CREATE_READY").label === "APPROVE INVOICE" &&
    mod._msSesStatusChip("PRE_XERO_DOCS_READY").label === "DOCS READY" &&
    mod._msSesStatusChip("HOLD").label === "ON HOLD",
);
check(
  "unknown / no-docket statuses get honest fallback chips",
  mod._msSesStatusChip("NO_DOCKET").label === "NO SES PACK" &&
    mod._msSesStatusChip("whatever").label === "SES UNKNOWN",
);
check(
  "_msSesIsStale classifies 409s and stale_review refusals",
  mod._msSesIsStale({ status: 409 }) &&
    mod._msSesIsStale({ refusal: { code: "stale_review" } }) &&
    !mod._msSesIsStale({ status: 500 }) &&
    !mod._msSesIsStale(null),
);

// ── 15. Card money-review chip still comes from the live feed ────────────────
const moneyDraft = Object.assign({}, feedDraft, {
  job_id: "job-mr",
  needs_money_review: true,
  money_review: { needs_money_review: true, reason: "Unit price above rate card" },
});
check(
  "the card still renders CHECK PRICING from the live feed",
  mod.renderMsReportingCard(moneyDraft).includes("CHECK PRICING"),
);
check(
  "a clean feed row renders no CHECK PRICING chip",
  !mod.renderMsReportingCard(feedDraft).includes("CHECK PRICING"),
);

console.log("");
if (failures) {
  console.log("SMOKE FAILED: " + failures + " check(s) failed.");
  process.exit(1);
} else {
  console.log("SMOKE PASSED: all checks ok.");
  process.exit(0);
}
