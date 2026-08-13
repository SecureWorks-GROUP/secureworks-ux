/**
 * Docs Ready review-pane family fixtures for the QA-v2 fix
 * (fm/review-pane-qa-v2). Each fixture mirrors the SHAPE the captain saw live
 * on 2026-08-13 (identity facts only — suburb + job number + builder routing,
 * never client name / phone / street), so the offline proof shot reproduces the
 * bug and proves the fix without any live session.
 *
 * The four families the captain named:
 *   - MLB physical make-safe  (Report + SWMS + Invoice DRAFT + WO)
 *   - MLB physical, report signed URL NOT minted (the "no report tile" lie)
 *   - AJS temporary fence     (Report + Invoice + WO, NO SWMS — a SWMS X is a lie)
 *   - Roof portal capture      (the Prime capture IS the report; no MakeSafe PDF)
 *
 * Signed URLs point at localhost sample assets (real bytes) or are null where
 * the scenario needs the "artifact present, link unavailable" path. The proof
 * script (scripts/ses-review-pane-qa-v2-shot.js) rewrites the *_ASSET hashes to
 * the served sample files, exactly like ses-review-pane-proof-shot.js.
 */

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function baseCockpit(jobNumber, controls) {
  return {
    schema: 'secureworks.makesafe.ses-review-cockpit/v1',
    status: 'SEND_READY',
    stale: false,
    sections: {
      job_story: { job_id: jobNumber, job_number: jobNumber, attendance_cycle_ids: [] },
      status: { status: 'SEND_READY', stale: false, reasons: [] },
      money: { local_invoice_proposal: null, xero: null },
      email_drafts: [],
    },
    controls: controls || {
      approve_invoice: { enabled: true, label: 'APPROVE INVOICE', plan: 'Authorise one Xero draft invoice.' },
      send_it: { enabled: false, label: 'SEND IT', plan: '' },
      captain_only: false,
    },
  };
}

function context(jobId, cockpit, artifacts, extra) {
  const DOCKET = jobId + '-docket';
  const ctx = {
    jobId: jobId,
    cockpit: cockpit,
    queueEntry: { job_id: jobId, docket_revision_id: DOCKET, review_state: 'needs_review' },
    pack: { review: { docket_revision_id: DOCKET }, docket: { id: DOCKET, local_invoice_proposal: (cockpit.sections.money || {}).local_invoice_proposal || null, xero_binding: (cockpit.sections.money || {}).xero || null }, artifacts: artifacts },
    docketRevisionId: DOCKET,
    reviewState: 'needs_review',
    fetchedAt: 0,
  };
  return Object.assign(ctx, extra || {});
}

