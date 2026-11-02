// NEW synthetic local API capture -> real page renderer. No production read,
// signed-in staff acceptance, or financial mutation. All remote requests abort.
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

function response() { return JSON.parse(JSON.stringify(capture.response)); }
async function render(page, data) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(data => {
    // Real page layout, not a copied renderer. Auth gate removal is fixture-only.
    document.querySelectorAll('.view,.sub-view').forEach(el => el.classList.remove('active'));
    document.getElementById('viewFinancials').classList.add('active');
    document.getElementById('subJobprofit').classList.add('active');
    document.getElementById('jpDetail').innerHTML = _jpRenderDetail(data);
  }, data);
  return page.locator('#jpDetail');
}

test('captured bill -> PO -> frozen items are readable without claiming line allocation or cost-close', async ({ page }, testInfo) => {
  const data = response(), panel = await render(page, data);
  const evidence = panel.locator('[data-jp-order-evidence="recorded"]');
  await expect(evidence).toHaveCount(1);
  await expect(evidence).toContainText(data.material_order_sources.links[0].po_number);
  await expect(evidence).toContainText('Invoice amounts by scope line: Unknown');
  await expect(evidence.locator('details')).not.toHaveAttribute('open', '');
  await evidence.locator('summary').click();
  await expect(evidence.locator('details')).toHaveAttribute('open', '');
  for (const line of data.material_order_sources.links[0].scope_lines) {
    await expect(evidence).toContainText(line.scope_line_id);
    await expect(evidence).toContainText(line.scope_revision_id);
  }
  await expect(evidence).toContainText('earlier revision, retained on this order');
  await expect(evidence).toContainText('does not show how the bill total is divided');
  const row = evidence.locator('xpath=ancestor::tr[1]');
  await expect(row.locator('[data-label="Amount"]')).toHaveText('$4,150.50');
  expect(data.job.actual_materials_ex).toBe(capture.provenance.independent_fixture_materials_ex);
  expect(data.job.profit_ex).toBeNull();
  await evidence.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('source-desktop.png') });
});

for (const kind of ['old-server', 'read-error', 'missing-order', 'wrong-bill', 'duplicate-link', 'bad-manifest']) {
  test(`${kind} shows Unknown evidence while the recorded cost stays visible`, async ({ page }) => {
    const data = response();
    if (kind === 'old-server') delete data.material_order_sources;
    if (kind === 'read-error') data.material_order_sources = { status: 'unknown', reason: 'orders_unreadable', links: [] };
    if (kind === 'missing-order') data.material_order_sources.links[0] = { ...data.material_order_sources.links[0], status: 'unknown', reason: 'order_link_not_recorded', scope_lines: null };
    if (kind === 'wrong-bill') data.material_order_sources.links[0].invoice_id = 'another-bill';
    if (kind === 'duplicate-link') data.material_order_sources.links.push(data.material_order_sources.links[0]);
    if (kind === 'bad-manifest') data.material_order_sources.links[0].scope_lines[0].scope_hash = null;
    const panel = await render(page, data), evidence = panel.locator('[data-jp-order-evidence]');
    await expect(evidence).toHaveAttribute('data-jp-order-evidence', 'unknown');
    await expect(evidence).toContainText('Order evidence unknown');
    await expect(evidence.locator('details')).toHaveCount(0);
    await expect(evidence.locator('xpath=ancestor::tr[1]').locator('[data-label="Amount"]')).toHaveText('$4,150.50');
  });
}

test('source labels and IDs are text, not executable markup', async ({ page }) => {
  const data = response();
  data.material_order_sources.links[0].po_number = '<img src=x onerror="window.injected=true">';
  data.material_order_sources.links[0].scope_lines[0].scope_line_id = '<script>window.injected=true</script>';
  const panel = await render(page, data), evidence = panel.locator('[data-jp-order-evidence]');
  await evidence.locator('summary').click();
  await expect(evidence).toContainText('<img src=x');
  await expect(evidence.locator('img,script')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('expanded frozen evidence fits the existing phone layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await render(page, response());
  await panel.locator('[data-jp-order-evidence] summary').click();
  const size = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth }));
  expect(size.page).toBeLessThanOrEqual(size.width + 1);
  const evidenceWidth = await panel.locator('[data-jp-order-evidence]').evaluate(el => el.getBoundingClientRect().width);
  expect(evidenceWidth).toBeGreaterThan(300);
  await expect(panel.locator('[data-jp-order-evidence]')).toBeVisible();
  await panel.locator('[data-jp-order-evidence]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('source-phone.png') });
});
