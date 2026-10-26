// Deposit flag on fencing and patio jobs: the pure rules.
// ---------------------------------------------------------------------------
// Pure node, no browser: this spec READS ../../modules/ops-job-deposit-flag.js, takes
// the code between `// <job-deposit-flag-core>` and `// </job-deposit-flag-core>`, and
// runs it, so every assertion is against the shipped functions.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const MODULE = resolve(__dirname, '../../modules/ops-job-deposit-flag.js');
const OPEN = '// <job-deposit-flag-core>';
const CLOSE = '// </job-deposit-flag-core>';
const SOURCE = readFileSync(MODULE, 'utf8');

function extractCore() {
  const a = SOURCE.indexOf(OPEN);
  const b = SOURCE.indexOf(CLOSE);
  if (a < 0 || b < 0 || b <= a) throw new Error(`job-deposit-flag-core sentinels not found in ${MODULE}`);
  // eslint-disable-next-line no-new-func
  return new Function(SOURCE.slice(a + OPEN.length, b) + '\n;return DepositFlagCore;')();
}

const C = extractCore();
const voided = { reason: 'deposit_voided', invoice_number: 'INV-1234', invoice_status: 'VOIDED', flagged_at: '2026-10-27T02:00:00Z' };
const unpaid = { reason: 'deposit_unpaid', invoice_number: 'INV-1235', invoice_status: 'AUTHORISED', flagged_at: null };

test.describe('Deposit flag core (extracted from modules/ops-job-deposit-flag.js)', () => {
  test('the flag says its own reason, then "check"', () => {
    expect(C.label(voided)).toBe('Deposit voided after move - check');
    expect(C.label(unpaid)).toBe('Deposit no longer paid after move - check');
    expect(C.label({ reason: 'some_new_reason' })).toBe('Deposit flag: some new reason - check');
  });

  test('a card draws the flag only when the block carries a reason', () => {
    const html = C.cardHtml({ id: 'f1', deposit_flag: voided });
    expect(html).toContain('Deposit voided after move - check');
    expect(html).toContain('data-deposit-flag="deposit_voided"');
    expect(html).toContain('Invoice INV-1234 is VOIDED');
    for (const flag of [undefined, null, {}, { reason: '' }, 'deposit_voided']) {
      expect(C.cardHtml({ id: 'f1', deposit_flag: flag })).toBe('');
    }
  });

  test('the job page: the flag with Mark dealt with, "couldn\'t check" when unreadable, nothing when none', () => {
    const html = C.detailHtml('f1', unpaid, false);
    expect(html).toContain('Deposit no longer paid after move - check');
    expect(html).toContain('Invoice INV-1235 is AUTHORISED');
    expect(html).toContain('data-deposit-flag-clear="f1"');
    expect(html).toContain('Mark dealt with');
    const unreadable = C.detailHtml('f1', null, true);
    expect(unreadable).toContain("Deposit flag: couldn't check");
    expect(unreadable).not.toContain('data-deposit-flag-clear');
    expect(C.detailHtml('f1', null, false)).toBe('');
    expect(C.detailHtml('f1', undefined, false)).toBe('');
  });

  test('a missing invoice number is said, never filled in', () => {
    expect(C.invoiceWords({ reason: 'deposit_voided', invoice_number: null, invoice_status: 'VOIDED' })).toBe('Invoice number not known is VOIDED');
    expect(C.invoiceWords({ reason: 'deposit_voided' })).toBe('');
  });

  test('cleared and no_open_flag both mean no open flag; anything else is not a clear', () => {
    expect(C.clearedBy({ ok: true, action: 'cleared' })).toBe(true);
    expect(C.clearedBy({ ok: true, action: 'no_open_flag' })).toBe(true);
    expect(C.clearedBy({ ok: false, action: 'cleared' })).toBe(false);
    expect(C.clearedBy({ ok: true })).toBe(false);
    expect(C.clearedBy(null)).toBe(false);
  });

  test('refusals are in words, never codes', () => {
    expect(C.refusalWords({ status: 403, code: 'operator_access_required' })).toBe('Only signed-in office staff can clear a deposit flag. Nothing was changed.');
    expect(C.refusalWords({ status: 503, body: { code: 'state_unwritable' } })).toBe('The deposit flag could not be cleared. Nothing was changed.');
  });

  test('a failure with no HTTP answer is unknown, never "Nothing was changed"', () => {
    const unknown = 'Could not tell whether the deposit flag was cleared. Refresh the job to check.';
    expect(C.refusalWords(new TypeError('Failed to fetch'))).toBe(unknown);
    expect(C.refusalWords(new Error('unexpected answer'))).toBe(unknown);
    expect(C.refusalWords({ code: 'operator_access_required' })).toBe(unknown);
    expect(C.refusalWords(null)).toBe(unknown);
  });

  test('no long dash in anything the module shows', () => {
    const shown = [
      C.cardHtml({ id: 'f1', deposit_flag: voided }),
      C.cardHtml({ id: 'f1', deposit_flag: unpaid }),
      C.cardHtml({ id: 'f1', deposit_flag: { reason: 'some_new_reason' } }),
      C.detailHtml('f1', voided, false),
      C.detailHtml('f1', unpaid, false),
      C.detailHtml('f1', { reason: 'some_new_reason', invoice_status: 'VOIDED' }, false),
      C.detailHtml('f1', null, true),
      C.label(voided),
      C.invoiceWords({ reason: 'deposit_voided', invoice_status: 'VOIDED' }),
      C.refusalWords({ status: 403, code: 'operator_access_required' }),
      C.refusalWords({ status: 503, code: 'state_unwritable' }),
      C.refusalWords(new TypeError('Failed to fetch')),
    ];
    for (const s of shown) {
      expect(s).not.toBe('');
      expect(s).not.toMatch(/[–—]/);
    }
  });
});
