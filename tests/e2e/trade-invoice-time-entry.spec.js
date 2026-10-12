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
  test.use({ persona: 'fencing_manager', feedScenario: 'henry-wo-hydrate-fail', timezoneId: 'Australia/Perth', ...PHONE });

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

  test('a second day on the same job is a second line, added from the card', async ({ appPage: page, feedRequests }) => {
    const weekStart = perthWeekMonday();
    const jobDate = addIsoDays(weekStart, 1);
    const secondDay = addIsoDays(weekStart, 2);
    const card = await openHenryBuilder(page);
    await card.locator('[data-cardstart]').fill('07:00');
    await card.locator('[data-cardfinish]').fill('15:00');

    await card.getByRole('button', { name: '+ Add another day on this job' }).click();
    const cards = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
    const second = cards.filter({ hasText: 'Another day you added' });
    await expect(second).toHaveCount(1);
    // The new line opens with no date: the trade says which day it was.
    await expect(second.locator('[data-carddate]')).toHaveValue('');
    // What was typed on the first card is still there.
    await expect(cards.first().locator('[data-cardfinish]')).toHaveValue('15:00');

    // One line is one job on one day: the same day again is refused.
    await second.locator('[data-carddate]').fill(jobDate);
    await expect(page.locator('#toast')).toContainText('That job already has a line for that day');
    await expect(second.locator('[data-carddate]')).toHaveValue('');

    await second.locator('[data-carddate]').fill(secondDay);
    const moved = page.locator('.jc-card').filter({ hasText: 'Another day you added' });
    await moved.locator('[data-cardstart]').fill('08:00');
    await moved.locator('[data-cardfinish]').fill('12:00');
    await moved.locator('[data-cardfinish]').blur();
    await expect(moved.locator('[data-cardhours]')).toHaveText('4 hrs');

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    const body = invoicePosts(feedRequests)[0].body;
    expect(body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-henry-assignment', hours: 8, work_date: jobDate, start_time: '07:00', finish_time: '15:00', break_minutes: 0 })
    ]);
    // The added day has no assignment row of its own, so it rides the
    // office-verified extras lane with the same four fields.
    expect(body.extra_items).toEqual([
      expect.objectContaining({
        type: 'Labour', unit: 'hr', quantity: 4, rate: 55, source: 'extra_day',
        job_id: 'fence-job-henry', job_number: 'FENCE-HENRY-001',
        date: secondDay, work_date: secondDay, start_time: '08:00', finish_time: '12:00', break_minutes: 0
      })
    ]);
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

test.describe('weekly invoice: times already given are not asked for twice', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', timezoneId: 'Australia/Perth', ...PHONE });

  async function openInstallerBuilder(page, seed) {
    await signIn(page, PERSONAS.installer);
    if (seed) await page.evaluate(seed.fn, seed.arg);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(card.locator('[data-cardstart]')).toBeVisible();
    return card;
  }

  test('a job clocked on and off opens on those times', async ({ appPage: page, feedRequests }) => {
    const jobDate = addIsoDays(perthWeekMonday(), 1);
    const card = await openInstallerBuilder(page);
    await expect(card.locator('[data-carddate]')).toHaveValue(jobDate);
    await expect(card.locator('[data-cardstart]')).toHaveValue('07:00');
    await expect(card.locator('[data-cardfinish]')).toHaveValue('15:00');
    await expect(card.locator('[data-cardhours]')).toHaveText('8 hrs');
    await expect(card.locator('[data-cardtimehint]')).toHaveText('From your clock on and off. Change it if it is wrong.');

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 8, work_date: jobDate, start_time: '07:00', finish_time: '15:00', break_minutes: 0 })
    ]);
  });

  test('times the trade gave on the job view carry onto that job\'s card', async ({ appPage: page }) => {
    const jobDate = addIsoDays(perthWeekMonday(), 1);
    const card = await openInstallerBuilder(page, {
      arg: jobDate,
      fn: (day) => localStorage.setItem('sw_time_job_' + encodeURIComponent('e2e-installer'), JSON.stringify({
        'e2e-wo-holder-job': { work_date: day, start_time: '06:30', finish_time: '15:00', break_minutes: 30, hours: 8, at: Date.now() }
      }))
    });
    await expect(card.locator('[data-cardstart]')).toHaveValue('06:30');
    await expect(card.locator('[data-cardfinish]')).toHaveValue('15:00');
    await expect(card.locator('[data-cardbreak]')).toHaveValue('30');
    await expect(card.locator('[data-cardhours]')).toHaveText('8 hrs');
    await expect(card.locator('[data-cardtimehint]')).toHaveText('From the times you gave on the job. Change it if it is wrong.');
  });

  test('times given on the job view that no longer match the hours on record are not used', async ({ appPage: page }) => {
    const jobDate = addIsoDays(perthWeekMonday(), 1);
    const card = await openInstallerBuilder(page, {
      arg: jobDate,
      fn: (day) => localStorage.setItem('sw_time_job_' + encodeURIComponent('e2e-installer'), JSON.stringify({
        'e2e-wo-holder-job': { work_date: day, start_time: '09:00', finish_time: '11:00', break_minutes: 0, hours: 2, at: Date.now() }
      }))
    });
    // The server holds 8 hrs for this job, so the 2 hr memory is stale: the clock wins.
    await expect(card.locator('[data-cardstart]')).toHaveValue('07:00');
    await expect(card.locator('[data-cardfinish]')).toHaveValue('15:00');
  });
});
