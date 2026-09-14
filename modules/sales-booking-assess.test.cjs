const { test } = require('node:test');
const assert = require('node:assert/strict');
const assess = require('./sales-booking-assess.cjs');

const nithin = {
  name: 'Nithin',
  lane: 'patio',
  desk_rules: { monday_from: 12, no_wednesday: true, last_start: 15.5 }
};
function proof(extra) {
  return Object.assign({
    week_start: '2026-09-14',
    resource: nithin,
    calendar_retrieved_at: '2026-09-12T13:00:00Z',
    leave_retrieved_at: '2026-09-12T13:00:00Z',
    leave_intervals: [],
    travel_retrieved_at: '2026-09-12T13:00:00Z',
    travel_minutes: 0,
    now: '2026-09-12T13:00:00Z',
    events: [],
    pending_offers: []
  }, extra || {});
}

function inbound(body, extra) {
  return Object.assign({ direction: 'inbound', timestamp: '2026-09-12T13:00:00Z', id: 'in-1', body: body }, extra || {});
}

test('explicit 22 September is not mapped onto Tuesday 15', () => {
  const result = assess.assess(proof({
    messages: [inbound('Tuesday 22 September at 10am')]
  }));
  assert.equal(result.exact_acceptance, false);
  if (result.proposal) assert.equal(String(result.proposal.start_iso).slice(0, 10), '2026-09-22');
  assert.notEqual(result.proposal && result.proposal.start_iso, '2026-09-15T10:00:00');
});

test('afternoons without a day may get an AI-proposed afternoon, not a customer Monday fact', () => {
  const result = assess.assess(proof({
        messages: [inbound('Afternoons work for me')]
  }));
  assert.equal(result.exact_acceptance, false);
  assert.equal(result.customer_facts.date_specified, false);
  assert.equal(result.customer_facts.time_of_day, 'afternoon');
  assert.equal((result.windows || []).length, 0);
  assert.ok(result.proposal);
  assert.equal(result.proposal.date_source, 'ai_proposed');
  assert.equal(result.proposal.customer_date_specified, false);
  const hour = Number(String(result.proposal.start_iso).slice(11, 13));
  assert.ok(hour >= 13);
  assert.equal(result.status, 'ready');
  assert.match(result.proposal.window_label, /AI-proposed date/);
});

test('please do not cancel is not cancellation', () => {
  const result = assess.assess(proof({
        messages: [
      { direction: 'outbound', timestamp: '2026-09-12T12:00:00Z', id: 'out-1', body: 'Can I come Thursday at 1pm?' },
      inbound('Please do not cancel, Thursday at 1pm is still good')
    ]
  }));
  assert.notEqual(result.reply_kind, 'cancellation');
  assert.notEqual(result.status, 'repair');
  assert.equal(result.exact_acceptance, false);
});

test('yes but only after 4pm does not accept a 1pm offer', () => {
  const result = assess.assess(proof({
        sent_offers: [{ offer_id: 'off-1', message_id: 'out-1', slot_revision: 1, start_iso: '2026-09-17T13:00:00', send_evidence: 'sent', sent_at: '2026-09-12T12:00:00Z' }],
    messages: [
      { direction: 'outbound', timestamp: '2026-09-12T12:00:00Z', id: 'out-1', body: 'Can I come Thursday at 1pm?' },
      inbound('Yes but only after 4pm')
    ]
  }));
  assert.equal(result.exact_acceptance, false);
  assert.notEqual(result.reply_kind, 'acceptance');
});

test('an earlier yes does not accept a later outbound offer', () => {
  const result = assess.assess(proof({
        sent_offers: [{
      offer_id: 'off-late',
      message_id: 'out-2',
      slot_revision: 1,
      start_iso: '2026-09-18T14:00:00',
      send_evidence: 'sent',
      sent_at: '2026-09-12T12:00:00Z'
    }],
    messages: [
      inbound('Yes', { timestamp: '2026-09-12T11:00:00Z', id: 'in-yes' }),
      { direction: 'outbound', timestamp: '2026-09-12T12:00:00Z', id: 'out-2', body: 'Would Friday at 2pm work instead?' }
    ]
  }));
  assert.equal(result.exact_acceptance, false);
  assert.notEqual(result.accepted_offer && result.accepted_offer.offer_id, 'off-late');
});

test('outbound-only text is not customer availability; outreach may still propose a slot', () => {
  const result = assess.assess(proof({
        messages: [{ direction: 'outbound', timestamp: '2026-09-12T12:00:00Z', id: 'out-1', body: 'Can I come Thursday at 1pm?' }]
  }));
  assert.equal((result.windows || []).length, 0);
  assert.equal(result.exact_acceptance, false);
  assert.ok(result.proposal);
  assert.equal(result.proposal.date_source, 'ai_proposed');
  assert.equal(result.proposal.customer_date_specified, false);
});

