const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../../modules/ops-dispatch-core.js');

function harness(get, post) {
  let id = 0;
  return create({ get, post, id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` });
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const record = (id, version, sourceVersion) => ({ job: { id }, version, source_version: sourceVersion, groups: [], requirements: [], drafts: [] });

test('task read exposes separately paged task and source-failure state', async () => {
  const calls = [];
  const core = harness(async (action, params) => {
    calls.push({ action, params });
    return {
      items: [{ job_id: 'job-a', source_version: 'src-a', plan_version: 1, status: 'failed' }],
      has_more: true,
      next_offset: 25,
      source_failures: [{ job_id: 'job-b', status: 'deferred' }],
      source_failures_has_more: false,
      source_failures_next_offset: null,
      live_actions_enabled: false
    };
  });
  await core.tasks({ status: 'failed' });
  assert.deepEqual(calls, [{ action: 'dispatch_tasks', params: { status: 'failed', limit: 25, offset: 0 } }]);
  assert.deepEqual(core.state.tasks.items.map(row => row.job_id), ['job-a']);
  assert.deepEqual(core.state.tasks.sourceFailures.map(row => row.job_id), ['job-b']);
  assert.equal(core.state.tasks.hasMore, true);
  assert.equal(core.state.tasks.sourceFailuresHasMore, false);
  assert.equal(core.state.tasks.read.items.complete, false);
  assert.equal(core.state.tasks.read.sourceFailures.complete, true);
  assert.equal(core.state.tasks.loaded, true);
  assert.equal(core.state.tasks.error, null);
});

test('malformed task pages preserve previous rows and refuse complete coverage', async () => {
  let malformed = false;
  const core = harness(async () => {
    if (malformed) return { items: [], has_more: false };
    return { items: [{ job_id: 'job-a', source_version: 'src', plan_version: 1 }], has_more: false, source_failures: [], source_failures_has_more: false };
  });
  await core.tasks();
  malformed = true;
  await assert.rejects(core.tasks({ status: 'failed' }), /incomplete/);
  assert.deepEqual(core.state.tasks.items.map(row => row.job_id), ['job-a']);
  assert.equal(core.state.tasks.read.items.complete, false);
  assert.equal(core.state.tasks.read.sourceFailures.complete, false);
});

test('nonadvancing task cursors are rejected without an inferred terminal page', async () => {
  const core = harness(async () => ({
    items: [{ job_id: 'job-a', source_version: 'src', plan_version: 1 }],
    has_more: true,
    next_offset: 0,
    source_failures: [],
    source_failures_has_more: false
  }));
  await assert.rejects(core.tasks(), /cursor did not advance/);
  assert.equal(core.state.tasks.loaded, false);
  assert.equal(core.state.tasks.read.items.complete, false);
});

test('task load more advances both lists until both are terminal without duplicate rows', async () => {
  const offsets = [];
  const pages = new Map([
    [0, {
      items: [{ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }],
      has_more: true,
      next_offset: 1,
      source_failures: [{ job_id: 'job-x' }],
      source_failures_has_more: true,
      source_failures_next_offset: 1
    }],
    [1, {
      items: [{ job_id: 'job-b', source_version: 'src-b', plan_version: 2 }],
      has_more: false,
      next_offset: null,
      source_failures: [{ job_id: 'job-y' }],
      source_failures_has_more: true,
      source_failures_next_offset: 2
    }],
    [2, {
      items: [{ job_id: 'job-b', source_version: 'src-b', plan_version: 2 }],
      has_more: false,
      next_offset: null,
      source_failures: [{ job_id: 'job-z' }],
      source_failures_has_more: false,
      source_failures_next_offset: null
    }]
  ]);
  const core = harness(async (action, params) => {
    offsets.push(params.offset);
    return pages.get(params.offset);
  });
  await core.tasks();
  await core.tasks({ more: true });
  assert.deepEqual(offsets, [0, 1, 2]);
  assert.deepEqual(core.state.tasks.items.map(row => row.job_id), ['job-a', 'job-b']);
  assert.deepEqual(core.state.tasks.sourceFailures.map(row => row.job_id), ['job-x', 'job-y', 'job-z']);
  assert.equal(core.state.tasks.read.items.complete, true);
  assert.equal(core.state.tasks.read.sourceFailures.complete, true);
});

test('task load more stays loading and coalesces duplicate clicks until terminal', async () => {
  const second = deferred();
  let reads = 0;
  const core = harness(async (action, params) => {
    reads++;
    if (params.offset === 0) return { items: [{ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }], has_more: true, next_offset: 1, source_failures: [], source_failures_has_more: false };
    return second.promise;
  });
  await core.tasks();
  const more = core.tasks({ more: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(core.state.tasks.loading, true);
  assert.equal(core.state.tasks.read.items.loading, true);
  const duplicate = core.tasks({ more: true });
  assert.equal(reads, 2);
  second.resolve({ items: [{ job_id: 'job-b', source_version: 'src-b', plan_version: 2 }], has_more: false, source_failures: [], source_failures_has_more: false });
  assert.equal(await more, await duplicate);
  assert.equal(core.state.tasks.loading, false);
});

test('matching task reads coalesce while newer reads protect against stale task pages', async () => {
  const slow = deferred();
  let reads = 0;
  const core = harness(async (action, params) => {
    reads++;
    if (params.status === 'failed') return slow.promise;
    return { items: [{ job_id: 'job-new', source_version: 'src-new', plan_version: 2 }], has_more: false, source_failures: [], source_failures_has_more: false };
  });
  const first = core.tasks({ status: 'failed' });
  const second = core.tasks({ status: 'failed' });
  assert.equal(reads, 1);
  await core.tasks({ status: 'pending' });
  slow.resolve({ items: [{ job_id: 'job-old', source_version: 'src-old', plan_version: 1 }], has_more: false, source_failures: [], source_failures_has_more: false });
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.deepEqual(core.state.tasks.items.map(row => row.job_id), ['job-new']);
  assert.equal(core.state.tasks.status, 'pending');
});

test('failed current task read preserves rows and marks both channels incomplete', async () => {
  let fail = false;
  const core = harness(async () => {
    if (fail) throw Error('task read offline');
    return { items: [{ job_id: 'job-a', source_version: 'src', plan_version: 1 }], has_more: false, source_failures: [], source_failures_has_more: false };
  });
  await core.tasks();
  fail = true;
  await assert.rejects(core.tasks({ more: true }), /task read offline/);
  assert.deepEqual(core.state.tasks.items.map(row => row.job_id), ['job-a']);
  assert.equal(core.state.tasks.loading, false);
  assert.equal(core.state.tasks.loaded, false);
  assert.equal(core.state.tasks.error, 'task read offline');
  assert.equal(core.state.tasks.read.items.complete, false);
  assert.equal(core.state.tasks.read.sourceFailures.complete, false);
});

test('existing task retry posts source and plan versions with the operator reason', async () => {
  const posts = [];
  const core = harness(async (action, params) => record(params.job_id, 3, 'src-a'), async (action, body) => {
    posts.push({ action, body: { ...body } });
    return { status: 'pending', retry: 'accepted' };
  });
  const result = await core.retryTask({ job_id: 'job-a', source_version: 'src-a', plan_version: 3 }, 'operator checked source');
  assert.deepEqual(posts, [{
    action: 'dispatch_retry_task',
    body: { job_id: 'job-a', request_id: '00000000-0000-4000-8000-000000000001', reason: 'operator checked source', source_version: 'src-a', plan_version: 3 }
  }]);
  assert.equal(result.retry, 'accepted');
  const retry = core.state.taskRetries.get('task:job-a:src-a:3');
  assert.equal(retry.running, false);
  assert.equal(retry.result.retry, 'accepted');
  assert.equal(retry.reason, 'operator checked source');
});

test('source-failure retry omits task versions', async () => {
  const posts = [];
  const core = harness(async () => ({}), async (action, body) => {
    posts.push({ action, body: { ...body } });
    return { status: 'resolved' };
  });
  await core.retryTask({ job_id: 'job-source', source_version: 'ignored', plan_version: 4 }, 'source fixed', { sourceFailure: true });
  assert.deepEqual(posts, [{
    action: 'dispatch_retry_task',
    body: { job_id: 'job-source', request_id: '00000000-0000-4000-8000-000000000001', reason: 'source fixed' }
  }]);
  assert.equal(core.state.taskRetries.get('source_failure:job-source').result.status, 'resolved');
});

test('uncertain task retry stores the exact envelope and replays it explicitly', async () => {
  const posts = [];
  const core = harness(async (action, params) => record(params.job_id, 1, 'src-a'), async (action, body) => {
    posts.push({ action, body: { ...body } });
    if (posts.length === 1) throw Error('network uncertain');
    return { status: 'pending' };
  });
  await assert.rejects(core.retryTask({ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }, 'retry safely'), /network uncertain/);
  const key = 'task:job-a:src-a:1';
  assert.equal(core.state.taskRetries.get(key).uncertain, true);
  await core.retryTaskRequest(key);
  assert.deepEqual(posts[1], posts[0]);
  assert.equal(core.state.taskRetries.get(key).uncertain, false);
  assert.equal(core.state.taskRetries.get(key).result.status, 'pending');
});

test('uncertain task retry blocks a fresh request id until the original is replayed', async () => {
  const posts = [];
  const core = harness(async (action, params) => record(params.job_id, 1, 'src-a'), async (action, body) => {
    posts.push({ ...body });
    throw Error('network uncertain');
  });
  await assert.rejects(core.retryTask({ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }, 'first reason'), /network uncertain/);
  await assert.rejects(core.retryTask({ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }, 'changed reason'), /uncertain task request/);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].request_id, '00000000-0000-4000-8000-000000000001');
});

test('pending task retry preflight blocks duplicate clicks before posting', async () => {
  const pendingRead = deferred();
  let posts = 0;
  const core = harness(async (action, params) => pendingRead.promise, async () => { posts++; });
  const first = core.retryTask({ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }, 'retry once');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(core.retryTask({ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }, 'retry twice'), /already pending/);
  assert.equal(core.state.taskRetries.get('task:job-a:src-a:1').envelope.request_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(posts, 0);
  pendingRead.resolve(record('job-a', 1, 'src-a'));
  await first;
  assert.equal(posts, 1);
});

test('existing task retry holds without posting when assessment sources changed', async () => {
  let posts = 0;
  const core = harness(async (action, params) => record(params.job_id, 2, 'new-source'), async () => { posts++; });
  await assert.rejects(core.retryTask({ job_id: 'job-a', source_version: 'old-source', plan_version: 1 }, 'retry'), /Assessment sources changed/);
  assert.equal(posts, 0);
  const retry = core.state.taskRetries.get('task:job-a:old-source:1');
  assert.equal(retry.refusal, true);
  assert.equal(retry.envelope.job_id, 'job-a');
  assert.equal(retry.envelope.reason, 'retry');
  assert.equal(retry.error, 'Assessment sources changed; refresh status before retrying this task.');
});

test('definite task retry refusal exposes refusal reason without uncertain replay', async () => {
  const core = harness(async (action, params) => record(params.job_id, 1, 'src-a'), async () => {
    throw Object.assign(Error('Source and plan version must identify the same task'), { status: 409 });
  });
  await assert.rejects(core.retryTask({ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }, 'retry stale'), /Source and plan version/);
  const retry = core.state.taskRetries.get('task:job-a:src-a:1');
  assert.equal(retry.refusal, true);
  assert.equal(retry.uncertain, false);
  assert.equal(retry.error, 'Source and plan version must identify the same task');
  await assert.rejects(core.retryTaskRequest('task:job-a:src-a:1'), /Only an uncertain task retry/);
});

test('task retry requires a reason and existing task versions', async () => {
  let posts = 0;
  const core = harness(async () => ({}), async () => { posts++; });
  await assert.rejects(core.retryTask({ job_id: 'job-a', source_version: 'src-a', plan_version: 1 }, '  '), /Retry reason/);
  await assert.rejects(core.retryTask({ job_id: 'job-a', source_version: 'src-a' }, 'retry'), /source and plan versions/);
  assert.equal(posts, 0);
});
