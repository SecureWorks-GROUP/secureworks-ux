#!/usr/bin/env node
// Trades say WHEN they worked when they invoice (Captain, 2026-10-12).
//
// Every invoice line that bills a trade's time carries work_date (YYYY-MM-DD),
// start_time and finish_time (24-hour HH:MM) and optional break_minutes; hours
// are (finish - start) - break and are never typed. This harness runs the
// shipped code, not a copy: it extracts the `<trade-time-entry>` rules and the
// [JC-PAYLOAD-BUILD-START..END] payload builder verbatim from trade.html and
// pins the form rules and the exact payload shape ops-api is built against.
const fs = require('fs')
const assert = require('assert')
const vm = require('vm')

const html = fs.readFileSync('trade.html', 'utf8')

function slice(startMark, endMark) {
  const start = html.indexOf(startMark)
  const end = html.indexOf(endMark)
  assert(start !== -1 && end > start, startMark + ' block markers exist')
  return html.slice(start, end)
}

// ── 1. The rules, on their own ─────────────────────────────────────────────
const rulesCtx = { console }
vm.createContext(rulesCtx)
vm.runInContext(slice('// <trade-time-entry>', '// </trade-time-entry>') + '\nthis.Core = TradeTimeEntryCore;', rulesCtx)
const Core = rulesCtx.Core

// Hours are finish minus start minus break.
assert.strictEqual(Core.hoursFor('07:00', '15:30', 30), 8)
assert.strictEqual(Core.hoursFor('07:00', '15:30', 0), 8.5)
assert.strictEqual(Core.hoursFor('07:00', '15:30', ''), 8.5, 'a blank break is no break')
assert.strictEqual(Core.hoursFor('07:00', '15:20', 0), 8.33, 'hours round to two places, inside the 0.01 the server allows')
assert.strictEqual(Core.hoursFor('09:00', '09:15', 0), 0.25)
assert.strictEqual(Core.hoursFor('07:00:00', '15:30:00', 0), 8.5, 'a stored HH:MM:SS reads the same')
assert.strictEqual(Core.hoursFor('', '15:30', 0), null)
assert.strictEqual(Core.hoursFor('15:30', '07:00', 0), null, 'finish before start is not hours')
assert.strictEqual(Core.hoursFor('22:00', '02:00', 0), null, 'a shift past midnight is two lines, never one')
assert.strictEqual(Core.hoursFor('25:00', '26:00', 0), null)

const good = { work_date: '2026-10-07', start_time: '07:00', finish_time: '15:30', break_minutes: 30 }
const ok = Core.check(good)
assert.strictEqual(ok.ok, true)
assert.strictEqual(ok.hours, 8)

// Date, start and finish are each required, and said in plain words.
function refusal(entry) { return Core.check(Object.assign({}, good, entry)) }
assert.deepStrictEqual([refusal({ work_date: '' }).ok, refusal({ work_date: '' }).field], [false, 'work_date'])
assert.match(refusal({ work_date: '' }).error, /date you worked/)
assert.strictEqual(refusal({ work_date: '2026-02-30' }).field, 'work_date', 'a date that does not exist is not a date')
assert.strictEqual(refusal({ work_date: '7/10/2026' }).field, 'work_date')
assert.strictEqual(refusal({ start_time: '' }).field, 'start_time')
assert.match(refusal({ start_time: '' }).error, /start time/)
assert.strictEqual(refusal({ finish_time: '' }).field, 'finish_time')
assert.match(refusal({ finish_time: '' }).error, /finish time/)
// Finish must be after start on the same day.
assert.match(refusal({ finish_time: '07:00' }).error, /after start time/)
assert.match(refusal({ start_time: '22:00', finish_time: '02:00' }).error, /past midnight.*own line/)
// Break is whole minutes and cannot swallow the shift.
assert.strictEqual(refusal({ break_minutes: 1.5 }).field, 'break_minutes')
assert.strictEqual(refusal({ break_minutes: -5 }).field, 'break_minutes')
assert.strictEqual(refusal({ break_minutes: 510 }).field, 'break_minutes')
assert.strictEqual(refusal({ break_minutes: undefined }).ok, true, 'break is optional')

// The four fields, named exactly as the contract names them.
assert.deepStrictEqual(Object.assign({}, Core.fields({ work_date: '2026-10-07', start_time: '7:05', finish_time: '15:30:00', break_minutes: '' })),
  { work_date: '2026-10-07', start_time: '07:05', finish_time: '15:30', break_minutes: 0 })

