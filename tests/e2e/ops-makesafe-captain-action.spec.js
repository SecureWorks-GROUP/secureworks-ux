const { test, expect } = require('@playwright/test');

test('make-safe card shows the actionable Captain sentence inline', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => renderMakesafeCard({
    id: 'job-captain-action',
    job_number: 'SWMS-TEST',
    board_stage: 'allocated',
    makesafe_job_family_label: 'Make Safe',
    site_suburb: 'Perth',
    external_ref: 'MLB-TEST',
    created_at: new Date().toISOString(),
    captain_action: {
      code: 'attendance_cycle_ruling',
      message:
        'Need you to choose which attendance cycle owns <script>bad()</script>.',
      evidence_refs: ['job_service_reports:report-1'],
      since: new Date().toISOString(),
    },
  }, 'allocated'));

  expect(rendered).toContain('class="ms-captain-action"');
  expect(rendered).toContain('Waiting on Captain');
  expect(rendered).toContain(
    'Need you to choose which attendance cycle owns &lt;script&gt;bad()&lt;/script&gt;.',
  );
  expect(rendered).not.toContain('<script>bad()</script>');
});

test('make-safe card does not warn when server stage is valid and action is absent', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => renderMakesafeCard({
    id: 'job-captain-stage',
    job_number: 'SWMS-STAGE',
    board_stage: 'allocated',
    makesafe_job_family_label: 'Make Safe',
    site_suburb: 'Perth',
    created_at: new Date().toISOString(),
  }, 'allocated'));

  expect(rendered).not.toContain('ms-captain-action');
});

test('make-safe card shows an identified gap for an incomplete Captain action envelope', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => renderMakesafeCard({
    id: 'job-captain-gap',
    job_number: 'SWMS-GAP',
    board_stage: 'allocated',
    makesafe_job_family_label: 'Make Safe',
    site_suburb: 'Perth',
    created_at: new Date().toISOString(),
    captain_action: { code: 'attendance_cycle_ruling' },
  }, 'allocated'));

  expect(rendered).toContain('Waiting on Captain');
  expect(rendered).toContain(
    'Action unavailable — needs attention — SWMS-GAP',
  );
});

test('report-ready placement labels an incomplete pack without hiding Captain review', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => {
    const card = mapCanonicalMakesafeRow({
      id: 'job-missing-report-bind',
      job_number: 'SWMS-26980',
      canonical_stage: 'report_ready',
      substatus: 'admin_to_send_report',
      ses_family_label: 'Roof Report',
      site_suburb: 'Gwelup',
      created_at: new Date().toISOString(),
      pack: {
        drafted: true,
        state: 'drafted',
        // Deliberately contradictory: a stale ready label cannot erase the
        // visible document caveat, but the Captain still owns manual review.
        presentation_kind: 'ready',
        presentation_reason:
          'The pack has no bound report_doc_id — <script>bad()</script>.',
        invoice_doc_id: 'invoice-doc-missing-report-bind',
        required_documents_resolved: true,
        required_documents: { report: true, invoice: true, swms: false },
        required_documents_unresolved_reason: null,
        closeout_documents: { report: false, invoice: true, swms: false },
      },
    }, null, { rememberStage: false });
    return renderMakesafeCard(card, 'report_ready');
  });

  expect(rendered).toContain('PACK INCOMPLETE');
  expect(rendered).toContain('Report: required pack pointer is missing or unresolved');
  expect(rendered).not.toContain('Ready to send');
  expect(rendered).toContain('Review job pack');
  expect(rendered).not.toContain('<script>bad()</script>');
});

