import { buildLines, buildSubmit, estimate, lineProblem, builderFromDraft, draftFromBuilder } from '../../crew/js/lib/invoice.js';
import { receiptsEnabled, receiptLine, receiptProblem, refreshReceiptLine, receiptSendFacts } from '../../crew/js/lib/reimbursements.js';

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};
const receipt = (extra = {}) => ({ id: 'receipt-1', submitted_by: 'crew', vendor_name: 'Supplier', receipt_date: '2026-11-09', total_amount: 80, status: 'pending', jobs: { job_number: 'ZZTEST-1' }, reimbursement: { claimable: true, reason: null }, ...extra });
const hours = { assignments: [], money: { super_basis: 'inclusive_12_112_v1' } };
const opts = { monday: '2026-11-09', gstOn: true, notes: '', rateEditable: false };
const linesFor = (rows: unknown[] | null, added = [receiptLine(receipt())]) => buildLines(hours, { added }, { receiptRows: rows, userId: 'crew' });

Deno.test('switch off, absent metadata and empty reads keep the receipt choice hidden', () => {
  for (const rows of [null, [], [{ id: 'old-receipt' }], [receipt({ reimbursement: { claimable: false, reason: 'reimbursement_switch_off' } })]]) equal(receiptsEnabled(rows), false);
  equal(receiptsEnabled([receipt()]), true);
});
Deno.test('receipt sends only its id, never a typed price or job', () => {
  const lines = linesFor([receipt()]);
  equal(buildSubmit(lines, opts).extra_items, [{ type: 'reimbursement', expense_receipt_id: 'receipt-1' }]);
  equal(lineProblem(lines[0], opts), '');
});
Deno.test('receipt adds to bank pay and leaves super and GST bases unchanged', () => {
  const labour = { kind: 'other', type: 'Other', amount: 560 };
  const before = estimate([labour], { basis: 'inclusive_12_112_v1', gstOn: true });
  const after = estimate([labour, ...linesFor([receipt()])], { basis: 'inclusive_12_112_v1', gstOn: true });
  equal([after.base, after.paidToYou, after.superPaid, after.gst], [560, before.paidToYou, before.superPaid, before.gst]);
  equal([after.reimb, after.intoBank - before.intoBank], [80, 80]);
});
Deno.test('missing receipt, failed read and switch off block a saved receipt without sending it', () => {
  for (const rows of [null, [], [receipt({ reimbursement: undefined })]]) {
    const lines = linesFor(rows);
    equal(Boolean(lineProblem(lines[0], opts)), true);
    equal(buildSubmit(lines, opts).extra_items, []);
    equal(estimate(lines, { basis: 'inclusive_12_112_v1' }).unfinished, 1);
  }
});
Deno.test('office changes replace stale saved figures and descriptions', () => {
  const line = linesFor([receipt({ total_amount: 35, vendor_name: 'Receipt revised', status: 'approved' })], [{ ...receiptLine(receipt()), amount: 9999 }])[0];
  equal([line.amount, line.description, line.status], [35, 'Receipt revised', 'approved']);
});
Deno.test('refusal and retry use the new server decision, never saved eligibility', () => {
  const denied = receipt({ reimbursement: { claimable: false, reason: 'reimbursement_already_claimed' } });
  equal(receiptProblem(denied), 'This receipt is already on an invoice.');
  equal(buildSubmit(linesFor([denied]), opts).extra_items, []);
  equal(buildSubmit(linesFor([receipt()]), opts).extra_items.length, 1);
  equal(Boolean(refreshReceiptLine(receiptLine(receipt()), [receipt({ submitted_by: 'other-crew' })], 'crew').receiptProblem), true);
});
Deno.test('missing or invalid amount cannot become zero or an invoice line', () => {
  for (const total_amount of [null, '', 0, -1, 'unreadable']) equal(Boolean(receiptProblem(receipt({ total_amount }))), true);
});
Deno.test('a receipt is one line even when a saved draft repeats it', () => {
  equal(linesFor([receipt()], [receiptLine(receipt()), receiptLine(receipt())]).length, 1);
});
Deno.test('save and reopen preserve receipt identity and reread its amount', () => {
  const draft = { added: [receiptLine(receipt())] };
  const snap = builderFromDraft(hours, draft, linesFor([receipt()]), opts);
  equal(snap.invRows, [{ _source: 'crew_app', crew_line: { key: 'receipt:receipt-1', kind: 'reimbursement', receiptId: 'receipt-1' } }]);
  const reopened = draftFromBuilder(snap, hours);
  equal(buildLines(hours, reopened, { receiptRows: [receipt({ total_amount: 42 })], userId: 'crew' })[0].amount, 42);
});
Deno.test('sent receipt facts name skips and only say approval is pending when needed', () => {
  const selected = [receiptLine(receipt()), receiptLine(receipt({ id: 'approved', status: 'approved' }))];
  const facts = receiptSendFacts(selected, { skipped_items: [{ expense_receipt_id: 'receipt-1', words: 'Receipt was changed at the office.' }] });
  equal(facts.skipped, ['Receipt was changed at the office.']);
  equal(facts.accepted.map((l) => [l.receiptId, l.waiting]), [['approved', false]]);
  equal(receiptSendFacts(selected, {}).accepted[0].waiting, true);
});
Deno.test('switch-off invoice payload and old-basis arithmetic stay unchanged', () => {
  const line = { key: 'extra', kind: 'other', type: 'Other', amount: 560, description: 'Job item', title: 'ZZTEST-1' };
  const normal = buildLines(hours, { added: [line] });
  equal(buildSubmit(normal, opts), buildSubmit(buildLines(hours, { added: [line] }, { receiptRows: [{ id: 'old-receipt' }] }), opts));
  const m = estimate(normal, { gstOn: true, basis: null });
  equal([m.gross, m.superHeld, m.gst, m.pay], [560, 33.6, 56, 582.4]);
});

