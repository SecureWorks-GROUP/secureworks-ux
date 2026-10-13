const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { fillCardTime } = require('../helpers/invoice-time');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

// The rate on an hours line is a box like the other inputs (Captain,
// 2026-10-13): "it should look like the same boxes as the other inputs, and
// just have like an auto fill to their rate that they normally set so they can
// change the rate per job". The app never shows a rate the server will not
// pay, so the box is there only once ops-api says on my_hours that it honours
// a rate typed on an assigned job (trade_rate_editable). Until then the card
// shows the office's rate read-only and bills it, as before. The fixture's
// invoice stub refuses a typed assigned rate unless that capability is on.
// Either way the app never saves a rate as the trade's usual one (no
// set_trade_rate, Profile stays read-only), and the description of work sits
// in the block with the other boxes.
const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';

function invoicePosts(feedRequests) {
  return feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
}

async function confirmSubmit(page) {
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();
}

const HENRY = { persona: 'fencing_manager', feedScenario: 'henry-wo-hydrate-fail', appWeekDay: 6 };

async function openHenryCard(page) {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardhours]')).toBeVisible();
  return card;
}

function boxLook(block, sel) {
  return block.locator(sel).evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.borderTopWidth, s.borderTopColor, s.borderRadius, s.fontSize, s.backgroundColor].join('|');
  });
}

test.describe('an assigned job while ops-api bills its own rate', () => {
  test.use(HENRY);

  test('shows the office rate read-only, bills it, and says nothing about a changed rate', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);

    // Profile shows the usual rate read-only: the app never saves one.
    await page.locator('[data-view="profile"]').click();
    const rateCard = page.locator('#profileRateCard');
    await expect(page.locator('#profileRateValue')).toHaveText('$55.00/hr');
    await expect(rateCard.locator('input, button')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.updateTradeRate)).toBe('undefined');

    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: 'Weekly Invoice' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
    await expect(card.locator('[data-cardrate]')).toHaveCount(0);
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$55.00/hr');
    await expect(card).toContainText('Set by the office');
    await expect(page.locator('#hoursContent')).toContainText('Your rate is set by the office and shown for reference.');
    await expect(page.locator('#hoursContent')).not.toContainText('rate box');
    await expect(card.locator('[data-cardratenote]')).toBeHidden();

    // The description of work still sits in the block with the other boxes.
    const block = card.locator('[data-cardtime]');
    await expect(block.locator('label.jct-f [data-carddesc]')).toHaveCount(1);
    expect(await boxLook(block, '[data-carddesc]')).toBe(await boxLook(block, '[data-cardstart]'));

    // A direct call cannot change an assigned card's rate either.
    await page.evaluate(() => window.setJobCardRate(0, '99'));
    await fillCardTime(card, 3);
    await block.locator('[data-carddesc]').fill('Replaced two panels');
    await block.locator('[data-carddesc]').blur();
    await expect(card.locator('[data-cardamt]')).toHaveText('$165.00');
    await expect(card.locator('[data-cardratenote]')).toBeHidden();
    await expect(card).not.toContainText('The office checks a changed rate');

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    const writes = invoicePosts(feedRequests);
    expect(writes.length).toBe(1);
    expect(writes[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-henry-assignment', hours: 3, rate: 55, rate_source: 'server_resolved', description: 'Replaced two panels' })
    ]);
    expect(feedRequests.filter((entry) => entry.action === 'set_trade_rate')).toEqual([]);
  });
});

