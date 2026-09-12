const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace, clone } = require('./workspace-harness.cjs');

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

test('reply drafts use captured outbound recipients and inbound senders', async () => {
  const outbound = await workspace();
  outbound.records.a.communications = [{
    id: 'sent-po',
    job_id: 'a',
    direction: 'sent',
    subject: 'PO 123',
    to_email: 'supplier@example.test',
    cc_email: 'qs@example.test,accounts@example.test',
    from_email: 'ops@example.test',
    sender: 'SecureWorks Ops',
    mailbox: 'ops@example.test',
    body_text: 'Sent PO body'
  }];
  await outbound.core.load('a');
  await outbound.click('tab', 'email');
  await outbound.click('mail', 'sent-po');
  await outbound.click('reply-mail');
  const outboundDraftKey = [...outbound.core.state.editors.get('a').keys()].find(key => key.startsWith('draft:'));
  assert.deepEqual(outbound.core.editor('a', outboundDraftKey).to, ['supplier@example.test']);
  assert.deepEqual(outbound.core.editor('a', outboundDraftKey).cc, ['qs@example.test', 'accounts@example.test']);
  assert.equal(outbound.core.editor('a', outboundDraftKey).sender, 'ops@example.test');

  const inbound = await workspace();
  inbound.records.a.communications = [{
    id: 'inbound-po',
    job_id: 'a',
    direction: 'received',
    subject: 'Question about PO',
    to_email: 'ops@example.test',
    from_email: 'fallback@example.test',
    sender: 'supplier-inbound@example.test',
    mailbox: 'ops@example.test',
    body_text: 'Supplier question'
  }];
  await inbound.core.load('a');
  await inbound.click('tab', 'email');
  await inbound.click('mail', 'inbound-po');
  await inbound.click('reply-mail');
  const inboundDraftKey = [...inbound.core.state.editors.get('a').keys()].find(key => key.startsWith('draft:'));
  assert.deepEqual(inbound.core.editor('a', inboundDraftKey).to, ['supplier-inbound@example.test']);
  assert.equal(inbound.core.editor('a', inboundDraftKey).sender, 'ops@example.test');
});

test('past-job mail cannot carry recipients into the selected job', async () => {
  const ui = await workspace();
  ui.records.a.communications = [{ id: 'foreign', job_id: 'b', direction: 'sent', to_email: 'foreign@example.test', cc_email: 'foreign-copy@example.test', body_text: 'Original job B message' }];
  await ui.core.load('a');
  await ui.click('tab', 'email');
  await ui.click('mail', 'foreign');
  await ui.click('reply-mail');
  assert.match(ui.host.innerHTML, /Open the original job to reply/);
  await ui.click('new-draft');
  const key = [...ui.core.state.editors.get('a').keys()].find(key => key.startsWith('draft:'));
  assert.deepEqual(ui.core.editor('a', key).to, []);
  assert.deepEqual(ui.core.editor('a', key).cc, []);
  assert.equal(ui.commands.length, 0);
});

test('captured mail prefers parsed full HTML over snippets and keeps text precedence', async () => {
  const parsed = [];
  class BodyParser {
    parseFromString(html, type) {
      parsed.push({ html, type });
      return { querySelectorAll: () => [], body: { textContent: 'Full body line\nSecond & complete' } };
    }
  }
  const ui = await workspace({ globals: { DOMParser: BodyParser } });
  ui.records.a.communications = [
    {
      id: 'html-mail',
      job_id: 'a',
      subject: 'HTML full body',
      mailbox: 'ops@example.test',
      body_html: '<p>Full body line</p><p>Second &amp; complete</p>',
      snippet: 'Short snippet only'
    },
    {
      id: 'text-mail',
      job_id: 'a',
      subject: 'Text wins',
      mailbox: 'ops@example.test',
      body_text: 'Authoritative text body',
      body_html: '<p>HTML body</p>',
      snippet: 'Snippet body'
    }
  ];
  await ui.core.load('a');
  await ui.click('tab', 'email');
  await ui.click('mail', 'html-mail');
  assert.match(ui.host.innerHTML, /Full body line/);
  assert.match(ui.host.innerHTML, /Second &amp; complete/);
  assert.doesNotMatch(ui.host.innerHTML, /Short snippet only/);
  assert.ok(parsed.length > 0);
  assert.equal(parsed[0].html, ui.records.a.communications[0].body_html);
  assert.equal(parsed[0].type, 'text/html');
  const parsedBeforeText = parsed.length;
  await ui.click('mail', 'text-mail');
  assert.match(ui.host.innerHTML, /Authoritative text body/);
  assert.doesNotMatch(ui.host.innerHTML, /HTML body|Snippet body/);
  assert.equal(parsed.length, parsedBeforeText);
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
  assert.deepEqual(ui.commands[0].payload, { id: 'receipt-a', new_id: ui.commands[0].payload.new_id, quantity: 2.5, location: 'site', evidence: values.evidence });
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
