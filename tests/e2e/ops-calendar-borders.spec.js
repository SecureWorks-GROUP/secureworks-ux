// Ops Dash calendar: thin borders on every job line and a visible day grid,
// live for everyone. Search <calendar-borders> in ops.html.
//
// What this guards:
//  - every job line carries a 1px outline in a darker shade of its own colour,
//    and every day cell a visible light grid line, in 1 Week and Month
//  - a stale ?calborders switch or stored sw_cal_borders_preview value from the
//    old preview cannot hide them
//  - the outline moves no line: every bar keeps the same box (drag and the
//    overlap guards measure it)
//
// Static-fixture spec, same pattern as ops-calendar-v3.spec.js.
// Every name here is made up; dates are pinned through window._calDate.
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

const EVENTS = [
  ev({ job_id: 'j1', assignment_id: 'a1', job_number: 'SWP-27001', client_name: 'Alice Adams', job_type: 'patio', scheduled_date: '2026-08-03', scheduled_end: '2026-08-05' }),
  ev({ job_id: 'j2', assignment_id: 'a2', job_number: 'SWF-27002', client_name: 'Bob Baker', job_type: 'fencing', scheduled_date: '2026-08-04', scheduled_end: '2026-08-04' }),
  ev({ job_id: 'j3', assignment_id: 'a3', job_number: 'SWMS-27003', client_name: 'Cara Chen', job_type: 'makesafe', scheduled_date: '2026-08-04', scheduled_end: '2026-08-04', confirmation_status: 'confirmed' }),
  ev({ job_id: 'j4', assignment_id: 'a4', job_number: 'SWR-27004', client_name: 'Dana Diaz', job_type: 'repair', scheduled_date: '2026-08-06', scheduled_end: '2026-08-06' }),
];
const CREW = [{ id: 'u1', name: 'Rex Lawson', fullName: '', role: 'crew', division: '' }];

async function seedAndRender(page, opts = {}) {
  await page.evaluate(({ EVENTS, CREW, opts }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    document.getElementById('viewCalendar').classList.add('active');
    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = opts.range || '1w';
    window._calViewMode = 'schedule';
    window._calEvents = EVENTS;
    window._calOrgEvents = [];
    window._calDeliveries = [];
    window._calPOs = null;
    window._crewList = CREW;
    window._calLeaveByDate = {};
    window._calAvailability = {};
    window._calReadiness = {};
    window.applyCalFocus();
    window.renderCalendar();
  }, { EVENTS, CREW, opts });
}

function snapshot(page) {
  return page.evaluate(() => {
    const cal = document.getElementById('calendarBody');
    const bars = [...cal.querySelectorAll('.cal-schedule-bar[data-job-id]')].map((b) => {
      const r = b.getBoundingClientRect();
      return { job: b.getAttribute('data-job-id'), shadow: getComputedStyle(b).boxShadow, box: [r.x, r.y, r.width, r.height].map(Math.round).join(',') };
    });
    const cell = getComputedStyle(cal.querySelector('.cal-schedule-cell[data-date="2026-08-04"]'));
    return {
      bars,
      cellLine: cell.borderRightWidth + ' ' + cell.borderRightColor + ' / ' + cell.borderBottomColor,
    };
  });
}

async function open(page, query) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ops.html' + (query || ''));
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
  await revealOpsStaticFixture(page);
}

test('every job line is outlined in a darker shade of its colour and the day grid is visible, on the plain calendar and with a stale switch', async ({ page }) => {
  for (const [query, stored] of [['', null], ['?calborders=live', '0'], ['?calborders=preview', null]]) {
    for (const range of ['1w', 'month']) {
      await page.addInitScript((v) => { try { if (v === null) localStorage.removeItem('sw_cal_borders_preview'); else localStorage.setItem('sw_cal_borders_preview', v); } catch (e) {} }, stored);
      await open(page, query);
      await seedAndRender(page, { range });
      const s = await snapshot(page);
      expect(s.cellLine).toBe('1px rgb(212, 212, 218) / rgb(212, 212, 218)');
      const shadows = Object.fromEntries(s.bars.map((b) => [b.job, b.shadow]));
      // patio blue, fencing yellow, make safe purple, repair green, each darkened
      expect(Object.keys(shadows).sort()).toEqual(['j1', 'j2', 'j3', 'j4']);
      Object.values(shadows).forEach((sh) => expect(sh).toMatch(/ 0px 0px 0px 1px inset$/));
      expect(new Set(Object.values(shadows)).size).toBe(4);
    }
  }
});

test('the outline moves no line: every bar keeps the box drag and the overlap guards measure', async ({ page }) => {
  for (const range of ['1w', 'month']) {
    await open(page);
    await seedAndRender(page, { range });
    const s = await snapshot(page);
    const boxes = await page.evaluate(() => {
      // Take the outline and grid off and measure again: the boxes must match.
      const st = document.createElement('style');
      st.textContent = '#viewCalendar.cal-v3 .cal-schedule-grid.v3, #viewCalendar.cal-v3 .cal-schedule-grid.v3 .cal-schedule-bar { box-shadow: none !important; }';
      document.head.appendChild(st);
      const out = [...document.querySelectorAll('#calendarBody .cal-schedule-bar[data-job-id]')].map((b) => { const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); });
      st.remove();
      return out;
    });
    expect(s.bars.map((b) => b.box)).toEqual(boxes);
  }
});
