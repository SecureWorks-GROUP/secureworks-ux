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
context.authorizeWorkOrders(context.workOrdersForViewer(workOrders));
assert.strictEqual(context.isAuthorizedWorkOrder('wo-untyped'), true);
context.authorizeWorkOrders([{ id: 'wo-fencing', job_type: 'fencing' }]);
assert.strictEqual(context.isAuthorizedWorkOrder('wo-fencing'), true);
assert.strictEqual(context.isAuthorizedWorkOrder('wo-untyped'), false,
  'a later my_work_orders result replaces the authorized set and drops ids no longer present');
assert(/authorizeWorkOrders\(\[match\]\);/.test(html),
  'the job-detail Cost Breakdown registers its matched work order before rendering Invoice');
assert(/var orders = workOrdersForViewer\(res\.work_orders \|\| \[\]\);/.test(html),
  'Cost Breakdown applies the same managed-vertical lens before render/authorize');
assert(!/orders\[i\]\.id === wo\.id \|\| orders\[i\]\.job_id === job\.id/.test(html),
  'Cost Breakdown never authorizes a different WO via job_id fallback');
assert(/if \(String\(orders\[i\]\.id\) === String\(wo\.id\)\)/.test(html),
  'Cost Breakdown matches only the work order being viewed');
assert((html.match(/api\('my_work_orders', \{ mode: 'all' \}\)/g) || []).length >= 2,
  'hub and Cost Breakdown request my_work_orders with mode=all');
assert(!/api\('my_work_orders'\)/.test(html),
  'no bare my_work_orders read remains — managed WOs need mode=all');
