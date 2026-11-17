const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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

for (const failure of ['network', 500, 'malformed', 401, 403]) {
  test(`a ${failure} refresh failure removes the previous sample and only auth failures hide navigation`, async () => {
    const nav = { style: { display: 'none' } };
    const root = { innerHTML: '', classList: { add() {} }, addEventListener() {}, querySelectorAll() { return []; } };
    const fixture = {
      week: job.week, jobs: [{ ...job, job_number: 'ZZTEST-401' }], scores: [], close_shares: null,
      this_week: { drawn: 1, read: 1, complete: true, score: 0.5, stories_with_miss: 1,
        misses: [{ job_number: 'ZZTEST-401', text: 'Previous sample miss', why: 'Previous reason' }] }
    };
    const window = { weeklyCheckEnabled: () => true, opsFetch: async () => fixture };
    const document = { querySelectorAll: () => [nav], getElementById: () => ({}), head: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../../modules/ops-weekly-check.js'), 'utf8'), { window, document });
    await window.WeeklyCheck.mount(root);
    assert.match(root.innerHTML, /ZZTEST-401/);
    assert.match(root.innerHTML, /This week: 50.0%/);
    assert.match(root.innerHTML, /Previous sample miss/);
    assert.equal(nav.style.display, '');

    window.opsFetch = async () => {
      if (failure === 'malformed') return {};
      throw Object.assign(new Error('Read failed'), typeof failure === 'number' ? { status: failure } : {});
    };
    await window.WeeklyCheck.refresh();
    assert.match(root.innerHTML, /Could not load\. Try again\./);
    assert.doesNotMatch(root.innerHTML, /ZZTEST-401|This week:|Previous sample miss|data-save|wc-jobs/);
    assert.equal(nav.style.display, failure === 401 || failure === 403 ? 'none' : '');

    window.opsFetch = async () => ({ ...fixture, jobs: [{ ...fixture.jobs[0], story: [], notes: [], marks: [], missing: [] }] });
    await window.WeeklyCheck.refresh();
    assert.match(root.innerHTML, /ZZTEST-401/);
    assert.doesNotMatch(root.innerHTML, /Could not load\. Try again\./);
    assert.equal(nav.style.display, '');
  });
}
