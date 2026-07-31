// Ops Dash: an assignment whose scheduled_end falls BEFORE its scheduled_date
// must never silently vanish. Every surface that turns an assignment into a date
// span used to do `end = scheduled_end || scheduled_date` and then sweep
// `day >= start && day <= end`, which matches ZERO days on an inverted row — so
// the job dropped off the Crew view, was left out of conflict counting, and
// disappeared from the make-safe planner while still holding a real assignment.
//
// Companion to ops-schedule-lane-overlap.spec.js, which covers the fourth
// surface (Schedule view). All four now read spans through CalOpsCore.spanEnd,
// which clamps a backwards range to a single-day span at its start date.
const { test, expect } = require('@playwright/test');

// Week of Mon 3 Aug 2026.
const MON = '2026-08-03';
const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const CLASH_DAY = '2026-08-06';

function ev(o) {
  return Object.assign({
    assignment_type: 'install',
    confirmation_status: 'tentative',
    job_type: 'makesafe',
    job_status: 'new',
    site_suburb: 'Balga',
    site_address: '1 Test St',
    start_time: null,
    end_time: null,
    user_id: null,
    crew_name: null,
    assigned_to: null,
    label: null,
    recurrence_group_id: null,
  }, o);
}

// The bad row: starts 6 Aug, "ends" 4 Aug. Both jobs sit on Hugo's 6 Aug, so a
// surface that reads the span honestly also sees a conflict.
const INVERTED = ev({
  job_id: 'job-hicks', assignment_id: 'asg-hicks', job_number: 'SWM-26325',
  client_name: 'Mandy Hicks', site_suburb: 'Balga',
  scheduled_date: CLASH_DAY, scheduled_end: '2026-08-04', crew_name: 'Hugo',
});
const PARTNER = ev({
  job_id: 'job-hoks', assignment_id: 'asg-hoks', job_number: 'SWM-26326',
  client_name: 'Wade Hoks', site_suburb: 'Girrawheen',
  scheduled_date: CLASH_DAY, scheduled_end: CLASH_DAY, crew_name: 'Hugo',
});
const MESSY_EVENTS = [INVERTED, PARTNER];

// Well-formed spans only: the "nothing else changed" baseline. Two jobs share
// Hugo's 4 Aug (one genuine conflict) and one runs clean across 5-7 Aug.
const TIDY_EVENTS = [
  ev({ job_id: 'job-1', assignment_id: 'asg-1', job_number: 'SWM-27001',
       client_name: 'Alice Adams', site_suburb: 'Nollamara',
       scheduled_date: '2026-08-04', scheduled_end: '2026-08-04', crew_name: 'Hugo' }),
  ev({ job_id: 'job-2', assignment_id: 'asg-2', job_number: 'SWM-27002',
       client_name: 'Bob Baker', site_suburb: 'Dianella',
       scheduled_date: '2026-08-04', scheduled_end: '2026-08-04', crew_name: 'Hugo' }),
  ev({ job_id: 'job-3', assignment_id: 'asg-3', job_number: 'SWM-27003',
       client_name: 'Carol Chen', site_suburb: 'Morley',
       scheduled_date: '2026-08-05', scheduled_end: '2026-08-07', crew_name: 'Isaac' }),
];

// Park the calendar on Aug 2026 and hand it a fixed event set. Shared by every
// surface below so all three read exactly the same rows.
async function primeCalendar(page, events) {
  await page.evaluate((evts) => {
    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = 'month';
    window._calViewMode = 'crew';
    window._crewList = [];
    window._calEvents = evts;
    window._calReadiness = {};
    window._calAvailability = {};
    window._calDeliveries = [];
    window._unschedJobs = [];
    window._calShowDone = false;
    window._calTruncated = false;
    window._calDivFilter = 'all';
    window._calDivFilters = ['all'];
    window._calEventFilters = { jobs: true, meetings: true, holidays: false, leave: true, reminders: true };
  }, events);
}

