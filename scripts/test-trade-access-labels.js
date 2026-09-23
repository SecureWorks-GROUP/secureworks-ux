#!/usr/bin/env node
/**
 * Trade access labels (page review group 1): TradeAccessCore names what each
 * person's access actually is, per role, from the shipped trade.html code.
 * Office, vertical manager, work-order trade and hourly crew; trade tier is
 * never the label, so a tier-1 lead installer does not read as contradictory.
 */
const fs = require('fs')
const assert = require('assert')
const path = require('path')

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8')
const OPEN = '// <trade-access-core>'
const CLOSE = '// </trade-access-core>'
const a = html.indexOf(OPEN)
const b = html.indexOf(CLOSE)
assert(a !== -1 && b > a, 'trade-access-core sentinels present in trade.html')
// eslint-disable-next-line no-new-func
const core = new Function(html.slice(a + OPEN.length, b) + '\n;return TradeAccessCore;')()

function check(name, user, expected) {
  const got = core.describe(user)
  for (const key of Object.keys(expected)) {
    assert.strictEqual(got[key], expected[key], `${name}: ${key} was ${JSON.stringify(got[key])}`)
  }
  assert(!/tier|division manager|senior installer/i.test(JSON.stringify(got)), `${name}: no tier wording`)
  return got
}

// Office (Shaun): ops manager, tier 3, every vertical, hourly.
check('office', { role: 'ops_manager', trade_tier: 3, invoice_type: 'hourly', managed_verticals: ['makesafe', 'fencing', 'patio', 'repair'] }, {
  tone: 'office', title: 'Office', everyone: 'Everyone · all trades', pay: 'Paid by the hour'
})
check('office admin', { role: 'admin', managed_verticals: [] }, { tone: 'office', title: 'Office admin', everyone: 'Everyone · all trades', pay: '' })

// Vertical manager (Ryan): crew role, tier 2, make-safe. Role "crew" must not win.
check('make-safe manager', { role: 'crew', trade_tier: 2, invoice_type: 'hourly', managed_verticals: ['makesafe'] }, {
  tone: 'manager', title: 'Make-safe manager', everyone: 'Everyone · make-safe', pay: 'Paid by the hour'
})

// Vertical manager + work-order trade (Henry): lead installer, tier 3, per-metre, fencing.
const henry = check('fencing manager on work orders', { role: 'lead_installer', trade_tier: 3, invoice_type: 'per_metre', managed_verticals: ['fencing'] }, {
  tone: 'manager', title: 'Fencing manager', everyone: 'Everyone · fencing', pay: 'Paid by work order'
})
assert(/every fencing job/.test(henry.scope), 'manager scope names the vertical')

// Two managed verticals read as one list, de-duplicated and ordered.
check('two verticals', { role: 'crew', managed_verticals: ['Makesafe', 'fencing', 'fencing', ''] }, {
  title: 'Fencing and make-safe manager', everyone: 'Everyone · fencing, make-safe'
})

// Work-order trade with no managed vertical.
check('work-order trade', { role: 'crew', trade_tier: 1, invoice_type: 'per_metre', managed_verticals: [] }, {
  tone: 'crew', title: 'Work-order trade', everyone: '', pay: ''
})

// Hourly crew (Alyx): no Everyone lens, scope explains All search.
const alyx = check('hourly crew', { role: 'crew', trade_tier: 1, invoice_type: 'hourly', managed_verticals: [] }, {
  tone: 'crew', title: 'Crew', everyone: '', pay: 'Paid by the hour'
})
assert(/search All in Jobs/.test(alyx.scope), 'crew scope points at All search')

// Tier-1 lead installer: role label, never a tier label that contradicts it.
check('tier-1 lead installer', { role: 'lead_installer', trade_tier: 1, managed_verticals: null }, {
  tone: 'crew', title: 'Lead installer', everyone: ''
})

// Missing profile facts stay honest (no invented pay basis).
check('empty profile', null, { title: 'Crew', pay: '', everyone: '' })

console.log('trade access labels: ok')
