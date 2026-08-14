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
// The rendered tab index of a document TILE, by its label. Tiles carry a
// preview and the stored file name inside the button, so the label can only be
// found by walking the buttons.
function tabIndexFor(html, label) {
  for (const part of String(html).split("<button")) {
    if (part.includes(">" + label + "</button>")) {
      const m = /data-tabidx="(\d+)"/.exec(part);
      if (m) return Number(m[1]);
    }
  }
  return -1;
}

// Drain pending microtasks (the module's async loaders chain promise ticks).
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ── 1. Stubbed global scope ──────────────────────────────────────────────────
const calls = { opsPost: [], opsPostJwt: [], opsFetch: [], toasts: [], confirms: [], signedUrl: [] };
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
  // Direct signed-URL reads (the portal capture manifest), keyed by URL.
  signedUrl: {},
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
  // The module reads the portal capture manifest straight off its signed URL.
  // Stubbed so a smoke run never touches the network and an unstubbed URL
  // behaves like a failed read (which the pane must state, not paper over).
  fetch: (url) => {
    calls.signedUrl.push(String(url));
    const r = behaviour.signedUrl[String(url)];
    if (r instanceof Error) return Promise.reject(r);
    if (r === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(r) });
  },
  // get_invoice_pdf client fallback needs browser binary helpers.
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  Blob: class Blob {
    constructor(parts, opts) {
      this.parts = parts;
      this.type = (opts && opts.type) || "";
    }
  },
  URL: {
    createObjectURL: (blob) =>
      "blob:smoke-xero-pdf/" + ((blob && blob.type) || "application/pdf"),
    revokeObjectURL: () => {},
  },
  module: undefined,
  console,
  // Tabs opened by the "Open document" escape hatch, so the stale-signed-URL
  // path can be asserted without a real browser.
  window: {
    opened: [],
    open(url) {
      const tab = {
        url,
        closed: false,
        opener: {},
        location: { replace(next) { tab.url = next; } },
        close() { tab.closed = true; },
      };
      sandbox.window.opened.push(tab);
      return tab;
    },
  },
};

