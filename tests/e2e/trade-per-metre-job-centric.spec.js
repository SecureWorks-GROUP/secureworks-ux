const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

// Fixtures date work orders from perthWeekMonday(). A UTC browser after Perth
// Monday midnight filters that week out and the job-centric hydrate paints Hours.
test.use({ persona: 'fencing_manager', timezoneId: 'Australia/Perth' });

test('Henry Financial invoices jobs with WO-trade deducts and a 12% super preview', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();

  await expect(page.locator('[data-financial-hub]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weekly Invoice' })).toBeVisible();
  await expect(page.locator('[data-work-order-weekly-invoice]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'My Work Orders' })).toBeVisible();
  await expect(page.locator('[data-weekly-work-order]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  await expect(page.locator('#hoursContent')).toContainText('what SecureWorks owes you');

  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card).toBeVisible();
  await expect(page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' })).toHaveCount(1);
  await expect(card.getByRole('button', { name: 'Work Order', exact: true })).toBeVisible();
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(card.locator('[data-cardamt]')).toHaveText('$60.00');
  await expect(card).toContainText('WO trades [Israel $40]');
  await page.getByRole('button', { name: '+ Add labour line' }).click();
  await card.locator('[data-cardwollname]').nth(1).fill('Kim');
  await card.locator('[data-cardwollhours]').fill('1');
  await card.locator('[data-cardwollrate]').fill('20');
  await card.locator('[data-cardwollrate]').press('Tab');
  await page.evaluate(() => window.retryPerMetreWorkOrderHydrate());
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(card.locator('[data-cardwollname]').nth(1)).toHaveValue('Kim');
  await card.locator('[data-woll]').nth(1).getByRole('button').click();
  await expect(card.locator('[data-cardamt]')).toHaveText('$60.00');
  await expect(page.getByRole('button', { name: '+ Deduct work order paid to a trade' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add job' }).first()).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeEnabled();
  await page.getByRole('button', { name: '+ Add job' }).first().click();
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');

  await card.getByRole('button', { name: '+ Add amount' }).click();
  await card.locator('[data-cardlumpdesc]').fill('Materials');
  await card.locator('[data-cardlumpamt]').fill('10');
  await card.locator('[data-cardlumpamt]').press('Tab');
  await expect(card.locator('[data-cardamt]')).toHaveText('$50.00');
  await expect(card).toContainText('other [Materials $10]');

  const money = page.locator('[data-invoice-money-summary]');
  await expect(money).toContainText('Earned$50.00');
  await expect(money).toContainText('Less super (12%)−$6.00');
  await expect(money).toContainText('Net pay$44.00');

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();

  await page.getByRole('button', { name: 'My Work Orders' }).click();
  await expect(page.getByRole('heading', { name: 'My Work Orders' })).toBeVisible();
  await expect(page.locator('[data-work-order-card]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add to Weekly Invoice' })).toBeVisible();

  const hubReads = feedRequests.filter((entry) => entry.method === 'GET' && entry.action === 'my_work_orders');
  expect(hubReads.length).toBeGreaterThan(0);
  expect(hubReads.every((entry) => new URL(entry.url).searchParams.get('mode') === 'all')).toBe(true);
});

test('a failed work-order hydrate shows retry and still lets Hours submit', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();

  let failHydrate = true;
  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_work_orders' && failHydrate) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'work orders unavailable' })
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toBeVisible();
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toContainText('Could not load work-order amounts');
  const hoursCard = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(hoursCard.locator('[data-cardhours]')).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeEnabled();
  await expect(page.locator('[data-pm-wo-hydrate-submit-block]')).toHaveCount(0);

  failHydrate = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toHaveCount(0);
  await expect(page.locator('#invSubmitBtn')).toBeEnabled();
});

test('a partial work-order money payload keeps restored deductions and blocks WO submit', async ({ appPage: page }) => {
  const weekStart = perthWeekMonday();
  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_work_orders') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          work_orders: [{
            id: 'wo-fence-authorised',
            wo_number: 'WO-FENCE-001',
            job_id: 'fence-job-henry',
            job_number: 'FENCE-HENRY-001',
            client_name: 'Henry Client',
            job_type: 'fencing',
            status: 'complete',
            scheduled_date: addIsoDays(weekStart, 1),
            subtotal: 100,
            already_invoiced: false,
            can_invoice: true,
            can_add_to_weekly_invoice: true
          }]
        })
      });
      return;
    }
    await route.fallback();
  });

  await signIn(page, PERSONAS.fencing_manager);
  await page.evaluate(([start, end, jobDate]) => {
    sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-henry'), JSON.stringify({
      user_id: 'e2e-henry',
      is_per_metre: true,
      invoice_type: 'per_metre',
      jobCentric: true,
      jobCards: [{
        assignment_id: 'e2e-henry-assignment',
        job_id: 'fence-job-henry',
        job_number: 'FENCE-HENRY-001',
        client_name: 'Henry Client',
        scheduled_date: jobDate,
        included: true,
        wo_mode: true,
        work_order_id: 'wo-fence-authorised',
        wo_number: 'WO-FENCE-001',
        wo_allocated: 999,
        wo_labour_lines: [{
          trade_name: 'Old Israel',
          line_kind: 'wo_pass_through',
          amount: 99,
          source_line_id: 'wo-fence-charge-israel'
        }],
        hours: 8,
        rate: 55
      }],
      weekStart: start,
      weekEnd: end
    }));
  }, [weekStart, addIsoDays(weekStart, 6), addIsoDays(weekStart, 1)]);

  await page.locator('[data-view="hours"]').click();
  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toBeVisible();
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toContainText('Could not load work-order amounts');

  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('999');
  await expect(card.getByLabel('Work order amount paid to Old Israel')).toHaveValue('99');
  await expect(page.locator('#invSubmitBtn')).toBeDisabled();
  await expect(page.locator('[data-pm-wo-hydrate-submit-block]')).toBeVisible();
});

