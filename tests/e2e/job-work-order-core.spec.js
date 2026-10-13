// Job work order: the pure rules and HTML (docs/job-work-order-screens.md).
// ---------------------------------------------------------------------------
// Pure node, no browser: this spec READS ../../shared/job-work-order.js, takes the
// code between `// <job-work-order-core>` and `// </job-work-order-core>`, and runs
// it, so every assertion is against the shipped functions both apps load.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const SHARED = resolve(__dirname, '../../shared/job-work-order.js');
const OPS_MODULE = resolve(__dirname, '../../modules/ops-job-work-order.js');
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
    { description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', kind: 'labour', rate_ex: 35, allocation_ex: 1316 },
    { description: 'Plinth install', qty: 21, unit: 'each', kind: 'labour', rate_ex: 10, allocation_ex: 210 },
    { description: 'Root removal / hard digging', qty: 2, unit: 'hrs', kind: 'labour', rate_ex: 80, allocation_ex: 160 },
    { description: 'Root removal', qty: 1, unit: 'job', kind: 'labour', allocation_ex: 250 },
    { description: 'Remove tree roots between 378/1 and 378/2', hours: 4, kind: 'labour', allocation_ex: 320, variation_number: 1, variation_approved_at: '2026-10-14T02:00:00Z' },
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
  test('the shared file and the Ops module hold no long dash and no emoji', () => {
    for (const src of [SOURCE, readFileSync(OPS_MODULE, 'utf8')]) {
      expect(src).not.toMatch(/[–—]/);
      expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  test('preview switch: off by default, the URL turns it on or off and asks to be remembered', () => {
    expect(C.previewState('', null)).toEqual({ on: false, persist: null });
    expect(C.previewState('', '1')).toEqual({ on: true, persist: null });
    expect(C.previewState('', '0')).toEqual({ on: false, persist: null });
    expect(C.previewState('?wo=preview', null)).toEqual({ on: true, persist: '1' });
    expect(C.previewState('?jobId=x&wo=1', null)).toEqual({ on: true, persist: '1' });
    expect(C.previewState('?wo=live', '1')).toEqual({ on: false, persist: '0' });
    expect(C.previewState('?wo=off', '1')).toEqual({ on: false, persist: '0' });
    // An unknown value leaves the remembered setting alone.
    expect(C.previewState('?wo=banana', '1')).toEqual({ on: true, persist: null });
    expect(C.previewState('?two=1', null)).toEqual({ on: false, persist: null });
  });

  test('only fencing and patio jobs carry a job work order', () => {
    expect(C.eligibleType('fencing')).toBe(true);
    expect(C.eligibleType('Patio')).toBe(true);
    expect(C.eligibleType('makesafe')).toBe(false);
    expect(C.eligibleType('')).toBe(false);
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
    // Other spellings of the same fields.
    expect(C.lineOf({ task: 'Gate rehang', quantity: '3', units: 'hours' }).hours).toBe(3);
    expect(C.lineOf({ name: 'Post set', hrs: '1.5', qty: 4, unit: 'each' })).toMatchObject({ task: 'Post set', hours: 1.5, qty: 4 });
    expect(C.needsHours(C.lineOf({ description: 'Material', qty: 1, unit: 'job', kind: 'material' }))).toBe(false);
  });

  test('variations are their own marked addenda; the approved lines are never mixed with one', () => {
    const items = scopeItems().concat([
      { description: 'Extra gate post', hours: 1, variation_number: 2 },
      { description: 'Second variation line', hours: 0.5, variation_number: 2 },
      { description: 'Flagged only', hours: 2, variation: true, variation_label: 'Neighbour request' },
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
