#!/usr/bin/env node
// Offline screenshot harness for the Ops calendar day-cell rules, in both views
// (Crew swimlane + Schedule) and any range mode. Serves ops.html from disk on its
// own port and aborts every off-origin request, so nothing is fetched.
// Usage: node scripts/cal-month-border-shot.js [outDir] [rangeMode]
//   rangeMode: month (default) | 2w | 1w
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../tests/helpers/ops-auth.js');

const OUT = process.argv[2] || 'docs/evidence/ops-calendar-day-borders-2026-09-04/after';
const RANGE = process.argv[3] || 'month';
const PORT = 4196;

if (!['month', '2w', '1w'].includes(RANGE)) {
  console.error('usage: node scripts/cal-month-border-shot.js [outDir] [month|2w|1w]');
  process.exit(2);
}

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

function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
  });
  proc.on('exit', () => { proc._exited = true; });
  return proc;
}

// A server we did NOT spawn answering on this port would serve a DIFFERENT
// checkout's ops.html — the shots would then prove nothing about this tree. So
// bail out the moment our own python exits (port already bound) rather than
// screenshotting whatever else is listening.
async function waitForServer(proc, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc._exited) {
      throw new Error(`static server exited — port ${PORT} is already in use by another process`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start: ' + url);
}

async function shot(page, view, file) {
  await page.evaluate(({ view, range, EVENTS, CREW, LEAVE, AVAIL }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    container.style.width = '1400px';
    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = range;
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
    const calRange = window.getCalRange();
    if (view === 'schedule') window.renderScheduleView(container, calRange);
    else window.renderSwimlaneView(container, calRange);
  }, { view, range: RANGE, EVENTS, CREW, LEAVE, AVAIL });
  const el = await page.$('#calendarBody');
  await el.screenshot({ path: path.join(OUT, file) });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = startServer();
  const base = `http://127.0.0.1:${PORT}`;
  let browser;
  try {
    await waitForServer(server, `${base}/ops.html`, 15000);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
    // Read-only: abort every network call that is not this local static server.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      return route.abort();
    });
    await page.goto(`${base}/ops.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
    await revealOpsStaticFixture(page);
    // The Jarvis ambient bar is fixed to the viewport bottom and paints over the
    // last ~48px of an element shot — i.e. over the grid's own bottom edge, which
    // is exactly where the last week row's rule is judged. Hide it for the shot.
    await page.addStyleTag({ content: '#jarvisBar { display: none !important; }' });
    await shot(page, 'schedule', `${RANGE}-schedule.png`);
    await shot(page, 'crew', `${RANGE}-crew-swimlane.png`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  console.log(`wrote ${RANGE} shots to ` + OUT);
}

main().catch((err) => { console.error(err); process.exit(1); });
