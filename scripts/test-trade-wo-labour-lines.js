#!/usr/bin/env node
// Regression: WO-mode labour deductions must identify the named crew member.
//
// The reported production bug (2026-07-30): Alyx worked out SWF-26767 as
// WO $559.50 with labour line "Tendo" 11.5h × $25 = $287.50, net $272. The
// $287.50 came off Alyx's net but the office could not reconcile it to Tendo
// from the prose description and mis-keyed it in production. The structured
// labour lines make the CLIENT payload the reconciliation contract: this
// harness extracts the [JC-PAYLOAD-BUILD-START..END] block verbatim from
// trade.html, executes it, and pins the deduction details shown to the office
// while named crew bill SecureWorks Group directly.
const fs = require('fs')
const assert = require('assert')
const vm = require('vm')

const html = fs.readFileSync('trade.html', 'utf8')

function createWebLockBroker() {
  const state = Object.create(null)
  function slot(name) {
    if (!state[name]) state[name] = { held: false, waiters: [] }
    return state[name]
  }
  function release(name) {
    const s = slot(name)
    s.held = false
    const next = s.waiters.shift()
    if (next) next()
  }
  function acquire(name, cb, resolve, reject) {
    const s = slot(name)
    if (s.held) {
      s.waiters.push(function() { acquire(name, cb, resolve, reject) })
      return
    }
    s.held = true
    Promise.resolve().then(function() { return cb({ name: name }) }).then(function(value) {
      release(name)
      resolve(value)
    }, function(err) {
      release(name)
      reject(err)
    })
  }
  return {
    request: function(name, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {} }
      opts = opts || {}
      if (opts.ifAvailable && slot(name).held) return Promise.resolve(cb(null))
      return new Promise(function(resolve, reject) {
        acquire(name, cb, resolve, reject)
      })
    }
  }
}

const startMark = '// [JC-PAYLOAD-BUILD-START]'
const endMark = '// [JC-PAYLOAD-BUILD-END]'
const start = html.indexOf(startMark)
const end = html.indexOf(endMark)
assert(start !== -1 && end !== -1 && end > start, 'JC-PAYLOAD block markers exist')
const block = html.slice(start, end)

const context = {
  // The block references _isMakesafeCard (defined outside it in trade.html);
  // none of these cards are make-safe, so a false stub is faithful.
  _isMakesafeCard: function() { return false },
  console,
}
vm.createContext(context)
vm.runInContext(block, context)

function woCard(overrides) {
  return Object.assign({
    _idx: 0,
    included: true,
    wo_mode: true,
    job_id: 'j-26767',
    job_number: 'SWF-26767',
    job_type: 'fencing',
    client_name: 'Kelvin Gillies',
    scheduled_date: '2026-07-14',
    wo_allocated: 559.5,
    wo_labour_lines: [{ trade_name: 'Tendo', hours: 11.5, rate: 25 }],
    description: '',
    manually_added: false,
  }, overrides || {})
}

// ── The captain's screenshot, end to end ─────────────────────────────────
{
  const built = context._buildJobCentricPayload([woCard()])
  assert(!built.error, 'captain case builds without error: ' + built.error)
  assert.strictEqual(built.cardExtraItems.length, 1)
  const row = built.cardExtraItems[0]
  assert.strictEqual(row.row_type, 'work_order')
  assert.strictEqual(row.rate, 272, 'WO holder net is 559.5 − 287.5 = 272')
  assert.strictEqual(row.wo_allocated, 559.5)
  assert.strictEqual(row.wo_labour_deduction, 287.5)
  // JSON round-trip: vm-context objects carry a foreign Object.prototype.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(row.wo_labour_lines)), [
    { trade_name: 'Tendo', hours: 11.5, rate: 25, amount: 287.5 },
  ], 'structured labour line rides the payload for office reconciliation')
  assert(row.description.indexOf('Tendo 11.5h×$25=$287.5') !== -1, 'prose audit trail kept')
  assert.strictEqual(built.subtotal, 272)
}

// ── Name hygiene: "Tendo  " (production data) is the same person ─────────
{
  const built = context._buildJobCentricPayload([woCard({
    wo_labour_lines: [{ trade_name: '  Tendo  ', hours: 11.5, rate: 25 }],
  })])
  assert(!built.error, 'padded name builds: ' + built.error)
  assert.strictEqual(built.cardExtraItems[0].wo_labour_lines[0].trade_name, 'Tendo')
  assert(built.cardExtraItems[0].description.indexOf('Tendo 11.5h') !== -1, 'breakdown text uses the cleaned name')
}

// ── Multiple labourers on one WO ─────────────────────────────────────────
{
  const built = context._buildJobCentricPayload([woCard({
    wo_allocated: 2000,
    wo_labour_lines: [
      { trade_name: 'Henry', hours: 4, rate: 50 },
      { trade_name: 'Jose', hours: 6, rate: 45 },
    ],
  })])
  assert(!built.error, 'multi-line builds: ' + built.error)
  const row = built.cardExtraItems[0]
  assert.strictEqual(row.wo_labour_deduction, 470)
  assert.strictEqual(row.rate, 1530)
  assert.strictEqual(row.wo_labour_lines.length, 2)
}

// ── Empty template rows are dropped, not sent ────────────────────────────
{
  const built = context._buildJobCentricPayload([woCard({
    wo_labour_lines: [
      { trade_name: 'Tendo', hours: 11.5, rate: 25 },
      { trade_name: '', hours: null, rate: null }, // untouched "+ Add labour line"
    ],
  })])
  assert(!built.error, 'template row builds: ' + built.error)
  assert.strictEqual(built.cardExtraItems[0].wo_labour_lines.length, 1)
  assert.strictEqual(built.cardExtraItems[0].rate, 272)
}

// ── Money with no person blocks (deduction must be attributable) ─────────
{
  const built = context._buildJobCentricPayload([woCard({
    wo_labour_lines: [{ trade_name: '', hours: 2, rate: 30 }],
  })])
  assert(built.error, 'unnamed money must block')
  assert(built.error.indexOf('name the crew member') !== -1, 'error says why: ' + built.error)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(built.missingIndices)), [0])
}

// ── A person with no money blocks (half-filled line) ─────────────────────
{
  const built = context._buildJobCentricPayload([woCard({
    wo_labour_lines: [{ trade_name: 'Kim', hours: 0, rate: 25 }],
  })])
  assert(built.error, 'named line without hours must block')
  assert(built.error.indexOf('Kim') !== -1, 'error names the person: ' + built.error)
}

// ── Existing WO guards unchanged ─────────────────────────────────────────
{
  const neg = context._buildJobCentricPayload([woCard({
    wo_allocated: 100,
    wo_labour_lines: [{ trade_name: 'Tendo', hours: 10, rate: 25 }],
  })])
  assert(neg.error && neg.error.indexOf('negative') !== -1, 'negative net still blocks')

  const zero = context._buildJobCentricPayload([woCard({
    wo_allocated: 287.5,
    wo_labour_lines: [{ trade_name: 'Tendo', hours: 11.5, rate: 25 }],
  })])
  assert(zero.error && zero.error.indexOf('$0.00') !== -1, 'zero net still blocks')

  const noAlloc = context._buildJobCentricPayload([woCard({ wo_allocated: null })])
  assert(noAlloc.error && noAlloc.error.indexOf('WO allocated') !== -1, 'missing WO amount still blocks')
}

function hoursCard(overrides) {
  return Object.assign({
    _idx: 0,
    included: true,
    assignment_id: 'a1',
    hours: 8,
    rate: 40,
    job_id: 'j-hours',
    job_number: 'SWF-HOURS',
    job_type: 'fencing',
    client_name: 'Test Client',
    scheduled_date: '2026-07-14',
    description: '',
    manually_added: false,
    wo_lump_lines: [],
  }, overrides || {})
}

// ── Hourly cards untouched by the labour-line validation ─────────────────
{
  const built = context._buildJobCentricPayload([hoursCard()])
  assert(!built.error, 'plain hourly card builds: ' + built.error)
  assert.strictEqual(built.manualAssignments.length, 1)
}

// ── Hours-card lump: peer option to hours, same extra_items deduct ───────
{
  const built = context._buildJobCentricPayload([hoursCard({
    wo_lump_lines: [{ description: 'Materials', amount: 10, line_kind: 'lump_sum' }],
  })])
  assert(!built.error, 'hours + lump builds: ' + built.error)
  assert.strictEqual(built.manualAssignments.length, 1)
  assert.strictEqual(built.cardExtraItems.length, 1)
  const extra = built.cardExtraItems[0]
  assert.strictEqual(extra.source, 'invoice_final_deduction')
  assert.strictEqual(extra.line_kind, 'lump_sum')
  assert.strictEqual(extra.rate, -10)
  assert.strictEqual(extra.job_number, 'SWF-HOURS')
  assert.strictEqual(extra.description, 'Materials')
  assert.strictEqual(built.subtotal, 310, '8h×$40 − Materials $10')
}

{
  const built = context._buildJobCentricPayload([hoursCard({
    hours: null,
    wo_lump_lines: [{ description: 'Site allowance', amount: 50, line_kind: 'lump_sum' }],
  })])
  assert(!built.error, 'lumps-only hours card builds without hours: ' + built.error)
  assert.strictEqual(built.manualAssignments.length, 0)
  assert.strictEqual(built.cardExtraItems.length, 1)
  assert.strictEqual(built.cardExtraItems[0].rate, -50)
  assert.strictEqual(built.subtotal, -50)
}

{
  const built = context._buildJobCentricPayload([hoursCard({
    wo_lump_lines: [{ description: '', amount: 10 }],
  })])
  assert(built.error, 'hours-card lump amount without description must block')
  assert(built.error.indexOf('describe') !== -1, 'error asks for a description: ' + built.error)
}

{
  const built = context._buildJobCentricPayload([hoursCard({
    assignment_id: null,
    hours: 2,
    rate: 50,
    description: 'Extra visit',
    manually_added: true,
    wo_lump_lines: [{ description: 'Fuel', amount: 15, line_kind: 'lump_sum' }],
  })])
  assert(!built.error, 'searched hours + lump builds: ' + built.error)
  assert.strictEqual(built.manualAssignments.length, 0)
  assert.strictEqual(built.cardExtraItems.length, 2)
  assert.strictEqual(built.cardExtraItems[0].row_type, 'labour')
  assert.strictEqual(built.cardExtraItems[1].source, 'invoice_final_deduction')
  assert.strictEqual(built.subtotal, 85, '2h×$50 − Fuel $15')
}

