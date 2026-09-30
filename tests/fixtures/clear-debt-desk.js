// Offline fixture for the Clear Debt desk screen (docs/clear-debt-desk.md).
// Shapes follow the backend as built: debt_book (fm/debt-reader-1) and debt_morning_list
// (fm/debt-morning-list-2): item ids are date:payer_key:group:step, builders key as mlb / aj /
// other_builder:<label>, holds are group 'hold' with step null and held_step (the step the payer would be on), open promises sit in paused[].
// The drafts on items are a preview of plan step 3; step 2 sends draft: null.
// Every name is made up. Dates are derived from today's Perth date at run time,
// so ages and "overdue" never rot as the real calendar moves on.
const { perthDate, addIsoDays } = require('../helpers/feed-stub');

function uuid(n) { return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }

function buildClearDebtDeskFixture(today = perthDate()) {
  const d = (n) => addIsoDays(today, n);
  const inv = (n, o) => Object.assign({
    xero_invoice_id: uuid(9000 + n), invoice_number: 'INV-' + (9000 + n), contact_id: uuid(100 + n),
    is_debt: true, hold: null, hold_reason: null, job_status: 'complete', total: o.amount_due,
    invoice_date: o.due_date ? addIsoDays(o.due_date, -7) : d(-30),
  }, o);
  const invoices = [
    inv(1, { contact_name: 'Harper Nguyen', payer: 'client', kind: 'final', reference: 'SWP-90001-FINBAL', job_number: 'SWP-90001', due_date: d(-2), amount_due: 6480, reason: 'Final invoice on a complete job' }),
    inv(2, { contact_name: 'Oscar Patel', payer: 'client', kind: 'final', reference: 'SWF-90002-FINBAL', job_number: 'SWF-90002', due_date: d(-2), amount_due: 4215.5, reason: 'Final invoice on a complete job' }),
    inv(3, { contact_name: 'Mia Laurent', payer: 'client', kind: 'variation', reference: 'SWP-90003-VAR', job_number: 'SWP-90003', due_date: d(-5), amount_due: 1320, reason: 'Variation, agreed extra work' }),
    inv(4, { contact_name: 'Theo Brennan', payer: 'client', kind: 'final', reference: 'SWP-90004-FINBAL', job_number: 'SWP-90004', due_date: d(-45), amount_due: 3497.24, reason: 'Final invoice on a complete job' }),
    inv(5, { contact_name: 'Ruby Castillo', payer: 'client', kind: 'final', reference: 'SWF-90005-FINBAL', job_number: 'SWF-90005', job_status: 'rectification', due_date: d(-12), amount_due: 2860, hold: 'fix_first', hold_reason: 'Job in rectification: gate latch to refit', reason: 'Final invoice, job in rectification' }),
    inv(6, { contact_name: 'Leo Fraser', payer: 'client', kind: 'final', reference: 'SWP-90006-FINBAL', job_number: 'SWP-90006', due_date: d(6), amount_due: 5900, reason: 'Final invoice on a complete job' }),
    inv(7, { contact_name: 'Ivy Okafor', payer: 'client', kind: 'deposit', reference: 'SWP-90007-DEP', job_number: 'SWP-90007', job_status: 'accepted', is_debt: false, invoice_date: d(-70), due_date: d(-63), amount_due: 3120, reason: 'Deposit: not debt' }),
    inv(8, { contact_name: 'Sam Whitlock', payer: 'client', kind: 'progress_claim', reference: 'SWP-90008-PROG', job_number: 'SWP-90008', job_status: 'scheduled', is_debt: false, not_debt_reason: 'before_first_payment', invoice_date: d(-20), due_date: d(-6), amount_due: 8750.01, reason: 'Progress claim, job has had no first payment yet' }),
    inv(9, { contact_name: 'Ada Kowalski', payer: 'client', kind: 'deposit', reference: 'SWF-90009-DEP', job_number: 'SWF-90009', job_status: 'accepted', is_debt: false, invoice_date: d(-10), due_date: d(-3), amount_due: 2400, reason: 'Deposit: not debt' }),
    inv(19, { contact_name: 'Eli Moreau', payer: 'client', kind: 'deposit', reference: 'SWP-90019-DEP', job_number: 'SWP-90019', job_status: 'in_progress', is_debt: false, invoice_date: d(-90), due_date: d(-83), amount_due: 1850, reason: 'Deposit: not debt' }),
    inv(10, { contact_name: 'Major Loss Builders', payer: 'mlb', kind: 'builder', reference: 'MLB-90010 PO-5510', job_number: 'SWMS-90010', due_date: d(-18), amount_due: 1332.1, reason: 'Builder invoice, make-safe' }),
    inv(11, { contact_name: 'Major Loss Builders', payer: 'mlb', kind: 'builder', reference: 'MLB-90011 PO-5511', job_number: 'SWMS-90011', due_date: d(-3), amount_due: 561, reason: 'Builder invoice, roof report' }),
    inv(12, { contact_name: 'Major Loss Builders', payer: 'mlb', kind: 'builder', reference: 'MLB-90012 PO-5512', job_number: 'SWMS-90012', due_date: d(-40), amount_due: 838.2, hold: 'check_first', hold_reason: 'In dispute with the builder', reason: 'Builder invoice, make-safe' }),
    inv(13, { contact_name: 'Major Loss Builders', payer: 'mlb', kind: 'builder', reference: 'MLB-90013 PO-5513', job_number: 'SWMS-90013', due_date: null, amount_due: 412.5, reason: 'Builder invoice, assessment report' }),
    inv(14, { contact_name: 'AJ Building & Restoration', payer: 'aj', kind: 'builder', reference: 'AJBR-90014', job_number: 'SWMS-90014', due_date: d(-95), amount_due: 1006.5, reason: 'Builder invoice, make-safe' }),
    inv(15, { contact_name: 'Builderwest', payer: 'other_builder', kind: 'builder', reference: 'BW-90015', job_number: 'SWMS-90015', due_date: d(-120), amount_due: 2386.72, hold: 'check_first', hold_reason: 'Builder rejected the invoice', reason: 'Builder invoice, make-safe' }),
    inv(16, { contact_name: 'ML Builders', payer: 'not_chased', kind: 'builder', reference: 'MLB-90016', job_number: 'SWMS-90016', is_debt: false, due_date: d(-80), amount_due: 305.25, reason: 'Old ML Builders contact: only Major Loss Builders counts' }),
    inv(18, { contact_name: 'Grace Tan', payer: 'client', kind: 'final', reference: 'SWF-90018-FINBAL', job_number: 'SWF-90018', due_date: d(-9), amount_due: 2150, reason: 'Final invoice on a complete job' }),
    inv(17, { contact_name: 'Nina Hollis', payer: 'client', kind: 'final', reference: 'SWP-90017-FINBAL', job_number: 'SWP-90017', due_date: d(-8), amount_due: 1573.68, reason: 'Final invoice on a complete job' }),
  ];
  const byNo = Object.fromEntries(invoices.map((i) => [i.invoice_number, i]));
  const ref = (...nos) => nos.map((no) => ({ xero_invoice_id: byNo[no].xero_invoice_id, invoice_number: no, amount_due: byNo[no].amount_due, due_date: byNo[no].due_date }));
  const item = (o) => Object.assign({ hold: null, hold_reason: null, promise: null, last_outcome: null, draft: null }, o, { amount: o.invoices.reduce((a, x) => a + Math.round(x.amount_due * 100), 0) / 100 });
  const mid = (key, group, step) => today + ':' + key + ':' + group + ':' + step;
  const at = (days, hhmm) => addIsoDays(today, days) + 'T' + hhmm + ':00+08:00';
  const words = (iso) => { const [y, m, dd] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }); };

  const items = [
    item({ id: mid(uuid(101), 'text', 'friendly_text'), payer_key: uuid(101), payer_name: 'Harper Nguyen', payer: 'client', group: 'text', step: 'friendly_text', step_label: 'Day 1: friendly text', days_overdue: 2, invoices: ref('INV-9001'),
      draft: { id: 'draft-harper', channel: 'sms', status: 'pending', text: 'Hi Harper, a friendly reminder that invoice INV-9001 for $6,480.00 was due ' + words(d(-2)) + '. You can pay it here: https://in.xero.com/example. Thanks, SecureWorks WA' } }),
    item({ id: mid(uuid(102), 'text', 'friendly_text'), payer_key: uuid(102), payer_name: 'Oscar Patel', payer: 'client', group: 'text', step: 'friendly_text', step_label: 'Day 1: friendly text', days_overdue: 2, invoices: ref('INV-9002'),
      draft: { id: 'draft-oscar', channel: 'sms', status: 'approved', approved_by: 'Shaun', text: 'Hi Oscar, a friendly reminder that invoice INV-9002 for $4,215.50 was due ' + words(d(-2)) + '. You can pay it here: https://in.xero.com/example. Thanks, SecureWorks WA' } }),
    item({ id: mid(uuid(103), 'call', 'call'), payer_key: uuid(103), payer_name: 'Mia Laurent', payer: 'client', group: 'call', step: 'call', step_label: 'Day 3: Shaun calls', days_overdue: 5, invoices: ref('INV-9003'),
      last_outcome: { code: 'no_answer', at: at(-1, '09:12'), by: 'Shaun' },
      draft: { id: 'draft-mia', channel: 'call_script', status: 'pending', text: 'Calling about the variation invoice INV-9003, $1,320.00, due ' + words(d(-5)) + '. Ask when it will be paid; offer the pay link by text.' } }),
    item({ id: mid(uuid(104), 'broken_promise', 'firm_text'), payer_key: uuid(104), payer_name: 'Theo Brennan', payer: 'client', group: 'broken_promise', step: 'firm_text', step_label: 'Promise broken: firm text', days_overdue: 45, invoices: ref('INV-9004'),
      promise: { amount: 1000, date: d(-2), status: 'broken' },
      draft: { id: 'draft-theo', channel: 'sms', status: 'pending', text: 'Hi Theo, we had $1,000.00 promised by ' + words(d(-2)) + ' on invoice INV-9004 and have not seen it. Please pay today here: https://in.xero.com/example. Thanks, SecureWorks WA' } }),
    item({ id: mid(uuid(117), 'jan', 'jan_visit'), payer_key: uuid(117), payer_name: 'Nina Hollis', payer: 'client', group: 'jan', step: 'jan_visit', step_label: 'Day 7: Jan visits', days_overdue: 8, invoices: ref('INV-9017') }),
    item({ id: mid('aj', 'call', 'builder_call'), payer_key: 'aj', payer_name: 'AJ Building & Restoration', payer: 'aj', group: 'call', step: 'builder_call', step_label: '30 days overdue: Shaun calls', days_overdue: 95, invoices: ref('INV-9014') }),
    item({ id: mid('mlb', 'statement', 'statement'), payer_key: 'mlb', payer_name: 'Major Loss Builders', payer: 'mlb', group: 'statement', step: 'statement', step_label: 'Monday statement', days_overdue: 18, invoices: ref('INV-9010') }),
    item({ id: mid(uuid(107), 'deposit_reminder', 'deposit_reminder'), payer_key: uuid(107), payer_name: 'Ivy Okafor', payer: 'client', group: 'deposit_reminder', step: 'deposit_reminder', step_label: 'One friendly deposit reminder', days_overdue: 63, invoices: ref('INV-9007'),
      draft: { id: 'draft-ivy', channel: 'sms', status: 'skipped', text: 'Hi Ivy, just checking in about your patio. The deposit invoice INV-9007 is still open; let us know if you would like to go ahead. Thanks, SecureWorks WA' } }),
    // Book holds, as the backend sends them: one item per payer and hold kind, group 'hold', step null, no draft.
    item({ id: mid(uuid(105), 'hold', 'fix_first') + ':INV-9005', payer_key: uuid(105), payer_name: 'Ruby Castillo', payer: 'client', group: 'hold', step: null, held_step: 'friendly_text', step_label: 'Fix first: Job in rectification: gate latch to refit', days_overdue: 12, invoices: ref('INV-9005'), hold: 'fix_first', hold_reason: 'Job in rectification: gate latch to refit' }),
    item({ id: mid('other_builder:Builderwest', 'hold', 'check_first') + ':INV-9015', payer_key: 'other_builder:Builderwest', payer_name: 'Builderwest', payer: 'other_builder', group: 'hold', step: null, held_step: 'builder_call', step_label: 'Check first: Builder rejected the invoice', days_overdue: 120, invoices: ref('INV-9015'), hold: 'check_first', hold_reason: 'Builder rejected the invoice' }),
    item({ id: mid('mlb', 'hold', 'check_first') + ':INV-9012', payer_key: 'mlb', payer_name: 'Major Loss Builders', payer: 'mlb', group: 'hold', step: null, held_step: 'statement', step_label: 'Check first: In dispute with the builder', days_overdue: 40, invoices: ref('INV-9012'), hold: 'check_first', hold_reason: 'In dispute with the builder' }),
  ];

  // Open promises pause chasing: they come in paused[], not items.
  const paused = [
    { payer_key: uuid(118), payer_name: 'Grace Tan', payer: 'client', invoices: ref('INV-9018'), amount: byNo['INV-9018'].amount_due, promise: { amount: 2150, date: d(3), status: 'open' }, resumes_on: d(4) },
  ];
  const waiting = [
    { payer_key: uuid(106), payer_name: 'Leo Fraser', invoice_numbers: ['INV-9006'], reason: 'not_due', next_step: 'friendly_text', next_date: d(7) },
    { payer_key: 'mlb', payer_name: 'Major Loss Builders', invoice_numbers: ['INV-9013'], reason: 'no_due_date', next_step: null, next_date: null },
  ];
  const notChased = [
    { invoice_number: 'INV-9016', payer_name: 'ML Builders', reason: 'Old ML Builders contact: only Major Loss Builders counts' },
    { invoice_number: 'INV-9019', payer_name: 'Eli Moreau', reason: 'Deposit invoice made late to match a bank transfer already received' },
  ];
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();
  const nextMonday = d(((8 - dow) % 7) || 7);

  // Our copy (list_debt_picture): what the Debt book tab's bar and payer groups read today.
  const classOf = (i) => (i.hold === 'check_first' ? (i.payer === 'other_builder' ? ['blocked_by_us', 'invoice_wrong'] : ['in_dispute', null]) : i.hold === 'fix_first' ? ['blocked_by_us', 'rectification'] : !i.is_debt ? ['not_owed', null] : ['genuine_debt', null]);
  const pictureRows = invoices.map((i) => {
    const [cls, blocker] = classOf(i);
    return {
      xero_invoice_id: i.xero_invoice_id, xero_contact_id: i.contact_id, contact_name: i.contact_name, invoice_number: i.invoice_number, reference: i.reference,
      status: 'AUTHORISED', total: i.total, amount_due: i.amount_due, invoice_date: i.invoice_date, due_date: i.due_date, job_number: i.job_number,
      debt_classification: cls, debt_blocker: blocker, debt_type: { final: 'final_balance', variation: 'variation', builder: 'work_order', deposit: 'deposit', progress_claim: 'progress_claim' }[i.kind],
      debt_owner: i.payer === 'client' ? 'DEBT' : 'INSURANCE', debt_classification_reason: i.reason, debt_next_action: i.hold_reason || 'Chase on the morning list',
      debt_as_of: at(-1 - (i.amount_due > 3000 ? 3 : 0), '06:30'),
    };
  });

  return {
    debt_book: { ok: true, version: 'debt-book/v1', read_at: at(0, '07:02'), perth_date: today, read_stable: true, read_warning: null, copy_check: { matches: true, differs_by: 0, invoice_count: 0, stamp: 'Matches Xero, read 07:02' }, invoices },
    debt_morning_list: {
      ok: true, version: 'debt-morning/v1', generated_at: at(0, '07:05'), perth_date: today, is_statement_day: dow === 1, next_statement_date: dow === 1 ? today : nextMonday,
      items, paused, waiting, not_chased: notChased,
      summary: { items: items.filter((i) => !i.hold).length, held: items.filter((i) => i.hold).length, paused: paused.length, groups: {} },
      book: { version: 'debt-book/v1', read_at: at(0, '07:02'), read_stable: true, read_warning: null, copy_check: { matches: true, differs_by: 0, invoice_count: 0, stamp: 'Matches Xero, read 07:02' } },
      schedule: {},
    },
    list_debt_picture: { version: 'debt-picture/v1', as_of: at(0, '07:00'), rows: pictureRows, newest_as_of: at(-1, '06:30') },
    debt_context_coverage: { as_of: at(0, '07:00'), rows: [], totals: {} },
  };
}

module.exports = { buildClearDebtDeskFixture };
