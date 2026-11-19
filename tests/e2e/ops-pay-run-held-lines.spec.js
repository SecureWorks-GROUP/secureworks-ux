// P1-05.13: the held lines panel inside the Pay run. Made-up ZZTEST names, ids and amounts only.
// No network: the page is served from this repo and every ops-api call is stubbed.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.use({ browserName: process.env.CI ? 'chromium' : 'webkit', headless: true });
const root = path.resolve(__dirname, '../..');
const CHECK_CODES = ['pay_equals_job_cost', 'nobody_above_work_order', 'super_is_12_over_112',
  'no_paid_line_without_work_order', 'nothing_lost', 'crew_accepted'];

function payRunAnswer(over = {}) {
  return {
    ok: true, week_start: '2026-11-16', run: null, can_approve: true,
    counts: { clean: 1, stopped: 0, late: 0 },
    totals: { total_inc_super: 1120, paid_to_you: 1000, super: 120, gst: 0, reimbursements: 0, into_bank: 1000 },
    held: { lines_waiting: 2, amount_ex: 250.5 },
    invoices: [{ invoice_id: 'ZZTEST-id-1', invoice_number: 'ZZTEST-INV-1', trade_name: 'ZZTEST Crew A', week_start: '2026-11-16',
      total_inc_super: 1120, paid_to_you: 1000, super_amount: 120, into_bank: 1000, verdict: 'clean', stops: [], pushed: false }],
    super_by_person: [{ user_id: 'ZZTEST-user-1', trade_name: 'ZZTEST Crew A', super_amount: 120 }],
    standing: CHECK_CODES.map(code => ({ code, pass: true, checked: 1 })),
    run_blocked: false, clean_ids_hash: 'ZZTEST', ...over
  };
}
const L1 = '11111111-0000-4000-8000-0000000000a1';
const L2 = '11111111-0000-4000-8000-0000000000a2';
const L3 = '11111111-0000-4000-8000-0000000000a3';
function heldAnswer(over = {}) {
  return {
    ok: true, enabled: true, count: 3, lines: [
      { id: L1, invoice_number: 'ZZTEST-INV-H1', trade_name: 'ZZTEST Crew B', week_start: '2026-11-09', job_number: 'ZZTEST-JOB-1',
        line_type: 'labour', description: 'ZZTEST posts', total_hours: 8, hourly_rate: 25, line_total_ex: 200, sent_amount_ex: 200,
        hold_reason: 'over_amount', office_review_status: 'awaiting', office_review_note: null },
      { id: L2, invoice_number: 'ZZTEST-INV-H2', trade_name: 'ZZTEST Crew C', week_start: '2026-11-16', job_number: null,
        line_type: 'travel', description: 'ZZTEST drive', total_hours: null, line_total_ex: 50.5, sent_amount_ex: 50.5,
        hold_reason: 'no_job', office_review_status: 'queried', office_review_note: 'ZZTEST which job was this?' },
      { id: L3, invoice_number: 'ZZTEST-INV-H3', trade_name: 'ZZTEST Crew D', week_start: '2026-11-16', job_number: 'ZZTEST-JOB-3',
        line_type: 'commission', total_hours: null, line_total_ex: 0, sent_amount_ex: null,
        hold_reason: 'commission_no_figure', office_review_status: 'awaiting', office_review_note: null }
    ], ...over
  };
}