test('a truncated work-order listing keeps restored deductions and blocks WO submit', async ({ appPage: page }) => {
  const weekStart = perthWeekMonday();
  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_work_orders') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          truncated: true,
          work_orders: [{
            id: 'wo-other-page',
            wo_number: 'WO-OTHER',
            job_id: 'other-job',
            job_number: 'FENCE-OTHER-002',
            client_name: 'Other Client',
            job_type: 'fencing',
            status: 'complete',
            scheduled_date: addIsoDays(weekStart, 1),
            subtotal: 80,
            already_invoiced: false,
            can_invoice: true,
            can_add_to_weekly_invoice: true,
            negative_charges: []
          }]
        })
      });
      return;
    }
    await route.fallback();
  });

  await signIn(page, PERSONAS.fencing_manager);
  await page.evaluate(([start, end, jobDate]) => {
    sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-henry'), JSON.stringify({
      user_id: 'e2e-henry',
      is_per_metre: true,
      invoice_type: 'per_metre',
      jobCentric: true,
      jobCards: [{
        assignment_id: 'e2e-henry-assignment',
        job_id: 'fence-job-henry',
        job_number: 'FENCE-HENRY-001',
        client_name: 'Henry Client',
        scheduled_date: jobDate,
        included: true,
        wo_mode: true,
        work_order_id: 'wo-fence-authorised',
        wo_number: 'WO-FENCE-001',
        wo_allocated: 999,
        wo_labour_lines: [{
          trade_name: 'Old Israel',
          line_kind: 'wo_pass_through',
          amount: 99,
          source_line_id: 'wo-fence-charge-israel'
        }],
        hours: 8,
        rate: 55
      }],
      weekStart: start,
      weekEnd: end
    }));
  }, [weekStart, addIsoDays(weekStart, 6), addIsoDays(weekStart, 1)]);

  await page.locator('[data-view="hours"]').click();
  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  await expect(page.locator('[data-pm-wo-hydrate="error"]')).toBeVisible();

  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('999');
  await expect(card.getByLabel('Work order amount paid to Old Israel')).toHaveValue('99');
  await expect(page.locator('#invSubmitBtn')).toBeDisabled();
  await expect(page.locator('[data-pm-wo-hydrate-submit-block]')).toBeVisible();
});

