// Ops Dash calendar v3: the signed-off month design for the job-based
// (Schedule) view. On by default (window.__SW_CAL_V3_ENABLED); the one off
// switch is localStorage.sw_cal_v3 = '0', or ?calv3=0 for one page load.
//
// What this guards:
//  - the line format: type square, client, job number, staff circles, lock
//  - two states only: placeholder and client locked in
//  - business lines (meetings, company days) drawn like job lines, in purple,
//    always above the jobs, and stretched across the days they cover
//  - the Show / Type tick boxes, and that "Insurance" is a view filter over
//    make safes AND repairs without touching the stored divisions
//  - deliveries in the day from every live order, with an honest empty state
//  - the kill switch giving the old calendar back, and the first-open landing
//
// Static-fixture spec, same pattern as ops-calendar-repair-division.spec.js:
// it seeds window._calEvents (no network) and lets the real renderCalendar()
// draw. Every name here is made up. Dates are pinned through window._calDate,
// so nothing in this file compares against "today" and it cannot date-rot.
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub, revealOpsStaticFixture } = require('../helpers/ops-auth');

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
       confirmation_status: 'confirmed', start_time: '07:00:00', scheduled_date: '2026-08-04', scheduled_end: '2026-08-04', user_id: 'u3', crew_name: 'Ivy' }),
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
    window._calViewMode = opts.view || 'schedule';
    window._calEvents = opts.events || EVENTS;
    window._calOrgEvents = opts.noOrg ? [] : ORG_EVENTS;
    window._calDeliveries = opts.noDeliveries ? [] : DELIVERIES;
    // list_pos, null until that read lands (the page's own starting state)
    window._calPOs = opts.pos || null;
    if (!opts.keepCrew) window._crewList = opts.crew || CREW;
    window._calLeaveByDate = { '2026-08-05': ['Ivy'] };
    window._calAvailability = {};
    window._calReadiness = { j1: { status: 'ready', score: 100, blockers: [], warnings: [], completeness: [] } };
    ['show', 'type'].forEach((k) => Object.keys(window._calPick[k]).forEach((o) => { window._calPick[k][o] = true; }));
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
      dot: !!b.querySelector('.bar-dot'),
      bg: getComputedStyle(b).backgroundColor,
      r: rect(b),
    }));
    const cells = [...cal.querySelectorAll('.cal-schedule-cell')].map((c) => ({
      date: c.getAttribute('data-date'), w: rect(c).w, r: rect(c),
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
      crewDels: [...cal.querySelectorAll('.cal-delivery-block')].map((d) => d.getAttribute('data-po-id')),
      // Crew view: what each block is (client, or the label of a meeting), and any dimmed row
      crewBlocks: [...new Set([...cal.querySelectorAll('.cal-job-block')].map((b) => (b.getAttribute('title') || '').split(' \u2014 ')[0]))].sort(),
      dimmed: cal.querySelectorAll('.dimmed').length,
      divs: window._calDivFilters, storedDivs: localStorage.getItem('sw_cal_divs'), storedEvt: localStorage.getItem('sw_cal_evt_filters'),
    };
  });
}
const jobBars = (s) => s.bars.filter((b) => !b.biz);
// A real click on the one business line carrying both texts; answers which
// assignment's popup that opened.
async function openedLine(page, label, time) {
  await page.evaluate(() => window.closeCalJobPopup());
  await page.locator('.cal-schedule-bar.v3-biz', { hasText: label }).filter({ hasText: time }).click();
  return page.evaluate(() => window._calPopupAssignment && window._calPopupAssignment.assignment_id);
}
// Tick only one Show or Type option (Everything / All tick them all back).
const pick = (page, kind, key) => page.evaluate(([k, v]) => {
  if (v === 'everything' || v === 'all') return window.setCalPick(k, 'all', true);
  window.setCalPick(k, 'all', false);
  window.setCalPick(k, v, true);
}, [kind, key]);
const bizBars = (s) => s.bars.filter((b) => b.biz);
const bar = (s, job) => s.bars.find((b) => b.job === job);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function' && typeof window.setCalPick === 'function');
  await revealOpsStaticFixture(page);
  await seedAndRender(page);
});

