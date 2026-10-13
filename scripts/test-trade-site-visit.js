#!/usr/bin/env node
// Sign in and sign out on a job carry over to the invoice (Captain, 2026-10-13).
//
// A trade taps Sign in when they arrive and Sign out when they leave. Those taps
// fill date worked, start, finish and break on that job's invoice line, one
// line per signed-in day, rounded to 15 minutes by ops-api. This harness runs the shipped
// code, not a copy: it extracts the `<trade-time-entry>` and `<trade-site-visit>`
// rules and the [JC-PAYLOAD-BUILD-START..END] payload builder verbatim from
// trade.html and pins the rules and the exact fields ops-api is built against.
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
const plain = (v) => JSON.parse(JSON.stringify(v))

// ── 1. The rules, on their own ─────────────────────────────────────────────
const rulesCtx = { console, Intl }
vm.createContext(rulesCtx)
vm.runInContext(
  slice('// <trade-time-entry>', '// </trade-time-entry>') +
  slice('// <trade-site-visit>', '// </trade-site-visit>') +
  '\nthis.T = TradeTimeEntryCore; this.SV = TradeSiteVisitCore;', rulesCtx)
const { T, SV } = rulesCtx

assert.strictEqual(T.clock12('07:02'), '7:02 am')
assert.strictEqual(T.clock12('15:34'), '3:34 pm')
assert.strictEqual(T.clock12('00:05'), '12:05 am')
assert.strictEqual(T.clock12('12:00'), '12:00 pm')

