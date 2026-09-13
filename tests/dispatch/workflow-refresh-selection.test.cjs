const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { workspace, clone } = require('./workspace-harness.cjs');
const operator = { id: 'operator-a', org_id: 'org-a' };

function refreshDriver(calls) {
  return {
    html: () => '<button data-action="workflow-refresh">Workflow Refresh</button>',
    start: async (workflow, scope) => { calls.push({ workflow, scope: clone(scope) }); return { capability: 'unavailable' }; }
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
  const ui = await workflowWorkspace(async () => ({ outcome: 'unavailable', reason: 'driver_not_registered' }));
  await ui.click('select', 'b');
  await ui.click('workflow-refresh');
  assert.deepEqual(ui.workflowCalls, [{ action: 'workflow_refresh', op: 'start', workflow: 'dispatch', scope: { job_id: 'b' } }]);
  assert.match(ui.host.innerHTML, /Workflow Refresh unavailable/);
  assert.equal(ui.commands.length, 0);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function workflowWorkspace(post) {
  const ui = await workspace({ hostIdentity: operator });
  const calls = [];
  ui.context.opsPost = async (action, body, options) => {
    options?.assertIdentity?.();
    calls.push(clone({ action, ...body }));
    return post(body);
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../modules/ops-workflow-refresh.js'), 'utf8'), ui.context);
  ui.app.render();
  return { ...ui, workflowCalls: calls };
}

test('verified selected job displays the result of its guarded run readback', async () => {
  const ui = await workflowWorkspace(async body => body.op === 'start'
    ? { id: 'run-a', status: 'running' }
    : { id: 'run-a', status: 'completed', source_cutoff: '2026-09-13T04:33:06Z' });
  await ui.click('workflow-refresh');
  assert.deepEqual(ui.workflowCalls, [
    { action: 'workflow_refresh', op: 'start', workflow: 'dispatch', scope: { job_id: 'a' } },
    { action: 'workflow_refresh', op: 'readback', id: 'run-a', workflow: 'dispatch' }
  ]);
  assert.match(ui.host.innerHTML, /Workflow Refresh completed · source cutoff 2026-09-13T04:33:06Z/);
  await ui.click('select', 'b');
  assert.doesNotMatch(ui.host.innerHTML, /2026-09-13T04:33:06Z/);
});

test('Refresh result belongs to its job and disappears when identity resets', async () => {
  const ui = await workflowWorkspace(async () => ({ outcome: 'unavailable', reason: 'Private A refresh reason' }));
  await ui.click('workflow-refresh');
  assert.match(ui.host.innerHTML, /Private A refresh reason/);
  await ui.click('select', 'b');
  assert.doesNotMatch(ui.host.innerHTML, /Private A refresh reason/);
  await ui.click('select', 'a');
  assert.match(ui.host.innerHTML, /Private A refresh reason/);
  assert.doesNotMatch(ui.context.OpsWorkflowRefresh.html('dispatch'), /Private A refresh reason/);

  await ui.click('new-draft');
  ui.input('draft', { subject: 'Keep same-identity edits', body: 'Exact wording', purchase_commitment: 'false' }, 'draft');
  ui.identity({ ...operator });
  await ui.app.refresh();
  assert.match(ui.host.innerHTML, /Keep same-identity edits/);
  assert.match(ui.host.innerHTML, /Private A refresh reason/);

  ui.identity(null);
  assert.equal(ui.host.innerHTML, '');
  ui.identity({ id: 'operator-b', org_id: 'org-a' });
  await ui.context.DispatchOps.load();
  assert.doesNotMatch(ui.host.innerHTML, /Private A refresh reason|Keep same-identity edits/);
  assert.match(ui.host.innerHTML, /Workflow Refresh has not been requested/);
});

for (const stage of ['start', 'readback']) {
  for (const boundary of ['job selection', 'operator']) {
    for (const outcome of ['success', 'failure']) {
      test(`late Refresh ${stage} ${outcome} cannot cross ${boundary}`, async () => {
        const pending = deferred(), started = deferred();
        let hold = true;
        const ui = await workflowWorkspace(async body => {
          if (!hold) return { outcome: 'unavailable', reason: 'Current selection refresh' };
          if (body.op === stage) { started.resolve(); return pending.promise; }
          return { id: 'private-a-run', status: 'running' };
        });
        const old = ui.click('workflow-refresh');
        await started.promise;
        if (boundary === 'operator') {
          ui.identity(null);
          ui.identity({ id: 'operator-b', org_id: 'org-a' });
          await ui.context.DispatchOps.load();
        } else {
          await ui.click('select', 'b');
          await ui.click('select', 'a');
        }
        assert.match(ui.host.innerHTML, /Workflow Refresh has not been requested/);
        hold = false;
        await ui.click('workflow-refresh');
        const callsBeforeCompletion = ui.workflowCalls.length;
        if (outcome === 'success') pending.resolve({ id: 'private-a-run', status: 'completed', reason: 'Private A reason', source_cutoff: 'Private A cutoff' });
        else pending.reject(new Error('Private A failure'));
        await old;
        assert.equal(callsBeforeCompletion, stage === 'start' ? 2 : 3);
        assert.equal(ui.workflowCalls.length, callsBeforeCompletion);
        assert.doesNotMatch(ui.host.innerHTML, /Private A|private-a-run/);
        assert.match(ui.host.innerHTML, /Current selection refresh/);
      });
    }
  }
}