test('resolved ready presentation still renders the review control', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => {
    const card = mapCanonicalMakesafeRow({
      id: 'job-ready-pack',
      job_number: 'SWMS-READY',
      canonical_stage: 'report_ready',
      substatus: 'admin_to_send_report',
      ses_family_label: 'MakeSafe',
      site_suburb: 'Perth',
      created_at: new Date().toISOString(),
      report: { state: 'submitted', cycle_number: 1 },
      pack: {
        drafted: true,
        state: 'drafted',
        presentation_kind: 'ready',
        report_doc_id: 'report-doc-ready-pack',
        invoice_doc_id: 'invoice-doc-ready-pack',
        swms_doc_id: 'swms-doc-ready-pack',
        required_documents_resolved: true,
        required_documents: { report: true, invoice: true, swms: true },
        required_documents_unresolved_reason: null,
        closeout_documents: { report: true, invoice: true, swms: true },
      },
    }, null, { rememberStage: false });
    return renderMakesafeCard(card, 'report_ready');
  });

  expect(rendered).toContain('Ready to send');
  expect(rendered).toContain('Review job pack');
  expect(rendered).not.toContain('PACK INCOMPLETE');
});

test('legacy-transition closeout-only pack keeps the Captain review control visible', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => {
    const card = mapCanonicalMakesafeRow({
      id: 'f6dba284-43b6-41ee-8ccd-6a625c371193',
      job_number: 'SWMS-261286',
      canonical_stage: 'report_ready',
      substatus: 'admin_to_send_report',
      ses_family_label: 'MakeSafe',
      site_suburb: 'Perth',
      created_at: new Date().toISOString(),
      report: { state: 'submitted', cycle_number: 1 },
      pack: {
        drafted: true,
        state: 'drafted',
        presentation_kind: 'ready',
        report_doc_id: 'report-doc-live-shape',
        invoice_doc_id: 'invoice-doc-live-shape',
        swms_doc_id: 'swms-doc-live-shape',
        // Until backend #745 is deployed, v1 supplies closeout truth without
        // requirements. The UX must call that unknown and preserve the door.
        closeout_documents: { report: true, invoice: true, swms: true },
      },
    }, null, { rememberStage: false });
    return renderMakesafeCard(card, 'report_ready');
  });

  expect(rendered).toContain('Review job pack');
  expect(rendered).toContain('REQUIREMENTS UNKNOWN');
  expect(rendered).toContain('Requirements unknown');
  expect(rendered).not.toContain('Required and closeout document truth is empty or malformed');
});

test('ready label with empty document maps stays visibly incomplete but reviewable', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => {
    const card = mapCanonicalMakesafeRow({
      id: 'job-empty-document-maps',
      job_number: 'SWMS-EMPTY-MAPS',
      canonical_stage: 'report_ready',
      substatus: 'admin_to_send_report',
      report: { state: 'submitted', cycle_number: 1 },
      pack: {
        drafted: true,
        state: 'drafted',
        presentation_kind: 'ready',
        report_doc_id: 'report-doc-empty-maps',
        required_documents: {},
        closeout_documents: {},
      },
    }, null, { rememberStage: false });
    return renderMakesafeCard(card, 'report_ready');
  });

  expect(rendered).toContain('REQUIREMENTS UNKNOWN');
  expect(rendered).toContain('Requirements unknown');
  expect(rendered).not.toContain('Ready to send');
  expect(rendered).toContain('Review job pack');
});

test('ready label with explicitly null document maps stays visibly incomplete but reviewable', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => {
    const card = mapCanonicalMakesafeRow({
      id: 'job-null-document-maps',
      job_number: 'SWMS-NULL-MAPS',
      canonical_stage: 'report_ready',
      substatus: 'admin_to_send_report',
      report: { state: 'submitted', cycle_number: 1 },
      pack: {
        drafted: true,
        state: 'drafted',
        presentation_kind: 'ready',
        report_doc_id: 'report-doc-null-maps',
        required_documents: null,
        closeout_documents: null,
      },
    }, null, { rememberStage: false });
    return renderMakesafeCard(card, 'report_ready');
  });

  expect(rendered).toContain('REQUIREMENTS UNKNOWN');
  expect(rendered).toContain('Requirements unknown');
  expect(rendered).not.toContain('Ready to send');
  expect(rendered).toContain('Review job pack');
});

