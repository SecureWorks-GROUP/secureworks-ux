const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = require('./ops-sales-booking.js');
const performance = require('./ops-sales-performance.js');
const repairEvent = require('./sales-booking-repair-event.cjs');

function sampleRead(resource) {
  return {
    ok: true,
    fixture: false,
    send_hold: true,
    resource: {
      id: resource || 'nithin',
      name: 'Nithin',
      scoper_user_id: '5862cf1d-0a3b-4836-8fd1-d69f95aa2f73',
      calendar: { ok: true, mailbox: 'nithin@secureworkswa.com.au', can_edit: true, leave: 'not_read' }
    },
    week_start: '2026-09-14',
    coverage: { operational_leave: 'not_read', non_primary_calendars: 'not_read', full_population: false, gaps: [] },
    events: [{
      event_id: 'evt-1',
      case_id: 'evt-1',
      subject: 'Scope visit',
      display_name: 'Sample visit',
      suburb: 'City Beach',
      start_iso: '2026-09-15T11:30:00',
      end_iso: '2026-09-15T12:30:00',
      layer: 'confirmed'
    }],
    cases: [{
      id: 'case-a',
      contact_id: 'contact-a',
      display_name: 'Sample A',
      suburb: 'Carlisle',
      status: 'ready',
      reason: 'Customer window, not acceptance.',
      proposal: {
        start_iso: '2026-09-17T13:00:00',
        end_iso: '2026-09-17T14:00:00',
        offer_id: 'off-a',
        window_start_iso: '2026-09-17T13:00:00',
        window_end_iso: '2026-09-17T17:00:00',
        window_label: 'Thursday after 13:00',
        draft: 'Hi, Thursday 1:00pm works.'
      }
    }, {
      id: 'evt-1',
      contact_id: null,
      display_name: 'Sample visit',
      suburb: 'City Beach',
      status: 'booked',
      reason: 'Provider event',
      proposal: null
    }]
  };
}

test('monday of the proof week stays 14 Sep 2026', () => {
  assert.equal(api.mondayIso('2026-09-14'), '2026-09-14');
  assert.equal(api.mondayIso('2026-09-16'), '2026-09-14');
});

test('real durations drive block height math', () => {
  assert.equal(api.durationHours('2026-09-15T11:30:00', '2026-09-15T12:30:00'), 1);
  assert.equal(api.durationHours('2026-09-18T10:00:00', '2026-09-18T10:45:00'), 0.75);
});

test('send hold refuses the provider send and records the intended recipient', () => {
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  const result = api.attemptApprove();
  assert.equal(result.sent, false);
  assert.equal(result.held, true);
  assert.equal(api.state.lastSendCall.contact_id, 'contact-a');
  assert.equal(api.state.lastSendCall.sender, '+61489267774');
});

test('resource switch uses configured scoper ids, not fictional calendars', () => {
  assert.equal(api.RESOURCES.nithin.scoper_user_id, '5862cf1d-0a3b-4836-8fd1-d69f95aa2f73');
  assert.equal(api.RESOURCES.marnin.scoper_user_id, '706c5258-70dd-483a-b36c-af6864b24498');
  assert.equal(api.RESOURCES.khairo.scoper_user_id, 'be6c2188-2b7b-49c7-b6e4-5b0d0deb6415');
  assert.equal(api.RESOURCES.nithin.sender, '+61489267774');
  assert.notEqual(api.RESOURCES.nithin.sender, '+61489267776');
});

test('fixture envelopes are refused', async () => {
  global.opsFetch = async () => ({ ok: true, fixture: true, events: [], cases: [] });
  api.state.request = 0;
  await api.load('nithin', '2026-09-14');
  assert.match(api.state.error, /Fixture fallback is refused/);
  assert.equal(api.state.data, null);
});

test('slower previous resource cannot replace the current workspace', async () => {
  let resolveOld;
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.opsFetch = (_action, params) => {
    if (params.resource === 'nithin') return new Promise((r) => { resolveOld = r; });
    return Promise.resolve(sampleRead('khairo'));
  };
  api.state.request = 0;
  const old = api.load('nithin', '2026-09-14');
  await api.load('khairo', '2026-09-14');
  resolveOld(sampleRead('nithin'));
  await old;
  assert.equal(api.state.resourceId, 'khairo');
});

test('opening a conversation is read-only and never posts a booking event', async () => {
  const posts = [];
  global.opsPost = (action, body) => { posts.push({ action, body }); };
  global.opsAuthHeaders = async () => ({ Authorization: 'Bearer t' });
  global._commsGHLBase = 'https://invalid.test/ghl-proxy';
  global.fetch = async () => ({ json: async () => ({ messages: [{ body: 'please cancel', direction: 'inbound', timestamp: '1' }] }) });
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.conversation.generation = 0;
  await api.loadConversation('contact-a', 'case-a');
  assert.equal(api.state.conversation.messages.length, 1);
  assert.equal(posts.length, 0);
  assert.equal(api.state.data.cases[0].status, 'ready');
});