test('02:00Z busy collides with 10:00 Perth', () => {
  const result = assess.assess(proof({
        messages: [inbound('Tuesday 15 September at 10am')],
    events: [{ start_iso: '2026-09-15T02:00:00Z', end_iso: '2026-09-15T03:00:00Z' }]
  }));
  assert.equal(result.proposal, null);
  assert.notEqual(result.status, 'ready');
});

test('AI afternoon suggestion still requires coverage', () => {
  const result = assess.assess(proof({
        coverage: { leave: 'not_read', calendar: true, route: false },
    messages: [inbound('Afternoons work for me')]
  }));
  assert.notEqual(result.status, 'ready');
  assert.equal(result.proposal, null);
  assert.equal(result.customer_facts.time_of_day, 'afternoon');
});

test('missing calendar, leave or travel cannot be ready', () => {
  const result = assess.assess(proof({
        coverage: { leave: 'unavailable', calendar: false, route: false },
    messages: [inbound('Tuesday 15 September at 10am')]
  }));
  assert.notEqual(result.status, 'ready');
  assert.equal(result.proposal, null);
});

test('no feasible slot is review, not ready', () => {
  const result = assess.assess(proof({
        messages: [inbound('Wednesday 16 September morning')]
  }));
  assert.notEqual(result.status, 'ready');
  assert.equal(result.proposal, null);
});

test('unqualified yes binds the preceding sent offer only', () => {
  const result = assess.assess(proof({
        sent_offers: [{
      offer_id: 'off-1',
      message_id: 'out-1',
      slot_revision: 3,
      start_iso: '2026-09-17T13:00:00',
      send_evidence: 'sent',
      sent_at: '2026-09-12T12:00:00Z'
    }],
    messages: [
      { direction: 'outbound', timestamp: '2026-09-12T12:00:00Z', id: 'out-1', body: 'Can I come Thursday 17 September at 1:00pm?' },
      inbound('Yes that works')
    ]
  }));
  assert.equal(result.exact_acceptance, true);
  assert.equal(result.accepted_offer.offer_id, 'off-1');
  assert.equal(result.accepted_offer.slot_revision, 3);
  assert.equal(result.status, 'needs_decision');
});

test('dated inbound window can be ready only with coverage and a free slot', () => {
  const result = assess.assess(proof({
        suburb: 'Sampleton',
    messages: [inbound('Thursday 17 September after 1pm is ok if that works')],
    events: [],
    pending_offers: []
  }));
  assert.equal(result.exact_acceptance, false);
  assert.equal(result.status, 'ready');
  assert.equal(result.proposal.start_iso, '2026-09-17T13:00:00');
  assert.equal(result.intelligent_automation, false);
});

test('fencing tag on a patio resource is a decision, not a Patio offer', () => {
  const result = assess.assess(proof({
        tags: ['missed-call', 'sw fencing'],
    messages: [inbound('Thursday 17 September after 1')]
  }));
  assert.equal(result.status, 'needs_decision');
  assert.equal(result.proposal, null);
});

test('held send evidence cannot classify as waiting', () => {
  const result = assess.assess(proof({
        send_evidence: 'held',
    messages: []
  }));
  assert.notEqual(result.status, 'waiting');
});

test('validator rejects an invented slot from a reason adapter', () => {
  const result = assess.assess(proof({
        messages: [inbound('Tuesday 22 September at 10am')],
    reason: function () {
      return {
        interpreter: 'ops-ai-structured',
        intelligent_automation: true,
        reply_kind: 'ordinary',
        exact_acceptance: false,
        customer_windows: [{ start_iso: '2026-09-15T10:00:00', end_iso: '2026-09-15T11:00:00', source_message_id: 'in-1' }]
      };
    }
  }));
  assert.notEqual(result.proposal && String(result.proposal.start_iso).slice(0, 10), '2026-09-15');
});

test('fallback never claims intelligent automation', () => {
  const result = assess.assess(proof({
        messages: []
  }));
  assert.equal(result.interpreter, 'conservative-fallback');
  assert.equal(result.intelligent_automation, false);
});

test('ops-ai structured result is still rejected when it invents a date', async () => {
  const reason = require('./sales-booking-reason-ops-ai.cjs');
  const result = await reason.assessViaOpsAi(proof({
    messages: [inbound('Tuesday 22 September at 10am')]
  }), {
    url: 'https://invalid.test/ops-ai',
    fetch: async () => ({
      ok: true,
      json: async () => ({ reply: '{"reply_kind":"ordinary","exact_acceptance":false,"customer_windows":[{"start_iso":"2026-09-15T10:00:00","end_iso":"2026-09-15T11:00:00","source_message_id":"in-1"}]}' })
    })
  });
  assert.notEqual(result.proposal && String(result.proposal.start_iso).slice(0, 10), '2026-09-15');
});

