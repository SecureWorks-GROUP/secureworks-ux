// Ops Dash calendar: thin borders on every job line and a visible day grid,
// live for everyone. Search <calendar-borders> in ops.html.
//
// What this guards:
//  - every job line carries a 1px outline in a darker shade of its own colour,
//    and every day cell a visible light grid line, in 1 Week and Month
//  - the outline moves no line: every bar still spans exactly its start and
//    end day cells (drag and the overlap guards measure that box)
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

async function open(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
  await revealOpsStaticFixture(page);
}

test('every job line is outlined in a darker shade of its colour and the day grid is visible', async ({ page }) => {
  for (const range of ['1w', 'month']) {
    await open(page);
    await seedAndRender(page, { range });
    const s = await snapshot(page);
    expect(s.cellLine).toBe('1px rgb(212, 212, 218) / rgb(212, 212, 218)');
    const shadows = Object.fromEntries(s.bars.map((b) => [b.job, b.shadow]));
    // patio blue, fencing yellow, make safe purple, repair green, each darkened
    expect(Object.keys(shadows).sort()).toEqual(['j1', 'j2', 'j3', 'j4']);
    Object.values(shadows).forEach((sh) => expect(sh).toMatch(/ 0px 0px 0px 1px inset$/));
    expect(new Set(Object.values(shadows)).size).toBe(4);
  }
});

test('the outline moves no line: every bar still spans exactly its start and end day cells', async ({ page }) => {
  const spans = Object.fromEntries(EVENTS.map((e) => [e.job_id, [e.scheduled_date, e.scheduled_end]]));
  for (const range of ['1w', 'month']) {
    await open(page);
    await seedAndRender(page, { range });
    const edges = await page.evaluate((spans) => {
      const cal = document.getElementById('calendarBody');
      return [...cal.querySelectorAll('.cal-schedule-bar[data-job-id]')].map((b) => {
        const [start, end] = spans[b.getAttribute('data-job-id')];
        const r = b.getBoundingClientRect();
        const s = cal.querySelector('.cal-schedule-cell[data-date="' + start + '"]').getBoundingClientRect();
        const e = cal.querySelector('.cal-schedule-cell[data-date="' + end + '"]').getBoundingClientRect();
        return { job: b.getAttribute('data-job-id'), left: r.left - s.left, right: r.right - e.right };
      });
    }, spans);
    expect(edges.map((x) => x.job).sort()).toEqual(['j1', 'j2', 'j3', 'j4']);
    for (const x of edges) {
      expect(Math.abs(x.left), range + ' ' + x.job + ' left edge').toBeLessThanOrEqual(1);
      expect(Math.abs(x.right), range + ' ' + x.job + ' right edge').toBeLessThanOrEqual(1);
    }
  }
});
