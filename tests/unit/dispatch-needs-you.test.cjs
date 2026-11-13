// Dispatch v2 "Needs you now" (modules/dispatch-needs-you.js): what each
// Active job needs from Shaun, the chip counts and the chip filter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../../modules/dispatch-needs-you.js');

// Thu 5 Nov 2026, Perth. Melbourne Cup is not a WA holiday; a made-up
// holiday on Mon 9 Nov tests the skip.
const TODAY = '2026-11-05';
const ctx = (extra = {}) => ({ today: TODAY, isHoliday: () => false, ...extra });

// One supplier box order on the board, sent and waiting by default.
const order = (name, extra = {}) => ({
  key: 'box:' + name, source: 'supplier_box', supplier_name: name, order_sent: true, sent_at: '2026-11-04T01:00:00Z',
  delivery_date: null, date_confirmed: false, material_stage: 'order_confirmed', flag: null, payment: null, ...extra,
});
const job = (id, orders, extra = {}) => ({
  id,
  board: { view: 'active', stage_phase: 'window', install: { booked: false, day: null, passed: false }, arrival: { today: TODAY, install_day: null, orders }, ...(extra.board || {}) },
  suggestions: extra.suggestions === undefined ? null : extra.suggestions,
});
const reasons = (j, c = ctx()) => N.jobReasons(j, c).map((r) => r.kind + ': ' + r.text);

test('the thresholds are the ones Shaun said Go to', () => {
  assert.equal(N.FOLLOW_UP_AFTER_WORKING_DAYS, 2);
  assert.equal(N.DATE_RISK_WITHIN_WORKING_DAYS, 5);
});

test('working days skip weekends and holidays', () => {
  assert.equal(N.workingDaysBetween('2026-11-02', '2026-11-04'), 2); // Mon to Wed
  assert.equal(N.workingDaysBetween('2026-11-06', '2026-11-09'), 1); // Fri to Mon
  assert.equal(N.workingDaysBetween('2026-11-06', '2026-11-10', (d) => d === '2026-11-09'), 1); // Mon a holiday
  assert.equal(N.workingDaysBetween('2026-11-05', '2026-11-05'), 0);
  assert.equal(N.workingDaysBetween('2026-11-05', '2026-11-01'), 0);
  assert.equal(N.workingDaysBetween('nope', '2026-11-05'), null);
});

test('a timestamp is read as its Perth day', () => {
  assert.equal(N.perthDay('2026-11-02T23:30:00Z'), '2026-11-03');
  assert.equal(N.perthDay('2026-11-02T10:00:00Z'), '2026-11-02');
  assert.equal(N.perthDay(null), null);
});

test('To order: a supplier box whose order is not sent yet', () => {
  assert.deepEqual(reasons(job('j', [order('Metroll', { order_sent: false, sent_at: null, material_stage: 'order_materials', flag: 'not_sent' })])), ['order: Order Metroll']);
  // A purchase order with no box is never "to order" here.
  assert.deepEqual(reasons(job('j', [order('PO', { source: 'dispatch_order', order_sent: false, material_stage: 'order_materials' })])), []);
});

test('To order: every job at Order Materials counts, boxes or not', () => {
  const at = (orders, board) => job('j', orders, { board: { stage_key: 'order_materials', track: 'pipeline', ...board } });
  // No supplier box set up yet (the 8 patio jobs on 12 Nov 2026).
  assert.deepEqual(reasons(at([])), ['order: Set up order']);
  // An unsent box already says which supplier: no second tag.
  assert.deepEqual(reasons(at([order('Metroll', { order_sent: false, sent_at: null, material_stage: 'order_materials' })])), ['order: Order Metroll']);
  // Every box sent, the job still at the stage.
  assert.deepEqual(reasons(at([order('Metroll', { material_stage: 'order_confirmed' })])), ['order: Still at Order materials']);
  // A purchase order alone is not a box: the order is still to set up.
  assert.deepEqual(reasons(at([order('PO', { source: 'dispatch_order', order_sent: true, material_stage: 'order_confirmed' })])), ['order: Set up order']);
  // Repairs: their Materials stage is the ordering stage.
  assert.deepEqual(reasons(job('j', [], { board: { stage_key: 'materials', track: 'repairs' } })), ['order: Set up order']);
  // Later stages with nothing unsent: not to order.
  assert.deepEqual(reasons(job('j', [], { board: { stage_key: 'awaiting_supplier', track: 'pipeline' } })), []);
  assert.deepEqual(reasons(job('j', [], { board: { stage_key: 'scheduled', track: 'repairs' } })), []);
  // Archived: never.
  assert.deepEqual(reasons(job('j', [], { board: { stage_key: 'order_materials', view: 'archive' } })), []);
  // The chip counts each job once.
  const s = N.summarise([at([]), job('k', [], { board: { stage_key: 'order_materials' } })], ctx(), 0);
  assert.equal(s.counts.order, 2);
});

