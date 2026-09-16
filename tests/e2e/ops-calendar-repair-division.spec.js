// Ops Dash calendar sidebar "Divisions" filter: Repair is its own division,
// separate from Make Safe (Captain ruling 2026-09-16). Repair jobs mint as
// job_type='repair' (SWR- numbers, backend PR #771/#774) and must be
// independently toggleable — not folded under the Make Safes checkbox and
// not shown for every other division while hidden under "All".
//
// This is a static-fixture spec: it stubs window._calEvents directly (no
// network) with one patio, one makesafe and one repair event, then drives
// the real sidebar checkbox via a click so toggleCalDivision()'s real
// production code path (not a re-implementation of it) decides what renders.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

function ev(o) {
  return Object.assign({
    assignment_type: 'install',
    confirmation_status: 'tentative',
    site_suburb: 'Perth',
    site_address: '1 Test St',
    start_time: null, end_time: null,
    user_id: null, crew_name: 'Hugo', assigned_to: null,
    label: null, recurrence_group_id: null,
  }, o);
}

const EVENTS = [
  ev({ job_id: 'j1', assignment_id: 'a1', job_number: 'SWP-27001', client_name: 'Alice Adams',
       job_type: 'patio', scheduled_date: '2026-09-14', scheduled_end: '2026-09-14' }),
  ev({ job_id: 'j2', assignment_id: 'a2', job_number: 'SWMS-27002', client_name: 'Bob Baker',
       job_type: 'makesafe', scheduled_date: '2026-09-14', scheduled_end: '2026-09-14' }),
  ev({ job_id: 'j3', assignment_id: 'a3', job_number: 'SWR-27003', client_name: 'Cara Chen',
       job_type: 'repair', scheduled_date: '2026-09-14', scheduled_end: '2026-09-14' }),
];

async function seedAndRender(page) {
  await page.evaluate((EVENTS) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    window._calDate = new Date('2026-09-14T00:00:00');
    window._calRangeMode = '1w';
    window._calViewMode = 'schedule'; // division filter hard-drops non-matching jobs here
    window._calEvents = EVENTS;
    window._crewList = [{ id: 'u1', name: 'Hugo', role: 'crew', division: 'patio' }];
    window._calLeaveByDate = {};
    window._calAvailability = {};
    window._calReadiness = {};
    window._calDeliveries = [];
    window.syncCalDivCheckboxes(); // normally run from loadCalendar(); reflects stored _calDivFilters onto the checkboxes
    window.renderCalendar();
  }, EVENTS);
}

function visibleJobNumbers(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.cal-schedule-bar strong')].map((el) => el.textContent.trim())
  );
}

// The checkboxes are visually hidden (a dot span carries the visible state),
// so drive them through the wrapping label rather than requiring visibility.
function clickDiv(page, div) {
  return page.locator('.cal-sidebar-item:has([data-caldiv="' + div + '"])').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.toggleCalDivision === 'function');
  await revealOpsStaticFixture(page);
  await seedAndRender(page);
});

test('sidebar offers a Repair division distinct from Make Safes', async ({ page }) => {
  const divs = await page.$$eval('[data-caldiv]', (els) => els.map((el) => el.dataset.caldiv));
  expect(divs).toEqual(['all', 'patio', 'fencing', 'makesafe', 'repair']);
});

test('ticking only Repair shows the repair job and hides patio/makesafe', async ({ page }) => {
  // Baseline: All shows every division together.
  expect(await visibleJobNumbers(page)).toEqual(expect.arrayContaining(['SWP-27001', 'SWMS-27002', 'SWR-27003']));

  // Deselect All, then tick only Repair.
  await clickDiv(page, 'all');
  await clickDiv(page, 'repair');

  const visible = await visibleJobNumbers(page);
  expect(visible).toEqual(['SWR-27003']);

  const checks = await page.$$eval('[data-caldiv]', (els) =>
    Object.fromEntries(els.map((el) => [el.dataset.caldiv, el.checked])));
  expect(checks).toEqual({ all: false, patio: false, fencing: false, makesafe: false, repair: true });
});

test('ticking only Make Safes hides repair jobs', async ({ page }) => {
  await clickDiv(page, 'all');
  await clickDiv(page, 'makesafe');

  const visible = await visibleJobNumbers(page);
  expect(visible).toEqual(['SWMS-27002']);
});

test('ticking every individual division collapses to All', async ({ page }) => {
  await clickDiv(page, 'all'); // clear
  await clickDiv(page, 'patio');
  await clickDiv(page, 'fencing');
  await clickDiv(page, 'makesafe');
  await clickDiv(page, 'repair');

  const checks = await page.$$eval('[data-caldiv]', (els) =>
    Object.fromEntries(els.map((el) => [el.dataset.caldiv, el.checked])));
  expect(checks).toEqual({ all: true, patio: true, fencing: true, makesafe: true, repair: true });

  expect(await visibleJobNumbers(page)).toEqual(
    expect.arrayContaining(['SWP-27001', 'SWMS-27002', 'SWR-27003']));
});

test('unticking every division falls back to All rather than showing nothing', async ({ page }) => {
  await clickDiv(page, 'all');
  await clickDiv(page, 'repair');
  await clickDiv(page, 'repair'); // untick the last one selected

  const checks = await page.$$eval('[data-caldiv]', (els) =>
    Object.fromEntries(els.map((el) => [el.dataset.caldiv, el.checked])));
  expect(checks.all).toBe(true);
  expect(await visibleJobNumbers(page)).toEqual(
    expect.arrayContaining(['SWP-27001', 'SWMS-27002', 'SWR-27003']));
});

test('an old three-division stored selection loads sanely with Repair simply unticked', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('sw_cal_divs', JSON.stringify(['patio', 'fencing', 'makesafe']));
  });
  await page.reload();
  await page.waitForFunction(() => typeof window.toggleCalDivision === 'function');
  await revealOpsStaticFixture(page);
  await seedAndRender(page);

  const checks = await page.$$eval('[data-caldiv]', (els) =>
    Object.fromEntries(els.map((el) => [el.dataset.caldiv, el.checked])));
  expect(checks).toEqual({ all: false, patio: true, fencing: true, makesafe: true, repair: false });

  const visible = await visibleJobNumbers(page);
  expect(visible).toEqual(expect.arrayContaining(['SWP-27001', 'SWMS-27002']));
  expect(visible).not.toContain('SWR-27003');
});
