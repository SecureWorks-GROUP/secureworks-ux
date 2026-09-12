import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConversation, readPerformance, latestClosedWeek } from './sales-booking-local-api.mjs';

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
