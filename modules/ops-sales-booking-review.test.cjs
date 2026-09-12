const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function proposal(hour = '13') {
  return {
    start_iso: `2026-09-17T${hour}:00:00+08:00`,
    end_iso: `2026-09-17T${Number(hour) + 1}:00:00+08:00`,
    offer_id: 'offer-a',
    draft: `Visit on 17 September at ${hour}:00`
  };
}

function harness() {
  const context = { AbortController };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('./ops-sales-booking.js'), 'utf8'), context);
  const api = context.SalesBooking;
  const c = { id: 'case-a', contact_id: 'contact-a', status: 'ready', proposal: proposal(), source_version: 'source-v1' };
  api.state.data = { ok: true, events: [], cases: [c, { id: 'case-b', contact_id: null }] };
  api.state.selectedId = c.id;
  return { api, c, context };
}

function thread(context, message) {
  context.SALES_BOOKING_PREVIEW_CONVERSATION_URL = 'https://invalid.test/conversation';
  context.fetch = async () => ({ json: async () => ({ messages: [message] }) });
}

test('rendering an older case snapshot cannot rewind an acknowledged draft', async () => {
  const { api, c, context } = harness();
  c.draft = { revision: 1, text: 'A', human_edited: true };
  api.bindDraft(c);
  const d = api.draftFor(c);
  const expected = [];
  context.opsPost = async (_action, body) => {
    expected.push(body.expected_revision);
    return { ok: true, revision: body.expected_revision + 1 };
  };
  d.text = 'B';
  await api.persistDraftToServer(c, d);
  api.renderHTML();
  assert.equal(d.serverRevision, 2);
  assert.equal(d.savedText, 'B');
  assert.equal(api.draftIsAcknowledged(d), true);
  d.text = 'C';
  await api.persistDraftToServer(c, d);
  assert.deepEqual(expected, [1, 2]);
  assert.equal(d.serverRevision, 3);
});

test('an assessment for m1 cannot restore a proposal after m2 invalidates it', async () => {
  const { api, c, context } = harness();
  const old = deferred();
  const started = deferred();
  context.opsPost = (action, body) => {
    if (action !== 'sales_booking_assess') return Promise.resolve({ ok: true });
    if (body.input.messages[0].id === 'm1') { started.resolve(); return old.promise; }
    return Promise.resolve({ payload: { status: 'needs_decision', exact_acceptance: false } });
  };
  thread(context, { id: 'm1', timestamp: '2026-09-13T01:00:00Z', body: 'Thursday afternoon' });
  const first = api.loadConversation(c.contact_id, c.id);
  await started.promise;
  thread(context, { id: 'm2', timestamp: '2026-09-13T02:00:00Z', body: 'Unavailable' });
  await api.loadConversation(c.contact_id, c.id);
  old.resolve({ payload: { status: 'ready', proposal: proposal() } });
  await first;
  assert.equal(c.status, 'needs_decision');
  assert.equal(c.proposal_stale, true);
  assert.equal(api.actionKind(c), 'none');
});

for (const transition of ['case', 'resource', 'workspace']) {
  test(`assessment completion is ignored after the ${transition} changes`, async () => {
    const { api, c, context } = harness();
    const old = deferred();
    const started = deferred();
    context.opsPost = (action) => {
      if (action !== 'sales_booking_assess') return Promise.resolve({ ok: true });
      started.resolve();
      return old.promise;
    };
    thread(context, { id: 'm1', timestamp: '2026-09-13T01:00:00Z', body: 'Thursday afternoon' });
    const first = api.loadConversation(c.contact_id, c.id);
    await started.promise;
    context.opsFetch = async () => ({ ok: true, events: [], cases: [{ id: c.id, status: 'needs_decision' }] });
    if (transition === 'case') api.selectCase('case-b');
    if (transition === 'resource') await api.switchResource('khairo');
    if (transition === 'workspace') await api.load('nithin');
    old.resolve({ payload: { status: 'ready', proposal: proposal('15') } });
    await first;
    assert.equal(c.status, 'needs_decision');
    assert.equal(c.proposal.start_iso, proposal().start_iso);
  });
}

