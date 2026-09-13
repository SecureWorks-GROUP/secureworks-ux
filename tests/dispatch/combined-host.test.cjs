const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'modules/ops-sales-host-provenance.json'), 'utf8'));
const opsHtml = fs.readFileSync(path.join(root, 'ops.html'), 'utf8');
const hostSource = fs.readFileSync(path.join(root, 'modules/ops-sales-host.js'), 'utf8');
const bookingSource = fs.readFileSync(path.join(root, 'modules/ops-sales-booking.js'), 'utf8');
const performanceSource = fs.readFileSync(path.join(root, 'modules/ops-sales-performance.js'), 'utf8');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'modules', file))).digest('hex');
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' found');
  const open = source.indexOf('{', start);
  assert.ok(open > start, name + ' body found');
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(name + ' body did not close');
}

function extractOpsNavigation() {
  return [
    extractFunction(opsHtml, 'jobDetailIsOpen'),
    extractFunction(opsHtml, 'showView'),
    extractFunction(opsHtml, 'restoreTab'),
    extractFunction(opsHtml, 'showSalesSub')
  ].join('\n');
}

function extractOpsTransport() {
  const start = opsHtml.indexOf('async function opsAuthHeaders');
  const end = opsHtml.indexOf('// Compatibility name retained', start);
  assert.ok(start > -1 && end > start, 'ops transport functions found');
  return opsHtml.slice(start, end);
}

function parseButtons(containerClass) {
  const start = opsHtml.indexOf('<div class="' + containerClass + '">');
  assert.ok(start >= 0, containerClass + ' found');
  const end = opsHtml.indexOf('</div>', start);
  assert.ok(end > start, containerClass + ' closes');
  const block = opsHtml.slice(start, end);
  return Array.from(block.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)).map(match => {
    const attrs = match[1];
    const view = (attrs.match(/data-view="([^"]+)"/) || [])[1] || null;
    const onclick = (attrs.match(/onclick="([^"]+)"/) || [])[1] || null;
    return { view, onclick, text: match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() };
  });
}

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(...items) { items.forEach(item => values.add(item)); },
    remove(...items) { items.forEach(item => values.delete(item)); },
    contains(item) { return values.has(item); },
    toggle(item, force) {
      const next = force === undefined ? !values.has(item) : !!force;
      if (next) values.add(item); else values.delete(item);
      return next;
    },
    values() { return Array.from(values).sort(); }
  };
}

function element(id, attrs = {}) {
  return {
    id,
    dataset: attrs.dataset || {},
    onclick: attrs.onclick || null,
    style: {},
    options: [],
    selectedIndex: 0,
    classList: classList(attrs.classes || []),
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name]; }
  };
}

