// CP1 drag-to-reschedule — REAL-INPUT regression (Crew view + Schedule view).
//
// Why this spec exists: the original CP1 checks drove the calendar with
// synthetic dispatched events and passed 15/15 while a real user could not
// drag anything — the Captain's live page was in the SCHEDULE view, which had
// zero drag wiring, and synthetic checks never caught it. So this spec:
//   1. uses ONLY Playwright's trusted CDP input pipeline (page.mouse
//      press-move-release) — never element.dispatchEvent;
//   2. runs the REAL repo ops.html over file:// in its real shape — the
//      Jarvis bar present, NOT hidden the way the walkthrough harness hid it;
//   3. covers BOTH views. The Schedule-view tests fail on any build where
//      renderScheduleView has no drag wiring (the shipped CP1 bug).
//
// The ops-api backend is stubbed at the network layer via page.route — the
// page runs its real fetch code; writes land in this file's `writes` array.
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const OPS_URL = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html') + '?dragv2=1#calendar';

// Fixture dates: first Monday >= today (same scheme as the CP1 walkthrough),
// so every date sits inside the 2-week today-forward window.
function isoStr(d) {
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function plusDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const today = new Date(); today.setHours(0, 0, 0, 0);
const monA = plusDays(today, (8 - today.getDay()) % 7);
const D = {
  MON: isoStr(monA), TUE: isoStr(plusDays(monA, 1)), WED: isoStr(plusDays(monA, 2)),
  THU: isoStr(plusDays(monA, 3)), FRI: isoStr(plusDays(monA, 4)), SAT: isoStr(plusDays(monA, 5)),
  SUN: isoStr(plusDays(monA, 6)), MON2: isoStr(plusDays(monA, 7)),
  WED2: isoStr(plusDays(monA, 9)), THU2: isoStr(plusDays(monA, 10)),
};

const USERS = [
  { id: 'u-hugo', name: 'Hugo', email: 'hugo@secureworkswa.com.au', role: 'lead_installer' },
  { id: 'u-liam', name: 'Liam', email: 'liam@secureworkswa.com.au', role: 'installer' },
  { id: 'u-priya', name: 'Priya', email: 'priya@secureworkswa.com.au', role: 'installer' },
];

function fixtureEvents() {
  const base = {
    start_time: null, end_time: null, assignment_type: 'install',
    assignment_status: 'scheduled', confirmation_status: 'tentative',
    job_type: 'fencing', job_status: 'processing', legacy: false,
  };
  return [
    { ...base, assignment_id: 'a-jane', job_id: 'j-1', user_id: 'u-hugo', crew_name: 'Hugo', assigned_to: 'Hugo', job_number: 'SWF-101', client_name: 'Jane Citizen', site_address: '12 Example St, Padbury WA 6025', site_suburb: 'Padbury', scheduled_date: D.MON, scheduled_end: D.WED, duration_days: 3 },
    { ...base, assignment_id: 'a-bob', job_id: 'j-2', user_id: 'u-liam', crew_name: 'Liam', assigned_to: 'Liam', job_number: 'SWF-102', client_name: 'Bob Mason', site_address: '8 Harbour Rd, Hillarys WA 6025', site_suburb: 'Hillarys', scheduled_date: D.FRI, scheduled_end: D.FRI, duration_days: 1 },
    // Weekend-crossing span: Fri + Mon (2 working days), interior Sat/Sun are breaks.
    { ...base, assignment_id: 'a-will', job_id: 'j-3', user_id: 'u-priya', crew_name: 'Priya', assigned_to: 'Priya', job_number: 'SWF-103', client_name: 'Will Parker', site_address: '19 Seaview Tce, Trigg WA 6029', site_suburb: 'Trigg', scheduled_date: D.FRI, scheduled_end: D.MON2, duration_days: 2 },
  ];
}

// Boots ops.html on the stubbed network. Returns { writes } — every mutating
// ops-api call the page makes, in order. Pass { events } to boot with a
// modified fixture (e.g. a confirmed assignment).
async function bootCalendar(page, opts = {}) {
  const state = { events: opts.events || fixtureEvents() };
  const writes = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const m = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (!m) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    const action = m[1];
    const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'calendar') return json({ events: state.events });
    if (action === 'pipeline') return json({ columns: { accepted: [] } });
    if (action === 'get_crew_availability') return json([]);
    if (action === 'list_users') return json({ users: USERS });
    if (action === 'update_assignment') {
      const body = route.request().postDataJSON();
      writes.push({ action, body });
      const ev = state.events.find((e) => e.assignment_id === body.assignmentId);
      if (ev) {
        if (body.scheduled_date) ev.scheduled_date = body.scheduled_date;
        if (body.scheduled_end) ev.scheduled_end = body.scheduled_end;
        if (body.duration_days != null) ev.duration_days = body.duration_days;
        if (body.crew_name) { ev.crew_name = body.crew_name; ev.assigned_to = body.crew_name; }
      }
      return json({ ok: true });
    }
    if (action === 'create_assignment' || action === 'delete_assignment' || action === 'send_client_update') {
      writes.push({ action, body: route.request().postDataJSON() });
      return json({ ok: true, sent: true });
    }
    return json({});
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sw_ops_tab', 'calendar');
      localStorage.setItem('sw_cal_range', '2w');
      localStorage.setItem('sw_cal_view_mode', 'crew');
    } catch (e) { /* file:// storage quirks — the URL flag still applies */ }
  });
  await page.goto(OPS_URL);
  await expect(page.locator('.cal-job-block').first()).toBeVisible();
  // The real page shape: the Jarvis bar must be present, not hidden.
  await expect(page.locator('#jarvisBar')).toBeVisible();
  return { writes };
}

