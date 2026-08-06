/**
 * The Mindarie SWMS-261081 roof-report proof card, for the portal-capture
 * document tab.
 *
 * Identity, family rules, artifact roles and the duplicate-capture shape are
 * the LIVE record for that job (read-only lookup, 2026-08-06). Client personal
 * data is deliberately absent — suburb and job reference only, never the street
 * address, client name, phone or email — the same redaction rule the read-only
 * census scripts in `scripts/` apply before anything reaches a screenshot.
 *
 * TWO THINGS ARE DELIBERATELY NOT THE LIVE VALUE, because both are pointers to
 * a document that DOES carry client detail:
 *   - the capture bytes are a drawn FACSIMILE of a portal form (see
 *     captureFacsimile below), never the real capture;
 *   - the portal share URL is a zero UUID, not the live share.
 * The live capture never enters this repo, in any form.
 *
 * What makes this the right proof card:
 *   - its family is `ordinary_roof_portal`, whose backend rule is
 *     "report-only-portal-is-the-report" — the portal capture IS the report, so
 *     a missing capture leaves the pack with no report at all;
 *   - it carries the capture TWICE with identical bytes and different file
 *     names (a retake changed the name and broke the producer's idempotency),
 *     which is the case the tab has to collapse to one without deleting
 *     anything;
 *   - the live capture is image-only, so "no extractable text" must never be
 *     read as "empty document".
 */

const JOB_ID = '967cdb6e-e57e-46ea-89d8-14e8afbc2ada';
const DOCKET_REV = '69b844b0-d266-5e92-89b2-f93fa32a0ca5';
const OUTPUT_HASH = 'sha256:' + 'c'.repeat(64);

// One capture, stored twice. Identical bytes -> identical hash: that identity,
// not the file name, is what lets the pane show one tab honestly.
const CAPTURE_HASH = 'sha256:' + '8'.repeat(64);
const WO_HASH = 'sha256:' + '2'.repeat(64);
const INVOICE_HASH = 'sha256:' + '5'.repeat(64);
const MANIFEST_HASH = 'sha256:' + '1'.repeat(64);

/**
 * A drawn stand-in for the portal roof report: same shape as the real capture
 * (a submitted, locked portal form), with obviously invented answers and a
 * SAMPLE banner. It exists so a screenshot can prove the form is READABLE at
 * stage size without the live capture ever being committed.
 */