// A signed-in day from my_hours: the server's rounded times are the source.
const served = {
  work_date: '2026-10-06', start_time: '07:00', finish_time: '15:30', break_minutes: 30, hours: 8,
  tapped_in: '07:02', tapped_out: '15:34', out_capture: 'tap', visit_ids: ['v-1', 'v-2']
}
assert.deepStrictEqual(plain(SV.day(served)), {
  work_date: '2026-10-06', start_time: '07:00', finish_time: '15:30', finish_next_day: false, break_minutes: 30,
  tapped_in: '07:02', tapped_out: '15:34', out_capture: 'tap', visit_ids: ['v-1', 'v-2']
})
// The app rounds nothing itself: a day sent with only its exact taps is not offered.
assert.strictEqual(SV.day({ work_date: '2026-10-06', tapped_in: '07:02', tapped_out: '15:34' }), null)
// No sign out: the start is carried and the finish is left blank. Never invented.
const open = SV.day({ work_date: '2026-10-06', start_time: '07:00', finish_time: null, hours: null, tapped_in: '07:02', tapped_out: null, visit_ids: ['v-3'] })
assert.strictEqual(open.start_time, '07:00')
assert.strictEqual(open.finish_time, '')
// A day that makes no line is not offered.
assert.strictEqual(SV.day({ work_date: '2026-10-06', start_time: '07:00', finish_time: '07:00' }), null, 'rounding left the finish not after the start')
assert.strictEqual(SV.day({ work_date: 'yesterday', start_time: '07:00' }), null)
assert.strictEqual(SV.day({ work_date: '2026-10-06' }), null, 'no sign in time is no sign in')
assert.strictEqual(SV.day(null), null)
// A visit that ran past midnight (a night make-safe callout): signed in
// 11:30 pm, signed out 1:15 am. One day, dated the day it started, and the
// finish is the next day's clock time.
const night = SV.day({ work_date: '2026-10-05', start_time: '23:30', finish_time: '01:15', finish_next_day: true, break_minutes: 0, hours: 1.75, tapped_in: '23:30', tapped_out: '01:15', out_capture: 'tap', visit_ids: ['v-night'] })
assert.deepStrictEqual(plain(night), {
  work_date: '2026-10-05', start_time: '23:30', finish_time: '01:15', finish_next_day: true, break_minutes: 0,
  tapped_in: '23:30', tapped_out: '01:15', out_capture: 'tap', visit_ids: ['v-night']
})
assert.strictEqual(SV.day({ work_date: '2026-10-05', start_time: '23:30', finish_time: '01:15' }), null, 'a finish before the start is a day only where the server says it ran past midnight')
assert.strictEqual(SV.day({ work_date: '2026-10-05', start_time: '07:00', finish_time: '15:30', finish_next_day: true }), null, 'a visit is never more than a day long')
const nightLine = { ...SV.fill({}, night), sv: night }
assert.strictEqual(T.overnight(nightLine), true)
assert.deepStrictEqual(plain(T.check(nightLine, '2026-10-11')), { ok: true, hours: 1.75, field: '', error: '' })
assert.deepStrictEqual(plain(T.fields(nightLine)), { work_date: '2026-10-05', start_time: '23:30', finish_time: '01:15', break_minutes: 0, finish_next_day: true })
assert.strictEqual(T.hoursFor('23:30', '01:15', 0, true), 1.75)
assert.deepStrictEqual(plain(SV.note(nightLine, night)), { tag: 'From your sign in', text: 'You left after midnight, so the finish is the next day.' })
assert.strictEqual(T.label({ work_date: '2026-10-05', start_time: '23:30', finish_time: '01:15', finish_next_day: true }), 'Mon 5 Oct, 23:30 to 01:15 the next day')
// They changed the finish to before midnight: an ordinary same-day line again.
assert.strictEqual(T.overnight({ ...nightLine, finish_time: '23:45' }), false)
assert.deepStrictEqual(plain(T.fields({ ...nightLine, finish_time: '23:45' })), { work_date: '2026-10-05', start_time: '23:30', finish_time: '23:45', break_minutes: 0 })
assert.strictEqual(T.check({ ...nightLine, finish_time: '23:45' }, '2026-10-11').hours, 0.25)
// Past midnight is only for a line still on the day of a sign in that did:
// a typed line, or one moved to another day, keeps finish after start.
assert.match(T.check({ work_date: '2026-10-05', start_time: '23:30', finish_time: '01:15', break_minutes: 0 }, '2026-10-11').error, /Finish time must be after start time/)
assert.match(T.check({ ...nightLine, work_date: '2026-10-06' }, '2026-10-11').error, /Finish time must be after start time/)
assert.match(T.check({ ...SV.fill({}, SV.day(served)), sv: SV.day(served), start_time: '16:00' }, '2026-10-11').error, /Finish time must be after start time/)
// One entry per day, oldest first.
assert.deepStrictEqual(
  plain(SV.days([{ ...served, work_date: '2026-10-08' }, served, { ...served, start_time: '09:00' }, null]).map((d) => [d.work_date, d.start_time])),
  [['2026-10-06', '07:00'], ['2026-10-08', '07:00']])
assert.deepStrictEqual(plain(SV.days(undefined)), [], 'an ops-api that sends no sign ins gives none')

// Which day rides which card: its own day's card first, then a free card,
// then a further line on the job's first card.
const d6 = SV.day(served)
const d7 = SV.day({ ...served, work_date: '2026-10-07', visit_ids: ['v-7'] })
const d8 = SV.day({ ...served, work_date: '2026-10-08', visit_ids: ['v-8'] })
let plan = SV.assign([
  { key: 0, job_id: 'j1', scheduled_date: '2026-10-06', days: [d6, d7, d8] },
  { key: 1, job_id: 'j1', scheduled_date: '2026-10-07', days: [d6, d7, d8] },
  { key: 2, job_id: 'j2', scheduled_date: '2026-10-06', days: [] }
])
assert.deepStrictEqual(plain(plan.line), { 0: plain(d6), 1: plain(d7) })
assert.deepStrictEqual(plain(plan.more), { 0: [plain(d8)] }, 'the day with no card of its own is a further line on the first card')
plan = SV.assign([{ key: 4, job_id: 'j1', scheduled_date: '2026-10-05', days: [d7] }])
assert.deepStrictEqual(plain(plan.line), { 4: plain(d7) }, 'signed in on a different day to the booking: the card carries the day they signed in')
assert.deepStrictEqual(plain(SV.assign([{ key: 0, job_id: 'j1', scheduled_date: '2026-10-06', days: [] }])), { line: {}, more: {} })