test('My Work Orders and Work Order Invoice recover from a failed read', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();

  let failReads = true;
  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_work_orders' && failReads) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'work orders unavailable' })
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: 'My Work Orders' }).click();
  await expect(page.locator('[data-work-order-hub-error]')).toBeVisible();
  failReads = false;
  await page.locator('[data-work-order-hub-retry]').click();
  await expect(page.locator('[data-work-order-card]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();
  failReads = true;
  await page.locator('[data-work-order-weekly-invoice]').click();
  await expect(page.locator('[data-weekly-wo-load-error]')).toBeVisible();
  failReads = false;
  await page.locator('[data-weekly-wo-retry]').click();
  await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();
  await expect(page.locator('[data-weekly-work-order]')).toHaveCount(1);
});

test('a truncated work-order listing keeps the hub and weekly invoice on Retry', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();

  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_work_orders') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, truncated: true, work_orders: [] })
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: 'My Work Orders' }).click();
  await expect(page.locator('[data-work-order-hub-error]')).toBeVisible();
  await expect(page.locator('[data-work-order-card]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();
  await page.locator('[data-work-order-weekly-invoice]').click();
  await expect(page.locator('[data-weekly-wo-load-error]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toHaveCount(0);
});

test('job-centric WO allocations survive a Financial reload', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await card.getByRole('button', { name: '+ Add amount' }).click();
  await card.locator('[data-cardlumpdesc]').fill('Materials');
  await card.locator('[data-cardlumpamt]').fill('10');
  await card.locator('[data-cardlumpamt]').press('Tab');
  await expect(card.locator('[data-cardamt]')).toHaveText('$50.00');
  const draft = await page.evaluate(() => {
    const key = 'sw_inv_draft_' + encodeURIComponent('e2e-henry');
    return JSON.parse(sessionStorage.getItem(key) || sessionStorage.getItem('sw_inv_draft') || 'null');
  });
  expect(draft && draft.is_per_metre).toBe(true);
  expect(draft.user_id).toBe('e2e-henry');
  expect(Array.isArray(draft.jobCards) && draft.jobCards.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => sessionStorage.getItem('sw_inv_draft'))).toBeNull();

  await page.reload();
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  const restored = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(restored.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(restored.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(restored.locator('[data-cardlumpdesc]')).toHaveValue('Materials');
  await expect(restored.locator('[data-cardlumpamt]')).toHaveValue('10');
  await expect(restored.locator('[data-cardamt]')).toHaveText('$50.00');
});

test('an invoice draft from another account is not restored', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.evaluate(() => {
    const leak = {
      user_id: 'other-user',
      jobCards: [{ job_number: 'LEAK-JOB', included: true, wo_mode: true, wo_allocated: 99 }],
      is_per_metre: true
    };
    sessionStorage.setItem('sw_inv_draft', JSON.stringify(leak));
    sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('other-user'), JSON.stringify(leak));
  });
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invoice' })).toHaveCount(0);
  await expect(page.locator('#hoursContent')).not.toContainText('LEAK-JOB');
});

test('Hours typed while hydrate is pending stay Hours after the WO arrives', async ({ appPage: page }) => {
  let releaseHydrate;
  const holdHydrate = new Promise((resolve) => { releaseHydrate = resolve; });
  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_work_orders') {
      await holdHydrate;
    }
    await route.fallback();
  });

  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toBeVisible();
  await expect(card.locator('[data-cardhours]')).toBeVisible();
  await card.locator('[data-cardhours]').evaluate((el) => {
    el.focus();
    el.value = '3';
  });
  releaseHydrate();

  await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);
  await expect(card.locator('[data-cardhours]')).toHaveValue('3');
  await expect(card.locator('[data-cardwoalloc]')).toHaveCount(0);
  await card.getByRole('button', { name: 'Work Order', exact: true }).click();
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
});

