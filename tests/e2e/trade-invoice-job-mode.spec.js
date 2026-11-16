// The job decides how it is billed (Marnin, 11 Nov 2026). ops-api sends each
// job's invoice_mode and can_claim_commission on my_hours, and from
// trade_invoice_job_modes for a job the trade searched in. A card starts in
// that mode; a work-order card keeps a small "Bill by hours instead";
// Commission shows only where it may be claimed. With no mode (an older
// ops-api, or invoice_mode_unavailable) the card keeps the old toggle.
// trade.html `// <invoice-job-mode>`.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { fillCardTime, fixtureJobDay } = require('../helpers/invoice-time');

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'Australia/Perth' };
const ASSIGNMENT = 'e2e-wo-holder-assignment';

async function openInvoice(page, jobNumber = 'SWF-26767') {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const card = page.locator('.jc-card').filter({ hasText: jobNumber });
  await expect(card).toBeVisible();
  return card;
}

function invoicePosts(feedRequests) {
  return feedRequests.filter((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
}

async function submit(page) {
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();
}

test.describe('an hourly job', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', appWeekDay: 6, ...PHONE,
    myHoursPatch: { assignments: { [ASSIGNMENT]: { invoice_mode: 'hourly', can_claim_commission: false } } } });

  test('shows how it is paid and offers no work order or commission', async ({ appPage: page, feedRequests }) => {
    const card = await openInvoice(page);
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Paid by the hour');
    await expect(card).toContainText('Fill in the date you worked and your start and finish times.');
    await expect(card.locator('[data-card-day]')).toContainText('Booked for');
    for (const name of ['Hours', 'Work Order', 'Commission']) {
      await expect(card.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(card.locator('[data-card-mode-switch]')).toHaveCount(0);
    await expect(page.locator('[data-invoice-cards-intro]')).toContainText('Each job says how it is paid.');

    await fillCardTime(card, 8);
    await submit(page);
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    const body = invoicePosts(feedRequests)[0].body;
    expect(body.manual_assignments).toEqual([expect.objectContaining({ assignment_id: ASSIGNMENT, hours: 8, work_date: fixtureJobDay() })]);
    expect((body.extra_items || []).some((x) => x.row_type === 'work_order' || x.row_type === 'commission')).toBe(false);
  });

  test('an amount taken off is not a line on its own: the card still owes its times', async ({ appPage: page, feedRequests }) => {
    const card = await openInvoice(page);
    await card.getByRole('button', { name: '+ Take an amount off' }).click();
    await expect(card).toContainText('Taken off this job');
    await card.locator('[data-cardlumpdesc]').fill('Fuel card');
    await card.locator('[data-cardlumpamt]').fill('40');
    await card.locator('[data-cardlumpamt]').press('Tab');
    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('SWF-26767: add the date, start time and finish time you worked.');
    await expect(page.locator('#toast')).not.toContainText('add an amount');
    expect(invoicePosts(feedRequests)).toEqual([]);

    // With times it goes, the amount taken off the hours.
    await fillCardTime(card, 8);
    await expect(card.locator('[data-cardamt]')).toHaveText('$360.00');
  });
});

test.describe('an hourly job the trade may claim commission on', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', appWeekDay: 6, ...PHONE,
    myHoursPatch: { assignments: { [ASSIGNMENT]: { invoice_mode: 'hourly', can_claim_commission: true } } } });

  test('offers Commission as a link, and back to hours', async ({ appPage: page, feedRequests }) => {
    const card = await openInvoice(page);
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Paid by the hour');
    await expect(card.locator('[data-card-mode-switch]')).toHaveText(['Claim commission instead']);
    await card.getByRole('button', { name: 'Claim commission instead' }).click();
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Commission');
    await card.locator('[data-cardcommamt]').fill('150');
    await card.locator('[data-cardcommamt]').press('Tab');
    await expect(card.locator('[data-card-mode-switch]')).toHaveText(['Bill by hours instead']);
    // Commission carries no super: the estimate takes none off it.
    const summary = page.locator('#invMoneySummary');
    await expect(summary.locator('[data-invoice-commission-no-super]')).toContainText('No super is taken on commission ($150.00)');
    await expect(summary.locator('.inv-money-row.net')).toContainText('$150.00');
    await submit(page);
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    const body = invoicePosts(feedRequests)[0].body;
    expect(body.extra_items).toEqual([expect.objectContaining({ row_type: 'commission', commission_amount: 150 })]);
  });
});

