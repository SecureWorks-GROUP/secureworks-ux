// Ops Dash calendar v3: the signed-off month design for the job-based
// (Schedule) view. On by default (window.__SW_CAL_V3_ENABLED); kill switch
// ?calv3=0 or localStorage.sw_cal_v3 = '0'.
//
// What this guards:
//  - the line format: type square, client, job number, staff circles, lock
//  - two states only: placeholder and client locked in
//  - business lines (meetings, company days) drawn like job lines, in purple,
//    always above the jobs, and stretched across the days they cover
//  - the Show / Type focus row, and that "Insurance" is a view filter over
//    make safes AND repairs without touching the stored divisions
//  - deliveries in the day, with an honest empty state
//  - the kill switch giving the old calendar back, and the first-open landing
//
// Static-fixture spec, same pattern as ops-calendar-repair-division.spec.js:
// it seeds window._calEvents (no network) and lets the real renderCalendar()
// draw. Every name here is made up. Dates are pinned through window._calDate,
// so nothing in this file compares against "today" and it cannot date-rot.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

function ev(o) {
  return Object.assign({
    assignment_type: 'install',
    confirmation_status: 'tentative',
    site_suburb: 'Testville',
    site_address: '1 Test St, Testville',
    start_time: null, end_time: null,
    user_id: null, crew_name: null, assigned_to: null,
    label: null, recurrence_group_id: null,
  }, o);
}

// Week of Mon 3 Aug 2026.
const EVENTS = [
  // patio, two named crew over two days, placeholder
  ev({ job_id: 'j1', assignment_id: 'a1', job_number: 'SWP-27001', client_name: 'Alice Adams', job_type: 'patio',
       scheduled_date: '2026-08-03', scheduled_end: '2026-08-04', user_id: 'u1', crew_name: 'Rex Lawson' }),
  ev({ job_id: 'j1', assignment_id: 'a1b', job_number: 'SWP-27001', client_name: 'Alice Adams', job_type: 'patio',
       scheduled_date: '2026-08-03', scheduled_end: '2026-08-04', user_id: 'u2', crew_name: 'Sam' }),
  // fencing, client confirmed = locked in
  ev({ job_id: 'j2', assignment_id: 'a2', job_number: 'SWF-27002', client_name: 'Bob Baker', job_type: 'fencing',
       confirmation_status: 'confirmed', scheduled_date: '2026-08-04', scheduled_end: '2026-08-04', user_id: 'u3', crew_name: 'Ivy' }),
  // make safe
  ev({ job_id: 'j3', assignment_id: 'a3', job_number: 'SWMS-27003', client_name: 'Cara Chen', job_type: 'makesafe',
       scheduled_date: '2026-08-05', scheduled_end: '2026-08-05', user_id: 'u1', crew_name: 'Rex Lawson' }),
  // repair by family, jobs.type still makesafe
  ev({ job_id: 'j4', assignment_id: 'a4', job_number: 'SWMS-27004', client_name: 'Dana Diaz', job_type: 'makesafe', job_family: 'repair',
       scheduled_date: '2026-08-05', scheduled_end: '2026-08-05', user_id: 'u1', crew_name: 'Rex Lawson' }),
  // nobody named on it
  ev({ job_id: 'j5', assignment_id: 'a5', job_number: 'SWP-27005', client_name: 'Eli Evans', job_type: 'patio',
       scheduled_date: '2026-08-06', scheduled_end: '2026-08-06' }),
  // two meetings on the Monday, with people
  ev({ job_id: null, assignment_id: 'm1', assignment_type: 'meeting', label: 'Toolbox talk', start_time: '06:45:00',
       scheduled_date: '2026-08-03', scheduled_end: '2026-08-03', user_id: 'u1', crew_name: 'Rex Lawson' }),
  ev({ job_id: null, assignment_id: 'm2', assignment_type: 'meeting', label: 'Weekly ops meeting', start_time: '13:00:00',
       scheduled_date: '2026-08-03', scheduled_end: '2026-08-03', user_id: 'u3', crew_name: 'Ivy' }),
];
const ORG_EVENTS = [{ event_date: '2026-08-06', event_end: '2026-08-07', title: 'Team Conference' }];
const DELIVERIES = [
  { id: 'po-1', po_number: 'PO-9001', supplier_name: 'Example Steel Co', delivery_date: '2026-08-03', confirmed_delivery_date: null, job_id: 'j1', status: 'submitted' },
  { id: 'po-2', po_number: 'PO-9002', supplier_name: 'Example Fence Supplies', delivery_date: '2026-08-04', confirmed_delivery_date: '2026-08-04', job_id: 'j2', status: 'authorised' },
];
const CREW = [
  { id: 'u1', name: 'Rex Lawson', fullName: '', role: 'crew', division: '' },
  { id: 'u2', name: 'Sam', fullName: 'Sam Example Rivers', role: 'crew', division: '' },
  { id: 'u3', name: 'Ivy', fullName: '', role: 'crew', division: '' },
];

