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
  // Family-tagged repair: jobs.type still 'makesafe' (has not been re-typed), but
  // job_family says repair — the calendar-feed-job-family contract (backend
  // companion task). Must classify as Repair, not Make Safes, same as the board's
  // isRepairJob. This is the case PR #314 left unhandled (SWMS-261319 et al).
  ev({ job_id: 'j4', assignment_id: 'a4', job_number: 'SWMS-27004', client_name: 'Simon Davey',
       job_type: 'makesafe', job_family: 'repair', scheduled_date: '2026-09-14', scheduled_end: '2026-09-14' }),
  // job_family absent entirely: must behave exactly as today (falls back to job_type).
  ev({ job_id: 'j5', assignment_id: 'a5', job_number: 'SWMS-27005', client_name: 'Dana Diaz',
       job_type: 'makesafe', scheduled_date: '2026-09-14', scheduled_end: '2026-09-14' }),
  // Plain decking event, no job_family: files under Patio for the filter but must
  // keep its own decking glyph/colour (calDivisionOf collapses decking -> patio
  // for the FILTER only, never for the type icon or bar colour).
  ev({ job_id: 'j6', assignment_id: 'a6', job_number: 'SWD-27006', client_name: 'Eli Evans',
       job_type: 'decking', scheduled_date: '2026-09-14', scheduled_end: '2026-09-14' }),
];

// The three-horizontal-line decking glyph painted by calTypeIconSvg('decking');
// the patio glyph is the house outline (M1 9V5L6 1l5 4v4).
const DECKING_GLYPH_PATH = 'M0 2h12M0 5h12M0 8h12';

async function seedAndRender(page, viewMode) {
  await page.evaluate(({ EVENTS, viewMode }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    window._calDate = new Date('2026-09-14T00:00:00');
    window._calRangeMode = '1w';
    window._calViewMode = viewMode || 'schedule'; // division filter hard-drops non-matching jobs here
    window._calEvents = EVENTS;
    window._crewList = [{ id: 'u1', name: 'Hugo', role: 'crew', division: 'patio' }];
    window._calLeaveByDate = {};
    window._calAvailability = {};
    window._calReadiness = {};
    window._calDeliveries = [];
    window.syncCalDivCheckboxes(); // normally run from loadCalendar(); reflects stored _calDivFilters onto the checkboxes
    window.renderCalendar();
  }, { EVENTS, viewMode });
}

function scheduleBarClasses(page) {
  return page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.cal-schedule-bar')].map((bar) => [
      (bar.querySelector('strong') || {}).textContent, [...bar.classList],
    ]))
  );
}

// Crew (swimlane) week view paints one .cal-job-block per assignment with the
// job number in a <strong> and the type icon as the trailing .cal-type-icon svg.
function crewBlockIconPaths(page) {
  return page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.cal-job-block')].map((block) => [
      (block.querySelector('strong') || {}).textContent,
      [...block.querySelectorAll('.cal-type-icon path')].map((p) => p.getAttribute('d')),
    ]))
  );
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
  expect(await visibleJobNumbers(page)).toEqual(expect.arrayContaining(
    ['SWP-27001', 'SWMS-27002', 'SWR-27003', 'SWMS-27004', 'SWMS-27005']));

  // Deselect All, then tick only Repair.
  await clickDiv(page, 'all');
  await clickDiv(page, 'repair');

  const visible = await visibleJobNumbers(page);
  // SWMS-27004 is job_type='makesafe' but job_family='repair' — must match Repair,
  // never Make Safes, per calDivisionOf(). SWMS-27005 (no job_family) stays out.
  expect(visible.sort()).toEqual(['SWMS-27004', 'SWR-27003']);

  const checks = await page.$$eval('[data-caldiv]', (els) =>
    Object.fromEntries(els.map((el) => [el.dataset.caldiv, el.checked])));
  expect(checks).toEqual({ all: false, patio: false, fencing: false, makesafe: false, repair: true });
});

test('the Schedule bar colour agrees with the Divisions bucket for family-tagged repairs', async ({ page }) => {
  // Under All: SWMS-27004 (job_type makesafe, job_family repair) and SWR-27003
  // (job_type repair) both paint with the repair bar class, so a card the filter
  // files under Repair never wears Make Safes/Fencing colours. Everything without
  // a repair family keeps its existing class, decking included.
  const classes = await scheduleBarClasses(page);
  expect(classes['SWMS-27004']).toContain('repair');
  expect(classes['SWMS-27004']).not.toContain('patio');
  expect(classes['SWMS-27004']).not.toContain('fencing');
  expect(classes['SWR-27003']).toContain('repair');
  expect(classes['SWD-27006']).toContain('decking');
  expect(classes['SWD-27006']).not.toContain('repair');
  expect(classes['SWP-27001']).toContain('patio');
  expect(classes['SWMS-27005']).not.toContain('repair');

  const repairBar = page.locator('.cal-schedule-bar.repair:has(strong:text-is("SWMS-27004"))');
  await expect(repairBar).toHaveCSS('border-left-color', 'rgb(13, 148, 136)');
});

test('a plain decking event keeps its decking type icon in the Crew week view', async ({ page }) => {
  // Regression guard: the type icon must be driven by the raw job_type, not the
  // division bucket — collapsing decking into patio there would repaint every
  // decking event with the patio house glyph when job_family is absent.
  await seedAndRender(page, 'crew');
  const icons = await crewBlockIconPaths(page);
  expect(icons['SWD-27006']).toEqual([DECKING_GLYPH_PATH]);
  expect(icons['SWP-27001']).not.toEqual([DECKING_GLYPH_PATH]);
  expect(icons['SWP-27001']).toHaveLength(1);
});

test('ticking only Make Safes hides repair jobs, including family-tagged ones', async ({ page }) => {
  await clickDiv(page, 'all');
  await clickDiv(page, 'makesafe');

  const visible = await visibleJobNumbers(page);
  // SWMS-27004 carries job_type='makesafe' but job_family='repair', so it must NOT
  // show here even though jobs.type still says makesafe. SWMS-27005 has no
  // job_family at all and falls back to job_type='makesafe' exactly as before.
  expect(visible.sort()).toEqual(['SWMS-27002', 'SWMS-27005']);
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
  expect(visible).toEqual(expect.arrayContaining(['SWP-27001', 'SWMS-27002', 'SWMS-27005']));
  expect(visible).not.toContain('SWR-27003');
  expect(visible).not.toContain('SWMS-27004'); // job_family='repair' — stays out of Make Safes
});
