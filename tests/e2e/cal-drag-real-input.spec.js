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
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { jobBookingsAnswer, planReschedule, applyReschedule } = require('../helpers/job-bookings-stub');

const OPS_BASE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const OPS_URL = OPS_BASE + '?dragv2=1#calendar';
// dragv2 is ON by default now, so the flag-off boot must opt OUT explicitly.
const OPS_URL_FLAG_OFF = OPS_BASE + '?dragv2=0#calendar';

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
  TUE2: isoStr(plusDays(monA, 8)), WED2: isoStr(plusDays(monA, 9)), THU2: isoStr(plusDays(monA, 10)),
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
// ops-api call the page makes, in order. Opts: { events } fixture override,
// { flagOff } to boot WITHOUT dragv2, { unschedJobs } for the pipeline feed,
// { availability } rows for get_crew_availability, { url } to override the
// boot URL entirely (the gating tests boot with NO dragv2 param to prove the
// default), { dragLs } to seed localStorage.sw_cal_dragv2 before load.
async function bootCalendar(page, opts = {}) {
  const state = { events: opts.events || fixtureEvents(), reads: { job_bookings: 0, job_detail: 0 } };
  // { holdJobRead }: every job_detail read (the drag's job read) waits until
  // the test calls state.releaseJobRead().
  const jobReadGate = new Promise((r) => { state.releaseJobRead = r; });
  const writes = [];
  // Crew texts the page sends through ghl-proxy send_sms. Stubbed: nothing
  // leaves the browser.
  const texts = [];
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    if (/\/functions\/v1\/ghl-proxy\?action=send_sms/.test(url)) {
      texts.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    const m = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (!m) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    const action = m[1];
    const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'calendar') {
      // { windowOnly }: the feed sends only rows inside the asked window, as
      // the live one does. { refreshFails } / { refreshDelayMs }: every read
      // after the first fails, or is slow.
      state.calendarReads = (state.calendarReads || 0) + 1;
      if (state.calendarReads > 1 && opts.refreshFails) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' });
      }
      if (state.calendarReads > 1 && opts.refreshDelayMs) await new Promise((r) => setTimeout(r, opts.refreshDelayMs));
      const q = new URL(url).searchParams;
      const from = q.get('from'), to = q.get('to');
      return json({ events: opts.windowOnly
        ? state.events.filter((e) => e.scheduled_date <= to && (e.scheduled_end || e.scheduled_date) >= from)
        : state.events });
    }
    if (action === 'pipeline') return json({ columns: { accepted: opts.unschedJobs || [] } });
    if (action === 'get_crew_availability') return json(opts.availability || []);
    if (action === 'list_users') return json({ users: opts.users || USERS });
    if (action === 'job_bookings') {
      // The read taken as a whole-job save starts (`reads` counts each).
      // { laterJobRows }: rows booked by someone else after the job was
      // first read, so only a job read after the first carries them.
      const later = state.reads.job_bookings + state.reads.job_detail > 0 ? (opts.laterJobRows || []) : [];
      state.reads.job_bookings++;
      const jobId = new URL(url).searchParams.get('job_id');
      return json(jobBookingsAnswer(jobId, state.events.map((e) => ({ ...e, role: 'installer', status: e.assignment_status }))
        .concat(opts.extraJobRows || [], later)));
    }
    if (action === 'reschedule_job_bookings') {
      // A whole job's move or stretch in one all-or-nothing call. Planned with
      // the calendar's own planner, as ops-api's port of it plans.
      // { refuseReschedule: { status, body } }: ops-api refuses it whole.
      // { rescheduleAnswer }: changes the success answer (a server that laid the days out differently).
      const body = route.request().postDataJSON();
      writes.push({ action, body });
      if (opts.writeDelayMs) await new Promise((r) => setTimeout(r, opts.writeDelayMs));
      state.writesAnswered = (state.writesAnswered || 0) + 1;
      if (opts.refuseReschedule) {
        return route.fulfill({ status: opts.refuseReschedule.status || 409, contentType: 'application/json', body: JSON.stringify(opts.refuseReschedule.body) });
      }
      if (opts.writeFails) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"database unavailable"}' });
      let made = 0;
      const answer = applyReschedule(state.events, body, planReschedule(state.events, body), (create, template) => ({
        ...template, assignment_id: 'new-' + writes.length + (made++ ? '-' + made : ''), user_id: create.userId,
        crew_name: create.crewName, assigned_to: create.crewName, scheduled_date: create.scheduledDate,
        scheduled_end: create.scheduledEnd || create.scheduledDate, duration_days: 1,
        assignment_status: 'scheduled', confirmation_status: create.confirmationStatus,
      }));
      return json(opts.rescheduleAnswer ? opts.rescheduleAnswer(answer) : answer);
    }
    if (action === 'job_detail') {
      state.reads.job_detail++;
      if (opts.holdJobRead) await jobReadGate;
      const jobId = new URL(url).searchParams.get('jobId');
      return json({
        job: { id: jobId },
        // { extraJobRows }: rows only the job reads carry (ghost watchers,
        // bookings past the loaded window).
        assignments: state.events.filter((e) => e.job_id === jobId).map((e) => ({
          id: e.assignment_id, job_id: e.job_id, user_id: e.user_id, role: 'installer',
          status: e.assignment_status, assignment_type: e.assignment_type,
          scheduled_date: e.scheduled_date, scheduled_end: e.scheduled_end,
          users: e.user_id ? { id: e.user_id, name: e.crew_name } : null,
        })).concat((opts.extraJobRows || []).filter((a) => a.job_id === jobId)),
      });
    }
    if (action === 'update_assignment') {
      const body = route.request().postDataJSON();
      writes.push({ action, body });
      if (opts.writeDelayMs) await new Promise((r) => setTimeout(r, opts.writeDelayMs));
      state.writesAnswered = (state.writesAnswered || 0) + 1;
      // { writeFails }: every booking write is refused, after its delay.
      // { refuseUpdate }: assignment id -> the refusal ops-api answers for it.
      const refusedUpdate = (opts.refuseUpdate || {})[body.assignmentId];
      if (refusedUpdate) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: refusedUpdate }) });
      if (opts.writeFails) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"database unavailable"}' });
      const ev = state.events.find((e) => e.assignment_id === body.assignmentId);
      if (ev) {
        if (body.scheduled_date) ev.scheduled_date = body.scheduled_date;
        if (body.scheduled_end) ev.scheduled_end = body.scheduled_end;
        if (body.duration_days != null) ev.duration_days = body.duration_days;
        if (body.crew_name) { ev.crew_name = body.crew_name; ev.assigned_to = body.crew_name; }
      }
      return json({ ok: true });
    }
    if (action === 'delete_assignment') {
      // { deleteDelayMs }: each delete is slow. { refuseDelete }: assignment
      // id -> the refusal ops-api answers for it (an invoiced booking).
      const body = route.request().postDataJSON();
      // `answeredBefore`: how many deletes the server had answered when this one arrived
      writes.push({ action, body, answeredBefore: state.deletesAnswered || 0 });
      if (opts.deleteDelayMs) await new Promise((r) => setTimeout(r, opts.deleteDelayMs));
      state.deletesAnswered = (state.deletesAnswered || 0) + 1;
      const refusal = (opts.refuseDelete || {})[body.assignmentId];
      if (refusal) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: refusal }) });
      state.events = state.events.filter((e) => e.assignment_id !== body.assignmentId);
      return json({ ok: true });
    }
    if (action === 'create_assignment' || action === 'send_client_update') {
      const body = route.request().postDataJSON();
      // `answeredBefore`: how many booking updates the server had answered when this arrived
      writes.push({ action, body, answeredBefore: state.writesAnswered || 0 });
      if (action === 'create_assignment' && opts.keepCreates) {
        const like = state.events.find((e) => e.job_id === body.jobId) || {};
        state.events.push({ ...like, assignment_id: 'new-' + writes.length, user_id: body.userId, crew_name: body.crewName,
          assigned_to: body.crewName, scheduled_date: body.scheduledDate, scheduled_end: body.scheduledEnd || body.scheduledDate, duration_days: 1 });
      }
      return json({ ok: true, sent: true });
    }
    return json({});
  });
  await page.addInitScript((dragLs) => {
    try {
      // Calendar v3 lands a first-time browser on the job-based Month once
      // (sw_cal_v3_intro). These specs pick their own view, so mark it seen.
      localStorage.setItem('sw_cal_v3_intro', '1');
      localStorage.setItem('sw_ops_tab', 'calendar');
      localStorage.setItem('sw_cal_range', '2w');
      localStorage.setItem('sw_cal_view_mode', 'crew');
      if (dragLs != null) localStorage.setItem('sw_cal_dragv2', dragLs);
    } catch (e) { /* file:// storage quirks — the URL flag still applies */ }
  }, opts.dragLs == null ? null : opts.dragLs);
  await page.goto(opts.url || (opts.flagOff ? OPS_URL_FLAG_OFF : OPS_URL));
  await expect(page.locator('.cal-job-block').first()).toBeVisible();
  // The real page shape: the Jarvis bar must be present, not hidden.
  await expect(page.locator('#jarvisBar')).toBeVisible();
  if (opts.availability && opts.availability.length) {
    // The availability shading is an async enrich — wait for it to land so a
    // drag can't race ahead of the leave data it is meant to warn about.
    await expect
      .poll(() => page.evaluate(() => Object.keys(_calAvailability).length), { message: 'availability enrich never landed' })
      .toBeGreaterThan(0);
  }
  return { writes, texts, state };
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

  test('move: drop a job bar on the narrow Saturday column → the write lands on Saturday', async ({ page }) => {
    const { writes } = await bootCalendar(page);
    await toSchedule(page);
    // Calendar v3 narrows the weekend columns while nothing is booked on them.
    // The narrow column must still be a real drop target for a real pointer.
    const fri = page.locator('.cal-schedule-cell[data-date="' + D.FRI + '"]');
    const sat = page.locator('.cal-schedule-cell[data-date="' + D.SAT + '"]');
    expect((await sat.boundingBox()).width, 'Saturday starts out narrow').toBeLessThan((await fri.boundingBox()).width * 0.4);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-2"]').first();
    await realDrag(page, bar, sat);
    await expect
      .poll(() => writes.filter((w) => w.action === 'update_assignment').length, { message: 'a real bar drag onto the narrow Saturday must produce an update_assignment write' })
      .toBeGreaterThan(0);
    const move = writes.find((w) => w.action === 'update_assignment');
    expect(move.body.assignmentId).toBe('a-bob');
    expect(move.body.scheduled_date).toBe(D.SAT);
    expect(move.body.scheduled_end).toBe(D.SAT);
    expect(move.body.crew_name).toBe('Liam');
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

  test('weekend-crossing booking: dragging the FIRST segment moves its one row', async ({ page }) => {
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

  test('weekend-crossing booking: dragging the RESUME segment moves its one row', async ({ page }) => {
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

// Captain ruling [cp1-askuser-2] (2026-08-01): both review findings fixed.
// These checks pin the browser to Perth time (UTC+8) — the flag-off end-date
// bug only shows on the UTC+ side of midnight.
test.describe('Captain ruling cp1-askuser-2 — Perth timezone', () => {
  test.use({ timezoneId: 'Australia/Perth' });

  test('flag OFF: Schedule-modal create writes the intended local span, never inverted', async ({ page }) => {
    await bootCalendar(page, {
      flagOff: true,
      unschedJobs: [{ id: 'j-new', client_name: 'Pat New', site_suburb: 'Padbury', job_number: 'SWF-200', type: 'fencing', value: 0 }],
    });
    const writes = [];
    page.on('request', (r) => {
      if (r.url().includes('action=create_assignment')) writes.push(r.postDataJSON());
    });
    // Opening the modal is setup, not the behaviour under test — the create
    // form itself is driven with real input.
    await page.evaluate((date) => openScheduleModal('j-new', '', date), D.MON);
    await expect(page.locator('#schedCrew')).toBeVisible();
    await page.selectOption('#schedCrew', 'u-hugo');
    // 1-day create: pre-fix, toISOString in Perth wrote scheduled_end the day
    // BEFORE scheduled_date (an inverted span the Crew view silently drops).
    await page.locator('#schedDuration').fill('1');
    await page.getByRole('button', { name: 'Create Planned' }).click();
    await expect.poll(() => writes.length).toBeGreaterThan(0);
    expect(writes[0].scheduledDate).toBe(D.MON);
    expect(writes[0].scheduledEnd).toBe(D.MON);
    // The first create closes the modal when its response lands; reopening
    // before that lets the late close shut the second form.
    await expect(page.locator('#calSchedModal')).not.toHaveClass(/open/);
    // 3-day create: flag off counts CALENDAR days — Mon..Wed.
    await page.evaluate((date) => openScheduleModal('j-new', '', date), D.MON);
    await page.selectOption('#schedCrew', 'u-hugo');
    await page.locator('#schedDuration').fill('3');
    await page.getByRole('button', { name: 'Create Planned' }).click();
    await expect.poll(() => writes.length).toBeGreaterThan(1);
    expect(writes[1].scheduledDate).toBe(D.MON);
    expect(writes[1].scheduledEnd).toBe(D.WED);
  });

  test('single-crew multi-day move onto mid-span leave triggers the combined warning', async ({ page }) => {
    const { writes } = await bootCalendar(page, {
      availability: [{ user_id: 'u-priya', date: D.TUE2, status: 'leave', note: 'AL' }],
    });
    // Crew view: drag Will Parker (Priya, Fri->Mon, 2 working days) onto MON2.
    // The moved span is Mon+Tue; Priya is on leave Tue — the drop-day-only
    // check would stay silent, the span-depth check must warn.
    const src = page.locator('.cal-swim-cell[data-date="' + D.FRI + '"][data-crew="Priya"] .cal-job-block');
    const dst = page.locator('.cal-swim-cell[data-date="' + D.MON2 + '"][data-crew="Priya"]');
    await realDrag(page, src, dst);
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    const modal = page.locator('#calConfirmModal');
    await expect(modal).toContainText('Crew Unavailable');
    await expect(modal).toContainText('Priya');
    await expect(modal).toContainText('leave');
    // Nothing moves until the explicit confirm.
    expect(writes.filter((w) => w.action === 'update_assignment')).toHaveLength(0);
    await page.locator('#confirmModalProceed').click();
    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length).toBeGreaterThan(0);
    const move = writes.find((w) => w.action === 'update_assignment');
    expect(move.body.assignmentId).toBe('a-will');
    expect(move.body.scheduled_date).toBe(D.MON2);
    expect(move.body.scheduled_end).toBe(D.TUE2);
    expect(move.body.duration_days).toBe(2);
  });
});

// ── dragv2 default-on gating (team-wide enable) ──
// The flag flip is the change under test here: a PLAIN boot — no query param,
// no localStorage key, exactly how the team loads the page — must behave like
// ?dragv2=1 used to, and both kill switches must still reach the untouched V1
// path.
test.describe('dragv2 default-on gating', () => {
  const PLAIN_URL = OPS_BASE + '#calendar';

  test('plain boot (no param, no localStorage): drag is V2 — working-day span + reschedule prompt', async ({ page }) => {
    const { writes } = await bootCalendar(page, { url: PLAIN_URL });
    expect(await page.evaluate(() => window.__SW_CAL_DRAGV2_ENABLED)).toBe(true);
    const src = page.locator('.cal-swim-cell[data-date="' + D.MON + '"][data-crew="Hugo"] .cal-job-block');
    const dst = page.locator('.cal-swim-cell[data-date="' + D.THU + '"][data-crew="Hugo"]');
    await realDrag(page, src, dst);
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    const move = writes.find((w) => w.action === 'update_assignment');
    expect(move, 'a plain-boot drag must produce an update_assignment write').toBeTruthy();
    expect(move.body.scheduled_date).toBe(D.THU);
    // Weekend-skip end = V2. The V1 calendar shift would have written D.SAT.
    expect(move.body.scheduled_end).toBe(D.MON2);
    expect(move.body.duration_days).toBe(3);
  });

  test('localStorage kill switch "0": drag is the V1 calendar-delta shift, no prompt', async ({ page }) => {
    const { writes } = await bootCalendar(page, { url: PLAIN_URL, dragLs: '0' });
    expect(await page.evaluate(() => window.__SW_CAL_DRAGV2_ENABLED)).toBe(false);
    const src = page.locator('.cal-swim-cell[data-date="' + D.MON + '"][data-crew="Hugo"] .cal-job-block');
    const dst = page.locator('.cal-swim-cell[data-date="' + D.THU + '"][data-crew="Hugo"]');
    await realDrag(page, src, dst);
    await expect
      .poll(() => writes.filter((w) => w.action === 'update_assignment').length, { message: 'the kill switch must keep the old drag working, not remove drag' })
      .toBeGreaterThan(0);
    const move = writes.find((w) => w.action === 'update_assignment');
    // V1 shifts the whole span by the calendar delta: Mon..Wed +3 = Thu..Sat.
    expect(move.body.scheduled_date).toBe(D.THU);
    expect(move.body.scheduled_end).toBe(D.SAT);
    expect(move.body.duration_days).toBeUndefined();
    // The reschedule-SMS prompt is V2-only — the V1 move is silent.
    await page.waitForTimeout(300);
    await expect(page.locator('#calConfirmBackdrop')).not.toHaveClass(/open/);
  });

  test('flag precedence: URL beats localStorage in both directions', async ({ page }) => {
    await bootCalendar(page, { url: PLAIN_URL });
    const flag = () => page.evaluate(() => window.__SW_CAL_DRAGV2_ENABLED);
    expect(await flag()).toBe(true); // default ON
    await page.evaluate(() => localStorage.setItem('sw_cal_dragv2', '1'));
    await page.goto(PLAIN_URL);
    expect(await flag()).toBe(true); // legacy '1' opt-in bookmark still works
    await page.goto(OPS_URL_FLAG_OFF);
    expect(await flag()).toBe(false); // ?dragv2=0 beats localStorage '1'
    await page.evaluate(() => localStorage.setItem('sw_cal_dragv2', '0'));
    await page.goto(PLAIN_URL);
    expect(await flag()).toBe(false); // persistent kill switch
    await page.goto(OPS_URL);
    expect(await flag()).toBe(true); // ?dragv2=1 beats localStorage '0'
  });
});

// The live failure (Captain, Milan Mall SWP-26595): a multi-crew job stored as
// one booking per person per day, across a weekend. Grabbing it anywhere and
// dropping it on a new start day moves the WHOLE job by working days, every
// person together, with the job's own rows never counted as clashes.
test.describe('One booking per person per day (Milan Mall shape): each bar stands on its own', () => {
  // Pin the page's today to this spec's first Monday so every day below is
  // inside the 2-week window whatever weekday the suite runs on.
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(D.MON + 'T09:00:00'));
  });
  const FRI2 = isoStr(plusDays(monA, 11));
  const CREW4 = [
    { id: 'u-hugo', name: 'Hugo', email: 'hugo@secureworkswa.com.au', role: 'lead_installer', phone: '+61400000001' },
    { id: 'u-liam', name: 'Liam', email: 'liam@secureworkswa.com.au', role: 'installer', phone: '+61400000002' },
    { id: 'u-priya', name: 'Priya', email: 'priya@secureworkswa.com.au', role: 'installer' },
    { id: 'u-nina', name: 'Nina', email: 'nina@secureworkswa.com.au', role: 'installer', phone: '+61400000004' },
  ];
  function perDayRows(days, crew = CREW4) {
    const out = [];
    days.forEach((day, di) => crew.forEach((u) => out.push({
      start_time: null, end_time: null, assignment_type: 'install', assignment_status: 'scheduled',
      confirmation_status: 'tentative', job_type: 'patio', job_status: 'accepted', legacy: false,
      assignment_id: 'mm-' + u.name.toLowerCase() + '-' + di, job_id: 'j-mm', user_id: u.id, crew_name: u.name,
      assigned_to: u.name, job_number: 'SWP-26595', client_name: 'Milan Mall', site_address: '4 Example Way, Malaga WA 6090',
      site_suburb: 'Malaga', scheduled_date: day, scheduled_end: day, duration_days: 1,
    })));
    return out;
  }
  const datesOf = (state, userId) => state.events.filter((e) => e.job_id === 'j-mm' && e.user_id === userId)
    .map((e) => e.scheduled_date).sort();
  const shownDatesOf = (page, userId) => page.evaluate((u) => window._calEvents.filter((e) => e.job_id === 'j-mm' && e.user_id === u)
    .map((e) => e.scheduled_date).sort(), userId);
  // A whole job is one reschedule_job_bookings call; these are the writes it replaces.
  const PER_BOOKING = ['update_assignment', 'create_assignment', 'delete_assignment'];
  const reschedules = (writes) => writes.filter((w) => w.action === 'reschedule_job_bookings');
  const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  async function toSchedule(page) {
    await page.locator('#btnViewSchedule').click();
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first()).toBeVisible();
  }

  // Captain 2026-10-27: a drag moves the bar that was grabbed and nothing
  // else. The job's other bars (Fri before the weekend, Thu after the gap)
  // are other bookings and stay where they are.
  const bar = (page, firstRowId) => page.locator('.cal-schedule-bar[data-assignment-id="' + firstRowId + '"]');
  test('drag one bar: every person on it moves, painted at once, and the job\'s other bars stay', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, {
      events: perDayRows([D.FRI, D.MON2, D.TUE2, D.THU2]), users: CREW4, writeDelayMs: 1500,
    });
    await toSchedule(page);
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]')).toHaveCount(3);
    // the Mon-Tue bar after the weekend, one working day later
    await realDrag(page, bar(page, 'mm-hugo-1'), page.locator('.cal-schedule-cell[data-date="' + D.TUE2 + '"]'));

    // On screen at once, while the server is still answering, and the grid
    // never blanks to the loading state.
    await expect.poll(() => page.evaluate(() => window._calEvents.filter((e) => e.job_id === 'j-mm' && e.user_id === 'u-hugo')
      .map((e) => e.scheduled_date).sort()), { timeout: 1000 }).toEqual([D.FRI, D.TUE2, D.WED2, D.THU2]);
    await expect(page.locator('#calendarBody .cal-loading')).toHaveCount(0);

    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length, { timeout: 15000 }).toBe(8);
    await expect(page.locator('body')).not.toContainText('Not moved');
    for (const u of CREW4) await expect.poll(() => datesOf(state, u.id), { message: u.name }).toEqual([D.FRI, D.TUE2, D.WED2, D.THU2]);
    // only the grabbed bar's bookings are written, each kept one day long;
    // a bar that is part of a job keeps its own writes, never the whole-job call
    expect(reschedules(writes)).toHaveLength(0);
    const moved = writes.filter((w) => w.action === 'update_assignment');
    expect(moved.every((w) => /^mm-[a-z]+-[12]$/.test(w.body.assignmentId))).toBe(true);
    expect(moved.every((w) => w.body.scheduled_date === w.body.scheduled_end)).toBe(true);
    // a person's day is never written onto a date another of their rows still holds
    const order = moved.map((w) => w.body.assignmentId);
    // (Tue leaves for Wed before Mon takes Tue)
    expect(order.indexOf('mm-hugo-2')).toBeLessThan(order.indexOf('mm-hugo-1'));
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
  });

  test('the Friday piece moves alone: the bars after the weekend are other bookings', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, { events: perDayRows([D.FRI, D.MON2, D.TUE2]), users: CREW4 });
    await toSchedule(page);
    await realDrag(page, bar(page, 'mm-hugo-0'), page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length).toBe(4);
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.action === 'update_assignment').map((w) => w.body.assignmentId).sort())
      .toEqual(['mm-hugo-0', 'mm-liam-0', 'mm-nina-0', 'mm-priya-0']);
    for (const u of CREW4) expect(datesOf(state, u.id), u.name).toEqual([D.WED, D.MON2, D.TUE2]);
  });

  test('the reschedule step also offers the crew text: one each, from the office number, naming who has no phone', async ({ page }) => {
    const { writes, texts } = await bootCalendar(page, { events: perDayRows([D.FRI, D.MON2, D.TUE2, D.THU2]), users: CREW4 });
    await toSchedule(page);
    await realDrag(page, bar(page, 'mm-hugo-0'), page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    const modal = page.locator('#calConfirmModal');
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    await expect(modal).toContainText('Send reschedule update?');
    // the client text is unchanged; the crew text sits beside it, ticked
    await expect(page.locator('#calReschedClient')).toBeChecked();
    await expect(page.locator('#calReschedCrew')).toBeChecked();
    await expect(modal).toContainText('Hugo, Liam, Nina');
    await expect(page.locator('#calReschedNoPhone')).toHaveText('No phone on file, not texted: Priya');
    await page.locator('#confirmModalProceed').click();

    await expect.poll(() => texts.length).toBe(3);
    expect(texts.map((t) => t.phone).sort()).toEqual(['+61400000001', '+61400000002', '+61400000004']);
    for (const t of texts) {
      expect(t).toMatchObject({ fromNumber: '+61489267771', recipientRole: 'crew', aboutJobId: 'j-mm' });
      expect(t.jobId).toBeUndefined();
      expect(t.message).toContain('SWP-26595');
      expect(t.message).toContain('Milan Mall');
      expect(t.message).toContain('4 Example Way');
      expect(t.message).toContain('trade.html#job/j-mm');
    }
    const hugo = texts.find((t) => t.phone === '+61400000001').message;
    const label = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
    // every day the person is on the job, not only the moved bar's
    expect(hugo).toContain('Your days: ' + [D.WED, D.MON2, D.TUE2, D.THU2].map(label).join(', '));
    expect(writes.filter((w) => w.action === 'send_client_update')).toHaveLength(1);
    await expect(page.getByText(/Crew texted: Hugo, Liam, Nina/)).toBeVisible();
    await expect(page.getByText(/No phone on file, not texted: Priya/).last()).toBeVisible();
  });

  test('untick the crew text and only the client text goes', async ({ page }) => {
    const { writes, texts } = await bootCalendar(page, { events: perDayRows([D.MON, D.TUE]), users: CREW4 });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    await page.locator('#calReschedCrew').uncheck();
    await page.locator('#confirmModalProceed').click();
    await expect.poll(() => writes.filter((w) => w.action === 'send_client_update').length).toBe(1);
    await page.waitForTimeout(300);
    expect(texts).toHaveLength(0);
  });

  test('stretch the end over a weekend: every person gains Monday, the whole job in one call', async ({ page }) => {
    // Hugo and Liam booked per day Thu + Fri; Priya on one spanning row.
    const rows = perDayRows([D.THU, D.FRI], CREW4.slice(0, 2));
    rows.push({ ...rows[0], assignment_id: 'mm-priya-span', user_id: 'u-priya', crew_name: 'Priya', assigned_to: 'Priya',
      scheduled_date: D.THU, scheduled_end: D.FRI, duration_days: 2 });
    const { writes, state } = await bootCalendar(page, { events: rows, users: CREW4 });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.MON2 + '"]'));

    await expect.poll(() => writes.filter((w) => w.action !== 'send_client_update').length).toBe(1);
    expect(reschedules(writes)[0].body).toMatchObject({ job_id: 'j-mm', mode: 'stretch', edge: 'end', target: D.MON2 });
    expect(writes.some((w) => PER_BOOKING.includes(w.action))).toBe(false);
    // the interior Sat and Sun are breaks; only Monday is added
    await expect(page.getByText('Duration updated')).toBeVisible();
    for (const u of ['u-hugo', 'u-liam']) expect(datesOf(state, u), u).toEqual([D.THU, D.FRI, D.MON2]);
    const priya = state.events.find((e) => e.assignment_id === 'mm-priya-span');
    expect([priya.scheduled_date, priya.scheduled_end]).toEqual([D.THU, D.MON2]);
  });

  test('stretch the start back a day on a multi-crew job: the end holds, every person gains the day', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, { events: perDayRows([D.WED, D.THU], CREW4.slice(0, 3)), users: CREW4 });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.left'), page.locator('.cal-schedule-cell[data-date="' + D.TUE + '"]'));

    // painted at once, for every person
    await expect.poll(() => shownDatesOf(page, 'u-priya'), { timeout: 1000 }).toEqual([D.TUE, D.WED, D.THU]);
    await expect.poll(() => reschedules(writes).length).toBe(1);
    expect(reschedules(writes)[0].body).toMatchObject({ job_id: 'j-mm', mode: 'stretch', edge: 'start', target: D.TUE });
    expect(writes.some((w) => PER_BOOKING.includes(w.action))).toBe(false);
    await expect(page.getByText('Duration updated')).toBeVisible();
    for (const u of CREW4.slice(0, 3)) expect(datesOf(state, u.id), u.name).toEqual([D.TUE, D.WED, D.THU]);
  });

  // The loaded window is today forward for two weeks (to D.MON + 13). A
  // job's bookings past it, or before it, are other bookings: they never
  // stop a bar in view from moving or stretching, and never move with it.
  const MON3 = isoStr(plusDays(monA, 14));
  const FRI0 = isoStr(plusDays(monA, -3));

  test('a job with bookings past the view: its bar\'s end handle stretches that bar only', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, {
      events: perDayRows([D.THU2, MON3], CREW4.slice(0, 2)), users: CREW4, windowOnly: true,
    });
    await toSchedule(page);
    const thu = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await thu.hover();
    await realDrag(page, thu.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + FRI2 + '"]'));
    // each person's one-row Thursday booking now runs Thu to Fri
    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length).toBe(2);
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.action === 'update_assignment').map((w) => [w.body.assignmentId, w.body.scheduled_date, w.body.scheduled_end]).sort())
      .toEqual([['mm-hugo-0', D.THU2, FRI2], ['mm-liam-0', D.THU2, FRI2]]);
    expect(writes.some((w) => w.action === 'create_assignment' || w.action === 'delete_assignment')).toBe(false);
    await expect(page.locator('body')).not.toContainText('runs past the calendar view');
    expect(state.events.filter((e) => e.scheduled_date === MON3)).toHaveLength(2);
  });

  test('a job with a booking before the view: the bar in view moves alone', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, {
      events: perDayRows([FRI0, D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4, windowOnly: true,
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length).toBe(4);
    await page.waitForTimeout(300);
    await expect(page.locator('body')).not.toContainText('runs past the calendar view');
    expect(datesOf(state, 'u-hugo')).toEqual([FRI0, D.WED, D.THU]);
    expect(datesOf(state, 'u-liam')).toEqual([FRI0, D.WED, D.THU]);
  });

  // Michael Johnson SWP-26183, 27 Oct 2026: unfinished bookings weeks
  // earlier, out of view, refused the drag of its 28 Oct booking.
  test('a booking whose job has old unfinished days out of view drags on its own', async ({ page }) => {
    const longAgo = [isoStr(plusDays(monA, -49)), isoStr(plusDays(monA, -35))];
    const rows = perDayRows(longAgo, CREW4.slice(0, 2)).concat(perDayRows([D.WED], CREW4.slice(0, 1)).map((e) => ({ ...e, assignment_id: 'mm-hugo-now' })));
    const { writes, state } = await bootCalendar(page, { events: rows, users: CREW4, windowOnly: true });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.THU + '"]'));
    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length).toBe(1);
    await page.waitForTimeout(300);
    expect(writes.find((w) => w.action === 'update_assignment').body).toMatchObject({ assignmentId: 'mm-hugo-now', scheduled_date: D.THU, scheduled_end: D.THU });
    await expect(page.locator('body')).not.toContainText('runs past the calendar view');
    // its old days are past, so this is the next visit and the client text starts ticked
    await expect(page.locator('#calReschedClient')).toBeChecked();
    expect(datesOf(state, 'u-hugo')).toEqual([longAgo[0], longAgo[1], D.THU]);
    expect(datesOf(state, 'u-liam')).toEqual(longAgo);
  });

  test('a second drop while the first is still reading the job is refused, never planned over its stand-ins', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 1)), users: CREW4, holdJobRead: true,
    });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    // the first drop is still waiting on the job read: nothing painted yet
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.THU + '"]'));
    await expect(page.getByText('Still saving the last change to this job')).toBeVisible();
    state.releaseJobRead();
    await expect.poll(() => reschedules(writes).length).toBe(1);
    await expect(page.getByText('Duration updated')).toBeVisible();
    await page.waitForTimeout(300);
    // only the first drop's stretch was sent
    expect(writes.map((w) => w.action)).toEqual(['reschedule_job_bookings']);
    expect(reschedules(writes)[0].body).toMatchObject({ mode: 'stretch', edge: 'end', target: D.WED });
  });

  test('a calendar reload drops the job reads a drag kept, so the next drag plans over today\'s bookings', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, { events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4 });
    await toSchedule(page);
    // a drop back on the job's own first day changes nothing, but reads the job
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.MON + '"]'));
    await expect.poll(() => page.evaluate(() => !!(_calJobRowsCache['j-mm'] && _calJobRowsCache['j-mm'].rows))).toBe(true);
    // another edit removes Liam's Tuesday, and the page reloads the calendar as every such write does
    state.events = state.events.filter((e) => e.assignment_id !== 'mm-liam-1');
    await page.evaluate(() => loadCalendar());
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first()).toBeVisible();
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    // planned over a stale read, Liam's removed Tuesday would make the bar
    // part of the job and send a write for it; read again, it is the whole job
    await expect.poll(() => reschedules(writes).length).toBe(1);
    await page.waitForTimeout(300);
    expect(writes.some((w) => PER_BOOKING.includes(w.action))).toBe(false);
    expect(reschedules(writes)[0].body).toMatchObject({ job_id: 'j-mm', mode: 'move', new_start: D.WED });
    expect(datesOf(state, 'u-hugo')).toEqual([D.WED, D.THU]);
    expect(datesOf(state, 'u-liam')).toEqual([D.WED]);
  });

  test('a booking just added is never acted on under its stand-in id before the calendar is read again', async ({ page }) => {
    // The stand-in lasts as long as the slow read; long enough for the steps below on a busy runner.
    test.setTimeout(40000);
    const { writes } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 1)), users: CREW4, keepCreates: true, refreshDelayMs: 8000,
    });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => reschedules(writes).length).toBe(1);
    await expect(page.getByText('Duration updated')).toBeVisible();
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    await page.evaluate(() => closeConfirmModal());
    // the added Wednesday is painted under a stand-in until the slow read lands
    await page.locator('#btnViewCrew').click();
    const added = page.locator('.cal-swim-cell[data-date="' + D.WED + '"][data-crew="Hugo"] .cal-job-block');
    await expect(added).toHaveCount(1);
    await realDrag(page, added, page.locator('.cal-swim-cell[data-date="' + D.FRI + '"][data-crew="Hugo"]'));
    await expect(page.getByText('Still saving that booking - try again in a moment')).toBeVisible();
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.action === 'update_assignment')).toHaveLength(0);
    // once the read lands the real row replaces it
    await expect.poll(() => page.evaluate(() => window._calEvents.filter((e) => e.job_id === 'j-mm')
      .map((e) => e.assignment_id).sort()), { timeout: 15000 }).toEqual(['mm-hugo-0', 'mm-hugo-1', 'new-1']);
  });

  test('a failed read after a save takes the stand-ins off the grid and says so', async ({ page }) => {
    const { writes } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 1)), users: CREW4, keepCreates: true, refreshFails: true,
    });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => reschedules(writes).length).toBe(1);
    await expect(page.getByText('Saved, but the calendar could not refresh. Reload it to see every booking.')).toBeVisible();
    expect(await page.evaluate(() => window._calEvents.some((e) => String(e.assignment_id).startsWith('pending-')))).toBe(false);
  });

  test('pull the end in: the dropped day is removed for every person', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, { events: perDayRows([D.MON, D.TUE, D.WED], CREW4.slice(0, 2)), users: CREW4 });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.TUE + '"]'));
    await expect.poll(() => reschedules(writes).length).toBe(1);
    expect(reschedules(writes)[0].body).toMatchObject({ job_id: 'j-mm', mode: 'stretch', edge: 'end', target: D.TUE });
    expect(writes.some((w) => PER_BOOKING.includes(w.action))).toBe(false);
    await expect(page.getByText('Duration updated')).toBeVisible();
    expect(datesOf(state, 'u-hugo')).toEqual([D.MON, D.TUE]);
    expect(datesOf(state, 'u-liam')).toEqual([D.MON, D.TUE]);
  });

  // The whole job in ONE all-or-nothing call (ops-api reschedule_job_bookings,
  // owner's go 28 Oct 2026): Milan Mall, 4 crew x 4 days, was 16 saves one
  // after another, and a failure partway left the job half moved.
  test('Milan Mall, 4 crew x 4 days: the whole job moves with one call, painted at once, confirmed by a fresh job_bookings read', async ({ page }) => {
    const { writes, texts, state } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE, D.WED, D.THU]), users: CREW4, writeDelayMs: 1500,
    });
    await toSchedule(page);
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]')).toHaveCount(1);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.MON2 + '"]'));

    // on screen at once, and the reschedule step opens while the one save runs
    await expect.poll(() => shownDatesOf(page, 'u-nina'), { timeout: 1000 }).toEqual([D.MON2, D.TUE2, D.WED2, D.THU2]);
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/, { timeout: 1000 });
    await expect(page.locator('#calReschedClient')).toBeChecked();
    await page.locator('#confirmModalProceed').click();
    await expect(page.locator('#confirmModalProceed')).toHaveText('Saving...');
    expect(texts).toHaveLength(0);

    // the texts go once the one call has landed, about the saved days
    await expect.poll(() => texts.length, { timeout: 10000 }).toBe(3);
    expect(writes.filter((w) => w.action !== 'send_client_update').map((w) => w.action)).toEqual(['reschedule_job_bookings']);
    expect(reschedules(writes)[0].body).toMatchObject({ job_id: 'j-mm', mode: 'move', new_start: D.MON2 });
    const client = writes.filter((w) => w.action === 'send_client_update');
    expect(client).toHaveLength(1);
    expect(client[0].body).toMatchObject({ job_id: 'j-mm', comms_trigger: 'install_rescheduled', template_vars: { new_date: D.MON2 } });
    for (const u of CREW4) expect(datesOf(state, u.id), u.name).toEqual([D.MON2, D.TUE2, D.WED2, D.THU2]);
    await expect(page.getByText('Rescheduled', { exact: true })).toBeVisible();
    // the clash check read job_detail; one fresh job_bookings read confirmed the whole job
    expect(state.reads.job_detail).toBeGreaterThan(0);
    expect(state.reads.job_bookings).toBe(1);
  });

  test('a meeting on the job past the loaded window is not crew work: the job still moves whole and no text names its day', async ({ page }) => {
    // Hugo also has a site meeting on the job three weeks out, which only the
    // job read carries. It is its own line: it never makes the bar part of the
    // job and never appears in Hugo's days.
    const MEET = isoStr(plusDays(monA, 21));
    const { writes, texts, state } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4,
      extraJobRows: [{ id: 'mm-hugo-meet', job_id: 'j-mm', user_id: 'u-hugo', role: 'installer', status: 'scheduled',
        assignment_type: 'meeting', scheduled_date: MEET, scheduled_end: MEET }],
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
    await expect(page.locator('#calReschedClient')).toBeChecked();
    await page.locator('#confirmModalProceed').click();

    await expect.poll(() => texts.length).toBe(2);
    expect(writes.filter((w) => w.action !== 'send_client_update').map((w) => w.action)).toEqual(['reschedule_job_bookings']);
    expect(reschedules(writes)[0].body).toMatchObject({ job_id: 'j-mm', mode: 'move', new_start: D.WED });
    const label = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
    const hugo = texts.find((t) => t.phone === '+61400000001').message;
    expect(hugo).toContain('Your days: ' + [D.WED, D.THU].map(label).join(', '));
    expect(hugo).not.toContain(label(MEET));
    expect(datesOf(state, 'u-hugo')).toEqual([D.WED, D.THU]);
    expect(datesOf(state, 'u-liam')).toEqual([D.WED, D.THU]);
  });

  test('a booking added since the drag read the job is never moved: the bar saves booking by booking', async ({ page }) => {
    // The drag's job read (kept a minute) shows the bar as the whole job, but
    // someone has since booked Liam on Friday. The whole-job call would move
    // that booking too, so the fresh read taken as the save starts sends the
    // bar down its own writes, and Friday stays.
    const { writes, state } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4,
      laterJobRows: [{ id: 'mm-liam-later', job_id: 'j-mm', user_id: 'u-liam', role: 'installer', status: 'scheduled',
        scheduled_date: D.FRI, scheduled_end: D.FRI }],
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length).toBe(4);
    await expect(page.getByText('Rescheduled', { exact: true })).toBeVisible();
    expect(reschedules(writes)).toHaveLength(0);
    expect(writes.filter((w) => w.action === 'update_assignment').map((w) => w.body.assignmentId).sort())
      .toEqual(['mm-hugo-0', 'mm-hugo-1', 'mm-liam-0', 'mm-liam-1']);
    expect(state.reads.job_bookings).toBe(1);
    expect(datesOf(state, 'u-hugo')).toEqual([D.WED, D.THU]);
    expect(datesOf(state, 'u-liam')).toEqual([D.WED, D.THU]);
  });

  test('a whole-job move ops-api refuses (JB409) puts every booking back, says why in words and sends no text', async ({ page }) => {
    const { writes, texts, state } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE]), users: CREW4, writeDelayMs: 1500,
      refuseReschedule: { status: 409, body: {
        error: 'Not changed: that crew member already has a booking on this job on ' + D.THU, code: 'booking_date_taken',
        user_id: 'u-liam', scheduled_date: D.THU, assignment_id: 'mm-liam-1', held_by: 'mm-liam-cancelled',
        constraint: 'job_assignments_job_user_date_key',
      } },
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => shownDatesOf(page, 'u-hugo'), { timeout: 1000 }).toEqual([D.WED, D.THU]);
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/, { timeout: 1000 });
    await page.locator('#confirmModalProceed').click();
    await expect(page.locator('#confirmModalProceed')).toHaveText('Saving...');

    await expect(page.locator('#calReschedSaveFailed')).toHaveText('The move did not save, so no text was sent. The calendar shows what was saved.');
    // the date was taken after the job was read: the toast names the person and day in words
    await expect(page.getByText('Not moved: Liam already has a booking on this job on ' + fmtDate(D.THU) +
      '. The calendar now shows what was saved.')).toBeVisible();
    for (const u of CREW4) await expect.poll(() => shownDatesOf(page, u.id), { message: u.name }).toEqual([D.MON, D.TUE]);
    for (const u of CREW4) expect(datesOf(state, u.id), u.name).toEqual([D.MON, D.TUE]);
    await page.locator('#confirmModalProceed').click();
    await page.waitForTimeout(300);
    expect(writes.map((w) => w.action)).toEqual(['reschedule_job_bookings']);
    expect(texts).toHaveLength(0);
  });

  test('a taken date names the person from their booking even when the crew list does not carry them', async ({ page }) => {
    const { writes } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4.slice(0, 1),
      refuseReschedule: { status: 409, body: {
        error: 'Not changed: that crew member already has a booking on this job on ' + D.THU, code: 'booking_date_taken',
        user_id: 'u-liam', scheduled_date: D.THU, assignment_id: 'mm-liam-1', held_by: 'mm-liam-elsewhere',
        constraint: 'job_assignments_job_user_date_key',
      } },
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.getByText('Not moved: Liam already has a booking on this job on ' + fmtDate(D.THU) +
      '. The calendar now shows what was saved.')).toBeVisible();
    expect(writes.map((w) => w.action)).toEqual(['reschedule_job_bookings']);
  });

  test('a stretch on a job ops-api no longer knows (JB404) puts the bar back and says so', async ({ page }) => {
    const { writes, texts } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4,
      refuseReschedule: { status: 404, body: { error: 'Job not found', code: 'job_not_found', job_id: 'j-mm' } },
    });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.getByText('Not changed - Job not found. The calendar now shows what was saved.')).toBeVisible();
    for (const u of CREW4.slice(0, 2)) await expect.poll(() => shownDatesOf(page, u.id), { message: u.name }).toEqual([D.MON, D.TUE]);
    await expect(page.getByText('Duration updated')).toHaveCount(0);
    expect(writes.map((w) => w.action)).toEqual(['reschedule_job_bookings']);
    expect(texts).toHaveLength(0);
  });

  test('a whole-job move ops-api lays out on other days than shown sends no text and shows what was saved', async ({ page }) => {
    const { writes, texts } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4, writeDelayMs: 1500,
      rescheduleAnswer: (answer) => ({ ...answer, to: { start: D.THU, end: D.FRI } }),
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/, { timeout: 1000 });
    await page.locator('#confirmModalProceed').click();
    await expect(page.locator('#confirmModalProceed')).toHaveText('Saving...');
    await expect(page.locator('#calReschedSaveFailed')).toHaveText('The move saved, but not on the days shown, so no text was sent. The calendar shows what was saved.');
    await expect(page.locator('#calConfirmModal')).toContainText('Move saved differently');
    await expect(page.getByText('Saved, but not on the days shown. The calendar now shows what was saved.')).toBeVisible();
    await page.locator('#confirmModalProceed').click();
    await page.waitForTimeout(300);
    expect(writes.map((w) => w.action)).toEqual(['reschedule_job_bookings']);
    expect(texts).toHaveLength(0);
  });
  // The reschedule step opens on the drop, not after the saves. Live ops-api
  // takes 3 to 5 seconds per booking write and a multi-crew, multi-day bar
  // writes in several rounds one after another, so waiting for the saves put the step
  // 10 to 17 seconds after the drop.
  test('the reschedule step opens the moment a multi-crew job is dropped, while its saves are still running', async ({ page }) => {
    test.setTimeout(45000);
    const { writes, texts, state } = await bootCalendar(page, {
      events: perDayRows([D.FRI, D.MON2, D.TUE2, D.THU2]), users: CREW4, writeDelayMs: 1500,
    });
    await toSchedule(page);
    await realDrag(page, bar(page, 'mm-hugo-1'), page.locator('.cal-schedule-cell[data-date="' + D.TUE2 + '"]'));
    const dropped = Date.now();
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/, { timeout: 1000 });
    expect(Date.now() - dropped, 'drop to reschedule step').toBeLessThan(1000);
    await expect(page.locator('#calConfirmModal')).toContainText('Send reschedule update?');
    expect(state.writesAnswered || 0, 'no booking write has been answered yet').toBe(0);
    // the Friday bar is the job's next visit, so the client text for this later bar starts unticked
    await expect(page.locator('#calReschedClient')).not.toBeChecked();

    // A press before the save lands waits for it and sends nothing yet.
    const send = page.locator('#confirmModalProceed');
    await send.click();
    await expect(send).toHaveText('Saving...');
    await expect(send).toBeDisabled();
    expect(writes.filter((w) => w.action === 'send_client_update')).toHaveLength(0);
    expect(texts).toHaveLength(0);

    // Once every write has landed, the crew texts go, about the saved days.
    await expect.poll(() => texts.length, { timeout: 20000 }).toBe(3);
    expect(state.writesAnswered).toBe(8);
    expect(writes.filter((w) => w.action === 'send_client_update')).toHaveLength(0);
    await expect(page.locator('#calConfirmBackdrop')).not.toHaveClass(/open/);
    for (const u of CREW4) expect(datesOf(state, u.id), u.name).toEqual([D.FRI, D.TUE2, D.WED2, D.THU2]);
  });

  test('a save that fails behind a pressed reschedule step sends nothing and puts the job back', async ({ page }) => {
    const { writes, texts } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE]), users: CREW4, writeDelayMs: 800, writeFails: true,
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/, { timeout: 1000 });
    await page.locator('#confirmModalProceed').click();
    await expect(page.locator('#confirmModalProceed')).toHaveText('Saving...');

    await expect(page.locator('#calReschedSaveFailed')).toHaveText('The move did not save, so no text was sent. The calendar shows what was saved.');
    await expect(page.locator('#calConfirmModal')).toContainText('Move not saved');
    await expect.poll(() => page.evaluate(() => window._calEvents.filter((e) => e.job_id === 'j-mm' && e.user_id === 'u-hugo')
      .map((e) => e.scheduled_date).sort())).toEqual([D.MON, D.TUE]);
    await page.locator('#confirmModalProceed').click();
    await expect(page.locator('#calConfirmBackdrop')).not.toHaveClass(/open/);
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.action === 'send_client_update')).toHaveLength(0);
    expect(texts).toHaveLength(0);
  });

  test('a save that fails before any press turns the open step into "not saved"', async ({ page }) => {
    const { writes, texts } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE]), users: CREW4, writeDelayMs: 500, writeFails: true,
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.locator('#calConfirmModal')).toContainText('Send reschedule update?', { timeout: 1000 });
    await expect(page.locator('#calReschedSaveFailed')).toBeVisible();
    await expect(page.locator('#calReschedClient')).toHaveCount(0);
    await page.locator('#confirmModalProceed').click();
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.action === 'send_client_update')).toHaveLength(0);
    expect(texts).toHaveLength(0);
  });

  test('Cancel while the save is still running sends nothing, and the save still lands', async ({ page }) => {
    const { writes, texts, state } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE]), users: CREW4, writeDelayMs: 800,
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/, { timeout: 1000 });
    await page.locator('#confirmModalProceed').click();
    await page.locator('#calConfirmModal .btn-cancel').click();
    await expect.poll(() => state.writesAnswered || 0, { timeout: 10000 }).toBe(1);
    expect(writes.map((w) => w.action)).toEqual(['reschedule_job_bookings']);
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.action === 'send_client_update')).toHaveLength(0);
    expect(texts).toHaveLength(0);
    expect(datesOf(state, 'u-hugo')).toEqual([D.WED, D.THU]);
  });

  // <calendar-job-remove>: Remove takes one person off one day, or clears
  // one day; the whole job comes off only from "Remove whole job from
  // calendar" (Captain 2026-10-27).
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayList(dates) {
    const groups = [];
    dates.forEach((ds) => {
      const d = new Date(ds + 'T00:00:00'), m = MONTHS[d.getMonth()], last = groups[groups.length - 1];
      if (last && last.m === m) last.days.push(d.getDate()); else groups.push({ m, days: [d.getDate()] });
    });
    return groups.map((g) => g.days.join(', ') + ' ' + g.m).join(', ');
  }
  const ghostRows = (days) => days.map((day, di) => ({
    id: 'mm-ghost-' + di, job_id: 'j-mm', user_id: 'u-shaun', role: 'observer', is_ghost: true,
    status: 'scheduled', scheduled_date: day, scheduled_end: day,
  }));
  async function openRemoveMenu(page, block) {
    await block.click();
    await expect(page.locator('#calJobPopup')).toHaveClass(/open/);
    await page.locator('#calJobPopup .btn-overflow').click();
    return page.locator('#calJobPopup .cal-popup-overflow');
  }
  const deletedIds = (writes) => writes.filter((w) => w.action === 'delete_assignment').map((w) => w.body.assignmentId).sort();

  test('Remove on a Schedule bar offers each person on that day, the day, and the whole job by name', async ({ page }) => {
    const days = [D.MON, D.WED, D.FRI];
    const { writes, state } = await bootCalendar(page, { events: perDayRows(days), users: CREW4, extraJobRows: ghostRows(days) });
    await toSchedule(page);
    const menu = await openRemoveMenu(page, bar(page, 'mm-hugo-1'));
    const wed = await page.evaluate((d) => fmtDate(d), D.WED);
    await expect(menu.locator('[data-remove="person"]')).toHaveText(['Hugo', 'Liam', 'Nina', 'Priya'].map((n) => 'Remove ' + n + ' from ' + wed));
    await expect(menu.locator('[data-remove="day"]')).toHaveText('Clear ' + wed + ' (everyone)');
    await expect(menu.locator('[data-remove="job"]')).toHaveText('Remove whole job from calendar');

    await menu.locator('[data-remove="person"]', { hasText: 'Liam' }).click();
    const modal = page.locator('#calConfirmModal');
    await expect(modal).toContainText('Take Liam off Milan Mall SWP-26595 on ' + wed + '?');
    await expect(page.locator('#calRemoveKeeps')).toHaveText('Everyone else that day, and every other day of this job, stays.');
    expect(writes.filter((w) => w.action === 'delete_assignment')).toHaveLength(0);
    await page.locator('#confirmModalProceed').click();
    await expect.poll(() => deletedIds(writes)).toEqual(['mm-liam-1']);
    await expect(page.getByText('Removed Liam from Milan Mall SWP-26595 on ' + wed)).toBeVisible();
    await page.waitForTimeout(300);
    expect(deletedIds(writes)).toEqual(['mm-liam-1']);
    expect(state.events.filter((e) => e.job_id === 'j-mm')).toHaveLength(11);
    expect(datesOf(state, 'u-liam')).toEqual([D.MON, D.FRI]);
    expect(datesOf(state, 'u-hugo')).toEqual(days);
  });

  test('Clear a day takes everyone off that day and leaves every other day', async ({ page }) => {
    const days = [D.MON, D.WED, D.FRI];
    const { writes, state } = await bootCalendar(page, { events: perDayRows(days), users: CREW4, extraJobRows: ghostRows(days), deleteDelayMs: 1500 });
    await toSchedule(page);
    const menu = await openRemoveMenu(page, bar(page, 'mm-hugo-1'));
    await menu.locator('[data-remove="day"]').click();
    const wed = await page.evaluate((d) => fmtDate(d), D.WED);
    await expect(page.locator('#calConfirmModal')).toContainText('Clear ' + wed + ' on Milan Mall SWP-26595: Hugo, Liam, Nina, Priya?');
    await expect(page.locator('#calRemoveKeeps')).toHaveText('Every other day of this job stays.');
    await page.locator('#confirmModalProceed').click();
    // the day comes off on the press, while the deletes are still answering
    await expect(bar(page, 'mm-hugo-1')).toHaveCount(0, { timeout: 500 });
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]')).toHaveCount(2);
    await expect.poll(() => deletedIds(writes), { timeout: 5000 }).toEqual(['mm-hugo-1', 'mm-liam-1', 'mm-nina-1', 'mm-priya-1']);
    // the last booking leaving the day goes once the others are answered, so ops-api sees the day emptied once
    expect(writes.filter((w) => w.action === 'delete_assignment').map((w) => w.answeredBefore)).toEqual([0, 0, 0, 3]);
    await expect(page.getByText('Removed Milan Mall SWP-26595 on ' + wed)).toBeVisible({ timeout: 5000 });
    // the watcher rows are ops-api's to drop once nobody is on the day
    expect(writes.some((w) => w.action === 'delete_assignment' && w.body.assignmentId.startsWith('mm-ghost'))).toBe(false);
    for (const u of CREW4) expect(datesOf(state, u.id), u.name).toEqual([D.MON, D.FRI]);
  });

  test('Remove whole job from calendar, chosen by name, takes every booking off: every crew member, every day, the watcher rows too', async ({ page }) => {
    const days = [D.MON, D.WED, D.THU];
    const { writes, state } = await bootCalendar(page, {
      events: perDayRows(days), users: CREW4, extraJobRows: ghostRows(days), deleteDelayMs: 1500,
    });
    await toSchedule(page);
    const menu = await openRemoveMenu(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first());
    await menu.locator('[data-remove="job"]').click();
    const modal = page.locator('#calConfirmModal');
    await expect(modal).toContainText('Remove the whole job Milan Mall SWP-26595 from the calendar: 12 bookings, 4 crew across ' + dayList(days) + '?');
    await expect(page.locator('#calRemoveJobCrew')).toHaveText('Hugo, Liam, Nina, Priya, every day.');
    await expect(modal).toContainText('Paid (invoiced) days stay.');
    await expect(page.locator('#confirmModalProceed')).toHaveText('Remove whole job');
    expect(writes.filter((w) => w.action === 'delete_assignment')).toHaveLength(0);

    await page.locator('#confirmModalProceed').click();
    // The line comes off on the press, while the deletes are still answering.
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]')).toHaveCount(0, { timeout: 500 });
    await expect(page.locator('#calJobPopup')).not.toHaveClass(/open/);
    await expect.poll(() => writes.filter((w) => w.action === 'delete_assignment').length).toBe(15);
    expect(deletedIds(writes)).toEqual(perDayRows(days).map((e) => e.assignment_id).concat(['mm-ghost-0', 'mm-ghost-1', 'mm-ghost-2']).sort());
    await expect(page.getByText('Removed Milan Mall SWP-26595 from the calendar')).toBeVisible({ timeout: 5000 });
    await expect.poll(() => state.events.filter((e) => e.job_id === 'j-mm').length).toBe(0);
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]')).toHaveCount(0);
  });

  test('Remove whole job keeps an invoiced booking the server refuses, names it by person and day, and puts it back', async ({ page }) => {
    const days = [D.MON, D.TUE];
    const { writes } = await bootCalendar(page, {
      events: perDayRows(days, CREW4.slice(0, 2)), users: CREW4,
      refuseDelete: { 'mm-liam-1': 'Booking is on an invoice and cannot be removed' },
    });
    await toSchedule(page);
    const menu = await openRemoveMenu(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first());
    await menu.locator('[data-remove="job"]').click();
    await expect(page.locator('#calConfirmModal')).toContainText('4 bookings, 2 crew across ' + dayList(days));
    await page.locator('#confirmModalProceed').click();
    await expect.poll(() => writes.filter((w) => w.action === 'delete_assignment').length).toBe(4);
    const label = await page.evaluate((d) => fmtDate(d), D.TUE);
    await expect(page.getByText('Removed Milan Mall SWP-26595 from the calendar, except: Liam on ' + label +
      ' (Booking is on an invoice and cannot be removed)')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window._calEvents.filter((e) => e.job_id === 'j-mm').map((e) => e.assignment_id))).toEqual(['mm-liam-1']);
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]')).toHaveCount(1);
  });

  test('a whole-job Remove the server refuses whole puts the job back and says so', async ({ page }) => {
    const days = [D.MON];
    await bootCalendar(page, {
      events: perDayRows(days, CREW4.slice(0, 2)), users: CREW4,
      refuseDelete: { 'mm-hugo-0': 'down', 'mm-liam-0': 'down' },
    });
    await toSchedule(page);
    const menu = await openRemoveMenu(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first());
    await menu.locator('[data-remove="job"]').click();
    await page.locator('#confirmModalProceed').click();
    await expect(page.getByText('Not removed: Milan Mall SWP-26595 - down. The calendar shows what was saved.')).toBeVisible();
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]')).toHaveCount(1);
  });

  test('Remove on one person\'s booking in the Crew view takes only that person off that day', async ({ page }) => {
    const days = [D.MON, D.TUE];
    const { writes, state } = await bootCalendar(page, { events: perDayRows(days, CREW4.slice(0, 2)), users: CREW4 });
    const menu = await openRemoveMenu(page, page.locator('.cal-swim-cell[data-date="' + D.MON + '"][data-crew="Hugo"] .cal-job-block'));
    const mon = await page.evaluate((d) => fmtDate(d), D.MON);
    // the clicked person only, then the day and the whole job
    await expect(menu.locator('[data-remove="person"]')).toHaveText(['Remove Hugo from ' + mon]);
    await expect(menu.locator('[data-remove="day"]')).toHaveText('Clear ' + mon + ' (everyone)');
    await menu.locator('[data-remove="person"]').click();
    await expect(page.locator('#calConfirmModal')).toContainText('Take Hugo off Milan Mall SWP-26595 on ' + mon + '?');
    await page.locator('#confirmModalProceed').click();
    await expect.poll(() => deletedIds(writes)).toEqual(['mm-hugo-0']);
    await page.waitForTimeout(300);
    expect(deletedIds(writes)).toEqual(['mm-hugo-0']);
    expect(datesOf(state, 'u-hugo')).toEqual([D.TUE]);
    expect(datesOf(state, 'u-liam')).toEqual([D.MON, D.TUE]);
    await expect(page.locator('.cal-swim-cell[data-date="' + D.MON + '"][data-crew="Hugo"] .cal-job-block')).toHaveCount(0);
    await expect(page.locator('.cal-swim-cell[data-date="' + D.MON + '"][data-crew="Liam"] .cal-job-block')).toHaveCount(1);
  });

  // Michael Johnson SWP-26183: Isaac and Henry on an old day, Isaac alone on
  // a day in view. Removing Isaac from the day in view leaves the old day,
  // both of them, exactly as it was.
  test('Remove one person from a day in view never touches the job\'s old bookings out of view', async ({ page }) => {
    const old = isoStr(plusDays(monA, -49));
    const rows = perDayRows([old], CREW4.slice(0, 2)).concat(perDayRows([D.WED], CREW4.slice(0, 1)).map((e) => ({ ...e, assignment_id: 'mm-hugo-now' })));
    const { writes, state } = await bootCalendar(page, { events: rows, users: CREW4, windowOnly: true });
    const menu = await openRemoveMenu(page, page.locator('.cal-swim-cell[data-date="' + D.WED + '"][data-crew="Hugo"] .cal-job-block'));
    // one person on the day: no separate Clear
    await expect(menu.locator('[data-remove="day"]')).toHaveCount(0);
    await menu.locator('[data-remove="person"]').click();
    await page.locator('#confirmModalProceed').click();
    await expect.poll(() => deletedIds(writes)).toEqual(['mm-hugo-now']);
    await page.waitForTimeout(300);
    expect(deletedIds(writes)).toEqual(['mm-hugo-now']);
    expect(datesOf(state, 'u-hugo')).toEqual([old]);
    expect(datesOf(state, 'u-liam')).toEqual([old]);
  });
});