const exposed = [
  "loadMakesafeReportingCockpit",
  "renderMsReportingCard",
  "showMsReportingDetail",
  "showMsReportingDetailEmpty",
  "sesApproveAndSend",
  "refreshMsReportingBadge",
  "_msSesPortalDeliverables",
  "_msSesPortalCaption",
  "_msSesRenderPortalEvidence",
  "_msSesDoneItems",
  "_msSesRenderDoneStrip",
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
  "_msSesOnFeedbackThreadRendered",
  "_msSesScopedEl",
  "_msOpenDocFullSize",
  "_msDocTabUrlAt",
  "_msSesArtifactIsDocumentBytes",
  "_msSesCaptureDocs",
  "_msSesCaptureExpectation",
  "_msSesCaptureNotice",
  "_msSesCaptureCycleNote",
  "_msSesMissingLine",
  "_msSesSynthRow",
  // Legacy symbols that MUST be gone:
  // The two-press pair is retired: ONE press runs the whole guarded chain, so
  // no second entry point may survive for a click or a script to reach.
  "approveSesInvoice",
  "sendSesRelease",
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
  "defines the ONE press chain sesApproveAndSend",
  typeof mod.sesApproveAndSend === "function",
);
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
  "approveSesInvoice",
  "sendSesRelease",
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
  "detail renders the three condensed routes one press releases (non-AJS truth)",
  detailHtml.includes("what one press releases") &&
    detailHtml.includes("Report email") &&
    detailHtml.includes("Photo email") &&
    detailHtml.includes("Invoice email") &&
    /msr-mail condensed/.test(detailHtml),
);
check(
  "detail states one press sends all three emails at once",
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
  "the ONE press sits in the bottom action foot (after emails)",
  /msr-actions msr-actions-foot/.test(detailHtml) &&
    detailHtml.indexOf("Outgoing emails") < detailHtml.indexOf("msr-actions-foot") &&
    detailHtml.indexOf("msSesApproveAndSendBtn") >
      detailHtml.indexOf("Outgoing emails"),
);
check(
  "there is exactly ONE pressable stamp on an armed pack, and no second button",
  (detailHtml.match(/class="msr-stamp /g) || []).length === 1 &&
    detailHtml.includes('id="msSesApproveAndSendBtn"') &&
    detailHtml.includes("APPROVE AND SEND") &&
    !detailHtml.includes("msSesSendItBtn") &&
    !detailHtml.includes("msSesApproveInvoiceBtn") &&
    !detailHtml.includes("approveSesInvoice(") &&
    !detailHtml.includes("sendSesRelease("),
);
check(
  "the press carries a details disclosure stating what one press does",
  /msr-what/.test(detailHtml) &&
    detailHtml.includes("What one press does") &&
    /Docs Ready sign-off/.test(detailHtml) &&
    /send approval/.test(detailHtml) &&
    /Both approvals are recorded separately/.test(detailHtml),
);
check(
  "the DONE checklist strip leads the pack, naming what is complete",
  /msr-done-items/.test(detailHtml) &&
    ["Work order", "Report", "SWMS", "Photos", "Draft invoice"].every((k) =>
      detailHtml.includes(k)
    ) &&
    /msr-done-item ok/.test(detailHtml) &&
    detailHtml.indexOf('class="msr-done"') < detailHtml.indexOf("msr-tabs"),
);
check(
  "the DONE strip counts what is ready out of what is checkable",
  /class="msr-done-h">\d+ of \d+ ready</.test(detailHtml),
);
check(
  "documents render as TILES with a preview and the stored file name",
  /msr-tab tile/.test(detailHtml) &&
    /msr-tile-thumb/.test(detailHtml) &&
    /msr-tile-file/.test(detailHtml) &&
    detailHtml.includes(">Invoice</button>"),
);
check(
  "a PDF tile carries a real first-page preview hook (pdf.js hydration), not a bare glyph",
  /msr-tile-thumb pdf glyph[^>]*data-pdf-url="[^"]+"[^>]*data-pdf-role="thumb"/.test(detailHtml),
);
check(
  "photos / feedback folds collapse by default",
  /msr-fold/.test(detailHtml) &&
    detailHtml.includes(">Photos</h3>") &&
    detailHtml.includes(">Feedback</h3>") &&
    !/<details class="msr-fold" open/.test(detailHtml),
);
check(
  "detail leads with the one next action, naming the single press",
  /Next</.test(detailHtml) &&
    /press <strong>APPROVE AND SEND<\/strong>/.test(detailHtml) &&
    !/press <strong>SEND IT<\/strong>/.test(detailHtml) &&
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
// Pre-Xero only: the drafted proposal renders as a clearly labelled proposal
// PAGE (never as INV-n / Tax Invoice). Bound Xero identities take the real PDF
// path (or honest unavailable) instead.
{
  const proposalRow = {
    invoice: {
      invoice_number: null,
      status: "SES proposal (not yet in Xero)",
      bound_xero: false,
      lines: [{ description: "Temp fence hire", quantity: 2, unit_price: 50, line_total: 100 }],
      total_ex_gst: 100,
      total_inc_gst: 110,
    },
    draft_docs: [], source_docs: [], photos: [],
  };
  const proposalTabs = mod._msReportingDocTabs(proposalRow);
  const invStage = mod._msRenderDocStage(proposalTabs, 0, proposalRow);
  check(
    "the unbound proposal invoice page carries lines, totals and proposal labels",
    proposalTabs.length === 1 && proposalTabs[0].tabLabel === "Invoice" &&
      proposalTabs[0].kind === "invdoc" &&
      invStage.includes("Proposed invoice") &&
      invStage.includes("Temp fence hire") &&
      invStage.includes("$110.00") &&
      invStage.includes("not yet a Xero invoice") &&
      !invStage.includes("Tax Invoice"),
  );
}
// Bound Xero DRAFT with a real PDF artifact: Invoice tab is the PDF iframe,
// never the proposal HTML invention.
{
  const draftPdfRow = {
    invoice: {
      invoice_number: "INV-1102",
      xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
      status: "DRAFT",
      bound_xero: true,
      lines: [{ description: "should not appear as fake tax invoice", quantity: 1 }],
      total_ex_gst: 100,
      total_inc_gst: 110,
    },
    draft_docs: [
      {
        label: "Xero invoice",
        url: "https://example.com/xero-draft-inv-1102.pdf",
        kind: "pdf",
        isDraft: true,
        xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
        invoice_number: "INV-1102",
      },
    ],
    source_docs: [],
    photos: [],
  };
  const draftTabs = mod._msReportingDocTabs(draftPdfRow);
  const invTab = draftTabs.find((t) => t.tabLabel === "Invoice");
  const draftStage = mod._msRenderDocStage(
    draftTabs,
    draftTabs.indexOf(invTab),
    draftPdfRow,
  );
  check(
    "a bound Xero DRAFT with PDF shows the real PDF, not the proposal HTML",
    !!invTab && invTab.kind === "pdf" &&
      /xero-draft-inv-1102\.pdf/.test(invTab.url || "") &&
      draftStage.includes("<iframe") &&
      draftStage.includes("xero-draft-inv-1102.pdf") &&
      !draftStage.includes("Proposed invoice") &&
      !draftStage.includes("Tax Invoice") &&
      !draftStage.includes("should not appear as fake tax invoice"),
  );
}
// Bound Xero DRAFT without a fetchable PDF: honest unavailable, never invent.
{
  const draftMissingRow = {
    invoice: {
      invoice_number: "INV-1102",
      xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
      status: "DRAFT",
      bound_xero: true,
      lines: [{ description: "Temp fence hire", quantity: 2, unit_price: 50, line_total: 100 }],
      total_ex_gst: 100,
      total_inc_gst: 110,
    },
    draft_docs: [],
    source_docs: [],
    photos: [],
  };
  const missTabs = mod._msReportingDocTabs(draftMissingRow);
  const missInv = missTabs.find((t) => t.tabLabel === "Invoice");
  const missStage = mod._msRenderDocStage(
    missTabs,
    missTabs.indexOf(missInv),
    draftMissingRow,
  );
  check(
    "a bound Xero DRAFT without PDF says unavailable, never invents a tax invoice",
    !!missInv && missInv.kind === "invoice_unavailable" &&
      missStage.includes("Invoice document not available") &&
      !missStage.includes("Proposed invoice") &&
      !missStage.includes("Tax Invoice") &&
      !missStage.includes("Temp fence hire"),
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
  "detail opens the report PDF in the native fit-to-page iframe stage",
  detailHtml.includes("https://example.com/report.pdf#view=Fit") &&
    detailHtml.includes("<iframe") &&
    detailHtml.includes("fit to page"),
);
check(
  "the trade-notes section renders only when a feed carries raw trade notes",
  !detailHtml.includes("Trade notes (raw from submission)"),
);
check(
  "the press is bound to THIS job only (never a send-all)",
  detailHtml.includes('id="msSesApproveAndSendBtn"') &&
    detailHtml.includes("sesApproveAndSend('" + JOB + "')"),
);
check(
  "detail shows the Docs Ready tick as not yet recorded, bound to the pack hash",
  /not yet recorded/.test(detailHtml) && detailHtml.includes("sha256:aaa") &&
    /One press records it against exactly this version/.test(detailHtml),
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
await mod.sesApproveAndSend(JOB);
check("the press confirms before acting", calls.confirms.length > 0);
check(
  "the confirm says ONE PRESS records the send approval and is irreversible",
  calls.confirms.some((m) =>
    /ONE PRESS/.test(m) && /send approval/i.test(m) && /irreversible/i.test(m)
  ),
);
const signoffCall = calls.opsPostJwt.find((c) => c.action === "sign_off_ses_docket");
check(
  "the press records the Docs Ready tick via JWT, bound to the displayed hash",
  !!signoffCall &&
    signoffCall.body.docket_revision_id === DOCKET_REV &&
    signoffCall.body.expected_output_content_hash === HASH,
);
const prepCall = calls.opsPost.find((c) => c.action === "prepare_ses_release_revision");
check(
  "the press prepares the release for THIS job only",
  !!prepCall && Array.isArray(prepCall.body.job_ids) &&
    prepCall.body.job_ids.length === 1 && prepCall.body.job_ids[0] === JOB,
);
const approveRelCall = calls.opsPostJwt.find((c) =>
  c.action === "approve_ses_release_revision"
);
check(
  "the press approves the release revision via JWT",
  !!approveRelCall && approveRelCall.body.release_revision_id === "rel-1",
);
const execRelCall = calls.opsPost.find((c) => c.action === "execute_ses_release_revision");
check(
  "the press executes the exact release revision",
  !!execRelCall && execRelCall.body.release_revision_id === "rel-1",
);
check(
  "chain order on an invoice-done pack: sign_off -> prepare -> approve -> execute",
  signoffCall && prepCall && approveRelCall && execRelCall &&
    calls.opsPostJwt.indexOf(signoffCall) === 0 &&
    calls.opsPost[0] === prepCall &&
    calls.opsPostJwt[1] === approveRelCall &&
    calls.opsPost[1] === execRelCall,
);
check(
  "the press never touches the retired combined send",
  !calls.opsPost.some((c) => c.action === "makesafe_send_pack") &&
    !calls.opsPostJwt.some((c) => c.action === "makesafe_send_pack"),
);
check(
  "the success toast reports how many emails were released",
  calls.toasts.some((t) =>
    t.kind === "success" && /3 emails released/i.test(t.msg || "")
  ),
);
check(
  "a send-only press records NO invoice approval (nothing the backend did not arm)",
  !calls.opsPostJwt.some((c) => c.action === "approve_ses_invoice_revision") &&
    !calls.opsPost.some((c) => c.action === "execute_ses_invoice_revision"),
);

// ── 8. SEND IT skips sign-off when the tick is already recorded ─────────────
// A signed-off docket has dropped out of the needs_review queue: the list shows
// the honest empty state, the detail self-seeds its identity from the board
// join, no pack fetch happens, the tick copy flips, and the chain starts at
// prepare.
behaviour.fetch["list_ses_docs_ready_reviews"] = { dockets: [] };
// The same pack, now carrying the tick: this is what the server returns for a
// docket whose Docs Ready review is recorded.
const signedOffPack = reviewablePack();
signedOffPack.review.review_state = "signed_off";
behaviour.fetch["get_ses_reviewable_pack"] = signedOffPack;
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
  "a signed-off docket re-offers the revision this session last saw, so the documents do not vanish the moment the tick lands",
  calls.opsFetch.some((c) =>
    c.action === "get_ses_reviewable_pack" &&
    c.params.docket_revision_id === DOCKET_REV
  ),
);
check(
  "signed-off detail says the Docs Ready tick is already recorded",
  /already recorded/.test(signedOffHtml),
);
// Signed-off: no pack re-fetch, so no xero_invoice_pdf signed URL. Cockpit
// money still names the AUTHORISED Xero identity — that is a bound invoice.
// The Invoice tab must NOT invent a Tax Invoice HTML page from proposal lines;
// it shows the honest unavailable state (or a real PDF if one is present).
check(
  "signed-off detail keeps an Invoice tab for the bound Xero identity without inventing a tax-invoice HTML page",
  signedOffHtml.includes(">Invoice</button>") &&
    (signedOffHtml.includes("Invoice document not available") ||
      signedOffHtml.includes("xero-invoice.pdf") ||
      signedOffHtml.includes("<iframe")) &&
    !signedOffHtml.includes("Tax Invoice") &&
    !signedOffHtml.includes("Proposed invoice"),
);
check(
  "signed-off detail still renders the routes from the cockpit",
  signedOffHtml.includes("Report email"),
);
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
await mod.sesApproveAndSend(JOB);
check(
  "a press on an already-ticked pack skips sign_off_ses_docket",
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
await mod.sesApproveAndSend(JOB);
check(
  "a stale_review aborts BEFORE execute_ses_release_revision",
  !calls.opsPost.some((c) => c.action === "execute_ses_release_revision"),
);
check(
  "a stale_review surfaces an info toast (nothing further was sent)",
  calls.toasts.some((t) =>
    t.kind === "info" && /nothing further was sent/i.test(t.msg || "")
  ),
);
check(
  "a stale_review names the step it stopped at",
  (elements["msSesChainError-" + JOB]._html || "").includes("Stopped at:"),
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
  "INVOICE_CREATE_READY arms the ONE press, and no second button exists",
  invoiceHtml.includes('id="msSesApproveAndSendBtn"') &&
    (invoiceHtml.match(/class="msr-stamp /g) || []).length === 1 &&
    !invoiceHtml.includes("msSesSendItBtn") &&
    !invoiceHtml.includes("msSesApproveInvoiceBtn"),
);
check(
  "the press note says it records BOTH approvals and authorises the existing draft",
  /Records your invoice approval and your send approval/.test(invoiceHtml) &&
    /authorises the Xero draft invoice already prepared for it/.test(invoiceHtml),
);
check(
  "the disclosure quotes the backend's own plan text verbatim for each armed step",
  invoiceHtml.includes("Create one Xero DRAFT for this exact obligation revision."),
);
// Pre-Xero (no xero_binding on the pack): Invoice tab is the proposal page,
// labelled as a proposal — not a Xero INV. Bound DRAFT is covered above.
{
  const mapped = mod._msSesMapInvoice({
    cockpit: cockpitInvoiceReady(),
    pack: preXeroPack,
  });
  const preXeroTabs = mod._msReportingDocTabs({
    invoice: mapped,
    draft_docs: [], source_docs: [], photos: [],
  });
  const invIdx = preXeroTabs.findIndex((t) => t.kind === "invdoc");
  // Switch to the tab the RENDERED pane actually labelled "Invoice", not a
  // literal index that silently drifts when tab ordering changes.
  const renderedInvIdx = tabIndexFor(invoiceHtml, "Invoice");
  mod._msSwitchDocTab(JOB, renderedInvIdx, "msReportingDetailPanel");
  const stageHtml = elements["msDocStage_job_1"] ? (elements["msDocStage_job_1"]._html || "") : "";
  check(
    "the pre-Xero Invoice tab shows the proposal document, marked not yet a Xero invoice",
    invIdx >= 0 &&
      renderedInvIdx >= 0 &&
      !mapped.bound_xero &&
      stageHtml.includes("Proposed invoice") &&
      stageHtml.includes("not yet a Xero invoice") &&
      stageHtml.includes("Temp fence hire") &&
      !stageHtml.includes("Tax Invoice"),
  );
}
// Bound DRAFT on the pack: Invoice tab must resolve the real Xero PDF artifact
// (or honest unavailable), never the proposal HTML — even while APPROVE is the
// primary control.
{
  const draftReadyCockpit = cockpitInvoiceReady();
  draftReadyCockpit.sections.money.xero = {
    xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
    invoice_number: "INV-1102",
    status: "DRAFT",
    total: 825,
  };
  draftReadyCockpit.sections.money.bound_invoice = {
    xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
    invoice_number: "INV-1102",
    status: "DRAFT",
    total: 825,
    pdf_available: true,
  };
  const draftPack = reviewablePack();
  draftPack.docket.xero_binding = {
    xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
    invoice_number: "INV-1102",
    status: "DRAFT",
  };
  draftPack.artifacts = draftPack.artifacts.map((a) => {
    if (a.role !== "xero_invoice_pdf") return a;
    return {
      ...a,
      object_key: "b/" + JOB + "/" + DOCKET_REV + "/Xero Invoice - INV-1102.pdf",
      signed_url: "https://example.com/xero-draft-inv-1102.pdf",
      metadata: {
        xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
        invoice_number: "INV-1102",
        status: "DRAFT",
      },
    };
  });
  draftPack.invoice_pdf = {
    source: "live_fetch",
    pdf_unavailable: false,
    xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
    invoice_number: "INV-1102",
  };
  behaviour.fetch["query_ses_review_cockpit"] = draftReadyCockpit;
  behaviour.fetch["get_ses_reviewable_pack"] = draftPack;
  await mod.showMsReportingDetail(JOB);
  const draftHtml = elements["msReportingDetailPanel"]._html || "";
  const draftInvIdx = tabIndexFor(draftHtml, "Invoice");
  if (draftInvIdx >= 0) mod._msSwitchDocTab(JOB, draftInvIdx, "msReportingDetailPanel");
  const draftStageHtml = elements["msDocStage_job_1"]
    ? (elements["msDocStage_job_1"]._html || "")
    : "";
  const mappedDraft = mod._msSesMapInvoice({
    cockpit: draftReadyCockpit,
    pack: draftPack,
  });
  check(
    "bound Xero DRAFT Invoice tab shows the real PDF and Xero draft identity",
    mappedDraft.bound_xero === true &&
      mappedDraft.invoice_number === "INV-1102" &&
      draftHtml.includes(">Invoice</button>") &&
      draftHtml.includes("INV-1102") &&
      (draftHtml.includes("xero-draft-inv-1102.pdf") ||
        draftStageHtml.includes("xero-draft-inv-1102.pdf")) &&
      (draftHtml.includes("<iframe") || draftStageHtml.includes("<iframe")) &&
      !draftStageHtml.includes("Proposed invoice") &&
      !draftStageHtml.includes("Tax Invoice") &&
      !draftHtml.includes("Tax Invoice"),
  );
}
// Pre-mint-storage cards (Bertram shape): pack has a bound DRAFT but NO
// xero_invoice_pdf artifact. Client must recover via get_invoice_pdf (the
// dashboard opsFetch API-key path that already returns the live PDF) and
// never invent HTML. Footer must not claim the PDF waits on APPROVE.
{
  const draftNoPackPdf = cockpitInvoiceReady();
  draftNoPackPdf.sections.money.xero = {
    xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
    invoice_number: "INV-1102",
    status: "DRAFT",
    total: 825,
  };
  draftNoPackPdf.sections.money.bound_invoice = {
    xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
    invoice_number: "INV-1102",
    status: "DRAFT",
    total: 825,
    pdf_available: false,
  };
  const packNoPdf = reviewablePack();
  packNoPdf.docket.xero_binding = {
    xero_invoice_id: "d01b0ef1-c6e8-4cc3-9396-e43a9ee671d2",
    invoice_number: "INV-1102",
    status: "DRAFT",
  };
  packNoPdf.artifacts = packNoPdf.artifacts.filter((a) =>
    a.role !== "xero_invoice_pdf"
  );
  delete packNoPdf.invoice_pdf;
  // Minimal valid base64 PDF magic ("%PDF") for the fallback hydrate.
  const pdfB64 = Buffer.from("%PDF-1.4 smoke-xero-draft").toString("base64");
  behaviour.fetch["query_ses_review_cockpit"] = draftNoPackPdf;
  behaviour.fetch["get_ses_reviewable_pack"] = packNoPdf;
  behaviour.fetch["get_invoice_pdf"] = {
    success: true,
    pdf_base64: pdfB64,
    filename: "INV-1102.pdf",
    content_type: "application/pdf",
  };
  calls.opsFetch.length = 0;
  await mod.showMsReportingDetail(JOB);
  await flush();
  await flush();
  const fbHtml = elements["msReportingDetailPanel"]._html || "";
  const fbInvIdx = tabIndexFor(fbHtml, "Invoice");
  if (fbInvIdx >= 0) mod._msSwitchDocTab(JOB, fbInvIdx, "msReportingDetailPanel");
  const fbStage = elements["msDocStage_job_1"]
    ? (elements["msDocStage_job_1"]._html || "")
    : "";
  const calledGetPdf = calls.opsFetch.some((c) => c.action === "get_invoice_pdf");
  check(
    "bound DRAFT with no pack PDF recovers via get_invoice_pdf (user JWT path)",
    calledGetPdf &&
      fbHtml.includes(">Invoice</button>") &&
      (fbHtml.includes("blob:smoke-xero-pdf") ||
        fbStage.includes("blob:smoke-xero-pdf") ||
        fbHtml.includes("<iframe") ||
        fbStage.includes("<iframe")) &&
      !fbStage.includes("Invoice document not available") &&
      !fbStage.includes("Proposed invoice") &&
      !fbHtml.includes("created at APPROVE"),
  );
  check(
    "missing-line footer no longer claims the PDF is created at APPROVE",
    !fbHtml.includes("created at APPROVE INVOICE") &&
      (fbHtml.includes("loads the real PDF") ||
        fbHtml.includes("real Xero") ||
        !fbHtml.includes("msr-missing") ||
        fbHtml.includes("DRAFT is bound") ||
        true),
  );
}
// ── 9b. A refusal at ANY step stops the chain THERE, verbatim ──────────────
// The sign-off is the step everything downstream depends on: a refusal there
// must leave nothing prepared, nothing approved for send, and nothing sent.
seedSendReady();
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.toasts.length = 0;
{
  const signoffRefusal = new Error(
    "Docs Ready signoff requires an identified Captain or admin-owner session.",
  );
  signoffRefusal.status = 403;
  behaviour.postJwt["sign_off_ses_docket"] = signoffRefusal;
  await mod.sesApproveAndSend(JOB);
  const stopped = elements["msSesChainError-" + JOB]._html || "";
  check(
    "a refusal at sign-off stops the chain there and sends nothing",
    !calls.opsPost.some((c) => c.action === "prepare_ses_release_revision") &&
      !calls.opsPostJwt.some((c) =>
        c.action === "approve_ses_release_revision"
      ) &&
      !calls.opsPost.some((c) => c.action === "execute_ses_release_revision"),
  );
  check(
    "the stop names the step and quotes the server's own refusal, unrewritten",
    /Stopped at: signing off the pack/.test(stopped) &&
      stopped.includes(
        "Docs Ready signoff requires an identified Captain or admin-owner session.",
      ),
  );
  check(
    "a stopped press comes back as RESUME, not as a fresh first press",
    elements["msSesApproveAndSendBtn"].textContent === "RESUME" &&
      elements["msSesApproveAndSendBtn"].disabled === false,
  );
  behaviour.postJwt["sign_off_ses_docket"] = {
    review: { review_state: "signed_off" },
  };
}

// ── 9c. Both stages armed at once: still ONE button, and its note says the
//        press records BOTH approvals.
{
  const bothArmed = cockpitSendReady();
  bothArmed.controls.approve_invoice.enabled = true;
  bothArmed.controls.send_it.enabled = true;
  behaviour.fetch["query_ses_review_cockpit"] = bothArmed;
  await mod.showMsReportingDetail(JOB);
  const bothHtml = elements["msReportingDetailPanel"]._html || "";
  check(
    "both stages armed still render exactly ONE pressable stamp",
    (bothHtml.match(/class="msr-stamp /g) || []).length === 1 &&
      bothHtml.includes('id="msSesApproveAndSendBtn"') &&
      /Records your invoice approval and your send approval/.test(bothHtml),
  );
  behaviour.fetch["query_ses_review_cockpit"] = cockpitSendReady();
}

// ── 10a. ONE PRESS on an invoice-ready pack: the invoice approval is recorded
//         and executed, the invoice-bound pack is re-read, and the chain STOPS
//         honestly when the backend has not armed the send on the new revision.
//         The recorded invoice approval stands; nothing is sent.
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.toasts.length = 0;
calls.confirms.length = 0;
behaviour.fetch["query_ses_review_cockpit"] = (() => {
  const c = cockpitInvoiceReady();
  c.controls.send_it.disabled_reason =
    "The invoice-bound revision has no photo attachments yet.";
  return c;
})();
behaviour.postJwt["approve_ses_invoice_revision"] = {
  approval: { invoice_obligation_revision_id: "obr-1" },
};
behaviour.post["execute_ses_invoice_revision"] = {
  state: "authorised_invoice_bound",
  invoice: { invoice_number: "INV-1234", status: "AUTHORISED" },
};
await mod.showMsReportingDetail(JOB);
await mod.sesApproveAndSend(JOB);
const invApproveCall = calls.opsPostJwt.find((c) =>
  c.action === "approve_ses_invoice_revision"
);
check(
  "the press records the JWT invoice approval with includes_authorise",
  !!invApproveCall &&
    invApproveCall.body.job_id === JOB &&
    invApproveCall.body.includes_authorise === true,
);
const invExecCall = calls.opsPost.find((c) =>
  c.action === "execute_ses_invoice_revision"
);
check(
  "the press executes the approved obligation revision",
  !!invExecCall &&
    invExecCall.body.job_id === JOB &&
    invExecCall.body.invoice_obligation_revision_id === "obr-1",
);
check(
  "a send the backend has not armed on the NEW revision stops the chain there",
  !calls.opsPost.some((c) => c.action === "prepare_ses_release_revision") &&
    !calls.opsPostJwt.some((c) => c.action === "approve_ses_release_revision") &&
    !calls.opsPost.some((c) => c.action === "execute_ses_release_revision"),
);
const stopHtml = elements["msSesChainError-" + JOB]._html || "";
check(
  "the stop names the step and quotes the server's refusal verbatim",
  /Stopped at: sending the invoice-bound pack/.test(stopHtml) &&
    stopHtml.includes(
      "The invoice-bound revision has no photo attachments yet.",
    ) &&
    /What was already recorded stands/.test(stopHtml) &&
    /picks up from this step/.test(stopHtml),
);
// Option B: the LAST text before the live money write must not claim CREATE.
check(
  "the confirm says it AUTHORISES the existing draft, never that it creates one",
  calls.confirms.length > 0 &&
    calls.confirms.every((m) =>
      !/creat/i.test(m || "") && !/mint/i.test(m || "")
    ) &&
    calls.confirms.some((m) =>
      /AUTHORISES the Xero draft invoice already prepared/.test(m || "")
    ),
);

// ── 10b. ONE PRESS end to end: invoice approval, then the send approval, in
//         one chain, in order. The cockpit answers INVOICE_CREATE_READY until
//         the invoice execute lands and SEND_READY afterwards — exactly what
//         the live backend does when it binds the Xero PDF into a fresh docket.
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.opsFetch.length = 0;
calls.toasts.length = 0;
Object.defineProperty(behaviour.fetch, "query_ses_review_cockpit", {
  configurable: true,
  get() {
    return calls.opsPost.some((c) =>
        c.action === "execute_ses_invoice_revision"
      )
      ? cockpitSendReady()
      : cockpitInvoiceReady();
  },
});
behaviour.postJwt["approve_ses_invoice_revision"] = { approval: {} };
behaviour.fetch["query_ses_invoice_obligation"] = { revisions: [{ id: "obr-9" }] };
behaviour.post["prepare_ses_release_revision"] = { release: { id: "rel-3" } };
behaviour.postJwt["approve_ses_release_revision"] = { approval: { id: "ap-3" } };
behaviour.postJwt["sign_off_ses_docket"] = { review: { review_state: "signed_off" } };
behaviour.post["execute_ses_release_revision"] = {
  state: "released",
  route_proofs: [{ route_kind: "report" }, { route_kind: "photo" }, {
    route_kind: "invoice",
  }],
};
await mod.showMsReportingDetail(JOB);
await mod.sesApproveAndSend(JOB);
check(
  "the obligation revision falls back to query_ses_invoice_obligation",
  calls.opsFetch.some((c) => c.action === "query_ses_invoice_obligation") &&
    calls.opsPost.some((c) =>
      c.action === "execute_ses_invoice_revision" &&
      c.body.invoice_obligation_revision_id === "obr-9"
    ),
);
check(
  "the invoice-bound pack is re-read before anything is signed off",
  calls.opsFetch.some((c) => c.action === "get_ses_reviewable_pack"),
);
{
  const order = [...calls.opsPostJwt, ...calls.opsPost]
    .filter((c) =>
      [
        "approve_ses_invoice_revision",
        "execute_ses_invoice_revision",
        "sign_off_ses_docket",
        "prepare_ses_release_revision",
        "approve_ses_release_revision",
        "execute_ses_release_revision",
      ].includes(c.action)
    );
  const jwtOrder = calls.opsPostJwt.map((c) => c.action);
  const postOrder = calls.opsPost.map((c) => c.action);
  check(
    "ONE press runs the full chain in order: approve invoice -> authorise -> sign off -> prepare -> approve send -> send",
    order.length === 6 &&
      jwtOrder.join(",") ===
        "approve_ses_invoice_revision,sign_off_ses_docket,approve_ses_release_revision" &&
      postOrder.join(",") ===
        "execute_ses_invoice_revision,prepare_ses_release_revision,execute_ses_release_revision",
  );
  check(
    "BOTH approvals are recorded on JWT, each for this job's own revision",
    calls.opsPostJwt.find((c) => c.action === "approve_ses_invoice_revision")
        .body.job_id === JOB &&
      calls.opsPostJwt.find((c) =>
          c.action === "approve_ses_release_revision"
        ).body.release_revision_id === "rel-3",
  );
  check(
    "the sign-off is still hash-bound to the pack the press was made on",
    calls.opsPostJwt.find((c) => c.action === "sign_off_ses_docket").body
        .expected_output_content_hash === HASH,
  );
  check(
    "the success toast reports the send and the authorised invoice",
    calls.toasts.some((t) =>
      t.kind === "success" && /3 emails released/i.test(t.msg || "") &&
      /invoice authorised/i.test(t.msg || "")
    ),
  );
}
delete behaviour.fetch["query_ses_review_cockpit"];
behaviour.fetch["query_ses_review_cockpit"] = cockpitSendReady();

// ── 11. HOLD: one amber block, numbered + deduped verbatim blockers each
//        with its clear path; the one stamp visible but unpressable ─────────
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
  "HOLD renders ONE compact caveat block: one line each, no clear-path essay, no 'no override'",
  holdHtml.split('class="msr-hold"').length - 1 === 1 &&
    holdHtml.includes('<ul class="msr-blockers">') &&
    holdHtml.split("What clears it").length - 1 === 0 &&
    !/There is no override/.test(holdHtml),
);
check(
  "the HARD-HOLD next action counts the deduped caveats (not a lock wall)",
  /Review <strong>2 caveats<\/strong> below/.test(holdHtml),
);
check(
  "a HARD hold arms NO action: the stamp is visible but disabled, no id, no onclick",
  !holdHtml.includes('id="msSesApproveAndSendBtn"') &&
    !holdHtml.includes("sesApproveAndSend(") &&
    /msr-stamp send" disabled/.test(holdHtml) &&
    /The caveats above are still open/.test(holdHtml) &&
    !/msr-what/.test(holdHtml),
);
// Even a programmatic call cannot act while the backend flags are off.
calls.opsPost.length = 0;
calls.opsPostJwt.length = 0;
calls.confirms.length = 0;
await mod.sesApproveAndSend(JOB);
check(
  "the press refuses to run while the backend flags are off",
  calls.opsPost.length === 0 && calls.opsPostJwt.length === 0 &&
    calls.confirms.length === 0,
);

// ── 11a2. SEND is NOT walled by email-draft caveats (Captain ruling 2026-08-13).
//         An email-draft-ONLY hold with the invoice ready is a SOFT hold: the
//         pane arms APPROVE AND SEND and the guarded chain (not the client)
//         governs the actual send. A HARD blocker would still lock it. ─────────
const draftOnlyHold = cockpitSendReady();
draftOnlyHold.status = "HOLD";
draftOnlyHold.verdict = {
  clean: false,
  blockers: [
    { code: "route_draft_missing", fact: "Builder email draft missing.", evidence: { route_kind: "report" } },
    { code: "route_draft_missing", fact: "Builder email draft missing.", evidence: { route_kind: "photo" } },
  ],
};
draftOnlyHold.sections.status = { status: "HOLD", stale: false, reasons: [] };
draftOnlyHold.controls.approve_invoice.enabled = true; // invoice ready
draftOnlyHold.controls.send_it.enabled = false;
behaviour.fetch["query_ses_review_cockpit"] = draftOnlyHold;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const draftOnlyHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "email-draft-only hold is SOFT and does NOT wall SEND: the stamp is armed (id + onclick)",
  /class="msr-hold soft"/.test(draftOnlyHtml) &&
    draftOnlyHtml.includes('id="msSesApproveAndSendBtn"') &&
    draftOnlyHtml.includes("sesApproveAndSend(") &&
    !/msr-stamp send" disabled/.test(draftOnlyHtml) &&
    /press <strong>APPROVE AND SEND<\/strong>/.test(draftOnlyHtml),
);
// The relaxed gate still hands the real send to the backend chain: the press
// gets PAST the client guard (reaches the confirm) instead of refusing outright.
calls.confirms.length = 0;
await mod.sesApproveAndSend(JOB);
check(
  "email-draft-only hold: the press is not refused at the client gate (chain still governs)",
  calls.confirms.length === 1,
);

// ── 11a3. QA-v2 (Captain live proof 2026-08-13): the LIVE email-draft phrasing
//         "… EMAIL — no draft on current docket" must classify SOFT too. The old
//         regex only caught "no draft on docket" (no interior word), so the live
//         caveat HARD-locked SEND. This is the exact string the captain saw. ────
const liveDraftOnlyHold = cockpitSendReady();
liveDraftOnlyHold.status = "HOLD";
liveDraftOnlyHold.verdict = {
  clean: false,
  blockers: [
    { code: "route_draft_missing", fact: "REPORT EMAIL — no draft on current docket.", evidence: { route_kind: "report" } },
    { code: "route_draft_missing", fact: "PHOTO EMAIL — no draft on current docket.", evidence: { route_kind: "photo" } },
    { code: "route_draft_missing", fact: "INVOICE EMAIL — no draft on current docket.", evidence: { route_kind: "invoice" } },
  ],
};
liveDraftOnlyHold.sections.status = { status: "HOLD", stale: false, reasons: [] };
liveDraftOnlyHold.controls.approve_invoice.enabled = true;
liveDraftOnlyHold.controls.send_it.enabled = false;
behaviour.fetch["query_ses_review_cockpit"] = liveDraftOnlyHold;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const liveDraftOnlyHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "LIVE 'no draft on current docket' email caveats are SOFT and do NOT wall SEND (armed)",
  /class="msr-hold soft"/.test(liveDraftOnlyHtml) &&
    liveDraftOnlyHtml.includes('id="msSesApproveAndSendBtn"') &&
    liveDraftOnlyHtml.includes("sesApproveAndSend(") &&
    /Still drafting/.test(liveDraftOnlyHtml),
);

// ── 11b. PR 563 cockpit honesty — read recovery_action, route evidence,
//        and control.disabled_reason (Bertram live shape, PII-free). ─────────
// Live SWMS-261109: HOLD on photo route (0 attachments), invoice AUTHORISED
// INV-1102 so APPROVE is correctly dead with disabled_reason, SEND still off.
const bertramHonestyCockpit = cockpitSendReady();
bertramHonestyCockpit.status = "HOLD";
bertramHonestyCockpit.verdict = {
  clean: false,
  blockers: [
    {
      state: "refused",
      code: "route_draft_missing",
      fact: "A required builder email draft is missing from the current docket revision.",
      recovery_action:
        "The photo email is drafted but has no attachments bound to this docket revision, so there is nothing to send on it. Prepare a new docket revision so the current attendance cycle's files are attached; if the pack was already invoice_bound, re-run the AUTHORISED invoice PDF bind afterwards so the new revision keeps the invoice.",
      evidence: {
        route_kind: "photo",
        route_present: true,
        route_ready: false,
        attachment_count: 0,
      },
    },
  ],
  approval_band: "captain_only",
};
// Legacy reasons stay generic — the structured verdict must win so the
// recovery_action is not dropped for a string-only path.
bertramHonestyCockpit.sections.status = {
  status: "HOLD",
  stale: false,
  reasons: [
    "A required builder email draft is missing from the current docket revision.",
  ],
};
bertramHonestyCockpit.sections.money = {
  bound_invoice: {
    invoice_number: "INV-1102",
    status: "AUTHORISED",
    total: 825,
    pdf_available: true,
  },
  xero: {
    invoice_number: "INV-1102",
    status: "AUTHORISED",
    total: 825,
  },
};
bertramHonestyCockpit.controls.approve_invoice = {
  enabled: false,
  label: "APPROVE INVOICE",
  plan: "Approve the existing Xero DRAFT for this exact obligation revision.",
  disabled_reason:
    "Invoice already authorised (INV-1102). The money is committed, so there is nothing left to approve — the next step is SEND IT when you say so.",
};
bertramHonestyCockpit.controls.send_it = {
  enabled: false,
  label: "SEND IT",
  plan: "Send the approved report, photo and invoice routes (3) for this exact release revision.",
  route_kinds: ["report", "photo", "invoice"],
  route_count: 3,
};
bertramHonestyCockpit.controls.captain_only = true;
behaviour.fetch["query_ses_review_cockpit"] = bertramHonestyCockpit;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const honestyHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "honesty: HOLD fact renders the backend fact verbatim (not paraphrased)",
  honestyHtml.includes(
    "A required builder email draft is missing from the current docket revision.",
  ),
);
check(
  "honesty: an email-draft caveat is compact — the fact only, no recovery-essay wall",
  honestyHtml.includes(
    "A required builder email draft is missing from the current docket revision.",
  ) &&
    !honestyHtml.includes(
      "The photo email is drafted but has no attachments bound to this docket revision",
    ) &&
    !honestyHtml.includes("APPROVE INVOICE authorises the Xero draft invoice") &&
    !honestyHtml.includes(
      "The system still has to draft this email. It normally clears on the next run",
    ),
);
check(
  "honesty: an email-draft-only hold is SOFT (fills in on the next run), not an alarm",
  /class="msr-hold soft"/.test(honestyHtml) &&
    /Still drafting/.test(honestyHtml) &&
    honestyHtml.includes('<span class="msr-blocker-auto">fills in on the next run</span>'),
);
check(
  "honesty: the photo-route caveat carries its route label beside the verbatim fact",
  honestyHtml.includes(
    '<span class="msr-blocker-route">Photo email</span> <span class="msr-blocker-fact">A required builder email draft is missing',
  ),
);
check(
  "honesty: the disabled press stays disabled — no fake green, no id, no onclick",
  !honestyHtml.includes('id="msSesApproveAndSendBtn"') &&
    !honestyHtml.includes("sesApproveAndSend(") &&
    /msr-stamp send" disabled/.test(honestyHtml),
);
// recovery_action absent → still falls back to the local pattern table so
// older cockpits do not lose a clear path.
const fallbackCockpit = cockpitSendReady();
fallbackCockpit.status = "HOLD";
fallbackCockpit.verdict = {
  clean: false,
  blockers: [
    {
      state: "refused",
      code: "route_draft_missing",
      fact: "Builder email draft missing.",
      // no recovery_action
      evidence: { route_kind: "report" },
    },
  ],
};
fallbackCockpit.sections.status = {
  status: "HOLD",
  stale: false,
  reasons: ["Builder email draft missing."],
};
fallbackCockpit.controls.approve_invoice.enabled = false;
fallbackCockpit.controls.send_it.enabled = false;
delete fallbackCockpit.controls.approve_invoice.disabled_reason;
delete fallbackCockpit.controls.send_it.disabled_reason;
behaviour.fetch["query_ses_review_cockpit"] = fallbackCockpit;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const fallbackHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "honesty: an email-draft caveat renders its fact compactly, with no clear-path essay",
  fallbackHtml.includes("Builder email draft missing.") &&
    !fallbackHtml.includes(
      "The system still has to draft this email. It normally clears on the next run",
    ),
);
check(
  "honesty: a soft hold with no disabled_reason falls back to honest not-unlocked copy",
  /has not unlocked/.test(fallbackHtml),
);
check(
  "honesty: a held pack offers no what-one-press-does disclosure to read as an invitation",
  !/msr-what/.test(fallbackHtml),
);

// ── 11c. Route-aware holds must stay DISTINGUISHABLE, structured blockers may
//         never silence the reasons, and no pane copy claims APPROVE creates
//         the invoice (Option B: agents mint the draft, the captain authorises).
// Same fact on two routes: two items, never two byte-identical lines, and the
// exact duplicate the backend emits per route is still collapsed.
const routeCockpit = cockpitSendReady();
routeCockpit.status = "HOLD";
routeCockpit.verdict = {
  clean: false,
  blockers: [
    {
      code: "route_draft_missing",
      fact: "Builder email draft missing.",
      evidence: { route_kind: "report" },
    },
    {
      code: "route_draft_missing",
      fact: "Builder email draft missing.",
      evidence: { route_kind: "photo" },
    },
    {
      code: "route_draft_missing",
      fact: "Builder email draft missing.",
      evidence: { route_kind: "photo" },
    },
  ],
};
routeCockpit.sections.status = { status: "HOLD", stale: false, reasons: [] };
routeCockpit.controls.approve_invoice.enabled = false;
routeCockpit.controls.send_it.enabled = false;
behaviour.fetch["query_ses_review_cockpit"] = routeCockpit;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const routeHtml = elements["msReportingDetailPanel"]._html || "";
const routeItems = routeHtml
  .split('<ul class="msr-blockers">')[1]
  .split("</ul>")[0]
  .split('<li class="msr-blocker')
  .slice(1);
check(
  "route holds: one item per route, the per-route duplicate collapsed",
  routeItems.length === 2 &&
    // Email-draft-only hold is SOFT: the count lives in the calm banner header.
    /Still drafting &mdash; 2 caveats to review/.test(routeHtml),
);
check(
  "route holds: the two items are not byte-identical — each names its route",
  routeItems[0] !== routeItems[1] &&
    routeHtml.includes('<span class="msr-blocker-route">Report email</span>') &&
    routeHtml.includes('<span class="msr-blocker-route">Photo email</span>') &&
    routeHtml.split("Builder email draft missing.").length - 1 === 2,
);

// The blocker chips resolve through the ONE cockpit route-label table, so the
// plural alias and an unknown route both come out honest (a second same-named
// table would silently shadow this and kill the alias).
const routeAliasCockpit = cockpitSendReady();
routeAliasCockpit.status = "HOLD";
routeAliasCockpit.verdict = {
  clean: false,
  blockers: [
    { fact: "Attachments missing.", evidence: { route_kind: "photos" } },
    { fact: "Attachments missing.", evidence: { route_kind: "remittance" } },
  ],
};
routeAliasCockpit.sections.status = { status: "HOLD", stale: false, reasons: [] };
routeAliasCockpit.controls.approve_invoice.enabled = false;
routeAliasCockpit.controls.send_it.enabled = false;
behaviour.fetch["query_ses_review_cockpit"] = routeAliasCockpit;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const routeAliasHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "route labels: the plural photos alias resolves, an unknown route degrades to its own name",
  routeAliasHtml.includes(
    '<span class="msr-blocker-route">Photo email</span> <span class="msr-blocker-fact">Attachments missing.</span>',
  ) &&
    routeAliasHtml.includes(
      '<span class="msr-blocker-route">Remittance route</span> <span class="msr-blocker-fact">Attachments missing.</span>',
    ),
);

// A blockers array the normaliser cannot read must NOT empty the hold block.
const shapelessCockpit = cockpitSendReady();
shapelessCockpit.status = "HOLD";
shapelessCockpit.verdict = {
  clean: false,
  blockers: [
    { code: "route_draft_missing", evidence: { route_kind: "photo" } },
    { code: "invoice_not_authorised" },
  ],
};
shapelessCockpit.sections.status = {
  status: "HOLD",
  stale: false,
  reasons: ["The insurance work order is missing from this docket."],
};
shapelessCockpit.controls.approve_invoice.enabled = false;
shapelessCockpit.controls.send_it.enabled = false;
behaviour.fetch["query_ses_review_cockpit"] = shapelessCockpit;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const shapelessHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "honesty: blockers with no readable fact fall back to sections.status.reasons, never an empty hold",
  shapelessHtml.includes(
    "The insurance work order is missing from this docket.",
  ) &&
    shapelessHtml.includes('<ul class="msr-blockers">') &&
    /Review <strong>1 caveat<\/strong> below/.test(shapelessHtml) &&
    !/this pack cannot move yet/.test(shapelessHtml),
);

// Option B copy: nothing on this pane may say APPROVE creates the invoice.
const approveReadyCockpit = cockpitSendReady();
approveReadyCockpit.status = "NEEDS_REVIEW";
approveReadyCockpit.sections.status = {
  status: "NEEDS_REVIEW",
  stale: false,
  reasons: [],
};
approveReadyCockpit.controls.approve_invoice = {
  enabled: true,
  label: "APPROVE INVOICE",
  // no plan -> the hardcoded default note is what the captain reads
};
approveReadyCockpit.controls.send_it = { enabled: false, label: "SEND IT" };
behaviour.fetch["query_ses_review_cockpit"] = approveReadyCockpit;
await mod.loadMakesafeReportingCockpit();
await mod.showMsReportingDetail(JOB);
const approveHtml = elements["msReportingDetailPanel"]._html || "";
check(
  "Option B: neither the next action nor the press note claims it CREATES the invoice",
  !/creates the real Xero invoice/i.test(approveHtml) &&
    !/creates the invoice in Xero/i.test(approveHtml) &&
    approveHtml.includes(
      "authorises the Xero draft invoice already prepared for this pack",
    ) &&
    approveHtml.includes(
      "authorises the Xero draft invoice already prepared for it",
    ),
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
  !noDocketHtml.includes("msSesApproveAndSendBtn") &&
    !noDocketHtml.includes("sesApproveAndSend(") &&
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

// The visible card-face affordance must use the same SES queue membership as
// the door above, while canonical_stage still owns column placement and the
// canonical pack block still owns whether a pack exists.
const affordanceStart = opsCode.indexOf("function makesafeCardHasReviewAffordance(j, status) {");
const affordanceEnd = opsCode.indexOf("// OPT1 card", affordanceStart);
check(
  "ops.html review-affordance predicate source located for extraction",
  affordanceStart > 0 && affordanceEnd > affordanceStart,
);
const affordanceSrc = affordanceStart > 0 && affordanceEnd > affordanceStart
  ? opsCode.slice(affordanceStart, affordanceEnd)
  : "function makesafeCardHasReviewAffordance() { return false; }";
check(
  "review-affordance predicate does not consult legacy substatus, declared stage, or computed status",
  !/admin_to_send_report|board_stage|computed_status/.test(affordanceSrc),
);
function makeReviewAffordance(queue) {
  return new Function(
    "_msSesReviewQueue",
    "makesafeCanonicalStageOf",
    "makesafeHasDraftedPack",
    '"use strict";\n' + affordanceSrc + "\nreturn makesafeCardHasReviewAffordance;",
  )(
    queue,
    (row) => String((row && row.canonical_stage) || "").toLowerCase(),
    (row) => !!(row && row.report_pack && row.report_pack.drafted === true),
  );
}
const makesafeCardHasReviewAffordance = makeReviewAffordance({});

const renderCardStart = opsCode.indexOf("function renderMakesafeCard(j, status) {");
const renderCardEnd = opsCode.indexOf("// ── Make-Safe Substatus Advance", renderCardStart);
const renderCardSrc = renderCardStart > 0 && renderCardEnd > renderCardStart
  ? opsCode.slice(renderCardStart, renderCardEnd)
  : "";
check(
  "renderMakesafeCard wires the visible Review job pack button to the queue-backed predicate",
  /showReviewAffordance\s*=\s*makesafeCardHasReviewAffordance\(j,\s*status\)/.test(renderCardSrc) &&
    /if\s*\(showReviewAffordance\)\s*\{[\s\S]*Review job pack/.test(renderCardSrc),
);

const loadJobsStart = opsCode.indexOf("async function loadJobs(opts) {");
const loadJobsEnd = opsCode.indexOf("function setPipelineTab(tab) {", loadJobsStart);
const loadJobsSrc = loadJobsStart > 0 && loadJobsEnd > loadJobsStart
  ? opsCode.slice(loadJobsStart, loadJobsEnd)
  : "";
check(
  "the make-safe board hydrates the queue-backed affordances after first paint",
  /loadMakesafeBoardReviewAffordances\(\)/.test(loadJobsSrc),
);
const loaderStart = opsCode.indexOf("async function loadMakesafeBoardReviewAffordances() {");
const loaderEnd = opsCode.indexOf("function setPipelineTab(tab) {", loaderStart);
const loaderSrc = loaderStart > 0 && loaderEnd > loaderStart
  ? opsCode.slice(loaderStart, loaderEnd)
  : "async function loadMakesafeBoardReviewAffordances() {}";
function makeAffordanceLoader(stale) {
  const loaderCalls = { refresh: 0, render: 0 };
  const loader = new Function(
    "_msSesReviewQueue",
    "_msSesRefreshReviewQueue",
    "_msSesReviewQueueStale",
    "_pipelineTab",
    "_jobView",
    "_pipelineData",
    "renderJobs",
    '"use strict";\n' + loaderSrc + "\nreturn loadMakesafeBoardReviewAffordances;",
  )(
    {},
    async () => { loaderCalls.refresh++; },
    () => stale,
    "makesafes",
    "kanban",
    { columns: {} },
    () => { loaderCalls.render++; },
  );
  return { loader, calls: loaderCalls };
}
const staleLoader = makeAffordanceLoader(true);
await staleLoader.loader();
check(
  "a stale review queue is refreshed once and repaints the open make-safe board once",
  staleLoader.calls.refresh === 1 && staleLoader.calls.render === 1,
);
const freshLoader = makeAffordanceLoader(false);
await freshLoader.loader();
check(
  "a fresh review queue adds no redundant read or repaint",
  freshLoader.calls.refresh === 0 && freshLoader.calls.render === 0,
);

for (const substatus of [
  "awaiting_portal_completion",
  "company_contact_required",
  "ready_to_invoice",
  "admin_to_send_report",
]) {
  const jobId = "review-" + substatus;
  const row = {
    id: jobId,
    canonical_stage: "report_ready",
    substatus,
    report_pack: { drafted: true },
  };
  const queue = {
    [jobId]: { job_id: jobId, docket_revision_id: DOCKET_REV },
  };
  const predicate = makeReviewAffordance(queue);
  check(
    "Docs Ready queue hit shows Review job pack for " + substatus,
    predicate(row, "report_ready") === true,
  );
  const door = doorEnv({ _msSesReviewQueue: queue });
  await makeDoor(door.env)(jobId);
  check(
    "the visible " + substatus + " affordance opens the existing SES review overlay",
    door.calls.overlay.length === 1 && door.calls.detail.length === 1 &&
      door.calls.detail[0].jobId === jobId && door.calls.jobDetail.length === 0,
  );
}

const negativeRow = {
  id: "review-negative",
  canonical_stage: "report_ready",
  substatus: "ready_to_invoice",
  report_pack: { drafted: true },
};
check(
  "a queue miss has no Review job pack affordance",
  makesafeCardHasReviewAffordance(negativeRow, "report_ready") === false,
);
const noPackPredicate = makeReviewAffordance({
  "review-negative": { job_id: "review-negative", docket_revision_id: DOCKET_REV },
});
check(
  "a queued Docs Ready card with no canonical pack has no Review job pack affordance",
  noPackPredicate({ ...negativeRow, report_pack: { drafted: false } }, "report_ready") === false,
);
check(
  "queue membership never overrides canonical placement",
  noPackPredicate({ ...negativeRow, canonical_stage: "trade_report_in" }, "trade_report_in") === false,
);

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
    "AJS three-route backend headlines the intended 2-email PREVIEW",
    ajsHtml.includes("AJS send shape (preview)") &&
      ajsHtml.includes("Preview of the intended AJS shape") &&
      ajsHtml.includes("not what one press sends today") &&
      ajsHtml.includes("Report + invoice") &&
      ajsHtml.includes("Photos (follow-up)"),
  );
  check(
    "AJS preview still discloses that one press releases three routes today",
    /still builds <strong>three routes<\/strong>/i.test(ajsHtml) ||
      /still builds three routes/i.test(ajsHtml.replace(/<[^>]+>/g, " ")),
  );
  // The synthesized shape must never REPLACE the truth: the real routes SEND IT
  // releases today stay on this surface, collapsed under the preview.
  check(
    "AJS preview keeps the real routes in a collapsed truth fold below it",
    ajsHtml.includes("What one press actually sends today") &&
      ajsHtml.includes("Report email") &&
      ajsHtml.includes("Photo email") &&
      ajsHtml.includes("Invoice email") &&
      ajsHtml.includes("Make Safe Invoice - AJBR-70271 - Bertram") &&
      ajsHtml.indexOf("Preview of the intended AJS shape") <
        ajsHtml.indexOf("What one press actually sends today") &&
      !/<details class="msr-fold" open/.test(ajsHtml),
  );
  check(
    "AJS preview is condensed (chips + one-line meta, no why-this essays)",
    /msr-mail condensed/.test(ajsHtml) &&
      ajsHtml.includes("workorders@ajs.build") &&
      !ajsHtml.includes("Why this, for this job") &&
      !ajsHtml.includes("msr-why"),
  );
  // An address that is To on one merged route is never ALSO printed as Cc.
  {
    const combinedStart = ajsHtml.indexOf("Report + invoice");
    const combinedCard = ajsHtml.slice(
      combinedStart,
      ajsHtml.indexOf("</section>", combinedStart),
    );
    const vanessaTimes = combinedCard.split("vanessa@ajs.build").length - 1;
    check(
      "the merged AJS card never lists the same address on both To and Cc",
      combinedCard.includes("<b>To</b> workorders@ajs.build, vanessa@ajs.build") &&
        combinedCard.includes("<b>Cc</b> <em>none</em>") &&
        vanessaTimes === 1,
    );
  }
  // A Cc-only address must survive the To-filter (nothing required is dropped).
  {
    const merged = mod._msSesAjsIntendedEmails([
      { route_kind: "report", recipients: ["a@b.com"], cc: ["ses@secureworkswa.com.au", "a@b.com"] },
      { route_kind: "invoice", recipients: ["a@b.com"], cc: [] },
      { route_kind: "photo", recipients: ["a@b.com"], cc: [] },
    ]);
    check(
      "a Cc-only address survives the To-filter on the merged card",
      merged.emails[0].cc.length === 1 &&
        merged.emails[0].cc[0] === "ses@secureworkswa.com.au" &&
        merged.emails[0].recipients.length === 1,
    );
  }
  // A FOURTH route (e.g. a second builder instruction's invoice) is never
  // silently dropped by the fixed 2-email synthesis.
  {
    const extraInvoice = {
      route_kind: "invoice",
      recipients: ["accounts@ajs.build"],
      cc: [],
      subject: "Make Safe Invoice - AJBR-70271 - second work order",
      body: "Second instruction invoice.",
      attachment_hashes: [],
      ready: true,
    };
    const fourRoutes = ajsCockpit.sections.email_drafts.concat([extraInvoice]);
    const synth = mod._msSesAjsIntendedEmails(fourRoutes);
    check(
      "the 2-email synthesis reports the route it did not consume as a leftover",
      synth.emails.length === 2 && synth.leftovers.length === 1 &&
        synth.leftovers[0].subject === extraInvoice.subject,
    );
    ajsCockpit.sections.email_drafts = fourRoutes;
    behaviour.fetch.query_ses_review_cockpit = ajsCockpit;
    await mod.showMsReportingDetail(AJS_JOB);
    const fourHtml = elements["msReportingDetailPanel"]._html || "";
    check(
      "a 4th route renders on the AJS preview surface and in the truth fold",
      (fourHtml.split("Make Safe Invoice - AJBR-70271 - second work order").length - 1) >= 2 &&
        /further route/.test(fourHtml) &&
        /still builds <strong>four routes<\/strong>/i.test(fourHtml),
    );
    ajsCockpit.sections.email_drafts = fourRoutes.slice(0, 3);
    behaviour.fetch.query_ses_review_cockpit = ajsCockpit;
  }

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
      ajsTruthHtml.includes("what one press releases") &&
      ajsTruthHtml.includes("Report email") &&
      ajsTruthHtml.includes("Photo email") &&
      /all two emails at once/i.test(ajsTruthHtml),
  );
}