test('v3 is on by default: new chrome, sidebar hidden, focus row drawn', async ({ page }) => {
  const s = await snapshot(page);
  expect(s.flag).toBe(true);
  expect(s.v3).toBe(true);
  expect(s.sidebar).toBe('none');
  expect(s.grid).toContain('v3');
  expect(s.focus.map((f) => f.text)).toEqual(['Everything', 'Labour', 'Materials', 'Business', 'All', 'Patios', 'Fencing', 'Insurance', 'Repairs', 'Make Safes']);
  expect(s.focus.every((f) => f.on)).toBe(true);
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
  // readiness is on record for this job, and the line still carries no dot for it
  expect(alice.dot).toBe(false);

  const bob = bar(s, 'j2');
  expect(bob.classes).toContain('v3s-locked');
  expect(bob.lock).toBe(true);
  // no surname on record anywhere: one letter, never two that read as initials
  expect(bob.crew).toEqual(['I']);
  // a job line carries no start time, even when the assignment has one
  expect(bob.time).toBe('');

  const eli = bar(s, 'j5');
  expect(eli.noCrew).toBe(true);
  expect(eli.crew).toEqual([]);
});

test('two states only, and make safes and repairs each have their own colour', async ({ page }) => {
  const s = await snapshot(page);
  const unit = (b) => b.classes.find((k) => k.indexOf('v3u-') === 0);
  expect(unit(bar(s, 'j1'))).toBe('v3u-patio');
  expect(unit(bar(s, 'j2'))).toBe('v3u-fencing');
  expect(unit(bar(s, 'j3'))).toBe('v3u-makesafe');
  expect(unit(bar(s, 'j4'))).toBe('v3u-repair');
  // warning triangle for a make safe, hammer for a repair, and a colour each
  expect(bar(s, 'j3').icon).not.toBe(bar(s, 'j4').icon);
  expect(bar(s, 'j3').bg).not.toBe(bar(s, 'j4').bg);
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
  await pick(page, 'show', 'labour');
  let s = await snapshot(page);
  expect(jobBars(s)).toHaveLength(5);
  expect(bizBars(s)).toHaveLength(0);
  expect(s.cells.flatMap((c) => c.dels)).toHaveLength(0);
  expect(s.cells.some((c) => c.leave)).toBe(false);

  await pick(page, 'show', 'business');
  s = await snapshot(page);
  expect(jobBars(s)).toHaveLength(0);
  expect(bizBars(s)).toHaveLength(3);
  // leave stays visible with business (nothing today's page shows is removed)
  expect(s.cells.find((c) => c.date === '2026-08-05').leave).toContain('Ivy');

  await pick(page, 'show', 'materials');
  s = await snapshot(page);
  expect(s.bars).toHaveLength(0);
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id).sort()).toEqual(['po-1', 'po-2']);
  expect(s.empty).toBe('');

  await pick(page, 'show', 'everything');
  s = await snapshot(page);
  expect(jobBars(s)).toHaveLength(5);
  expect(bizBars(s)).toHaveLength(3);
  expect(s.cells.flatMap((c) => c.dels)).toHaveLength(2);
  expect(s.focus.every((f) => f.on)).toBe(true);
});

test('Materials with nothing booked says so instead of showing an empty grid', async ({ page }) => {
  await seedAndRender(page, { noDeliveries: true });
  await pick(page, 'show', 'materials');
  let s = await snapshot(page);
  expect(s.empty).toBe('No deliveries booked');
  expect(s.bars).toHaveLength(0);

  // an order booked for a day outside the window is still nothing to show here
  await seedAndRender(page, { noDeliveries: true, pos: [
    { id: 'po-far', po_number: 'PO-9090', supplier_name: 'Example Steel Co', delivery_date: '2026-09-21', job_id: 'j1', status: 'sent' },
  ] });
  await pick(page, 'show', 'materials');
  s = await snapshot(page);
  expect(s.cells.flatMap((c) => c.dels)).toHaveLength(0);
  expect(s.empty).toBe('No deliveries booked');
});