test('a Jason-only diary subject still blocks the cancelled Marangaroo enquiry', () => {
  const events = [{
    event_id: 'evt-jason',
    subject: 'Scope: Jason',
    display_name: 'Jason',
    suburb: 'Marangaroo',
    start_iso: '2026-09-14T10:00:00'
  }, {
    event_id: 'evt-carlisle-booked',
    subject: 'Scope: Pat, Carlisle',
    display_name: 'Pat',
    suburb: 'Carlisle',
    start_iso: '2026-09-15T09:00:00'
  }];
  const row = { id: 'marangaroo', suburb: 'Marangaroo', status: 'repair', contact_id: 'ghl-1' };
  const built = {
    id: 'marangaroo',
    contact_id: 'ghl-1',
    display_name: 'Marangaroo enquiry',
    suburb: 'Marangaroo',
    status: 'ready',
    reason: 'AI proposal',
    event_id: null,
    proposal: { start_iso: '2026-09-14T12:00:00', end_iso: '2026-09-14T13:00:00' }
  };
  const joined = repairEvent.attachCancelledEnquiry(row, built, events);
  assert.equal(joined.event_id, 'evt-jason');
  assert.equal(joined.status, 'repair');
  assert.equal(api.caseLayer(joined), 'blocked');
  assert.match(api.stampBlockReason(joined), /Cancelled in the thread with the diary event still present/);
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.data.cases.push(joined);
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  const html = api.renderHTML();
  assert.doesNotMatch(html, /data-booking-stamp="keep" data-booking-stamp-id="marangaroo"/);
  assert.doesNotMatch(html, /data-booking-stamp="cut" data-booking-stamp-id="marangaroo"/);
  assert.match(html, /Marangaroo enquiry/);
  const open = repairEvent.attachCancelledEnquiry(
    { id: 'carlisle', suburb: 'Carlisle', status: 'ready' },
    { id: 'carlisle', suburb: 'Carlisle', status: 'ready', event_id: null, proposal: built.proposal },
    events
  );
  assert.equal(open.event_id, null);
  assert.equal(open.status, 'ready');
});

test('stale conversation response is ignored after a case switch', async () => {
  let resolveOld;
  global.opsAuthHeaders = async () => ({ Authorization: 'Bearer t' });
  global._commsGHLBase = 'https://invalid.test/ghl-proxy';
  global.fetch = async (url) => {
    if (url.includes('contact-a')) return new Promise((r) => { resolveOld = r; });
    return { json: async () => ({ messages: [{ body: 'new', direction: 'inbound', timestamp: '2' }] }) };
  };
  api.state.conversation.generation = 0;
  const first = api.loadConversation('contact-a');
  await api.loadConversation('contact-b');
  resolveOld({ json: async () => ({ messages: [{ body: 'stale-wrong-recipient', direction: 'inbound', timestamp: '1' }] }) });
  await first;
  assert.equal(api.state.conversation.contactId, 'contact-b');
  assert.doesNotMatch(JSON.stringify(api.state.conversation.messages), /stale-wrong-recipient/);
});

test('empty khairo week is coverage, not a fake free diary', () => {
  const html = (function () {
    api.state.data = {
      ok: true,
      fixture: false,
      resource: { id: 'khairo', name: 'Khairo', calendar: { ok: true, mailbox: 'khairo@secureworkswa.com.au', leave: 'not_read' } },
      coverage: { operational_leave: 'not_read', non_primary_calendars: 'not_read', full_population: false, gaps: [] },
      events: [],
      cases: []
    };
    api.state.error = null;
    api.state.resourceId = 'khairo';
    return api.renderHTML();
  })();
  assert.match(html, /Empty diary is not spare capacity/);
  assert.match(html, /khairo@secureworkswa.com.au/);
  assert.doesNotMatch(html, /Sample A/);
});

test('XSS in provider subjects is escaped', () => {
  api.state.data = sampleRead();
  api.state.data.events[0].subject = '<img src=x onerror=alert(1)>';
  api.state.data.events[0].display_name = '<img src=x onerror=alert(1)>';
  const html = api.renderHTML();
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
});

function classList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    toggle: (name, on) => {
      if (on === undefined) {
        if (set.has(name)) set.delete(name);
        else set.add(name);
      } else if (on) set.add(name);
      else set.delete(name);
    },
    contains: (name) => set.has(name)
  };
}

function hostElement(id, attrs) {
  const attributes = Object.assign({}, attrs);
  return {
    id: id || '',
    classList: classList(),
    style: {},
    innerHTML: '',
    dispatchEvent: () => true,
    getAttribute: (key) => (attributes[key] == null ? null : attributes[key]),
    setAttribute: (key, value) => { attributes[key] = String(value); },
    hasAttribute: (key) => attributes[key] != null
  };
}

function salesHost() {
  const viewSales = hostElement('viewSales');
  const viewToday = hostElement('viewToday');
  const bookingRoot = hostElement('salesBookingRoot');
  const performanceRoot = hostElement('salesPerformanceRoot');
  const desktopSales = hostElement('', { 'data-view': 'sales' });
  const mobileSales = hostElement('', { 'data-view': 'sales' });
  const perfTab = hostElement('', { 'data-sales-tab': 'performance' });
  const bookTab = hostElement('', { 'data-sales-tab': 'booking' });
  const body = hostElement('body');
  const byId = {
    viewSales,
    viewToday,
    salesBookingRoot: bookingRoot,
    salesPerformanceRoot: performanceRoot,
    salesWorkspaceSubnav: hostElement('salesWorkspaceSubnav'),
    jobDetailView: hostElement('jobDetailView')
  };
  return {
    viewSales,
    viewToday,
    bookingRoot,
    performanceRoot,
    desktopSales,
    mobileSales,
    perfTab,
    bookTab,
    body,
    document: {
      body,
      getElementById: (id) => byId[id] || null,
      querySelectorAll: (sel) => {
        if (sel === '.view') return [viewSales, viewToday];
        if (sel === '.header-nav button') return [desktopSales];
        if (sel === '.mobile-nav button') return [mobileSales];
        if (sel === '[data-view="sales"]') return [desktopSales, mobileSales];
        if (sel === '#salesWorkspaceSubnav [data-sales-tab]') return [perfTab, bookTab];
        return [];
      },
      addEventListener: () => {}
    }
  };
}

