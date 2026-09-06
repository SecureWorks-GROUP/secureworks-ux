#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');

function block(open, close) {
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  assert(start >= 0 && end > start, `missing ${open}`);
  return html.slice(start + open.length, end);
}

const context = {
  console,
  window: {},
  _isAdmin: false,
  _authorizedWorkOrderIds: {},
  _user: {
    id: 'henry',
    email: 'henry@example.test',
    role: 'lead_installer',
    managed_verticals: ['fencing']
  }
};
vm.createContext(context);
vm.runInContext([
  block('// <trade-visibility-core>', '// </trade-visibility-core>'),
  block('// <calendar-adapter-core>', '// </calendar-adapter-core>'),
  block('// <trade-calendar-source>', '// </trade-calendar-source>'),
  block('// <fencing-board-core>', '// </fencing-board-core>'),
  block('// <trade-workorder-auth>', '// </trade-workorder-auth>')
].join('\n'), context);

const visibility = {
  managed: context.managedTradeVerticals,
  canEveryone: context.canUseEveryoneLens,
  key: context.tradeSurfaceCacheKey
};
const calendar = context.TradeCalendarSource;
const fencing = context.FencingBoardCore;

assert.deepStrictEqual(Array.from(visibility.managed(context._user)), ['fencing']);
assert.strictEqual(visibility.canEveryone(), true, 'managed-vertical lead gets the explicit Everyone lens');
const allKey = visibility.key('calendar', 'fencing', 'everyone');
const mineKey = visibility.key('calendar', 'fencing', 'mine');
assert.notStrictEqual(allKey, mineKey, 'calendar cache is split by lens');
assert(allKey.includes('henry') && allKey.includes('fencing'), 'calendar cache is split by identity and vertical');
context._user = { id: 'installer', role: 'crew', managed_verticals: [] };
assert.strictEqual(visibility.canEveryone(), false, 'ordinary installer stays own-only');
context._user = { id: 'henry', role: 'lead_installer', managed_verticals: ['fencing'] };

const fencingJob = {
  id: 'fence-1', job_number: 'FENCE-1', type: 'fencing', status: 'scheduled',
  client_name: 'Fence Client', site_suburb: 'Perth'
};
const assigned = {
  id: 'assignment-1', user_id: 'alyx', status: 'confirmed',
  scheduled_date: '2026-07-25', crew_name: 'Alyx', jobs: fencingJob
};
const stalePool = {
  id: 'stale-open', status: 'available', assignment_type: 'fencing_open', jobs: fencingJob
};
const genuinePool = {
  id: 'open-2', status: 'available', assignment_type: 'fencing_open',
  // Production currently transports open pool rows with a synthetic today date.
  // Board semantics must still keep the row under Unscheduled Ready.
  scheduled_date: '2026-07-25',
  jobs: { ...fencingJob, id: 'fence-2', job_number: 'FENCE-2' }
};
const duplicatePool = { ...genuinePool, id: 'open-2-duplicate' };
const mixed = {
  id: 'patio-1', status: 'scheduled',
  jobs: { id: 'patio-job', job_number: 'PATIO-1', type: 'patio', status: 'scheduled' }
};
const mislabeledPool = {
  id: 'patio-open', status: 'available', assignment_type: 'fencing_open',
  jobs: { id: 'patio-open-job', job_number: 'PATIO-OPEN', type: 'patio', status: 'new' }
};
const otherTenant = {
  id: 'outside-assignment', org_id: 'org-2', status: 'scheduled', scheduled_date: '2026-07-25',
  jobs: { ...fencingJob, id: 'outside-job', job_number: 'OUTSIDE-1', org_id: 'org-2' }
};
const unknownStatus = {
  id: 'assignment-future', status: 'future_backend_status',
  jobs: { ...fencingJob, id: 'fence-3', job_number: 'FENCE-3' }
};
const unknownStatusTwin = {
  id: 'assignment-future-2', status: 'future_backend_status',
  jobs: { ...fencingJob, id: 'fence-4', job_number: 'FENCE-4' }
};
const backendUnscheduled = {
  id: 'assignment-unscheduled', user_id: 'henry', status: 'confirmed', scheduled_date: null,
  jobs: { ...fencingJob, id: 'fence-5', job_number: 'FENCE-5' }
};
const board = fencing.buildBoard({
  today: [assigned, mixed, mislabeledPool, unknownStatus, otherTenant],
  thisWeek: [],
  upcoming: [],
  recent: [],
  unscheduled: [backendUnscheduled],
  makesafePool: [stalePool, genuinePool, duplicatePool]
}, (job, row) => ({ job, row, _boardRow: row }), 'org-1');
const cards = board.verticals[0].columns.flatMap((column) => column.cards);
assert.strictEqual(cards.length, 4, 'board keeps assigned, backend-unscheduled, genuinely open, and review-required fencing');
assert.strictEqual(cards.filter((card) => card.job.id === 'fence-1').length, 1, 'old assigned work cannot reappear as available');
assert.strictEqual(cards.filter((card) => card.job.id === 'fence-2').length, 1, 'duplicate open rows cannot duplicate a fencing card');
assert.strictEqual(cards.some((card) => card.job.type !== 'fencing'), false, 'other verticals never enter the fencing board');
assert.strictEqual(cards.some((card) => card.job.id === 'outside-job'), false, 'a row carrying another tenant id never enters the fencing board');
assert.strictEqual(board.verticals[0].columns.find((column) => column.key === 'attention').cards[0].job.id, 'fence-3',
  'unknown server statuses stay visible in Attention');