test('Order drafted: a box with its email saved and not sent is out of To order (Shaun, 13 Nov 2026)', () => {
  const unsent = (name, extra = {}) => order(name, { order_sent: false, sent_at: null, material_stage: 'order_materials', flag: 'not_sent', order_drafted: false, ...extra });
  // Kevin Beaver SWP-261641 on 13 Nov: both boxes drafted, the job at Order
  // Materials. Order drafted alone: no To order tag from the stage.
  const kevin = job('kevin', [unsent('Panelmakers', { order_drafted: true }), unsent('CMI', { order_drafted: true })],
    { board: { stage_key: 'order_materials', track: 'pipeline' } });
  assert.deepEqual(reasons(kevin), ['drafted: Send Panelmakers order', 'drafted: Send CMI order']);
  // Angus Roxburgh SWP-261178: CMI and Bondor sent, Ampelite drafted.
  const angus = job('angus', [order('CMI', { order_drafted: false }), order('Bondor', { order_drafted: false }), unsent('Ampelite', { order_drafted: true })],
    { board: { stage_key: 'scheduled', track: 'pipeline' } });
  assert.deepEqual(reasons(angus), ['drafted: Send Ampelite order']);
  // One box drafted, one with nothing written: one tag under each chip.
  const both = job('both', [unsent('Metroll'), unsent('Stratco', { order_drafted: true })]);
  assert.deepEqual(reasons(both), ['order: Order Metroll', 'drafted: Send Stratco order']);
  // A sent box with a new draft (an extra order) is drafted too.
  assert.deepEqual(reasons(job('x', [order('Stratco', { order_drafted: true })])), ['drafted: Send Stratco order']);
  // At Order Materials with every box sent and nothing drafted: still To order.
  assert.deepEqual(reasons(job('y', [order('Stratco', { order_drafted: false })], { board: { stage_key: 'order_materials' } })), ['order: Still at Order materials']);
  // A purchase order is never drafted here.
  assert.deepEqual(reasons(job('z', [order('PO', { source: 'dispatch_order', order_drafted: true })])), []);
  // The chips: each job once per chip.
  const s = N.summarise([kevin, angus, both], ctx(), 0);
  assert.equal(s.counts.order, 1);
  assert.equal(s.counts.drafted, 3);
  assert.deepEqual(s.ids.drafted, ['kevin', 'angus', 'both']);
  assert.equal(s.shown.drafted, true);
  // The chip sits right after To order.
  assert.deepEqual(N.KINDS.slice(0, 3).map((k) => k.label), ['To order', 'Order drafted', 'To pay']);
});

test('Order drafted: a server without order_drafted hides the chip, and its drafts stay under To order', () => {
  const s = N.summarise([job('a', [order('Metroll', { order_sent: false, sent_at: null, material_stage: 'order_materials' })])], ctx(), 0);
  assert.equal(s.shown.drafted, false);
  assert.equal(s.counts.order, 1);
  // No boxes at all: nothing to say it is missing, so the chip shows (at 0).
  assert.equal(N.summarise([job('b', [])], ctx(), 0).shown.drafted, true);
});

