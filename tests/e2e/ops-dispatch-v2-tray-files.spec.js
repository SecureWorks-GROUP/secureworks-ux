// Dispatch v2 item 16 part 1 (approved by Shaun 16 Nov 2026): the files on an
// Unmatched supplier email, against a stubbed ops-api (backend contract
// section 3i, secureworks-backend feat/dispatch-tray-attachments). Nothing
// leaves: every read and press is answered by the stub, and the file link
// is answered by the test too.
//
//  - Each card lists the email's files as "PDF: name, size, Open"; a file the
//    capture reader did not keep shows why, with no Open.
//  - Open asks dispatch_v2_tray_attachment_open for that email and file and
//    shows the link in a new tab.
//  - Put on job says how many files went to the job's documents (office only).
//  - An ops-api from before item 16 (no attachments field) draws the card as
//    before.
// The emails copy the shape of the four Ampelite "FW: Scanned Document"
// emails of 16 Nov 2026; the ids, the jobs and the link are made up.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { V2_ANSWER, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const SIGNED = 'https://files.e2e.test/context-email-attachments/scan-1.pdf?token=e2e';
const NO_DASH = /[–—]/;

const JOB = {
  id: 'job-t1', job_number: 'SWP-950001', client_name: 'Example Client', site_suburb: 'Testville', type: 'patio', work_type: 'patio',
  status: 'order_materials', updated_at: '2026-11-16T05:00:00+00:00', site_address: '1 Test Street', value: 9000, value_inc_gst: true,
  description: 'Patio', next_scheduled_date: null, last_scheduled_date: null, po_count: 0, dispatch_next_step: null, ghl_contact_id: null,
};
const FILE = (over) => Object.assign({
  id: 'att-1', file_name: '16112026124402-0001.pdf', content_type: 'application/pdf', size_bytes: 192853, size_label: '188 KB',
  kind_label: 'PDF', openable: true, status: 'stored', not_kept_reason: null,
}, over);
const EMAIL = (over) => Object.assign({
  id: 'tf-1', received_at: '2026-11-16T03:51:54+00:00', from_email: 'warwick@ampelite.example', subject: 'FW: Scanned Document',
  snippet: '', supplier_name: 'Ampelite', state: 'unmatched', rung: null, match_reason: null, job_id: null, job_number: null,
  order_id: null, candidates: [], delivery_label: null, decision: null, attachments: [FILE()],
}, over);

async function boot(page, api) {
  const calls = [];
  const handlers = Object.assign({}, V2_EMPTY_READS, {
    pipeline: () => ({ columns: { accepted: [JSON.parse(JSON.stringify(JOB))] }, total: 1, dispatch_materials: 'ok' }),
    job_detail: () => ({ job: { id: JOB.id, job_number: JOB.job_number, type: 'patio', scope_json: null, ghl_contact_id: null }, media: [], documents: [], invoices: [] }),
    job_notes: () => ({ job_id: JOB.id, total: 0, notes: [] }),
    list_pos: () => ({ purchase_orders: [] }),
  }, api);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installOpsSessionStub(page);
  // The file link opens in a new tab of the same context: answered here
  // (as a page, since a headless browser downloads a PDF instead of showing it).
  await page.context().route('https://files.e2e.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>the file</p>' }));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    if (url.hostname === 'files.e2e.test') return route.fallback();
    const action = /\/functions\/v1\/ops-api$/.test(url.pathname) ? url.searchParams.get('action') : null;
    if (!action) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    calls.push({ action, method: request.method(), url, body });
    const view = url.searchParams.get('view') || 'active';
    const out = action === 'pipeline' && view === 'archive' ? { columns: {}, total: 0 } : handlers[action] ? await handlers[action](url, body) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    let reply = wrapped ? out.body : out;
    if (action === 'pipeline') reply = V2_ANSWER(reply, view);
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(OPS_FILE + '#dispatch');
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const root = page.locator('#dispatchRoot');
  await root.locator('[data-dpc-needs="emails"]').click();
  const tray = root.locator('[data-dpc-region="tray"]');
  await expect(tray.locator('h3')).toHaveText('Unmatched supplier emails');
  const of = (action) => calls.filter((c) => c.action === action);
  return { root, tray, of, calls };
}

const tray = (emails) => () => ({ ok: true, include_other: false, attachments_read: 'ok', emails, counts: { needs_confirmation: 0, unmatched_order_desk: emails.length, unmatched_other: 0 } });