async function waitUntil(pred) {
  for (let i = 0; i < 30; i++) {
    if (pred()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('timed out waiting for host view');
}

test('showView loads Booking beside Performance and restores the last Sales tab', async () => {
  const host = salesHost();
  const store = {};
  const source = fs.readFileSync(require.resolve('../ops.html'), 'utf8');
  const start = source.indexOf('function showView(view)');
  const end = source.indexOf('\nvar _approvalsActiveTab', start);
  assert.ok(end > start, 'showView slice must include the Sales host');
  const prevDoc = global.document;
  const prevFetch = global.opsFetch;
  global.document = host.document;
  global.opsFetch = async (action) => {
    if (action === 'sales_booking_read') return sampleRead();
    if (action === 'sales_performance_read') {
      return { rows: [], week_start: '2026-08-31', week_starts: ['2026-08-31'], available_weeks: ['2026-08-31'], fetched_at: '2026-09-07T01:00:00Z' };
    }
    throw new Error('unexpected ' + action);
  };
  const ctx = {
    document: host.document,
    localStorage: {
      getItem: (key) => (store[key] == null ? null : store[key]),
      setItem: (key, value) => { store[key] = String(value); }
    },
    history: { replaceState: () => {} },
    SalesWorkspace: global.SalesWorkspace,
    jobDetailIsOpen: () => false,
    closeJobDetail: () => {},
    loadToday: () => {},
    loadCalendar: () => {},
    loadJobs: () => {},
    loadFinancials: () => {},
    loadMaterials: () => {},
    loadInbox: () => {},
    loadApprovals: () => {},
    updateJarvisSummary: () => {},
    setTimeout: () => 0
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  try {
    ctx.showView('booking');
    await waitUntil(() => api.state.data && !api.state.loading);
    assert.equal(api.state.subtab, 'booking');
    assert.ok(host.viewSales.classList.contains('active'));
    assert.ok(host.viewSales.classList.contains('sales-sub-booking'));
    assert.ok(host.desktopSales.classList.contains('active'));
    assert.ok(host.mobileSales.classList.contains('active'));
    assert.equal(host.bookTab.getAttribute('aria-selected'), 'true');
    assert.match(host.bookingRoot.innerHTML, /Sample A/);
    assert.equal(store.sw_ops_sales_tab, 'booking');

    ctx.showView('performance');
    await waitUntil(() => performance.state.data && !performance.state.loading);
    assert.equal(api.state.subtab, 'performance');
    assert.ok(host.viewSales.classList.contains('sales-sub-performance'));
    assert.match(host.performanceRoot.innerHTML, /Sales performance/);
    assert.equal(host.perfTab.getAttribute('aria-selected'), 'true');
    assert.ok(host.body.classList.contains('performance-view-active'));
    assert.equal(store.sw_ops_sales_tab, 'performance');

    ctx.showView('today');
    assert.ok(host.viewToday.classList.contains('active'));
    assert.equal(host.viewSales.classList.contains('active'), false);

    ctx.showView('sales');
    await waitUntil(() => performance.state.data && !performance.state.loading);
    assert.equal(api.state.subtab, 'performance');
    assert.equal(host.perfTab.getAttribute('aria-selected'), 'true');
    assert.ok(host.viewSales.classList.contains('active'));
    assert.ok(host.body.classList.contains('performance-view-active'));
    assert.match(host.performanceRoot.innerHTML, /Sales performance/);
    assert.match(host.bookingRoot.innerHTML, /Sample A/);
  } finally {
    global.document = prevDoc;
    global.opsFetch = prevFetch;
  }
});

test('booked cases stay on the default unscoped list; archived and completed do not', () => {
  api.state.filter = 'all';
  api.state.search = '';
  api.state.data = sampleRead();
  api.state.data.cases.push({ id: 'done', display_name: 'Scoped already', suburb: 'Test', status: 'ready', completed: true, contact_id: 'c-done' });
  api.state.data.cases.push({ id: 'parked', display_name: 'Parked', suburb: 'Test', status: 'ready', contact_id: 'c-park', archived: { reason: 'declined', restored: false } });
  const html = api.renderHTML();
  assert.match(html, /Sample visit/);
  assert.match(html, /Booked/);
  assert.doesNotMatch(html, /Scoped already/);
  assert.doesNotMatch(html, /Parked/);
});

test('selected case shows chat, draft and proposed time together', () => {
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.drafts = {};
  const html = api.renderHTML();
  assert.match(html, /Draft SMS/);
  assert.match(html, /GHL conversation/);
  assert.match(html, /Proposed time/);
  assert.match(html, /Approve offer \(held\)/);
  assert.match(html, /2026-09-17T13:00:00/);
  assert.doesNotMatch(html, /data-booking-archive/);
  assert.doesNotMatch(html, /data-booking-restore/);
  assert.doesNotMatch(html, />Archive</);
});

test('confirm booking is not offered without exact acceptance', () => {
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  assert.equal(api.actionKind(api.state.data.cases[0]), 'approve_offer');
  api.state.data.cases[0].exact_acceptance = true;
  api.state.data.cases[0].accepted_start_iso = api.state.data.cases[0].proposal.start_iso;
  api.state.data.cases[0].accepted_end_iso = api.state.data.cases[0].proposal.end_iso;
  api.state.data.cases[0].accepted_offer_id = api.state.data.cases[0].proposal.offer_id;
  assert.equal(api.actionKind(api.state.data.cases[0]), 'confirm_booking');
  const result = api.attemptApprove();
  assert.equal(result.booked, false);
  assert.equal(result.held, true);
});

test('time change revises an unedited draft and keeps a human edit with a conflict flag', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.drafts = {};
  const first = api.reviseProposedTime('2026-09-17T14:00:00');
  assert.equal(first.conflict, false);
  // The customer is promised an arrival window, never an exact minute (standing rule).
  assert.match(first.text, /between 2:00 and 3:30pm/);
  assert.doesNotMatch(first.text, /at 2:00pm/);
  assert.match(first.text, /Nithin/);
  assert.doesNotMatch(first.text, /\u2014/);
  api.state.drafts['case-a'].humanEdited = true;
  api.state.drafts['case-a'].text = 'Keep my wording';
  const second = api.reviseProposedTime('2026-09-17T15:00:00');
  assert.equal(second.conflict, true);
  assert.equal(api.state.drafts['case-a'].text, 'Keep my wording');
  assert.match(second.suggested, /between 3:00 and 4:30pm/);
});

test('render after unedited time change keeps the revised draft, not the old proposal text', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.drafts = {};
  api.reviseProposedTime('2026-09-17T14:00:00');
  const html = api.renderHTML();
  assert.match(html, /between 2:00 and 3:30pm/);
  assert.doesNotMatch(html, /Thursday 1:00pm works/);
});

test('changing an accepted slot invalidates Confirm booking', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.data.cases[0].proposal.start_iso = '2026-09-17T13:00:00';
  api.applyInboundReply('acceptance');
  assert.equal(api.actionKind(api.state.data.cases[0]), 'confirm_booking');
  const revised = api.reviseProposedTime('2026-09-17T14:00:00');
  assert.equal(revised.exact_acceptance, false);
  assert.equal(api.actionKind(api.state.data.cases[0]), 'approve_offer');
});

