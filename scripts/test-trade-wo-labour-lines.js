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
  const oneLocal = context._mergeServerPassThroughs([Object.assign({}, israel)], [israel, Object.assign({}, israel)])
  assert.strictEqual(oneLocal.lines.length, 2, 'one local no-ID line plus two server lines keeps both deducts')
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
  const changed = context._applyHydratedWorkOrderMoney(card, { subtotal: 100 }, [israel])
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
  assert.strictEqual(context._applyHydratedWorkOrderMoney(staleSameIdCard, { subtotal: 100 }, [israel]), true)
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
      if (action === 'my_work_orders') return Promise.resolve({ work_orders: [{ id: 'wo-b' }] })
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

  ctx.queueOfflineAction('generate_trade_invoice', { final_deductions: [{ description: 'Alice fuel', unit_rate: 10 }] })
  ctx.queueOfflineAction('update_job_phase', { assignmentId: 'a1', phase: 'on_site' })
  let queued = JSON.parse(store.sw_action_queue)
  assert.strictEqual(queued.length, 2)
  assert.strictEqual(queued[0].user_id, 'alice')
  assert.strictEqual(queued[0].action, 'generate_trade_invoice')
  assert.strictEqual(queued[1].user_id, undefined, 'non-invoice actions stay unstamped')

  ctx._user = { id: 'bob' }
  queued = ctx._purgeOfflineInvoiceActionsNotOwnedByCurrentAccount()
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
  Promise.resolve(ctx.syncOfflineQueue()).then(function() {
    assert.strictEqual(sent.filter((s) => s.action !== 'my_work_orders').length, 1,
      'only the current account\'s invoice write is replayed')
    assert.strictEqual(sent.filter((s) => s.action === 'submit_work_order_invoice')[0].body.work_order_id, 'wo-b')

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
          return Promise.resolve({
            invoices: [{ work_order_id: 'wo-b', status: 'draft' }],
          })
        }
        return Promise.resolve({})
      }
      return ctx._reconcileAmbiguousInvoiceAction({
        action: 'submit_work_order_invoice',
        body: { work_order_id: 'wo-b' },
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
      assert.strictEqual(jobCentricUncommitted, false,
        'a complete empty listing means the job-centric write is not landed and may retry')
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
        const lockedMutate = ctx._mutateOfflineQueue(function() { return [{ id: 'should-not-write' }] })
        assert.strictEqual(lockedMutate.ok, false, 'a held queue lock reports mutation failure')
        assert.strictEqual(store.sw_action_queue, before,
          'a held queue lock fails closed instead of mutating unlocked')
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
              ctx.navigator.locks = savedLocks
              return Promise.resolve()
            })
          }).then(function() {

          let persistSends = 0
          ctx.api = function(action) {
            if (action === 'my_work_orders' || action === 'my_trade_invoices') {
              return Promise.resolve({ work_orders: [], invoices: [] })
            }
            persistSends += 1
            store.sw_action_queue_lock = JSON.stringify({
              owner: 'other-tab',
              ts: Date.now(),
              nonce: 'held',
              v: 4
            })
            return Promise.resolve({ ok: true })
          }
          store.sw_action_queue = JSON.stringify([{
            id: 'iq_persist',
            client_request_id: 'iq_persist',
            action: 'generate_trade_invoice',
            user_id: 'bob',
            body: { week_start: '2026-09-07', extra_items: [{ job_number: 'SWF-A' }, { job_number: 'SWF-B' }] }
          }])
          return ctx.syncOfflineQueue().then(function() {
            assert.strictEqual(persistSends, 1, 'the invoice POST happens once before persist fails closed')
            const afterPersistFail = JSON.parse(store.sw_action_queue)
            assert.strictEqual(afterPersistFail.some((i) => i.id === 'iq_persist'), true,
              'a successful replay stays queued when removal cannot be committed')
            assert.strictEqual(store.sw_action_queue_unconfirmed_iq_persist, '1',
              'failed removal records a persist-unconfirmed marker')
            delete store.sw_action_queue_lock
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

  tabA.queueOfflineAction('generate_trade_invoice', { week_start: '2026-09-07', extra_items: [{ description: 'A' }] })
  tabB.queueOfflineAction('generate_trade_invoice', { week_start: '2026-09-14', extra_items: [{ description: 'B' }] })
  assert.strictEqual(tabA._readOfflineQueue().filter((i) => i.action === 'generate_trade_invoice').length, 2,
    'concurrent tabs keep both week-distinct invoice actions')

  const first = tabA._readOfflineQueue().find((i) => i.body && i.body.week_start === '2026-09-07')
  store.sw_action_queue = '[]'
  store.sw_action_queue_inbox_ids = JSON.stringify([first.id])
  store['sw_action_queue_inbox_' + first.id] = JSON.stringify(first)
  tabB.queueOfflineAction('generate_trade_invoice', { week_start: '2026-09-21', extra_items: [{ description: 'C' }] })
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
  holding.then(function() {
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
    console.log('OK — cross-tab invoice single-flight and queue merge')
  }).catch(function(err) {
    console.error(err)
    process.exitCode = 1
  })
}
