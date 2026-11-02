// R57 line evidence on the job profit detail. Synthetic local capture -> real
// page renderer. No production read, no signed-in staff check, no mutation.
const { test, expect } = require('@playwright/test');
const capture = require('../fixtures/job-profit-order-source.json');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      ? route.continue() : route.abort();
  });
});

function lineEvidence() {
  return {
    job_id: 'job-1', rule: 'r57-v1', status: 'provisional', items: 4, evidenced: 1,
    invoice_lines: 1, invoice_lines_evidenced: 0, cost_items: 2, cost_items_evidenced: 1,
    evidence_says_elsewhere: 1, not_in_job_profit: 1, evidenced_ex: 812.5, not_evidenced_ex: 9450,
    why_not_verified: ['1 customer-invoice line(s) without evidence', '1 cost item(s) without evidence for this job', '1 evidenced line(s) Job Profit does not carry'],
    lines: [
      { kind: 'invoice_line', document: 'INV-1', date: '2026-09-04', description: 'Progress payment', amount_ex: 9000, state: 'no_evidence' },
      { kind: 'supplier_bill', document: 'B-2', date: '2026-09-10', description: 'Steel', amount_ex: 300, state: 'evidence_says_elsewhere', allocation: 'job', evidence_job_number: 'SWF-26174' },
      { kind: 'not_in_job_profit', document: 'B-3', date: '2026-10-06', description: 'Concrete', amount_ex: 150, state: 'not_in_job_profit' },
      { kind: 'trade_line', document: 'SW-INV-1', date: null, description: 'Crew share', amount_ex: 812.5, state: 'evidenced', basis: 'crew_invoice_line' }
    ],
    read_at: '2026-11-02T05:34:43Z'
  };
}
function response(le) {
  const data = JSON.parse(JSON.stringify(capture.response));
  if (le === undefined) delete data.line_evidence; else data.line_evidence = le;
  return data;
}
async function render(page, data) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(data => {
    document.querySelectorAll('.view,.sub-view').forEach(el => el.classList.remove('active'));
    document.getElementById('viewFinancials').classList.add('active');
    document.getElementById('subJobprofit').classList.add('active');
    document.getElementById('jpDetail').innerHTML = _jpRenderDetail(data);
  }, data);
  return page.locator('#jpDetail');
}

test('provisional job names what is missing and shows each line with its evidence', async ({ page }, testInfo) => {
  const panel = await render(page, response(lineEvidence()));
  const note = panel.locator('[data-jp-line-evidence]');
  await expect(note).toHaveAttribute('data-jp-line-evidence', 'provisional');
  await expect(note).toContainText('Provisional');
  await expect(note).not.toContainText('Verified');
  await expect(note).toContainText('Customer invoice lines evidenced: 0 of 1');
  await expect(note).toContainText('cost items evidenced: 1 of 2');
  await expect(panel.locator('[data-jp-why-not-verified] li')).toHaveCount(3);
  const lines = panel.locator('[data-jp-evidence-lines]');
  await expect(lines.locator('summary')).toHaveText('Show 4 lines');
  await lines.locator('summary').click();
  await expect(lines.locator('[data-jp-evidence-state="no_evidence"]')).toContainText('No evidence yet');
  await expect(lines.locator('[data-jp-evidence-state="evidence_says_elsewhere"]')).toContainText('Bookkeeping puts it on job SWF-26174');
  await expect(lines.locator('[data-jp-evidence-state="not_in_job_profit"]')).toContainText('Evidenced to this job, not counted in Job Profit');
  await expect(lines.locator('[data-jp-evidence-state="evidenced"]')).toContainText('crew invoice line');
  await expect(lines.locator('[data-jp-evidence-state="evidenced"] [data-label="Amount"]')).toHaveText('$812.50');
  await page.screenshot({ path: testInfo.outputPath('line-evidence-desktop.png'), fullPage: true });
});

test('verified only when the server says verified', async ({ page }) => {
  const le = lineEvidence();
  le.status = 'verified'; le.why_not_verified = [];
  const panel = await render(page, response(le));
  await expect(panel.locator('[data-jp-line-evidence]')).toHaveAttribute('data-jp-line-evidence', 'verified');
  await expect(panel.locator('[data-jp-line-evidence]')).toContainText('Every invoice and cost line on this job has Bookkeeping');
  await expect(panel.locator('[data-jp-why-not-verified]')).toHaveCount(0);
});

for (const kind of ['absent', 'unknown', 'odd-status', 'no_lines']) {
  test(`${kind} line evidence never reads verified and keeps the figures`, async ({ page }) => {
    const le = kind === 'absent' ? undefined
      : kind === 'unknown' ? { status: 'unknown', reason: 'line evidence read failed: timeout' }
      : kind === 'odd-status' ? { status: 'VERIFIED!', lines: [] }
      : { status: 'no_lines', lines: [] };
    const panel = await render(page, response(le));
    const note = panel.locator('[data-jp-line-evidence]');
    await expect(note).toHaveCount(1);
    await expect(note).not.toHaveAttribute('data-jp-line-evidence', 'verified');
    await expect(note).not.toContainText('Every invoice and cost line');
    if (kind === 'unknown') await expect(note).toContainText('line evidence read failed: timeout');
    await expect(panel.locator('[data-jp-lanes]')).toHaveCount(1);
  });
}

test('evidence text is shown as text, not markup', async ({ page }) => {
  const le = lineEvidence();
  le.lines[0].description = '<img src=x onerror="window.injected=true">';
  le.why_not_verified = ['<script>window.injected=true</script>'];
  le.lines[1].evidence_job_number = '<b>x</b>';
  const panel = await render(page, response(le));
  await panel.locator('[data-jp-evidence-lines] summary').click();
  await expect(panel.locator('[data-jp-evidence-lines]')).toContainText('<img src=x');
  await expect(panel.locator('[data-jp-line-evidence] script, [data-jp-evidence-lines] img, [data-jp-evidence-lines] b')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('expanded evidence lines fit the phone layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await render(page, response(lineEvidence()));
  await panel.locator('[data-jp-evidence-lines] summary').click();
  const size = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth }));
  expect(size.page).toBeLessThanOrEqual(size.width + 1);
  await panel.locator('[data-jp-evidence-lines]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('line-evidence-phone.png') });
});
