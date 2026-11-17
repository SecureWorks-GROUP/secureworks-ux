const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../../modules/ops-agent-proposals.js');

function fixture(proposals = []) {
  const root = { hidden: true, innerHTML: '', addEventListener() {} };
  const calls = [];
  const host = {
    enabled: () => true, visible: () => true, identity: () => 'admin',
    read: async (action, params) => {
      calls.push({ action, params });
      return action === 'job_detail' ? { job: { job_number: 'ZZTEST-401' } } : { proposals };
    },
    post: async (action, body) => { calls.push({ action, body }); return { ok: true, status: 'carried_out' }; }
  };
  const api = create(host);
  api.mount(root);
  return { root, calls, host, api };
}

test('empty list and proposal rows show the required words and controls', async () => {
  const f = fixture(); await f.api.refresh();
  assert.match(f.root.innerHTML, /Nothing is waiting for a press\./);
  const row = fixture([{ id: 'proposal', summary: 'Record a payment', job_id: 'job', actor: 'finance', status: 'pending' }]);
  await row.api.refresh();
  assert.match(row.root.innerHTML, /Record a payment/);
  assert.match(row.root.innerHTML, /Job ZZTEST-401/);
  assert.match(row.root.innerHTML, />Carry out<|>Carry out<\/button>/);
  assert.match(row.root.innerHTML, />Decline<\/button>/);
});

test('a carry out needs confirmation, posts once, and a 409 cannot be retried', async () => {
  const f = fixture([{ id: 'proposal', summary: 'Record a payment', status: 'pending' }]);
  await f.api.refresh();
  await f.api.press('proposal', 'yes');
  assert.equal(f.calls.filter(c => c.body).length, 0);
  await f.api.press('proposal', 'carry');
  assert.match(f.root.innerHTML, /Carry out: Record a payment/);
  f.host.post = async (action, body) => {
    f.calls.push({ action, body }); throw Object.assign(new Error('conflict'), { status: 409 });
  };
  await f.api.press('proposal', 'yes');
  assert.match(f.root.innerHTML, /Someone has already decided this one\./);
  await f.api.press('proposal', 'carry'); await f.api.press('proposal', 'yes');
  assert.equal(f.calls.filter(c => c.body).length, 1);
});

test('hidden, disabled and signed-out panels make no reads or writes', async () => {
  for (const key of ['enabled', 'visible', 'identity']) {
    const f = fixture(); f.host[key] = () => false;
    await f.api.refresh(); await f.api.press('proposal', 'yes');
    assert.equal(f.calls.length, 0); assert.equal(f.root.hidden, true);
  }
});

test('decline records the reason once and shows the confirmed outcome', async () => {
  const f = fixture([{ id: 'proposal', summary: 'Change work order state', status: 'pending' }]);
  await f.api.refresh(); await f.api.press('proposal', 'decline');
  assert.match(f.root.innerHTML, /Why\? \(a few words\)/);
  f.host.post = async (action, body) => { f.calls.push({ action, body }); return { ok: true, status: 'declined' }; };
  await f.api.press('proposal', 'no', 'Already handled');
  assert.deepEqual(f.calls.at(-1), { action: 'decline_agent_proposal', body: { proposal_id: 'proposal', reason: 'Already handled' } });
  assert.match(f.root.innerHTML, /Declined\./);
});

test('missing data and failed reads are errors, and a lost write never claims nothing changed', async () => {
  const f = fixture([{ id: 'proposal', summary: 'Record a payment', status: 'pending' }]);
  f.host.read = async () => ({}); await f.api.refresh();
  assert.match(f.root.innerHTML, /Could not load\. Try again\./);
  f.host.read = async () => { throw new Error('read failed'); }; await f.api.refresh();
  assert.match(f.root.innerHTML, /Could not load\. Try again\./);
  f.host.read = async () => ({ proposals: [{ id: 'proposal', summary: 'Record a payment', status: 'pending' }] });
  await f.api.refresh(); await f.api.press('proposal', 'carry');
  f.host.post = async () => { throw new Error('connection lost'); };
  await f.api.press('proposal', 'yes');
  assert.doesNotMatch(f.root.innerHTML, /Nothing was changed/);
  assert.match(f.root.innerHTML, /could not be confirmed/);
});

test('a refreshed office edit is shown, parameters stay hidden, and terminal refusals have no retry', async () => {
  const proposal = { id: 'proposal', summary: 'Record a payment', status: 'pending', params: { private: 'RAW_PARAMETERS' } };
  const f = fixture([proposal]); await f.api.refresh();
  proposal.summary = 'Record the updated payment'; await f.api.refresh();
  assert.match(f.root.innerHTML, /Record the updated payment/);
  assert.doesNotMatch(f.root.innerHTML, /RAW_PARAMETERS/);
  for (const [status, words] of [[403, 'You do not have permission for this one. Ask an admin.'], [410, 'This one has expired. Ask the agent again.']]) {
    const r = fixture([proposal]); await r.api.refresh(); await r.api.press('proposal', 'carry');
    r.host.post = async () => { throw Object.assign(new Error('refused'), { status }); };
    await r.api.press('proposal', 'yes');
    assert.ok(r.root.innerHTML.includes(words));
    assert.doesNotMatch(r.root.innerHTML, /data-ap="carry"|data-ap="decline"/);
  }
});
