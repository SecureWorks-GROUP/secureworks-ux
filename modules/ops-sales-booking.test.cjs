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
  const viewApprovals = hostElement('viewApprovals');
  viewApprovals.style.display = 'flex';
  const bookingRoot = hostElement('salesBookingRoot');
  const performanceRoot = hostElement('salesPerformanceRoot');
  const desktopSales = hostElement('', { 'data-view': 'sales' });
  const mobileSales = hostElement('', { 'data-view': 'sales' });
  const desktopApprovals = hostElement('', { 'data-view': 'approvals' });
  const perfTab = hostElement('', { 'data-sales-tab': 'performance' });
  const bookTab = hostElement('', { 'data-sales-tab': 'booking' });
  const body = hostElement('body');
  const byId = {
    viewSales,
    viewToday,
    viewApprovals,
    salesBookingRoot: bookingRoot,
    salesPerformanceRoot: performanceRoot,
    salesWorkspaceSubnav: hostElement('salesWorkspaceSubnav'),
    jobDetailView: hostElement('jobDetailView')
  };
  return {
    viewSales,
    viewToday,
    viewApprovals,
    bookingRoot,
    performanceRoot,
    desktopSales,
    mobileSales,
    desktopApprovals,
    perfTab,
    bookTab,
    body,
    document: {
      body,
      getElementById: (id) => byId[id] || null,
      querySelectorAll: (sel) => {
        if (sel === '.view') return [viewSales, viewToday, viewApprovals];
        if (sel === '.header-nav button') return [desktopSales, desktopApprovals];
        if (sel === '.mobile-nav button') return [mobileSales];
        if (sel === '[data-view="sales"]') return [desktopSales, mobileSales];
        if (sel === '[data-view="approvals"]') return [desktopApprovals];
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
    assert.equal(host.viewApprovals.classList.contains('active'), false);
    assert.equal(host.viewApprovals.style.display, '');
    assert.ok(host.body.classList.contains('sales-booking-view-active'));

    ctx.showView('approvals');
    assert.ok(host.viewApprovals.classList.contains('active'));
    assert.equal(host.viewSales.classList.contains('active'), false);
    assert.ok(host.body.classList.contains('approvals-view-active'));
    assert.equal(host.body.classList.contains('sales-booking-view-active'), false);

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
  const queue = html.split('data-booking-pipeline')[0];
  assert.match(html, /Sample visit/);
  assert.match(html, /Booked/);
  assert.doesNotMatch(queue, /Scoped already/);
  assert.doesNotMatch(queue, /Parked/);
  assert.match(html, /Quoted and archived/);
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
  assert.match(html, />Send message</);
  assert.doesNotMatch(html, /Send message \(held\)/);
  assert.match(html, /Approve offer \(held\)/);
  assert.match(html, /does not send, approve, confirm or write a diary/);
  // Send message is the stamp write. Approve/Confirm stay hard-held.
  assert.match(html, /data-booking-stamp-send="1"/);
  assert.doesNotMatch(html, /data-booking-confirm="1"(?![^>]*disabled)/);
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

test('the queue groups by real GHL pipeline stages and states an unread enquiry date rather than faking one', () => {
  api.state.resourceId = 'nithin';
  api.state.data = doorRead();
  const groups = api.queueGroups().map((g) => g[0]);
  assert.deepEqual(groups, [
    'Client Needs To Be Contacted',
    'Contacted Waiting on Response',
    'Needs Scope / Quote',
    'Scope Booked',
    'Enumerated, not yet assessed'
  ]);
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
  assert.equal(f.to_book, 0);
  assert.equal(f.booked, 1);
  const html = api.renderHTML();
  assert.match(html, /Enquiries still to book/);
  assert.match(html, /Waiting on a reply/);
  assert.match(html, /Booked to quote this week/);
  assert.match(html, /Quotes to send/);
  assert.match(html, /GHL stages that still need a booking/);
  assert.match(html, /diary events matched to a case/);
  assert.match(html, /in Scope Complete \/ Quote to be Sent/);
  assert.doesNotMatch(html, /in the diary with a customer yes/);
  assert.doesNotMatch(html, /visited this week plus last/);
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
  assert.equal(f.to_book, 0, 'the raw row must not inflate the demand tile');
  const groups = api.queueGroups();
  const toBook = groups.find((g) => g[0] === 'Client Needs To Be Contacted')[1].map((c) => c.id);
  const raw = groups.find((g) => g[0] === 'Enumerated, not yet assessed')[1].map((c) => c.id);
  assert.ok(!toBook.includes('raw-1'));
  assert.ok(!toBook.includes('case-a'));
  assert.ok(raw.includes('raw-1'));
  assert.ok(raw.includes('case-a'));
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
  const ev = { id: 'evt-1', case_id: 'evt-1', layer: 'confirmed', start_iso: '2026-09-15T11:30:00' };
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
  api.state.data.events = [{ event_id: 'e9', subject: 'Scope: Real visit', display_name: 'Real visit', suburb: 'Alkimos', start_iso: '2026-09-17T09:00:00', end_iso: '2026-09-17T10:00:00', layer: 'confirmed' }];
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

function withFakeTimers(run) {
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  const timers = [];
  let now = 0;
  let nextId = 1;
  global.setTimeout = (cb, ms) => {
    const handle = { id: nextId++, at: now + Number(ms || 0), cb };
    timers.push(handle);
    return handle.id;
  };
  global.clearTimeout = (tid) => {
    const i = timers.findIndex((t) => t.id === tid);
    if (i >= 0) timers.splice(i, 1);
  };
  const tick = (ms) => {
    now += ms;
    timers
      .filter((t) => t.at <= now)
      .sort((a, b) => a.at - b.at)
      .forEach((t) => {
        const i = timers.indexOf(t);
        if (i < 0) return;
        timers.splice(i, 1);
        t.cb();
      });
  };
  return Promise.resolve()
    .then(() => run(tick))
    .finally(() => {
      global.setTimeout = realSet;
      global.clearTimeout = realClear;
    });
}

function delayedOpsFetch(delayMs, payload) {
  return (_action, _params, opts) => new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      fn(value);
    };
    const failAbort = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      finish(reject, err);
    };
    const timer = setTimeout(() => finish(resolve, payload), delayMs);
    const signal = opts && opts.signal;
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      failAbort();
      return;
    }
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      failAbort();
    });
  });
}

test('a 20 second booking read completes and a 61 second read times out', async () => {
  await withFakeTimers(async (tick) => {
    global.SALES_BOOKING_PREVIEW_URL = null;
    api.state.request = 0;
    api.state.resourceId = 'nithin';
    api.state.error = null;
    api.state.data = null;
    global.opsFetch = delayedOpsFetch(20000, doorRead());
    const fast = api.load('nithin', '2026-09-14');
    tick(20000);
    await fast;
    assert.equal(api.state.error, null);
    assert.equal(api.state.data.ok, true);
    assert.match(api.renderHTML(), /Sample A/);

    global.opsFetch = delayedOpsFetch(61000, doorRead());
    const slow = api.load('nithin', '2026-09-14');
    tick(61000);
    await slow;
    assert.match(api.state.error, /timed out after 60 seconds/);
    assert.ok(api.state.data, 'a timeout after a good read keeps the last complete week');
    assert.equal(api.state.stale, true);
    assert.match(api.renderHTML(), /Sample A/);
  });
});

