// Weekly invoice draft fixes (20 Nov 2026):
//  1. Opening the week's running draft from Invoice history opens the weekly
//     builder for that week, from the saved builder, never a rebuilt copy.
//  2. A save refused with draft_replaced (409) re-reads the week, keeps what
//     the person typed on top of the fresh draft and saves once more under
//     the fresh id. A second refusal is shown and not retried.
//  3. A line typed with a job number but no job id is offered "Add yourself"
//     when the refusal names the job's id.
//  4. Deductions alone are not something to invoice.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

test.use({
  persona: 'installer',
  feedScenario: 'trade-invoice-running-draft',
  appWeekDay: 6,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  timezoneId: 'Australia/Perth'
});

const week = () => perthWeekMonday();

function savedCard(day, extra) {
  return Object.assign({
    assignment_id: 'as-saved', job_id: 'job-saved', job_number: 'SWF-30001', client_name: 'Saved Client',
    site_suburb: 'Wembley', job_type: 'fencing', scheduled_date: day, work_date: day,
    start_time: '07:00', finish_time: '15:30', break_minutes: 30, hours: 8, rate: 50,
    description: 'Saved builder line', included: true, source_key: 'as:as-saved'
  }, extra || {});
}

function builderWith(cards, extra) {
  const ws = week();
  return Object.assign({ version: 1, weekStart: ws, weekEnd: addIsoDays(ws, 6), manualLock: true, jobCards: cards,
    invRows: [], invLumpLines: [], dismissedKeys: [], notes: '', gst_on: false }, extra || {});
}

// Stands in for ops-api for the weekly invoice. `state` is changed by tests.
async function stubWeek(page, state) {
  const posts = [];
  await page.route('**/functions/v1/ops-api?**', async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const reply = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'POST') posts.push({ action, body: req.postDataJSON() });
    const ws = week();
    if (action === 'my_hours') {
      return reply({ assignments: state.assignments || [], rate: 50, rate_resolved: true, invoice_type: 'hourly', running_invoice_draft: true,
        week_start: ws, week_ending: addIsoDays(ws, 6), total_hours: 0, already_submitted: false });
    }
    if (action === 'my_trade_invoices') return reply({ invoices: state.invoices || [] });
    if (action === 'get_trade_invoice') return reply({ invoice: state.invoice });
    if (action === 'get_running_invoice_draft') {
      state.reads = (state.reads || 0) + 1;
      return reply(Object.assign({ ok: true, status: 'draft', draft_id: state.draftId, draft_builder: state.builder, suggested: [], claimed: [] }, state.readExtra || {}));
    }
    if (action === 'save_running_invoice_draft') {
      const body = req.postDataJSON();
      if (state.refuseSaves > 0) {
        state.refuseSaves -= 1;
        if (state.onRefuse) state.onRefuse();
        return reply({ ok: false, code: 'draft_replaced', error: 'That draft was replaced. Open the week again.' }, 409);
      }
      state.builder = body.draft_builder;
      return reply({ ok: true, draft_id: state.draftId, status: 'draft', xero: false });
    }
    if (action === 'generate_trade_invoice' && state.generate) return state.generate(route, body => reply(body.body, body.status));
    if (action === 'self_allocate_for_invoice') return reply({ ok: true, mode: 'created' });
    return route.fallback();
  });
  return posts;
}

const saves = (posts) => posts.filter((p) => p.action === 'save_running_invoice_draft');

test('opening the running draft from Invoice history opens the weekly builder from the saved draft', async ({ appPage: page }) => {
  const ws = week();
  const day = addIsoDays(ws, 1);
  const builder = builderWith([savedCard(day)]);
  const draftRow = { id: 'fixture-draft', status: 'draft', week_start: ws, week_end: addIsoDays(ws, 6), invoice_number: null, invoice_source: 'hourly' };
  const state = {
    draftId: 'fixture-draft',
    builder,
    invoices: [draftRow],
    // The priced lines the old open rebuilt as clock rows.
    invoice: Object.assign({}, draftRow, { draft_builder: builder, notes: '', gst_on: false,
      lines: [{ id: 'l1', line_type: 'labour', job_id: 'job-saved', job_number: 'SWF-30001', work_date: day, quantity: 8, unit_rate: 50, line_total_ex: 400 }] })
  };
  const posts = await stubWeek(page, state);
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.locator('[data-inv-history="fixture-draft"]').click();

  await expect(page.locator('#invSaveBtn')).toBeVisible();
  const card = page.locator('.jc-card').filter({ hasText: 'SWF-30001' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-carddesc]')).toHaveValue('Saved builder line');
  await expect(card.locator('[data-cardstart]')).toHaveValue('07:00');
  await expect(card.locator('[data-cardfinish]')).toHaveValue('15:30');

  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#invSaveState')).toContainText('Saved');
  const last = saves(posts).pop().body;
  expect(last.draft_id).toBe('fixture-draft');
  expect(last.week_start).toBe(ws);
  // The draft is saved from the builder; no rebuilt clock rows ride along.
  expect(last.draft_builder.invRows.filter((r) => r && r._source === 'clock')).toHaveLength(0);
  expect(last.draft_builder.jobCards.filter((c) => c.job_number === 'SWF-30001')).toHaveLength(1);
  expect(posts.some((p) => p.action === 'generate_trade_invoice')).toBe(false);
});

test('a replaced draft is read again, the typed edit is kept on the fresh draft, and saved once under its id', async ({ appPage: page }) => {
  const ws = week();
  const day = addIsoDays(ws, 1);
  const state = { draftId: 'old-draft', builder: builderWith([savedCard(day)]), refuseSaves: 1 };
  // The other app replaced the draft and added a line of its own.
  state.onRefuse = () => {
    state.draftId = 'fresh-draft';
    state.readExtra = { current_draft_id: 'fresh-draft' };
    state.builder = builderWith([savedCard(day, { description: 'Other app text' }), savedCard(addIsoDays(ws, 2), {
      assignment_id: 'as-other', job_id: 'job-other', job_number: 'SWF-30002', source_key: 'as:as-other', description: 'Added in the other app' })]);
  };
  const posts = await stubWeek(page, state);
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'SWF-30001' });
  await expect(card.locator('[data-carddesc]')).toHaveValue('Saved builder line');

  await card.locator('[data-carddesc]').fill('Typed on this phone');
  await card.locator('[data-carddesc]').blur();
  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#invSaveState')).toContainText('Saved');

  const all = saves(posts);
  expect(all).toHaveLength(2);
  expect(all[0].body.draft_id).toBe('old-draft');
  const retry = all[1].body;
  expect(retry.draft_id).toBe('fresh-draft');
  const cards = retry.draft_builder.jobCards;
  expect(cards.find((c) => c.job_number === 'SWF-30001').description).toBe('Typed on this phone');
  expect(cards.find((c) => c.job_number === 'SWF-30002').description).toBe('Added in the other app');
  await expect(page.locator('.jc-card').filter({ hasText: 'SWF-30002' })).toHaveCount(1);
  // The phone copy now names the fresh draft, not the replaced one.
  const phoneIds = await page.evaluate(() => Object.keys(sessionStorage).map((k) => { try { return JSON.parse(sessionStorage.getItem(k)).draftId; } catch (e) { return undefined; } }).filter((v) => v !== undefined));
  expect(phoneIds).toContain('fresh-draft');
  expect(phoneIds).not.toContain('old-draft');
});