async function seedAndRender(page, opts = {}) {
  await page.evaluate(({ EVENTS, ORG_EVENTS, DELIVERIES, CREW, opts }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    document.getElementById('viewCalendar').classList.add('active');
    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = opts.range || '1w';
    window._calViewMode = 'schedule';
    window._calEvents = opts.events || EVENTS;
    window._calOrgEvents = opts.noOrg ? [] : ORG_EVENTS;
    window._calDeliveries = opts.noDeliveries ? [] : DELIVERIES;
    window._crewList = CREW;
    window._calLeaveByDate = { '2026-08-05': ['Ivy'] };
    window._calAvailability = {};
    window._calReadiness = { j1: { status: 'ready', score: 100, blockers: [], warnings: [], completeness: [] } };
    window._calFocus = { show: 'everything', type: 'all' };
    window.applyCalFocus();
    window.renderCalendar();
  }, { EVENTS, ORG_EVENTS, DELIVERIES, CREW, opts });
}

// One read of everything the assertions need, so each test stays a list of expects.
function snapshot(page) {
  return page.evaluate(() => {
    const cal = document.getElementById('calendarBody');
    const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
    const bars = [...cal.querySelectorAll('.cal-schedule-bar')].map((b) => ({
      job: b.getAttribute('data-job-id') || '',
      biz: b.classList.contains('v3-biz'),
      org: b.hasAttribute('data-org-event'),
      classes: [...b.classList],
      label: (b.querySelector('.bar-label') || {}).textContent || '',
      num: (b.querySelector('.v3-num') || {}).textContent || '',
      time: (b.querySelector('.v3-time') || {}).textContent || '',
      strong: (b.querySelector('strong') || {}).textContent || '',
      square: !!b.querySelector('.cal-v3-sq svg'),
      icon: (b.querySelector('.cal-v3-sq svg') || {}).innerHTML || '',
      crew: [...b.querySelectorAll('.crew-initial')].map((c) => c.textContent),
      noCrew: !!b.querySelector('.v3-nocrew'),
      lock: !!b.querySelector('.bar-lock'),
      bg: getComputedStyle(b).backgroundColor,
      draggable: b.getAttribute('draggable'),
      dragstart: b.getAttribute('ondragstart') || '',
      inlineWidth: (b.getAttribute('style').match(/width:\s*([^;]*)/) || [])[1] || '',
      r: rect(b),
    }));
    const cells = [...cal.querySelectorAll('.cal-schedule-cell')].map((c) => ({
      date: c.getAttribute('data-date'), drop: c.getAttribute('ondrop') || '', w: rect(c).w, r: rect(c),
      leave: (c.querySelector('.cal-schedule-leave-badge') || {}).textContent || '',
      holidayBadge: !!c.querySelector('.cal-schedule-holiday-badge'),
      dels: [...c.querySelectorAll('.cal-v3-del')].map((d) => ({ id: d.getAttribute('data-po-id'), l1: (d.querySelector('.v3-d1') || {}).textContent || '', l2: (d.querySelector('.v3-d2') || {}).textContent || '', truck: !!d.querySelector('.v3-truck svg'), unit: [...d.classList].find((k) => k.indexOf('v3u-') === 0) || '', bottom: rect(d).bottom })),
    }));
    const view = document.getElementById('viewCalendar');
    return {
      v3: view.classList.contains('cal-v3'), flag: window.__SW_CAL_V3_ENABLED,
      sidebar: getComputedStyle(document.querySelector('.cal-sidebar')).display,
      focus: [...document.querySelectorAll('#calFocus .cal-focus-btn')].map((b) => ({ text: b.textContent.trim(), on: b.classList.contains('on') })),
      empty: (document.getElementById('calV3Empty') || {}).textContent || '',
      grid: (cal.querySelector('.cal-schedule-grid') || { className: '' }).className,
      bars, cells,
      divs: window._calDivFilters, storedDivs: localStorage.getItem('sw_cal_divs'), storedEvt: localStorage.getItem('sw_cal_evt_filters'),
    };
  });
}
const jobBars = (s) => s.bars.filter((b) => !b.biz);
const bizBars = (s) => s.bars.filter((b) => b.biz);
const bar = (s, job) => s.bars.find((b) => b.job === job);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function' && typeof window.setCalFocus === 'function');
  await revealOpsStaticFixture(page);
  await seedAndRender(page);
});