test('a typed job-less row is a business line: shown under Business, hidden under Labour', async ({ page }) => {
  const withLabel = EVENTS.concat([ev({ job_id: null, assignment_id: 'l1', assignment_type: 'install', label: 'Yard clean-up',
    scheduled_date: '2026-08-07', scheduled_end: '2026-08-07', user_id: 'u3', crew_name: 'Ivy' })]);
  await seedAndRender(page, { events: withLabel });
  await pick(page, 'show', 'business');
  let s = await snapshot(page);
  expect(bizBars(s).map((b) => b.label)).toContain('Yard clean-up');
  expect(jobBars(s)).toHaveLength(0);

  await pick(page, 'show', 'labour');
  s = await snapshot(page);
  expect(s.bars.map((b) => b.label)).not.toContain('Yard clean-up');
  expect(jobBars(s)).toHaveLength(5);
});

test('a job outside the three named types sits with Patios for colour, filter and delivery alike', async ({ page }) => {
  const withGeneral = EVENTS.concat([ev({ job_id: 'j7', assignment_id: 'a7', job_number: 'SWG-27007', client_name: 'Finn Ford', job_type: 'general',
    scheduled_date: '2026-08-07', scheduled_end: '2026-08-07', user_id: 'u3', crew_name: 'Ivy' })]);
  const pos = [{ id: 'po-7', po_number: 'PO-9007', supplier_name: 'Example Timber Yard', delivery_date: '2026-08-07', job_id: 'j7', status: 'sent' }];
  await seedAndRender(page, { events: withGeneral, pos });
  let s = await snapshot(page);
  expect(bar(s, 'j7').classes).toContain('v3u-patio');

  await pick(page, 'type', 'patio');
  s = await snapshot(page);
  expect(jobBars(s).map((b) => b.job).sort()).toEqual(['j1', 'j5', 'j7']);
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id).sort()).toEqual(['po-1', 'po-7']);

  await pick(page, 'type', 'fencing');
  s = await snapshot(page);
  expect(jobBars(s).map((b) => b.job)).toEqual(['j2']);
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id)).toEqual(['po-2']);
});

test('Type filters by colour group, and Insurance is a view over make safes and repairs only', async ({ page }) => {
  await pick(page, 'type', 'patio');
  let s = await snapshot(page);
  expect(jobBars(s).map((b) => b.job).sort()).toEqual(['j1', 'j5']);
  expect(bizBars(s)).toHaveLength(3);                       // business is not a type
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id)).toEqual(['po-1']);

  await pick(page, 'type', 'fencing');
  s = await snapshot(page);
  expect(jobBars(s).map((b) => b.job)).toEqual(['j2']);
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id)).toEqual(['po-2']);

  await pick(page, 'type', 'insurance');
  s = await snapshot(page);
  expect(jobBars(s).map((b) => b.job).sort()).toEqual(['j3', 'j4']);
  // a view filter: the sidebar's divisions underneath are left exactly as they were
  expect(s.divs).toEqual(['all']);
  // and the sidebar's own stored choices were never written by the focus row
  expect(s.storedDivs).toBeNull();
  expect(s.storedEvt).toBeNull();

  await pick(page, 'type', 'all');
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

