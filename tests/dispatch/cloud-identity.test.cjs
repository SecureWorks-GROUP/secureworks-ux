const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function cloudHarness({ initialSession = { data: { session: null } } } = {}) {
  const events = [];
  const fetches = [];
  const sessions = [initialSession];
  let authCallback = null;
  const signOutGate = deferred();
  let signOutCalls = 0;
  const passwordReplies = [];
  const profileReplies = [];
  const sb = {
    auth: {
      getSession() {
        const next = sessions.length ? sessions.shift() : { data: { session: { access_token: 'token-latest' } } };
        return next && next.promise ? next.promise : Promise.resolve(next);
      },
      signInWithPassword(args) {
        const reply = passwordReplies.shift();
        if (reply) return reply.promise || Promise.resolve(reply);
        return Promise.resolve({ data: { user: { id: args.email, email: args.email } } });
      },
      signOut() { signOutCalls++; return signOutGate.promise; },
      onAuthStateChange(fn) { authCallback = fn; },
    },
    from() { throw new Error('unexpected table call'); },
    storage: { from() { throw new Error('unexpected storage call'); } },
  };
  const context = {
    URLSearchParams,
    SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_ANON_KEY: 'anon',
    supabase: { createClient() { return sb; } },
    navigator: { onLine: true },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      title: 'Ops',
      querySelector() { return null; },
      createElement() { return { style: {}, addEventListener() {}, remove() {}, set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html || ''; } }; },
      body: { appendChild() {} },
      getElementById() { return null; },
    },
    location: { href: 'https://app.example.test/ops.html', search: '' },
    addEventListener() {},
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(fn) { return fn(); },
    console: { log() {}, warn() {} },
    fetch(url, options) {
      const reply = profileReplies.shift() || deferred();
      fetches.push({ url, options, body: JSON.parse(options.body), reply });
      return reply.promise;
    },
  };
  context.window = context;
  context.window.top = context.window;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../shared/cloud.js'), 'utf8'), context);
  context.SECUREWORKS_CLOUD.on('auth:changing', detail => events.push({ event: 'auth:changing', detail: detail == null ? detail : JSON.parse(JSON.stringify(detail)) }));
  context.SECUREWORKS_CLOUD.on('auth:login', detail => events.push({ event: 'auth:login', detail: detail == null ? detail : JSON.parse(JSON.stringify(detail)) }));
  context.SECUREWORKS_CLOUD.on('auth:logout', detail => events.push({ event: 'auth:logout', detail }));
  return {
    context,
    events,
    fetches,
    passwordReplies,
    profileReplies,
    signOutGate,
    signedOut() { return signOutCalls; },
    pushSession(session) { sessions.push(session); },
    trigger(event, user) { return authCallback(event, user ? { user } : null); },
  };
}

function validProfile(user, extra = {}) {
  return Object.assign({ id: user.id, email: user.email, org_id: 'org-a', role: 'admin' }, extra);
}

function cloudGateHarness() {
  const events = [];
  const fetches = [];
  const profileReplies = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const elements = new Map();
  let authCallback = null;
  let signOutCalls = 0;
  let sessionReads = 0;

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
      elements.delete(this.id);
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
  }

  const head = new Element('head');
  const body = new Element('body');
  const main = new Element('main');
  main.id = 'mainApp';
  body.appendChild(main);

  const sb = {
    auth: {
      getSession() { return Promise.resolve({ data: { session: sessionReads++ === 0 ? null : { access_token: 'fixture-token' } } }); },
      signInWithPassword() { throw new Error('unexpected password signin'); },
      signOut() { signOutCalls++; return Promise.resolve({}); },
      onAuthStateChange(fn) { authCallback = fn; },
    },
    from() { throw new Error('unexpected table call'); },
    storage: { from() { throw new Error('unexpected storage call'); } },
  };
  const context = {
    URLSearchParams,
    SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_ANON_KEY: 'anon',
    supabase: { createClient() { return sb; } },
    navigator: { onLine: true },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      head,
      body,
      title: 'Ops',
      querySelector(selector) {
        if (selector === 'meta[name="sw-allowed-roles"]') return { content: 'admin' };
        if (selector === '.main-content' || selector === 'main') return main;
        return null;
      },
      createElement(tag) { return new Element(tag); },
      getElementById(id) { return elements.get(id) || null; },
      addEventListener(type, listener) { documentListeners.set(type, listener); },
      fire(type) { return documentListeners.get(type)?.(); },
    },
    location: { href: 'https://app.example.test/ops.html', search: '' },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    dispatchEvent(event) {
      events.push({ type: event.type, detail: event.detail == null ? event.detail : JSON.parse(JSON.stringify(event.detail)) });
      for (const listener of [...(windowListeners.get(event.type) || [])]) listener(event);
      return true;
    },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(fn) { return fn(); },
    console: { log() {}, warn() {} },
    fetch(url, options) {
      const reply = profileReplies.shift() || deferred();
      fetches.push({ url, options, body: JSON.parse(options.body), reply });
      return reply.promise;
    },
  };
  context.window = context;
  context.window.top = context.window;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../shared/cloud.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../shared/auth-gate.js'), 'utf8'), context);
  context.document.fire('DOMContentLoaded');
  return {
    context,
    events,
    fetches,
    profileReplies,
    signedOut() { return signOutCalls; },
    trigger(event, user) { return authCallback(event, user ? { user } : null); },
  };
}

