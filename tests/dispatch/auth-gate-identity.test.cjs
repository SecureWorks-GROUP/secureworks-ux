const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const own = value => JSON.parse(JSON.stringify(value));

function gateHarness({ profile, currentProfile = profile, allowed = 'admin', loggedIn = true, fire = true } = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const events = [];
  const order = [];
  const cloudListeners = new Map();
  let signedOut = 0;
  let loggedInState = loggedIn;
  let cloudProfile = currentProfile;

  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.listeners = new Map();
      this.textContent = '';
      this.disabled = false;
      this.value = '';
    }
    set id(value) { this._id = value; if (value) elements.set(value, this); }
    get id() { return this._id; }
    set cssText(value) { this._cssText = value; }
    get cssText() { return this._cssText || ''; }
    set innerHTML(value) {
      this._innerHTML = value;
      for (const match of String(value).matchAll(/id="([^"]+)"/g)) {
        const child = new Element('div');
        child.id = match[1];
        child.parentNode = this;
        this.children.push(child);
      }
    }
    get innerHTML() { return this._innerHTML || ''; }
    appendChild(child) { child.parentNode = this; this.children.push(child); if (child.id) elements.set(child.id, child); return child; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    remove() {
      if (this.id === 'swAuthGateStyle') order.push('reveal');
      elements.delete(this.id);
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
  }

  const head = new Element('head');
  const body = new Element('body');
  const main = new Element('main');
  main.id = 'mainApp';
  body.appendChild(main);

  const document = {
    head,
    body,
    activeElement: null,
    visibilityState: 'visible',
    createElement(tag) { return new Element(tag); },
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) {
      if (selector === 'meta[name="sw-allowed-roles"]') return allowed == null ? null : { content: allowed };
      if (selector === '.main-content' || selector === 'main') return main;
      return null;
    },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    fire(type) { return documentListeners.get(type)?.(); },
  };

  const cloud = {
    auth: {
      isLoggedIn() { return loggedInState; },
      getUser() { return cloudProfile; },
      signOut() { signedOut++; return Promise.resolve(); },
    },
    on(type, listener) { cloudListeners.set(type, listener); },
    emit(type, detail) { return cloudListeners.get(type)?.(detail); },
    setUser(nextProfile) { cloudProfile = nextProfile; },
    setLoggedIn(nextLoggedIn) { loggedInState = nextLoggedIn; },
    signedOut() { return signedOut; },
  };

  const context = {
    document,
    SECUREWORKS_CLOUD: cloud,
    setInterval() { return 1; },
    clearInterval() {},
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { windowListeners.get(type)?.delete(listener); },
    dispatchEvent(event) {
      events.push(event);
      order.push(event.type + ':' + JSON.stringify(event.detail ?? null));
      for (const listener of [...(windowListeners.get(event.type) || [])]) listener(event);
      return true;
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../shared/auth-gate.js'), 'utf8'), context);
  if (fire) document.fire('DOMContentLoaded');
  return { context, document, cloud, events, order };
}

test('verified identity event is synchronous and emitted before DOM unlock', () => {
  const profile = { id: 'user-1', org_id: 'org-1', role: 'admin' };
  const { context, order, events } = gateHarness({ profile });
  const identityIndex = order.findIndex(item => item === 'sw:auth-identity:{"id":"user-1","org_id":"org-1"}');
  const revealIndex = order.indexOf('reveal');
  const unlockedIndex = order.findIndex(item => item.startsWith('sw:auth-unlocked:'));

  assert.notEqual(identityIndex, -1);
  assert.notEqual(revealIndex, -1);
  assert.ok(identityIndex < revealIndex);
  assert.ok(revealIndex < unlockedIndex);
  assert.deepEqual(own(context.SW_AUTH_GATE.identity()), { id: 'user-1', org_id: 'org-1' });
  assert.equal(context.SW_AUTH_GATE.isUnlocked(), true);
  assert.deepEqual(own(events.find(event => event.type === 'sw:auth-identity' && event.detail)?.detail), { id: 'user-1', org_id: 'org-1' });
});

test('invalid or denied profiles do not unlock without verified user and org identity', () => {
  const missingOrg = gateHarness({ profile: { id: 'user-1', role: 'admin' } });
  assert.equal(missingOrg.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(missingOrg.context.SW_AUTH_GATE.identity(), null);
  assert.equal(missingOrg.events.some(event => event.type === 'sw:auth-unlocked'), false);
  assert.ok(missingOrg.document.getElementById('swAuthGateStyle'));
  assert.equal(missingOrg.cloud.signedOut(), 1);

  const denied = gateHarness({ profile: { id: 'user-2', org_id: 'org-1', role: 'field' }, allowed: 'admin' });
  assert.equal(denied.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(denied.context.SW_AUTH_GATE.identity(), null);
  assert.equal(denied.events.some(event => event.type === 'sw:auth-unlocked'), false);
  assert.ok(denied.document.getElementById('swAuthGateStyle'));
  assert.equal(denied.cloud.signedOut(), 1);

  const switched = gateHarness({ profile: null, loggedIn: false });
  switched.cloud.setLoggedIn(true);
  switched.cloud.setUser({ id: 'current-user', org_id: 'org-1', role: 'admin' });
  switched.cloud.emit('auth:login', { id: 'stale-user', org_id: 'org-1', role: 'admin' });
  assert.equal(switched.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(switched.context.SW_AUTH_GATE.identity(), null);
  assert.equal(switched.events.some(event => event.type === 'sw:auth-unlocked'), false);
  assert.ok(switched.document.getElementById('swAuthGateStyle'));
  assert.equal(switched.cloud.signedOut(), 1);
});

test('pending profile keeps the gate locked without signing out', () => {
  const run = gateHarness({ profile: null, loggedIn: true });

  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(run.context.SW_AUTH_GATE.identity(), null);
  assert.equal(run.events.some(event => event.type === 'sw:auth-unlocked'), false);
  assert.ok(run.document.getElementById('swAuthGateStyle'));
  assert.equal(run.cloud.signedOut(), 0);
});

test('delayed verified profile unlocks from the pending profile state', () => {
  const profile = { id: 'user-1', org_id: 'org-1', role: 'admin' };
  const run = gateHarness({ profile: null, currentProfile: null, loggedIn: true });
  run.cloud.setUser(profile);
  run.cloud.emit('auth:login', profile);

  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), true);
  assert.deepEqual(own(run.context.SW_AUTH_GATE.identity()), { id: 'user-1', org_id: 'org-1' });
  assert.equal(run.cloud.signedOut(), 0);
});

test('delayed null profile remains locked without signing out', () => {
  const run = gateHarness({ profile: null, loggedIn: true });
  run.cloud.emit('auth:login', null);

  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(run.context.SW_AUTH_GATE.identity(), null);
  assert.equal(run.events.some(event => event.type === 'sw:auth-unlocked'), false);
  assert.ok(run.document.getElementById('swAuthGateStyle'));
  assert.equal(run.cloud.signedOut(), 0);
});

test('delayed profile without the required role fails verification and stays locked', () => {
  const run = gateHarness({ profile: null, loggedIn: true });
  const denied = { id: 'user-1', org_id: 'org-1', role: 'estimator' };
  run.cloud.setUser(denied);
  run.cloud.emit('auth:login', denied);

  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(run.context.SW_AUTH_GATE.identity(), null);
  assert.equal(run.events.some(event => event.type === 'sw:auth-unlocked'), false);
  assert.equal(run.cloud.signedOut(), 1);
});

test('late prior user profile is denied from the pending profile state', () => {
  const current = { id: 'current-user', org_id: 'org-1', role: 'admin' };
  const prior = { id: 'prior-user', org_id: 'org-1', role: 'admin' };
  const run = gateHarness({ profile: null, currentProfile: null, loggedIn: true });
  run.cloud.setUser(current);
  run.cloud.emit('auth:login', prior);

  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(run.context.SW_AUTH_GATE.identity(), null);
  assert.equal(run.events.some(event => event.type === 'sw:auth-unlocked'), false);
  assert.ok(run.document.getElementById('swAuthGateStyle'));
  assert.equal(run.cloud.signedOut(), 1);
});

test('denied login event after unlock locks before signout completes', () => {
  const run = gateHarness({ profile: { id: 'user-1', org_id: 'org-1', role: 'admin' } });
  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), true);
  run.cloud.setUser({ id: 'field-user', org_id: 'org-1', role: 'field' });
  run.cloud.emit('auth:login', { id: 'field-user', org_id: 'org-1', role: 'field' });
  const nullIdentity = run.order.findLastIndex(item => item === 'sw:auth-identity:null');
  const lastSignout = run.cloud.signedOut();

  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(run.context.SW_AUTH_GATE.identity(), null);
  assert.ok(run.document.getElementById('swAuthGateStyle'));
  assert.ok(nullIdentity > -1);
  assert.equal(lastSignout, 1);
});