test('a 20s live shape with failed calendar still paints the queue and tiles', () => {
  api.state.resourceId = 'marnin';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  api.state.error = null;
  api.state.loading = false;
  const stages = api.RESOURCES.marnin.pipeline_stages;
  const need = stages.find((s) => s.name === 'New Lead (Call + Qualify)');
  const waitStage = stages.find((s) => s.name === 'Presentation Made (scope not booked)');
  const booked = stages.find((s) => s.name === 'Scope Scheduled');
  const quote = stages.find((s) => s.name === 'Scope Complete');
  const lost = stages.find((s) => s.name === 'Job Lost');
  const cases = [];
  const thread_facts = {};
  function push(count, stage, prefix, extra) {
    for (let i = 0; i < count; i++) {
      const id = prefix + '-' + i;
      cases.push(Object.assign({
        id,
        resource_id: 'marnin',
        opportunity_id: id,
        contact_id: 'c-' + id,
        display_name: prefix + ' ' + i,
        suburb: 'Canning Vale',
        status: 'needs_decision',
        tags: ['stratco'],
        stage_name: stage.name
      }, extra || {}));
    }
  }
  push(400, need, 'new');
  push(80, waitStage, 'pres');
  push(50, booked, 'booked');
  push(20, quote, 'quote');
  push(460, lost, 'lost');
  assert.equal(cases.length, 1010);
  for (let i = 0; i < 80; i++) {
    const id = 'pres-' + i;
    thread_facts[id] = {
      case_id: id,
      contact_id: 'c-' + id,
      read_ok: i < 63,
      reason: i < 63 ? null : 'thread_http_500',
      quiet_window: i < 10,
      classification: i < 20 && i < 63 ? 'waiting_reply' : 'needs_decision',
      message_count: 2,
      template_outbound_count: 0
    };
  }
  api.state.data = {
    ok: true,
    fixture: false,
    send_hold: true,
    resource: {
      resource_id: 'marnin',
      lane: 'fencing',
      pipeline_id: 'I9t8njpuR0Dm7B2NDcvI',
      scoper_user_id: '706c5258-70dd-483a-b36c-af6864b24498',
      sender_line: '776'
    },
    week_start: '2026-09-14',
    coverage: {
      full_population: true,
      enumerated: 1010,
      threads_attempted: 80,
      threads_read: 63,
      diary_read_ok: false,
      gaps: [
        '930 case(s) had no thread read (row budget reached)',
        '17 thread read(s) failed'
      ]
    },
    diary_read: { read_ok: false, reason: 'calendar_http_403', source: 'outlook_primary' },
    thread_facts,
    diary: [],
    cases
  };
  assert.equal(api.calendarUnread(api.state.data), true);
  const html = api.renderHTML();
  const tiles = api.followThrough();
  assert.equal(tiles.to_book > 0, true);
  assert.equal(tiles.booked, 0);
  assert.equal(tiles.quotes, 20);
  assert.equal(tiles.waiting, 20);
  assert.equal(api.urgency(cases.find((c) => c.id === 'booked-0'))[1], 'Booked');
  assert.notEqual(api.urgency(cases.find((c) => c.id === 'new-0'))[1], 'Act today');
  assert.notEqual(api.urgency(cases.find((c) => c.id === 'lost-0'))[1], 'Act today');
  assert.notEqual(api.urgency(cases.find((c) => c.id === 'quote-0'))[1], 'Act today');
  assert.equal(api.urgency(cases.find((c) => c.id === 'pres-0'))[1], 'Waiting');
  assert.notEqual(api.urgency(cases.find((c) => c.id === 'pres-20'))[1], 'Waiting');
  assert.match(html, /New Lead \(Call \+ Qualify\)/);
  assert.match(html, /Scope Scheduled/);
  assert.match(html, /Calendar not connected/);
  assert.match(html, /calendar_http_403/);
  assert.match(html, /Missing coverage is not a free week/);
  assert.match(html, /930 case\(s\) had no thread read \(row budget reached\)/);
  assert.match(html, /17 thread read\(s\) failed/);
  assert.doesNotMatch(html, /Source not retrieved/);
  assert.match(html, /outlook_primary/);
  assert.match(html, /diary not read/);
  assert.doesNotMatch(html, /in the diary with a customer yes/);
  assert.match(html, /<span class="count">[1-9][0-9]* people/);
});

test('Nithin queue groups by the 11 patio stages and folds quoted work', () => {
  api.state.resourceId = 'nithin';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  const stages = api.RESOURCES.nithin.pipeline_stages;
  assert.equal(stages.length, 11);
  assert.match(api.RESOURCES.nithin.pipeline_stages_source, /secureworks-wiki\/pull\/438/);
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'nithin', calendar: { ok: true, mailbox: 'nithin@secureworkswa.com.au' } },
    coverage: { gaps: [] },
    diary: [],
    cases: [
      { id: 'n1', display_name: 'Need contact', suburb: 'Carlisle', status: 'needs_decision', stage_name: stages[0].name },
      { id: 'n2', display_name: 'Waiting reply', suburb: 'Merriwa', status: 'needs_decision', stage_name: 'Contacted Waiting on Response' },
      { id: 'n3', display_name: 'Booked visit', suburb: 'City Beach', status: 'needs_decision', stage_id: stages[3].id, stage_name: stages[3].name },
      { id: 'n4', display_name: 'Quote owed', suburb: 'Balga', status: 'needs_decision', stage_name: stages[4].name }
    ]
  };
  const names = api.queueGroups().map((g) => g[0]);
  assert.deepEqual(names, [
    'Client Needs To Be Contacted',
    'Contacted Waiting on Response',
    'Needs Scope / Quote',
    'Scope Booked',
    'Enumerated, not yet assessed'
  ]);
  assert.deepEqual(api.queueGroups()[0][1].map((c) => c.id), ['n1']);
  assert.deepEqual(api.queueGroups()[1][1].map((c) => c.id), ['n2']);
  assert.deepEqual(api.queueGroups()[3][1].map((c) => c.id), ['n3']);
  assert.equal(api.queueGroups().some((g) => g[1].some((c) => c.id === 'n4')), false);
  api.state.showArchived = true;
  assert.equal(api.foldedCases().some((c) => c.id === 'n4'), true);
  const tiles = api.followThrough();
  assert.equal(tiles.to_book, 1);
  assert.equal(tiles.waiting, 1);
  assert.equal(tiles.booked, 0);
  assert.equal(tiles.quotes, 1);
  assert.equal(api.urgency(api.state.data.cases.find((c) => c.id === 'n3'))[1], 'Booked');
  assert.equal(api.urgency(api.state.data.cases.find((c) => c.id === 'n2'))[1], 'Waiting');
  assert.notEqual(api.urgency(api.state.data.cases.find((c) => c.id === 'n1'))[1], 'Act today');
});

test('Marnin queue groups by the 14 fencing stages and folds quoted work', () => {
  api.state.resourceId = 'marnin';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  const stages = api.RESOURCES.marnin.pipeline_stages;
  assert.equal(stages.length, 14);
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin' },
    coverage: { gaps: ['leave unread'] },
    diary_read: { read_ok: true, calendar_email: 'marnin@secureworkswa.com.au' },
    diary: [],
    cases: [
      { id: 'm1', display_name: 'New stratco', suburb: 'Southern River', status: 'needs_decision', stage_name: stages[0].name },
      { id: 'm2', display_name: 'Urgent scope', suburb: 'Piara Waters', status: 'needs_decision', stage_name: stages[6].name },
      { id: 'm3', display_name: 'Closed booked', suburb: 'Canning Vale', status: 'needs_decision', stage_name: stages[7].name },
      { id: 'm4', display_name: 'Complete quote', suburb: 'Harrisdale', status: 'needs_decision', stage_name: stages[9].name },
      { id: 'm5', display_name: 'Replied no thread', suburb: 'Byford', status: 'needs_decision', stage_name: stages[1].name }
    ]
  };
  const names = api.queueGroups().map((g) => g[0]);
  assert.equal(names[0], 'New Lead (Call + Qualify)');
  assert.equal(names[6], 'Needs On Site Scope Urgently');
  assert.equal(names[7], 'Lead Closed (scope booked)');
  assert.equal(names[8], 'Scope Scheduled');
  assert.deepEqual(api.queueGroups()[0][1].map((c) => c.id), ['m1']);
  assert.deepEqual(api.queueGroups()[1][1].map((c) => c.id), ['m5']);
  assert.deepEqual(api.queueGroups()[6][1].map((c) => c.id), ['m2']);
  assert.deepEqual(api.queueGroups()[7][1].map((c) => c.id), ['m3']);
  assert.equal(api.queueGroups().some((g) => g[1].some((c) => c.id === 'm4')), false);
  assert.match(api.renderHTML(), /leave unread/);
  const tiles = api.followThrough();
  assert.equal(tiles.to_book, 3);
  assert.equal(tiles.waiting, 0);
  assert.equal(tiles.booked, 0);
  assert.equal(tiles.quotes, 1);
  assert.equal(api.urgency(api.state.data.cases.find((c) => c.id === 'm3'))[1], 'Booked');
  assert.notEqual(api.urgency(api.state.data.cases.find((c) => c.id === 'm5'))[1], 'Waiting');
  assert.notEqual(api.urgency(api.state.data.cases.find((c) => c.id === 'm1'))[1], 'Act today');
});

test('a non-array cases roster fails honestly instead of inventing people', () => {
  api.state.resourceId = 'marnin';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.data = {
    ok: true,
    fixture: false,
    cases: 1010,
    coverage: { full_population: true, enumerated: 1010, diary_read_ok: false, gaps: ['row budget reached'] },
    diary_read: { read_ok: false, reason: 'calendar_http_403', source: 'outlook_primary' },
    thread_facts: { 'tf-0': { case_id: 'tf-0', read_ok: true, classification: 'ready_to_contact' } },
    diary: []
  };
  assert.throws(() => api.cases(), /cases must be an array/);
  assert.throws(() => api.renderHTML(), /cases must be an array/);
});

