// Ops Dash calendar, Schedule view: every week row of day cells must be ruled
// off from the row below it, so a job bar or an "away" strip reads against a
// grid instead of a flat white field.
//
// Regression guard. The between-week line used to be styled with
// `.cal-schedule-week + .cal-schedule-week { border-top: … }`, but
// renderScheduleView emits a bar-overlay div after EVERY week, so two week divs
// are never adjacent siblings — that selector only ever reached the first row
// and a month range rendered six rows with no horizontal separation at all.
// The rule is now drawn by the cell. These assertions read the RENDERED cascade
// and the RENDERED box metrics, not the stylesheet text.
//
// The second half is the no-reflow contract: the border must consume content
// box, never outer box, so adding it moved no cell, no week row and no bar.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

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

// August 2026, week beginning Mon 3 Aug: multi-day bars across three job types
// and crew leave, so the rules are judged on a populated month, not an empty one.
const EVENTS = [
  ev({ job_id: 'j1', assignment_id: 'a1', job_number: 'SWP-27001', client_name: 'Alice Adams',
       scheduled_date: '2026-08-04', scheduled_end: '2026-08-06', crew_name: 'Hugo' }),
  ev({ job_id: 'j2', assignment_id: 'a2', job_number: 'SWF-27002', client_name: 'Bob Baker',
       job_type: 'fencing', scheduled_date: '2026-08-05', scheduled_end: '2026-08-07', crew_name: 'Isaac' }),
  ev({ job_id: 'j3', assignment_id: 'a3', job_number: 'SWP-27003', client_name: 'Cara Chen',
       confirmation_status: 'confirmed', scheduled_date: '2026-08-11', scheduled_end: '2026-08-13', crew_name: 'Shaun' }),
  ev({ job_id: 'j4', assignment_id: 'a4', job_number: 'SWD-27004', client_name: 'Dan Diaz',
       job_type: 'decking', scheduled_date: '2026-08-18', scheduled_end: '2026-08-19', crew_name: 'Henry' }),
];
const LEAVE = { '2026-08-12': ['Shaun'], '2026-08-13': ['Shaun'], '2026-08-19': ['Henry'] };

async function measure(page, { view, range }) {
  return page.evaluate(({ view, range, EVENTS, LEAVE }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    container.style.width = '1400px';
    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = range;
    window._calViewMode = view;
    window._calEvents = EVENTS;
    window._crewList = [
      { id: 'u1', name: 'Hugo', role: 'crew', division: 'patio' },
      { id: 'u3', name: 'Shaun', role: 'lead_installer', division: 'patio' },
      { id: 'u4', name: 'Henry', role: 'lead_installer', division: 'fencing' },
    ];
    window._calLeaveByDate = LEAVE;
    window._calAvailability = {};
    window._calReadiness = {};
    window._calDeliveries = [];
    window._calDivFilter = 'all';
    window._calDivFilters = ['all'];
    window._calEventFilters = { jobs: true, meetings: true, holidays: true, leave: true, reminders: true };
    if (view === 'schedule') window.renderScheduleView(container, window.getCalRange());
    else window.renderSwimlaneView(container, window.getCalRange());

    const round = (n) => Math.round(n * 100) / 100;
    const rect = (el) => { const b = el.getBoundingClientRect(); return { x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height) }; };
    const token = getComputedStyle(document.documentElement).getPropertyValue('--sw-border').trim();
    const probe = document.createElement('div');
    probe.style.color = token;
    document.body.appendChild(probe);
    const tokenRgb = getComputedStyle(probe).color;
    probe.remove();

    const grid = container.querySelector('.cal-schedule-grid');
    const weeks = grid ? [...grid.querySelectorAll(':scope > .cal-schedule-week')] : [];
    // The header row is itself a .cal-schedule-week; the day rows are the rest.
    const dayRows = weeks.filter((w) => !w.querySelector('.cal-schedule-header'));

    return {
      tokenRgb,
      grid: grid ? rect(grid) : null,
      rows: dayRows.map((row) => {
        const cells = [...row.querySelectorAll('.cal-schedule-cell')];
        return {
          rect: rect(row),
          cells: cells.map((c) => {
            const cs = getComputedStyle(c);
            return {
              rect: rect(c),
              boxSizing: cs.boxSizing,
              borderBottom: cs.borderBottomWidth,
              borderBottomColor: cs.borderBottomColor,
              borderRight: cs.borderRightWidth,
              borderRightColor: cs.borderRightColor,
              // content box height: what the cell has left to lay children in
              clientHeight: c.clientHeight,
              outside: c.classList.contains('outside'),
              weekend: c.classList.contains('weekend'),
              opacity: cs.opacity,
              background: cs.backgroundColor,
            };
          }),
        };
      }),
      bars: [...container.querySelectorAll('.cal-schedule-bar')].map((b) => ({
        asg: b.getAttribute('data-assignment-id'), ...rect(b),
      })),
    };
  }, { view, range, EVENTS, LEAVE });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function');
  await revealOpsStaticFixture(page);
});