function navigationHarness() {
  const headerButtonDefs = parseButtons('header-nav');
  const mobileButtonDefs = parseButtons('mobile-nav');
  const headerButtons = headerButtonDefs.map(button => element('header-' + button.view, { dataset: { view: button.view }, onclick: button.onclick }));
  const mobileButtons = mobileButtonDefs.map(button => element('mobile-' + button.view, { dataset: { view: button.view }, onclick: button.onclick }));
  const viewNames = Array.from(new Set(headerButtons.concat(mobileButtons).map(button => button.dataset.view).filter(Boolean)));
  const views = viewNames.map(view => element('view' + view.charAt(0).toUpperCase() + view.slice(1), { classes: view === 'today' ? ['active'] : [] }));
  const salesTabs = [
    element('sales-performance-tab', { dataset: { salesSub: 'performance' }, classes: ['sales-sub-tab', 'active'] }),
    element('sales-booking-tab', { dataset: { salesSub: 'booking' }, classes: ['sales-sub-tab'] })
  ];
  const byId = new Map([...views, ...headerButtons, ...mobileButtons, ...salesTabs].map(node => [node.id, node]));
  byId.set('jobDetailView', element('jobDetailView'));
  const storage = new Map();
  const salesShows = [];
  const context = {
    window: null,
    document: {
      body: { style: {} },
      getElementById(id) { return byId.get(id) || null; },
      querySelector(selector) {
        if (selector === '.sales-sub-tab.active') return salesTabs.find(tab => tab.classList.contains('active')) || null;
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        if (selector === '.view') return views;
        if (selector === '.header-nav button') return headerButtons;
        if (selector === '.mobile-nav button') return mobileButtons;
        if (selector === '.sales-sub-tab') return salesTabs;
        const viewMatch = selector.match(/^\[data-view="([^"]+)"\]$/);
        if (viewMatch) return headerButtons.concat(mobileButtons).filter(button => button.dataset.view === viewMatch[1]);
        const salesMatch = selector.match(/^\[data-sales-sub="([^"]+)"\]$/);
        if (salesMatch) return salesTabs.filter(tab => tab.dataset.salesSub === salesMatch[1]);
        return [];
      }
    },
    history: { replaceState(_state, _title, url) { context.window.location.hash = url; } },
    location: { hash: '' },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    DispatchOps: { setActive() {}, load() {} },
    OpsSalesHost: { show(tab) { salesShows.push(tab); } },
    loadToday() {},
    loadCalendar() {},
    loadJobs() {},
    loadFinancials() {},
    loadMaterials() {},
    loadMaterialsRecon() {},
    loadInbox() {},
    loadApprovals() {},
    updateJarvisSummary() {},
    closeJobDetail() {},
    openJobDetailByRef() {},
    setTimeout(fn) { fn(); }
  };
  context.window = context;
  vm.runInNewContext(extractOpsNavigation(), context);
  headerButtons.concat(mobileButtons).forEach(button => {
    button.click = function () {
      assert.ok(button.onclick, button.id + ' has executable onclick');
      vm.runInNewContext(button.onclick, context);
    };
  });
  return { context, headerButtons, mobileButtons, views, salesShows };
}

function salesHostHarness() {
  const notices = {};
  const inserted = [];
  const sales = element('viewSales');
  const bookingRoot = element('salesBookingRoot');
  const performanceRoot = element('salesPerformanceRoot');
  bookingRoot.parentNode = { insertBefore(node) { notices[node.id] = node; inserted.push(node.id); } };
  performanceRoot.parentNode = { insertBefore(node) { notices[node.id] = node; inserted.push(node.id); } };
  const shown = [];
  const listeners = [];
  const context = {
    SALES_BOOKING_PREVIEW_URL: 'http://127.0.0.1:4174/sales-booking-read',
    SALES_BOOKING_PREVIEW_API: 'http://127.0.0.1:4174/booking-api',
    SALES_PERFORMANCE_PREVIEW_URL: 'http://127.0.0.1:4174/sales-performance-read',
    SW_AUTH_GATE: {
      identity() { return { id: 'operator-a', org_id: 'org-a' }; },
      identityGuard() { return function assertVerifiedSalesIdentity() {}; }
    },
    document: {
      body: element('body'),
      addEventListener(type, handler) { listeners.push({ target: 'document', type, handler }); },
      getElementById(id) {
        if (id === 'viewSales') return sales;
        if (id === 'salesBookingRoot') return bookingRoot;
        if (id === 'salesPerformanceRoot') return performanceRoot;
        return notices[id] || null;
      },
      createElement() {
        return element('');
      }
    },
    addEventListener(type, handler) { listeners.push({ target: 'window', type, handler }); },
    SalesBooking: {
      state: { drafts: {}, request: 0, conversation: { generation: 0 } },
      selectCase(id) { shown.push(['select-case', id]); },
      show(tab) { shown.push(['booking', tab]); }
    },
    SalesPerformance: {
      state: { request: 0, loading: false, error: null, data: null, week: null },
      specs: [],
      adapt() { return { measures: {} }; },
      escape(value) { return String(value); },
      load() { shown.push(['performance', 'load']); }
    }
  };
  context.window = context;
  return { context, inserted, sales, shown };
}

