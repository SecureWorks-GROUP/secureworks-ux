import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const assess = require('../modules/sales-booking-assess.cjs');

const PIPELINES = {
  nithin: 'OGZLpPPVWVarN94HL6af',
  marnin: 'I9t8njpuR0Dm7B2NDcvI',
  khairo: 'I9t8njpuR0Dm7B2NDcvI'
};

export function createLocalStore(filePath) {
  const empty = { cases: {}, drafts: {}, offers: {}, actions: [], archives: {}, assessments: {}, cursors: {}, seenEvents: [] };
  function load() {
    try { return Object.assign(empty, JSON.parse(fs.readFileSync(filePath, 'utf8'))); } catch { return structuredClone(empty); }
  }
  function save(s) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(s));
  }
  return { load, save };
}

function phoneLike(name) {
  return !!name && /^(\+61|0)\d/.test(String(name).replace(/\s/g, ''));
}

function shiftMonday(week, days) {
  return new Date(Date.parse(week + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

/** Same closed-week clock as ops-api sales_performance_read (Australia/Perth). */
export function latestClosedWeek(now = new Date()) {
  const perth = new Date(now.getTime() + 8 * 3600000);
  return shiftMonday(perth.toISOString().slice(0, 10), -((perth.getUTCDay() + 6) % 7) - 7);
}

function mondayOrThrow(value) {
  const week = String(value || '');
  const date = new Date(week + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== week || date.getUTCDay() !== 1) {
    const err = new Error('invalid_week_start');
    err.code = 'invalid_week_start';
    throw err;
  }
  return week;
}

/**
 * Read-only stored weekly desk reports. Same envelope as ops-api sales_performance_read.
 * Never invents measure rows. Empty rows mean missing reports, not zeros.
 */
export async function readPerformance(params, fetchStored, now = new Date()) {
  const fetched_at = now.toISOString();
  const closed = latestClosedWeek(now);
  let requested = null;
  if (params && params.week_start) {
    try {
      requested = mondayOrThrow(params.week_start);
    } catch {
      return { ok: false, fixture: false, read_only: true, error: 'invalid_week_start', rows: [], week_starts: [] };
    }
  }
  if (typeof fetchStored === 'function') {
    try {
      const stored = await fetchStored({ week_start: requested });
      if (stored && Array.isArray(stored.rows) && Array.isArray(stored.week_starts)) {
        if (stored.fixture === true) {
          return { ok: false, fixture: false, read_only: true, error: 'Fixture performance rows are refused.', rows: [], week_starts: [] };
        }
        return Object.assign({}, stored, {
          ok: true,
          fixture: false,
          read_only: true,
          fetched_at: stored.fetched_at || fetched_at
        });
      }
    } catch (e) {
      const week = requested || closed;
      const week_starts = [0, 1, 2, 3].map((i) => shiftMonday(week, -7 * i));
      return {
        ok: true,
        fixture: false,
        read_only: true,
        rows: [],
        week_start: week,
        week_starts,
        latest_closed_week: closed,
        latest_stored_closed_week: null,
        missing_latest_closed_week: true,
        available_weeks: [],
        fetched_at,
        coverage: {
          complete: false,
          as_of: fetched_at,
          source: 'sales_performance_read',
          gaps: [
            'Stored weekly desk reports were not retrieved: ' + (e && e.message ? e.message : 'provider error'),
            'Empty rows are missing reports, not zero measures.'
          ]
        }
      };
    }
  }
  const week = requested || closed;
  const week_starts = [0, 1, 2, 3].map((i) => shiftMonday(week, -7 * i));
  return {
    ok: true,
    fixture: false,
    read_only: true,
    rows: [],
    week_start: week,
    week_starts,
    latest_closed_week: closed,
    latest_stored_closed_week: null,
    missing_latest_closed_week: true,
    available_weeks: [],
    fetched_at,
    coverage: {
      complete: false,
      as_of: fetched_at,
      source: 'sales_performance_read',
      gaps: [
        'Isolated preview has no staff JWT for ops-api sales_performance_read.',
        'Production path remains authenticated opsFetch sales_performance_read.',
        'Empty rows are missing reports, not zero measures. Filters and drilldowns still operate on this envelope.'
      ]
    }
  };
}

export async function handleLocal(action, params, body, mcpCall, storeFile) {
  const db = createLocalStore(storeFile);
  const store = db.load();
  if (action === 'sales_booking_policy') {
    return { ok: true, policy: { activation: 'held', send: 'held', calendar_write: 'held', debounce_seconds: 60, catch_up_minutes: 15, daily_reconcile: '06:00 Australia/Perth after CIO context pass' }, version: 'sales-booking-api/v1' };
  }
  if (action === 'sales_booking_read') {
    const resource = params.resource || 'nithin';
    const weekStart = params.week_start || '2026-09-14';
    const pipeline = PIPELINES[resource];
    const cursorKey = 'consume:' + resource + ':' + weekStart;
    const cursor = store.cursors[cursorKey] || { complete: false, next: null, total: null, pages: 0 };
    let pages = 0;
    while (!cursor.complete && pages < 8) {
      const args = { pipeline_id: pipeline, status: 'open', limit: 20 };
      if (cursor.next && cursor.next.start_after) {
        args.start_after = cursor.next.start_after;
        args.start_after_id = cursor.next.start_after_id;
      }
      const page = await mcpCall('sw_list_ghl_opportunities', args);
      const items = (page.data && page.data.opportunities) || page.opportunities || [];
      const pag = page.pagination || {};
      for (const item of items) {
        const contact = item.contact || {};
        const name = contact.name || item.name || '';
        const existing = store.cases[item.id] || {};
        if (existing.resource_id && existing.resource_id !== resource) continue;
        store.cases[item.id] = Object.assign({}, existing, {
          id: item.id,
          resource_id: resource,
          opportunity_id: item.id,
          contact_id: item.contactId || contact.id || null,
          suburb: existing.suburb || null,
          display_name: phoneLike(name) ? (existing.suburb || 'Enquiry') : (name || existing.display_name || 'Enquiry'),
          status: existing.status || 'needs_decision',
          tags: contact.tags || []
        });
      }
      cursor.pages = (cursor.pages || 0) + 1;
      cursor.total = (page.data && page.data.meta && page.data.meta.total) || pag.total || cursor.total;
      cursor.complete = pag.complete === true || pag.has_more === false;
      if (items.length === 0 && pag.complete !== true && pag.has_more == null) cursor.complete = false;
      cursor.next = pag.next_cursor || (pag.has_more === false ? null : cursor.next);
      store.cursors[cursorKey] = cursor;
      pages += 1;
      if (pag.complete !== true && pag.has_more !== false) break;
    }
    db.save(store);
    const cases = Object.values(store.cases).filter((c) => c.resource_id === resource).map((c) => Object.assign({}, c, {
      draft: store.drafts[c.id] || null,
      assessment: store.assessments[c.id] || null,
      archived: store.archives[c.id] && !store.archives[c.id].restored ? store.archives[c.id] : null
    }));
    return {
      ok: true,
      fixture: false,
      send_hold: true,
      version: 'sales-booking-api/v1',
      week_start: weekStart,
      coverage: {
        full_population: cursor.complete === true,
        enumerated: cases.filter((c) => c.opportunity_id).length,
        total: cursor.total || null,
        operational_leave: 'not_read',
        gaps: [
          cursor.complete === true ? 'Opportunity enumeration terminal for this resource.' : 'Opportunity enumeration still paging; empty or missing-next is not a completed book.',
          'Leave and travel remain unread. Missing coverage is not free capacity.'
        ]
      },
      cases,
      drafts: store.drafts,
      policy: { activation: 'held' }
    };
  }
  if (action === 'sales_booking_draft') {
    const id = body.case_id;
    const prev = store.drafts[id] || { revision: 0 };
    const expected = body.expected_revision == null ? 0 : Number(body.expected_revision);
    if (Number(prev.revision || 0) !== expected) {
      return { ok: false, code: 'cas_conflict', error: 'Draft revision conflict' };
    }
    const next = {
      ok: true,
      case_id: id,
      text: body.text,
      human_edited: !!body.human_edited,
      sender: body.sender || prev.sender || null,
      revision: Number(prev.revision || 0) + 1
    };
    store.drafts[id] = next;
    db.save(store);
    return next;
  }
  if (action === 'sales_booking_archive') {
    const c = store.cases[body.case_id];
    if (c && (c.event_id || c.exact_acceptance)) return { ok: false, reason: 'commitment_visible', crm_deleted: false };
    store.archives[body.case_id] = { reason: body.reason, restored: false, contact_id: c && c.contact_id, crm_deleted: false };
    db.save(store);
    return store.archives[body.case_id];
  }
  if (action === 'sales_booking_restore') {
    if (store.archives[body.case_id]) store.archives[body.case_id].restored = true;
    db.save(store);
    return { ok: true, crm_deleted: false };
  }
  if (action === 'sales_booking_assess') {
    const input = Object.assign({}, body.input || {});
    const payload = typeof assess.assessWithReason === 'function'
      ? await assess.assessWithReason(input)
      : assess.assess(input);
    store.assessments[body.case_id] = { version: payload.version, payload, at: new Date().toISOString() };
    db.save(store);
    return store.assessments[body.case_id];
  }
  if (action === 'sales_booking_approve' || action === 'sales_booking_confirm') {
    if (body.fake === true || body.execute === true) return { ok: false, reason: 'fixture_control_refused', sent: false, held: true };
    const c = store.cases[body.case_id] || {};
    const draft = store.drafts[body.case_id];
    if (body.kind && body.kind !== (action === 'sales_booking_confirm' ? 'confirm_booking' : 'approve_offer')) {
      return { ok: false, reason: 'invalid_action_kind', held: true };
    }
    if (body.recipient && c.contact_id && body.recipient !== String(c.contact_id)) {
      return { ok: false, reason: 'recipient_mismatch', sent: false, held: true };
    }
    if (body.resource_id && c.resource_id && body.resource_id !== c.resource_id) {
      return { ok: false, reason: 'resource_mismatch', sent: false, held: true };
    }
    if (action === 'sales_booking_confirm') {
      if (!c.exact_acceptance || !body.start_iso || !body.end_iso || !body.offer_id) {
        return { ok: false, reason: 'no_exact_acceptance', sent: false, held: true, booked: false };
      }
      if (c.accepted_offer_id && body.offer_id !== c.accepted_offer_id) {
        return { ok: false, reason: 'accepted_slot_mismatch', sent: false, held: true, booked: false };
      }
    }
    store.actions.push({
      kind: body.kind || (action === 'sales_booking_confirm' ? 'confirm_booking' : 'approve_offer'),
      case_id: body.case_id,
      status: 'held',
      send_evidence: 'held',
      start_iso: body.start_iso || null,
      end_iso: body.end_iso || null,
      offer_id: body.offer_id || null,
      resource_id: body.resource_id || null,
      recipient: body.recipient || null,
      sender: body.sender || null,
      draft_revision: body.draft_revision || (draft && draft.revision) || 0,
      source_version: body.source_version || null
    });
    db.save(store);
    return { ok: false, held: true, sent: false, waiting: false, booked: false, reason: 'send_hold', persisted: true };
  }
  if (action === 'sales_booking_on_event') {
    if (store.seenEvents.includes(body.event_key)) return { ok: true, duplicate: true };
    store.seenEvents.push(body.event_key);
    db.save(store);
    return { ok: true, duplicate: false };
  }
  if (action === 'sales_booking_reconcile') return { ok: true, invalidated: Object.keys(store.assessments).length, activation: 'held' };
  if (action === 'sales_booking_runner') return { ok: true, ran: false, reason: 'runner_held' };
  return { ok: false, error: 'unknown action' };
}

function unwrapProvider(page) {
  if (!page || typeof page !== 'object') return {};
  if (page.data && typeof page.data === 'object' && !Array.isArray(page.data)) {
    return Object.assign({}, page, page.data);
  }
  return page;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function paginationOf(page) {
  return (page && page.pagination) || {};
}

function paginationHasMore(page) {
  const pag = paginationOf(page);
  if (pag.complete === true) return false;
  if (pag.has_more === false) return false;
  if (pag.has_more === true) return true;
  if (pag.next_cursor) return true;
  return false;
}

function paginationCursor(page, key) {
  const pag = paginationOf(page);
  if (pag.next_cursor) return pag.next_cursor;
  if (key && pag[key]) return pag[key];
  return null;
}

function rawMessagesOf(page) {
  if (Array.isArray(page.messages)) return page.messages;
  if (page.messages && Array.isArray(page.messages.messages)) return page.messages.messages;
  if (Array.isArray(page.data)) return page.data;
  return [];
}

function normalizeMessage(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    id: m.id || m.message_id || null,
    type: String(m.messageType || m.type || 'SMS').toUpperCase(),
    direction: m.direction || (m.userId ? 'outbound' : 'inbound'),
    body: m.body || m.message || m.text || '',
    timestamp: m.dateAdded || m.createdAt || m.timestamp || '',
    sender_name: m.userName || (m.user && m.user.name) || ''
  };
}

/** Read-only GHL thread via the authorised sw-mcp provider route. Never invents messages. */
export async function readConversation(params, mcpCall) {
  const contactId = params.contactId || params.contact_id || '';
  if (!contactId) {
    return { ok: false, error: 'contactId required', fixture: false, read_only: true, messages: [] };
  }
  const retrieved_at = new Date().toISOString();
  const limit = Math.min(100, Math.max(1, Number(params.limit || 50)));
  let conversationId = params.conversationId || params.conversation_id || null;
  const gaps = [];
  let conversationHasMore = false;
  let conversationNext = null;
  let conversationCount = conversationId ? 1 : 0;

  if (!conversationId) {
    const convPage = unwrapProvider(await mcpCall('sw_list_ghl_conversations', {
      contact_id: contactId,
      limit: 50,
      ...(params.start_after_date ? { start_after_date: params.start_after_date } : {})
    }));
    const convs = asArray(convPage.conversations);
    conversationCount = convs.length;
    conversationHasMore = paginationHasMore(convPage);
    conversationNext = paginationCursor(convPage, 'start_after_date');
    conversationId = convs[0] && (convs[0].id || convs[0].conversation_id) || null;
    if (conversationHasMore) gaps.push('Additional conversations exist; this page is not the full set.');
    if (!conversationId) {
      return {
        ok: true,
        fixture: false,
        read_only: true,
        contact_id: contactId,
        conversation_id: null,
        messages: [],
        retrieved_at,
        pagination: { has_more: conversationHasMore, next_cursor: conversationNext, last_message_id: null },
        coverage: {
          complete: conversationHasMore === false,
          has_more: conversationHasMore,
          next_cursor: conversationNext,
          conversation_count: conversationCount,
          message_count: 0,
          contact_id: contactId,
          conversation_id: null,
          source: 'sw_list_ghl_conversations',
          source_message_ids: [],
          retrieved_at,
          gaps: gaps.concat(['No conversation found for this contact in this provider page.'])
        }
      };
    }
  }

  const msgArgs = { contact_id: contactId, conversation_id: conversationId, limit };
  if (params.last_message_id) msgArgs.last_message_id = params.last_message_id;
  const msgPage = unwrapProvider(await mcpCall('sw_list_ghl_messages', msgArgs));
  const raw = rawMessagesOf(msgPage);
  const messages = raw.map(normalizeMessage).filter(Boolean);
  const msgHasMore = paginationHasMore(msgPage);
  const lastId = messages.length ? messages[messages.length - 1].id : null;
  const msgNext = paginationCursor(msgPage, 'last_message_id') || (msgHasMore ? lastId : null);
  if (msgHasMore) gaps.push('Older messages exist. Follow last_message_id.');
  if (messages.some((m) => !m.id)) gaps.push('Some messages arrived without a provider id.');

  return {
    ok: true,
    fixture: false,
    read_only: true,
    contact_id: contactId,
    conversation_id: conversationId,
    messages,
    retrieved_at,
    pagination: {
      has_more: msgHasMore,
      next_cursor: msgNext,
      last_message_id: msgHasMore ? msgNext : null
    },
    coverage: {
      complete: msgHasMore === false && conversationHasMore === false,
      has_more: msgHasMore || conversationHasMore,
      next_cursor: msgHasMore ? msgNext : conversationNext,
      conversation_count: conversationCount,
      message_count: messages.length,
      contact_id: contactId,
      conversation_id: conversationId,
      source: 'sw_list_ghl_conversations+sw_list_ghl_messages',
      source_message_ids: messages.map((m) => m.id).filter(Boolean),
      retrieved_at,
      gaps
    }
  };
}