// ── WO pass-through: amount Henry paid another trade, not hours×rate ─────
{
  const built = context._buildJobCentricPayload([woCard({
    wo_allocated: 100,
    wo_labour_lines: [
      { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40 }
    ],
  })])
  assert(!built.error, 'pass-through builds: ' + built.error)
  const row = built.cardExtraItems[0]
  assert.strictEqual(row.rate, 60, 'net is WO 100 − Israel 40')
  assert.strictEqual(row.wo_labour_deduction, 40)
  assert.strictEqual(row.wo_labour_lines[0].line_kind, 'wo_pass_through')
  assert.strictEqual(row.wo_labour_lines[0].amount, 40)
  assert(row.description.indexOf('Israel $40') !== -1, 'breakdown names the WO trade: ' + row.description)
}

{
  const built = context._buildJobCentricPayload([woCard({
    wo_allocated: 559.5,
    wo_labour_lines: [
      { trade_name: 'Tendo', hours: 11.5, rate: 25 },
      { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40 }
    ],
  })])
  assert(!built.error, 'mixed labour + pass-through builds: ' + built.error)
  assert.strictEqual(built.cardExtraItems[0].rate, 232)
  assert(built.cardExtraItems[0].description.indexOf('Tendo 11.5h×$25=$287.5') !== -1)
  assert(built.cardExtraItems[0].description.indexOf('Israel $40') !== -1)
}

// ── Lump-sum deduct: description + amount, not hours×rate ────────────────
{
  const built = context._buildJobCentricPayload([woCard({
    wo_allocated: 100,
    wo_labour_lines: [
      { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40 }
    ],
    wo_lump_lines: [
      { description: 'Materials', amount: 10, line_kind: 'lump_sum' }
    ],
  })])
  assert(!built.error, 'lump-sum builds: ' + built.error)
  const row = built.cardExtraItems[0]
  assert.strictEqual(row.rate, 50, 'net is WO 100 − Israel 40 − Materials 10')
  assert.strictEqual(row.wo_labour_deduction, 40)
  assert.strictEqual(row.wo_lump_deduction, 10)
  assert.strictEqual(row.wo_lump_lines[0].line_kind, 'lump_sum')
  assert.strictEqual(row.wo_lump_lines[0].description, 'Materials')
  assert.strictEqual(row.wo_lump_lines[0].amount, 10)
  assert(row.description.indexOf('other [Materials $10]') !== -1, 'breakdown names the lump: ' + row.description)
  assert.strictEqual(built.cardExtraItems.filter((item) => item.source === 'invoice_final_deduction').length, 0,
    'WO deducts stay nested on the WO extra and are not also emitted as extra_items')
}

{
  const deductStart = html.indexOf('function _hoursCardLumpFinalDeductions')
  const deductEnd = html.indexOf('function _syncInvLumpLinesFromDOM')
  assert(deductStart !== -1 && deductEnd > deductStart, 'final-deduction helpers exist')
  context._invLumpLines = [{ description: 'Car loan', amount: 20 }]
  context._jobCards = [
    woCard({
      included: true,
      wo_allocated: 100,
      wo_labour_lines: [
        { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40 },
        { trade_name: 'Tendo', hours: 2, rate: 25 },
      ],
      wo_lump_lines: [{ description: 'Materials', amount: 10, line_kind: 'lump_sum' }],
    }),
    hoursCard({
      included: true,
      wo_lump_lines: [{ description: 'Fuel', amount: 15, line_kind: 'lump_sum' }],
    }),
  ]
  vm.runInContext(html.slice(deductStart, deductEnd), context)
  const finals = context._invFinalDeductions()
  const descs = finals.map((row) => row.description + ':' + row.unit_rate)
  assert.ok(descs.indexOf('Car loan:20') !== -1, 'invoice-level lumps stay on final_deductions')
  assert.ok(descs.indexOf('Fuel:15') !== -1, 'hours-card lumps stay on final_deductions')
  assert.ok(descs.indexOf('Israel:40') !== -1, 'hydrated WO pass-throughs ride top-level final_deductions')
  assert.ok(descs.indexOf('Materials:10') !== -1, 'WO-card lumps ride top-level final_deductions')
  assert.ok(descs.indexOf('Tendo:50') === -1, 'named WO labour hours are not copied onto final_deductions')
  assert.strictEqual(finals.length, 4, 'each distinct deduct appears once on the common list')
}

{
  const built = context._buildJobCentricPayload([woCard({
    wo_allocated: 100,
    wo_labour_lines: [],
    wo_lump_lines: [{ description: '', amount: 10 }],
  })])
  assert(built.error, 'lump amount without description must block')
  assert(built.error.indexOf('describe') !== -1, 'error asks for a description: ' + built.error)
}

{
  const built = context._buildJobCentricPayload([woCard({
    wo_allocated: 100,
    wo_labour_lines: [],
    requires_work_order_id: true,
    work_order_id: '',
  })])
  assert(built.error, 'per-metre WO card without work_order_id must block')
  assert(built.error.indexOf('no work order yet') !== -1, 'error names the missing WO: ' + built.error)
}

{
  const built = context._buildJobCentricPayload([woCard({
    wo_allocated: 100,
    wo_labour_lines: [],
    work_order_id: '',
  })])
  assert(!built.error, 'other trades can still submit a WO-mode card without work_order_id: ' + built.error)
}

// ── No-ID pass-through merge is a multiset, not a name+amount collapse ──
{
  const startMark = '// [WO-PASSTHROUGH-MERGE-START]'
  const endMark = '// [WO-PASSTHROUGH-MERGE-END]'
  const mergeStart = html.indexOf(startMark)
  const mergeEnd = html.indexOf(endMark)
  assert(mergeStart !== -1 && mergeEnd > mergeStart, 'pass-through merge markers exist')
  vm.runInContext(html.slice(mergeStart, mergeEnd), context)
  const israel = { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40 }
  const two = context._mergeServerPassThroughs([], [israel, Object.assign({}, israel)])
  assert.strictEqual(two.lines.length, 2, 'two no-ID Israel $40 charges both land')
  assert.strictEqual(two.changed, true)
  const retry = context._mergeServerPassThroughs(two.lines, [israel, Object.assign({}, israel)])
  assert.strictEqual(retry.lines.length, 2, 'a second hydrate does not double no-ID lines')
  assert.strictEqual(retry.changed, false)
  const untaggedCollision = context._mergeServerPassThroughs([Object.assign({}, israel)], [israel, Object.assign({}, israel)])
  assert.strictEqual(untaggedCollision.unresolved, true,
    'an untagged local no-ID line colliding with server no-ID money stays unresolved')
  assert.strictEqual(untaggedCollision.lines.length, 1, 'unresolved merge does not rewrite restored lines')
  const localOwned = { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40, server_owned: false }
  const oneLocal = context._mergeServerPassThroughs([localOwned], [
    Object.assign({}, israel, { server_owned: true }),
    Object.assign({}, israel, { server_owned: true }),
  ])
  assert.strictEqual(oneLocal.unresolved, false)
  assert.strictEqual(oneLocal.lines.length, 3, 'a tagged local no-ID line plus two server lines keeps all three deducts')
  const staleSameId = { trade_name: 'Old Israel', line_kind: 'wo_pass_through', amount: 99, source_line_id: 'wo-fence-charge-israel' }
  const freshSameId = { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40, source_line_id: 'wo-fence-charge-israel' }
  const replaced = context._mergeServerPassThroughs([staleSameId, { trade_name: 'Kim', hours: 1, rate: 20 }], [freshSameId])
  assert.strictEqual(replaced.changed, true, 'same-ID stale amount/name is replaced')
  assert.strictEqual(replaced.lines.length, 2, 'same-ID replace does not drop neighbouring labour')
  assert.strictEqual(replaced.lines[0].amount, 40, 'same-ID amount is current server truth')
  assert.strictEqual(replaced.lines[0].trade_name, 'Israel', 'same-ID name is current server truth')
  assert.strictEqual(replaced.lines[1].trade_name, 'Kim', 'hourly labour stays in place after same-ID replace')
}

// ── Hydrate authorizes only invoiceable in-week WOs ──
{
  const startMark = '// [WO-HYDRATE-FILTER-START]'
  const endMark = '// [WO-HYDRATE-FILTER-END]'
  const filterStart = html.indexOf(startMark)
  const filterEnd = html.indexOf(endMark)
  assert(filterStart !== -1 && filterEnd > filterStart, 'hydrate filter markers exist')
  context._weeklyWorkOrderDate = function (wo) {
    return String((wo && (wo.scheduled_date || wo.date)) || '').slice(0, 10)
  }
  context._hoursWeekStart = '2026-09-07'
  context._hoursWeekEnd = '2026-09-13'
  vm.runInContext(html.slice(filterStart, filterEnd), context)
  const inWeek = {
    id: 'wo-in',
    scheduled_date: '2026-09-08',
    can_invoice: true,
    already_invoiced: false,
  }
  assert.strictEqual(context._workOrderInvoiceableForHydrate(inWeek), true, 'in-week invoiceable WO hydrates')
  assert.strictEqual(context._workOrderInvoiceableForHydrate(Object.assign({}, inWeek, {
    already_invoiced: true,
  })), false, 'already invoiced WO is not hydrated')
  assert.strictEqual(context._workOrderInvoiceableForHydrate(Object.assign({}, inWeek, {
    can_invoice: false,
    can_add_to_weekly_invoice: false,
  })), false, 'skipped WO is not hydrated')
  assert.strictEqual(context._workOrderInvoiceableForHydrate(Object.assign({}, inWeek, {
    scheduled_date: '2026-08-31',
  })), false, 'out-of-week WO is not hydrated')
  assert.strictEqual(context._workOrderInvoiceableForHydrate({
    id: 'wo-undated',
    can_invoice: true,
    already_invoiced: false,
  }), true, 'undated invoiceable WO still hydrates (Firstmate pending)')
}

