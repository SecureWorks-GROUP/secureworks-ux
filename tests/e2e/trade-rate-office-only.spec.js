const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

// Rates are office only (captain ruling 2026-09-23, trade app audit finding 7).
// The trade sees the rate the office set, read-only, and nothing the trade does
// on Profile or in the invoice builder may call set_trade_rate.
test.use({ persona: 'fencing_manager', feedScenario: 'henry-wo-hydrate-fail' });

test('Profile and the invoice builder show the office rate read-only and never save a rate', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.fencing_manager);

  await page.locator('[data-view="profile"]').click();
  const rateCard = page.locator('#profileRateCard');
  await expect(rateCard).toContainText('My Hourly Rate');
  await expect(page.locator('#profileRateValue')).toHaveText('$55.00/hr');
  await expect(rateCard).toContainText('Set by the office');
  await expect(rateCard.locator('input, button')).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.updateTradeRate)).toBe('undefined');

  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardhours]')).toBeVisible();
  await expect(card.locator('[data-cardrate]')).toHaveCount(0);
  await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$55.00/hr');
  await expect(card).toContainText('Set by the office');

  // A direct call cannot change an assigned card's rate either.
  await page.evaluate(() => window.setJobCardRate(0, '99'));
  await card.locator('[data-cardhours]').fill('3');
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

  const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
  expect(writes.length).toBe(1);
  expect(writes[0].body.manual_assignments).toEqual([
    expect.objectContaining({ assignment_id: 'e2e-henry-assignment', hours: 3, rate: 55, rate_source: 'server_resolved' })
  ]);
  expect(feedRequests.filter((entry) => entry.action === 'set_trade_rate')).toEqual([]);
});