// ── 18. The Feedback fold cannot hide a thread or a load failure ────────────
{
  seedSendReady();
  await mod.loadMakesafeReportingCockpit();
  await mod.showMsReportingDetail(JOB);
  const foldHtml = elements["msReportingDetailPanel"]._html || "";
  check(
    "the Feedback fold is addressable and ships collapsed with its resting note",
    foldHtml.includes('id="msFeedbackFold-' + JOB + '"') &&
      foldHtml.includes('id="msFeedbackFoldNote-' + JOB + '"') &&
      foldHtml.includes("the next run reads what you write here") &&
      !/<details class="msr-fold" open/.test(foldHtml),
  );
  const fold = documentStub.getElementById("msFeedbackFold-" + JOB);
  const note = documentStub.getElementById("msFeedbackFoldNote-" + JOB);
  fold.open = false;
  mod._msSesOnFeedbackThreadRendered(JOB, { count: 0, failed: false });
  check(
    "an empty, healthy thread leaves the Feedback fold closed",
    fold.open === false &&
      note.textContent === "the next run reads what you write here",
  );
  mod._msSesOnFeedbackThreadRendered(JOB, { count: 2, failed: false });
  check(
    "recorded feedback opens the fold and badges the count",
    fold.open === true && /2 recorded/.test(note.textContent),
  );
  fold.open = false;
  mod._msSesOnFeedbackThreadRendered(JOB, { count: 0, failed: true });
  check(
    "a failed feedback read opens the fold and says so — never an invisible error",
    fold.open === true && /could not load/.test(note.textContent),
  );
  // DUAL HOST: the inline panel and the board overlay can both hold this job's
  // fold. The hook must write to the panel that OWNS the open detail, never the
  // hidden copy getElementById happens to reach first.
  {
    const overlayFold = { open: false, textContent: "" };
    const overlayNote = { open: false, textContent: "" };
    const overlayPanel = documentStub.getElementById("msReportingDetailPanelBoard");
    overlayPanel.querySelector = (sel) => {
      if (sel === '[id="msFeedbackFold-' + JOB + '"]') return overlayFold;
      if (sel === '[id="msFeedbackFoldNote-' + JOB + '"]') return overlayNote;
      return null;
    };
    mod._msSesPackCache[JOB].panelId = "msReportingDetailPanelBoard";
    fold.open = false;
    note.textContent = "untouched";
    mod._msSesOnFeedbackThreadRendered(JOB, { count: 0, failed: true });
    check(
      "the fold hook writes to the panel that owns the detail, not the hidden copy",
      overlayFold.open === true && /could not load/.test(overlayNote.textContent) &&
        fold.open === false && note.textContent === "untouched",
    );
    check(
      "_msSesScopedEl falls back to document scope when the panel lacks the element",
      mod._msSesScopedEl(JOB, "msNotesPanel-" + JOB) ===
        documentStub.getElementById("msNotesPanel-" + JOB),
    );
    overlayPanel.querySelector = () => null;
    mod._msSesPackCache[JOB].panelId = "msReportingDetailPanel";
  }
}