// ── Surface 1: Crew view (renderSwimlaneView) ──
// Returns, per crew row, which job numbers landed in which day cell.
async function renderCrewView(page, events) {
  await primeCalendar(page, events);
  return page.evaluate(() => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    container.style.width = '1400px';
    window.renderSwimlaneView(container, window.getCalRange());

    const cells = {};
    container.querySelectorAll('.cal-swim-cell').forEach((cell) => {
      const blocks = [...cell.querySelectorAll('.cal-job-block')].map((b) => b.textContent.trim());
      if (!blocks.length) return;
      cells[cell.getAttribute('data-crew') + '|' + cell.getAttribute('data-date')] = blocks;
    });
    return {
      cells,
      crewRows: [...container.querySelectorAll('.cal-swim-cell')]
        .map((c) => c.getAttribute('data-crew'))
        .filter((v, i, a) => a.indexOf(v) === i),
      conflictMarkers: [...container.querySelectorAll('.cal-cell-warning.conflict')]
        .map((w) => {
          const cell = w.closest('.cal-swim-cell');
          return cell.getAttribute('data-crew') + '|' + cell.getAttribute('data-date');
        }),
    };
  });
}

// ── Surface 2: calendar summary conflict counter (renderCalSummary) ──
// NOTE: ops.html has no #calSummaryBar node in its markup today, so
// renderCalSummary early-returns in production and the whole summary bar is
// dead UI. That is a separate pre-existing defect, out of scope here; the test
// mounts the node so the counting logic this fix touches is observable.
async function renderSummary(page, events) {
  await primeCalendar(page, events);
  return page.evaluate(() => {
    let bar = document.getElementById('calSummaryBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'calSummaryBar';
      bar.className = 'cal-summary-bar';
      document.body.appendChild(bar);
    }
    bar.innerHTML = '';
    window.renderCalSummary(window.getCalRange());
    const warn = bar.querySelector('.conflict-warn');
    return {
      conflictText: warn ? warn.textContent.trim() : null,
      conflictCount: warn ? parseInt(warn.textContent.replace(/\D+/g, ''), 10) : 0,
    };
  });
}

// ── Surface 3: make-safe crew planner (makesafePlannerEventDates) ──
async function renderPlanner(page, events) {
  await primeCalendar(page, events);
  return page.evaluate(({ evts, week }) => {
    let body = document.getElementById('makesafeCrewDayBody');
    if (!body) {
      body = document.createElement('div');
      body.id = 'makesafeCrewDayBody';
      document.body.appendChild(body);
    }
    body.innerHTML = '';

    const jobsById = {};
    evts.forEach((e) => {
      jobsById[e.job_id] = {
        id: e.job_id, job_number: e.job_number, client_name: e.client_name,
        site_suburb: e.site_suburb, type: 'makesafe', status: 'new',
      };
    });
    window.renderMakesafeCrewWeek({ days: week, events: evts, allMakesafes: [], jobsById: jobsById });

    // The planner's own tally of jobs it managed to place on the grid.
    const liveStat = [...body.querySelectorAll('div')]
      .find((d) => d.textContent.trim() === 'live calendar jobs this week');
    return {
      // the pure span helper, per event, straight from the page
      dates: evts.map((e) => window.makesafePlannerEventDates(e, week)),
      liveCount: liveStat ? Number(liveStat.previousElementSibling.textContent.trim()) : null,
      placedJobNumbers: evts.map((e) => e.job_number).filter((n) => body.textContent.includes(n)),
    };
  }, { evts: events, week: WEEK });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderSwimlaneView === 'function'
    && typeof window.renderCalSummary === 'function'
    && typeof window.makesafePlannerEventDates === 'function');
});

test('crew view still shows a job whose scheduled_end precedes its scheduled_date', async ({ page }) => {
  const { cells, crewRows, conflictMarkers } = await renderCrewView(page, MESSY_EVENTS);

  expect(crewRows, 'Hugo must have a row').toContain('Hugo');
  const key = 'Hugo|' + CLASH_DAY;
  // The symptom: the inverted row matched zero days and left no block at all.
  expect(cells[key], `Hugo's ${CLASH_DAY} cell`).toBeDefined();
  expect(cells[key].join(' | ')).toContain('Mandy Hicks');
  expect(cells[key].join(' | ')).toContain('Wade Hoks');
  // Clamped to a single day at its start — it must not bleed onto other days.
  for (const day of WEEK.filter((d) => d !== CLASH_DAY)) {
    expect(cells['Hugo|' + day], `Hugo|${day} should be empty`).toBeUndefined();
  }
  // Both jobs are now visible on the same crew/day, so the cell warns.
  expect(conflictMarkers).toContain(key);
});

