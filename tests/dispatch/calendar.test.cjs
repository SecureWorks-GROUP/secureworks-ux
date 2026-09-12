const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');

function dispatchContext() {
  const context = {
    console,
    document: { getElementById() { return null; } },
    opsFetch() { throw new Error('unexpected live read'); },
    opsPost() { throw new Error('unexpected live write'); },
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/ops-dispatch-core.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/ops-dispatch.js'), 'utf8'), context);
  return context;
}

function scheduleContext() {
  const html = fs.readFileSync(path.join(root, 'ops.html'), 'utf8');
  const match = html.match(/function renderScheduleView\(container, range\) \{[\s\S]*?\n\}\n\n\/\/ Schedule tooltip/);
  assert.ok(match, 'renderScheduleView is available');
  const context = {
    window: null,
    Date,
    CalOpsCore: {
      spanEnd(event) { return event.scheduled_end || event.scheduled_date; },
      paintedSpanDates(start, end) {
        const out = [];
        const day = new Date(start + 'T00:00:00');
        const last = new Date(end + 'T00:00:00');
        while (day <= last) {
          out.push(context.localDateStr(day));
          day.setDate(day.getDate() + 1);
        }
        return out;
      },
    },
    __SW_CAL_DRAGV2_ENABLED: false,
    _calEventFilters: { jobs: true, meetings: true, holidays: false, leave: true, reminders: true },
    _calDivFilter: 'all',
    _calDivFilters: ['all'],
    _calReadiness: {},
    _calLeaveByDate: {},
    _calEvents: [],
    _calDeliveries: [],
    DispatchOps: {
      mainBlock(event) {
        return `<button class="cal-delivery-block${event.late_material ? ' warning' : ''}" data-source-event-id="${event.dispatch_event_id}">${event.supplier_name}</button>`;
      },
    },
    localDateStr(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },
    getCalDays(range) {
      const out = [];
      const day = new Date(range.from + 'T00:00:00');
      const last = new Date(range.to + 'T00:00:00');
      while (day <= last) {
        out.push(context.localDateStr(day));
        day.setDate(day.getDate() + 1);
      }
      return out;
    },
    getHolidayMap() { return {}; },
    crewDisplayName(event) { return event.crew_name || event.assigned_to || 'Unassigned'; },
    crewColor() { return '#999'; },
    escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    },
    calTypeIconSvg() { return ''; },
    showScheduleTooltip() {},
    hideScheduleTooltip() {},
    openCalJobPopup() {},
    handleSchedBarDragStart() {},
    handleResizeDragStart() {},
    handleSchedDrop() {},
    openAssignmentModal() {},
  };
  context.window = context;
  vm.runInNewContext(match[0].replace(/\n\n\/\/ Schedule tooltip$/, ''), context);
  return context;
}

test('dispatch calendar projection keeps late material warnings on shared PO blocks', () => {
  const context = dispatchContext();
  const events = [
    { job_id: 'late', assignment_type: 'meeting', scheduled_date: '2026-08-03' },
    { job_id: 'late', assignment_type: 'install', scheduled_date: '2026-08-05' },
    { job_id: 'meeting-only', assignment_type: 'meeting', scheduled_date: '2026-08-04' },
    { job_id: 'meeting-only', assignment_type: 'install', scheduled_date: '2026-08-08' },
    { job_id: 'survey-only', assignment_type: 'survey', scheduled_date: '2026-08-01' },
    { job_id: 'survey-only', assignment_type: 'install', scheduled_date: '2026-08-10' },
  ];
  const deliveries = [
    { id: 'late-po', job_id: 'late', job_number: 'SWP-1', supplier_name: 'Promised Supplier', confirmed_delivery_date: '2026-08-06', status: 'promised' },
    { id: 'meeting-po', job_id: 'meeting-only', job_number: 'SWP-2', supplier_name: 'Requested Supplier', delivery_date: '2026-08-05', status: 'needs_review' },
    { id: 'kind-po', job_id: 'survey-only', job_number: 'SWP-3', supplier_name: 'Kind Supplier', delivery_date: '2026-08-02', delivery_kind: 'promised', status: 'requested' },
  ];

  const projected = context.DispatchOps.projectMain(events, deliveries, { from: '2026-08-03', to: '2026-08-09' });
  const late = projected.deliveries.find((delivery) => delivery.id === 'late-po');
  const meetingOnly = projected.deliveries.find((delivery) => delivery.id === 'meeting-po');
  const surveyOnly = projected.deliveries.find((delivery) => delivery.id === 'kind-po');

  assert.equal(late.late_material, true);
  assert.equal(late.delivery_kind, 'promised');
  assert.equal(meetingOnly.late_material, false);
  assert.equal(meetingOnly.delivery_kind, 'requested');
  assert.equal(surveyOnly.late_material, false);
  assert.equal(surveyOnly.delivery_kind, 'promised');

  const lateBlock = context.DispatchOps.mainBlock(late);
  const meetingBlock = context.DispatchOps.mainBlock(meetingOnly);
  assert.match(lateBlock, /class="cal-delivery-block dispatch-calendar-event warning"/);
  assert.match(lateBlock, /needs review/);
  assert.match(lateBlock, /promised delivery after installation starts/);
  assert.doesNotMatch(meetingBlock, / warning/);
  assert.match(meetingBlock, /needs review/);
  assert.match(meetingBlock, /requested delivery/);
});

test('schedule view reserves delivery rows above actionable job bars', () => {
  const context = scheduleContext();
  context._calEvents = [
    { job_id: 'late', assignment_id: 'a-late', assignment_type: 'install', job_number: 'SWP-1', client_name: 'Late Job', job_type: 'patio', scheduled_date: '2026-08-05', scheduled_end: '2026-08-06', crew_name: 'Shaun' },
    { job_id: 'same-day', assignment_id: 'a-same', assignment_type: 'install', job_number: 'SWP-2', client_name: 'Same Day Job', job_type: 'fencing', scheduled_date: '2026-08-07', scheduled_end: '2026-08-07', crew_name: 'Hugo' },
  ];
  context._calDeliveries = [
    { dispatch_event_id: 'po:late-one', delivery_date: '2026-08-06', supplier_name: 'First Supplier', late_material: true },
    { dispatch_event_id: 'po:late-two', delivery_date: '2026-08-06', supplier_name: 'Second Supplier', late_material: true },
  ];
  const container = { innerHTML: '' };

  context.renderScheduleView(container, { from: '2026-08-03', to: '2026-08-09' });

  assert.match(container.innerHTML, /class="cal-delivery-block warning"/);
  assert.match(container.innerHTML, /class="cal-schedule-deliveries"/);
  assert.match(container.innerHTML, /min-height:122px/);
  assert.match(container.innerHTML, /top:94px/);
  assert.doesNotMatch(container.innerHTML, /cal-schedule-bar [^"]*" style="position:absolute;top:22px/);
});
