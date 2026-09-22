// CP1 — ops calendar working-day (weekend-skip) span math (ops-dash-calendar-
// overhaul · Feature 1).
// ---------------------------------------------------------------------------
// Single source of truth: this spec READS ../../ops.html, extracts the code
// between `// <calendar-ops-core>` and `// </calendar-ops-core>`, and evaluates
// it to obtain the REAL CalOpsCore functions (same pattern as
// trade-app-m2/smoke/cp1-adapter-tests.mjs). The date math is never re-declared
// here — assertions run against the shipped code, so the spec can't drift.
//
// Pure node assertions: no browser, no page, no server.
// Fixture week: 2026-07-20 = Monday … 2026-07-24 = Friday, 25/26 = weekend,
// 2026-07-27 = the following Monday.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const OPS_HTML = resolve(__dirname, '../../ops.html');
const OPEN = '// <calendar-ops-core>';
const CLOSE = '// </calendar-ops-core>';

function extractCore() {
  const html = readFileSync(OPS_HTML, 'utf8');
  const a = html.indexOf(OPEN);
  const b = html.indexOf(CLOSE);
  if (a < 0 || b < 0 || b <= a) throw new Error(`calendar-ops-core sentinels not found in ${OPS_HTML}`);
  // eslint-disable-next-line no-new-func
  return new Function(html.slice(a + OPEN.length, b) + '\n;return CalOpsCore;')();
}

const C = extractCore();

const MON = '2026-07-20', TUE = '2026-07-21', WED = '2026-07-22', THU = '2026-07-23',
      FRI = '2026-07-24', SAT = '2026-07-25', SUN = '2026-07-26',
      MON2 = '2026-07-27', TUE2 = '2026-07-28';

test.describe('CP1 weekend-skip working-day math (extracted from ops.html)', () => {
  test('isWeekendStr: Sat/Sun true, weekdays false', () => {
    expect(C.isWeekendStr(SAT)).toBe(true);
    expect(C.isWeekendStr(SUN)).toBe(true);
    expect(C.isWeekendStr(FRI)).toBe(false);
    expect(C.isWeekendStr(MON)).toBe(false);
  });

  test('layWorkingDays: duration laid forward skipping weekends', () => {
    expect(C.layWorkingDays(MON, 1)).toBe(MON);
    expect(C.layWorkingDays(MON, 5)).toBe(FRI);      // Mon..Fri fits the week
    expect(C.layWorkingDays(MON, 6)).toBe(MON2);     // crosses the weekend
    expect(C.layWorkingDays(FRI, 2)).toBe(MON2);     // Fri +1 working day = Mon
    expect(C.layWorkingDays(THU, 4)).toBe(TUE2);     // Thu,Fri,Mon,Tue
  });

  test('layWorkingDays: a deliberate weekend START counts as day 1', () => {
    expect(C.layWorkingDays(SAT, 1)).toBe(SAT);
    expect(C.layWorkingDays(SAT, 2)).toBe(MON2);     // Sat + (skip Sun) + Mon
  });

  test('paintedSpanDates: weekend-crossing job renders Mon–Fri, breaks, resumes Monday', () => {
    expect(C.paintedSpanDates(MON, MON2)).toEqual([MON, TUE, WED, THU, FRI, MON2]);
  });

  test('paintedSpanDates: endpoint weekends are deliberate and painted; interior weekends never are', () => {
    expect(C.paintedSpanDates(FRI, SAT)).toEqual([FRI, SAT]);        // drawn onto Sat
    expect(C.paintedSpanDates(THU, SUN)).toEqual([THU, FRI, SUN]);   // Sun endpoint, Sat break
    expect(C.paintedSpanDates(FRI, MON2)).toEqual([FRI, MON2]);      // weekend fully skipped
    expect(C.paintedSpanDates(SAT, SAT)).toEqual([SAT]);
  });

  test('workingSpanDays matches the painted count', () => {
    expect(C.workingSpanDays(MON, FRI)).toBe(5);
    expect(C.workingSpanDays(MON, MON2)).toBe(6);
    expect(C.workingSpanDays(FRI, MON2)).toBe(2);
    expect(C.workingSpanDays(FRI, FRI)).toBe(1);
  });
});