test.describe('a work-order job', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', appWeekDay: 6, ...PHONE,
    myHoursPatch: { assignments: { [ASSIGNMENT]: { invoice_mode: 'work_order', can_claim_commission: false } } } });

  test('opens as a work order, with a small way to bill hours instead', async ({ appPage: page, feedRequests }) => {
    const card = await openInvoice(page);
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Paid as a work order');
    await expect(card.locator('[data-cardwoalloc]')).toBeVisible();
    await expect(card.locator('[data-carddate]')).toHaveCount(0);
    await expect(card.locator('[data-card-mode-switch]')).toHaveText(['Bill by hours instead']);
    await expect(card.getByRole('button', { name: 'Commission', exact: true })).toHaveCount(0);

    // A fencing helper bills hours on this fencing job.
    await card.getByRole('button', { name: 'Bill by hours instead' }).click();
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Paid by the hour');
    await expect(card.locator('[data-cardwoalloc]')).toHaveCount(0);
    await expect(card.locator('[data-card-mode-switch]')).toHaveText(['Bill as a work order instead']);
    await fillCardTime(card, 8);
    await submit(page);
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    const body = invoicePosts(feedRequests)[0].body;
    expect(body.manual_assignments).toEqual([expect.objectContaining({ assignment_id: ASSIGNMENT, hours: 8 })]);
    expect((body.extra_items || []).some((x) => x.row_type === 'work_order')).toBe(false);
  });

  test('the trade picking hours survives the saved draft', async ({ appPage: page }) => {
    const card = await openInvoice(page);
    await card.getByRole('button', { name: 'Bill by hours instead' }).click();
    await fillCardTime(card, 6);
    const stored = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((k) => k.indexOf('sw_inv_draft_') === 0);
      return key ? JSON.parse(sessionStorage.getItem(key)) : null;
    });
    expect(stored && stored.jobCards[0]).toMatchObject({ wo_mode: false, mode_picked: true, invoice_mode: 'work_order' });

    await page.reload();
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    const restored = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(restored.locator('[data-card-mode-label]')).toHaveText('Paid by the hour');
    await expect(restored.locator('[data-cardstart]')).toHaveValue('07:00');
    await expect(restored.locator('[data-cardwoalloc]')).toHaveCount(0);
  });
});

// Marnin, 12 Nov 2026: a fencing job with an approved job work order bills as
// a work order at the agreed amount. ops-api sends work_order_agreed_ex (ex
// GST) and job_work_order_id; the card shows the agreed amount read only, and
// the old "approved work order bills hours" rule no longer forces it to hours.
const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const AGREED = { invoice_mode: 'work_order', can_claim_commission: false, work_order_agreed_ex: 1850, job_work_order_id: 'jwo-1' };