// Every live order shows, not only the three statuses the calendar feed sends
// (Captain ruling 2026-10-12). list_pos is the source; the feed tops it up.
const ALL_ORDERS = [
  DELIVERIES[0],
  { id: 'po-3', po_number: 'PO-9003', supplier_name: 'Example Roofing', delivery_date: '2026-08-05', confirmed_delivery_date: '2026-08-06', job_id: 'j3', status: 'sent' },
  { id: 'po-4', po_number: 'PO-9004', supplier_name: 'Example Timber Yard', delivery_date: '2026-08-06', confirmed_delivery_date: null, job_id: 'j5', status: 'confirmed' },
  // its job is not on the calendar in this window: the order's own job fields speak
  { id: 'po-5', po_number: 'PO-9005', supplier_name: 'Example Posts', delivery_date: '2026-08-07', confirmed_delivery_date: null, job_id: 'j-later', status: 'delivered',
    job_number: 'SWF-27050', job_type: 'fencing', delivery_address: '9 Sample Rd, Testville' },
  { id: 'po-6', po_number: 'PO-9006', supplier_name: 'Example Steel Co', delivery_date: '2026-08-04', confirmed_delivery_date: null, job_id: 'j1', status: 'cancelled' },
];

test('deliveries are every live order, on the same day the Crew row puts them', async ({ page }) => {
  await seedAndRender(page, { pos: ALL_ORDERS });
  const s = await snapshot(page);
  const onDay = (id) => (s.cells.find((c) => c.dels.some((d) => d.id === id)) || {}).date;
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id).sort()).toEqual(['po-1', 'po-2', 'po-3', 'po-4', 'po-5']);
  // requested day first, the supplier's confirmed day only when there is no requested one
  expect(onDay('po-3')).toBe('2026-08-05');

  await seedAndRender(page, { pos: ALL_ORDERS, view: 'crew' });
  const crew = await snapshot(page);
  expect(crew.crewDels.sort()).toEqual(['po-1', 'po-2', 'po-3', 'po-4', 'po-5']);
});

test('a delivery whose job is not in view still has its colour, job number and address', async ({ page }) => {
  await seedAndRender(page, { pos: ALL_ORDERS });
  let s = await snapshot(page);
  const fri = s.cells.find((c) => c.date === '2026-08-07');
  expect(fri.dels).toHaveLength(1);
  expect(fri.dels[0].l1).toBe('Example Posts SWF-27050');
  expect(fri.dels[0].l2).toBe('9 Sample Rd, Testville');
  expect(fri.dels[0].unit).toBe('v3u-fencing');

  await pick(page, 'type', 'fencing');
  s = await snapshot(page);
  expect(s.cells.flatMap((c) => c.dels).map((d) => d.id).sort()).toEqual(['po-2', 'po-5']);
});

test('the Crew view honours Type: other jobs are dropped, no crew row is dimmed, business stays', async ({ page }) => {
  // installers carry the division "trade", which is no job type at all
  const crew = CREW.map((c) => Object.assign({}, c, { role: 'installer', division: 'trade' }));
  const meetings = ['Toolbox talk', 'Weekly ops meeting'];
  await seedAndRender(page, { view: 'crew', crew });
  let s = await snapshot(page);
  expect(s.crewBlocks).toEqual(['Alice Adams', 'Bob Baker', 'Cara Chen', 'Dana Diaz', 'Eli Evans'].concat(meetings));

  await pick(page, 'type', 'insurance');
  s = await snapshot(page);
  expect(s.crewBlocks).toEqual(['Cara Chen', 'Dana Diaz'].concat(meetings));
  expect(s.dimmed).toBe(0);

  await pick(page, 'type', 'patio');
  s = await snapshot(page);
  expect(s.crewBlocks).toEqual(['Alice Adams', 'Eli Evans'].concat(meetings));
  expect(s.dimmed).toBe(0);

  await pick(page, 'type', 'all');
  s = await snapshot(page);
  expect(s.crewBlocks).toHaveLength(7);
});

