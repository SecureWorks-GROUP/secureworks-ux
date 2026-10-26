// The legacy Deposit column is hidden on the fencing and patio boards (Captain
// 2026-10-26), but a job still holding status `deposit` must not vanish: the
// column comes back beside Awaiting Deposit while it holds one. Patio is offered
// Awaiting Deposit as a next status, as fencing is. Search
// `// <deposit-column-hidden>` in ops.html. Runs the shipped renderers only.
const { test, expect } = require('@playwright/test');

async function openOps(page) {
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderPatioKanban === 'function' && typeof window.getNextStatuses === 'function');
}

function columnsFor(page, tab, columns) {
  return page.evaluate(({ tab, columns }) => {
    _pipelineTab = tab;
    var host = document.createElement('div');
    document.body.appendChild(host);
    if (tab === 'fencing') renderFencingKanban(host, columns); else renderPatioKanban(host, columns);
    var keys = Array.from(host.querySelectorAll('.kanban-col')).map((c) => c.getAttribute('data-status'));
    var drawer = host.textContent;
    host.remove();
    return { keys, drawer };
  }, { tab, columns });
}

const job = (id, status, type) => ({ id, status, type, client_name: 'Test Client', value: 1000, days_in_stage: 1 });

for (const tab of ['fencing', 'patio']) {
  test(`${tab}: no Deposit column when no job holds it; Processing stays`, async ({ page }) => {
    await openOps(page);
    const { keys } = await columnsFor(page, tab, { processing: [job('p1', 'processing', tab)] });
    expect(keys).not.toContain('deposit');
    expect(keys).toContain('processing');
    const stages = await page.evaluate((t) => (t === 'fencing' ? FENCING_STAGES : PATIO_STAGES), tab);
    expect(stages).not.toContain('deposit');
  });

  test(`${tab}: a job still at status deposit keeps a visible column`, async ({ page }) => {
    await openOps(page);
    const { keys } = await columnsFor(page, tab, { deposit: [job('d1', 'deposit', tab)] });
    expect(keys).toContain('deposit');
    const draggable = await page.evaluate((t) => { _pipelineTab = t; return kanbanDragAllowed('deposit', 'awaiting_deposit') && !kanbanDragAllowed('awaiting_deposit', 'deposit'); }, tab);
    expect(draggable).toBe(true);
  });
}

test('patio offers Awaiting Deposit as a next status, like fencing', async ({ page }) => {
  await openOps(page);
  const next = await page.evaluate(() => ({
    patioAccepted: getNextStatuses('accepted', 'patio'),
    patioAwaiting: getNextStatuses('awaiting_deposit', 'patio'),
    fencingAccepted: getNextStatuses('accepted', 'fencing'),
  }));
  expect(next.patioAccepted).toEqual(['awaiting_deposit', 'approvals', 'processing']);
  expect(next.patioAwaiting).toEqual(['approvals', 'processing']);
  expect(next.fencingAccepted).toEqual(['awaiting_deposit']);
});