assert.deepStrictEqual(Array.from(board.unmappedStatuses), ['future_backend_status']);
assert.strictEqual(board.unmappedCount, 1, 'the unmapped guard counts jobs, not status tokens');
assert.strictEqual(board.verticals[0].unmappedCount, 1, 'the fencing vertical carries its own unmapped job count');
assert.strictEqual(fencing.columnOf(assigned), 'scheduled');
assert.strictEqual(fencing.columnOf(genuinePool), 'needs');
assert.strictEqual(fencing.weekStart('2026-07-25'), '2026-07-20', 'week planning uses Monday in date-only space');
assert.strictEqual(fencing.weekLabel('2026-07-20'), 'Mon 20 Jul – Sun 26 Jul 2026');
const scheduledWeek = fencing.forSelection(board.verticals[0], '2026-07-20', false);
assert.strictEqual(scheduledWeek.total, 1,
  'a selected week includes only canonically dated work in that Monday-Sunday range');
assert.strictEqual(scheduledWeek.unmappedCount, 1,
  'the unmapped-status guard stays board-wide, never recounted from the filtered week');
const unscheduled = fencing.forSelection(board.verticals[0], '2026-07-20', true);
assert.strictEqual(unscheduled.total, 3,
  'Unscheduled reaches backend null-date assignments and synthetic-date open Ready work');
assert.deepStrictEqual(
  Array.from(unscheduled.columns.filter((column) => column.cards.length).map((column) => column.key)),
  ['needs', 'scheduled', 'attention'],
  'each unscheduled card stays in its own status column');
assert.strictEqual(unscheduled.unmappedCount, 1,
  'an undated unknown status is still counted in the board-wide unmapped guard');
const reachableJobIds = new Set(
  scheduledWeek.columns.concat(unscheduled.columns)
    .flatMap((column) => column.cards)
    .map((card) => card.job.id)
);
assert.strictEqual(cards.filter((card) => !reachableJobIds.has(card.job.id)).length, 0,
  'no authorised card is unreachable from its own week plus Unscheduled');