// Filling: only an untouched line, and it says where the times came from.
const line = { work_date: '', start_time: '', finish_time: '', break_minutes: 0 }
assert.strictEqual(SV.blank(line), true)
assert.strictEqual(SV.blank({ ...line, start_time: '06:00' }), false, 'a line the trade typed on is theirs')
SV.fill(line, d6)
assert.deepStrictEqual(plain(line), { work_date: '2026-10-06', start_time: '07:00', finish_time: '15:30', break_minutes: 30 })
assert.strictEqual(SV.same(line, d6), true)
assert.deepStrictEqual(plain(SV.note(line, d6)), { tag: 'From your sign in', text: '' })
assert.deepStrictEqual(plain(SV.ids(line, d6)), ['v-1', 'v-2'])
// A time they change: the line says what the tap was, and that the office sees both.
assert.deepStrictEqual(plain(SV.note({ ...line, finish_time: '16:00' }, d6)),
  { tag: 'From your sign in', text: 'You signed out at 3:34 pm. The office sees both.' })
assert.deepStrictEqual(plain(SV.note({ ...line, start_time: '06:30' }, d6)),
  { tag: '', text: 'You signed in at 7:02 am. The office sees both.' })
assert.deepStrictEqual(plain(SV.ids({ ...line, finish_time: '16:00' }, d6)), ['v-1', 'v-2'], 'a changed time still points at its sign in')
// A break they add is not a changed tap.
assert.deepStrictEqual(plain(SV.note({ ...line, break_minutes: 45 }, d6)), { tag: 'From your sign in', text: '' })
// Moved to another day, the line is no longer that sign in.
assert.deepStrictEqual(plain(SV.ids({ ...line, work_date: '2026-10-07' }, d6)), [])
assert.deepStrictEqual(plain(SV.note({ ...line, work_date: '2026-10-07' }, d6)), { tag: '', text: 'You signed in on Tue 6 Oct.' })
// No sign out: the finish is the trade's to give.
assert.deepStrictEqual(plain(SV.note(SV.fill({}, open), open)),
  { tag: 'From your sign in', text: 'No sign out that day. Add the time you left.' })
assert.match(SV.note({ ...SV.fill({}, open), finish_time: '15:30' }, open).text, /No sign out that day\. The finish is the time you typed\./)
// A leave time typed later is marked as typed.
assert.match(SV.note(SV.fill({}, { ...d6, out_capture: 'typed_later' }), { ...d6, out_capture: 'typed_later' }).text, /You typed the time you left\. It was not a tap\./)
assert.deepStrictEqual(plain(SV.note(line, null)), { tag: '', text: '' }, 'no sign in, nothing said')

