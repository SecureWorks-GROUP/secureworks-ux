import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleLocal, readConversation, readPerformance, latestClosedWeek } from './sales-booking-local-api.mjs';

function storePath(t, name) {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-sales-booking-local-api-tests-'));
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, name + '.json');
}

test('conversation read requires a contact id and invents no messages', async () => {
  const r = await readConversation({}, async () => ({ conversations: [{ id: 'should-not-run' }] }));
  assert.equal(r.ok, false);
  assert.equal(r.fixture, false);
  assert.equal(r.read_only, true);
  assert.deepEqual(r.messages, []);
});

test('empty provider conversation page is empty coverage, not a fixture thread', async () => {
  const r = await readConversation({ contactId: 'c1' }, async (tool) => {
    assert.equal(tool, 'sw_list_ghl_conversations');
    return { conversations: [], pagination: { has_more: false } };
  });
  assert.equal(r.ok, true);
  assert.equal(r.fixture, false);
  assert.equal(r.messages.length, 0);
  assert.equal(r.conversation_id, null);
  assert.equal(r.coverage.complete, true);
  assert.ok(r.coverage.gaps.length);
});

test('paged messages expose source ids and last_message_id', async () => {
  const r = await readConversation({ contactId: 'c1' }, async (tool, args) => {
    if (tool === 'sw_list_ghl_conversations') {
      return { conversations: [{ id: 'conv-9' }], pagination: { has_more: false } };
    }
    assert.equal(tool, 'sw_list_ghl_messages');
    assert.equal(args.conversation_id, 'conv-9');
    assert.equal(args.contact_id, 'c1');
    return {
      messages: [
        { id: 'm-old', body: 'Hi', direction: 'inbound', dateAdded: '2026-09-10T01:00:00Z' },
        { id: 'm-new', body: 'Thursday after 1', direction: 'inbound', dateAdded: '2026-09-12T05:00:00Z' }
      ],
      pagination: { has_more: true, next_cursor: 'm-old' }
    };
  });
  assert.equal(r.ok, true);
  assert.equal(r.fixture, false);
  assert.equal(r.read_only, true);
  assert.equal(r.conversation_id, 'conv-9');
  assert.equal(r.messages.length, 2);
  assert.deepEqual(r.coverage.source_message_ids, ['m-old', 'm-new']);
  assert.equal(r.pagination.has_more, true);
  assert.equal(r.pagination.last_message_id, 'm-old');
  assert.equal(r.coverage.complete, false);
});

test('closed week clock matches the stored-report reader', () => {
  assert.equal(latestClosedWeek(new Date('2026-09-13T15:59:59Z')), '2026-08-31');
  assert.equal(latestClosedWeek(new Date('2026-09-13T16:00:00Z')), '2026-09-07');
});

