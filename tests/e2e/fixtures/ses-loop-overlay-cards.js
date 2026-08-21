/**
 * Three live-shaped sample cards for the SES loop overlay ship.
 * Identity only: job numbers + suburb. No client name / street / phone.
 *
 *   SWMS-261237  Docs Ready, complete drafted pack, NOT in the SES queue
 *   SWMS-261241  Docs Ready, complete drafted pack with WO + report + SWMS + invoice
 *   SWMS-261243  assessment, no pack — do not invent one
 */

const JOB_237 = 'a1000000-0000-4000-8000-000000000237';
const JOB_241 = 'a1000000-0000-4000-8000-000000000241';
const JOB_243 = 'a1000000-0000-4000-8000-000000000243';
const DOCKET_237 = 'd1000000-0000-4000-8000-000000000237';
const DOCKET_241 = 'd1000000-0000-4000-8000-000000000241';

function baseRow(over) {
  return Object.assign({
    type: 'makesafe',
    canonical_stage: 'report_ready',
    board_stage: 'report_ready',
    substatus: 'admin_to_send_report',
    ses_family: 'physical_makesafe',
    ses_family_label: 'MakeSafe',
    requesting_company_slug: 'mlb',
    requesting_company_name: 'Major Loss Builders',
    site_suburb: 'Perth',
    has_wo: false,
    missing_docs: ['wo'],
    has_report_doc: false,
    report: { state: 'submitted', cycle_number: 1 },
    has_swms_doc: false,
    invoice_status: 'not_ready',
  }, over || {});
}

const pack237 = {
  drafted: true,
  state: 'drafted',
  sent: false,
  docket_revision_id: DOCKET_237,
  presentation_kind: 'ready',
  report_doc_id: 'report-doc-261237',
  required_documents: { report: true, invoice: true, swms: true },
  closeout_documents: { report: true, invoice: true, swms: true },
};

const pack241 = {
  drafted: true,
  state: 'drafted',
  sent: false,
  docket_revision_id: DOCKET_241,
  presentation_kind: 'ready',
  report_doc_id: 'report-doc-261241',
  required_documents: { report: true, invoice: true, swms: true },
  closeout_documents: { report: true, invoice: true, swms: true },
  artifacts: [
    { role: 'work_order', object_key: 'wo/work_order_MLB-26183.pdf', media_type: 'application/pdf' },
    { role: 'supporting_report_pdf', object_key: 'r/Make Safe Report.pdf', media_type: 'application/pdf' },
    { role: 'swms_artifact', object_key: 's/SWMS.pdf', media_type: 'application/pdf' },
    { role: 'xero_invoice_pdf', object_key: 'i/invoice.pdf', media_type: 'application/pdf', signed_url: 'about:blank#inv' },
    { role: 'site_photo', object_key: 'p/site.jpg', media_type: 'image/jpeg' },
  ],
};

const cards = [
  {
    id: JOB_237,
    job_number: 'SWMS-261237',
    pack: pack237,
    row: baseRow({
      id: JOB_237,
      job_number: 'SWMS-261237',
      external_ref: 'MLB-261237',
      report_pack: pack237,
    }),
  },
  {
    id: JOB_241,
    job_number: 'SWMS-261241',
    pack: pack241,
    packFacts: {
      wo: true, report: true, swms: true, invoice: true, photos: true, sent: false, fromPack: true,
    },
    row: baseRow({
      id: JOB_241,
      job_number: 'SWMS-261241',
      external_ref: 'MLB-261241',
      report_pack: pack241,
    }),
  },
  {
    id: JOB_243,
    job_number: 'SWMS-261243',
    pack: null,
    row: baseRow({
      id: JOB_243,
      job_number: 'SWMS-261243',
      external_ref: 'MLB-261243',
      ses_family: 'assessment_quote',
      ses_family_label: 'Assessment Report & Quote',
      substatus: 'ready_to_invoice',
      report_pack: { drafted: false, state: 'not_started', sent: false },
    }),
  },
];

const overlay = {
  jobId: JOB_241,
  row: {
    job_id: JOB_241,
    job_number: 'SWMS-261241',
    builder: 'Major Loss Builders',
    external_ref: 'MLB-261241',
    site_suburb: 'Perth',
    makesafe_job_family: 'physical_makesafe',
    makesafe_job_family_label: 'Make safe',
    pack_truth: {
      drafted: true,
      presentation_kind: 'ready',
      report_doc_id: 'report-doc-261241',
      has_selected_current_cycle_trade_report: true,
      required_documents: pack241.required_documents,
      closeout_documents: pack241.closeout_documents,
    },
  },
  ctx: {
    jobId: JOB_241,
    panelId: 'msReportingDetailPanel',
    queueEntry: { job_id: JOB_241, docket_revision_id: DOCKET_241, review_state: 'needs_review' },
    docketRevisionId: DOCKET_241,
    reviewState: 'needs_review',
    cockpit: {
      status: 'SEND_READY',
      controls: {
        approve_invoice: { enabled: false, disabled_reason: 'Preview only — do not approve' },
        send_it: { enabled: false, disabled_reason: 'Preview only — do not send' },
      },
      sections: {
        money: {
          labour_hours: 3,
          local_invoice_proposal: {
            line_items: [{
              description: 'Make-safe labour',
              quantity: 3,
              unit_price_ex_gst: 80,
              amount_ex_gst: 240,
            }],
            subtotal_ex_gst: 240,
            total_inc_gst: 264,
          },
        },
        email_drafts: [
          {
            route_kind: 'report',
            ready: true,
            recipients: ['accounts@mlb.com.au'],
            cc: [],
            subject: 'Make Safe Completion - MLB-261241',
            body: 'Please find the make-safe report for MLB-261241.',
            attachment_hashes: [],
          },
        ],
      },
    },
    pack: {
      drafted: true,
      presentation: { kind: 'ready', reason: null },
      report_doc_id: 'report-doc-261241',
      has_selected_current_cycle_trade_report: true,
      required_documents: pack241.required_documents,
      closeout_documents: pack241.closeout_documents,
      docket: {
        id: DOCKET_241,
        local_invoice_proposal: {
          line_items: [{
            description: 'Make-safe labour',
            quantity: 3,
            unit_price_ex_gst: 80,
            amount_ex_gst: 240,
          }],
          subtotal_ex_gst: 240,
          total_inc_gst: 264,
        },
      },
      artifacts: pack241.artifacts.map((a) => Object.assign({ signed_url: a.signed_url || 'about:blank#' + a.role }, a)),
    },
  },
};

module.exports = { cards, overlay, JOB_237, JOB_241, JOB_243 };
