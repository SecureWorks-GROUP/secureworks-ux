const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../modules/ops-context-mail.js'), 'utf8');

function load(opsFetch) {
  const context = { opsFetch };
  vm.runInNewContext(source, context);
  return context.OpsContextMail;
}

test('failed or partial capture is never complete', () => {
  const mail = load();
  assert.equal(mail.coverageHonesty({ complete: true, capture_failed: true }).complete, false);
  assert.equal(mail.coverageHonesty({ complete: true, has_more: true }).complete, false);
  assert.equal(mail.coverageHonesty({ status: 'partial' }).complete, false);
});

test('job-first load does not require event_id and uses job_communications', async () => {
  const calls = [];
  const mail = load(async (action, params) => {
    calls.push([action, params]);
    return { ok: true, records: [], coverage: { complete: false, reason: 'uncaptured sent mailbox' } };
  });
  const state = await mail.load('dispatch', { job_id: 'job-1', job_number: 'SWF-1' });
  assert.deepEqual(calls[0][0], 'job_communications');
  assert.equal(calls[0][1].job_id, 'job-1');
  assert.equal(state.capability, 'connected');
  assert.equal(state.coverage.complete, false);
  const html = mail.render('dispatch', { job_id: 'job-1' }, state);
  assert.match(html, /not complete|partial|uncaptured/i);
  assert.match(html, /sends nothing/);
});