test('loading state does not paint a fake empty week', () => {
  api.state.resourceId = 'marnin';
  api.state.data = null;
  api.state.error = null;
  api.state.loading = true;
  const html = api.renderHTML();
  assert.match(html, /Reading the provider calendar and GHL enquiries/);
  assert.match(html, /Reading this week/);
  assert.doesNotMatch(html, /0 people/);
  assert.doesNotMatch(html, /Source not retrieved/);
  api.state.loading = false;
});

function marninWeekRead() {
  const bookedStage = api.RESOURCES.marnin.pipeline_stages.find((s) => s.name === 'Scope Scheduled');
  const cases = [];
  const diary = [
    { event_id: 'pay', title: 'Payday SecureWorks', kind: 'busy', start: '2026-09-15T09:00:00', end: '2026-09-15T09:30:00', blocks_capacity: true, source: 'ghl_calendar' },
    { event_id: 'outback', title: 'Outback Agreements', kind: 'busy', start: '2026-09-15T10:00:00', end: '2026-09-15T11:00:00', blocks_capacity: true, source: 'ghl_calendar' },
    { event_id: 'sw-1', title: 'SecureWorks', kind: 'busy', start: '2026-09-15T11:00:00', end: '2026-09-15T11:30:00', blocks_capacity: true, source: 'ghl_calendar' },
    { event_id: 'sw-2', title: 'SecureWorks', kind: 'busy', start: '2026-09-18T09:00:00', end: '2026-09-18T09:30:00', blocks_capacity: true, source: 'ghl_calendar' },
    { event_id: 'scope-evt', opportunity_id: 'opp-scope', title: 'Scope: Pat, Canning Vale', kind: 'busy', start: '2026-09-15T13:00:00', end: '2026-09-15T14:00:00', blocks_capacity: true, source: 'ghl_calendar' }
  ];
  cases.push({
    id: 'opp-scope',
    opportunity_id: 'opp-scope',
    contact_id: 'c-opp-scope',
    display_name: 'Pat',
    suburb: 'Canning Vale',
    status: 'needs_decision',
    stage_name: bookedStage.name,
    stage_id: bookedStage.id
  });
  const suburbs = ['Canning Vale', 'Harrisdale', 'Piara Waters', 'Southern River', 'Byford', 'Alkimos'];
  for (let i = 0; i < 6; i++) {
    const id = 'opp-booked-' + i;
    cases.push({
      id,
      opportunity_id: id,
      contact_id: 'c-' + id,
      display_name: 'Customer ' + i,
      suburb: suburbs[i],
      status: 'needs_decision',
      stage_name: bookedStage.name,
      stage_id: bookedStage.id
    });
    diary.push({
      event_id: 'visit-' + i,
      opportunity_id: id,
      title: 'Customer ' + i,
      suburb: suburbs[i],
      kind: 'busy',
      start: '2026-09-18T1' + i + ':00:00',
      end: '2026-09-18T1' + i + ':45:00',
      blocks_capacity: true,
      source: 'ghl_calendar'
    });
  }
  return {
    ok: true,
    fixture: false,
    send_hold: true,
    resource: { id: 'marnin', calendar: { ok: true, mailbox: 'marnin@secureworkswa.com.au' } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    diary_read: { read_ok: true, source: 'ghl_calendar' },
    diary,
    events: [],
    cases,
    pack: { present: false },
    stamp: { present: false }
  };
}

test('Marnin company diary paints Busy and does not count as booked scopes', () => {
  api.state.resourceId = 'marnin';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  api.state.layers = { confirmed: true, proposal: true, offer: true, blocked: true, personal: true, availability: true };
  api.state.data = marninWeekRead();
  const rows = api.diary();
  const payday = rows.find((r) => r.title === 'Payday SecureWorks');
  const outback = rows.find((r) => r.title === 'Outback Agreements');
  const company = rows.filter((r) => r.title === 'SecureWorks');
  const scoped = rows.find((r) => /^Scope:/i.test(r.title));
  assert.equal(api.diaryLayerFor(payday), 'busy');
  assert.equal(api.diaryLayerFor(outback), 'busy');
  assert.equal(company.length, 2);
  company.forEach((ev) => assert.equal(api.diaryLayerFor(ev), 'busy'));
  assert.equal(api.diaryEventIsScopeBooking(scoped), true);
  assert.equal(api.diaryLayerFor(scoped), 'confirmed');
  assert.equal(api.diaryEventIsScopeBooking(payday), false);
  const html = api.renderHTML();
  assert.match(html, />Busy</);
  assert.match(html, /Payday SecureWorks/);
  assert.match(html, /Outback Agreements/);
  assert.match(html, /CONFIRMED/);
  assert.match(html, /Scope: Pat, Canning Vale/);
  const tiles = api.followThrough();
  assert.equal(tiles.booked, 7);
  assert.equal(api.bookedCount(), 7);
  assert.match(html, />7</);
  assert.match(html, /class="ev busy event busy"[^>]*data-booking-case="pay"/);
  assert.match(html, /class="ev confirmed event confirmed"[^>]*data-booking-case="scope-evt"/);
  assert.doesNotMatch(html, /class="ev confirmed event confirmed"[^>]*data-booking-case="pay"/);
});

test('GHL booked-stage rows with an empty diary do not count as booked visits', () => {
  api.state.resourceId = 'marnin';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  const booked = api.RESOURCES.marnin.pipeline_stages.find((s) => s.name === 'Scope Scheduled');
  const cases = [];
  for (let i = 0; i < 172; i++) {
    cases.push({
      id: 'stage-booked-' + i,
      opportunity_id: 'stage-booked-' + i,
      contact_id: 'c-stage-' + i,
      display_name: 'Stage row ' + i,
      suburb: 'Canning Vale',
      status: 'needs_decision',
      stage_name: booked.name,
      stage_id: booked.id
    });
  }
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true, mailbox: 'marnin@secureworkswa.com.au' } },
    week_start: '2026-09-14',
    coverage: { full_population: true, enumerated: 172, gaps: [] },
    diary_read: { read_ok: true, source: 'ghl_calendar' },
    diary: [],
    events: [],
    cases
  };
  const tiles = api.followThrough();
  assert.equal(cases.length, 172);
  assert.equal(tiles.booked, 0);
  assert.equal(api.bookedCount(), 0);
  const html = api.renderHTML();
  assert.match(html, /GHL calendar empty this week/);
  assert.doesNotMatch(html, /diary not read/);
  assert.doesNotMatch(html, /in the diary with a customer yes/);
  assert.match(html, /<div class="v">0<\/div>/);
});

test('a diary event matches a queue row by opportunity, contact, or exact name and suburb', () => {
  api.state.resourceId = 'marnin';
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    diary: [
      { event_id: 'e-opp', opportunity_id: 'opp-1', title: 'Linked by opportunity', kind: 'busy', start: '2026-09-15T09:00:00', end: '2026-09-15T10:00:00' },
      { event_id: 'e-contact', contact_id: 'ct-2', title: 'Linked by contact', kind: 'busy', start: '2026-09-15T10:00:00', end: '2026-09-15T11:00:00' },
      { event_id: 'e-name', title: 'Sam Ferry', suburb: 'Byford', kind: 'busy', start: '2026-09-15T11:00:00', end: '2026-09-15T12:00:00' },
      { event_id: 'e-close', title: 'Sam Ferry', suburb: 'Harrisdale', kind: 'busy', start: '2026-09-15T13:00:00', end: '2026-09-15T14:00:00' }
    ],
    cases: [
      { id: 'opp-1', opportunity_id: 'opp-1', contact_id: 'ct-1', display_name: 'Opportunity match', suburb: 'Canning Vale', status: 'needs_decision', stage_name: 'Scope Scheduled' },
      { id: 'opp-2', opportunity_id: 'opp-2', contact_id: 'ct-2', display_name: 'Contact match', suburb: 'Piara Waters', status: 'needs_decision', stage_name: 'Scope Scheduled' },
      { id: 'opp-3', opportunity_id: 'opp-3', contact_id: 'ct-3', display_name: 'Sam Ferry', suburb: 'Byford', status: 'needs_decision', stage_name: 'New Lead (Call + Qualify)' }
    ]
  };
  const rows = api.diary();
  assert.equal(api.diaryLayerFor(rows.find((r) => r.id === 'e-opp')), 'confirmed');
  assert.equal(api.diaryLayerFor(rows.find((r) => r.id === 'e-contact')), 'confirmed');
  assert.equal(api.diaryLayerFor(rows.find((r) => r.id === 'e-name')), 'confirmed');
  assert.equal(api.diaryLayerFor(rows.find((r) => r.id === 'e-close')), 'busy');
});