test.describe('a restored hourly draft cannot keep a trade-typed assigned rate', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', timezoneId: 'Australia/Perth' });

  test('clears the typed rate until the office rate lands, then submits that rate', async ({ appPage: page, feedRequests }) => {
    const weekStart = perthWeekMonday();
    const weekEnd = addIsoDays(weekStart, 6);
    const jobDate = addIsoDays(weekStart, 1);
    let releaseHours;
    const holdHours = new Promise((resolve) => { releaseHours = resolve; });

    await signIn(page, PERSONAS.installer);
    await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'my_hours') await holdHours;
      await route.fallback();
    });
    await page.evaluate(([start, end, scheduled]) => {
      sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-installer'), JSON.stringify({
        user_id: 'e2e-installer',
        jobCentric: true,
        jobCards: [{
          assignment_id: 'e2e-wo-holder-assignment',
          job_id: 'e2e-wo-holder-job',
          job_number: 'SWF-26767',
          client_name: 'Kelvin Gillies',
          site_suburb: 'Joondalup',
          job_type: 'fencing',
          scheduled_date: scheduled,
          included: true,
          wo_mode: false,
          hours: 3,
          rate: 99,
          rate_source: 'client_entered',
          manually_added: false
        }],
        weekStart: start,
        weekEnd: end
      }));
    }, [weekStart, weekEnd, jobDate]);

    await page.locator('[data-view="hours"]').click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(card.locator('[data-cardhours]')).toHaveValue('3');
    await expect(card.locator('[data-cardrate]')).toHaveCount(0);
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('Not set');
    await expect(card).not.toContainText('$99.00/hr');
    await expect(page.locator('#hoursContent')).toContainText('No pay rate is set for you yet');

    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('No pay rate is set for you yet');
    await expect(page.locator('#toast')).toContainText('contact them to have it set');
    await expect(page.locator('#toast')).not.toContainText('enter hours and your rate');
    expect(feedRequests.filter((entry) => entry.action === 'generate_trade_invoice')).toEqual([]);

    releaseHours();
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$50.00/hr');
    await expect(page.locator('#hoursContent')).not.toContainText('contact them to have it set before you invoice hours');

    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmAck').check();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(writes.length).toBe(1);
    expect(writes[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 3, rate: 50, rate_source: 'server_resolved' })
    ]);
  });

  test('keeps in-progress notes, description and extras when the office rate lands', async ({ appPage: page, feedRequests }) => {
    const weekStart = perthWeekMonday();
    const weekEnd = addIsoDays(weekStart, 6);
    const jobDate = addIsoDays(weekStart, 1);
    let releaseHours;
    const holdHours = new Promise((resolve) => { releaseHours = resolve; });

    await signIn(page, PERSONAS.installer);
    await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'my_hours') await holdHours;
      await route.fallback();
    });
    await page.evaluate(([start, end, scheduled]) => {
      sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-installer'), JSON.stringify({
        user_id: 'e2e-installer',
        jobCentric: true,
        jobCards: [{
          assignment_id: 'e2e-wo-holder-assignment',
          job_id: 'e2e-wo-holder-job',
          job_number: 'SWF-26767',
          client_name: 'Kelvin Gillies',
          site_suburb: 'Joondalup',
          job_type: 'fencing',
          scheduled_date: scheduled,
          included: true,
          wo_mode: false,
          hours: 3,
          rate: 99,
          rate_source: 'client_entered',
          manually_added: false
        }],
        invLumpLines: [{ id: 'il-e2e-refresh', description: '', amount: 0 }],
        weekStart: start,
        weekEnd: end
      }));
    }, [weekStart, weekEnd, jobDate]);

    await page.locator('[data-view="hours"]').click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    const desc = card.locator('input[placeholder="Description of work"]');
    const notes = page.locator('#invNotes');
    const extraDesc = page.locator('[data-invlumpdesc="0"]');
    const extraAmt = page.locator('[data-invlumpamt="0"]');
    await expect(card.locator('[data-cardhours]')).toHaveValue('3');
    await notes.fill('Side gate access');
    await desc.fill('Replaced palings on the street side');
    await page.getByRole('button', { name: '+ Add extra / adjustment' }).click();
    const adjDesc = page.locator('#ir_desc_0');
    const adjType = page.locator('#ir_div_0');
    await expect(adjDesc).toBeVisible();
    await extraDesc.fill('Tool hire');
    await extraAmt.fill('15');
    await adjDesc.fill('Travel to second site');
    await adjType.selectOption('Fencing');

    releaseHours();
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$50.00/hr');
    await expect(desc).toHaveValue('Replaced palings on the street side');
    await expect(notes).toHaveValue('Side gate access');
    await expect(extraDesc).toHaveValue('Tool hire');
    await expect(extraAmt).toHaveValue('15');
    await expect(adjDesc).toHaveValue('Travel to second site');
    await expect(adjType).toHaveValue('Fencing');

    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmAck').check();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(writes.length).toBe(1);
    expect(writes[0].body.notes).toBe('Side gate access');
    expect(writes[0].body.manual_assignments).toEqual([
      expect.objectContaining({
        assignment_id: 'e2e-wo-holder-assignment',
        hours: 3,
        rate: 50,
        rate_source: 'server_resolved',
        description: 'Replaced palings on the street side'
      })
    ]);
    expect(writes[0].body.final_deductions).toEqual([
      { description: 'Tool hire', quantity: 1, unit: 'ea', unit_rate: 15 }
    ]);
    expect(writes[0].body.extra_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        description: 'Travel to second site',
        division: 'Fencing',
        source: 'manual'
      })
    ]));
  });

  test('does not pin the previous trade\'s office rate after a shared-device sign-in', async ({ appPage: page, feedRequests }) => {
    const weekStart = perthWeekMonday();
    const weekEnd = addIsoDays(weekStart, 6);
    const jobDate = addIsoDays(weekStart, 1);
    let priorAccount = true;
    let releaseHours;
    const holdHours = new Promise((resolve) => { releaseHours = resolve; });

    await page.route('https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'my_hours') {
        if (priorAccount) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              week_start: weekStart,
              week_ending: weekEnd,
              rate: 55,
              rate_resolved: true,
              assignments: [],
              already_submitted: false,
              invoice_type: 'hourly'
            })
          });
          return;
        }
        await holdHours;
      }
      await route.fallback();
    });

    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await expect(page.locator('[data-financial-hub]')).toBeVisible();
    priorAccount = false;

    await page.evaluate(() => window.doLogout());
    await expect(page.locator('#viewLogin')).toBeVisible();
    await page.evaluate(() => {
      var btn = document.getElementById('btnLogin');
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = 'Log In';
    });

    await signIn(page, PERSONAS.installer);
    await page.evaluate(([start, end, scheduled]) => {
      sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-installer'), JSON.stringify({
        user_id: 'e2e-installer',
        jobCentric: true,
        jobCards: [{
          assignment_id: 'e2e-wo-holder-assignment',
          job_id: 'e2e-wo-holder-job',
          job_number: 'SWF-26767',
          client_name: 'Kelvin Gillies',
          site_suburb: 'Joondalup',
          job_type: 'fencing',
          scheduled_date: scheduled,
          included: true,
          wo_mode: false,
          hours: 3,
          rate: 99,
          rate_source: 'client_entered',
          manually_added: false
        }],
        weekStart: start,
        weekEnd: end
      }));
    }, [weekStart, weekEnd, jobDate]);

    await page.locator('[data-view="hours"]').click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(card.locator('[data-cardhours]')).toHaveValue('3');
    await expect(card.locator('[data-cardrate]')).toHaveCount(0);
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('Not set');
    await expect(card).not.toContainText('$55.00/hr');
    await expect(card).not.toContainText('$99.00/hr');
    await expect(page.locator('#hoursContent')).toContainText('No pay rate is set for you yet');

    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('No pay rate is set for you yet');
    await expect(page.locator('#toast')).toContainText('contact them to have it set');
    expect(feedRequests.filter((entry) => entry.action === 'generate_trade_invoice')).toEqual([]);

    releaseHours();
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$50.00/hr');

    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmAck').check();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
    expect(writes.length).toBe(1);
    expect(writes[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 3, rate: 50, rate_source: 'server_resolved' })
    ]);
  });
});