// The open sign in, as my_jobs.open_site_visit gives it.
const visit = SV.openVisit({ visit_id: 'v-9', job_id: 'j1', job_number: 'SWF-1', site_suburb: 'Northfield', signed_in_at: '2026-10-05T07:02:00+08:00', status: 'open' })
assert.strictEqual(visit.visit_id, 'v-9')
assert.strictEqual(SV.signedInText(visit), 'Signed in 7:02 am')
assert.strictEqual(SV.signedInText({ ...visit, pending: true }), 'Signed in 7:02 am · waiting for signal')
assert.strictEqual(SV.signedInText({ ...visit, pending: true, sending: true }), 'Signed in 7:02 am · sending', 'a tap on its way to the server')
assert.strictEqual(SV.where(visit), 'Northfield')
assert.strictEqual(SV.openVisit(null), null)
assert.strictEqual(SV.openVisit({ job_id: 'j1', signed_in_at: 'not a time' }), null)
assert.strictEqual(SV.openVisit({ job_id: 'j1', signed_in_at: '2026-10-05T07:02:00+08:00', status: 'closed' }), null)
// One shape only: the visit names itself by visit_id and signed_in_at.
assert.strictEqual(SV.openVisit({ id: 'v-9', job_id: 'j1', signed_in_at: '2026-10-05T07:02:00+08:00' }).visit_id, '')
assert.strictEqual(SV.openVisit({ visit_id: 'v-9', job_id: 'j1', clocked_on_at: '2026-10-05T07:02:00+08:00' }), null)
// Forgot to sign out: the server marked it, or it is from an earlier day
// and more than 16 hours old. Never today's, and never one that only ran
// past midnight.
assert.strictEqual(SV.owesFinish(visit, new Date('2026-10-05T16:00:00+08:00')), false, 'still on site today')
assert.strictEqual(SV.owesFinish(visit, new Date('2026-10-06T06:30:00+08:00')), true)
assert.strictEqual(SV.owesFinish({ ...visit, status: 'no_sign_out' }, new Date('2026-10-05T23:30:00+08:00')), true)
const lateShift = SV.openVisit({ visit_id: 'v-night', job_id: 'j1', site_suburb: 'Northfield', signed_in_at: '2026-10-05T23:30:00+08:00', status: 'open' })
assert.strictEqual(SV.owesFinish(lateShift, new Date('2026-10-06T01:15:00+08:00')), false, 'signed in 11:30 pm, still on site at 1:15 am')
assert.strictEqual(SV.owesFinish(lateShift, new Date('2026-10-06T15:30:00+08:00')), false, '16 hours on the dot is still live')
assert.strictEqual(SV.owesFinish(lateShift, new Date('2026-10-06T15:31:00+08:00')), true)
assert.strictEqual(SV.owesFinish({ ...lateShift, status: 'no_sign_out' }, new Date('2026-10-06T01:15:00+08:00')), true, 'the server\'s mark decides whatever the hour')
assert.strictEqual(SV.owesFinish({ ...visit, signed_in_at: '2026-10-05T00:10:00+08:00' }, new Date('2026-10-05T23:50:00+08:00')), false, 'a long day is not an earlier day')
assert.strictEqual(SV.lateQuestion(visit, new Date('2026-10-06T06:30:00+08:00')),
  'You are still signed in at Northfield since 7:02 am Monday. What time did you leave?')
// The time they left is a day and a time after the sign in, not after now.
// A clock time at or before the sign in's can only be the day after.
const tuesday = new Date('2026-10-06T06:30:00+08:00')
assert.deepStrictEqual(plain(SV.lateLeave(visit, '15:30', tuesday)), { error: '', finish_date: '2026-10-05', finish_time: '15:30', when: '3:30 pm' })
assert.deepStrictEqual(plain(SV.lateLeave(visit, '06:00', tuesday)),
  { error: '', finish_date: '2026-10-06', finish_time: '06:00', when: '6:00 am Tuesday, the day after you signed in' })
assert.deepStrictEqual(plain(SV.lateLeave(lateShift, '01:15', new Date('2026-10-06T09:00:00+08:00'))),
  { error: '', finish_date: '2026-10-06', finish_time: '01:15', when: '1:15 am Tuesday, the day after you signed in' })
assert.match(SV.lateLeave(visit, '', tuesday).error, /Add the time you left/)
assert.match(SV.lateLeave(visit, '07:02', tuesday).error, /must be after you signed in at 7:02 am/)
assert.match(SV.lateLeave(visit, '06:45', tuesday).error, /cannot be after now/, 'the next day, but later than it is now')
assert.match(SV.lateLeave(visit, '18:00', new Date('2026-10-05T16:00:00+08:00')).error, /cannot be after now/)
assert.match(SV.lateLeave(lateShift, '01:15', new Date('2026-10-05T23:50:00+08:00')).error, /cannot be after now/)
assert.strictEqual(SV.lateLeave(visit, '15:30', tuesday).finish_date < SV.lateLeave(visit, '06:00', tuesday).finish_date, true)