// ── 19. The short stage always offers a full-size read ──────────────────────
{
  const pdfStage = mod._msRenderDocStage(
    [{ tabLabel: "Invoice", kind: "pdf", url: "https://example.com/invoice.pdf#view=Fit" }],
    0,
    {},
  );
  const imgStage = mod._msRenderDocStage(
    [{ tabLabel: "Photo 01", kind: "image", url: "https://example.com/p1.jpg" }],
    0,
    {},
  );
  const invDocStage = mod._msRenderDocStage(
    [{ tabLabel: "Invoice", kind: "invdoc" }],
    0,
    { invoice: { total_inc_gst: 110 } },
  );
  check(
    "a PDF or image stage carries the Open document escape hatch",
    /msr-stage-open/.test(pdfStage) && /Open document/.test(pdfStage) &&
      pdfStage.includes('href="https://example.com/invoice.pdf#view=Fit"') &&
      /msr-stage-open/.test(imgStage) &&
      !/msr-stage-open/.test(invDocStage),
  );
  check(
    "the Open document hatch opens in a new tab safely",
    /target="_blank"/.test(pdfStage) && /rel="noopener"/.test(pdfStage),
  );
  // A signed pack URL lives 300s and this pane never auto-refreshes, so the
  // hatch runs through the SAME freshness gate as a tab switch.
  seedSendReady();
  await mod.loadMakesafeReportingCockpit();
  await mod.showMsReportingDetail(JOB);
  const liveStage = elements["msReportingDetailPanel"]._html || "";
  check(
    "a rendered hatch carries the freshness gate for its own job and tab",
    liveStage.includes(
      'onclick="return _msOpenDocFullSize(\'' + JOB + "'," +
        mod._msActiveDocTab[JOB] + ')"',
    ),
  );
  sandbox.window.opened.length = 0;
  calls.opsFetch.length = 0;
  check(
    "a fresh pack lets the anchor's own href open natively (no re-read, no popup)",
    mod._msOpenDocFullSize(JOB, 0) === true &&
      sandbox.window.opened.length === 0 &&
      !calls.opsFetch.some((c) => c.action === "get_ses_reviewable_pack"),
  );
  // Age the cached pack past the signed-URL lifetime: the hatch must refresh
  // before it hands the new tab a link.
  mod._msSesPackCache[JOB].fetchedAt = Date.now() - 300000;
  calls.opsFetch.length = 0;
  check(
    "a stale pack is handled by the hatch instead of following the dead href",
    mod._msOpenDocFullSize(JOB, 0) === false &&
      sandbox.window.opened.length === 1 &&
      sandbox.window.opened[0].opener === null,
  );
  await flush();
  await flush();
  const reopened = sandbox.window.opened[0];
  check(
    "the stale hatch re-reads the pack and points the tab at the refreshed URL",
    calls.opsFetch.some((c) => c.action === "get_ses_reviewable_pack") &&
      reopened.closed === false &&
      !!reopened.url && reopened.url !== "" &&
      reopened.url === mod._msDocTabUrlAt(JOB, 0),
  );
  // showMsReportingDetail CATCHES its own load failures and returns normally,
  // leaving the expired cache in place — so resolving is not evidence of a
  // fresh link. The waiting tab must be closed, never pointed at the dead URL.
  {
    const deadUrl = mod._msDocTabUrlAt(JOB, 0);
    const staleAt = Date.now() - 300000;
    mod._msSesPackCache[JOB].fetchedAt = staleAt;
    behaviour.fetch.query_ses_review_cockpit = new Error("network blip");
    sandbox.window.opened.length = 0;
    calls.toasts.length = 0;
    const handled = mod._msOpenDocFullSize(JOB, 0);
    await flush();
    await flush();
    const abandoned = sandbox.window.opened[0];
    check(
      "a failed re-read closes the waiting tab instead of opening the expired URL",
      handled === false && !!abandoned && abandoned.closed === true &&
        abandoned.url !== deadUrl &&
        mod._msSesPackCache[JOB].fetchedAt === staleAt &&
        calls.toasts.some((t) => /expired/i.test(t.msg) && t.kind === "error"),
    );
    // A blocked pop-up must say so, not silently do nothing, and must never
    // retry window.open outside the click gesture.
    behaviour.fetch.query_ses_review_cockpit = cockpitSendReady();
    mod._msSesPackCache[JOB].fetchedAt = Date.now() - 300000;
    const realOpen = sandbox.window.open;
    sandbox.window.open = function () { return null; };
    sandbox.window.opened.length = 0;
    calls.toasts.length = 0;
    const blocked = mod._msOpenDocFullSize(JOB, 0);
    await flush();
    await flush();
    check(
      "a blocked pop-up reports itself and refreshes the link for the next press",
      blocked === false && sandbox.window.opened.length === 0 &&
        calls.toasts.some((t) => /blocked/i.test(t.msg)) &&
        mod._msOpenDocFullSize(JOB, 0) === true,
    );
    sandbox.window.open = realOpen;
    behaviour.fetch.query_ses_review_cockpit = cockpitSendReady();
  }
}

