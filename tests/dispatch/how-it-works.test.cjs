const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { workspace } = require('./workspace-harness.cjs');

const contract = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../modules/ops-how-it-works-contract.json'), 'utf8'));
const source = fs.readFileSync(path.resolve(__dirname, '../../modules/ops-how-it-works.js'), 'utf8');

function overlayHost() {
  const host = {
    id: 'opsHowItWorks', className: '', hidden: true, innerHTML: '', dataset: {}, isConnected: true,
    addEventListener() {},
    querySelector() { return { focus() {} }; }
  };
  return host;
}

test('How it works contract names all five workflows and does not claim the Dispatch worker is running', () => {
  assert.equal(contract.definition_version, 'ops-how-it-works/v1');
  assert.deepEqual(Object.keys(contract.workflows).sort(), ['booking', 'debt', 'dispatch', 'performance', 'ses']);
  assert.match(contract.workflows.dispatch.technical.cloud, /enabled:false|disabled/i);
  assert.equal(contract.workflows.booking.definition_status, 'pending_domain_owner');
  assert.equal(contract.workflows.performance.definition_status, 'pending_domain_owner');
  assert.equal(contract.workflows.debt.definition_status, 'pending_domain_owner');
  assert.equal(contract.workflows.ses.definition_status, 'pending_domain_owner');
});

test('Dispatch How it works overlay reads live workflow status and keeps the selected job', async () => {
  const host = overlayHost();
  const ui = await workspace({
    hostIdentity: { id: 'operator-a', org_id: 'org-a' },
    get: async action => action === 'dispatch_workflow' ? {
      workflow: 'dispatch',
      definition_version: 'dispatch-workflow/v1',
      live_actions_enabled: false,
      worker: { intended_enabled: false, observed_enabled: false, schedule_installed: false, mismatch: false, manual_command: 'bash scripts/dispatch/run-dispatch-worker.sh --once' },
      latest_task: null,
      coverage: { tasks_complete: true, source_failures_complete: true }
    } : undefined
  });
  const selected = ui.core.state.selectedId;
  Object.assign(ui.context, {
    OPS_HOW_IT_WORKS_CONTRACT: contract,
    fetch: async () => ({ json: async () => contract })
  });
  ui.document.body = { appendChild(node) { return node; } };
  ui.document.createElement = () => host;
  ui.document.getElementById = id => id === 'opsHowItWorks' ? host : id === 'dispatchRoot' ? ui.host : null;
  vm.runInContext(source, ui.context);
  await ui.context.OpsHowItWorks.open('dispatch');
  assert.equal(ui.core.state.selectedId, selected);
  assert.match(ui.host.innerHTML, /Dispatch/);
  assert.match(host.innerHTML, /How Dispatch works/);
  assert.match(host.innerHTML, /disabled/);
  assert.doesNotMatch(host.innerHTML, /DISPATCH_WORKER_TOKEN|worker is running/);
  ui.identity(null);
  assert.equal(host.hidden, true);
});

test('How it works reports unread runtime for Booking without inventing a runner', async () => {
  const host = overlayHost();
  const context = {
    console,
    document: {
      addEventListener() {},
      getElementById: () => host,
      createElement: () => host,
      body: { appendChild(node) { return node; } },
      documentElement: {},
      activeElement: null
    },
    fetch: async () => ({ json: async () => contract }),
    OPS_HOW_IT_WORKS_CONTRACT: contract,
    opsFetch: async () => { throw new Error('unexpected live read'); },
    addEventListener() {},
    SW_AUTH_GATE: { identity: () => ({ id: 'operator-a', org_id: 'org-a' }) }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  await context.OpsHowItWorks.open('booking');
  assert.match(host.innerHTML, /How Sales Booking works/);
  assert.match(host.innerHTML, /pending|unread|Patio/i);
  assert.doesNotMatch(host.innerHTML, /worker is running/i);
});
