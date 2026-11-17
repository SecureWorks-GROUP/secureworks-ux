// Drive the shipped save function, including its retained identity and catch.
const page = await Deno.readTextFile(Deno.env.get('TRADE_DRAFT_SOURCE') || new URL('../../trade.html', import.meta.url));
function pageFunction(name: string) {
  const start = page.indexOf('  function ' + name + '(');
  if (start < 0) throw new Error('Missing page function: ' + name);
  return page.slice(start, page.indexOf('\n  }', start) + 4);
}
const start = page.indexOf('  window.saveDraftInvoice = function()');
const save = page.slice(start, page.indexOf('\n  };', start) + 5);
const functions = ['_draftInvoiceSaveProblem', '_invoiceDraftIdentity', '_invoiceDraftSaveSucceeded'].map(pageFunction).join('\n');
function harness(options: { week?: string; id?: string; replies: unknown[] }) {
  const requests: unknown[] = [], messages: unknown[] = [];
  let fallback = 0, ended = 0;
  const state = new Function('replies', 'requests', 'messages', 'options', 'onFallback', 'onEnd', `
    var window = {}, _draftInvoiceId = options.id || '', _draftSaveUnresolved = false;
    var _invoiceBuilderMode = options.week ? 'invoice' : 'expense', _hoursWeekStart = options.week;
    var _invRows = [{description: 'Receipt', expense_receipt_id: 'ZZTEST-receipt'}];
    var _invNotes = 'Keep my edits', _invGst = false;
    var _crewReceiptSubmitBlocked = () => false, _syncRowsFromDOM = () => {};
    var _invoiceApiContext = () => ({}), _invoiceApiCurrent = () => true;
    var _manualInvoiceRows = x => x, _invRowHasWork = () => true, _invRowsTimeError = () => '';
    var _rowToExtraItem = x => ({type: 'reimbursement', expense_receipt_id: x.expense_receipt_id});
    var _guardFinancialWrite = () => false, _beginSaveTradeInvoiceDraft = () => true;
    var _financialInvoiceApi = (action, params, body) => {
      requests.push(JSON.parse(JSON.stringify({action, body})));
      var result = replies.shift();
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    };
    var _endSaveTradeInvoiceDraft = onEnd, _noteInvoiceDeductionWeek = () => {};
    var toast = (message, error) => messages.push({message, error: !!error});
    var _handleFinancialWriteFailure = () => { onFallback(); return Promise.resolve({outcome: 'failed'}); };
    var _financialWriteAborted = () => false;
    var _financialWriteFailureToast = (outcome, err) => toast(err.message, true);
    var _ambiguousInvoiceResponseError = message => Object.assign(new Error(message), {code: 'invoice_response_ambiguous'});
    ${functions}
    ${save}
    return {save: window.saveDraftInvoice, id: () => _draftInvoiceId, notes: () => _invNotes, rows: () => _invRows};
  `)(options.replies.slice(), requests, messages, options, () => fallback++, () => ended++);
  return { ...state, requests, messages, fallback: () => fallback, ended: () => ended };
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(JSON.stringify({ actual, expected }));
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const error = (message: string, body = false) => Object.assign(new Error(body ? 'Request failed' : message), body ? {body: {error: message}} : {});

Deno.test('FU17 undated saves send each returned draft_id and keep the receipt', async () => {
  const h = harness({replies: [{success: true, draft_id: 'ZZTEST-first'}, {success: true, draft_id: 'ZZTEST-next'}, {success: true, draft_id: 'ZZTEST-last'}]});
  for (let i = 0; i < 3; i++) { h.save(); await settle(); }
  equal(h.requests.map((r: any) => r.body.draft_id), [undefined, 'ZZTEST-first', 'ZZTEST-next']);
  for (const r of h.requests as any[]) {
    equal(r.action, 'save_trade_invoice_draft');
    equal(r.body.week_start, null);
    equal(r.body.extra_items, [{type: 'reimbursement', expense_receipt_id: 'ZZTEST-receipt'}]);
  }
  equal(h.id(), 'ZZTEST-last'); equal(h.ended(), 3); equal(h.fallback(), 0);
});

Deno.test('FU17 stale or office-changed draft shows recovery words without clearing edits or queueing a new draft', async () => {
  for (const message of ['The selected undated draft is no longer replaceable', 'selected weekly/hourly draft is no longer replaceable', 'weekly/hourly draft has an external Xero identity']) {
    for (const body of [false, true]) {
      const h = harness({id: 'ZZTEST-stale', replies: [error(message, body), error(message, body)]});
      for (let i = 0; i < 2; i++) { h.save(); await settle(); }
      equal(h.requests.map((r: any) => r.body.draft_id), ['ZZTEST-stale', 'ZZTEST-stale']);
      equal(h.messages, Array(2).fill({message: 'This draft has changed or is no longer available. Your changes have not been saved. Open Invoice history and reopen the draft before saving again.', error: true}));
      equal(h.fallback(), 0); equal(h.ended(), 2); equal(h.id(), 'ZZTEST-stale');
      equal(h.notes(), 'Keep my edits'); equal(h.rows().length, 1);
    }
  }
});

Deno.test('FU17 unreadable selected draft keeps its identity for a successful retry', async () => {
  const h = harness({id: 'ZZTEST-held', replies: [error('Could not read the selected undated draft', true), {success: true, draft_id: 'ZZTEST-retry'}]});
  h.save(); await settle();
  equal(h.messages[0], {message: 'Could not check this draft. Your changes have not been saved. Try saving again.', error: true});
  equal(h.id(), 'ZZTEST-held'); equal(h.fallback(), 0);
  h.save(); await settle();
  equal(h.requests.map((r: any) => r.body.draft_id), ['ZZTEST-held', 'ZZTEST-held']);
  equal(h.id(), 'ZZTEST-retry'); equal(h.messages[1], {message: 'Draft saved', error: false});
});

Deno.test('FU17 dated saves and legacy success fields keep the existing payload and outcome', async () => {
  const h = harness({week: '2026-11-16', id: 'ZZTEST-prior', replies: [{success: true, invoice_id: 'ZZTEST-dated'}]});
  h.save(); await settle();
  equal((h.requests[0] as any).body, {week_start: '2026-11-16', draft_id: 'ZZTEST-prior', extra_items: [{type: 'reimbursement', expense_receipt_id: 'ZZTEST-receipt'}], notes: 'Keep my edits', labour_lines: [], gst_on: false});
  equal(h.id(), 'ZZTEST-dated'); equal(h.messages, [{message: 'Draft saved', error: false}]);
});

Deno.test('FU17 unrelated errors and a missing returned identity retain existing failure handling', async () => {
  for (const reply of [error('Failed to fetch'), {success: true}]) {
    const h = harness({replies: [reply]}); h.save(); await settle();
    equal(h.id(), ''); equal(h.fallback(), 1); equal(h.ended(), 1);
    equal(h.messages.some((m: any) => m.message === 'Draft saved'), false);
  }
});

Deno.test('FU17 dated and first-save refusals retain main handling', async () => {
  for (const options of [{week: '2026-11-16', id: 'ZZTEST-dated'}, {}]) {
    const h = harness({...options, replies: [error('selected weekly/hourly draft is no longer replaceable')]});
    h.save(); await settle();
    equal(h.fallback(), 1); equal(h.ended(), 1);
    equal(h.messages, [{message: 'selected weekly/hourly draft is no longer replaceable', error: true}]);
  }
});
