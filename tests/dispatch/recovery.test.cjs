const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace, clone } = require('./workspace-harness.cjs');

test('pending recovery survives refresh and retries the exact request', async () => {
  let writes = 0;
  const ui = await workspace({ post: async (action, envelope) => {
    writes += 1;
    if (writes === 1) throw new Error('timeout while saving');
    const current = ui.records[envelope.job_id];
    current.notes.push(clone(envelope.payload));
    current.version += 1;
    return clone(current);
  } });
  await ui.click('tab', 'notes');
  ui.input('note', { text: 'Keep this note during recovery' }, 'note');
  await ui.click('save-note');
  assert.match(ui.host.innerHTML, /previous save outcome is unconfirmed/i);
  assert.match(ui.host.innerHTML, /Retry same request/);
  const first = clone(ui.commands[0]);
  await ui.core.load('a');
  assert.match(ui.host.innerHTML, /Retry same request/);
  await ui.click('retry-write');
  assert.equal(ui.commands.length, 2);
  assert.deepEqual(ui.commands[1], first);
  assert.equal(ui.records.a.notes[0].text, 'Keep this note during recovery');
});

test('conflict recovery keeps the original request until explicit reload', async () => {
  let writes = 0;
  const ui = await workspace({ post: async () => {
    writes += 1;
    throw Object.assign(new Error('Source or plan changed; reload before saving'), { status: 409 });
  } });
  await ui.click('tab', 'notes');
  ui.input('note', { text: 'Conflict note stays editable' }, 'note');
  await ui.click('save-note');
  assert.equal(writes, 1);
  const first = clone(ui.commands[0]);
  await ui.core.load('a');
  assert.match(ui.host.innerHTML, /Reload changed evidence/);
  assert.deepEqual(ui.core.state.pending.get('a').envelope, {
    job_id: first.job_id,
    expected_version: first.expected_version,
    source_version: first.source_version,
    request_id: first.request_id,
    command: first.command,
    payload: first.payload
  });
  await assert.rejects(() => ui.core.retry('a'), /Reload/);
  await ui.click('resolve-conflict');
  assert.equal(ui.core.state.pending.has('a'), false);
  assert.match(ui.host.innerHTML, /Conflict note stays editable/);
});

async function reviewedAttachmentUi(canonicalAttachment) {
  let reviewPayload = null;
  const ui = await workspace({ post: async (action, envelope) => {
    const current = ui.records[envelope.job_id];
    if (envelope.command === 'draft_upsert') {
      const saved = { ...clone(envelope.payload), attachments: [clone(canonicalAttachment)], status: 'draft', content_hash: 'hash-draft' };
      const index = current.drafts.findIndex(item => item.id === saved.id);
      if (index < 0) current.drafts.push(saved); else current.drafts[index] = saved;
    }
    if (envelope.command === 'draft_review') {
      reviewPayload = clone(envelope.payload);
      const draft = current.drafts.find(item => item.id === envelope.payload.id);
      draft.review = { content_hash: draft.content_hash, source_version: current.source_version };
    }
    current.version += 1;
    return clone(current);
  } });
  ui.records.a.media = [{ id: 'photo-1', name: 'Panel photo', source_ref: 'media:photo-1', revision: 'hash-1', url: 'https://example.test/photo.jpg' }];
  ui.records.a.drafts = [{
    id: 'draft-a',
    sender: 'ops@example.test',
    to: ['supplier@example.test'],
    cc: [],
    subject: 'Panels',
    body: 'Please supply panels',
    proposed_delivery_at: null,
    purchase_commitment: false,
    attachments: [{ id: canonicalAttachment.id, name: canonicalAttachment.name, source_ref: canonicalAttachment.source_ref, revision: canonicalAttachment.revision }],
    status: 'draft',
    content_hash: 'hash-draft'
  }];
  await ui.core.load('a');
  await ui.click('tab', 'email');
  await ui.click('open-draft', 'draft-a');
  ui.input('draft', { sender: 'ops@example.test', to: 'supplier@example.test', cc: '', subject: 'Panels', body: 'Please supply panels', proposed_delivery_at: '', purchase_commitment: 'false', attachment: 'photo-1' }, 'draft');
  return { ui, reviewPayload: () => reviewPayload, clearReview: () => { reviewPayload = null; } };
}