test('blocks_capacity false does not occupy an off-lane day', () => {
  api.state.resourceId = 'marnin';
  api.state.data = doorRead();
  api.state.data.resource.id = 'marnin';
  api.state.data.events = [];
  api.state.data.diary = [{
    event_id: 'free', title: 'Hint only', kind: 'busy', start: '2026-09-17T09:00:00', end: '2026-09-17T10:00:00',
    blocks_capacity: false, source: 'ghl_calendar'
  }];
  const ev = api.diary()[0];
  assert.equal(api.diaryOccupiesDay(ev), false);
  const html = api.renderHTML();
  assert.match(html, /Not a Marnin day/);
  assert.match(html, /Hint only/);
  api.state.resourceId = 'nithin';
});

test('absent pack is named in the coverage strip, never shown as free capacity', () => {
  api.state.resourceId = 'marnin';
  api.state.data = marninWeekRead();
  const html = api.renderHTML();
  assert.match(html, /No proposals published yet for this week/);
  assert.match(html, /Empty diary is not spare capacity|11 provider events/);
});

test('a pack proposal paints the day, window and draft on the card and in the detail', () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.drafts = {};
  api.state.selectedId = 'opp-offer';
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true, mailbox: 'marnin@secureworkswa.com.au' } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    pack: { present: true, as_of: '2026-09-17T04:00:00Z' },
    stamp: { present: false },
    diary: [],
    cases: [{
      id: 'opp-offer',
      opportunity_id: 'opp-offer',
      contact_id: 'c-offer',
      display_name: 'Sam Ferry',
      suburb: 'Byford',
      job: 'Colorbond fence',
      status: 'needs_decision',
      stage_name: 'Presentation Made (scope not booked)',
      proposal: {
        disposition: 'offer',
        day: '2026-09-18',
        window_start: '11:15',
        window_end: '12:45',
        draft: 'Hi Sam, Friday 18 September between 11:15 and 12:45pm to measure and quote. Does that suit?',
        why: ['Friday is a Stratco day.']
      },
      stamp_state: 'none'
    }],
    drafts: { 'opp-offer': 'Hi Sam, Friday 18 September between 11:15 and 12:45pm to measure and quote. Does that suit?' }
  };
  const html = api.renderHTML();
  assert.doesNotMatch(html, /No proposals published yet for this week/);
  assert.match(html, /Friday 18 September · arrive 11:15am to 12:45pm/);
  assert.match(html, /Hi Sam, Friday 18 September between 11:15 and 12:45pm/);
  assert.match(html, /Proposed text/);
  assert.match(html, /Colorbond fence/);
  const p = api.cases()[0].proposal;
  assert.equal(p.start_iso, '2026-09-18T11:15:00');
  assert.equal(p.end_iso, '2026-09-18T12:45:00');
});

test('Send message posts the stamp and Cut rejects, then a re-read keeps the paint', async () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.drafts = {};
  const proposal = {
    disposition: 'offer',
    day: '2026-09-18',
    window_start: '11:15',
    window_end: '12:45',
    draft: 'Hi Sam, Friday 18 September between 11:15 and 12:45pm. Does that suit?',
    why: []
  };
  const base = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    pack: { present: true, as_of: '2026-09-17T04:00:00Z' },
    stamp: { present: false, approved: [], rejected: [], decisions: {}, stage_moves: [] },
    diary: [],
    cases: [{
      id: 'opp-offer',
      opportunity_id: 'opp-offer',
      contact_id: 'c-offer',
      display_name: 'Sam Ferry',
      suburb: 'Byford',
      status: 'needs_decision',
      stage_name: 'Presentation Made (scope not booked)',
      proposal,
      stamp_state: 'none'
    }]
  };
  api.state.data = JSON.parse(JSON.stringify(base));
  api.state.selectedId = 'opp-offer';
  const posts = [];
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.opsPost = async (action, body) => {
    posts.push({ action, body });
    return { ok: true };
  };
  global.opsFetch = async () => {
    const next = JSON.parse(JSON.stringify(base));
    const last = posts[posts.length - 1];
    next.stamp = {
      present: true,
      as_of: '2026-09-17T05:00:00Z',
      approved: (last && last.body.stamp.approved) || [],
      rejected: (last && last.body.stamp.rejected) || [],
      decisions: {},
      stage_moves: []
    };
    const st = next.stamp.rejected.length ? 'rejected' : (next.stamp.approved.length ? 'approved' : 'none');
    next.cases[0].stamp_state = st;
    return next;
  };
  const sent = await api.writeStamp('opp-offer', 'keep');
  assert.equal(sent.sent, false);
  assert.equal(sent.wrote_calendar, false);
  assert.equal(sent.posted, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].action, 'sales_booking_stamp_write');
  assert.deepEqual(posts[0].body.stamp.approved, ['opp-offer']);
  assert.deepEqual(posts[0].body.stamp.rejected, []);
  assert.deepEqual(posts[0].body.stamp.stage_moves, []);
  assert.equal(posts[0].body.resource, 'marnin');
  assert.equal(posts[0].body.week_start, '2026-09-14');
  assert.equal(api.state.data.cases[0].stamp_state, 'approved');
  assert.equal(api.stampStateOf(api.state.data.cases[0]), 'keep');
  let html = api.renderHTML();
  assert.match(html, /Stamped KEEP/);
  assert.match(html, /stampcard stamped/);

  const cut = await api.writeStamp('opp-offer', 'cut');
  assert.equal(cut.posted, true);
  assert.deepEqual(posts[1].body.stamp.approved, []);
  assert.deepEqual(posts[1].body.stamp.rejected, ['opp-offer']);
  assert.equal(api.state.data.cases[0].stamp_state, 'rejected');
  assert.equal(api.stampStateOf(api.state.data.cases[0]), 'cut');
  html = api.renderHTML();
  assert.match(html, /Stamped CUT/);
  assert.match(html, /stampcard weak/);
  assert.equal(posts.every((p) => p.action === 'sales_booking_stamp_write'), true);
});

function liveMarninPackRead() {
  const days = [
    { iso: '2026-09-18', weekday: 'Fri', suburb: 'Byford' },
    { iso: '2026-09-22', weekday: 'Tue', suburb: 'Canning Vale' },
    { iso: '2026-09-25', weekday: 'Fri', suburb: 'Harrisdale' },
    { iso: '2026-09-29', weekday: 'Tue', suburb: 'Piara Waters' }
  ];
  const cases = [];
  for (let i = 0; i < 31; i++) {
    const slot = days[i % 4];
    const disposition = i === 0 ? 'booked' : (i <= 11 ? 'offer' : 'capacity');
    cases.push({
      id: 'opp-' + i,
      opportunity_id: 'opp-' + i,
      contact_id: 'ct-' + i,
      display_name: 'Lead ' + i,
      suburb: null,
      job: 'Colorbond fence',
      status: 'needs_decision',
      stage_name: 'Presentation Made (scope not booked)',
      proposal: {
        disposition,
        day: slot.weekday,
        window_start: slot.iso + 'T11:15:00+08:00',
        window_end: slot.iso + 'T12:45:00+08:00',
        suburb: slot.suburb,
        draft: disposition === 'offer' ? 'Hi Lead ' + i + ', draft for ' + slot.iso : null,
        why: []
      },
      stamp_state: 'none'
    });
  }
  return {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true, mailbox: 'marnin@secureworkswa.com.au' } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    pack: { present: true, as_of: '2026-09-16T07:48:00Z', week_start: '2026-09-14' },
    stamp: { present: false },
    diary: [],
    cases
  };
}

test('live pack windows keep their own day, not the weekday of the week on screen', () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  const p = api.normaliseProposal({
    disposition: 'capacity',
    day: 'Fri',
    window_start: '2026-09-25T11:15:00+08:00',
    window_end: '2026-09-25T12:45:00+08:00',
    suburb: 'Harrisdale',
    draft: null,
    why: []
  });
  assert.equal(p.start_iso.slice(0, 10), '2026-09-25');
  assert.equal(p.end_iso.slice(0, 10), '2026-09-25');
});