test('reply mapper requires a bound offer for confirm-booking', () => {
  const unbound = assess.applyReplyToStatus('waiting', 'acceptance', false);
  assert.equal(unbound.exact_acceptance, false);
  const bound = assess.applyReplyToStatus('waiting', 'acceptance', true);
  assert.equal(bound.action, 'confirm_booking');
});

test('fabricated offer_id cannot create exact acceptance against inbound No', () => {
  const result = assess.assess(proof({
    messages: [inbound('No, that will not work')],
    reason: function () {
      return {
        exact_acceptance: true,
        accepted_offer: { offer_id: 'fabricated', slot_revision: 99, start_iso: '2026-09-17T13:00:00', message_id: 'invented' }
      };
    }
  }));
  assert.equal(result.exact_acceptance, false);
});

test('model cancellation cannot override please do not cancel', () => {
  const result = assess.assess(proof({
    messages: [inbound('Please do not cancel our appointment')],
    reason: function () {
      return { reply_kind: 'cancellation', source_message_ids: ['invented'] };
    }
  }));
  assert.notEqual(result.status, 'repair');
  assert.notEqual(result.reply_kind, 'cancellation');
});

test('model customer_facts cannot move 22 Sep 10am to 15 Sep', () => {
  const result = assess.assess(proof({
    messages: [inbound('Tuesday 22 September at 10am')],
    reason: function () {
      return { customer_facts: { date_specified: true, explicit_date: '2026-09-15', clock: 10 } };
    }
  }));
  if (result.proposal) assert.equal(String(result.proposal.start_iso).slice(0, 10), '2026-09-22');
  assert.notEqual(result.proposal && String(result.proposal.start_iso).slice(0, 10), '2026-09-15');
  assert.equal(result.customer_facts.explicit_date, '2026-09-22');
});

test('outbound message id cannot be customer evidence for a window', () => {
  const result = assess.assess(proof({
    messages: [
      { direction: 'outbound', timestamp: '2026-09-12T12:00:00Z', id: 'out1', body: 'How about 15:00?' },
      inbound('Tuesday 15 September at 10am')
    ],
    reason: function () {
      return { customer_windows: [{ start_iso: '2026-09-15T15:00:00', end_iso: '2026-09-15T16:00:00', source_message_id: 'out1' }] };
    }
  }));
  assert.notEqual(result.proposal && result.proposal.start_iso, '2026-09-15T15:00:00');
});

test('past slots are not ready', () => {
  const result = assess.assess(proof({
    now: '2026-09-30T02:00:00Z',
    messages: [inbound('Tuesday 15 September at 10am')]
  }));
  assert.notEqual(result.status, 'ready');
});

test('malformed busy occupancy is a gap, not a free slot', () => {
  const result = assess.assess(proof({
    messages: [inbound('Tuesday 15 September at 10am')],
    events: [{ end_iso: '2026-09-15T11:00:00+08:00' }]
  }));
  assert.notEqual(result.status, 'ready');
  assert.equal(result.proposal, null);
});

test('leave intervals block the candidate', () => {
  const result = assess.assess(proof({
    messages: [inbound('Tuesday 15 September at 10am')],
    leave_intervals: [{ start_iso: '2026-09-15T00:00:00+08:00', end_iso: '2026-09-16T00:00:00+08:00' }]
  }));
  assert.notEqual(result.status, 'ready');
});

test('travel from a previous visit blocks an immediate next suburb', () => {
  const result = assess.assess(proof({
    messages: [inbound('Tuesday 15 September at 10am')],
    previous_visit: { end_iso: '2026-09-15T10:00:00+08:00', suburb: 'Fremantle' },
    travel_minutes: 60
  }));
  assert.notEqual(result.status, 'ready');
});

test('sent_offers array order does not bind an older offer', () => {
  const result = assess.assess(proof({
    sent_offers: [
      { offer_id: 'new', message_id: 'out-new', slot_revision: 2, start_iso: '2026-09-18T12:00:00+08:00', send_evidence: 'sent', sent_at: '2026-09-12T12:00:00Z' },
      { offer_id: 'old', message_id: 'out-old', slot_revision: 1, start_iso: '2026-09-15T10:00:00+08:00', send_evidence: 'sent', sent_at: '2026-09-12T10:00:00Z' }
    ],
    messages: [
      { direction: 'outbound', timestamp: '2026-09-12T10:00:00Z', id: 'out-old', body: 'Tue 10am?' },
      { direction: 'outbound', timestamp: '2026-09-12T12:00:00Z', id: 'out-new', body: 'Fri 12 instead?' },
      inbound('Yes', { timestamp: '2026-09-12T13:00:00Z' })
    ]
  }));
  assert.equal(result.exact_acceptance, true);
  assert.equal(result.accepted_offer.offer_id, 'new');
});
