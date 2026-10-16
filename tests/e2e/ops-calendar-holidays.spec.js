// Ops Dash calendar: the Holidays tick box, the colours, outlined tick boxes
// and WA public holidays, live for everyone.
// Search <calendar-holidays> in ops.html.
//
// What this guards:
//  - the plain address shows it all; a stale ?calholidays value or the old
//    localStorage.sw_cal_holidays_preview key cannot hide it
//  - Holidays alone covers holidays and company days; Business keeps meetings,
//    leave and reminders; Everything covers both
//  - colours: patios blue, fencing yellow, repairs green, make safes purple,
//    holidays bright red, business grey
//  - every tick box is an outlined button, coloured when ticked
//  - WA public holidays are drawn with nobody entering them, never twice on a
//    day a single-day Holiday / Company Day event covers or one carrying the
//    holiday's own name; a multi-day company event over one keeps its line
//  - saved picks from before the Holidays tick box still load
//
// Static-fixture spec, same pattern as ops-calendar-tick-filters.spec.js:
// seeds window._calEvents (no network), dates pinned through window._calDate.
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

// Week of Mon 3 Aug 2026 (no WA public holiday in it).
const EVENTS = [
  ev({ job_id: 'j1', assignment_id: 'a1', job_number: 'SWP-27001', client_name: 'Alice Adams', job_type: 'patio', scheduled_date: '2026-08-03', scheduled_end: '2026-08-03' }),
  ev({ job_id: 'j2', assignment_id: 'a2', job_number: 'SWF-27002', client_name: 'Bob Baker', job_type: 'fencing', scheduled_date: '2026-08-04', scheduled_end: '2026-08-04' }),
  ev({ job_id: 'j3', assignment_id: 'a3', job_number: 'SWMS-27003', client_name: 'Cara Chen', job_type: 'makesafe', scheduled_date: '2026-08-05', scheduled_end: '2026-08-05' }),
  ev({ job_id: 'j4', assignment_id: 'a4', job_number: 'SWR-27004', client_name: 'Dana Diaz', job_type: 'repair', scheduled_date: '2026-08-06', scheduled_end: '2026-08-06' }),
  ev({ job_id: null, assignment_id: 'm1', assignment_type: 'meeting', label: 'Toolbox talk', start_time: '06:45:00', scheduled_date: '2026-08-03', scheduled_end: '2026-08-03' }),
];
const ORG_EVENTS = [{ event_date: '2026-08-06', event_end: '2026-08-07', title: 'Example Conference', event_type: 'public_holiday' }];
const CREW = [{ id: 'u1', name: 'Rex Lawson', fullName: '', role: 'crew', division: '' }];

async function seedAndRender(page, opts = {}) {
  await page.evaluate(({ EVENTS, ORG_EVENTS, CREW, opts }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    document.getElementById('viewCalendar').classList.add('active');
    window._calDate = new Date((opts.week || '2026-08-03') + 'T00:00:00');
    window._calRangeMode = opts.range || '1w';
    window._calViewMode = opts.view || 'schedule';
    window._calEvents = opts.events || EVENTS;
    window._calOrgEvents = opts.org || ORG_EVENTS;
    window._calDeliveries = [];
    window._calPOs = null;
    window._crewList = CREW;
    window._calLeaveByDate = { '2026-08-05': ['Rex Lawson'] };
    window._calAvailability = {};
    window._calReadiness = {};
    window.applyCalFocus();
    window.renderCalendar();
  }, { EVENTS, ORG_EVENTS, CREW, opts });
}

function snapshot(page) {
  return page.evaluate(() => {
    const cal = document.getElementById('calendarBody');
    const bars = [...cal.querySelectorAll('.cal-schedule-bar')];
    const sq = (b) => { const s = b.querySelector('.cal-v3-sq'); return s ? getComputedStyle(s).backgroundColor : ''; };
    return {
      ticks: [...document.querySelectorAll('#calFocus .cal-focus-tick')].map((l) => {
        const i = l.querySelector('input');
        const cs = getComputedStyle(l);
        return { text: l.textContent.trim(), on: i.checked, mixed: i.indeterminate, border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor };
      }),
      squares: Object.fromEntries(bars.filter((b) => b.getAttribute('data-job-id')).map((b) => [b.getAttribute('data-job-id'), sq(b)])),
      meetings: bars.filter((b) => b.classList.contains('v3-biz') && !b.hasAttribute('data-org-event')).map((b) => ({ label: b.querySelector('.bar-label').textContent, sq: sq(b) })),
      holidays: bars.filter((b) => b.hasAttribute('data-org-event')).map((b) => ({
        label: b.querySelector('.bar-label').textContent, wa: b.hasAttribute('data-wa-holiday'),
        hol: b.classList.contains('v3-hol'), bg: getComputedStyle(b).backgroundColor,
      })),
      holidayCells: [...cal.querySelectorAll('.cal-schedule-cell.holiday-col')].length,
      holidayCellBg: (() => { const c = cal.querySelector('.cal-schedule-cell.holiday-col'); return c ? getComputedStyle(c).backgroundColor : ''; })(),
      leave: cal.querySelectorAll('.cal-schedule-leave-badge').length,
      crewBadges: [...cal.querySelectorAll('.cal-holiday-badge')].map((b) => b.textContent),
    };
  });
}
const tick = (page, kind, key) => page.locator('#calFocus [data-pick-' + kind + '="' + key + '"] input').click();