test('published marnin pack: 31 proposals, 11 offers, other-week slots listed, suburb from proposal', () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.drafts = {};
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.data = liveMarninPackRead();
  const list = api.cases();
  const proposals = list.filter((c) => c.proposal);
  const offers = proposals.filter((c) => c.proposal.disposition === 'offer');
  assert.equal(proposals.length, 31);
  assert.equal(offers.length, 11);
  assert.equal(api.caseSuburb(list[1]), 'Canning Vale');
  assert.equal(api.proposalSlotLabel(list[1]), 'Tuesday 22 September · arrive 11:15am to 12:45pm');

  let html = api.renderHTML();
  assert.match(html, /data-booking-week="-7"/);
  assert.match(html, /data-booking-week="7"/);
  assert.match(html, /Tuesday 22 September · arrive 11:15am to 12:45pm/);
  assert.match(html, /Friday 25 September · arrive 11:15am to 12:45pm/);
  assert.match(html, /Tuesday 29 September · arrive 11:15am to 12:45pm/);
  assert.match(html, /Lead 1 · Canning Vale/);
  assert.match(html, /Lead 2 · Harrisdale/);
  assert.doesNotMatch(html, /Lead 1 · Suburb unknown/);
  assert.match(html, /data-booking-case="opp-1"/);
  assert.match(html, /Friday 18 September/);
  assert.doesNotMatch(html, /class="ev proposal event proposal"[^>]*data-booking-case="opp-1"/);

  api.state.weekStart = '2026-09-21';
  html = api.renderHTML();
  assert.match(html, /class="ev proposal event proposal"[^>]*data-booking-case="opp-1"/);
  assert.match(html, /Tuesday 22 September · arrive 11:15am to 12:45pm/);
  assert.match(html, /Friday 18 September · arrive 11:15am to 12:45pm/);
  api.state.weekStart = '2026-09-14';
  api.state.resourceId = 'nithin';
});

test('Send after Next week still writes the live marnin pack week', async () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.drafts = {};
  const pack = liveMarninPackRead();
  api.state.data = JSON.parse(JSON.stringify(pack));
  api.state.selectedId = 'opp-1';
  const posts = [];
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.opsPost = async (action, body) => {
    posts.push({ action, body });
    return { ok: true };
  };
  global.opsFetch = async (_action, params) => {
    const next = JSON.parse(JSON.stringify(pack));
    if (params && params.week_start) next.week_start = params.week_start;
    const last = posts[posts.length - 1];
    if (last && last.body && last.body.stamp) {
      next.stamp = {
        present: true,
        week_start: last.body.week_start,
        approved: last.body.stamp.approved || [],
        rejected: last.body.stamp.rejected || [],
        decisions: {},
        stage_moves: []
      };
      const st = next.stamp.rejected.length ? 'rejected' : (next.stamp.approved.length ? 'approved' : 'none');
      const hit = next.cases.find((c) => c.id === 'opp-1');
      if (hit) hit.stamp_state = st;
    }
    return next;
  };
  await api.switchWeek(7);
  assert.equal(api.state.weekStart, '2026-09-21');
  assert.equal(api.state.data.pack.week_start, '2026-09-14');
  const sent = await api.writeStamp('opp-1', 'keep');
  assert.equal(sent.posted, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].action, 'sales_booking_stamp_write');
  assert.equal(posts[0].body.week_start, '2026-09-14');
  assert.equal(posts[0].body.resource, 'marnin');
  assert.deepEqual(posts[0].body.stamp.approved, ['opp-1']);
  assert.equal(api.stampStateOf(api.cases().find((c) => c.id === 'opp-1')), 'keep');
  api.state.weekStart = '2026-09-14';
  api.state.resourceId = 'nithin';
});

test('a clock-only Fri row stays undated and does not attach to the week on screen', () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.drafts = {};
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.selectedId = 'opp-clock';
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    pack: { present: true, week_start: '2026-09-14' },
    stamp: { present: false },
    diary: [],
    cases: [{
      id: 'opp-clock',
      opportunity_id: 'opp-clock',
      contact_id: 'ct-clock',
      display_name: 'Clock Fri',
      suburb: 'Byford',
      job: 'Colorbond fence',
      status: 'needs_decision',
      stage_name: 'Presentation Made (scope not booked)',
      proposal: {
        disposition: 'offer',
        day: 'Fri',
        window_start: '11:15',
        window_end: '12:45',
        draft: null,
        why: []
      }
    }]
  };
  const p = api.cases()[0].proposal;
  assert.equal(p.start_iso == null, true);
  assert.equal(p.end_iso == null, true);
  assert.equal(api.proposalSlotLabel(api.cases()[0]), '');
  const html = api.renderHTML();
  assert.match(html, /Clock Fri · Byford/);
  assert.doesNotMatch(html, /Friday 18 September/);
  assert.doesNotMatch(html, /class="ev proposal event proposal"[^>]*data-booking-case="opp-clock"/);
  api.state.weekStart = '2026-09-14';
  api.state.resourceId = 'nithin';
});

function degradedRosterPackRead() {
  const offers = [
    { id: 'TelAKHzhxnCjKrExxQxE', name: 'Lawrence Guo', suburb: 'Woodlands', day: '2026-09-18', start: '08:00', end: '09:30', draft: 'Hi Lawrence, Friday 18 September between 08:00 and 09:30.' },
    { id: '2ELupAoaJJfij4orMa8h', name: 'Bruce Reidy-Crofts', suburb: 'Greenwood', day: '2026-09-18', start: '11:15', end: '12:45', draft: 'Hi Bruce, Friday 18 September between 11:15 and 12:45.' },
    { id: 'wdi52oA5Lnh19ZdXWjmY', name: 'Greg Holland', suburb: 'Leederville', day: '2026-09-18', start: '15:00', end: '16:30', draft: 'Hi Greg, Friday 18 September between 15:00 and 16:30.' },
    { id: '9XZmlVHcsQ0F8ExT3Smz', name: 'Aubin Grove enquiry', suburb: 'Aubin Grove', day: '2026-09-22', start: '08:00', end: '09:30', draft: 'Hi there, Tuesday 22 September between 08:00 and 09:30.' },
    { id: '9kreNjMoK8wu6hENvECe', name: 'Balga enquiry', suburb: 'Balga', day: '2026-09-22', start: '10:00', end: '11:30', draft: 'Hi there, Tuesday 22 September between 10:00 and 11:30.' },
    { id: 'jksTxrbNpEKcmpayYHqI', name: 'Sonia Stratco', suburb: 'Noranda', day: '2026-09-25', start: '08:00', end: '09:30', draft: 'Hi Sonia, Friday 25 September between 08:00 and 09:30.' },
    { id: 'zFg2alBIMAxTMdHigrjT', name: 'Sinagra enquiry', suburb: 'Sinagra', day: '2026-09-25', start: '10:00', end: '11:30', draft: 'Hi there, Friday 25 September between 10:00 and 11:30.' },
    { id: '4WkOLh61XUwX9aSWy8Pf', name: 'Clarkson enquiry', suburb: 'Clarkson', day: '2026-09-25', start: '12:00', end: '13:30', draft: 'Hi there, Friday 25 September between 12:00 and 13:30.' },
    { id: 'JtUWsD27EkSMWtqxGMHs', name: 'Andrew Allen', suburb: 'Jindalee', day: '2026-09-25', start: '14:00', end: '15:30', draft: 'Hi Andrew, Friday 25 September between 14:00 and 15:30.' },
    { id: 'wr2YBmIyAI1ygiru5zwc', name: 'Kim Douglas', suburb: 'Sorrento', day: '2026-09-29', start: '08:00', end: '09:30', draft: 'Hi Kim, Tuesday 29 September between 08:00 and 09:30.' },
    { id: 'yLb0XYAiIZb7jmYiFWAM', name: 'Mark Thomas', suburb: 'Redcliffe', day: '2026-09-29', start: '10:00', end: '11:30', draft: 'Hi Mark, Tuesday 29 September between 10:00 and 11:30.' }
  ];
  const inRoster = new Set(['JtUWsD27EkSMWtqxGMHs', 'wr2YBmIyAI1ygiru5zwc']);
  const proposals = {};
  offers.forEach((row) => {
    proposals[row.id] = {
      offer: true,
      day: row.day,
      window: { start: row.start, end: row.end },
      draft: row.draft,
      name: row.name,
      suburb: row.suburb
    };
  });
  const cases = offers.filter((row) => inRoster.has(row.id)).map((row) => ({
    id: row.id,
    opportunity_id: row.id,
    contact_id: 'ct-' + row.id.slice(0, 6),
    display_name: row.name,
    suburb: row.suburb,
    job: 'Colorbond fence',
    status: 'needs_decision',
    stage_name: 'Presentation Made (scope not booked)',
    stamp_state: 'none'
  }));
  for (let i = 0; i < 3; i++) {
    cases.push({
      id: 'roster-filler-' + i,
      opportunity_id: 'roster-filler-' + i,
      display_name: 'Filler ' + i,
      suburb: 'Perth',
      status: 'needs_decision',
      stage_name: 'New Lead (Call + Qualify)'
    });
  }
  return {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true, mailbox: 'marnin@secureworkswa.com.au' } },
    week_start: '2026-09-14',
    coverage: { full_population: false, enumerated: 5, total: 1012, gaps: ['roster read degraded by GHL 429'] },
    pack: {
      present: true,
      as_of: '2026-09-16T07:48:00Z',
      week_start: '2026-09-14',
      proposals
    },
    stamp: { present: false },
    diary: [],
    cases,
    _offers: offers
  };
}