test('conflict counter counts a job whose scheduled_end precedes its scheduled_date', async ({ page }) => {
  const { conflictCount, conflictText } = await renderSummary(page, MESSY_EVENTS);

  // The symptom: the inverted row swept zero days, so Hugo|06 held one job and
  // the clash went uncounted.
  expect(conflictCount, conflictText || 'no conflict pill rendered').toBe(1);
});

test('make-safe planner places a job whose scheduled_end precedes its scheduled_date', async ({ page }) => {
  const { dates, liveCount, placedJobNumbers } = await renderPlanner(page, MESSY_EVENTS);

  // The symptom: makesafePlannerEventDates returned [] for the inverted row.
  expect(dates[0], 'inverted span clamps to its start day').toEqual([CLASH_DAY]);
  expect(dates[1], 'well-formed single day is untouched').toEqual([CLASH_DAY]);
  expect(liveCount, 'live calendar jobs this week').toBe(2);
  expect(placedJobNumbers).toEqual(['SWM-26325', 'SWM-26326']);
});

test('well-formed spans read identically on all three surfaces', async ({ page }) => {
  const crew = await renderCrewView(page, TIDY_EVENTS);
  expect(Object.keys(crew.cells).sort()).toEqual([
    'Hugo|2026-08-04',
    'Isaac|2026-08-05', 'Isaac|2026-08-06', 'Isaac|2026-08-07',
  ]);
  expect(crew.cells['Hugo|2026-08-04'].join(' | ')).toContain('Alice Adams');
  expect(crew.cells['Hugo|2026-08-04'].join(' | ')).toContain('Bob Baker');
  expect(crew.cells['Isaac|2026-08-06'].join(' | ')).toContain('Carol Chen');
  expect(crew.conflictMarkers).toEqual(['Hugo|2026-08-04']);

  const summary = await renderSummary(page, TIDY_EVENTS);
  expect(summary.conflictCount).toBe(1);

  const planner = await renderPlanner(page, TIDY_EVENTS);
  expect(planner.dates).toEqual([
    ['2026-08-04'],
    ['2026-08-04'],
    ['2026-08-05', '2026-08-06', '2026-08-07'],
  ]);
  expect(planner.liveCount).toBe(3);
  expect(planner.placedJobNumbers).toEqual(['SWM-27001', 'SWM-27002', 'SWM-27003']);
});

test('CalOpsCore.spanEnd is a no-op for every well-formed span', async ({ page }) => {
  const out = await page.evaluate(({ mon }) => {
    const spanEnd = window.CalOpsCore.spanEnd;
    return {
      forward: spanEnd({ scheduled_date: mon, scheduled_end: '2026-08-07' }),
      sameDay: spanEnd({ scheduled_date: mon, scheduled_end: mon }),
      missingEnd: spanEnd({ scheduled_date: mon, scheduled_end: null }),
      noEndKey: spanEnd({ scheduled_date: mon }),
      inverted: spanEnd({ scheduled_date: '2026-08-06', scheduled_end: '2026-08-04' }),
      nullEvent: spanEnd(null),
      emptyEvent: spanEnd({}),
    };
  }, { mon: MON });

  expect(out.forward).toBe('2026-08-07');
  expect(out.sameDay).toBe(MON);
  expect(out.missingEnd).toBe(MON);
  expect(out.noEndKey).toBe(MON);
  // The only value the guard changes.
  expect(out.inverted).toBe('2026-08-06');
  // Null-safe: callers that guarded on a missing event keep their old result.
  expect(out.nullEvent == null).toBe(true);
  expect(out.emptyEvent == null).toBe(true);
});