// ── Hydrate overwrites stale server-owned money; reconcile clears it ──
{
  const moneyStart = html.indexOf('// [WO-SERVER-MONEY-START]')
  const moneyEnd = html.indexOf('// [WO-SERVER-MONEY-END]')
  const reconStart = html.indexOf('// [WO-RECONCILE-AUTH-START]')
  const reconEnd = html.indexOf('// [WO-RECONCILE-AUTH-END]')
  assert(moneyStart !== -1 && moneyEnd > moneyStart, 'server-money markers exist')
  assert(reconStart !== -1 && reconEnd > reconStart, 'reconcile markers exist')
  vm.runInContext(html.slice(moneyStart, moneyEnd), context)
  vm.runInContext(html.slice(reconStart, reconEnd), context)

  const israel = { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40, source_line_id: 'wo-fence-charge-israel' }
  const stalePt = { trade_name: 'Stale', line_kind: 'wo_pass_through', amount: 77, source_line_id: 'wo-stale-old-line' }
  const kim = { trade_name: 'Kim', hours: 1, rate: 20 }
  const userPt = { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40 }
  const card = {
    wo_allocated: 999,
    wo_labour_lines: [stalePt, kim, userPt],
    wo_lump_lines: [{ description: 'Materials', amount: 10 }],
    work_order_id: 'wo-fence-authorised',
    wo_mode: true,
  }
  const woComplete = { subtotal: 100, negative_charges: [{ amount: 40, source_line_id: 'wo-fence-charge-israel' }] }
  const changed = context._applyHydratedWorkOrderMoney(card, woComplete, [israel])
  assert.strictEqual(changed, true)
  assert.strictEqual(card.wo_allocated, 100, 'hydrate overwrites stale allocated')
  assert.strictEqual(card.wo_labour_lines.filter((ln) => ln.source_line_id === 'wo-stale-old-line').length, 0,
    'stale server pass-through is dropped')
  assert.strictEqual(card.wo_labour_lines.filter((ln) => ln.source_line_id === 'wo-fence-charge-israel').length, 1,
    'current server Israel rematches once')
  assert.strictEqual(card.wo_labour_lines.filter((ln) => ln.trade_name === 'Kim').length, 1, 'hourly labour is kept')
  assert.strictEqual(card.wo_labour_lines.filter((ln) => ln.line_kind === 'wo_pass_through' && !ln.source_line_id).length, 1,
    'user-added no-id pass-through is kept')
  assert.strictEqual(card.wo_lump_lines[0].description, 'Materials', 'user lump lines are kept')

  const staleSameIdCard = {
    wo_allocated: 100,
    wo_labour_lines: [
      { trade_name: 'Old Israel', line_kind: 'wo_pass_through', amount: 99, source_line_id: 'wo-fence-charge-israel' },
      kim,
    ],
  }
  assert.strictEqual(context._applyHydratedWorkOrderMoney(staleSameIdCard, woComplete, [israel]), true)
  assert.strictEqual(staleSameIdCard.wo_labour_lines[0].amount, 40, 'hydrate overwrites same-ID stale amount')
  assert.strictEqual(staleSameIdCard.wo_labour_lines[0].trade_name, 'Israel', 'hydrate overwrites same-ID stale name')
  assert.strictEqual(staleSameIdCard.wo_labour_lines[1].trade_name, 'Kim', 'same-ID replace keeps hourly labour in place')

  const stripped = {
    work_order_id: 'wo-stale-not-authorized',
    wo_number: 'WO-STALE',
    wo_mode: true,
    wo_allocated: 99,
    wo_labour_lines: [stalePt, kim],
  }
  context._jobCards = [stripped]
  assert.strictEqual(context._reconcileJobCardWorkOrderAuth({}), true)
  assert.strictEqual(stripped.work_order_id, '')
  assert.strictEqual(stripped.wo_mode, false)
  assert.strictEqual(stripped.wo_allocated, null, 'unauthorized WO clears allocated')
  assert.strictEqual(stripped.wo_labour_lines.filter((ln) => ln.source_line_id).length, 0,
    'unauthorized WO clears server pass-throughs')
  assert.strictEqual(stripped.wo_labour_lines.filter((ln) => ln.trade_name === 'Kim').length, 1,
    'hourly labour survives unauthorized strip')

  assert.strictEqual(context._workOrdersHydratePayloadComplete(null), false,
    'a missing hydrate body is incomplete')
  assert.strictEqual(context._workOrdersHydratePayloadComplete({}), false,
    'a hydrate body without work_orders is incomplete')
  assert.strictEqual(context._workOrdersHydratePayloadComplete({ work_orders: [] }), true,
    'an explicit empty work_orders array is a complete listing')
  assert.strictEqual(context._workOrdersHydratePayloadComplete({ work_orders: [], truncated: true }), false,
    'a truncated listing is not a complete hydrate')
  assert.strictEqual(context._workOrdersHydratePayloadComplete({ work_orders: [{}], has_more: true }), false,
    'has_more is not a complete hydrate')
  assert.strictEqual(context._workOrdersHydratePayloadComplete({ work_orders: [{}], incomplete: true }), false,
    'an incomplete listing is not a complete hydrate')
  assert.strictEqual(context._workOrdersHydratePayloadComplete({ work_orders: [{}], next_offset: 20 }), false,
    'a paged listing with next_offset is not a complete hydrate')
  assert.strictEqual(context._workOrdersHydrateMoneyComplete([
    { id: 'wo-1', subtotal: 100 }
  ]), false, 'an authorized work order missing negative_charges is incomplete money')
  assert.strictEqual(context._workOrdersHydrateMoneyComplete([
    { id: 'wo-1', subtotal: 100, negative_charges: [] }
  ]), true, 'an explicit empty negative_charges array is complete money')
  assert.strictEqual(context._workOrderHasCompleteMoney({ id: 'wo-1', negative_charges: [{ amount: 40 }] }), true)

  const keptRestored = {
    wo_allocated: 999,
    wo_labour_lines: [stalePt],
  }
  assert.strictEqual(context._applyHydratedWorkOrderMoney(keptRestored, { subtotal: 100 }, [israel]), false,
    'missing negative_charges does not apply or strip restored money')
  assert.strictEqual(keptRestored.wo_allocated, 999, 'incomplete apply keeps allocated')
  assert.strictEqual(keptRestored.wo_labour_lines[0].source_line_id, 'wo-stale-old-line',
    'incomplete apply keeps restored source_line_id rows')
  assert.strictEqual(context._applyHydratedWorkOrderMoney(keptRestored, { subtotal: 100, negative_charges: [] }, null), false,
    'a missing pass-through array is not an authoritative empty deduction set')
  assert.strictEqual(keptRestored.wo_labour_lines[0].source_line_id, 'wo-stale-old-line',
    'null pass-throughs keep restored deductions')

  context._woChargeSourceLineId = function(charge) {
    charge = charge || {}
    var id = charge.line_id || charge.source_line_id || charge.id || ''
    return id ? String(id) : ''
  }
  const collectedIds = context._workOrderNegativeChargeLineIds({
    negative_charges: [
      { id: 'cl-israel', amount: 40 },
      { source_line_id: 'cl-kim', amount: 20 },
    ],
  })
  assert.ok(collectedIds, 'complete charges yield their source ids')
  assert.strictEqual(Array.prototype.join.call(collectedIds, ','), 'cl-israel,cl-kim',
    'complete charges yield their source ids')
  const emptyIds = context._workOrderNegativeChargeLineIds({ negative_charges: [] })
  assert.ok(emptyIds, 'an explicit empty charge list is a complete no-deduct set')
  assert.strictEqual(emptyIds.length, 0, 'an explicit empty charge list is a complete no-deduct set')
  assert.strictEqual(context._workOrderNegativeChargeLineIds({
    negative_charges: [{ trade_name: 'Israel', amount: 40 }],
  }), null, 'charges without ids cannot be posted')
  assert.strictEqual(context._workOrderNegativeChargeLineIds({ subtotal: 100 }), null,
    'missing negative_charges cannot yield a charge-id list')

  const staleNoIdServer = {
    wo_allocated: 100,
    wo_labour_lines: [
      { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 100, server_owned: true },
      kim,
    ],
  }
  const israel120 = { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 120, server_owned: true }
  assert.strictEqual(context._applyHydratedWorkOrderMoney(staleNoIdServer, {
    subtotal: 80,
    negative_charges: [{ trade_name: 'Israel', amount: 120 }],
  }, [israel120]), true)
  const israelNoId = staleNoIdServer.wo_labour_lines.filter((ln) => ln.line_kind === 'wo_pass_through' && !ln.source_line_id)
  assert.strictEqual(israelNoId.length, 1, 'complete hydrate replaces stale no-ID server money instead of appending')
  assert.strictEqual(israelNoId[0].amount, 120, 'replaced no-ID server deduct is current server truth')
  assert.strictEqual(staleNoIdServer.wo_labour_lines.filter((ln) => ln.trade_name === 'Kim').length, 1,
    'hourly labour survives no-ID server replace')

  const removedServerPlusLocal = {
    wo_allocated: 100,
    wo_labour_lines: [
      { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 100, server_owned: true },
      { trade_name: 'Local extra', line_kind: 'wo_pass_through', amount: 15, server_owned: false },
      kim,
    ],
  }
  assert.strictEqual(context._applyHydratedWorkOrderMoney(removedServerPlusLocal, {
    subtotal: 100,
    negative_charges: [],
  }, []), true)
  assert.strictEqual(removedServerPlusLocal.wo_labour_lines.filter((ln) => ln.server_owned === true).length, 0,
    'a complete listing that removes a no-ID charge drops the stale server row')
  assert.strictEqual(removedServerPlusLocal.wo_labour_lines.filter((ln) => ln.server_owned === false).length, 1,
    'local no-ID deducts survive a complete server replace')

  const twoServerNoId = {
    wo_allocated: 100,
    wo_labour_lines: [
      { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40, server_owned: true },
      { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40, server_owned: true },
    ],
  }
  const twoIsrael = [
    { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40, server_owned: true },
    { trade_name: 'Israel', line_kind: 'wo_pass_through', amount: 40, server_owned: true },
  ]
  assert.strictEqual(context._applyHydratedWorkOrderMoney(twoServerNoId, {
    subtotal: 100,
    negative_charges: [{ amount: 40 }, { amount: 40 }],
  }, twoIsrael), true)
  assert.strictEqual(twoServerNoId.wo_labour_lines.filter((ln) => ln.line_kind === 'wo_pass_through').length, 2,
    'complete replace of two same-amount server no-ID rows stays two, not four')
}