test('To pay: payment.to_pay, and the same rule for a server without it', () => {
  assert.deepEqual(reasons(job('j', [order('CMI', { material_stage: 'awaiting_payment', payment: { state: 'unpaid', to_pay: true } })])), ['pay: Pay CMI']);
  assert.deepEqual(reasons(job('j', [order('CMI', { material_stage: 'awaiting_payment', payment: { state: 'unpaid', to_pay: false } })])), []);
  assert.deepEqual(reasons(job('j', [order('CMI', { material_stage: 'awaiting_payment', payment: { state: 'unpaid' } })])), ['pay: Pay CMI']);
  assert.deepEqual(reasons(job('j', [order('CMI', { material_stage: 'sent', sent_at: '2026-11-05T01:00:00Z', payment: { state: 'unpaid' } })])), []);
});

test('Supplier replied: a quote to check, and an open date suggestion to Accept', () => {
  const j = job('j', [order('Stratco', { material_stage: 'quote_received' })], { suggestions: [{ id: 's1', state: 'open', supplier_name: 'Stratco' }, { id: 's2', state: 'accepted', supplier_name: 'Lysaght' }] });
  assert.deepEqual(reasons(j), ['replied: Check Stratco quote', 'replied: Accept Stratco date']);
});

test('Follow up: sent, no reply has moved it, two working days or more', () => {
  // Sent Mon 2/11 (Perth): Tue, Wed, Thu = 3 working days.
  assert.deepEqual(reasons(job('j', [order('R&R', { material_stage: 'sent', sent_at: '2026-11-02T02:00:00Z' })])), ['follow: Follow up R&R, 3 days']);
  // Sent Tue 3/11: 2 days, the threshold.
  assert.deepEqual(reasons(job('j', [order('R&R', { material_stage: 'sent', sent_at: '2026-11-03T02:00:00Z' })])), ['follow: Follow up R&R, 2 days']);
  // Sent Wed 4/11: 1 day, not yet.
  assert.deepEqual(reasons(job('j', [order('R&R', { material_stage: 'sent', sent_at: '2026-11-04T02:00:00Z' })])), []);
  // A reply moved it on: no follow up.
  assert.deepEqual(reasons(job('j', [order('R&R', { material_stage: 'order_confirmed', sent_at: '2026-10-20T02:00:00Z' })])), []);
});

test('Follow up skips weekends and WA public holidays', () => {
  // Sent Fri 30/10, today Mon 2/11: one working day.
  const c = ctx({ today: '2026-11-02' });
  assert.deepEqual(reasons(job('j', [order('R&R', { material_stage: 'sent', sent_at: '2026-10-30T02:00:00Z' })]), c), []);
  // Sent Thu 5/11, today Tue 10/11 with Mon 9/11 a holiday: Fri, Tue = 2.
  const h = ctx({ today: '2026-11-10', isHoliday: (d) => d === '2026-11-09' });
  assert.deepEqual(reasons(job('j', [order('R&R', { material_stage: 'sent', sent_at: '2026-11-05T02:00:00Z' })]), h), ['follow: Follow up R&R, 2 days']);
});

test('Date at risk: due after the install, or not confirmed with the install five working days away or less', () => {
  const near = { board: { install: { booked: true, day: '2026-11-12', first_day: '2026-11-12', passed: false } } }; // Thu 12/11: 5 working days
  const far = { board: { install: { booked: true, day: '2026-11-13', first_day: '2026-11-13', passed: false } } }; // Fri 13/11: 6
  assert.deepEqual(reasons(job('j', [order('Metroll')], near)), ['risk: Metroll date not confirmed, install in 5 days']);
  assert.deepEqual(reasons(job('j', [order('Metroll')], far)), []);
  assert.deepEqual(reasons(job('j', [order('Metroll', { date_confirmed: true, delivery_date: '2026-11-11' })], near)), []);
  assert.deepEqual(reasons(job('j', [order('Metroll', { date_confirmed: true, flag: 'after_install' })], far)), ['risk: Metroll due after install']);
  // Delivered, or the install passed: nothing at risk.
  assert.deepEqual(reasons(job('j', [order('Metroll', { material_stage: 'delivered' })], near)), []);
  assert.deepEqual(reasons(job('j', [order('Metroll')], { board: { install: { booked: true, day: '2026-11-04', passed: true } } })), []);
});