// Signed in at another job: the server says where, and the app asks once.
const clash = SV.alreadySignedIn({ status: 409, code: 'already_signed_in', body: { code: 'already_signed_in', visit_id: 'v-1', job_id: 'j9', job_number: 'SWP-9', site_suburb: 'Kinross', signed_in_at: '2026-10-05T07:02:00+08:00' } })
assert.strictEqual(SV.where(clash), 'Kinross')
assert.strictEqual(clash.visit_id, 'v-1')
assert.strictEqual(SV.alreadySignedIn({ status: 409, code: 'WEEK_ALREADY_INVOICED' }), null)
assert.strictEqual(SV.alreadySignedIn({ status: 500, message: 'Not your assignment' }), null)

// Jobs signed in to with no card in the week: one entry per signed-in day,
// naming its job, gathered per job.
assert.deepStrictEqual(
  plain(SV.otherJobs([
    { job_id: 'j5', job_number: 'SWP-5', site_suburb: 'Duncraig', ...served },
    { job_id: 'j5', job_number: 'SWP-5', site_suburb: 'Duncraig', ...served, work_date: '2026-10-07' },
    { job_id: 'j6', job_number: 'SWF-6', site_suburb: 'Morley', ...served },
    { job_id: 'j7', job_number: 'SWF-7', work_date: '2026-10-06' },
    { job_number: 'SWF-8', ...served },
    null
  ]).map((g) => [g.job_id, g.job_number, g.site_suburb, g.days.map((d) => d.work_date)])),
  [['j5', 'SWP-5', 'Duncraig', ['2026-10-06', '2026-10-07']], ['j6', 'SWF-6', 'Morley', ['2026-10-06']]])
assert.deepStrictEqual(plain(SV.otherJobs(undefined)), [])

// Plain words in everything these rules hand a screen: no clock, timer or
// shift, and no long dash.
const typedLater = { ...d6, out_capture: 'typed_later' }
const said = [
  SV.signedInText(visit), SV.signedInText({ ...visit, pending: true }), SV.signedInText({ ...visit, pending: true, sending: true }), SV.where(visit), SV.where(null),
  SV.lateQuestion(visit, tuesday), SV.lateQuestion(visit, new Date('2026-10-05T16:00:00+08:00')),
  SV.lateLeave(null, '15:30', tuesday).error, SV.lateLeave(visit, '', tuesday).error, SV.lateLeave(visit, '07:02', tuesday).error,
  SV.lateLeave(visit, '18:00', new Date('2026-10-05T16:00:00+08:00')).error, SV.lateLeave(visit, '06:00', tuesday).when,
  SV.note(nightLine, night).text,
  ...[
    SV.note(line, d6), SV.note({ ...line, start_time: '06:30', finish_time: '16:00' }, d6), SV.note({ ...line, work_date: '2026-10-07' }, d6),
    SV.note(SV.fill({}, open), open), SV.note({ ...SV.fill({}, open), finish_time: '15:30' }, open), SV.note(SV.fill({}, typedLater), typedLater)
  ].flatMap((n) => [n.tag, n.text])
]
assert(said.filter(Boolean).length >= 14, 'the rules said something for every case asked')
said.forEach((w) => {
  assert(!/\b(clock(ed)?|timer|shift)\b/i.test(w), 'plain words only: ' + w)
  assert(!/[\u2013\u2014]/.test(w), 'no long dash in words a trade reads: ' + w)
})

// ── 2. The payload the trade app posts ─────────────────────────────────────
const ctx = {
  _isMakesafeCard: function (c) { return !!c.is_makesafe },
  RATE_NOT_SET_MSG: 'No pay rate is set for you yet.',
  console, Intl
}
vm.createContext(ctx)
vm.runInContext(slice('// [JC-PAYLOAD-BUILD-START]', '// [JC-PAYLOAD-BUILD-END]'), ctx)
const build = ctx._buildJobCentricPayload
const WEEK = { weekStart: '2026-10-05', weekEnd: '2026-10-11', today: '2026-10-11' }
function card(extra) {
  return Object.assign({
    _idx: 0, included: true, assignment_id: 'a1', job_id: 'j1', job_number: 'SWF-1', client_name: 'Client', site_suburb: 'Northfield',
    job_type: 'fencing', scheduled_date: '2026-10-06', rate: 50, rate_source: 'server_resolved', description: '',
    work_date: '', start_time: '', finish_time: '', break_minutes: 0, hours: null, wo_lump_lines: [], wo_labour_lines: [], more_days: [], sv: null
  }, extra || {})
}
function filled(day, extra) { return Object.assign({ work_date: day.work_date, start_time: day.start_time, finish_time: day.finish_time, break_minutes: day.break_minutes, sv: day }, extra || {}) }