test.describe('same job on two days', () => {
  test.use({ feedScenario: 'henry-same-job-two-days' });

  test('a work order does not bind to a later day of the same job', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: 'Weekly Invoice' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    const woCard = page.locator('.jc-card').filter({ hasText: 'WO-FENCE-001' });
    const hoursCard = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' }).filter({ hasNotText: 'WO-FENCE-001' });
    await expect(page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' })).toHaveCount(2);
    await expect(woCard.locator('[data-cardwoalloc]')).toHaveValue('100');
    await expect(hoursCard.locator('[data-cardhours]')).toBeVisible();
    await expect(hoursCard.locator('[data-cardwoalloc]')).toHaveCount(0);
  });
});

test('an empty work-order week offers the job-centric invoice builder', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.locator('[data-work-order-weekly-invoice]').click();
  await expect(page.getByRole('heading', { name: 'Weekly Invoice' })).toBeVisible();

  await page.getByRole('button', { name: 'Next invoice week' }).click();
  await expect(page.getByText('No completed work orders available for this week')).toBeVisible();
  await page.locator('[data-invoice-jobs-instead]').click();

  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  await expect(page.locator('#hoursContent')).toContainText('Your jobs this week');
  await expect(page.getByRole('button', { name: '+ Add job' }).first()).toBeVisible();
});

test.describe('Henry job-centric submit', () => {
  test.use({ feedScenario: 'henry-job-centric-submit' });

  test('Henry can add any searchable job on a chosen day without completing it', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: 'Weekly Invoice' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
    await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);

    await page.getByRole('button', { name: '+ Add job' }).first().click();
    await page.locator('#jcSearchInput_0').fill('FENCE-ANY');
    await expect(page.locator('.jc-job-search-hit')).toContainText('FENCE-ANY-002');
    await page.locator('.jc-job-search-hit').first().click();

    const anyCard = page.locator('.jc-card').filter({ hasText: 'FENCE-ANY-002' });
    await expect(anyCard).toBeVisible();
    await expect(anyCard.getByRole('button', { name: 'Work Order', exact: true })).toBeDisabled();
    await anyCard.locator('[data-cardhours]').fill('2');
    await anyCard.locator('[data-cardrate]').fill('55');
    await anyCard.locator('input[placeholder="Description of work"]').fill('Install extra panels');
    await anyCard.locator('input[placeholder="Description of work"]').press('Tab');

    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(writes.length).toBe(1);
    const extras = writes[0].body.extra_items || [];
    const added = extras.find((item) => /FENCE-ANY-002/.test(item.job_number || item.description || ''));
    expect(added).toBeTruthy();
    expect(added.job_id).toBe('e2e-fence-any-job');
    expect(added.assignment_id == null).toBeTruthy();
    expect(added.manually_added).toBe(true);
    expect(added.date || added.scheduled_date).toBe(perthWeekMonday());
    expect(Number(added.quantity || added.hours)).toBe(2);
    expect(Number(added.rate)).toBe(55);
  });

  test('Henry weekly submit keeps invoice-level lump-sum deducts without a job', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: 'Weekly Invoice' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);
    await expect(page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' })).toBeVisible();

    await page.locator('#btnAddInvLump').click();
    await page.locator('.inv-lump-desc').fill('Fuel / materials');
    await page.locator('.inv-lump-amt').fill('25');
    await page.locator('.inv-lump-amt').press('Tab');
    const money = page.locator('[data-invoice-money-summary]');
    await expect(money).toContainText('Earned$35.00');

    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(writes.length).toBe(1);
    const body = writes[0].body;
    const lump = (body.extra_items || []).find((item) => item.source === 'invoice_final_deduction' || item.line_kind === 'lump_sum');
    expect(lump).toBeTruthy();
    expect(lump.rate).toBe(-25);
    expect(lump.job_id == null).toBeTruthy();
    expect(lump.description).toBe('Fuel / materials');
    expect(body.final_deductions).toEqual([
      { description: 'Fuel / materials', quantity: 1, unit: 'ea', unit_rate: 25 }
    ]);
    const woExtra = (body.extra_items || []).find((item) => item.row_type === 'work_order');
    expect(woExtra).toBeTruthy();
    expect(woExtra.wo_labour_lines).toEqual([
      { trade_name: 'Israel', hours: 1, rate: 40, amount: 40 }
    ]);
    expect(woExtra).not.toHaveProperty('wo_lump_lines');
    expect(woExtra).not.toHaveProperty('wo_lump_deduction');
    expect(body).not.toHaveProperty('grand_total');
    expect(body).not.toHaveProperty('super_amount');
  });

  test('job-centric generate fails closed when the exclusive re-read loses can_invoice', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: 'Weekly Invoice' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);
    const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
    await expect(card).toBeVisible();
    await expect(page.locator('#invSubmitBtn')).toBeEnabled();

    let exclusive = true;
    await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'my_work_orders' && !exclusive) {
        // Fulfill the listing here — route.fetch() bypasses the feed stub and
        // would drop wo-fence-authorised, which reads as a missing-WO week miss.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            work_orders: [{
              id: 'wo-fence-authorised',
              wo_number: 'WO-FENCE-001',
              job_id: 'fence-job-henry',
              job_number: 'FENCE-HENRY-001',
              client_name: 'Henry Client',
              job_type: 'fencing',
              status: 'complete',
              scheduled_date: perthWeekMonday(),
              subtotal: 100,
              already_invoiced: true,
              can_invoice: false,
              can_add_to_weekly_invoice: false,
              negative_charges: [{
                line_id: 'wo-fence-charge-israel',
                trade_name: 'Israel',
                amount_ex: -40
              }]
            }]
          })
        });
        return;
      }
      await route.fallback();
    });

    exclusive = false;
    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#toast')).toContainText('already been invoiced');
    await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
    await expect(card.locator('[data-wo-block]')).toContainText('already been invoiced');
    expect(feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST').length).toBe(0);
  });
});

