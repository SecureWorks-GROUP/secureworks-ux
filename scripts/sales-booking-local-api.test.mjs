import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConversation } from './sales-booking-local-api.mjs';

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
