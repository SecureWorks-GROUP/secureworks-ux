const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace } = require('./workspace-harness.cjs');

test('selecting a job opens the workshop without an AI plan', async () => {
  const ui = await workspace();
  await ui.click('select', 'a');
  assert.match(ui.host.innerHTML, /data-workshop="job"/);
  assert.match(ui.host.innerHTML, /data-workshop="grounding"/);
  assert.match(ui.host.innerHTML, /Job workshop/);
  assert.match(ui.host.innerHTML, /AI suggestions are future scope/);
  assert.match(ui.host.innerHTML, /optional-ai/);
  assert.match(ui.host.innerHTML, /This workshop does not require an AI plan/);
  assert.match(ui.host.innerHTML, /Job history/);
  assert.doesNotMatch(ui.host.innerHTML, /Needs assessment/);
  assert.match(ui.host.innerHTML, /Evidence refresh is a source reload, not an AI assessment/);
});

test('workshop shows missing extraction honestly and keeps a working note across evidence refresh', async () => {
  const ui = await workspace();
  await ui.click('select', 'a');
  assert.match(ui.host.innerHTML, /Missing extraction/);
  assert.match(ui.host.innerHTML, /Manual workshop still works/);
  await ui.click('tab', 'notes');
  ui.input('note', { text: 'Keep this Shaun note' }, 'note');
  await ui.click('refresh');
  await ui.click('tab', 'notes');
  assert.match(ui.host.innerHTML, /Keep this Shaun note/);
});

test('job history is whole-job by default; PO filter is optional', async () => {
  const ui = await workspace();
  ui.records.a.purchase_orders = [
    { id: 'po-a', po_number: 'PO-1', supplier_name: 'Supplier A', line_items: [] },
    { id: 'po-b', po_number: 'PO-2', supplier_name: 'Supplier B', line_items: [] }
  ];
  await ui.click('select', 'a');
  assert.match(ui.host.innerHTML, /Whole job history/);
  assert.match(ui.host.innerHTML, /PO-1/);
  assert.match(ui.host.innerHTML, /PO-2/);
  assert.match(ui.host.innerHTML, /data-filter="mail-po"/);
});
