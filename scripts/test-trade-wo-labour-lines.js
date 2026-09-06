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

// ── Hourly cards untouched by the labour-line validation ─────────────────
{
  const built = context._buildJobCentricPayload([{
    _idx: 0, included: true, assignment_id: 'a1', hours: 8, rate: 40,
    job_number: 'SWF-1', description: '', manually_added: false,
  }])
  assert(!built.error, 'plain hourly card builds: ' + built.error)
  assert.strictEqual(built.manualAssignments.length, 1)
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
}

console.log('OK — WO labour-line payload contract holds (17 scenarios)')