// A REAL drag: trusted pointer press at the source, incremental moves, release
// over the target. Chromium's browser-side drag controller turns this into the
// native HTML5 dragstart/dragover/drop sequence.
async function realDrag(page, srcLocator, dstLocator, opts = {}) {
  const src = await srcLocator.boundingBox();
  const dst = await dstLocator.boundingBox();
  if (!src || !dst) throw new Error('drag endpoints not visible');
  const sx = src.x + src.width * (opts.srcXFrac ?? 0.5), sy = src.y + src.height / 2;
  const dx = dst.x + dst.width / 2, dy = dst.y + dst.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const steps = 25;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + ((dx - sx) * i) / steps, sy + ((dy - sy) * i) / steps);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test.describe('Crew view — real-pointer drag', () => {
  test('move: drag the 3-day block to Thursday → V2 payload + reschedule prompt', async ({ page }) => {
    const { writes } = await bootCalendar(page);
    const src = page.locator('.cal-swim-cell[data-date="' + D.MON + '"][data-crew="Hugo"] .cal-job-block');
    const dst = page.locator('.cal-swim-cell[data-date="' + D.THU + '"][data-crew="Hugo"]');
    await realDrag(page, src, dst);
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    const move = writes.find((w) => w.action === 'update_assignment');
    expect(move, 'a real drag must produce an update_assignment write').toBeTruthy();
    expect(move.body.assignmentId).toBe('a-jane');
    expect(move.body.scheduled_date).toBe(D.THU);
    // 3 working days laid from Thursday skip the weekend: Thu, Fri, Mon.
    expect(move.body.scheduled_end).toBe(D.MON2);
    expect(move.body.duration_days).toBe(3);
  });

  test('resize: drag the right edge handle of the Friday job onto Monday → Fri + Mon', async ({ page }) => {
    const { writes } = await bootCalendar(page);
    const block = page.locator('.cal-swim-cell[data-date="' + D.FRI + '"][data-crew="Liam"] .cal-job-block');
    await block.hover();
    const handle = block.locator('.cal-resize-handle.right');
    const dst = page.locator('.cal-swim-cell[data-date="' + D.MON2 + '"][data-crew="Liam"]');
    await realDrag(page, handle, dst);
    await expect
      .poll(() => writes.filter((w) => w.action === 'update_assignment').length, { message: 'a real edge-handle drag must produce an update_assignment write' })
      .toBeGreaterThan(0);
    const resize = writes.find((w) => w.action === 'update_assignment');
    expect(resize.body.assignmentId).toBe('a-bob');
    expect(resize.body.scheduled_date).toBe(D.FRI);
    expect(resize.body.scheduled_end).toBe(D.MON2);
    expect(resize.body.duration_days).toBe(2);
  });
});