test('v3 is on by default: new chrome, sidebar hidden, focus row drawn', async ({ page }) => {
  const s = await snapshot(page);
  expect(s.flag).toBe(true);
  expect(s.v3).toBe(true);
  expect(s.sidebar).toBe('none');
  expect(s.grid).toContain('v3');
  expect(s.focus.map((f) => f.text)).toEqual(['Everything', 'Labour', 'Materials', 'Business', 'All', 'Patios', 'Fencing', 'Insurance']);
  expect(s.focus.filter((f) => f.on).map((f) => f.text)).toEqual(['Everything', 'All']);
});

test('a job line carries type square, client, job number, staff circles and the lock', async ({ page }) => {
  const s = await snapshot(page);
  const alice = bar(s, 'j1');
  expect(alice.square).toBe(true);
  expect(alice.label).toBe('Alice Adams');
  expect(alice.num).toBe('SWP-27001');
  // first + last initial; the surname comes from the full name when there is one
  expect(alice.crew.sort()).toEqual(['RL', 'SR']);
  expect(alice.lock).toBe(false);
  expect(alice.classes).toContain('v3s-placeholder');

  const bob = bar(s, 'j2');
  expect(bob.classes).toContain('v3s-locked');
  expect(bob.lock).toBe(true);
  // no surname on record anywhere: first two letters of the first name
  expect(bob.crew).toEqual(['IV']);

  const eli = bar(s, 'j5');
  expect(eli.noCrew).toBe(true);
  expect(eli.crew).toEqual([]);
});

test('two states only, and three colours with insurance covering make safes and repairs', async ({ page }) => {
  const s = await snapshot(page);
  const unit = (b) => b.classes.find((k) => k.indexOf('v3u-') === 0);
  expect(unit(bar(s, 'j1'))).toBe('v3u-patio');
  expect(unit(bar(s, 'j2'))).toBe('v3u-fencing');
  expect(unit(bar(s, 'j3'))).toBe('v3u-insurance');
  expect(unit(bar(s, 'j4'))).toBe('v3u-insurance');
  // same colour, different symbol: warning triangle for a make safe, hammer for a repair
  expect(bar(s, 'j3').icon).not.toBe(bar(s, 'j4').icon);
  expect(bar(s, 'j3').bg).toBe(bar(s, 'j4').bg);
  // every job line is exactly one of the two states
  for (const b of jobBars(s)) {
    expect(b.classes.filter((k) => k === 'v3s-locked' || k === 'v3s-placeholder')).toHaveLength(1);
  }
  // the locked line is a stronger fill than a placeholder of the same colour would be
  const patioBgs = new Set(jobBars(s).filter((b) => unit(b) === 'v3u-patio').map((b) => b.bg));
  expect(patioBgs.size).toBe(1);
  expect(bar(s, 'j2').bg).not.toBe(bar(s, 'j1').bg);
});

