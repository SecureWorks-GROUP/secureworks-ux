const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspace, clone } = require('./workspace-harness.cjs');
const task = { job_id: 'a', source_version: 'source-1', plan_version: 0, status: 'failed', last_error: 'Read scope again' };
const page = (items = [task], sourceFailures = []) => ({ items, has_more: false, next_offset: null, source_failures: sourceFailures, source_failures_has_more: false, source_failures_next_offset: null });

test('assessment status shows separate coverage and original job source failures', async () => {
  let fail = false;
  const ui = await workspace({ get: async action => {
    if (action !== 'dispatch_tasks') return;
    if (fail) throw Error('Status read unavailable');
    return { ...page([task], [{ job_id: 'b', status: 'deferred', last_error: 'Original source unavailable' }]), has_more: true, next_offset: 25 };
  } });
  await ui.click('refresh-assessments');
  assert.match(ui.host.innerHTML, /Job assessments<\/h4><p class="dp-small">1 captured · Coverage unknown \/ partial/);
  assert.match(ui.host.innerHTML, /Source reads needing attention<\/h4><p class="dp-small">1 captured · Complete/);
  assert.match(ui.host.innerHTML, /Original source unavailable/);
  assert.match(ui.host.innerHTML, /Load more assessment records/);
  assert.equal(ui.core.state.selectedId, 'a');
  fail = true; await ui.click('refresh-assessments');
  assert.match(ui.host.innerHTML, /Assessment status unavailable: Status read unavailable/);
  assert.doesNotMatch(ui.host.innerHTML, /captured · Complete/);
});

for (const reason of ['lease_active', 'already_done']) {
  test(`assessment retry displays server refusal ${reason}`, async () => {
    const ui = await workspace({ get: async action => action === 'dispatch_tasks' ? page() : undefined,
      post: async () => ({ retried: false, reason, task: { ...task, status: reason === 'already_done' ? 'done' : 'running' } }) });
    await ui.click('refresh-assessments');
    await ui.click('prepare-assessment-retry', ui.core.taskKey(task, false));
    ui.input('assessment-retry', { reason: 'Reviewed current source' });
    await ui.submit('assessment-retry', { reason: 'Reviewed current source' });
    assert.match(ui.host.innerHTML, /Retried: no/);
    assert.match(ui.host.innerHTML, new RegExp(reason.replaceAll('_', ' ')));
    assert.equal(ui.commands[0].action, 'dispatch_retry_task');
    assert.equal(ui.commands[0].source_version, 'source-1');
    assert.equal(ui.commands[0].plan_version, 0);
  });
}

test('source failure retry retains its reason and exact unknown request across refresh', async () => {
  let writes = 0;
  const source = { job_id: 'b', status: 'deferred', last_error: 'Source unavailable' };
  const ui = await workspace({ get: async action => action === 'dispatch_tasks' ? page([], [source]) : undefined,
    post: async () => { if (++writes === 1) throw Error('Lost retry response'); return { retried: false, queued: false, job_id: 'b', status: 'deferred', reason: 'source_unavailable', error: 'Source still unavailable' }; } });
  await ui.click('tab', 'email'); await ui.click('new-draft');
  ui.input('draft', { sender: 'ops@example.test', to: 'supplier@example.test', cc: '', subject: 'Human subject', body: 'Keep human text', purchase_commitment: 'false' }, 'draft');
  const drafts = clone([...ui.core.state.editors.get('a').values()]);
  await ui.click('refresh-assessments');
  const key = ui.core.taskKey(source, true);
  await ui.click('prepare-assessment-retry', key);
  ui.input('assessment-retry', { reason: 'Source access restored' });
  await ui.tick();
  await ui.submit('assessment-retry', { reason: 'Source access restored' });
  await ui.click('refresh-assessments');
  assert.match(ui.host.innerHTML, /Check same assessment retry request/);
  assert.match(ui.host.innerHTML, /Source access restored/);
  await ui.click('recover-assessment-retry', key);
  assert.deepEqual(ui.commands[0], ui.commands[1]);
  assert.equal(Object.hasOwn(ui.commands[0], 'source_version'), false);
  assert.equal(Object.hasOwn(ui.commands[0], 'plan_version'), false);
  assert.match(ui.host.innerHTML, /Queued: no · Retried: no · Status: deferred · source unavailable/);
  assert.equal(ui.core.state.selectedId, 'a');
  assert.deepEqual(clone([...ui.core.state.editors.get('a').values()]), drafts);
});
