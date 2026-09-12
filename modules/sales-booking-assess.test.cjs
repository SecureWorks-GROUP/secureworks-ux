const { test } = require('node:test');
const assert = require('node:assert/strict');
const assess = require('./sales-booking-assess.cjs');

const nithin = {
  name: 'Nithin',
  lane: 'patio',
  desk_rules: { monday_from: 12, no_wednesday: true, last_start: 15.5 }
};

test('window after 13:00 on Thursday is not exact acceptance', () => {
  const result = assess.assess({
    week_start: '2026-09-14',
    resource: nithin,
    suburb: 'Sampleton',
    messages: [{ direction: 'inbound', timestamp: '1', body: 'Thursday after 1pm is ok if that works' }],
    events: [],
    pending_offers: []
  });
  assert.equal(result.exact_acceptance, false);
  assert.equal(result.status, 'ready');
  assert.equal(result.proposal.start_iso, '2026-09-17T13:00:00');
  assert.match(result.draft, /1:00pm/);
});

test('contextual yes after an offer becomes confirm-booking, not a new ghost', () => {
  const result = assess.assess({
    week_start: '2026-09-14',
    resource: nithin,
    messages: [
      { direction: 'outbound', timestamp: '1', body: 'Can I come Thursday 17 September at 1:00pm?' },
      { direction: 'inbound', timestamp: '2', body: 'Yes that works' }
    ]
  });
  assert.equal(result.reply_kind, 'acceptance');
  assert.equal(result.exact_acceptance, true);
  assert.equal(result.status, 'needs_decision');
});

test('later cancellation leaves the diary occupied as repair', () => {
  const result = assess.assess({
    week_start: '2026-09-14',
    resource: nithin,
    messages: [
      { direction: 'outbound', timestamp: '1', body: 'See you Tuesday 8:30am' },
      { direction: 'inbound', timestamp: '2', body: 'Yes' },
      { direction: 'inbound', timestamp: '3', body: 'Sorry I need to cancel Tuesday' }
    ],
    events: [{ start_iso: '2026-09-15T08:30:00', end_iso: '2026-09-15T09:30:00' }]
  });
  assert.equal(result.reply_kind, 'cancellation');
  assert.equal(result.status, 'repair');
});

test('pending offer blocks the same slot for someone else', () => {
  const result = assess.assess({
    week_start: '2026-09-14',
    resource: nithin,
    suburb: 'Sampleton',
    messages: [{ direction: 'inbound', timestamp: '1', body: 'Tuesday after 2pm' }],
    events: [],
    pending_offers: [{ start_iso: '2026-09-15T14:00:00', end_iso: '2026-09-15T15:00:00' }]
  });
  assert.ok(result.proposal);
  assert.notEqual(result.proposal.start_iso, '2026-09-15T14:00:00');
});

test('fencing tag on a patio resource is a decision, not a Patio offer', () => {
  const result = assess.assess({
    week_start: '2026-09-14',
    resource: nithin,
    tags: ['missed-call', 'sw fencing'],
    messages: [{ direction: 'inbound', timestamp: '1', body: 'Thursday after 1' }]
  });
  assert.equal(result.status, 'needs_decision');
  assert.match(result.reason, /Lane is unresolved/);
  assert.equal(result.proposal, null);
});

test('held send evidence cannot classify as waiting', () => {
  const result = assess.assess({
    week_start: '2026-09-14',
    resource: nithin,
    send_evidence: 'held',
    messages: []
  });
  assert.notEqual(result.status, 'waiting');
});

test('reply mapper leaves waiting without a new taxonomy', () => {
  const next = assess.applyReplyToStatus('waiting', 'ordinary');
  assert.equal(next.status, 'needs_decision');
  const acc = assess.applyReplyToStatus('waiting', 'acceptance');
  assert.equal(acc.action, 'confirm_booking');
});

test('Wednesday is not proposed for Nithin', () => {
  const slot = assess.proposeSlot(
    [{ start_iso: '2026-09-16T08:00:00', end_iso: '2026-09-16T16:00:00', label: 'wednesday' }],
    [],
    [],
    nithin.desk_rules,
    '2026-09-14'
  );
  assert.equal(slot, null);
});