test('two requests for one contact keep separate human drafts', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.data.cases.push({
    id: 'case-b',
    contact_id: 'contact-a',
    display_name: 'Sample A request 2',
    suburb: 'Carlisle',
    status: 'ready',
    proposal: { start_iso: '2026-09-18T09:00:00', end_iso: '2026-09-18T10:00:00', draft: 'Second request draft' }
  });
  api.state.drafts = {};
  const firstCase = api.state.data.cases.find((c) => c.id === 'case-a');
  const secondCase = api.state.data.cases.find((c) => c.id === 'case-b');
  api.draftFor(firstCase).text = 'First request human';
  api.draftFor(firstCase).humanEdited = true;
  const second = api.draftFor(secondCase);
  assert.notEqual(second.text, 'First request human');
  assert.equal(api.draftKey(firstCase), 'case-a');
  assert.equal(api.draftKey(secondCase), 'case-b');
});

test('accepted offer stays on the calendar and cannot be archived before an event exists', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.applyInboundReply('acceptance');
  const html = api.renderHTML();
  assert.match(html, /event offer/);
  const blocked = api.archiveCase('declined', '');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'commitment_visible');
});

test('selecting a provider event with no contact clears the previous thread', () => {
  api.state.conversation = { contactId: 'contact-a', caseId: 'case-a', loading: false, error: null, messages: [{ body: 'previous customer', direction: 'inbound', timestamp: '1' }], generation: 3 };
  api.state.data = sampleRead();
  api.state.selectedId = 'evt-1';
  api.selectCase('evt-1');
  assert.equal(api.state.conversation.contactId, null);
  assert.equal(api.state.conversation.messages.length, 0);
  const html = api.renderHTML();
  assert.doesNotMatch(html, /previous customer/);
});

test('follow_up with a sent offer still occupies the calendar and cannot be archived', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.data.cases[0].status = 'follow_up';
  api.state.selectedId = 'case-a';
  const html = api.renderHTML();
  assert.match(html, /event offer/);
  const blocked = api.archiveCase('declined', '');
  assert.equal(blocked.ok, false);
});

test('accepted duration change invalidates confirm booking', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.data.cases[0].proposal.start_iso = '2026-09-17T13:00:00';
  api.state.data.cases[0].proposal.end_iso = '2026-09-17T13:30:00';
  api.applyInboundReply('acceptance');
  assert.equal(api.actionKind(api.state.data.cases[0]), 'confirm_booking');
  const sameStart = api.reviseProposedTime('2026-09-17T13:00:00');
  assert.equal(sameStart.end_iso, '2026-09-17T13:30:00');
  assert.equal(sameStart.exact_acceptance, true);
  const stretched = api.reviseProposedSlot('2026-09-17T13:00:00', '2026-09-17T14:00:00');
  assert.equal(stretched.exact_acceptance, false);
  assert.equal(api.actionKind(api.state.data.cases[0]), 'approve_offer');
});

test('Marnin Stratco line is a captain default of 776 that still names both sources', () => {
  // Captain ruling 2026-09-16 settled the 772-vs-776 disagreement for v1. It is a
  // recorded default the captain can flip, not code guessing a line, so both source
  // claims must survive on the record.
  api.state.resourceId = 'marnin';
  const route = api.resolveSender(api.RESOURCES.marnin);
  assert.equal(route.resolved, true);
  assert.equal(route.number, '+61489267776');
  assert.equal(api.RESOURCES.marnin.sender_default.by, 'captain');
  assert.equal(api.RESOURCES.marnin.sender_default.flippable, true);
  assert.equal(api.RESOURCES.marnin.sender_candidates.length, 2);
  assert.ok(api.RESOURCES.marnin.sender_candidates.some((c) => c.number === '+61489267772'));
  assert.equal(api.CAPTAIN_DEFAULTS.stratco_sender_line, '776');
  // A resolved line is still not permission to send.
  api.state.data = sampleRead('marnin');
  api.state.selectedId = 'case-a';
  const result = api.attemptApprove();
  assert.equal(result.reason, 'send_hold');
  assert.equal(result.sent, false);
  assert.equal(result.held, true);
});