// Production-shaped multi-week jobs must be filtered to the selected week
// before the one-card-per-job dedupe. The same job appears once in every week
// where it has a visit, never only in whichever response bucket won globally.
const multiCurrentJob = { ...fencingJob, id: 'fence-26004', job_number: 'SWF-26004' };
const multiFutureJob = { ...fencingJob, id: 'fence-26033', job_number: 'SWF-26033' };
const multiWeekBoard = fencing.buildBoard({
  today: [{ id: '26004-current', status: 'scheduled', scheduled_date: '2026-07-25', jobs: multiCurrentJob }],
  thisWeek: [{ id: '26004-current-second', status: 'scheduled', scheduled_date: '2026-07-23', jobs: multiCurrentJob }],
  upcoming: [{ id: '26033-future', status: 'scheduled', scheduled_date: '2026-08-03', jobs: multiFutureJob }],
  recent: [
    { id: '26004-history', status: 'scheduled', scheduled_date: '2026-05-04', jobs: multiCurrentJob },
    { id: '26033-previous', status: 'scheduled', scheduled_date: '2026-07-13', jobs: multiFutureJob }
  ],
  unscheduled: [], makesafePool: []
}, (job, row) => ({ job, row, _boardRow: row }));
function selectedJobCount(boardModel, week, jobId) {
  return fencing.forSelection(boardModel.verticals[0], week, false).columns
    .flatMap((column) => column.cards)
    .filter((card) => card.job.id === jobId).length;
}
assert.strictEqual(selectedJobCount(multiWeekBoard, '2026-07-20', 'fence-26004'), 1,
  'SWF-26004 class appears once in its current visit week');
assert.strictEqual(selectedJobCount(multiWeekBoard, '2026-05-04', 'fence-26004'), 1,
  'SWF-26004 class also appears once in its historical visit week');
assert.strictEqual(selectedJobCount(multiWeekBoard, '2026-07-13', 'fence-26033'), 1,
  'SWF-26033 class appears once in its previous visit week');
assert.strictEqual(selectedJobCount(multiWeekBoard, '2026-08-03', 'fence-26033'), 1,
  'SWF-26033 class also appears once in its future visit week');

// Two jobs sharing ONE unknown status must report as 2 jobs, not 1 status token.
const sharedUnknown = fencing.buildBoard({
  today: [unknownStatus, unknownStatusTwin], thisWeek: [], upcoming: [], recent: [], makesafePool: []
}, (job, row) => ({ job, row, _boardRow: row }));
assert.deepStrictEqual(Array.from(sharedUnknown.unmappedStatuses), ['future_backend_status']);
assert.strictEqual(sharedUnknown.unmappedCount, 2, 'jobs sharing one unknown status still count as 2 jobs');
assert.strictEqual(sharedUnknown.verticals[0].unmappedCount, 2);
assert(/var unmappedJobs = active\.unmappedCount \|\| 0;/.test(html),
  'the board banner reads the ACTIVE vertical unmapped count, never a cross-vertical merge');

// The mobile column pager is a fencing-Board affordance only — the make-safe
// board keeps its stacked columns and plain counters at every width.
const mobileBlock = html.match(/@media \(max-width:700px\)\{([\s\S]*?)\n {4}\}/);
assert(mobileBlock, 'the board mobile media query still exists');
const sharedBoardClasses = ['tjb-pager', 'tjb-col', 'tjb-strip', 'tjb-stripcell'];
Array.from(mobileBlock[1].matchAll(/([^{}]+)\{[^{}]*\}/g)).forEach((rule) => {
  rule[1].split(',').forEach((selector) => {
    const text = selector.trim();
    if (!sharedBoardClasses.some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(text))) return;
    assert(text.startsWith('.tjb-wrap.fencing '),
      `"${text}" restyles a shared board class on phones — scope it to .tjb-wrap.fencing so make-safe is unchanged`);
  });
});
assert(/if \(isFencing\) _wireBoardPager\(\);/.test(html),
  'only the fencing board wires the horizontal pager');
assert(/\['today', 'thisWeek', 'upcoming', 'recent', 'recentCompleted', 'unscheduled', 'makesafePool'\]/.test(html),
  'the Board ingests the backend unscheduled + recentCompleted buckets');
assert(/if \(unscheduled\) return pool \|\| !scheduled;/.test(html),
  'open pool rows stay under Unscheduled even when production supplies a synthetic date');
assert(/function _invalidateAssignmentLifecycleCaches\(\)/.test(html),
  'assignment lifecycle writes own a shared Board and Calendar invalidation seam');
assert((html.match(/_invalidateAssignmentLifecycleCaches\(\);/g) || []).length >= 10,
  'successful assignment, phase, clock, verification, completion, and sync paths invalidate planning caches');
