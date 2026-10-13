// Sign in and sign out carry over to the invoice (Captain, 2026-10-13).
//
// The taps fill date worked, start, finish and break on that job's invoice
// line, one line per signed-in day, rounded to 15 minutes by ops-api. The line says
// "From your sign in", stays the trade's to change, and posts the sign ins it
// came from. The rules and payload are pinned against the shipped code in
// scripts/test-trade-site-visit.js; this spec proves them on the real card.
// A week with no sign ins keeps the blank card: that case is the "hours on
// record" test in trade-invoice-time-entry.spec.js, which this change leaves
// untouched.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');
const { dayText, fillCardTime } = require('../helpers/invoice-time');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

const MON = perthWeekMonday();
const TUE = addIsoDays(MON, 1);
const WED = addIsoDays(MON, 2);
const THU = addIsoDays(MON, 3);

function signedInDay(date, extra) {
  return Object.assign({
    work_date: date, start_time: '07:00', finish_time: '15:30', break_minutes: 30, hours: 8,
    tapped_in: '07:02', tapped_out: '15:34', out_capture: 'tap', visit_ids: ['visit-' + date]
  }, extra || {});
}

// my_hours as the paired back end hands it over: the fixture week's one
// assigned job (SWF-26767, Tuesday, $50), plus the trade's own sign ins.
function hours(days, extra) {
  return Object.assign({
    week_start: MON,
    week_ending: addIsoDays(MON, 6),
    assignments: [{
      id: 'e2e-wo-holder-assignment', job_id: 'e2e-wo-holder-job', scheduled_date: TUE, hours_worked: 8,
      jobs: { id: 'e2e-wo-holder-job', job_number: 'SWF-26767', client_name: 'Kelvin Gillies', site_suburb: 'Joondalup', type: 'fencing' },
      site_visit_days: days
    }],
    rate: 50, rate_resolved: true, total_hours: 8, already_submitted: false
  }, extra || {});
}

async function serveHours(page, payload) {
  await page.route(`${OPS_API}**`, async (route) => {
    if (new URL(route.request().url()).searchParams.get('action') !== 'my_hours') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(typeof payload === 'function' ? payload() : payload) });
  });
}

