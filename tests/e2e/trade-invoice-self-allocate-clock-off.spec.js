// Trade invoicing, quick for the trade (Marnin, 11 Nov 2026):
//  - a trade invoicing a job they are not booked on adds themselves to it
//    from the invoice, then invoices it as an ordinary job card;
//  - clock off asks about a break and saves the times on their job card;
//  - the Weekly Invoice card opens on those saved times for them to check.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Australia/Perth' };

test.describe('invoice: add yourself to a job you are not on', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-multi-week', appWeekDay: 6, ...PHONE });

  // Stands in for ops-api: an extra line on a job the trade is not booked on
  // refuses the whole invoice (extra_job_not_allowed, 403, nothing saved)
  // until the trade is booked on it.
  async function refuseUntilBooked(page, feedRequests, jobNumber) {
    const refused = [];
    await page.route((url) => url.pathname.endsWith('/ops-api') && url.searchParams.get('action') === 'generate_trade_invoice', (route) => {
      const booked = feedRequests.some((entry) => entry.action === 'self_allocate_for_invoice');
      if (booked) return route.fallback();
      refused.push(route.request().postDataJSON());
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, saved: false, code: 'extra_job_not_allowed', jobs: [jobNumber],
          error: `This invoice was not saved. You are not booked on job ${jobNumber}.`, userMessage: `This invoice was not saved. You are not booked on job ${jobNumber}.` })
      });
    });
    return refused;
  }

  async function addJobAndSubmit(page, jobNumber, day) {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.locator('#invoiceWeekContinue').click();
    await page.locator('button[onclick="jcOpenJobSearch(1)"]').click();
    await page.locator('#jcSearchInput_1').fill(jobNumber);
    await page.locator('.jc-job-search-hit').filter({ hasText: jobNumber }).click();
    // Picking a job is unchanged: no question, no booking yet.
    await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);
    const card = page.locator('.jc-card').filter({ hasText: jobNumber });
    await card.locator('input[type="text"]').first().fill('Fence install');
    await card.locator('[data-carddate]').fill(day);
    await card.locator('[data-carddate]').blur();
    await card.locator('[data-cardstart]').fill('07:00');
    await card.locator('[data-cardfinish]').fill('15:00');
    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmAck').check();
    await page.locator('#confirmOk').click();
  }

  test('a refused invoice offers to add the trade for the day worked, then sends', async ({ appPage: page, feedRequests }) => {
    const day = addIsoDays(perthWeekMonday(), 1);
    const refused = await refuseUntilBooked(page, feedRequests, 'SWF-26168');
    await addJobAndSubmit(page, 'SWF-26168', day);

    await expect(page.locator('#confirmTitle')).toHaveText('Add yourself to SWF-26168?');
    await expect(page.locator('#confirmMsg')).toContainText('You are not booked on SWF-26168, so the invoice was not sent.');
    await expect(page.locator('#confirmMsg')).toContainText('The office will see you added yourself.');
    await expect(page.locator('#confirmOk')).toHaveText('Add me and send');
    await page.locator('#confirmOk').click();

    await expect.poll(() => feedRequests.filter((entry) => entry.action === 'self_allocate_for_invoice').length).toBe(1);
    const booked = feedRequests.find((entry) => entry.action === 'self_allocate_for_invoice');
    expect(booked.body).toEqual({ job_id: 'e2e-admin-job-complete-fence', work_date: day });

    // Sending again still goes through the one-invoice-per-week confirm.
    await expect(page.locator('#confirmAckWrap')).toBeVisible();
    await page.locator('#confirmAck').check();
    await page.locator('#confirmOk').click();
    // The first send was refused (nothing saved); the second reaches the server.
    expect(refused).toHaveLength(1);
    await expect.poll(() => feedRequests.filter((entry) => entry.action === 'generate_trade_invoice').length).toBe(1);
    const sent = feedRequests.find((entry) => entry.action === 'generate_trade_invoice').body;
    expect(sent.extra_items.filter((x) => x.job_id === 'e2e-admin-job-complete-fence')).toHaveLength(1);
  });

  test('saying no books nothing and sends nothing more', async ({ appPage: page, feedRequests }) => {
    const day = addIsoDays(perthWeekMonday(), 1);
    const refused = await refuseUntilBooked(page, feedRequests, 'SWF-26168');
    await addJobAndSubmit(page, 'SWF-26168', day);
    await expect(page.locator('#confirmOk')).toHaveText('Add me and send');
    await page.locator('#confirmCancel').click();
    expect(feedRequests.filter((entry) => entry.action === 'self_allocate_for_invoice')).toEqual([]);
    expect(refused).toHaveLength(1);
    expect(feedRequests.filter((entry) => entry.action === 'generate_trade_invoice')).toEqual([]);
    await expect(page.locator('.jc-card').filter({ hasText: 'SWF-26168' })).toHaveCount(1);
  });

  test('a refusal to add is shown in words', async ({ appPage: page, feedRequests }) => {
    const day = addIsoDays(perthWeekMonday(), 1);
    const refused = await refuseUntilBooked(page, feedRequests, 'SWF-26168');
    await page.route((url) => url.pathname.endsWith('/ops-api') && url.searchParams.get('action') === 'self_allocate_for_invoice', (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'self_allocate_job_not_open', error: 'SWF-26168 is a cancelled job, so you cannot add yourself to it. Ask the office.' }) }));
    await addJobAndSubmit(page, 'SWF-26168', day);
    await page.locator('#confirmOk').click();
    await expect(page.locator('#toast')).toContainText('cannot add yourself');
    expect(refused).toHaveLength(1);
    expect(feedRequests.filter((entry) => entry.action === 'generate_trade_invoice')).toEqual([]);
  });
});

