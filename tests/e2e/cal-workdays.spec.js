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
