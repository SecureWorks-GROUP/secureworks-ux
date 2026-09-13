const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function extractOpsTransport() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../ops.html'), 'utf8');
  const start = html.indexOf('async function opsAuthHeaders');
  const end = html.indexOf('// Compatibility name retained', start);
  assert.ok(start > -1 && end > start, 'ops transport functions found');
  return html.slice(start, end);
}

function transportContext({ token, guardAvailable = true } = {}) {
  const calls = [];
  const tokenGate = token || deferred();
  let guardValid = true;
  let currentUser = { email: 'current@example.test' };
  const context = {
    _opsApiBase: 'https://ops.example/functions/v1/ops-api',
    _opsUserEmail: 'sticky@example.test',
    cloud: {
      auth: {
        getAccessToken() { return tokenGate.promise; },
        getUser() { return currentUser; },
      },
    },
    DispatchOps: guardAvailable ? { identityGuard() { return function assertIdentity() {
      if (!guardValid) { const error = new Error('changed'); error.code = 'dispatch_identity_changed'; throw error; }
    }; } } : {},
    fetch: async (url, options) => {
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  };
  context.window = context;
  vm.runInNewContext(extractOpsTransport(), context);
  return {
    context,
    calls,
    tokenGate,
    invalidate() { guardValid = false; },
    setCurrentUser(user) { currentUser = user; },
  };
}

test('Dispatch opsFetch aborts before fetch when identity changes while token is pending', async () => {
  const h = transportContext();
  const result = h.context.opsFetch('dispatch_job', { job_id: 'job-a' }).then(
    () => null,
    error => error
  );
  await Promise.resolve();
  h.invalidate();
  h.tokenGate.resolve('new-token');
  const error = await result;

  assert.equal(error.code, 'dispatch_identity_changed');
  assert.equal(h.calls.length, 0);
});

test('Dispatch opsPost aborts before fetch when identity guard is unavailable', async () => {
  const token = deferred();
  token.resolve('token');
  const h = transportContext({ token, guardAvailable: false });
  const error = await h.context.opsPost('dispatch_command', { command: 'draft_upsert' }).then(
    () => null,
    err => err
  );

  assert.equal(error.code, 'dispatch_identity_changed');
  assert.equal(h.calls.length, 0);
});

test('guarded Dispatch opsPost attributes the current verified user, not sticky cached email', async () => {
  const token = deferred();
  token.resolve('token');
  const h = transportContext({ token });
  h.setCurrentUser({ email: 'verified@example.test' });
  await h.context.opsPost('dispatch_command', { command: 'draft_upsert' });

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.operator_email, 'verified@example.test');
});

function extractLoadCalendar() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../ops.html'), 'utf8');
  const start = html.indexOf('async function loadCalendar()');
  const end = html.indexOf('// <calendar-ops-core>', start);
  assert.ok(start > -1 && end > start, 'loadCalendar function found');
  return html.slice(start, end);
}

function extractCrewList() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../ops.html'), 'utf8');
  const start = html.indexOf('var CREW_NAME_MAP =');
  const end = html.indexOf('function renderCrewDropdown(', start);
  assert.ok(start > -1 && end > start, 'crew list functions found');
  return html.slice(start, end);
}


function extractOpenAssignmentModalForJob() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../ops.html'), 'utf8');
  const start = html.indexOf('function openAssignmentModalForJob(jobId)');
  const end = html.indexOf('// ── Hover Preview Popover', start);
  assert.ok(start > -1 && end > start, 'assignment modal callback found');
  return html.slice(start, end);
}

function extractPOJobList() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../ops.html'), 'utf8');
  const start = html.indexOf('var _poJobList = []');
  const end = html.indexOf('// ── Unified searchable job picker', start);
  assert.ok(start > -1 && end > start, 'PO job picker functions found');
  return html.slice(start, end);
}