async function open(page, query) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ops.html' + (query || ''));
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function' && typeof window.setCalPick === 'function');
  await revealOpsStaticFixture(page);
}

test.describe('Holidays: live for everyone', () => {
  for (const [name, query, stored] of [
    ['the plain address', '', null],
    ['a stale ?calholidays=live', '?calholidays=live', null],
    ['an old stored preview choice of off', '', '0'],
  ]) {
    test('the live screen has the Holidays tick box, new colours and WA holidays: ' + name, async ({ page }) => {
      if (stored !== null) {
        await page.addInitScript((v) => { try { localStorage.setItem('sw_cal_holidays_preview', v); } catch (e) {} }, stored);
      }
      await open(page, query);
      await seedAndRender(page);
      let s = await snapshot(page);
      expect(s.ticks.map((t) => t.text)).toEqual(['Everything', 'Labour', 'Materials', 'Business', 'Holidays', 'All', 'Patios', 'Fencing', 'Insurance', 'Repairs', 'Make Safes']);
      expect(s.squares.j1).toBe('rgb(37, 99, 235)');
      expect(s.holidays.map((h) => [h.label, h.hol])).toEqual([['Example Conference', true]]);
      await seedAndRender(page, { week: '2026-09-28', events: [], org: [] });
      s = await snapshot(page);
      expect(s.holidays.map((h) => h.label)).toEqual(["King's Birthday"]);
    });
  }
});