// ── MLB physical make-safe: Report + SWMS + Invoice DRAFT + WO, closeout true ──
const MLB = (function () {
  const JOB = 'SWMS-261179';
  const REPORT_ASSET = 'sha256:' + 'a1'.repeat(32);
  const WO_ASSET = 'sha256:' + 'a2'.repeat(32);
  const INVOICE_ASSET = 'sha256:' + 'a7'.repeat(32);
  const identityRow = {
    job_id: JOB, id: JOB, job_number: JOB,
    requesting_company_name: 'MLB Insurance Builders', builder: 'MLB Insurance Builders',
    external_ref: 'MLB-261179', site_suburb: 'Ellenbrook',
    makesafe_job_family: 'physical_makesafe', makesafe_job_family_label: 'Make safe',
    requesting_company_slug: 'mlb',
    trade_notes: 'Make-safe type: Physical make-safe.\nBoarded broken windows, made structure safe. 36 photos.',
  };
  const invoiceProposal = {
    line_items: [{ description: 'MLB-261179 - Ellenbrook - physical make-safe', quantity: 4, unit_price_ex_gst: 85, amount_ex_gst: 340 }],
    subtotal_ex_gst: 340, total_inc_gst: 374,
  };
  function artifacts(reportUrlMinted) {
    return [
      { role: 'supporting_report_pdf', object_key: 'b/' + JOB + '/Make Safe Report - MLB-261179 - Ellenbrook.pdf', media_type: 'application/pdf', content_hash: REPORT_ASSET, signed_url: reportUrlMinted ? REPORT_ASSET : null },
      { role: 'xero_invoice_pdf', object_key: 'b/' + JOB + '/Invoice INV-4419 - MLB-261179.pdf', media_type: 'application/pdf', content_hash: INVOICE_ASSET, signed_url: INVOICE_ASSET, metadata: { xero_invoice_id: 'xero-4419', invoice_number: 'INV-4419' } },
      { role: 'swms_artifact', object_key: 'b/' + JOB + '/SWMS - MLB-261179.pdf', media_type: 'application/pdf', content_hash: 'sha256:' + 'b3'.repeat(32), signed_url: REPORT_ASSET },
      { role: 'source_attachment', object_key: 'b/' + JOB + '/Works Order MLB-261179.pdf', media_type: 'application/pdf', content_hash: WO_ASSET, signed_url: WO_ASSET, received_at: '2026-08-08T02:00:00Z' },
      { role: 'completion_photo', object_key: 'b/' + JOB + '/Photo 01.jpg', media_type: 'image/jpeg', content_hash: 'sha256:' + 'c4'.repeat(32), signed_url: PIXEL, metadata: { order: 1 } },
      { role: 'completion_photo', object_key: 'b/' + JOB + '/Photo 02.jpg', media_type: 'image/jpeg', content_hash: 'sha256:' + 'c5'.repeat(32), signed_url: PIXEL, metadata: { order: 2 } },
    ];
  }
  function cockpit() {
    const c = baseCockpit(JOB);
    c.sections.money = { local_invoice_proposal: invoiceProposal, xero: { status: 'DRAFT', invoice_number: 'INV-4419', xero_invoice_id: 'xero-4419' } };
    return c;
  }
  return { JOB, REPORT_ASSET, WO_ASSET, INVOICE_ASSET, identityRow, invoiceProposal, artifacts, cockpit };
})();

// ── AJS temporary fence: Report + Invoice + WO, NO SWMS (a SWMS X is a lie) ────
const AJS = (function () {
  const JOB = 'SWMS-261174';
  const REPORT_ASSET = 'sha256:' + 'd1'.repeat(32);
  const WO_ASSET = 'sha256:' + 'd2'.repeat(32);
  const identityRow = {
    job_id: JOB, id: JOB, job_number: JOB,
    requesting_company_name: 'AJ Building & Restoration', builder: 'AJ Building & Restoration',
    external_ref: 'AJBR-261174', site_suburb: 'Heathridge',
    makesafe_job_family: 'temporary_fencing', makesafe_job_family_label: 'Temporary fencing',
    requesting_company_slug: 'aj',
    trade_notes: 'Make-safe type: Temporary fencing.\nInstalled temp fence around storm-damaged boundary. 13 photos.',
  };
  const invoiceProposal = {
    line_items: [{ description: 'AJBR-261174 - Heathridge - temporary fencing make-safe', quantity: 3, unit_price_ex_gst: 80, amount_ex_gst: 240 }],
    subtotal_ex_gst: 240, total_inc_gst: 264,
  };
  function artifacts() {
    return [
      { role: 'supporting_report_pdf', object_key: 'b/' + JOB + '/Make Safe Report - AJBR-261174 - Heathridge.pdf', media_type: 'application/pdf', content_hash: REPORT_ASSET, signed_url: REPORT_ASSET },
      { role: 'source_attachment', object_key: 'b/' + JOB + '/Works Order AJBR-261174.pdf', media_type: 'application/pdf', content_hash: WO_ASSET, signed_url: WO_ASSET, received_at: '2026-08-09T02:00:00Z' },
      { role: 'completion_photo', object_key: 'b/' + JOB + '/Photo 01.jpg', media_type: 'image/jpeg', content_hash: 'sha256:' + 'e4'.repeat(32), signed_url: PIXEL, metadata: { order: 1 } },
    ];
  }
  // A hold whose only caveats are the email-draft walls in the LIVE phrasing the
  // old regex missed ("no draft on current docket") — SEND must still arm.
  function cockpitDraftOnlyHold() {
    const c = baseCockpit(JOB);
    c.status = 'HOLD';
    c.sections.money = { local_invoice_proposal: invoiceProposal, xero: { status: 'DRAFT', invoice_number: 'INV-4420', xero_invoice_id: 'xero-4420' } };
    c.verdict = {
      clean: false,
      blockers: [
        { code: 'route_draft_missing', fact: 'REPORT EMAIL — no draft on current docket.', evidence: { route_kind: 'report' } },
        { code: 'route_draft_missing', fact: 'PHOTO EMAIL — no draft on current docket.', evidence: { route_kind: 'photo' } },
        { code: 'route_draft_missing', fact: 'INVOICE EMAIL — no draft on current docket.', evidence: { route_kind: 'invoice' } },
      ],
    };
    c.controls.approve_invoice = { enabled: true, label: 'APPROVE INVOICE', plan: 'Authorise the Xero draft invoice already prepared for this pack.' };
    c.controls.send_it = { enabled: false, label: 'SEND IT', plan: '' };
    return c;
  }
  return { JOB, REPORT_ASSET, WO_ASSET, identityRow, invoiceProposal, artifacts, cockpitDraftOnlyHold };
})();

