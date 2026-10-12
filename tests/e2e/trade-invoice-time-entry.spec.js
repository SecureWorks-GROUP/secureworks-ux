// Trades say WHEN they worked when they invoice (Captain, 2026-10-12).
//
// Every line of hours carries the date worked, a start and a finish time (and
// an optional break). Hours are worked out and never typed. The rules and the
// exact payload shape are pinned in scripts/test-trade-time-entry.js against
// the shipped code; this spec proves a trade on a phone meets them on the
// real screens, through the real inputs.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function openHenryBuilder(page) {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' }).first();
  await expect(card.locator('[data-cardstart]')).toBeVisible();
  return card;
}

async function confirmSubmit(page) {
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();
}

function invoicePosts(feedRequests) {
  return feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
}

test.describe('weekly invoice: a line of hours says when it was worked', () => {
  test.use({ persona: 'fencing_manager', feedScenario: 'henry-wo-hydrate-fail', timezoneId: 'Australia/Perth', appWeekDay: 6, ...PHONE });

  test('date, start and finish are required, hours are worked out, and the fields are posted as the contract names them', async ({ appPage: page, feedRequests }) => {
    const jobDate = addIsoDays(perthWeekMonday(), 1);
    const card = await openHenryBuilder(page);

    // No hours figure to type: the card shows a calculated, read-only figure.
    await expect(card.locator('input[data-cardhours]')).toHaveCount(0);
    await expect(card.locator('[data-cardhours]')).toHaveText('0 hrs');
    await expect(card.locator('[data-carddate]')).toHaveValue(jobDate);
    await expect(card.locator('[data-carddate]')).toHaveAttribute('type', 'date');
    await expect(card.locator('[data-cardstart]')).toHaveAttribute('type', 'time');
    await expect(card.locator('[data-cardfinish]')).toHaveAttribute('type', 'time');
    for (const field of ['[data-carddate]', '[data-cardstart]', '[data-cardfinish]', '[data-cardbreak]']) {
      const box = await card.locator(field).boundingBox();
      expect(box.height, field + ' is a thumb-sized target').toBeGreaterThanOrEqual(44);
    }

    // Nothing entered: nothing is sent, and the card says what it needs.
    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('FENCE-HENRY-001: add the date, start time and finish time you worked');
    expect(invoicePosts(feedRequests)).toEqual([]);

    // A start with no finish is not hours.
    await card.locator('[data-cardstart]').fill('07:00');
    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('FENCE-HENRY-001: Add your finish time.');
    await expect(card.locator('[data-cardtimeerr]')).toHaveText('Add your finish time.');
    expect(invoicePosts(feedRequests)).toEqual([]);

    // Finish must be after start on the same day.
    await card.locator('[data-cardfinish]').fill('06:00');
    await expect(card.locator('[data-cardtimeerr]')).toContainText('Finish time must be after start time');
    await expect(card.locator('[data-cardhours]')).toHaveText('0 hrs');
    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('Finish time must be after start time');
    expect(invoicePosts(feedRequests)).toEqual([]);

    // Hours are finish minus start minus break, at the office rate.
    await card.locator('[data-cardfinish]').fill('15:30');
    await expect(card.locator('[data-cardhours]')).toHaveText('8.5 hrs');
    await card.locator('[data-cardbreak]').fill('30');
    await card.locator('[data-cardbreak]').blur();
    await expect(card.locator('[data-cardhours]')).toHaveText('8 hrs');
    await expect(card.locator('[data-cardtimeerr]')).toBeHidden();
    await expect(card.locator('[data-cardamt]')).toHaveText('$440.00');

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    const posts = invoicePosts(feedRequests);
    expect(posts).toHaveLength(1);
    expect(posts[0].body.manual_assignments).toEqual([{
      assignment_id: 'e2e-henry-assignment',
      hours: 8,
      work_date: jobDate,
      start_time: '07:00',
      finish_time: '15:30',
      break_minutes: 30,
      rate: 55,
      rate_source: 'server_resolved',
      description: '',
      manually_added: false
    }]);
  });

  test('the server refusing a line with no times reads in plain words and keeps the form', async ({ appPage: page }) => {
    let refused = 0;
    const card = await openHenryBuilder(page);
    await page.route(`${OPS_API}**`, async (route) => {
      if (new URL(route.request().url()).searchParams.get('action') !== 'generate_trade_invoice') return route.fallback();
      refused += 1;
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'time_entry_required', error: 'time_entry_required' }) });
    });
    await card.locator('[data-cardstart]').fill('07:00');
    await card.locator('[data-cardfinish]').fill('15:00');
    await confirmSubmit(page);

    await expect(page.locator('#toast')).toContainText('Every line of hours needs the date you worked, a start time and a finish time');
    await expect(page.locator('#toast')).not.toContainText('time_entry_required');
    expect(refused).toBe(1);
    await expect(page.getByText('Invoice Submitted')).toHaveCount(0);
    await expect(page.locator('#invSubmitBtn')).toBeVisible();
    await expect(page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' }).first().locator('[data-cardfinish]')).toHaveValue('15:00');
    // A refusal is an answer, not a dropped connection: nothing is parked to resend.
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /queue|inbox/i.test(k)).map((k) => localStorage.getItem(k)).join('')))
      .not.toContain('generate_trade_invoice');
  });
});

