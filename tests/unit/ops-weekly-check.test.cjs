const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRead } = require('../../modules/ops-weekly-check.js');

const job = { week: '2026-11-16', job_id: '00000000-0000-4000-8000-000000000401',
  story: [{ ref: 'headline:1', text: 'Visit arranged.' }],
  notes: [{ item_key: 'note:1', what: 'Check payment.', status: 'open' }] };

test('an untouched job saves an all-correct read', () => {
  assert.deepEqual(buildRead(job, [], []), { week: job.week, job_id: job.job_id, marks: [], missing: [] });
});

test('Should be closed records the note identity, stored problem and reason', () => {
  const body = buildRead(job, [{ target: 'note', ref: 'note:1', problem: 'Should be closed', why: 'invoice was paid' }], []);
  assert.deepEqual(body.marks, [{ target: 'note', ref: 'note:1', problem: 'wrongly_open', why: 'invoice was paid' }]);
});

test('a ticked line without a reason cannot be saved', () => {
  assert.throws(() => buildRead(job, [{ target: 'story', ref: 'headline:1', problem: 'unsupported', why: '  ' }], []), /^Error: reason_needed$/);
});
