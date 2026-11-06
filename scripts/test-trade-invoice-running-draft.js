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

// The owner can delete an auto line. The key stays dismissed, so the next
// rebuild does not put it back, and an edit on another line is not replaced.
const withAuto = Core.mergeApproved({
  cards: entered.jobCards,
  dismissed: [],
  claimed: claimed,
  suggested: suggested
});
const deleted = Core.applyOwnerCommand({
  cards: withAuto.cards,
  dismissed: withAuto.dismissed,
  remove: ['wo:wo-this-week']
});
assert.deepStrictEqual(deleted.removed, ['wo:wo-this-week']);
assert.ok(deleted.dismissed.indexOf('wo:wo-this-week') !== -1);
assert.ok(!deleted.cards.some(function (card) { return card.source_key === 'wo:wo-this-week'; }));
const edited = Core.applyOwnerCommand({
  cards: deleted.cards,
  dismissed: deleted.dismissed,
  edits: [{ assignment_id: 'as-hugo-1', description: 'Hugo changed the auto line', hours: 4 }]
});
assert.deepStrictEqual(edited.edited, ['as:as-hugo-1']);
assert.strictEqual(edited.cards[0].description, 'Hugo changed the auto line');
assert.strictEqual(edited.cards[0].hours, 4);
assert.strictEqual(edited.cards[0].owner_edited, true);
assert.strictEqual(edited.locked, true);
const rebuilt = Core.regenerate({
  cards: edited.cards,
  dismissed: edited.dismissed,
  claimed: claimed,
  suggested: suggested.concat([
    { assignment_id: 'as-hugo-1', description: 'Auto rebuilt this line', hours: 9 },
    { assignment_id: 'as-new-job', job_number: 'SWF-NEWJOB', description: 'A job added later' }
  ])
});
assert.deepStrictEqual(rebuilt.added, ['as:as-new-job'], 'new work still comes in');
assert.ok(rebuilt.added.indexOf('wo:wo-this-week') === -1, 'a removed line is not put back');
const kept = rebuilt.cards.filter(function (card) { return card.assignment_id === 'as-hugo-1'; })[0];
assert.strictEqual(kept.description, 'Hugo changed the auto line');
assert.strictEqual(kept.hours, 4, 'an edit is not overwritten by the rebuild');
const savedEdit = Core.snapshot({
  jobCards: edited.cards,
  dismissedKeys: edited.dismissed,
  manualLock: edited.locked,
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25'
});
const reloadedEdit = Core.snapshot(Core.saveBody(savedEdit).draft_builder);
assert.strictEqual(reloadedEdit.manualLock, true);
assert.strictEqual(reloadedEdit.jobCards[0].description, 'Hugo changed the auto line');
assert.ok(reloadedEdit.dismissedKeys.indexOf('wo:wo-this-week') !== -1);

// Putting removed lines back is explicit. Other edits stay.
const restored = Core.regenerate({
  cards: edited.cards,
  dismissed: edited.dismissed,
  claimed: claimed,
  suggested: suggested,
  restoreRemoved: true
});
assert.ok(restored.added.indexOf('wo:wo-this-week') !== -1);
assert.strictEqual(
  restored.cards.filter(function (card) { return card.assignment_id === 'as-hugo-1'; })[0].description,
  'Hugo changed the auto line'
);

// The assistant can delete and edit a line that is already on the owner's draft.
const agentEdit = Core.agentDraft({
  user_id: 'hugo',
  caller_kind: 'agent',
  week_start: '2026-10-19',
  week_end: '2026-10-25',
  existing: {
    status: 'draft',
    jobCards: withAuto.cards,
    dismissedKeys: withAuto.dismissed,
    weekStart: '2026-10-19',
    weekEnd: '2026-10-25'
  },
  remove: [{ work_order_id: 'wo-this-week' }],
  edits: [{ assignment_id: 'as-hugo-1', description: 'Assistant edited this', amount: 55 }]
});
assert.strictEqual(agentEdit.status, 'draft');
assert.strictEqual(agentEdit.xero, false);
assert.strictEqual(agentEdit.submitted, false);
assert.deepStrictEqual(agentEdit.removed, ['wo:wo-this-week']);
assert.deepStrictEqual(agentEdit.edited, ['as:as-hugo-1']);
assert.strictEqual(agentEdit.draft_builder.manualLock, true);
assert.ok(!agentEdit.draft_builder.jobCards.some(function (card) { return card.work_order_id === 'wo-this-week'; }));
const assistantLine = agentEdit.draft_builder.jobCards.filter(function (card) { return card.assignment_id === 'as-hugo-1'; })[0];
assert.strictEqual(assistantLine.description, 'Assistant edited this');
assert.strictEqual(assistantLine.rate, 55);
const afterAgent = Core.regenerate({
  cards: agentEdit.draft_builder.jobCards,
  dismissed: agentEdit.draft_builder.dismissedKeys,
  claimed: claimed,
  suggested: suggested
});
assert.ok(afterAgent.added.indexOf('wo:wo-this-week') === -1);