test('logout locks the gate and publishes null identity before locked event', () => {
  const run = gateHarness({ profile: { id: 'user-1', org_id: 'org-1', role: 'admin' } });
  run.cloud.emit('auth:logout');
  const nullIdentity = run.order.findLastIndex(item => item === 'sw:auth-identity:null');
  const locked = run.order.findLastIndex(item => item === 'sw:auth-locked:null');

  assert.notEqual(nullIdentity, -1);
  assert.notEqual(locked, -1);
  assert.ok(nullIdentity < locked);
  assert.equal(run.context.SW_AUTH_GATE.identity(), null);
  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.ok(run.document.getElementById('swAuthGateStyle'));
});

test('auth changing locks the gate before the next verified identity arrives', () => {
  const run = gateHarness({ profile: { id: 'user-1', org_id: 'org-1', role: 'admin' } });
  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), true);

  run.cloud.emit('auth:changing');

  assert.equal(run.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(run.context.SW_AUTH_GATE.identity(), null);
  assert.ok(run.document.getElementById('swAuthGateStyle'));
  assert.equal(run.order.at(-1), 'sw:auth-identity:null');
});

function extractOpsStartup() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../ops.html'), 'utf8');
  const start = html.indexOf('var _opsAppStarted = false;');
  const end = html.indexOf("if (document.readyState === 'loading')", start);
  assert.ok(start > -1 && end > start, 'ops startup functions found');
  return html.slice(start, end);
}