function captureFacsimile() {
  const rows = [
    ['Roof type', 'Concrete tile'],
    ['Roof pitch', '22 degrees'],
    ['Storey', 'Single'],
    ['Damage observed', 'Wind-lifted tiles, ridge capping cracked'],
    ['Tiles displaced', '14'],
    ['Sarking damaged', 'No'],
    ['Water ingress', 'Yes — ceiling stain in one room'],
    ['Temporary cover installed', 'Yes — tarp, sandbag weighted'],
    ['Area covered', '18 m2'],
    ['Safe to leave', 'Yes'],
    ['Follow-up trade required', 'Roof plumber'],
    ['Attended by', 'Crew of 2'],
  ];
  const line = (label, value, i) =>
    `<text x="40" y="${196 + i * 34}" font-family="Helvetica,Arial" font-size="15" fill="#4C6A7C">${label}</text>` +
    `<text x="330" y="${196 + i * 34}" font-family="Helvetica,Arial" font-size="15" fill="#1A272E" font-weight="600">${value}</text>` +
    `<line x1="40" y1="${208 + i * 34}" x2="760" y2="${208 + i * 34}" stroke="#EDF1F4" stroke-width="1"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640" viewBox="0 0 800 640">` +
    `<rect width="800" height="640" fill="#ffffff"/>` +
    `<rect x="0" y="0" width="800" height="8" fill="#F15A29"/>` +
    `<text x="40" y="62" font-family="Helvetica,Arial" font-size="26" font-weight="700" fill="#1A272E">Roof Report</text>` +
    `<text x="40" y="88" font-family="Helvetica,Arial" font-size="14" fill="#4C6A7C">Builder portal submission &#183; MLB-27100 &#183; Mindarie</text>` +
    `<rect x="40" y="106" width="720" height="34" rx="6" fill="#FDF2EE" stroke="#F4C7B5"/>` +
    `<text x="52" y="128" font-family="Helvetica,Arial" font-size="13" font-weight="700" fill="#B4441C">` +
    `SAMPLE FACSIMILE &#8212; drawn for this repo&#8217;s screenshots. Not the real capture, not client data.</text>` +
    rows.map((r, i) => line(r[0], r[1], i)).join('') +
    `<text x="40" y="620" font-family="Helvetica,Arial" font-size="13" fill="#7C8898">` +
    `Form submitted and locked &#8212; no longer available for editing or submission.</text>` +
    `</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const CAPTURE_URL = captureFacsimile();

/**
 * The capture MANIFEST the producer writes beside the capture. Every field here
 * is a fact ABOUT the evidence — when it was taken, what the observer saw —
 * which is why the pane reads it rather than guessing. `url` is neutered (see
 * the file header); everything else matches the live producer's shape.
 */
const captureManifest = {
  builder_reference: 'MLB-27100',
  capture_producer: 'capture_portal_evidence.py/v1',
  captured_at: '2026-08-06T00:31:58.239+00:00',
  captured_by: 'ses-prime-portal-observer/2026-08-02.4',
  content_fingerprint: 'sha256:' + 'd'.repeat(64),
  docket_id: 'SWMS-261081',
  job_id: JOB_ID,
  role: 'roof_report',
  signal: 'submitted/locked observed, 21 of 23 fields answered',
  status: 'done',
  url: 'https://primeeco.tech/share/00000000-0000-0000-0000-000000000000',
};

const identityRow = {
  job_id: JOB_ID,
  id: JOB_ID,
  job_number: 'SWMS-261081',
  requesting_company_name: 'MLB',
  builder: 'MLB',
  external_ref: 'MLB-27100',
  site_suburb: 'Mindarie',
  makesafe_job_family: 'ordinary_roof_portal',
  makesafe_job_family_label: 'Roof Report',
  requesting_company_slug: 'mlb',
  attendance_cycle_id: '90bbf1ee-70ac-4cb0-ae7e-1356423ad5db',
  cycle_number: 1,
  is_reattend: false,
  reattend_count: 0,
  last_reattend_at: null,
};

const invoiceProposal = {
  line_items: [
    {
      description: 'MLB-27100 - Mindarie - roof report attendance and portal submission',
      quantity: 1,
      unit_price_ex_gst: 330,
      amount_ex_gst: 330,
    },
  ],
  subtotal_ex_gst: 330,
  total_inc_gst: 363,
};

// The JSON manifest artifact. JSON is not a document: it must never take a tab.
const manifestArtifact = {
  role: 'portal_roof_report',
  object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/EVIDENCE/portal_roof_report.json',
  media_type: 'application/json',
  content_hash: MANIFEST_HASH,
  signed_url: 'about:blank#capture-manifest',
};

/**
 * A capture artifact. The live pack ships `image/png`; the facsimile is SVG,
 * which resolves to the same viewer kind ('image') through _msSesMediaKind, so
 * the rendered pane is the one the captain sees.
 */
function captureArtifact(fileName) {
  return {
    role: 'portal_roof_report_screenshot',
    object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/' + fileName,
    media_type: 'image/svg+xml',
    content_hash: CAPTURE_HASH,
    signed_url: CAPTURE_URL,
  };
}

const workOrderArtifact = {
  role: 'source_attachment',
  object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/work_order_MLB-27100PO-56960.pdf',
  media_type: 'application/pdf',
  content_hash: WO_HASH,
  signed_url: 'about:blank#works-order',
  received_at: '2026-08-01T08:38:54Z',
};

const invoiceArtifact = {
  role: 'xero_invoice_pdf',
  object_key: 'b/' + JOB_ID + '/' + DOCKET_REV + '/INV-1150.pdf',
  media_type: 'application/pdf',
  content_hash: INVOICE_HASH,
  signed_url: 'about:blank#xero-invoice',
  metadata: { xero_invoice_id: 'fe826d86', invoice_number: 'INV-1150', status: 'DRAFT' },
};

/** The live shape: manifest + the capture stored twice + work order + invoice. */
function artifactsWithCapture() {
  return [
    manifestArtifact,
    captureArtifact('Prime Portal Roof Report - MLB-27100 - Mindarie.png'),
    captureArtifact('Prime Portal Roof Report - MLB-27100 - Mindarie - RETAKE.png'),
    workOrderArtifact,
    invoiceArtifact,
  ];
}

/** The same roof card with no capture attached — the honest-absence proof. */
function artifactsWithoutCapture() {
  return [workOrderArtifact, invoiceArtifact];
}

/**
 * The live cockpit's family rules for this card: the portal IS the report (so
 * no separate report PDF is owed) and a roof capture IS owed. `captureEvidence`
 * overrides the capture entry so the absence case can carry the backend's own
 * blocked reason.
 */
function cockpit(captureEvidence) {
  return {
    schema: 'secureworks.makesafe.ses-review-cockpit/v1',
    status: 'INVOICE_CREATE_READY',
    stale: false,
    sections: {
      job_story: { job_id: JOB_ID, job_number: 'SWMS-261081', attendance_cycle_ids: [identityRow.attendance_cycle_id] },
      status: { status: 'INVOICE_CREATE_READY', stale: false, reasons: [] },
      money: {
        local_invoice_proposal: invoiceProposal,
        xero: { invoice_number: 'INV-1150', status: 'DRAFT', xero_invoice_id: 'fe826d86' },
      },
      email_drafts: [
        {
          route_kind: 'invoice',
          recipients: ['makesafes@mlbuilders.com.au'],
          cc: [],
          subject: 'Roof Report and Invoice - MLB-27100 - Mindarie',
          body:
            'Hi team,\n\n' +
            'Please find attached our tax invoice for the roof report attendance at MLB-27100 (Mindarie). ' +
            'The roof report itself was submitted through your portal.\n\n' +
            'Payment terms: 7 days.',
          attachment_hashes: [INVOICE_HASH],
          ready: true,
        },
      ],
      family_evidence: {
        supporting_report_pdf: { state: 'not_applicable', rule: 'report-only-portal-is-the-report' },
        roof_report_capture: captureEvidence || {
          state: 'ready',
          evidence: 'file:EVIDENCE/portal_roof_report.json',
        },
        swms_requirement: {
          state: 'ready',
          evidence: 'rule:swms-not-required-under-named-builder-job-rule',
        },
      },
    },
    controls: {
      approve_invoice: {
        enabled: true,
        label: 'APPROVE INVOICE',
        plan: 'Approve the existing Xero DRAFT for this exact obligation revision.',
        disabled_reason: null,
      },
      send_it: {
        enabled: false,
        label: 'SEND IT',
        plan: '',
        disabled_reason: 'The bound Xero invoice is DRAFT, not AUTHORISED.',
      },
    },
  };
}

/** The blocked-capture variant of the cockpit, for the absence screenshot. */
function cockpitCaptureMissing() {
  return cockpit({
    state: 'blocked',
    reason: 'No portal capture is recorded for this docket revision.',
    reason_code: 'recovery-not-run',
    recovery_action: 'The portal observer re-runs against the builder share; if the share has lapsed, ask the builder to re-issue it.',
  });
}

function pack(artifacts) {
  return {
    review: {
      docket_revision_id: DOCKET_REV,
      review_state: 'needs_review',
      docket_output_content_hash: OUTPUT_HASH,
    },
    docket: {
      id: DOCKET_REV,
      output_content_hash: OUTPUT_HASH,
      local_invoice_proposal: invoiceProposal,
      xero_binding: { invoice_number: 'INV-1150', status: 'DRAFT', xero_invoice_id: 'fe826d86' },
    },
    artifacts: artifacts,
  };
}

/**
 * The ctx shape `_msSesRenderDetail` consumes. `portalCaptureFacts` is what
 * _msSesHydratePortalCaptureFacts puts there after reading the manifest off its
 * signed URL; pass null to render the "manifest could not be read" state.
 */
function context(opts) {
  opts = opts || {};
  const withCapture = opts.withCapture !== false;
  return {
    jobId: JOB_ID,
    cockpit: withCapture ? cockpit() : cockpitCaptureMissing(),
    queueEntry: {
      job_id: JOB_ID,
      docket_revision_id: DOCKET_REV,
      docket_output_content_hash: OUTPUT_HASH,
      review_state: 'needs_review',
    },
    pack: pack(withCapture ? artifactsWithCapture() : artifactsWithoutCapture()),
    portalCaptureFacts: withCapture && opts.manifestRead !== false ? captureManifest : undefined,
    portalCaptureFactsFailed: withCapture && opts.manifestRead === false,
    docketRevisionId: DOCKET_REV,
    outputHash: OUTPUT_HASH,
    reviewState: 'needs_review',
    fetchedAt: 0,
  };
}

module.exports = {
  JOB_ID,
  DOCKET_REV,
  CAPTURE_HASH,
  CAPTURE_URL,
  captureManifest,
  captureFacsimile,
  identityRow,
  artifactsWithCapture,
  artifactsWithoutCapture,
  cockpit,
  cockpitCaptureMissing,
  pack,
  context,
};