// The job's approved work order, as my_job_work_order answers it: on its
// own it is what retired the typed box and forced hours.
async function approvedJobWorkOrder(page) {
  await page.route(`${OPS_API}**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') !== 'my_job_work_order') return route.fallback();
    const jobId = url.searchParams.get('job_id');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      schema: 'trade-job-work-order.v1', job_id: jobId, reason: null, can_report_variation: true, my_variations: [],
      work_order: { id: 'jwo-1', wo_number: 'WO-0042', status: 'approved', approved_at: '2026-10-13T05:00:00Z', job_id: jobId, job_number: 'SWF-26767', job_type: 'fencing', scope_items: [] },
    }) });
  });
}

test.describe('a work-order job with an agreed work order', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', appWeekDay: 6, ...PHONE,
    myHoursPatch: { assignments: { [ASSIGNMENT]: AGREED } } });

  test('bills the agreed amount, read only, less what was paid to other trades', async ({ appPage: page, feedRequests }) => {
    await approvedJobWorkOrder(page);
    const card = await openInvoice(page);
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Paid as a work order');
    await expect(card.locator('[data-card-wo-agreed]')).toContainText('Agreed work order $1850.00');
    await expect(card).toContainText('The work-order amount is agreed with the office.');
    await expect(card.locator('[data-cardwoalloc]')).toHaveCount(0);
    await expect(card.locator('[data-job-wo-invoice-note]')).toHaveCount(0);
    await expect(card.locator('[data-card-mode-switch]')).toHaveText(['Bill by hours instead']);

    // A fencing helper can still bill hours, and come back to the agreed amount.
    await card.getByRole('button', { name: 'Bill by hours instead' }).click();
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Paid by the hour');
    await card.getByRole('button', { name: 'Bill as a work order instead' }).click();
    await expect(card.locator('[data-card-wo-agreed]')).toContainText('$1850.00');

    await card.getByRole('button', { name: '+ Deduct work order paid to a trade' }).click();
    await card.locator('[data-cardwollname]').fill('Jose');
    await card.locator('[data-cardwollamt]').fill('350');
    await card.locator('[data-cardwollamt]').press('Tab');
    await submit(page);
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    const body = invoicePosts(feedRequests)[0].body;
    const wo = (body.extra_items || []).find((x) => x.row_type === 'work_order');
    expect(wo).toMatchObject({ wo_allocated: 1850, rate: 1500, job_id: 'e2e-wo-holder-job' });
    expect(body.manual_assignments || []).toEqual([]);
  });

  test('a saved draft takes the agreed amount from the server, never the one it kept', async ({ appPage: page }) => {
    const card = await openInvoice(page);
    await expect(card.locator('[data-card-wo-agreed]')).toContainText('$1850.00');
    // A stale draft: an old agreed figure, and a total typed against it.
    await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((k) => k.indexOf('sw_inv_draft_') === 0);
      const draft = JSON.parse(sessionStorage.getItem(key));
      Object.assign(draft.jobCards[0], { wo_mode: false, hours_mode_locked: true, wo_allocated: 9999, work_order_agreed_ex: 9999, agreed_applied: 9999 });
      sessionStorage.setItem(key, JSON.stringify(draft));
    });
    await page.reload();
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    const restored = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(restored.locator('[data-card-mode-label]')).toHaveText('Paid as a work order');
    await expect(restored.locator('[data-card-wo-agreed]')).toContainText('Agreed work order $1850.00');
    await expect(restored).not.toContainText('9999');
  });

  test('a refusal for an amount that is not the agreed one is shown in words and not queued', async ({ appPage: page, feedRequests }) => {
    await page.route(`${OPS_API}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') !== 'generate_trade_invoice' || route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
        ok: false, code: 'work_order_amount_not_agreed',
        error: 'SWF-26767 has an agreed work order of $1,850.00. Bill that amount, or bill your hours.',
      }) });
    });
    const card = await openInvoice(page);
    await expect(card.locator('[data-card-wo-agreed]')).toBeVisible();
    const hoursReadsBefore = feedRequests.filter((e) => e.action === 'my_hours').length;
    await submit(page);
    await expect(page.locator('#toast')).toContainText('has an agreed work order of $1,850.00');
    await expect(page.locator('#toast')).toContainText('Nothing was sent.');
    await expect(page.getByText('Invoice Submitted')).toHaveCount(0);
    await expect(page.locator('.jc-card').filter({ hasText: 'SWF-26767' })).toBeVisible();
    const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('sw_action_queue') || '[]'));
    expect(queued).toEqual([]);
    await expect.poll(() => feedRequests.filter((e) => e.action === 'my_hours').length).toBeGreaterThan(hoursReadsBefore);
  });
});