function proposalCardIds(html) {
  const ids = [];
  const re = /class="ev proposal[^"]*"[^>]*data-booking-case="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.push(m[1]);
  return ids;
}

test('pack offers paint and stamp even when the roster missed them', async () => {
  const payload = degradedRosterPackRead();
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  api.state.drafts = {};
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.layers = { confirmed: true, proposal: true, offer: true, blocked: true, personal: true, availability: true };
  api.state.data = JSON.parse(JSON.stringify(payload));
  api.state.selectedId = null;

  const list = api.cases();
  const offers = list.filter((c) => api.isPackOfferCase(c));
  assert.equal(offers.length, 11);
  assert.equal(offers.filter((c) => c.not_in_this_read).length, 9);
  assert.equal(api.stampableOfferList().length, 11);

  const weekCards = {};
  ['2026-09-14', '2026-09-21', '2026-09-28'].forEach((week) => {
    api.state.weekStart = week;
    weekCards[week] = proposalCardIds(api.renderHTML());
  });
  api.state.weekStart = '2026-09-14';
  assert.deepEqual(weekCards['2026-09-14'].sort(), [
    '2ELupAoaJJfij4orMa8h',
    'TelAKHzhxnCjKrExxQxE',
    'wdi52oA5Lnh19ZdXWjmY'
  ].sort());
  assert.deepEqual(weekCards['2026-09-21'].sort(), [
    '4WkOLh61XUwX9aSWy8Pf',
    '9XZmlVHcsQ0F8ExT3Smz',
    '9kreNjMoK8wu6hENvECe',
    'JtUWsD27EkSMWtqxGMHs',
    'jksTxrbNpEKcmpayYHqI',
    'zFg2alBIMAxTMdHigrjT'
  ].sort());
  assert.deepEqual(weekCards['2026-09-28'].sort(), [
    'wr2YBmIyAI1ygiru5zwc',
    'yLb0XYAiIZb7jmYiFWAM'
  ].sort());
  const allCards = [].concat(weekCards['2026-09-14'], weekCards['2026-09-21'], weekCards['2026-09-28']);
  assert.equal(allCards.length, 11);
  assert.equal(new Set(allCards).size, 11);

  let html = api.renderHTML();
  assert.match(html, /11 proposals unsent/);
  assert.match(html, /11 lines/);
  assert.equal((html.match(/class="stampcard/g) || []).length, 11);
  assert.equal((html.match(/<div class="stampcard[^>]*data-not-in-read="1"/g) || []).length, 9);
  assert.match(html, /Lawrence Guo · Woodlands/);
  assert.match(html, /Bruce Reidy-Crofts · Greenwood/);
  assert.match(html, /Andrew Allen · Jindalee/);
  assert.match(html, /Kim Douglas · Sorrento/);
  payload._offers.filter((row) => !['JtUWsD27EkSMWtqxGMHs', 'wr2YBmIyAI1ygiru5zwc'].includes(row.id)).forEach((row) => {
    assert.match(html, new RegExp(row.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,400}not in this read'));
  });

  const posts = [];
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.opsPost = async (action, body) => {
    posts.push({ action, body });
    return { ok: true };
  };
  global.opsFetch = async () => JSON.parse(JSON.stringify(payload));

  for (const row of payload._offers) {
    api.state.selectedId = row.id;
    html = api.renderHTML();
    assert.match(html, new RegExp('data-booking-stamp-send="1" data-booking-stamp-id="' + row.id + '"'));
    assert.doesNotMatch(html, new RegExp('data-booking-stamp-send="1" data-booking-stamp-id="' + row.id + '" disabled'));
    assert.match(html, /Proposed text/);
    assert.match(html, new RegExp(row.draft.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (row.id !== 'JtUWsD27EkSMWtqxGMHs' && row.id !== 'wr2YBmIyAI1ygiru5zwc') {
      assert.match(html, /not in this read/);
    }
  }

  const sent = await api.writeStamp('TelAKHzhxnCjKrExxQxE', 'keep');
  assert.equal(sent.posted, true);
  assert.equal(posts[0].action, 'sales_booking_stamp_write');
  assert.equal(posts[0].body.week_start, '2026-09-14');
  assert.deepEqual(posts[0].body.stamp.approved, ['TelAKHzhxnCjKrExxQxE']);
  assert.equal(posts[0].body.resource, 'marnin');

  api.state.weekStart = '2026-09-14';
  api.state.resourceId = 'nithin';
  api.state.selectedId = null;
});

test('job_type sits next to suburb on the queue row and in the detail header', () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  api.state.selectedId = 'opp-fence';
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    diary_read: { read_ok: true, source: 'ghl_calendar' },
    diary: [],
    cases: [{
      id: 'opp-fence',
      opportunity_id: 'opp-fence',
      contact_id: 'ct-fence',
      display_name: 'Sam Ferry',
      suburb: 'Byford',
      job_type: 'fencing',
      status: 'needs_decision',
      stage_name: 'New Lead (Call + Qualify)'
    }, {
      id: 'opp-blank',
      opportunity_id: 'opp-blank',
      contact_id: 'ct-blank',
      display_name: 'No Type Yet',
      suburb: 'Carlisle',
      job_type: 'not given',
      status: 'needs_decision',
      stage_name: 'New Lead (Call + Qualify)'
    }, {
      id: 'opp-missing',
      opportunity_id: 'opp-missing',
      contact_id: 'ct-missing',
      display_name: 'Missing Type',
      suburb: 'Balga',
      status: 'needs_decision',
      stage_name: 'New Lead (Call + Qualify)'
    }]
  };
  assert.equal(api.jobTypeLabel(api.state.data.cases[0]), 'fencing');
  assert.equal(api.jobTypeLabel(api.state.data.cases[1]), 'not given');
  assert.equal(api.jobTypeLabel(api.state.data.cases[2]), 'not given');
  let html = api.renderHTML();
  assert.match(html, /Sam Ferry · Byford · fencing/);
  assert.match(html, /No Type Yet · Carlisle · not given/);
  assert.match(html, /Missing Type · Balga · not given/);
  assert.match(html, /Byford · fencing/);
  assert.doesNotMatch(html, /No job details yet/);
  api.state.selectedId = 'opp-blank';
  html = api.renderHTML();
  assert.match(html, /Carlisle · not given/);
  api.state.resourceId = 'nithin';
  api.state.selectedId = null;
});

test('a job-only pack row shows the job on the queue, detail, and stamp board', () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  api.state.drafts = {};
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.selectedId = 'TelAKHzhxnCjKrExxQxE';
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    pack: {
      present: true,
      week_start: '2026-09-14',
      proposals: {
        TelAKHzhxnCjKrExxQxE: {
          offer: true,
          day: '2026-09-18',
          window: { start: '08:00', end: '09:30' },
          draft: 'Hi Lawrence, Friday 18 September between 08:00 and 09:30.',
          name: 'Lawrence Guo',
          suburb: 'Woodlands',
          job: 'Colorbond fence'
        }
      }
    },
    diary: [],
    cases: []
  };
  const row = api.cases()[0];
  assert.equal(row.job, 'Colorbond fence');
  assert.equal(row.job_type == null, true);
  assert.equal(api.jobTypeLabel(row), 'Colorbond fence');
  const html = api.renderHTML();
  assert.match(html, /Lawrence Guo · Woodlands · Colorbond fence/);
  assert.match(html, /Woodlands · Colorbond fence/);
  assert.match(html, /<div class="why">Colorbond fence · Ready to contact<\/div>/);
  assert.doesNotMatch(html, /Lawrence Guo · Woodlands · not given/);
  api.state.resourceId = 'nithin';
  api.state.selectedId = null;
});

test('pack offers accept only offer true or disposition offer on a keyed object', () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.showArchived = false;
  api.state.drafts = {};
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.selectedId = null;
  const body = {
    day: '2026-09-18',
    window: { start: '08:00', end: '09:30' },
    draft: 'Hi Lawrence, Friday 18 September between 08:00 and 09:30.',
    name: 'Lawrence Guo',
    suburb: 'Woodlands'
  };
  const read = (proposals) => ({
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    pack: { present: true, week_start: '2026-09-14', proposals },
    diary: [],
    cases: []
  });

  api.state.data = read({ flagged: Object.assign({}, body, { offer: true }) });
  assert.equal(api.stampableOfferList().length, 1);
  assert.equal(api.isPackOfferCase(api.cases()[0]), true);

  api.state.data = read({ flagged: Object.assign({}, body, { disposition: 'offer' }) });
  assert.equal(api.stampableOfferList().length, 1);
  assert.equal(api.isPackOfferCase(api.cases()[0]), true);

  api.state.data = read({ flagged: Object.assign({}, body, { offer: 'offer' }) });
  assert.equal(api.cases().length, 0);
  assert.equal(api.stampableOfferList().length, 0);

  api.state.data = read({ flagged: Object.assign({}, body, { kind: 'offer' }) });
  assert.equal(api.cases().length, 0);
  assert.equal(api.stampableOfferList().length, 0);

  api.state.data = read([Object.assign({}, body, { offer: true, opportunity_id: 'array-1' })]);
  assert.equal(api.cases().length, 0);
  assert.equal(api.stampableOfferList().length, 0);

  api.state.resourceId = 'nithin';
});

test('Booked tile names an empty GHL calendar and keeps diary not read for a failed read', () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true, mailbox: 'marnin@secureworkswa.com.au' } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    diary_read: { read_ok: true, source: 'ghl_calendar' },
    diary: [],
    events: [],
    cases: []
  };
  assert.equal(api.bookedTileReason(), 'GHL calendar empty this week');
  assert.match(api.renderHTML(), /GHL calendar empty this week/);
  assert.doesNotMatch(api.renderHTML(), /diary not read/);

  api.state.data.diary_read = { read_ok: false, reason: 'calendar_http_403', source: 'ghl_calendar' };
  assert.equal(api.bookedTileReason(), 'diary not read');
  assert.match(api.renderHTML(), /diary not read/);
  assert.doesNotMatch(api.renderHTML(), /GHL calendar empty this week/);
  api.state.resourceId = 'nithin';
});

function pipelineRead() {
  return {
    ok: true,
    fixture: false,
    send_hold: true,
    resource: { id: 'nithin', calendar: { ok: true, mailbox: 'nithin@secureworkswa.com.au' } },
    week_start: '2026-09-14',
    coverage: { full_population: true, enumerated: 2, total: 2, gaps: [] },
    pack: { present: true, as_of: '2026-09-17T09:18:00Z', week_start: '2026-09-14' },
    stamp: { present: false, approved: [], rejected: [], decisions: {}, stage_moves: [] },
    diary_read: { read_ok: true, source: 'ghl_calendar' },
    diary: [{
      event_id: 'evt-booked',
      opportunity_id: 'opp-booked',
      contact_id: 'ct-booked',
      display_name: 'Booked Pat',
      suburb: 'Carlisle',
      start_iso: '2026-09-16T10:00:00',
      end_iso: '2026-09-16T11:00:00',
      kind: 'confirmed',
      layer: 'confirmed',
      title: 'Scope: Booked Pat'
    }],
    thread_facts: {
      'opp-wait': { read_ok: true, classification: 'waiting_reply' }
    },
    cases: [{
      id: 'opp-wait',
      opportunity_id: 'opp-wait',
      contact_id: 'ct-wait',
      display_name: 'Waiter',
      suburb: 'Merriwa',
      job_type: 'patio',
      status: 'needs_decision',
      stage_id: '09759a42-f80a-4947-bca4-71df5dd770da',
      stage_name: 'Client Needs To Be Contacted',
      enquiry_date: '2026-09-10'
    }, {
      id: 'opp-booked',
      opportunity_id: 'opp-booked',
      contact_id: 'ct-booked',
      display_name: 'Booked Pat',
      suburb: 'Carlisle',
      job_type: 'patio',
      status: 'needs_decision',
      stage_id: '09759a42-f80a-4947-bca4-71df5dd770da',
      stage_name: 'Client Needs To Be Contacted',
      enquiry_date: '2026-09-08'
    }]
  };
}

test('GHL pipeline board uses real stage names, flags thread/diary drift, and holds Move', () => {
  api.state.resourceId = 'nithin';
  api.state.weekStart = '2026-09-14';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.data = pipelineRead();
  const cols = api.pipelineBoardColumns();
  assert.equal(cols.length, 6);
  assert.equal(cols[0].name, 'Client Needs To Be Contacted');
  assert.equal(cols[cols.length - 1].name, 'Quoted and archived');
  assert.equal(api.MOVE_HOLD, true);
  const waiter = api.cases().find((c) => c.id === 'opp-wait');
  const booked = api.cases().find((c) => c.id === 'opp-booked');
  assert.equal(api.impliedStage(waiter).name, 'Contacted Waiting on Response');
  assert.equal(api.stageDrift(waiter).want.name, 'Contacted Waiting on Response');
  assert.equal(api.impliedStage(booked).name, 'Scope Booked');
  const html = api.renderHTML();
  assert.match(html, /GHL sales pipeline · two way/);
  assert.match(html, /Client Needs To Be Contacted/);
  assert.match(html, /Quoted and archived/);
  assert.match(html, /2 cards · 2 out of step · Move held/);
  assert.match(html, /pcard off/);
  assert.match(html, /Thread and diary say <b>Contacted Waiting on Response<\/b>/);
  assert.match(html, /Thread and diary say <b>Scope Booked<\/b>/);
  assert.match(html, /data-booking-move-held="1"/);
  assert.match(html, /Move \(held\)/);
  assert.doesNotMatch(html, /data-booking-move="/);
  assert.deepEqual(api.stampWriteBody().stage_moves, []);
});

test('KEEP round-trips through a stamp store: wipe local state, re-read, KEEP and the board card remain', async () => {
  const store = { stamp: { present: false, approved: [], rejected: [], decisions: {}, stage_moves: [] } };
  const base = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    pack: { present: true, as_of: '2026-09-17T04:00:00Z', week_start: '2026-09-14' },
    stamp: store.stamp,
    diary: [],
    cases: [{
      id: 'opp-offer',
      opportunity_id: 'opp-offer',
      contact_id: 'c-offer',
      display_name: 'Sam Ferry',
      suburb: 'Byford',
      job_type: 'fencing',
      status: 'needs_decision',
      stage_name: 'Presentation Made (scope not booked)',
      proposal: {
        disposition: 'offer',
        start_iso: '2026-09-18T11:15:00',
        end_iso: '2026-09-18T12:45:00',
        draft: 'Hi Sam, Friday 18 September between 11:15 and 12:45pm. Does that suit?'
      },
      stamp_state: 'none'
    }]
  };
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.drafts = {};
  api.state.cache = {};
  api.state.data = JSON.parse(JSON.stringify(base));
  api.state.selectedId = 'opp-offer';
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.SALES_BOOKING_PREVIEW_API = null;
  global.opsPost = async (action, body) => {
    assert.equal(action, 'sales_booking_stamp_write');
    store.stamp = {
      present: true,
      week_start: body.week_start,
      approved: (body.stamp && body.stamp.approved) || [],
      rejected: (body.stamp && body.stamp.rejected) || [],
      decisions: (body.stamp && body.stamp.decisions) || {},
      stage_moves: []
    };
    return { ok: true, stamp: store.stamp };
  };
  global.opsFetch = async () => {
    const next = JSON.parse(JSON.stringify(base));
    next.stamp = JSON.parse(JSON.stringify(store.stamp));
    if (next.stamp.present) {
      const st = next.stamp.rejected.length ? 'rejected' : (next.stamp.approved.length ? 'approved' : 'none');
      next.cases[0].stamp_state = st;
    }
    return next;
  };
  const sent = await api.writeStamp('opp-offer', 'keep');
  assert.equal(sent.posted, true);
  assert.deepEqual(store.stamp.approved, ['opp-offer']);
  assert.deepEqual(store.stamp.stage_moves, []);

  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.data = null;
  api.state.cache = {};
  await api.load('marnin', '2026-09-14');
  assert.equal(api.stampStateOf(api.cases()[0]), 'keep');
  const html = api.renderHTML();
  assert.match(html, /stampcard stamped/);
  assert.match(html, /GHL sales pipeline · two way/);
  assert.match(html, /Sam Ferry · Byford/);
  assert.match(html, /Presentation Made \(scope not booked\)/);
  api.state.resourceId = 'nithin';
});

test('a GHL 429 mapped to HTTP 500 keeps the last complete week on screen', async () => {
  api.state.resourceId = 'marnin';
  api.state.weekStart = '2026-09-14';
  api.state.cache = {};
  api.state.data = null;
  api.state.error = null;
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.SALES_BOOKING_PREVIEW_API = null;
  const good = sampleRead('marnin');
  good.coverage = { full_population: false, enumerated: 5, total: 1012, gaps: ['roster read degraded by GHL 429'] };
  global.opsFetch = async () => JSON.parse(JSON.stringify(good));
  await api.load('marnin', '2026-09-14');
  assert.equal(api.state.data.ok, true);
  assert.match(api.renderHTML(), /GHL rate limited/);
  global.opsFetch = async () => {
    const err = new Error('Too Many Requests');
    err.status = 500;
    throw err;
  };
  await api.load('marnin', '2026-09-14');
  assert.ok(api.state.data);
  assert.equal(api.state.stale, true);
  assert.match(api.state.error, /provider 429 returned as HTTP 500/);
  assert.match(api.renderHTML(), /Sample A/);
  assert.match(api.renderHTML(), /last complete week/);
  api.state.resourceId = 'nithin';
  api.state.cache = {};
  api.state.data = null;
  api.state.error = null;
  api.state.stale = false;
});

test('fixture refusal still wipes the workspace even when a cache exists', async () => {
  api.state.cache = {};
  api.state.data = null;
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.opsFetch = async () => sampleRead('nithin');
  await api.load('nithin', '2026-09-14');
  assert.ok(api.state.data);
  global.opsFetch = async () => ({ ok: true, fixture: true, events: [], cases: [] });
  await api.load('nithin', '2026-09-14');
  assert.match(api.state.error, /Fixture fallback is refused/);
  assert.equal(api.state.data, null);
});

test('a cached scoper week paints before the next read returns', async () => {
  api.state.resourceId = 'nithin';
  api.state.weekStart = '2026-09-14';
  api.state.cache = {};
  api.state.data = null;
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.SALES_BOOKING_PREVIEW_API = null;
  let resolveSlow;
  global.opsFetch = () => sampleRead('nithin');
  await api.load('nithin', '2026-09-14');
  const coldMs = api.state.lastReadMs;
  api.state.data = null;
  global.opsFetch = () => new Promise((resolve) => {
    resolveSlow = resolve;
  });
  const pending = api.load('nithin', '2026-09-14');
  assert.ok(api.state.data, 'cache must paint before the in-flight read resolves');
  assert.equal(api.state.stale, true);
  assert.equal(api.state.readKind, 'cache');
  assert.match(api.renderHTML(), /last complete read stays on screen/);
  resolveSlow(sampleRead('nithin'));
  await pending;
  assert.equal(api.state.stale, false);
  assert.equal(api.state.readKind, 'fresh');
  assert.ok(typeof coldMs === 'number');
});

test('a queue row with no job type prints not given once', () => {
  api.state.resourceId = 'nithin';
  api.state.weekStart = '2026-09-14';
  api.state.selectedId = 'opp-blank';
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'nithin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    diary: [],
    cases: [{
      id: 'opp-blank',
      opportunity_id: 'opp-blank',
      display_name: 'No Type Yet',
      suburb: 'Carlisle',
      job_type: 'not given',
      status: 'needs_decision',
      stage_name: 'Client Needs To Be Contacted'
    }]
  };
  const html = api.renderHTML();
  const hits = html.match(/not given/g) || [];
  assert.ok(hits.length >= 1);
  assert.doesNotMatch(html, /not given · not given/);
  assert.doesNotMatch(html, /<b>not given<\/b>/);
});