test.describe('Henry Hours submit after hydrate fail', () => {
  test.use({ feedScenario: 'henry-wo-hydrate-fail' });

  test('Hours path still submits when work-order hydrate fails', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: 'Weekly Invoice' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('[data-pm-wo-hydrate="error"]')).toBeVisible();

    const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
    await expect(card.locator('[data-cardhours]')).toBeVisible();
    await card.locator('[data-cardhours]').fill('3');
    await card.locator('[data-cardrate]').fill('55');
    await expect(page.locator('#invSubmitBtn')).toBeEnabled();

    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(writes.length).toBe(1);
    const body = writes[0].body;
    expect(body.manual_assignments).toEqual([
      expect.objectContaining({
        assignment_id: 'e2e-henry-assignment',
        hours: 3,
        rate: 55
      })
    ]);
    const woExtra = (body.extra_items || []).find((item) => item.row_type === 'work_order');
    expect(woExtra).toBeFalsy();
  });
});

test('a late invoice history response does not paint after logout', async ({ appPage: page }) => {
  let releaseHistory;
  const holdHistory = new Promise((resolve) => { releaseHistory = resolve; });
  let fulfilled = 0;
  await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') === 'my_trade_invoices') {
      await holdHistory;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          invoices: [{
            id: 'henry-leak-invoice',
            invoice_number: 'HENRY-LEAK-INV',
            week_ending: addIsoDays(perthWeekMonday(), 6),
            status: 'submitted',
            total: 99
          }]
        })
      });
      fulfilled += 1;
      return;
    }
    await route.fallback();
  });

  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();
  await page.getByRole('button', { name: 'View All' }).click();
  await page.evaluate(() => window.doLogout());
  await expect(page.locator('#viewLogin')).toBeVisible();
  releaseHistory();
  await expect.poll(() => fulfilled).toBeGreaterThan(0);
  await expect(page.locator('#hoursContent')).not.toContainText('HENRY-LEAK-INV');
  await expect(page.locator('#viewLogin')).toBeVisible();
});

