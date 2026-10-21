// Job work order: the pure rules and HTML (docs/job-work-order-screens.md).
// ---------------------------------------------------------------------------
// Pure node, no browser: this spec READS ../../shared/job-work-order.js, takes the
// code between `// <job-work-order-core>` and `// </job-work-order-core>`, and runs
// it, so every assertion is against the shipped functions both apps load.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const SHARED = resolve(__dirname, '../../shared/job-work-order.js');
const OPEN = '// <job-work-order-core>';
const CLOSE = '// </job-work-order-core>';
const SOURCE = readFileSync(SHARED, 'utf8');

function extractCore() {
  const a = SOURCE.indexOf(OPEN);
  const b = SOURCE.indexOf(CLOSE);
  if (a < 0 || b < 0 || b <= a) throw new Error(`job-work-order-core sentinels not found in ${SHARED}`);
  // eslint-disable-next-line no-new-func
  return new Function(SOURCE.slice(a + OPEN.length, b) + '\n;return JobWorkOrderCore;')();
}

const C = extractCore();
const SHAUN = 'shaun@secureworkswa.com.au';

// The quote's own cost table, as the backend line builder is expected to write
// it: per-metre fencing as quoted, extras with hours, a lump "1 job" line with
// no hours (the captain's example), and a variation addendum.
function scopeItems() {
  return [
    { description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', kind: 'labour', rate: 35, rate_unit: 'm', total: 1316 },
    { description: 'Plinth install', qty: 21, unit: 'each', kind: 'labour', rate: 10, rate_unit: 'each', total: 210 },
    { description: 'Root removal / hard digging', qty: 2, unit: 'hrs', kind: 'labour', rate: 80, rate_unit: 'hr', total: 160 },
    { description: 'Root removal', qty: 1, unit: 'job', kind: 'labour', total: 250 },
    { description: 'Remove tree roots between 378/1 and 378/2', hours: 4, kind: 'labour', total: 320, variation_number: 1, variation_approved_at: '2026-10-14T02:00:00Z' },
  ];
}

function draftBlock(over) {
  return {
    work_order: Object.assign({
      id: 'wo-1', job_id: 'job-1', wo_number: 'WO-0042', kind: 'job', status: 'draft',
      scope_items: scopeItems(), special_instructions: 'Dog on site. Gate code 1234.',
      agreed_labour_ex: 2256, approved_at: null, updated_at: '2026-10-13T03:04:05.123456+00:00',
    }, over || {}),
    live_work_order_id: null,
    draft_work_order_id: 'wo-1',
    figures: { agreed_ex: null, billed_to_date_ex: 0, variations_ex: 0, variation_count: 0, billed_within_agreed_scope_ex: 0, remaining_ex: null, used_ratio: null, over_agreed: false, rules: [{ key: 'no_approved_work_order', level: 'info', message: 'No approved work order yet, so no labour counts against it.' }] },
    invoice_count: 0,
    variation_count: 0,
  };
}

function approvedBlock() {
  const b = draftBlock({ status: 'approved', approved_at: '2026-10-13T05:00:00Z' });
  b.live_work_order_id = 'wo-1';
  b.draft_work_order_id = null;
  b.figures = { agreed_ex: 2256, billed_to_date_ex: 2400, variations_ex: 0, variation_count: 0, billed_within_agreed_scope_ex: 2400, remaining_ex: -144, used_ratio: 1.0638, over_agreed: true, rules: [{ key: 'over_agreed', level: 'flag', message: 'Billed $2400.00 is over the agreed $2256.00.' }] };
  return b;
}

test.describe('Job work order core (extracted from shared/job-work-order.js)', () => {
  test('nothing the screens render holds a long dash or an emoji', () => {
    const detail = {
      work_order: draftBlock().work_order,
      figures: draftBlock().figures,
      labour_before_approval: { amount_ex: 432.5, line_count: 2, note: 'It links and counts when the work order is approved.' },
      variations: [{ id: 'v1', reported_by_name: 'Alyx', description: 'Extra roots', amount_ex: 300, counted: false, over_invoice_labour: true, created_at: '2026-10-12T01:00:00Z', corrected_at: '2026-10-12T03:00:00Z', original_description: 'Roots', original_amount_ex: 250 }],
    };
    const approvedRead = { work_order: approvedBlock().work_order };
    const outputs = [
      C.renderOpsPanel(draftBlock(), null, 'loading', { viewerEmail: SHAUN, preview: true }),
      C.renderOpsPanel(draftBlock(), detail, 'ready', { viewerEmail: SHAUN, busy: true, message: 'Approved and sealed.', messageLevel: 'ok' }),
      C.renderOpsPanel(draftBlock({ scope_items: [], agreed_labour_ex: null }), null, 'failed', { viewerEmail: SHAUN }),
      C.renderOpsPanel(approvedBlock(), detail, 'ready', { viewerEmail: SHAUN }),
      C.renderOpsPanel({ work_order: null }, null, 'idle', {}),
      C.renderOpsPanel({ unreadable: true }, null, 'idle', {}),
      C.renderOpsPanel({ work_order: null }, null, 'idle', { canOpen: true }),
      C.renderOpsPanel({ work_order: null }, null, 'idle', { canOpen: true, busy: true }),
      C.openedWords({ created: true, quote_fill: { reason: 'filled' } }),
      C.openedWords({ created: false, quote_fill: { reason: 'no_accepted_quote' } }),
      C.openedWords({ created: true, quote_fill: { reason: 'no_quote_lines' } }),
      C.openedWords({ created: true, quote_fill: null }),
      C.renderTrade(approvedRead, 'ready'),
      C.renderTrade({ work_order: Object.assign({}, approvedRead.work_order, { scope_items: [] }) }, 'ready'),
      C.renderTrade({ work_order: null }, 'ready'),
      C.renderTrade(null, 'loading'),
      C.renderTrade(null, 'failed'),
      C.invoiceNote(approvedRead),
      C.invoiceNote({ work_order: Object.assign({}, approvedRead.work_order, { scope_items: [{ description: 'Gate rehang', hours: 2 }] }) }),
    ];
    for (const block of [draftBlock(), approvedBlock()]) {
      const pdf = C.pdfSections(block);
      outputs.push(pdf.title, pdf.scopeHtml, pdf.costHtml);
    }
    for (const code of ['stale_review', 'expected_updated_at_required', 'approver_required', 'approver_identity_missing',
      'approver_not_set', 'terminal_approval_switched_off', 'work_order_not_ready', 'not_a_draft', 'work_order_not_found',
      'not_a_job_work_order', '']) {
      outputs.push(C.refusalWords(code, ''));
    }
    for (const code of ['job_type_not_eligible', 'work_order_sealed', 'draft_not_created', 'draft_not_updated', 'not_a_draft', '']) {
      outputs.push(C.openRefusalWords(code, ''));
    }
    for (const out of outputs) {
      expect(out).toBeTruthy();
      expect(out).not.toMatch(/[\u2013\u2014]/);
      expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  test('the trade hours view is still fencing and patio', () => {
    expect(C.eligibleType('fencing')).toBe(true);
    expect(C.eligibleType('Patio')).toBe(true);
    expect(C.eligibleType('makesafe')).toBe(false);
    expect(C.eligibleType('')).toBe(false);
  });

  test('Create work order goes to the job work order for every type, including while the old switch is off', () => {
    for (const type of ['fencing', 'Patio', 'repair', 'makesafe', 'decking', 'renovation', 'general', 'miscellaneous', '', null, undefined]) {
      expect(C.createRoute(type, true)).toBe('job');
      expect(C.createRoute(type, false)).toBe('job');
    }
    expect(C.createRoute()).toBe('job');
  });

  test('opening the draft: the button on a job with none yet, what it did, and its refusals in words', () => {
    const none = C.renderOpsPanel({ work_order: null }, null, 'idle', { canOpen: true });
    expect(none).toContain('data-job-wo-none');
    expect(none).toContain('Work order not filled yet');
    expect(none).toContain('it fills from the accepted quote');
    expect(none).toContain('JobWorkOrderOps.openDraft()');
    expect(none).toMatch(/data-job-wo-open onclick/);
    expect(C.renderOpsPanel({ work_order: null }, null, 'idle', { canOpen: true, busy: true })).toMatch(/data-job-wo-open disabled[^>]*>Opening\.\.\./);
    expect(C.renderOpsPanel({ work_order: null }, null, 'idle', {})).not.toContain('data-job-wo-open');
    // A job that has a work order, or one that could not be read, never offers it.
    expect(C.renderOpsPanel(draftBlock(), null, 'idle', { canOpen: true, viewerEmail: SHAUN })).not.toContain('data-job-wo-open');
    expect(C.renderOpsPanel({ unreadable: true }, null, 'idle', { canOpen: true })).not.toContain('data-job-wo-open');

    expect(C.openedWords({ created: true, quote_fill: { reason: 'filled' } })).toBe('Draft opened, filled from the accepted quote. Check it, then approve.');
    expect(C.openedWords({ created: false, quote_fill: { reason: 'no_accepted_quote' } })).toBe('The draft was already open. The job has no accepted quote to fill it from.');
    expect(C.openedWords({ created: true, quote_fill: { reason: 'no_quote_lines' } })).toContain('no labour lines');
    expect(C.openedWords({ created: true, quote_fill: null })).toBe('Draft opened.');
    expect(C.openedWords(null)).toBe('Draft opened.');

    expect(C.openRefusalWords('job_type_not_eligible', 'raw')).toBe('The draft could not be opened. This job type is not on the server yet.');
    expect(C.openRefusalWords('work_order_sealed', 'raw')).toContain('already approved and sealed');
    expect(C.openRefusalWords('something_new', 'Server words')).toBe('Server words');
    expect(C.openRefusalWords('', '')).toBe('The draft could not be opened.');
    expect(C.openRefusalNeedsReread('work_order_sealed')).toBe(true);
    expect(C.openRefusalNeedsReread('draft_not_created')).toBe(false);
  });

  test('a line priced in hours is its own hours; per metre stays as quoted; a lump job has no hours', () => {
    const [fence, plinth, roots, lump, variation] = scopeItems().map(C.lineOf);
    expect(fence).toMatchObject({ task: 'Install Colorbond fencing', qty: 37.6, unit: 'm', hours: null });
    expect(C.qtyWords(fence)).toBe('37.6 m');
    expect(C.needsHours(fence)).toBe(false);
    expect(C.qtyWords(plinth)).toBe('21 each');
    expect(C.needsHours(plinth)).toBe(false);
    expect(roots.hours).toBe(2);
    expect(C.qtyWords(roots)).toBe('');
    expect(C.needsHours(roots)).toBe(false);
    expect(lump.hours).toBe(null);
    expect(C.needsHours(lump)).toBe(true);
    expect(variation.hours).toBe(4);
    expect(variation.addendumKey).toBe('n:1');
    expect(C.lineOf({ description: 'Gate rehang', qty: '3', unit: 'hours' }).hours).toBe(3);
    expect(C.lineOf({ description: 'Post set', hours: '1.5', qty: 4, unit: 'each', notes: 'Corner first' }))
      .toMatchObject({ task: 'Post set', hours: 1.5, qty: 4, notes: 'Corner first' });
    expect(C.needsHours(C.lineOf({ description: 'Material', qty: 1, unit: 'job', kind: 'material' }))).toBe(false);
    // Only the backend contract's keys are read: no other spelling stands in for a field.
    expect(C.lineOf({ task: 'Gate', quantity: 3, units: 'hours', hrs: 2, total_ex: 500, allocation_ex: 500, rate_ex: 9, cost_per_hour: 9, note: 'x', variation: true }))
      .toMatchObject({ task: '', qty: null, unit: '', hours: null, allocationEx: null, rateEx: null, notes: '', addendumKey: '' });
  });

  test('variations are their own marked addenda; the approved lines are never mixed with one', () => {
    const items = scopeItems().concat([
      { description: 'Extra gate post', hours: 1, variation_number: 2 },
      { description: 'Second variation line', hours: 0.5, variation_number: 2 },
      { description: 'Labelled only', hours: 2, variation_label: 'Neighbour request' },
      { description: '' },
    ]);
    const g = C.groupLines(items);
    expect(g.base.map((l) => l.task)).toEqual(['Install Colorbond fencing', 'Plinth install', 'Root removal / hard digging', 'Root removal']);
    expect(g.addenda.map((a) => a.title)).toEqual(['Variation 1', 'Variation 2', 'Neighbour request']);
    expect(g.addenda[1].lines).toHaveLength(2);
    expect(C.hoursTotal(g.base)).toEqual({ hours: 2, without: 3 });
    expect(C.hoursTotal(g.addenda[1].lines)).toEqual({ hours: 1.5, without: 0 });
    expect(C.allocationTotal(g.base)).toBe(1936);
  });

  test('status, readiness and the approver', () => {
    expect(C.statusOf(null).key).toBe('not_applicable');
    expect(C.statusOf({ unreadable: true }).key).toBe('unreadable');
    expect(C.statusOf({ work_order: null }).key).toBe('none');
    expect(C.statusOf(draftBlock()).label).toBe('Draft, not approved');
    expect(C.statusOf(approvedBlock()).label).toBe('Approved and sealed');

    expect(C.missingForApproval(draftBlock().work_order)).toEqual([]);
    expect(C.missingForApproval({ agreed_labour_ex: null, scope_items: [], special_instructions: '' }))
      .toEqual(['the agreed labour', 'a task line or the special instructions']);
    expect(C.missingForApproval({ agreed_labour_ex: 0, scope_items: [], special_instructions: 'Build per quote' })).toEqual([]);

    expect(C.canApprove(draftBlock().work_order, SHAUN)).toBe(true);
    expect(C.canApprove(draftBlock().work_order, 'SHAUN@secureworkswa.com.au')).toBe(true);
    expect(C.canApprove(draftBlock().work_order, 'esther@secureworkswa.com.au')).toBe(false);
    expect(C.canApprove(approvedBlock().work_order, SHAUN)).toBe(false);
    expect(C.canApprove(draftBlock({ updated_at: null }).work_order, SHAUN)).toBe(false);
  });

  test('refusals read in words, and the ones that need a fresh read say so', () => {
    expect(C.refusalWords('stale_review', 'raw')).toMatch(/changed after it was read/);
    expect(C.refusalWords('approver_required')).toBe('Only Shaun approves job work orders.');
    expect(C.refusalWords('mystery', 'Server said no')).toBe('Server said no');
    expect(C.refusalWords('', '')).toBe('The work order could not be approved.');
    expect(C.refusalNeedsReread('stale_review')).toBe(true);
    expect(C.refusalNeedsReread('not_a_draft')).toBe(true);
    expect(C.refusalNeedsReread('approver_required')).toBe(false);
  });

  test('Ops panel: lines with qty, unit, hours and allocation, the figures, and Approve for Shaun only', () => {
    const shaun = C.renderOpsPanel(draftBlock(), null, 'loading', { viewerEmail: SHAUN });
    expect(shaun).toContain('WO-0042');
    expect(shaun).toContain('Draft, not approved');
    expect(shaun).toContain('37.6 m');
    expect(shaun).toContain('2 h');
    expect(shaun).toContain('No hours');
    expect(shaun).toContain('$1,316.00');
    expect(shaun).toContain('Variation 1');
    expect(shaun).toContain('Approved 14 Oct 2026');
    expect(shaun).toContain('Agreed labour (draft)');
    expect(shaun).toContain('$2,256.00');
    expect(shaun).toContain('data-job-wo-approve');
    expect(shaun).toContain('Dog on site');

    const esther = C.renderOpsPanel(draftBlock(), null, 'loading', { viewerEmail: 'esther@secureworkswa.com.au' });
    expect(esther).not.toContain('data-job-wo-approve');

    const notReady = C.renderOpsPanel(draftBlock({ agreed_labour_ex: null }), null, 'ready', { viewerEmail: SHAUN });
    expect(notReady).toMatch(/data-job-wo-approve disabled/);
    expect(notReady).toContain('Still needs the agreed labour');

    const approved = C.renderOpsPanel(approvedBlock(), null, 'ready', { viewerEmail: SHAUN });
    expect(approved).toContain('Approved and sealed');
    expect(approved).toContain('Approved 13 Oct 2026');
    expect(approved).not.toContain('data-job-wo-approve');
    expect(approved).toContain('Billed to date');
    expect(approved).toContain('$2,400.00');
    expect(approved).toContain('-$144.00');
    expect(approved).toContain('data-job-wo-rule="over_agreed"');
    expect(approved).not.toContain('no_approved_work_order');
  });

  test('Ops panel: empty draft, no work order, unreadable, and trade-reported variations', () => {
    const empty = C.renderOpsPanel(draftBlock({ scope_items: [], agreed_labour_ex: null }), null, 'ready', { viewerEmail: SHAUN });
    expect(empty).toContain('data-job-wo-no-lines');
    expect(empty).toContain('this draft has none so far');
    expect(C.renderOpsPanel({ work_order: null }, null, 'idle', {})).toContain('data-job-wo-none');
    expect(C.renderOpsPanel({ unreadable: true }, null, 'idle', {})).toContain('could not be read');
    expect(C.renderOpsPanel(null, null, 'idle', {})).toBe('');

    const detail = {
      work_order: draftBlock().work_order,
      figures: draftBlock().figures,
      labour_before_approval: { amount_ex: 432.5, line_count: 2, note: 'It links and counts when the work order is approved.' },
      variations: [{ id: 'v1', reported_by_name: 'Alyx', description: 'Extra roots', amount_ex: 300, counted: true, over_invoice_labour: true, created_at: '2026-10-12T01:00:00Z', corrected_at: null }],
    };
    const html = C.renderOpsPanel(draftBlock(), detail, 'ready', { viewerEmail: SHAUN });
    expect(html).toContain('Billed before approval');
    expect(html).toContain('$432.50');
    expect(html).toContain('Variations reported by trades');
    expect(html).toContain('Alyx');
    expect(html).toContain('More than the labour its invoice now bills');
  });

  test('Ops panel escapes what it prints', () => {
    const html = C.renderOpsPanel(draftBlock({ scope_items: [{ description: '<img src=x onerror=alert(1)>', hours: 1 }] }), null, 'ready', {});
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('PDF sections: the stored lines and the agreed labour, never a recomputed rate', () => {
    const d = C.pdfSections(draftBlock());
    expect(d.title).toBe('Work Order WO-0042');
    expect(d.scopeHtml).toContain('DRAFT');
    expect(d.scopeHtml).toContain('Root removal / hard digging');
    expect(d.scopeHtml).toContain('Variation 1');
    expect(d.scopeHtml).not.toContain('$');
    expect(d.costHtml).toContain('$1,316.00');
    expect(d.costHtml).toContain('Agreed labour (draft)');
    expect(d.costHtml).toContain('$2,256.00');
    const a = C.pdfSections(approvedBlock());
    expect(a.scopeHtml).not.toContain('DRAFT');
    expect(a.costHtml).toContain('Billed to date');
    expect(C.pdfSections({ work_order: null })).toBe(null);
  });

  test('trade view: tasks and hours only, no dollar figure even when a line carries money', () => {
    const read = { work_order: Object.assign({}, approvedBlock().work_order, { agreed_labour_ex: 2256 }) };
    const html = C.renderTrade(read, 'ready');
    expect(html).toContain('WO-0042');
    expect(html).toContain('Install Colorbond fencing');
    expect(html).toContain('37.6 m');
    expect(html).toContain('Root removal / hard digging');
    expect(html).toContain('2 h');
    expect(html).toContain('Variation 1');
    // Per-metre lines carry no hours, so the sum is named for what it covers.
    expect(html).toContain('Hours on hourly tasks');
    expect(html).not.toContain('$');
    for (const money of ['1316', '1,316', '2256', '2,256', '160', '320', '250']) expect(html).not.toContain(money);
    expect(C.renderTrade({ work_order: null, reason: 'no_approved_work_order' }, 'ready')).toContain('No approved work order');
    expect(C.renderTrade(null, 'loading')).toContain('Loading');
    expect(C.renderTrade(null, 'failed')).toContain('could not be loaded');
    expect(C.renderTrade({ work_order: Object.assign({}, read.work_order, { scope_items: [] }) }, 'ready')).toContain('data-trade-job-wo-no-lines');
  });

  test('invoice note names the work order and its hours, with no money', () => {
    const hourly = Object.assign({}, approvedBlock().work_order, { scope_items: [{ description: 'Gate rehang', hours: 2 }, { description: 'Roots', hours: 4, variation_number: 1 }] });
    expect(C.invoiceNote({ work_order: hourly })).toContain('(6 h of tasks)');
    const note = C.invoiceNote({ work_order: approvedBlock().work_order });
    expect(note).toContain('WO-0042');
    expect(note).not.toContain('of tasks');
    expect(note).toContain('Bill the hours you worked');
    expect(note).not.toContain('$');
    expect(C.invoiceNote({ work_order: null })).toBe('');
  });

  test('dates are Perth calendar dates whatever zone the process is in', () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/New_York', 'Australia/Perth']) {
        process.env.TZ = tz;
        expect(C.dateWords('2026-10-13T17:30:00Z')).toBe('14 Oct 2026');
        expect(C.dateWords('2026-10-13')).toBe('13 Oct 2026');
        expect(C.dateWords('2026-10-13 03:04:05.12+00')).toBe('13 Oct 2026');
      }
    } finally {
      process.env.TZ = saved;
    }
  });
});

// Customer variations (secureworks-backend docs/job-work-orders-v1.md,
// "Customer variations"): the office records one, Shaun approves it, and it
// joins the approved work order as a marked addendum. Fixtures follow the
// shapes the backend sends: the staff addenda[] carry lines[] and the money,
// the trade addenda[] carry scope_items[] and never any money.
function staffAddendum(over) {
  return Object.assign({
    id: 'cv-1', variation_number: 1, label: 'Variation 1 - approved 13 Oct 2026', approved_at: '2026-10-13T02:00:00Z',
    approved_by: 'user-shaun', description: 'Extra works the customer agreed on site',
    lines: [
      { line_key: 'variation:1:0', source: 'variation', is_variation: true, variation_number: 1, description: 'Remove tree roots between 378/1 and 378/2', qty: 4, unit: 'hrs', hours: 4 },
      { line_key: 'variation:1:1', source: 'variation', is_variation: true, variation_number: 1, description: 'Extend the fence along the side', qty: 6, unit: 'm', hours: 3 },
    ],
    hours_total: 7, trade_allocation_ex: 320, customer_price_ex: 921.6,
  }, over || {});
}

function approvedWithVariation() {
  const b = approvedBlock();
  b.work_order.scope_items = scopeItems().slice(0, 4);
  b.addenda = [staffAddendum()];
  b.customer_variations_open_count = 2;
  b.figures = {
    agreed_ex: 2256, customer_variations_ex: 320, customer_variations_price_ex: 921.6, customer_variation_count: 1,
    agreed_total_ex: 2576, billed_to_date_ex: 2400, variations_ex: 0, variation_count: 0, billed_within_agreed_scope_ex: 2400,
    remaining_ex: 176, used_ratio: 0.9317, over_agreed: false,
    rules: [{ key: 'has_customer_variations', level: 'info', message: '1 approved customer variation added to the agreed labour.' }],
  };
  return b;
}

const CV_UPDATED_AT = '2026-10-13T06:00:00.123456+00:00';
function customerVariations() {
  return [
    { id: 'cv-1', status: 'approved', variation_number: 1, label: 'Variation 1 - approved 13 Oct 2026', description: 'Extra works the customer agreed on site',
      tasks: [{ description: 'Remove tree roots between 378/1 and 378/2', hours: 4 }, { description: 'Extend the fence along the side', hours: 3, qty: 6, unit: 'm' }],
      hours_total: 7, trade_allocation_ex: 320, customer_price_ex: 921.6, created_at: '2026-10-12T02:00:00Z', updated_at: '2026-10-13T02:00:00Z', approved_at: '2026-10-13T02:00:00Z', invoice: null },
    { id: 'cv-2', status: 'draft', variation_number: null, label: null, description: 'Second gate', tasks: [{ description: 'Hang a second gate', hours: 2 }],
      hours_total: 2, trade_allocation_ex: 90, customer_price_ex: 250, created_at: '2026-10-13T06:00:00Z', updated_at: CV_UPDATED_AT },
    { id: 'cv-3', status: 'cancelled', variation_number: null, label: null, description: 'Paint the fence', tasks: [],
      hours_total: 0, trade_allocation_ex: null, customer_price_ex: null, created_at: '2026-10-11T06:00:00Z', updated_at: '2026-10-12T06:00:00Z',
      cancelled_at: '2026-10-12T06:00:00Z', cancel_reason: 'Customer changed their mind' },
    { id: 'cv-4', status: 'draft', description: 'Not priced yet', tasks: [{ description: 'Retaining wall', hours: 5 }],
      hours_total: 5, trade_allocation_ex: null, customer_price_ex: null, created_at: '2026-10-13T07:00:00Z', updated_at: '2026-10-13T07:00:00Z' },
  ];
}

function readWith(block, list) {
  return { work_order: block.work_order, figures: block.figures, addenda: block.addenda || [], customer_variations: list, variations: [] };
}

test.describe('Customer variations on the job work order (core)', () => {
  test('backend addenda become marked addenda under the approved lines; money only for the office', () => {
    const office = C.addendaOf([staffAddendum()], { money: true });
    expect(office).toHaveLength(1);
    expect(office[0]).toMatchObject({ number: 1, title: 'Variation 1 - approved 13 Oct 2026', description: 'Extra works the customer agreed on site', tradeAllocationEx: 320, customerPriceEx: 921.6, fromServer: true });
    expect(office[0].lines.map((l) => [l.task, l.hours, C.qtyWords(l), l.isVariation])).toEqual([
      ['Remove tree roots between 378/1 and 378/2', 4, '', true],
      ['Extend the fence along the side', 3, '6 m', true],
    ]);
    // Without opts.money no money field is read, even if one is sent.
    const trade = C.addendaOf([Object.assign(staffAddendum(), { scope_items: [{ description: 'x', hours: 1, total: 99, rate: 9, rate_unit: 'hr' }], lines: [] })]);
    expect(trade[0].tradeAllocationEx).toBeUndefined();
    expect(trade[0].customerPriceEx).toBeUndefined();
    expect(trade[0].lines[0].allocationEx).toBe(null);

    // A server addendum replaces an inline group with the same number and the order is by number.
    const g = C.groupLines(scopeItems(), C.addendaOf([staffAddendum({ variation_number: 2, label: 'Variation 2 - approved 14 Oct 2026' }), staffAddendum()]));
    expect(g.addenda.map((a) => a.title)).toEqual(['Variation 1 - approved 13 Oct 2026', 'Variation 2 - approved 14 Oct 2026']);
    expect(g.base.map((l) => l.task)).not.toContain('Remove tree roots between 378/1 and 378/2');
  });

  test('Ops panel: approved variations are addenda after the original lines, and the figures use the agreed total', () => {
    const block = approvedWithVariation();
    const html = C.renderOpsPanel(block, readWith(block, customerVariations()), 'ready', { viewerEmail: SHAUN });
    const lastBase = html.indexOf('Root removal</td>');
    const addendum = html.indexOf('data-job-wo-addendum');
    expect(lastBase).toBeGreaterThan(0);
    expect(addendum).toBeGreaterThan(lastBase);
    expect(html).toContain('Variation 1 - approved 13 Oct 2026');
    expect(html).toContain('Extra works the customer agreed on site');
    expect(html).toContain('Remove tree roots between 378/1 and 378/2');
    expect(html).toContain('6 m');
    expect(html).toContain('7 h');
    expect(html).toContain('Trade allocation $320.00 · Customer price $921.60 ex GST');
    expect(html).toContain('Approved variations');
    expect(html).toContain('data-job-wo-agreed-total');
    expect(html).toContain('$2,576.00');
    expect(html).toContain('$176.00');
    expect(html).toContain('data-job-wo-rule="has_customer_variations"');

    // Variations without an agreed total read Not set, never the agreed labour.
    const noTotal = approvedWithVariation();
    delete noTotal.figures.agreed_total_ex;
    const unset = C.renderOpsPanel(noTotal, readWith(noTotal, customerVariations()), 'ready', { viewerEmail: SHAUN });
    expect(unset).toMatch(/data-job-wo-agreed-total><div class="jwo-fig-k">Agreed total<\/div><div class="jwo-fig-v">Not set</);

    // No variations: no agreed total cell, the figures stay as before.
    const plain = C.renderOpsPanel(approvedBlock(), null, 'ready', { viewerEmail: SHAUN });
    expect(plain).not.toContain('data-job-wo-agreed-total');
  });

  test('Ops panel: the customer variations list, with edit, approve (approver only) and cancel on drafts', () => {
    const block = approvedWithVariation();
    const html = C.renderOpsPanel(block, readWith(block, customerVariations()), 'ready', { viewerEmail: SHAUN, cv: {} });
    expect(html).toContain('data-job-wo-cv');
    expect((html.match(/data-job-wo-cv-row/g) || [])).toHaveLength(4);
    expect(html).toContain('data-cv-id="cv-2" data-cv-status="draft"');
    expect(html).toContain('data-cv-id="cv-3" data-cv-status="cancelled"');
    expect(html).toContain('Cancelled 12 Oct 2026: Customer changed their mind');
    expect(html).toContain('Trade allocation $90.00 · Customer price $250.00 ex GST');
    // cv-2 can be approved; cv-4 is held with the reason.
    expect(html).toMatch(/data-job-wo-cv-approve data-cv-id="cv-2"\s+onclick/);
    expect(html).toMatch(/data-job-wo-cv-approve data-cv-id="cv-4" disabled/);
    expect(html).toContain('Still needs the trade allocation, the customer price.');
    expect(html).toContain('data-job-wo-cv-edit data-cv-id="cv-2"');
    expect(html).toContain('data-job-wo-cv-cancel data-cv-id="cv-2"');
    expect(html).not.toContain('data-job-wo-cv-edit data-cv-id="cv-1"');
    expect(html).toContain('data-job-wo-cv-add');
    // The approved one offers the invoice line preview, and nothing that makes a Xero draft.
    expect(html).toContain('data-job-wo-cv-invoice-line data-cv-id="cv-1"');
    expect(html).not.toMatch(/xero_draft|Create (the )?Xero|create_customer_variation_xero_draft/i);

    const esther = C.renderOpsPanel(block, readWith(block, customerVariations()), 'ready', { viewerEmail: 'esther@secureworkswa.com.au' });
    expect(esther).not.toContain('data-job-wo-cv-approve');
    expect(esther).toContain('data-job-wo-cv-edit data-cv-id="cv-2"');

    // On a draft work order a variation cannot be approved yet, and says why.
    const draft = draftBlock();
    const onDraft = C.renderOpsPanel(draft, readWith(draft, customerVariations().slice(1, 2)), 'ready', { viewerEmail: SHAUN });
    expect(onDraft).toMatch(/data-job-wo-cv-approve data-cv-id="cv-2" disabled/);
    expect(onDraft).toContain('Approve the work order first');

    // Loading and failed reads say so.
    expect(C.renderOpsPanel(block, null, 'loading', {})).toContain('Loading the variations (2 recorded)');
    expect(C.renderOpsPanel(block, null, 'failed', {})).toContain('data-job-wo-cv-failed');
  });

  test('Ops panel: the form, the confirm rows and the invoice line preview', () => {
    const block = approvedWithVariation();
    const read = readWith(block, customerVariations());
    const create = C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { form: { mode: 'create', values: C.customerVariationFormValues(null), errors: ['Describe the variation.'] } } });
    expect(create).toContain('data-job-wo-cv-form="create"');
    expect(create).toContain('Describe the variation.');
    expect(create).toContain('Save draft variation');
    expect(create).not.toContain('data-job-wo-cv-add ');

    const edit = C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { form: { mode: 'edit', id: 'cv-2', values: C.customerVariationFormValues(customerVariations()[1]), errors: [] } } });
    expect(edit).toContain('data-job-wo-cv-form="edit"');
    expect(edit).toContain('value="Hang a second gate"');
    expect(edit).toContain('value="90"');
    expect(edit).toContain('Save changes');

    const approve = C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { confirm: { kind: 'approve', id: 'cv-2' } } });
    expect(approve).toContain('data-job-wo-cv-confirm="approve"');
    expect(approve).toContain('It joins WO-0042 as the next numbered addendum');
    const cancel = C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { confirm: { kind: 'cancel', id: 'cv-2' } } });
    expect(cancel).toContain('data-job-wo-cv-cancel-reason');

    const prepared = {
      customer_variation_id: 'cv-1',
      line: { description: 'Variation 1 - approved 13 Oct 2026: Extra works the customer agreed on site\n- Remove tree roots between 378/1 and 378/2', quantity: 1, unit_price: 921.6, account_code: '200' },
      invoice: { status: 'prepared' },
      create_invoice_draft: { job_id: 'job-1', line_items: [], reference: 'SWF-26904 Variation 1' },
      xero_draft_switched_on: false,
    };
    const preview = C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { previews: { 'cv-1': prepared } } });
    expect(preview).toContain('data-job-wo-cv-invoice-preview');
    expect(preview).toContain('$921.60');
    expect(preview).toContain('Reference SWF-26904 Variation 1');
    expect(preview).toContain('Preview only: nothing is sent to Xero from here.');
    expect(preview).not.toContain('data-job-wo-cv-invoice-line data-cv-id="cv-1"');
    // Even with the backend switch on, this screen offers no Xero draft.
    const switchedOn = C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { previews: { 'cv-1': Object.assign({}, prepared, { xero_draft_switched_on: true }) } } });
    expect(switchedOn).not.toMatch(/Create (the )?Xero|create_customer_variation_xero_draft/i);

    // A kept invoice line shows without a new prepare; a zero price has none.
    const kept = customerVariations();
    kept[0].invoice = { status: 'prepared', line: prepared.line };
    expect(C.renderOpsPanel(block, readWith(block, kept), 'ready', {})).toContain('data-job-wo-cv-invoice-preview');
    kept[0].customer_price_ex = 0;
    expect(C.renderOpsPanel(block, readWith(block, kept), 'ready', {})).toContain('data-job-wo-cv-no-charge');
  });

  test('form values are checked in words before anything is sent', () => {
    const ok = C.customerVariationFields({
      description: '  Extra roots  ',
      tasks: [{ description: 'Remove roots', hours: '4', qty: '', unit: '' }, { description: 'Extend fence', hours: '3', qty: '6', unit: 'm' }, { description: '', hours: '', qty: '', unit: '' }],
      trade_allocation_ex: '$1,320', customer_price_ex: '921.6',
    });
    expect(ok.errors).toEqual([]);
    expect(ok.fields).toEqual({
      description: 'Extra roots',
      tasks: [{ description: 'Remove roots', hours: 4 }, { description: 'Extend fence', hours: 3, qty: 6, unit: 'm' }],
      trade_allocation_ex: 1320, customer_price_ex: 921.6,
    });
    // Empty amounts are null: a draft may be saved without them.
    expect(C.customerVariationFields({ description: 'x', tasks: [], trade_allocation_ex: '', customer_price_ex: '' }).fields)
      .toMatchObject({ tasks: [], trade_allocation_ex: null, customer_price_ex: null });
    const bad = C.customerVariationFields({
      description: 'Costs $300',
      tasks: [{ description: '', hours: '2' }, { description: 'Dig', hours: '0' }, { description: 'Fence', hours: '1', qty: '6', unit: '' }, { description: 'Paint $50', hours: '1' }],
      trade_allocation_ex: 'abc', customer_price_ex: '-5',
    });
    expect(bad.errors).toEqual([
      'Leave prices out of the description: trades read it.',
      'Task 1 needs its words.',
      'Task 2 needs the hours it takes (more than 0).',
      'Task 3: give a quantity with its unit (for example 6 and m), or neither.',
      'Leave prices out of task 4: trades read it.',
      'The trade allocation must be a dollar amount of zero or more, ex GST.',
      'The customer price must be a dollar amount of zero or more, ex GST.',
    ]);
    expect(C.customerVariationFields({ description: '', tasks: [] }).errors).toEqual(['Describe the variation.']);
    expect(C.customerVariationFormValues(null).tasks).toHaveLength(1);
  });

  test('status, readiness, approver and refusal words for a customer variation', () => {
    const [approved, draft, cancelled, unpriced] = customerVariations();
    expect(C.customerVariationStatus(approved)).toEqual({ key: 'approved', label: 'Variation 1 - approved 13 Oct 2026' });
    expect(C.customerVariationStatus(draft).label).toBe('Draft, not approved');
    expect(C.customerVariationStatus(cancelled).label).toBe('Cancelled');
    expect(C.customerVariationMissing(draft)).toEqual([]);
    expect(C.customerVariationMissing(unpriced)).toEqual(['the trade allocation', 'the customer price']);
    expect(C.customerVariationMissing({ tasks: [], trade_allocation_ex: 0, customer_price_ex: 0 })).toEqual(['a task with its hours']);
    expect(C.canApproveCustomerVariation(draft, SHAUN)).toBe(true);
    expect(C.canApproveCustomerVariation(draft, 'esther@secureworkswa.com.au')).toBe(false);
    expect(C.canApproveCustomerVariation(approved, SHAUN)).toBe(false);
    expect(C.customerVariationApproveHold(draft, approvedBlock().work_order)).toBe('');
    expect(C.customerVariationApproveHold(draft, draftBlock().work_order)).toMatch(/Approve the work order first/);
    expect(C.customerVariationRefusalWords('stale_review')).toMatch(/changed after it was read/);
    expect(C.customerVariationRefusalWords('work_order_not_approved')).toMatch(/Approve the work order first/);
    expect(C.customerVariationRefusalWords('mystery', 'Server said no')).toBe('Server said no');
    expect(C.customerVariationNeedsReread('stale_review')).toBe(true);
    expect(C.customerVariationNeedsReread('variation_sealed')).toBe(true);
    expect(C.customerVariationNeedsReread('money_in_text')).toBe(false);
  });

  test('PDF: approved variations print as marked addenda, hours in the scope, the allocation only in the cost breakdown', () => {
    const p = C.pdfSections(approvedWithVariation());
    expect(p.scopeHtml).toContain('ADDENDUM: Variation 1 - approved 13 Oct 2026');
    expect(p.scopeHtml).toContain('Extra works the customer agreed on site');
    expect(p.scopeHtml).toContain('Remove tree roots between 378/1 and 378/2');
    expect(p.scopeHtml).toContain('4 h');
    expect(p.scopeHtml.indexOf('ADDENDUM')).toBeGreaterThan(p.scopeHtml.indexOf('Root removal'));
    expect(p.scopeHtml).not.toContain('$');
    expect(p.costHtml).toContain('Trade allocation for this variation');
    expect(p.costHtml).toContain('$320.00');
    expect(p.costHtml).toContain('Approved variations (1)');
    expect(p.costHtml).toContain('Agreed total');
    expect(p.costHtml).toContain('$2,576.00');
    // The customer's price is not on the work order.
    expect(p.costHtml).not.toContain('921');
  });

  test('trade view: variation lines are marked, with hours, and no dollar figure for anyone', () => {
    const wo = Object.assign({}, approvedBlock().work_order, {
      scope_items: scopeItems().slice(0, 3).map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, hours: l.unit === 'hrs' ? l.qty : null })),
      addenda: [{
        variation_number: 1, label: 'Variation 1 - approved 13 Oct 2026', approved_at: '2026-10-13T02:00:00Z',
        description: 'Extra works the customer agreed on site',
        // Money smuggled onto an addendum is never read by the trade view.
        trade_allocation_ex: 320, customer_price_ex: 921.6,
        scope_items: [
          { description: 'Remove tree roots between 378/1 and 378/2', qty: 4, unit: 'hrs', hours: 4, is_variation: true, variation_number: 1, total: 320, rate: 80, rate_unit: 'hr' },
          { description: 'Extend the fence along the side', qty: 6, unit: 'm', hours: 3, is_variation: true, variation_number: 1 },
        ],
      }],
    });
    const html = C.renderTrade({ work_order: wo }, 'ready');
    expect(html).toContain('data-trade-job-wo-addendum data-variation-number="1"');
    expect(html).toContain('Variation 1 - approved 13 Oct 2026');
    expect(html).toContain('Extra works the customer agreed on site');
    expect((html.match(/data-trade-job-wo-variation-line/g) || [])).toHaveLength(2);
    expect(html).toContain('<span class="two-var-tag">Variation</span>Remove tree roots');
    expect(html).toContain('4 h');
    expect(html).toContain('3 h');
    expect(html).toContain('6 m');
    expect(html.indexOf('data-trade-job-wo-addendum')).toBeGreaterThan(html.indexOf('Plinth install'));
    expect(html).not.toContain('$');
    for (const money of ['320', '921']) expect(html).not.toContain(money);
    // The invoice note counts the variation's hours with the rest.
    const hourly = Object.assign({}, wo, { scope_items: [{ description: 'Gate rehang', hours: 2 }] });
    expect(C.invoiceNote({ work_order: hourly })).toContain('(9 h of tasks)');
  });

  test('nothing the variation screens render holds a long dash or an emoji', () => {
    const block = approvedWithVariation();
    const read = readWith(block, customerVariations());
    const outputs = [
      C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { message: 'Variation saved.', level: 'ok' } }),
      C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { form: { mode: 'create', values: C.customerVariationFormValues(null), errors: ['x'] } } }),
      C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { confirm: { kind: 'approve', id: 'cv-2' } } }),
      C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { confirm: { kind: 'cancel', id: 'cv-2' } } }),
      C.renderOpsPanel(block, null, 'failed', {}),
      C.pdfSections(block).scopeHtml,
      C.pdfSections(block).costHtml,
      C.renderTrade({ work_order: Object.assign({}, block.work_order, { addenda: [staffAddendum()] }) }, 'ready'),
    ];
    for (const code of ['stale_review', 'expected_updated_at_required', 'variation_sealed', 'not_a_draft', 'work_order_not_approved',
      'variation_not_ready', 'approver_required', 'approver_identity_missing', 'approver_not_set', 'terminal_approval_switched_off',
      'actor_identity_missing', 'job_type_not_eligible', 'money_in_text', 'invalid_tasks', 'invalid_description', 'nothing_to_update',
      'customer_variation_not_found', 'variation_not_approved', 'no_customer_charge', '']) {
      outputs.push(C.customerVariationRefusalWords(code, ''));
    }
    for (const out of outputs) {
      expect(out).toBeTruthy();
      expect(out).not.toMatch(/[–—]/);
      expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

// The quote line builder's real line shape (secureworks-backend
// docs/quote-work-order-lines-v1.md, quote_work_order_lines.ts): rate,
// rate_unit and total, with counted saying whether the quote's labour figure
// is made of the line. Shaped from SWF-26904 and SWF-261527.
function backendQuoteLines() {
  return [
    { line_key: 'install:0', source: 'quote', basis: 'fence_install', description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', hours: null, rate: 35, rate_unit: 'm', total: 1316, counted: true, flags: [], needs_review: false },
    { line_key: 'plinths', source: 'quote', basis: 'fence_plinths', description: 'Plinth install', qty: 21, unit: 'each', hours: null, rate: 10, rate_unit: 'each', total: 210, counted: true, flags: [], needs_review: false },
    { line_key: 'access', source: 'quote', basis: 'fence_access', description: 'Moderate site access, extra time on the install', qty: 1, unit: 'lot', hours: null, rate: 10, rate_unit: 'pct', total: null, counted: false, flags: ['labour_split_unverified'], needs_review: true },
    { line_key: 'removal:3', source: 'quote', basis: 'removal', description: 'Remove old timber fence', qty: 15, unit: 'm', hours: null, rate: 10, rate_unit: 'm', total: 150, counted: false, flags: ['quote_counted_as_materials'], needs_review: false },
    { line_key: 'extra:5', source: 'quote', basis: 'quote_extra', description: 'Root removal / hard digging', qty: 2, unit: 'hrs', hours: 2, rate: 80, rate_unit: 'hr', total: 160, counted: false, flags: ['saved_as_material', 'outside_quote_labour'], needs_review: true },
  ];
}

test.describe('Quote lines as the backend sends them (core)', () => {
  test('the office allocation and rate come from total, rate and rate_unit; lines outside the agreed labour are named and left out of the total', () => {
    const l = C.lineOf(backendQuoteLines()[0]);
    expect(l).toMatchObject({ allocationEx: 1316, rateEx: 35, rateUnit: 'm', counted: true });
    expect(C.rateWords(l)).toBe('$35.00/m');
    expect(C.rateWords(C.lineOf(backendQuoteLines()[4]))).toBe('$80.00/h');
    expect(C.rateWords(C.lineOf(backendQuoteLines()[2]))).toBe('10%');
    const lines = backendQuoteLines().map(C.lineOf);
    // The counted lines are the quote's own labour figure (37.6 m x $35 + 21 x $10).
    expect(C.allocationTotal(lines)).toBe(1526);

    const block = draftBlock({ scope_items: backendQuoteLines(), agreed_labour_ex: 1526 });
    const html = C.renderOpsPanel(block, null, 'ready', { viewerEmail: SHAUN });
    expect(html).toContain('<th class="r">Allocation</th>');
    expect(html).toContain('$1,316.00');
    expect(html).toContain('$35.00/m');
    expect(html).toContain('$210.00');
    expect(html).toContain('$10.00/each');
    expect(html).toContain('$80.00/h');
    expect(html).toContain('10%');
    expect((html.match(/data-job-wo-not-counted/g) || [])).toHaveLength(2);
    expect(html).toContain('$1,526.00');

    const pdf = C.pdfSections(block);
    expect(pdf.costHtml).toContain('$1,316.00');
    expect(pdf.costHtml).toContain('Not in the agreed labour');
    expect(pdf.scopeHtml).not.toContain('$');
  });

  test('office only: the trade view of the same lines shows no rate, no allocation and no dollar figure', () => {
    const wo = Object.assign({}, approvedBlock().work_order, { scope_items: backendQuoteLines() });
    const html = C.renderTrade({ work_order: wo }, 'ready');
    expect(html).toContain('Install Colorbond fencing');
    expect(html).toContain('37.6 m');
    expect(html).toContain('2 h');
    expect(html).not.toContain('$');
    expect(html).not.toContain('%');
    for (const money of ['1316', '1,316', '210.00', '160', '150', '35.00', '80.00', '10%']) expect(html).not.toContain(money);
  });
});

// A stuck Xero draft record (secureworks-backend docs/job-work-orders-v1.md,
// "A stuck Xero draft record"), on the job work order panel: an approved
// variation's invoice record in 'unknown', or in 'creating' for 15 minutes,
// is answered for by the approver after checking Xero by hand.
const XERO_ID = '0f8e2c1a-3b4d-4e5f-8a9b-1c2d3e4f5a6b';
const STUCK_REQUESTED_AT = '2026-10-15T02:00:00.000Z'; // 10:00 am Perth
const STUCK_UPDATED_AT = '2026-10-15T02:00:01.234567+00:00';

function stuckInvoice(status, over) {
  return Object.assign({
    status, line: { description: 'Variation 1 - approved 13 Oct 2026: Extra works', quantity: 1, unit_price: 921.6, account_code: '200' },
    xero_requested_at: STUCK_REQUESTED_AT, xero_invoice_id: null, invoice_number: null, failure: null, updated_at: STUCK_UPDATED_AT,
  }, over || {});
}

function withStuck(invoice) {
  const list = customerVariations();
  list[0] = Object.assign({}, list[0], { invoice });
  return list;
}

const MIN = 60 * 1000;
const REQUESTED_MS = Date.parse(STUCK_REQUESTED_AT);

test.describe('A stuck Xero draft record (core)', () => {
  test('stuck is unknown at once, and creating only once its claim is 15 minutes old', () => {
    expect(C.xeroDraftStuck(null, REQUESTED_MS)).toBeNull();
    expect(C.xeroDraftStuck(stuckInvoice('prepared'), REQUESTED_MS)).toBeNull();
    expect(C.xeroDraftStuck(stuckInvoice('xero_draft_created'), REQUESTED_MS)).toBeNull();
    expect(C.xeroDraftStuck(stuckInvoice('unknown'), REQUESTED_MS + MIN)).toMatchObject({ status: 'unknown', answerable: true });
    expect(C.xeroDraftStuck(stuckInvoice('creating'), REQUESTED_MS + 14 * MIN)).toMatchObject({ status: 'creating', answerable: false, answerableAt: REQUESTED_MS + 15 * MIN });
    expect(C.xeroDraftStuck(stuckInvoice('creating'), REQUESTED_MS + 15 * MIN)).toMatchObject({ status: 'creating', answerable: true });
    // A claim with no time on it is never taken as old enough.
    expect(C.xeroDraftStuck(stuckInvoice('creating', { xero_requested_at: null }), REQUESTED_MS + 60 * MIN)).toMatchObject({ answerable: false });
    expect(C.canReconcileXeroDraft(stuckInvoice('unknown'), SHAUN, REQUESTED_MS)).toBe(true);
    expect(C.canReconcileXeroDraft(stuckInvoice('unknown'), 'esther@secureworkswa.com.au', REQUESTED_MS)).toBe(false);
    expect(C.canReconcileXeroDraft(stuckInvoice('unknown', { updated_at: null }), SHAUN, REQUESTED_MS)).toBe(false);
    expect(C.canReconcileXeroDraft(stuckInvoice('creating'), SHAUN, REQUESTED_MS + 5 * MIN)).toBe(false);
  });

  test('the Xero invoice id is read from the id itself or from the draft link in Xero', () => {
    expect(C.xeroInvoiceIdFrom(XERO_ID)).toBe(XERO_ID);
    expect(C.xeroInvoiceIdFrom(' ' + XERO_ID.toUpperCase() + ' ')).toBe(XERO_ID);
    expect(C.xeroInvoiceIdFrom('https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=' + XERO_ID)).toBe(XERO_ID);
    expect(C.xeroInvoiceIdFrom('https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' + XERO_ID.toUpperCase() + '&foo=1')).toBe(XERO_ID);
    // Any other text with an id in it is not the invoice's id.
    expect(C.xeroInvoiceIdFrom('https://go.xero.com/Contacts/View/' + XERO_ID)).toBe('');
    expect(C.xeroInvoiceIdFrom('https://go.xero.com/Contacts/View.aspx?contactID=' + XERO_ID)).toBe('');
    expect(C.xeroInvoiceIdFrom('Invoice ' + XERO_ID)).toBe('');
    expect(C.xeroInvoiceIdFrom(XERO_ID + 'a')).toBe('');
    expect(C.xeroInvoiceIdFrom('https://go.xero.com/Edit.aspx?InvoiceID=' + XERO_ID + '0')).toBe('');
    expect(C.xeroInvoiceIdFrom('INV-0123')).toBe('');
    expect(C.xeroInvoiceIdFrom('')).toBe('');
  });

  test('the dialog answer: found (id required, number optional) or none, always after checking Xero', () => {
    expect(C.xeroReconcileFields({ outcome: 'draft_exists', invoiceId: 'https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=' + XERO_ID, invoiceNumber: ' INV-0123 ', checked: true }))
      .toEqual({ fields: { outcome: 'draft_exists', xero_invoice_id: XERO_ID, invoice_number: 'INV-0123' }, errors: [] });
    expect(C.xeroReconcileFields({ outcome: 'draft_exists', invoiceId: XERO_ID, invoiceNumber: '', checked: true }).fields)
      .toEqual({ outcome: 'draft_exists', xero_invoice_id: XERO_ID });
    expect(C.xeroReconcileFields({ outcome: 'no_draft', invoiceId: XERO_ID, invoiceNumber: 'INV-1', checked: true }))
      .toEqual({ fields: { outcome: 'no_draft' }, errors: [] });
    expect(C.xeroReconcileFields({ outcome: 'draft_exists', invoiceId: '', checked: true }).errors).toEqual(['Paste the Xero invoice id, or the link to the draft in Xero.']);
    expect(C.xeroReconcileFields({ outcome: 'draft_exists', invoiceId: 'INV-0123', checked: true }).errors[0]).toMatch(/not a Xero invoice id/);
    const contact = C.xeroReconcileFields({ outcome: 'draft_exists', invoiceId: 'https://go.xero.com/Contacts/View/' + XERO_ID, checked: true });
    expect(contact.fields).toBeNull();
    expect(contact.errors[0]).toMatch(/not a Xero invoice id/);
    expect(C.xeroReconcileFields({ outcome: 'draft_exists', invoiceId: XERO_ID, invoiceNumber: 'x'.repeat(51), checked: true }).errors).toEqual(['The invoice number is longer than 50 characters.']);
    expect(C.xeroReconcileFields({ outcome: 'no_draft', checked: false })).toEqual({ fields: null, errors: ['Tick that you checked Xero by hand first.'] });
    expect(C.xeroReconcileFields({ outcome: '', checked: true }).errors).toEqual(['Say what you found in Xero.']);
  });

  test('refusals read in words; the ones that mean the record moved read it again', () => {
    expect(C.xeroReconcileRefusalWords('xero_invoice_already_recorded')).toMatch(/already recorded for another variation/);
    expect(C.xeroReconcileRefusalWords('xero_draft_in_progress')).toMatch(/less than 15 minutes ago/);
    expect(C.xeroReconcileRefusalWords('mystery', 'Server said no')).toBe('Server said no');
    expect(C.xeroReconcileRefusalWords('', '')).toBe('The answer could not be saved. Nothing changed.');
    for (const code of ['nothing_to_reconcile', 'xero_draft_already_recorded', 'xero_draft_in_progress', 'stale_review', 'expected_updated_at_required', 'invoice_line_not_found']) {
      expect(C.xeroReconcileNeedsReread(code)).toBe(true);
    }
    for (const code of ['xero_invoice_already_recorded', 'invalid_request', 'approver_required', '']) expect(C.xeroReconcileNeedsReread(code)).toBe(false);
    expect(C.xeroReconcileDoneWords('draft_exists', { invoice: { invoice_number: 'INV-0123' }, duplicate: false })).toBe('Recorded: INV-0123 is this variation\'s Xero draft. Nothing was sent to Xero or the customer.');
    expect(C.xeroReconcileDoneWords('draft_exists', { invoice: { invoice_number: 'INV-0123' }, duplicate: true })).toMatch(/already recorded/);
    expect(C.xeroReconcileDoneWords('no_draft', { invoice: { status: 'prepared' } })).toMatch(/^Released: the line is back to prepared/);
  });

  test('the panel: stuck states in words, the button for the approver only', () => {
    const block = approvedWithVariation();
    const panel = (invoice, email, now, extra) => C.renderOpsPanel(block, readWith(block, withStuck(invoice)), 'ready',
      { viewerEmail: email, cv: Object.assign({ now }, extra || {}) });

    const unknown = panel(stuckInvoice('unknown', { failure: 'Xero timed out' }), SHAUN, REQUESTED_MS + MIN);
    expect(unknown).toContain('data-job-wo-cv-xero-stuck="unknown"');
    expect(unknown).toContain('Xero draft not confirmed');
    expect(unknown).toContain('Xero did not confirm whether the draft for this line was made (asked for 15 Oct 2026, 10:00 am)');
    expect(unknown).toContain('What went wrong: Xero timed out');
    expect(unknown).toMatch(/data-job-wo-cv-xero-open data-cv-id="cv-1" onclick/);

    const office = panel(stuckInvoice('unknown'), 'esther@secureworkswa.com.au', REQUESTED_MS + MIN);
    expect(office).toContain('Xero draft not confirmed');
    expect(office).not.toContain('data-job-wo-cv-xero-open');
    expect(office).toContain('Only Shaun records what Xero shows, after checking it by hand.');

    const young = panel(stuckInvoice('creating'), SHAUN, REQUESTED_MS + 5 * MIN);
    expect(young).toContain('Xero draft being made');
    expect(young).toContain('If it still says this after 15 Oct 2026, 10:15 am, check Xero');
    expect(young).not.toContain('data-job-wo-cv-xero-open');

    const old = panel(stuckInvoice('creating'), SHAUN, REQUESTED_MS + 20 * MIN);
    expect(old).toContain('Xero draft stuck');
    expect(old).toContain('never finished');
    expect(old).toContain('data-job-wo-cv-xero-open');

    expect(panel(stuckInvoice('prepared'), SHAUN, REQUESTED_MS)).not.toContain('data-job-wo-cv-xero-stuck');
  });

  test('the dialog: both answers, the fields that go with each, and the press held until Xero was checked', () => {
    const block = approvedWithVariation();
    const read = readWith(block, withStuck(stuckInvoice('unknown')));
    const dialog = (over) => C.renderOpsPanel(block, read, 'ready', { viewerEmail: SHAUN, cv: { now: REQUESTED_MS, xero: Object.assign({ id: 'cv-1', outcome: '', invoiceId: '', invoiceNumber: '', checked: false, errors: [] }, over || {}) } });

    const blank = dialog();
    expect(blank).toContain('role="dialog"');
    expect(blank).toContain('What does Xero show?');
    expect(blank).toContain('This screen never calls Xero');
    expect(blank).toMatch(/data-job-wo-cv-xero-submit disabled/);
    expect(blank).not.toContain('data-cv-xero-f="invoiceId"');
    // The open button is held while its dialog is open.
    expect(blank).toMatch(/data-job-wo-cv-xero-open data-cv-id="cv-1" disabled/);

    const found = dialog({ outcome: 'draft_exists', invoiceId: XERO_ID, checked: true });
    expect(found).toContain('data-cv-xero-f="invoiceId"');
    expect(found).toContain('Record this Xero draft');
    expect(found).toContain('Nothing is sent to Xero or the customer.');
    expect(found).not.toMatch(/data-job-wo-cv-xero-submit disabled/);

    const none = dialog({ outcome: 'no_draft', checked: false, errors: ['Tick that you checked Xero by hand first.'] });
    expect(none).toContain('Release the line');
    expect(none).toContain('making it again puts a second one there');
    expect(none).toContain('data-job-wo-cv-xero-errors');
    expect(none).toMatch(/data-job-wo-cv-xero-submit disabled/);

    for (const out of [blank, found, none, C.xeroReconcileRefusalWords('stale_review'), C.xeroReconcileDoneWords('no_draft', {})]) {
      expect(out).not.toMatch(/[–—]/);
      expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    for (const code of Object.keys({ nothing_to_reconcile: 1, xero_draft_already_recorded: 1, xero_draft_in_progress: 1, xero_invoice_already_recorded: 1, stale_review: 1, expected_updated_at_required: 1, invoice_line_not_found: 1, invalid_outcome: 1, invalid_request: 1, invalid_invoice_number: 1, approver_required: 1, approver_identity_missing: 1, approver_not_set: 1, terminal_approval_switched_off: 1 })) {
      expect(C.xeroReconcileRefusalWords(code, '')).not.toMatch(/[–—]/);
    }
  });
});

test.describe('Overview card and retired crew work orders (core)', () => {
  test('a kind=crew row is labelled retiring; a job row and an untagged row are not', () => {
    expect(C.isRetiredCrewWorkOrder({ id: 'a', kind: 'crew' })).toBe(true);
    expect(C.isRetiredCrewWorkOrder({ id: 'b', kind: 'CREW' })).toBe(true);
    expect(C.isRetiredCrewWorkOrder({ id: 'c', kind: 'job' })).toBe(false);
    expect(C.isRetiredCrewWorkOrder({ id: 'd' })).toBe(false);
    expect(C.retiringCrewLabel({ kind: 'crew', wo_number: 'WO-OLD' })).toBe('Old crew work order (retiring)');
    expect(C.retiringCrewLabel({ kind: 'job' })).toBe('');
    expect(C.retiringCrewLabel({ wo_number: 'WO-UNTAGGED' })).toBe('');
  });

  test('the Overview card: status, allowance, approver, review, overrun, and no money unless asked', () => {
    const block = {
      work_order: {
        id: 'wo-1', wo_number: 'WO-0042', status: 'approved', kind: 'job',
        agreed_labour_ex: 1800, makesafe_labour_allowance_ex: 400,
        approved_at: '2026-10-13T05:00:00Z', approved_by_name: 'Shaun Kay',
      },
      figures: { agreed_ex: 2006, billed_to_date_ex: 2400, remaining_ex: -394, over_agreed: true },
    };
    const lines = [
      { trade_name: 'Sam Crew', description: 'Install day', line_total_ex: 1500, total_hours: 8, work_date: '2026-10-12', review_state: 'approved', work_order_id: 'wo-1' },
      { trade_name: 'Pat Query', description: 'Extra posts', override_amount: 700, acknowledgment_status: 'queried', job_work_order_id: 'wo-1' },
      { trade_name: 'Held Hand', description: 'Waiting', amount_ex: 200, acknowledgment_status: 'pending', work_order_id: 'wo-1' },
      { trade_name: 'No Stamp', description: 'On the job', line_total_ex: 50, review_state: 'rejected' },
      { trade_name: 'Other Job', description: 'Not this work order', line_total_ex: 999, work_order_id: 'wo-other', review_state: 'approved' },
      { description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', kind: 'labour' },
      { trade_name: 'Office', description: 'Commission', line_type: 'commission', line_total_ex: 80, review_state: 'held', work_order_id: 'wo-1' },
    ];
    const html = C.renderOverviewCard(block, { figures: block.figures, lines }, { showMoney: true, lines, linesState: 'ready' });
    expect(html).toContain('data-job-wo-card-status="approved"');
    expect(html).toContain('WO-0042');
    expect(html).toContain('Approved by Shaun Kay on 13 Oct 2026');
    expect(html).toContain('data-job-wo-allowance');
    expect(html).toContain('Make-safe allowance');
    expect(html).toContain('$400.00');
    expect(html).toContain('$2,006.00');
    expect(html).toContain('$2,400.00');
    expect(html).toContain('data-job-wo-overrun');
    expect(html).toContain('Over agreed by $394.00');
    expect(html).toContain('data-job-wo-vs-agreed');
    expect(html).toContain('Sam Crew');
    expect(html).toContain('data-job-wo-review="approved"');
    expect(html).toContain('data-review-source="review_state"');
    expect(html).toContain('data-job-wo-review="queried"');
    expect(html).toContain('data-review-source="acknowledgment_status"');
    expect(html).toContain('data-job-wo-review="held"');
    expect(html).toContain('data-job-wo-review="rejected"');
    expect(html).toContain('Not counted as labour');
    expect(html).toContain('data-job-wo-lines-unstamped');
    expect(html).not.toContain('Not this work order');
    expect(html).not.toContain('Install Colorbond fencing');
    expect(html).not.toContain('$999.00');
    expect(html).not.toMatch(/[–—]/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);

    const quiet = C.renderOverviewCard(block, { figures: block.figures, lines }, { lines, linesState: 'ready' });
    expect(quiet).not.toContain('$');
    expect(quiet).not.toContain('Agreed labour');
    expect(quiet).not.toContain('data-job-wo-overrun');
    expect(quiet).toContain('Sam Crew');

    const blank = C.renderOverviewCard(null, null, { showMoney: true, lines: [], linesState: 'ready' });
    expect(blank).toContain('data-job-wo-card-status="blank"');
    expect(blank).toContain('Work order not filled yet.');
    expect(blank).toContain('Not set');
    expect(blank).toContain('No crew invoice lines on this work order yet.');
    expect(blank).not.toContain('data-job-wo-card-open');

    const openable = C.renderOverviewCard(null, null, { showMoney: true, lines: [], linesState: 'ready', canOpen: true });
    expect(openable).toContain('data-job-wo-card-open');
    expect(openable).toContain('JobWorkOrderOps.openDraft()');
    expect(openable).toContain('Open the draft');

    const refused = C.renderOverviewCard(null, null, {
      showMoney: true, lines: [], linesState: 'ready', canOpen: true,
      message: 'The draft could not be opened. This job type is not on the server yet.',
      messageLevel: 'error',
    });
    expect(refused).toContain('data-job-wo-message');
    expect(refused).toContain('This job type is not on the server yet.');
    expect(refused).toContain('data-job-wo-card-open');

    const issued = C.renderOverviewCard({ work_order: { id: 'wo-2', status: 'issued', wo_number: 'WO-9' } }, null, { showMoney: true, linesState: 'absent' });
    expect(issued).toContain('data-job-wo-card-status="issued"');
    expect(issued).toContain('Crew lines are not on this read yet.');
    expect(issued).not.toContain('Approved by');

    const uuid = C.renderOverviewCard({
      work_order: { id: 'wo-3', status: 'approved', approved_at: '2026-10-01T00:00:00Z', approved_by: '11111111-1111-1111-1111-111111111111', approved_via: 'auto' },
    }, null, { showMoney: false });
    expect(uuid).toContain('Approved automatically on 1 Oct 2026');
    expect(uuid).not.toContain('11111111');

    const draft = C.renderOverviewCard({
      work_order: { id: 'wo-4', status: 'draft', agreed_labour_ex: 100 },
    }, { labour_before_approval: { amount_ex: 40 }, figures: {} }, { showMoney: true, linesState: 'loading' });
    expect(draft).toContain('data-job-wo-card-status="draft"');
    expect(draft).toContain('$100.00');
    expect(draft).toContain('$40.00');
    expect(draft).toContain('data-job-wo-crew-state="loading"');
    expect(draft).not.toContain('data-job-wo-overrun');
  });

  test('billed labour on a job with no work order counts only billed labour lines (SWF-26615)', () => {
    // Live list_trade_invoice_lines nests status on trade_invoices, as an
    // object or a one-element array. A flat invoice_status is not on that read.
    const swf = [
      { trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', trade_invoices: { status: 'acknowledged' }, acknowledgment_status: 'acknowledged', line_total_ex: 430 },
      { trade_name: 'Van', description: 'Travel', line_type: 'other', trade_invoices: { status: 'acknowledged' }, line_total_ex: 80 },
      { trade_name: 'Sam Crew', description: 'Rejected day', line_type: 'labour', trade_invoices: [{ status: 'ops-reject' }], line_total_ex: 100 },
    ];
    const html = C.renderOverviewCard({ work_order: null }, null, { showMoney: true, lines: swf, linesState: 'ready' });
    expect(html).toMatch(/Billed labour<\/div><div class="jwo-fig-v">\$430\.00/);
    expect(html).not.toContain('$610.00');
    expect(html).toContain('Not counted as labour');
    expect(html).toContain('Rejected');
    expect(html).not.toContain('No crew invoice lines');

    const swp = [
      { trade_name: 'Sam Crew', description: 'Patio day', line_type: 'patio', trade_invoices: { status: 'acknowledged' }, line_total_ex: 3000 },
      { trade_name: 'Sam Crew', description: 'Second day', line_type: 'labour', trade_invoices: [{ status: 'paid' }], line_total_ex: 686 },
      { trade_name: 'Sam Crew', description: 'Rejected day', line_type: 'labour', trade_invoices: [{ status: 'ops-reject' }], line_total_ex: 220 },
    ];
    const swpHtml = C.renderOverviewCard({ work_order: null }, null, { showMoney: true, lines: swp, linesState: 'ready' });
    expect(swpHtml).toMatch(/Billed labour<\/div><div class="jwo-fig-v">\$3,686\.00/);
    expect(swpHtml).toContain('Rejected');
    expect(swpHtml).not.toContain('$3,906.00');

    const overridden = C.renderOverviewCard({ work_order: null }, null, { showMoney: true, lines: [
      { trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', trade_invoices: { status: 'acknowledged' }, counted: false, line_total_ex: 430 },
    ], linesState: 'ready' });
    expect(overridden).toMatch(/Billed labour<\/div><div class="jwo-fig-v">\$0\.00/);
    expect(overridden).toContain('Not counted as labour');

    const undecided = C.renderOverviewCard({ work_order: null }, null, { showMoney: true, lines: [
      { trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', line_total_ex: 430 },
    ], linesState: 'ready' });
    expect(undecided).toMatch(/Billed labour<\/div><div class="jwo-fig-v">Not on this read/);
    expect(undecided).toContain('Not counted on this read');

    const draftOnly = C.renderOverviewCard({ work_order: null }, null, { showMoney: true, lines: [
      { trade_name: 'Sam Crew', description: 'Draft day', line_type: 'labour', trade_invoices: { status: 'draft' }, line_total_ex: 210 },
    ], linesState: 'ready' });
    expect(draftOnly).toMatch(/Billed labour<\/div><div class="jwo-fig-v">\$0\.00/);
    expect(draftOnly).toContain('Draft');
    expect(draftOnly).toContain('Not counted as labour');

    const besideBilled = C.renderOverviewCard(
      { work_order: null, figures: { billed_to_date_ex: 430 } },
      null,
      { showMoney: true, lines: [], linesState: 'ready' },
    );
    expect(besideBilled).toContain('$430.00');
    expect(besideBilled).toContain('Crew lines are not on this read yet.');
    expect(besideBilled).not.toContain('No crew invoice lines');
  });

  test('review state is merged from the trade invoice line by line id', () => {
    const woLines = [
      { id: 'wo-line', trade_invoice_line_id: 'inv-1', trade_name: 'Sam Crew', description: 'Install day', line_total_ex: 430, work_order_id: 'wo-1' },
    ];
    const invoiceLines = [
      { id: 'inv-1', acknowledgment_status: 'acknowledged', trade_invoices: { status: 'acknowledged' }, line_type: 'labour', line_total_ex: 430, trade_name: 'Sam Crew', description: 'Install day' },
      { id: 'inv-2', acknowledgment_status: 'queried', trade_invoices: [{ status: 'queried' }], line_type: 'labour', line_total_ex: 80, trade_name: 'Pat Query', description: 'Extra posts' },
    ];
    const merged = C.mergeCrewInvoiceLines(woLines, invoiceLines);
    expect(merged).toHaveLength(2);
    expect(merged[0].acknowledgment_status).toBe('acknowledged');
    expect(merged[0].line_type).toBe('labour');
    expect(merged[0].trade_invoices.status).toBe('acknowledged');
    expect(merged[1].trade_invoices[0].status).toBe('queried');
    const fromLines = C.renderOverviewCard({ work_order: null }, null, { showMoney: true, lines: merged, linesState: 'ready' });
    expect(fromLines).toMatch(/Billed labour<\/div><div class="jwo-fig-v">\$510\.00/);
    const html = C.renderOverviewCard(
      { work_order: { id: 'wo-1', status: 'draft', wo_number: 'WO-9' } },
      { labour_before_approval: { amount_ex: 0 } },
      { showMoney: true, lines: merged, linesState: 'ready' },
    );
    expect(html).toContain('data-job-wo-review="approved"');
    expect(html).toContain('data-review-source="acknowledgment_status"');
    expect(html).toContain('data-job-wo-review="queried"');
    expect(html).toContain('Pat Query');
    expect(html).not.toContain('No crew invoice lines');
    expect(C.mergeCrewInvoiceLines([], invoiceLines)).toHaveLength(2);
  });
});
