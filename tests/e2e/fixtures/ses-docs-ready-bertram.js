/**
 * The Bertram AJBR-70271 Docs Ready proof card.
 *
 * Identity, builder routing rules and the trade submission are the LIVE record
 * for job SWMS-261109 (read-only lookup, 2026-08-03). Client personal data is
 * deliberately absent: suburb only, never the street address, never the client
 * name or phone — the same redaction rule the read-only census scripts in
 * `scripts/` apply before anything reaches a screenshot.
 *
 * Two facts about this job make it the right proof card for the rebuilt review
 * pane: it carries NO SWMS and NO Xero invoice, so the evidence-completeness
 * section has real missing documents to name (blueprint RV-1), and its builder
 * carries a recorded CC rule, so the per-route "why this, for this job" block
 * has a real recorded reason to quote (blueprint RV-5).
 *
 * The invoice figures are a FIXTURE derived from the job's recorded billing
 * rule (hourly_rate 80) and the trade's recorded labour_hours (3). No Xero
 * invoice exists for this job; the pack renders it as an SES proposal, which is
 * exactly what the live cockpit does before a Xero binding exists.
 */

const JOB_ID = '208450c0-7161-4b30-9514-66226b054609';
const DOCKET_REV = '9f2a71c4-0d5e-4b18-9a3c-71c8e0d24f61';

const REPORT_HASH = 'sha256:' + '1'.repeat(64);
const WO_HASH = 'sha256:' + '2'.repeat(64);
const PHOTO_HASH_1 = 'sha256:' + '3'.repeat(64);
const PHOTO_HASH_2 = 'sha256:' + '4'.repeat(64);
const PHOTO_HASH_3 = 'sha256:' + '5'.repeat(64);
const ORPHAN_HASH = 'sha256:' + '9'.repeat(64);

// A 1x1 grey PNG — the photo tiles need real bytes, not a network fetch.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const identityRow = {
  job_id: JOB_ID,
  id: JOB_ID,
  job_number: 'SWMS-261109',
  requesting_company_name: 'AJ Building & Restoration',
  // The identity projections (_msSesIdentityFrom*) always flatten builder to a
  // string before it reaches the cache, so the fixture matches that shape.
  builder: 'AJ Building & Restoration',
  external_ref: 'AJBR-70271',
  site_suburb: 'Bertram',
  makesafe_job_family: 'physical_makesafe',
  makesafe_job_family_label: 'Make safe',
  requesting_company_slug: 'aj',
  trade_notes:
    'Make-safe type: Temporary fencing\n' +
    'Damage: Cracked hardy fence leaning over (storm / wind).\n' +
    'Propped up hardy fence using 20 star pickets to secure upright until fence replaced.\n' +
    '2 trades, 3 labour hours. On site 30 July 2026, 09:19.',
};

const invoiceProposal = {
  line_items: [
    {
      description:
        'AJBR-70271 - Bertram - temporary fencing make-safe: propped cracked hardy fence upright with 20 star pickets to secure until replacement, including site attendance',
      quantity: 3,
      unit_price_ex_gst: 80,
      amount_ex_gst: 240,
    },
  ],
  subtotal_ex_gst: 240,
  total_inc_gst: 264,
};

const artifacts = [
  {
    role: 'supporting_report_pdf',
    object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/Make Safe Report - AJBR-70271 - Bertram.pdf',
    media_type: 'application/pdf',
    content_hash: REPORT_HASH,
    signed_url: 'about:blank#report',
  },
  {
    role: 'source_attachment',
    object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/Works Order.pdf',
    media_type: 'application/pdf',
    content_hash: WO_HASH,
    signed_url: 'about:blank#works-order',
    received_at: '2026-07-29T05:31:05Z',
  },
  {
    role: 'completion_photo',
    object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/AJBR-70271 - Photo 01.jpg',
    media_type: 'image/jpeg',
    content_hash: PHOTO_HASH_1,
    signed_url: PIXEL,
    metadata: { order: 1 },
  },
  {
    role: 'completion_photo',
    object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/AJBR-70271 - Photo 02.jpg',
    media_type: 'image/jpeg',
    content_hash: PHOTO_HASH_2,
    signed_url: PIXEL,
    metadata: { order: 2 },
  },
  {
    role: 'sibling_photo_evidence',
    object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/AJBR-70271 - Site context.jpg',
    media_type: 'image/jpeg',
    content_hash: PHOTO_HASH_3,
    signed_url: PIXEL,
    metadata: { order: 3 },
  },
];

