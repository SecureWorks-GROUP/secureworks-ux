const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRead } = require('../../modules/ops-weekly-check.js');

const job = { week: '2026-11-16', job_id: 'ZZTEST-401', story: [{ ref: 'headline:1', text: 'The visit is booked.' }], notes: [{ item_key: 'invoice:paid', what: 'Check the invoice.', status: 'open' }] };

test('an untouched read has no marks or missing lines', () => {
  assert.deepEqual(buildRead(job, [], []), { week: job.week, job_id: job.job_id, marks: [], missing: [] });
});

test('a note that should be closed records its item key and reason', () => {
  const result = buildRead(job, [{ target: 'note', ref: 'invoice:paid', problem: 'Should be closed', why: 'invoice was paid' }], []);
  assert.deepEqual(result.marks, [{ target: 'note', ref: 'invoice:paid', problem: 'wrongly_open', why: 'invoice was paid' }]);
});

test('a ticked line without a reason cannot be saved', () => {
  for (const why of ['', '   ']) {
    assert.throws(() => buildRead(job, [{ target: 'story', ref: 'headline:1', problem: 'Not supported by the job', why }], []), /^Error: reason_needed$/);
  }
});