test('a queued invoice from another account is not replayed after sign-in', async ({ appPage: page, feedRequests }) => {
  await page.evaluate(() => {
    localStorage.setItem('sw_action_queue', JSON.stringify([
      {
        action: 'generate_trade_invoice',
        user_id: 'other-trade',
        ts: new Date().toISOString(),
        body: {
          week_start: '2026-01-05',
          extra_items: [],
          final_deductions: [{ description: 'CROSS-ACCOUNT-LEAK', quantity: 1, unit: 'ea', unit_rate: 99 }],
          gst_on: false
        }
      },
      {
        action: 'generate_trade_invoice',
        ts: new Date().toISOString(),
        body: {
          week_start: '2026-01-05',
          extra_items: [],
          final_deductions: [{ description: 'UNSTAMPED-LEAK', quantity: 1, unit: 'ea', unit_rate: 50 }],
          gst_on: false
        }
      },
      {
        action: 'update_job_phase',
        ts: new Date().toISOString(),
        body: { assignmentId: 'keep-phase', phase: 'on_site' }
      }
    ]));
  });

  await signIn(page, PERSONAS.fencing_manager);

  const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('sw_action_queue') || '[]'));
  expect(queue.some((item) => item.action === 'generate_trade_invoice')).toBe(false);
  expect(queue.some((item) => item.action === 'update_job_phase')).toBe(true);

  const invoiceWrites = feedRequests.filter((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
  expect(invoiceWrites.some((entry) => JSON.stringify(entry.body || {}).includes('CROSS-ACCOUNT-LEAK'))).toBe(false);
  expect(invoiceWrites.some((entry) => JSON.stringify(entry.body || {}).includes('UNSTAMPED-LEAK'))).toBe(false);
});

test.describe('stale restored work-order id', () => {
  test.use({ feedScenario: 'henry-job-centric-submit' });

  test('a restored work-order id stays blocked unless the current hydrate authorizes it', async ({ appPage: page, feedRequests }) => {
    const weekStart = perthWeekMonday();
    await signIn(page, PERSONAS.fencing_manager);
    await page.evaluate(([start, end]) => {
      sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-henry'), JSON.stringify({
        user_id: 'e2e-henry',
        is_per_metre: true,
        invoice_type: 'per_metre',
        jobCentric: true,
        jobCards: [{
          job_id: 'stale-job',
          job_number: 'FENCE-STALE-009',
          client_name: 'Stale Client',
          scheduled_date: start,
          included: true,
          wo_mode: true,
          work_order_id: 'wo-stale-not-authorized',
          wo_number: 'WO-STALE',
          wo_allocated: 99,
          wo_labour_lines: [],
          hours: 2,
          rate: 55,
          description: 'stale wo hours',
          manually_added: true
        }],
        weekStart: start,
        weekEnd: end
      }));
    }, [weekStart, addIsoDays(weekStart, 6)]);

    await page.locator('[data-view="hours"]').click();
    await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
    await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);

    const stale = page.locator('.jc-card').filter({ hasText: 'FENCE-STALE-009' });
    await expect(stale).toBeVisible();
    await expect(stale.locator('[data-wo-block]')).toBeVisible();
    await expect(stale.locator('[data-wo-block]')).toContainText('not available to invoice this week');
    await expect(stale.locator('[data-cardwoalloc]')).toHaveValue('99');
    await expect(stale.getByRole('button', { name: 'Hours', exact: true })).toBeDisabled();
    await expect(stale.locator('[data-cardhours]')).toHaveCount(0);
    await expect(page.locator('#invSubmitBtn')).toBeDisabled();
    await expect(page.locator('[data-wo-submit-block]')).toBeVisible();

    const beforeAck = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(beforeAck.length).toBe(0);

    await stale.locator('[data-wo-hours-ack]').click();
    await expect(stale.locator('[data-wo-block]')).toHaveCount(0);
    await expect(stale.locator('[data-cardhours]')).toHaveValue('2');

    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(writes.length).toBe(1);
    const extras = writes[0].body.extra_items || [];
    expect(extras.some((item) => item.work_order_id === 'wo-stale-not-authorized')).toBe(false);
    const added = extras.find((item) => item.job_number === 'FENCE-STALE-009');
    expect(added).toBeTruthy();
    expect(added.row_type).toBe('labour');
    expect(added.manually_added).toBe(true);
  });
});