test('map-less drafted packs remain reviewable without inventing document completeness', async ({ page }) => {
  await page.goto('/ops.html');
  const cards = await page.evaluate(() => {
    function render(id, report, reportDocId) {
      return renderMakesafeCard(mapCanonicalMakesafeRow({
        id,
        job_number: id,
        canonical_stage: 'report_ready',
        substatus: 'admin_to_send_report',
        report,
        pack: {
          drafted: true,
          state: 'drafted',
          report_doc_id: reportDocId,
        },
      }, null, { rememberStage: false }), 'report_ready');
    }
    return {
      proved: render('legacy-proved', { state: 'submitted', cycle_number: 1 }, 'report-doc-legacy'),
      noPointer: render('legacy-no-pointer', { state: 'submitted', cycle_number: 1 }, null),
      noSelectedReport: render('legacy-no-report', { state: 'waiting_on_trade_report', cycle_number: 1 }, 'report-doc-legacy'),
    };
  });

  for (const rendered of Object.values(cards)) {
    expect(rendered).toContain('REQUIREMENTS UNKNOWN');
    expect(rendered).toContain('Requirements unknown');
    expect(rendered).toContain('Review job pack');
    expect(rendered).not.toContain('Ready to send');
  }
});

test('engine-owned assessment and no-charge maps preserve their exceptions', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => {
    function card(id, family, required, closeout, report) {
      return renderMakesafeCard(mapCanonicalMakesafeRow({
        id,
        job_number: id,
        canonical_stage: 'report_ready',
        substatus: 'admin_to_send_report',
        ses_family: family,
        ses_family_label: family,
        site_suburb: 'Perth',
        created_at: new Date().toISOString(),
        report,
        pack: {
          drafted: true,
          state: 'drafted',
          presentation_kind: 'ready',
          report_doc_id: required.report ? 'report-doc-' + id : null,
          invoice_doc_id: required.invoice ? 'invoice-doc-' + id : null,
          swms_doc_id: required.swms ? 'swms-doc-' + id : null,
          required_documents_resolved: true,
          required_documents: required,
          required_documents_unresolved_reason: null,
          closeout_documents: closeout,
        },
      }, null, { rememberStage: false }), 'report_ready');
    }
    return {
      assessment: card(
        'SWMS-ASSESSMENT',
        'assessment_quote',
        { report: false, invoice: true, swms: false },
        { report: false, invoice: true, swms: false },
        { state: 'waiting_on_trade_report', cycle_number: 1 },
      ),
      noCharge: card(
        'SWMS-NO-CHARGE',
        'physical_makesafe',
        { report: true, invoice: false, swms: true },
        { report: true, invoice: false, swms: true },
        { state: 'submitted', cycle_number: 1 },
      ),
    };
  });

  for (const html of Object.values(rendered)) {
    expect(html).toContain('Ready to send');
    expect(html).toContain('Review job pack');
    expect(html).not.toContain('PACK INCOMPLETE');
    expect(html).not.toContain('REQUIREMENTS UNKNOWN');
  }
  expect(rendered.assessment).toContain('Local report: not required for this pack');
  expect(rendered.noCharge).toContain('Invoice: not required for this no-charge pack');
});

test('byte-exact review requirements outrank a stale canonical invoice demand', async ({ page }) => {
  await page.goto('/ops.html');
  const verdict = await page.evaluate(() => _msSesPackCompleteness(
    'job-refreshed-no-charge',
    {
      pack: {
        drafted: true,
        presentation: { kind: 'ready', reason: null },
        report_doc_id: 'report-doc-refreshed',
        swms_doc_id: 'swms-doc-refreshed',
        has_selected_current_cycle_trade_report: true,
        required_documents_resolved: true,
        required_documents: { report: true, invoice: false, swms: true },
        required_documents_unresolved_reason: null,
        closeout_documents: { report: true, invoice: false, swms: true },
      },
    },
    {
      pack_truth: {
        drafted: true,
        presentation_kind: 'ready',
        report_doc_id: 'report-doc-stale',
        invoice_doc_id: 'invoice-doc-stale',
        swms_doc_id: 'swms-doc-stale',
        has_selected_current_cycle_trade_report: true,
        required_documents_resolved: true,
        required_documents: { report: true, invoice: true, swms: true },
        required_documents_unresolved_reason: null,
        closeout_documents: { report: true, invoice: true, swms: true },
      },
    },
  ));

  expect(verdict.complete).toBe(true);
  expect(verdict.required_documents).toEqual({ report: true, invoice: false, swms: true });
  expect(verdict.missing_required).toEqual([]);
});

