// 2026-09-08 — complete-to-invoice: finishing a job feeds the trade's weekly
// invoice (per-metre: the work order goes onto the weekly draft; hourly: one-tap hours).
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const UPLOAD_URL = `${SUPABASE_ORIGIN}/storage/v1/object/upload/sign/job-photos/e2e`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const shot = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

function fenceDetail(jobId, userId, userName) {
  return {
    access_tier: 'allocated', quote_visible: false,
    job: {
      id: jobId, job_number: 'E2E-JOB-001', type: 'fencing', status: 'processing',
      client_name: 'Fixture Homeowner', client_phone: '0400333444', site_address: '20 Trappers Dr', site_suburb: 'Woodvale',
      scope_json: { job: { runs: [{ name: 'RHS', length: 7.1, sheetHeight: 1800 }], neighbours: [{ id: 'nb-1', firstName: 'Sue', lastName: 'Lee' }] } },
    },
    crew: [{ id: 'asn-1', user_id: userId, users: { id: userId, name: userName }, scheduled_date: '2026-09-09', status: 'in_progress', started_at: '2026-09-09T00:00:00Z', clocked_on_at: '2026-09-09T00:00:00Z' }],
    purchaseOrders: [], documents: [], notes: [], media: [], quote_packs: [], quote_extracts: [],
    completion_evidence: { job_id: jobId, applies: true, satisfied: false, photos: 0, photos_required: 3, signoffs: 0, signoffs_required: 1, named_neighbours: 1, waived: false, waiver_reason: null, missing: ['completion_photos', 'neighbour_signoff'], read_failed: false },
    workOrder: null,
  };
}

async function runWizardToComplete(page) {
  await page.locator('[data-stepper-finish]').click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#wizOverlay')).toHaveClass(/active/);
  for (const label of ['Full fence run', 'Gate operation', 'Post bases and plinths']) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('.wiz-photo-prompt').filter({ hasText: label }).locator('.wiz-photo-btn-lib').click(),
    ]);
    await chooser.setFiles(shot(label.replace(/\s+/g, '-') + '.png'));
  }
  await page.locator('#wizFooter .wiz-btn-primary').click();
  const [ns] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-neighbour-slot="0"] .wiz-photo-btn-lib').click()]);
  await ns.setFiles(shot('sue.png'));
  await page.locator('[data-neighbour-next]').click();
  await page.locator('#wizBody button').filter({ hasText: '☆' }).nth(4).click();
  await page.locator('#wizFooter .wiz-btn-primary').click();
  for (const cb of await page.locator('#wizBody input[type="checkbox"]').all()) await cb.check();
  await page.locator('#wizFooter .wiz-btn-primary').click();
  await page.locator('#wizCompleteBtn').click();
  await expect(page.locator('#wizBody')).toContainText('Job Complete!', { timeout: 15000 });
}