test('inbound replies leave waiting and pick the matching simple action', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.data.cases[0].status = 'waiting';
  api.state.data.cases[0].exact_acceptance = false;
  api.state.data.cases[0].event_id = 'evt-keep';
  const accepted = api.applyInboundReply('acceptance');
  assert.equal(accepted.status, 'needs_decision');
  assert.equal(accepted.action, 'confirm_booking');
  assert.notEqual(accepted.status, 'waiting');
  api.state.data.cases[0].status = 'follow_up';
  const declined = api.applyInboundReply('new_availability');
  assert.equal(declined.status, 'ready');
  assert.equal(declined.action, 'approve_offer');
  const cancelled = api.applyInboundReply('cancellation');
  assert.equal(cancelled.status, 'repair');
  assert.equal(cancelled.action, 'repair');
  assert.equal(cancelled.event_id, 'evt-keep');
});

test('held or uncertain approve does not become Waiting for reply', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.data.cases[0].status = 'ready';
  const held = api.attemptApprove();
  assert.equal(held.waiting, false);
  assert.equal(api.state.data.cases[0].status, 'ready');
  assert.equal(api.state.data.cases[0].send_evidence, 'held');
  const failed = api.markSendResult('failed');
  assert.equal(failed.waiting, false);
  assert.equal(api.state.data.cases[0].status, 'ready');
  const sent = api.markSendResult('sent');
  assert.equal(sent.waiting, true);
});

test('archive does not delete the GHL contact and cannot hide an outstanding offer', () => {
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.data.cases[0].status = 'waiting';
  const blocked = api.archiveCase('declined', '');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'commitment_visible');
  assert.equal(blocked.crm_deleted, false);
  assert.equal(api.state.data.cases[0].contact_id, 'contact-a');
  api.state.data.cases[0].status = 'ready';
  api.state.data.cases[0].event_id = null;
  const ok = api.archiveCase('declined', 'customer said no');
  assert.equal(ok.ok, true);
  assert.equal(ok.crm_deleted, false);
  assert.equal(ok.contact_id, 'contact-a');
  const restored = api.restoreCase('case-a');
  assert.equal(restored.ok, true);
  assert.equal(restored.crm_deleted, false);
});

test('opsFetch for the workspace uses the signed-in token', async () => {
  const source = fs.readFileSync(require.resolve('../ops.html'), 'utf8');
  const start = source.indexOf('async function opsAuthHeaders(');
  const end = source.indexOf('\nasync function opsPost', start);
  assert.ok(end > start);
  const ctx = {
    cloud: { auth: { getAccessToken: async () => 'synthetic-staff-token' } },
    _opsApiBase: 'https://invalid.test/ops-api',
    fetch: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-staff-token');
      assert.match(url, /sales_booking_read/);
      return { ok: true, json: async () => sampleRead() };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  await ctx.opsFetch('sales_booking_read', { resource: 'nithin', week_start: '2026-09-14' });
});

// ---------------------------------------------------------------------------
// The door design. These encode what the captain approved over three rounds, so
// expect to change them deliberately rather than route around them.
// ---------------------------------------------------------------------------

function doorRead() {
  const d = sampleRead();
  d.cases[0].enquiry_date = '2026-09-07';
  d.cases[0].address = '18 Riverbank Rd';
  d.cases[0].job = 'Flat patio, 6 x 4';
  d.diary = [{ start: '2026-09-17T08:00:00', end: '2026-09-17T09:00:00', title: 'Dentist', kind: 'personal', source: 'outlook' }];
  d.thread_facts = { 'case-a': { quiet_window: '5 days', classification: 'no_reply', read_ok: true } };
  return d;
}

test('every customer send, approval, confirmation and diary write renders held', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.selectedId = 'case-a';
  const html = api.renderHTML();
  assert.match(html, /Send message \(held\)/);
  assert.match(html, /Approve offer \(held\)/);
  assert.match(html, /does not send, approve, confirm or write a diary/);
  // No enabled path to a provider write exists on the surface.
  assert.doesNotMatch(html, /data-booking-approve="1"(?![^>]*disabled)/);
  assert.doesNotMatch(html, /data-booking-confirm="1"(?![^>]*disabled)/);
  // And the held handler still refuses if a click reaches it anyway.
  const result = api.attemptApprove();
  assert.equal(result.sent, false);
  assert.equal(result.held, true);
});

test('a stamp records a captain decision and is never a send or a calendar write', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.selectedId = 'case-a';
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  const keep = api.stampCase('case-a', 'keep');
  assert.equal(keep.sent, false);
  assert.equal(keep.wrote_calendar, false);
  assert.equal(api.stampStateOf(api.state.data.cases[0]), 'keep');
  const rec = api.stampRecord();
  assert.deepEqual(rec.approved, ['opp:case-a']);
  assert.deepEqual(rec.rejected, []);
  assert.equal(rec.sent, false);
  assert.equal(rec.calendar_written, false);
  assert.equal(rec.week_start, '2026-09-14');
  // KEEP then CUT replaces the decision rather than stacking two.
  api.stampCase('case-a', 'cut');
  const cut = api.stampRecord();
  assert.deepEqual(cut.approved, []);
  assert.deepEqual(cut.rejected, ['opp:case-a']);
  api.stampCase('case-a', 'clear');
  assert.equal(api.stampStateOf(api.state.data.cases[0]), 'none');
});

test('switching scoper drops the stamp, so one scoper cannot be stamped into another', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.stamp = { approved: ['case-a'], rejected: [], decisions: {}, stage_moves: {} };
  global.opsFetch = async () => doorRead();
  api.switchResource('marnin');
  assert.deepEqual(api.state.stamp.approved, []);
  api.state.resourceId = 'nithin';
});

test('the five week layers each own a stage tag and can be switched off', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.selectedId = 'case-a';
  api.state.layers = { confirmed: true, proposal: true, offer: true, blocked: true, personal: true, availability: true };
  let html = api.renderHTML();
  assert.match(html, /data-booking-layer="blocked"/);
  assert.match(html, /data-booking-layer="personal"/);
  assert.match(html, /PROPOSED/);
  assert.match(html, /CONFIRMED/);
  assert.match(html, /PERSONAL/);
  api.state.layers.personal = false;
  html = api.renderHTML();
  assert.doesNotMatch(html, /PERSONAL/);
  api.state.layers.personal = true;
});