test('fresh review pack without requirements stays unknown despite a stale canonical map', async ({ page }) => {
  await page.goto('/ops.html');
  const verdict = await page.evaluate(() => _msSesPackCompleteness(
    'job-fresh-map-absent',
    {
      pack: {
        drafted: true,
        presentation: { kind: 'ready', reason: null },
        report_doc_id: 'report-doc-fresh',
        invoice_doc_id: 'invoice-doc-fresh',
        swms_doc_id: 'swms-doc-fresh',
        has_selected_current_cycle_trade_report: true,
        closeout_documents: { report: true, invoice: true, swms: true },
      },
    },
    {
      pack_truth: {
        drafted: true,
        presentation_kind: 'ready',
        report_doc_id: 'report-doc-stale',
        invoice_doc_id: 'invoice-doc-stale',
        swms_doc_id: 'swms-doc-stale',
        has_selected_current_cycle_trade_report: true,
        required_documents_resolved: true,
        required_documents: { report: true, invoice: true, swms: true },
        required_documents_unresolved_reason: null,
        closeout_documents: { report: true, invoice: true, swms: true },
      },
    },
  ));

  expect(verdict.reviewable).toBe(true);
  expect(verdict.complete).toBe(false);
  expect(verdict.requirements_resolved).toBe(false);
  expect(verdict.required_documents).toBeNull();
  expect(verdict.warning_label).toBe('REQUIREMENTS UNKNOWN');
});

test('fresh required pack cannot borrow a missing invoice pointer from canonical cache', async ({ page }) => {
  await page.goto('/ops.html');
  const verdict = await page.evaluate(() => _msSesPackCompleteness(
    'job-fresh-invoice-pointer-absent',
    {
      pack: {
        drafted: true,
        presentation: { kind: 'ready', reason: null },
        report_doc_id: 'report-doc-fresh',
        swms_doc_id: 'swms-doc-fresh',
        has_selected_current_cycle_trade_report: true,
        required_documents_resolved: true,
        required_documents: { report: true, invoice: true, swms: true },
        required_documents_unresolved_reason: null,
        closeout_documents: { report: true, invoice: true, swms: true },
      },
    },
    {
      pack_truth: {
        drafted: true,
        presentation_kind: 'ready',
        report_doc_id: 'report-doc-stale',
        invoice_doc_id: 'invoice-doc-stale',
        swms_doc_id: 'swms-doc-stale',
        has_selected_current_cycle_trade_report: true,
        required_documents_resolved: true,
        required_documents: { report: true, invoice: true, swms: true },
        required_documents_unresolved_reason: null,
        closeout_documents: { report: true, invoice: true, swms: true },
      },
    },
  ));

  expect(verdict.reviewable).toBe(true);
  expect(verdict.complete).toBe(false);
  expect(verdict.missing_required).toContain('invoice');
  expect(verdict.warning_label).toBe('PACK INCOMPLETE');
});

