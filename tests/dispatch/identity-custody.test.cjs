const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace, clone } = require('./workspace-harness.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const operator = { id: 'operator-a', org_id: 'org-a' };
const mail = { sender: 'private-a@example.test', to: 'supplier-a@example.test', subject: 'Private operator subject', body: 'Private operator text', purchase_commitment: 'false' };

for (const next of [{ id: 'operator-b', org_id: 'org-a' }, { id: 'operator-a', org_id: 'org-b' }]) {
  test(`identity change to ${next.id}/${next.org_id} clears prior DOM and pending reads`, async () => {
    const late = deferred(); let hold = false, denied = false;
    const ui = await workspace({ hostIdentity: operator, get: async action => {
      if (denied) throw Error('New account evidence unavailable');
      if (hold && action === 'dispatch_job') return late.promise;
    } });
    await ui.click('tab', 'email'); await ui.click('new-draft'); ui.input('draft', mail, 'draft');
    ui.records.a.job.pricing_json = { price: 'Private price' };
    hold = true;
    const old = ui.core.load('a');
    const rejected = assert.rejects(old, /disposed/);
    ui.identity(null); ui.emit('sw:auth-locked');
    assert.equal(ui.host.innerHTML, '');
    assert.equal(ui.core.state.editors.size, 0);
    assert.equal(ui.core.state.records.size, 0);
    denied = true; hold = false;
    ui.identity(next); ui.emit('sw:auth-unlocked');
    await ui.context.DispatchOps.load();
    assert.doesNotMatch(ui.host.innerHTML, /Private operator|Private price|supplier-a/);
    late.resolve(clone(ui.records.a)); await rejected;
    assert.equal(ui.core.state.records.size, 0);
    assert.doesNotMatch(ui.host.innerHTML, /Private operator|Private price/);
    await assert.rejects(ui.core.command('a', 'note_upsert', { text: 'old actor' }), /disposed/);
    assert.equal(ui.commands.length, 0);
  });
}

test('late prior-operator save cannot restore editors or start another request', async () => {
  const late = deferred();
  const ui = await workspace({ hostIdentity: operator, post: () => late.promise });
  await ui.click('add-group'); ui.input('group', { name: 'Private old group' });
  const saving = ui.submit('group', { name: 'Private old group' });
  const originalCalls = ui.reads.length;
  ui.identity(null);
  ui.identity({ id: 'operator-b', org_id: 'org-a' });
  late.resolve({ saved: true }); await saving;
  assert.equal(ui.host.innerHTML, '');
  assert.equal(ui.core.state.pending.size, 0);
  assert.equal(ui.core.state.records.size, 0);
  assert.equal(ui.reads.length, originalCalls);
  assert.equal(ui.commands.length, 1);
});

test('same-identity refresh retains editor but signout fences even a same-identity return', async () => {
  const ui = await workspace({ hostIdentity: operator });
  await ui.click('new-draft'); ui.input('draft', mail, 'draft');
  const guard = ui.context.DispatchOps.identityGuard();
  ui.identity({ ...operator });
  guard(); ui.app.render(); assert.match(ui.host.innerHTML, /Private operator/);
  ui.identity(null); ui.identity({ ...operator });
  assert.throws(guard, /identity changed/);
  assert.equal(ui.host.innerHTML, '');
  assert.equal(ui.core.state.editors.size, 0);
});