// ── Offline invoice queue is account-bound ──
{
  const startMark = '// [OFFLINE-INVOICE-QUEUE-START]'
  const endMark = '// [OFFLINE-INVOICE-QUEUE-END]'
  const qStart = html.indexOf(startMark)
  const qEnd = html.indexOf(endMark)
  assert(qStart !== -1 && qEnd > qStart, 'offline invoice queue markers exist')
  const store = { sw_action_queue: '[]' }
  const sent = []
  const webLocks = createWebLockBroker()
  const ctx = {
    localStorage: {
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
      setItem: function(k, v) { store[k] = String(v) },
      removeItem: function(k) { delete store[k] },
      key: function(i) { return Object.keys(store)[i] || null },
      get length() { return Object.keys(store).length },
    },
    setInterval: function(fn, ms) { return setInterval(fn, ms) },
    clearInterval: function(id) { return clearInterval(id) },
    _user: { id: 'alice' },
    _invoiceAuthGen: 1,
    _authorizedWorkOrderIds: { 'wo-b': true },
    _invDraftOwnerId: function() { return String((ctx._user && (ctx._user.id || ctx._user.email)) || '') },
    _invoiceApiContext: function() { return { gen: ctx._invoiceAuthGen, userId: ctx._invDraftOwnerId() } },
    _invoiceApiCurrent: function(c) {
      return !!(c && c.gen === ctx._invoiceAuthGen && c.userId && c.userId === ctx._invDraftOwnerId())
    },
    isAuthorizedWorkOrder: function(id) { return ctx._authorizedWorkOrderIds[String(id || '')] === true },
    authorizeWorkOrders: function(orders) {
      const next = {}
      ;(orders || []).forEach(function(order) {
        if (order && order.id) next[String(order.id)] = true
      })
      ctx._authorizedWorkOrderIds = next
      return orders || []
    },
    workOrdersForViewer: function(orders) { return orders || [] },
    blockedForeignJobWrite: function() { return false },
    api: function(action, _q, body, options) {
      if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
        const err = new Error('Invoice replay cancelled')
        err.code = 'invoice_replay_cancelled'
        return Promise.reject(err)
      }
      sent.push({ action: action, body: body })
      if (action === 'my_work_orders') return Promise.resolve({ work_orders: [{ id: 'wo-b', can_invoice: true, already_invoiced: false }] })
      return Promise.resolve({ ok: true })
    },
    toast: function() {},
    friendlyError: function(err) { return String((err && err.message) || err || '') },
    navigator: { onLine: true, locks: webLocks },
    setTimeout: function(fn, ms) { return setTimeout(fn, ms) },
    _invalidateAssignmentLifecycleCaches: function() {},
  }
  vm.createContext(ctx)
  vm.runInContext(html.slice(qStart, qEnd), ctx)

  assert.strictEqual(ctx._invoiceXeroPushSavedUnconfirmed({
    ok: false,
    code: 'XERO_PUSH_FAILED',
    success: true,
  }), true, 'Xero-saved without identity is the unconfirmed save-with-retry shape')
  assert.strictEqual(ctx._invoiceXeroPushSavedUnconfirmed({
    ok: false,
    code: 'XERO_PUSH_FAILED',
    success: true,
    invoice_id: 'invoice-saved',
  }), false, 'Xero-saved with a durable invoice id is not unconfirmed')
  assert.strictEqual(ctx._invoiceXeroPushSavedUnconfirmed({
    ok: false,
    error: 'RATE_NOT_CONFIGURED',
  }), false, 'a hard business reject is not the unconfirmed Xero-saved shape')
  assert.strictEqual(ctx._offlineInvoiceReplaySucceeded({
    ok: false,
    code: 'XERO_PUSH_FAILED',
    success: true,
  }, { action: 'submit_work_order_invoice' }), false,
    'replay does not treat an unidentified Xero-saved response as committed')

  Promise.resolve(ctx.queueOfflineAction('generate_trade_invoice', { final_deductions: [{ description: 'Alice fuel', unit_rate: 10 }] })).then(function() {
    return ctx.queueOfflineAction('update_job_phase', { assignmentId: 'a1', phase: 'on_site' })
  }).then(function() {
    let queued = JSON.parse(store.sw_action_queue)
    assert.strictEqual(queued.length, 2)
    assert.strictEqual(queued[0].user_id, 'alice')
    assert.strictEqual(queued[0].action, 'generate_trade_invoice')
    assert.strictEqual(queued[1].user_id, undefined, 'non-invoice actions stay unstamped')

    ctx._user = { id: 'bob' }
    return ctx._purgeOfflineInvoiceActionsNotOwnedByCurrentAccount()
  }).then(function(queued) {
    assert.strictEqual(queued.filter((i) => i.action === 'generate_trade_invoice').length, 0,
      'account switch drops the other account\'s invoice write')
    assert.strictEqual(queued.filter((i) => i.action === 'update_job_phase').length, 1,
      'non-invoice queued work survives an account switch')

    store.sw_action_queue = JSON.stringify([
      { action: 'generate_trade_invoice', user_id: 'alice', body: { leak: true } },
      { action: 'submit_work_order_invoice', user_id: 'bob', body: { work_order_id: 'wo-b' } },
      { action: 'generate_trade_invoice', body: { unstamped: true } },
    ])
    ctx._user = { id: 'bob' }
    sent.length = 0
    return ctx.syncOfflineQueue()
  }).then(function() {
    assert.strictEqual(sent.filter((s) => s.action !== 'my_work_orders').length, 1,
      'only the current account\'s invoice write is replayed')
    assert.strictEqual(sent.filter((s) => s.action === 'submit_work_order_invoice')[0].body.work_order_id, 'wo-b')

    ctx.api = function(action, q, body, options) {
      if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
        const err = new Error('Invoice replay cancelled')
        err.code = 'invoice_replay_cancelled'
        return Promise.reject(err)
      }
      sent.push({ action: action, body: body })
      if (action === 'my_work_orders') {
        return Promise.resolve({ work_orders: [{ id: 'wo-b', can_invoice: false, already_invoiced: true }] })
      }
      return Promise.resolve({ ok: true })
    }
    ctx._invoiceAuthGen += 1
    ctx._authorizedWorkOrderIds = { 'wo-b': true }
    store.sw_action_queue = JSON.stringify([
      { action: 'submit_work_order_invoice', user_id: 'bob', body: { work_order_id: 'wo-b' } },
    ])
    sent.length = 0
    return ctx.syncOfflineQueue()
  }).then(function() {
    assert.strictEqual(sent.filter((s) => s.action === 'submit_work_order_invoice').length, 0,
      'an already-invoiced work order is not replayed')
    assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.action === 'submit_work_order_invoice'), true,
      'an already-invoiced work-order write stays queued instead of posting again')

    store.sw_action_queue = JSON.stringify([
      { action: 'generate_trade_invoice', user_id: 'bob', body: { raced: true } },
    ])
    sent.length = 0
    const origApi = ctx.api
    ctx.api = function(action, q, body, options) {
      ctx._invoiceAuthGen += 1
      return origApi(action, q, body, options)
    }
    return ctx.syncOfflineQueue()
  }).then(function() {
    assert.strictEqual(sent.filter((s) => s.action === 'generate_trade_invoice').length, 0,
      'a generation bump between check and send aborts the invoice replay')

    ctx.api = function(action, q, body, options) {
      if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
        const err = new Error('Invoice replay cancelled')
        err.code = 'invoice_replay_cancelled'
        return Promise.reject(err)
      }
      sent.push({ action: action, body: body })
      if (action === 'my_work_orders') return Promise.resolve({ work_orders: [] })
      return Promise.resolve({})
    }
    ctx._invoiceAuthGen += 1
    ctx._authorizedWorkOrderIds = { 'wo-unauth': true, 'wo-stale': true }
    store.sw_action_queue = JSON.stringify([
      { action: 'submit_work_order_invoice', user_id: 'bob', body: { work_order_id: 'wo-unauth' } },
    ])
    sent.length = 0
    return ctx.syncOfflineQueue()
  }).then(function() {
    assert.strictEqual(sent.filter((s) => s.action === 'submit_work_order_invoice').length, 0,
      'a work-order invoice is not replayed without current WO authorization')
    assert.ok(sent.filter((s) => s.action === 'my_work_orders').length >= 1,
      'replay always re-reads my_work_orders instead of trusting a cached WO id')
    assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.action === 'submit_work_order_invoice'), true,
      'an unauthorized work-order invoice stays queued for a later authorized session')
    assert.strictEqual(ctx.isAuthorizedWorkOrder('wo-unauth'), false,
      'a later my_work_orders result replaces the authorized set and drops stale ids')

    ctx._invoiceAuthGen += 1
    ctx._authorizedWorkOrderIds = { 'wo-unauth': true }
    ctx.api = function(action, q, body, options) {
      if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
        const err = new Error('Invoice replay cancelled')
        err.code = 'invoice_replay_cancelled'
        return Promise.reject(err)
      }
      sent.push({ action: action, body: body })
      if (action === 'my_work_orders') return Promise.reject(new Error('Failed to fetch'))
      return Promise.resolve({ ok: true })
    }
    store.sw_action_queue = JSON.stringify([
      { id: 'iq_wo_authfail', client_request_id: 'iq_wo_authfail', action: 'submit_work_order_invoice', user_id: 'bob', body: { work_order_id: 'wo-unauth' } },
    ])
    sent.length = 0
    return ctx.syncOfflineQueue()
  }).then(function() {
    assert.strictEqual(sent.filter((s) => s.action === 'submit_work_order_invoice').length, 0,
      'a failed work-order auth refresh does not POST the queued invoice')
    assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.id === 'iq_wo_authfail'), true,
      'a failed work-order auth refresh keeps the queued invoice for retry')
    assert.strictEqual(ctx.isAuthorizedWorkOrder('wo-unauth'), true,
      'a failed my_work_orders read must not replace the authorized set')

    ctx._user = { id: 'bob' }
    ctx._invoiceAuthGen += 1
    let sendCount = 0
    let releaseFirst
    const firstHold = new Promise(function(resolve) { releaseFirst = resolve })
    ctx.api = function(action, q, body, options) {
      if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
        const err = new Error('Invoice replay cancelled')
        err.code = 'invoice_replay_cancelled'
        return Promise.reject(err)
      }
      if (action === 'my_work_orders' || action === 'my_trade_invoices') {
        return Promise.resolve({ work_orders: [], invoices: [] })
      }
      sendCount += 1
      return firstHold.then(function() { return { ok: true } })
    }
    store.sw_action_queue = JSON.stringify([
      { id: 'iq_lock', client_request_id: 'iq_lock', action: 'generate_trade_invoice', user_id: 'bob', body: { week_start: '2026-09-07' } },
    ])
    const firstSync = ctx.syncOfflineQueue()
    const overlapSync = ctx.syncOfflineQueue()
    assert.strictEqual(ctx._offlineQueueSyncing, true, 'overlapping syncs share one in-flight lock')
    assert.strictEqual(ctx._offlineQueueSyncAgain, true, 'a second caller asks for one follow-up pass')
    releaseFirst()
    return Promise.all([firstSync, overlapSync]).then(function() {
      assert.strictEqual(sendCount, 1, 'single-flight lock sends a financial item once')

      sendCount = 0
      ctx.api = function(action, q, body, options) {
        if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
          const err = new Error('Invoice replay cancelled')
          err.code = 'invoice_replay_cancelled'
          return Promise.reject(err)
        }
        if (action === 'my_work_orders' || action === 'my_trade_invoices') {
          return Promise.resolve({ work_orders: [], invoices: [] })
        }
        sendCount += 1
        ctx.queueOfflineAction('generate_trade_invoice', { week_start: '2026-09-14' })
        return Promise.resolve({ ok: true })
      }
      store.sw_action_queue = JSON.stringify([
        { id: 'iq_old', client_request_id: 'iq_old', action: 'generate_trade_invoice', user_id: 'bob', body: { week_start: '2026-09-07' } },
      ])
      return ctx.syncOfflineQueue()
    }).then(function() {
      const afterMerge = JSON.parse(store.sw_action_queue)
      assert.strictEqual(sendCount, 1, 'the in-flight snapshot item is sent once')
      assert.strictEqual(afterMerge.some((i) => i.id === 'iq_old'), false,
        'a completed snapshot item is dropped')
      assert.strictEqual(afterMerge.filter((i) => i.action === 'generate_trade_invoice' && i.body && i.body.week_start === '2026-09-14').length, 1,
        'an invoice queued during replay survives persist merge')

      sendCount = 0
      ctx.api = function(action, q, body, options) {
        if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
          const err = new Error('Invoice replay cancelled')
          err.code = 'invoice_replay_cancelled'
          return Promise.reject(err)
        }
        if (action === 'my_trade_invoices') {
          return Promise.resolve({
            invoices: [{ week_start: '2026-09-07', status: 'submitted', xero_bill_id: 'xb1' }],
          })
        }
        if (action === 'my_work_orders') return Promise.resolve({ work_orders: [] })
        sendCount += 1
        const err = new Error('Aborted')
        err.name = 'AbortError'
        return Promise.reject(err)
      }
      store.sw_action_queue = JSON.stringify([
        { id: 'iq_to', client_request_id: 'iq_to', action: 'generate_trade_invoice', user_id: 'bob', body: { week_start: '2026-09-07' } },
      ])
      return ctx.syncOfflineQueue()
    }).then(function() {
      const timedOut = JSON.parse(store.sw_action_queue)
      assert.strictEqual(timedOut.length, 1, 'a timed-out invoice write stays queued')
      assert.strictEqual(timedOut[0].ambiguous, true, 'timeout marks the financial item ambiguous')
      assert.strictEqual(sendCount, 1, 'the first timeout is the only generate attempt')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', status: 'submitted', xero_bill_id: 'xb1' },
        { body: { week_start: '2026-09-07' } }
      ), false, 'week-only reconcile is not an exact match')
      return ctx.syncOfflineQueue()
    }).then(function() {
      assert.strictEqual(sendCount, 1, 'week-only ambiguous timeout does not resend')
      assert.strictEqual(JSON.parse(store.sw_action_queue).length, 1,
        'a week-only match stays unresolved instead of dropping a different invoice')

      sendCount = 0
      ctx.api = function(action, q, body, options) {
        if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
          const err = new Error('Invoice replay cancelled')
          err.code = 'invoice_replay_cancelled'
          return Promise.reject(err)
        }
        if (action === 'my_trade_invoices') {
          return Promise.resolve({
            invoices: [{ id: 'draft-1', draft_id: 'draft-1', status: 'submitted', xero_bill_id: 'xb1' }],
          })
        }
        if (action === 'my_work_orders') return Promise.resolve({ work_orders: [] })
        sendCount += 1
        const err = new Error('Aborted')
        err.name = 'AbortError'
        return Promise.reject(err)
      }
      store.sw_action_queue = JSON.stringify([
        { id: 'iq_exact', client_request_id: 'iq_exact', action: 'generate_trade_invoice', user_id: 'bob', body: { draft_id: 'draft-1', week_start: '2026-09-07' } },
      ])
      return ctx.syncOfflineQueue()
    }).then(function() {
      assert.strictEqual(JSON.parse(store.sw_action_queue)[0].ambiguous, true)
      return ctx.syncOfflineQueue()
    }).then(function() {
      assert.strictEqual(sendCount, 1, 'exact draft identity does not resend after it has landed')
      assert.strictEqual(JSON.parse(store.sw_action_queue).length, 0,
        'an exact draft/invoice identity can be dropped as already landed')

      store.sw_action_queue = '[]'
      const abort = new Error('Aborted')
      abort.name = 'AbortError'
      return ctx._handleFinancialWriteFailure(
        'generate_trade_invoice',
        { week_start: '2026-09-07' },
        abort,
        ctx._invoiceApiContext()
      )
    }).then(function(result) {
      assert.strictEqual(result.outcome, 'queued_unresolved',
        'an online timeout without exact identity stays unresolved')
      assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.ambiguous && i.body && i.body.week_start === '2026-09-07'), true,
        'online timeouts persist through the same queue path')
      assert.strictEqual(ctx._sameFinancialWriteIntent(
        { week_start: '2026-09-07' },
        { week_start: '2026-09-07', extra_items: [{ description: 'Other job' }] }
      ), false, 'week-only is not an exact intent match')
      assert.strictEqual(ctx._guardFinancialWrite('generate_trade_invoice', {
        week_start: '2026-09-07',
        extra_items: [{ description: 'Other job' }],
      }), false, 'a distinct same-week payload is not suppressed after an unresolved timeout')
      assert.strictEqual(ctx._sameFinancialWriteIntent(
        { draft_id: 'draft-1', week_start: '2026-09-07' },
        { draft_id: 'draft-1', week_start: '2026-09-21' }
      ), true, 'exact draft identity still matches')
      assert.strictEqual(ctx._beginSaveTradeInvoiceDraft(), true)
      assert.strictEqual(ctx._beginSaveTradeInvoiceDraft(), false,
        'direct draft save is single-flight')
      ctx._endSaveTradeInvoiceDraft()
      assert.strictEqual(ctx._invoiceDraftSaveSucceeded({ ok: true }), false,
        'a generic ok draft save is not durable without a draft identity')
      assert.strictEqual(ctx._invoiceDraftSaveSucceeded({ ok: true, draft_id: 'draft-1' }), true)
      assert.strictEqual(ctx._offlineInvoiceReplaySucceeded({ ok: true }, { action: 'save_trade_invoice_draft' }), false,
        'offline draft replay requires a durable draft identity')
      assert.strictEqual(ctx._offlineInvoiceReplaySucceeded({ ok: true, draft_id: 'draft-1' }, { action: 'save_trade_invoice_draft' }), true)
      assert.strictEqual(ctx._beginFinancialWrite('generate_trade_invoice'), true)
      assert.strictEqual(ctx._beginFinancialWrite('generate_trade_invoice'), false,
        'invoice generate/submit is single-flight')
      ctx._endFinancialWrite('generate_trade_invoice')
      assert.strictEqual(ctx._sameFinancialWriteIntent(
        { week_start: '2026-09-07', extra_items: [{ description: 'A' }], gst_on: true },
        { week_start: '2026-09-14', extra_items: [{ description: 'A' }], gst_on: true }
      ), false, 'the same payload in a different week is a distinct intent')

      ctx.api = function(action) {
        if (action === 'my_trade_invoices') {
          return Promise.resolve({ invoices: [] })
        }
        return Promise.resolve({})
      }
      return ctx._reconcileAmbiguousInvoiceAction({
        action: 'delete_trade_invoice',
        body: { invoice_id: 'inv-gone' },
      }).then(function(emptyDelete) {
        assert.strictEqual(emptyDelete, null,
          'an empty invoice listing does not prove a delete committed')
        ctx.api = function(action) {
          if (action === 'my_trade_invoices') {
            return Promise.resolve({ invoices: [{ id: 'inv-other' }], truncated: true })
          }
          return Promise.resolve({})
        }
        return ctx._reconcileAmbiguousInvoiceAction({
          action: 'delete_trade_invoice',
          body: { invoice_id: 'inv-gone' },
        })
      }).then(function(truncatedDelete) {
        assert.strictEqual(truncatedDelete, null,
          'a truncated invoice listing does not prove a delete committed')
        ctx.api = function(action) {
          if (action === 'my_trade_invoices') {
            return Promise.resolve({ invoices: [{ id: 'inv-other' }] })
          }
          return Promise.resolve({})
        }
        return ctx._reconcileAmbiguousInvoiceAction({
          action: 'delete_trade_invoice',
          body: { invoice_id: 'inv-gone' },
        })
      }).then(function(absentDelete) {
        assert.strictEqual(absentDelete, true,
          'absence from a complete non-empty listing means the delete landed')
        ctx.api = function(action) {
          if (action === 'my_trade_invoices') {
            return Promise.resolve({ invoices: [{ id: 'inv-gone' }] })
          }
          return Promise.resolve({})
        }
        return ctx._reconcileAmbiguousInvoiceAction({
          action: 'delete_trade_invoice',
          body: { invoice_id: 'inv-gone' },
        })
      }).then(function(stillThere) {
        assert.strictEqual(stillThere, false, 'a still-listed invoice is not a landed delete')
        ctx.api = function(action) {
          if (action === 'my_trade_invoices') {
            return Promise.resolve({ invoices: [{ work_order_id: 'wo-b', status: 'draft' }] })
          }
          return Promise.resolve({})
        }
        return ctx._reconcileAmbiguousInvoiceAction({
        action: 'submit_work_order_invoice',
        body: { work_order_id: 'wo-b' },
      })
      }).then(function(draftLanded) {
        assert.strictEqual(draftLanded, true,
          'an exact WO identity in draft is already landed and must not resend')
        return ctx._reconcileAmbiguousInvoiceAction({
          action: 'submit_work_order_invoice',
          body: { work_order_id: 'wo-b' },
        })
      }).then(function() {
        ctx.api = function(action) {
          if (action === 'my_trade_invoices') {
            return Promise.resolve({
              invoices: [{ work_order_id: 'wo-b', status: 'pending_ops_review' }],
            })
          }
          return Promise.resolve({})
        }
        return ctx._reconcileAmbiguousInvoiceAction({
          action: 'submit_work_order_invoice',
          body: { work_order_id: 'wo-b' },
        })
      }).then(function(pendingLanded) {
        assert.strictEqual(pendingLanded, true,
          'an exact WO identity in pending_ops_review is already landed')
        ctx.navigator.onLine = false
        store.sw_action_queue = '[]'
        const offlineAbort = new Error('Failed to fetch')
        return ctx._handleFinancialWriteFailure(
          'generate_trade_invoice',
          { week_start: '2026-09-07', extra_items: [{ description: 'Offline A' }] },
          offlineAbort,
          ctx._invoiceApiContext()
        )
      })
    }).then(function(offlineResult) {
      assert.strictEqual(offlineResult.outcome, 'queued_unresolved',
        'an offline Failed-to-fetch still goes through the ambiguous path')
      const offlineQueued = JSON.parse(store.sw_action_queue)
      assert.strictEqual(offlineQueued.length, 1)
      assert.strictEqual(offlineQueued[0].ambiguous, true,
        'offline timeout/Failed-to-fetch is marked ambiguous so replay reconciles first')
      ctx.navigator.onLine = true

      ctx._user = null
      ctx.queueOfflineAction('generate_trade_invoice', { final_deductions: [] })
      assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.action === 'generate_trade_invoice' && !i.user_id), false,
        'unsigned-in invoice writes are not parked')

      ctx._user = { id: 'bob' }
      ctx._invoiceAuthGen += 1
      assert.strictEqual(ctx._offlineInvoiceHasExactTarget({
        action: 'generate_trade_invoice',
        body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-26767', job_id: 'j-26767' }] }
      }), true, 'nested job identities count as an exact target')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-26767' }], status: 'draft' },
        { body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-26767', job_id: 'j-26767' }] } }
      ), true, 'job-centric reconcile matches a nested job identity in the same week')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' },
        { body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }] } }
      ), false, 'a multi-job write does not match an older same-week invoice that only has one job')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }], status: 'draft' },
        { body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }] } }
      ), false, 'a multi-job write without a matching period stays unresolved')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }], status: 'draft' },
        { body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }] } }
      ), true, 'a multi-job write matches only when every job and the period land')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' },
        { body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-A' }] } }
      ), false, 'two same-job slots are not covered by one repeated-job invoice row')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        {
          week_start: '2026-09-07',
          extra_items: [
            { job_number: 'SWF-A', scheduled_date: '2026-09-07' },
            { job_number: 'SWF-A', scheduled_date: '2026-09-08' },
          ],
          status: 'draft',
        },
        { body: {
          week_start: '2026-09-07',
          extra_items: [
            { job_number: 'SWF-A', scheduled_date: '2026-09-07' },
            { job_number: 'SWF-A', scheduled_date: '2026-09-08' },
          ],
        } }
      ), true, 'same-job slots with distinct dates match one-to-one')
      assert.strictEqual(ctx._invoiceSlotsCovered(
        ctx._invoiceIdentitySlots({ extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-A' }] }),
        { extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-A' }] }
      ), true, 'two indistinguishable same-job rows can cover two same-job slots')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' },
        { body: {
          week_start: '2026-09-07',
          extra_items: [{ job_number: 'SWF-A' }],
          final_deductions: [{ description: 'Fuel', unit_rate: 10 }],
        } }
      ), false, 'a write with invoice-level deductions does not match a job-only invoice')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' },
        { body: {
          week_start: '2026-09-07',
          extra_items: [
            { job_number: 'SWF-A' },
            { description: 'Fuel', unit_rate: -10, source: 'invoice_final_deduction' },
          ],
        } }
      ), false, 'job+week is not landed when the queued write has a deduction extra')
      assert.strictEqual(ctx._invoicePayloadHasMoneyAffectingExtras({
        extra_items: [{ job_number: 'SWF-26767', job_id: 'j-26767' }]
      }), false, 'job identity extras without labour/lump stay slot-matchable')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' },
        { body: {
          week_start: '2026-09-07',
          extra_items: [{
            job_number: 'SWF-A',
            wo_labour_lines: [{ trade_name: 'Tendo', hours: 11.5, rate: 25 }],
            wo_labour_deduction: 287.5
          }]
        } }
      ), false, 'job+week is not landed when the queued write has WO labour lines')
      assert.strictEqual(ctx._invoiceMatchesQueueIntent(
        { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' },
        { body: {
          week_start: '2026-09-07',
          extra_items: [{ job_number: 'SWF-A' }],
          work_order_blocks: [{ labour_deductions: [{ user_id: 'u1', hours: 2 }] }]
        } }
      ), false, 'job+week is not landed when nested WO labour deductions differ')
      assert.strictEqual(ctx._invoicePayloadHasMoneyAffectingExtras({
        extra_items: [{ job_number: 'SWF-A', wo_labour_deduction: 40 }]
      }), true, 'a positive WO labour deduction is money-affecting')
      ctx.api = function(action) {
        if (action === 'my_trade_invoices') return Promise.resolve({ invoices: [] })
        return Promise.resolve({ ok: true })
      }
      return ctx._reconcileAmbiguousInvoiceAction({
        action: 'generate_trade_invoice',
        body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-26767' }] }
      })
    }).then(function(jobCentricUncommitted) {
      assert.strictEqual(jobCentricUncommitted, null,
        'an exact-target job-centric write stays unresolved when the listing cannot prove it landed')
      const safariLoad = new Error('Load failed')
      safariLoad.name = 'TypeError'
      const firefoxNet = new Error('NetworkError when attempting to fetch resource')
      firefoxNet.name = 'TypeError'
      const chromeFetch = new Error('Failed to fetch')
      chromeFetch.name = 'TypeError'
      assert.strictEqual(ctx._isOfflineInvoiceTimeoutError(safariLoad), true,
        'Safari Load failed is an ambiguous transport failure')
      assert.strictEqual(ctx._isOfflineInvoiceTimeoutError(firefoxNet), true,
        'Firefox NetworkError is an ambiguous transport failure')
      assert.strictEqual(ctx._isOfflineInvoiceTimeoutError(chromeFetch), true,
        'Chrome Failed to fetch is an ambiguous transport failure')
      assert.strictEqual(ctx._isOfflineInvoiceTimeoutError(new Error('RATE_NOT_CONFIGURED')), false,
        'a business error is not a transport failure')
      const lockedErr = new Error('Invoice send is already in progress.')
      lockedErr.code = 'invoice_write_locked'
      assert.strictEqual(ctx._isOfflineInvoiceTimeoutError(lockedErr), false,
        'lock contention is not a transport failure')
      return ctx._reconcileAmbiguousInvoiceAction({
        action: 'submit_work_order_invoice',
        body: { work_order_id: 'wo-missing' }
      }).then(function(woEmpty) {
        assert.strictEqual(woEmpty, null,
          'an exact WO target with no listing match fails closed instead of resending')
        let woResends = 0
        ctx.api = function(action) {
          if (action === 'my_trade_invoices') return Promise.resolve({ invoices: [] })
          if (action === 'my_work_orders') return Promise.resolve({ work_orders: [{ id: 'wo-missing' }] })
          woResends += 1
          return Promise.resolve({ ok: true })
        }
        store.sw_action_queue = JSON.stringify([{
          id: 'iq_wo_empty',
          client_request_id: 'iq_wo_empty',
          action: 'submit_work_order_invoice',
          user_id: 'bob',
          ambiguous: true,
          body: { work_order_id: 'wo-missing' }
        }])
        return ctx.syncOfflineQueue().then(function() {
          assert.strictEqual(woResends, 0,
            'ambiguous exact-target WO replay does not POST after a negative listing')
          assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.id === 'iq_wo_empty'), true,
            'the unresolved WO write is retained for later reconciliation')
          store.sw_action_queue = '[]'
          return ctx._handleFinancialWriteFailure(
            'generate_trade_invoice',
            { week_start: '2026-09-07', extra_items: [{ description: 'Safari drop' }] },
            safariLoad,
            ctx._invoiceApiContext()
          )
        }).then(function(loadFailedResult) {
          assert.strictEqual(loadFailedResult.outcome, 'queued_unresolved',
            'Safari Load failed takes the ambiguous persist-and-reconcile path')
          assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.ambiguous && i.body && i.body.extra_items), true,
            'Load failed persists as an ambiguous write before any retry')
          return ctx._handleFinancialWriteFailure(
            'generate_trade_invoice',
            { week_start: '2026-09-14' },
            lockedErr,
            ctx._invoiceApiContext()
          )
        }).then(function(lockedResult) {
          assert.strictEqual(lockedResult.outcome, 'locked',
            'cross-tab Web Lock contention is locked, not a retryable failure')
          assert.strictEqual(ctx._financialWriteAborted(lockedResult), true)
          let invoiceReads = 0
          let resendCount = 0
          ctx.api = function(action) {
            if (action === 'my_trade_invoices') {
              invoiceReads += 1
              return Promise.resolve({})
            }
            if (action === 'my_work_orders') return Promise.resolve({ work_orders: [] })
            resendCount += 1
            return Promise.resolve({ ok: true })
          }
      store.sw_action_queue = JSON.stringify([{
        id: 'iq_incomplete',
        client_request_id: 'iq_incomplete',
        action: 'generate_trade_invoice',
        user_id: 'bob',
        ambiguous: true,
        body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-26767' }] }
      }])
      return ctx.syncOfflineQueue().then(function() {
        assert.ok(invoiceReads >= 3, 'ambiguous replay retries the invoice listing before deciding')
        assert.strictEqual(resendCount, 0, 'an incomplete listing does not resend an ambiguous invoice')
        ctx.api = function(action) {
          if (action === 'my_work_orders' || action === 'my_trade_invoices') {
            return Promise.resolve({ work_orders: [], invoices: [] })
          }
          return Promise.resolve({ ok: false, error: 'RATE_NOT_CONFIGURED' })
        }
        store.sw_action_queue = JSON.stringify([{
          id: 'iq_bizfail',
          client_request_id: 'iq_bizfail',
          action: 'generate_trade_invoice',
          user_id: 'bob',
          body: { week_start: '2026-09-07' }
        }])
        return ctx.syncOfflineQueue()
      }).then(function() {
        assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.id === 'iq_bizfail'), true,
          'HTTP-success business failures stay queued')
        store.sw_action_queue_lock = JSON.stringify({
          owner: 'other-tab',
          ts: Date.now(),
          nonce: 'held',
          v: 1
        })
        const before = store.sw_action_queue
        const lockedMutate = ctx._mutateOfflineQueue(function() { return [{ id: 'should-not-write' }] }, { money: true })
        assert.strictEqual(lockedMutate.ok, false, 'an unlocked money queue mutation fails closed')
        assert.strictEqual(store.sw_action_queue, before,
          'an unlocked money queue mutation does not overwrite the queue')
        delete store.sw_action_queue_lock

        return ctx._reconcileAmbiguousInvoiceAction({
          action: 'generate_trade_invoice',
          body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }] }
        }).then(function(multiJobEmpty) {
          assert.strictEqual(multiJobEmpty, null,
            'a multi-job write on a complete empty listing stays unresolved instead of retrying')
          ctx.api = function(action) {
            if (action === 'my_trade_invoices') {
              return Promise.resolve({
                invoices: [{ week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' }],
              })
            }
            return Promise.resolve({ ok: true })
          }
          return ctx._reconcileAmbiguousInvoiceAction({
            action: 'generate_trade_invoice',
            body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }] }
          })
        }).then(function(partialLanded) {
          assert.strictEqual(partialLanded, null,
            'a same-week invoice that only shares one job does not land a multi-job write')
          ctx.api = function(action) {
            if (action === 'my_trade_invoices') {
              return Promise.resolve({
                invoices: [{ week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' }],
              })
            }
            return Promise.resolve({ ok: true })
          }
          return ctx._reconcileAmbiguousInvoiceAction({
            action: 'generate_trade_invoice',
            body: {
              week_start: '2026-09-07',
              extra_items: [
                { job_number: 'SWF-A' },
                { description: 'Fuel', unit_rate: -10, source: 'invoice_final_deduction' },
              ],
            }
          }).then(function(deductLanded) {
            assert.strictEqual(deductLanded, null,
              'a one-job invoice does not land a queued write that still carries a deduction extra')
            ctx.api = function(action) {
              if (action === 'my_trade_invoices') {
                return Promise.resolve({
                  invoices: [{ week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' }],
                })
              }
              return Promise.resolve({ ok: true })
            }
            return ctx._reconcileAmbiguousInvoiceAction({
              action: 'generate_trade_invoice',
              body: {
                week_start: '2026-09-07',
                extra_items: [{
                  job_number: 'SWF-A',
                  wo_labour_lines: [{ trade_name: 'Tendo', hours: 11.5, rate: 25 }],
                  wo_labour_deduction: 287.5
                }]
              }
            })
          }).then(function(labourLanded) {
            assert.strictEqual(labourLanded, null,
              'a one-job invoice does not land a queued write that still carries WO labour deductions')
            ctx.api = function(action) {
              if (action === 'my_trade_invoices') {
                return Promise.resolve({
                  invoices: [{ week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }], status: 'draft' }],
                })
              }
              return Promise.resolve({ ok: true })
            }
            return ctx._reconcileAmbiguousInvoiceAction({
              action: 'generate_trade_invoice',
              body: {
                week_start: '2026-09-07',
                extra_items: [{ job_number: 'SWF-A' }],
                work_order_blocks: [{ labour_deductions: [{ user_id: 'u1', hours: 2 }] }]
              }
            })
          }).then(function(blockLabourLanded) {
            assert.strictEqual(blockLabourLanded, null,
              'a one-job invoice does not land a queued write with nested WO-block labour deductions')
            const savedLocks = ctx.navigator.locks
            delete ctx.navigator.locks
            assert.strictEqual(ctx._beginFinancialWrite('generate_trade_invoice'), false,
              'financial writes fail closed when Web Locks are unavailable')
            let noLockSends = 0
            ctx.api = function(action) {
              if (action === 'my_work_orders' || action === 'my_trade_invoices') {
                return Promise.resolve({ work_orders: [], invoices: [] })
              }
              noLockSends += 1
              return Promise.resolve({ ok: true })
            }
            store.sw_action_queue = JSON.stringify([{
              id: 'iq_nolock',
              client_request_id: 'iq_nolock',
              action: 'generate_trade_invoice',
              user_id: 'bob',
              body: { week_start: '2026-09-07' }
            }])
            return ctx.syncOfflineQueue().then(function() {
              assert.strictEqual(noLockSends, 0,
                'offline invoice replay does not POST money without Web Locks')
              store.sw_action_queue_inbox_ids = '[]'
              return ctx.queueOfflineAction('generate_trade_invoice', { week_start: '2026-09-28' })
            }).then(function(queuedNoLock) {
              assert.strictEqual(queuedNoLock.ok, false,
                'money queue mutations fail closed when Web Locks are unavailable')
              assert.strictEqual(JSON.parse(store.sw_action_queue).some((i) => i.week_start === '2026-09-28' || (i.body && i.body.week_start === '2026-09-28')), false,
                'a failed money queue mutation does not write the main queue')
              const inboxIds = JSON.parse(store.sw_action_queue_inbox_ids || '[]')
              assert.ok(inboxIds.length >= 1, 'the inbox item is preserved when the money merge cannot commit')
              ctx.navigator.locks = savedLocks
              return Promise.resolve()
            })
          }).then(function() {

          let persistSends = 0
          const origSetItem = ctx.localStorage.setItem
          ctx.localStorage.setItem = function(k, v) {
            if (k === 'sw_action_queue' && persistSends >= 1 && String(v).indexOf('iq_persist') === -1) {
              throw new Error('persist blocked')
            }
            return origSetItem.call(ctx.localStorage, k, v)
          }
          ctx.api = function(action) {
            if (action === 'my_work_orders' || action === 'my_trade_invoices') {
              return Promise.resolve({ work_orders: [], invoices: [] })
            }
            persistSends += 1
            return Promise.resolve({ ok: true })
          }
          Object.keys(store).forEach(function(key) {
            if (key.indexOf('sw_action_queue_inbox') === 0 || key.indexOf('sw_action_queue_unconfirmed_') === 0) {
              delete store[key]
            }
          })
          store.sw_action_queue = JSON.stringify([{
            id: 'iq_persist',
            client_request_id: 'iq_persist',
            action: 'generate_trade_invoice',
            user_id: 'bob',
            body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }] }
          }])
          store.sw_action_queue_inbox_ids = '[]'
          return ctx.syncOfflineQueue().then(function() {
            assert.strictEqual(persistSends, 1, 'the invoice POST happens once before persist fails closed')
            const afterPersistFail = ctx._readOfflineQueue()
            assert.strictEqual(afterPersistFail.some((i) => i.id === 'iq_persist'), true,
              'a successful replay stays queued when removal cannot be committed')
            assert.strictEqual(store.sw_action_queue_unconfirmed_iq_persist, '1',
              'failed removal records a persist-unconfirmed marker')
            ctx.localStorage.setItem = origSetItem
            persistSends = 0
            return ctx.syncOfflineQueue()
          }).then(function() {
            assert.strictEqual(persistSends, 0,
              'an unconfirmed successful replay reconciles and does not POST again')
            console.log('OK — WO labour-line payload contract holds (25 scenarios + offline invoice ownership)')
          })
          })
        })
      })
    })
    })
    })
  }).catch(function(err) {
    console.error(err)
    process.exitCode = 1
  })
}