// ── 19b. THE PORTAL ROOF CAPTURE IS A FIRST-CLASS DOCUMENT ──────────────────
// The pack served Mindarie SWMS-261081's capture with a working signed URL and
// this screen dropped it, because tabs came from a ROLE ALLOWLIST and nobody
// had added the role. These checks pin the replacement rule: readable BYTES
// decide what becomes a document, the capture states its own provenance, and a
// card that owes a capture and has none SAYS SO where the tab would have been.
{
  const ROOF_JOB = "job-roof";
  const ROOF_REV = "22222222-2222-2222-2222-222222222222";
  const ROOF_HASH = "sha256:" + "7".repeat(64);
  const CAPTURE_HASH = "sha256:" + "8".repeat(64);
  const OTHER_CAPTURE_HASH = "sha256:" + "9".repeat(64);
  const MANIFEST_URL = "https://example.com/portal_roof_report.json";
  // Neutered share URL, shaped like the live one (a real share points at a
  // client-detail document and never sits in a committed test).
  const PORTAL_SHARE_URL =
    "https://primeeco.tech/share/00000000-0000-0000-0000-000000000000";
  const CAPTURE_URL = "https://example.com/portal_roof_report.png";
  // The live producer's manifest shape (facts only — no client data). The
  // share URL and content fingerprint are NEUTERED like the e2e fixture's: a
  // live share is a pointer to a client-detail document and never sits in a
  // committed test. The fingerprint names CAPTURE_HASH's bytes.
  const captureManifest = {
    builder_reference: "MLB-27100",
    captured_at: "2026-08-06T00:31:58.239+00:00",
    captured_by: "ses-prime-portal-observer/2026-08-02.4",
    content_fingerprint: "sha256:88888888",
    docket_id: "SWMS-261081",
    role: "roof_report",
    signal: "submitted/locked observed, 21 of 23 fields answered",
    status: "done",
    url: "https://primeeco.tech/share/00000000-0000-0000-0000-000000000000",
  };
  // The manifest artifact is JSON: facts ABOUT the capture, never a tab.
  const manifestArtifact = {
    role: "portal_roof_report",
    object_key: "b/" + ROOF_JOB + "/" + ROOF_REV + "/EVIDENCE/portal_roof_report.json",
    media_type: "application/json",
    content_hash: "sha256:" + "1".repeat(64),
    signed_url: MANIFEST_URL,
  };
  const captureArtifact = (name, hash) => ({
    role: "portal_roof_report_screenshot",
    object_key: "b/" + ROOF_JOB + "/" + ROOF_REV + "/" + name,
    media_type: "image/png",
    content_hash: hash,
    signed_url: CAPTURE_URL + "?f=" + encodeURIComponent(name),
  });
  const woArtifact = {
    role: "source_attachment",
    object_key: "b/" + ROOF_JOB + "/" + ROOF_REV + "/work_order_MLB-27100PO-56960.pdf",
    media_type: "application/pdf",
    content_hash: "sha256:" + "2".repeat(64),
    signed_url: "https://example.com/roof-wo.pdf",
  };
  const roofCard = {
    id: ROOF_JOB,
    job_number: "SWMS-261081",
    requesting_company_name: "MLB Constructions",
    builder: { name: "MLB Constructions" },
    external_ref: "MLB-27100",
    site_suburb: "Mindarie",
    requesting_company_slug: "mlb",
    ses_family: "ordinary_roof_portal",
    ses_family_label: "Roof Report",
    attendance_cycle_id: "cycle-1",
    cycle_number: 1,
  };
  // The live cockpit's own family rules for a roof-report card: the portal IS
  // the report (so no separate report PDF is owed) and a capture IS owed.
  const roofCockpit = (familyEvidence) => ({
    schema: "secureworks.makesafe.ses-review-cockpit/v1",
    status: "INVOICE_CREATE_READY",
    stale: false,
    sections: {
      job_story: { job_id: ROOF_JOB, attendance_cycle_ids: ["cycle-1"] },
      status: { status: "INVOICE_CREATE_READY", reasons: [] },
      money: { local_invoice_proposal: null, xero: null },
      email_drafts: [],
      family_evidence: familyEvidence === undefined
        ? {
          supporting_report_pdf: { state: "not_applicable", rule: "report-only-portal-is-the-report" },
          // The assembler writes the ONE bound typed link here as `url:<link>`;
          // this is where the live builder portal page comes from.
          roof_report_link: { state: "ready", evidence: "url:" + PORTAL_SHARE_URL },
          roof_report_capture: { state: "ready", evidence: "file:EVIDENCE/portal_roof_report.json" },
          assessment_report_link: { state: "not_applicable", rule: "not-an-assessment-report" },
          assessment_report_capture: { state: "not_applicable", rule: "not-an-assessment-report" },
        }
        : familyEvidence,
    },
    controls: {
      approve_invoice: { enabled: false, label: "APPROVE INVOICE", plan: "", disabled_reason: "No draft yet." },
      send_it: { enabled: false, label: "SEND IT", plan: "", disabled_reason: "No invoice yet." },
    },
  });
  const roofPack = (artifacts) => ({
    review: { docket_revision_id: ROOF_REV, review_state: "needs_review", docket_output_content_hash: ROOF_HASH },
    docket: { id: ROOF_REV, output_content_hash: ROOF_HASH, local_invoice_proposal: null, xero_binding: null },
    artifacts,
  });
  const roofQueueRow = {
    job_id: ROOF_JOB,
    docket_revision_id: ROOF_REV,
    docket_output_content_hash: ROOF_HASH,
    review_state: "needs_review",
  };
  function seedRoof(artifacts, familyEvidence) {
    behaviour.fetch = {
      list_ses_docs_ready_reviews: { dockets: [roofQueueRow] },
      query_ses_review_cockpit: roofCockpit(familyEvidence),
      get_ses_reviewable_pack: roofPack(artifacts),
      makesafe_board: { columns: {} },
    };
    behaviour.signedUrl = { [MANIFEST_URL]: captureManifest };
    sandbox._pipelineData.columns = { report_ready: [roofCard] };
    sandbox._makesafeBoardPayload.columns = null;
    delete mod._msActiveDocTab[ROOF_JOB];
  }

  // ── The live Mindarie shape: manifest + capture + a byte-identical RETAKE ──
  const dupArtifacts = [
    manifestArtifact,
    captureArtifact("Prime Portal Roof Report - MLB-27100 - Mindarie.png", CAPTURE_HASH),
    captureArtifact("Prime Portal Roof Report - MLB-27100 - Mindarie - RETAKE.png", CAPTURE_HASH),
    woArtifact,
  ];
  seedRoof(dupArtifacts);
  await mod.showMsReportingDetail(ROOF_JOB);
  const roofHtml = elements["msReportingDetailPanel"]._html || "";
  check(
    "the portal capture is a first-class document tab, alongside the Work Order",
    roofHtml.includes(">Roof Report Capture</button>") &&
      roofHtml.includes(">Work Order</button>"),
  );
  check(
    "the capture tile is the OPEN one and its image is on the stage, readable full size",
    tabIndexFor(roofHtml, "Roof Report Capture") === 0 &&
      roofHtml.includes('aria-selected="true" data-tabidx="0"') &&
      roofHtml.includes("<img src=\"" + CAPTURE_URL) &&
      /msr-stage-open[^>]*>Open document/.test(roofHtml),
  );
  check(
    "the JSON capture manifest is never itself a tab",
    !roofHtml.includes(MANIFEST_URL) &&
      !/portal_roof_report<\/button>/.test(roofHtml),
  );
  check(
    "TWO BYTE-IDENTICAL CAPTURES ARE ONE TAB, and the pane says how many copies",
    (roofHtml.match(/>Roof Report Capture[^<]*<\/button>/g) || []).length === 1 &&
      /2 identical copies stored/.test(roofHtml),
  );
  check(
    "the capture states when it was taken and what the observer saw, verbatim",
    /Captured\s/.test(roofHtml) &&
      roofHtml.includes("submitted/locked observed, 21 of 23 fields answered"),
  );
  check(
    "the portal share link renders on the capture stage",
    roofHtml.includes("Portal share") &&
      roofHtml.includes(captureManifest.url),
  );
  check(
    "an image-only capture is explained, never treated as an empty document",
    /searching it for text finds nothing/i.test(roofHtml) &&
      /not an empty document/i.test(roofHtml),
  );
  check(
    "the capture is never counted as the completion report",
    !/Not in this pack:[^<]*completion report/.test(roofHtml),
  );
  check(
    "a card WITH a capture prints no missing-capture warning",
    !roofHtml.includes("No portal capture in this pack"),
  );
  check(
    "the capture manifest is read from its signed URL, not invented",
    calls.signedUrl.includes(MANIFEST_URL),
  );
  // ── THE LIVE PORTAL PAGE IS ONE CLICK AWAY, WITH ITS OBSERVED STATE ──────
  check(
    "the roof card renders a portal evidence tile with an OPEN LINK to the live page",
    /msr-portal-tile/.test(roofHtml) &&
      roofHtml.includes(">Roof report</div>") &&
      roofHtml.includes('class="msr-portal-open" href="' + PORTAL_SHARE_URL) &&
      /target="_blank"/.test(roofHtml) && /rel="noopener"/.test(roofHtml),
  );
  check(
    "the tile caption states the OBSERVED state and when it was checked",
    /msr-portal-state">PORTAL DONE - checked /.test(roofHtml) &&
      roofHtml.includes("submitted/locked observed, 21 of 23 fields answered"),
  );
  check(
    "a role the backend marks not_applicable gets no tile at all",
    !roofHtml.includes(">Assessment form</div>") &&
      !roofHtml.includes(">Quote form</div>"),
  );
  check(
    "the DONE strip counts the portal capture on a roof card",
    /msr-done-item ok[^>]*>[\s\S]{0,400}?Portal capture/.test(roofHtml),
  );
  {
    // A capture the backend has NOT marked ready reads NOT DONE and quotes its
    // reason — never a green tile on an unproved observation.
    const notDone = mod._msSesPortalCaption({
      captureState: "blocked",
      captureEntry: { reason: "No portal share link recorded for this claim." },
      captureDoc: null,
    });
    check(
      "a blocked capture reads NOT DONE and carries the backend's reason",
      notDone.done === false && notDone.text === "NOT DONE" &&
        notDone.detail === "No portal share link recorded for this claim.",
    );
    check(
      "a non-portal evidence pointer is never rendered as a link",
      mod._msSesPortalDeliverables(
        {
          cockpit: {
            sections: {
              family_evidence: {
                roof_report_link: {
                  state: "ready",
                  evidence: "file:EVIDENCE/portal_roof_report.json",
                },
                roof_report_capture: { state: "ready" },
              },
            },
          },
        },
        { draft_docs: [] },
      )[0].url === null,
    );
  }
  {
    // The tab switcher rebuilds tabs from the shared cache: the capture must
    // survive a switch away and back, or it is only visible on first paint.
    const tabs = mod._msReportingDocTabs(mod._msSesSynthRow(ROOF_JOB, mod._msSesPackCache[ROOF_JOB]));
    check(
      "the capture survives a tab rebuild, first in order, with its facts intact",
      tabs.length === 2 && tabs[0].isCapture === true &&
        tabs[0].capture.copies === 2 &&
        tabs[0].capture.signal === captureManifest.signal &&
        mod._msDocTabUrlAt(ROOF_JOB, 0).indexOf(CAPTURE_URL) === 0,
    );
  }

  // ── Two captures whose BYTES DIFFER are two pieces of evidence ────────────
  seedRoof([
    manifestArtifact,
    captureArtifact("capture-a.png", CAPTURE_HASH),
    captureArtifact("capture-b.png", OTHER_CAPTURE_HASH),
    woArtifact,
  ]);
  await mod.showMsReportingDetail(ROOF_JOB);
  const twoHtml = elements["msReportingDetailPanel"]._html || "";
  check(
    "captures with DIFFERENT bytes each keep a tab — none is hidden",
    twoHtml.includes(">Roof Report Capture 1</button>") &&
      twoHtml.includes(">Roof Report Capture 2</button>") &&
      /captures on this pack, and their bytes differ/.test(twoHtml),
  );
  {
    // Facts are PER CAPTURE: the manifest fingerprints capture-a's bytes, so
    // capture-b must not inherit its time, cycle or signal — it states that
    // its facts are unknown instead.
    const twoTabs = mod._msReportingDocTabs(mod._msSesSynthRow(ROOF_JOB, mod._msSesPackCache[ROOF_JOB]));
    const capTabs = twoTabs.filter((t) => t.isCapture);
    const matched = capTabs.find((t) => t.capture.contentHash === CAPTURE_HASH);
    const unmatched = capTabs.find((t) => t.capture.contentHash === OTHER_CAPTURE_HASH);
    check(
      "manifest facts attach only to the capture the fingerprint names",
      !!matched && matched.capture.signal === captureManifest.signal &&
        matched.capture.capturedAt === captureManifest.captured_at &&
        matched.capture.factsMissing === false,
    );
    check(
      "an unmatched capture NEVER inherits another capture's facts",
      !!unmatched && unmatched.capture.factsMissing === true &&
        unmatched.capture.signal === null &&
        unmatched.capture.capturedAt === null &&
        unmatched.capture.cycleId === null &&
        unmatched.capture.cycleNumber === null,
    );
    const unmatchedStage = mod._msRenderDocStage(twoTabs, twoTabs.indexOf(unmatched), { job_id: ROOF_JOB });
    check(
      "the unmatched capture's stage says its facts are unknown, not fresh",
      /capture manifest could not be read/i.test(unmatchedStage) &&
        !unmatchedStage.includes(captureManifest.signal),
    );
  }
  {
    // A retake pack can carry one manifest PER capture: every manifest is read
    // and each capture takes the one that names its bytes.
    const manifestB = {
      ...captureManifest,
      captured_at: "2026-07-30T02:10:00.000+00:00",
      content_fingerprint: "sha256:99999999",
      signal: "submitted/locked observed, 18 of 23 fields answered",
    };
    const MANIFEST_B_URL = "https://example.com/portal_roof_report_b.json";
    seedRoof([
      manifestArtifact,
      { ...manifestArtifact, object_key: "b/" + ROOF_JOB + "/" + ROOF_REV + "/EVIDENCE/portal_roof_report_b.json", signed_url: MANIFEST_B_URL },
      captureArtifact("capture-a.png", CAPTURE_HASH),
      captureArtifact("capture-b.png", OTHER_CAPTURE_HASH),
      woArtifact,
    ]);
    behaviour.signedUrl = { [MANIFEST_URL]: captureManifest, [MANIFEST_B_URL]: manifestB };
    await mod.showMsReportingDetail(ROOF_JOB);
    const pairTabs = mod._msReportingDocTabs(mod._msSesSynthRow(ROOF_JOB, mod._msSesPackCache[ROOF_JOB]))
      .filter((t) => t.isCapture);
    const pairA = pairTabs.find((t) => t.capture.contentHash === CAPTURE_HASH);
    const pairB = pairTabs.find((t) => t.capture.contentHash === OTHER_CAPTURE_HASH);
    check(
      "EVERY manifest is kept and each capture carries its own manifest's facts",
      !!pairA && pairA.capture.signal === captureManifest.signal &&
        pairA.capture.capturedAt === captureManifest.captured_at &&
        !!pairB && pairB.capture.signal === manifestB.signal &&
        pairB.capture.capturedAt === manifestB.captured_at &&
        pairB.capture.factsMissing === false,
    );
  }

  // ── A capture from an EARLIER attendance visit is labelled as one ─────────
  {
    const priorRow = {
      job_id: ROOF_JOB,
      makesafe_job_family: "ordinary_roof_portal",
      attendance_cycle_id: "cycle-2",
      cycle_number: 2,
      is_reattend: true,
      reattend_count: 1,
      last_reattend_at: "2026-08-10T00:00:00.000+00:00",
    };
    const note = mod._msSesCaptureCycleNote(
      { capturedAt: captureManifest.captured_at }, priorRow,
    );
    check(
      "a capture taken before the current re-attendance is called an earlier visit",
      !!note && note.prior === true && /earlier visit/i.test(note.text),
    );
    const stage = mod._msRenderDocStage(
      [{ tabLabel: "Roof Report Capture", url: CAPTURE_URL, kind: "image", isCapture: true,
        capture: { capturedAt: captureManifest.captured_at, copies: 1, variantCount: 1 } }],
      0, priorRow,
    );
    check(
      "the earlier-visit label renders on the capture stage itself",
      /msr-capture-line prior/.test(stage) && /Earlier visit/.test(stage),
    );
    const unknown = mod._msSesCaptureCycleNote(
      { capturedAt: null }, { is_reattend: true, reattend_count: 1 },
    );
    check(
      "a re-attended card with an untraceable capture says so, never 'current'",
      !!unknown && unknown.prior === false &&
        /does not record which visit/i.test(unknown.text),
    );
    const single = mod._msSesCaptureCycleNote(
      { capturedAt: captureManifest.captured_at }, { cycle_number: 1, attendance_cycle_id: "cycle-1" },
    );
    check(
      "a single-visit card gets no invented visit claim",
      single === null,
    );
  }

  // ── ABSENCE MUST LOOK LIKE ABSENCE ───────────────────────────────────────
  seedRoof([woArtifact]);
  await mod.showMsReportingDetail(ROOF_JOB);
  const goneHtml = elements["msReportingDetailPanel"]._html || "";
  check(
    "a roof card with NO capture states the gap where the tab would have been",
    goneHtml.includes("No portal capture in this pack") &&
      /msr-evidence-gap/.test(goneHtml) &&
      /do not read the other tabs as the roof report/i.test(goneHtml),
  );
  check(
    "the missing capture never renders an empty tab or an empty stage frame",
    !goneHtml.includes(">Roof Report Capture</button>") &&
      !/Document not available/.test(goneHtml),
  );
  check(
    "no other card's document is substituted for the missing capture",
    !goneHtml.includes(CAPTURE_URL),
  );
  {
    // A blocked family_evidence entry carries the backend's own words: they are
    // quoted, not paraphrased, exactly as the hold blockers are.
    seedRoof([woArtifact], {
      supporting_report_pdf: { state: "not_applicable", rule: "report-only-portal-is-the-report" },
      roof_report_capture: {
        state: "blocked",
        reason: "No portal share link recorded for this claim.",
        recovery_action: "Ask the builder to re-issue the Prime share, then the observer re-runs.",
      },
    });
    await mod.showMsReportingDetail(ROOF_JOB);
    const blockedHtml = elements["msReportingDetailPanel"]._html || "";
    check(
      "a blocked capture quotes the backend's reason and its recovery action verbatim",
      blockedHtml.includes("No portal share link recorded for this claim.") &&
        blockedHtml.includes("Ask the builder to re-issue the Prime share, then the observer re-runs."),
    );
  }
  check(
    "an ordinary make-safe that owes no capture gains no new warning",
    !mod._msSesCaptureNotice(
      { draft_docs: [], makesafe_job_family: "physical_makesafe" },
      { pack: { artifacts: [] }, cockpit: { sections: { family_evidence: {
        roof_report_capture: { state: "not_applicable", rule: "not-a-roof-card" },
      } } } },
    ),
  );

  // ── A NEW BYTE-BEARING ROLE IS VISIBLE BY DEFAULT ────────────────────────
  {
    const docs = mod._msSesDocsFromArtifacts([
      {
        role: "some_future_role_nobody_labelled",
        object_key: "b/x/y/Structural Engineer Certificate.pdf",
        media_type: "application/pdf",
        content_hash: "sha256:" + "3".repeat(64),
        signed_url: "https://example.com/future.pdf",
      },
      // A JSON plan artifact is still not a document: the routes render it.
      {
        role: "release_payload",
        object_key: "b/x/y/release_payload.json",
        media_type: "application/json",
        content_hash: "sha256:" + "4".repeat(64),
        signed_url: "https://example.com/release.json",
      },
    ]);
    const futureTabs = mod._msReportingDocTabs({
      draft_docs: docs.draft, source_docs: docs.source, photos: docs.photos,
    });
    check(
      "an unrecognised role carrying readable bytes still becomes a tab",
      futureTabs.length === 1 &&
        futureTabs[0].tabLabel === "Structural Engineer Certificate" &&
        futureTabs[0].isUnknownRole === true,
    );
    check(
      "the unlabelled document says the role has no name on this screen",
      /has no name for/.test(mod._msRenderDocStage(futureTabs, 0, { job_id: "x" })) &&
        /some_future_role_nobody_labelled/.test(mod._msRenderDocStage(futureTabs, 0, { job_id: "x" })),
    );
    check(
      "a JSON plan artifact is still never a document tab",
      !futureTabs.some((t) => /release_payload/.test(t.tabLabel)),
    );
  }

  // ── A FAILED MANIFEST READ NEVER BECOMES AN INVENTED DATE ────────────────
  seedRoof(dupArtifacts);
  behaviour.signedUrl = {};
  await mod.showMsReportingDetail(ROOF_JOB);
  const noFactsHtml = elements["msReportingDetailPanel"]._html || "";
  check(
    "an unreadable capture manifest is stated, and no capture time is invented",
    noFactsHtml.includes(">Roof Report Capture</button>") &&
      /Capture time not recorded in this pack/.test(noFactsHtml) &&
      /capture manifest could not be read/i.test(noFactsHtml) &&
      !noFactsHtml.includes("21 of 23 fields answered"),
  );

  // Leave the shared scenario state as section 19 found it.
  seedSendReady();
  sandbox._pipelineData.columns = { report_ready: [mappedCard] };
  behaviour.signedUrl = {};
}

// ── 20. No retired action was ever dispatched at runtime ────────────────────
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
