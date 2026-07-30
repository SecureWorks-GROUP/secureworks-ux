// Ops Dash calendar, Schedule view: job bars must never paint on top of each
// other. Regression guard for the inverted-span bug — an assignment whose
// scheduled_end fell before its scheduled_date was read as "no overlap" by the
// lane packer AND produced a negative CSS width, so the bar auto-sized around
// its own label and superimposed it on its lane-mate.
const { test, expect } = require('@playwright/test');

function ev(o) {
  return Object.assign({
    assignment_type: 'install',
    confirmation_status: 'tentative',
    job_type: 'patio',
    site_suburb: 'Perth',
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

// Week of Mon 3 Aug 2026. The first job's span is inverted (starts 6 Aug, ends
// 4 Aug); the other three are well-formed and overlap it in the same week row.
const COLLIDING_EVENTS = [
  ev({ job_id: 'job-hicks', assignment_id: 'asg-hicks', job_number: 'SWP-26325',
       client_name: 'Mandy Hicks', scheduled_date: '2026-08-06', scheduled_end: '2026-08-04',
       crew_name: 'Hugo' }),
  ev({ job_id: 'job-hoks', assignment_id: 'asg-hoks', job_number: 'SWP-26326',
       client_name: 'Wade Hoks', scheduled_date: '2026-08-05', scheduled_end: '2026-08-07',
       crew_name: 'Isaac' }),
  ev({ job_id: 'job-lisbeth', assignment_id: 'asg-lisbeth', job_number: 'SWF-26647',
       client_name: 'Lisbeth Sonder-Sorensen', job_type: 'fencing',
       scheduled_date: '2026-08-04', scheduled_end: '2026-08-07', crew_name: 'Sam' }),
  ev({ job_id: 'job-brian', assignment_id: 'asg-brian', job_number: 'SWF-26850',
       client_name: 'Brian Mortimer', job_type: 'fencing',
       scheduled_date: '2026-08-06', scheduled_end: '2026-08-08', crew_name: 'Hugo' }),
];

// Well-formed, non-overlapping spans: the "nothing else changed" baseline.
const TIDY_EVENTS = [
  ev({ job_id: 'job-1', assignment_id: 'asg-1', job_number: 'SWP-27001',
       client_name: 'Alice Adams', scheduled_date: '2026-08-04', scheduled_end: '2026-08-05',
       crew_name: 'Hugo' }),
  ev({ job_id: 'job-2', assignment_id: 'asg-2', job_number: 'SWP-27002',
       client_name: 'Bob Baker', scheduled_date: '2026-08-06', scheduled_end: '2026-08-07',
       crew_name: 'Isaac' }),
  ev({ job_id: 'job-3', assignment_id: 'asg-3', job_number: 'SWP-27003',
       client_name: 'Bartholomew Fitzwilliam-Harrington-Smythe III',
       scheduled_date: '2026-08-11', scheduled_end: '2026-08-11', crew_name: 'Sam' }),
];

async function renderSchedule(page, events) {
  return page.evaluate((evts) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    container.style.width = '1400px';

    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = 'month';
    window._calViewMode = 'schedule';
    window._crewList = [];
    window._calReadiness = {};
    window._calDivFilter = 'all';
    window._calDivFilters = ['all'];
    window._calEventFilters = { jobs: true, meetings: true, holidays: false, leave: true, reminders: true };
    window._calEvents = evts;

    window.renderScheduleView(container, window.getCalRange());

    const bars = [...container.querySelectorAll('.cal-schedule-bar')].map((b) => {
      const r = b.getBoundingClientRect();
      const label = b.querySelector('.bar-label');
      const crew = b.querySelector('.bar-crew');
      const lr = label && label.getBoundingClientRect();
      const cr = crew && crew.getBoundingClientRect();
      return {
        asg: b.getAttribute('data-assignment-id'),
        text: b.textContent.trim(),
        inlineWidth: (b.getAttribute('style').match(/width:\s*([^;]*)/) || [])[1] || '',
        x: r.x, y: r.y, w: r.width, h: r.height,
        labelText: label ? label.textContent : null,
        labelClipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
        labelEllipsis: label ? getComputedStyle(label).textOverflow : null,
        // a badge is "attached" when it sits inside its own bar's box
        crewInside: cr ? (cr.left >= r.left - 1 && cr.right <= r.right + 1) : null,
      };
    });

    const clashes = [];
    for (let i = 0; i < bars.length; i++) {
      for (let j = i + 1; j < bars.length; j++) {
        const a = bars[i], b = bars[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) {
          clashes.push({ a: a.asg, b: b.asg, overlapX: Math.round(ox), overlapY: Math.round(oy) });
        }
      }
    }
    const cell = container.querySelector('.cal-schedule-cell');
    return { bars, clashes, dayWidth: cell ? cell.getBoundingClientRect().width : 0 };
  }, events);
}

test('schedule view never superimposes two job bars, even on an inverted span', async ({ page }) => {
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function');

  const { bars, clashes, dayWidth } = await renderSchedule(page, COLLIDING_EVENTS);

  expect(bars).toHaveLength(4);
  // The symptom: two bars occupying the same pixels.
  expect(clashes, 'job bars must not overlap each other').toEqual([]);
  // The mechanism: a negative width is invalid CSS, so the bar would fall back
  // to width:auto and shrink-wrap its label.
  for (const bar of bars) {
    expect(bar.inlineWidth, `bar ${bar.asg} width`).not.toMatch(/-/);
    expect(bar.w, `bar ${bar.asg} rendered width`).toBeGreaterThan(0);
  }
  // The inverted-span job still renders, clamped to a single day at its start.
  const hicks = bars.find((b) => b.asg === 'asg-hicks');
  expect(hicks.text).toContain('Mandy Hicks');
  expect(Math.abs(hicks.w - dayWidth), 'clamped to a single day column').toBeLessThan(2);
});

test('schedule view leaves a tidy week alone and keeps labels inside their bars', async ({ page }) => {
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function');

  const { bars, clashes } = await renderSchedule(page, TIDY_EVENTS);

  expect(bars).toHaveLength(3);
  expect(clashes).toEqual([]);

  // Non-overlapping spans still share one lane (no extra vertical growth).
  const week1 = bars.filter((b) => b.asg === 'asg-1' || b.asg === 'asg-2');
  expect(week1[0].y).toBe(week1[1].y);

  // Crew badges stay attached to their own bar.
  for (const bar of bars) expect(bar.crewInside, `badge on ${bar.asg}`).toBe(true);

  // A long client name truncates with an ellipsis inside its bar.
  const long = bars.find((b) => b.asg === 'asg-3');
  expect(long.labelEllipsis).toBe('ellipsis');
  expect(long.labelClipped, 'long label should be clipped, not overflowing').toBe(true);
});