// Display: shown when the data is there, nothing when it is not.
assert.strictEqual(Core.label(good), 'Wed 7 Oct, 07:00 to 15:30, 30 min break')
assert.strictEqual(Core.label({ work_date: '2026-10-07', start_time: '07:00:00', finish_time: '15:30:00', break_minutes: 0 }), 'Wed 7 Oct, 07:00 to 15:30')
assert.strictEqual(Core.label({ line_date: '2026-10-07', total_hours: 8 }), '', 'an older line with no times shows nothing')
assert.strictEqual(Core.label(null), '')
assert.strictEqual(Core.hoursText(8), '8 hrs')
assert.strictEqual(Core.hoursText(1), '1 hr')
assert.strictEqual(Core.hoursText(8.33), '8.33 hrs')
assert.strictEqual(Core.hoursText(null), '')

// The server's refusal, however it arrives.
assert.strictEqual(Core.refused({ code: 'time_entry_required' }), true)
assert.strictEqual(Core.refused({ error: 'time_entry_required' }), true)
assert.strictEqual(Core.refused({ code: 'request_failed', body: { code: 'TIME_ENTRY_REQUIRED' } }), true)
assert.strictEqual(Core.refused({ code: 'WEEK_ALREADY_INVOICED' }), false)
assert.strictEqual(Core.refused(null), false)
assert.match(Core.REFUSAL_MSG, /date you worked, a start time and a finish time/)
assert(!/—/.test(Core.REFUSAL_MSG), 'no em dash in words a trade reads')

// ── 2. The payload the trade app posts ─────────────────────────────────────
const ctx = {
  _isMakesafeCard: function (c) { return !!c.is_makesafe },
  RATE_NOT_SET_MSG: 'No pay rate is set for you yet.',
  console,
}
vm.createContext(ctx)
vm.runInContext(slice('// [JC-PAYLOAD-BUILD-START]', '// [JC-PAYLOAD-BUILD-END]'), ctx)
const build = ctx._buildJobCentricPayload
const WEEK = { weekStart: '2026-10-05', weekEnd: '2026-10-11' }

function card(overrides) {
  return Object.assign({
    _idx: 0, included: true, assignment_id: 'a-1', manually_added: false, extra_day: false,
    job_id: 'j-1', job_number: 'SWF-26001', job_type: 'fencing', client_name: 'Test Client',
    scheduled_date: '2026-10-07', work_date: '2026-10-07',
    start_time: '07:00', finish_time: '15:30', break_minutes: 30, start_auto: false,
    rate: 45, rate_source: 'server_resolved', description: '',
    wo_mode: false, commission_mode: false, wo_lump_lines: [], wo_labour_lines: [],
  }, overrides || {})
}
function plain(v) { return JSON.parse(JSON.stringify(v)) }

// An assigned job: the time fields ride manual_assignments with the hours
// they work out to.
let out = build([card()], WEEK)
assert(!out.error, out.error)
assert.deepStrictEqual(plain(out.manualAssignments), [{
  assignment_id: 'a-1', hours: 8,
  work_date: '2026-10-07', start_time: '07:00', finish_time: '15:30', break_minutes: 30,
  rate: 45, rate_source: 'server_resolved', description: '', manually_added: false,
}])
assert.strictEqual(out.subtotal, 360)
assert.strictEqual(out.cardExtraItems.length, 0)

// A typed hours figure with no times bills nothing and cannot be sent.
out = build([card({ start_time: '', finish_time: '', break_minutes: 0, hours: 8 })], WEEK)
assert.match(out.error, /SWF-26001: add the date, start time and finish time you worked/)
assert.deepStrictEqual(plain(out.missingIndices), [0])
// The remembered start a card opens on is not the trade's own entry.
out = build([card({ start_time: '07:00', start_auto: true, finish_time: '', break_minutes: 0 })], WEEK)
assert.match(out.error, /add the date, start time and finish time you worked/)

