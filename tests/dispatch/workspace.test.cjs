const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const DispatchCore = require('../../modules/ops-dispatch-core.js');

const clone = value => JSON.parse(JSON.stringify(value));
const record = id => ({
  job: { id, job_number: `FIX-${id}`, work_type: 'fencing', eligibility: { state: 'accepted' } },
  version: 0, source_version: 'source-1', groups: [], requirements: [], drafts: [], notes: [],
  allocations: [], receipts: [], purchase_orders: [], movements: [], media: [], communications: []
});
class FormValues {
  constructor(form) { this.entries = Object.entries(form.values); }
  get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
  getAll(name) { return this.entries.filter(([key]) => key === name).flatMap(([, value]) => value); }
  [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
}
async function workspace() {
  const listeners = new Map(), records = { a: record('a'), b: record('b') }, commands = [], lots = [];
  const host = {
    innerHTML: '', classList: { add() {} }, contains: node => !!node,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener: (type, listener) => listeners.set(type, listener)
  };
  let count = 0, pendingSave;
  const core = DispatchCore.create({
    id: () => `fixture-${++count}`,
    get: async (action, params) => {
      if (action === 'dispatch_list') return { jobs: Object.values(records).map(r => r.job), coverage: { complete: true } };
      if (action === 'dispatch_job') return clone(records[params.job_id]);
      if (action === 'dispatch_calendar') return { events: [], undated: [], coverage: { complete: true } };
      if (action === 'dispatch_execution') return { actions: [], capabilities: { release_hold: true } };
      if (action === 'dispatch_supply') return { supply_lots: lots.filter(lot => lot.supply_kind === params.kind), coverage: { complete: true } };
      throw new Error(`Unexpected fixture read: ${action}`);
    },
    post: async (action, envelope) => {
      commands.push(clone({ action, ...envelope }));
      if (pendingSave) await pendingSave;
      const current = records[envelope.job_id];
      if (envelope.command === 'group_upsert') current.groups.push(clone(envelope.payload));
      current.version++;
      return clone(current);
    }
  });
  const context = vm.createContext({ DispatchCore, document: { activeElement: null }, FormData: FormValues, URL, innerWidth: 1200 });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../modules/ops-dispatch.js'), 'utf8'), context);
  const app = context.DispatchOps.mount(host, { core, now: new Date('2026-09-14T04:00:00Z') });
  await app.load();
  return {
    app, core, host, records, commands, lots,
    hold() { let release; pendingSave = new Promise(resolve => { release = resolve; }); return () => { pendingSave = null; release(); }; },
    click(action, id) {
      const target = { dataset: { action, id }, closest: selector => selector === '[data-action]' ? target : null };
      return listeners.get('click')({ target, preventDefault() {} });
    },
    input(kind, values, editor) {
      const form = { dataset: { form: kind }, values };
      const target = { dataset: editor ? { editor } : {}, form, closest: () => form };
      return listeners.get('input')({ target });
    },
    submit(kind, values) {
      return listeners.get('submit')({ target: { dataset: { form: kind }, values }, preventDefault() {} });
    }
  };
}

for (const switchAway of [false, true]) {
  test(`older group save preserves a replacement editor${switchAway ? ' across a job switch' : ''}`, async () => {
    const ui = await workspace();
    await ui.click('add-group');
    ui.input('group', { name: 'First order group' });
    const release = ui.hold();
    const save = ui.submit('group', { name: 'First order group' });
    await ui.click('add-requirement');
    ui.input('requirement', { description: 'New requirement while saving', quantity: '2.5', unit: 'each' });
    if (switchAway) await ui.click('select', 'b');
    release();
    await save;
    if (switchAway) await ui.click('select', 'a');
    assert.match(ui.host.innerHTML, /name="description" value="New requirement while saving"/);
    assert.match(ui.host.innerHTML, /name="quantity"[^>]*value="2.5"/);
    assert.equal(ui.records.a.groups[0].name, 'First order group');
    await ui.click('select', 'b');
    await ui.click('select', 'a');
    assert.match(ui.host.innerHTML, /name="description" value="New requirement while saving"/);
  });
}

test('typing in the submitted form remains editable after its earlier values save', async () => {
  const ui = await workspace();
  await ui.click('add-group');
  ui.input('group', { name: 'Earlier name' });
  const release = ui.hold();
  const save = ui.submit('group', { name: 'Earlier name' });
  ui.input('group', { name: 'Later name' });
  release();
  await save;
  assert.match(ui.host.innerHTML, /name="name" value="Later name"/);
  assert.equal(ui.records.a.groups[0].name, 'Earlier name');
});

const mail = body => ({ sender: 'ops@example.test', to: 'supplier@example.test', cc: 'copy@example.test', subject: 'Human subject', body, proposed_delivery_at: '' });
test('History and Compose recover the exact unsaved draft and isolate each job', async () => {
  const ui = await workspace();
  await ui.click('tab', 'email');
  await ui.click('new-draft');
  const aKey = [...ui.core.state.editors.get('a').keys()].find(key => key.startsWith('draft:'));
  const body = 'Keep every line\nEven <brackets> & "quotes".';
  ui.input('draft', mail(body), 'draft');
  const original = clone(ui.core.editor('a', aKey));
  await ui.click('close-draft');
  assert.match(ui.host.innerHTML, new RegExp(`data-action="open-draft" data-id="${original.id}"`));
  assert.match(ui.host.innerHTML, /Unsaved Dispatch edits/);
  await ui.click('new-draft');
  assert.deepEqual(clone(ui.core.editor('a', aKey)), original);
  assert.equal([...ui.core.state.editors.get('a').keys()].filter(key => key.startsWith('draft:')).length, 1);
  assert.match(ui.host.innerHTML, /Keep every line\nEven &lt;brackets&gt; &amp; &quot;quotes&quot;\./);
  await ui.click('close-draft');
  await ui.click('select', 'b');
  await ui.click('new-draft');
  ui.input('draft', mail('Separate job B draft'), 'draft');
  await ui.click('close-draft');
  await ui.click('select', 'a');
  assert.doesNotMatch(ui.host.innerHTML, /Separate job B draft/);
  await ui.click('open-draft', original.id);
  assert.deepEqual(clone(ui.core.editor('a', aKey)), original);
  assert.match(ui.host.innerHTML, /Keep every line\nEven &lt;brackets&gt;/);
  await ui.click('select', 'b');
  await ui.click('new-draft');
  assert.match(ui.host.innerHTML, /Separate job B draft/);
  assert.equal(ui.commands.length, 0);
});

async function withReceipt() {
  const ui = await workspace();
  ui.records.a.requirements = [{ id: 'requirement-a', description: 'Custom fence panels', quantity: 8, unit: 'each' }];
  ui.records.a.allocations = [{ id: 'allocation-a', requirement_id: 'requirement-a', quantity: 8, unit: 'each' }];
  ui.records.a.receipts = [{ id: 'receipt-a', allocation_id: 'allocation-a', usable_quantity: 5, damaged_quantity: 3, location: 'yard', evidence: 'Counted at yard' }];
  await ui.core.load('a');
  return ui;
}
test('receipt identifies its requirement and chosen partial transfer survives rerenders and job switches', async () => {
  const ui = await withReceipt();
  assert.match(ui.host.innerHTML, /<strong>Custom fence panels<\/strong><p>5 usable · 3 damaged · yard<\/p>/);
  await ui.click('transfer-receipt', 'receipt-a');
  assert.match(ui.host.innerHTML, /Usable quantity to transfer<input name="quantity"[^>]*max="5"[^>]*required/);
  const values = { quantity: '2.5', location: 'site', evidence: 'Delivered and checked 2.5 panels' };
  ui.input('transfer', values);
  ui.core.setLayer('staff', false);
  await ui.click('select', 'b');
  await ui.click('select', 'a');
  assert.match(ui.host.innerHTML, /name="quantity"[^>]*value="2.5"/);
  assert.match(ui.host.innerHTML, /name="location" value="site"/);
  await ui.submit('transfer', values);
  assert.equal(ui.commands.length, 1);
  assert.equal(ui.commands[0].command, 'receipt_transfer');
  assert.deepEqual(ui.commands[0].payload, { id: 'receipt-a', quantity: 2.5, location: 'site', evidence: values.evidence });
});

for (const quantity of ['', '0', '-1', '5.01', 'NaN', 'Infinity']) {
  test(`invalid transfer quantity ${JSON.stringify(quantity)} never reaches a write`, async () => {
    const ui = await withReceipt();
    await ui.click('transfer-receipt', 'receipt-a');
    const values = { quantity, location: 'site', evidence: 'Receipt evidence' };
    ui.input('transfer', values);
    await ui.submit('transfer', values);
    assert.equal(ui.commands.length, 0);
    assert.match(ui.host.innerHTML, /positive transfer quantity no greater than the recorded usable amount/);
    assert.match(ui.host.innerHTML, /name="location" value="site"/);
  });
}

test('transfer validates against the latest receipt without dropping entered quantity', async () => {
  const ui = await withReceipt();
  await ui.click('transfer-receipt', 'receipt-a');
  const values = { quantity: '3', location: 'site', evidence: 'Verified movement' };
  ui.input('transfer', values);
  ui.records.a.receipts[0].usable_quantity = 2;
  await ui.core.load('a');
  assert.match(ui.host.innerHTML, /name="quantity"[^>]*max="2"[^>]*value="3"/);
  await ui.submit('transfer', values);
  assert.equal(ui.commands.length, 0);
});

test('global supply choices show recorded quantity and original provenance with source description fallback', async () => {
  const ui = await workspace();
  ui.lots.push(
    { id: 'lot-po', supply_kind: 'po', job_id: 'current-job', quantity: 7, unit: 'each', source_ref: { description: 'Original custom brackets', location: 'supplier depot', job_id: 'original-job', po_id: 'PO-original' } },
    { id: 'lot-stock', supply_kind: 'stock', description: 'Counted fence posts', quantity: 4, unit: 'each', location: 'north yard', job_id: 'stock-job', po_id: 'PO-stock', source_ref: { description: 'Older description' } }
  );
  await ui.click('add-allocation');
  assert.match(ui.host.innerHTML, />Original custom brackets · 7 each recorded · Original location: supplier depot · Original job: original-job · PO: PO-original<\/option>/);
  assert.match(ui.host.innerHTML, />Counted fence posts · 4 each recorded · Original location: north yard · Original job: stock-job · PO: PO-stock<\/option>/);
  assert.doesNotMatch(ui.host.innerHTML, /7 each available|4 each available/);
  assert.equal(ui.commands.length, 0);
});

for (const quantity of ['5', '0.0000001']) {
  test(`positive transfer quantity ${quantity} within the recorded amount is accepted`, async () => {
    const ui = await withReceipt();
    await ui.click('transfer-receipt', 'receipt-a');
    const values = { quantity, location: 'site', evidence: 'Verified movement' };
    ui.input('transfer', values);
    await ui.submit('transfer', values);
    assert.equal(ui.commands.length, 1);
    assert.equal(ui.commands[0].payload.quantity, Number(quantity));
  });
}
