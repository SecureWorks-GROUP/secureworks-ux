const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const a = { id: 'operator-a', org_id: 'org-a' };
const b = { id: 'operator-b', org_id: 'org-a' };
const week = '2026-09-14';
const bookingData = name => ({ ok: true, cases: [{ id: 'case-1', display_name: name, contact_id: 'contact-1', status: 'follow_up' }], events: [], week_start: week });
const performanceData = () => ({ rows: [], week_start: null, week_starts: [], available_weeks: [], unpublished: true });

function host({ get, post, fetch, headers } = {}) {
  let actor = a;
  const winEvents = new Map(), docEvents = new Map(), nodes = new Map(), calls = [];
  const listen = map => (name, fn) => map.set(name, [...(map.get(name) || []), fn]);
  const emit = (map, name, event) => (map.get(name) || []).forEach(fn => fn(event));
  const document = { activeElement: null, addEventListener: listen(docEvents), getElementById: id => nodes.get(id) || null };
  function element(id) {
    let html = '';
    const classes = new Set();
    const node = {
      id, isConnected: true,
      classList: { add: value => classes.add(value), contains: value => classes.has(value), toggle(value, on) { if (on) classes.add(value); else classes.delete(value); } },
      setAttribute() {}, querySelector() { return null; }, contains() { return true; },
      parentNode: { insertBefore(child) { nodes.set(child.id, child); } },
      dispatchEvent(event) { emit(docEvents, event.type, event); },
      focus() { document.activeElement = node; },
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; if (id === 'salesPerformanceRoot' && nodes.has('salesPerformanceNotes')) nodes.get('salesPerformanceNotes').innerHTML = ''; },
    };
    return node;
  }
  document.createElement = () => element('');
  for (const id of ['viewSales', 'salesBookingRoot', 'salesPerformanceRoot', 'salesPerformanceNotes']) nodes.set(id, element(id));
  const detailPanel = element('detail-panel');
  nodes.get('salesPerformanceNotes').firstElementChild = detailPanel;
  document.body = element('body');
  const context = vm.createContext({ document, AbortController,
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    addEventListener: listen(winEvents), SW_AUTH_GATE: { identity: () => actor },
    opsFetch: async (action, params) => { calls.push({ action, params }); return get ? get(action, params) : action === 'sales_booking_read' ? bookingData('Private A') : performanceData(); },
    opsPost: async (action, body) => { calls.push({ action, body }); return post ? post(action, body) : { ok: true }; },
    opsAuthHeaders: headers || (async () => ({ Authorization: 'Bearer a' })),
    _commsGHLBase: 'https://example.test/conversation',
    fetch: fetch || (async () => ({ json: async () => ({ messages: [] }) }))
  });
  context.window = context;
  for (const file of ['ops-sales-performance.js', 'ops-sales-booking.js', 'ops-sales-host.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../modules', file), 'utf8'), context);
  }
  return { context, nodes, calls, document, detailPanel,
    identity(value) { actor = value; emit(winEvents, 'sw:auth-identity', { detail: value }); },
    emit(name, detail) { emit(docEvents, name, { detail }); },
    click(target) { emit(docEvents, 'click', { target, preventDefault() {} }); }
  };
}

for (const next of [b, { id: a.id, org_id: 'org-b' }]) {
  test(`Sales clears private state and late reads before ${next.id}/${next.org_id} unlocks`, async () => {
    const lateBooking = deferred(), latePerformance = deferred(), lateConversation = deferred();
    let hold = false, name = 'Private A';
    const h = host({ get: action => {
      if (hold) return action === 'sales_booking_read' ? lateBooking.promise : latePerformance.promise;
      return action === 'sales_booking_read' ? bookingData(name) : performanceData();
    }, fetch: () => lateConversation.promise });
    const booking = h.context.SalesBooking, performance = h.context.SalesPerformance;
    await booking.load();
    booking.state.selectedId = 'case-1';
    booking.state.drafts['case-1'] = { text: 'Private A wording', humanEdited: true };
    booking.state.archives.archived = { note: 'Private A reason' };
    booking.state.conversation.messages = [{ body: 'Private A message' }];
    booking.render();
    assert.match(h.nodes.get('salesBookingRoot').innerHTML, /Private A wording/);
    hold = true;
    const bookingRead = booking.load(), performanceRead = performance.load(), conversationRead = booking.loadConversation('contact-1', 'case-1');
    await Promise.resolve();
    h.identity(null);
    assert.equal(h.nodes.get('salesBookingRoot').innerHTML, '');
    assert.equal(h.nodes.get('salesPerformanceRoot').innerHTML, '');
    assert.equal(booking.state.data, null);
    assert.equal(JSON.stringify(booking.state.drafts), '{}');
    assert.equal(JSON.stringify(booking.state.archives), '{}');
    assert.equal(JSON.stringify(booking.state.conversation.messages), '[]');
    h.identity(next);
    hold = false; name = 'Current operator case';
    await booking.load();
    const currentMarkup = h.nodes.get('salesBookingRoot').innerHTML;
    lateBooking.resolve(bookingData('Late old actor'));
    latePerformance.resolve({ ...performanceData(), rows: [{ lane: 'patio', secret: 'Late old performance' }] });
    lateConversation.resolve({ json: async () => ({ messages: [{ body: 'Late old thread' }] }) });
    await Promise.all([bookingRead, performanceRead, conversationRead]);
    assert.equal(h.nodes.get('salesBookingRoot').innerHTML, currentMarkup);
    assert.equal(performance.state.data, null);
    assert.equal(JSON.stringify(booking.state.conversation.messages), '[]');
    assert.doesNotMatch(JSON.stringify(booking.state), /Private A|Late old/);
  });
}