async function openRun(page, { run = payRunAnswer(), held = heldAnswer(), role = 'owner' } = {}) {
  const css = fs.readFileSync(path.join(root, 'ops.html'), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ZZTEST-pay-run-held') return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1100px;margin:auto;padding:20px"><button id="payTab" data-payrun-nav>Pay run</button><div id="payRunHost"></div></main><script src="/modules/ops-pay-run.js"></script></body></html>` });
    if (url.pathname === '/modules/ops-pay-run.js') return route.fulfill({ path: path.join(root, 'modules/ops-pay-run.js'), contentType: 'text/javascript' });
    return route.abort();
  });
  await page.goto('/ZZTEST-pay-run-held');
  await page.evaluate(({ run, held, role }) => {
    window.SECUREWORKS_CLOUD = { auth: { isLoggedIn: () => true, getRole: () => role } };
    window.ZZ = { run, held, reads: [], writes: [], heldError: null, postReply: null };
    window.opsFetch = async (action) => {
      ZZ.reads.push(action);
      if (action === 'pay_run') return structuredClone(ZZ.run);
      if (action === 'held_trade_lines') {
        if (ZZ.heldError) throw Object.assign(new Error(ZZ.heldError.body.error), ZZ.heldError);
        return structuredClone(ZZ.held);
      }
      throw new Error('Unexpected read ' + action);
    };
    window.opsPost = async (action, body) => {
      ZZ.writes.push({ action, body });
      const reply = typeof ZZ.postReply === 'function' ? ZZ.postReply(action, body) : ZZ.postReply;
      if (reply && reply.__reject) throw Object.assign(new Error(reply.body.error), reply);
      if (reply) return reply;
      // The decided line leaves the list; the pay run's count goes down with it.
      ZZ.held.lines = ZZ.held.lines.filter(l => l.id !== body.line_id);
      ZZ.run.held = { lines_waiting: ZZ.run.held.lines_waiting - 1, amount_ex: 50.5 };
      return { ok: true, line: { id: body.line_id }, send: { balanced: true } };
    };
    return PayRun.open(document.getElementById('payRunHost'), document.getElementById('payTab'));
  }, { run, held, role });
}