test('hydrate overwrites stale allocated money and rematches server pass-throughs', async ({ appPage: page }) => {
  const weekStart = perthWeekMonday();
  await signIn(page, PERSONAS.fencing_manager);
  await page.evaluate(([start, end, jobDate]) => {
    sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-henry'), JSON.stringify({
      user_id: 'e2e-henry',
      is_per_metre: true,
      invoice_type: 'per_metre',
      jobCentric: true,
      jobCards: [{
        assignment_id: 'e2e-henry-assignment',
        job_id: 'fence-job-henry',
        job_number: 'FENCE-HENRY-001',
        client_name: 'Henry Client',
        scheduled_date: jobDate,
        included: true,
        wo_mode: true,
        work_order_id: 'wo-fence-authorised',
        wo_number: 'WO-FENCE-001',
        wo_allocated: 999,
        wo_labour_lines: [{
          trade_name: 'Old Israel',
          line_kind: 'wo_pass_through',
          amount: 99,
          source_line_id: 'wo-fence-charge-israel'
        }, {
          trade_name: 'Stale',
          line_kind: 'wo_pass_through',
          amount: 77,
          source_line_id: 'wo-stale-old-line'
        }],
        wo_lump_lines: [{ description: 'Materials', amount: 10 }],
        hours: 8,
        rate: 55
      }],
      weekStart: start,
      weekEnd: end
    }));
  }, [weekStart, addIsoDays(weekStart, 6), addIsoDays(weekStart, 1)]);

  await page.locator('[data-view="hours"]').click();
  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
  await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);

  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
  await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
  await expect(card.locator('[data-cardlumpdesc]')).toHaveValue('Materials');
  await expect(card.locator('[data-cardlumpamt]')).toHaveValue('10');
  await expect(card.locator('[data-cardamt]')).toHaveText('$50.00');
  await expect(card).not.toContainText('Stale');
  await expect(card).not.toContainText('$999');
});

test.describe('already-invoiced work order stays blocked', () => {
  test.use({ feedScenario: 'henry-job-centric-submit' });

  test('a restored already-invoiced work order does not convert to Hours', async ({ appPage: page, feedRequests }) => {
    const weekStart = perthWeekMonday();
    const jobDate = addIsoDays(weekStart, 1);
    await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'my_work_orders') {
        const response = await route.fetch();
        const body = await response.json();
        const extra = {
          id: 'wo-already-invoiced',
          wo_number: 'WO-ALREADY',
          job_id: 'fence-job-already',
          job_number: 'FENCE-ALREADY-009',
          client_name: 'Already Client',
          job_type: 'fencing',
          status: 'complete',
          scheduled_date: jobDate,
          subtotal: 80,
          already_invoiced: true,
          can_invoice: false,
          can_add_to_weekly_invoice: false,
          negative_charges: [{ amount: 40, trade_name: 'Israel', source_line_id: 'wo-already-israel' }]
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Object.assign({}, body, {
            work_orders: (body.work_orders || []).concat([extra])
          }))
        });
        return;
      }
      await route.fallback();
    });

    await signIn(page, PERSONAS.fencing_manager);
    await page.evaluate(([start, end, date]) => {
      sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-henry'), JSON.stringify({
        user_id: 'e2e-henry',
        is_per_metre: true,
        invoice_type: 'per_metre',
        jobCentric: true,
        jobCards: [{
          job_id: 'fence-job-already',
          job_number: 'FENCE-ALREADY-009',
          client_name: 'Already Client',
          scheduled_date: date,
          included: true,
          wo_mode: true,
          work_order_id: 'wo-already-invoiced',
          wo_number: 'WO-ALREADY',
          wo_allocated: 80,
          wo_labour_lines: [{
            trade_name: 'Israel',
            line_kind: 'wo_pass_through',
            amount: 40,
            source_line_id: 'wo-already-israel'
          }],
          hours: 3,
          rate: 55,
          description: 'already invoiced hours',
          manually_added: true
        }],
        weekStart: start,
        weekEnd: end
      }));
    }, [weekStart, addIsoDays(weekStart, 6), jobDate]);

    await page.locator('[data-view="hours"]').click();
    await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
    await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);

    const card = page.locator('.jc-card').filter({ hasText: 'FENCE-ALREADY-009' });
    await expect(card.locator('[data-wo-block]')).toContainText('already been invoiced');
    await expect(card.locator('[data-cardwoalloc]')).toHaveValue('80');
    await expect(card.getByLabel('Work order amount paid to Israel')).toHaveValue('40');
    await expect(card.locator('[data-cardhours]')).toHaveCount(0);
    await expect(page.locator('#invSubmitBtn')).toBeDisabled();
    expect(feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST').length).toBe(0);
  });
});

