#!/usr/bin/env node
const fs = require('fs')
const vm = require('vm')
const assert = require('assert')

const html = fs.readFileSync('trade.html', 'utf8')
const start = html.indexOf("var TODAY_RUN_LIST_STORAGE_PREFIX = 'sw_today_run_list_v1'")
const end = html.indexOf('\n\n  function hasJobInAssignmentGroups', start)
assert(start !== -1 && end !== -1, 'Today Run List helper block is present and extractable')
const helperBlock = html.slice(start, end)

function makeStorage() {
  const store = Object.create(null)
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    dump: () => ({ ...store })
  }
}

const localStorage = makeStorage()
const context = {
  window: {},
  localStorage,
  _user: { id: 'trade-user-1', name: 'Isaac' },
  _lastJobData: null,
  awstDateStr: () => '2026-06-08',
  renderMyJobs: () => {}
}
vm.runInNewContext(helperBlock, context)
const helpers = context.window.__SW_TRADE_TODAY_RUN_LIST_TESTS
assert(helpers, 'helpers are exposed for regression testing')

const jobs = [
  { id: 'asg-a', crew_name: 'Crew A', start_time: '09:00', status: 'scheduled', jobs: { id: 'job-a', client_name: 'A' } },
  { id: 'asg-b', crew_name: 'Crew A', start_time: '10:00', status: 'scheduled', jobs: { id: 'job-b', client_name: 'B' } },
  { id: 'asg-c', crew_name: 'Crew A', start_time: '11:00', status: 'scheduled', jobs: { id: 'job-c', client_name: 'C' } }
]

let state = helpers.getTodayRunListState(jobs)
assert.deepStrictEqual(Array.from(state.ids), ['job-a', 'job-b', 'job-c'], 'initial natural Today order is persisted')
assert(state.key.includes('sw_today_run_list_v1:2026-06-08:trade-user-1:Crew A'), 'key is per date/user/crew')

localStorage.setItem(state.key, JSON.stringify(['job-c', 'job-a', 'stale-job']))
state = helpers.getTodayRunListState(jobs)
assert.deepStrictEqual(Array.from(state.ids), ['job-c', 'job-a', 'job-b'], 'stored order removes stale ids and appends new today jobs')
assert.deepStrictEqual(Array.from(state.items.map((a) => a.jobs.id)), ['job-c', 'job-a', 'job-b'], 'stored order controls rendered order')

const otherCrewKey = helpers.getTodayRunListStorageKey([{ id: 'asg-x', crew_name: 'Crew B', jobs: { id: 'job-x' } }])
assert.notStrictEqual(otherCrewKey, state.key, 'different crew gets a separate persisted order')

assert.strictEqual(helpers.isReportSubmittedForTradeCard({ service_report_status: 'submitted' }, {}), true, 'submitted service report marks card complete')
assert.strictEqual(helpers.isReportSubmittedForTradeCard({ makesafe_details: { substatus: 'admin_to_send_report' } }, {}), true, 'MakeSafe post-submit substatus marks card complete')
assert.strictEqual(helpers.isReportSubmittedForTradeCard({ status: 'scheduled' }, { status: 'scheduled' }), false, 'scheduled job is not complete-looking')

const leftover = (job, assignmentStatus = 'scheduled') => ({
  id: `asg-${job.id}`,
  scheduled_date: '2026-06-01',
  status: assignmentStatus,
  jobs: { type: 'makesafe', ...job }
})

assert.strictEqual(helpers.shouldShowTodayMakesafeLeftover(leftover({ id: 'archived-flag', status: 'scheduled', archived: true })), false, 'archived flag drops a past-dated card from Today leftovers')
for (const status of ['archived', 'cancelled', 'complete', 'completed', 'invoiced', 'paid', 'closed', 'void', 'deleted', 'duplicate', 'duplicated', 'voided']) {
  assert.strictEqual(helpers.shouldShowTodayMakesafeLeftover(leftover({ id: `dead-${status}`, status })), false, `${status} job drops from Today leftovers`)
}
for (const reportStatus of ['submitted', 'approved', 'sent', 'report_ready']) {
  assert.strictEqual(helpers.shouldShowTodayMakesafeLeftover(leftover({ id: `reported-${reportStatus}`, status: 'scheduled', service_report_status: reportStatus })), false, `${reportStatus} report drops from Needs Report`)
}
for (const substatus of ['admin_to_send_report', 'ready_to_invoice', 'complete', 'report_ready', 'to_invoice', 'invoiced']) {
  assert.strictEqual(helpers.shouldShowTodayMakesafeLeftover(leftover({ id: `past-trade-${substatus}`, status: 'scheduled', makesafe_details: { substatus } })), false, `${substatus} make-safe drops from Needs Report`)
}
assert.strictEqual(helpers.shouldShowTodayMakesafeLeftover(leftover({ id: 'live-report-owed', status: 'scheduled' })), true, 'past-dated live make-safe with no report stays on Needs Report')
assert.strictEqual(helpers.shouldShowTodayMakesafeLeftover(leftover({ id: 'completed-attendance-report-owed', status: 'scheduled' }, 'complete')), true, 'completed attendance stays visible while the live job still genuinely owes the trade report')
assert(html.includes('filtered = filtered.filter(shouldShowTodayMakesafeLeftover);'), 'Today borrowed make-safe strips apply the shared leftover eligibility helper')

assert(html.includes("var _jobFilter = 'today'"), 'Jobs view defaults to Today filter')
assert(html.includes('data-filter="today"') && html.includes('filter-chip active'), 'Today filter chip is active by default')
assert(html.includes('renderTradeCardCompactSummary'), 'job cards use the compact field-card summary')
assert(!html.includes('renderTradeCardFacts(job, a, type)'), 'job cards do not render the old database fact grid')
assert(!html.includes('Builder #') && !html.includes('External #'), 'standard cards do not expose empty builder/external database labels')
// Runsheet retired per captain ruling ("it loses its value"): Today is simply
// the day's cards in time order — no reorder controls, no run-numbering badges.
// getTodayRunListState still supplies the natural/persisted order (covered above).
assert(!/html\s*\+=\s*renderRunListControls\(/.test(html), 'runsheet reorder controls no longer render on any card')
assert(!html.includes('<span class="run-list-order-badge">'), 'run-numbering badges are removed from Today cards')
assert(!html.includes('Open report</button>'), 'visible Open report button is removed from job cards')
assert(html.includes('openJobReport'), 'MakeSafe card tap still opens the report path')
assert(!/maps\.googleapis\.com|google\.maps\.DirectionsService|DirectionsRenderer/.test(html), 'MVP avoids Google Maps route optimization APIs')

console.log('PASS trade Today Run List regression checks')
