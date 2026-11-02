// Actual renderer, synthetic page shell. No browser/auth/provider acceptance.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { buildJobDetail, buildJobOverview } = require('../tests/fixtures/job-overview-v2');
const repo = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const source = baseline
  ? cp.execFileSync('git', ['show', 'fe02c2cf:modules/ops-job-overview-v2.js'], { cwd: repo, encoding: 'utf8' })
  : fs.readFileSync(path.join(repo, 'modules/ops-job-overview-v2.js'), 'utf8');
const now = Date.parse('2026-10-30T17:45:00Z');
const reference = '7e200000-0000-0000-0000-000000000009';
const sample = {
  disputed: [{ key: 'claim:damage', what: 'Customer reports damage remains unresolved', status: 'disputed', disputed_at: null, since: '2026-10-20T08:00:00Z', customer_reported: true,
    cites: [{ t: 'business_events', id: reference, excerpt: 'PROTECTED_TRANSCRIPT_WORDS' }] }],
  settled: [
    { key: 'visit:sunday', what: 'Sunday visit was declined', status: 'declined', closed_at: '2026-10-25T02:00:00Z' },
    { key: 'booking:old', what: 'Earlier booking was replaced', status: 'superseded', closed_at: null },
    { key: 'request:document', what: 'Document request marked closed', status: 'closed', closed_at: '2026-10-26T02:00:00Z' },
  ],
};
function render(delta) {
  const el = { innerHTML: '', addEventListener() {} };
  const detail = buildJobDetail({ now }), ov = buildJobOverview({ now });
  Object.assign(ov.story, delta);
  const before = JSON.stringify(ov);
  const ctx = { console, Intl, URLSearchParams, Date, setTimeout() {}, clearTimeout() {},
    document: { getElementById(id) { return id === 'jdOverview' ? el : id === 'ov2-css' ? {} : null; } },
    location: { search: '?overview=v2' }, localStorage: { getItem() { return null; } },
    opsPost() { throw Error('No writes'); }, opsFetch() { throw Error('No originals access'); }, fetch() { throw Error('No network'); } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  ctx.JobOverviewV2._state.cache[detail.job.id] = { status: 'ok', data: ov, at: now };
  assert.equal(ctx.JobOverviewV2.render(detail), true);
  assert.equal(JSON.stringify(ov), before, 'render must not change notes or obligations');
  return { html: el.innerHTML, history: el.innerHTML.match(/<section[^>]*id="ov2LedgerHistory"[\s\S]*?<\/section>/)?.[0] || '', core: ctx.JobOverviewV2Core, ov };
}
let scenarios = 0;
function test(name, fn) { fn(); scenarios++; console.log('PASS ' + name); }
test('all recorded states and full wording visible, current obligations preserved', () => {
  const r = render(sample);
  assert.ok(r.history, 'staff must see disputed and historical ledger lists');
  for (const item of [...sample.disputed, ...sample.settled]) assert.ok(r.history.includes(item.what));
  for (const label of ['Disputed', 'Declined', 'Replaced', 'Closed in AI notes']) assert.ok(r.history.includes(label));
  assert.match(r.html, /let us know once the deposit is paid/);
  const before = render({});
  assert.deepEqual(JSON.parse(JSON.stringify(r.core.openItems(r.ov.story, r.ov.story.job, r.ov.notes, now))),
    JSON.parse(JSON.stringify(before.core.openItems(before.ov.story, before.ov.story.job, before.ov.notes, now))));
});
test('source identity retained without transcript excerpts or invented closure date', () => {
  const r = render(sample); assert.match(r.history, new RegExp(reference));
  assert.doesNotMatch(r.history, /PROTECTED_TRANSCRIPT_WORDS|20 Oct/);
  assert.match(r.history, /Status date not recorded/); assert.match(r.history, /Customer-reported claim/);
  assert.match(r.history, /Closed does not prove payment/);
});
test('uncertain job stays explicit', () => {
  const x = structuredClone(sample); x.disputed[0].job_certain = false;
  assert.match(render(x).history, /Job not certain: may belong to another job/);
});
test('missing lists stay unknown, distinct from empty', () => {
  assert.match(render({}).history, /notes were not returned in this read/);
  const h = render({ disputed: [], settled: [] }).history;
  assert.match(h, /No disputed notes were returned/); assert.match(h, /No settled or replaced notes were returned/);
  assert.doesNotMatch(h, /notes were not returned in this read/);
});
test('malformed notes retain an explicit unavailable row', () => {
  const h = render({ disputed: [null, { what: 'Unclassified matter', status: 'open' }], settled: 'bad' }).history;
  assert.match(h, /Note wording unavailable/); assert.match(h, /Note status unavailable/);
  assert.match(h, /Unclassified matter/); assert.match(h, /Settled and replaced notes were not returned/);
});
test('untrusted words and identifiers escaped, no receipt code executed', () => {
  const x = structuredClone(sample); x.disputed[0].what = '<script>alert(1)</script>';
  x.disputed[0].cites[0].id = '<img src=x onerror=alert(1)>';
  const h = render(x).history; assert.doesNotMatch(h, /<script>alert|<img src=x/); assert.match(h, /&lt;script/); assert.match(h, /&lt;img/);
});
test('long obligation and missing sources remain visible', () => {
  const x = structuredClone(sample); x.disputed[0].what = 'Long matter '.repeat(250) + 'FINAL_OBLIGATION'; x.disputed[0].cites = [];
  const h = render(x).history; assert.match(h, /FINAL_OBLIGATION/); assert.match(h, /Source references unavailable/);
});
test('source references deduplicate without copying side-by-side opinions', () => {
  const x = structuredClone(sample); x.disputed[0].closed_by = x.disputed[0].cites;
  x.disputed[0].why = 'UNAPPROVED_SIDE_BY_SIDE_REASON';
  const h = render(x).history; assert.equal(h.split(reference).length - 1, 1); assert.doesNotMatch(h, /UNAPPROVED_SIDE_BY_SIDE_REASON/);
});
const inputIndex = process.argv.indexOf('--story');
if (inputIndex >= 0) test('actual SQL assembled story retained by staff renderer', () => {
  const story = JSON.parse(fs.readFileSync(process.argv[inputIndex + 1], 'utf8'));
  assert.equal(story.settled.length, 3); assert.equal(story.disputed.length, 1);
  const r = render(story);
  for (const item of [...story.settled, ...story.disputed]) assert.ok(r.history.includes(item.what), item.key);
  assert.match(r.html, /Unanswered document promise remains open/);
  assert.doesNotMatch(r.history, /PROTECTED_TRANSCRIPT_WORDS/);
  const out = process.argv.indexOf('--html');
  if (out >= 0) fs.writeFileSync(process.argv[out + 1], r.html);
});
console.log(JSON.stringify({ result: 'PASS', scenarios, baseline, limits: 'actual module in synthetic DOM shell; no signed-in browser, independent or production acceptance' }));
