import { deepEqual as equal } from 'node:assert/strict';
import { ApiError } from '../../crew/js/lib/api.js';

(globalThis as Record<string, unknown>).window = {
  CREW_CONFIG: { memoryRoutes: true },
  addEventListener() {},
  location: { hash: '', pathname: '/crew/', search: '' }
};
(globalThis as Record<string, unknown>).document = { addEventListener() {} };

const {
  spendCaptureEnabled,
  reimbursementSwitchOn,
  savedReceiptReimbursedOnInvoice,
  stockDivisionOfVertical,
  stockDivisionOfJob,
  divisionsForUser,
  nextStepWords,
  serverWordsOf
} = await import('../../crew/js/screens/receipt.js');

Deno.test('spendCaptureEnabled stays false until the server explicitly sends spend_capture_v2 true', () => {
  equal(spendCaptureEnabled({}), false);
  equal(spendCaptureEnabled({ expense: { expense_id: 'ex-1' }, expensesData: { expenses: [] } }), false);
  equal(spendCaptureEnabled({ expense: { spend_capture_v2: false }, expensesData: { spend_capture_v2: true } }), false);
  equal(spendCaptureEnabled({ expense: { spend_capture_v2: true } }), true);
  equal(spendCaptureEnabled({ expensesData: { spend_capture_v2: true } }), true);
});

Deno.test('reimbursementSwitchOn and savedReceiptReimbursedOnInvoice stay false unless server confirms claimable', () => {
  equal(reimbursementSwitchOn(null), false);
  equal(reimbursementSwitchOn({ expenses: [{ id: 'ex-1', payment_method: 'personal_card' }] }), false);
  equal(
    reimbursementSwitchOn({
      expenses: [{ id: 'ex-1', reimbursement: { claimable: false, reason: 'reimbursement_switch_off' } }]
    }),
    false
  );
  equal(
    reimbursementSwitchOn({
      expenses: [{ id: 'ex-1', reimbursement: { claimable: true, reason: null } }]
    }),
    true
  );

  // Switch off on server -> never claimable on next invoice.
  equal(
    savedReceiptReimbursedOnInvoice({
      expensesData: { expenses: [{ id: 'ex-1', payment_method: 'personal_card' }] },
      expenseId: 'ex-1',
      hasPhoto: true
    }),
    false
  );
  // Switch on, photo receipt -> claimable on next invoice.
  equal(
    savedReceiptReimbursedOnInvoice({
      expensesData: { expenses: [{ id: 'ex-1', reimbursement: { claimable: true, reason: null } }] },
      expenseId: 'ex-1',
      hasPhoto: true
    }),
    true
  );
  // Switch on, no-photo slip -> server marks reimbursement_receipt_required, so do not promise invoice reimbursement.
  equal(
    savedReceiptReimbursedOnInvoice({
      expensesData: { expenses: [{ id: 'ex-2', reimbursement: { claimable: false, reason: 'reimbursement_receipt_required' } }] },
      expenseId: 'ex-2',
      hasPhoto: false
    }),
    false
  );
});

Deno.test('stockDivisionOfVertical and stockDivisionOfJob map only the three real stock divisions', () => {
  equal(stockDivisionOfVertical('patio'), 'patios');
  equal(stockDivisionOfVertical('decking'), 'patios');
  equal(stockDivisionOfVertical('fencing'), 'fencing');
  equal(stockDivisionOfVertical('makesafe'), 'insurance');
  equal(stockDivisionOfVertical('repair'), 'insurance');
  equal(stockDivisionOfVertical('restoration'), 'insurance');
  equal(stockDivisionOfVertical('roofing'), null);
  equal(stockDivisionOfJob({ type: 'granny_flat', job_number: 'SWP-990010' }), null);
  equal(stockDivisionOfJob({ type: 'fencing', job_number: 'SWF-990001' }), 'fencing');
  equal(stockDivisionOfJob({ type: 'makesafe', job_number: 'SWMS-990003' }), 'insurance');
  equal(stockDivisionOfJob({ job_number: 'SWD-990005' }), 'patios');
});

Deno.test('divisionsForUser shows only divisions the trade works for, never guessing when empty', () => {
  const trade = { id: 'u-1', role: 'crew', office: false, managed: [], managed_verticals: [] };
  equal(divisionsForUser(trade, []), []);
  equal(
    divisionsForUser(trade, [{ job: { id: 'j-1', type: 'fencing', job_number: 'SWF-990001' } }]),
    [['fencing', 'Fencing stock']]
  );
  equal(
    divisionsForUser(
      { ...trade, managed: ['makesafe'] },
      [{ job: { id: 'j-2', type: 'patio', job_number: 'SWP-990002' } }]
    ),
    [['patios', 'Patio stock'], ['insurance', 'Insurance stock']]
  );
  equal(
    divisionsForUser({ id: 'u-off', role: 'ops_manager', office: true }, []),
    [['patios', 'Patio stock'], ['fencing', 'Fencing stock'], ['insurance', 'Insurance stock']]
  );
});

Deno.test('nextStepWords gates reimbursement invoice promise on server reimbursementOn and keeps exact v2 words', () => {
  equal(nextStepWords('reimbursed_on_next_invoice', { reimbursementOn: false }), 'Saved. The office will see it.');
  equal(nextStepWords('reimbursed_on_next_invoice', { reimbursementOn: true }), 'Saved. It will be on your next invoice as a reimbursement.');
  equal(nextStepWords('saved_against_job', { jobNumber: 'SWF-990001' }), 'Saved against SWF-990001.');
  equal(nextStepWords('saved_to_stock', { stockDivision: 'fencing' }), 'Saved to fencing stock.');
  equal(nextStepWords('saved_to_stock', { stockDivision: 'patios' }), 'Saved to patio stock.');
  equal(nextStepWords('saved_to_stock', { stockDivision: 'insurance' }), 'Saved to insurance stock.');
  equal(nextStepWords('draft_bill', {}), 'Saved. The office will see it.');
  equal(nextStepWords('evidence_for_supplier_bill', {}), "Saved. It will be matched to the supplier's bill.");
  equal(nextStepWords(null, {}), 'Saved. The office will see it.');
});

Deno.test('serverWordsOf reads P2-06.4 error-code plus message bodies without exposing raw codes', () => {
  const makeErr = (msg: string, opts: Record<string, unknown>) => new (ApiError as unknown as new (m: string, o: Record<string, unknown>) => unknown)(msg, opts);
  const err409 = makeErr('expense_needs_job_or_division', {
    status: 409,
    body: { error: 'expense_needs_job_or_division', message: 'Pick the job or the stock this was for.' }
  });
  equal(serverWordsOf(err409), 'Pick the job or the stock this was for.');

  const billed409 = makeErr('expense_already_billed', {
    status: 409,
    body: { error: 'expense_already_billed', message: 'This receipt already has a bill in Xero.' }
  });
  equal(serverWordsOf(billed409), 'This receipt already has a bill in Xero.');

  const changed409 = makeErr('The receipt changed. Reload it and try again.', {
    status: 409,
    body: { error: 'The receipt changed. Reload it and try again.' }
  });
  equal(serverWordsOf(changed409), 'The receipt changed. Reload it and try again.');

  const offline = makeErr('No signal', { offline: true });
  equal(serverWordsOf(offline), 'No signal. Nothing is lost: press Save receipt again when you are back in range.');
});
