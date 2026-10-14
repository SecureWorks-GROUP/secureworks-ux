// Ops Dash calendar: the tick-box Show / Type row.
// Search <calendar-tick-filters> in ops.html.
//
// What this guards:
//  - Show and Type are tick boxes, several at once, every one ticked to start
//  - unticking hides what it covers, and nothing ticked shows nothing for it
//  - Insurance is the umbrella over Repairs and Make Safes, which are separate
//    options with their own colour; Insurance ticks or unticks both
//  - deliveries and the Crew view follow the same ticks
//  - ticks are remembered across a reload
//
// Static-fixture spec, same pattern as ops-calendar-v3.spec.js: seeds
// window._calEvents (no network), dates pinned through window._calDate.
// Every name here is made up.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

function ev(o) {
  return Object.assign({
    assignment_type: 'install', confirmation_status: 'tentative',
    site_suburb: 'Testville', site_address: '1 Test St, Testville',
    start_time: null, end_time: null, user_id: 'u1', crew_name: 'Rex Lawson', assigned_to: null,
    label: null, recurrence_group_id: null,
  }, o);
}

// Week of Mon 3 Aug 2026.
const EVENTS = [
  ev({ job_id: 'j1', assignment_id: 'a1', job_number: 'SWP-27001', client_name: 'Alice Adams', job_type: 'patio', scheduled_date: '2026-08-03', scheduled_end: '2026-08-03' }),
  ev({ job_id: 'j2', assignment_id: 'a2', job_number: 'SWF-27002', client_name: 'Bob Baker', job_type: 'fencing', scheduled_date: '2026-08-04', scheduled_end: '2026-08-04', user_id: 'u3', crew_name: 'Ivy' }),
  ev({ job_id: 'j3', assignment_id: 'a3', job_number: 'SWMS-27003', client_name: 'Cara Chen', job_type: 'makesafe', scheduled_date: '2026-08-05', scheduled_end: '2026-08-05' }),
  // a repair by family while jobs.type still says makesafe
  ev({ job_id: 'j4', assignment_id: 'a4', job_number: 'SWMS-27004', client_name: 'Dana Diaz', job_type: 'makesafe', job_family: 'repair', scheduled_date: '2026-08-05', scheduled_end: '2026-08-05', user_id: 'u3', crew_name: 'Ivy' }),
  ev({ job_id: 'j5', assignment_id: 'a5', job_number: 'SWR-27005', client_name: 'Eli Evans', job_type: 'repair', scheduled_date: '2026-08-06', scheduled_end: '2026-08-06' }),
  ev({ job_id: null, assignment_id: 'm1', assignment_type: 'meeting', label: 'Toolbox talk', start_time: '06:45:00', scheduled_date: '2026-08-03', scheduled_end: '2026-08-03' }),
];
const DELIVERIES = [
  { id: 'po-1', po_number: 'PO-9001', supplier_name: 'Example Steel Co', delivery_date: '2026-08-03', job_id: 'j1', status: 'submitted' },
  { id: 'po-2', po_number: 'PO-9002', supplier_name: 'Example Roof Supplies', delivery_date: '2026-08-05', job_id: 'j3', status: 'authorised' },
];
const CREW = [
  { id: 'u1', name: 'Rex Lawson', fullName: '', role: 'crew', division: '' },
  { id: 'u3', name: 'Ivy', fullName: '', role: 'crew', division: '' },
];

async function seedAndRender(page, opts = {}) {
  await page.evaluate(({ EVENTS, DELIVERIES, CREW, opts }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    document.getElementById('viewCalendar').classList.add('active');
    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = '1w';
    window._calViewMode = opts.view || 'schedule';
    window._calEvents = EVENTS;
    window._calOrgEvents = [];
    window._calDeliveries = opts.noDeliveries ? [] : DELIVERIES;
    window._calPOs = null;
    window._crewList = CREW;
    window._calLeaveByDate = {};
    window._calAvailability = {};
    window._calReadiness = {};
    window.applyCalFocus();
    window.renderCalendar();
  }, { EVENTS, DELIVERIES, CREW, opts });
}