test('business lines are drawn like job lines, sit above every job, and stretch over their days', async ({ page }) => {
  const s = await snapshot(page);
  const biz = bizBars(s);
  expect(biz.map((b) => b.label).sort()).toEqual(['Team Conference', 'Toolbox talk', 'Weekly ops meeting']);
  for (const b of biz) {
    expect(b.square).toBe(true);
    expect(b.r.h).toBe(jobBars(s)[0].r.h);
    expect(b.bg).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(biz.find((b) => b.label === 'Toolbox talk').time).toBe('6:45am');
  expect(biz.find((b) => b.label === 'Weekly ops meeting').time).toBe('1pm');
  // always on top: no job line starts above the lowest business line of the week
  const lowestBiz = Math.max(...biz.map((b) => b.r.bottom));
  for (const j of jobBars(s)) expect(j.r.y).toBeGreaterThanOrEqual(lowestBiz - 1);
  // the two-day company day is one line across both days, not a corner badge per day
  const conf = biz.find((b) => b.label === 'Team Conference');
  const thu = s.cells.find((c) => c.date === '2026-08-06'), fri = s.cells.find((c) => c.date === '2026-08-07');
  expect(conf.org).toBe(true);
  expect(Math.abs(conf.r.w - (thu.w + fri.w))).toBeLessThan(2);
  expect(s.cells.some((c) => c.holidayBadge)).toBe(false);
});

test('Show focuses on labour, business or materials, and Everything brings it back', async ({ page }) => {
  await page.evaluate(() => window.setCalFocus('show', 'labour'));
  let s = await snapshot(page);
  expect(jobBars(s)).toHaveLength(5);
  expect(bizBars(s)).toHaveLength(0);
  expect(s.cells.flatMap((c) => c.dels)).toHaveLength(0);
  expect(s.cells.some((c) => c.leave)).toBe(false);

  await page.evaluate(() => window.setCalFocus('show', 'business'));
  s = await snapshot(page);
  expect(jobBars(s)).toHaveLength(0);
  expect(bizBars(s)).toHaveLength(3);
  // leave stays visible with business (nothing today's page shows is removed)
  expect(s.cells.find((c) => c.date === '2026-08-05').leave).toContain('Ivy');

  await page.evaluate(() => window.setCalFocus('show', 'materials'));
  s = await snapshot(page);
  expect(s.bars).toHaveLength(0);
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id).sort()).toEqual(['po-1', 'po-2']);
  expect(s.empty).toBe('');

  await page.locator('#calFocus [data-focus-show="everything"]').click();
  s = await snapshot(page);
  expect(jobBars(s)).toHaveLength(5);
  expect(bizBars(s)).toHaveLength(3);
  expect(s.cells.flatMap((c) => c.dels)).toHaveLength(2);
  expect(s.focus.filter((f) => f.on).map((f) => f.text)).toEqual(['Everything', 'All']);
});

test('Materials with nothing booked says so instead of showing an empty grid', async ({ page }) => {
  await seedAndRender(page, { noDeliveries: true });
  await page.evaluate(() => window.setCalFocus('show', 'materials'));
  const s = await snapshot(page);
  expect(s.empty).toBe('No deliveries booked');
  expect(s.bars).toHaveLength(0);
});

test('Type filters by colour group, and Insurance is a view over make safes and repairs only', async ({ page }) => {
  await page.locator('#calFocus [data-focus-type="patio"]').click();
  let s = await snapshot(page);
  expect(jobBars(s).map((b) => b.job).sort()).toEqual(['j1', 'j5']);
  expect(bizBars(s)).toHaveLength(3);                       // business is not a type
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id)).toEqual(['po-1']);

  await page.locator('#calFocus [data-focus-type="fencing"]').click();
  s = await snapshot(page);
  expect(jobBars(s).map((b) => b.job)).toEqual(['j2']);
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id)).toEqual(['po-2']);

  await page.locator('#calFocus [data-focus-type="insurance"]').click();
  s = await snapshot(page);
  expect(jobBars(s).map((b) => b.job).sort()).toEqual(['j3', 'j4']);
  // a view filter: the divisions underneath are still two separate ones
  expect(s.divs).toEqual(['makesafe', 'repair']);
  // and the sidebar's own stored choices were never written by the focus row
  expect(s.storedDivs).toBeNull();
  expect(s.storedEvt).toBeNull();

  await page.locator('#calFocus [data-focus-type="all"]').click();
  s = await snapshot(page);
  expect(jobBars(s)).toHaveLength(5);
  expect(s.divs).toEqual(['all']);
});

test('a delivery shows truck, supplier, job number and address at the foot of its day', async ({ page }) => {
  const s = await snapshot(page);
  const mon = s.cells.find((c) => c.date === '2026-08-03');
  expect(mon.dels).toHaveLength(1);
  expect(mon.dels[0].truck).toBe(true);
  expect(mon.dels[0].l1).toBe('Example Steel Co SWP-27001');
  expect(mon.dels[0].l2).toBe('1 Test St, Testville');
  expect(mon.dels[0].unit).toBe('v3u-patio');
  // at the foot of the day, under every line drawn in it
  const lowestLine = Math.max(...s.bars.filter((b) => b.r.x < mon.r.right - 2 && b.r.right > mon.r.x + 2).map((b) => b.r.bottom));
  expect(mon.dels[0].bottom).toBeLessThanOrEqual(mon.r.bottom + 1);
  expect(mon.dels[0].bottom).toBeGreaterThan(lowestLine);
});