test('each meeting or reminder on one job and day keeps its own line, time and popup', async ({ page }) => {
  const onJob = (o) => ev(Object.assign({ job_id: 'j1', job_number: 'SWP-27001', client_name: 'Alice Adams', job_type: 'patio',
    scheduled_date: '2026-08-05', scheduled_end: '2026-08-05' }, o));
  await seedAndRender(page, { events: EVENTS.concat([
    onJob({ assignment_id: 'm3', assignment_type: 'meeting', start_time: '09:00:00', user_id: 'u3', crew_name: 'Ivy' }),
    // the same 9am meeting with a second person on it: one line, two circles
    onJob({ assignment_id: 'm4', assignment_type: 'meeting', start_time: '09:00:00', user_id: 'u2', crew_name: 'Sam' }),
    onJob({ assignment_id: 'r3', assignment_type: 'reminder', start_time: '14:00:00', user_id: 'u1', crew_name: 'Rex Lawson' }),
    onJob({ assignment_id: 'm5', assignment_type: 'meeting', start_time: '15:00:00', user_id: 'u1', crew_name: 'Rex Lawson' }),
  ]) });
  const s = await snapshot(page);
  const lines = bizBars(s).filter((b) => b.label.indexOf('Alice Adams') !== -1)
    .map((b) => ({ label: b.label, time: b.time, crew: b.crew.slice().sort() }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.time.localeCompare(b.time));
  expect(lines).toEqual([
    { label: 'Meeting \u00b7 Alice Adams', time: '3pm', crew: ['RL'] },
    { label: 'Meeting \u00b7 Alice Adams', time: '9am', crew: ['I', 'SR'] },
    { label: 'Reminder \u00b7 Alice Adams', time: '2pm', crew: ['RL'] },
  ]);

  // a click on each line opens that event, not its neighbour on the same job
  expect(await openedLine(page, 'Alice Adams', '2pm')).toBe('r3');
  expect(await openedLine(page, 'Alice Adams', '3pm')).toBe('m5');
  expect(await openedLine(page, 'Alice Adams', '9am')).toBe('m3');
});

test('job-less events that share a title and a day each keep their own line, time and popup', async ({ page }) => {
  const titled = (o) => ev(Object.assign({ job_id: null, label: 'Call supplier', scheduled_date: '2026-08-07', scheduled_end: '2026-08-07' }, o));
  await seedAndRender(page, { events: EVENTS.concat([
    titled({ assignment_id: 'r5', assignment_type: 'reminder', start_time: '09:00:00', user_id: 'u3', crew_name: 'Ivy' }),
    titled({ assignment_id: 'r6', assignment_type: 'reminder', start_time: '15:00:00', user_id: 'u1', crew_name: 'Rex Lawson' }),
    // a meeting with the reminder's title and time is still a different event
    titled({ assignment_id: 'm6', assignment_type: 'meeting', start_time: '09:00:00', user_id: 'u2', crew_name: 'Sam' }),
    // and a second person on that meeting shares its line
    titled({ assignment_id: 'm7', assignment_type: 'meeting', start_time: '09:00:00', user_id: 'u1', crew_name: 'Rex Lawson' }),
  ]) });
  const s = await snapshot(page);
  const lines = bizBars(s).filter((b) => b.label === 'Call supplier')
    .map((b) => ({ time: b.time, crew: b.crew.slice().sort() }))
    .sort((a, b) => (a.time + a.crew.join()).localeCompare(b.time + b.crew.join()));
  expect(lines).toEqual([
    { time: '3pm', crew: ['RL'] },
    { time: '9am', crew: ['I'] },
    { time: '9am', crew: ['RL', 'SR'] },
  ]);
  expect(await openedLine(page, 'Call supplier', '3pm')).toBe('r6');
});

test('hovering a job line names the job\'s own time and crew, not a meeting held on that job', async ({ page }) => {
  // the feed lists the meeting first, ahead of the job's own rows
  const meetingFirst = [ev({ job_id: 'j1', assignment_id: 'm3', assignment_type: 'meeting', start_time: '09:00:00',
    job_number: 'SWP-27001', client_name: 'Alice Adams', job_type: 'patio',
    scheduled_date: '2026-08-05', scheduled_end: '2026-08-05', user_id: 'u3', crew_name: 'Ivy' })].concat(EVENTS);
  await seedAndRender(page, { events: meetingFirst });
  await page.locator('.cal-schedule-bar[data-job-id="j1"]').first().hover();
  const tip = page.locator('#calScheduleTooltip');
  await expect(tip.locator('.tt-name')).toHaveText('Alice Adams');
  await expect(tip.locator('.tt-crew')).toHaveText('Crew: Rex Lawson, Sam');
  await expect(tip.locator('.tt-time')).toHaveCount(0);
});

test('the new chrome is in place before the calendar feed answers, and stays when it fails', async ({ page, baseURL }) => {
  let calendarReads = 0;
  let answerFeed;
  const feedHeld = new Promise((resolve) => { answerFeed = resolve; });
  await installOpsSessionStub(page);
  await page.addInitScript(() => {
    try { localStorage.setItem('sw_ops_tab', 'calendar'); } catch (e) { /* storage unavailable */ }
  });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(baseURL)) return route.continue();
    const m = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (m && m[1] === 'calendar') {
      calendarReads += 1;
      await feedHeld;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'e2e calendar feed down' }) });
    }
    return route.fulfill({ status: m ? 200 : 404, contentType: 'application/json', body: '{}' });
  });
  // beforeEach left this page on /ops.html; a hash-only goto would not reload it
  await page.goto('about:blank');
  await page.goto('/ops.html#calendar');
  const chromeIsV3 = async () => {
    await expect(page.locator('#viewCalendar')).toHaveClass(/cal-v3/);
    // the old sidebar and its live tick boxes are never on screen with v3 on
    await expect(page.locator('#viewCalendar .cal-sidebar').first()).toBeHidden();
    await expect(page.locator('#calFocus .cal-focus-btn')).toHaveCount(10);
  };
  await expect(page.locator('#viewCalendar')).toHaveClass(/active/);
  await expect.poll(() => calendarReads, { message: 'the calendar feed was never read' }).toBeGreaterThan(0);
  // the feed has been asked and has not answered yet
  await expect(page.locator('#calendarBody .cal-loading')).toBeVisible();
  await chromeIsV3();

  answerFeed();
  await expect(page.locator('#calendarBody .cal-loading')).toHaveCount(0);
  await expect(page.locator('#calendarBody .cal-schedule-grid')).toHaveCount(0);
  await chromeIsV3();
});

