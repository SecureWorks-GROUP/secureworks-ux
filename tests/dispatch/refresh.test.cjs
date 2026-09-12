const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace, clone } = require('./workspace-harness.cjs');
const mail = (purchase = 'true') => ({ sender: 'ops@example.test', to: 'supplier@example.test', cc: 'copy@example.test', subject: 'Exact human subject', body: 'Keep this exact human text\nand second line.', proposed_delivery_at: '', purchase_commitment: purchase });
const attrs = (ui, action) => ui.host.innerHTML.match(new RegExp(`<button data-action="${action}"([^>]*)>`))?.[1];
async function reviewed(ui, purchase) {
  ui.records.a.drafts = [{ id: 'draft-a', sender: 'ops@example.test', to: ['supplier@example.test'], cc: [], subject: 'Saved email', body: 'Saved text', attachments: [], content_hash: 'hash-a', ...(purchase === undefined ? {} : { purchase_commitment: purchase }), review: { content_hash: 'hash-a', source_version: 'source-1' }, approval: { id: 'approval-a', content_hash: 'hash-a', source_version: 'source-1' } }];
  ui.records.a.reviewed_source_version = 'source-1';
  await ui.core.load('a'); await ui.click('tab', 'email'); await ui.click('open-draft', 'draft-a');
}
test('visible source refresh invalidates old exact review and approval', async () => {
  const ui = await workspace({ get: async action => action === 'dispatch_execution' ? { actions: [], coverage: { complete: true }, capabilities: { approval_enabled: true, release_hold: false } } : undefined });
  await reviewed(ui, false);
  assert.doesNotMatch(attrs(ui, 'approve-draft'), /disabled/);
  assert.doesNotMatch(attrs(ui, 'execute-draft'), /disabled/);
  ui.records.a.source_version = 'source-2'; await ui.tick();
  assert.equal(ui.core.state.records.get('a').source_version, 'source-2');
  assert.match(attrs(ui, 'approve-draft'), /disabled/); assert.match(attrs(ui, 'execute-draft'), /disabled/);
  assert.match(ui.host.innerHTML, /Last evidence read:/); assert.doesNotMatch(ui.host.innerHTML, /Current source set reviewed/);
  assert.equal(ui.commands.length, 0);
});
test('failed refresh revokes approval and preserves the last successful read stamp', async () => {
  let offline = false;
  const ui = await workspace({ get: async action => { if (offline && action === 'dispatch_job') throw Error('Fixture evidence unavailable'); } });
  await reviewed(ui, true); const last = ui.core.state.evidence.get('a').lastSuccessAt;
  offline = true; await ui.tick();
  assert.equal(ui.core.state.evidence.get('a').verified, false); assert.equal(ui.core.state.evidence.get('a').lastSuccessAt, last);
  assert.match(ui.host.innerHTML, /Refresh failed: Fixture evidence unavailable/); assert.match(attrs(ui, 'approve-draft'), /disabled/);
  ui.input('approval', { communications_approved: 'on', purchase_approved: 'on' }); await ui.click('approve-draft'); assert.equal(ui.commands.length, 0);
  offline = false; await ui.emit('focus'); assert.equal(ui.core.state.evidence.get('a').verified, true);
});
test('hidden or unmounted Dispatch stops refreshing and resumes with a visible read', async () => {
  const ui = await workspace(); assert.equal([...ui.timers.values()][0].delay, 60000);
  await ui.visibility(false); const hiddenReads = ui.reads.length; await ui.tick(); await ui.emit('focus');
  assert.equal(ui.reads.length, hiddenReads); assert.equal(ui.timers.size, 0);
  await ui.visibility(true); assert.equal(ui.reads.filter(r => r.action === 'dispatch_job').length, 2);
  await ui.app.setActive(false); const inactiveReads = ui.reads.length; await ui.emit('focus'); await ui.tick(); assert.equal(ui.reads.length, inactiveReads);
  await ui.app.setActive(true); assert.equal(ui.reads.filter(r => r.action === 'dispatch_job').length, 3);
  ui.app.destroy(); const finalReads = ui.reads.length; await ui.emit('focus'); await ui.visibility(false); await ui.visibility(true); await ui.tick();
  assert.equal(ui.reads.length, finalReads); assert.equal(ui.timers.size, 0);
});
test('timer, focus and visibility refreshes share one pending evidence read', async () => {
  let wait = false, release;
  const ui = await workspace({ get: async action => { if (wait && action === 'dispatch_job') return new Promise(resolve => { release = resolve; }); } });
  const before = ui.reads.filter(r => r.action === 'dispatch_job').length; wait = true;
  const timer = ui.tick(), focus = ui.emit('focus'), visibility = ui.visibility(true);
  assert.equal(ui.reads.filter(r => r.action === 'dispatch_job').length - before, 1);
  release(clone(ui.records.a)); await Promise.all([timer, focus, visibility]); assert.equal(ui.timers.size, 1);
});
test('refresh retains exact draft identity, typing, caret and form focus', async () => {
  const ui = await workspace(); await ui.click('tab', 'email'); await ui.click('new-draft'); ui.input('draft', mail('false'), 'draft');
  const key = [...ui.core.state.editors.get('a').keys()].find(key => key.startsWith('draft:')), before = clone(ui.core.editor('a', key));
  const focused = ui.focusControl('draft', 'body', 7, 12); ui.records.a.source_version = 'changed-source'; await ui.tick();
  assert.deepEqual(clone(ui.core.editor('a', key)), before); assert.equal(focused.focused, true); assert.equal(focused.selectionStart, 7); assert.equal(focused.selectionEnd, 12);
  assert.match(ui.host.innerHTML, /Keep this exact human text\nand second line\./);
  await ui.click('add-requirement'); ui.input('requirement', { description: 'Typed requirement', quantity: '2', unit: 'each' });
  const requirementFocus = ui.focusControl('requirement', 'description', 4, 8); await ui.tick();
  assert.equal(requirementFocus.focused, true); assert.match(ui.host.innerHTML, /name="description" value="Typed requirement"/);
});
test('mail search and purchase acknowledgments stay bound to their exact context', async () => {
  const ui = await workspace(); await reviewed(ui, true);
  ui.input('mail-search', { scope: 'all', search: 'supplier history' }); ui.input('approval', { communications_approved: 'on', purchase_approved: 'on' }); await ui.tick();
  assert.match(ui.host.innerHTML, /name="search" value="supplier history"/); assert.match(ui.host.innerHTML, /name="purchase_approved" checked/);
  ui.records.a.source_version = 'source-2'; await ui.tick(); assert.doesNotMatch(ui.host.innerHTML, /name="purchase_approved" checked/);
});
for (const purchase of [undefined, true, false]) {
  test(`purchase approval follows exact non-PO classification ${purchase}`, async () => {
    const ui = await workspace(); await reviewed(ui, purchase); assert.equal(/name="purchase_approved"/.test(ui.host.innerHTML), purchase !== false);
    ui.input('approval', { communications_approved: 'on' }); await ui.click('approve-draft'); assert.equal(ui.commands.length, purchase === false ? 1 : 0);
    if (purchase !== false) { ui.input('approval', { communications_approved: 'on', purchase_approved: 'on' }); await ui.click('approve-draft'); assert.equal(ui.commands.length, 1); assert.equal(ui.commands[0].payload.purchase_approved, true); }
  });
}
test('classification saves as a boolean and editing it invalidates exact review', async () => {
  const ui = await workspace(); await ui.click('tab', 'email'); await ui.click('new-draft'); ui.input('draft', mail('false'), 'draft'); await ui.click('review-draft');
  assert.equal(ui.commands[0].payload.purchase_commitment, false); assert.match(ui.host.innerHTML, /Purchase authority: Does not commit to a purchase/); assert.match(ui.host.innerHTML, /Exact draft reviewed and persisted/);
  const id = ui.records.a.drafts[0].id; ui.input('draft', mail('true'), 'draft'); await ui.tick();
  assert.equal(ui.core.editor('a', `draft:${id}`).purchase_commitment, true); assert.doesNotMatch(ui.host.innerHTML, /Exact draft reviewed and persisted/); assert.match(attrs(ui, 'approve-draft'), /disabled/);
  await ui.click('save-draft'); assert.equal(ui.commands.at(-1).payload.purchase_commitment, true);
});
test('PO-linked drafts cannot opt out of purchase authority', async () => {
  const ui = await workspace(); ui.records.a.purchase_orders = [{ id: 'po-a', po_number: 'PO-1' }]; await ui.core.load('a'); await ui.click('po', 'po-a');
  assert.match(ui.host.innerHTML, /name="purchase_commitment" data-editor="draft" disabled/); ui.input('draft', mail('false'), 'draft'); await ui.click('save-draft');
  assert.equal(ui.commands[0].payload.purchase_commitment, true); assert.equal(ui.commands[0].payload.po_id, 'po-a'); assert.match(ui.host.innerHTML, /name="purchase_approved"/);
});
test('returned types stay selectable independently of next action through empty refresh', async () => {
  let empty = false;
  const ui = await workspace({ get: async action => action === 'dispatch_list' && empty ? { jobs: [], coverage: { complete: false } } : undefined });
  ui.records.a.job.work_type = 'Decking'; ui.records.a.job.next_action = 'Check scope'; ui.records.b.job.work_type = 'Custom repairs'; ui.records.b.job.next_action = 'Await delivery'; await ui.core.list();
  assert.match(ui.host.innerHTML, /data-action="trade" data-id="decking"/); assert.match(ui.host.innerHTML, /data-action="trade" data-id="custom repairs"/);
  await ui.click('trade', 'decking'); await ui.filter('workflow', 'Check scope'); assert.match(ui.host.innerHTML, /class="dp-job" data-action="select" data-id="a"/); assert.doesNotMatch(ui.host.innerHTML, /class="dp-job" data-action="select" data-id="b"/);
  empty = true; await ui.core.list(); assert.match(ui.host.innerHTML, /data-id="decking" aria-pressed="true"/); assert.match(ui.host.innerHTML, /Coverage incomplete/); assert.match(ui.host.innerHTML, /value="Check scope" selected/);
});