const oldApp = Deno.readTextFileSync(new URL('../../trade.html', import.meta.url));
const markerCode = oldApp.split('// <crew-receipt-marker>')[1].split('// </crew-receipt-marker>')[0];
const marker = () => ({ _source: 'crew_app', crew_line: { key: 'receipt:receipt-1', kind: 'reimbursement', receiptId: 'receipt-1' } });
Deno.test('old app names receipt markers and links the same week to Crew without an amount input', () => {
  const f = new Function('_invRows', '_hoursWeekStart', markerCode + '; return { has: _hasCrewReceiptMarkers(), html: _crewReceiptMarkerHtml() };');
  const out = f([marker()], '2026-11-09');
  equal(out.has, true);
  equal(out.html.includes('Reimbursement (receipt)'), true);
  equal(out.html.includes('crew/#/pay/week/2026-11-09/invoice'), true);
  equal(out.html.includes('<input'), false);
  equal(f([{ description: 'ordinary' }], '').has, false);
});
Deno.test('old app preserves the id-only receipt marker when syncing the draft', () => {
  const rows = [marker()];
  const before = JSON.stringify(rows);
  const code = oldApp.slice(oldApp.indexOf('  function _syncRowsFromDOM() {'), oldApp.indexOf('  function _calcInvTotals() {'));
  const f = new Function('_invRows', 'document', markerCode + code + '; _syncRowsFromDOM();');
  f(rows, { getElementById: () => null });
  equal(JSON.stringify(rows), before);
});
Deno.test('old app refuses both submit paths and legacy draft conversion instead of dropping the receipt', () => {
  for (const name of ['submitJobCentricInvoice', 'submitInvoiceFromBuilder', 'saveDraftInvoice']) {
    const start = oldApp.indexOf('  window.' + name + ' = function() {');
    const end = oldApp.indexOf('\n  };', start) + 5;
    const notices: string[] = [];
    const f = new Function('_invRows', 'toast', 'window', markerCode + oldApp.slice(start, end) + '; window.' + name + '();');
    f([marker()], (text: string) => notices.push(text), {});
    equal(notices.length, 1);
    equal(notices[0].includes('Open Crew'), true);
  }
});