test('attachment review accepts canonical field order', async () => {
  const canonical = { revision: 'hash-1', source_ref: 'media:photo-1', name: 'Panel photo', id: 'photo-1' };
  const { ui, reviewPayload } = await reviewedAttachmentUi(canonical);
  await ui.click('review-draft');
  assert.deepEqual(reviewPayload(), { id: 'draft-a' });
  assert.match(ui.host.innerHTML, /Exact draft reviewed and persisted/);
});

for (const [field, value] of [
  ['name', 'Renamed panel photo'],
  ['source_ref', 'https://example.test/replaced-photo.jpg'],
  ['revision', 'hash-2']
]) {
  test(`attachment review stops when canonical ${field} changes`, async () => {
    const canonical = { id: 'photo-1', name: 'Panel photo', source_ref: 'media:photo-1', revision: 'hash-1' };
    const { ui, reviewPayload, clearReview } = await reviewedAttachmentUi(canonical);
    canonical[field] = value;
    clearReview();
    await ui.click('review-draft');
    assert.equal(reviewPayload(), null);
    assert.match(ui.host.innerHTML, /Attachment bytes resolved/);
  });
}

test('allocation suitability review requires reason and evidence without receipt inference', async () => {
  const ui = await workspace();
  ui.records.a.requirements = [{ id: 'requirement-a', description: 'Custom fence panels', quantity: 8, unit: 'each' }];
  ui.records.a.allocations = [{ id: 'allocation-a', requirement_id: 'requirement-a', quantity: 8, unit: 'each', supply_id: 'stock:yard', suitability_obligation: 'Confirm compatibility' }];
  ui.records.a.receipts = [{ id: 'receipt-a', allocation_id: 'allocation-a', usable_quantity: 8, damaged_quantity: 0, location: 'site', evidence: 'Quantity only' }];
  await ui.core.load('a');
  await ui.click('review-allocation', 'allocation-a');
  assert.match(ui.host.innerHTML, /Review allocation compatibility/);
  await ui.submit('suitability', { reason: '', evidence: 'Photo evidence' });
  assert.equal(ui.commands.length, 0);
  assert.match(ui.host.innerHTML, /A reason and compatibility evidence are required/);
  assert.match(ui.host.innerHTML, /8 usable · 0 damaged · site/);
  assert.match(ui.host.innerHTML, /Confirm compatibility/);
  assert.doesNotMatch(ui.host.innerHTML, /Compatibility current|Current compatibility/);
});

test('allocation suitability edits survive refresh and job switches', async () => {
  const ui = await workspace();
  ui.records.a.requirements = [{ id: 'requirement-a', description: 'Custom fence panels', quantity: 8, unit: 'each' }];
  ui.records.a.allocations = [{ id: 'allocation-a', requirement_id: 'requirement-a', quantity: 8, unit: 'each', supply_id: 'stock:yard', suitability_obligation: 'Confirm compatibility' }];
  await ui.core.load('a');
  await ui.click('review-allocation', 'allocation-a');
  ui.input('suitability', { reason: 'Matches signed scope', evidence: 'Photo and docket checked' });
  await ui.core.load('a');
  await ui.click('select', 'b');
  await ui.click('select', 'a');
  assert.match(ui.host.innerHTML, /Matches signed scope/);
  assert.match(ui.host.innerHTML, /Photo and docket checked/);
  await ui.submit('suitability', { reason: 'Matches signed scope', evidence: 'Photo and docket checked' });
  assert.equal(ui.commands.at(-1).command, 'allocation_confirm_suitability');
  assert.deepEqual(ui.commands.at(-1).payload, { id: 'allocation-a', reason: 'Matches signed scope', evidence: 'Photo and docket checked' });
});