test('drag wiring is untouched: job lines stay draggable and days stay drop targets', async ({ page }) => {
  const s = await snapshot(page);
  const alice = bar(s, 'j1');
  expect(alice.draggable).toBe('true');
  expect(alice.dragstart).toContain('handleSchedBarDragStart');
  // the bar box is plain percentages, as the overlap and resize guards expect
  expect(alice.inlineWidth).toMatch(/^[\d.]+%$/);
  // a client-locked line refuses the drag, as before
  expect(bar(s, 'j2').dragstart).toContain('Confirmed');
  for (const c of s.cells) expect(c.drop).toContain('handleSchedDrop');
});

test('weekend columns are narrow until something is booked on a weekend', async ({ page }) => {
  let s = await snapshot(page);
  const mon = s.cells.find((c) => c.date === '2026-08-03'), sat = s.cells.find((c) => c.date === '2026-08-08');
  expect(sat.w).toBeLessThan(mon.w * 0.4);

  const withSaturday = EVENTS.concat([ev({ job_id: 'j9', assignment_id: 'a9', job_number: 'SWP-27009', client_name: 'Gia Gray', job_type: 'patio',
    scheduled_date: '2026-08-08', scheduled_end: '2026-08-08', crew_name: 'Sam', user_id: 'u2' })]);
  await seedAndRender(page, { events: withSaturday });
  s = await snapshot(page);
  const mon2 = s.cells.find((c) => c.date === '2026-08-03'), sat2 = s.cells.find((c) => c.date === '2026-08-08');
  expect(Math.abs(sat2.w - mon2.w)).toBeLessThan(2);
  // and the Saturday line sits inside the Saturday column
  const gia = bar(s, 'j9');
  expect(gia.r.x).toBeGreaterThanOrEqual(sat2.r.x - 1);
  expect(gia.r.right).toBeLessThanOrEqual(sat2.r.right + 1);
});

test.describe('the switch', () => {
  test('sw_cal_v3 = 0 gives the old calendar back: sidebar, old line format, no focus row', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('sw_cal_v3', '0'); } catch (e) {} });
    await page.goto('/ops.html');
    await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
    await revealOpsStaticFixture(page);
    await seedAndRender(page);
    const s = await snapshot(page);
    expect(s.flag).toBe(false);
    expect(s.v3).toBe(false);
    expect(s.sidebar).not.toBe('none');
    expect(s.focus).toHaveLength(0);
    expect(s.grid).not.toContain('v3');
    const alice = bar(s, 'j1');
    expect(alice.strong).toBe('SWP-27001');        // old format: number in bold before the name
    expect(alice.square).toBe(false);
    expect(alice.crew.sort()).toEqual(['R', 'S']);  // old format: one letter
    expect(alice.classes.some((k) => k.indexOf('v3') === 0)).toBe(false);
    // company days are back to the corner badge
    expect(s.cells.filter((c) => c.holidayBadge).map((c) => c.date)).toEqual(['2026-08-06', '2026-08-07']);
    expect(s.cells.flatMap((c) => c.dels)).toHaveLength(0);
  });

  test('first open lands on the job-based Month once, then the stored view is the operator\'s own', async ({ page }) => {
    const state = () => page.evaluate(() => ({ view: window._calViewMode, range: window._calRangeMode, intro: localStorage.getItem('sw_cal_v3_intro') }));
    // a browser that had Crew / 1 Week stored and has never seen v3
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('e2e_seeded')) return;
        sessionStorage.setItem('e2e_seeded', '1');
        localStorage.removeItem('sw_cal_v3_intro');
        localStorage.setItem('sw_cal_view_mode', 'crew');
        localStorage.setItem('sw_cal_range', '1w');
      } catch (e) {}
    });
    await page.goto('/ops.html');
    await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
    expect(await state()).toEqual({ view: 'schedule', range: 'month', intro: '1' });

    // they go back to Crew / 1 Week; the next load leaves that alone
    await page.evaluate(() => { localStorage.setItem('sw_cal_view_mode', 'crew'); localStorage.setItem('sw_cal_range', '1w'); });
    await page.reload();
    await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
    expect(await state()).toEqual({ view: 'crew', range: '1w', intro: '1' });
  });
});