test('stale initial session is ignored after a later auth transition', async () => {
  const initSession = deferred();
  const h = cloudHarness({ initialSession: initSession });
  h.pushSession({ data: { session: { access_token: 'token-b' } } });
  const profileB = deferred();
  h.profileReplies.push(profileB);
  const next = h.trigger('SIGNED_IN', { id: 'user-b', email: 'b@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  initSession.resolve({ data: { session: { user: { id: 'user-a', email: 'a@example.test' }, access_token: 'token-a' } } });
  profileB.resolve({ ok: true, json: async () => ({ profile: { id: 'user-b', email: 'b@example.test', org_id: 'org-b', role: 'admin' } }) });
  await next;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().id, 'user-b');
  assert.deepEqual(h.fetches.map(fetch => fetch.body), [{ userId: 'user-b', email: 'b@example.test' }]);
});

test('new auth identity emits changing before profile loading can complete', async () => {
  const h = cloudHarness();
  h.pushSession({ data: { session: { access_token: 'token-b' } } });
  const profile = deferred();
  h.profileReplies.push(profile);
  const pending = h.trigger('SIGNED_IN', { id: 'user-b', email: 'b@example.test' });
  assert.deepEqual(h.events, [{ event: 'auth:changing', detail: { id: 'user-b', email: 'b@example.test' } }]);
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.isLoggedIn(), true);
  profile.resolve({ ok: true, json: async () => ({ profile: { id: 'user-b', email: 'b@example.test', org_id: 'org-b', role: 'admin' } }) });
  await pending;
  assert.equal(h.events[1].event, 'auth:login');
  assert.equal(h.events[1].detail.id, 'user-b');
});

test('profile load failure keeps the session active but unverified', async () => {
  const h = cloudHarness();
  h.pushSession({ data: { session: { access_token: 'token-a' } } });
  const profile = deferred();
  h.profileReplies.push(profile);
  const pending = h.trigger('SIGNED_IN', { id: 'user-a', email: 'a@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  profile.resolve({ ok: false, json: async () => ({ error: 'profile unavailable' }) });
  await pending;

  assert.equal(h.context.SECUREWORKS_CLOUD.auth.isLoggedIn(), true);
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser(), null);
  assert.deepEqual(h.events, [{ event: 'auth:changing', detail: { id: 'user-a', email: 'a@example.test' } }]);
  assert.equal(h.signedOut(), 0);
});

test('mismatched or incomplete profiles are not accepted as verified identity', async () => {
  const cases = [
    { id: 'other-user', email: 'a@example.test', org_id: 'org-a', role: 'admin' },
    { id: 'user-a', email: 'a@example.test', role: 'admin' },
    { id: 'user-a', email: 'a@example.test', org_id: 'org-a' },
  ];

  for (const profile of cases) {
    const h = cloudHarness();
    h.pushSession({ data: { session: { access_token: 'token-a' } } });
    const reply = deferred();
    h.profileReplies.push(reply);
    const pending = h.trigger('SIGNED_IN', { id: 'user-a', email: 'a@example.test' });
    await new Promise(resolve => setImmediate(resolve));
    reply.resolve({ ok: true, json: async () => ({ profile }) });
    await pending;

    assert.equal(h.context.SECUREWORKS_CLOUD.auth.isLoggedIn(), true);
    assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser(), null);
    assert.deepEqual(h.events, [{ event: 'auth:changing', detail: { id: 'user-a', email: 'a@example.test' } }]);
    assert.equal(h.signedOut(), 0);
  }
});

