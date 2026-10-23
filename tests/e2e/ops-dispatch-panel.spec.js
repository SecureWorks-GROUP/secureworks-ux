// Guard for Dispatch slice 2 (modules/ops-dispatch.js): the right panel beside
// the open job. Sources (quotes sent to the client and this job's client
// invoices, from slice 1's one job_detail read), Context story (job_story's
// timeline, in order, never capped) and Messages (the live GoHighLevel chat
// with a text-only reply from +61489267771, and the job's email history from
// get_job_conversation). The panel collapses to a floating tab.
//
// Every read is stubbed. Invented job numbers and contacts, no client data.
// No test ever lets a text leave: send_sms is fulfilled by the stub.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { V2_ANSWER, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const PERTH_YEAR = new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear();

const ROW = (over) => Object.assign({
  client_name: 'Test Client', site_address: '1 Test Street', status: 'accepted', value: 1000, value_inc_gst: true,
  description: null, next_scheduled_date: null, last_scheduled_date: null,
  council_status: null, council_step: null, council_required: false, po_count: 0, work_type: over.type,
  // Slice 3's stage fields, as the live dispatch=1 read carries them: each job in To do at Accepted.
  dispatch_stage: 'accepted', dispatch_stage_index: 1, dispatch_stage_source: 'job_status', dispatch_stage_from: 'accepted',
  dispatch_stage_set_at: null, dispatch_stage_set_by: null, dispatch_todo: true, dispatch_todo_out: null, dispatch_next_step: null,
}, over);

const JOBS = {
  a: ROW({ id: 'job-a', job_number: 'SWF-900501', type: 'fencing', site_suburb: 'Suburb A', updated_at: '2026-10-12T05:00:00+00:00' }),
  b: ROW({ id: 'job-b', job_number: 'SWP-900502', type: 'patio', site_suburb: 'Suburb B', updated_at: '2026-10-12T04:00:00+00:00' }),
  c: ROW({ id: 'job-c', job_number: 'SWR-900503', type: 'repair', site_suburb: 'Suburb C', updated_at: '2026-10-12T03:00:00+00:00' }),
};
const LIST = () => ({ columns: { accepted: [JOBS.a, JOBS.b, JOBS.c] }, total: 3, dispatch_stages: 'ok', todo_total: 3 });

const quote = (over) => Object.assign({ type: 'quote', quote_number: 'Q-900501', created_at: '2026-09-01T01:00:00+00:00' }, over);
const invoice = (over) => Object.assign({ job_id: 'job-a', invoice_type: 'ACCREC', status: 'PAID', reference: '', invoice_date: '2026-09-10' }, over);

const DETAIL = {
  'job-a': {
    job: { id: 'job-a', job_number: 'SWF-900501', type: 'fencing', scope_json: null, ghl_contact_id: 'contactA0000001' },
    media: [],
    documents: [
      quote({ id: 'q1', version: 1, sent_to_client: true, sent_at: `${PERTH_YEAR}-09-01T02:00:00+00:00`, superseded_at: `${PERTH_YEAR}-09-20T02:00:00+00:00`, pdf_url: 'https://docs.example.test/q1.pdf' }),
      quote({ id: 'q2', version: 2, sent_to_client: true, accepted_at: `${PERTH_YEAR}-10-03T02:00:00+00:00`, created_at: '2026-09-20T01:00:00+00:00', storage_url: 'https://docs.example.test/q2.pdf' }),
      quote({ id: 'q3', version: 3, sent_to_client: true, sent_at: `${PERTH_YEAR}-10-05T02:00:00+00:00`, created_at: '2026-10-05T01:00:00+00:00', pdf_url: 'https://docs.example.test/q3.pdf' }),
      quote({ id: 'q4', version: 4, sent_to_client: false, created_at: '2026-10-06T01:00:00+00:00', pdf_url: 'https://docs.example.test/q4-draft.pdf' }),
      { id: 'wo', type: 'work_order', sent_to_client: true, created_at: '2026-10-07T01:00:00+00:00', pdf_url: 'https://docs.example.test/wo.pdf' },
    ],
    invoices: [
      invoice({ invoice_number: 'INV-1001', reference: 'SWF-900501-DEP', status: 'PAID', invoice_date: '2026-09-05', xero_invoice_id: 'xero-dep' }),
      invoice({ invoice_number: 'INV-1002', status: 'AUTHORISED', invoice_date: '2026-10-01', xero_invoice_id: 'xero-auth' }),
      invoice({ invoice_number: 'INV-1003', status: 'DRAFT', invoice_date: '2026-10-02', xero_invoice_id: 'xero-draft' }),
      invoice({ invoice_number: 'INV-1004', status: 'SUBMITTED', invoice_date: '2026-10-03', xero_invoice_id: 'xero-sub' }),
      invoice({ invoice_number: 'INV-VOID', status: 'VOIDED', invoice_date: '2026-10-04', xero_invoice_id: 'xero-void' }),
      invoice({ invoice_number: 'INV-DEL', status: 'DELETED', invoice_date: '2026-10-04', xero_invoice_id: 'xero-del' }),
      invoice({ invoice_number: 'BILL-1', invoice_type: 'ACCPAY', status: 'AUTHORISED', invoice_date: '2026-10-04', xero_invoice_id: 'xero-bill' }),
    ],
  },
  // A job with nothing linked: job_detail's client-name fallback hands it
  // another job's invoice, which must not show.
  'job-b': {
    job: { id: 'job-b', job_number: 'SWP-900502', type: 'patio', scope_json: null, ghl_contact_id: 'contactB0000002' },
    media: [],
    documents: [quote({ id: 'qb', version: 1, sent_to_client: true, sent_at: `${PERTH_YEAR}-08-01T02:00:00+00:00`, share_token: 'tok-e2e' })],
    invoices: [invoice({ job_id: 'job-other', invoice_number: 'INV-NAME-MATCH', xero_invoice_id: 'xero-other' })],
  },
  'job-c': {
    job: { id: 'job-c', job_number: 'SWR-900503', type: 'repair', scope_json: null, ghl_contact_id: null },
    media: [],
    documents: [],
    invoices: [],
  },
};