test('loadCalendar ignores a late incumbent response after Dispatch identity changes', async () => {
  const calendarRead = deferred();
  let guardValid = true;
  let renderCount = 0;
  const body = { innerHTML: '' };
  const context = {
    _calEvents: [{ job_id: 'old' }],
    _calDeliveries: [{ id: 'old-po' }],
    _calReadiness: { old: true },
    _calOrgEvents: [{ id: 'old-org' }],
    _calTruncated: false,
    _unschedJobs: ['old-unscheduled'],
    _calAvailability: {},
    _calLeaveByDate: {},
    _crewList: [],
    document: { getElementById(id) { return id === 'calendarBody' ? body : null; } },
    getCalRange() { return { from: '2026-09-14', to: '2026-09-20' }; },
    DispatchOps: {
      loadMainCalendar() {},
      identityGuard() { return function assertIdentity() {
        if (!guardValid) { const error = new Error('changed'); error.code = 'dispatch_identity_changed'; throw error; }
      }; },
    },
    opsFetch(action) {
      if (action === 'calendar') return calendarRead.promise;
      throw new Error('unexpected enrichment read before calendar commit: ' + action);
    },
    initCalEventFilterChips() { throw new Error('should not initialize filters after identity change'); },
    renderCalendar() { renderCount++; },
    renderCalUnschedSidebar() {},
    renderCalSummary() {},
    console: { error() {} },
    showToast() { throw new Error('identity changes should not toast calendar failures'); },
  };
  context.window = context;
  vm.runInNewContext(extractLoadCalendar(), context);

  const load = context.loadCalendar();
  await Promise.resolve();
  guardValid = false;
  calendarRead.resolve({ events: [{ job_id: 'new' }], deliveries: [{ id: 'new-po' }], readiness: { new: true }, orgEvents: [{ id: 'new-org' }], truncated: true });
  await load;

  assert.deepEqual(context._calEvents, [{ job_id: 'old' }]);
  assert.deepEqual(context._calDeliveries, [{ id: 'old-po' }]);
  assert.deepEqual(context._calReadiness, { old: true });
  assert.deepEqual(context._calOrgEvents, [{ id: 'old-org' }]);
  assert.equal(context._calTruncated, false);
  assert.equal(renderCount, 0);
});

test('loadCalendar reloads verified crew before joining availability rows', async () => {
  const own = value => JSON.parse(JSON.stringify(value));
  const scenarios = [
    {
      availability: [{ user_id: 'crew-b', date: '2026-09-14', status: 'leave', note: 'RDO' }],
      expectedAvailability: { 'Crew B_2026-09-14': { status: 'leave', note: 'RDO' } },
      expectedLeaveByDate: { '2026-09-14': ['Crew B'] },
    },
    {
      availability: [],
      expectedAvailability: {},
      expectedLeaveByDate: {},
    },
  ];

  for (const scenario of scenarios) {
    const crewRead = deferred();
    const availabilityRead = deferred();
    const availabilityStarted = deferred();
    const repainted = deferred();
    let availabilityCalls = 0;
    let renderCount = 0;
    const context = {
      _crewList: [],
      _calEvents: [],
      _calDeliveries: [],
      _calReadiness: {},
      _calOrgEvents: [],
      _calTruncated: false,
      _unschedJobs: [],
      _calAvailability: { stale: { status: 'leave', note: 'old' } },
      _calLeaveByDate: { '2026-09-13': ['Old Crew'] },
      document: { getElementById(id) { return id === 'calendarBody' ? { innerHTML: '' } : null; } },
      getCalRange() { return { from: '2026-09-14', to: '2026-09-20' }; },
      DispatchOps: {
        loadMainCalendar() {},
        identityGuard() { return function assertIdentity() {}; },
      },
      opsFetch(action) {
        if (action === 'calendar') return Promise.resolve({ events: [], deliveries: [], readiness: {}, orgEvents: [], truncated: false });
        if (action === 'pipeline') return Promise.resolve({ columns: { accepted: [] } });
        if (action === 'list_users') return crewRead.promise;
        if (action === 'get_crew_availability') {
          availabilityCalls++;
          availabilityStarted.resolve();
          return availabilityRead.promise;
        }
        throw new Error('unexpected read: ' + action);
      },
      initCalEventFilterChips() {},
      renderCalendar() { renderCount++; if (renderCount === 2) repainted.resolve(); },
      renderCalUnschedSidebar() {},
      renderCalSummary() {},
      console: { error() {}, warn() {} },
      showToast() { throw new Error('calendar should not fail'); },
    };
    context.window = context;
    vm.runInNewContext(extractCrewList() + '\n' + extractLoadCalendar(), context);

    await context.loadCalendar();
    assert.equal(availabilityCalls, 0);

    crewRead.resolve({ users: [{ id: 'crew-b', name: 'Crew B', email: 'crew.b@example.test', role: 'installer' }] });
    await availabilityStarted.promise;
    assert.equal(availabilityCalls, 1);

    availabilityRead.resolve({ availability: scenario.availability });
    await repainted.promise;

    assert.deepEqual(own(context._crewList), [{ id: 'crew-b', name: 'Crew B', email: 'crew.b@example.test', role: 'installer', division: 'trade' }]);
    assert.deepEqual(own(context._calAvailability), scenario.expectedAvailability);
    assert.deepEqual(own(context._calLeaveByDate), scenario.expectedLeaveByDate);
    assert.equal(renderCount, 2);
  }
});

