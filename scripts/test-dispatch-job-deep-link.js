// Executes the shipped routing functions with local navigation stand-ins only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('ops.html', 'utf8');
const routes = source.slice(source.indexOf('// <dispatch-job-deep-link>'), source.indexOf('var _searchTimer = null;'));
const jobId = '00000000-0000-4000-8000-000000000001';

function boot(hash, options = {}) {
  const events = [];
  const sandbox = {
    window: { location: { hash } },
    OpsDispatch: { openJob(id) { events.push(['open', id]); } },
    showView(view) { events.push(['view', view]); sandbox.window.location.hash = '#' + view; },
    showToast(message) { events.push(['error', message]); },
    history: { replaceState(_state, _title, url) { sandbox.window.location.hash = url; } },
    setTimeout(fn) { fn(); },
    openJobDetailByRef(ref) { events.push(['detail', ref]); },
  };
  if (options.missingModule) delete sandbox.OpsDispatch;
  if (options.v1) sandbox.window.__swDispatchVersion = "v1";
  vm.runInNewContext(routes, sandbox);
  sandbox.restoreTab();
  return { sandbox, events };
}

const opened = boot('#dispatch/' + jobId);
assert.deepEqual(opened.events, [['open', jobId], ['view', 'dispatch']]);
assert.equal(opened.sandbox.window.location.hash, '#dispatch/' + jobId);
opened.sandbox.restoreTab();
assert.deepEqual(opened.events.slice(2), [['open', jobId], ['view', 'dispatch']]);

for (const hash of ['#dispatch/%ZZ', '#dispatch/', '#dispatch/not-a-job', '#dispatch/' + jobId + '/other']) {
  const bad = boot(hash);
  assert.deepEqual(bad.events, [['view', 'dispatch'], ['error', 'This Dispatch job link is invalid.']]);
}
assert.deepEqual(boot('#booking').events, [['view', 'booking']]);
assert.deepEqual(boot('#job/DEMO-ONLY').events, [['view', 'jobs'], ['detail', 'DEMO-ONLY']]);
console.log('PASS: Dispatch job link opens before list load, survives refresh, rejects 4 malformed links, and preserves booking/job routes. No network or sends.');

for (const options of [{ missingModule: true }, { v1: true }]) {
  const refused = boot('#dispatch/' + jobId, options);
  assert.equal(refused.events[0][0], 'view');
  assert.equal(refused.events[0][1], 'jobs');
  assert.equal(refused.events[1][0], 'error');
}

// Run the real Dispatch module and its selection state with DOM/network stand-ins.
const dispatchSource = fs.readFileSync('modules/ops-dispatch.js', 'utf8');
const dispatchStore = {};
const dispatch = { document: { getElementById: () => null, querySelector: () => null },
  localStorage: { getItem: () => null, setItem() {} },
  sessionStorage: { getItem: key => dispatchStore[key], setItem: (key, value) => { dispatchStore[key] = value; } },
  opsFetch: () => Promise.resolve({}), setTimeout, clearTimeout,
};
dispatch.window = dispatch;
// Expose existing functions inside the closure solely to execute this local check.
vm.runInNewContext(dispatchSource.replace('global.OpsDispatch = {',
  'global.dispatchCheck = { state: state, adopt: adoptSelection, html: workspaceHtml }; global.OpsDispatch = {'), dispatch);
const actual = dispatch.dispatchCheck;
actual.state.base.status = 'ok';
actual.state.base.rows = [{ id: 'different-job', type: 'patio', status: 'order_materials' }];
dispatch.OpsDispatch.openJob(jobId);
actual.adopt();
assert.equal(actual.state.jobId, null);
assert.equal(actual.state.row, null);
assert.match(actual.html(), /This job is not in Dispatch/);
actual.state.base.rows = [];
actual.adopt();
assert.equal(actual.state.jobId, null);
assert.match(actual.html(), /This job is not in Dispatch/);
console.log('PASS: Real Dispatch selection never substitutes another job or orders when requested job is absent; missing module and v1 links refuse plainly.');

actual.state.base.rows = [{ id: jobId, type: 'patio', status: 'order_materials', job_number: 'DEMO-ONLY' }];
actual.adopt();
assert.equal(actual.state.jobId, jobId);
assert.equal(actual.state.row.id, jobId);
console.log('PASS: Real Dispatch selection adopts the exact requested job once its accepted row arrives.');