const STORY = (lines) => ({ version: 'job-story-v1', job: {}, as_of: '2026-10-14', now: {}, money: {}, loops: [], checks: [], timeline: lines });
const LINE = (kind, what, date) => ({ kind, what, date, at: date + 'T01:00:00+00:00', source_table: 'jobs' });
const STORY_A = STORY([
  LINE('first_contact', 'Enquiry from the website', '2026-08-01'),
  LINE('quote', 'Quote v1 sent', '2026-08-03'),
  LINE('purchase_order', 'Purchase order raised', '2026-09-02'),
  LINE('work_order', 'Work order issued', '2026-09-03'),
  LINE('payment', 'Deposit paid', '2026-09-04'),
]);

const msg = (i, over) => Object.assign({ id: 'm' + i, type: 'TYPE_SMS', direction: i % 2 ? 'outbound' : 'inbound', body: 'Message ' + i, timestamp: `${PERTH_YEAR}-10-0${1 + (i % 9)}T0${i % 10}:15:00.000Z` }, over);
const CHAT = (n) => ({ contactId: 'contactA0000001', conversationId: 'conv-1', messages: Array.from({ length: n }, (_, i) => msg(i)) });

const EMAILS = {
  messages: [
    { id: 'bev:1', channel: 'email', direction: 'inbound', source_system: 'business_events', occurred_at: '2026-10-05T02:00:00Z', author: 'Client Person', subject: 'Re: install day', preview: 'Thanks, see you then.', customer_party: true },
    { id: 'ghl:1', channel: 'email', direction: 'outbound', source_system: 'ghl_cache', occurred_at: '2026-10-04T02:00:00Z', subject: 'Booking details', preview: 'Sent from client messaging.', customer_party: true },
    { id: 'ghl:2', channel: 'sms', direction: 'outbound', source_system: 'ghl_cache', occurred_at: '2026-10-04T01:00:00Z', preview: 'a text' },
    { id: 'note:1', channel: 'note', direction: 'internal', source_system: 'job_events', occurred_at: '2026-10-03T02:00:00Z', preview: 'a note' },
    { id: 'email_event:1', channel: 'email', direction: 'outbound', source_system: 'email_events', occurred_at: '2026-10-02T02:00:00Z', subject: 'Your quote Q-900501', preview: 'Subject: Your quote Q-900501\nSent by our system, email type: quote.', customer_party: true },
    { id: 'inbox:1', channel: 'email', direction: 'inbound', source_system: 'inbox', occurred_at: '2026-10-01T02:00:00Z', author: null, subject: 'Order confirmation', preview: 'Your order is confirmed.' },
    { id: 'bev:2', channel: 'email', direction: 'outbound', source_system: 'business_events', occurred_at: '2026-09-30T02:00:00Z', subject: 'Order for job', preview: 'Please supply.', customer_party: false },
  ],
  summary: { count: 7, channels: { email: 5, sms: 1, note: 1 } },
};

const FOOT = 'Email sent by the system, GoHighLevel (client messaging) email, email filed from the inbox, and mailbox email the context system has placed on this job. Mailbox email not yet placed on a job is not listed.';

