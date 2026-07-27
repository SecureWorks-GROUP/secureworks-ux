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