test('a week-nav 429 does not keep the previous week book', async () => {
  api.state.cache = {};
  api.state.data = null;
  api.state.error = null;
  api.state.stale = false;
  api.state.resourceId = 'nithin';
  api.state.weekStart = '2026-09-14';
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.SALES_BOOKING_PREVIEW_API = null;
  const weekA = sampleRead('nithin');
  weekA.week_start = '2026-09-14';
  weekA.cases[0].display_name = 'Week A Lead';
  global.opsFetch = async (_action, params) => {
    if (params && params.week_start === '2026-09-14') return JSON.parse(JSON.stringify(weekA));
    const err = new Error('Too Many Requests');
    err.status = 429;
    throw err;
  };
  await api.load('nithin', '2026-09-14');
  assert.match(api.renderHTML(), /Week A Lead/);
  await api.switchWeek(7);
  assert.equal(api.state.weekStart, '2026-09-21');
  assert.equal(api.state.data, null);
  assert.doesNotMatch(api.renderHTML(), /Week A Lead/);
  api.state.cache = {};
  api.state.data = null;
  api.state.error = null;
  api.state.stale = false;
  api.state.weekStart = '2026-09-14';
});

test('week-nav 429 keeps only the requested week cache', async () => {
  api.state.cache = {};
  api.state.data = null;
  api.state.error = null;
  api.state.stale = false;
  api.state.resourceId = 'nithin';
  global.SALES_BOOKING_PREVIEW_URL = null;
  global.SALES_BOOKING_PREVIEW_API = null;
  const weekA = sampleRead('nithin');
  weekA.week_start = '2026-09-14';
  weekA.cases[0].display_name = 'Week A Lead';
  const weekB = sampleRead('nithin');
  weekB.week_start = '2026-09-21';
  weekB.cases[0].display_name = 'Week B Lead';
  let failB = false;
  global.opsFetch = async (_action, params) => {
    if (params && params.week_start === '2026-09-14') return JSON.parse(JSON.stringify(weekA));
    if (failB) {
      const err = new Error('Too Many Requests');
      err.status = 429;
      throw err;
    }
    return JSON.parse(JSON.stringify(weekB));
  };
  await api.load('nithin', '2026-09-14');
  await api.load('nithin', '2026-09-21');
  assert.match(api.renderHTML(), /Week B Lead/);
  failB = true;
  await api.load('nithin', '2026-09-14');
  assert.match(api.renderHTML(), /Week A Lead/);
  await api.load('nithin', '2026-09-21');
  assert.ok(api.state.data);
  assert.equal(api.state.data.week_start, '2026-09-21');
  assert.equal(api.state.stale, true);
  assert.match(api.renderHTML(), /Week B Lead/);
  assert.doesNotMatch(api.renderHTML(), /Week A Lead/);
  api.state.cache = {};
  api.state.data = null;
  api.state.error = null;
  api.state.stale = false;
  api.state.weekStart = '2026-09-14';
});