test.describe('the rate box once ops-api honours a typed rate', () => {
  test.use({ ...HENRY, tradeRateEditable: true });

  test('opens on the usual rate, sits with the other boxes, and an untouched rate posts as the usual rate', async ({ appPage: page, feedRequests }) => {
    const card = await openHenryCard(page);
    const rate = card.locator('[data-cardrate]');
    await expect(rate).toHaveValue('55');
    await expect(rate).toBeEditable();
    await expect(card.locator('[data-cardrate-readonly]')).toHaveCount(0);
    await expect(card).not.toContainText('Set by the office');

    // The same kind of box as date, start, finish and break, in the same block,
    // with the description of work beside them.
    const block = card.locator('[data-cardtime]');
    for (const field of ['[data-carddate]', '[data-cardstart]', '[data-cardfinish]', '[data-cardbreak]', '[data-cardrate]', '[data-carddesc]']) {
      await expect(block.locator('label.jct-f ' + field), field + ' is one of the labelled boxes').toHaveCount(1);
      expect((await block.locator(field).boundingBox()).height, field + ' is a thumb-sized target').toBeGreaterThanOrEqual(44);
    }
    expect(await boxLook(block, '[data-cardrate]')).toBe(await boxLook(block, '[data-cardstart]'));
    expect(await boxLook(block, '[data-carddesc]')).toBe(await boxLook(block, '[data-cardstart]'));
    await expect(block.locator('[data-carddesc]')).toHaveAttribute('placeholder', 'Description of work');
    await expect(card.locator('[data-cardratenote]')).toBeHidden();

    await fillCardTime(card, 3);
    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    const writes = invoicePosts(feedRequests);
    expect(writes.length).toBe(1);
    expect(writes[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-henry-assignment', hours: 3, rate: 55, rate_source: 'server_resolved' })
    ]);
    expect(feedRequests.filter((entry) => entry.action === 'set_trade_rate')).toEqual([]);
  });

  test('a rate changed for this job is the rate sent, marked as typed, and never saved as the usual rate', async ({ appPage: page, feedRequests }) => {
    const card = await openHenryCard(page);
    await fillCardTime(card, 3);
    await card.locator('[data-carddesc]').fill('Night call-out, double time agreed');
    await card.locator('[data-cardrate]').fill('60');
    await card.locator('[data-cardrate]').blur();
    await expect(card.locator('[data-cardamt]')).toHaveText('$180.00');
    await expect(card.locator('[data-cardratenote]')).toHaveText('Your usual rate is $55.00. The office checks a changed rate.');

    // Back on the usual rate it is no longer a changed rate.
    await card.locator('[data-cardrate]').fill('55');
    await card.locator('[data-cardrate]').blur();
    await expect(card.locator('[data-cardratenote]')).toBeHidden();
    await expect(card.locator('[data-cardamt]')).toHaveText('$165.00');
    await card.locator('[data-cardrate]').fill('60');
    await card.locator('[data-cardrate]').blur();

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-henry-assignment', hours: 3, rate: 60, rate_source: 'client_entered', description: 'Night call-out, double time agreed' })
    ]);
    expect(feedRequests.filter((entry) => entry.action === 'set_trade_rate')).toEqual([]);
  });

  test('an emptied rate box stays empty through a repaint and is asked for on the card', async ({ appPage: page, feedRequests }) => {
    const card = await openHenryCard(page);
    await fillCardTime(card, 3);
    await card.locator('[data-cardrate]').fill('');
    await card.locator('[data-cardrate]').blur();
    await expect(card.locator('[data-cardamt]')).toHaveText('$0.00');

    // Opening a day's job search repaints the whole builder.
    await page.getByRole('button', { name: '+ Add job' }).first().click();
    await expect(page.locator('[id^="jcSearchInput_"]')).toBeVisible();
    await expect(card.locator('[data-cardrate]')).toHaveValue('');
    await expect(card.locator('[data-cardamt]')).toHaveText('$0.00');
    await expect(card.locator('[data-cardratenote]')).toBeHidden();

    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('FENCE-HENRY-001: enter your rate, or add an amount.');
    await expect(page.locator('#toast')).not.toContainText('contact them to have it set');
    expect(invoicePosts(feedRequests)).toEqual([]);
  });
});

