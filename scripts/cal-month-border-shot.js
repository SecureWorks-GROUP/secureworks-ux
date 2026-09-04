// Offline screenshot harness for the Ops calendar MONTH range in both views
// (Crew swimlane + Schedule). Renders from a fixed fixture — no network.
// Usage: node scripts/cal-month-border-shot.js <outDir>
const path = require('path');
const { chromium } = require('@playwright/test');

const OUT = process.argv[2] || 'docs/evidence/cal-month-borders';

function ev(o) {
  return Object.assign({
    assignment_type: 'install',
    confirmation_status: 'tentative',
    job_type: 'patio',
    site_suburb: 'Perth',
    site_address: '1 Test St',
    start_time: null, end_time: null,
    user_id: null, crew_name: null, assigned_to: null,
    label: null, recurrence_group_id: null,
  }, o);
}

const EVENTS = [
  ev({ job_id: 'j1', assignment_id: 'a1', job_number: 'SWP-27001', client_name: 'Alice Adams',
       scheduled_date: '2026-08-04', scheduled_end: '2026-08-06', crew_name: 'Hugo' }),
  ev({ job_id: 'j2', assignment_id: 'a2', job_number: 'SWF-27002', client_name: 'Bob Baker',
       job_type: 'fencing', scheduled_date: '2026-08-05', scheduled_end: '2026-08-07', crew_name: 'Isaac' }),
  ev({ job_id: 'j3', assignment_id: 'a3', job_number: 'SWP-27003', client_name: 'Cara Chen',
       confirmation_status: 'confirmed', scheduled_date: '2026-08-11', scheduled_end: '2026-08-13', crew_name: 'Shaun' }),
  ev({ job_id: 'j4', assignment_id: 'a4', job_number: 'SWD-27004', client_name: 'Dan Diaz',
       job_type: 'decking', scheduled_date: '2026-08-18', scheduled_end: '2026-08-19', crew_name: 'Henry' }),
  ev({ job_id: 'j5', assignment_id: 'a5', job_number: 'SWF-27005', client_name: 'Eve Ellis',
       job_type: 'fencing', scheduled_date: '2026-08-25', scheduled_end: '2026-08-25', crew_name: 'Hugo' }),
];

const CREW = [
  { id: 'u1', name: 'Hugo', role: 'crew', division: 'patio' },
  { id: 'u2', name: 'Isaac', role: 'crew', division: 'fencing' },
  { id: 'u3', name: 'Shaun', role: 'lead_installer', division: 'patio' },
  { id: 'u4', name: 'Henry', role: 'lead_installer', division: 'fencing' },
];

// Leave: Shaun away 12-13 Aug, Henry away 19 Aug.
const LEAVE = { '2026-08-12': ['Shaun'], '2026-08-13': ['Shaun'], '2026-08-19': ['Henry'] };
const AVAIL = {
  'Shaun_2026-08-12': { status: 'leave' }, 'Shaun_2026-08-13': { status: 'leave' },
  'Henry_2026-08-19': { status: 'leave' }, 'Isaac_2026-08-20': { status: 'unavailable' },
};

async function shot(page, view, file) {
  await page.evaluate(({ view, EVENTS, CREW, LEAVE, AVAIL }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    container.style.width = '1400px';
    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = 'month';
    window._calViewMode = view;
    window._calEvents = EVENTS;
    window._crewList = CREW;
    window._calLeaveByDate = LEAVE;
    window._calAvailability = AVAIL;
    window._calReadiness = {};
    window._calDeliveries = [];
    window._calDivFilter = 'all';
    window._calDivFilters = ['all'];
    window._calEventFilters = { jobs: true, meetings: true, holidays: true, leave: true, reminders: true };
    const range = window.getCalRange();
    if (view === 'schedule') window.renderScheduleView(container, range);
    else window.renderSwimlaneView(container, range);
  }, { view, EVENTS, CREW, LEAVE, AVAIL });
  const el = await page.$('#calendarBody');
  await el.screenshot({ path: path.join(OUT, file) });
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  await page.goto('http://127.0.0.1:4173/ops.html');
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
  await page.evaluate(() => {
    const g = document.getElementById('swAuthGate'); if (g) g.remove();
    const s = document.getElementById('swAuthGateStyle'); if (s) s.remove();
  });
  await shot(page, 'schedule', 'month-schedule.png');
  await shot(page, 'crew', 'month-crew-swimlane.png');
  await browser.close();
  console.log('wrote to ' + OUT);
})();