test('a cancelled thread whose diary event survives keeps the slot blocked, not free', () => {
  const c = { id: 'x', status: 'repair', event_id: 'evt-9', proposal: { start_iso: '2026-09-15T09:00:00' } };
  assert.equal(api.caseLayer(c), 'blocked');
  // Without the surviving event it is a repair to decide, not an occupied slot.
  assert.notEqual(api.caseLayer({ id: 'x', status: 'repair', proposal: c.proposal }), 'blocked');
});

test('the queue groups by stage and states an unread enquiry date rather than faking one', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  const groups = api.queueGroups().map((g) => g[0]);
  assert.deepEqual(groups, ['Scope to be booked', 'Scope booked', 'Visited, quote to send', 'Enumerated, not yet assessed']);
  const html = api.renderHTML();
  assert.match(html, /Came in Monday 7 September/);
  assert.match(html, /Flat patio, 6 x 4/);
  delete api.state.data.cases[0].enquiry_date;
  assert.equal(api.daysWaiting(api.state.data.cases[0]), null);
  assert.match(api.renderHTML(), /Enquiry date not read/);
});

test('follow-through tiles count the queue and name the captain window', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  const f = api.followThrough();
  assert.equal(f.to_book, 1);
  assert.equal(f.booked, 1);
  const html = api.renderHTML();
  assert.match(html, /Enquiries still to book/);
  assert.match(html, /Waiting on a reply/);
  assert.match(html, /Booked to quote this week/);
  assert.match(html, /Quotes to send/);
  assert.match(html, new RegExp(api.CAPTAIN_DEFAULTS.scopes_done_window));
});

test('v1 shows two scopers while Khairo stays configured for the flip', () => {
  assert.deepEqual(api.V1_SCOPERS, ['nithin', 'marnin']);
  assert.ok(api.RESOURCES.khairo);
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  const html = api.renderHTML();
  assert.match(html, /data-booking-resource-btn="nithin"/);
  assert.match(html, /data-booking-resource-btn="marnin"/);
  assert.doesNotMatch(html, /data-booking-resource-btn="khairo"/);
  assert.match(html, /Khairo later/);
});

test('the Stratco lane paints Tue and Fri only with the Canning Vale band protected', () => {
  api.state.resourceId = 'marnin';
  api.state.data = doorRead();
  api.state.data.resource.id = 'marnin';
  const html = api.renderHTML();
  assert.match(html, /Canning Vale band/);
  assert.match(html, /13:00 to 15:30 protected/);
  assert.match(html, /Not a Marnin day/);
  api.state.resourceId = 'nithin';
});

test('the backend diary[] contract and the preview events[] shape both paint', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  const rows = api.diary();
  assert.ok(rows.some((r) => r.layer === 'personal' && r.source === 'outlook'));
  assert.ok(rows.some((r) => r.layer === 'confirmed' && r.display_name === 'Sample visit'));
  // The same event arriving on both keys is one card, not two.
  api.state.data.diary.push({ event_id: 'evt-1', start: '2026-09-15T11:30:00', end: '2026-09-15T12:30:00', title: 'Sample visit', kind: 'busy' });
  assert.equal(api.diary().filter((r) => r.id === 'evt-1').length, 1);
});

test('the stamp file the terminal reads is shown verbatim and escaped', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.data.cases[0].display_name = '<img src=x onerror=alert(1)>';
  api.state.stamp = { approved: ['case-a'], rejected: [], decisions: {}, stage_moves: {} };
  const html = api.renderHTML();
  assert.match(html, /stamp\.json/);
  assert.match(html, /&quot;approved&quot;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('the stamp board holds back cases with nothing to stamp and says how many', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.data.cases.push({ id: 'no-slot', display_name: 'No slot yet', suburb: 'Bayswater', status: 'ready', proposal: null });
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  const html = api.renderHTML();
  // 'evt-1' is booked with no proposal and 'no-slot' has none either. Each withheld
  // line names its reason and its people rather than vanishing into a count.
  assert.match(html, /No proposed time on this case, so there is nothing to stamp/);
  assert.match(html, /They stay in the work queue/);
  assert.match(html, /No slot yet/);
  assert.match(html, /Sample visit/);
});

test('an enumerated CRM row is findable but is never counted or ranked as demand', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  // A bare opportunity row: no reason, no proposal, so the engine has not judged it.
  api.state.data.cases.push({ id: 'raw-1', display_name: 'Raw CRM row', suburb: 'Bayswater', status: 'needs_decision' });
  assert.equal(api.isAssessed(api.state.data.cases.find((c) => c.id === 'raw-1')), false);
  assert.equal(api.isAssessed(api.state.data.cases[0]), true);
  const f = api.followThrough();
  assert.equal(f.unassessed, 1);
  assert.equal(f.to_book, 1, 'the raw row must not inflate the demand tile');
  const groups = api.queueGroups();
  const toBook = groups.find((g) => g[0] === 'Scope to be booked')[1].map((c) => c.id);
  const raw = groups.find((g) => g[0] === 'Enumerated, not yet assessed')[1].map((c) => c.id);
  assert.ok(!toBook.includes('raw-1'));
  assert.deepEqual(raw, ['raw-1']);
  const html = api.renderHTML();
  // Still findable, never dressed up as urgent, and the tile says why it is not counted.
  assert.match(html, /Raw CRM row/);
  assert.match(html, /Not assessed/);
  assert.match(html, /1 more CRM rows are enumerated but not assessed/);
  assert.equal(api.urgency(api.state.data.cases.find((c) => c.id === 'raw-1'))[1], 'Not assessed');
});