test.describe('an older ops-api with no agreed amount on a job with an approved work order', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', appWeekDay: 6, ...PHONE,
    myHoursPatch: { assignments: { [ASSIGNMENT]: { invoice_mode: 'work_order', can_claim_commission: false } } } });

  test('keeps today\'s rule: the card bills hours, with the note', async ({ appPage: page }) => {
    await approvedJobWorkOrder(page);
    const card = await openInvoice(page);
    await expect(card.locator('[data-job-wo-invoice-note]')).toBeVisible();
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Paid by the hour');
    await expect(card.locator('[data-cardwoalloc], [data-card-wo-agreed]')).toHaveCount(0);
  });
});

test.describe('a job paid through a group work order', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', appWeekDay: 6, ...PHONE,
    myHoursPatch: { assignments: { [ASSIGNMENT]: { invoice_mode: 'group_work_order', can_claim_commission: false } } } });

  test('goes to the group, with no hours, work-order or commission choice', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const card = page.locator('.jc-card[data-group-job-card="e2e-wo-holder-job"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-group-mode]')).toHaveText('Paid through the group work order');
    await expect(card).toContainText('Open the job to join or start its group, then add your hours there.');
    await expect(card.locator('[data-carddate], [data-cardwoalloc], [data-cardcommamt]')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Job details' })).toBeVisible();
    // A group job is never billed as an ordinary line on this invoice.
    expect(invoicePosts(feedRequests)).toEqual([]);
  });
});

test.describe('a job the trade searched in', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-multi-week', appWeekDay: 6, ...PHONE,
    invoiceJobModes: { 'e2e-admin-job-complete-fence': { invoice_mode: 'work_order', can_claim_commission: false } } });

  test('asks how the job is paid and opens the card in that mode', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.locator('#invoiceWeekContinue').click();
    await page.locator('button[onclick="jcOpenJobSearch(1)"]').click();
    await page.locator('#jcSearchInput_1').fill('SWF-26168');
    await page.locator('.jc-job-search-hit').filter({ hasText: 'SWF-26168' }).click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26168' });
    await expect(card.locator('[data-card-mode-label]')).toHaveText('Paid as a work order');
    await expect(card.locator('[data-cardwoalloc]')).toBeVisible();
    await expect(card.locator('[data-card-mode-switch]')).toHaveText(['Bill by hours instead']);
    const read = feedRequests.find((entry) => entry.action === 'trade_invoice_job_modes');
    expect(read.method).toBe('GET');
    expect(new URL(read.url).searchParams.get('job_ids')).toBe('e2e-admin-job-complete-fence');
  });
});

test.describe('an older ops-api with no job mode', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-multi-week', appWeekDay: 6, ...PHONE });

  test('a searched-in card keeps the Hours / Work Order / Commission toggle', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.locator('#invoiceWeekContinue').click();
    await page.locator('button[onclick="jcOpenJobSearch(1)"]').click();
    await page.locator('#jcSearchInput_1').fill('SWF-26168');
    await page.locator('.jc-job-search-hit').filter({ hasText: 'SWF-26168' }).click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26168' });
    for (const name of ['Hours', 'Work Order', 'Commission']) {
      await expect(card.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(card.locator('[data-card-mode-label]')).toHaveCount(0);
  });
});

test.describe('my_hours says the mode could not be worked out', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', appWeekDay: 6, ...PHONE,
    myHoursPatch: { top: { invoice_mode_unavailable: true }, assignments: { [ASSIGNMENT]: { invoice_mode: null, can_claim_commission: false } } } });

  test('the card keeps the toggle it always had', async ({ appPage: page }) => {
    const card = await openInvoice(page);
    for (const name of ['Hours', 'Work Order', 'Commission']) {
      await expect(card.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(page.locator('[data-invoice-cards-intro]')).toContainText('For each job, give the date you worked');
  });
});