test.describe('weekly invoice opens on the times saved at clock off', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-saved-times', appWeekDay: 6, ...PHONE });

  test('the card is filled from logged_time_entry and says to check them', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(card.locator('[data-cardstart]')).toHaveValue('07:00');
    await expect(card.locator('[data-cardfinish]')).toHaveValue('15:00');
    await expect(card.locator('[data-carddate]')).toHaveValue(addIsoDays(perthWeekMonday(), 1));
    await expect(card.locator('[data-cardbreak]')).toHaveValue('30');
    await expect(card).toContainText('Times you saved on this job. Check them before you submit.');
  });
});

test.describe('clock off asks about a break and saves the times', () => {
  test.use({ persona: 'installer', ...PHONE });

  function fenceDetail(status) {
    return {
      access_tier: 'allocated',
      quote_visible: false,
      job: { id: 'e2e-job-1', job_number: 'E2E-JOB-001', type: 'fencing', status: 'processing', client_name: 'Fixture Homeowner', site_address: '20 Trappers Dr', site_suburb: 'Woodvale' },
      crew: [{ id: 'e2e-assignment-1', user_id: 'e2e-installer', users: { id: 'e2e-installer', name: 'E2E Installer' }, scheduled_date: '2026-09-09', start_time: '07:00', status }],
      purchaseOrders: [], documents: [], notes: [], media: [], quote_packs: [], quote_extracts: [], workOrder: null
    };
  }

  async function stub(page, log) {
    let status = 'confirmed';
    await page.route(`${OPS_API}**`, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const action = url.searchParams.get('action');
      const body = req.method() === 'POST' ? (req.postDataJSON() || {}) : null;
      const json = (obj, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(obj) });
      if (action === 'trade_job_detail') return json(fenceDetail(status));
      if (action === 'clock_event') {
        log.push([action, body]);
        const now = new Date().toISOString();
        status = body.event === 'clock_on' ? 'in_progress' : 'complete';
        return json({ success: true, assignment: body.event === 'clock_on'
          ? { id: body.assignment_id, status, started_at: now, clocked_on_at: now }
          : { id: body.assignment_id, status, completed_at: now, clocked_off_at: now }, net_hours: body.event === 'clock_off' ? 1 : null });
      }
      if (action === 'log_my_job_hours') { log.push([action, body]); return json({ ok: true, hours: body.hours, time_entry: body }); }
      if (['add_note', 'send_client_update'].includes(action)) return json({ ok: true });
      return route.fallback();
    });
  }

  async function clockOnThenOff(page) {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
    await page.locator('[data-stepper-start]').click();
    await expect(page.locator('#toast')).toContainText('Clocked On');
    await page.locator('[data-stepper-endday]').click();
    const sheet = page.locator('#clockOffTimesOverlay');
    await expect(sheet).toBeVisible();
    return sheet;
  }

  test('the trade picks a break, checks the times, and they are saved on the job card', async ({ appPage: page }) => {
    const log = [];
    await stub(page, log);
    const sheet = await clockOnThenOff(page);
    await expect(sheet).toContainText('Did you have a break?');
    // Start is when they clocked on, finish is now: both filled, both editable.
    await expect(sheet.locator('[data-cot-start]')).not.toHaveValue('');
    await expect(sheet.locator('[data-cot-finish]')).not.toHaveValue('');
    // No answer yet: cannot save.
    await expect(sheet.locator('[data-cot-save]')).toBeDisabled();

    await sheet.locator('[data-cot-start]').fill('07:00');
    await sheet.locator('[data-cot-finish]').fill('15:30');
    await sheet.locator('[data-cot-break="30"]').click();
    await expect(sheet.locator('[data-cot-hours]')).toContainText('8');
    for (const sel of ['[data-cot-start]', '[data-cot-finish]', '[data-cot-break="30"]', '[data-cot-save]']) {
      const box = await sheet.locator(sel).boundingBox();
      expect(box.height, sel + ' is a thumb-sized target').toBeGreaterThanOrEqual(44);
    }
    await sheet.locator('[data-cot-save]').click();

    await expect(page.locator('#toast')).toContainText('Clocked off. 07:00 to 15:30, 30 min break saved for your invoice.');
    const off = log.find(([a, b]) => a === 'clock_event' && b.event === 'clock_off');
    expect(off[1].break_minutes).toBe(30);
    const logged = log.find(([a]) => a === 'log_my_job_hours');
    expect(logged, 'times are saved on the job card').toBeTruthy();
    expect(logged[1]).toMatchObject({
      jobId: 'e2e-job-1', assignmentId: 'e2e-assignment-1',
      start_time: '07:00', finish_time: '15:30', break_minutes: 30, hours: 8, source: 'clock_off'
    });
    expect(logged[1].work_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('No break is an answer too', async ({ appPage: page }) => {
    const log = [];
    await stub(page, log);
    const sheet = await clockOnThenOff(page);
    await sheet.locator('[data-cot-start]').fill('08:00');
    await sheet.locator('[data-cot-finish]').fill('12:00');
    await sheet.locator('[data-cot-break="0"]').click();
    await sheet.locator('[data-cot-save]').click();
    await expect(page.locator('#toast')).toContainText('08:00 to 12:00, no break');
    const logged = log.find(([a]) => a === 'log_my_job_hours');
    expect(logged[1]).toMatchObject({ break_minutes: 0, hours: 4 });
  });

  test('clocking off without saving times saves no times, and Cancel does not clock off', async ({ appPage: page }) => {
    const log = [];
    await stub(page, log);
    let sheet = await clockOnThenOff(page);
    await sheet.locator('[data-cot-cancel]').click();
    await expect(sheet).toHaveCount(0);
    expect(log.filter(([a, b]) => a === 'clock_event' && b.event === 'clock_off')).toEqual([]);

    await page.locator('[data-stepper-endday]').click();
    sheet = page.locator('#clockOffTimesOverlay');
    await sheet.locator('[data-cot-skip]').click();
    await expect(page.locator('#toast')).toContainText('Clocked off');
    expect(log.filter(([a, b]) => a === 'clock_event' && b.event === 'clock_off')).toHaveLength(1);
    expect(log.filter(([a]) => a === 'log_my_job_hours')).toEqual([]);
  });
});
