// Standalone smoke test for the MakeSafe Reporting cockpit module (SES wiring).
//
// The ops dashboard has no JS test runner; this is a stricter, automated smoke
// for the MONEY/COMMS-critical reporting cockpit: it evals the module in a
// stubbed browser-ish global scope and asserts the SES gate-critical wiring
// WITHOUT a real browser, real DOM, or real network:
//   - the list renders from the SES Docs Ready queue (list_ses_docs_ready_reviews)
//     and NEVER reads the retired legacy makesafe_report_drafts feed; card
//     identity is joined from the canonical makesafe_board feed and each card's
//     chip + invoice glance are enriched from query_ses_review_cockpit;
//   - the board door (openMakesafeJob, extracted from ops.html) opens the SES
//     review overlay for a queued job and falls back to the canonical job
//     detail only when no SES docket AND no legacy pack exist;
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
const OPS_HTML = join(__dirname, "..", "ops.html");
const code = readFileSync(SRC, "utf8");
const opsHtml = readFileSync(OPS_HTML, "utf8");

function extractOpsBlock(open, close) {
  const start = opsHtml.indexOf(open);
  const end = opsHtml.indexOf(close);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Missing ${open} block in ${OPS_HTML}`);
  }
  return opsHtml.slice(start + open.length, end);
}

const suburbParserSource = extractOpsBlock(
  "// <makesafe-suburb-from-address>",
  "// </makesafe-suburb-from-address>",
);
const makesafeSuburbFromAddress = new Function(
  suburbParserSource + "\nreturn makesafeSuburbFromAddress;",
)();

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
// Every action ever dispatched (never reset) so the retired-action sweep covers
// the whole run, not just the last section.
const actionLog = [];

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
    actionLog.push(action);
    return dispatch(behaviour.fetch, action);
  },
  opsPost: (action, body) => {
    calls.opsPost.push({ action, body });
    actionLog.push(action);
    return dispatch(behaviour.post, action);
  },
  opsPostJwt: (action, body) => {
    calls.opsPostJwt.push({ action, body });
    actionLog.push(action);
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
  // Board-feed state the identity join reads (ops.html globals). Object holders
  // so scenarios can mutate .columns; the module's typeof guards must also
  // tolerate their absence.
  _pipelineTab: "makesafes",
  _pipelineData: { columns: {} },
  _makesafeBoardPayload: { columns: null },
  // The actual board degraded-path parser extracted from ops.html. The module
  // consumes this global in production, so the smoke must not carry a mirror.
  makesafeSuburbFromAddress,
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
  "_msSesQueueCardRow",
  "_msSesReviewQueueStale",
  "_msSwitchDocTab",
  "_msReportingDocTabs",
  "_msRenderDocStage",
  "_msReportingHideJobFromActiveList",
  "_msGetAllPhotos",
  "_msIsPortalBuilder",
  "_msIsAjsBuilder",
  "_msSesAjsIntendedEmails",
  "_msSesRenderDetail",
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
check(
  "defines the queue card-row builder + queue staleness gate",
  typeof mod._msSesQueueCardRow === "function" &&
    typeof mod._msSesReviewQueueStale === "function",
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
// The list must never read the retired legacy drafts feed again (it is empty in
// production and its approve path answers 410).
check(
  "source never reads the retired legacy drafts feed",
  !/ops(?:Post|Fetch|PostJwt)\(\s*['"]makesafe_report_drafts['"]/.test(code),
);
// No multi-job release can be built from this surface: the only prepare call
// must bind exactly one job.
check(
  "prepare_ses_release_revision is wired single-job only",
  /prepare_ses_release_revision['"]\s*,\s*prepBody/.test(code) &&
    /prepBody\s*=\s*\{\s*job_ids:\s*\[jobId\]\s*\}/.test(code),
);

// The shipped degraded-path parser must handle both canonical address shapes.
check(
  "separate state/postcode segment resolves the preceding suburb",
  makesafeSuburbFromAddress("186 Tyler Street, Tuart Hill, WA 6060") === "Tuart Hill",
);
check(
  "split comma-delimited state/postcode resolves the preceding suburb",
  makesafeSuburbFromAddress("186 Tyler Street, Tuart Hill, WA, 6060") === "Tuart Hill",
);
check(
  "same-segment state/postcode suffix resolves the suburb",
  makesafeSuburbFromAddress("4 Warrior Pass, Bertram WA 6167") === "Bertram",
);
check(
  "suburb-only tail remains the suburb",
  makesafeSuburbFromAddress("28 Peninsula Road, Maylands") === "Maylands",
);
check(
  "single-segment address does not invent a suburb",
  makesafeSuburbFromAddress("Single street only") === "",
);

// ── 4. Fixtures ──────────────────────────────────────────────────────────────
const JOB = "job-1";
const DOCKET_REV = "11111111-1111-1111-1111-111111111111";
const HASH = "sha256:" + "a".repeat(64);
const PHOTO_HASH_1 = "sha256:" + "b".repeat(64);
const PHOTO_HASH_2 = "sha256:" + "c".repeat(64);
const REPORT_HASH = "sha256:" + "d".repeat(64);
const XERO_PDF_HASH = "sha256:" + "e".repeat(64);

// The legacy drafts feed row. Still stubbed so the smoke proves the module
// chooses NOT to read it — a card can only ever come from the SES queue.
const legacyFeedDraft = {
  job_id: JOB,
  job_number: "MS-100",
  builder: "Ghost Builder (legacy feed)",
  external_ref: "GHOST-1",
  site_suburb: "Ghostville",
  invoice: { total_inc_gst: 999 },
};

// The canonical makesafe_board row the identity join projects (raw feed shape).
const boardRawRow = {
  id: JOB,
  job_number: "261065",
  contact: {
    client_name: "Jane Homeowner",
    address: "12 Smith Street, Joondalup WA 6027",
  },
  builder: { name: "MLB Constructions", external_ref: "MLB-25248" },
  ses_family: "physical_makesafe",
  ses_family_label: "Physical make safe",
  pack: { drafted: true, state: "drafted" },
};
const boardPayloadStub = {
  contract_version: "makesafe-board.v1",
  columns: { report_ready: [boardRawRow] },
};

// The mapped board card (canonical row + close-out enrichment already joined by
// fetchMakesafeBoardData) — carries the true enriched site_suburb and wins over
// the raw projection.
const mappedCard = {
  id: JOB,
  job_number: "261065",
  requesting_company_name: "MLB Constructions",
  builder: { name: "MLB Constructions" },
  external_ref: "MLB-25248",
  site_suburb: "Joondalup",
  site_address: "12 Smith Street, Joondalup WA 6027",
  client_name: "Jane Homeowner",
  requesting_company_slug: "mlb",
  ses_family: "physical_makesafe",
  ses_family_label: "Physical make safe",
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
      job_story: { job_id: JOB, job_number: "261065", attendance_cycle_ids: [] },
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
  docket_stage: "pre_xero",
  review_state: "needs_review",
  review_state_changed_at: "2026-08-03T01:00:00Z",
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

// Main scenario: the queue holds JOB, the mapped board card is loaded (the
// captain came from the board), the raw canonical payload is not cached.
function seedSendReady() {
  behaviour.fetch = {
    makesafe_report_drafts: { drafts: [legacyFeedDraft] },
    list_ses_docs_ready_reviews: { dockets: [queueRow] },
    query_ses_review_cockpit: cockpitSendReady(),
    get_ses_reviewable_pack: reviewablePack(),
    makesafe_board: boardPayloadStub,
  };
  behaviour.post = {};
  behaviour.postJwt = {};
  sandbox._pipelineData.columns = { report_ready: [mappedCard] };
  sandbox._makesafeBoardPayload.columns = null;
}

// ── 5. List load: the SES queue owns the cards; identity joins from the board ─
seedSendReady();
await mod.loadMakesafeReportingCockpit();
check(
  "load refreshes the SES Docs Ready queue",
  calls.opsFetch.some((c) => c.action === "list_ses_docs_ready_reviews"),
);
check(
  "load NEVER reads the retired legacy drafts feed",
  !calls.opsFetch.some((c) => c.action === "makesafe_report_drafts"),
);
const listHtml = elements["msReportingListBody"]._html || "";
check(
  "a card is rendered into the list body for the queued pack",
  listHtml.includes("Major Loss Builders"),
);
check(
  "the card identity is joined from the board feed (ref / job number / suburb)",
  listHtml.includes("MLB-25248") && listHtml.includes("261065") &&
    listHtml.includes("Joondalup"),
);
check(
  "no identity fact comes from the legacy feed ghost",
  !listHtml.includes("Ghost Builder") && !listHtml.includes("GHOST-1") &&
    !listHtml.includes("Ghostville") && !listHtml.includes("MS-100"),
);
check(
  "the card chip starts neutral and carries the enrichment hook id",
  listHtml.includes("msCardBadge_job_1"),
);
check(
  "the card carries the money + job-number enrichment hooks",
  listHtml.includes("msCardMoney_job_1") && listHtml.includes("msCardJob_job_1"),
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
check(
  "the invoice glance fills from the SES money section (local_invoice_proposal.total_inc_gst)",
  (elements["msCardMoney_job_1"]._html || "").includes("$110.00"),
);

// ── 5b. Card identity sources: mapped cards / cached payload / one read ──────
// Cached raw canonical payload (no mapped cards loaded): the suburb comes off
// the contact.address tail via the board's own degraded-path helper.
sandbox._pipelineData.columns = null;
sandbox._makesafeBoardPayload.columns = { report_ready: [boardRawRow] };
calls.opsFetch.length = 0;
await mod.loadMakesafeReportingCockpit();
const rawJoinHtml = elements["msReportingListBody"]._html || "";
check(
  "identity projects from the cached canonical payload when no mapped cards are loaded",
  rawJoinHtml.includes("261065") && rawJoinHtml.includes("Joondalup") &&
    rawJoinHtml.includes("MLB-25248"),
);
check(
  "the cached-payload path does NOT re-read the board feed",
  !calls.opsFetch.some((c) => c.action === "makesafe_board"),
);
// Regression for the production failure shape: the canonical address ends in
// its own `WA 6060` segment, so the cockpit card must render the segment before
// it instead of publishing the state token as the suburb.
const separateStateTailRow = {
  ...boardRawRow,
  contact: {
    ...boardRawRow.contact,
    address: "186 Tyler Street, Tuart Hill, WA 6060",
  },
  builder: {
    ...boardRawRow.builder,
    external_ref: "MLB-26658PO-56313",
  },
};
sandbox._makesafeBoardPayload.columns = { report_ready: [separateStateTailRow] };
calls.opsFetch.length = 0;
await mod.loadMakesafeReportingCockpit();
const separateStateTailHtml = elements["msReportingListBody"]._html || "";
check(
  "cached canonical MLB-26658PO-56313 card renders Tuart Hill, never Suburb: WA",
  separateStateTailHtml.includes("<strong>Suburb:</strong> Tuart Hill") &&
    !separateStateTailHtml.includes("<strong>Suburb:</strong> WA"),
);
// Neither cache in memory (Approvals tab opened first): one read-only GET of
// the same canonical feed.
sandbox._makesafeBoardPayload.columns = null;
calls.opsFetch.length = 0;
await mod.loadMakesafeReportingCockpit();
check(
  "with no board state in memory the canonical feed is read once for identity",
  calls.opsFetch.filter((c) => c.action === "makesafe_board").length === 1,
);
check(
  "the fetched-feed path still renders the joined identity",
  (elements["msReportingListBody"]._html || "").includes("Joondalup"),
);

// ── 5c. Empty queue: the honest empty state, badge cleared ──────────────────
sandbox._pipelineData.columns = { report_ready: [mappedCard] };
behaviour.fetch["list_ses_docs_ready_reviews"] = { dockets: [] };
await mod.loadMakesafeReportingCockpit();
check(
  "an empty SES queue renders the honest empty state",
  (elements["msReportingListBody"]._html || "").includes(
    "No packs awaiting review",
  ),
);
check(
  "an empty SES queue clears the badge",
  elements["msReportingBadge"].style.display === "none",
);

// ── 6. Detail: byte-exact pack, routes, fixed photos, invoice, controls ─────
seedSendReady();
await mod.loadMakesafeReportingCockpit();
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
  "detail header renders the board-joined identity (builder / ref / job number)",
  detailHtml.includes("Major Loss Builders") && detailHtml.includes("MLB-25248") &&
    detailHtml.includes("261065"),
);
check(
  "detail renders the three condensed routes SEND IT releases (non-AJS truth)",
  detailHtml.includes("what SEND IT releases") &&
    detailHtml.includes("Report email") &&
    detailHtml.includes("Photo email") &&
    detailHtml.includes("Invoice email") &&
    /msr-mail condensed/.test(detailHtml),
);
check(
  "detail states SEND IT sends all three emails at once",
  /all three emails? at once/i.test(detailHtml),
);
check(
  "detail uses condensed TO/CC/subject line — no 'why this' essays",
  detailHtml.includes("msr-mail-line") &&
    detailHtml.includes("accounts@mlb.com.au") &&
    !detailHtml.includes("Why this, for this job") &&
    !detailHtml.includes("msr-why"),
);
check(
  "primary action stamps sit in the bottom action foot (after emails)",
  /msr-actions msr-actions-foot/.test(detailHtml) &&
    detailHtml.indexOf("Outgoing emails") < detailHtml.indexOf("msr-actions-foot") &&
    detailHtml.indexOf("msSesSendItBtn") > detailHtml.indexOf("Outgoing emails"),
);
check(
  "photos / feedback folds collapse by default",
  /msr-fold/.test(detailHtml) &&
    detailHtml.includes(">Photos</h3>") &&
    detailHtml.includes(">Feedback</h3>") &&
    !/<details class="msr-fold" open/.test(detailHtml),
);
check(
  "detail leads with the one next action for the enabled control",
  /Next</.test(detailHtml) &&
    /press <strong>SEND IT<\/strong>/.test(detailHtml) &&
    !/press <strong>APPROVE INVOICE<\/strong>/.test(detailHtml),
);
check(
  "detail shows the route recipient, cc and subject",
  detailHtml.includes("accounts@mlb.com.au") &&
    detailHtml.includes("ses@secureworkswa.com.au") &&
    detailHtml.includes("Make Safe Completion - MLB-25248"),
);
check(
  "detail renders the read-only photo state (1 in the email, 1 evidence-only)",
  detailHtml.includes("fixed in the release") &&
    /1 of 2 photos in the photo email/.test(detailHtml) &&
    /1 kept as evidence only/.test(detailHtml) &&
    /msr-photo ok/.test(detailHtml) && /msr-photo ev/.test(detailHtml),
);
check(
  "detail has NO include/exclude photo toggles (fixed set)",
  !detailHtml.includes("_msTogglePhotoApproval"),
);
check(
  "the invoice is a DOCUMENT: an Invoice tab, and the Xero binding is cited",
  detailHtml.includes(">Invoice</button>") &&
    detailHtml.includes("INV-1234"),
);
// The drafted proposal renders as an invoice PAGE on the stage when no
// invoice PDF is bound (lines + totals from the row's own figures).
{
  const proposalRow = {
    invoice: {
      invoice_number: null,
      status: "SES proposal (not yet in Xero)",
      lines: [{ description: "Temp fence hire", quantity: 2, unit_price: 50, line_total: 100 }],
      total_ex_gst: 100,
      total_inc_gst: 110,
    },
    draft_docs: [], source_docs: [], photos: [],
  };
  const proposalTabs = mod._msReportingDocTabs(proposalRow);
  const invStage = mod._msRenderDocStage(proposalTabs, 0, proposalRow);
  check(
    "the proposal invoice document carries the lines, totals and DRAFT status",
    proposalTabs.length === 1 && proposalTabs[0].tabLabel === "Invoice" &&
      invStage.includes("Tax Invoice") &&
      invStage.includes("Temp fence hire") &&
      invStage.includes("$110.00") &&
      invStage.includes("SES proposal, not yet in Xero"),
  );
}
// A builder SOURCE attachment whose file name says "invoice" must NOT claim the
// Invoice tab — the drafted proposal page would become unreachable.
{
  const builderInvoiceRow = {
    invoice: {
      invoice_number: null,
      status: "SES proposal (not yet in Xero)",
      lines: [{ description: "Temp fence hire", quantity: 2, unit_price: 50, line_total: 100 }],
      total_ex_gst: 100,
      total_inc_gst: 110,
    },
    draft_docs: [],
    source_docs: [
      { label: "invoice_MLB-25248", url: "https://example.com/invoice_MLB-25248.pdf", kind: "pdf" },
    ],
    photos: [],
  };
  const bTabs = mod._msReportingDocTabs(builderInvoiceRow);
  const invTabs = bTabs.filter((t) => t.tabLabel === "Invoice");
  check(
    "a source attachment named invoice_*.pdf does not suppress the drafted invoice document",
    invTabs.length === 1 && invTabs[0].kind === "invdoc" &&
      bTabs.some((t) => t.kind === "pdf" && t.tabLabel !== "Invoice"),
  );
}
// A second work order is NEVER collapsed into the first tab
// (<makesafe-workorder-identity>: no surface may pick one and hide the rest).
{
  const twoWoRow = {
    invoice: null,
    draft_docs: [],
    source_docs: [
      { label: "work_order_MLB-26183PO-54000_a", url: "https://example.com/wo1.pdf", kind: "pdf" },
      { label: "work_order_MLB-26183PO-61000_b", url: "https://example.com/wo2.pdf", kind: "pdf" },
    ],
    photos: [],
  };
  const woTabs = mod._msReportingDocTabs(twoWoRow).filter((t) => t.isWorkOrder);
  check(
    "two work orders get two distinct tabs, never one",
    woTabs.length === 2 && woTabs[0].tabLabel !== woTabs[1].tabLabel,
  );
}
check(
  "detail renders doc tabs from the pack artifacts",
  detailHtml.includes("Make Safe Report") &&
    detailHtml.includes(">Invoice</button>") &&
    detailHtml.includes("SWMS") &&
    detailHtml.includes("Work Order"),
);
check(
  "detail opens the report PDF fit-to-page in the stage",
  detailHtml.includes("https://example.com/report.pdf#view=Fit") &&
    detailHtml.includes("<iframe") &&
    detailHtml.includes("fit to page"),
);
check(
  "the trade-notes section renders only when a feed carries raw trade notes",
  !detailHtml.includes("Trade notes (raw from submission)"),
);
check(
  "detail renders the per-job SEND IT button (never a send-all)",
  detailHtml.includes('id="msSesSendItBtn"') &&
    detailHtml.includes("sendSesRelease(&#x27;" + JOB) ||
    detailHtml.includes("sendSesRelease('" + JOB),
);
check(
  "a disabled APPROVE INVOICE renders as a visible stamp with NO id and NO onclick",
  !detailHtml.includes('id="msSesApproveInvoiceBtn"') &&
    !detailHtml.includes("approveSesInvoice(") &&
    /msr-stamp approve" disabled/.test(detailHtml) &&
    /Already done/.test(detailHtml),
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
// A signed-off docket has dropped out of the needs_review queue: the list shows
// the honest empty state, the detail self-seeds its identity from the board
// join, no pack fetch happens, the tick copy flips, and the chain starts at
// prepare.
behaviour.fetch["list_ses_docs_ready_reviews"] = { dockets: [] };
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.opsFetch.length = 0;
await mod.loadMakesafeReportingCockpit();
check(
  "the list empties when the queue empties (no legacy ghosts)",
  (elements["msReportingListBody"]._html || "").includes(
    "No packs awaiting review",
  ),
);
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
  "signed-off detail renders the invoice document from the cockpit money facts",
  signedOffHtml.includes(">Invoice</button>") &&
    signedOffHtml.includes("Tax Invoice") &&
    signedOffHtml.includes("Temp fence hire"),
);
check(
  "signed-off detail still renders the routes from the cockpit",
  signedOffHtml.includes("Report email"),
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
  "a stale_review reloads the fresh pack from the SES queue",
  calls.opsFetch.some((c) => c.action === "list_ses_docs_ready_reviews"),
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
  "APPROVE INVOICE's note renders the backend's own plan text verbatim",
  invoiceHtml.includes("Create one Xero DRAFT for this exact obligation revision."),
);
// Switching to the Invoice tab renders the proposal as an invoice document,
// honestly marked not-yet-in-Xero.
{
  const preXeroTabs = mod._msReportingDocTabs({
    invoice: mod._msSesMapInvoice({ cockpit: cockpitInvoiceReady(), pack: preXeroPack }),
    draft_docs: [], source_docs: [], photos: [],
  });
  const invIdx = preXeroTabs.findIndex((t) => t.kind === "invdoc");
  // Switch to the tab the RENDERED pane actually labelled "Invoice", not a
  // literal index that silently drifts when tab ordering changes.
  const renderedInvIdx = (() => {
    const m = /data-tabidx="(\d+)"[^>]*>Invoice<\/button>/.exec(invoiceHtml);
    return m ? Number(m[1]) : -1;
  })();
  mod._msSwitchDocTab(JOB, renderedInvIdx, "msReportingDetailPanel");
  const stageHtml = elements["msDocStage_job_1"] ? (elements["msDocStage_job_1"]._html || "") : "";
  check(
    "the pre-Xero Invoice tab shows the proposal document, marked not yet in Xero",
    invIdx >= 0 &&
      renderedInvIdx >= 0 &&
      stageHtml.includes("SES proposal, not yet in Xero") &&
      stageHtml.includes("Temp fence hire"),
  );
}
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

// ── 11. HOLD: one amber block, numbered + deduped verbatim blockers each
//        with its clear path; both stamps visible but unpressable ────────────
const holdCockpit = cockpitSendReady();
holdCockpit.status = "HOLD";
holdCockpit.sections.status = {
  status: "HOLD",
  stale: false,
  // The duplicate is deliberate: the backend can emit the same blocker once
  // per route (this is how "builder email draft missing" printed twice on the
  // captain's screen). The block must collapse it.
  reasons: [
    "The insurance work order is missing from this docket.",
    "Builder email draft missing.",
    "Builder email draft missing.",
  ],
};
holdCockpit.controls.approve_invoice.enabled = false;
holdCockpit.controls.send_it.enabled = false;
behaviour.fetch["query_ses_review_cockpit"] = holdCockpit;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const holdHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "HOLD renders the backend blocker facts verbatim",
  holdHtml.includes("The insurance work order is missing from this docket.") &&
    holdHtml.includes("Builder email draft missing."),
);
check(
  "HOLD deduplicates a blocker the backend emitted twice",
  holdHtml.split("Builder email draft missing.").length - 1 === 1,
);
check(
  "HOLD renders exactly ONE amber block, numbered, with a clear path per blocker",
  holdHtml.split('class="msr-hold"').length - 1 === 1 &&
    holdHtml.includes('<ol class="msr-blockers">') &&
    holdHtml.split("What clears it").length - 1 === 2 &&
    /There is no override/.test(holdHtml),
);
check(
  "the HOLD next action counts the deduped blockers",
  /Clear <strong>2 blockers<\/strong> below/.test(holdHtml),
);
check(
  "HOLD arms NO action: stamps visible but disabled, no ids, no onclick",
  !holdHtml.includes('id="msSesSendItBtn"') &&
    !holdHtml.includes('id="msSesApproveInvoiceBtn"') &&
    !holdHtml.includes("sendSesRelease(") &&
    !holdHtml.includes("approveSesInvoice(") &&
    /msr-stamp approve" disabled/.test(holdHtml) &&
    /msr-stamp send" disabled/.test(holdHtml) &&
    /Locked by the hold above/.test(holdHtml),
);
// Even a programmatic call cannot act while the backend flags are off.
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.confirms.length = 0;
await mod.sendSesRelease(JOB);
await mod.approveSesInvoice(JOB);
check(
  "sendSesRelease / approveSesInvoice refuse to run while the backend flags are off",
  calls.opsPost.length === 0 && calls.opsPostJwt.length === 0 &&
    calls.confirms.length === 0,
);

// ── 12. Queue/cockpit disagreement + no SES docket: honest states ───────────
// A queued job whose docket dropped out between the queue read and the cockpit
// read gets the honest NO SES PACK chip — never an invented state — and the
// detail renders the no-pack state with no actions.
behaviour.fetch["list_ses_docs_ready_reviews"] = {
  dockets: [Object.assign({}, queueRow, { job_id: "job-no-docket" })],
};
behaviour.fetch["query_ses_review_cockpit"] = new Error(
  "No current SES docket revision exists for this job.",
);
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
await mod.loadMakesafeReportingCockpit();
await flush();
check(
  "a queued job whose docket vanished gets the honest NO SES PACK chip",
  elements["msCardBadge_job_no_docket"].textContent === "NO SES PACK",
);
await mod.showMsReportingDetail("job-no-docket");
const noDocketHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "a job with no SES docket renders the honest State B not-ready refusal",
  noDocketHtml.includes("Draft pack not ready yet") &&
    noDocketHtml.includes("Nothing to send yet") &&
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

// ── 15. Cards render queue + joined identity facts only ─────────────────────
const bareCardHtml = mod.renderMsReportingCard({
  job_id: "job-bare",
  ses_docket_revision_id: DOCKET_REV,
});
check(
  "a card with no joined identity invents no facts (no suburb / ref / pricing chip)",
  !bareCardHtml.includes("Suburb") && !bareCardHtml.includes("Ref:") &&
    !bareCardHtml.includes("CHECK PRICING") &&
    bareCardHtml.includes("(no builder)"),
);
check(
  "a bare card still carries the enrichment hooks + review action",
  bareCardHtml.includes("msCardBadge_job_bare") &&
    bareCardHtml.includes("msCardMoney_job_bare") &&
    bareCardHtml.includes("Review job pack"),
);
const joinedCardHtml = mod.renderMsReportingCard(
  mod._msSesQueueCardRow(JOB, queueRow, {
    job_number: "261065",
    builder: "MLB Constructions",
    external_ref: "MLB-25248",
    site_suburb: "Joondalup",
  }),
);
check(
  "a joined card renders the queue + identity facts",
  joinedCardHtml.includes("MLB-25248") && joinedCardHtml.includes("261065") &&
    joinedCardHtml.includes("Joondalup"),
);
check(
  "the queue card row carries NO legacy send fields (resume_action / pack_status)",
  !("resume_action" in mod._msSesQueueCardRow(JOB, queueRow, null)) &&
    !("pack_status" in mod._msSesQueueCardRow(JOB, queueRow, null)),
);

// ── 16. The board door (openMakesafeJob, extracted from ops.html) ───────────
const OPS_SRC = join(__dirname, "..", "ops.html");
const opsCode = readFileSync(OPS_SRC, "utf8");
const doorStart = opsCode.indexOf("async function openMakesafeJob(jobId) {");
const doorEnd = opsCode.indexOf("/**\n * Mount a board overlay", doorStart);
check(
  "ops.html door source located for extraction",
  doorStart > 0 && doorEnd > doorStart,
);
const doorSrc = opsCode.slice(doorStart, doorEnd);
check(
  "the door no longer primes the legacy drafts feed",
  !/loadMakesafeReportingCockpit/.test(doorSrc),
);
check(
  "the door source never calls a retired action",
  !/makesafe_send_pack|makesafe_send_photo_followup|makesafe_resume_close|makesafe_reset_failed_pack/
    .test(doorSrc),
);

function makeDoor(env) {
  const names = Object.keys(env);
  // eslint-disable-next-line no-new-func
  return new Function(
    ...names,
    '"use strict";\n' + doorSrc + "\nreturn openMakesafeJob;",
  )(...names.map((n) => env[n]));
}
function doorEnv(over) {
  const doorCalls = {
    overlay: [],
    detail: [],
    jobDetail: [],
    queueRefresh: 0,
  };
  const env = {
    _msSesReviewQueue: {},
    _msReportingCache: {},
    _msSesReviewQueueStale: () => false,
    _msSesRefreshReviewQueue: async () => {
      doorCalls.queueRefresh++;
    },
    _msIsPortalBuilder: () => false,
    showMsReportingDetail: (jobId, panelId) => {
      doorCalls.detail.push({ jobId, panelId });
    },
    openMakesafeReviewOverlay: (overlayId, panelId) => {
      doorCalls.overlay.push({ overlayId, panelId });
    },
    openJobDetail: (jobId) => {
      doorCalls.jobDetail.push(jobId);
    },
  };
  Object.assign(env, over || {});
  return { env, calls: doorCalls };
}

// (a) A queued job opens the SES review overlay in the board host.
const doorA = doorEnv({
  _msSesReviewQueue: {
    "job-1": { job_id: "job-1", docket_revision_id: DOCKET_REV },
  },
});
await makeDoor(doorA.env)("job-1");
check(
  "door opens the SES review overlay for a queued job",
  doorA.calls.overlay.length === 1 &&
    doorA.calls.overlay[0].overlayId === "makesafeReportingOverlay" &&
    doorA.calls.detail.length === 1 &&
    doorA.calls.detail[0].jobId === "job-1" &&
    doorA.calls.detail[0].panelId === "msReportingDetailPanelBoard" &&
    doorA.calls.jobDetail.length === 0,
);
check(
  "door does not re-read the queue on a hit",
  doorA.calls.queueRefresh === 0,
);

// (b) No docket + a fresh queue + no legacy pack -> the canonical job detail,
// with no queue re-read.
const doorB = doorEnv();
await makeDoor(doorB.env)("job-2");
check(
  "door falls back to the job detail when no docket and no legacy pack exist",
  doorB.calls.jobDetail.length === 1 && doorB.calls.jobDetail[0] === "job-2" &&
    doorB.calls.overlay.length === 0 && doorB.calls.detail.length === 0,
);
check(
  "door does not re-read a fresh queue on a miss",
  doorB.calls.queueRefresh === 0,
);

// (c1) A stale queue is re-read on a miss; a docket that just entered review
// opens the SES overlay.
const doorC1 = doorEnv({ _msSesReviewQueueStale: () => true });
doorC1.env._msSesRefreshReviewQueue = async () => {
  doorC1.calls.queueRefresh++;
  // Mutate the SAME object the door holds (the real refresh reassigns the
  // page-global map; the extracted function sees this one's properties).
  doorC1.env._msSesReviewQueue["job-3"] = {
    job_id: "job-3",
    docket_revision_id: DOCKET_REV,
  };
};
await makeDoor(doorC1.env)("job-3");
check(
  "door re-reads a stale queue on a miss and opens the SES overlay when the docket appears",
  doorC1.calls.queueRefresh === 1 && doorC1.calls.overlay.length === 1 &&
    doorC1.calls.jobDetail.length === 0,
);

// (c2) A stale re-read that finds no docket falls back to the job detail.
const doorC2 = doorEnv({ _msSesReviewQueueStale: () => true });
await makeDoor(doorC2.env)("job-4");
check(
  "door falls back to the job detail after a stale re-read finds no docket",
  doorC2.calls.queueRefresh === 1 && doorC2.calls.jobDetail.length === 1 &&
    doorC2.calls.overlay.length === 0,
);

// (d) Legacy safety net: no SES entry, but a genuinely actionable legacy pack
// is cached -> the review overlay still opens (it can never shadow an SES card:
// the SES gate ran first).
const doorD = doorEnv({
  _msReportingCache: { "job-5": { job_id: "job-5", resume_action: "send" } },
});
await makeDoor(doorD.env)("job-5");
check(
  "door keeps the legacy actionable-pack safety net below the SES gate",
  doorD.calls.overlay.length === 1 && doorD.calls.jobDetail.length === 0,
);

// (e) The SES gate wins over a failed legacy cache row (which the legacy branch
// would reject): a queued job still opens the review overlay.
const doorE = doorEnv({
  _msSesReviewQueue: {
    "job-6": { job_id: "job-6", docket_revision_id: DOCKET_REV },
  },
  _msReportingCache: {
    "job-6": { job_id: "job-6", pack_status: { status: "failed" } },
  },
});
await makeDoor(doorE.env)("job-6");
check(
  "the SES gate opens even over a failed legacy cache row",
  doorE.calls.overlay.length === 1 && doorE.calls.jobDetail.length === 0,
);

// (f) The SES module absent entirely (typeof guards) -> the canonical job
// detail, no throw.
const doorF = doorEnv();
delete doorF.env._msSesReviewQueue;
delete doorF.env._msSesRefreshReviewQueue;
delete doorF.env._msSesReviewQueueStale;
await makeDoor(doorF.env)("job-7");
check(
  "door degrades to the job detail when the SES module is absent",
  doorF.calls.jobDetail.length === 1 && doorF.calls.overlay.length === 0,
);

// ── 17. AJS two-email shape: preview when backend still builds 3 routes ─────
{
  // Bertram-shaped AJS identity + three backend routes.
  const ajsId = {
    job_id: "ajs-job",
    builder: "AJ Building & Restoration",
    external_ref: "AJBR-70271",
    requesting_company_slug: "aj",
    site_suburb: "Bertram",
    job_number: "SWMS-261109",
  };
  check("_msIsAjsBuilder recognises AJ Building / AJBR", mod._msIsAjsBuilder(ajsId) === true);
  check("_msIsAjsBuilder rejects MLB", mod._msIsAjsBuilder({ builder: "MLB Constructions", external_ref: "MLB-1", requesting_company_slug: "mlb" }) === false);

  sandbox._msReportingCache = sandbox._msReportingCache || {};
  // Seed identity the way showMsReportingDetail's list path would.
  // Direct render via _msSesRenderDetail with a three-route cockpit.
  const ajsCockpit = cockpitSendReady();
  ajsCockpit.sections.email_drafts = [
    {
      route_kind: "report",
      recipients: ["workorders@ajs.build"],
      cc: ["vanessa@ajs.build"],
      subject: "Make Safe Report - AJBR-70271 - Bertram",
      body: "Report body for Bertram. Photos follow separately. Invoice follows separately.",
      attachment_hashes: [REPORT_HASH],
      ready: true,
    },
    {
      route_kind: "photo",
      recipients: ["workorders@ajs.build"],
      cc: ["vanessa@ajs.build"],
      subject: "Photo Evidence - AJBR-70271 - Bertram",
      body: "Site photos attached as separate files.",
      attachment_hashes: [PHOTO_HASH_1],
      ready: true,
    },
    {
      route_kind: "invoice",
      recipients: ["vanessa@ajs.build"],
      cc: [],
      subject: "Make Safe Invoice - AJBR-70271 - Bertram",
      body: "Invoice attached for AJBR-70271.",
      attachment_hashes: [XERO_PDF_HASH],
      ready: true,
    },
  ];
  // Put identity in the cache the renderer reads.
  if (typeof mod._msSesRenderDetail === "function") {
    // The smoke sandbox does not re-export _msReportingCache mutably on mod;
    // the module closes over the sandbox's globals via new Function — but
    // _msReportingCache is module-local. Seed through the exposed path used
    // by showMsReportingDetail: load a card then override.
  }
  // Use the list/detail path: queue one AJS job with board identity.
  const AJS_JOB = "ajs-bertram-job";
  behaviour.fetch.list_ses_docs_ready_reviews = {
    dockets: [{
      job_id: AJS_JOB,
      docket_revision_id: DOCKET_REV,
      docket_output_content_hash: HASH,
      review_state: "needs_review",
    }],
  };
  behaviour.fetch.makesafe_board = {
    contract_version: "makesafe-board.v1",
    columns: {
      report_ready: [{
        id: AJS_JOB,
        job_number: "SWMS-261109",
        contact: { address: "Bertram WA 6167" },
        builder: { name: "AJ Building & Restoration", external_ref: "AJBR-70271" },
        ses_family: "physical_makesafe",
        ses_family_label: "Make safe",
        pack: { drafted: true, state: "drafted" },
      }],
    },
  };
  // Mapped board wins for suburb/slug when present. Mutate the SAME object the
  // module closed over as a parameter (reassigning sandbox._pipelineData would
  // not reach the module's binding).
  sandbox._pipelineTab = "makesafes";
  sandbox._pipelineData.columns = {
    report_ready: [{
      id: AJS_JOB,
      job_number: "SWMS-261109",
      requesting_company_name: "AJ Building & Restoration",
      builder: "AJ Building & Restoration",
      external_ref: "AJBR-70271",
      site_suburb: "Bertram",
      requesting_company_slug: "aj",
      ses_family: "physical_makesafe",
      ses_family_label: "Make safe",
    }],
  };
  sandbox._makesafeBoardPayload.columns = null;
  behaviour.fetch.query_ses_review_cockpit = ajsCockpit;
  behaviour.fetch.get_ses_reviewable_pack = {
    review: {
      docket_revision_id: DOCKET_REV,
      review_state: "needs_review",
      docket_output_content_hash: HASH,
    },
    docket: { id: DOCKET_REV, output_content_hash: HASH },
    artifacts: [
      {
        role: "supporting_report_pdf",
        object_key: "Make Safe Report.pdf",
        media_type: "application/pdf",
        content_hash: REPORT_HASH,
        signed_url: "https://example.com/report.pdf",
      },
      {
        role: "xero_invoice_pdf",
        object_key: "Invoice.pdf",
        media_type: "application/pdf",
        content_hash: XERO_PDF_HASH,
        signed_url: "https://example.com/invoice.pdf",
      },
      {
        role: "completion_photo",
        object_key: "Photo 01.jpg",
        media_type: "image/jpeg",
        content_hash: PHOTO_HASH_1,
        signed_url: "https://example.com/p1.jpg",
      },
    ],
  };
  await mod.loadMakesafeReportingCockpit();
  await mod.showMsReportingDetail(AJS_JOB);
  const ajsHtml = elements["msReportingDetailPanel"]._html || "";
  check(
    "AJS three-route backend shows the intended 2-email PREVIEW (not truth-as-sent)",
    ajsHtml.includes("Preview of the intended AJS shape") &&
      ajsHtml.includes("not what SEND IT sends today") &&
      ajsHtml.includes("Report + invoice") &&
      ajsHtml.includes("Photos (follow-up)") &&
      !ajsHtml.includes("Report email") &&
      !ajsHtml.includes("Invoice email"),
  );
  check(
    "AJS preview still discloses that SEND IT releases three routes today",
    /still builds <strong>three routes<\/strong>/i.test(ajsHtml) ||
      /still builds three routes/i.test(ajsHtml.replace(/<[^>]+>/g, " ")),
  );
  check(
    "AJS preview is condensed (chips + one-line meta, no why-this essays)",
    /msr-mail condensed/.test(ajsHtml) &&
      ajsHtml.includes("workorders@ajs.build") &&
      !ajsHtml.includes("Why this, for this job"),
  );

  // When the backend already has 2 routes, show the truth with no preview banner.
  ajsCockpit.sections.email_drafts = [
    {
      route_kind: "report",
      recipients: ["workorders@ajs.build"],
      cc: ["vanessa@ajs.build"],
      subject: "Make Safe Report & Invoice - AJBR-70271",
      body: "Report and invoice attached.",
      attachment_hashes: [REPORT_HASH, XERO_PDF_HASH],
      ready: true,
    },
    {
      route_kind: "photo",
      recipients: ["workorders@ajs.build"],
      cc: [],
      subject: "Photos - AJBR-70271",
      body: "Photos follow-up.",
      attachment_hashes: [PHOTO_HASH_1],
      ready: true,
    },
  ];
  behaviour.fetch.query_ses_review_cockpit = ajsCockpit;
  await mod.showMsReportingDetail(AJS_JOB);
  const ajsTruthHtml = elements["msReportingDetailPanel"]._html || "";
  check(
    "AJS two-route backend shows the truth (no preview banner)",
    !ajsTruthHtml.includes("Preview of the intended AJS shape") &&
      ajsTruthHtml.includes("what SEND IT releases") &&
      ajsTruthHtml.includes("Report email") &&
      ajsTruthHtml.includes("Photo email") &&
      /all two emails at once/i.test(ajsTruthHtml),
  );
}

// ── 18. No retired action was ever dispatched at runtime ────────────────────
check(
  "no retired action was ever called at runtime",
  !actionLog.some((a) =>
    [
      "makesafe_send_pack",
      "makesafe_send_photo_followup",
      "makesafe_resume_close",
      "makesafe_reset_failed_pack",
    ].includes(a)
  ),
);

console.log("");
if (failures) {
  console.log("SMOKE FAILED: " + failures + " check(s) failed.");
  process.exit(1);
} else {
  console.log("SMOKE PASSED: all checks ok.");
  process.exit(0);
}