test('loadCrewList ignores stale prior identity completion without clearing newer crew', async () => {
  const oldRead = deferred();
  const newRead = deferred();
  let currentGeneration = 1;
  let calls = 0;
  const own = value => JSON.parse(JSON.stringify(value));
  const context = {
    _crewList: [],
    window: null,
    DispatchOps: {
      identityGuard() {
        const generation = currentGeneration;
        return function assertIdentity() {
          if (generation !== currentGeneration) {
            const error = new Error('changed');
            error.code = 'dispatch_identity_changed';
            throw error;
          }
        };
      },
    },
    opsFetch(action) {
      assert.equal(action, 'list_users');
      calls++;
      return calls === 1 ? oldRead.promise : newRead.promise;
    },
    console: { warn() { throw new Error('stale identity should not warn'); } },
  };
  context.window = context;
  vm.runInNewContext(extractCrewList(), context);

  const oldLoad = context.loadCrewList();
  await Promise.resolve();
  currentGeneration++;
  context._crewList = [];
  const newLoad = context.loadCrewList();
  newRead.resolve({ users: [{ id: 'crew-b', name: 'Crew B', email: 'crew.b@example.test', role: 'installer' }] });
  await newLoad;
  assert.deepEqual(own(context._crewList), [{ id: 'crew-b', name: 'Crew B', email: 'crew.b@example.test', role: 'installer', division: 'trade' }]);
  oldRead.resolve({ users: [{ id: 'crew-a', name: 'Private A', email: 'private.a@example.test', role: 'installer' }] });
  await oldLoad;
  assert.deepEqual(own(context._crewList), [{ id: 'crew-b', name: 'Crew B', email: 'crew.b@example.test', role: 'installer', division: 'trade' }]);
});

test('loadPOJobList ignores stale prior identity completion without clearing newer jobs', async () => {
  const oldRead = deferred();
  const newRead = deferred();
  let currentGeneration = 1;
  let calls = 0;
  const own = value => JSON.parse(JSON.stringify(value));
  const context = {
    window: null,
    DispatchOps: {
      identityGuard() {
        const generation = currentGeneration;
        return function assertIdentity() {
          if (generation !== currentGeneration) {
            const error = new Error('changed');
            error.code = 'dispatch_identity_changed';
            throw error;
          }
        };
      },
    },
    opsFetch(action) {
      assert.equal(action, 'pipeline');
      calls++;
      return calls === 1 ? oldRead.promise : newRead.promise;
    },
    console: { error() { throw new Error('stale identity should not log picker errors'); } },
  };
  context.window = context;
  vm.runInNewContext(extractPOJobList(), context);

  const oldLoad = context.loadPOJobList();
  await Promise.resolve();
  currentGeneration++;
  context._poJobList = [];
  const newLoad = context.loadPOJobList();
  newRead.resolve({ columns: { accepted: [{ id: 'job-b', client_name: 'Crew B job' }] } });
  await newLoad;
  assert.deepEqual(own(context._poJobList), [{ id: 'job-b', client_name: 'Crew B job' }]);
  oldRead.resolve({ columns: { accepted: [{ id: 'job-a', client_name: 'Private A job' }] } });
  await oldLoad;
  assert.deepEqual(own(context._poJobList), [{ id: 'job-b', client_name: 'Crew B job' }]);
});

test('openAssignmentModalForJob suppresses stale delayed preselect after identity changes', async () => {
  let currentGeneration = 1;
  let timer;
  const select = { value: '' };
  const context = {
    window: null,
    DispatchOps: {
      identityGuard() {
        const generation = currentGeneration;
        return function assertIdentity() {
          if (generation !== currentGeneration) {
            const error = new Error('changed');
            error.code = 'dispatch_identity_changed';
            throw error;
          }
        };
      },
    },
    openAssignmentModal() {},
    setTimeout(fn) { timer = fn; },
    document: { getElementById(id) { return id === 'assignJobSelect' ? select : null; } },
  };
  context.window = context;
  vm.runInNewContext(extractOpenAssignmentModalForJob(), context);

  context.openAssignmentModalForJob('job-a');
  currentGeneration++;
  timer();
  assert.equal(select.value, '');
});