test('auth gate stays locked after failed cloud profile and unlocks after recovery', async () => {
  const h = cloudGateHarness();
  const user = { id: 'user-a', email: 'a@example.test' };
  const failedProfile = deferred();
  h.profileReplies.push(failedProfile);
  const failed = h.trigger('SIGNED_IN', user);
  await new Promise(resolve => setImmediate(resolve));
  failedProfile.resolve({ ok: false, json: async () => ({ error: 'profile unavailable' }) });
  await failed;

  assert.equal(h.context.SECUREWORKS_CLOUD.auth.isLoggedIn(), true);
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser(), null);
  assert.equal(h.context.SW_AUTH_GATE.isUnlocked(), false);
  assert.equal(h.context.SW_AUTH_GATE.identity(), null);
  assert.equal(h.signedOut(), 0);

  const goodProfile = deferred();
  h.profileReplies.push(goodProfile);
  const recovered = h.trigger('SIGNED_IN', user);
  await new Promise(resolve => setImmediate(resolve));
  goodProfile.resolve({ ok: true, json: async () => ({ profile: validProfile(user) }) });
  await recovered;

  assert.equal(h.context.SW_AUTH_GATE.isUnlocked(), true);
  assert.equal(h.context.SW_AUTH_GATE.identity().id, 'user-a');
  assert.equal(h.context.SW_AUTH_GATE.identity().org_id, 'org-a');
  assert.equal(h.signedOut(), 0);
});

