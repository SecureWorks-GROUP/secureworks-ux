#!/usr/bin/env node
// Running weekly invoice draft.
// Save/reload keeps the entered lines. Approved work is added once, including
// across weeks. An agent draft is always a draft and cannot be sent from the
// agent path. The screen flag defaults off.
const assert = require('assert');
const Core = require('../modules/trade-invoice-running-draft.js');

// Flag: off unless a server flag or an explicit trial switch is on.
assert.strictEqual(Core.flagOn({}), false, 'default off');
assert.strictEqual(Core.flagOn({ server: false }), false);
assert.strictEqual(Core.flagOn({ server: true }), true);
assert.strictEqual(Core.flagOn({ query: '1' }), true);
assert.strictEqual(Core.flagOn({ stored: '1' }), true);
assert.strictEqual(Core.flagOn({ server: true, query: '0' }), false, 'query kill switch');
assert.strictEqual(Core.flagOn({ server: true, stored: '0' }), false, 'stored kill switch');
assert.strictEqual(Core.flagOn({ query: '0', stored: '1' }), false);

// Save then reload returns the same lines and fields.
const entered = Core.snapshot({
  jobCards: [{
    assignment_id: 'as-hugo-1',
    job_id: 'job-1',
    job_number: 'SWMS-261319',
    client_name: 'Hugo Client',
    description: 'Fence repair Tuesday',
    hours: 6,
    rate: 50,
    included: true,
    work_date: '2026-10-20',
    start_time: '07:00',
    finish_time: '13:00',
    break_minutes: 0,
    source_key: 'as:as-hugo-1'
  }],
  invRows: [{ description: 'Parking', amount: 12, _misc: true }],
  invLumpLines: [{ id: 'il-1', description: 'Ute fuel', amount: 20 }],
  dismissedKeys: [],
  notes: 'Hold for Friday',
  gst_on: true,
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25'
});
const saved = Core.saveBody(entered, { draft_id: 'draft-1' });
assert.strictEqual(saved.draft_id, 'draft-1');
assert.strictEqual(saved.week_start, '2026-10-19');
assert.strictEqual(saved.gst_on, true);
assert.strictEqual(saved.notes, 'Hold for Friday');
assert.deepStrictEqual(saved.draft_builder, entered);
const reloaded = Core.snapshot(saved.draft_builder);
assert.deepStrictEqual(reloaded, entered, 'reopen shows the saved draft exactly');
assert.strictEqual(Core.hashSnapshot(reloaded), Core.hashSnapshot(entered));

// Save never asks to submit or to create anything in Xero.
const saveCheck = Core.assertDraftOnly(saved);
assert.strictEqual(saveCheck.ok, true, saveCheck.refused.join(','));
assert.strictEqual(Object.prototype.hasOwnProperty.call(saved, 'submit'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(saved, 'xero'), false);
assert.strictEqual(JSON.stringify(saved).indexOf('generate_trade_invoice'), -1);

// Approved work joins the open draft once. A line already claimed on another
// week, or dismissed from this draft, stays out. A second pass adds nothing.
const claimed = ['wo:wo-last-week', 'as:as-last-week'];
const suggested = [
  { work_order_id: 'wo-last-week', job_number: 'SWF-OLD', description: 'Already invoiced' },
  { assignment_id: 'as-last-week', job_number: 'SWF-OLD2', description: 'Already invoiced assignment' },
  { work_order_id: 'wo-this-week', job_number: 'SWMS-261400', description: 'Approved make-safe' },
  { assignment_id: 'as-hugo-1', job_number: 'SWMS-261319', description: 'Would duplicate Hugo' },
  { job_id: 'job-searched', work_date: '2026-10-21', job_number: 'SWF-NEW', description: 'Searched job' }
];
const first = Core.mergeApproved({
  cards: entered.jobCards,
  dismissed: ['job:job-searched:2026-10-21'],
  claimed: claimed,
  suggested: suggested
});
assert.deepStrictEqual(first.added, ['wo:wo-this-week']);
assert.strictEqual(first.cards.length, 2);
assert.strictEqual(first.cards[0].description, 'Fence repair Tuesday', 'an existing line is not replaced');
assert.strictEqual(first.cards[1].job_number, 'SWMS-261400');
assert.strictEqual(first.cards[1].source_key, 'wo:wo-this-week');
const second = Core.mergeApproved({
  cards: first.cards,
  dismissed: first.dismissed,
  claimed: claimed,
  suggested: suggested
});
assert.deepStrictEqual(second.added, [], 'nothing is pulled in twice');
assert.strictEqual(second.cards.length, 2);

// Removing a line keeps its key dismissed, so the next build leaves it out.
const dismissed = Core.dismissKey(first.dismissed, 'wo:wo-this-week');
const afterRemove = Core.mergeApproved({
  cards: [first.cards[0]],
  dismissed: dismissed,
  claimed: claimed,
  suggested: suggested
});
assert.deepStrictEqual(afterRemove.added, []);

// Agent path: a draft, marked, and no way to send it.
const agent = Core.agentDraft({
  user_id: 'hugo',
  week_start: '2026-10-19',
  week_end: '2026-10-25',
  agent_label: 'grok-bot',
  lines: [{ work_order_id: 'wo-agent', job_number: 'SWMS-261500', description: 'Drafted by assistant' }],
  existing: entered,
  claimed: claimed
});
assert.strictEqual(agent.status, 'draft');
assert.strictEqual(agent.created_by_agent, true);
assert.strictEqual(agent.draft_origin, 'agent');
assert.strictEqual(agent.xero, false);
assert.strictEqual(agent.submitted, false);
assert.strictEqual(agent.pay_rules, 'unchanged_until_submit');
assert.ok(agent.draft_builder.jobCards.some(function (card) { return card.job_number === 'SWMS-261500'; }));
assert.ok(agent.draft_builder.jobCards.some(function (card) { return card.description === 'Fence repair Tuesday'; }));
assert.strictEqual(Core.assertDraftOnly(agent).ok, true);

function refuses(input) {
  assert.throws(function () { Core.agentDraft(input); }, function (err) {
    return err && err.code === 'agent_draft_only';
  });
}
refuses({ submit: true, week_start: '2026-10-19', lines: [] });
refuses({ send: true, week_start: '2026-10-19', lines: [] });
refuses({ authorise: true, week_start: '2026-10-19', lines: [] });
refuses({ pay: true, week_start: '2026-10-19', lines: [] });
refuses({ xero: true, week_start: '2026-10-19', lines: [] });
refuses({ status: 'authorised', week_start: '2026-10-19', lines: [] });
refuses({ action: 'generate_trade_invoice', week_start: '2026-10-19', lines: [] });
refuses({ action: 'submit_work_order_invoice', week_start: '2026-10-19', lines: [] });

console.log('trade invoice running draft: ok');