test('a meeting linked to a job is a business line of its own, never part of the job line', async ({ page }) => {
  const withJobMeeting = EVENTS.concat([ev({ job_id: 'j1', assignment_id: 'm3', assignment_type: 'meeting', start_time: '09:00:00',
    job_number: 'SWP-27001', client_name: 'Alice Adams', job_type: 'patio',
    scheduled_date: '2026-08-05', scheduled_end: '2026-08-05', user_id: 'u3', crew_name: 'Ivy' })]);
  const LABEL = 'Meeting \u00b7 Alice Adams';
  await seedAndRender(page, { events: withJobMeeting });
  let s = await snapshot(page);
  const line = bizBars(s).find((b) => b.label === LABEL);
  expect(line, 'the meeting is drawn as a business line').toBeTruthy();
  expect(line.classes).toContain('v3u-biz');
  expect(line.num).toBe('SWP-27001');
  expect(line.time).toBe('9am');
  expect(line.crew).toEqual(['I']);
  // on top, like every business line
  const lowestBiz = Math.max(...bizBars(s).map((b) => b.r.bottom));
  for (const j of jobBars(s)) expect(j.r.y).toBeGreaterThanOrEqual(lowestBiz - 1);
  // the job's own line is untouched: its two days, its two people
  const alice = bar(s, 'j1');
  const mon = s.cells.find((c) => c.date === '2026-08-03'), tue = s.cells.find((c) => c.date === '2026-08-04');
  expect(Math.abs(alice.r.w - (mon.w + tue.w))).toBeLessThan(2);
  expect(alice.crew.sort()).toEqual(['RL', 'SR']);

  await pick(page, 'show', 'business');
  s = await snapshot(page);
  expect(bizBars(s).map((b) => b.label)).toContain(LABEL);
  expect(jobBars(s)).toHaveLength(0);

  for (const show of ['labour', 'materials']) {
    await pick(page, 'show', show);
    s = await snapshot(page);
    expect(s.bars.map((b) => b.label), 'Show = ' + show).not.toContain(LABEL);
  }

  // a business line is not a type
  await pick(page, 'show', 'everything');
  await pick(page, 'type', 'fencing');
  s = await snapshot(page);
  expect(bizBars(s).map((b) => b.label)).toContain(LABEL);
  expect(jobBars(s).map((b) => b.job)).toEqual(['j2']);
});

