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

test('identity reset clears incumbent calendar caches and unscheduled sidebar hosts', async () => {
  const sidebar = { innerHTML: 'Private A · Secret suburb · $999' };
  const ui = await workspace({ hostIdentity: operator });
  ui.document.getElementById = id => id === 'calUnschedSidebar' ? sidebar : id === 'dispatchRoot' ? ui.host : null;
  Object.assign(ui.context, {
    _unschedJobs: [{ client_name: 'Private A', site_suburb: 'Secret suburb', quoted_value: 999 }],
    _calEvents: [{ job_id: 'old', client_name: 'Private A' }],
    _calDeliveries: [{ id: 'old-po' }],
    _calReadiness: { old: true },
    _calOrgEvents: [{ id: 'old-org' }],
    _calLeaveByDate: { '2026-09-14': ['Private A'] },
    _calAvailability: { old: true },
    _crewList: ['Private crew'],
    _calTruncated: true
  });
  ui.identity(null);
  assert.equal(JSON.stringify(ui.context._unschedJobs), '[]');
  assert.equal(JSON.stringify(ui.context._calEvents), '[]');
  assert.equal(JSON.stringify(ui.context._calDeliveries), '[]');
  assert.equal(JSON.stringify(ui.context._calReadiness), '{}');
  assert.equal(JSON.stringify(ui.context._calOrgEvents), '[]');
  assert.equal(JSON.stringify(ui.context._calLeaveByDate), '{}');
  assert.equal(JSON.stringify(ui.context._calAvailability), '{}');
  assert.equal(JSON.stringify(ui.context._crewList), '[]');
  assert.equal(ui.context._calTruncated, false);
  assert.equal(sidebar.innerHTML, '');
  assert.doesNotMatch(ui.host.innerHTML, /Private A|Secret suburb/);
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
