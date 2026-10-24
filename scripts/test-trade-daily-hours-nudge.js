#!/usr/bin/env node
// Daily hours nudge. Shows only for the running-draft flag, only while today's
// start and finish are missing from the weekly draft, and never asks to send.
const assert = require('assert');
const Core = require('../modules/trade-daily-hours-nudge.js');

const today = '2026-10-24';
const job = {
  assignment_id: 'as-1',
  job_id: 'job-1',
  job_number: 'E2E-JOB-001',
  client_name: 'Fixture Homeowner',
  scheduled_date: today
};
const other = {
  assignment_id: 'as-2',
  job_id: 'job-2',
  job_number: 'SWF-200',
  scheduled_date: today
};

function state(overrides) {
  return Object.assign({
    flagOn: true,
    dismissedDay: '',
    today: today,
    weekSubmitted: false,
    jobsToday: [job],
    lines: []
  }, overrides || {});
}

assert.strictEqual(Core.shouldShow(state({ flagOn: false })), false, 'flag off');
assert.strictEqual(Core.shouldShow(state({ lines: null })), false, 'draft not read yet');
assert.strictEqual(Core.shouldShow(state({ jobsToday: [] })), false, 'no job today');
assert.strictEqual(Core.shouldShow(state({ dismissedDay: today })), false, 'dismissed for today');
assert.strictEqual(Core.shouldShow(state({ dismissedDay: '2026-10-23' })), true, 'yesterday dismiss does not carry');
assert.strictEqual(Core.shouldShow(state({ weekSubmitted: true })), false, 'week already sent');
assert.strictEqual(Core.shouldShow(state()), true, 'today is not on the draft');

const logged = {
  assignment_id: 'as-1',
  job_id: 'job-1',
  work_date: today,
  start_time: '07:00',
  finish_time: '15:00',
  included: true
};
assert.strictEqual(Core.shouldShow(state({ lines: [logged] })), false, 'today is on the draft');
assert.strictEqual(Core.shouldShow(state({
  lines: [Object.assign({}, logged, { work_date: '2026-10-23' })]
})), true, 'another day does not clear today');
assert.strictEqual(Core.shouldShow(state({
  lines: [Object.assign({}, logged, { finish_time: '07:00' })]
})), true, 'a finish that is not after the start is not logged');
assert.strictEqual(Core.shouldShow(state({
  lines: [Object.assign({}, logged, { wo_mode: true })]
})), true, 'a work-order line is not hours');
assert.strictEqual(Core.shouldShow(state({
  lines: [Object.assign({}, logged, { included: false })]
})), true, 'an unticked line is not logged');

const still = Core.missing([job, other], [logged], today);
assert.deepStrictEqual(still.map(function (row) { return row.job_number; }), ['SWF-200']);
assert.strictEqual(Core.copy(still.length).body.indexOf('2 jobs') === -1, true);
assert.strictEqual(Core.copy(2).title, "Add today's hours");
assert.strictEqual(Core.copy(2).body.indexOf('2 jobs today') !== -1, true);

const rows = Core.jobsFromAssignments([
  { id: 'as-1', job_id: 'job-1', scheduled_date: today, status: 'confirmed', jobs: { id: 'job-1', job_number: 'E2E-JOB-001' } },
  { id: 'as-1', job_id: 'job-1', scheduled_date: today, jobs: { id: 'job-1', job_number: 'E2E-JOB-001' } },
  { id: 'as-gone', scheduled_date: today, status: 'cancelled', jobs: { id: 'job-x', job_number: 'SW-X' } },
  { id: 'as-watch', scheduled_date: today, role: 'observer', jobs: { id: 'job-y', job_number: 'SW-Y' } },
  { id: 'as-old', scheduled_date: '2026-10-23', jobs: { id: 'job-z', job_number: 'SW-Z' } }
], today);
assert.deepStrictEqual(rows.map(function (row) { return row.assignment_id; }), ['as-1']);

const banner = Core.bannerHTML(state());
assert.strictEqual(banner.indexOf('Add today&#39;s hours') !== -1, true);
assert.strictEqual(banner.indexOf('data-hours-nudge-go') !== -1, true);
assert.strictEqual(banner.indexOf('Not today') !== -1, true);
assert.strictEqual(banner.indexOf('openDailyHoursNudge') !== -1, true);
assert.strictEqual(/submit|generate_trade_invoice|send_sms|whatsapp/i.test(banner), false, banner);

const land = Core.landHTML(job);
assert.strictEqual(land.indexOf('E2E-JOB-001') !== -1, true);
assert.strictEqual(land.indexOf('does not send the invoice') !== -1, true);
assert.strictEqual(land.indexOf('data-hours-nudge-check') !== -1, true);
assert.strictEqual(/generate_trade_invoice|submitJobCentricInvoice|send_sms|whatsapp/i.test(land), false, land);
assert.strictEqual(Core.dismissKey('user-1'), 'sw_hours_nudge_day:user-1');

console.log('trade daily hours nudge: ok');