// ── Roof portal capture: the Prime capture IS the report (no MakeSafe PDF) ─────
const ROOF = (function () {
  const JOB = 'SWMS-261146';
  const CAPTURE_ASSET = 'sha256:' + 'f1'.repeat(32);
  const WO_ASSET = 'sha256:' + 'f2'.repeat(32);
  const identityRow = {
    job_id: JOB, id: JOB, job_number: JOB,
    requesting_company_name: 'Prime Roofing', builder: 'Prime Roofing',
    external_ref: 'PRM-261146', site_suburb: 'Mosman Park',
    makesafe_job_family: 'roof_portal', makesafe_job_family_label: 'Roof',
    requesting_company_slug: 'prime',
    trade_notes: 'Make-safe type: Roof portal.\nTarped storm-damaged ridge. Prime portal form locked.',
  };
  const invoiceProposal = {
    line_items: [{ description: 'PRM-261146 - Mosman Park - roof make-safe', quantity: 2, unit_price_ex_gst: 120, amount_ex_gst: 240 }],
    subtotal_ex_gst: 240, total_inc_gst: 264,
  };
  function artifacts() {
    return [
      { role: 'portal_roof_report_screenshot', object_key: 'b/' + JOB + '/Prime Roof Capture - PRM-261146.svg', media_type: 'image/svg+xml', content_hash: CAPTURE_ASSET, signed_url: CAPTURE_ASSET },
      { role: 'source_attachment', object_key: 'b/' + JOB + '/Works Order PRM-261146.pdf', media_type: 'application/pdf', content_hash: WO_ASSET, signed_url: WO_ASSET, received_at: '2026-08-07T02:00:00Z' },
      { role: 'completion_photo', object_key: 'b/' + JOB + '/Photo 01.jpg', media_type: 'image/jpeg', content_hash: 'sha256:' + 'a6'.repeat(32), signed_url: PIXEL, metadata: { order: 1 } },
    ];
  }
  function cockpit() {
    const c = baseCockpit(JOB);
    c.sections.money = { local_invoice_proposal: invoiceProposal, xero: { status: 'DRAFT', invoice_number: 'INV-4418', xero_invoice_id: 'xero-4418' } };
    // The roof family owes NO separate MakeSafe report PDF — the portal capture
    // is the report. This is the backend's own not_applicable signal.
    c.sections.family_evidence = {
      supporting_report_pdf: { state: 'not_applicable' },
      roof_report_capture: { state: 'present' },
    };
    return c;
  }
  return { JOB, CAPTURE_ASSET, WO_ASSET, identityRow, invoiceProposal, artifacts, cockpit };
})();

module.exports = { PIXEL, context, MLB, AJS, ROOF };