// ── Cross-tab invoice locks and queue merge ──
{
  const startMark = '// [OFFLINE-INVOICE-QUEUE-START]'
  const endMark = '// [OFFLINE-INVOICE-QUEUE-END]'
  const qStart = html.indexOf(startMark)
  const qEnd = html.indexOf(endMark)
  const store = { sw_action_queue: '[]' }
  function sharedLocalStorage() {
    return {
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
      setItem: function(k, v) { store[k] = String(v) },
      removeItem: function(k) { delete store[k] },
      key: function(i) { return Object.keys(store)[i] || null },
      get length() { return Object.keys(store).length },
    }
  }
  const sharedLocks = createWebLockBroker()
  function makeQueueCtx(userId, locks) {
    const sent = []
    const ctx = {
      localStorage: sharedLocalStorage(),
      _user: { id: userId },
      _invoiceAuthGen: 1,
      _authorizedWorkOrderIds: {},
      _invDraftOwnerId: function() { return String((ctx._user && (ctx._user.id || ctx._user.email)) || '') },
      _invoiceApiContext: function() { return { gen: ctx._invoiceAuthGen, userId: ctx._invDraftOwnerId() } },
      _invoiceApiCurrent: function(c) {
        return !!(c && c.gen === ctx._invoiceAuthGen && c.userId && c.userId === ctx._invDraftOwnerId())
      },
      isAuthorizedWorkOrder: function() { return false },
      authorizeWorkOrders: function(orders) { return orders || [] },
      workOrdersForViewer: function(orders) { return orders || [] },
      blockedForeignJobWrite: function() { return false },
      api: function(action, _q, body, options) {
        if (options && typeof options.beforeSend === 'function' && options.beforeSend() === false) {
          const err = new Error('Invoice replay cancelled')
          err.code = 'invoice_replay_cancelled'
          return Promise.reject(err)
        }
        sent.push({ action: action, body: body })
        if (action === 'my_work_orders' || action === 'my_trade_invoices') {
          return Promise.resolve({ work_orders: [], invoices: [] })
        }
        return Promise.resolve({ ok: true })
      },
      toast: function() {},
      friendlyError: function(err) { return String((err && err.message) || err || '') },
      navigator: locks ? { onLine: true, locks: locks } : { onLine: true },
      setTimeout: function(fn, ms) { return setTimeout(fn, ms) },
      setInterval: function(fn, ms) { return setInterval(fn, ms) },
      clearInterval: function(id) { return clearInterval(id) },
      _invalidateAssignmentLifecycleCaches: function() {},
    }
    ctx._sent = sent
    vm.createContext(ctx)
    vm.runInContext(html.slice(qStart, qEnd), ctx)
    return ctx
  }

  const tabA = makeQueueCtx('bob', sharedLocks)
  const tabB = makeQueueCtx('bob', sharedLocks)
  const noLockTab = makeQueueCtx('bob')
  assert.notStrictEqual(tabA._crossTabId, tabB._crossTabId, 'each tab has its own cross-tab id')
  assert.strictEqual(noLockTab._beginFinancialWrite('generate_trade_invoice'), false,
    'begin fails closed when Web Locks are unavailable')
  assert.strictEqual(tabA._beginFinancialWrite('generate_trade_invoice'), true)
  assert.strictEqual(tabA._beginFinancialWrite('generate_trade_invoice'), false,
    'same-tab invoice generate/submit is still single-flight')
  assert.strictEqual(tabA._beginFinancialWrite('delete_trade_invoice'), false,
    'delete cannot start while another invoice write is in flight in this tab')
  assert.strictEqual(tabB._beginFinancialWrite('delete_trade_invoice'), true,
    'begin is local; cross-tab exclusivity is the Web Lock around the POST')
  tabB._endFinancialWrite('delete_trade_invoice')
  tabA._endFinancialWrite('generate_trade_invoice')

  store.sw_action_queue_lock = JSON.stringify({
    owner: tabA._crossTabId,
    ts: Date.now(),
    nonce: 'held',
    v: 2,
    fence: tabA._crossTabId + ':claim:held:1'
  })
  store['sw_action_queue_lock__cas'] = tabA._crossTabId + ':claim:held:1'
  const heldRaw = store.sw_action_queue_lock
  assert.strictEqual(tabB._compareAndSwapStorageLock('sw_action_queue_lock', null, {
    owner: tabB._crossTabId,
    ts: Date.now(),
    nonce: 'stale-writer',
    v: 1,
    prev: 0,
  }, 'claim'), false, 'a stale empty-expected claim cannot overwrite an active queue lease')
  assert.strictEqual(store.sw_action_queue_lock, heldRaw, 'active queue lease bytes stay intact after a stale claim')
  store['sw_action_queue_lock__cas'] = 'other-tab:claim:x:0'
  assert.strictEqual(tabA._storageLockStillOurs('sw_action_queue_lock'), false,
    'a stolen fence means the queue lease is no longer ours')
  delete store.sw_action_queue_lock
  delete store['sw_action_queue_lock__cas']

  Promise.all([
    tabA.queueOfflineAction('generate_trade_invoice', { week_start: '2026-09-07', extra_items: [{ description: 'A' }] }),
    tabB.queueOfflineAction('generate_trade_invoice', { week_start: '2026-09-14', extra_items: [{ description: 'B' }] }),
  ]).then(function() {
    assert.strictEqual(tabA._readOfflineQueue().filter((i) => i.action === 'generate_trade_invoice').length, 2,
      'concurrent tabs keep both week-distinct invoice actions')

    const first = tabA._readOfflineQueue().find((i) => i.body && i.body.week_start === '2026-09-07')
    store.sw_action_queue = '[]'
    store.sw_action_queue_inbox_ids = JSON.stringify([first.id])
    store['sw_action_queue_inbox_' + first.id] = JSON.stringify(first)
    return tabB.queueOfflineAction('generate_trade_invoice', { week_start: '2026-09-21', extra_items: [{ description: 'C' }] }).then(function() {
      return first
    })
  }).then(function(first) {
    const recovered = tabA._readOfflineQueue()
    assert.strictEqual(recovered.some((i) => i.id === first.id), true,
      'an inbox item survives a stale overwrite of the main queue')
    assert.strictEqual(recovered.some((i) => i.body && i.body.week_start === '2026-09-21'), true,
      'the later tab still appends after recovering the inbox item')

    let sendCount = 0
  let releaseFirst
  const firstHold = new Promise(function(resolve) { releaseFirst = resolve })
  function gatedApi(action, _q, body, options) {
    if (options && typeof options.beforeSend === 'function') {
      try {
        if (options.beforeSend() === false) {
          const err = new Error('Invoice replay cancelled')
          err.code = 'invoice_replay_cancelled'
          return Promise.reject(err)
        }
      } catch (e) {
        return Promise.reject(e)
      }
    }
    if (action === 'my_work_orders' || action === 'my_trade_invoices') {
      return Promise.resolve({ work_orders: [], invoices: [] })
    }
    sendCount += 1
    return firstHold.then(function() { return { ok: true } })
  }

  let blockedSends = 0
  tabB.api = function(action, _q, body, options) {
    if (options && typeof options.beforeSend === 'function') {
      try {
        if (options.beforeSend() === false) {
          const err = new Error('Invoice replay cancelled')
          err.code = 'invoice_replay_cancelled'
          return Promise.reject(err)
        }
      } catch (e) {
        return Promise.reject(e)
      }
    }
    if (action === 'my_work_orders' || action === 'my_trade_invoices') {
      return Promise.resolve({ work_orders: [], invoices: [] })
    }
    blockedSends += 1
    return Promise.resolve({ ok: true })
  }
  store.sw_action_queue = JSON.stringify([{
    id: 'iq_blocked',
    client_request_id: 'iq_blocked',
    action: 'generate_trade_invoice',
    user_id: 'bob',
    body: { week_start: '2026-09-07' },
  }])
  store.sw_action_queue_inbox_ids = '[]'
  let releaseHold
  const holdLock = new Promise(function(resolve) { releaseHold = resolve })
  let enteredHold
  const holding = new Promise(function(resolve) { enteredHold = resolve })
  const held = tabA._withFinancialWebLock('generate_trade_invoice', function() {
    enteredHold()
    return holdLock
  }, { acquire: true })
  return holding.then(function() {
    return tabB.syncOfflineQueue()
  }).then(function() {
    assert.strictEqual(blockedSends, 0, 'replay does not POST while another tab holds the financial Web Lock')
    releaseHold()
    return held
  }).then(function() {
    tabA.api = gatedApi
    tabB.api = gatedApi
    store.sw_action_queue = JSON.stringify([{
      id: 'iq_xtab',
      client_request_id: 'iq_xtab',
      action: 'generate_trade_invoice',
      user_id: 'bob',
      body: { week_start: '2026-09-07' },
    }])
    store.sw_action_queue_inbox_ids = '[]'
    const syncA = tabA.syncOfflineQueue()
    const syncB = tabB.syncOfflineQueue()
    releaseFirst()
    return Promise.all([syncA, syncB])
  }).then(function() {
    assert.strictEqual(sendCount, 1, 'overlapping tabs send a queued invoice once')

    assert.strictEqual(tabA._beginFinancialWrite('generate_trade_invoice'), true)
    const postA = tabA._withFinancialWebLock('generate_trade_invoice', function() {
      return Promise.resolve({ ok: true, invoice_id: 'inv-post-commit' })
    }, { acquire: false })
    return postA.then(function() {
      assert.strictEqual(tabA._financialWriteHeldLocally(), true,
        'the fetch result is delivered before the local financial write ends')
      assert.strictEqual(tabB._sharedFinancialWriteHeld('generate_trade_invoice'), true,
        'the shared sw_fin_write fence stays held through response handling')
      assert.strictEqual(tabB._financialWriteAlreadyPending('generate_trade_invoice', { week_start: '2026-09-21' }), true,
        'another tab sees the shared financial fence, not just a local in-flight flag')
      assert.strictEqual(tabB._beginFinancialWrite('generate_trade_invoice'), true)
      return tabB._withFinancialWebLock('generate_trade_invoice', function() {
        return Promise.resolve({ ok: true })
      }, { acquire: false }).then(function() {
        throw new Error('second tab acquired the financial lock during response handling')
      }, function(err) {
        assert.strictEqual(err && err.code, 'invoice_write_locked',
          'another tab cannot POST after commit while the first tab still handles the response')
        tabB._endFinancialWrite('generate_trade_invoice')
        tabA._endFinancialWrite('generate_trade_invoice')
      })
    })
  }).then(function() {
    assert.strictEqual(tabB._sharedFinancialWriteHeld('generate_trade_invoice'), false,
      'the shared sw_fin_write fence is released after the first tab ends the write')
    assert.strictEqual(tabA._beginFinancialWrite('save_trade_invoice_draft'), true)
    const pending = tabA._beginFinancialWriteSend('save_trade_invoice_draft', { week_start: '2026-09-28' })
    assert.ok(pending && pending.id, 'persist-before-send parks the draft write before fetch')
    assert.strictEqual(tabB._financialWriteAlreadyPending('save_trade_invoice_draft', { week_start: '2026-09-28' }), true,
      'another tab sees the parked draft write before the POST returns')
    tabA._settleFinancialWriteSend('save_trade_invoice_draft', pending, { ok: true }, null)
    assert.strictEqual(tabB._financialWriteAlreadyPending('save_trade_invoice_draft', { week_start: '2026-09-28' }), true,
      'a generic ok draft response stays unresolved without a draft identity')
    tabA._settleFinancialWriteSend('save_trade_invoice_draft', pending, { ok: true, draft_id: 'draft-xtab' }, null)
    tabA._endFinancialWrite('save_trade_invoice_draft')
    assert.strictEqual(tabA._financialWriteHeldLocally(), false,
      'the local draft write ends after a durable identity')
    return new Promise(function(resolve) { setTimeout(resolve, 80); }).then(function() {
      assert.strictEqual(tabB._financialWriteAlreadyPending('save_trade_invoice_draft', { week_start: '2026-09-28' }), false,
        'a durable draft identity clears the parked write after the local write ends')
      assert.strictEqual(tabA._beginFinancialWrite('submit_work_order_invoice'), true)
      const pendingXero = tabA._beginFinancialWriteSend('submit_work_order_invoice', { work_order_id: 'wo-xero' })
      assert.ok(pendingXero && pendingXero.id, 'persist-before-send parks the direct WO write')
      tabA._settleFinancialWriteSend('submit_work_order_invoice', pendingXero, {
        ok: false,
        code: 'XERO_PUSH_FAILED',
        success: true,
      }, null)
      assert.strictEqual(tabA._financialWriteAlreadyPending('submit_work_order_invoice', { work_order_id: 'wo-xero' }), true,
        'an unidentified Xero-saved response keeps the durable pending fence')
      tabA._endFinancialWrite('submit_work_order_invoice')
      assert.strictEqual(tabB._financialWriteAlreadyPending('submit_work_order_invoice', { work_order_id: 'wo-xero' }), true,
        'retry stays blocked after the local write ends without a confirmed identity')
      const origSetItem = tabA.localStorage.setItem
      tabA.localStorage.setItem = function(k, v) {
        if (String(k || '').indexOf('sw_action_queue_inbox_') === 0) throw new Error('quota')
        return origSetItem.call(tabA.localStorage, k, v)
      }
      assert.strictEqual(tabA._beginFinancialWrite('generate_trade_invoice'), true)
      try {
        tabA._beginFinancialWriteSend('generate_trade_invoice', { week_start: '2026-10-05' })
        throw new Error('persist-before-send should fail closed when inbox write cannot be read back')
      } catch (err) {
        assert.strictEqual(err && err.code, 'invoice_storage_unavailable',
          'a failed durable persist blocks the POST')
      }
      tabA.localStorage.setItem = origSetItem
      tabA._endFinancialWrite('generate_trade_invoice')
      console.log('OK — cross-tab invoice single-flight and queue merge')
    })
  }).catch(function(err) {
    console.error(err)
    process.exitCode = 1
  })
  })
}
