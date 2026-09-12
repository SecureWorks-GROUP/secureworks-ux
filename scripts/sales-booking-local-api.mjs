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
    const cursorKey = 'opps:' + resource;
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
        store.cases[item.id] = Object.assign({}, store.cases[item.id], {
          id: item.id,
          resource_id: resource,
          opportunity_id: item.id,
          contact_id: item.contactId || contact.id || null,
          suburb: null,
          display_name: phoneLike(name) ? 'Enquiry' : (name || 'Enquiry'),
          status: (store.cases[item.id] && store.cases[item.id].status) || 'needs_decision',
          tags: contact.tags || []
        });
      }
      cursor.pages = (cursor.pages || 0) + 1;
      cursor.total = (page.data && page.data.meta && page.data.meta.total) || pag.total || cursor.total;
      cursor.complete = pag.has_more === false || pag.complete === true || items.length === 0;
      cursor.next = pag.next_cursor || null;
      store.cursors[cursorKey] = cursor;
      pages += 1;
      if (cursor.complete) break;
    }
    db.save(store);
    const cases = Object.values(store.cases).filter((c) => c.resource_id === resource);
    return {
      ok: true,
      fixture: false,
      send_hold: true,
      version: 'sales-booking-api/v1',
      week_start: weekStart,
      coverage: {
        full_population: !!cursor.complete,
        enumerated: cases.length,
        total: cursor.total || cases.length,
        operational_leave: 'not_read',
        gaps: [
          cursor.complete ? 'Opportunity enumeration terminal for this resource.' : 'Opportunity enumeration still paging; not a completed empty book.',
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
    store.drafts[id] = { case_id: id, text: body.text, human_edited: !!body.human_edited, revision: prev.revision + 1 };
    db.save(store);
    return store.drafts[id];
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
    delete input.coverage;
    const payload = typeof assess.assessWithReason === 'function'
      ? await assess.assessWithReason(input)
      : assess.assess(input);
    store.assessments[body.case_id] = { version: payload.version, payload, at: new Date().toISOString() };
    db.save(store);
    return store.assessments[body.case_id];
  }
  if (action === 'sales_booking_approve' || action === 'sales_booking_confirm') {
    if (body.execute && !body.fake) return { ok: false, reason: 'live_write_refused', sent: false };
    store.actions.push({ kind: action, case_id: body.case_id, status: 'held', send_evidence: 'held' });
    db.save(store);
    return { ok: false, held: true, sent: false, waiting: false, reason: 'send_hold' };
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
