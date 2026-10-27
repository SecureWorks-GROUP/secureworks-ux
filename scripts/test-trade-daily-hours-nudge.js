#!/usr/bin/env node
// Daily hours nudge. Shows only for the running-draft flag, only when a job
// today has no start and finish, and never asks to send an invoice.
const assert = require('assert');
require('../modules/trade-invoice-running-draft.js');
const Nudge = require('../modules/trade-daily-hours-nudge.js');

const today = '2026-10-21';
const job = {
  source_key: 'wo:wo-today',
  work_order_id: 'wo-today',
  job_number: 'SWMS-261400',
  client_name: 'Approved Work',
  site_suburb: 'Midland',
  scheduled_date: today,
  included: true
};

function decide(extra) {
  return Nudge.decide(Object.assign({
    flag: true,
    today: today,
    dismissedOn: '',
    weekSubmitted: false,
    suggested: [job],
    cards: [],
    claimed: [],
    dismissed: []
  }, extra || {}));
}

assert.strictEqual(decide({ flag: false }).show, false);
assert.strictEqual(decide({ flag: false }).reason, 'off');
assert.strictEqual(decide({ dismissedOn: today }).reason, 'dismissed');
assert.strictEqual(decide({ weekSubmitted: true }).reason, 'submitted');
assert.strictEqual(decide({ suggested: [], cards: [] }).reason, 'no-job');

const open = decide();
assert.strictEqual(open.show, true);
assert.strictEqual(open.title, "Add today's hours");
assert.ok(open.detail.indexOf('SWMS-261400') !== -1);
assert.ok(open.detail.indexOf('Midland') !== -1);
assert.ok(open.detail.indexOf('Nothing is sent') !== -1);
assert.strictEqual(open.open.length, 1);

const logged = decide({
  cards: [{
    source_key: 'wo:wo-today',
    work_order_id: 'wo-today',
    job_number: 'SWMS-261400',
    scheduled_date: today,
    work_date: today,
    start_time: '07:00',
    finish_time: '15:30',
    break_minutes: 30,
    included: true
  }]
});
assert.strictEqual(logged.reason, 'logged', 'start and finish for today hide the nudge');
assert.strictEqual(Nudge.hoursOf('07:00', '15:30', 30), 8);

const oneOfTwo = decide({
  suggested: [
    job,
    {
      assignment_id: 'as-2',
      job_number: 'SWF-200',
      site_suburb: 'Joondalup',
      scheduled_date: today,
      included: true
    }
  ],
  cards: [{
    source_key: 'wo:wo-today',
    job_number: 'SWMS-261400',
    work_date: today,
    start_time: '07:00',
    finish_time: '12:00',
    included: true
  }]
});
assert.strictEqual(oneOfTwo.show, true);
assert.deepStrictEqual(oneOfTwo.open.map(function (row) { return row.job_number; }), ['SWF-200']);

assert.strictEqual(decide({ claimed: ['wo:wo-today'] }).reason, 'no-job');
assert.strictEqual(decide({ dismissed: ['wo:wo-today'] }).reason, 'no-job');

assert.strictEqual(decide({
  suggested: [],
  cards: [{
    source_key: 'wo:wo-today',
    job_number: 'SWMS-261400',
    scheduled_date: today,
    wo_mode: true,
    included: true
  }]
}).reason, 'logged', 'a work-order card for today is already on the draft');

assert.strictEqual(decide({
  suggested: [job],
  cards: [{
    source_key: 'as:other',
    assignment_id: 'other',
    job_number: 'SWF-YESTERDAY',
    scheduled_date: '2026-10-20',
    work_date: '2026-10-20',
    start_time: '07:00',
    finish_time: '15:00',
    included: true
  }]
}).show, true, 'yesterday does not clear today');

const draft = require('../modules/trade-invoice-running-draft.js');
assert.strictEqual(Nudge.sourceKey({ assignment_id: 'as-1' }), draft.sourceKey({ assignment_id: 'as-1' }));
assert.strictEqual(Nudge.sourceKey(job), 'wo:wo-today');

console.log('trade daily hours nudge: ok');