// Boots Ops on Dispatch with ops-api and ghl-proxy stubbed. `ops[action]` and
// `ghl[action]` return a JSON body, or { status, body }.
async function boot(page, { ops = {}, ghl = {}, viewport = null } = {}) {
  const calls = [];
  const opsHandlers = Object.assign({
    pipeline: () => LIST(),
    job_detail: (url) => DETAIL[url.searchParams.get('jobId')] || { status: 404, body: { error: 'Job not found' } },
    job_notes: (url) => ({ job_id: url.searchParams.get('jobId'), total: 0, notes: [] }),
    job_story: () => STORY_A,
    get_job_conversation: () => EMAILS,
    get_invoice_pdf: () => ({ success: true, pdf_base64: Buffer.from('%PDF-1.4 e2e').toString('base64'), content_type: 'application/pdf' }),
    list_pos: () => ({ purchase_orders: [] }),
    // Slices 4 and 5: no materials and no order email on these jobs.
    dispatch_materials: (url) => ({
      job_id: url.searchParams.get('job_id'), suppliers: [], lines: [], counts: { total: 0, ready: 0 }, can_suggest: false,
      workings: { working_out: null, working_out_updated_at: null, sketch_png: null, sketch_updated_at: null }, orders: [], orders_status: 'ok',
    }),
    dispatch_order_emails: (url) => ({ job_id: url.searchParams.get('job_id'), drafts: [], threads: [], orders_for_link: [], threads_status: 'ok' }),
    // Dispatch v2: no Arrival line, supplier reply or tray email.
    ...V2_EMPTY_READS,
  }, ops);
  const ghlHandlers = Object.assign({
    get_conversation: () => CHAT(3),
    send_sms: () => ({ success: true, messageId: 'sent-1' }),
  }, ghl);
  await page.setViewportSize(viewport || { width: 1440, height: 900 });
  await installOpsSessionStub(page);
  // A pressed invoice opens its PDF in a new tab: recorded, not opened.
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    const fn = (/\/functions\/v1\/([a-z0-9-]+)$/.exec(url.pathname) || [])[1] || null;
    const action = url.searchParams.get('action');
    const handlers = fn === 'ops-api' ? opsHandlers : fn === 'ghl-proxy' ? ghlHandlers : null;
    if (!handlers || !action) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    calls.push({ fn, action, method: request.method(), url, body });
    const view = url.searchParams.get('view') || 'active';
    // Dispatch v2: the Archive read is empty here.
    const archiveRead = fn === 'ops-api' && action === 'pipeline' && view === 'archive' && !url.searchParams.get('search');
    const out = archiveRead ? { columns: {}, total: 0 } : handlers[action] ? await handlers[action](url, body) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    let reply = wrapped ? out.body : out;
    // The v1-shaped list answers become the v2 board answer.
    if (fn === 'ops-api' && action === 'pipeline' && (!wrapped || out.status < 300)) reply = V2_ANSWER(reply, view);
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(OPS_FILE + '#dispatch');
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const root = page.locator('#dispatchRoot');
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWF-900501 · Suburb A');
  const of = (action) => calls.filter((c) => c.action === action);
  return { calls, of, root, panel: root.locator('[data-dpc-region="panel"]') };
}

const openJob = (root, number) => root.locator('.dpc-job', { hasText: number }).click();
const tab = (root, key) => root.locator(`[data-dpc-tab="${key}"]`).click();

// ── Panel frame ──────────────────────────────────────────────────────────────

test('Dispatch panel: three tabs beside the job, the chosen tab kept across jobs and a reload', async ({ page }) => {
  const { root, of, calls } = await boot(page);
  await expect(root.locator('[data-dpc-tab]')).toHaveText(['Sources', 'Context story', 'Messages']);
  await expect(root.locator('[data-dpc-tab="sources"]')).toHaveAttribute('aria-selected', 'true');
  // Beside the middle, 304 wide, with a 20 gap.
  const box = await page.evaluate(() => {
    const ctx = document.querySelector('.dpc-context').getBoundingClientRect();
    const work = document.querySelector('.dpc-workspace').getBoundingClientRect();
    return { width: ctx.width, gap: ctx.left - work.right, sameRow: Math.abs(ctx.top - work.top) < 2 };
  });
  expect(box).toEqual({ width: 304, gap: 20, sameRow: true });
  // Opening a job read job_detail once; the panel added nothing while on Sources.
  await page.waitForLoadState('networkidle');
  expect(of('job_detail').length).toBe(1);
  expect(calls.filter((c) => ['job_story', 'get_conversation', 'get_job_conversation', 'get_invoice_pdf', 'send_sms'].includes(c.action))).toEqual([]);

  await tab(root, 'story');
  await expect(root.locator('.dpc-story li')).toHaveCount(5);
  await openJob(root, 'SWP-900502');
  await expect(root.locator('[data-dpc-tab="story"]')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(root.locator('[data-dpc-tab="story"]')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => localStorage.getItem('sw_dispatch_tab'))).toBe('story');
});

