const { test, expect } = require('@playwright/test');

// The pipeline API owns schedule selection. Cards must render its next visit,
// falling back to the latest past visit, rather than the historical first date.
async function renderCard(page, job, status) {
  await page.evaluate(({ card, cardStatus }) => {
    var host = document.createElement('div');
    host.id = 'schedule-date-card-host';
    document.body.appendChild(host);
    window._pipelineTab = card.type === 'repair' ? 'repairs' : card.type;
    host.innerHTML = renderKanbanCard(card, cardStatus);
  }, { card: job, cardStatus: status });

  return page.locator('.kanban-card[data-job-id="' + job.id + '"]');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/ops.html');
});

test('scheduled card shows the upcoming visit instead of its earlier historical visit', async ({ page }) => {
  const card = await renderCard(page, {
    id: 'swms-261163',
    type: 'repair',
    status: 'scheduled',
    client_name: 'Repair fixture',
    first_scheduled_date: '2026-08-13',
    last_scheduled_date: '2026-08-13',
    next_scheduled_date: '2026-10-28',
    assignment_count: 4,
    days_in_stage: 0,
  }, 'scheduled');

  await expect(card).toContainText('28/10');
  await expect(card).not.toContainText('13/08');
  await expect(card).toContainText('4 sched');
});

test('in-progress card falls back to its most recent past visit', async ({ page }) => {
  const card = await renderCard(page, {
    id: 'all-past',
    type: 'fencing',
    status: 'in_progress',
    client_name: 'All-past fixture',
    first_scheduled_date: '2026-07-10',
    last_scheduled_date: '2026-09-02',
    next_scheduled_date: null,
    days_in_stage: 1,
  }, 'in_progress');

  await expect(card).toContainText('02/09');
  await expect(card).not.toContainText('10/07');
});

test('card trusts the precomputed real visit over an earlier uppercase observer row', async ({ page }) => {
  const card = await renderCard(page, {
    id: 'swf-26813',
    type: 'patio',
    status: 'scheduled',
    client_name: 'Observer fixture',
    first_scheduled_date: '2026-08-05',
    last_scheduled_date: '2026-08-06',
    next_scheduled_date: '2026-08-31',
    assignments: [
      { scheduled_date: '2026-08-05', role: 'OBSERVER', is_ghost: true },
      { scheduled_date: '2026-08-06', role: 'helper', is_ghost: false },
      { scheduled_date: '2026-08-31', role: 'lead_installer', is_ghost: false },
    ],
    days_in_stage: 2,
  }, 'scheduled');

  await expect(card).toContainText('31/08');
  await expect(card).not.toContainText('05/08');
});

test('card renders no date chip when neither selected schedule field exists', async ({ page }) => {
  const card = await renderCard(page, {
    id: 'no-selected-date',
    type: 'repair',
    status: 'scheduled',
    client_name: 'No selected date fixture',
    first_scheduled_date: '2026-08-05',
    next_scheduled_date: null,
    last_scheduled_date: null,
    days_in_stage: 3,
  }, 'scheduled');

  await expect(card.locator('.kanban-meta-badge')).toHaveCount(0);
  await expect(card).not.toContainText('05/08');
});
