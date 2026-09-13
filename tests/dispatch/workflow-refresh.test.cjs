const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../modules/ops-workflow-refresh.js'), 'utf8');

function loadRefresh(opsPost) {
  const context = { opsPost };
  context.window = context;
  vm.runInNewContext(source, context);
  return context.OpsWorkflowRefresh;
}

test('Workflow Refresh displays failed transport status with escaped reason', async () => {
  const refresh = loadRefresh(async () => {
    const error = new Error('HTTP 500 <script>alert("x")</script>');
    error.status = 500;
    throw error;
  });
  const run = await refresh.start('dispatch', { job_id: 'job-a' });
  assert.equal(run.capability, 'failed');
  assert.equal(refresh.label(run), 'Workflow Refresh failed: HTTP 500 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;.');
  const html = refresh.html('dispatch', run);
  assert.match(html, /Workflow Refresh failed:/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('Workflow Refresh pending reasons are escaped in rendered status', () => {
  const refresh = loadRefresh();
  const html = refresh.html('dispatch', { capability: 'pending', reason: '<b>waiting</b>' });
  assert.match(html, /&lt;b&gt;waiting&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>waiting<\/b>/);
});