test('SWP-261293: two to pay and one waiting, install Wed 18/11', () => {
  const j = job('swp', [
    order('AMPELITE AUSTRALIA PTY LTD', { material_stage: 'awaiting_payment', payment: { state: 'unpaid', to_pay: true }, delivery_date: '2026-11-10' }),
    order('CMI', { material_stage: 'awaiting_payment', payment: { state: 'unpaid', to_pay: true }, delivery_date: '2026-11-10' }),
    order('Metroll', { material_stage: 'sent', sent_at: '2026-11-02T03:00:00Z', delivery_date: '2026-11-10' }),
  ], { board: { install: { booked: true, day: '2026-11-18', first_day: '2026-11-18', passed: false } } });
  assert.deepEqual(reasons(j), ['pay: Pay AMPELITE AUSTRALIA PTY LTD', 'pay: Pay CMI', 'follow: Follow up Metroll, 3 days']);
});

test('archived jobs need nothing', () => {
  assert.deepEqual(reasons(job('j', [order('X', { order_sent: false })], { board: { view: 'archive' } })), []);
  assert.deepEqual(reasons({ id: 'j', board: null }), []);
});

test('summarise counts jobs per chip, the jobs needing anything, and the tab total with emails', () => {
  const jobs = [
    job('a', [order('A1', { order_sent: false, material_stage: 'order_materials' }), order('A2', { material_stage: 'awaiting_payment', payment: { to_pay: true } })]),
    job('b', [order('B1', { material_stage: 'awaiting_payment', payment: { to_pay: true } }), order('B2', { material_stage: 'awaiting_payment', payment: { to_pay: true } })]),
    job('c', [order('C1')]),
  ];
  const s = N.summarise(jobs, ctx(), 4);
  assert.deepEqual(s.counts, { order: 1, drafted: 0, pay: 2, replied: 0, follow: 0, risk: 0, emails: 4 });
  assert.deepEqual(s.ids.pay, ['a', 'b']);
  assert.equal(s.jobs, 2);
  assert.equal(s.total, 6);
  assert.equal(s.reasons.c, undefined);
  assert.equal(s.shown.emails, true);
});

test('a chip with nothing to go on is hidden, not a false 0', () => {
  // The tray was not read: no Emails to sort chip, and no emails in the total.
  const noTray = N.summarise([job('a', [order('A', { order_sent: false })])], ctx(), null);
  assert.equal(noTray.shown.emails, false);
  assert.equal(noTray.total, 1);
  // An older server without sent_at: no Follow up chip, and no follow up tags.
  const old = order('R&R', { material_stage: 'sent' });
  delete old.sent_at;
  const s = N.summarise([job('a', [old])], ctx(), 0);
  assert.equal(s.shown.follow, false);
  assert.equal(s.jobs, 0);
});

test('a chip keeps only its jobs, in their own order; pressing nothing or emails keeps all', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const s = N.summarise([
    job('a', [order('A', { material_stage: 'awaiting_payment', payment: { to_pay: true } })]),
    job('b', []),
    job('c', [order('C', { material_stage: 'awaiting_payment', payment: { to_pay: true } })]),
  ], ctx(), 0);
  assert.deepEqual(N.filterRows(rows, s, 'pay').map((r) => r.id), ['a', 'c']);
  assert.deepEqual(N.filterRows(rows, s, 'risk').map((r) => r.id), []);
  assert.deepEqual(N.filterRows(rows, s, null).map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(N.filterRows(rows, s, 'emails').map((r) => r.id), ['a', 'b', 'c']);
});

test('jobs that need something come first; the rest stay below in their order', () => {
  const rows = [{ id: 'x' }, { id: 'a' }, { id: 'y' }, { id: 'b' }];
  const s = { reasons: { a: [{}], b: [{}] } };
  assert.deepEqual(N.needsFirst(rows, s).map((r) => r.id), ['a', 'b', 'x', 'y']);
});