test('diary evidence leaves quoted, folded, and already-booked cards in their stage', () => {
  function diaryFor(id, name, suburb) {
    return [{
      event_id: 'evt-' + id,
      opportunity_id: id,
      contact_id: 'ct-' + id,
      display_name: name,
      suburb: suburb,
      start_iso: '2026-09-16T10:00:00',
      end_iso: '2026-09-16T11:00:00',
      kind: 'confirmed',
      layer: 'confirmed',
      title: 'Scope: ' + name
    }];
  }

  api.state.resourceId = 'nithin';
  api.state.weekStart = '2026-09-14';
  api.state.filter = 'all';
  api.state.search = '';
  api.state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'nithin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    diary_read: { read_ok: true, source: 'ghl_calendar' },
    diary: diaryFor('opp-quoted', 'Quoted Pat', 'Carlisle').concat(diaryFor('opp-complete', 'Done Pat', 'Merriwa')),
    cases: [{
      id: 'opp-quoted',
      opportunity_id: 'opp-quoted',
      contact_id: 'ct-opp-quoted',
      display_name: 'Quoted Pat',
      suburb: 'Carlisle',
      job_type: 'patio',
      status: 'needs_decision',
      stage_id: 'd2fb3af7-91e5-4317-b778-2be117341f07',
      stage_name: 'Quote Sent / Follow up'
    }, {
      id: 'opp-complete',
      opportunity_id: 'opp-complete',
      contact_id: 'ct-opp-complete',
      display_name: 'Done Pat',
      suburb: 'Merriwa',
      job_type: 'patio',
      status: 'needs_decision',
      stage_id: '9b9e5313-8e0e-4ed6-8654-d50413b99885',
      stage_name: 'Scope Complete / Quote to be Sent'
    }]
  };
  const quoted = api.cases().find((c) => c.id === 'opp-quoted');
  const complete = api.cases().find((c) => c.id === 'opp-complete');
  assert.equal(api.impliedStage(quoted).name, 'Quote Sent / Follow up');
  assert.equal(api.stageDrift(quoted), null);
  assert.equal(api.impliedStage(complete).name, 'Scope Complete / Quote to be Sent');
  assert.equal(api.stageDrift(complete), null);

  api.state.resourceId = 'marnin';
  api.state.data = {
    ok: true,
    fixture: false,
    resource: { id: 'marnin', calendar: { ok: true } },
    week_start: '2026-09-14',
    coverage: { gaps: [] },
    diary_read: { read_ok: true, source: 'ghl_calendar' },
    diary: diaryFor('opp-scheduled', 'Scheduled Fen', 'Byford'),
    cases: [{
      id: 'opp-scheduled',
      opportunity_id: 'opp-scheduled',
      contact_id: 'ct-opp-scheduled',
      display_name: 'Scheduled Fen',
      suburb: 'Byford',
      job_type: 'fencing',
      status: 'needs_decision',
      stage_id: '4dc3da8f-d713-4bd4-851c-8e89b6682a4e',
      stage_name: 'Scope Scheduled'
    }]
  };
  const scheduled = api.cases().find((c) => c.id === 'opp-scheduled');
  assert.equal(api.impliedStage(scheduled).name, 'Scope Scheduled');
  assert.equal(api.stageDrift(scheduled), null);
  api.state.resourceId = 'nithin';
});
