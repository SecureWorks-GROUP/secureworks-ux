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
  const state = { events: opts.events || fixtureEvents() };
  // { holdJobRead }: every job_detail read waits until the test calls
  // state.releaseJobRead().
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
    if (action === 'job_detail') {
      if (opts.holdJobRead) await jobReadGate;
      const jobId = new URL(url).searchParams.get('jobId');
      return json({
        job: { id: jobId },
        assignments: state.events.filter((e) => e.job_id === jobId).map((e) => ({
          id: e.assignment_id, job_id: e.job_id, user_id: e.user_id, role: 'installer',
          status: e.assignment_status, scheduled_date: e.scheduled_date, scheduled_end: e.scheduled_end,
        })),
      });
    }
    if (action === 'update_assignment') {
      const body = route.request().postDataJSON();
      writes.push({ action, body });
      if (opts.writeDelayMs) await new Promise((r) => setTimeout(r, opts.writeDelayMs));
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
      const body = route.request().postDataJSON();
      writes.push({ action, body });
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
test.describe('Whole job, one booking per person per day (Milan Mall shape)', () => {
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
  async function toSchedule(page) {
    await page.locator('#btnViewSchedule').click();
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first()).toBeVisible();
  }

  test('drag the Friday piece onto Monday: every person moves one working day, painted at once', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, {
      events: perDayRows([D.FRI, D.MON2, D.TUE2, D.THU2]), users: CREW4, writeDelayMs: 1500,
    });
    await toSchedule(page);
    // the Friday piece, before the weekend break
    const friPiece = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await realDrag(page, friPiece, page.locator('.cal-schedule-cell[data-date="' + D.MON2 + '"]'));

    // On screen at once, while the server is still answering, and the grid
    // never blanks to the loading state.
    await expect.poll(() => page.evaluate(() => window._calEvents.filter((e) => e.job_id === 'j-mm' && e.user_id === 'u-hugo')
      .map((e) => e.scheduled_date).sort()), { timeout: 1000 }).toEqual([D.MON2, D.TUE2, D.WED2, FRI2]);
    await expect(page.locator('#calendarBody .cal-loading')).toHaveCount(0);

    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length, { timeout: 15000 }).toBe(16);
    await expect(page.locator('body')).not.toContainText('Not moved');
    for (const u of CREW4) await expect.poll(() => datesOf(state, u.id), { message: u.name }).toEqual([D.MON2, D.TUE2, D.WED2, FRI2]);
    // every write keeps the booking one day long
    expect(writes.filter((w) => w.action === 'update_assignment').every((w) => w.body.scheduled_date === w.body.scheduled_end)).toBe(true);
    // a person's day is never written onto a date another of their rows still holds
    const order = writes.filter((w) => w.action === 'update_assignment').map((w) => w.body.assignmentId);
    // (Tue leaves for Wed before Mon takes Tue, and Mon leaves before Fri takes it)
    expect(order.indexOf('mm-hugo-2')).toBeLessThan(order.indexOf('mm-hugo-1'));
    expect(order.indexOf('mm-hugo-1')).toBeLessThan(order.indexOf('mm-hugo-0'));
    await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);
  });

  test('the reschedule step also offers the crew text: one each, from the office number, naming who has no phone', async ({ page }) => {
    const { writes, texts } = await bootCalendar(page, { events: perDayRows([D.FRI, D.MON2, D.TUE2, D.THU2]), users: CREW4 });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.MON2 + '"]'));
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
    expect(hugo).toContain('Your days: ' + [D.MON2, D.TUE2, D.WED2, FRI2].map(label).join(', '));
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

  test('stretch the end over a weekend: every person gains Monday, new bookings sent quietly', async ({ page }) => {
    // Hugo and Liam booked per day Thu + Fri; Priya on one spanning row.
    const rows = perDayRows([D.THU, D.FRI], CREW4.slice(0, 2));
    rows.push({ ...rows[0], assignment_id: 'mm-priya-span', user_id: 'u-priya', crew_name: 'Priya', assigned_to: 'Priya',
      scheduled_date: D.THU, scheduled_end: D.FRI, duration_days: 2 });
    const { writes } = await bootCalendar(page, { events: rows, users: CREW4 });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.MON2 + '"]'));

    await expect.poll(() => writes.filter((w) => w.action !== 'send_client_update').length).toBe(3);
    const creates = writes.filter((w) => w.action === 'create_assignment').map((w) => w.body);
    expect(creates.map((c) => c.userId).sort()).toEqual(['u-hugo', 'u-liam']);
    for (const c of creates) {
      // the interior Sat and Sun are breaks; only Monday is added
      expect(c).toMatchObject({ jobId: 'j-mm', scheduledDate: D.MON2, scheduledEnd: D.MON2, suppress_notifications: true });
    }
    const priya = writes.find((w) => w.action === 'update_assignment').body;
    expect(priya).toMatchObject({ assignmentId: 'mm-priya-span', scheduled_date: D.THU, scheduled_end: D.MON2, duration_days: 3 });
    expect(writes.some((w) => w.action === 'delete_assignment')).toBe(false);
    await expect(page.getByText('Duration updated')).toBeVisible();
  });

  test('stretch the start back a day on a multi-crew job: the end holds, every person gains the day', async ({ page }) => {
    const { writes } = await bootCalendar(page, { events: perDayRows([D.WED, D.THU], CREW4.slice(0, 3)), users: CREW4, keepCreates: true });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.left'), page.locator('.cal-schedule-cell[data-date="' + D.TUE + '"]'));

    await expect.poll(() => writes.filter((w) => w.action === 'create_assignment').length).toBe(3);
    const creates = writes.filter((w) => w.action === 'create_assignment').map((w) => w.body);
    expect(new Set(creates.map((c) => c.scheduledDate))).toEqual(new Set([D.TUE]));
    expect(creates.every((c) => c.suppress_notifications === true)).toBe(true);
    expect(writes.some((w) => w.action === 'update_assignment' || w.action === 'delete_assignment')).toBe(false);
  });

  // The loaded window is today forward for two weeks (to D.MON + 13). A job
  // whose bookings reach past it must never be planned from the edge that is
  // only the window's.
  const MON3 = isoStr(plusDays(monA, 14));
  const FRI0 = isoStr(plusDays(monA, -3));

  test('a job running past the view: its end handle refuses rather than removing the days out of sight', async ({ page }) => {
    const { writes } = await bootCalendar(page, {
      events: perDayRows([D.THU2, MON3], CREW4.slice(0, 2)), users: CREW4, windowOnly: true,
    });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + FRI2 + '"]'));
    await expect(page.getByText('Not changed - this job runs past the calendar view; widen the view to change it')).toBeVisible();
    await page.waitForTimeout(300);
    expect(writes).toHaveLength(0);
    // with the job's bookings read, the handle is no longer offered on the
    // window's edge
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"] .cal-resize-handle.right')).toHaveCount(0);
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"] .cal-resize-handle.left')).toHaveCount(1);
  });

  test('a job that started before the view: a move refuses rather than taking the hidden first day as the drop', async ({ page }) => {
    const { writes } = await bootCalendar(page, {
      events: perDayRows([FRI0, D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4, windowOnly: true,
    });
    await toSchedule(page);
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect(page.getByText('Not changed - this job runs past the calendar view; widen the view to change it')).toBeVisible();
    await page.waitForTimeout(300);
    expect(writes).toHaveLength(0);
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
    await expect.poll(() => writes.filter((w) => w.action === 'create_assignment').length).toBe(1);
    await expect(page.getByText('Duration updated')).toBeVisible();
    await page.waitForTimeout(300);
    expect(writes.filter((w) => w.action === 'update_assignment')).toHaveLength(0);
  });

  test('a calendar reload drops the job reads a drag kept, so the next drag plans over today\'s bookings', async ({ page }) => {
    const { writes, state } = await bootCalendar(page, { events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 2)), users: CREW4 });
    await toSchedule(page);
    // a drop back on the job's own first day changes nothing, but reads the job
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.MON + '"]'));
    await expect.poll(() => page.evaluate(() => !!calJobSpanInHand('j-mm'))).toBe(true);
    // another edit removes Liam's Tuesday, and the page reloads the calendar as every such write does
    state.events = state.events.filter((e) => e.assignment_id !== 'mm-liam-1');
    await page.evaluate(() => loadCalendar());
    await expect(page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first()).toBeVisible();
    await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first(),
      page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => writes.filter((w) => w.action === 'update_assignment').length).toBe(3);
    await page.waitForTimeout(300);
    const ids = writes.filter((w) => w.action === 'update_assignment').map((w) => w.body.assignmentId).sort();
    expect(ids).toEqual(['mm-hugo-0', 'mm-hugo-1', 'mm-liam-0']);
  });

  test('a booking just added is never acted on under its stand-in id before the calendar is read again', async ({ page }) => {
    const { writes } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 1)), users: CREW4, keepCreates: true, refreshDelayMs: 4000,
    });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => writes.filter((w) => w.action === 'create_assignment').length).toBe(1);
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
      .map((e) => e.assignment_id).sort()), { timeout: 10000 }).toEqual(['mm-hugo-0', 'mm-hugo-1', 'new-1']);
  });

  test('a failed read after a save takes the stand-ins off the grid and says so', async ({ page }) => {
    const { writes } = await bootCalendar(page, {
      events: perDayRows([D.MON, D.TUE], CREW4.slice(0, 1)), users: CREW4, keepCreates: true, refreshFails: true,
    });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.WED + '"]'));
    await expect.poll(() => writes.filter((w) => w.action === 'create_assignment').length).toBe(1);
    await expect(page.getByText('Saved, but the calendar could not refresh. Reload it to see every booking.')).toBeVisible();
    expect(await page.evaluate(() => window._calEvents.some((e) => String(e.assignment_id).startsWith('pending-')))).toBe(false);
  });

  test('pull the end in: the dropped day is removed for every person', async ({ page }) => {
    const { writes } = await bootCalendar(page, { events: perDayRows([D.MON, D.TUE, D.WED], CREW4.slice(0, 2)), users: CREW4 });
    await toSchedule(page);
    const bar = page.locator('.cal-schedule-bar[data-job-id="j-mm"]').first();
    await bar.hover();
    await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator('.cal-schedule-cell[data-date="' + D.TUE + '"]'));
    await expect.poll(() => writes.filter((w) => w.action === 'delete_assignment').length).toBe(2);
    expect(writes.filter((w) => w.action === 'delete_assignment').map((w) => w.body.assignmentId).sort())
      .toEqual(['mm-hugo-2', 'mm-liam-2']);
    expect(writes.some((w) => w.action === 'create_assignment' || w.action === 'update_assignment')).toBe(false);
  });
});