function salesTransportHarness() {
  const calls = [];
  const token = deferred();
  let guardValid = true;
  let currentUser = { email: 'verified@example.test' };
  const context = {
    _opsApiBase: 'https://ops.example/functions/v1/ops-api',
    _opsUserEmail: 'sticky@example.test',
    cloud: {
      auth: {
        getAccessToken() { return token.promise; },
        getUser() { return currentUser; }
      }
    },
    DispatchOps: {
      identityGuard() {
        throw new Error('Sales transport must not use Dispatch identity');
      }
    },
    OpsSalesHost: {
      identityGuard() {
        return function assertSalesIdentity() {
          if (!guardValid) {
            const error = new Error('Sales auth identity changed');
            error.code = 'sales_identity_changed';
            throw error;
          }
        };
      }
    },
    fetch: async (url, options) => {
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, json: async () => ({ ok: true }) };
    }
  };
  context.window = context;
  vm.runInNewContext(extractOpsTransport(), context);
  return {
    context,
    calls,
    token,
    invalidate() { guardValid = false; },
    setCurrentUser(user) { currentUser = user; }
  };
}

test('copied Booking and Performance bytes match accepted 9dda and PR313 pins', () => {
  assert.equal(provenance.source_sha, '9dda1c49c133b488fd77e901e3a2da581bee4819');
  assert.equal(provenance.baseline_sha, 'f048ca533e4c9b375b3928710aacdbebd97f4bc9');
  assert.equal(provenance.backend_pin, '70d96b0e8790f7966ad34f6bf0a3e9c4c3a5a80b');
  assert.equal(provenance.performance_sha, '08d27c7b9a40a4270e4dbefe5062907e4b3c7505');
  assert.equal(provenance.backend_do_not_import, 'e828cf48');
  for (const [file, digest] of Object.entries(provenance.files)) {
    assert.equal(sha256(file), digest, file);
  }
});

test('mobile Sales navigation restores and mounts the verified Sales host', () => {
  const h = navigationHarness();
  const mobileSales = h.mobileButtons.find(button => button.dataset.view === 'sales');

  assert.ok(mobileSales);
  mobileSales.click();

  assert.ok(h.context.document.getElementById('viewSales').classList.contains('active'));
  assert.ok(mobileSales.classList.contains('active'));
  assert.equal(h.context.localStorage.getItem('sw_ops_tab'), 'sales');
  assert.deepEqual(h.salesShows, ['performance']);

  const hashed = navigationHarness();
  hashed.context.window.location.hash = '#sales';
  hashed.context.restoreTab();

  assert.ok(hashed.context.document.getElementById('viewSales').classList.contains('active'));
  assert.deepEqual(hashed.salesShows, ['performance']);

  const saved = navigationHarness();
  saved.context.window.location.hash = '';
  saved.context.localStorage.setItem('sw_ops_tab', 'sales');
  saved.context.restoreTab();

  assert.ok(saved.context.document.getElementById('viewSales').classList.contains('active'));
  assert.deepEqual(saved.salesShows, ['performance']);
});

test('showSalesSub does not bypass OpsSalesHost with a direct Booking fallback', () => {
  const calls = [];
  const tabs = [
    element('sales-performance-tab', { dataset: { salesSub: 'performance' }, classes: ['sales-sub-tab', 'active'] }),
    element('sales-booking-tab', { dataset: { salesSub: 'booking' }, classes: ['sales-sub-tab'] })
  ];
  const context = {
    window: null,
    document: {
      querySelectorAll(selector) { return selector === '.sales-sub-tab' ? tabs : []; },
      querySelector(selector) { return selector === '[data-sales-sub="booking"]' ? tabs[1] : null; }
    },
    SalesBooking: { show(tab) { calls.push(tab); } }
  };
  context.window = context;
  vm.runInNewContext(extractFunction(opsHtml, 'showSalesSub'), context);

  context.showSalesSub('booking');

  assert.ok(tabs[1].classList.contains('active'));
  assert.deepEqual(calls, []);
});

