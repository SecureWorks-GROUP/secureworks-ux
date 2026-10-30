// Actual shipped module, synthetic page shell, captured failure metadata only.
// No browser/auth/network or live rewrite; not signed-in staff acceptance.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { buildJobDetail, buildJobOverview } = require('../tests/fixtures/job-overview-v2');
const baseline = process.argv.includes('--baseline');
const source = baseline
  ? cp.execFileSync('git', ['show', '6b0a93b4:modules/ops-job-overview-v2.js'], { encoding: 'utf8' })
  : fs.readFileSync('modules/ops-job-overview-v2.js', 'utf8');
const now = Date.parse('2026-10-30T15:16:36.118192Z');
// From the read-only context_job_story_text_get receipt at that time, both jobs.
const failureTimes = ['2026-10-30T10:00:49.786325+00:00', '2026-10-14T05:53:51.829408+00:00'];
function render(raw, asked) {
  const el = { innerHTML: '', addEventListener() {} };
  const detail = buildJobDetail({ now });
  const ov = buildJobOverview({ now });
  ov.story_text = raw;
  const before = JSON.stringify(ov);
  const ctx = { console, Intl, URLSearchParams, Date, setTimeout() {}, clearTimeout() {},
    document: { getElementById(id) { return id === 'jdOverview' ? el : id === 'ov2-css' ? {} : null; } },
    location: { search: '?overview=v2' }, localStorage: { getItem() { return null; } },
    opsPost() { throw new Error('Rendering must never request a rewrite or send'); },
    fetch() { throw new Error('Rendering must not call a provider'); }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx.JobOverviewV2._state.cache[detail.job.id] = { status: 'ok', data: ov, at: now };
  assert.equal(ctx.JobOverviewV2.render(detail), true, 'actual page renderer succeeds');
  if (asked) {
    ctx.JobOverviewV2._state.ui[detail.job.id].asked = asked;
    assert.equal(ctx.JobOverviewV2.render(detail), true);
  }
  assert.equal(JSON.stringify(ov), before, 'render leaves source data untouched');
  return el.innerHTML;
}
function failed(at = failureTimes[0]) {
  return { status: 'none', writer: { on: true, open_request: null,
    last_failure: { at, error: 'fact_check_failed' } } };
}
for (const at of failureTimes) {
  const h = render(failed(at));
  assert.match(h, /id="ov2WriterFailure"/, 'captured failure must be visible');
  assert.match(h, /did not pass its source checks/);
  assert.match(h, /No replacement story was saved/);
  assert.match(h, /No rewrite is queued/);
  assert.match(h, /id="ov2Rewrite"/, 'existing manual action stays available');
  assert.match(h, /This card comes from the job records/);
}
const oldAsk = { at: Date.parse('2026-10-30T09:56:47.173607Z'), ok: true, words: 'Queued.' };
const afterFailure = render(failed(), oldAsk);
assert.doesNotMatch(afterFailure, /id="ov2Asked"/, 'terminal server failure supersedes old local Asked');
assert.match(afterFailure, /id="ov2Rewrite"/);
const pending = failed();
pending.writer.open_request = { id: 'new-request' };
const waiting = render(pending, oldAsk);
assert.match(waiting, /A rewrite has been asked for/);
assert.doesNotMatch(waiting, /No rewrite is queued|id="ov2Rewrite"/);
const newAsk = { ...oldAsk, at: Date.parse('2026-10-30T11:00:00Z') };
assert.match(render(failed(), newAsk), /Asked at/, 'old failure does not erase a newer request');
const previous = failed();
previous.status = 'stale';
previous.text = { sections: { headline: 'Previous source-linked story.' }, written_at: '2026-10-30T09:00:00Z' };
const stale = render(previous);
assert.match(stale, /Previous source-linked story/);
assert.match(stale, /id="ov2WriterFailure"/);
assert.doesNotMatch(stale, /rewritten when something new happens/, 'no unproven automatic-update promise');
const recovered = structuredClone(previous);
recovered.status = 'fresh';
recovered.text.written_at = '2026-10-30T11:00:00Z';
const success = render(recovered, oldAsk);
assert.doesNotMatch(success, /id="ov2WriterFailure"|id="ov2Asked"/,
  'new saved story supersedes historical failure and local request');
const off = failed(); off.writer.on = false;
assert.doesNotMatch(render(off), /id="ov2Rewrite"/);
assert.match(render(off), /id="ov2WriterOff"/);
const unknown = failed('not-a-date'); unknown.writer.last_failure.error = '<script>secret-provider-detail</script>';
const safe = render(unknown);
assert.match(safe, /last rewrite failed/i);
assert.doesNotMatch(safe, /secret-provider-detail|Invalid Date/);
assert.doesNotMatch(render({ status: 'none', writer: { on: true, open_request: null } }), /id="ov2WriterFailure"/);
console.log(JSON.stringify({ result: 'PASS', scenarios: 10, baseline,
  limits: 'actual module renderer in synthetic DOM shell; captured failure metadata; no browser/staff/production acceptance' }));