test('every required document needs its producer proof pointer', async ({ page }) => {
  await page.goto('/ops.html');
  const verdicts = await page.evaluate(() => {
    const complete = {
      drafted: true,
      presentation_kind: 'ready',
      report_doc_id: 'report-doc-complete',
      invoice_doc_id: 'invoice-doc-complete',
      swms_doc_id: 'swms-doc-complete',
      has_selected_current_cycle_trade_report: true,
      required_documents_resolved: true,
      required_documents: { report: true, invoice: true, swms: true },
      required_documents_unresolved_reason: null,
      closeout_documents: { report: true, invoice: true, swms: true },
    };
    return Object.fromEntries([
      ['report', 'report_doc_id'],
      ['invoice', 'invoice_doc_id'],
      ['swms', 'swms_doc_id'],
    ].map(([documentKey, pointerKey]) => [
      documentKey,
      makesafePackCompletenessVerdict({ ...complete, [pointerKey]: null }),
    ]));
  });

  for (const [documentKey, verdict] of Object.entries(verdicts)) {
    expect(verdict.complete, documentKey).toBe(false);
    expect(verdict.reviewable, documentKey).toBe(true);
    expect(verdict.missing_required, documentKey).toContain(documentKey);
    expect(verdict.warning_label, documentKey).toBe('PACK INCOMPLETE');
  }
});

test('unresolved engine requirements stay unknown without hiding Captain review', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => renderMakesafeCard(mapCanonicalMakesafeRow({
    id: 'job-unresolved-requirements',
    job_number: 'SWMS-UNKNOWN',
    canonical_stage: 'report_ready',
    substatus: 'admin_to_send_report',
    ses_family: null,
    ses_family_label: null,
    site_suburb: 'Perth',
    created_at: new Date().toISOString(),
    pack: {
      drafted: true,
      state: 'drafted',
      presentation_kind: 'ready',
      required_documents_resolved: false,
      required_documents: null,
      required_documents_unresolved_reason:
        'family_unknown: No sealed family row resolved.',
      closeout_documents: { report: true, invoice: true, swms: false },
    },
  }, null, { rememberStage: false }), 'report_ready'));

  expect(rendered).toContain('REQUIREMENTS UNKNOWN');
  expect(rendered).toContain('Requirements unknown');
  expect(rendered).toContain('family_unknown');
  expect(rendered).toContain('Review job pack');
  expect(rendered).not.toContain('Ready to send');
});

test('whole-card open path sends complete and incomplete drafted packs to Captain review', async ({ page }) => {
  await page.goto('/ops.html');
  const calls = await page.evaluate(async () => {
    const observed = { review: [], detail: [] };
    globalThis.showMsReportingDetail = (jobId) => observed.review.push(jobId);
    globalThis.openMakesafeReviewOverlay = () => {};
    globalThis.openJobDetail = (jobId) => observed.detail.push(jobId);
    globalThis._msReportingCache = {};
    globalThis._msSesReviewQueue = {};

    function mountCard(id, pack) {
      const card = mapCanonicalMakesafeRow({
        id,
        job_number: id,
        canonical_stage: 'report_ready',
        substatus: 'admin_to_send_report',
        ses_family_label: 'MakeSafe',
        site_suburb: 'Perth',
        created_at: new Date().toISOString(),
        report: { state: 'submitted', cycle_number: 1 },
        pack,
      });
      _msSesReviewQueue[id] = { job_id: id, docket_revision_id: 'docket-' + id };
      const host = document.createElement('div');
      host.innerHTML = renderMakesafeCard(card, 'report_ready');
      document.body.appendChild(host);
      return host.querySelector('[data-job-id="' + id + '"]');
    }

    const basePack = {
      drafted: true,
      state: 'drafted',
      presentation_kind: 'ready',
      report_doc_id: 'report-doc-open-path',
      invoice_doc_id: 'invoice-doc-open-path',
      required_documents_resolved: true,
      required_documents: { report: true, invoice: true, swms: false },
      required_documents_unresolved_reason: null,
      closeout_documents: { report: true, invoice: true, swms: false },
    };
    mountCard('job-open-incomplete', {
      ...basePack,
      closeout_documents: { report: false, invoice: true, swms: false },
    }).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    mountCard('job-open-ready', basePack).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return observed;
  });

  expect(calls.detail).toEqual([]);
  expect(calls.review).toEqual(['job-open-incomplete', 'job-open-ready']);
});
