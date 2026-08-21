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

test('report-ready placement never renders send controls for an incomplete pack', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => renderMakesafeCard({
    id: 'job-missing-report-bind',
    job_number: 'SWMS-26980',
    board_stage: 'report_ready',
    makesafe_stage: 'report_ready',
    substatus: 'admin_to_send_report',
    makesafe_job_family_label: 'Roof Report',
    site_suburb: 'Gwelup',
    created_at: new Date().toISOString(),
    pack: {
      presentation_kind: 'incomplete',
      presentation_reason:
        'The pack has no bound report_doc_id — <script>bad()</script>.',
      required_documents: { report: true, invoice: true, swms: false },
      closeout_documents: { report: false, invoice: true, swms: false },
    },
  }, 'report_ready'));

  expect(rendered).toContain('Pack incomplete');
  expect(rendered).toContain('Report: required pack pointer is missing or unresolved');
  expect(rendered).not.toContain('Ready to send');
  expect(rendered).not.toContain('Review job pack');
  expect(rendered).not.toContain('<script>bad()</script>');
});

test('resolved ready presentation still renders the review control', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate(() => renderMakesafeCard({
    id: 'job-ready-pack',
    job_number: 'SWMS-READY',
    board_stage: 'report_ready',
    makesafe_stage: 'report_ready',
    substatus: 'admin_to_send_report',
    makesafe_job_family_label: 'MakeSafe',
    site_suburb: 'Perth',
    created_at: new Date().toISOString(),
    pack: {
      presentation_kind: 'ready',
      required_documents: { report: true, invoice: true, swms: true },
      closeout_documents: { report: true, invoice: true, swms: true },
    },
  }, 'report_ready'));

  expect(rendered).toContain('Ready to send');
  expect(rendered).toContain('Review job pack');
  expect(rendered).not.toContain('Pack incomplete');
});