test('a cancelled case does not leave its diary block reading as a confirmed booking', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  const ev = { id: 'evt-1', layer: 'confirmed', start_iso: '2026-09-15T11:30:00' };
  assert.equal(api.diaryLayerFor(ev), 'confirmed');
  // Customer cancelled in the thread; Outlook still holds the slot.
  api.state.data.cases[1].status = 'repair';
  api.state.data.cases[1].event_id = 'evt-1';
  assert.equal(api.diaryLayerFor(ev), 'blocked');
  const html = api.renderHTML();
  assert.match(html, /CANCELLED/);
  // The slot is still occupied, so the block is drawn rather than freed.
  assert.match(html, /class="ev blocked/);
  // A personal block is the provider's own statement and is never overridden.
  assert.equal(api.diaryLayerFor({ id: 'evt-1', layer: 'personal', start_iso: '2026-09-15T11:30:00' }), 'personal');
});

test('a desk rule states where work is offered and never overprints a real booking', () => {
  api.state.resourceId = 'marnin';
  api.state.data = doorRead();
  api.state.data.resource.id = 'marnin';
  // Tuesday 15 Sep is in the Stratco lane; the 17th (Thursday) is not.
  api.state.data.events = [];
  api.state.data.diary = [];
  let html = api.renderHTML();
  assert.match(html, /Not a Marnin day/, 'an empty off-lane day is hatched closed');
  // Now the provider actually has a visit booked on that off-lane day.
  api.state.data.events = [{ event_id: 'e9', display_name: 'Real visit', suburb: 'Alkimos', start_iso: '2026-09-17T09:00:00', end_iso: '2026-09-17T10:00:00', layer: 'confirmed' }];
  html = api.renderHTML();
  assert.match(html, /Outside the Marnin lane/);
  assert.match(html, /Stratco scopes are offered Tue and Fri/);
  assert.match(html, /Real visit/);
  api.state.resourceId = 'nithin';
});

test('an AI proposal with a coverage gap is stampable and shows the reason, not hidden', () => {
  // Captain ruling 2026-09-16: execution-ready gates Confirm booking alone. The stamp
  // board is KEEP/CUT over AI proposals, and the engine's refusal reason belongs on the
  // card as the why-stamp checklist.
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  const c = api.state.data.cases[0];
  c.exact_acceptance = false;
  c.proposal.date_source = 'ai_proposed';
  c.proposal.customer_date_specified = false;
  c.proposal.coverage_gaps = ['leave_unobserved', 'travel_unobserved'];
  c.proposal.warnings = ['AI-proposed date, customer date unspecified.'];
  c.proposal.execution_ready = false;
  c.proposal.stampable = true;
  c.review_reasons = ['Customer date unspecified. Any chosen day is an AI proposal, not a customer-stated date.'];

  const html = api.renderHTML();
  // The row is on the board, with KEEP and CUT live.
  assert.match(html, /data-booking-stamp="keep" data-booking-stamp-id="case-a"/);
  assert.match(html, /data-booking-stamp="cut" data-booking-stamp-id="case-a"/);
  // The refusal is shown as the checklist, not used to hide the row. Each fact appears
  // once, in its shortest wording; see the dedupe-by-topic test below.
  assert.match(html, /Coverage not read: leave_unobserved, travel_unobserved/);
  assert.match(html, /AI-proposed date\. The customer did not name this day\./);
  // Evidence chips carry the same facts in short form.
  assert.match(html, /class="chip warn">Coverage partial/);
  assert.match(html, /class="chip warn">AI date/);
  // A stamp still offers a time; it never claims a confirmation.
  assert.match(html, /this stamp offers a time\. It does not confirm one/);
  // And the stamp itself is still not a send.
  const res = api.stampCase('case-a', 'keep');
  assert.equal(res.sent, false);
  assert.equal(res.wrote_calendar, false);
});

test('a cancelled case with its diary event still present is never offered for stamping', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  const c = api.state.data.cases[0];
  c.status = 'repair';
  c.event_id = 'evt-live';
  assert.equal(api.caseLayer(c), 'blocked');
  const html = api.renderHTML();
  assert.doesNotMatch(html, /data-booking-stamp="keep" data-booking-stamp-id="case-a"/);
  assert.match(html, /Cancelled in the thread with the diary event still present/);
  assert.match(html, /blocked until the delete reads back/);
  // It is named, not silently dropped.
  assert.match(html, /Sample A/);
});

test('the stamp refuses a blocked or undated case in the handler, not only in the markup', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  const c = api.state.data.cases[0];
  c.status = 'repair';
  c.event_id = 'evt-live';
  const blocked = api.stampCase('case-a', 'keep');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'slot_blocked');
  assert.equal(blocked.sent, false);
  assert.deepEqual(api.stampRecord().approved, []);
  // A case with no proposed time has nothing to decide either.
  const undated = api.stampCase('evt-1', 'keep');
  assert.equal(undated.ok, false);
  assert.equal(undated.reason, 'no_proposed_time');
  assert.deepEqual(api.stampRecord().approved, []);
});