// A matching line is an edit only when the assistant says so. A plain add
// still does not replace what is already there.
const plainAdd = Core.agentDraft({
  user_id: 'hugo',
  week_start: '2026-10-19',
  existing: entered,
  lines: [{ assignment_id: 'as-hugo-1', description: 'Would replace Hugo', hours: 9, update: true }]
});
assert.strictEqual(plainAdd.draft_builder.jobCards[0].description, 'Would replace Hugo');
assert.strictEqual(plainAdd.draft_builder.jobCards[0].hours, 9);
const skippedAdd = Core.agentDraft({
  user_id: 'hugo',
  week_start: '2026-10-19',
  existing: entered,
  lines: [{ assignment_id: 'as-hugo-1', description: 'Would replace Hugo', hours: 9 }]
});
assert.strictEqual(skippedAdd.draft_builder.jobCards[0].description, 'Fence repair Tuesday');

// Only the owner, the office, or that owner's assistant, and only on a draft.
const office = Core.agentDraft({
  user_id: 'hugo',
  caller_kind: 'office',
  caller_role: 'ops_manager',
  week_start: '2026-10-19',
  existing: entered,
  lines: [{ update: true, assignment_id: 'as-hugo-1', description: 'Office edit' }]
});
assert.strictEqual(office.draft_builder.jobCards[0].description, 'Office edit');
const owner = Core.agentDraft({
  user_id: 'hugo',
  caller_id: 'hugo',
  caller_kind: 'owner',
  week_start: '2026-10-19',
  existing: entered,
  remove: ['as:as-hugo-1']
});
assert.deepStrictEqual(owner.removed, ['as:as-hugo-1']);

function refusesEdit(input, code) {
  assert.throws(function () { Core.agentDraft(input); }, function (err) {
    return err && err.code === code;
  });
}
refusesEdit({
  user_id: 'hugo',
  caller_id: 'someone-else',
  caller_kind: 'staff',
  week_start: '2026-10-19',
  existing: entered,
  remove: ['as:as-hugo-1']
}, 'not_draft_owner');
refusesEdit({
  user_id: 'hugo',
  caller_kind: 'agent',
  week_start: '2026-10-19',
  existing: { status: 'submitted', jobCards: entered.jobCards },
  remove: ['as:as-hugo-1']
}, 'draft_locked');
refusesEdit({
  user_id: 'hugo',
  existing: { status: 'authorised', jobCards: entered.jobCards },
  edits: [{ assignment_id: 'as-hugo-1', description: 'Too late' }]
}, 'draft_locked');

// A saved card whose patio group is missing stays in the builder, but the
// group route excludes it from ordinary hours before Submit.
async function checkPayableRoutes() {
  const fs = require('fs'), vm = require('vm');
  const scope = { window: {}, document: { querySelector: () => true, querySelectorAll: () => [] } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../modules/trade-group-invoice.js'), 'utf8'), scope);
  const group = scope.window.GroupWorkOrderInvoice;
  const card = { job_id: 'patio-fixture', job_number: 'PATIO-FIXTURE', included: true, hours: 4 };
  const before = JSON.stringify(card);
  let reason = 'group_missing', writes = 0;
  group.use(async (action, params, body) => {
    if (body) writes++;
    assert.strictEqual(action, 'my_group_work_orders');
    return { enabled: true, groups: [], payable_routes: [{ job_id: card.job_id, route: 'group_setup_required', group_id: null, setup_reason: reason }] };
  }, () => {}, 'fixture-user');
  group.load();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(group.isGroupJob(card.job_id), true);
  assert.strictEqual(group.isGroupJob('ordinary-fixture'), false);
  let html = group.jobCardHtml(card, '<input data-ordinary-hours>');
  assert(html.includes('Group work order needs setting up'));
  assert(html.includes('approved work-order amount is ready'));
  assert(!html.includes('data-ordinary-hours'));
  assert.strictEqual(group.total(), 0);
  assert.strictEqual(group.items().length, 0);
  assert.strictEqual(JSON.stringify(card), before, 'saved hours are retained');
  reason = 'allowance_missing';
  group.load(true);
  await new Promise(resolve => setImmediate(resolve));
  html = group.jobCardHtml(card);
  assert(html.includes('set the job work-order amount'));
  assert(!html.includes('approved work-order amount is ready'));
  assert.strictEqual(writes, 0);
}
checkPayableRoutes().then(() => console.log('trade invoice running draft: ok')).catch(error => { console.error(error); process.exitCode = 1; });