test('identity reset cancels the old draft save queue before its acknowledgement arrives', async () => {
  const ack = deferred();
  const h = host({ post: () => ack.promise });
  const booking = h.context.SalesBooking;
  await booking.load();
  const row = booking.state.data.cases[0], draft = booking.draftFor(row);
  draft.text = 'First private wording';
  const saving = booking.persistDraftToServer(row, draft);
  draft.text = 'Queued private wording';
  booking.persistDraftToServer(row, draft);
  assert.equal(draft.saveQueue, true);
  h.identity(null); h.identity(b);
  ack.resolve({ ok: true, revision: 1 }); await saving;
  await Promise.resolve();
  assert.equal(h.calls.filter(call => call.action === 'sales_booking_draft').length, 1);
  assert.equal(JSON.stringify(booking.state.drafts), '{}');
  assert.equal(h.nodes.get('salesBookingRoot').innerHTML, '');
  assert.equal(row.draft, undefined);
});

test('same verified actor retains edits; sign-out invalidates guards even on return', async () => {
  const h = host(), booking = h.context.SalesBooking;
  await booking.load();
  booking.state.drafts['case-1'] = { text: 'Retained wording' };
  const guard = h.context.OpsSalesHost.identityGuard();
  h.identity({ ...a });
  guard();
  assert.equal(booking.state.drafts['case-1'].text, 'Retained wording');
  h.identity(null);
  const calls = h.calls.length;
  h.context.OpsSalesHost.show('booking');
  assert.equal(h.calls.length, calls);
  h.identity(a);
  assert.throws(guard, /identity changed/);
  assert.equal(JSON.stringify(booking.state.drafts), '{}');
});

test('Performance measure clicks expose missing evidence and restore focus on close', async () => {
  const h = host();
  await h.context.SalesPerformance.load();
  const trigger = {
    dataset: { lane: 'patio', performanceDrill: 'A1' }, isConnected: true,
    hasAttribute() { return false; }, matches() { return false; },
    closest(selector) { return selector.includes('[data-performance-drill]') ? trigger : null; },
    dispatchEvent(event) { h.emit(event.type, event.detail); },
    focus() { h.document.activeElement = trigger; }
  };
  h.click(trigger);
  const notes = h.nodes.get('salesPerformanceNotes');
  assert.match(notes.innerHTML, /Patio · Leads in/);
  assert.match(notes.innerHTML, /No report is published/);
  assert.match(notes.innerHTML, /evidence are unavailable/);
  assert.equal(h.document.activeElement, h.detailPanel);
  const close = { closest: selector => selector === '[data-performance-detail-close]' ? close : null };
  h.click(close);
  assert.equal(notes.innerHTML, '');
  assert.equal(h.document.activeElement, trigger);
  h.click(trigger);
  h.identity(null);
  assert.equal(notes.innerHTML, '');
});

test('Performance unpublished measure keeps its declared reason and escapes coverage facts', async () => {
  const h = host({ get: () => ({ rows: [{ lane: 'patio', week_start: week, metrics: {}, coverage: { gaps: ['<script>private coverage</script>'] } }], week_start: week, week_starts: [week] }) });
  await h.context.SalesPerformance.load();
  h.emit('sales-performance:drill', { lane: 'patio', measure: 'B2', week_start: week });
  const markup = h.nodes.get('salesPerformanceNotes').innerHTML;
  assert.match(markup, /Attendance evidence not published/);
  assert.match(markup, /&lt;script&gt;private coverage&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

function useAuthenticatedTransport(h, token = async () => 'operator-token') {
  h.context.cloud = { auth: { getAccessToken: token, getUser: () => ({ email: 'operator@example.test' }) } };
  h.context._opsUserEmail = null;
  h.context._opsApiBase = 'https://example.test/ops-api';
  const html = fs.readFileSync(path.join(__dirname, '../../ops.html'), 'utf8');
  const start = html.indexOf('async function opsAuthHeaders');
  vm.runInContext(html.slice(start, html.indexOf('// Compatibility name retained', start)), h.context);
}

test('a prior conversation waiting for credentials cannot fetch as the next operator', async () => {
  const token = deferred(), calls = [];
  const h = host({ fetch: async (...args) => { calls.push(args); return { json: async () => ({ messages: [] }) }; } });
  useAuthenticatedTransport(h, () => token.promise);
  const reading = h.context.SalesBooking.loadConversation('old-contact', 'old-case');
  h.identity(null); h.identity(b);
  token.resolve('next-operator-token');
  await reading;
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(h.context.SalesBooking.state.conversation.messages), '[]');
});

test('a late restore acknowledgement cannot restore a next-operator case with the same id', async () => {
  const ack = deferred(), started = deferred();
  const h = host({ fetch: async url => {
    if (url.includes('sales_booking_restore')) { started.resolve(); return { ok: true, json: () => ack.promise }; }
    return { ok: true, json: async () => ({ ...bookingData('Current case'), cases: [{ id: 'case-1', display_name: 'Current case', archived: { restored: false }, status: 'follow_up' }] }) };
  } });
  useAuthenticatedTransport(h);
  const booking = h.context.SalesBooking;
  await booking.load();
  const restoring = booking.restoreCase('case-1');
  await started.promise;
  h.identity(null); h.identity(b);
  await booking.load();
  ack.resolve({ ok: true, restored: true });
  const result = await restoring;
  assert.equal(result.ok, false);
  assert.equal(booking.state.data.cases[0].archived.restored, false);
});
