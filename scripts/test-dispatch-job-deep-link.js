// Executes the shipped routing functions with local navigation stand-ins only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('ops.html', 'utf8');
const routes = source.slice(source.indexOf('// <dispatch-job-deep-link>'), source.indexOf('var _searchTimer = null;'));
const jobId = '00000000-0000-4000-8000-000000000001';

function boot(hash) {
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
