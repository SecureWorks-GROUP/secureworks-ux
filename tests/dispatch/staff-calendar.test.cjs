const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { workspace } = require('./workspace-harness.cjs');

const repoRoot = path.resolve(__dirname, '../..');

function actualCalOpsCore() {
  const html = fs.readFileSync(path.join(repoRoot, 'ops.html'), 'utf8');
  const match = html.match(/\/\/ <calendar-ops-core>[\s\S]*?\/\/ <\/calendar-ops-core>/);
  assert.ok(match, 'calendar ops core block exists');
  const context = {};
  vm.runInNewContext(match[0], context);
  return context.CalOpsCore;
}

function countRenderedEvent(html, id) {
  return (html.match(new RegExp(`data-id="${id}"`, 'g')) || []).length;
}

async function renderCalendar(flagEnabled, events) {
  const CalOpsCore = actualCalOpsCore();
  const ui = await workspace({
    globals: { CalOpsCore, __SW_CAL_DRAGV2_ENABLED: flagEnabled },
    get: async (action) => {
      if (action === 'dispatch_calendar') return { events, undated: [], coverage: { complete: true } };
    }
  });
  return { ui, html: ui.host.innerHTML, CalOpsCore };
}

test('dragv2 staff spans paint weekdays through weekend gaps using incumbent calendar core', async () => {
  const { html, CalOpsCore } = await renderCalendar(true, [
    { id: 'staff-weekday', layer: 'staff', job_id: 'a', job_number: 'SPAN', title: 'Weekday staff span', date: '2026-09-14', end_date: '2026-09-21', status: 'scheduled' },
    { id: 'staff-weekend-endpoint', layer: 'staff', job_id: 'b', job_number: 'ENDPOINT', title: 'Weekend endpoint span', date: '2026-09-18', end_date: '2026-09-19', status: 'scheduled' },
    { id: 'logistics-calendar-days', layer: 'logistics', job_id: 'c', job_number: 'LOG', title: 'Logistics range', date: '2026-09-14', end_date: '2026-09-20', status: 'scheduled' },
    { id: 'materials-calendar-days', layer: 'materials', job_id: 'd', job_number: 'MAT', title: 'Material range', date: '2026-09-14', end_date: '2026-09-20', status: 'scheduled' }
  ]);

  assert.deepEqual([...CalOpsCore.paintedSpanDates('2026-09-14', '2026-09-21')], ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21']);
  assert.deepEqual([...CalOpsCore.paintedSpanDates('2026-09-18', '2026-09-19')], ['2026-09-18', '2026-09-19']);
  assert.equal(countRenderedEvent(html, 'staff-weekday'), 5);
  assert.equal(countRenderedEvent(html, 'staff-weekend-endpoint'), 2);
  assert.equal(countRenderedEvent(html, 'logistics-calendar-days'), 7);
  assert.equal(countRenderedEvent(html, 'materials-calendar-days'), 7);
});

test('flag-off staff spans keep calendar-day rendering', async () => {
  const { html } = await renderCalendar(false, [
    { id: 'staff-calendar-days', layer: 'staff', job_id: 'a', job_number: 'OFF', title: 'Flag off staff span', date: '2026-09-14', end_date: '2026-09-20', status: 'scheduled' }
  ]);

  assert.equal(countRenderedEvent(html, 'staff-calendar-days'), 7);
});

test('Friday to Monday skips interior weekends and retains an explicit Sunday start', async () => {
  const { ui, html } = await renderCalendar(true, [
    { id: 'friday-monday', layer: 'staff', job_id: 'a', title: 'Installation', date: '2026-09-18', end_date: '2026-09-21' },
    { id: 'sunday-monday', layer: 'staff', job_id: 'b', title: 'Explicit Sunday work', date: '2026-09-20', end_date: '2026-09-21' }
  ]);
  assert.equal(countRenderedEvent(html, 'friday-monday'), 1);
  assert.equal(countRenderedEvent(html, 'sunday-monday'), 1);
  await ui.click('week-next');
  assert.equal(countRenderedEvent(ui.host.innerHTML, 'friday-monday'), 1);
  assert.equal(countRenderedEvent(ui.host.innerHTML, 'sunday-monday'), 1);
});