test('month Schedule view rules every week row off from the one below it', async ({ page }) => {
  const m = await measure(page, { view: 'schedule', range: 'month' });
  expect(m.rows.length).toBe(6);

  // Every row except the last carries a 1px rule in the shared border colour.
  const interior = m.rows.slice(0, -1);
  for (const [i, row] of interior.entries()) {
    for (const [j, cell] of row.cells.entries()) {
      expect(cell.borderBottom, `week row ${i} cell has no horizontal rule`).toBe('1px');
      expect(cell.borderBottomColor).toBe(m.tokenRgb);
      // same weight and colour as the vertical rule it meets. Sunday is the
      // row's last cell and deliberately has none — the grid border is there.
      const lastInRow = j === row.cells.length - 1;
      expect(cell.borderRight).toBe(lastInRow ? '0px' : '1px');
      if (!lastInRow) expect(cell.borderRightColor).toBe(m.tokenRgb);
    }
  }

  // The last row sits directly inside the grid's own border: a rule there
  // separates nothing and would thicken that one edge.
  for (const cell of m.rows[m.rows.length - 1].cells) {
    expect(cell.borderBottom).toBe('0px');
  }
});

test('the rule consumes content box, so no cell, week row or bar moved', async ({ page }) => {
  const m = await measure(page, { view: 'schedule', range: 'month' });

  for (const row of m.rows) {
    for (const cell of row.cells) {
      // min-height is 90 and box-sizing is border-box, so the 1px rule eats
      // content box: the cell's OUTER box is the same 90px it was without it.
      expect(cell.boxSizing).toBe('border-box');
      expect(cell.rect.h).toBe(90);
      expect(cell.clientHeight).toBe(90 - (cell.borderBottom === '1px' ? 1 : 0));
    }
    // A row is its cells plus only the border-top it already had (the retained
    // adjacent-sibling rule reaches the first day row, under the header).
    expect([90, 91]).toContain(row.rect.h);
  }

  // Rows stack flush: each row's top is the previous row's bottom, no gaps.
  for (let i = 1; i < m.rows.length; i++) {
    expect(m.rows[i].rect.y).toBeCloseTo(m.rows[i - 1].rect.y + m.rows[i - 1].rect.h, 1);
  }
  // Grid height is still its 2px border + header + the six stacked rows.
  const rowsH = m.rows.reduce((a, r) => a + r.rect.h, 0);
  const headerH = m.grid.h - 4 - rowsH;
  expect(headerH).toBeGreaterThan(0);
  expect(m.grid.h).toBe(4 + headerH + rowsH);

  // Bars are still laid out on the day columns they span.
  expect(m.bars.length).toBeGreaterThan(0);
  for (const bar of m.bars) {
    expect(bar.h).toBeGreaterThan(0);
    expect(bar.w).toBeGreaterThan(0);
  }
});

test('the rule does not disturb weekend, out-of-month or today tints', async ({ page }) => {
  const m = await measure(page, { view: 'schedule', range: 'month' });
  const all = m.rows.flatMap((r) => r.cells);

  const outside = all.filter((c) => c.outside);
  const inside = all.filter((c) => !c.outside);
  expect(outside.length).toBeGreaterThan(0);
  // Out-of-month cells stay dimmed, which is why their rule reads lighter.
  for (const c of outside) expect(Number(c.opacity)).toBeCloseTo(0.5, 2);
  for (const c of inside) expect(Number(c.opacity)).toBe(1);

  const weekend = inside.filter((c) => c.weekend);
  const weekday = inside.filter((c) => !c.weekend);
  expect(weekend.length).toBeGreaterThan(0);
  expect(weekend[0].background).not.toBe(weekday[0].background);
});

for (const range of ['2w', '1w']) {
  test(`${range} Schedule view shares the cell rule and the same geometry`, async ({ page }) => {
    const m = await measure(page, { view: 'schedule', range });
    expect(m.rows.length).toBe(range === '2w' ? 2 : 1);
    for (const row of m.rows) {
      for (const cell of row.cells) {
        expect(cell.rect.h).toBe(90);
        expect(cell.boxSizing).toBe('border-box');
      }
    }
    // Interior rows are ruled; the last row is not.
    for (const row of m.rows.slice(0, -1)) {
      for (const cell of row.cells) {
        expect(cell.borderBottom).toBe('1px');
        expect(cell.borderBottomColor).toBe(m.tokenRgb);
      }
    }
    for (const cell of m.rows[m.rows.length - 1].cells) expect(cell.borderBottom).toBe('0px');
  });
}