for (const humanEdited of [false, true]) {
  test(`reassessment synchronizes a ${humanEdited ? 'human' : 'generated'} saved draft`, async () => {
    const { api, c, context } = harness();
    c.draft = { revision: 1, text: c.proposal.draft, human_edited: humanEdited };
    api.bindDraft(c);
    const posts = [];
    context.opsPost = async (action, body) => {
      posts.push({ action, body });
      if (action === 'sales_booking_assess') return { payload: { status: 'ready', proposal: proposal('15') } };
      if (action === 'sales_booking_draft') return { ok: true, revision: body.expected_revision + 1 };
      return { ok: false, held: true };
    };
    thread(context, { id: 'm1', timestamp: '2026-09-13T01:00:00Z', body: 'Thursday after 3pm' });
    await api.loadConversation(c.contact_id, c.id);
    const d = api.draftFor(c);
    if (d.saveChain) await d.saveChain;
    api.renderHTML();
    assert.equal(c.proposal.start_iso, proposal('15').start_iso);
    assert.equal(d.suggested, proposal('15').draft);
    if (humanEdited) {
      assert.equal(d.text, proposal().draft);
      assert.equal(d.conflict, true);
      assert.equal(api.actionKind(c), 'none');
      assert.equal(api.attemptApprove().action, 'none');
      assert.equal(posts.some((p) => p.action === 'sales_booking_approve'), false);
    } else {
      assert.equal(d.text, proposal('15').draft);
      assert.equal(d.savedText, proposal('15').draft);
      assert.equal(d.serverRevision, 2);
      assert.equal(api.draftIsAcknowledged(d), true);
      assert.equal(api.actionKind(c), 'approve_offer');
      assert.equal(posts.find((p) => p.action === 'sales_booking_draft').body.expected_revision, 1);
    }
  });
}

test('restore changes archive visibility only after an acknowledged response', async () => {
  const { api, c, context } = harness();
  c.archived = { reason: 'declined', restored: false };
  api.state.archives[c.id] = c.archived;
  const save = deferred();
  context.opsPost = () => save.promise;
  const restored = api.restoreCase(c.id);
  assert.equal(c.archived.restored, false);
  assert.equal(c.restorePending, true);
  save.resolve({ ok: true, restored: true });
  const result = await restored;
  assert.equal(result.ok, true);
  assert.equal(c.archived.restored, true);
  assert.equal(c.restorePending, false);
});

for (const failure of ['refused', 'network', 'no_transport']) {
  test(`restore retains the archive on ${failure} failure`, async () => {
    const { api, c, context } = harness();
    c.archived = { reason: 'declined', restored: false };
    api.state.archives[c.id] = c.archived;
    if (failure === 'refused') context.opsPost = async () => ({ ok: false, error: 'Restore refused' });
    if (failure === 'network') context.opsPost = async () => { throw new Error('Network unavailable'); };
    const result = await api.restoreCase(c.id);
    assert.equal(result.ok, false);
    assert.equal(c.archived.restored, false);
    assert.equal(c.restorePending, false);
    assert.ok(c.restoreError);
    assert.match(api.renderHTML(), /Restore to workload/);
  });
}

test('bound confirmation reports the send hold and preserves Luna payload fields', async () => {
  const { api, c, context } = harness();
  Object.assign(c, {
    exact_acceptance: true,
    accepted_start_iso: c.proposal.start_iso,
    accepted_end_iso: c.proposal.end_iso,
    accepted_offer_id: c.proposal.offer_id,
    accepted_resource_id: 'nithin',
    accepted_contact_id: c.contact_id,
    draft: { revision: 1, text: 'Confirmed draft', human_edited: true }
  });
  api.bindDraft(c);
  const posted = deferred();
  context.opsPost = (action, body) => { posted.resolve({ action, body }); return Promise.resolve({ ok: false, held: true }); };
  const result = api.attemptApprove();
  assert.equal(result.reason, 'send_hold');
  assert.equal(result.action, 'confirm_booking');
  const { action, body } = await posted.promise;
  assert.equal(action, 'sales_booking_confirm');
  assert.equal(body.kind, 'confirm_booking');
  assert.equal(body.draft_revision, 1);
  assert.equal(body.resource_id, 'nithin');
  assert.equal(body.recipient, c.contact_id);
  assert.equal(body.source_version, 'source-v1');
  assert.equal(body.text, 'Confirmed draft');
  assert.equal(body.exact_acceptance, undefined);
});