test.describe('Dispatch v2 tray: the files on a supplier email', () => {
  test('each card lists its files as "PDF: name, size", with Open or the reason it was not kept', async ({ page }) => {
    const emails = [
      EMAIL(),
      EMAIL({
        id: 'tf-2', received_at: '2026-11-16T03:52:50+00:00',
        attachments: [FILE({ id: 'att-2', file_name: 'site.jpg', kind_label: 'Image', size_label: '1.4 MB' }), FILE({ id: 'att-3', file_name: 'huge.pdf', size_label: '19.1 MB', openable: false, status: 'skipped_too_large', not_kept_reason: 'Not saved: over 15 MB' })],
      }),
      EMAIL({ id: 'tf-3', attachments: [] }),
    ];
    const { tray: t } = await boot(page, { dispatch_v2_replies_unmatched: tray(emails) });
    const one = t.locator('[data-dpc-tray-item="tf-1"] .dpc-tf-row');
    await expect(one).toHaveCount(1);
    await expect(one).toContainText('PDF: 16112026124402-0001.pdf, 188 KB');
    await expect(one.locator('[data-dpc-tf-open]')).toHaveText('Open');
    const two = t.locator('[data-dpc-tray-item="tf-2"] .dpc-tf-row');
    await expect(two.nth(0)).toContainText('Image: site.jpg, 1.4 MB');
    await expect(two.nth(1)).toContainText('PDF: huge.pdf, 19.1 MB Not saved: over 15 MB');
    await expect(two.nth(1).locator('[data-dpc-tf-open]')).toHaveCount(0);
    await expect(t.locator('[data-dpc-tray-item="tf-3"] .dpc-tf')).toHaveCount(0);
    expect(await t.innerText()).not.toMatch(NO_DASH);
  });

  test('Open asks for that email and file, and shows the link in a new tab', async ({ page }) => {
    const { tray: t, of } = await boot(page, {
      dispatch_v2_replies_unmatched: tray([EMAIL()]),
      dispatch_v2_tray_attachment_open: () => ({ ok: true, url: SIGNED, expires_in: 120, file_name: '16112026124402-0001.pdf', content_type: 'application/pdf' }),
    });
    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      t.locator('[data-dpc-tf-open="tf-1"]').click(),
    ]);
    await tab.waitForURL(SIGNED, { waitUntil: 'commit' });
    const ask = of('dispatch_v2_tray_attachment_open');
    expect(ask).toHaveLength(1);
    expect(ask[0].method).toBe('GET');
    expect([ask[0].url.searchParams.get('email_id'), ask[0].url.searchParams.get('attachment_id')]).toEqual(['tf-1', 'att-1']);
    await expect(t.locator('[data-dpc-tf-open="tf-1"]')).toHaveText('Open');
    await expect(t.locator('[data-dpc-tf-open="tf-1"]')).toBeEnabled();
  });

  test('a refused Open closes the new tab and says why beside the file', async ({ page }) => {
    const { tray: t } = await boot(page, {
      dispatch_v2_replies_unmatched: tray([EMAIL()]),
      dispatch_v2_tray_attachment_open: () => ({ status: 409, body: { error: 'Not saved: over 15 MB', code: 'attachment_not_kept' } }),
    });
    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      t.locator('[data-dpc-tf-open="tf-1"]').click(),
    ]);
    await expect(t.locator('.dpc-tf-err')).toHaveText('Could not open the file: Not saved: over 15 MB');
    await expect.poll(() => tab.isClosed()).toBe(true);
  });

  test('Put on job says how many files went to the job, office only', async ({ page }) => {
    let emails = [EMAIL()];
    const { tray: t, of } = await boot(page, {
      dispatch_v2_replies_unmatched: () => tray(emails)(),
      dispatch_v2_replies_assign: (url, body) => {
        emails = emails.filter((m) => m.id !== body.email_id);
        return { ok: true, job_number: 'SWP-950001', email: { id: body.email_id, job_id: body.job_id }, documents: { read: 'ok', saved: [{ job_document_id: 'd1', name: 'Ampelite 16112026124402-0001.pdf', sha256: 'x' }], skipped: [] } };
      },
    });
    await t.locator('[data-dpc-tray-job="tf-1"]').selectOption(JOB.id);
    await t.locator('[data-dpc-tray-put="tf-1"]').click();
    await expect(t).toContainText("Put on SWP-950001. 1 file saved to the job's documents, office only.");
    expect(of('dispatch_v2_replies_assign').map((c) => [c.body.email_id, c.body.job_id])).toEqual([['tf-1', JOB.id]]);
    // Nothing else was pressed: no stage move, no send.
    expect(of('update_job_status').concat(of('update_repair_stage'), of('send_sms'))).toEqual([]);
  });

  test('an ops-api from before item 16 draws the card as before; a failed files read says so', async ({ page }) => {
    const old = EMAIL({ id: 'tf-old' });
    delete old.attachments;
    const { tray: t } = await boot(page, { dispatch_v2_replies_unmatched: tray([old, EMAIL({ id: 'tf-null', attachments: null })]) });
    await expect(t.locator('[data-dpc-tray-item="tf-old"]')).toContainText('FW: Scanned Document');
    await expect(t.locator('[data-dpc-tray-item="tf-old"] .dpc-tf, [data-dpc-tray-item="tf-old"] .dpc-tf-msg')).toHaveCount(0);
    await expect(t.locator('[data-dpc-tray-item="tf-null"] .dpc-tf-msg')).toHaveText('Could not read the files on this email.');
  });
});