// A line filled from a sign in posts the same four fields, plus its sign ins.
let built = build([card(filled(d6))], WEEK)
assert.strictEqual(built.error, undefined)
assert.deepStrictEqual(plain(built.manualAssignments), [{
  assignment_id: 'a1', hours: 8, work_date: '2026-10-06', start_time: '07:00', finish_time: '15:30', break_minutes: 30,
  rate: 50, rate_source: 'server_resolved', description: '', manually_added: false, site_visit_ids: ['v-1', 'v-2']
}])
assert.strictEqual(built.subtotal, 400)

// No sign in: the PR 375 payload, byte for byte. No site_visit_ids key at all.
built = build([card({ work_date: '2026-10-06', start_time: '07:00', finish_time: '15:00' })], WEEK)
assert.deepStrictEqual(plain(built.manualAssignments), [{
  assignment_id: 'a1', hours: 8, work_date: '2026-10-06', start_time: '07:00', finish_time: '15:00', break_minutes: 0,
  rate: 50, rate_source: 'server_resolved', description: '', manually_added: false
}])
assert.strictEqual('site_visit_ids' in built.manualAssignments[0], false)

// The trade changed a time: what they submit is billed, and it still points at the sign in.
built = build([card(filled(d6, { finish_time: '16:00' }))], WEEK)
assert.strictEqual(built.manualAssignments[0].hours, 8.5)
assert.deepStrictEqual(plain(built.manualAssignments[0].site_visit_ids), ['v-1', 'v-2'])

// A rate they changed for this job is the rate sent, marked as theirs.
built = build([card(filled(d6, { rate: 60, rate_source: 'client_entered' }))], WEEK)
assert.deepStrictEqual([built.manualAssignments[0].rate, built.manualAssignments[0].rate_source], [60, 'client_entered'])
assert.strictEqual(built.subtotal, 480)
// No rate in the box: they are asked for it, never sent to the office for it.
built = build([card(filled(d6, { rate: 0 }))], WEEK)
assert.match(built.error, /SWF-1: enter your rate/)

// Signed in 11:30 pm, signed out 1:15 am: one line dated the day it started,
// 1.75 hours, and it says the finish is the next day.
built = build([card(filled(night, { scheduled_date: '2026-10-05' }))], WEEK)
assert.strictEqual(built.error, undefined)
assert.deepStrictEqual(plain(built.manualAssignments), [{
  assignment_id: 'a1', hours: 1.75, work_date: '2026-10-05', start_time: '23:30', finish_time: '01:15', finish_next_day: true, break_minutes: 0,
  rate: 50, rate_source: 'server_resolved', description: '', manually_added: false, site_visit_ids: ['v-night']
}])
assert.strictEqual(built.subtotal, 87.5)
// A line the trade typed themselves cannot run past midnight.
assert.match(build([card({ work_date: '2026-10-05', start_time: '23:30', finish_time: '01:15' })], WEEK).error, /SWF-1: Finish time must be after start time/)

// No sign out: start filled, finish blank, and the line will not submit.
built = build([card(filled(open))], WEEK)
assert.match(built.error, /SWF-1: Add your finish time\./)