assert(/function _refreshBoardSilent\(\) \{[\s\S]*?_invalidateAssignmentLifecycleCaches\(\);[\s\S]*?_loadBoard\(true/.test(html),
  'allocation refresh reuses the same cache invalidation seam');
const ncSaveScheduleEdit = html.match(/function ncSaveScheduleEdit\(j\) \{[\s\S]*?\n {2}\}\n/);
assert(ncSaveScheduleEdit, 'the calendar schedule-edit write still exists');
assert(/_invalidateAssignmentLifecycleCaches\(\);[\s\S]*?renderNewCalendar\(\);/.test(ncSaveScheduleEdit[0]),
  'a calendar schedule edit clears the Board cache too, not just the calendar model');
assert(!/NC\.dirty = true;/.test(ncSaveScheduleEdit[0]),
  'the calendar schedule edit must not hand-roll a calendar-only invalidation');

// Work-order authorization. The registry is the authenticated my_work_orders
// response itself, so the job-detail Cost Breakdown never depends on a hub visit.
const workOrders = [
  { id: 'wo-fencing', job_type: 'fencing' },
  { id: 'wo-untyped' },
  { id: 'wo-kind-only', type: 'labour' },
  { id: 'wo-nested', jobs: { type: 'fencing' } },
  { id: 'wo-alias', vertical: 'Fencing' },
  { id: 'wo-patio', job_type: 'patio' },
  { id: 'wo-foreign', job_type: 'fencing', org_id: 'org-2' }
];
context._user = { id: 'henry', role: 'lead_installer', managed_verticals: ['fencing'], org_id: 'org-1' };
assert.deepStrictEqual(
  Array.from(context.workOrdersForViewer(workOrders).map((order) => order.id)),
  ['wo-fencing', 'wo-untyped', 'wo-kind-only', 'wo-nested', 'wo-alias'],
  'the managed hub drops another vertical and another tenant but never an untyped order');
assert.strictEqual(context.workOrderVertical({ type: 'labour' }), '',
  'a bare type is a work-order kind, never a job vertical');
assert.strictEqual(context.workOrderVertical({ job_type: 'labour', type: 'fencing' }), 'labour',
  'only the canonical vertical fields decide the vertical');
assert.deepStrictEqual(
  Array.from(['job_type', 'vertical', 'jobs'].map((field) => context.workOrderVertical(
    field === 'jobs' ? { jobs: { type: 'Fencing' } } : { [field]: 'Fencing' }
  ))),
  ['fencing', 'fencing', 'fencing'],
  'job_type, vertical and nested jobs.type are the accepted canonical vertical fields');
context._authorizedWorkOrderIds = {};
context.authorizeWorkOrders(context.workOrdersForViewer(workOrders));
assert.strictEqual(context.isAuthorizedWorkOrder('wo-untyped'), true,
  'an order the server returned without a vertical stays invoiceable');
assert.strictEqual(context.isAuthorizedWorkOrder('wo-foreign'), false,
  'another tenant order is never invoiceable');

// Job detail reaches invoiceWorkOrder from its own read, with no hub visit.
context._authorizedWorkOrderIds = {};
assert.strictEqual(context.isAuthorizedWorkOrder('wo-patio'), false);
context.authorizeWorkOrders([workOrders.find((order) => order.id === 'wo-patio')]);
assert.strictEqual(context.isAuthorizedWorkOrder('wo-patio'), true,
  'the job-detail entry point authorises the order it renders, hub or no hub');
assert(/authorizeWorkOrders\(\[match\]\);/.test(html),
  'the job-detail Cost Breakdown registers its matched work order before rendering Invoice');
assert(/var orders = \(res\.work_orders \|\| \[\]\)\.filter\(workOrderTenantOk\);/.test(html),
  'the job-detail read applies the same tenant guard as the hub');
assert((html.match(/api\('my_work_orders', \{ mode: 'all' \}\)/g) || []).length >= 2,
  'hub and Cost Breakdown request my_work_orders with mode=all');
assert(!/api\('my_work_orders'\)/.test(html),
  'no bare my_work_orders read remains — managed WOs need mode=all');
assert(/api\('submit_work_order_invoice', null, \{\s*work_order_id: workOrderId,\s*gst_on:/.test(html),
  'Invoice This Work Order always sends gst_on so the backend cannot 422 GST_CHOICE_REQUIRED');
assert(!/\(\/emeka\|henry\/i\.test\(_user\.email\)\)/.test(html),
  'per-metre extras never key on a henry/emeka email heuristic');
assert(!html.includes('!(_hoursData && _hoursData.is_per_metre)'),
  'job-centric invoice is not blocked for per-metre users');
assert(!/if \(isPerMetreUser\(\)\) \{\s*renderPerMetreView\(data\);/.test(html),
  'Financial hub is the primary Pay door for per-metre users too');
assert(html.includes('data-work-order-weekly-invoice'),
  'per-metre users still get the weekly work-order invoice as an extra door');
assert(html.includes('data-invoice-jobs-instead'),
  'an empty work-order week still offers the job-centric invoice path');
assert(html.includes('addWoPassThroughLine'),
  'job-centric WO cards can deduct a work-order amount paid to another trade');
assert(html.includes('_hydratePerMetreWorkOrderCards'),
  'per-metre job-centric builder hydrates his jobs from my_work_orders mode=all');
assert(!/if \(_mergeWorkOrdersIntoJobCards\(orders\)\) renderInvoiceBuilder/.test(html),
  'hydrate always re-renders — existing assignment cards can change without a new card');
assert(!html.includes('jobId && c.job_id === jobId && (!date || c.scheduled_date === date)'),
  'WO hydrate never folds same-job same-day work orders into one card');
assert(html.includes('never writes onto a card that already belongs to another WO'),
  'each work order keeps its own card identity');
assert(html.includes('data-pm-wo-hydrate'),
  'a failed or pending my_work_orders hydrate is visible, not swallowed');
assert(html.includes('retryPerMetreWorkOrderHydrate'),
  'Henry can retry a failed work-order hydrate');
assert(html.includes('woHydrateBlocked'),
  'Submit stays locked until the work-order hydrate succeeds');
assert(html.includes('addWoLumpLine'),
  'job-centric WO cards can deduct a freeform description + amount');
assert(html.includes('_mergeServerPassThroughs'),
  'hydrate merges server pass-throughs by source line id instead of replacing local lines');
assert(html.includes('requires_work_order_id'),
  'per-metre WO submit requires a real work_order_id');
assert(html.includes('data-weekly-wo-retry'),
  'the weekly work-order loader has Retry after a my_work_orders failure');
assert(html.includes('data-work-order-hub-retry'),
  'the My Work Orders hub has Retry after a my_work_orders failure');

// Tenant guard: fail closed for a widened viewer with no org_id, keep the
// ordinary server-scoped own-only response usable.
context._user = { id: 'henry', role: 'lead_installer', managed_verticals: ['fencing'] };
assert.strictEqual(context.workOrderTenantOk({ id: 'wo-foreign', org_id: 'org-2' }), false,
  'a managed lead with no org_id fails closed on a tenant-tagged order');
assert.strictEqual(context.workOrderTenantOk({ id: 'wo-untagged' }), true,
  'an untagged order stays usable — own-only responses carry no tenant column');
context._user = { id: 'installer', role: 'crew', managed_verticals: [] };
assert.strictEqual(context.workOrderTenantOk({ id: 'wo-own', org_id: 'org-2' }), true,
  'an ordinary installer keeps the server-authorized own-only response');
assert.strictEqual(fencing.isSameOrg({ org_id: 'org-2' }, ''), false,
  'the board tenant guard agrees: a tagged row needs a known viewer org');
assert.strictEqual(fencing.isSameOrg({ id: 'untagged' }, ''), true,
  'the board tenant guard keeps rows the server did not tag');
context._user = { id: 'henry', role: 'lead_installer', managed_verticals: ['fencing'] };

const payload = {
  schema: 'trade-calendar.v1',
  mode: 'all',
  type: 'fencing',
  events: [{
    assignment_id: 'assignment-1',
    job_id: 'fence-1',
    user_id: 'alyx',
    job_number: 'FENCE-1',
    client_name: 'Fence Client',
    site_address: '1 Fence Road',
    site_suburb: 'Perth',
    scheduled_date: '2026-07-25',
    scheduled_end: '2026-07-25',
    start_time: '08:00',
    end_time: '16:00',
    crew_name: 'Alyx',
    assigned_to: 'Alyx',
    assignment_type: 'install',
    assignment_status: 'scheduled',
    confirmation_status: 'confirmed',
    job_type: 'fencing',
    job_status: 'scheduled'
  }],
  truncated: false
};
const request = { from: '2026-07-20', to: '2026-08-10', vertical: 'fencing', lens: 'everyone' };
const adapted = calendar.adaptV1(payload, request);
const normalized = calendar.validateModel(adapted, request);
assert.strictEqual(normalized.blocks.length, 1);
assert.strictEqual(normalized.blocks[0].type, 'fencing');
assert.strictEqual(normalized.mode, 'all');
assert.strictEqual(normalized.permissions.sees_all, true);
assert.strictEqual(normalized.truncated, false);

assert.throws(() => calendar.adaptV1({ ...payload, schema: 'calendar.v0' }, request), /schema/);
assert.throws(() => calendar.adaptV1({ ...payload, type: 'patio' }, request), /vertical/);
assert.throws(() => calendar.adaptV1({ ...payload, truncated: undefined }, request), /truncated/);
assert.throws(() => calendar.adaptV1({
  ...payload,
  events: [{ ...payload.events[0], job_type: 'patio' }]
}, request), /outside fencing/);

assert(/api\('trade_calendar', params, null, \{ preserveSessionOnAuthFailure: true \}\)/.test(html),
  'calendar uses the authenticated api helper');
assert(/mode: request\.lens === 'everyone' \? 'all' : 'mine'/.test(html),
  'calendar sends only the published mine or all modes');
assert(/type: 'fencing'/.test(html), 'calendar sends the published fencing type');
assert(/from: request\.from,[\s\S]*to: request\.to/.test(html), 'calendar sends the published inclusive date fields');
assert(/crewNone: isPool \? \(isMs \? 'All make-safe trades' : 'Nobody allocated'\)/.test(html),
  'generic fencing pool cards do not inherit make-safe-only crew copy');
assert(/_lastJobDataKey === activeCacheKey/.test(html),
  'a late projection refresh cannot repaint a broader My Jobs lens');

// Freshness: the calendar's staleness decision must reach the transport cache,
// and a Board write must drop both field caches.
assert(/caFetchCalendarModel\(from, to, stale\)/.test(html),
  'the calendar threads its staleness decision into the source load');
assert(/\}, !!force\);/.test(html), 'the fencing calendar source honours a forced reload');
assert(/Date\.now\(\) - cached\.at < _fieldBoardTtlMs/.test(html),
  'the fencing board cache expires on a TTL instead of freezing for the session');
assert(/function _invalidateAssignmentLifecycleCaches\(\) \{[\s\S]*?_fieldBoardCacheByKey = \{\};[\s\S]*?TradeCalendarSource\.clear\(\);/.test(html),
  'the lifecycle invalidation seam clears the fencing board and calendar caches');
assert(/function _refreshBoardSilent\(\) \{[\s\S]*?_invalidateAssignmentLifecycleCaches\(\);/.test(html),
  'a Board write uses the shared lifecycle cache invalidation seam');

(async function freshness() {
  const cacheRequest = { from: '2026-07-20', to: '2026-08-10', vertical: 'fencing', lens: 'everyone', cacheKey: allKey };
  let loads = 0;
  calendar.register(() => { loads++; return adapted; });

  await calendar.load(cacheRequest, false);
  await calendar.load(cacheRequest, false);
  assert.strictEqual(loads, 1, 'an unforced load reuses the cached window');

  await calendar.load(cacheRequest, true);
  assert.strictEqual(loads, 2, 'a stale load refetches instead of serving the session cache');

  await calendar.load({ ...cacheRequest, cacheKey: mineKey, lens: 'mine' }, false);
  assert.strictEqual(loads, 3, 'a lens switch never reuses the other lens cache entry');

  calendar.clear();
  await calendar.load(cacheRequest, false);
  assert.strictEqual(loads, 4, 'clearing the source drops every cached window');

  console.log('fencing manager visibility tests passed');
})().catch((err) => { console.error(err); process.exitCode = 1; });
