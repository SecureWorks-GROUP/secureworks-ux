// Restoration panel rules (modules/ops-restoration.js, <ops-restoration-core>).
// The page side is one read and one innerHTML; everything it decides is here.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../modules/ops-restoration.js');

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('only a restoration family job on the make-safe board gets the panel', () => {
  assert.equal(Core.isRestorationJob({ type: 'makesafe', metadata: { makesafe_job_family: 'restoration' } }), true);
  // The older storage shape: the insurance type field outranks the family field.
  assert.equal(Core.isRestorationJob({ type: 'insurance', metadata: { makesafe_job_family: 'general_makesafe', insurance_job_type: 'restoration' } }), true);
  assert.equal(Core.isRestorationJob({ type: 'makesafe', metadata: { makesafe_job_family: 'general_makesafe' } }), false);
  assert.equal(Core.isRestorationJob({ type: 'repair', metadata: { makesafe_job_family: 'repair' } }), false);
  assert.equal(Core.isRestorationJob({ type: 'fencing', metadata: { makesafe_job_family: 'restoration' } }), false);
  assert.equal(Core.isRestorationJob({ type: 'makesafe' }), false);
  assert.equal(Core.isRestorationJob(null), false);
});

test('money and days read plainly, and an unknown amount is blank, never $0', () => {
  assert.equal(Core.money(1680), '$1,680.00');
  assert.equal(Core.money(0.5), '$0.50');
  assert.equal(Core.money(null), '');
  assert.equal(Core.money(undefined), '');
  assert.equal(Core.money('abc'), '');
  assert.equal(Core.day('2026-11-13T02:00:00.000Z'), '13 Nov 2026');
  assert.equal(Core.day(''), '');
});

test('the quote line says the number, the amount and where it stands', () => {
  assert.equal(
    Core.quoteLine({ quote_number: 'SWMS-261999-Q1', revision: 1, subtotal_ex_gst: 1680, status: 'draft' }),
    'SWMS-261999-Q1 · $1,680.00 ex GST · Draft, not sent',
  );
  assert.equal(
    Core.quoteLine({ quote_number: 'SWMS-261999-Q1', subtotal_ex_gst: 1680, status: 'sent', sent: { at: '2026-11-12T03:00:00Z', to: 'coordinator@builder.example' } }),
    'SWMS-261999-Q1 · $1,680.00 ex GST · With the builder (coordinator@builder.example), sent 12 Nov 2026',
  );
  assert.equal(
    Core.quoteLine({ quote_number: 'SWMS-261999-Q1', subtotal_ex_gst: 1680, status: 'approved', decision: { decided_by: 'Builder Coordinator', decided_at: '2026-11-13T05:00:00Z' } }),
    'SWMS-261999-Q1 · $1,680.00 ex GST · Approved by Builder Coordinator on 13 Nov 2026',
  );
  assert.equal(Core.quoteLine(null), '');
});

test('an assess and quote job waiting on the builder says so, with the limit and the PDF', () => {
  const html = Core.cardHtml({
    restoration: {
      mode: 'assess_and_quote',
      phase: 'awaiting_approval',
      phase_label: 'Quote with builder',
      next_step: 'Quote SWMS-261999-Q1 is with the builder. Do not start the quoted works until their approval is recorded.',
      quote: { quote_number: 'SWMS-261999-Q1', revision: 1, subtotal_ex_gst: 1680, status: 'sent', sent: { at: '2026-11-12T03:00:00Z', to: 'coordinator@builder.example' }, pdf_url: 'https://storage.example.invalid/q.pdf' },
      approved_quote_number: null,
    },
    authority_limit: { status: 'over_limit', note: 'The invoice proposal is $1260 ex GST, over the builder\'s $1000 authority limit for the initial attendance. Get their approval before it is invoiced.' },
    invoice_handoff: null,
  }, esc);
  assert.match(html, /data-restoration-mode[^>]*>Assess and quote</);
  assert.match(html, /data-restoration-phase[^>]*>Quote with builder</);
  assert.match(html, /Do not start the quoted works/);
  assert.match(html, /data-restoration-limit[^>]*font-weight:700/);
  assert.match(html, /data-restoration-pdf href="https:\/\/storage\.example\.invalid\/q\.pdf"/);
  assert.doesNotMatch(html, /data-restoration-invoice/);
});

