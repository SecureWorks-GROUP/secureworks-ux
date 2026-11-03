// V16 work-order claim warning on the office job Overview card.
// Pure node, no browser: runs the shipped code between `// <job-work-order-core>`
// and `// </job-work-order-core>` in shared/job-work-order.js.
//
// The rows are SWF-261209 as list_trade_invoice_lines returns them to a staff
// caller (production rows, read only, 3 Nov 2026; the job has no job work
// order, so the card is blank and lists the invoice lines). The warning text
// is the one secureworks-backend's work_order_claim_check.ts writes for this
// job, worked by hand from the records: labour 255 + 1225 + 240 = 1720.00,
// largest claim 1465.00 (Alyx), Henry claimed 1153.00.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const SOURCE = readFileSync(resolve(__dirname, '../../shared/job-work-order.js'), 'utf8');
const OPEN = '// <job-work-order-core>';
const CLOSE = '// </job-work-order-core>';
function core() {
  const a = SOURCE.indexOf(OPEN);
  const b = SOURCE.indexOf(CLOSE);
  if (a < 0 || b <= a) throw new Error('job-work-order-core sentinels not found');
  // eslint-disable-next-line no-new-func
  return new Function(SOURCE.slice(a + OPEN.length, b) + '\n;return JobWorkOrderCore;')();
}
const C = core();

const WARNING = 'Labour on this job $1,720.00 against the largest work-order claim $1,465.00, $255.00 more. ' +
  'Two leads claimed a work order: Alyx $1,465.00, Henry $1,153.00. ' +
  'Check who did the work before approving.';
const HTML_WARNING = WARNING; // no characters esc() changes

const TAIL = 'Named crew bill SecureWorks Group directly; office to check their invoices against this breakdown.';
function rows(opts) {
  const warn = !opts || opts.warn !== false;
  return [
    { id: '19ca6478-d36f-43e7-a1d8-0d027c20b6dc', trade_name: 'Henry', line_type: 'work order', line_total_ex: 255,
      description: 'Work order $1153.00.\nLess labour: Alyx 1h x $898 = $898.00.\nTotal labour deducted $898.00.\nNet payable to holder $255.00.\n' + TAIL,
      trade_invoices: { status: 'paid' }, office_review_status: 'awaiting', work_order_claim_warning: warn ? WARNING : null },
    { id: 'ba9a8a1c-1b09-49c4-8315-0d6e29dca5cf', trade_name: 'Khairo', line_type: 'commission', line_total_ex: 258,
      description: 'Commission SWF-261209 Estelle Sioz', trade_invoices: { status: 'paid' }, work_order_claim_warning: null },
    { id: 'e2bcd53b-e9f5-4ec2-8e64-2560b1c0082b', trade_name: 'Kim Muiruri', line_type: 'labour', line_total_ex: 240, total_hours: 8,
      description: 'Fencing', trade_invoices: { status: 'paid' }, work_order_claim_warning: null },
    { id: 'fe3ebe3a-5e46-4f75-94f2-9c308ee6ce69', trade_name: 'Alyx', line_type: 'work order', line_total_ex: 1225,
      description: 'Work order $1465.00.\nLess labour: Kim 8h x $30 = $240.00.\nTotal labour deducted $240.00.\nNet payable to holder $1225.00.\n' + TAIL,
      trade_invoices: { status: 'paid' }, work_order_claim_warning: warn ? WARNING : null },
  ];
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('office card shows the warning under each of the two claim lines, and on no other line', () => {
  const html = C.renderOverviewCard(null, null, { showMoney: true, lines: rows(), linesState: 'ready' });
  assert.equal(count(html, HTML_WARNING), 2);
  assert.match(html, /data-job-wo-claim-warning="19ca6478-d36f-43e7-a1d8-0d027c20b6dc"/);
  assert.match(html, /data-job-wo-claim-warning="fe3ebe3a-5e46-4f75-94f2-9c308ee6ce69"/);
  assert.doesNotMatch(html, /data-job-wo-claim-warning="e2bcd53b/);
  assert.doesNotMatch(html, /data-job-wo-claim-warning="ba9a8a1c/);
  // The warning sits straight after Henry's line, before Khairo's.
  const henry = html.indexOf('>Henry<');
  const warnAt = html.indexOf('data-job-wo-claim-warning="19ca6478');
  const khairo = html.indexOf('>Khairo<');
  assert.ok(henry >= 0 && henry < warnAt && warnAt < khairo);
});

test('the warning never blocks: the approve, query and reject buttons stay on the claim line', () => {
  const html = C.renderOverviewCard(null, null, { showMoney: true, lines: rows(), linesState: 'ready', officeReview: true });
  assert.equal(count(html, HTML_WARNING), 2);
  const review = html.indexOf('data-office-line-review="19ca6478-d36f-43e7-a1d8-0d027c20b6dc"');
  assert.ok(review > 0);
  const block = html.slice(review, html.indexOf('</tr>', review));
  assert.match(block, /data-office-line-decision="approve"/);
  assert.doesNotMatch(block, /disabled/);
});

test('a render without money (not the office) shows no claim warning', () => {
  const html = C.renderOverviewCard(null, null, { lines: rows(), linesState: 'ready' });
  assert.equal(count(html, 'Labour on this job'), 0);
  assert.doesNotMatch(html, /data-job-wo-claim-warning/);
});

test('a clean job (no warning from the server) draws no warning row', () => {
  const html = C.renderOverviewCard(null, null, { showMoney: true, lines: rows({ warn: false }), linesState: 'ready' });
  assert.doesNotMatch(html, /data-job-wo-claim-warning/);
});

test('the warning survives the merge onto work-order lines that do not carry it', () => {
  const woLines = rows().map((r) => ({ trade_invoice_line_id: r.id, trade_name: r.trade_name, line_type: r.line_type, amount_ex: r.line_total_ex }));
  const merged = C.mergeCrewInvoiceLines(woLines, rows());
  const html = C.renderOverviewCard(null, null, { showMoney: true, lines: merged, linesState: 'ready' });
  assert.equal(count(html, HTML_WARNING), 2);
});

test('the warning text is escaped', () => {
  const list = rows();
  list[0].work_order_claim_warning = 'Check <b>who</b> did the work & approve.';
  const html = C.renderOverviewCard(null, null, { showMoney: true, lines: list, linesState: 'ready' });
  assert.match(html, /Check &lt;b&gt;who&lt;\/b&gt; did the work &amp; approve\./);
});