test.describe('a restored hourly draft and the office rate', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', timezoneId: 'Australia/Perth', appWeekDay: 6 });

  const weekStart = perthWeekMonday();
  const weekEnd = addIsoDays(weekStart, 6);
  const jobDate = addIsoDays(weekStart, 1);

  function holdHours(page, firstResponse) {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let first = firstResponse;
    return page.route(`${OPS_API}**`, async (route) => {
      if (new URL(route.request().url()).searchParams.get('action') !== 'my_hours') return route.fallback();
      if (first && first.active()) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(first.body) });
        return;
      }
      await held;
      await route.fallback();
    }).then(() => release);
  }

  function seedDraft(page, card, extra) {
    return page.evaluate(([start, end, scheduled, cardExtra, draftExtra]) => {
      sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-installer'), JSON.stringify(Object.assign({
        user_id: 'e2e-installer',
        jobCentric: true,
        jobCards: [Object.assign({
          assignment_id: 'e2e-wo-holder-assignment', job_id: 'e2e-wo-holder-job', job_number: 'SWF-26767', client_name: 'Kelvin Gillies',
          site_suburb: 'Joondalup', job_type: 'fencing', scheduled_date: scheduled, included: true, wo_mode: false, hours: 3,
          work_date: scheduled, start_time: '07:00', finish_time: '10:00', break_minutes: 0, rate: 99, rate_source: 'client_entered', manually_added: false
        }, cardExtra)],
        weekStart: start,
        weekEnd: end
      }, draftExtra)));
    }, [weekStart, weekEnd, jobDate, card || {}, extra || {}]);
  }

  test('a rate typed on an assigned job in the draft is never billed: cleared until the office rate lands, then that rate is sent', async ({ appPage: page, feedRequests }) => {
    const releaseHours = await holdHours(page);
    await signIn(page, PERSONAS.installer);
    await seedDraft(page, { typed_rate: 99 });

    await page.locator('[data-view="hours"]').click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(card.locator('[data-cardhours]')).toHaveText('3 hrs');
    await expect(card.locator('[data-cardrate]')).toHaveCount(0);
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('Not set');
    await expect(card).not.toContainText('$99');
    await expect(page.locator('[data-rate-missing]')).toContainText('No pay rate is set for you yet');

    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('No pay rate is set for you yet');
    await expect(page.locator('#toast')).toContainText('contact them to have it set');
    expect(invoicePosts(feedRequests)).toEqual([]);

    releaseHours();
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$50.00/hr');
    await expect(card.locator('[data-cardrate]')).toHaveCount(0);
    await expect(page.locator('[data-rate-missing]')).toHaveCount(0);
    await expect(card.locator('[data-cardamt]')).toHaveText('$150.00');

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    const writes = invoicePosts(feedRequests);
    expect(writes.length).toBe(1);
    expect(writes[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 3, rate: 50, rate_source: 'server_resolved' })
    ]);
  });

  test('keeps in-progress notes, description and extras when the office rate lands', async ({ appPage: page, feedRequests }) => {
    const releaseHours = await holdHours(page);
    await signIn(page, PERSONAS.installer);
    await seedDraft(page, {}, { invLumpLines: [{ id: 'il-e2e-refresh', description: '', amount: 0 }] });

    await page.locator('[data-view="hours"]').click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    const desc = card.locator('input[placeholder="Description of work"]');
    const notes = page.locator('#invNotes');
    const extraDesc = page.locator('[data-invlumpdesc="0"]');
    const extraAmt = page.locator('[data-invlumpamt="0"]');
    await expect(card.locator('[data-cardhours]')).toHaveText('3 hrs');
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
    // An extras row is a line of hours: it says when it was worked too.
    await page.locator('#ir_date_0').fill(jobDate);
    await page.locator('#ir_start_0').fill('15:00');
    await page.locator('#ir_fin_0').fill('16:00');

    releaseHours();
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$50.00/hr');
    await expect(desc).toHaveValue('Replaced palings on the street side');
    await expect(notes).toHaveValue('Side gate access');
    await expect(extraDesc).toHaveValue('Tool hire');
    await expect(extraAmt).toHaveValue('15');
    await expect(adjDesc).toHaveValue('Travel to second site');
    await expect(adjType).toHaveValue('Fencing');
    await expect(page.locator('#ir_start_0')).toHaveValue('15:00');
    await expect(page.locator('#ir_fin_0')).toHaveValue('16:00');

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

    const writes = invoicePosts(feedRequests);
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
        source: 'manual',
        quantity: 1,
        work_date: jobDate,
        start_time: '15:00',
        finish_time: '16:00',
        break_minutes: 0
      })
    ]));
  });

  test('the last trade\'s rate never shows on the next trade\'s card on a shared phone', async ({ appPage: page, feedRequests }) => {
    let priorAccount = true;
    const releaseHours = await holdHours(page, {
      active: () => priorAccount,
      body: { week_start: weekStart, week_ending: weekEnd, rate: 55, rate_resolved: true, assignments: [], already_submitted: false, invoice_type: 'hourly' }
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
    await seedDraft(page);

    await page.locator('[data-view="hours"]').click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(card.locator('[data-cardhours]')).toHaveText('3 hrs');
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('Not set');
    await expect(card).not.toContainText('$55.00/hr');
    await expect(page.locator('[data-rate-missing]')).toBeVisible();

    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('contact them to have it set');
    expect(invoicePosts(feedRequests)).toEqual([]);

    releaseHours();
    await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$50.00/hr');

    await confirmSubmit(page);
    await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
    const writes = invoicePosts(feedRequests);
    expect(writes.length).toBe(1);
    expect(writes[0].body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 3, rate: 50, rate_source: 'server_resolved' })
    ]);
  });

  test.describe('once ops-api honours a typed rate', () => {
    test.use({ tradeRateEditable: true });

    test('a rate the trade changed for the job survives the reload and is the rate sent', async ({ appPage: page, feedRequests }) => {
      const releaseHours = await holdHours(page);
      await signIn(page, PERSONAS.installer);
      await seedDraft(page, { typed_rate: 99 });

      await page.locator('[data-view="hours"]').click();
      const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
      await expect(card.locator('[data-cardhours]')).toHaveText('3 hrs');
      // Until my_hours says the typed rate is honoured, it is neither shown nor billed.
      await expect(card.locator('[data-cardrate-readonly]')).toHaveText('Not set');
      await expect(card).not.toContainText('$99');

      releaseHours();
      await expect(card.locator('[data-cardrate]')).toHaveValue('99');
      await expect(card.locator('[data-cardratenote]')).toHaveText('Your usual rate is $50.00. The office checks a changed rate.');
      await expect(card.locator('[data-cardamt]')).toHaveText('$297.00');

      await confirmSubmit(page);
      await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
      expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([
        expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 3, rate: 99, rate_source: 'client_entered' })
      ]);
    });

    test('a draft saved before the rate box existed opens on the usual rate, never its stale figure', async ({ appPage: page, feedRequests }) => {
      const releaseHours = await holdHours(page);
      await signIn(page, PERSONAS.installer);
      await seedDraft(page);

      await page.locator('[data-view="hours"]').click();
      const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
      await expect(card.locator('[data-cardhours]')).toHaveText('3 hrs');
      await expect(card.locator('[data-cardrate-readonly]')).toHaveText('Not set');

      releaseHours();
      await expect(card.locator('[data-cardrate]')).toHaveValue('50');
      await expect(card.locator('[data-cardratenote]')).toBeHidden();
      await expect(page.locator('[data-rate-missing]')).toHaveCount(0);

      await confirmSubmit(page);
      await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
      const writes = invoicePosts(feedRequests);
      expect(writes.length).toBe(1);
      expect(writes[0].body.manual_assignments).toEqual([
        expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 3, rate: 50, rate_source: 'server_resolved' })
      ]);
    });

    test('with no usual rate on file there is no box to type one: the trade is sent to the office', async ({ appPage: page, feedRequests }) => {
      await holdHours(page, {
        active: () => true,
        body: {
          week_start: weekStart, week_ending: weekEnd, rate: 0, rate_resolved: false, trade_rate_editable: true,
          assignments: [{
            id: 'e2e-wo-holder-assignment', job_id: 'e2e-wo-holder-job', scheduled_date: jobDate,
            jobs: { id: 'e2e-wo-holder-job', job_number: 'SWF-26767', client_name: 'Kelvin Gillies', site_suburb: 'Joondalup', type: 'fencing' }
          }],
          total_hours: 0, already_submitted: false
        }
      });
      await signIn(page, PERSONAS.installer);
      await seedDraft(page, { typed_rate: 99 });

      await page.locator('[data-view="hours"]').click();
      const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
      await expect(card.locator('[data-cardhours]')).toHaveText('3 hrs');
      await expect(page.locator('[data-rate-missing]')).toContainText('No pay rate is set for you yet. Your rate is set by the office: contact them to have it set');
      await expect(card.locator('[data-cardrate]')).toHaveCount(0);
      await expect(card.locator('[data-cardrate-readonly]')).toHaveText('Not set');
      await expect(page.locator('#hoursContent')).not.toContainText('Type your rate');

      await page.locator('#invSubmitBtn').click();
      await expect(page.locator('#toast')).toContainText('contact them to have it set');
      await expect(page.locator('#toast')).not.toContainText('enter your rate');
      expect(invoicePosts(feedRequests)).toEqual([]);
    });
  });
});