test.describe('CP1 buildMovePayloadV2 — drop day = new start, duration preserved in working days', () => {
  const baseEv = {
    assignment_id: 'a1', job_id: 'j1', user_id: 'u1',
    scheduled_date: FRI, scheduled_end: MON2, duration_days: 2,
    start_time: null, end_time: null, assignment_type: 'install',
    crew_name: 'Hugo', role: 'lead_installer', label: null, job_type: 'fencing',
  };

  test('same-crew move: Fri–Mon (2 working days) dropped on Wed becomes Wed–Thu', () => {
    const plan = C.buildMovePayloadV2(baseEv, 'Hugo', 'u1', WED);
    expect(plan.mode).toBe('move');
    expect(plan.update).toEqual({
      assignmentId: 'a1', crew_name: 'Hugo',
      scheduled_date: WED, scheduled_end: THU, duration_days: 2,
    });
  });

  test('the rendered span wins over a stale duration_days default — a visible multi-day bar never collapses', () => {
    const ev = { ...baseEv, scheduled_date: MON, scheduled_end: MON2, duration_days: 1 }; // legacy default 1, bar shows 6
    const plan = C.buildMovePayloadV2(ev, 'Hugo', 'u1', TUE);
    expect(plan.update.duration_days).toBe(6);
    expect(plan.update.scheduled_end).toBe(TUE2); // Tue..Fri + Mon,Tue
  });

  test('duration_days is the duration source when there is no span to read (scheduled_end null)', () => {
    const ev = { ...baseEv, scheduled_date: FRI, scheduled_end: null, duration_days: 3 };
    const plan = C.buildMovePayloadV2(ev, 'Hugo', 'u1', MON);
    expect(plan.update.scheduled_end).toBe(WED); // Mon,Tue,Wed
    expect(plan.update.duration_days).toBe(3);
  });

  test('weekend opt-in: a deliberate Sat drop starts on Sat, then resumes Monday', () => {
    const plan = C.buildMovePayloadV2(baseEv, 'Hugo', 'u1', SAT);
    expect(plan.update.scheduled_date).toBe(SAT);
    expect(plan.update.scheduled_end).toBe(MON2); // Sat + Mon = 2 working days
  });

  test('crew change: reassign path carries the working-day span + duration on the recreate', () => {
    const plan = C.buildMovePayloadV2(baseEv, 'Maya', 'u2', WED);
    expect(plan.mode).toBe('reassign');
    expect(plan.deleteId).toBe('a1');
    expect(plan.create.userId).toBe('u2');
    expect(plan.create.scheduledDate).toBe(WED);
    expect(plan.create.scheduledEnd).toBe(THU);
    expect(plan.create.durationDays).toBe(2);
    expect(plan.create).not.toHaveProperty('confirmationStatus'); // allocation act stays G2
  });

  test('flag-off path still exists: original buildMovePayload is untouched', () => {
    expect(typeof C.buildMovePayload).toBe('function');
    const plan = C.buildMovePayload(baseEv, 'Hugo', 'u1', WED);
    expect(plan.mode).toBe('move');
    expect(plan.update.scheduled_date).toBe(WED);
    expect(plan.update.scheduled_end).toBe(SAT); // old behaviour: calendar-delta shift
  });
});

test.describe('CP1 buildResizePayload — edge drag with weekend-skip duration accounting', () => {
  const ev = { assignment_id: 'a1', scheduled_date: FRI, scheduled_end: FRI };

  test('Friday job pulled one day longer = Fri + Mon (2 working days)', () => {
    expect(C.buildResizePayload(ev, 'end', MON2)).toEqual({
      assignmentId: 'a1', scheduled_date: FRI, scheduled_end: MON2, duration_days: 2,
    });
  });

  test('deliberately drawn onto Saturday: endpoint weekend counts', () => {
    expect(C.buildResizePayload(ev, 'end', SAT)).toEqual({
      assignmentId: 'a1', scheduled_date: FRI, scheduled_end: SAT, duration_days: 2,
    });
  });

  test('start-edge resize holds the end day and recounts working days', () => {
    const multi = { assignment_id: 'a1', scheduled_date: FRI, scheduled_end: MON2 };
    expect(C.buildResizePayload(multi, 'start', WED)).toEqual({
      assignmentId: 'a1', scheduled_date: WED, scheduled_end: MON2, duration_days: 4, // Wed,Thu,Fri,Mon
    });
  });

  test('the span never inverts: targets past the far edge clamp to it', () => {
    expect(C.buildResizePayload(ev, 'end', MON).scheduled_end).toBe(FRI);
    expect(C.buildResizePayload(ev, 'end', MON).duration_days).toBe(1);
    const multi = { assignment_id: 'a1', scheduled_date: WED, scheduled_end: FRI };
    expect(C.buildResizePayload(multi, 'start', MON2).scheduled_date).toBe(FRI);
  });
});