assert(/gst_on: _invoiceGstDefault\(_hoursData \|\| _user\)/.test(html) && /_financialInvoiceApi\('submit_work_order_invoice', null, woBody/.test(html),
  'Invoice This Work Order always sends gst_on so the backend cannot 422 GST_CHOICE_REQUIRED');
assert(html.includes('_workOrderNegativeChargeLineIds') && html.includes('_confirmDirectWorkOrderInvoiceLanded'),
  'direct work-order invoice collects complete charge ids and confirms an unidentified Xero save');
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
assert(html.includes('_jobCentricSubmitBlockedByHydrate'),
  'hydrate submit block is scoped to pending or WO-mode cards, not a Pay-tab gate');
assert((function() {
  const hydrate = html.slice(html.indexOf('function _hydratePerMetreWorkOrderCards'), html.indexOf('window.retryPerMetreWorkOrderHydrate'));
  const fail = hydrate.slice(hydrate.indexOf('.catch(function'));
  const incomplete = hydrate.slice(
    hydrate.indexOf('if (!_workOrdersHydratePayloadComplete'),
    hydrate.indexOf('var orders = authorizeWorkOrders')
  );
  const incompleteMoney = hydrate.slice(
    hydrate.indexOf('if (!_workOrdersHydrateMoneyComplete'),
    hydrate.indexOf('_pmHydratedWorkOrderIds = _workOrderIdSet')
  );
  return !fail.includes('_reconcileJobCardWorkOrderAuth') &&
    !fail.includes('_pmHydratedWorkOrderIds = {}') &&
    fail.includes("_pmWoHydrateState = 'error'") &&
    incomplete.includes("_pmWoHydrateState = 'error'") &&
    !incomplete.includes('_reconcileJobCardWorkOrderAuth') &&
    !incomplete.includes('_mergeWorkOrdersIntoJobCards') &&
    incompleteMoney.includes("_pmWoHydrateState = 'error'") &&
    !incompleteMoney.includes('_reconcileJobCardWorkOrderAuth') &&
    /if \(_pmWoHydrateState === 'ok'\) \{\s*_reconcileJobCardWorkOrderAuth\(_pmHydratedWorkOrderIds\)/.test(html);
})(),
  'a failed or incomplete WO hydrate keeps restored deductions and does not reconcile against an empty set');
assert(html.includes('_workOrdersHydratePayloadComplete') && html.includes('_workOrdersHydrateMoneyComplete') &&
  html.includes('_workOrdersHydrateListingTruncated') &&
  html.includes('_workOrderHasCompleteMoney') &&
  html.includes('Array.isArray(wo.negative_charges)') &&
  /function _applyHydratedWorkOrderMoney[\s\S]*?_workOrderHasCompleteMoney\(wo\)[\s\S]*?Array\.isArray\(passThroughs\)/.test(html),
  'hydrate treats missing work_orders, truncated listings, or negative_charges as unresolved money, not an empty success');
assert(html.includes('woHydrateBlocked'),
  'the job-centric footer still names the hydrate submit block');
assert(html.includes('Undated assignments never prefill a card'),
  'undated my_hours assignments do not prefill a job card');
assert(html.includes('search_all_jobs'),
  'any-job add uses typed search_all_jobs on the same builder');
assert(html.includes('btnAddInvLump') && html.includes('final_deductions: finalDeductions'),
  'weekly job-centric submit keeps invoice-level final_deductions');
assert(html.includes('invoice_final_deduction'),
  'invoice-level lumps also ride extra_items as negative client-priced deducts');
assert(html.includes('_renderInvLumpLinesHtml()') && !/if \(isPerMetreUser\(\)[\s\S]{0,120}_renderInvLumpLinesHtml/.test(html),
  'invoice-level lump amounts are not gated to Henry / per-metre');
assert(html.includes('_renderCardLumpLinesHtml') && html.includes('_cardAddAmountBtnHtml'),
  'Hours and Work Order cards share the same amount-line UI');
assert((html.match(/_renderCardLumpLinesHtml\(c/g) || []).length >= 2,
  'amount lines render on both Hours and Work Order cards');
assert(!html.includes('Lump-sum amounts'),
  'amount lines are not framed as a separate product heading');
assert(html.includes('_hoursCardLumpExtras') && html.includes('_hoursCardLumpFinalDeductions') &&
  /function _invFinalDeductions[\s\S]*?_hoursCardLumpFinalDeductions\(\)/.test(html) &&
  !html.includes('_woCardFinalDeductions') &&
  html.includes('_woLabourLinesForFanout') &&
  html.includes('_woAmountAsHoursRate') &&
  !/wo_lump_lines: lumpLinesOut/.test(html),
  'invoice-level and hours-card lumps stay on final_deductions; WO deducts reshape to hours×rate fanout lines');
assert(html.includes('or add an amount'),
  'hours-card validation treats an amount as a peer to hours');
assert(html.includes('addWoLumpLine'),
  'job-centric cards can deduct a freeform description + amount');
assert(html.includes('_mergeServerPassThroughs'),
  'hydrate merges server pass-throughs by source line id');
assert(html.includes('Same-ID lines take current server amount/name'),
  'same-ID pass-throughs are overwritten from current server truth');
assert((html.match(/final_deductions: finalDeductions/g) || []).length >= 2,
  'offline job-centric replay queues the same final_deductions as the online payload');
assert(html.includes('_purgeOfflineInvoiceActionsNotOwnedByCurrentAccount') && html.includes('item.user_id'),
  'offline invoice actions are stamped with account identity');
assert(/_user = profile;[\s\S]{0,280}_purgeOfflineInvoiceActionsNotOwnedByCurrentAccount\(\)/.test(html),
  'sign-in drops invoice actions that do not belong to the new account');
assert(html.includes('if (prevOwner && prevOwner !== _invDraftOwnerId()) _invoiceAuthGen++'),
  'an in-page account switch bumps invoice auth generation so in-flight replay aborts');
assert(html.includes('_isOfflineInvoiceAction(action)') && html.includes('if (!owner) return'),
  'invoice writes are not queued without a signed-in account');
assert(html.includes('resetInvoiceSession()') && /function resetInvoiceSession\(\) \{[\s\S]*?_purgeOfflineInvoiceActionsNotOwnedByCurrentAccount\(\);/.test(html),
  'account switch / invoice session reset drops invoice actions the new account does not own');
assert((html.match(/_user = null;[\s\S]{0,80}_purgeOfflineInvoiceActionsNotOwnedByCurrentAccount\(\)/g) || []).length >= 1,
  'logout clears invoice actions once the account is gone');
assert(html.includes('_offlineInvoiceReplayAllowed') && html.includes('beforeSend'),
  'offline invoice replay re-checks ownership and auth generation immediately before send');
assert(html.includes('function _invoiceApiOptions(ctx') && html.includes('_financialInvoiceApi') && html.includes('_withFinancialWebLock') &&
  html.includes('_webLocksAvailable') && html.includes('_holdFinancialWebLockUntilLocalWriteEnds') &&
  html.includes('_financialWebLockDepth'),
  'direct invoice writes pass a context-bound beforeSend guard and keep the financial Web Lock through response handling');
assert(html.includes('_startStorageLockRenew') && html.includes('_renewStorageLock') && html.includes('_listTradeInvoicesForReconcile'),
  'storage locks renew for the in-flight request and ambiguous replay re-reads invoices before resend');
assert(html.includes('_nestedInvoiceIdentityValues') && html.includes('_offlineInvoiceReplaySucceeded') &&
  html.includes('_invoiceIdentitySlots') && html.includes('persist_unconfirmed') &&
  html.includes('_invoicePayloadHasMoneyAffectingExtras') && html.includes('_rollbackStorageLockWrite') &&
  html.includes('_financialLeaseOwned'),
  'job-centric nested identities can reconcile and replay drops only after durable queue removal');
assert((function() {
  const block = html.slice(html.indexOf('function _applyOfflineQueueMutation'), html.indexOf('function _withStorageLockAsync'));
  return block.includes('ok: false') && block.includes('_readOfflineQueue()') &&
    block.includes('_queueWebLockDepth') && block.includes('_applyOfflineQueueMutation') &&
    block.includes('_queueIdsMatch(_readOfflineQueueRaw(), next)') &&
    block.includes('_clearInboxIds(clearable)');
})(), 'queue mutations apply only under the Web Lock and never clear inbox before a verified write');
assert(html.includes('_offlineQueueSyncing') && html.includes('_persistOfflineQueueAfterSync'),
  'offline queue sync is single-flight and merges remaining items with the latest stored queue');
assert(html.includes('_mutateOfflineQueue') && html.includes('_withQueueWebLock') && html.includes('_writeInboxItem') &&
  html.includes('navigator.locks') && html.includes("var _QUEUE_WEB_LOCK_NAME = 'sw_action_queue'"),
  'money queue mutations serialize on a dedicated Web Lock and keep inbox items until merge commits');
assert((function() {
  const begin = html.slice(html.indexOf('function _beginFinancialWrite(action)'), html.indexOf('function _endFinancialWrite'));
  const webLock = html.slice(html.indexOf('function _withFinancialWebLock'), html.indexOf('function _withCrossTabLock'));
  const extras = html.slice(html.indexOf('function _invoicePayloadHasMoneyAffectingExtras'), html.indexOf('function _invoicePayloadNeedsFullFingerprint'));
  return begin.includes('_webLocksAvailable()') &&
    !begin.includes('_claimStorageLock(_financialWriteLockKey') &&
    webLock.includes('if (!_webLocksAvailable())') &&
    webLock.includes('_invoiceWriteLeaseLostError()') &&
    !webLock.includes('    return run();\n  }') &&
    extras.includes('wo_labour_lines') &&
    extras.includes('wo_labour_deduction') &&
    extras.includes('labour_deductions') &&
    /function _financialWriteAlreadyPending[\s\S]*?_sharedFinancialWriteHeld\(action\)/.test(html) &&
    html.includes("var _FINANCIAL_WRITE_LOCK_KEY = 'sw_fin_write'") &&
    webLock.includes('_claimStorageLock(_FINANCIAL_WRITE_LOCK_KEY') &&
    html.includes('_beginFinancialWriteSend') &&
    html.includes('_settleFinancialWriteSend') &&
    html.includes('_financialWriteItemDurable') &&
    html.includes('invoice_storage_unavailable') &&
    /function _financialInvoiceApi[\s\S]*?_beginFinancialWriteSend[\s\S]*?api\(action/.test(html) &&
    /function _invoiceSlotsCovered[\s\S]*?_invoiceResponseIdentityRows[\s\S]*?used\[pick\] = true/.test(html) &&
    html.includes('_compareAndSwapStorageLock') &&
    html.includes("{ acquire: true }") &&
    html.includes('_allStorageLeasesOwned');
})(),
  'money writes fail closed without Web Locks; WO labour deductions require a full fingerprint');
assert(html.includes('client_request_id') && html.includes('_reconcileAmbiguousInvoiceAction'),
  'financial queue items carry a local request id and reconcile before retrying a timeout');
assert(html.includes('_handleFinancialWriteFailure') && html.includes('_offlineInvoiceHasExactTarget'),
  'online financial timeouts persist through the same reconcile-or-queue path');
assert(html.includes('_guardFinancialWrite') && html.includes('Do not submit again'),
  'a pending ambiguous invoice write blocks a second send');
assert(html.includes('_financialWritePayloadIdentity') && !/aWeek === bWeek && aId === bId/.test(html),
  'pending invoice intents match exact identity or payload, not week-only');
assert(/return 'payload:' \+ JSON\.stringify\(\{[\s\S]*?week_start: body\.week_start \|\| null,[\s\S]*?week_ending: body\.week_ending \|\| null,/.test(html),
  'payload fingerprint includes week_start/week_ending so distinct weeks do not suppress each other');
assert(html.includes('_beginSaveTradeInvoiceDraft') && /saveDraftInvoice = function\(\) \{[\s\S]*?_beginSaveTradeInvoiceDraft\(\)/.test(html),
  'Save Draft is single-flight so concurrent taps cannot create parallel drafts');
assert(/saveDraftInvoice = function\(\) \{[\s\S]*?_invoiceDraftSaveSucceeded\(res\)[\s\S]*?invoice_response_ambiguous/.test(html) &&
  /saveWeeklyWorkOrderInvoice = function\(\) \{[\s\S]*?_invoiceDraftSaveSucceeded\(res\)[\s\S]*?_weeklyInvoiceFromResponse[\s\S]*?invoice_response_ambiguous/.test(html) &&
  html.includes('_invoiceDraftIdentity') &&
  html.includes('Do not save again yet'),
  'draft saves require a durable identity and treat accepted-but-invalid responses as unresolved');
assert(html.includes('_beginFinancialWrite') && html.includes('_financialWriteInFlight') &&
  /submitWeeklyWorkOrderInvoice = function\(\) \{[\s\S]*?_beginFinancialWrite\('generate_trade_invoice'\)/.test(html) &&
  /submitTradeHours = function\(\) \{[\s\S]*?_beginFinancialWrite\('submit_trade_invoice'\)/.test(html) &&
  /submitJobCentricInvoice = function\(\) \{[\s\S]*?_beginFinancialWrite\('generate_trade_invoice'\)/.test(html) &&
  /submitInvoiceFromBuilder = function\(\) \{[\s\S]*?_beginFinancialWrite\('generate_trade_invoice'\)/.test(html) &&
  /generateTradeInvoice = function\(weekStart\) \{[\s\S]*?_beginFinancialWrite\('generate_trade_invoice'\)/.test(html) &&
  /invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?_beginFinancialWrite\('submit_work_order_invoice'\)/.test(html) &&
  /deleteTradeInvoice = function\(invoiceId\) \{[\s\S]*?_beginFinancialWrite\('delete_trade_invoice'\)/.test(html) &&
  html.includes("_financialInvoiceApi('attach_invoice_pdf'"),
  'every financial invoice submit/generate/delete/attach path is process-wide single-flight');
assert(/var match = invoices\.filter\(function\(inv\) \{ return _invoiceMatchesQueueIntent\(inv, item\); \}\);[\s\S]{0,280}if \(match\.length > 0\) return true;/.test(html) &&
  html.includes('if (_invoicePayloadNeedsFullFingerprint(item)) return null;'),
  'an exact draft/invoice/work-order identity is treated as landed without a status filter');
assert(html.indexOf('if (_isOfflineInvoiceTimeoutError(err))') < html.indexOf('if (_isBrowserOffline())') &&
  html.includes('_persistAmbiguousFinancialWrite(action, body)') &&
  /function _isOfflineInvoiceTimeoutError[\s\S]*?Load failed[\s\S]*?NetworkError when attempting to fetch/.test(html),
  'timeout/Failed-to-fetch/Load failed/NetworkError is marked ambiguous before any offline-only queue path');
assert(/if \(_invoicePayloadNeedsFullFingerprint\(item\)\) return null;[\s\S]{0,450}return null;/.test(html) &&
  !/if \(_invoicePayloadNeedsFullFingerprint\(item\)\) return null;\s*return false;/.test(html),
  'an exact-target write with no listing match fails closed instead of resending');
assert(html.includes('_tradeInvoicesListingComplete') &&
  /if \(!invoices\.length\) return null;/.test(html) &&
  (html.match(/if \(!_workOrdersHydratePayloadComplete\(res\)\) throw new Error\('Could not load work orders\.'\);/g) || []).length >= 2,
  'weekly/hub WO reads and delete reconcile reject incomplete listings');
assert(html.includes('server_owned: false') && html.includes('server_owned: true') &&
  /function _mergeServerPassThroughs[\s\S]*?isUntaggedNoId[\s\S]*?unresolved: true/.test(html),
  'no-ID pass-through merge tags local lines and fail-closes untagged collisions');
assert(html.includes('_financialWriteAborted') &&
  html.includes("outcome: 'locked'") &&
  html.includes('Check Invoice history before trying again') &&
  /submitWeeklyWorkOrderInvoice = function\(\) \{[\s\S]*?_financialWriteAborted\(result\)[\s\S]*?state\.busy = false/.test(html) &&
  /submitJobCentricInvoice = function\(\) \{[\s\S]*?_financialWriteAborted\(result\)[\s\S]*?renderInvoiceBuilder\(\)/.test(html) &&
  /invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?_financialWriteAborted\(result\)[\s\S]*?_reEnableBtn\(\)/.test(html),
  'cross-tab invoice lock restores submit chrome and points the trade at Invoice history');
assert(/saveDraftInvoice = function\(\) \{[\s\S]*?draft_id: _draftInvoiceId/.test(html),
  'saving an existing invoice draft sends its draft_id');
assert(html.includes('_ensureOfflineInvoiceWorkOrderAuth') && /isAuthorizedWorkOrder\(woId\)/.test(html),
  'offline work-order invoice replay revalidates current WO authorization');
assert(/function _ensureOfflineInvoiceWorkOrderAuth[\s\S]*?if \(item\.action !== 'submit_work_order_invoice'\) \{[\s\S]*?_offlineInvoiceReplayAllowed\(item, ctx\)[\s\S]*?return api\('my_work_orders'/.test(html) &&
  /function _ensureOfflineInvoiceWorkOrderAuth[\s\S]*?\.catch\(function\(\) \{[\s\S]*?read:\s*false/.test(html) &&
  /if \(!auth\.read\) \{[\s\S]*?remaining\.push\(item\)/.test(html),
  'WO invoice replay re-reads my_work_orders and keeps the item when that read fails');
assert(/function authorizeWorkOrders\(orders\) \{[\s\S]*?var next = \{\};[\s\S]*?_authorizedWorkOrderIds = next;/.test(html),
  'authorizeWorkOrders replaces the authorized set from the latest authenticated result');
assert(/invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?var ctx = _invoiceApiContext\(\);[\s\S]*?if \(!_invoiceApiCurrent\(ctx\)\) return;[\s\S]*?submit_work_order_invoice[\s\S]*?if \(!_invoiceApiCurrent\(ctx\)\) return;[\s\S]*?_handleFinancialWriteFailure\('submit_work_order_invoice'/.test(html),
  'direct work-order invoice submit drops late toast/refresh/queue after account switch');
assert(/invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?if \(!_invoiceSubmitSucceeded\(result\)\) \{[\s\S]*?openWorkOrderHub\(\)/.test(html) &&
  !/invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?var succeeded = result\.ok === true \|\| result\.success === true/.test(html),
  'direct work-order invoice uses the shared committed-success predicate and refreshes the hub on durable success');
assert(/invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?_workOrdersHydratePayloadComplete\(res\)[\s\S]*?negative_charge_line_ids: chargeIds[\s\S]*?charge_line_ids: chargeIds[\s\S]*?_financialInvoiceApi\('submit_work_order_invoice', null, woBody/.test(html),
  'direct work-order invoice re-reads a complete WO listing and posts selected charge ids');
assert(html.includes('_workOrderDirectInvoiceAllowed') &&
  /invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?_workOrderDirectInvoiceAllowed\(wo\)[\s\S]*?_financialInvoiceApi\('submit_work_order_invoice', null, woBody/.test(html) &&
  /invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?_withFinancialWebLock\('submit_work_order_invoice'[\s\S]*?api\('my_work_orders'/.test(html) &&
  /function _offlineInvoiceReplayAllowed[\s\S]*?_workOrderDirectInvoiceAllowed\(/.test(html),
  'direct WO invoice and offline replay fail closed when already invoiced and hold the financial fence through the re-read');
assert(html.includes('_invoiceXeroPushSavedUnconfirmed') &&
  /function _settleFinancialWriteSend[\s\S]*?_invoiceXeroPushSavedUnconfirmed\(result\)\) return/.test(html) &&
  /invoiceWorkOrder = function\(workOrderId\) \{[\s\S]*?_invoiceXeroPushSavedUnconfirmed\(result\)[\s\S]*?Confirming\.\.\.[\s\S]*?_reEnableBtn\(\)/.test(html),
  'a saved-but-unidentified Xero push keeps the pending fence and does not re-arm Submit');
assert(html.includes('_financialWriteRejectionClearsPending') &&
  /function _financialWriteRejectionClearsPending[\s\S]*?err\.status[\s\S]*?success === false/.test(html) &&
  /function _settleFinancialWriteSend[\s\S]*?_financialWriteRejectionClearsPending\(err, null\)/.test(html) &&
  /function _settleFinancialWriteSend[\s\S]*?_financialWriteRejectionClearsPending\(null, result\)/.test(html),
  'definitive HTTP/JSON invoice rejections clear the durable pending fence; transport stays parked');
assert(/function _workOrderHasCompleteMoney[\s\S]*?_workOrderChargeAmount\(charge\)[\s\S]*?_workOrderChargeSubmitIdentity\(charge\)/.test(html),
  'hydrate money is complete only when every charge has a usable amount and submit identity');
assert(/function _applyHydratedWorkOrderMoney[\s\S]*?return ln\.server_owned !== true/.test(html),
  'complete hydrate replaces server-owned no-ID deductions from current server truth');
assert(html.includes('No-ID lines are a multiset'),
  'no-ID pass-through merge keeps distinct same-amount deducts');
assert(html.includes('_invoiceApiCurrent') && html.includes('_invoiceAuthGen++'),
  'invoice API responses are dropped after an account switch or superseded request');
assert(html.includes('_reconcileJobCardWorkOrderAuth'),
  'restored work-order ids are reconciled against the current hydrate authorization');
assert(html.includes('_workOrderInvoiceableForHydrate') && html.includes('return _workOrderInvoiceableForHydrate(wo)'),
  'job-centric hydrate authorizes only invoiceable in-week work orders');
assert((function() {
  const filter = html.slice(html.indexOf('// [WO-HYDRATE-FILTER-START]'), html.indexOf('// [WO-HYDRATE-FILTER-END]'));
  const merge = html.slice(html.indexOf('function _mergeWorkOrdersIntoJobCards'), html.indexOf('function _hydratePerMetreWorkOrderCards'));
  return filter.includes('if (wo.can_invoice !== true) return false') &&
    !filter.includes('can_add_to_weekly_invoice') &&
    merge.includes('if (wo.can_invoice !== true) return') &&
    !/function _mergeWorkOrdersIntoJobCards[\s\S]*?can_add_to_weekly_invoice !== true/.test(merge);
})(),
  'job-centric hydrate and merge require exclusive can_invoice, not weekly-door addability');
assert(html.includes('_blockJobCardWorkOrder') && html.includes('_jobCardWorkOrderBlocked') &&
  html.includes('ackJobCardWorkOrderAsHours') && html.includes('data-wo-block') &&
  html.includes('data-wo-hours-ack') &&
  /function _reconcileJobCardWorkOrderAuth[\s\S]*?_blockJobCardWorkOrder\(card/.test(html) &&
  !/function _reconcileJobCardWorkOrderAuth[\s\S]*?card\.work_order_id = ''/.test(html),
  'non-exclusive job-centric WOs stay blocked with a reason instead of converting to Hours');
assert(html.includes('_jobCentricWorkOrdersStillExclusive') &&
  html.includes('_confirmJobCentricWorkOrdersExclusive') &&
  /function _jobCentricWorkOrdersStillExclusive[\s\S]*?_workOrderDirectInvoiceAllowed/.test(html) &&
  /function _confirmJobCentricWorkOrdersExclusive[\s\S]*?api\('my_work_orders', \{ mode: 'all' \}\)[\s\S]*?_jobCentricWorkOrdersStillExclusive/.test(html) &&
  /submitJobCentricInvoice = function\(\) \{[\s\S]*?_beginFinancialWrite\('generate_trade_invoice'\)[\s\S]*?_withFinancialWebLock\('generate_trade_invoice'[\s\S]*?_confirmJobCentricWorkOrdersExclusive\(\)[\s\S]*?_postJobCentricGenerate\(\)/.test(html) &&
  !html.includes('claim_work_order') &&
  !html.includes('exclusive_claim'),
  'job-centric generate re-reads WO can_invoice under the financial fence and does not add a claim API');
assert(html.includes('_applyHydratedWorkOrderMoney') && html.includes('_clearJobCardServerOwnedWorkOrderMoney'),
  'hydrate overwrites server-owned money and clears it when a WO id is stripped');
assert(html.includes('_stripServerOwnedPassThroughs'),
  'stale source_line_id pass-throughs are dropped before rematching the current WO');
assert(html.includes('requires_work_order_id'),
  'per-metre WO submit requires a real work_order_id');
assert(html.includes('data-weekly-wo-retry'),
  'the weekly work-order loader has Retry after a my_work_orders failure');
assert(html.includes('data-work-order-hub-retry'),
  'the My Work Orders hub has Retry after a my_work_orders failure');
assert(html.includes('jobCards: _serializeJobCardsDraft(_jobCards)'),
  'the invoice draft persists job-centric cards, not only legacy _invRows');
assert(html.includes('_applyInvDraft(draft)'),
  'loadHoursView restores persisted job cards after a reload');
assert(html.includes('_invDraftStorageKey') && html.includes('resetInvoiceSession'),
  'invoice drafts are keyed by authenticated user and cleared on auth change');
assert(html.includes('_jobCardAcceptsWorkOrder'),
  'hydrate applies the date/job bind guard even when a card already has a work_order_id');
assert(html.includes('_unboundCardForWorkOrder'),
  'WO hydrate binds an unbound card only on the matching work-order date');
assert(html.includes('_jobCardKeepHoursMode'),
  'hydrate does not silently flip a card the user already edited in Hours');
assert(html.includes('hoursFocused') && html.includes('_markJobCardHoursEdited(c)'),
  'DOM sync treats an in-focus Hours input as an edit so hydrate cannot flip it');
assert(html.includes('_refreshHoursDataForOpenInvoice'),
  'draft restore still fetches my_hours so per-metre hydrate/submit gate can arm');
assert(html.includes('is_per_metre: isPerMetreUser()'),
  'the invoice draft remembers per-metre so restore does not wait on my_hours');

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