test.describe('Schedule view — real-pointer drag (the shipped CP1 gap)', () => {
  // Enter the Schedule view the way a user does: a real click on the toggle.
  async function toSchedule(page) {
    await page.locator('#btnViewSchedule').click();
    await expect(page.locator('.cal-schedule-grid')).toBeVisible();
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-1"]').first()).toBeVisible();
  }

  test('move: drag the job bar onto Thursday → reschedule write + prompt', async ({ page }) => {
    const { writes } = await bootCalendar(page);
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-1"]').first();
    const dst = page.locator('.cal-schedule-cell[data-date="' + D.THU + '"]');
    await expect(dst, 'schedule day cells must be drop targets (data-date wiring)').toHaveCount(1);
    // Grab the bar off-centre so the pointer is NOT over the day the bar
    // already covers mid-drag confusion-wise; drop dead-centre of Thursday.
    await realDrag(page, bar, dst, { srcXFrac: 0.5 });
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    const move = writes.find((w) => w.action === 'update_assignment');
    expect(move, 'a real bar drag in Schedule view must produce an update_assignment write').toBeTruthy();
    expect(move.body.assignmentId).toBe('a-jane');
    expect(move.body.scheduled_date).toBe(D.THU);
    expect(move.body.scheduled_end).toBe(D.MON2);
    expect(move.body.duration_days).toBe(3);
    // Crew never changes from the Schedule view.
    expect(move.body.crew_name).toBe('Hugo');
  });

  test('resize: right edge handle of the Friday bar onto Monday → Fri + Mon', async ({ page }) => {
    const { writes } = await bootCalendar(page);
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-2"]').first();
    await bar.hover();
    const handle = bar.locator('.cal-resize-handle.right');
    await expect(handle, 'single-assignment schedule bars must carry edge handles').toHaveCount(1);
    const dst = page.locator('.cal-schedule-cell[data-date="' + D.MON2 + '"]');
    await realDrag(page, handle, dst);
    await expect
      .poll(() => writes.filter((w) => w.action === 'update_assignment').length, { message: 'a real edge-handle drag in Schedule view must produce an update_assignment write' })
      .toBeGreaterThan(0);
    const resize = writes.find((w) => w.action === 'update_assignment');
    expect(resize.body.assignmentId).toBe('a-bob');
    expect(resize.body.scheduled_date).toBe(D.FRI);
    expect(resize.body.scheduled_end).toBe(D.MON2);
    expect(resize.body.duration_days).toBe(2);
  });

  test('weekend-crossing job renders as broken segments in BOTH views', async ({ page }) => {
    await bootCalendar(page);
    // Crew view: Fri and Mon paint, interior Sat/Sun do NOT.
    await expect(page.locator('.cal-swim-cell[data-date="' + D.FRI + '"][data-crew="Priya"] .cal-job-block')).toHaveCount(1);
    await expect(page.locator('.cal-swim-cell[data-date="' + D.MON2 + '"][data-crew="Priya"] .cal-job-block')).toHaveCount(1);
    await expect(page.locator('.cal-swim-cell[data-date="' + D.SAT + '"][data-crew="Priya"] .cal-job-block')).toHaveCount(0);
    await expect(page.locator('.cal-swim-cell[data-date="' + D.SUN + '"][data-crew="Priya"] .cal-job-block')).toHaveCount(0);
    // Schedule view: the same job is TWO bar segments (Fri | Mon), one logical job.
    await toSchedule(page);
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-3"]')).toHaveCount(2);
    // Two bars alone can't prove the weekend break — the old renderer also
    // splits at the week-row boundary (Fri–Sun | Mon). The Fri segment must
    // span ONE day column, never stretch across the Sat/Sun cells.
    const cell = await page.locator('.cal-schedule-cell[data-date="' + D.FRI + '"]').boundingBox();
    const friSeg = await page.locator('.cal-schedule-bar[data-job-id="j-3"]').first().boundingBox();
    expect(friSeg.width, 'the Fri segment must not paint across Sat/Sun').toBeLessThan(cell.width * 1.5);
  });

  test('weekend-crossing job: dragging the FIRST segment reschedules the whole job', async ({ page }) => {
    const { writes } = await bootCalendar(page);
    await toSchedule(page);
    // Segments render in date order: first() = the Friday segment.
    const friSeg = page.locator('.cal-schedule-bar[data-job-id="j-3"]').first();
    const dst = page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]');
    await realDrag(page, friSeg, dst);
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    const move = writes.find((w) => w.action === 'update_assignment');
    expect(move, 'dragging a weekend-crossing segment must produce an update_assignment write').toBeTruthy();
    expect(move.body.assignmentId).toBe('a-will');
    // Drop day = new START; 2 working days from Wednesday = Wed + Thu.
    expect(move.body.scheduled_date).toBe(D.WED);
    expect(move.body.scheduled_end).toBe(D.THU);
    expect(move.body.duration_days).toBe(2);
    expect(move.body.crew_name).toBe('Priya');
  });

  test('weekend-crossing job: dragging the RESUME segment reschedules the whole job', async ({ page }) => {
    const { writes } = await bootCalendar(page);
    await toSchedule(page);
    const monSeg = page.locator('.cal-schedule-bar[data-job-id="j-3"]').last();
    const dst = page.locator('.cal-schedule-cell[data-date="' + D.WED2 + '"]');
    await realDrag(page, monSeg, dst);
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    const move = writes.find((w) => w.action === 'update_assignment');
    expect(move, 'dragging the resume segment must produce an update_assignment write').toBeTruthy();
    expect(move.body.assignmentId).toBe('a-will');
    expect(move.body.scheduled_date).toBe(D.WED2);
    expect(move.body.scheduled_end).toBe(D.THU2);
    expect(move.body.duration_days).toBe(2);
  });

  test('confirmed bars stay locked: drag produces no write', async ({ page }) => {
    const events = fixtureEvents();
    events[0].confirmation_status = 'confirmed';
    const { writes } = await bootCalendar(page, { events });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-1"]').first();
    const dst = page.locator('.cal-schedule-cell[data-date="' + D.THU + '"]');
    await realDrag(page, bar, dst);
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.action === 'update_assignment')).toHaveLength(0);
  });
});