test.describe('hydrate ignores out-of-week work orders', () => {
  test.use({ feedScenario: 'henry-job-centric-submit' });

  test('a restored out-of-week work-order id stays blocked until hours are confirmed', async ({ appPage: page, feedRequests }) => {
    const weekStart = perthWeekMonday();
    const lastWeek = addIsoDays(weekStart, -7);
    await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'my_work_orders') {
        const response = await route.fetch();
        const body = await response.json();
        const extra = {
          id: 'wo-fence-last-week',
          wo_number: 'WO-FENCE-LAST',
          job_id: 'fence-job-last',
          job_number: 'FENCE-LAST-009',
          client_name: 'Last Week Client',
          job_type: 'fencing',
          status: 'complete',
          scheduled_date: lastWeek,
          subtotal: 250,
          already_invoiced: false,
          can_invoice: true,
          can_add_to_weekly_invoice: true,
          negative_charges: []
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(Object.assign({}, body, {
            work_orders: (body.work_orders || []).concat([extra])
          }))
        });
        return;
      }
      await route.fallback();
    });

    await signIn(page, PERSONAS.fencing_manager);
    await page.evaluate(([start, end, last]) => {
      sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-henry'), JSON.stringify({
        user_id: 'e2e-henry',
        is_per_metre: true,
        invoice_type: 'per_metre',
        jobCentric: true,
        jobCards: [{
          job_id: 'fence-job-last',
          job_number: 'FENCE-LAST-009',
          client_name: 'Last Week Client',
          scheduled_date: last,
          included: true,
          wo_mode: true,
          work_order_id: 'wo-fence-last-week',
          wo_number: 'WO-FENCE-LAST',
          wo_allocated: 250,
          wo_labour_lines: [],
          hours: 2,
          rate: 55,
          description: 'last week wo',
          manually_added: true
        }],
        weekStart: start,
        weekEnd: end
      }));
    }, [weekStart, addIsoDays(weekStart, 6), lastWeek]);

    await page.locator('[data-view="hours"]').click();
    await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();
    await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);

    const stale = page.locator('.jc-card').filter({ hasText: 'FENCE-LAST-009' });
    await expect(stale).toBeVisible();
    await expect(stale.locator('[data-wo-block]')).toBeVisible();
    await expect(stale.locator('[data-wo-block]')).toContainText('not available to invoice this week');
    await expect(stale.locator('[data-cardwoalloc]')).toHaveValue('250');
    await expect(stale.locator('[data-cardhours]')).toHaveCount(0);
    await expect(page.locator('#invSubmitBtn')).toBeDisabled();

    await stale.locator('[data-wo-hours-ack]').click();
    await expect(stale.locator('[data-cardhours]')).toHaveValue('2');

    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(writes.length).toBe(1);
    const extras = writes[0].body.extra_items || [];
    expect(extras.some((item) => item.work_order_id === 'wo-fence-last-week')).toBe(false);
    const added = extras.find((item) => item.job_number === 'FENCE-LAST-009');
    expect(added).toBeTruthy();
    expect(added.row_type).toBe('labour');
  });
});