// Several signed-in days on one card: the first rides the assignment row,
// each further day is its own extra_items line for the same job. It says it
// came from a sign in, never that the trade searched the job in, it carries
// the card's own rate source, and it needs no description.
const multi = card(filled(d6, {
  more_days: [
    { work_date: d7.work_date, start_time: d7.start_time, finish_time: d7.finish_time, break_minutes: d7.break_minutes, sv: d7 },
    { work_date: d8.work_date, start_time: d8.start_time, finish_time: d8.finish_time, break_minutes: d8.break_minutes, sv: d8, removed: true }
  ]
}))
built = build([multi], WEEK)
assert.strictEqual(built.error, undefined)
assert.strictEqual(built.manualAssignments.length, 1)
assert.deepStrictEqual(plain(built.cardExtraItems), [{
  type: 'Labour', row_type: 'labour', description: '', quantity: 8, unit: 'hr', rate: 50,
  date: '2026-10-07', work_date: '2026-10-07', start_time: '07:00', finish_time: '15:30', break_minutes: 30,
  job_id: 'j1', job_number: 'SWF-1', division: 'fencing', client_name: 'Client',
  manually_added: false, source: 'site_visit_day', rate_source: 'server_resolved', client_rate_entered: false,
  site_visit_ids: ['v-7']
}], 'a removed day is not sent')
assert.strictEqual(built.subtotal, 800)
// A rate they changed for the job marks every day of it as theirs.
built = build([Object.assign({}, multi, { rate: 60, rate_source: 'client_entered' })], WEEK)
assert.deepStrictEqual(
  [built.cardExtraItems[0].source, built.cardExtraItems[0].manually_added, built.cardExtraItems[0].rate, built.cardExtraItems[0].rate_source, built.cardExtraItems[0].client_rate_entered],
  ['site_visit_day', false, 60, 'client_entered', true])
// On a job the trade added themselves, a further day is labelled like that card's first line.
built = build([Object.assign({}, multi, { assignment_id: null, manually_added: true, rate_source: 'client_entered', description: 'Helped on the fence' })], WEEK)
assert.deepStrictEqual(
  plain(built.cardExtraItems.map((x) => [x.work_date, x.manually_added, x.source, x.rate_source, x.client_rate_entered])),
  [['2026-10-06', true, 'manual_job_search', 'client_entered', true], ['2026-10-07', true, 'manual_job_search', 'client_entered', true]])
// The card's own line left blank: its further days are still checked and still
// billed, with an amount on the card or without one.
const laterOnly = Object.assign({}, multi, { work_date: '', start_time: '', finish_time: '', break_minutes: 0, sv: null })
built = build([laterOnly], WEEK)
assert.strictEqual(built.error, undefined)
assert.deepStrictEqual(plain(built.manualAssignments), [])
assert.deepStrictEqual(plain(built.cardExtraItems.map((x) => [x.work_date, x.quantity, x.source])), [['2026-10-07', 8, 'site_visit_day']])
assert.strictEqual(built.subtotal, 400)
const withAmount = Object.assign({}, laterOnly, { wo_lump_lines: [{ description: 'Skip bin', amount: 40, line_kind: 'lump_sum' }] })
built = build([withAmount], WEEK)
assert.strictEqual(built.error, undefined)
assert.deepStrictEqual(plain(built.cardExtraItems.filter((x) => x.source === 'site_visit_day').map((x) => [x.work_date, x.quantity])), [['2026-10-07', 8]],
  'an amount on the card does not drop the further days it shows')
assert.match(build([Object.assign({}, withAmount, { more_days: [{ work_date: '2026-10-07', start_time: '07:00', finish_time: '', break_minutes: 0 }] })], WEEK).error,
  /SWF-1 \(Wed 7 Oct\): Add your finish time\./, 'a further day is checked even when the card bills an amount')
// A further day needs an in-week date and its own day.
assert.match(build([Object.assign({}, multi, { more_days: [{ work_date: '2026-10-07', start_time: '07:00', finish_time: '', break_minutes: 0 }] })], WEEK).error,
  /SWF-1 \(Wed 7 Oct\): Add your finish time\./)
assert.match(build([Object.assign({}, multi, { more_days: [Object.assign({}, multi.more_days[0], { work_date: '2026-10-06' })] })], WEEK).error,
  /two lines for 2026-10-06/)
assert.match(build([Object.assign({}, multi, { more_days: [Object.assign({}, multi.more_days[0], { work_date: '2026-10-01' })] })], WEEK).error,
  /outside this invoice week/)

console.log('trade site visit: sign in rules and invoice payload OK')