async function pictures(page, testInfo, name) {
  for (const width of [1280, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const picture = testInfo.outputPath(`ZZTEST-${name}-${width}.png`);
    await page.screenshot({ path: picture, fullPage: true });
    await testInfo.attach(`ZZTEST-${name}-${width}`, { path: picture, contentType: 'image/png' });
  }
}

test('switches off: no held read, no panel, the held line reads exactly as before', async ({ page }) => {
  for (const over of [{}, { enabled: false }]) {
    await openRun(page, { run: payRunAnswer(over) });
    await expect(page.locator('[data-pay-run] h3')).toHaveText('Pay run');
    await expect(page.locator('[data-held-lines]')).toHaveText('Still with the office: 2 lines, $250.50');
    await expect(page.locator('[data-held-panel]')).toHaveCount(0);
    await expect(page.locator('[data-hl-act]')).toHaveCount(0);
    expect(await page.evaluate(() => ZZ.reads)).toEqual(['pay_run']);
  }
});

test('switches on: every waiting line with its job, trade, type, plain reason and sent amount ex GST', async ({ page }, testInfo) => {
  await openRun(page, { run: payRunAnswer({ enabled: true }) });
  const panel = page.locator('[data-held-panel]');
  await expect(panel.locator('[data-hl-line-row]')).toHaveCount(3);
  const one = panel.locator(`[data-hl-line-row="${L1}"]`);
  await expect(one).toContainText('ZZTEST-JOB-1');
  await expect(one).toContainText('ZZTEST Crew B');
  await expect(one).toContainText('Labour');
  await expect(one.locator('[data-hl-why]')).toHaveText('More than the job\'s work order has left.');
  await expect(one.locator('[data-hl-sent]')).toHaveText('Sent $200.00 ex GST');
  await expect(one).toContainText('Week of Mon 9 Nov 2026');
  const two = panel.locator(`[data-hl-line-row="${L2}"]`);
  await expect(two).toContainText('No job');
  await expect(two).toContainText('Travel');
  await expect(two.locator('[data-hl-why]')).toHaveText('Not on a job.');
  await expect(two.locator('[data-hl-queried]')).toContainText('ZZTEST which job was this?');
  await expect(panel.locator(`[data-hl-line-row="${L3}"] [data-hl-sent]`)).toHaveText('Sent amount not known');
  await expect(panel).not.toContainText('over_amount');
  await expect(panel).not.toContainText('$0.00');
  await expect(page.locator('[data-held-lines]')).toHaveText('Still with the office: 2 lines, $250.50');
  expect(await page.evaluate(() => ZZ.reads)).toEqual(['pay_run', 'held_trade_lines']);
  await pictures(page, testInfo, 'held-lines-panel');
});

test('approve: a reason of 3 to 500 characters, never above what was sent, then a second press posts it and both read again', async ({ page }, testInfo) => {
  await openRun(page, { run: payRunAnswer({ enabled: true }) });
  const row = page.locator(`[data-hl-line-row="${L1}"]`);
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  const form = row.locator('[data-hl-form="approve"]');
  await form.locator('input[name="reason"]').fill('ok');
  await form.getByRole('button', { name: 'Approve...' }).click();
  await expect(page.locator('[data-hl-error]')).toHaveText('Give a reason of 3 to 500 characters.');
  await form.locator('input[name="reason"]').fill('ZZTEST agreed with the lead');
  await form.locator('input[name="amount"]').fill('250');
  await form.getByRole('button', { name: 'Approve...' }).click();
  await expect(page.locator('[data-hl-error]')).toHaveText('An approval cannot pay more than the trade sent ($200.00).');
  await form.locator('input[name="amount"]').fill('180.5');
  await form.locator('input[name="hours"]').fill('7.25');
  await form.getByRole('button', { name: 'Approve...' }).click();
  const confirm = row.locator('[data-hl-confirm="approve"]');
  await expect(confirm).toContainText('It pays $180.50 ex GST for 7.25 hours, on a follow-on invoice.');
  await pictures(page, testInfo, 'held-lines-approve-confirm');
  expect(await page.evaluate(() => ZZ.writes)).toEqual([]);
  await confirm.getByRole('button', { name: 'Yes, approve this line' }).click();
  await expect(page.locator('[data-hl-notice]')).toHaveText('Line approved. It is paid on a follow-on invoice.');
  await expect(page.locator(`[data-hl-line-row="${L1}"]`)).toHaveCount(0);
  await expect(page.locator('[data-held-lines]')).toHaveText('Still with the office: 1 line, $50.50');
  expect(await page.evaluate(() => ZZ.writes)).toEqual([{ action: 'decide_held_trade_line',
    body: { line_id: L1, decision: 'approve', reason: 'ZZTEST agreed with the lead', changes: { line_total_ex: 180.5, total_hours: 7.25 } } }]);
  expect(await page.evaluate(() => ZZ.reads)).toEqual(['pay_run', 'held_trade_lines', 'pay_run', 'held_trade_lines']);
});

test('an unchanged approval names the held amount it pays; a held amount below what was sent is shown', async ({ page }) => {
  const held = heldAnswer();
  held.lines[0] = { ...held.lines[0], line_total_ex: 150 };
  await openRun(page, { run: payRunAnswer({ enabled: true }), held });
  const row = page.locator(`[data-hl-line-row="${L1}"]`);
  await expect(row.locator('[data-hl-sent]')).toHaveText('Sent $200.00 ex GST (held $150.00)');
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  await row.locator('input[name="reason"]').fill('ZZTEST as held');
  await row.getByRole('button', { name: 'Approve...' }).click();
  await expect(row.locator('[data-hl-confirm="approve"]')).toContainText('It pays $150.00 ex GST, on a follow-on invoice.');
  // A typed amount equal to what was sent still differs from the held amount, so it is sent as a change.
  await row.getByRole('button', { name: 'Back' }).click();
  await row.locator('input[name="amount"]').fill('200');
  await row.getByRole('button', { name: 'Approve...' }).click();
  await expect(row.locator('[data-hl-confirm="approve"]')).toContainText('It pays $200.00 ex GST, on a follow-on invoice.');
  await expect(page.locator('[data-week="7"]')).toBeEnabled();
  await row.getByRole('button', { name: 'Yes, approve this line' }).click();
  await expect(page.locator('[data-hl-notice]')).toBeVisible();
  expect(await page.evaluate(() => ZZ.writes)).toEqual([{ action: 'decide_held_trade_line',
    body: { line_id: L1, decision: 'approve', reason: 'ZZTEST as held', changes: { line_total_ex: 200 } } }]);
});

test('query is one press with a reason; decline asks again; no amount box on a commission with no figure', async ({ page }) => {
  await openRun(page, { run: payRunAnswer({ enabled: true }) });
  const two = page.locator(`[data-hl-line-row="${L2}"]`);
  await two.getByRole('button', { name: 'Query', exact: true }).click();
  await two.locator('input[name="reason"]').fill('ZZTEST which job, please');
  await two.getByRole('button', { name: 'Send the query' }).click();
  await expect(page.locator('[data-hl-notice]')).toHaveText('Query sent.');
  const three = page.locator(`[data-hl-line-row="${L3}"]`);
  await three.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(three.locator('input[name="amount"]')).toHaveCount(0);
  await expect(three.locator('input[name="hours"]')).toHaveCount(0);
  await three.getByRole('button', { name: 'Cancel' }).click();
  await three.getByRole('button', { name: 'Decline', exact: true }).click();
  await three.locator('input[name="reason"]').fill('ZZTEST not a sale');
  await three.getByRole('button', { name: 'Decline...' }).click();
  await expect(three.locator('[data-hl-confirm="decline"]')).toContainText('The trade sees it as not approved, with your reason.');
  await three.getByRole('button', { name: 'Yes, decline this line' }).click();
  await expect(page.locator('[data-hl-notice]')).toHaveText('Line declined.');
  expect(await page.evaluate(() => ZZ.writes)).toEqual([
    { action: 'decide_held_trade_line', body: { line_id: L2, decision: 'query', reason: 'ZZTEST which job, please' } },
    { action: 'decide_held_trade_line', body: { line_id: L3, decision: 'decline', reason: 'ZZTEST not a sale' } }
  ]);
});

test('a refusal shows the server words, never the code; a 409 reads the held lines again', async ({ page }) => {
  await openRun(page, { run: payRunAnswer({ enabled: true }) });
  await page.evaluate(() => { ZZ.postReply = { __reject: true, status: 403, body: { ok: false, error: 'approver_required', message: 'Only a pay run approver can approve this line.' } }; });
  const row = page.locator(`[data-hl-line-row="${L2}"]`);
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  await row.locator('input[name="reason"]').fill('ZZTEST fine');
  await row.getByRole('button', { name: 'Approve...' }).click();
  await row.getByRole('button', { name: 'Yes, approve this line' }).click();
  await expect(page.locator('[data-hl-error]')).toHaveText('Only a pay run approver can approve this line.');
  await expect(page.locator('[data-held-panel]')).not.toContainText('approver_required');
  await expect(row.locator('[data-hl-form="approve"]')).toBeVisible();
  await page.evaluate(() => { ZZ.postReply = { __reject: true, status: 409, body: { ok: false, error: 'held_line_already_decided', message: 'That line has already been decided.' } }; });
  await row.getByRole('button', { name: 'Approve...' }).click();
  await row.getByRole('button', { name: 'Yes, approve this line' }).click();
  await expect(page.locator('[data-hl-error]')).toHaveText('That line has already been decided.');
  await expect(row.locator('[data-hl-form]')).toHaveCount(0);
  expect((await page.evaluate(() => ZZ.reads)).filter(a => a === 'held_trade_lines').length).toBe(2);
});

test('a refused held read is said in the panel and never hides the Pay run tab; switched off shows lines without buttons', async ({ page }) => {
  // A pay run approver who is not office staff (the bookkeeper) gets no held read and no panel.
  await openRun(page, { run: payRunAnswer({ enabled: true }), role: 'bookkeeper' });
  await expect(page.locator('[data-counts]')).toBeVisible();
  await expect(page.locator('[data-held-panel]')).toHaveCount(0);
  expect(await page.evaluate(() => ZZ.reads)).toEqual(['pay_run']);

  await openRun(page, { run: payRunAnswer({ enabled: true }), role: 'ops_manager' });
  await page.evaluate(() => { ZZ.heldError = { status: 403, body: { ok: false, error: 'held_line_staff_required', message: 'Only office staff can read held lines.' } }; });
  await page.locator('[data-week="7"]').click();
  await expect(page.locator('[data-hl-refused]')).toHaveText('Only office staff can read held lines.');
  await expect(page.locator('#payTab')).toBeVisible();
  await expect(page.locator('[data-counts]')).toBeVisible();

  await openRun(page, { run: payRunAnswer({ enabled: true }), held: heldAnswer({ enabled: false }) });
  await expect(page.locator('[data-hl-off]')).toBeVisible();
  await expect(page.locator('[data-hl-line-row]')).toHaveCount(3);
  await expect(page.locator('[data-hl-act]')).toHaveCount(0);
});
