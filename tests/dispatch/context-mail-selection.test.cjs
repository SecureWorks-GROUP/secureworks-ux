const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { workspace, clone } = require('./workspace-harness.cjs');

async function mailWorkspace() {
  const ui = await workspace();
  Object.assign(ui.records.a, {
    groups: [{ id: 'g-panels', name: 'Panels' }, { id: 'g-gates', name: 'Gates' }],
    requirements: [{ id: 'panels', group_id: 'g-panels' }, { id: 'gates', group_id: 'g-gates' }],
    purchase_orders: [
      { id: 'po-panels', po_number: 'PO-101', line_items: [{ dispatch_requirement_id: 'panels' }] },
      { id: 'po-gates', po_number: 'PO-102', line_items: [{ dispatch_requirement_id: 'gates' }] }
    ],
    communications: [{ id: 'job-mail', job_id: 'a', subject: 'Captured job correspondence' }]
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../modules/ops-context-mail.js'), 'utf8'), ui.context);
  const load = ui.context.OpsContextMail.load, selections = [];
  ui.context.OpsContextMail.load = (kind, selection) => { selections.push(clone(selection)); return load(kind, selection); };
  await ui.core.load('a');
  await ui.click('tab', 'email');
  return { ...ui, selections };
}

test('mail history selects either PO with its order group and retains whole-job history', async () => {
  const ui = await mailWorkspace();
  assert.deepEqual(ui.selections.at(-1), { job_id: 'a', job_number: 'FIX-a' });
  assert.match(ui.host.innerHTML, /PO-101 · Panels/);
  assert.match(ui.host.innerHTML, /PO-102 · Gates/);
  await ui.filter('mail-po', 'po-panels');
  assert.deepEqual(ui.selections.at(-1), { job_id: 'a', job_number: 'FIX-a', po_id: 'po-panels', po_number: 'PO-101' });
  assert.match(ui.host.innerHTML, /Selected FIX-a · PO PO-101/);
  await ui.click('new-draft');
  ui.input('draft', { subject: 'Keep my wording', body: 'Exact note', purchase_commitment: 'false' }, 'draft');
  await ui.filter('mail-po', 'po-gates');
  assert.deepEqual(ui.selections.at(-1), { job_id: 'a', job_number: 'FIX-a', po_id: 'po-gates', po_number: 'PO-102' });
  assert.match(ui.host.innerHTML, /Selected FIX-a · PO PO-102/);
  assert.match(ui.host.innerHTML, /Keep my wording/);
  assert.match(ui.host.innerHTML, /Captured job correspondence/);
  await ui.filter('mail-po', '');
  assert.deepEqual(ui.selections.at(-1), { job_id: 'a', job_number: 'FIX-a' });
  assert.match(ui.host.innerHTML, /Whole job history/);
  assert.match(ui.host.innerHTML, /Selected FIX-a · no PO selected/);
  assert.equal(ui.commands.length, 0);
});

test('mail selection survives PO reorder and keeps unavailable PO identity visible', async () => {
  const ui = await mailWorkspace();
  await ui.filter('mail-po', 'po-gates');
  ui.records.a.purchase_orders.reverse();
  await ui.core.load('a');
  assert.match(ui.host.innerHTML, /value="po-gates" selected/);
  ui.records.a.purchase_orders = ui.records.a.purchase_orders.filter(po => po.id !== 'po-gates');
  await ui.core.load('a');
  assert.match(ui.host.innerHTML, /Unavailable PO: po-gates/);
  const reads = ui.selections.length;
  await ui.click('tab', 'email');
  assert.equal(ui.selections.length, reads);
  await ui.filter('mail-po', 'po-panels');
  assert.equal(ui.selections.at(-1).po_id, 'po-panels');
});

test('late PO mail cannot replace the new selection or another job history', async () => {
  const ui = await mailWorkspace();
  const pending = [];
  ui.context.OpsContextMail.load = () => new Promise(resolve => pending.push(resolve));
  const old = ui.filter('mail-po', 'po-panels');
  const latest = ui.filter('mail-po', 'po-gates');
  const result = subject => ({ capability: 'connected', records: [{ subject }], coverage: { complete: false } });
  pending[1](result('Gate supplier history')); await latest;
  pending[0](result('Outdated panel supplier history')); await old;
  assert.match(ui.host.innerHTML, /Gate supplier history/);
  assert.doesNotMatch(ui.host.innerHTML, /Outdated panel supplier history/);
  const priorJob = ui.filter('mail-po', 'po-panels');
  await ui.click('select', 'b');
  pending[2](result('Previous job private history')); await priorJob;
  assert.doesNotMatch(ui.host.innerHTML, /Previous job private history|Gate supplier history/);
  assert.match(ui.host.innerHTML, /Selected FIX-b · no PO selected/);
});
