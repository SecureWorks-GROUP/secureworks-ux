const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace, clone } = require('./workspace-harness.cjs');

function refreshDriver(calls) {
  return {
    html: () => '<button data-action="workflow-refresh">Workflow Refresh</button>',
    start: async (workflow, scope) => { calls.push({ workflow, scope: clone(scope) }); return { capability: 'unavailable' }; },
    label: () => 'Workflow Refresh unavailable'
  };
}

test('unselected Workflow Refresh asks for a job while Evidence Refresh still reads the list and calendar', async () => {
  const calls = [];
  const ui = await workspace({
    get: async action => action === 'dispatch_list' ? { jobs: [], coverage: { complete: true } } : undefined,
    globals: { OpsWorkflowRefresh: refreshDriver(calls) }
  });
  assert.equal(ui.core.state.selectedId, null);
  await ui.click('workflow-refresh');
  assert.deepEqual(calls, []);
  assert.match(ui.host.innerHTML, /Choose a job before assessing it\./);
  const before = ui.reads.length;
  await ui.click('refresh');
  assert.ok(ui.reads.slice(before).some(read => read.action === 'dispatch_list'));
  assert.ok(ui.reads.slice(before).some(read => read.action === 'dispatch_calendar'));
  assert.deepEqual(calls, []);
});

test('Workflow Refresh assesses only the selected job', async () => {
  const calls = [];
  const ui = await workspace({ globals: { OpsWorkflowRefresh: refreshDriver(calls) } });
  await ui.click('select', 'b');
  await ui.click('workflow-refresh');
  assert.deepEqual(calls, [{ workflow: 'dispatch', scope: { job_id: 'b' } }]);
  assert.match(ui.host.innerHTML, /Workflow Refresh unavailable/);
  assert.equal(ui.commands.length, 0);
});