// Each missing piece is named.
assert.match(build([card({ finish_time: '' })], WEEK).error, /SWF-26001: Add your finish time\./)
assert.match(build([card({ start_time: '' })], WEEK).error, /SWF-26001: Add your start time\./)
assert.match(build([card({ work_date: '' })], WEEK).error, /SWF-26001: Add the date you worked\./)
assert.match(build([card({ finish_time: '06:00' })], WEEK).error, /Finish time must be after start time/)
assert.match(build([card({ break_minutes: 600 })], WEEK).error, /break is as long as the time worked/)
// An unticked card owes nothing.
assert(!build([card(), card({ _idx: 1, assignment_id: 'a-2', job_id: 'j-2', included: false, start_time: '', finish_time: '' })], WEEK).error)

// An assigned job was worked in the week it was scheduled.
assert.match(build([card({ work_date: '2026-10-12' })], WEEK).error, /outside this invoice week/)
assert.match(build([card({ work_date: '2026-10-04' })], WEEK).error, /outside this invoice week/)

// A job the trade searched in: same fields on a Labour extra, dated the day
// it was worked. An older job claimed late keeps its true date.
out = build([card({ assignment_id: null, manually_added: true, description: 'Reattend', work_date: '2026-09-29', scheduled_date: '2026-09-29', rate: 50, rate_source: 'client_entered' })], WEEK)
assert(!out.error, out.error)
assert.strictEqual(out.manualAssignments.length, 0)
const searched = plain(out.cardExtraItems[0])
assert.deepStrictEqual(
  [searched.type, searched.unit, searched.quantity, searched.rate, searched.date, searched.work_date, searched.start_time, searched.finish_time, searched.break_minutes, searched.source, searched.rate_source],
  ['Labour', 'hr', 8, 50, '2026-09-29', '2026-09-29', '07:00', '15:30', 30, 'manual_job_search', 'client_entered'])
assert.match(build([card({ assignment_id: null, manually_added: true, description: 'x', work_date: '2026-10-12' })], WEEK).error, /after this invoice week/)

// A second day on the same job is a second line. It has no assignment row,
// so it rides the office-verified extras lane and never the assignment lane
// (ops-api keys manual_assignments by assignment_id: two would collapse).
out = build([
  card(),
  card({ _idx: 1, assignment_id: null, extra_day: true, work_date: '2026-10-08', scheduled_date: '2026-10-08', start_time: '08:00', finish_time: '12:00', break_minutes: 0 }),
], WEEK)
assert(!out.error, out.error)
assert.strictEqual(out.manualAssignments.length, 1)
assert.strictEqual(out.cardExtraItems.length, 1)
const second = plain(out.cardExtraItems[0])
assert.deepStrictEqual(
  [second.job_id, second.quantity, second.work_date, second.start_time, second.finish_time, second.break_minutes, second.source, second.rate_source, second.description],
  ['j-1', 4, '2026-10-08', '08:00', '12:00', 0, 'extra_day', 'client_entered', 'Another day on this job'])
assert.strictEqual(out.subtotal, 360 + 180)

// One line is one job on one day: an added line cannot double a day up.
out = build([
  card(),
  card({ _idx: 1, assignment_id: null, extra_day: true, work_date: '2026-10-07', start_time: '16:00', finish_time: '18:00', break_minutes: 0 }),
], WEEK)
assert.match(out.error, /two lines for 2026-10-07/)
assert.deepStrictEqual(plain(out.missingIndices), [1])
// Two office assignments on one job and day are the office's doing, not doubled-up typing.
assert(!build([card(), card({ _idx: 1, assignment_id: 'a-9', start_time: '16:00', finish_time: '18:00', break_minutes: 0 })], WEEK).error)

// Lines that are not time carry none of the fields.
out = build([
  card({ commission_mode: true, commission_amount: 200 }),
  card({ _idx: 1, assignment_id: 'a-2', job_id: 'j-2', job_number: 'SWF-26002', wo_mode: true, wo_allocated: 500 }),
], WEEK)
assert(!out.error, out.error)
assert.strictEqual(out.manualAssignments.length, 0)
out.cardExtraItems.forEach(function (item) {
  ;['work_date', 'start_time', 'finish_time', 'break_minutes'].forEach(function (k) {
    assert(!(k in item), item.type + ' must not carry ' + k)
  })
})
// A card that only carries an amount bills no time and owes no times.
out = build([card({ start_time: '', finish_time: '', break_minutes: 0, wo_lump_lines: [{ description: 'Tip fees', amount: 40 }] })], WEEK)
assert(!out.error, out.error)
assert.strictEqual(out.manualAssignments.length, 0)

console.log('trade time entry: rules and payload shape OK')