test.describe('CP1 assignment date staging — unique-key collision safety', () => {
  const ev = (id, userId, date, extra = {}) => ({
    assignment_id: id, job_id: 'j1', user_id: userId,
    scheduled_date: date, assignment_type: 'install', ...extra,
  });
  const move = (id, userId, fromDate, toDate, extra = {}) => ({
    assignmentId: id, jobId: 'j1', userId, fromDate, toDate, ...extra,
  });

  test('a one-day forward shift frees the newest row first', () => {
    const events = [
      ev('a1', 'u1', MON), ev('a2', 'u1', TUE), ev('a3', 'u1', WED),
      // A ghost mirror for a different person holds its own key only; it
      // never joins the real crew's move graph.
      ev('ghost', 'shaun', TUE, { role: 'observer', is_ghost: true }),
    ];
    const staged = C.stageCollisionSafeMoves(events, [
      move('a1', 'u1', MON, TUE),
      move('a2', 'u1', TUE, WED),
      move('a3', 'u1', WED, THU),
    ]);
    expect(staged.ordered.map((item) => item.assignmentId)).toEqual(['a3', 'a2', 'a1']);
    expect(staged.skipped).toEqual([]);
  });

  test('an unaffected visit already on the target date is preserved and skipped', () => {
    const staged = C.stageCollisionSafeMoves(
      [ev('source', 'u1', MON), ev('existing', 'u1', WED)],
      [move('source', 'u1', MON, WED)],
    );
    expect(staged.ordered).toEqual([]);
    expect(staged.skipped).toEqual([{ move: move('source', 'u1', MON, WED), conflictAssignmentId: 'existing', reason: 'existing' }]);
  });

  test('a reassignment checks the target user while freeing the source user key', () => {
    const staged = C.stageCollisionSafeMoves(
      [ev('source', 'u1', MON), ev('existing', 'u2', MON)],
      [move('source', null, MON, MON, { sourceUserId: 'u1', targetUserId: 'u2' })],
    );
    expect(staged.ordered).toEqual([]);
    expect(staged.skipped[0].conflictAssignmentId).toBe('existing');
    expect(staged.blockers.map((b) => b.assignmentId)).toEqual(['existing']);
  });

  test('a target held only by a ghost observer mirror is free and the mirror is never a blocker', () => {
    // The ops user is mirrored as an observer on Wed AND holds a real crew row
    // on Mon for the same job. ops-api releases his own mirror off
    // (job,user,date) before writing the real row, so Mon -> Wed proceeds.
    const staged = C.stageCollisionSafeMoves(
      [ev('crew', 'shaun', MON), ev('mirror', 'shaun', WED, { role: 'observer', is_ghost: true })],
      [move('crew', 'shaun', MON, WED)],
    );
    expect(staged.ordered).toEqual([move('crew', 'shaun', MON, WED)]);
    expect(staged.skipped).toEqual([]);
    expect(staged.blockers).toEqual([]);
    expect(staged.collapseOnly).toBe(false);
  });

  test('a real row sharing a key with a ghost mirror still blocks and is the only named holder', () => {
    const staged = C.stageCollisionSafeMoves(
      [
        ev('crew', 'shaun', MON),
        ev('mirror', 'shaun', WED, { role: 'observer', is_ghost: true }),
        ev('existing', 'shaun', WED),
      ],
      [move('crew', 'shaun', MON, WED)],
    );
    expect(staged.ordered).toEqual([]);
    expect(staged.skipped).toEqual([{ move: move('crew', 'shaun', MON, WED), conflictAssignmentId: 'existing', reason: 'existing' }]);
    expect(staged.blockers.map((b) => b.assignmentId)).toEqual(['existing']);
  });

  test('two rows of one bar collapsing onto one date is reported as a collapse, not an existing visit', () => {
    const staged = C.stageCollisionSafeMoves(
      [ev('sat', 'u1', SAT), ev('sun', 'u1', SUN)],
      [move('sat', 'u1', SAT, FRI), move('sun', 'u1', SUN, FRI)],
    );
    expect(staged.ordered.map((item) => item.assignmentId)).toEqual(['sat']);
    expect(staged.skipped.map((item) => [item.move.assignmentId, item.reason])).toEqual([['sun', 'collapse']]);
    expect(staged.blockers).toEqual([]);
    expect(staged.collapseOnly).toBe(true);
  });

  test('a blocked crew chain reports the one genuine holder, never its cascaded candidates', () => {
    // Hugo (u1) and Isaac (u2) both hold Mon..Wed; Isaac also has a separate
    // visit on Fri. Shifting the bar to Wed..Fri blocks Isaac's Wed -> Fri row
    // outright, his Mon -> Wed row then waits on it forever (a cascaded
    // candidate), while his Tue -> Thu row is uncontested. The staging pass
    // therefore reports a PARTIAL ordered set — the caller's all-or-nothing
    // rule is what keeps the job from being torn — and exactly one blocker.
    const events = [
      ev('h0', 'u1', MON), ev('h1', 'u1', TUE), ev('h2', 'u1', WED),
      ev('i0', 'u2', MON), ev('i1', 'u2', TUE), ev('i2', 'u2', WED),
      ev('i-existing', 'u2', FRI),
    ];
    const staged = C.stageCollisionSafeMoves(events, [
      move('h0', 'u1', MON, WED), move('h1', 'u1', TUE, THU), move('h2', 'u1', WED, FRI),
      move('i0', 'u2', MON, WED), move('i1', 'u2', TUE, THU), move('i2', 'u2', WED, FRI),
    ]);
    const ordered = staged.ordered.map((item) => item.assignmentId);
    expect(ordered.sort()).toEqual(['h0', 'h1', 'h2', 'i1']);
    expect(staged.ordered.map((item) => item.assignmentId).indexOf('h2'))
      .toBeLessThan(staged.ordered.map((item) => item.assignmentId).indexOf('h0'));
    expect(staged.skipped.map((item) => item.move.assignmentId).sort()).toEqual(['i0', 'i2']);
    expect(staged.blockers).toEqual([{ assignmentId: 'i-existing', event: events[6] }]);
    expect(staged.collapseOnly, 'a cascade behind a real visit is never reported as a collapse').toBe(false);
  });
});