function snapshot(page) {
  return page.evaluate(() => {
    const cal = document.getElementById('calendarBody');
    const bars = [...cal.querySelectorAll('.cal-schedule-bar')];
    return {
      ticks: [...document.querySelectorAll('#calFocus .cal-focus-tick')].map((l) => {
        const i = l.querySelector('input');
        return { text: l.textContent.trim(), on: i.checked, mixed: i.indeterminate };
      }),
      liveButtons: document.querySelectorAll('#calFocus button.cal-focus-btn').length,
      jobs: bars.filter((b) => !b.classList.contains('v3-biz')).map((b) => b.getAttribute('data-job-id')).sort(),
      units: Object.fromEntries(bars.filter((b) => !b.classList.contains('v3-biz')).map((b) => [b.getAttribute('data-job-id'), [...b.classList].find((k) => k.indexOf('v3u-') === 0)])),
      bg: Object.fromEntries(bars.map((b) => [b.getAttribute('data-job-id') || 'biz', getComputedStyle(b).backgroundColor])),
      biz: bars.filter((b) => b.classList.contains('v3-biz')).length,
      dels: [...cal.querySelectorAll('.cal-v3-del')].map((d) => d.getAttribute('data-po-id')).sort(),
      crewDels: [...cal.querySelectorAll('.cal-delivery-block')].map((d) => d.getAttribute('data-po-id')).sort(),
      crewBlocks: [...new Set([...cal.querySelectorAll('.cal-job-block')].map((b) => (b.getAttribute('title') || '').split(' — ')[0]))].sort(),
      empty: (document.getElementById('calV3Empty') || {}).textContent || '',
      storedPick: localStorage.getItem('sw_cal_pick'),
    };
  });
}
const tick = (page, kind, key) => page.locator('#calFocus [data-pick-' + kind + '="' + key + '"] input').click();
const ALL_JOBS = ['j1', 'j2', 'j3', 'j4', 'j5'];