async function openBuilder(page) {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
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

test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', timezoneId: 'Australia/Perth', appWeekDay: 6, ...PHONE });

test('a signed-in day fills the line, says so, and posts the sign in it came from', async ({ appPage: page, feedRequests }) => {
  await serveHours(page, hours([signedInDay(TUE)]));
  const card = await openBuilder(page);

  // The taps were 7:02 am and 3:34 pm: the line carries them to the quarter hour.
  await expect(card.locator('[data-carddate]')).toHaveValue(TUE);
  await expect(card.locator('[data-cardstart]')).toHaveValue('07:00');
  await expect(card.locator('[data-cardfinish]')).toHaveValue('15:30');
  await expect(card.locator('[data-cardbreak]')).toHaveValue('30');
  await expect(card.locator('[data-cardhours]')).toHaveText('8 hrs');
  await expect(card.locator('[data-cardsv] [data-sv-tag]')).toHaveText('From your sign in');
  // The line names its own source: the older "hours on record" reminder is not repeated.
  await expect(card.locator('[data-cardtimehint]')).toBeHidden();
  await expect(card.locator('[data-cardamt]')).toHaveText('$400.00');

  // They check it and submit. Nothing was typed.
  await confirmSubmit(page);
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
  expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([{
    assignment_id: 'e2e-wo-holder-assignment', hours: 8, work_date: TUE, start_time: '07:00', finish_time: '15:30', break_minutes: 30,
    rate: 50, rate_source: 'server_resolved', description: '', manually_added: false, site_visit_ids: ['visit-' + TUE]
  }]);
});

test('a time they change is what is billed, and the line shows what the tap was', async ({ appPage: page, feedRequests }) => {
  await serveHours(page, hours([signedInDay(TUE)]));
  const card = await openBuilder(page);
  await card.locator('[data-cardfinish]').fill('16:00');
  await card.locator('[data-cardfinish]').blur();
  await expect(card.locator('[data-cardhours]')).toHaveText('8.5 hrs');
  await expect(card.locator('[data-cardsv] [data-sv-text]')).toHaveText('You signed out at 3:34 pm. The office sees both.');
  await expect(card.locator('[data-cardsv] [data-sv-tag]')).toHaveText('From your sign in');

  await card.locator('[data-cardstart]').fill('06:30');
  await card.locator('[data-cardstart]').blur();
  await expect(card.locator('[data-cardhours]')).toHaveText('9 hrs');
  await expect(card.locator('[data-cardsv] [data-sv-text]')).toHaveText('You signed in at 7:02 am. You signed out at 3:34 pm. The office sees both.');
  await expect(card.locator('[data-cardsv] [data-sv-tag]')).toBeHidden();
  await confirmSubmit(page);
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
  expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([
    expect.objectContaining({ hours: 9, start_time: '06:30', finish_time: '16:00', break_minutes: 30, site_visit_ids: ['visit-' + TUE] })
  ]);
});

test('no sign out that day: start filled, finish blank, and the line will not submit until they give it', async ({ appPage: page, feedRequests }) => {
  await serveHours(page, hours([signedInDay(TUE, { finish_time: null, hours: null, tapped_out: null, out_capture: null, break_minutes: 0 })]));
  const card = await openBuilder(page);
  await expect(card.locator('[data-cardstart]')).toHaveValue('07:00');
  await expect(card.locator('[data-cardfinish]')).toHaveValue('');
  await expect(card.locator('[data-cardhours]')).toHaveText('0 hrs');
  await expect(card.locator('[data-cardsv] [data-sv-text]')).toHaveText('No sign out that day. Add the time you left.');

  await page.locator('#invSubmitBtn').click();
  await expect(page.locator('#toast')).toContainText('SWF-26767: Add your finish time.');
  expect(invoicePosts(feedRequests)).toEqual([]);

  await card.locator('[data-cardfinish]').fill('15:00');
  await card.locator('[data-cardfinish]').blur();
  await expect(card.locator('[data-cardsv] [data-sv-text]')).toHaveText('No sign out that day. The finish is the time you typed.');
  await confirmSubmit(page);
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
  expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([
    expect.objectContaining({ hours: 8, start_time: '07:00', finish_time: '15:00', site_visit_ids: ['visit-' + TUE] })
  ]);
});

test('signed in 11:30 pm, signed out 1:15 am: one line dated the day it started, with the hours right', async ({ appPage: page, feedRequests }) => {
  await serveHours(page, hours([signedInDay(TUE, {
    start_time: '23:30', finish_time: '01:15', finish_next_day: true, break_minutes: 0, hours: 1.75, tapped_in: '23:30', tapped_out: '01:15'
  })]));
  const card = await openBuilder(page);
  await expect(card.locator('[data-carddate]')).toHaveValue(TUE);
  await expect(card.locator('[data-cardstart]')).toHaveValue('23:30');
  await expect(card.locator('[data-cardfinish]')).toHaveValue('01:15');
  await expect(card.locator('[data-cardhours]')).toHaveText('1.75 hrs');
  await expect(card.locator('[data-cardamt]')).toHaveText('$87.50');
  await expect(card.locator('[data-cardsv] [data-sv-tag]')).toHaveText('From your sign in');
  await expect(card.locator('[data-cardsv] [data-sv-text]')).toHaveText('You left after midnight, so the finish is the next day.');
  await expect(card.locator('[data-cardtimeerr]')).toBeHidden();
  // No second line appears for the Wednesday morning.
  await expect(card.locator('[data-cardday]')).toHaveCount(0);

  await confirmSubmit(page);
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
  expect(invoicePosts(feedRequests)[0].body.manual_assignments).toEqual([{
    assignment_id: 'e2e-wo-holder-assignment', hours: 1.75, work_date: TUE, start_time: '23:30', finish_time: '01:15', finish_next_day: true, break_minutes: 0,
    rate: 50, rate_source: 'server_resolved', description: '', manually_added: false, site_visit_ids: ['visit-' + TUE]
  }]);
});

test('several signed-in days on one job: one line per day on the same card, each posted as its own line', async ({ appPage: page, feedRequests }) => {
  await serveHours(page, hours([signedInDay(TUE), signedInDay(WED), signedInDay(THU, { start_time: '08:00', tapped_in: '08:04' })]));
  const card = await openBuilder(page);
  await expect(card.locator('[data-carddate]')).toHaveValue(TUE);
  const days = card.locator('[data-cardday]');
  await expect(days).toHaveCount(2);
  await expect(days.nth(0).locator('[data-daydate]')).toHaveValue(WED);
  await expect(days.nth(0).locator('[data-daystart]')).toHaveValue('07:00');
  await expect(days.nth(0).locator('[data-dayhours]')).toHaveText('8 hrs');
  await expect(days.nth(0).locator('[data-sv-tag]')).toHaveText('From your sign in');
  await expect(days.nth(1).locator('[data-daydate]')).toHaveValue(THU);
  await expect(days.nth(1).locator('[data-dayhours]')).toHaveText('7 hrs');
  await expect(card.locator('[data-cardallhours]')).toHaveText('23 hrs');
  await expect(card.locator('[data-cardamt]')).toHaveText('$1150.00');

  // They did not work the Thursday after all.
  await days.nth(1).locator('[data-daydrop]').click();
  await expect(card.locator('[data-cardday]')).toHaveCount(1);
  await expect(card.locator('[data-cardallhours]')).toHaveText('16 hrs');

  // Nothing was typed, a description included: the job is theirs by booking.
  await confirmSubmit(page);
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
  const body = invoicePosts(feedRequests)[0].body;
  expect(body.manual_assignments).toEqual([
    expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 8, work_date: TUE, rate_source: 'server_resolved', site_visit_ids: ['visit-' + TUE] })
  ]);
  // The further day says it came from a sign in at their usual rate, never
  // that they searched the job in and typed a rate.
  expect(body.extra_items).toEqual([{
    type: 'Labour', row_type: 'labour', description: '', quantity: 8, unit: 'hr', rate: 50,
    date: WED, work_date: WED, start_time: '07:00', finish_time: '15:30', break_minutes: 30,
    job_id: 'e2e-wo-holder-job', job_number: 'SWF-26767', division: 'fencing', client_name: 'Kelvin Gillies',
    manually_added: false, source: 'site_visit_day', rate_source: 'server_resolved', client_rate_entered: false,
    site_visit_ids: ['visit-' + WED]
  }]);
});