test.describe('weekly invoice: the date worked cannot be after today', () => {
  // The app's clock is on the Monday; Henry's job is scheduled for the Tuesday.
  test.use({ persona: 'fencing_manager', feedScenario: 'henry-wo-hydrate-fail', timezoneId: 'Australia/Perth', appWeekDay: 0, ...PHONE });

  test('a job card dated after today is not sent until its date is today or earlier', async ({ appPage: page, feedRequests }) => {
    const today = perthWeekMonday();
    const card = await openHenryBuilder(page);
    await expect(card.locator('[data-carddate]')).toHaveValue(addIsoDays(today, 1));
    await expect(card.locator('[data-carddate]')).toHaveAttribute('max', today);

    await card.locator('[data-cardstart]').fill('07:00');
    await card.locator('[data-cardfinish]').fill('15:00');
    await expect(card.locator('[data-cardtimeerr]')).toHaveText('The date worked cannot be after today.');
    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('FENCE-HENRY-001: The date worked cannot be after today.');
    expect(invoicePosts(feedRequests)).toEqual([]);

    await card.locator('[data-carddate]').fill(today);
    await expect(card.locator('[data-cardtimeerr]')).toBeHidden();
    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-henry-assignment', hours: 8, work_date: today, start_time: '07:00', finish_time: '15:00' })
    ]);
  });

  test('an Extras row dated after today is not sent', async ({ appPage: page, feedRequests }) => {
    const today = perthWeekMonday();
    const card = await openHenryBuilder(page);
    await card.locator('[data-carddate]').fill(today);
    await card.locator('[data-cardstart]').fill('07:00');
    await card.locator('[data-cardfinish]').fill('15:00');

    await page.getByRole('button', { name: '+ Add extra / adjustment' }).click();
    await expect(page.locator('#ir_date_0')).toHaveValue(today);
    await expect(page.locator('#ir_date_0')).toHaveAttribute('max', today);
    await page.locator('#ir_desc_0').fill('Second day on the job');
    await page.locator('#ir_date_0').fill(addIsoDays(today, 2));
    await page.locator('#ir_start_0').fill('08:00');
    await page.locator('#ir_fin_0').fill('12:00');
    await expect(page.locator('#ir_timeerr_0')).toHaveText('The date worked cannot be after today.');
    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('The date worked cannot be after today.');
    expect(invoicePosts(feedRequests)).toEqual([]);
  });
});

test.describe('weekly invoice: a job with hours on record and a clock on and off', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', timezoneId: 'Australia/Perth', appWeekDay: 6, ...PHONE });

  test('opens blank with the hours on record as a reminder, and bills only the times the trade types', async ({ appPage: page, feedRequests }) => {
    const jobDate = addIsoDays(perthWeekMonday(), 1);
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });

    // The fixture clocks this job 07:00 to 15:00 with 8 hrs on record. None of
    // it is carried onto the card.
    await expect(card.locator('[data-carddate]')).toHaveValue(jobDate);
    await expect(card.locator('[data-cardstart]')).toHaveValue('');
    await expect(card.locator('[data-cardfinish]')).toHaveValue('');
    await expect(card.locator('[data-cardhours]')).toHaveText('0 hrs');
    await expect(card.locator('[data-cardtimehint]')).toHaveText('8 hrs on record for this job. Add the times you worked.');

    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('SWF-26767: add the date, start time and finish time you worked');
    expect(invoicePosts(feedRequests)).toEqual([]);

    await card.locator('[data-cardstart]').fill('07:30');
    await card.locator('[data-cardfinish]').fill('09:30');
    await card.locator('[data-cardfinish]').blur();
    await expect(card.locator('[data-cardhours]')).toHaveText('2 hrs');
    await expect(card.locator('[data-cardtimehint]')).toBeHidden();

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 2, work_date: jobDate, start_time: '07:30', finish_time: '09:30', break_minutes: 0 })
    ]);
  });
});