test('older profile success cannot overwrite a later signed-in user', async () => {
  const h = cloudHarness();
  h.pushSession({ data: { session: { access_token: 'token-a' } } });
  h.pushSession({ data: { session: { access_token: 'token-b' } } });
  const profileA = deferred();
  const profileB = deferred();
  h.profileReplies.push(profileA, profileB);
  const old = h.trigger('SIGNED_IN', { id: 'user-a', email: 'a@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  const next = h.trigger('SIGNED_IN', { id: 'user-b', email: 'b@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  profileB.resolve({ ok: true, json: async () => ({ profile: { id: 'user-b', email: 'b@example.test', org_id: 'org-b', role: 'admin' } }) });
  await next;
  profileA.resolve({ ok: true, json: async () => ({ profile: { id: 'user-a', email: 'a@example.test', org_id: 'org-a', role: 'admin' } }) });
  await old;
  assert.deepEqual(h.fetches.map(fetch => fetch.body), [
    { userId: 'user-a', email: 'a@example.test' },
    { userId: 'user-b', email: 'b@example.test' },
  ]);
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().id, 'user-b');
  assert.deepEqual(h.events.filter(event => event.event === 'auth:login').map(event => event.detail.id), ['user-b']);
});

test('profile request waits do not build a stale callback body from the newer user', async () => {
  const h = cloudHarness();
  const headerA = deferred();
  h.pushSession(headerA);
  h.pushSession({ data: { session: { access_token: 'token-b' } } });
  const profileB = deferred();
  h.profileReplies.push(profileB);
  const old = h.trigger('SIGNED_IN', { id: 'user-a', email: 'a@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  const next = h.trigger('SIGNED_IN', { id: 'user-b', email: 'b@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  headerA.resolve({ data: { session: { access_token: 'token-a' } } });
  profileB.resolve({ ok: true, json: async () => ({ profile: { id: 'user-b', email: 'b@example.test', org_id: 'org-b', role: 'admin' } }) });
  await Promise.all([old, next]);
  assert.deepEqual(h.fetches.map(fetch => fetch.body), [{ userId: 'user-b', email: 'b@example.test' }]);
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().id, 'user-b');
});

test('signout emits changing and clears identity before provider signout resolves', async () => {
  const h = cloudHarness();
  h.pushSession({ data: { session: { access_token: 'token-a' } } });
  const profile = deferred();
  h.profileReplies.push(profile);
  const login = h.trigger('SIGNED_IN', { id: 'user-a', email: 'a@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  profile.resolve({ ok: true, json: async () => ({ profile: { id: 'user-a', email: 'a@example.test', org_id: 'org-a', role: 'admin' } }) });
  await login;
  h.events.length = 0;
  const signOut = h.context.SECUREWORKS_CLOUD.auth.signOut();
  assert.deepEqual(h.events, [{ event: 'auth:changing', detail: null }]);
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.isLoggedIn(), false);
  h.signOutGate.resolve({});
  await signOut;
  assert.equal(h.events[1].event, 'auth:logout');
});

test('late password sign-in response cannot resurrect after signout', async () => {
  const h = cloudHarness();
  const password = deferred();
  h.passwordReplies.push(password);
  const signIn = h.context.SECUREWORKS_CLOUD.auth.signIn('old@example.test', 'secret');
  await new Promise(resolve => setImmediate(resolve));
  const signOut = h.context.SECUREWORKS_CLOUD.auth.signOut();
  await new Promise(resolve => setImmediate(resolve));
  password.resolve({ data: { user: { id: 'old-user', email: 'old@example.test' } } });
  await assert.rejects(signIn, /identity changed/);
  h.signOutGate.resolve({});
  await signOut;
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.isLoggedIn(), false);
  assert.deepEqual(h.events.filter(event => event.event === 'auth:login'), []);
});

test('late signout completion does not emit logout after a newer sign-in', async () => {
  const h = cloudHarness();
  h.pushSession({ data: { session: { access_token: 'token-a' } } });
  const profileA = deferred();
  h.profileReplies.push(profileA);
  const loginA = h.trigger('SIGNED_IN', { id: 'user-a', email: 'a@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  profileA.resolve({ ok: true, json: async () => ({ profile: { id: 'user-a', email: 'a@example.test', org_id: 'org-a', role: 'admin' } }) });
  await loginA;
  h.events.length = 0;
  const signOut = h.context.SECUREWORKS_CLOUD.auth.signOut();
  await new Promise(resolve => setImmediate(resolve));
  h.pushSession({ data: { session: { access_token: 'token-b' } } });
  const profileB = deferred();
  h.profileReplies.push(profileB);
  const loginB = h.trigger('SIGNED_IN', { id: 'user-b', email: 'b@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  profileB.resolve({ ok: true, json: async () => ({ profile: { id: 'user-b', email: 'b@example.test', org_id: 'org-b', role: 'admin' } }) });
  await loginB;
  h.signOutGate.resolve({});
  await signOut;
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().id, 'user-b');
  assert.deepEqual(h.events.filter(event => event.event === 'auth:logout'), []);
});

test('same identity token refresh keeps profile while the fresh match loads', async () => {
  const h = cloudHarness();
  h.pushSession({ data: { session: { access_token: 'token-a' } } });
  h.pushSession({ data: { session: { access_token: 'token-a2' } } });
  const profileA = deferred();
  const profileA2 = deferred();
  h.profileReplies.push(profileA, profileA2);
  const first = h.trigger('SIGNED_IN', { id: 'user-a', email: 'a@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  profileA.resolve({ ok: true, json: async () => ({ profile: { id: 'user-a', email: 'a@example.test', org_id: 'org-a', role: 'admin' } }) });
  await first;
  h.events.length = 0;
  const second = h.trigger('SIGNED_IN', { id: 'user-a', email: 'a@example.test' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().id, 'user-a');
  assert.deepEqual(h.events.filter(event => event.event === 'auth:changing'), []);
  profileA2.resolve({ ok: true, json: async () => ({ profile: { id: 'user-a', email: 'a@example.test', org_id: 'org-a', role: 'admin' } }) });
  await second;
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().id, 'user-a');
  assert.deepEqual(h.events.map(event => event.event), ['auth:login']);
});

test('failed same identity reverify clears stale verified profile without signing out', async () => {
  const h = cloudHarness();
  h.pushSession({ data: { session: { access_token: 'token-a' } } });
  h.pushSession({ data: { session: { access_token: 'token-a2' } } });
  const profileA = deferred();
  const profileA2 = deferred();
  h.profileReplies.push(profileA, profileA2);
  const user = { id: 'user-a', email: 'a@example.test' };
  const first = h.trigger('SIGNED_IN', user);
  await new Promise(resolve => setImmediate(resolve));
  profileA.resolve({ ok: true, json: async () => ({ profile: validProfile(user) }) });
  await first;
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().id, 'user-a');

  h.events.length = 0;
  const second = h.trigger('SIGNED_IN', user);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().id, 'user-a');
  assert.deepEqual(h.events, []);
  profileA2.resolve({ ok: false, json: async () => ({ error: 'profile unavailable' }) });
  await second;

  assert.equal(h.context.SECUREWORKS_CLOUD.auth.isLoggedIn(), true);
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser(), null);
  assert.deepEqual(h.events, [{ event: 'auth:changing', detail: { id: 'user-a', email: 'a@example.test' } }]);
  assert.equal(h.signedOut(), 0);
});


test('older same-user profile cannot restore a previous organisation', async () => {
  const h = cloudHarness();
  const oldProfile = deferred(), nextProfile = deferred();
  h.profileReplies.push(oldProfile, nextProfile);
  const user = { id: 'user-a', email: 'a@example.test' };
  const first = h.trigger('SIGNED_IN', user);
  await new Promise(resolve => setImmediate(resolve));
  const second = h.trigger('SIGNED_IN', user);
  await new Promise(resolve => setImmediate(resolve));
  nextProfile.resolve({ ok: true, json: async () => ({ profile: { ...user, org_id: 'new-org', role: 'admin' } }) });
  await second;
  oldProfile.resolve({ ok: true, json: async () => ({ profile: { ...user, org_id: 'old-org', role: 'admin' } }) });
  await first;
  assert.equal(h.context.SECUREWORKS_CLOUD.auth.getUser().org_id, 'new-org');
  assert.deepEqual(h.events.filter(event => event.event === 'auth:login').map(event => event.detail.org_id), ['new-org']);
});