test.describe('One booking, one crew member (Crew view)', () => {
  test('Remove a person from the middle day of a longer booking keeps the days either side, the rest sent quietly', async ({ page }) => {
    const { writes } = await bootCalendar(page);
    await page.locator('.cal-swim-cell[data-date="' + D.TUE + '"][data-crew="Hugo"] .cal-job-block').click();
    await page.locator('#calJobPopup .btn-overflow').click();
    const tue = await page.evaluate((d) => fmtDate(d), D.TUE);
    await page.locator('#calJobPopup [data-remove="person"]', { hasText: 'Remove Hugo from ' + tue }).click();
    await expect(page.locator('#calConfirmModal')).toContainText('Take Hugo off Jane Citizen SWF-101 on ' + tue + '?');
    await page.locator('#confirmModalProceed').click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes.find((w) => w.action === 'update_assignment').body).toMatchObject({ assignmentId: 'a-jane', scheduled_date: D.MON, scheduled_end: D.MON, duration_days: 1 });
    // the rest is booked only once the shortened booking has landed
    expect(writes.find((w) => w.action === 'create_assignment').answeredBefore).toBe(1);
    expect(writes.find((w) => w.action === 'create_assignment').body).toMatchObject({
      jobId: 'j-1', userId: 'u-hugo', scheduledDate: D.WED, scheduledEnd: D.WED, durationDays: 1, suppress_notifications: true,
    });
    expect(writes.some((w) => w.action === 'delete_assignment')).toBe(false);
    await expect(page.getByText('Removed Hugo from Jane Citizen SWF-101 on ' + tue)).toBeVisible();
  });

  test('a refused shorten books nothing more, so the person is never booked twice', async ({ page }) => {
    const { writes } = await bootCalendar(page, { writeDelayMs: 300, writeFails: true });
    await page.locator('.cal-swim-cell[data-date="' + D.TUE + '"][data-crew="Hugo"] .cal-job-block').click();
    await page.locator('#calJobPopup .btn-overflow').click();
    await page.locator('#calJobPopup [data-remove="person"]').click();
    await page.locator('#confirmModalProceed').click();
    const tue = await page.evaluate((d) => fmtDate(d), D.TUE);
    await expect(page.getByText('Not removed: Hugo from Jane Citizen SWF-101 on ' + tue + ' - database unavailable')).toBeVisible();
    await page.waitForTimeout(300);
    expect(writes.map((w) => w.action)).toEqual(['update_assignment']);
    await expect.poll(() => page.evaluate(() => window._calEvents.filter((e) => e.job_id === 'j-1')
      .map((e) => [e.scheduled_date, e.scheduled_end]))).toEqual([[D.MON, D.WED]]);
  });

  test('Clear a day across two longer bookings: one refused shorten never drops the other person\'s later days', async ({ page }) => {
    const job = fixtureEvents()[0];
    const events = [
      { ...job, assignment_id: 'a-hugo', scheduled_date: D.MON, scheduled_end: D.FRI, duration_days: 5 },
      { ...job, assignment_id: 'a-liam', user_id: 'u-liam', crew_name: 'Liam', assigned_to: 'Liam', scheduled_date: D.MON, scheduled_end: D.FRI, duration_days: 5 },
    ];
    const { writes } = await bootCalendar(page, { events, refuseUpdate: { 'a-liam': 'Booking is on an invoice and cannot be changed' } });
    await page.locator('.cal-swim-cell[data-date="' + D.WED + '"][data-crew="Hugo"] .cal-job-block').click();
    await page.locator('#calJobPopup .btn-overflow').click();
    await page.locator('#calJobPopup [data-remove="day"]').click();
    await page.locator('#confirmModalProceed').click();
    const wed = await page.evaluate((d) => fmtDate(d), D.WED);
    await expect(page.getByText('Removed Jane Citizen SWF-101 on ' + wed + ', except: Liam on ' + wed + ' (Booking is on an invoice and cannot be changed)')).toBeVisible();
    await page.waitForTimeout(300);
    // Hugo's Thu-Fri is booked back once his own shorten landed; Liam's booking stays whole
    expect(writes.filter((w) => w.action === 'update_assignment').map((w) => w.body.assignmentId).sort()).toEqual(['a-hugo', 'a-liam']);
    const creates = writes.filter((w) => w.action === 'create_assignment').map((w) => w.body);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ userId: 'u-hugo', scheduledDate: D.THU, scheduledEnd: D.FRI, suppress_notifications: true });
  });

  test('the reschedule step opens the moment the booking is dropped, before its save is answered', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, { writeDelayMs: 3000 });
    const src = page.locator('.cal-swim-cell[data-date="' + D.MON + '"][data-crew="Hugo"] .cal-job-block');
    await realDrag(page, src, page.locator('.cal-swim-cell[data-date="' + D.THU + '"][data-crew="Hugo"]'));
    const dropped = Date.now();
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/, { timeout: 1000 });
    expect(Date.now() - dropped, 'drop to reschedule step').toBeLessThan(1000);
    expect(state.writesAnswered || 0).toBe(0);
    await page.locator('#confirmModalProceed').click();
    await expect(page.locator('#confirmModalProceed')).toHaveText('Saving...');
    await expect.poll(() => writes.filter((w) => w.action === 'send_client_update').length, { timeout: 8000 }).toBe(1);
    expect(writes.find((w) => w.action === 'send_client_update').body).toMatchObject({ comms_trigger: 'install_rescheduled', template_vars: { new_date: D.THU } });
  });
});