test('a cancelled booking still in the diary blocks that time for anyone, not just its own case', () => {
  // Standing rule: cancelled in thread with the event still present is a blocked slot
  // until the delete reads back. That is occupancy, so it holds against a different
  // customer proposed onto the same minutes.
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  // evt-1 (Tue 11:30 to 12:30) is cancelled but still in the diary.
  api.state.data.cases[1].status = 'repair';
  api.state.data.cases[1].event_id = 'evt-1';
  // A different enquiry is proposed onto the same minutes.
  api.state.data.cases[0].proposal.start_iso = '2026-09-15T12:00:00';
  api.state.data.cases[0].proposal.end_iso = '2026-09-15T13:00:00';
  const clash = api.blockingDiaryEvent(api.state.data.cases[0]);
  assert.ok(clash, 'the surviving cancelled event is found');
  assert.match(api.stampBlockReason(api.state.data.cases[0]), /still held by a cancelled booking/);
  const res = api.stampCase('case-a', 'keep');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'slot_still_held');
  assert.deepEqual(api.stampRecord().approved, []);
  const html = api.renderHTML();
  // Withheld from the board with the reason named, never silently dropped.
  assert.match(html, /still held by a cancelled booking/);
  assert.match(html, /Sample A/);
  assert.doesNotMatch(html, /data-booking-stamp="keep" data-booking-stamp-id="case-a"/);
  // Moving off the held minutes makes it stampable again.
  api.state.data.cases[0].proposal.start_iso = '2026-09-15T14:00:00';
  api.state.data.cases[0].proposal.end_iso = '2026-09-15T15:00:00';
  assert.equal(api.blockingDiaryEvent(api.state.data.cases[0]), null);
  assert.equal(api.stampBlockReason(api.state.data.cases[0]), null);
  assert.equal(api.stampCase('case-a', 'keep').ok, true);
});

test('the why-stamp checklist states each fact once, in its shortest wording', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.drafts = {};
  const c = api.state.data.cases[0];
  c.exact_acceptance = false;
  c.proposal.date_source = 'ai_proposed';
  c.proposal.customer_date_specified = false;
  c.proposal.coverage_gaps = ['leave_unobserved', 'travel_unobserved'];
  // The engine says the same two facts again in its own longer wording.
  c.proposal.warnings = [
    'Calendar, leave or travel coverage is missing. Not execution-ready. leave_unobserved,travel_unobserved',
    'AI-proposed date, customer date unspecified.'
  ];
  c.review_reasons = [
    'Calendar, leave or travel coverage is missing. Not execution-ready. leave_unobserved,travel_unobserved',
    'Customer named a weekday without a calendar date. A slot on that weekday is an AI proposal.',
    'Already quoted. Confirm whether this is a new request.'
  ];
  const list = api.stampChecklist(c);
  const topics = list.map((i) => api.checklistTopic(i.text));
  assert.equal(new Set(topics).size, topics.length, 'no topic is stated twice');
  assert.equal(topics.filter((t) => t === 'coverage').length, 1);
  assert.equal(topics.filter((t) => t === 'ai_date').length, 1);
  // The short derived wording wins over the engine's long one.
  assert.match(list.find((i) => api.checklistTopic(i.text) === 'coverage').text, /^Coverage not read:/);
  // A fact the derived lines do not cover still gets through verbatim.
  assert.ok(list.some((i) => /Already quoted/.test(i.text)));
});

test('every stamped line shows the text it would approve, not just the selected one', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.drafts = {};
  // Two stampable cases; neither is the selected one.
  api.state.data.cases.push({
    id: 'case-b', contact_id: 'contact-b', display_name: 'Second enquiry', suburb: 'Merriwa',
    status: 'ready', reason: 'Candidate slot for approval.',
    proposal: { start_iso: '2026-09-18T08:00:00', end_iso: '2026-09-18T09:00:00', offer_id: 'off-b', draft: 'Hi Second, Friday 18 September between 8:00 and 9:30am. Does that suit?' }
  });
  api.state.selectedId = null;
  const html = api.renderHTML();
  assert.match(html, /Hi Second, Friday 18 September between 8:00 and 9:30am/);
  assert.doesNotMatch(html, /No draft for this case/);
});

test('overlapping cards share the column so no proposal is hidden under another', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.layers = { confirmed: true, proposal: true, offer: true, blocked: true, personal: true, availability: true };
  const at = (id, start, end) => ({ block: { id, start_iso: start, end_iso: end }, kind: 'proposal' });
  // Three proposals on the same hour, plus one clear of them.
  const packed = api.packLanes([
    at('a', '2026-09-14T12:00:00', '2026-09-14T13:00:00'),
    at('b', '2026-09-14T12:00:00', '2026-09-14T13:00:00'),
    at('c', '2026-09-14T12:30:00', '2026-09-14T13:30:00'),
    at('d', '2026-09-14T16:00:00', '2026-09-14T17:00:00')
  ]);
  const byId = Object.fromEntries(packed.map((p) => [p.block.id, p.block]));
  assert.equal(packed.length, 4, 'every card survives');
  assert.equal(new Set([byId.a.lane, byId.b.lane, byId.c.lane]).size, 3, 'the clash gets three lanes');
  assert.equal(byId.a.lanes, 3);
  assert.equal(byId.d.lanes, 1, 'a card alone on its minutes keeps the full width');
  // A hidden layer is excluded rather than given a lane.
  api.state.layers.proposal = false;
  assert.equal(api.packLanes([at('a', '2026-09-14T12:00:00', '2026-09-14T13:00:00')]).length, 0);
  api.state.layers.proposal = true;
});

test('two proposals at the same time both render on the week', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  api.state.data.cases[0].proposal.start_iso = '2026-09-17T13:00:00';
  api.state.data.cases[0].proposal.end_iso = '2026-09-17T14:00:00';
  api.state.data.cases.push({
    id: 'case-c', contact_id: 'c3', display_name: 'Clashing enquiry', suburb: 'Balga',
    status: 'ready', reason: 'Candidate slot for approval.',
    proposal: { start_iso: '2026-09-17T13:00:00', end_iso: '2026-09-17T14:00:00', offer_id: 'off-c' }
  });
  const html = api.renderHTML();
  assert.match(html, /data-booking-case="case-a"[^>]*style="left:calc\(0%/);
  assert.match(html, /data-booking-case="case-c"[^>]*style="left:calc\(50%/);
  assert.match(html, /Clashing enquiry/);
});
