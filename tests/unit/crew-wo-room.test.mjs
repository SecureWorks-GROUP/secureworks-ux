// Work order room (owner, 28 Nov 2026) in the Crew app's plain-data layer:
// the amount a trade types survives the saved weekly draft in both
// directions with the Trade App, and a failed read of what is left blocks
// the line rather than locking it to the agreed amount.
// Run: node tests/unit/crew-wo-room.test.mjs
import assert from 'node:assert/strict';
const m = await import(new URL('../../crew/js/lib/invoice.js', import.meta.url).href);

const MONDAY = '2026-11-09';
const hoursWith = (billed, extra = {}) => ({
  rate: 50,
  assignments: [{
    id: 'zz-a1', scheduled_date: '2026-11-10',
    jobs: { id: 'zz-j1', job_number: 'SWF-ZZ01', client_name: 'ZZTEST Client', site_suburb: 'Testville', type: 'fencing' },
    invoice_mode: 'work_order', invoice_mode_reason: 'fencing_job', can_claim_commission: false,
    work_order_agreed_ex: 1850, job_work_order_id: 'zz-w1', work_order_amount_rule: 'up_to_left',
    ...(billed ? { work_order_billed: billed } : {}), ...extra,
  }],
});
const billed = (most) => ({ allowed_ex: 1850, billed_ex: 1850 - most, left_ex: most, billed_by: [], most_now_ex: most, amount_rule: 'up_to_left' });

// 1. Crew to the Trade App: a typed amount is written with the typed mark.
{
  const hours = hoursWith(billed(1250));
  const draft = { edits: { 'wo:zz-j1': { amount: 500 } }, added: [], lumps: [] };
  const lines = m.buildLines(hours, draft);
  const wo = lines.find((l) => l.kind === 'work_order');
  assert.equal(wo.amount, 500);
  assert.equal(wo.amountLocked, false);
  const builder = m.builderFromDraft(hours, draft, lines, { monday: MONDAY, gstOn: false });
  const card = builder.jobCards.find((c) => c.assignment_id === 'zz-a1');
  assert.equal(card.wo_allocated, 500);
  assert.equal(card.wo_amount_typed, true, 'the Trade App keeps a typed amount only with this mark');
  // Back into Crew: the typed amount stays.
  const again = m.draftFromBuilder(builder, hours);
  assert.equal(again.edits['wo:zz-j1'].amount, 500);
}

// 2. Crew to the Trade App, not typed: no typed mark, so the Trade App fills what is left.
{
  const hours = hoursWith(billed(1250));
  const draft = { edits: {}, added: [], lumps: [] };
  const lines = m.buildLines(hours, draft);
  assert.equal(lines.find((l) => l.kind === 'work_order').amount, 1250);
  const card = m.builderFromDraft(hours, draft, lines, { monday: MONDAY, gstOn: false }).jobCards.find((c) => c.assignment_id === 'zz-a1');
  assert.notEqual(card.wo_amount_typed, true);
  assert.equal(card.wo_amount_autofilled, 1250, 'marked as filled in, so the Trade App fills what is left now');
}

// 3. The Trade App to Crew: an amount the Trade App filled in (what was left
// then) is not taken as typed, so Crew shows what is left now; a typed one is kept.
{
  const hours = hoursWith(billed(900));
  const filled = { jobCards: [{ assignment_id: 'zz-a1', job_id: 'zz-j1', wo_mode: true, included: true, wo_allocated: 1250, wo_amount_autofilled: 1250, work_order_amount_rule: 'up_to_left' }] };
  const fromFilled = m.draftFromBuilder(filled, hours);
  assert.equal(fromFilled.edits['wo:zz-j1'].amount ?? null, null);
  assert.equal(m.buildLines(hours, fromFilled).find((l) => l.kind === 'work_order').amount, 900);
  const typed = { jobCards: [{ ...filled.jobCards[0], wo_allocated: 640, wo_amount_typed: true }] };
  assert.equal(m.buildLines(hours, m.draftFromBuilder(typed, hours)).find((l) => l.kind === 'work_order').amount, 640);
}

// 4. A failed read of what is left: never the agreed amount, never sent.
{
  const hours = hoursWith(null, { work_order_billed_unavailable: true });
  const mode = m.readMode(hours.assignments[0]);
  assert.equal(mode.upToLeft, true);
  assert.equal(mode.room, null);
  const wo = m.buildLines(hours, { edits: {}, added: [], lumps: [] }).find((l) => l.kind === 'work_order');
  assert.equal(wo.amountLocked, false);
  assert.equal(wo.amount, null);
  assert.equal(m.lineProblem(wo, { monday: MONDAY }), 'What is left on this work order could not be read. Try again when you have signal');
  const typedWo = m.buildLines(hours, { edits: { 'wo:zz-j1': { amount: 300 } }, added: [], lumps: [] }).find((l) => l.kind === 'work_order');
  assert.equal(m.lineProblem(typedWo, { monday: MONDAY }), 'What is left on this work order could not be read. Try again when you have signal');
}

// 5. No rule from the server (older, or restoration): the agreed amount, locked.
{
  const hours = hoursWith(null, { work_order_amount_rule: undefined });
  const wo = m.buildLines(hours, { edits: { 'wo:zz-j1': { amount: 300 } }, added: [], lumps: [] }).find((l) => l.kind === 'work_order');
  assert.deepEqual([wo.amount, wo.amountLocked], [1850, true]);
}
console.log('crew work order room: ok');