test('performance read never invents measure rows when storage is unavailable', async () => {
  const r = await readPerformance({}, null, new Date('2026-09-13T16:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(r.fixture, false);
  assert.equal(r.read_only, true);
  assert.deepEqual(r.rows, []);
  assert.equal(r.week_start, '2026-09-07');
  assert.deepEqual(r.week_starts, ['2026-09-07', '2026-08-31', '2026-08-24', '2026-08-17']);
  assert.equal(r.missing_latest_closed_week, true);
  assert.equal(r.coverage.complete, false);
  assert.equal(r.coverage.source, 'sales_performance_read');
  assert.equal(r.unpublished, true);
  assert.equal(r.storage_provenance, null);
  assert.ok(r.coverage.as_of);
});

test('performance read passes stored rows through unchanged', async () => {
  const stored = {
    rows: [{ lane: 'patio', week_start: '2026-08-31', computed_at: '2026-09-07T00:00:00Z', metrics: { enquiries_in: 4 }, coverage: { collection_complete: true, gaps: [] }, queues: {} }],
    week_start: '2026-08-31',
    week_starts: ['2026-08-31', '2026-08-24', '2026-08-17', '2026-08-10'],
    fetched_at: '2026-09-07T01:00:00Z'
  };
  const r = await readPerformance({ week_start: '2026-08-31' }, async () => stored);
  assert.equal(r.ok, true);
  assert.equal(r.fixture, false);
  assert.equal(r.rows[0].metrics.enquiries_in, 4);
  assert.equal(r.week_start, '2026-08-31');
});

test('invalid performance week_start is refused without filling rows', async () => {
  const r = await readPerformance({ week_start: '2026-09-13' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.rows, []);
});

test('slow booking read merges provider rows without losing concurrent workflow writes', async (t) => {
  const file = storePath(t, 'merge');
  fs.writeFileSync(file, JSON.stringify({
    cases: {
      'opp-1': { id: 'opp-1', resource_id: 'nithin', opportunity_id: 'opp-1', contact_id: 'contact-1', status: 'needs_decision' }
    },
    drafts: {},
    offers: {},
    actions: [],
    archives: {},
    assessments: {},
    cursors: {},
    seenEvents: []
  }));
  let resolvePage;
  const read = handleLocal('sales_booking_read', { resource: 'nithin', week_start: '2026-09-14' }, {}, () => new Promise((resolve) => { resolvePage = resolve; }), file);
  await handleLocal('sales_booking_draft', {}, { case_id: 'opp-1', text: 'Saved while read waits', human_edited: true, expected_revision: 0 }, null, file);
  await handleLocal('sales_booking_archive', {}, { case_id: 'opp-1', reason: 'declined' }, null, file);
  await handleLocal('sales_booking_restore', {}, { case_id: 'opp-1' }, null, file);
  resolvePage({
    opportunities: [{ id: 'opp-1', contactId: 'contact-1', contact: { id: 'contact-1', name: 'Alice Example', tags: ['patio'] } }],
    pagination: { has_more: false, total: 1 }
  });
  const result = await read;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.drafts['opp-1'].revision, 1);
  assert.equal(saved.drafts['opp-1'].text, 'Saved while read waits');
  assert.equal(saved.archives['opp-1'].restored, true);
  assert.equal(result.drafts['opp-1'].revision, 1);
  assert.equal(result.cases[0].archived, null);
});

test('completed opportunity cursor still refreshes the current workload', async (t) => {
  const file = storePath(t, 'refresh');
  fs.writeFileSync(file, JSON.stringify({
    cases: {},
    drafts: {},
    offers: {},
    actions: [],
    archives: {},
    assessments: {},
    cursors: { 'consume:nithin:2026-09-14': { complete: true, next: null, total: 1, pages: 3 } },
    seenEvents: []
  }));
  const calls = [];
  const result = await handleLocal('sales_booking_read', { resource: 'nithin', week_start: '2026-09-14' }, {}, async (tool, args) => {
    calls.push({ tool, args });
    return {
      opportunities: [{ id: 'opp-new', contactId: 'contact-new', contact: { id: 'contact-new', name: 'New Enquiry', tags: [] } }],
      pagination: { has_more: false, total: 0 }
    };
  }, file);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, 'sw_list_ghl_opportunities');
  assert.equal(calls[0].args.start_after, undefined);
  assert.equal(result.cases.some((c) => c.id === 'opp-new'), true);
  assert.equal(result.coverage.full_population, true);
  assert.equal(result.coverage.total, 0);
});

test('slow assessment commit preserves concurrent draft writes', async (t) => {
  const file = storePath(t, 'assess-merge');
  fs.writeFileSync(file, JSON.stringify({
    cases: {
      'case-a': { id: 'case-a', resource_id: 'nithin', opportunity_id: 'case-a', contact_id: 'contact-a', status: 'needs_decision' }
    },
    drafts: {},
    offers: {},
    actions: [],
    archives: {},
    assessments: {},
    cursors: {},
    seenEvents: []
  }));
  let resolveReason;
  const assess = handleLocal('sales_booking_assess', {}, {
    case_id: 'case-a',
    input: {
      messages: [{ id: 'in-1', direction: 'inbound', timestamp: '2026-09-12T13:00:00Z', body: 'Thursday after 1pm' }],
      week_start: '2026-09-14',
      calendar_retrieved_at: '2026-09-12T13:00:00Z',
      leave_retrieved_at: '2026-09-12T13:00:00Z',
      travel_retrieved_at: '2026-09-12T13:00:00Z',
      leave_intervals: [],
      travel_minutes: 0,
      now: '2026-09-12T13:00:00Z',
      events: [],
      pending_offers: [],
      reasonAsync: async () => new Promise((resolve) => { resolveReason = resolve; })
    }
  }, null, file);
  await handleLocal('sales_booking_draft', {}, { case_id: 'case-a', text: 'Draft during assessment', human_edited: true, expected_revision: 0 }, null, file);
  resolveReason({});
  await assess;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.drafts['case-a'].revision, 1);
  assert.equal(saved.drafts['case-a'].text, 'Draft during assessment');
  assert.equal(saved.assessments['case-a'].version, 'sales-booking-assess-v2.4');
});

test('draft CAS rejects a second write with the same expected revision', async (t) => {
  const file = storePath(t, 'draft-cas');
  fs.writeFileSync(file, JSON.stringify({
    cases: {},
    drafts: {},
    offers: {},
    actions: [],
    archives: {},
    assessments: {},
    cursors: {},
    seenEvents: []
  }));
  const first = await handleLocal('sales_booking_draft', {}, { case_id: 'case-a', text: 'First', human_edited: true, expected_revision: 0 }, null, file);
  const second = await handleLocal('sales_booking_draft', {}, { case_id: 'case-a', text: 'Second', human_edited: true, expected_revision: 0 }, null, file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(first.revision, 1);
  assert.equal(second.code, 'cas_conflict');
  assert.equal(saved.drafts['case-a'].text, 'First');
});