test('host strips preview globals and mounts accepted Booking 9dda without 4174/4175', async () => {
  const { context, inserted, sales, shown } = salesHostHarness();
  vm.runInNewContext(hostSource, context);
  context.OpsSalesHost.show('booking');

  assert.equal(!!context.SALES_BOOKING_PREVIEW_URL, false);
  assert.equal(!!context.SALES_BOOKING_PREVIEW_API, false);
  assert.equal(!!context.SALES_PERFORMANCE_PREVIEW_URL, false);
  assert.ok(sales.classList.contains('sales-sub-booking'));
  assert.ok(!sales.classList.contains('sales-sub-performance'));
  assert.deepEqual(inserted.sort(), ['salesBookingHostNotice', 'salesPerformanceHostNotice']);
  assert.deepEqual(shown, [['booking', 'booking']]);
  const notice = context.document.getElementById('salesBookingHostNotice').textContent;
  assert.match(notice, /9dda1c49/);
  assert.match(notice, /70d96b0e/);
  assert.match(notice, /e828cf48 is not imported/);
  assert.match(notice, /4174\/4175 preview is not connected/);
  context.OpsSalesHost.show('performance');
  assert.deepEqual(shown, [['booking', 'booking'], ['booking', 'performance']]);
});

test('Sales transport aborts when identity changes while auth token is pending', async () => {
  const h = salesTransportHarness();
  const result = h.context.opsFetch('sales_performance_read', {}).then(
    () => null,
    error => error
  );
  await Promise.resolve();
  h.invalidate();
  h.token.resolve('token');
  const error = await result;

  assert.equal(error.code, 'sales_identity_changed');
  assert.equal(h.calls.length, 0);
});

test('Sales transport attributes writes to the current verified operator', async () => {
  const h = salesTransportHarness();
  h.setCurrentUser({ email: 'verified-writer@example.test' });
  h.token.resolve('token');
  await h.context.opsPost('sales_booking_draft', { case_id: 'case-a', body: 'draft' });

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://ops.example/functions/v1/ops-api?action=sales_booking_draft');
  assert.equal(h.calls[0].options.method, 'POST');
  assert.equal(h.calls[0].options.headers.Authorization, 'Bearer token');
  assert.equal(h.calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(h.calls[0].body.operator_email, 'verified-writer@example.test');
  assert.equal(h.calls[0].body.case_id, 'case-a');
});

test('Performance unpublished envelope keeps missing measures missing, not zero', async () => {
  const rootEl = { innerHTML: '', setAttribute() {}, dispatchEvent() {} };
  const context = {
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    document: {
      addEventListener() {},
      getElementById: id => id === 'salesPerformanceRoot' ? rootEl : null
    },
    opsFetch: async action => {
      assert.equal(action, 'sales_performance_read');
      return {
        ok: true,
        unpublished: true,
        storage_provenance: null,
        rows: [],
        week_starts: [],
        available_weeks: [],
        week_start: null,
        fetched_at: '2026-09-13T03:10:38.718631Z'
      };
    }
  };
  context.window = context;
  vm.runInNewContext(performanceSource, context);
  await context.SalesPerformance.load();
  assert.match(rootEl.innerHTML, /No week stored/);
  assert.match(rootEl.innerHTML, /has no report for this week/);
  assert.match(rootEl.innerHTML, /No report/);
  assert.doesNotMatch(rootEl.innerHTML, /class="v">0</);
  assert.doesNotMatch(rootEl.innerHTML, /class="funnel-value">0</);
});

test('Booking authenticated read refuses fixture fallback and does not use preview URLs', async () => {
  const rootEl = { innerHTML: '', setAttribute() {} };
  const context = {
    document: {
      addEventListener() {},
      getElementById: id => id === 'salesBookingRoot' ? rootEl : null
    },
    opsFetch: async action => {
      assert.equal(action, 'sales_booking_read');
      assert.equal(context.SALES_BOOKING_PREVIEW_URL, undefined);
      return { ok: false, error: 'Authenticated Booking handler is Patio-owned. 4174/4175 JSON preview is not connected.' };
    },
    opsPost: async () => { throw new Error('unexpected write'); }
  };
  context.window = context;
  vm.runInNewContext(bookingSource, context);
  await context.SalesBooking.load('nithin', '2026-09-14');
  assert.match(rootEl.innerHTML, /4174\/4175 JSON preview is not connected|Booking read was incomplete|Patio-owned/);
});
