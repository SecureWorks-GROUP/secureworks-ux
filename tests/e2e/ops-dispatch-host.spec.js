const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

async function openStaticOps(page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !local) return route.abort();
    return route.continue();
  });
  await page.goto('/ops.html');
  await page.waitForFunction(() => window.DispatchOps && typeof window.DispatchOps.loadMainCalendar === 'function' && typeof window.renderScheduleView === 'function');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => {
    const identity = { id: 'fixture-operator', org_id: 'fixture-org' };
    window.SW_AUTH_GATE.identity = () => identity;
    window.dispatchEvent(new CustomEvent('sw:auth-identity', { detail: identity }));
  });
  await page.evaluate(() => {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById('viewCalendar').classList.add('active');
  });
}

test('Dispatch host layer controls are visible and keyboard toggles the main material layer', async ({ page }) => {
  await openStaticOps(page);
  await page.evaluate(() => {
    window.opsPost = async () => { throw new Error('unexpected write'); };
    window.opsFetch = async (action) => {
      if (action !== 'dispatch_calendar') throw new Error('unexpected read: ' + action);
      return {
        events: [{ id: 'po:fixture', job_id: 'job-a', job_number: 'SWP-1', title: 'Supplier delivery', date: '2026-09-15', layer: 'materials', status: 'requested' }],
        undated: [],
        coverage: { complete: true },
      };
    };
    return window.DispatchOps.loadMainCalendar({ from: '2026-09-14', to: '2026-09-20' });
  });

  const materials = page.locator('#dispatchCalendarLayers input[data-dispatch-layer="materials"]');
  await expect(materials).toBeVisible();
  await expect(materials).toBeChecked();
  const box = await materials.boundingBox();
  expect(box.width).toBeGreaterThan(8);
  expect(box.height).toBeGreaterThan(8);

  await materials.focus();
  await page.keyboard.press('Space');
  await expect(materials).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.DispatchOps.projectMain([], [], { from: '2026-09-14', to: '2026-09-20' }).deliveries.length)).toBe(0);

  await page.keyboard.press('Space');
  await expect(materials).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.DispatchOps.projectMain([], [], { from: '2026-09-14', to: '2026-09-20' }).deliveries.length)).toBe(1);
});

test('Schedule tracks stay equal with long material text and bounded crew badges', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });
  await openStaticOps(page);
  const metrics = await page.evaluate(() => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    container.style.width = '777px';
    window._calDate = new Date('2026-09-14T00:00:00');
    window._calRangeMode = 'week';
    window._calViewMode = 'schedule';
    window._crewList = [{ id: 'crew-1', name: 'Shaun', role: 'lead_installer', division: 'patio' }];
    window._calReadiness = {};
    window._calAvailability = {};
    window._calLeaveByDate = {};
    window._calDivFilter = 'all';
    window._calDivFilters = ['all'];
    window._calEventFilters = { jobs: true, meetings: true, holidays: false, leave: true, reminders: true };
    window.__SW_CAL_DRAGV2_ENABLED = true;
    window._calEvents = [{
      assignment_type: 'install',
      confirmation_status: 'confirmed',
      job_type: 'patio',
      site_suburb: 'Perth',
      site_address: '1 Test St',
      start_time: null,
      end_time: null,
      user_id: 'crew-1',
      crew_name: 'Shaun',
      assigned_to: null,
      label: null,
      recurrence_group_id: null,
      job_id: 'job-a',
      assignment_id: 'assignment-a',
      job_number: 'SWP-90001',
      client_name: 'Customer With A Very Long Installation Name That Must Not Stretch The Day Column',
      scheduled_date: '2026-09-15',
      scheduled_end: '2026-09-17',
    }];
    window._calDeliveries = [{
      id: 'po-long',
      dispatch_event_id: 'po:po-long',
      job_id: 'job-a',
      job_number: 'SWP-90001',
      supplier_name: 'Extremely Long Supplier Name With Material Description That Would Previously Stretch Schedule Tracks Across The Host',
      delivery_date: '2026-09-16',
      delivery_kind: 'promised',
      status: 'promised',
      dispatch_layer: 'materials',
    }];
    window.renderScheduleView(container, window.getCalRange());

    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    };
    const grid = container.querySelector('.cal-schedule-grid');
    const headers = [...grid.querySelectorAll('.cal-schedule-header')].map(rect);
    const firstWeek = [...grid.querySelectorAll(':scope > .cal-schedule-week')].find(row => row.querySelector('.cal-schedule-cell'));
    const cells = [...firstWeek.querySelectorAll('.cal-schedule-cell')].map(rect);
    const deliveryCell = firstWeek.querySelector('.cal-schedule-cell[data-date="2026-09-16"]');
    const delivery = deliveryCell.querySelector('.cal-delivery-block');
    const bar = grid.querySelector('.cal-schedule-bar[data-assignment-id="assignment-a"]');
    const crew = bar.querySelector('.bar-crew');
    return {
      grid: rect(grid),
      container: rect(container),
      headers,
      cells,
      delivery: rect(delivery),
      deliveryClientWidth: delivery.clientWidth,
      deliveryScrollWidth: delivery.scrollWidth,
      deliveryTitle: delivery.getAttribute('title') || '',
      bar: rect(bar),
      crew: rect(crew),
    };
  });

  const closeWidths = (items) => Math.max(...items.map(item => item.width)) - Math.min(...items.map(item => item.width));
  expect(closeWidths(metrics.headers)).toBeLessThanOrEqual(1);
  expect(closeWidths(metrics.cells)).toBeLessThanOrEqual(1);
  metrics.headers.forEach((header, index) => {
    expect(Math.abs(header.left - metrics.cells[index].left), `header ${index} aligns to day cell`).toBeLessThanOrEqual(1);
    expect(Math.abs(header.right - metrics.cells[index].right), `header ${index} aligns to day cell`).toBeLessThanOrEqual(1);
  });
  expect(metrics.grid.width).toBeLessThanOrEqual(metrics.container.width + 1);

  const tuesdayCell = metrics.cells[1];
  expect(Math.abs(metrics.bar.left - tuesdayCell.left), 'bar starts in Tuesday cell').toBeLessThanOrEqual(2);

  const targetCell = metrics.cells[2];
  expect(metrics.delivery.left).toBeGreaterThanOrEqual(targetCell.left - 1);
  expect(metrics.delivery.right).toBeLessThanOrEqual(targetCell.right + 1);
  expect(metrics.deliveryScrollWidth).toBeGreaterThan(metrics.deliveryClientWidth);
  expect(metrics.deliveryTitle).toBe('SWP-90001 · Extremely Long Supplier Name With Material Description That Would Previously Stretch Schedule Tracks Across The Host · promised delivery · materials · promised');

  expect(metrics.crew.left).toBeGreaterThanOrEqual(metrics.bar.left - 1);
  expect(metrics.crew.right).toBeLessThanOrEqual(metrics.bar.right + 1);
});