test('the first day left blank: the further signed-in days are still billed as the card shows', async ({ appPage: page, feedRequests }) => {
  await serveHours(page, hours([signedInDay(TUE), signedInDay(WED)]));
  const card = await openBuilder(page);
  await expect(card.locator('[data-cardday]')).toHaveCount(1);
  // They did not work the Tuesday: its line is cleared, the Wednesday stands.
  await card.locator('[data-carddate]').fill('');
  await card.locator('[data-cardstart]').fill('');
  await card.locator('[data-cardfinish]').fill('');
  await card.locator('[data-cardbreak]').fill('');
  await card.locator('[data-cardbreak]').blur();
  await expect(card.locator('[data-cardhours]')).toHaveText('0 hrs');
  await expect(card.locator('[data-cardamt]')).toHaveText('$400.00');

  await confirmSubmit(page);
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
  const body = invoicePosts(feedRequests)[0].body;
  expect(body.manual_assignments || []).toEqual([]);
  expect(body.extra_items).toEqual([
    expect.objectContaining({ job_id: 'e2e-wo-holder-job', quantity: 8, rate: 50, work_date: WED, source: 'site_visit_day', site_visit_ids: ['visit-' + WED] })
  ]);
});

test('a job signed in to that is not on the week\'s cards is offered, never added for them', async ({ appPage: page, feedRequests }) => {
  await serveHours(page, hours([], {
    site_visit_days_other: [Object.assign({ job_id: 'e2e-other-job', job_number: 'SWP-26999', site_suburb: 'Duncraig', client_name: 'Other Client', job_type: 'patio' }, signedInDay(WED))]
  }));
  const card = await openBuilder(page);
  await expect(card.locator('[data-carddate]')).toHaveValue('');
  await expect(page.locator('.jc-card').filter({ hasText: 'SWP-26999' })).toHaveCount(0);
  const offer = page.locator('[data-sv-other]');
  await expect(offer).toContainText('You also signed in at');
  await expect(offer).toContainText('SWP-26999');
  await expect(offer).toContainText('Duncraig');
  await expect(offer).toContainText(dayText(WED));

  await offer.locator('[data-sv-other-add]').click();
  const added = page.locator('.jc-card').filter({ hasText: 'SWP-26999' });
  await expect(added.locator('[data-carddate]')).toHaveValue(WED);
  await expect(added.locator('[data-cardstart]')).toHaveValue('07:00');
  await expect(added.locator('[data-cardfinish]')).toHaveValue('15:30');
  await expect(added.locator('[data-sv-tag]')).toHaveText('From your sign in');
  await expect(added.locator('[data-cardrate]')).toHaveValue('50');
  await expect(page.locator('[data-sv-other]')).toHaveCount(0);

  await added.locator('[data-carddesc]').fill('Helped on the patio');
  await added.locator('[data-carddesc]').blur();
  // The job they were booked on had no sign in: its line stays theirs to type.
  await fillCardTime(card, 3);
  await confirmSubmit(page);
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');
  const body = invoicePosts(feedRequests)[0].body;
  expect(body.manual_assignments).toEqual([
    expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 3, work_date: TUE })
  ]);
  expect('site_visit_ids' in body.manual_assignments[0]).toBe(false);
  expect(body.extra_items).toEqual([
    expect.objectContaining({ job_id: 'e2e-other-job', job_number: 'SWP-26999', quantity: 8, work_date: WED, start_time: '07:00', finish_time: '15:30', break_minutes: 30, source: 'manual_job_search', site_visit_ids: ['visit-' + WED] })
  ]);
});