test('ops startup waits for verified auth-gate identity before loading private views', () => {
  const listeners = new Map();
  const cloudListeners = new Map();
  const calls = [];
  let unlocked = false;
  let identity = null;
  const context = {
    window: null,
    document: {
      getElementById() { return null; },
    },
    SECUREWORKS_CLOUD: {
      auth: { isLoggedIn() { return true; } },
      on(type, listener) { cloudListeners.set(type, listener); },
    },
    SW_AUTH_GATE: {
      isUnlocked() { return unlocked; },
      identity() { return identity; },
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
    loadCrewList() { calls.push('crew'); },
    restoreTab() { calls.push('restore'); },
    updateJarvisSummary() { calls.push('summary'); },
    setTimeout() { return 1; },
    console: { log() {} },
  };
  context.window = context;
  vm.runInNewContext(extractOpsStartup(), context);

  context.bootOpsApp();
  cloudListeners.get('auth:login')?.();
  assert.equal(context._opsAppStarted, false);
  assert.deepEqual(calls, []);

  unlocked = true;
  identity = { id: 'user-1', org_id: 'org-1' };
  context.dispatchEvent({ type: 'sw:auth-unlocked', detail: identity });

  assert.equal(context._opsAppStarted, true);
  assert.deepEqual(calls, ['crew', 'restore']);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function dispatchHost() {
  const listeners = new Map();
  return {
    innerHTML: '',
    isConnected: true,
    classList: { add() {} },
    dataset: {},
    contains() { return false; },
    getClientRects() { return [{}]; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
}

test('auth identity changes destroy Dispatch before late private reads can repaint', async () => {
  const userA = { id: 'user-a', org_id: 'org-1', role: 'admin', email: 'a@example.test' };
  const userB = { id: 'user-b', org_id: 'org-1', role: 'admin', email: 'b@example.test' };
  const run = gateHarness({ profile: userA, fire: false });
  const privateRead = deferred();
  let activeUser = 'a';
  let jobReads = 0;
  const calendarResult = { events: [], undated: [], coverage: { complete: true } };
  const privateRecord = {
    job: { id: 'private-a', job_number: 'PRIVATE-A', client_name: 'Private A', site_address: 'A site', work_type: 'fencing', eligibility: { state: 'accepted' } },
    version: 1,
    source_version: 'source-a',
    reviewed_source_version: 'source-a',
    groups: [],
    requirements: [],
    drafts: [{ id: 'draft-a', subject: 'Private A draft', body: 'private A body', sender: 'ops@example.test', to: ['supplier@example.test'], cc: [], attachments: [], status: 'draft' }],
    notes: [],
    allocations: [],
    receipts: [],
    purchase_orders: [],
    order_drafts: [],
    movements: [],
    media: [],
    documents: [],
    communications: [],
    communication_links: [],
    coverage: { complete: true },
  };

  Object.assign(run.context, {
    console: { error() {} },
    crypto: { randomUUID: () => 'uuid-test' },
    opsFetch(action) {
      if (action === 'dispatch_list') {
        return Promise.resolve({ jobs: activeUser === 'a'
          ? [privateRecord.job]
          : [{ id: 'job-b', job_number: 'JOB-B', client_name: 'Job B', site_address: 'B site', work_type: 'patio', eligibility: { state: 'accepted' } }], coverage: { complete: true } });
      }
      if (action === 'dispatch_calendar') return Promise.resolve(calendarResult);
      if (action === 'dispatch_execution') return Promise.resolve({ actions: [], capabilities: { release_hold: true }, coverage: { complete: true } });
      if (action === 'dispatch_job') {
        jobReads++;
        if (jobReads === 1) return Promise.resolve(JSON.parse(JSON.stringify(privateRecord)));
        if (jobReads === 2) return privateRead.promise;
        return Promise.reject(new Error('job B read unavailable'));
      }
      return Promise.reject(new Error('unexpected Dispatch read: ' + action));
    },
    opsPost() { return Promise.reject(new Error('unexpected Dispatch write')); },
  });

  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../modules/ops-dispatch-core.js'), 'utf8'), run.context);
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../modules/ops-dispatch.js'), 'utf8'), run.context);
  run.document.fire('DOMContentLoaded');

  const host = dispatchHost();
  const appA = run.context.DispatchOps.mount(host);
  await appA.load();
  assert.match(host.innerHTML, /PRIVATE-A/);
  const loadA = appA.core.load('private-a').catch(error => error);

  run.cloud.setLoggedIn(false);
  run.cloud.setUser(null);
  run.cloud.emit('auth:logout');

  assert.equal(host.innerHTML, '');
  assert.equal(appA.core.state.records.size, 0);
  assert.equal(run.context.SW_AUTH_GATE.identity(), null);

  activeUser = 'b';
  run.cloud.setLoggedIn(true);
  run.cloud.setUser(userB);
  run.cloud.emit('auth:login', userB);
  const appB = run.context.DispatchOps.mount(host);
  await appB.load().catch(() => null);

  assert.equal(host.innerHTML.includes('PRIVATE-A'), false);
  assert.equal(host.innerHTML.includes('private A body'), false);
  assert.equal(appB.core.state.records.has('private-a'), false);

  privateRead.resolve(privateRecord);
  await loadA;

  assert.equal(host.innerHTML.includes('PRIVATE-A'), false);
  assert.equal(host.innerHTML.includes('private A body'), false);
  assert.equal(appB.core.state.records.has('private-a'), false);
});