test('a do and charge job with nothing on file is one quiet line, and a no-limit note is not drawn', () => {
  const html = Core.cardHtml({
    restoration: { mode: 'do_and_charge', phase: 'attend_and_charge', phase_label: 'Do and charge', next_step: 'Attend and do the work, then send the report, photos and invoice as for any make-safe.', quote: null },
    authority_limit: { status: 'no_limit', note: 'The work order states no authority limit.' },
    invoice_handoff: null,
  }, esc);
  assert.match(html, /data-restoration-mode[^>]*>Do and charge</);
  assert.doesNotMatch(html, /data-restoration-phase/);
  assert.doesNotMatch(html, /data-restoration-limit/);
  assert.doesNotMatch(html, /data-restoration-quote/);
});

test('an approved quote shows its evidence and whether it can be invoiced yet', () => {
  const base = {
    restoration: {
      mode: 'assess_and_quote', phase: 'approved_works', phase_label: 'Quote approved', next_step: 'Carry out the works, then invoice the approved quote.',
      quote: { quote_number: 'SWMS-261999-Q1', subtotal_ex_gst: 1680, status: 'approved', decision: { decided_by: 'Builder Coordinator', decided_at: '2026-11-13T05:00:00Z', evidence_ref: 'Re: MLR-40001 quote, 13 Nov 2026' } },
      approved_quote_number: 'SWMS-261999-Q1', approved_total_ex_gst: 1680,
    },
    authority_limit: { status: 'no_limit', note: '' },
  };
  const waiting = Core.cardHtml(Object.assign({}, base, { invoice_handoff: { ready: false, code: 'docket_not_prepared', reason: 'Prepare the docket for the completed works first; the invoice is priced against it.' } }), esc);
  assert.match(waiting, /Recorded from: Re: MLR-40001 quote, 13 Nov 2026/);
  assert.match(waiting, /data-restoration-invoice[^>]*>Prepare the docket for the completed works first/);
  const ready = Core.cardHtml(Object.assign({}, base, { invoice_handoff: { ready: true, total_ex_gst: 1680 } }), esc);
  assert.match(ready, /Ready to invoice the approved quote: \$1,680\.00 ex GST\./);
});

test('a later revision never hides the approved quote that is in force', () => {
  const html = Core.cardHtml({
    restoration: {
      mode: 'assess_and_quote', phase: 'approved_works', phase_label: 'Quote approved', next_step: 'x',
      quote: { quote_number: 'SWMS-261999-Q2', subtotal_ex_gst: 2040, status: 'draft' },
      approved_quote_number: 'SWMS-261999-Q1', approved_total_ex_gst: 1680,
    },
    authority_limit: null, invoice_handoff: null,
  }, esc);
  assert.match(html, /SWMS-261999-Q2 · \$2,040\.00 ex GST · Draft, not sent/);
  assert.match(html, /SWMS-261999-Q1 is the approved quote in force \(\$1,680\.00 ex GST\)/);
});

test('everything from the server is escaped, and a link that is not https is not drawn', () => {
  const html = Core.cardHtml({
    restoration: { mode: 'do_and_charge', phase: 'quote_drafted', phase_label: '<b>x</b>', next_step: '<script>alert(1)</script>', quote: { quote_number: '"><img>', subtotal_ex_gst: 1, status: 'draft', pdf_url: 'javascript:alert(1)' } },
    authority_limit: null, invoice_handoff: null,
  }, esc);
  assert.doesNotMatch(html, /<script>|<img>|<b>x<\/b>|javascript:/);
});

test('no plan paints nothing; a failed read says so; an unknown action stays silent', () => {
  assert.equal(Core.cardHtml(null, esc), '');
  assert.equal(Core.cardHtml({ restoration: {} }, esc), '');
  assert.match(Core.failedHtml('Quote SWMS-1-Q1 does not match its filed document.', esc), /Restoration plan not shown\.<\/strong> Quote SWMS-1-Q1 does not match/);
  assert.match(Core.failedHtml('', esc), /could not be read/);
  assert.equal(Core.isUnknownAction(new Error('Unknown action: restoration_plan')), true);
  assert.equal(Core.isUnknownAction({ body: { error: 'Unknown action: restoration_plan' } }), true);
  assert.equal(Core.isUnknownAction(new Error('Could not reach the server.')), false);
});