test('a second draft_replaced is shown and not retried, and the stale id is dropped', async ({ appPage: page }) => {
  const ws = week();
  const day = addIsoDays(ws, 1);
  const state = { draftId: 'old-draft', builder: builderWith([savedCard(day)]), refuseSaves: 2 };
  state.onRefuse = () => { state.draftId = 'fresh-draft'; };
  const posts = await stubWeek(page, state);
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'SWF-30001' });
  await card.locator('[data-carddesc]').fill('Typed again');
  await card.locator('[data-carddesc]').blur();
  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#invSaveState')).toHaveText('Not saved.');
  await expect(page.locator('#toast')).toContainText('changed in another place again');
  // The autosave that was already waiting does not write over the other place's draft.
  await page.waitForTimeout(3500);
  expect(saves(posts)).toHaveLength(2);
  // A pressed Save reads the week again and saves once under the fresh id.
  state.refuseSaves = 0;
  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#invSaveState')).toContainText('Saved');
  expect(saves(posts)).toHaveLength(3);
  expect(saves(posts)[2].body.draft_id).toBe('fresh-draft');
  const phoneIds = await page.evaluate(() => Object.keys(sessionStorage).map((k) => { try { return JSON.parse(sessionStorage.getItem(k)).draftId; } catch (e) { return undefined; } }).filter((v) => v !== undefined));
  expect(phoneIds).not.toContain('old-draft');
});

test('a line typed with only a job number is offered Add yourself from the refused job id', async ({ appPage: page }) => {
  const ws = week();
  const day = addIsoDays(ws, 1);
  const typedRow = { date: day, job_id: null, job_text: 'SWF-40404', description: 'Typed job', division: 'Fencing', hours: 8,
    start_time: '07:00', finish_time: '15:00', break_minutes: 0, rate: 50, amount: 400, _source: 'manual' };
  const state = { draftId: 'fixture-draft', builder: builderWith([], { invRows: [typedRow] }) };
  let refused = 0;
  state.generate = (route, send) => {
    const booked = posts.some((p) => p.action === 'self_allocate_for_invoice');
    if (booked) return send({ status: 200, body: { success: true, ok: true, invoice_id: 'inv-1', invoice_number: 'SW-INV-1', status: 'pending_ops_review', gross_earned: 400, trade_payable: 376 } });
    refused++;
    return send({ status: 403, body: { ok: false, saved: false, code: 'extra_job_not_allowed', jobs: ['SWF-40404'],
      refused_jobs: [{ job_id: 'job-typed-404', job_number: 'SWF-40404' }],
      error: 'This invoice was not saved. You are not booked on job SWF-40404.' } });
  };
  const posts = await stubWeek(page, state);
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#invSubmitBtn')).toBeVisible();
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();

  await expect(page.locator('#confirmTitle')).toHaveText('Add yourself to SWF-40404?');
  await page.locator('#confirmOk').click();
  await expect.poll(() => posts.filter((p) => p.action === 'self_allocate_for_invoice').length).toBe(1);
  expect(posts.find((p) => p.action === 'self_allocate_for_invoice').body).toEqual({ job_id: 'job-typed-404', work_date: day });
  expect(refused).toBe(1);
});

test('a deduction alone is not something to invoice', async ({ appPage: page }) => {
  const ws = week();
  const state = { draftId: 'fixture-draft', builder: builderWith([], { invLumpLines: [{ id: 'il-1', description: 'Ute hire', amount: 50 }] }) };
  const posts = await stubWeek(page, state);
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#invSubmitBtn')).toBeVisible();
  await page.locator('#invSubmitBtn').click();
  await expect(page.locator('#toast')).toContainText('A deduction takes money off. Add the job and the hours first.');
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);
  expect(posts.some((p) => p.action === 'generate_trade_invoice')).toBe(false);
  expect(ws).toBeTruthy();
});