test.describe('Holidays', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await seedAndRender(page);
  });

  test('Holidays sits beside Business, ticked to start, and Everything covers it', async ({ page }) => {
    let s = await snapshot(page);
    expect(s.ticks.map((t) => t.text)).toEqual(['Everything', 'Labour', 'Materials', 'Business', 'Holidays', 'All', 'Patios', 'Fencing', 'Insurance', 'Repairs', 'Make Safes']);
    expect(s.ticks.every((t) => t.on)).toBe(true);

    await tick(page, 'show', 'all');
    s = await snapshot(page);
    expect(s.ticks.find((t) => t.text === 'Holidays').on).toBe(false);
    expect(s.holidays).toEqual([]);

    await tick(page, 'show', 'holidays');
    s = await snapshot(page);
    expect(s.ticks.find((t) => t.text === 'Everything')).toMatchObject({ on: false, mixed: true });
    expect(s.holidays.map((h) => h.label)).toEqual(['Example Conference']);
  });

  test('Holidays alone covers holidays and company days; Business keeps meetings and leave', async ({ page }) => {
    await tick(page, 'show', 'business');
    let s = await snapshot(page);
    expect(s.meetings).toEqual([]);
    expect(s.leave).toBe(0);
    expect(s.holidays.map((h) => h.label)).toEqual(['Example Conference']);
    expect(s.holidayCells).toBe(2);

    await tick(page, 'show', 'business');
    await tick(page, 'show', 'holidays');
    s = await snapshot(page);
    expect(s.holidays).toEqual([]);
    expect(s.holidayCells).toBe(0);
    expect(s.meetings.map((m) => m.label)).toEqual(['Toolbox talk']);
    expect(s.leave).toBe(1);
  });

  test('colours: patios blue, fencing yellow, repairs green, make safes purple, holidays bright red, business grey', async ({ page }) => {
    const s = await snapshot(page);
    expect(s.squares).toEqual({ j1: 'rgb(37, 99, 235)', j2: 'rgb(234, 179, 8)', j3: 'rgb(124, 58, 237)', j4: 'rgb(22, 163, 74)' });
    expect(s.meetings[0].sq).toBe('rgb(107, 114, 128)');
    expect(s.holidays[0]).toMatchObject({ hol: true, bg: 'rgb(225, 29, 46)' });
    expect(s.holidayCellBg).toBe('rgb(253, 236, 236)');
  });

  test('every tick box is an outlined button, in its own colour when ticked', async ({ page }) => {
    let s = await snapshot(page);
    expect(s.ticks.every((t) => /^1px (solid|dashed) /.test(t.border))).toBe(true);
    expect(s.ticks.find((t) => t.text === 'Patios').border).toBe('1px solid rgb(37, 99, 235)');
    expect(s.ticks.find((t) => t.text === 'Holidays').border).toBe('1px solid rgb(225, 29, 46)');
    await tick(page, 'type', 'patio');
    await page.mouse.move(5, 890); // off the button, so its hover outline is not read
    s = await snapshot(page);
    expect(s.ticks.find((t) => t.text === 'Patios').border).toBe('1px solid rgb(212, 212, 218)');
    expect(s.ticks.find((t) => t.text === 'All').border).toMatch(/^1px dashed /);
  });

  test('WA public holidays show with nobody entering them, under Holidays, in red', async ({ page }) => {
    await seedAndRender(page, { week: '2026-09-28', events: [], org: [] });
    let s = await snapshot(page);
    expect(s.holidays).toEqual([{ label: "King's Birthday", wa: true, hol: true, bg: 'rgb(225, 29, 46)' }]);
    expect(s.holidayCells).toBe(1);

    await tick(page, 'show', 'holidays');
    s = await snapshot(page);
    expect(s.holidays).toEqual([]);
  });

  test('a day a Holiday / Company Day event already covers is not drawn twice', async ({ page }) => {
    await seedAndRender(page, { week: '2026-09-28', events: [], org: [{ event_date: '2026-09-28', title: "King's Birthday", event_type: 'public_holiday' }] });
    const s = await snapshot(page);
    expect(s.holidays).toEqual([{ label: "King's Birthday", wa: false, hol: true, bg: 'rgb(225, 29, 46)' }]);
  });

  test('a company shutdown over the public holidays keeps each holiday line and name', async ({ page }) => {
    const org = [{ event_date: '2026-12-24', event_end: '2027-01-05', title: 'Example Shutdown', event_type: 'public_holiday' }];
    await seedAndRender(page, { week: '2026-12-21', range: '2w', events: [], org });
    let s = await snapshot(page);
    expect(s.holidays.filter((h) => h.wa).map((h) => h.label)).toEqual(['Christmas Day', 'Boxing Day', 'Boxing Day (additional day)', "New Year's Day"]);
    expect(s.holidays.some((h) => !h.wa && h.label === 'Example Shutdown')).toBe(true);

    await seedAndRender(page, { view: 'crew', week: '2026-12-21', events: [], org });
    s = await snapshot(page);
    expect(s.crewBadges).toEqual(['Example Shutdown', 'Christmas Day', 'Boxing Day', 'Example Shutdown']);
  });

  test('the Crew view follows the Holidays tick box', async ({ page }) => {
    await seedAndRender(page, { view: 'crew', week: '2026-09-28', events: [], org: [] });
    let s = await snapshot(page);
    expect(s.crewBadges).toEqual(["King's Birthday"]);
    await tick(page, 'show', 'holidays');
    s = await snapshot(page);
    expect(s.crewBadges).toEqual([]);
  });

  test('the Crew view holiday header is bright red with readable white text, today included', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T09:00:00+08:00'));
    await seedAndRender(page, { view: 'crew', week: '2026-09-28', events: [], org: [] });
    const header = await page.evaluate(() => {
      const parse = (c) => c.match(/[\d.]+/g).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const h = document.querySelector('#calendarBody .cal-swimlane-day-header.holiday-col.today');
      const bg = parse(getComputedStyle(h).backgroundColor);
      const contrast = (el) => {
        let fg = parse(getComputedStyle(el).color);
        const a = fg.length > 3 ? fg[3] : 1;
        fg = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
        const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      return { bg: getComputedStyle(h).backgroundColor, name: contrast(h.querySelector('.day-name')), num: contrast(h.querySelector('.day-num')), cellBg: getComputedStyle(document.querySelector('#calendarBody .cal-swim-cell.holiday-col')).backgroundColor };
    });
    expect(header.bg).toBe('rgb(225, 29, 46)');
    expect(header.name).toBeGreaterThanOrEqual(4.5);
    expect(header.num).toBeGreaterThanOrEqual(4.5);
    expect(header.cellBg).toBe('rgb(254, 244, 244)');
  });

  test('an unticked Holidays is remembered across a reload', async ({ page }) => {
    await tick(page, 'show', 'holidays');
    await page.goto('/ops.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.setCalPick === 'function');
    await revealOpsStaticFixture(page);
    await seedAndRender(page);
    const s = await snapshot(page);
    expect(s.ticks.find((t) => t.text === 'Holidays').on).toBe(false);
    expect(s.holidays).toEqual([]);
  });
});

test.describe('Holidays: saved picks from before it', () => {
  test('a pick saved without a holidays key loads with Holidays ticked and the rest as saved', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('sw_cal_pick', JSON.stringify({ show: { labour: true, materials: true, business: false }, type: { patio: true, fencing: true, repair: true, makesafe: true } })); } catch (e) {}
    });
    await open(page);
    await seedAndRender(page);
    const s = await snapshot(page);
    expect(s.ticks.find((t) => t.text === 'Business').on).toBe(false);
    expect(s.ticks.find((t) => t.text === 'Holidays').on).toBe(true);
    expect(s.meetings).toEqual([]);
    expect(s.holidays.map((h) => h.label)).toEqual(['Example Conference']);
  });
});
