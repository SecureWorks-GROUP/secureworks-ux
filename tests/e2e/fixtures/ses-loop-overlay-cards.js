/**
 * Three live-shaped sample cards for the SES loop overlay ship.
 * Identity only: job numbers + suburb. No client name / street / phone.
 *
 *   SWMS-261237  Docs Ready, drafted pack, NOT in the SES queue
 *   SWMS-261241  Docs Ready, drafted pack, pack has WO + report + SWMS + invoice
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
    has_swms_doc: false,
    invoice_status: 'not_ready',
  }, over || {});
}

const pack241 = {
  drafted: true,
  state: 'drafted',
  sent: false,
  docket_revision_id: DOCKET_241,
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
    pack: { drafted: true, state: 'drafted', sent: false, docket_revision_id: DOCKET_237 },
    row: baseRow({
      id: JOB_237,
      job_number: 'SWMS-261237',
      external_ref: 'MLB-261237',
      report_pack: { drafted: true, state: 'drafted', sent: false, docket_revision_id: DOCKET_237 },
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
      report_pack: { drafted: true, state: 'drafted', sent: false, docket_revision_id: DOCKET_241 },
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

const sendReady = {
  jobId: JOB_241,
  ctx: Object.assign({}, JSON.parse(JSON.stringify(overlay.ctx)), {
    jobId: JOB_241,
    reviewState: 'needs_review',
    cockpit: Object.assign({}, JSON.parse(JSON.stringify(overlay.ctx.cockpit)), {
      status: 'SEND_READY',
      controls: {
        approve_invoice: { enabled: false, label: 'APPROVE INVOICE' },
        send_it: {
          enabled: true,
          label: 'SEND IT',
          plan: 'Send the approved report, photo, and invoice routes for this exact release revision.',
        },
      },
    }),
  }),
};

const northam = {
  jobId: 'a6eac431-01f0-41df-8ec6-e79e6925f76e',
  ctx: {
    jobId: 'a6eac431-01f0-41df-8ec6-e79e6925f76e',
    panelId: 'msReportingDetailPanel',
    docketRevisionId: 'd-northam',
    outputHash: 'sha256:northam',
    reviewState: 'signed_off',
    cockpit: {
      status: 'SEND_READY',
      controls: {
        approve_invoice: { enabled: false, disabled_reason: 'Invoice already authorised (INV-1179).' },
        send_it: {
          enabled: false,
          label: 'SEND IT',
          disabled_reason: 'Release already dispatching.',
        },
      },
      sections: {
        email_drafts: [
          { route_kind: 'report', ready: true, recipients: ['mlb.mailer@primeeco.tech'], cc: [], subject: 'Report', body: 'Report body' },
          { route_kind: 'photo', ready: true, recipients: ['mlb.mailer@primeeco.tech'], cc: [], subject: 'Photos', body: 'Photo body' },
          { route_kind: 'invoice', ready: true, recipients: ['makesafes@mlbuilders.com.au'], cc: [], subject: 'Invoice', body: 'Invoice body' },
        ],
        money: { xero: { invoice_number: 'INV-1179', status: 'AUTHORISED' } },
      },
    },
    pack: {
      docket: { id: 'd-northam', output_content_hash: 'sha256:northam' },
      review: { review_state: 'signed_off' },
      artifacts: [],
    },
    sesInspect: {
      release: {
        release_revision_id: '1be0f185-b8c9-572c-b57f-00dde333b591',
        state: 'dispatching',
      },
      release_send_progress: {
        kind: 'partially_released',
        release_revision_id: '1be0f185-b8c9-572c-b57f-00dde333b591',
        release_state: 'dispatching',
        missing_route_kinds: ['invoice', 'photo'],
      },
    },
  },
};

module.exports = { cards, overlay, sendReady, northam, JOB_237, JOB_241, JOB_243 };
