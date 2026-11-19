const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CEO_HTML = fs.readFileSync(path.join(ROOT, 'ceo.html'), 'utf8');
const CLOUD_JS = fs.readFileSync(path.join(ROOT, 'shared/cloud.js'), 'utf8');

function extractMainCeoScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const main = scripts.find((body) => body.includes('function unlockReport'));
  assert.ok(main, 'expected inline script containing unlockReport in ceo.html');
  return main;
}

const CEO_SCRIPT = extractMainCeoScript(CEO_HTML);

function makeMockClient(initialSession) {
  let currentSession = initialSession || null;
  const authListeners = [];
  const channels = [];

  const client = {
    auth: {
      async getSession() {
        return { data: { session: currentSession }, error: null };
      },
      onAuthStateChange(cb) {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signOut() {
        currentSession = null;
        return { error: null };
      },
      async signInWithOtp() {
        return { data: {}, error: null };
      },
    },
    channel(name) {
      const record = { name, bindings: [], subscribed: false };
      channels.push(record);
      const handle = {
        on(type, filter, handler) {
          record.bindings.push({ type, filter, handler });
          return handle;
        },
        subscribe() {
          record.subscribed = true;
          return handle;
        },
      };
      return handle;
    },
    _setSession(next) {
      currentSession = next;
    },
    _emitAuth(event, next) {
      currentSession = next;
      authListeners.forEach((cb) => cb(event, next));
    },
    _channels: channels,
  };

  return client;
}

function makeSandbox({ cloudClient = null, createClientImpl, loadCloudJs = false } = {}) {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        id,
        style: {},
        textContent: '',
        innerHTML: '',
        value: '',
        disabled: false,
        classList: {
          add(c) { classes.add(c); },
          remove(c) { classes.delete(c); },
          contains(c) { return classes.has(c); },
        },
        appendChild() {},
      });
    }
    return elements.get(id);
  };

  const store = new Map();
  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };

  const createdClients = [];
  const supabaseGlobal = {
    createClient(url, key) {
      const client = createClientImpl ? createClientImpl(url, key) : makeMockClient(null);
      createdClients.push({ url, key, client });
      return client;
    },
  };

  const document = {
    getElementById: getEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    getElementsByTagName: () => [],
    createElement: () => ({
      className: '',
      style: {},
      innerHTML: '',
      remove() {},
    }),
  };

  const windowObj = {
    SUPABASE_URL: 'https://zztest.example.invalid',
    SUPABASE_ANON_KEY: 'zztest-key',
    supabase: supabaseGlobal,
    location: { href: 'https://zztest.example.invalid/ceo.html', protocol: 'https:', search: '' },
    addEventListener: () => {},
    localStorage,
    document,
  };
  if (cloudClient) {
    windowObj.SECUREWORKS_CLOUD = { supabase: cloudClient };
  }

  const sandbox = {
    window: windowObj,
    self: windowObj,
    document,
    localStorage,
    navigator: { onLine: true },
    console: { log() {}, warn() {}, error() {} },
    Chart: { defaults: { font: {}, plugins: { legend: { labels: {} } } } },
    crypto: { randomUUID: () => 'zztest-uuid' },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    URL,
    URLSearchParams,
    Promise,
  };
  windowObj.window = windowObj;

  const ctx = vm.createContext(sandbox);
  if (loadCloudJs) {
    vm.runInContext(CLOUD_JS, ctx, { filename: 'shared/cloud.js' });
  }
  vm.runInContext(CEO_SCRIPT, ctx, { filename: 'ceo.html' });

  // Stub network/UI side effects so unlockReport tests stay pure and deterministic.
  const calls = { loadReport: 0, loadCeoAlerts: 0, toasts: [] };
  ctx.loadReport = () => { calls.loadReport += 1; };
  ctx.loadCeoAlerts = () => { calls.loadCeoAlerts += 1; };
  ctx.showToast = (message, type) => { calls.toasts.push({ message, type }); };

  return { ctx, windowObj, elements, getEl, createdClients, calls };
}