test.describe('tick-box Show / Type row', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/ops.html');
    await page.waitForFunction(() => typeof window.renderScheduleView === 'function' && typeof window.setCalPick === 'function');
    await revealOpsStaticFixture(page);
    await seedAndRender(page);
  });

  test('every option is a tick box and every one is ticked to start', async ({ page }) => {
    const s = await snapshot(page);
    expect(s.liveButtons).toBe(0);
    expect(s.ticks.map((t) => t.text)).toEqual(['Everything', 'Labour', 'Materials', 'Business', 'All', 'Patios', 'Fencing', 'Insurance', 'Repairs', 'Make Safes']);
    expect(s.ticks.every((t) => t.on && !t.mixed)).toBe(true);
    expect(s.jobs).toEqual(ALL_JOBS);
    expect(s.biz).toBe(1);
    expect(s.dels).toEqual(['po-1', 'po-2']);
  });

  test('Repairs and Make Safes each have their own colour, decided family-first', async ({ page }) => {
    const s = await snapshot(page);
    expect(s.units).toEqual({ j1: 'v3u-patio', j2: 'v3u-fencing', j3: 'v3u-makesafe', j4: 'v3u-repair', j5: 'v3u-repair' });
    expect(s.bg.j3).not.toBe(s.bg.j4);
    expect(s.bg.j4).toBe(s.bg.j5);
  });

  test('Make Safes and Repairs untick on their own; Insurance ticks or unticks both', async ({ page }) => {
    await tick(page, 'type', 'makesafe');
    let s = await snapshot(page);
    expect(s.jobs).toEqual(['j1', 'j2', 'j4', 'j5']);
    expect(s.ticks.find((t) => t.text === 'Insurance')).toMatchObject({ on: false, mixed: true });
    expect(s.dels).toEqual(['po-1']); // the make safe's delivery goes with it

    await tick(page, 'type', 'repair');
    s = await snapshot(page);
    expect(s.jobs).toEqual(['j1', 'j2']);
    expect(s.ticks.find((t) => t.text === 'Insurance')).toMatchObject({ on: false, mixed: false });

    await tick(page, 'type', 'insurance');
    s = await snapshot(page);
    expect(s.jobs).toEqual(ALL_JOBS);
    expect(s.ticks.filter((t) => ['Insurance', 'Repairs', 'Make Safes'].includes(t.text)).every((t) => t.on)).toBe(true);

    await tick(page, 'type', 'insurance');
    s = await snapshot(page);
    expect(s.jobs).toEqual(['j1', 'j2']);
  });

  test('Type is several at once: untick All, then pick what you want; business lines stay', async ({ page }) => {
    await tick(page, 'type', 'all');
    let s = await snapshot(page);
    expect(s.jobs).toEqual([]);
    expect(s.biz).toBe(1);
    expect(s.dels).toEqual([]);

    await tick(page, 'type', 'patio');
    await tick(page, 'type', 'repair');
    s = await snapshot(page);
    expect(s.jobs).toEqual(['j1', 'j4', 'j5']);
    expect(s.ticks.find((t) => t.text === 'All')).toMatchObject({ on: false, mixed: true });

    await tick(page, 'type', 'all');
    s = await snapshot(page);
    expect(s.jobs).toEqual(ALL_JOBS);
  });

  test('Show is several at once, and nothing ticked shows nothing', async ({ page }) => {
    await tick(page, 'show', 'labour');
    let s = await snapshot(page);
    expect(s.jobs).toEqual([]);
    expect(s.biz).toBe(1);
    expect(s.dels).toEqual(['po-1', 'po-2']);

    await tick(page, 'show', 'business');
    s = await snapshot(page);
    expect(s.biz).toBe(0);
    expect(s.dels).toEqual(['po-1', 'po-2']);

    await tick(page, 'show', 'materials');
    s = await snapshot(page);
    expect(s.jobs).toEqual([]);
    expect(s.biz).toBe(0);
    expect(s.dels).toEqual([]);
    expect(s.ticks.find((t) => t.text === 'Everything')).toMatchObject({ on: false, mixed: false });

    await tick(page, 'show', 'all');
    s = await snapshot(page);
    expect(s.jobs).toEqual(ALL_JOBS);
    expect(s.biz).toBe(1);
    expect(s.dels).toEqual(['po-1', 'po-2']);
  });

  test('Materials alone with nothing booked says so', async ({ page }) => {
    await seedAndRender(page, { noDeliveries: true });
    await tick(page, 'show', 'labour');
    await tick(page, 'show', 'business');
    const s = await snapshot(page);
    expect(s.empty).toBe('No deliveries booked');
  });

  test('the Crew view follows the same ticks', async ({ page }) => {
    await seedAndRender(page, { view: 'crew' });
    await tick(page, 'type', 'repair');
    let s = await snapshot(page);
    expect(s.crewBlocks).toEqual(['Alice Adams', 'Bob Baker', 'Cara Chen', 'Toolbox talk']);
    expect(s.crewDels).toEqual(['po-1', 'po-2']);

    await tick(page, 'show', 'materials');
    s = await snapshot(page);
    expect(s.crewDels).toEqual([]);
  });

  test('ticks are remembered across a reload', async ({ page }) => {
    await tick(page, 'type', 'makesafe');
    let s = await snapshot(page);
    expect(JSON.parse(s.storedPick).type.makesafe).toBe(false);

    await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.setCalPick === 'function');
    await revealOpsStaticFixture(page);
    await seedAndRender(page);
    s = await snapshot(page);
    expect(s.jobs).toEqual(['j1', 'j2', 'j4', 'j5']);
  });
});