test('staff circles take the surname from the user list: full_name, else a raw name of two words', async ({ page, baseURL }) => {
  const users = [
    { id: 'u1', name: 'Rex Lawson', email: 'rex@example.test', role: 'installer' },
    { id: 'u2', name: 'Sam', full_name: 'Sam Example Rivers', email: 'sam@example.test', role: 'installer' },
    { id: 'u3', name: 'Ivy', email: 'ivy@example.test', role: 'installer' },
  ];
  await installOpsSessionStub(page);
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(baseURL)) return route.continue();
    const m = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const body = m && m[1] === 'list_users' ? { users } : {};
    return route.fulfill({ status: m ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.loadCrewList === 'function');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    // the page shows some staff under a one-word name; do the same to this made-up one
    window.CREW_NAME_MAP.rexlawson = 'Rex';
    window._crewList = [];
    await window.loadCrewList();
  });
  await revealOpsStaticFixture(page);
  await seedAndRender(page, { keepCrew: true });
  const s = await snapshot(page);
  // shown as "Rex", yet the circle still has the surname's letter from the raw name
  expect(await page.evaluate(() => window._crewList.map((c) => c.name).sort())).toEqual(['Ivy', 'Rex', 'Sam']);
  expect(bar(s, 'j1').crew.sort()).toEqual(['RL', 'SR']);
  // one word and nothing else on record: one letter
  expect(bar(s, 'j2').crew).toEqual(['I']);
});

test('the Crew view honours Show: deliveries only under Everything and Materials', async ({ page }) => {
  await seedAndRender(page, { view: 'crew' });
  let s = await snapshot(page);
  expect(s.crewDels.sort()).toEqual(['po-1', 'po-2']);

  for (const show of ['labour', 'business']) {
    await pick(page, 'show', show);
    s = await snapshot(page);
    expect(s.crewDels, 'Show = ' + show).toEqual([]);
    expect(s.empty).toBe('');
  }

  await pick(page, 'show', 'materials');
  s = await snapshot(page);
  expect(s.crewDels.sort()).toEqual(['po-1', 'po-2']);
  expect(s.empty).toBe('');

  await seedAndRender(page, { view: 'crew', noDeliveries: true });
  await pick(page, 'show', 'materials');
  s = await snapshot(page);
  expect(s.crewDels).toEqual([]);
  expect(s.empty).toBe('No deliveries booked');
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
    expect(alice.dot).toBe(true);                   // old format: the readiness dot stays
    expect(alice.classes.some((k) => k.indexOf('v3') === 0)).toBe(false);
    // company days are back to the corner badge
    expect(s.cells.filter((c) => c.holidayBadge).map((c) => c.date)).toEqual(['2026-08-06', '2026-08-07']);
    expect(s.cells.flatMap((c) => c.dels)).toHaveLength(0);
  });

  test('?calv3=0 is the same switch for one page load, and nothing in the address forces v3 on', async ({ page }) => {
    const flag = async (url) => {
      await page.goto(url);
      await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
      return page.evaluate(() => window.__SW_CAL_V3_ENABLED);
    };
    expect(await flag('/ops.html?calv3=0')).toBe(false);
    expect(await flag('/ops.html')).toBe(true);
    await page.evaluate(() => localStorage.setItem('sw_cal_v3', '0'));
    expect(await flag('/ops.html?calv3=1')).toBe(false);
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