function emailDrafts() {
  return [
    {
      route_kind: 'report',
      recipients: ['workorders@ajs.build'],
      cc: ['vanessa@ajs.build'],
      subject: 'Make Safe Report - AJBR-70271 - Bertram',
      body:
        'Hi team,\n\n' +
        'Please find attached our make-safe completion report for AJBR-70271 at Bertram WA 6167.\n\n' +
        'Works completed: temporary fencing make-safe. The cracked hardy fence was propped upright and secured with 20 star pickets to hold it until the fence is replaced.\n\n' +
        'Photo evidence follows in a separate email. The invoice follows separately.\n\n' +
        'Any questions, just let us know.',
      attachment_hashes: [REPORT_HASH],
      ready: true,
      recipient_reasons: [
        {
          address: 'workorders@ajs.build',
          reason: "AJ Building & Restoration's recorded report recipient — the address the work order came from.",
        },
        {
          address: 'vanessa@ajs.build',
          reason: 'Copied under this builder’s recorded instruction: "CC vanessa@ajs.build on all correspondence".',
        },
      ],
    },
    {
      route_kind: 'photo',
      recipients: ['workorders@ajs.build'],
      cc: ['vanessa@ajs.build'],
      subject: 'Photo Evidence - AJBR-70271 - Bertram',
      body:
        'Hi team,\n\n' +
        'Further to our make-safe pack for AJBR-70271 (Bertram), please find the site photos from the report attached as separate full-resolution files, labelled to match the report.\n\n' +
        'Any questions, just let us know.',
      attachment_hashes: [PHOTO_HASH_1, PHOTO_HASH_2],
      ready: true,
    },
    {
      route_kind: 'invoice',
      recipients: ['vanessa@ajs.build'],
      cc: [],
      subject: 'Make Safe Invoice - AJBR-70271 - Bertram',
      body:
        'Hi team,\n\n' +
        'Please find attached our tax invoice and make-safe completion report for AJBR-70271 at Bertram WA 6167.\n\n' +
        'Labour 3 hours at $80/hr. Invoice total $264.00 inc GST ($240.00 ex GST).\n\n' +
        'Payment terms: 7 days.',
      // Deliberately references a hash with no artifact in the pack: the Xero
      // invoice PDF does not exist yet. The pane must SAY that rather than
      // quietly render one fewer attachment than the route carries.
      attachment_hashes: [REPORT_HASH, ORPHAN_HASH],
      ready: false,
    },
  ];
}

/** SEND_READY-shaped cockpit: the captain's normal Docs Ready review. */
function cockpitSendReady() {
  return {
    schema: 'secureworks.makesafe.ses-review-cockpit/v1',
    status: 'SEND_READY',
    stale: false,
    sections: {
      job_story: { job_id: JOB_ID, job_number: 'SWMS-261109', attendance_cycle_ids: [] },
      status: { status: 'SEND_READY', stale: false, reasons: [] },
      money: { local_invoice_proposal: invoiceProposal, xero: null },
      email_drafts: emailDrafts(),
    },
    controls: {
      approve_invoice: {
        enabled: true,
        label: 'APPROVE INVOICE',
        plan: 'Create and authorise one Xero invoice for this exact obligation revision.',
      },
      send_it: { enabled: false, label: 'SEND IT', plan: '' },
      captain_only: false,
    },
  };
}

/**
 * HOLD-shaped cockpit: the blueprint's "machine stopped and wants a person".
 * The default reasons mirror the captain's 2026-08 screenshots of the old
 * pane: a pricing blocker, a missing Xero invoice, and the builder-email
 * blocker EMITTED TWICE (the backend can repeat a blocker once per route) —
 * the pane must render it once.
 */
function cockpitHold(reasons) {
  const c = cockpitSendReady();
  c.status = 'HOLD';
  c.sections.status = {
    status: 'HOLD',
    stale: false,
    reasons: reasons || [
      'Invoice line 1 labour rate is below this builder’s written schedule ($80/hr min 2 hours).',
      'No Xero invoice exists for this docket revision.',
      'Builder email draft missing.',
      'Builder email draft missing.',
    ],
  };
  c.controls.approve_invoice.enabled = false;
  c.controls.send_it.enabled = false;
  return c;
}

function reviewablePack() {
  return {
    review: {
      docket_revision_id: DOCKET_REV,
      review_state: 'needs_review',
      docket_output_content_hash: 'sha256:' + 'a'.repeat(64),
    },
    docket: {
      id: DOCKET_REV,
      output_content_hash: 'sha256:' + 'a'.repeat(64),
      local_invoice_proposal: invoiceProposal,
      xero_binding: null,
    },
    artifacts: artifacts,
  };
}

/** The ctx shape `_msSesRenderDetail` consumes. */
function context(cockpit) {
  return {
    jobId: JOB_ID,
    cockpit: cockpit || cockpitSendReady(),
    queueEntry: {
      job_id: JOB_ID,
      docket_revision_id: DOCKET_REV,
      docket_output_content_hash: 'sha256:' + 'a'.repeat(64),
      review_state: 'needs_review',
    },
    pack: reviewablePack(),
    docketRevisionId: DOCKET_REV,
    outputHash: 'sha256:' + 'a'.repeat(64),
    reviewState: 'needs_review',
    fetchedAt: 0,
  };
}

module.exports = {
  JOB_ID,
  DOCKET_REV,
  REPORT_HASH,
  WO_HASH,
  ORPHAN_HASH,
  identityRow,
  invoiceProposal,
  artifacts,
  cockpitSendReady,
  cockpitHold,
  reviewablePack,
  context,
};