test.describe('CP1 staging occupancy — job-scoped assignment rows over the loaded window', () => {
  test('job_detail rows fold into the calendar-event shape and win over the window copy', () => {
    const jobRows = C.assignmentRowsToEvents([
      { id: 'a1', user_id: 'u1', scheduled_date: WED + 'T00:00:00+08:00', status: 'scheduled', role: 'installer' },
      { id: 'a9', users: { id: 'u1', name: 'Hugo' }, scheduled_date: FRI },
      { id: 'a-nodate', user_id: 'u1' },
      null,
    ], 'j1');
    expect(jobRows.map((r) => [r.assignment_id, r.job_id, r.user_id, r.scheduled_date, r.crew_name]))
      .toEqual([['a1', 'j1', 'u1', WED, null], ['a9', 'j1', 'u1', FRI, 'Hugo']]);

    const windowEvents = [
      { assignment_id: 'a1', job_id: 'j1', user_id: 'u1', scheduled_date: MON },
      { assignment_id: 'other', job_id: 'j2', user_id: 'u1', scheduled_date: MON },
    ];
    const merged = C.mergeOccupancyEvents(windowEvents, jobRows);
    expect(merged.map((r) => [r.assignment_id, r.scheduled_date]))
      .toEqual([['a1', WED], ['a9', FRI], ['other', MON]]);

    // The fresher job-scoped date is what staging must see: a row the window
    // still shows on Mon has really moved to Wed and blocks a Wed drop.
    const staged = C.stageCollisionSafeMoves(merged, [
      { assignmentId: 'other', jobId: 'j1', userId: 'u1', fromDate: MON, toDate: WED },
    ]);
    expect(staged.blockers.map((b) => b.assignmentId)).toEqual(['a1']);
  });
});
