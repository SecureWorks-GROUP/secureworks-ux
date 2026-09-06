#!/usr/bin/env node
/**
 * Alyx / crew trade visibility UX pins (Tickets 2-3):
 * - Jobs paints "My recent completed" + unscheduled (not Needs Report)
 * - viewOnly uses access_tier / quote_visible for managers
 * - Pay weekly-invoice entry is not tier-gated for allocated crew
 */
const fs = require('fs')
const vm = require('vm')
const assert = require('assert')
const path = require('path')

const htmlPath = path.join(__dirname, '..', 'trade.html')
const html = fs.readFileSync(htmlPath, 'utf8')

function block(startMarker, endMarker) {
  const start = html.indexOf(startMarker)
  const end = html.indexOf(endMarker, start)
  assert(start !== -1 && end !== -1, `missing markers ${startMarker} .. ${endMarker}`)
  return html.slice(start, end + endMarker.length)
}

// ── Ticket 2: Jobs discovery sections ──────────────────────────────────────
assert(html.includes("{ key: 'recentCompleted', label: 'My recent completed' }"),
  'Jobs list includes My recent completed section')
assert(html.includes("{ key: 'unscheduled', label: 'Unscheduled' }"),
  'Jobs list paints server unscheduled bucket')
assert(html.includes("{ key: 'recent', label: 'Needs Report' }"),
  'Needs Report label retained for the report-action queue')
assert(!html.includes("{ key: 'recent', label: 'My recent completed' }"),
  'completed work is not dumped into the Needs Report section key')
assert(html.includes("showView('hours')") && html.includes('Open Pay'),
  'empty Jobs state deep-links Pay for finished-work discovery')
assert(
  html.includes("['today', 'thisWeek', 'upcoming', 'recent', 'recentCompleted', 'unscheduled']"),
  'assignment cache includes recentCompleted + unscheduled'
)

// Fencing board ingest must not drop the new completed bucket
assert(
  /\['today', 'thisWeek', 'upcoming', 'recent', 'recentCompleted', 'unscheduled', 'makesafePool'\]/.test(html),
  'fencing board ingests recentCompleted'
)

// ── Ticket 3: viewOnly from server access tier ─────────────────────────────
const foreignBlock = block('// <foreign-job-readonly>', '// </foreign-job-readonly>')
const context = {
  window: {},
  _user: { id: 'henry' },
  _currentJob: null,
  getTradeJobType: () => 'fencing'
}
vm.runInNewContext(foreignBlock, context)
const helpers = context.window.__SW_TRADE_FOREIGN_JOB_TESTS
assert(helpers, 'foreign-job helpers exported for regression')

const otherCrew = {
  access_tier: 'allocated',
  quote_visible: false,
  crew: [{ id: 'a1', user_id: 'alyx', name: 'Alyx' }]
}
assert.strictEqual(helpers.isForeignCrewJob(otherCrew), true,
  'allocated viewer on another crew stays view-only')

const ownCrew = {
  access_tier: 'allocated',
  quote_visible: false,
  crew: [{ id: 'a1', user_id: 'henry', name: 'Henry' }]
}
assert.strictEqual(helpers.isForeignCrewJob(ownCrew), false,
  'own assignment is not view-only')

const managerOtherCrew = {
  access_tier: 'division_manager',
  quote_visible: true,
  crew: [{ id: 'a1', user_id: 'alyx', name: 'Alyx' }]
}
assert.strictEqual(helpers.isForeignCrewJob(managerOtherCrew), false,
  'division_manager is not forced view-only by foreign crew membership')

const officeOtherCrew = {
  access_tier: 'office',
  quote_visible: true,
  crew: [{ id: 'a1', user_id: 'alyx', name: 'Alyx' }]
}
assert.strictEqual(helpers.isForeignCrewJob(officeOtherCrew), false,
  'office tier is not forced view-only by foreign crew membership')

const quoteOnly = {
  access_tier: 'allocated',
  quote_visible: true,
  crew: [{ id: 'a1', user_id: 'alyx', name: 'Alyx' }]
}
assert.strictEqual(helpers.isForeignCrewJob(quoteOnly), false,
  'quote_visible alone clears viewOnly (manager/office signal)')

// ── Ticket 3: Pay path for tier 1 ──────────────────────────────────────────
// Weekly Invoice is the labour invoice door; it must not sit behind _userTier >= 2.
assert(html.includes('onclick="openWeeklyInvoice()"'), 'Pay hub exposes Weekly Invoice')
const weeklyBtnIdx = html.indexOf('onclick="openWeeklyInvoice()"')
const preceding = html.slice(Math.max(0, weeklyBtnIdx - 400), weeklyBtnIdx)
assert(!/if\s*\(\s*_userTier\s*>=\s*2\s*\)[\s\S]{0,350}openWeeklyInvoice/.test(preceding + 'openWeeklyInvoice'),
  'Weekly Invoice button is not wrapped in a tier>=2 gate')
assert(html.includes("_financialInvoiceApi('generate_trade_invoice'"), 'Pay path still calls generate_trade_invoice')
// Job-card WO invoice remaining tier>=2 is intentional (plan Ticket 3).
assert(html.includes('_userTier >= 2') && html.includes('Invoice This Work Order'),
  'job-card WO invoice gate still exists for tier>=2 (Pay is the tier-1 door)')

console.log('PASS alyx trade visibility Jobs + viewOnly + Pay pins')