test('CEO live alerts channel reuses the shared cloud client and makes no createClient call', async () => {
  const session = {
    access_token: 'zztest-token-1',
    user: { id: 'zztest-u1', email: 'zztest-ceo@example.test' },
  };
  const sharedClient = makeMockClient(null);
  const { ctx, createdClients, getEl, calls } = makeSandbox({ cloudClient: sharedClient });

  ctx.CEO_EMAILS = ['zztest-ceo@example.test'];
  sharedClient._emitAuth('SIGNED_IN', session);
  // Flush microtasks from async unlockReport -> await getSession()
  await new Promise((r) => setImmediate(r));

  assert.equal(createdClients.length, 0, 'no fresh createClient call should be made when cloud.supabase exists');
  assert.equal(sharedClient._channels.length, 1, 'shared client should open one ceo-alerts channel');
  assert.equal(sharedClient._channels[0].name, 'ceo-alerts');
  assert.equal(sharedClient._channels[0].subscribed, true);
  assert.equal(sharedClient._channels[0].bindings.length, 1);
  assert.equal(sharedClient._channels[0].bindings[0].type, 'postgres_changes');
  assert.equal(sharedClient._channels[0].bindings[0].filter.event, 'INSERT');

  // Re-invoking unlockReport (e.g. from both getSession and INITIAL_SESSION) does not open a second channel.
  await ctx.unlockReport();
  assert.equal(sharedClient._channels.length, 1, 'should not subscribe twice');
  assert.equal(createdClients.length, 0);

  // Triggering a live alert payload updates alerts, shows a toast, and pulses the Jarvis icon.
  sharedClient._channels[0].bindings[0].handler({
    new: { severity: 'red', title: 'ZZTEST urgent item' },
  });
  assert.equal(calls.loadCeoAlerts, 1);
  assert.deepEqual(calls.toasts, [{ message: 'Critical alert: ZZTEST urgent item', type: 'warning' }]);
  assert.equal(getEl('jarvisIcon').classList.contains('pulse'), true);
});

test('with shared/cloud.js loaded, only one client is created in total and ceo-alerts uses it', async () => {
  const session = {
    access_token: 'zztest-token-2',
    user: { id: 'zztest-u2', email: 'zztest-ceo@example.test' },
  };
  const { ctx, windowObj, createdClients } = makeSandbox({
    loadCloudJs: true,
    createClientImpl: () => makeMockClient(null),
  });

  assert.equal(createdClients.length, 1, 'shared/cloud.js should create the only client');
  const sharedClient = createdClients[0].client;
  assert.equal(windowObj.SECUREWORKS_CLOUD.supabase, sharedClient);

  sharedClient._setSession(session);
  await ctx.unlockReport();

  assert.equal(createdClients.length, 1, 'unlockReport must not create a second client');
  assert.equal(sharedClient._channels.length, 1);
  assert.equal(sharedClient._channels[0].name, 'ceo-alerts');
  assert.equal(sharedClient._channels[0].subscribed, true);
});

test('when shared cloud client is absent, fallback client is reused without creating a second client', async () => {
  const session = {
    access_token: 'zztest-token-3',
    user: { id: 'zztest-u3', email: 'zztest-ceo@example.test' },
  };
  const { ctx, createdClients } = makeSandbox({
    createClientImpl: () => makeMockClient(session),
  });

  assert.equal(createdClients.length, 1, 'fallback creates one _supaAuth client');
  await ctx.unlockReport();

  assert.equal(createdClients.length, 1, 'unlockReport must reuse _supaAuth instead of creating a second client');
  const fallbackClient = createdClients[0].client;
  assert.equal(fallbackClient._channels.length, 1);
  assert.equal(fallbackClient._channels[0].name, 'ceo-alerts');
  assert.equal(fallbackClient._channels[0].subscribed, true);
});

test('does not subscribe when no session is present, and subscribes once a session exists', async () => {
  const sharedClient = makeMockClient(null);
  const { ctx, createdClients } = makeSandbox({ cloudClient: sharedClient });

  await ctx.unlockReport();
  assert.equal(sharedClient._channels.length, 0, 'must not subscribe without a session');
  assert.equal(createdClients.length, 0);

  sharedClient._setSession({
    access_token: 'zztest-token-4',
    user: { id: 'zztest-u4', email: 'zztest-ceo@example.test' },
  });
  await ctx.unlockReport();

  assert.equal(sharedClient._channels.length, 1, 'should subscribe once a session is present');
  assert.equal(sharedClient._channels[0].name, 'ceo-alerts');
  assert.equal(sharedClient._channels[0].subscribed, true);
  assert.equal(createdClients.length, 0);
});