test('Dispatch panel: collapse leaves a floating tab whose three names each open the panel on that tab', async ({ page }) => {
  const { root, calls } = await boot(page);
  for (const [key, label] of [['sources', 'Sources'], ['story', 'Context story'], ['messages', 'Messages']]) {
    await root.locator('[data-dpc-right]').click();
    await expect(root.locator('.dpc-context')).toHaveCount(0);
    await expect(root.locator('.dpc-float button')).toHaveText(['Sources', 'Context story', 'Messages']);
    await expect(root.locator('.dpc-layout')).toHaveClass(/dpc-right-closed/);
    // Fixed to the right edge, half way down.
    const float = await page.evaluate(() => {
      const r = document.querySelector('.dpc-float').getBoundingClientRect();
      return { right: Math.round(window.innerWidth - r.right), mid: Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2) < 2 };
    });
    expect(float).toEqual({ right: 0, mid: true });
    await root.locator(`[data-dpc-opentab="${key}"]`).click();
    await expect(root.locator(`[data-dpc-tab="${key}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(root.locator(`[data-dpc-tab="${key}"]`)).toHaveText(label);
  }
  // Closed state is remembered.
  await root.locator('[data-dpc-right]').click();
  await page.reload();
  await expect(root.locator('.dpc-float')).toHaveCount(1);
  // Opening, switching and collapsing sent nothing.
  expect(calls.filter((c) => /send/.test(c.action)).map((c) => c.action)).toEqual([]);
});

test('Dispatch panel: under 1200 it drops under the middle; at 390 it follows the sections and floats bottom right', async ({ page }) => {
  const { root } = await boot(page, { viewport: { width: 1100, height: 900 } });
  const under = await page.evaluate(() => {
    const ctx = document.querySelector('.dpc-context').getBoundingClientRect();
    const work = document.querySelector('.dpc-workspace').getBoundingClientRect();
    const queue = document.querySelector('.dpc-queue').getBoundingClientRect();
    return { below: ctx.top >= work.bottom, fullWidth: Math.round(ctx.left) === Math.round(queue.left) && Math.round(ctx.right) === Math.round(work.right) };
  });
  expect(under).toEqual({ below: true, fullWidth: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const measure = () => page.evaluate(() => {
    const view = document.querySelector('#dispatchRoot');
    const width = document.documentElement.clientWidth;
    const past = [view].concat(Array.from(view.querySelectorAll('*'))).filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && getComputedStyle(el).position !== 'fixed' && (b.right > width + 0.5 || b.left < -0.5);
    }).map((el) => el.className || el.tagName);
    // Only the Dispatch view is measured, as slice 1's phone check does. The Ops
    // header's own right-hand buttons run past 390 on every tab (not Dispatch's).
    return { past };
  });
  const phone = await page.evaluate(() => {
    const ctx = document.querySelector('.dpc-context').getBoundingClientRect();
    const sec = document.querySelector('.dpc-sec').getBoundingClientRect();
    return ctx.top >= sec.bottom;
  });
  expect(phone).toBe(true);
  expect(await measure()).toEqual({ past: [] });
  for (const key of ['story', 'messages']) {
    await tab(root, key);
    expect(await measure()).toEqual({ past: [] });
  }
  await root.locator('[data-dpc-right]').click();
  const float = await page.evaluate(() => {
    const r = document.querySelector('.dpc-float').getBoundingClientRect();
    // Not hidden under the phone nav: the float is what is drawn at its own centre.
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return { right: Math.round(window.innerWidth - r.right), lowerHalf: r.top > window.innerHeight / 2, inside: r.left >= 0, onTop: !!(hit && hit.closest('.dpc-float')) };
  });
  expect(float).toEqual({ right: 0, lowerHalf: true, inside: true, onTop: true });
  await expect(root.locator('.dpc-float button')).toHaveText(['Sources', 'Context story', 'Messages']);
  expect(await measure()).toEqual({ past: [] });
});

// ── Sources ──────────────────────────────────────────────────────────────────

test('Dispatch panel Sources: quotes sent to the client, and this job\'s client invoices only', async ({ page }) => {
  const { root, panel, of } = await boot(page);
  const groups = panel.locator('.dpc-h4');
  await expect(groups).toHaveText(['Quotes sent to client', 'Invoices', 'Purchase orders']);
  await expect(panel).toContainText('No purchase order yet.');

  // Newest first; never the unsent quote or a work order.
  const quotes = panel.locator('.dpc-h4:has-text("Quotes") ~ .dpc-doc').filter({ hasText: 'Quote' });
  await expect(quotes.locator('strong')).toHaveText(['Quote Q-900501 v3', 'Quote Q-900501 v2', 'Quote Q-900501 v1']);
  await expect(quotes.locator('small')).toHaveText(['Sent 5/10', 'Sent and accepted 3/10', 'Superseded']);
  await expect(quotes.nth(0)).toHaveAttribute('href', 'https://docs.example.test/q3.pdf');
  await expect(quotes.nth(1)).toHaveAttribute('href', 'https://docs.example.test/q2.pdf');
  await expect(quotes.nth(0)).toHaveAttribute('target', '_blank');
  await expect(quotes.locator('.dpc-doc-ico').first()).toHaveText('PDF');

  // Supplier bill, voided and deleted invoices are not listed.
  const invoices = panel.locator('[data-dpc-invoice]');
  await expect(invoices.locator('strong')).toHaveText(['INV-1004', 'INV-1003', 'INV-1002', 'Deposit invoice INV-1001']);
  await expect(invoices.locator('small')).toHaveText(['Awaiting approval', 'Draft, not issued', 'Sent, not paid yet', 'Paid']);
  await expect(panel).not.toContainText(/INV-VOID|INV-DEL|BILL-1/);

  // Pressing an invoice reads that one PDF from Xero, once.
  expect(of('get_invoice_pdf')).toEqual([]);
  await invoices.last().click();
  await expect.poll(() => of('get_invoice_pdf').length).toBe(1);
  expect(of('get_invoice_pdf')[0].url.searchParams.get('xero_invoice_id')).toBe('xero-dep');
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
  await expect(invoices.last().locator('small')).toHaveText('Paid');
});

test('Dispatch panel Sources: a second press while the invoice PDF loads makes no second read', async ({ page }) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { panel, of } = await boot(page, {
    ops: {
      get_invoice_pdf: async () => {
        await held;
        return { success: true, pdf_base64: Buffer.from('%PDF-1.4 e2e').toString('base64'), content_type: 'application/pdf' };
      },
    },
  });
  const invoice = panel.locator('[data-dpc-invoice]').last();
  await expect(invoice.locator('small')).toHaveText('Paid');
  await invoice.click();
  await expect(invoice.locator('small')).toHaveText('Loading...');
  await invoice.click();
  await expect.poll(() => of('get_invoice_pdf').length).toBe(1);
  release();
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
  await expect(invoice.locator('small')).toHaveText('Paid');
  await page.waitForTimeout(300);
  expect(of('get_invoice_pdf').length).toBe(1);
  // Once it has loaded, a fresh press reads it again.
  await invoice.click();
  await expect.poll(() => of('get_invoice_pdf').length).toBe(2);
  await expect(invoice.locator('small')).toHaveText('Paid');
});

test('Dispatch panel Sources: a name-matched invoice and a quote with no PDF', async ({ page }) => {
  const { root, panel } = await boot(page);
  await openJob(root, 'SWP-900502');
  await expect(panel.locator('[data-dpc-invoice]')).toHaveCount(0);
  await expect(panel).toContainText('No invoice on this job yet.');
  await expect(panel).not.toContainText('INV-NAME-MATCH');
  // Listed, not pressable, and never the client's share page.
  const chip = panel.locator('[data-dpc-nopdf]');
  await expect(chip.locator('strong')).toHaveText('Quote Q-900501 v1');
  await expect(chip.locator('small')).toHaveText('Sent 1/8 · No PDF stored');
  await expect(chip).toHaveJSProperty('tagName', 'DIV');
  await expect(page.locator('#viewDispatch a[href*="send-quote"], #viewDispatch a[href*="tok-e2e"]')).toHaveCount(0);

  await openJob(root, 'SWR-900503');
  await expect(panel.locator('.dpc-empty')).toHaveText(['No quote sent to the client yet.', 'No invoice on this job yet.', 'No purchase order yet.']);
});

test('Dispatch panel Sources: a failed job read is an error in both groups, never an empty one', async ({ page }) => {
  let down = false;
  const { root, panel, of } = await boot(page, {
    ops: { job_detail: (url) => (down ? { status: 500, body: { error: 'e2e failure' } } : DETAIL[url.searchParams.get('jobId')]) },
  });
  down = true;
  await openJob(root, 'SWP-900502');
  await expect(panel.locator('[role="alert"]')).toHaveText(['Could not load documents. Retry', 'Could not load documents. Retry']);
  await expect(panel).not.toContainText(/No quote|No invoice/);
  down = false;
  await panel.locator('[data-dpc-retry="detail"]').first().click();
  await expect(panel).toContainText('No invoice on this job yet.');
  expect(of('job_detail').map((c) => c.url.searchParams.get('jobId'))).toEqual(['job-a', 'job-b', 'job-b']);
});

// ── Context story ────────────────────────────────────────────────────────────

test('Dispatch panel Context story: every timeline line in order, an unknown kind kept, read once per job', async ({ page }) => {
  const { root, panel, of } = await boot(page);
  await tab(root, 'story');
  await expect(panel.locator('.dpc-sub')).toHaveText('The whole job in one line of events, from the context system.');
  await expect(panel.locator('.dpc-story li strong')).toHaveText(['First contact', 'Quote', 'Purchase order', 'Work order', 'Payment']);
  await expect(panel.locator('.dpc-story li span')).toHaveText(['Enquiry from the website', 'Quote v1 sent', 'Purchase order raised', 'Work order issued', 'Deposit paid']);
  await expect(panel.locator('.dpc-story li small').first()).toHaveText(/^Sat 1\/8/);
  expect(of('job_story').map((c) => [c.method, c.url.searchParams.get('job_id')])).toEqual([['GET', 'job-a']]);
  // Switching tabs and back reads nothing again.
  await tab(root, 'sources');
  await tab(root, 'story');
  await tab(root, 'messages');
  await tab(root, 'story');
  await expect(panel.locator('.dpc-story li')).toHaveCount(5);
  expect(of('job_story').length).toBe(1);
});

test('Dispatch panel Context story: a long story is drawn whole', async ({ page }) => {
  const lines = Array.from({ length: 86 }, (_, i) => LINE(i % 3 ? 'status' : 'booking_change', 'Line ' + (i + 1), '2026-09-01'));
  const { root, panel } = await boot(page, { ops: { job_story: () => STORY(lines) } });
  await tab(root, 'story');
  await expect(panel.locator('.dpc-story li')).toHaveCount(86);
  await expect(panel.locator('.dpc-story li span').last()).toHaveText('Line 86');
});

test('Dispatch panel Context story: loading, empty, failed and 403 each say so, and Retry reads again', async ({ page }) => {
  let answer = { status: 500, body: { error: 'e2e failure' } };
  let release;
  const gate = new Promise((r) => { release = r; });
  const { root, panel, of } = await boot(page, {
    ops: { job_story: async (url) => (url.searchParams.get('job_id') === 'job-c' ? (await gate, STORY([])) : answer) },
  });
  await tab(root, 'story');
  await expect(panel.locator('[role="alert"]')).toHaveText('Could not read the story. Retry');
  await expect(panel).not.toContainText('No story for this job yet.');
  answer = STORY_A;
  await panel.locator('[data-dpc-retry="story"]').click();
  await expect(panel.locator('.dpc-story li')).toHaveCount(5);

  answer = { status: 403, body: { error: 'Organisation access required', code: 'operator_org_required' } };
  await openJob(root, 'SWP-900502');
  await expect(panel.locator('[role="alert"]')).toHaveText('The story needs a company sign-in.');

  await openJob(root, 'SWR-900503');
  await expect(panel).toContainText('Reading the story.');
  release();
  await expect(panel).toContainText('No story for this job yet.');
  // The job page link is under the story in every state.
  await expect(panel.locator('[data-dpc-jobpage]')).toHaveText('Open job page');
  expect(of('job_story').length).toBe(4);
});

test('Dispatch panel Context story: Open job page opens the same job, adding no Overview setting', async ({ page }) => {
  const { root, panel, of } = await boot(page);
  await tab(root, 'story');
  const link = panel.locator('[data-dpc-jobpage]');
  await expect(link).toHaveAttribute('href', '#job/SWF-900501');
  await link.click();
  await expect(page.locator('#jobDetailView')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#job/SWF-900501');
  expect(await page.evaluate(() => location.search)).toBe('');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /overview/i.test(k)))).toEqual([]);
  expect(of('job_detail').map((c) => c.url.searchParams.get('jobId'))).toEqual(['job-a', 'job-a']);
});

// ── Messages: client chat ────────────────────────────────────────────────────

test('Dispatch panel chat: the live conversation as returned, ours on the right, calls as lines', async ({ page }) => {
  const messages = [
    msg(1, { direction: 'inbound', body: 'When is the install?', timestamp: `${PERTH_YEAR}-10-06T01:12:00.000Z` }),
    msg(2, { direction: 'outbound', body: 'Booked for Tuesday.', timestamp: `${PERTH_YEAR}-10-06T01:30:00.000Z` }),
    msg(3, { type: 'TYPE_CALL', direction: 'inbound', body: '', timestamp: `${PERTH_YEAR}-10-06T02:00:00.000Z` }),
    msg(4, { type: 'TYPE_CALL', direction: 'outbound', body: '', timestamp: `${PERTH_YEAR}-10-06T03:00:00.000Z` }),
  ];
  const { root, panel, of } = await boot(page, { ghl: { get_conversation: () => ({ messages, contactId: 'contactA0000001' }) } });
  await tab(root, 'messages');
  await expect(panel.locator('[data-dpc-msg]')).toHaveText(['Client chat (GHL)', 'Email history']);
  await expect(panel.locator('[data-dpc-msg="client"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(2);
  await expect(panel.locator('.dpc-bubble').nth(0)).toHaveClass(/them/);
  await expect(panel.locator('.dpc-bubble').nth(0)).toContainText('When is the install?');
  await expect(panel.locator('.dpc-bubble').nth(0).locator('small')).toHaveText(/^Client, \w{3} 6\/10 9:12am$/);
  await expect(panel.locator('.dpc-bubble').nth(1)).toHaveClass(/us/);
  await expect(panel.locator('.dpc-bubble').nth(1).locator('small')).toHaveText(/^SecureWorks, \w{3} 6\/10 9:30am$/);
  await expect(panel.locator('.dpc-call')).toHaveText([/^Call, inbound, \w{3} 6\/10 10:00am$/, /^Call, outbound, \w{3} 6\/10 11:00am$/]);
  await expect(panel.locator('.dpc-chat > *')).toHaveCount(4);
  await expect(panel).not.toContainText('Showing the latest 30 messages.');
  expect(of('get_conversation').map((c) => c.url.searchParams.get('contactId'))).toEqual(['contactA0000001']);
  // Switching away and back reads nothing again.
  await panel.locator('[data-dpc-msg="email"]').click();
  await panel.locator('[data-dpc-msg="client"]').click();
  await tab(root, 'sources');
  await tab(root, 'messages');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(2);
  expect(of('get_conversation').length).toBe(1);
});

test('Dispatch panel chat: exactly 30 shows the latest-30 line above the oldest, 29 does not', async ({ page }) => {
  const { root, panel } = await boot(page, {
    ghl: { get_conversation: (url) => CHAT(url.searchParams.get('contactId') === 'contactA0000001' ? 30 : 29) },
  });
  await tab(root, 'messages');
  await expect(panel.locator('.dpc-chat > *').first()).toHaveText('Showing the latest 30 messages.');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(30);
  await openJob(root, 'SWP-900502');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(29);
  await expect(panel).not.toContainText('Showing the latest 30 messages.');
});

test('Dispatch panel chat: no contact, no messages, and a failed or rate-limited read each say so', async ({ page }) => {
  let answer = { status: 500, body: { error: 'GHL down', messages: [] } };
  const { root, panel, of } = await boot(page, { ghl: { get_conversation: (url) => (url.searchParams.get('contactId') === 'contactB0000002' ? { messages: [], contactId: 'contactB0000002', conversationId: null } : answer) } });
  await tab(root, 'messages');
  await expect(panel.locator('[role="alert"]')).toHaveText('Could not load the chat. Retry');
  await expect(panel).not.toContainText('No messages');
  // An error beside messages: [] on a 200, and a rate-limit answer.
  for (const next of [{ error: 'Rate limited', messages: [] }, { status: 429, body: { error: 'GoHighLevel rate limit', rate_limited: true, messages: [] } }]) {
    answer = next;
    await panel.locator('[data-dpc-retry="chat"]').click();
    await expect(panel.locator('[role="alert"]')).toHaveText('Could not load the chat. Retry');
    await expect(panel).not.toContainText('No messages');
  }
  answer = CHAT(2);
  await panel.locator('[data-dpc-retry="chat"]').click();
  await expect(panel.locator('.dpc-bubble')).toHaveCount(2);

  await openJob(root, 'SWP-900502');
  await expect(panel.locator('[data-dpc-region="chat"]')).toHaveText('No messages with this client yet.');
  await expect(panel.locator('[data-dpc-reply]')).toHaveCount(1);

  const before = of('get_conversation').length;
  await openJob(root, 'SWR-900503');
  await expect(panel.locator('[data-dpc-region="chat"]')).toHaveText('No client contact is linked to this job, so there is no chat.');
  await expect(panel.locator('[data-dpc-reply], [data-dpc-send]')).toHaveCount(0);
  expect(of('get_conversation').length).toBe(before);
});

test('Dispatch panel chat: Send texts once from +61489267771, then clears and re-reads once', async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let read = 0;
  const { root, panel, of, calls } = await boot(page, {
    ghl: {
      get_conversation: () => { read += 1; return CHAT(read === 1 ? 2 : 3); },
      send_sms: async () => { await gate; return { success: true, messageId: 'sent-1' }; },
    },
  });
  await tab(root, 'messages');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(2);
  const send = panel.locator('[data-dpc-send]');
  await expect(send).toBeDisabled();
  await panel.locator('[data-dpc-reply]').fill('   ');
  await expect(send).toBeDisabled();
  await page.evaluate(() => sessionStorage.setItem('sw_convo_contactA0000001', '{"messages":[]}'));
  // Nothing has been sent by opening, switching or typing.
  expect(of('send_sms')).toEqual([]);

  await panel.locator('[data-dpc-reply]').fill('See you Tuesday.');
  // v2 slice 4: Send only asks. Cancel sends nothing and keeps the text.
  await send.click();
  const ask = panel.locator('.dpc-sms-ask');
  await expect(ask).toContainText('Text this to the client? It sends from the admin line.');
  await expect(panel.locator('[data-dpc-reply]')).toHaveAttribute('readonly', '');
  await ask.locator('[data-dpc-send-no]').click();
  await expect(ask).toHaveCount(0);
  await expect(panel.locator('[data-dpc-reply]')).toHaveValue('See you Tuesday.');
  expect(of('send_sms')).toEqual([]);
  await send.click();
  await ask.locator('[data-dpc-send-go]').click();
  await expect(send).toHaveText('Sending...');
  await expect(send).toBeDisabled();
  await send.click({ force: true });
  await panel.locator('[data-dpc-reply]').press('Enter').catch(() => {});
  release();
  await expect(panel.locator('.dpc-note-msg')).toHaveText('Message sent.');
  await expect(panel.locator('[data-dpc-reply]')).toHaveValue('');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(3);
  expect(of('send_sms').length).toBe(1);
  const sent = of('send_sms')[0];
  expect(sent.method).toBe('POST');
  expect(sent.body).toEqual({ contactId: 'contactA0000001', message: 'See you Tuesday.', jobId: 'job-a', fromNumber: '+61489267771' });
  expect(of('get_conversation').length).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('sw_convo_contactA0000001'))).toBeNull();
  await page.waitForLoadState('networkidle');
  expect(calls.filter((c) => /send/.test(c.action)).map((c) => c.action)).toEqual(['send_sms']);
});

test('Dispatch panel chat: a failed send keeps the text and is never retried on its own', async ({ page }) => {
  const answers = [{ status: 500, body: { error: 'GHL down' } }, { status: 409, body: { success: false, error: 'This exact SMS was already sent', dedup_blocked: true } }];
  const { root, panel, of } = await boot(page, { ghl: { send_sms: () => answers.shift() || { success: true } } });
  await tab(root, 'messages');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(3);
  await panel.locator('[data-dpc-reply]').fill('Running late.');
  // Send asks first (v2 slice 4); Send text sends.
  await panel.locator('[data-dpc-send]').click();
  await panel.locator('[data-dpc-send-go]').click();
  await expect(panel.locator('.dpc-note-msg')).toHaveText('Message not sent. Your text is still here.');
  await expect(panel.locator('[data-dpc-reply]')).toHaveValue('Running late.');
  await page.waitForTimeout(500);
  expect(of('send_sms').length).toBe(1);
  await panel.locator('[data-dpc-send]').click();
  await panel.locator('[data-dpc-send-go]').click();
  await expect(panel.locator('.dpc-note-msg')).toHaveText('Message not sent. Your text is still here.');
  await expect(panel.locator('[data-dpc-reply]')).toHaveValue('Running late.');
  expect(of('send_sms').length).toBe(2);
  expect(of('get_conversation').length).toBe(1);
});

// ── Messages: email history ──────────────────────────────────────────────────

test('Dispatch panel email: every email row of get_job_conversation at limit 200, GoHighLevel email included', async ({ page }) => {
  const { root, panel, of } = await boot(page);
  await tab(root, 'messages');
  await panel.locator('[data-dpc-msg="email"]').click();
  const rows = panel.locator('.dpc-source');
  await expect(rows.locator('strong')).toHaveText(['Re: install day', 'Booking details', 'Your quote Q-900501', 'Order confirmation', 'Order for job']);
  await expect(rows.locator('.dpc-muted')).toHaveText([
    /^Client Person, \w{3} 5\/10$/, /^SecureWorks to client, \w{3} 4\/10$/, /^SecureWorks to client, \w{3} 2\/10$/, /^Sender not recorded, \w{3} 1\/10$/, /^SecureWorks, not to the client, \w{3} 30\/9$/,
  ]);
  await expect(rows.nth(0).locator('.dpc-preview')).toHaveText('Thanks, see you then.');
  await expect(panel.locator('.dpc-foot-line')).toHaveText(FOOT);
  await expect(panel).not.toContainText('Showing the latest email only.');
  expect(of('get_job_conversation').map((c) => [c.method, c.body.job_id, c.body.limit])).toEqual([['POST', 'job-a', 200]]);
  // No reply, link or open action on an email.
  await expect(panel.locator('.dpc-source a, .dpc-source button, [data-dpc-reply]')).toHaveCount(0);
  // Kept for the job.
  await panel.locator('[data-dpc-msg="client"]').click();
  await panel.locator('[data-dpc-msg="email"]').click();
  await expect(rows).toHaveCount(5);
  expect(of('get_job_conversation').length).toBe(1);
});

test('Dispatch panel email: an older GoHighLevel email outside the latest 30 chat messages shows in Email history', async ({ page }) => {
  const older = { id: 'ghl:old', channel: 'email', direction: 'outbound', source_system: 'ghl_cache', occurred_at: '2026-08-10T02:00:00Z', subject: 'Your fence quote', preview: 'Quote attached, sent from client messaging.', customer_party: true };
  const { root, panel } = await boot(page, {
    ghl: { get_conversation: () => CHAT(30) },
    ops: { get_job_conversation: () => ({ messages: [older], summary: { count: 1 } }) },
  });
  await tab(root, 'messages');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(30);
  await expect(panel).not.toContainText('Your fence quote');
  await panel.locator('[data-dpc-msg="email"]').click();
  const rows = panel.locator('.dpc-source');
  await expect(rows.locator('strong')).toHaveText(['Your fence quote']);
  await expect(rows.locator('.dpc-muted')).toHaveText([/^SecureWorks to client, \w{3} 10\/8$/]);
  await expect(rows.locator('.dpc-preview')).toHaveText('Quote attached, sent from client messaging.');
  await expect(panel.locator('.dpc-foot-line')).toHaveText(FOOT);
});

test('Dispatch panel email: a full read of 200 says so; empty and failed reads say so with the foot line', async ({ page }) => {
  let answer = { messages: EMAILS.messages, summary: { count: 200 } };
  const { root, panel } = await boot(page, { ops: { get_job_conversation: () => answer } });
  await tab(root, 'messages');
  await panel.locator('[data-dpc-msg="email"]').click();
  await expect(panel.locator('.dpc-chat-cap')).toHaveText('Showing the latest email only.');

  answer = { messages: [EMAILS.messages[2], EMAILS.messages[3]], summary: { count: 2 } };
  await openJob(root, 'SWP-900502');
  await expect(panel.locator('.dpc-empty')).toHaveText('No email on this job yet.');
  await expect(panel.locator('.dpc-foot-line')).toHaveText(FOOT);

  answer = { status: 500, body: { error: 'e2e failure' } };
  await openJob(root, 'SWR-900503');
  await expect(panel.locator('[role="alert"]')).toHaveText('Could not load email. Retry');
  await expect(panel).not.toContainText('No email on this job yet.');
  await expect(panel.locator('.dpc-foot-line')).toHaveText(FOOT);
  answer = { messages: [EMAILS.messages[0]], summary: { count: 1 } };
  await panel.locator('[data-dpc-retry="email"]').click();
  await expect(panel.locator('.dpc-source')).toHaveCount(1);
});

// ── The panel reads nothing else ─────────────────────────────────────────────

test('Dispatch panel: every call it makes is one of job_story, get_conversation, get_job_conversation, get_invoice_pdf', async ({ page }) => {
  const { root, panel, calls } = await boot(page);
  await page.waitForLoadState('networkidle');
  const mark = calls.length;
  await tab(root, 'story');
  await expect(panel.locator('.dpc-story li')).toHaveCount(5);
  await tab(root, 'messages');
  await expect(panel.locator('.dpc-bubble')).toHaveCount(3);
  await panel.locator('[data-dpc-msg="email"]').click();
  await expect(panel.locator('.dpc-source')).toHaveCount(5);
  await tab(root, 'sources');
  await panel.locator('[data-dpc-invoice]').first().click();
  await root.locator('[data-dpc-right]').click();
  await root.locator('[data-dpc-opentab="messages"]').click();
  await page.waitForLoadState('networkidle');
  const since = calls.slice(mark).map((c) => c.fn + ':' + c.action);
  expect([...new Set(since)].sort()).toEqual(['ghl-proxy:get_conversation', 'ops-api:get_invoice_pdf', 'ops-api:get_job_conversation', 'ops-api:job_story']);
  expect(since.length).toBe(4);
  // The panel draws no supplier card or email item (slices 3 to 7 are guarded in tests/e2e/ops-tab-set.spec.js).
  await expect(root.locator('.dpc-supcard, .dpc-mail')).toHaveCount(0);
  const panelText = await root.locator('.dpc-context').innerText();
  expect(panelText).not.toMatch(/—|template|attach|recording|transcript/i);
});
