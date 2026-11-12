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
