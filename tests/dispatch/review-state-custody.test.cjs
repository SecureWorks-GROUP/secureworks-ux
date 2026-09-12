const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../../modules/ops-dispatch-core.js');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const record = (id, version, sourceVersion = 'src') => ({ job: { id }, version, source_version: sourceVersion, groups: [], requirements: [], drafts: [] });
function harness(get, post) {
  let id = 0;
  return create({ get, post, id: () => `request-${++id}` });
}

test('successful command aggregate fences older successful job reads', async () => {
  const oldRead = deferred();
  const write = deferred();
  let reads = 0;
  const core = harness(async (action, params) => {
    reads++;
    if (reads === 2) return oldRead.promise;
    return record(params.job_id, 1);
  }, async () => write.promise);
  await core.load('job-a');
  const command = core.command('job-a', 'note_upsert', { id: 'note-a' });
  await new Promise(resolve => setImmediate(resolve));
  const stale = core.load('job-a');
  write.resolve(record('job-a', 3));
  await command;
  oldRead.resolve(record('job-a', 2));
  await stale;
  assert.equal(core.state.records.get('job-a').version, 3);
  assert.equal(core.state.evidence.get('job-a').verified, true);
});

test('successful command aggregate fences older failed job reads', async () => {
  const oldRead = deferred();
  const write = deferred();
  let reads = 0;
  const core = harness(async (action, params) => {
    reads++;
    if (reads === 2) return oldRead.promise;
    return record(params.job_id, 1);
  }, async () => write.promise);
  await core.load('job-a');
  const command = core.command('job-a', 'note_upsert', { id: 'note-a' });
  await new Promise(resolve => setImmediate(resolve));
  const stale = core.load('job-a');
  write.resolve(record('job-a', 3));
  await command;
  oldRead.reject(Error('old read failed'));
  await assert.rejects(stale, /old read failed/);
  assert.equal(core.state.records.get('job-a').version, 3);
  assert.equal(core.state.evidence.get('job-a').verified, true);
  assert.equal(core.state.errors.has('job-a'), false);
});

test('baseline conflict rejects before pending state or post', async () => {
  let version = 1;
  let posts = 0;
  const core = harness(async (action, params) => record(params.job_id, version), async () => { posts++; });
  await core.load('job-a');
  const captured = core.baseline('job-a');
  version = 2;
  await core.load('job-a');
  await assert.rejects(core.command('job-a', 'note_upsert', { id: 'note-a' }, 'dispatch_command', captured), /reconcile this editor/);
  assert.equal(posts, 0);
  assert.equal(core.state.pending.has('job-a'), false);
});

test('matching baseline supplies the captured versions in the command envelope', async () => {
  const posts = [];
  const core = harness(async (action, params) => record(params.job_id, 4, 'source-4'), async (action, body) => {
    posts.push({ action, body });
    return record(body.job_id, 5, 'source-5');
  });
  await core.load('job-a');
  const captured = core.baseline('job-a');
  await core.command('job-a', 'note_upsert', { id: 'note-a' }, 'dispatch_command', captured);
  assert.equal(posts[0].body.expected_version, 4);
  assert.equal(posts[0].body.source_version, 'source-4');
});

test('dispose clears local state and prevents late job reads from repopulating it', async () => {
  const slow = deferred();
  const core = harness(async () => slow.promise);
  const pending = core.load('job-a');
  core.edit('job-a', 'draft:d', { body: 'sensitive text' });
  core.dispose();
  assert.equal(core.state.editors.size, 0);
  assert.equal(core.state.records.size, 0);
  slow.resolve(record('job-a', 1));
  await assert.rejects(pending, /disposed/);
  assert.equal(core.state.records.size, 0);
  assert.equal(core.state.evidence.size, 0);
});

test('dispose prevents late population from selecting and loading a job', async () => {
  const listRead = deferred();
  const calls = [];
  const core = harness(async (action, params) => {
    calls.push(action);
    if (action === 'dispatch_list') return listRead.promise;
    return record(params.job_id, 1);
  });
  const pending = core.list();
  core.dispose();
  listRead.resolve({ jobs: [{ id: 'job-a' }], coverage: { complete: true } });
  await assert.rejects(pending, /disposed/);
  assert.deepEqual(calls, ['dispatch_list']);
  assert.equal(core.state.selectedId, null);
});

test('dispose rejects future writes without posting', async () => {
  let posts = 0;
  const core = harness(async (action, params) => record(params.job_id, 1), async () => { posts++; });
  await core.load('job-a');
  core.dispose();
  assert.throws(() => core.edit('job-a', 'draft:d', { body: 'new' }), /disposed/);
  await assert.rejects(core.command('job-a', 'note_upsert', { id: 'note-a' }), /disposed/);
  await assert.rejects(core.executeDraft('job-a', 'draft-a', 'approval-a'), /disposed/);
  assert.equal(posts, 0);
});

test('dispose prevents late command post from reading back or repopulating state', async () => {
  const write = deferred();
  const calls = [];
  const core = harness(async (action, params) => {
    calls.push(action);
    return record(params.job_id, 1);
  }, async action => {
    calls.push(action);
    return write.promise;
  });
  await core.load('job-a');
  const pending = core.command('job-a', 'note_upsert', { id: 'note-a' });
  await new Promise(resolve => setImmediate(resolve));
  core.dispose();
  write.resolve({ accepted: true });
  await assert.rejects(pending, /disposed/);
  assert.deepEqual(calls, ['dispatch_job', 'dispatch_command']);
  assert.equal(core.state.records.size, 0);
});
