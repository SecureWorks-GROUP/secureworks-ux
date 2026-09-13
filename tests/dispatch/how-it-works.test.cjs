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

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function runtimeResult(jobId, status = 'done') {
  return {
    workflow: 'dispatch',
    definition_version: 'dispatch-workflow/v1',
    live_actions_enabled: false,
    worker: { intended_enabled: false, observed_enabled: false, schedule_installed: false, mismatch: false, manual_command: 'bash scripts/dispatch/run-dispatch-worker.sh --once' },
    latest_task: { status, job_id: jobId },
    coverage: { tasks_complete: true, source_failures_complete: true }
  };
}

function standaloneOverlay({ opsFetch } = {}) {
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
    opsFetch,
    addEventListener() {},
    SW_AUTH_GATE: { identity: () => ({ id: 'operator-a', org_id: 'org-a' }) }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { host, context };
}

test('How it works contract names the five workflow definitions and their current ownership status', () => {
  assert.equal(contract.definition_version, 'ops-how-it-works/v1');
  assert.deepEqual(Object.keys(contract.workflows).sort(), ['booking', 'debt', 'dispatch', 'performance', 'ses']);
  assert.equal(contract.workflows.dispatch.definition_status, 'reviewed_local');
  assert.equal(contract.workflows.booking.definition_status, 'owner_definition_reviewed');
  assert.equal(contract.workflows.performance.definition_status, 'pending_domain_owner');
  assert.equal(contract.workflows.debt.definition_status, 'owner_definition_reviewed');
  assert.ok(contract.workflows.dispatch.runtime_receipt);
  assert.match(contract.workflows.dispatch.runtime_receipt.enabled, /false|disabled|workshop/i);
  assert.match(contract.workflows.dispatch.runtime_receipt.deployed, /dispatch_job_workshop|118b6f9/);
  assert.match(contract.workflows.dispatch.runtime_receipt.observed_successful, /SQL PASS|isolated/i);
  assert.match(contract.workflows.booking.runtime_receipt.deployed, /9dda1c49/);
  assert.match(contract.workflows.booking.runtime_receipt.enabled, /held/);
  assert.doesNotMatch(JSON.stringify(contract.workflows.dispatch.runtime_receipt), /AI assessment/);
  assert.equal(contract.workflows.ses.definition_status, 'pending_domain_owner');
  assert.equal(contract.workflows.dispatch.technical.runtime_action, 'dispatch_workflow');
  assert.equal(contract.workflows.booking.technical.page, 'Sales > Booking');
  assert.equal(contract.workflows.performance.technical.page, 'Sales > Performance');
  assert.equal(contract.workflows.performance.technical.ux_pin, 'bc8514ebb6172ced416162d96a28b77c56ad86fa');
  assert.match(contract.workflows.performance.runtime_receipt.deployed, /bc8514eb/);
  assert.match(contract.workflows.performance.runtime_receipt.observed_successful, /A1=17/);
  assert.doesNotMatch(contract.workflows.performance.runtime_receipt.deployed, /08d27c7b/);
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
  assert.match(host.innerHTML, /<dt>Enabled<\/dt>/);
  assert.match(host.innerHTML, /<dt>Deployed<\/dt>/);
  assert.match(host.innerHTML, /<dt>Observed successful<\/dt>/);
  assert.match(host.innerHTML, /disabled/);
  assert.doesNotMatch(host.innerHTML, /DISPATCH_WORKER_TOKEN|worker is running/);
  ui.identity(null);
  assert.equal(host.hidden, true);
});

test('How it works reports unread runtime for Booking without inventing a runner', async () => {
  let calls = 0;
  const { host, context } = standaloneOverlay({
    opsFetch: async () => { calls++; throw new Error('unexpected live read'); }
  });
  await context.OpsHowItWorks.open('booking');
  assert.match(host.innerHTML, /How Sales Booking works/);
  assert.match(host.innerHTML, /pending|unread|Patio|owner definition reviewed/i);
  assert.doesNotMatch(host.innerHTML, /worker is running/i);
  assert.equal(calls, 0);
});

test('How it works ignores a late Dispatch runtime after switching workflows', async () => {
  const firstRead = deferred();
  const { host, context } = standaloneOverlay({
    opsFetch: async action => {
      assert.equal(action, 'dispatch_workflow');
      return firstRead.promise;
    }
  });
  const dispatchOpen = context.OpsHowItWorks.open('dispatch');
  await Promise.resolve();
  await context.OpsHowItWorks.open('booking');
  firstRead.resolve(runtimeResult('late-dispatch'));
  await dispatchOpen;
  assert.match(host.innerHTML, /How Sales Booking works/);
  assert.doesNotMatch(host.innerHTML, /late-dispatch/);
  assert.doesNotMatch(host.innerHTML, /Last captured task is done/);
});

test('How it works clears completed runtime before painting another open state', async () => {
  const reads = [deferred(), deferred()];
  let index = 0;
  const { host, context } = standaloneOverlay({
    opsFetch: async action => {
      assert.equal(action, 'dispatch_workflow');
      return reads[index++].promise;
    }
  });
  const firstOpen = context.OpsHowItWorks.open('dispatch');
  reads[0].resolve(runtimeResult('old-dispatch'));
  await firstOpen;
  assert.match(host.innerHTML, /old-dispatch/);
  const bookingOpen = context.OpsHowItWorks.open('booking');
  assert.match(host.innerHTML, /How Sales Booking works/);
  assert.doesNotMatch(host.innerHTML, /old-dispatch/);
  await bookingOpen;
  const secondOpen = context.OpsHowItWorks.open('dispatch');
  assert.match(host.innerHTML, /How Dispatch works/);
  assert.doesNotMatch(host.innerHTML, /old-dispatch/);
  reads[1].resolve(runtimeResult('current-dispatch'));
  await secondOpen;
  assert.match(host.innerHTML, /current-dispatch/);
});

test('How it works ignores a stale same-workflow read after close and reopen', async () => {
  const reads = [deferred(), deferred()];
  let index = 0;
  const { host, context } = standaloneOverlay({
    opsFetch: async action => {
      assert.equal(action, 'dispatch_workflow');
      return reads[index++].promise;
    }
  });
  const firstOpen = context.OpsHowItWorks.open('dispatch');
  await Promise.resolve();
  context.OpsHowItWorks.close();
  const secondOpen = context.OpsHowItWorks.open('dispatch');
  await Promise.resolve();
  reads[1].resolve(runtimeResult('fresh-dispatch'));
  await secondOpen;
  assert.match(host.innerHTML, /fresh-dispatch/);
  reads[0].resolve(runtimeResult('stale-dispatch'));
  await firstOpen;
  assert.match(host.innerHTML, /fresh-dispatch/);
  assert.doesNotMatch(host.innerHTML, /stale-dispatch/);
});
