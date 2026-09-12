const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = require('./ops-sales-booking.js');

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

test('host wires Sales parent, keeps Performance restore, and loads Booking', () => {
  const s = fs.readFileSync(require.resolve('../ops.html'), 'utf8');
  assert.equal((s.match(/data-view="sales"/g) || []).length, 2);
  assert.match(s, /id="viewSales"/);
  assert.match(s, /id="salesBookingRoot"/);
  assert.match(s, /id="salesPerformanceRoot"/);
  assert.match(s, /modules\/ops-sales-booking\.js/);
  assert.match(s, /'materials', 'performance', 'booking', 'sales', 'inbox'/);
  assert.ok(s.indexOf('modules/ops-sales-booking.js') < s.indexOf('function showView('));
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
  assert.match(first.text, /2:00pm/);
  assert.match(first.text, /Nithin/);
  api.state.drafts['case-a'].humanEdited = true;
  api.state.drafts['case-a'].text = 'Keep my wording';
  const second = api.reviseProposedTime('2026-09-17T15:00:00');
  assert.equal(second.conflict, true);
  assert.equal(api.state.drafts['case-a'].text, 'Keep my wording');
  assert.match(second.suggested, /3:00pm/);
});

test('render after unedited time change keeps the revised draft, not the old proposal text', () => {
  api.state.resourceId = 'nithin';
  api.state.data = sampleRead();
  api.state.selectedId = 'case-a';
  api.state.drafts = {};
  api.reviseProposedTime('2026-09-17T14:00:00');
  const html = api.renderHTML();
  assert.match(html, /2:00pm/);
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

test('Marnin sender stays unresolved between 772 and 776', () => {
  api.state.resourceId = 'marnin';
  const route = api.resolveSender(api.RESOURCES.marnin);
  assert.equal(route.resolved, false);
  assert.equal(route.number, null);
  assert.equal(route.candidates.length, 2);
  api.state.data = sampleRead('marnin');
  api.state.selectedId = 'case-a';
  const result = api.attemptApprove();
  assert.equal(result.reason, 'sender_unresolved');
  assert.equal(result.sent, false);
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
