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