test('times the trade already typed are never overwritten, a restored draft included', async ({ appPage: page }) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(`${OPS_API}**`, async (route) => {
    if (new URL(route.request().url()).searchParams.get('action') !== 'my_hours') return route.fallback();
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hours([signedInDay(TUE)])) });
  });
  await signIn(page, PERSONAS.installer);
  await page.evaluate(([start, end, scheduled]) => {
    sessionStorage.setItem('sw_inv_draft_' + encodeURIComponent('e2e-installer'), JSON.stringify({
      user_id: 'e2e-installer', jobCentric: true,
      jobCards: [{
        assignment_id: 'e2e-wo-holder-assignment', job_id: 'e2e-wo-holder-job', job_number: 'SWF-26767', client_name: 'Kelvin Gillies',
        site_suburb: 'Joondalup', job_type: 'fencing', scheduled_date: scheduled, included: true, wo_mode: false,
        work_date: scheduled, start_time: '06:00', finish_time: '14:00', break_minutes: 0, manually_added: false
      }],
      weekStart: start, weekEnd: end
    }));
  }, [MON, addIsoDays(MON, 6), TUE]);
  await page.locator('[data-view="hours"]').click();
  const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  await expect(card.locator('[data-cardstart]')).toHaveValue('06:00');

  release();
  await expect(card.locator('[data-cardsv] [data-sv-text]')).toHaveText('You signed in at 7:02 am. You signed out at 3:34 pm. The office sees both.');
  await expect(card.locator('[data-cardstart]')).toHaveValue('06:00');
  await expect(card.locator('[data-cardfinish]')).toHaveValue('14:00');
  await expect(card.locator('[data-cardsv] [data-sv-tag]')).toBeHidden();
});