function baseRoutes(page, log, detail, queue) {
  return page.route(`${OPS_API}**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action');
    const body = req.method() === 'POST' ? (req.postDataJSON() || {}) : null;
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'trade_job_detail' && url.searchParams.get('jobId') === detail.job.id) return json(detail);
    if (action === 'get_upload_url') return json({ uploadUrl: UPLOAD_URL + '/' + Date.now(), token: 't', publicUrl: SUPABASE_ORIGIN + '/storage/v1/object/public/job-photos/e2e/' + body.fileName, path: 'e2e/' + body.fileName });
    if (action === 'confirm_upload') return json({ success: true, media: { id: 'm-' + Date.now(), phase: body.phase } });
    if (action === 'complete_my_job') { log.push([action, body]); return json({ success: true, completion_evidence: { satisfied: true }, invoice_queue: queue }); }
    if (action === 'log_my_job_hours') { log.push([action, body]); return json({ ok: true, hours: body.hours, assignment: { id: 'asn-1', status: 'complete', scheduled_date: '2026-09-09', hours_worked: body.hours }, week_ending: '2026-09-13' }); }
    if (action === 'save_trade_invoice_draft') { log.push([action, body]); return json({ error: 'Weekly invoice fixture is not enabled for this block set' }, 422); }
    if (['send_client_update', 'generate_completion_pack', 'add_note'].includes(action)) return json({ ok: true });
    await route.fallback();
  });
}

test.describe('Complete-to-invoice: hourly trade', () => {
  test.use({ persona: 'installer' });

  test('after Job complete an hourly trade gets one-tap hours on the success screen', async ({ appPage: page }) => {
    const log = [];
    await page.route(`${UPLOAD_URL}**`, (route) => route.fulfill({ status: 200, body: '' }));
    await baseRoutes(page, log, fenceDetail('e2e-job-1', 'e2e-installer', 'E2E Installer'), { lane: 'hours', hours_logged: null, work_orders: [] });
    await signIn(page, PERSONAS.installer);
    await page.evaluate(() => window.openJob('e2e-job-1'));
    await runWizardToComplete(page);
    const hours = page.locator('#wizBody #rrHours');
    await expect(hours).toBeVisible();
    await hours.locator('[data-rr-hour="2"]').click();
    await expect.poll(() => log.filter((e) => e[0] === 'log_my_job_hours').length).toBe(1);
    expect(log.find((e) => e[0] === 'log_my_job_hours')[1]).toMatchObject({ job_id: 'e2e-job-1', hours: 2 });
    await expect(page.locator('#wizBody #rrHours')).toContainText('2 hrs on your week (w/e Sun 13 Sep)');
  });

  test('hours already clocked are shown instead of the chips', async ({ appPage: page }) => {
    const log = [];
    await page.route(`${UPLOAD_URL}**`, (route) => route.fulfill({ status: 200, body: '' }));
    await baseRoutes(page, log, fenceDetail('e2e-job-1', 'e2e-installer', 'E2E Installer'), { lane: 'hours', hours_logged: 6.5, work_orders: [] });
    await signIn(page, PERSONAS.installer);
    await page.evaluate(() => window.openJob('e2e-job-1'));
    await runWizardToComplete(page);
    await expect(page.locator('#wizBody')).toContainText('6.5 hrs on your week for this job');
    await expect(page.locator('#wizBody #rrHours')).toHaveCount(0);
  });
});

test.describe('Complete-to-invoice: per-metre trade', () => {
  test.use({ persona: 'fencing_manager', feedScenario: 'trade-weekly-work-order-invoice', timezoneId: 'Australia/Perth' });

  test('the completed work order is sent to this week\'s weekly draft automatically, and a refusal is shown honestly', async ({ appPage: page }) => {
    const log = [];
    await page.route(`${UPLOAD_URL}**`, (route) => route.fulfill({ status: 200, body: '' }));
    await baseRoutes(page, log, fenceDetail('henry-job-1', 'e2e-henry', 'Henry'), {
      lane: 'weekly_work_order', hours_logged: null,
      work_orders: [{ id: 'henry-wo-1', wo_number: 'WO-HENRY-01', completed_at: '2026-09-08T02:00:00Z', business_date: '2026-09-08', week_end: '2026-09-13', priced: true, already_complete: false }],
    });
    await signIn(page, PERSONAS.fencing_manager);
    await page.evaluate(() => window.openJob('henry-job-1'));
    await runWizardToComplete(page);
    const card = page.locator('[data-wiz-invoice="henry-wo-1"]');
    await expect(card).toContainText('Work order WO-HENRY-01 complete');
    // The app asked the server to put exactly this work order on the weekly draft.
    await expect.poll(() => log.filter((e) => e[0] === 'save_trade_invoice_draft').length, { timeout: 10000 }).toBe(1);
    const save = log.find((e) => e[0] === 'save_trade_invoice_draft')[1];
    expect(save.work_order_blocks.map((b) => b.work_order_id)).toEqual(['henry-wo-1']);
    expect(save.week_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(['grand_total', 'to_be_paid', 'gross_earned'].some((k) => Object.hasOwn(save, k))).toBe(false);
    // The server refused (fixture), so the trade is told and given the manual path. Completion itself is done.
    await expect(card).toHaveAttribute('data-wiz-invoice-state', 'failed');
    await expect(card).toContainText('Add it from My Work Orders');
    await expect(card.locator('[data-wiz-review]')).toBeVisible();
    expect(log.filter((e) => e[0] === 'complete_my_job')).toHaveLength(1);
  });
});
