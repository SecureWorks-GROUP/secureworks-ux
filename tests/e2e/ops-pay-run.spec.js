const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Local screen proof uses WebKit. The existing GitHub runner installs Chromium only.
test.use({ browserName: process.env.CI ? 'chromium' : 'webkit', headless: true });
const root = path.resolve(__dirname, '../..');
const fields = ['tax_set_aside_percent', 'reimbursement_account_code', 'repayment_account_code', 'not_job_work_account_code'];
const empty = { inclusive_super_from: null, approvers_set: false, can_edit: true,
  missing: fields, recent_changes: [], ...Object.fromEntries(fields.map(field => [field, null])) };

async function open(page, answer = empty) {
  const css = fs.readFileSync(path.join(root, 'ops.html'), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ZZTEST-pay-settings') return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1000px;margin:auto;padding:20px"><button id="payTab">Pay run</button><div id="payHost"></div></main><script src="/modules/ops-pay-run.js"></script></body></html>` });
    if (url.pathname === '/modules/ops-pay-run.js') return route.fulfill({ path: path.join(root, 'modules/ops-pay-run.js'), contentType: 'text/javascript' });
    return route.abort();
  });
  await page.goto('/ZZTEST-pay-settings');
  await page.evaluate(answer => {
    window.ZZTEST = { answer, writes: [], failRead: false, refuse: false };
    window.opsFetch = async action => {
      if (action !== 'trade_pay_settings' || ZZTEST.failRead) throw new Error('Read unavailable');
      return structuredClone(ZZTEST.answer);
    };
    window.opsPost = async (action, body) => {
      ZZTEST.writes.push({ action, body });
      if (ZZTEST.refuse) throw new Error('Only the bookkeeper and the owner can change pay settings.');
      ZZTEST.answer[body.field] = body.value;
      ZZTEST.answer.missing = ZZTEST.answer.missing.filter(field => field !== body.field);
      ZZTEST.answer.recent_changes = [{ field: body.field, from_value: null, to_value: body.value, changed_at: '2026-11-18T00:00:00Z', changed_by_role: 'owner' }];
      return { field: body.field, value: body.value };
    };
    return PayRunSettings.mount(document.getElementById('payHost'), document.getElementById('payTab'));
  }, answer);
}

test('four missing settings, read-only director lines and tab count at desktop, iPad and phone', async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator('[data-pay-setting] [data-value]')).toHaveText(['Not set', 'Not set', 'Not set', 'Not set']);
  await expect(page.locator('#payTab')).toHaveText('Pay run (4 settings missing)');
  await expect(page.getByText('Start date: Not set', { exact: true })).toBeVisible();
  await expect(page.getByText('Approvers: Not set', { exact: true })).toBeVisible();
  for (const width of [1280, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const picture = testInfo.outputPath(`ZZTEST-pay-settings-${width}.png`);
    await page.screenshot({ path: picture, fullPage: true });
    await testInfo.attach(`ZZTEST-pay-settings-${width}`, { path: picture, contentType: 'image/png' });
  }
});

test('an approver saves the percent, a refusal stays unsaved, retry reads office changes', async ({ page }) => {
  await open(page);
  const row = page.locator('[data-pay-setting="tax_set_aside_percent"]');
  await row.getByRole('button', { name: 'Set', exact: true }).click();
  await row.getByRole('spinbutton').fill('20');
  await page.evaluate(() => { ZZTEST.refuse = true; });
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Only the bookkeeper');
  await expect(row.locator('[data-value]')).toHaveText('Not set');
  await page.evaluate(() => { ZZTEST.refuse = false; ZZTEST.answer.repayment_account_code = 'ZZTEST'; ZZTEST.answer.missing = ZZTEST.answer.missing.filter(f => f !== 'repayment_account_code'); });
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.locator('[data-value]')).toHaveText('20%');
  await expect(page.locator('[data-pay-setting="repayment_account_code"] [data-value]')).toHaveText('ZZTEST');
  await expect(page.locator('#payTab')).toHaveText('Pay run (2 settings missing)');
  await expect(page.locator('[data-pay-changes]')).toContainText('owner');
  await expect(page.locator('[data-pay-changes]')).toContainText('20%');
  expect(await page.evaluate(() => ZZTEST.writes)).toEqual([
    { action: 'set_trade_pay_setting', body: { field: 'tax_set_aside_percent', value: '20' } },
    { action: 'set_trade_pay_setting', body: { field: 'tax_set_aside_percent', value: '20' } }
  ]);
});

test('non-approvers have no edit buttons and no approver identity is shown', async ({ page }) => {
  await open(page, { ...empty, can_edit: false, approvers_set: true, inclusive_super_from: '2026-11-23',
    recent_changes: [{ field: 'tax_set_aside_percent', from_value: null, to_value: '0', changed_by: 'ZZTEST-private', changed_at: '2026-11-18T00:00:00Z' }] });
  await expect(page.locator('[data-pay-settings] button')).toHaveCount(0);
  await expect(page.getByText('Only the bookkeeper and the owner can change these.')).toBeVisible();
  await expect(page.getByText('Approvers: set', { exact: true })).toBeVisible();
  await expect(page.locator('[data-pay-settings]')).not.toContainText('ZZTEST-private');
  await expect(page.locator('[data-pay-changes]')).toContainText('0%');
});

test('a failed read offers a retry without claiming values or allowing writes', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => { ZZTEST.failRead = true; await PayRunSettings.refresh(); });
  await expect(page.getByRole('alert')).toContainText('Pay settings could not be read');
  await expect(page.locator('[data-pay-setting]')).toHaveCount(0);
  await expect(page.locator('#payTab')).toHaveText('Pay run');
  await page.evaluate(() => { ZZTEST.failRead = false; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-pay-setting]')).toHaveCount(4);
});

// P1-10.6: the weekly pay run screen (window.PayRun), read only. Role words and
// made-up amounts only; every figure is the stub's, never added up here.
const CHECK_CODES = ['pay_equals_job_cost', 'nobody_above_work_order', 'super_is_12_over_112',
  'no_paid_line_without_work_order', 'nothing_lost', 'crew_accepted'];
const CHECK_WORDS = ['Pay equals job cost', 'Nobody above a work order total', 'Super is 12/112 of every line',
  'No paid line without a work order', 'Nothing a trade sent is lost', 'Nobody paid on a job whose crew did not accept them'];

function invoice(n, trade, extra = {}) {
  return { invoice_id: `ZZTEST-id-${n}`, invoice_number: `ZZTEST-INV-${n}`, kind: 'standard', trade_name: trade,
    user_id: `ZZTEST-user-${n}`, week_start: '2026-11-16', total_inc_super: 1120, paid_to_you: 1000, super_amount: 120,
    reimbursements: 0, gst: 0, into_bank: 1000, verdict: 'clean', stops: [], xero_bill_id: null, pushed: false, ...extra };
}
function payRunAnswer(over = {}) {
  return {
    ok: true, week_start: '2026-11-16', cut_off: '2026-11-22T23:59:59+08:00', stage: 'before_xero', run: null, can_approve: true,
    counts: { clean: 3, stopped: 1, late: 2 },
    totals: { total_inc_super: 3456.78, paid_to_you: 3086.41, super: 370.37, gst: 0, reimbursements: 0, into_bank: 3086.41 },
    held: { lines_waiting: 2, amount_ex: 250.5, by_reason: [{ reason: 'ZZTEST', lines: 2, amount_ex: 250.5 }] },
    invoices: [
      invoice(4, 'Repair crew', { verdict: 'stopped', stops: [{ code: 'no_times', words: 'ZZTEST stop: a line has no finish time.' }] }),
      invoice(1, 'Fencing crew', { total_inc_super: 1234.56, into_bank: 1102.29 }),
      invoice(2, 'Lead installer'),
      invoice(3, 'Patio crew')
    ],
    late_invoices: [{ invoice_id: 'ZZTEST-late-1', invoice_number: 'ZZTEST-LATE-1', user_id: 'ZZTEST-user-late', submitted_at: '2026-11-23T08:00:00+08:00' }],
    super_by_person: [{ user_id: 'ZZTEST-user-1', trade_name: 'Fencing crew', super_amount: 132.27 },
      { user_id: 'ZZTEST-user-2', trade_name: 'Lead installer', super_amount: 120 }, { user_id: 'ZZTEST-user-3', trade_name: 'Patio crew', super_amount: 118.1 }],
    standing: CHECK_CODES.map(code => ({ code, pass: true, checked: 3, failed: 0, words: 'No difference found.', invoices: [], skipped: 0, skipped_why: null, expected: 0, actual: 0 })),
    run_blocked: false, run_blocked_words: null, clean_ids_hash: 'ZZTEST', ...over
  };
}

async function openRun(page, answer = payRunAnswer()) {
  const css = fs.readFileSync(path.join(root, 'ops.html'), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ZZTEST-pay-run') return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1100px;margin:auto;padding:20px"><button id="payTab">Pay run</button><div id="payRunHost"></div></main><script src="/modules/ops-pay-run.js"></script></body></html>` });
    if (url.pathname === '/modules/ops-pay-run.js') return route.fulfill({ path: path.join(root, 'modules/ops-pay-run.js'), contentType: 'text/javascript' });
    return route.abort();
  });
  await page.goto('/ZZTEST-pay-run');
  await page.evaluate(answer => {
    window.ZZRUN = { answer, reads: [], writes: [], fail: false, slow: {} };
    window.opsFetch = async (action, params) => {
      ZZRUN.reads.push({ action, params: params || null });
      if (action !== 'pay_run' || ZZRUN.fail) throw new Error('Read unavailable');
      const week = params && params.week_start;
      if (week && ZZRUN.slow[week]) await new Promise(resolve => setTimeout(resolve, ZZRUN.slow[week]));
      return structuredClone(week && week !== ZZRUN.answer.week_start ? { ...ZZRUN.answer, week_start: week } : ZZRUN.answer);
    };
    window.opsPost = async (action, body) => { ZZRUN.writes.push({ action, body }); throw new Error('No write is allowed'); };
    return PayRun.open(document.getElementById('payRunHost'), document.getElementById('payTab'));
  }, answer);
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

test('pay run: three clean and one stopped show counts, stop words and server totals, read only', async ({ page }, testInfo) => {
  await openRun(page);
  const run = page.locator('[data-pay-run]');
  await expect(run.getByText('Invoices in by Sunday night. Approve and upload the bank file on Wednesday. Paid on Friday.')).toBeVisible();
  await expect(run.locator('[data-week-label]')).toContainText('16 Nov 2026');
  await expect(run.locator('[data-check]')).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const row = run.locator(`[data-check="${CHECK_CODES[i]}"]`);
    await expect(row).toContainText(CHECK_WORDS[i]);
    await expect(row).toContainText('Passed, checked 3 invoices');
    await expect(row).toHaveClass(/pr-pass/);
  }
  await expect(run.locator('[data-counts]')).toHaveText(/Clean 3\s*Stopped 1\s*Late 2\s*To pay \$3,086\.41\s*Super \$370\.37/);
  const rows = run.locator('[data-pay-run-table] tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toHaveAttribute('data-verdict', 'stopped');
  await expect(rows.first()).toContainText('Repair crew');
  await expect(rows.first()).toContainText('Stopped');
  await expect(rows.first()).toContainText('ZZTEST stop: a line has no finish time.');
  await expect(run.locator('[data-invoice="ZZTEST-INV-1"]')).toContainText('$1,234.56');
  await expect(run.locator('[data-invoice="ZZTEST-INV-1"]')).toContainText('$1,102.29');
  await expect(run.locator('[data-invoice="ZZTEST-INV-1"] .pr-clean')).toHaveText('Clean');
  await expect(run.locator('[data-held-lines]')).toHaveText('Still with the office: 2 lines, $250.50');
  await expect(run.locator('[data-held-lines] a')).toHaveCount(0);
  await expect(run.locator('[data-super-table] tbody tr')).toHaveCount(4);
  await expect(run.locator('[data-super-table] .pr-total')).toHaveText(/Total\s*\$370\.37/);
  await expect(run.locator('[data-held-out]')).toHaveCount(0);
  await expect(page.locator('[data-run-blocked]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /approve/i })).toHaveCount(0);
  await expect(run).not.toContainText('ZZTEST-user');
  await expect(run).not.toContainText('ZZTEST-id');
  expect(await page.evaluate(() => ZZRUN.reads)).toEqual([{ action: 'pay_run', params: null }]);
  expect(await page.evaluate(() => ZZRUN.writes)).toEqual([]);
  await pictures(page, testInfo, 'pay-run');
});

test('pay run: a failed read shows the error words, no table and no zeros, then Try again reads it', async ({ page }, testInfo) => {
  await openRun(page);
  await page.evaluate(async () => { ZZRUN.fail = true; await PayRun.read(); });
  const run = page.locator('[data-pay-run]');
  await expect(run.getByRole('alert')).toHaveText('The pay run could not be read, so nothing is shown. Try again.');
  await expect(run.locator('table, [data-counts], [data-standing], [data-held-lines]')).toHaveCount(0);
  await expect(run).not.toContainText('$0.00');
  await pictures(page, testInfo, 'pay-run-error');
  await page.evaluate(() => { ZZRUN.fail = false; });
  await run.getByRole('button', { name: 'Try again' }).click();
  await expect(run.locator('[data-pay-run-table] tbody tr')).toHaveCount(4);
});

test('pay run: an invoice two standing checks stopped counts once as held out, with both check words and no banner', async ({ page }, testInfo) => {
  const base = payRunAnswer();
  const stopped = invoice(5, 'Fencing crew', { verdict: 'stopped', stops: [
    { code: 'standing_super_is_12_over_112', words: 'ZZTEST: super on a line is not 12/112.' },
    { code: 'standing_crew_accepted', words: 'ZZTEST: paid on a job whose crew did not accept them.' }] });
  await openRun(page, payRunAnswer({
    counts: { clean: 2, stopped: 2, late: 0 },
    invoices: [base.invoices[0], stopped, base.invoices[2], base.invoices[3]],
    standing: base.standing.map(c => ['super_is_12_over_112', 'crew_accepted'].includes(c.code)
      ? { ...c, pass: false, failed: 1, checked: 3 } : c)
  }));
  const run = page.locator('[data-pay-run]');
  for (const code of ['super_is_12_over_112', 'crew_accepted']) {
    await expect(run.locator(`[data-check="${code}"]`)).toHaveClass(/pr-fail/);
    await expect(run.locator(`[data-check="${code}"]`)).toContainText('Failed, checked 3 invoices');
  }
  await expect(run.locator('[data-check].pr-pass')).toHaveCount(4);
  await expect(run.locator('[data-held-out]')).toHaveText('1 invoice(s) held out of this run. Everyone else is paid as normal.');
  const row = run.locator('[data-invoice="ZZTEST-INV-5"]');
  await expect(row).toHaveAttribute('data-verdict', 'stopped');
  await expect(row).toContainText('ZZTEST: super on a line is not 12/112.');
  await expect(row).toContainText('ZZTEST: paid on a job whose crew did not accept them.');
  await expect(page.locator('[data-run-blocked]')).toHaveCount(0);
  await pictures(page, testInfo, 'pay-run-held-out');
});

test('pay run: a blocked week shows the banner above everything with the server words and no approve button', async ({ page }, testInfo) => {
  await openRun(page, payRunAnswer({ run_blocked: true, run_blocked_words: 'ZZTEST: job cost and pay differ by an amount no invoice explains.' }));
  const banner = page.locator('[data-run-blocked]');
  await expect(banner).toContainText('The pay run is stopped.');
  await expect(banner).toContainText('ZZTEST: job cost and pay differ by an amount no invoice explains.');
  await expect(banner).toContainText('Nobody is paid until this is clear. Open the pay run again when it is fixed.');
  expect(await page.evaluate(() => document.querySelector('[data-pay-run]').firstElementChild.hasAttribute('data-run-blocked'))).toBe(true);
  await expect(page.getByRole('button', { name: /approve/i })).toHaveCount(0);
  await pictures(page, testInfo, 'pay-run-blocked');
});

test('pay run: a missing check is unreadable, a null figure reads Not read, a follow-on row names its week', async ({ page }) => {
  const base = payRunAnswer();
  await openRun(page, payRunAnswer({ standing: base.standing.filter(c => c.code !== 'nothing_lost') }));
  const run = page.locator('[data-pay-run]');
  await expect(run.getByRole('alert')).toHaveText('The pay run could not be read, so nothing is shown. Try again.');
  await expect(run.locator('[data-check]')).toHaveCount(0);
  await page.evaluate(async () => {
    ZZRUN.answer.standing.push({ code: 'nothing_lost', pass: true, checked: 0, failed: 0, words: 'No difference found.', invoices: [], skipped: 2, skipped_why: 'ZZTEST' });
    ZZRUN.answer.invoices[0] = { ...ZZRUN.answer.invoices[0], total_inc_super: null, paid_to_you: null, super_amount: null, into_bank: null,
      stops: [{ code: 'money_unreadable', words: "This invoice's pay figures do not add up. Check it by hand." }] };
    ZZRUN.answer.invoices[1] = { ...ZZRUN.answer.invoices[1], kind: 'follow_on', week_start: '2026-11-02' };
    await PayRun.read();
  });
  await expect(run.locator('[data-check="nothing_lost"]')).toContainText('Passed, checked 0 invoices, skipped 2');
  const nullRow = run.locator('[data-invoice="ZZTEST-INV-4"]');
  await expect(nullRow.locator('.pr-none')).toHaveCount(4);
  await expect(nullRow).toContainText('Not read');
  await expect(nullRow).not.toContainText('$0.00');
  await expect(nullRow).toContainText("This invoice's pay figures do not add up. Check it by hand.");
  await expect(run.locator('[data-invoice="ZZTEST-INV-1"]')).toContainText('Approved lines from week of Mon 2 Nov 2026');
  await expect(run.locator('[data-invoice="ZZTEST-INV-2"]')).not.toContainText('Approved lines from week of');
});

test('pay run: the week steps by 7 days from the shown week, a slower earlier read is dropped, an empty week says so', async ({ page }) => {
  await openRun(page);
  const run = page.locator('[data-pay-run]');
  await page.evaluate(() => { ZZRUN.slow['2026-11-09'] = 600; });
  await run.getByRole('button', { name: 'Previous week' }).click();
  await page.evaluate(() => { ZZRUN.answer = { ...ZZRUN.answer, invoices: [], super_by_person: [], counts: { clean: 0, stopped: 0, late: 0 } }; });
  await page.evaluate(() => PayRun.read('2026-11-23'));
  await expect(run.locator('[data-week-label]')).toContainText('23 Nov 2026');
  await expect(run.locator('[data-empty]')).toHaveText('No invoices for this pay week.');
  await page.waitForTimeout(800);
  await expect(run.locator('[data-week-label]')).toContainText('23 Nov 2026');
  await expect(run.locator('[data-empty]')).toBeVisible();
  expect((await page.evaluate(() => ZZRUN.reads)).map(r => r.params && r.params.week_start)).toEqual([null, '2026-11-09', '2026-11-23']);
});

// F1 pay run buttons: gated on pay_run.enabled === true and approver role; warnings never block.
async function openRunWithWrites(page, answer, { role = 'owner', onPost = null } = {}) {
  const css = fs.readFileSync(path.join(root, 'ops.html'), 'utf8').match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/ZZTEST-pay-run-actions') return route.fulfill({ contentType: 'text/html', body:
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1100px;margin:auto;padding:20px"><button id="payTab">Pay run</button><div id="payRunHost"></div></main><script src="/modules/ops-pay-run.js"></script></body></html>` });
    if (url.pathname === '/modules/ops-pay-run.js') return route.fulfill({ path: path.join(root, 'modules/ops-pay-run.js'), contentType: 'text/javascript' });
    return route.abort();
  });
  await page.goto('/ZZTEST-pay-run-actions');
  await page.evaluate(({ answer, role, onPostSrc }) => {
    window.SECUREWORKS_CLOUD = { auth: { isLoggedIn: () => true, getRole: () => role, getUser: () => ({ id: 'ZZTEST-approver' }) } };
    window.ZZRUN = { answer, reads: [], writes: [], postReply: null };
    const handler = onPostSrc ? eval('(' + onPostSrc + ')') : null;
    window.opsFetch = async (action, params) => {
      ZZRUN.reads.push({ action, params: params || null });
      if (action !== 'pay_run') throw new Error('Unexpected read ' + action);
      return structuredClone(ZZRUN.answer);
    };
    window.opsPost = async (action, body) => {
      ZZRUN.writes.push({ action, body });
      if (ZZRUN.postReply) {
        const next = typeof ZZRUN.postReply === 'function' ? ZZRUN.postReply(action, body) : ZZRUN.postReply;
        ZZRUN.postReply = null;
        if (next && next.__reject) throw Object.assign(new Error(next.message || 'refused'), next);
        return next;
      }
      if (handler) return handler(action, body, ZZRUN);
      return { ok: true };
    };
    return PayRun.open(document.getElementById('payRunHost'), document.getElementById('payTab'));
  }, { answer, role, onPostSrc: onPost ? onPost.toString() : null });
}

test('pay run actions: hidden when enabled is false or absent, and hidden for non-approver roles', async ({ page }) => {
  await openRunWithWrites(page, payRunAnswer({ enabled: false }), { role: 'owner' });
  const run = page.locator('[data-pay-run]');
  await expect(run.locator('[data-pay-run-actions]')).toHaveCount(0);
  await expect(run.locator('button')).toHaveText(['← Previous', 'Next →']);

  // Non-approver role gets no write buttons even when enabled is true.
  await openRunWithWrites(page, payRunAnswer({ enabled: true }), { role: 'sales' });
  await expect(run.locator('[data-pay-run-actions]')).toHaveCount(0);
  await expect(run.locator('button')).toHaveText(['← Previous', 'Next →']);

  // Blocked week with enabled true still shows no Approve button.
  await openRunWithWrites(page, payRunAnswer({ enabled: true, run_blocked: true, run_blocked_words: 'ZZTEST: blocked.' }), { role: 'owner' });
  await expect(run.getByRole('button', { name: /approve/i })).toHaveCount(0);
});

test('pay run actions: work-order warning shows on a clean row and never blocks Approve or Push', async ({ page }) => {
  const warnedInvoice = invoice(1, 'Fencing crew', {
    notes: [{ code: 'hourly_no_agreed_amount', words: 'ZZTEST warning: job work order has no agreed amount.' }]
  });
  const initial = payRunAnswer({
    enabled: true,
    counts: { clean: 2, stopped: 1, late: 0 },
    invoices: [
      invoice(4, 'Repair crew', { verdict: 'stopped', stops: [{ code: 'no_times', words: 'ZZTEST stop.' }] }),
      warnedInvoice,
      invoice(2, 'Patio crew')
    ]
  });
  await openRunWithWrites(page, initial, {
    role: 'owner',
    onPost: (action, body, state) => {
      if (action === 'approve_pay_run') {
        state.answer = {
          ...state.answer,
          run: { id: 'ZZTEST-run-1', week_start: '2026-11-16', status: 'approved', approved_at: '2026-11-19T08:00:00Z' }
        };
        return { ok: true, week_start: body.week_start, run: { run_id: 'ZZTEST-run-1', week_start: body.week_start } };
      }
      if (action === 'push_pay_run_invoice') {
        state.answer = {
          ...state.answer,
          invoices: state.answer.invoices.map(i => i.invoice_id === body.invoice_id ? { ...i, pushed: true, xero_bill_id: 'ZZTEST-XERO-1' } : i)
        };
        return { ok: true, run_id: body.run_id, invoice_id: body.invoice_id, xero_bill_id: 'ZZTEST-XERO-1' };
      }
      return { ok: true };
    }
  });
  const run = page.locator('[data-pay-run]');
  const row1 = run.locator('[data-invoice="ZZTEST-INV-1"]');
  await expect(row1.locator('[data-notes]')).toContainText('Warning');
  await expect(row1.locator('[data-notes]')).toContainText('ZZTEST warning: job work order has no agreed amount.');
  await expect(row1.locator('.pr-clean')).toHaveText('Clean');

  // Two-press Approve: warns about the work-order warning but does not block.
  await run.getByRole('button', { name: 'Approve pay run' }).click();
  await expect(run.locator('[data-pr-warn-summary]')).toContainText('1 clean invoice carries a work-order warning. Approving still pays them.');
  expect(await page.evaluate(() => ZZRUN.writes)).toEqual([]);
  await run.getByRole('button', { name: 'Yes, approve pay run' }).click();
  await expect(run.locator('[data-pr-notice]')).toHaveText('Pay run approved.');
  await expect(run.locator('[data-run-status]')).toContainText('Pay run approved');

  // Push the clean invoice with the work-order warning: never blocked.
  await row1.getByRole('button', { name: 'Push to Xero' }).click();
  await row1.getByRole('button', { name: 'Yes, push draft bill' }).click();
  await expect(run.locator('[data-pr-notice]')).toHaveText('Pushed ZZTEST-INV-1 to Xero as a draft bill.');
  await expect(row1.locator('[data-pushed]')).toHaveText('Pushed to Xero');
  await expect(row1.getByRole('button', { name: 'Push to Xero' })).toHaveCount(0);

  expect(await page.evaluate(() => ZZRUN.writes)).toEqual([
    { action: 'approve_pay_run', body: { week_start: '2026-11-16', expected_clean_ids_hash: 'ZZTEST' } },
    { action: 'push_pay_run_invoice', body: { run_id: 'ZZTEST-run-1', invoice_id: 'ZZTEST-id-1' } }
  ]);
  for (const width of [1280, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('pay run actions: release requires a reason, surfaces server 409 words, and mark super paid stamps pushed runs', async ({ page }) => {
  const approvedRun = payRunAnswer({
    enabled: true,
    run: { id: 'ZZTEST-run-2', week_start: '2026-11-16', status: 'approved', approved_at: '2026-11-19T08:00:00Z' },
    counts: { clean: 2, stopped: 0, late: 0 },
    invoices: [
      invoice(1, 'Fencing crew', { pushed: true, xero_bill_id: 'ZZTEST-BILL-1' }),
      invoice(2, 'Patio crew', { pushed: false })
    ]
  });
  await openRunWithWrites(page, approvedRun, {
    role: 'bookkeeper',
    onPost: (action, body, state) => {
      if (action === 'release_pay_run_invoice') {
        state.answer = {
          ...state.answer,
          run: { ...state.answer.run, status: 'pushed' },
          invoices: state.answer.invoices.map(i => i.invoice_id === body.invoice_id
            ? { ...i, verdict: 'stopped', stops: [{ code: 'released_from_run', words: 'Taken out of this run and sent back to review.' }] }
            : i)
        };
        return { ok: true, run_status: 'pushed' };
      }
      if (action === 'mark_pay_run_super_paid') {
        return { ok: true, run_id: body.run_id, super_marked_paid_at: '2026-11-19T09:00:00Z' };
      }
      return { ok: true };
    }
  });
  const run = page.locator('[data-pay-run]');
  const row2 = run.locator('[data-invoice="ZZTEST-INV-2"]');

  // Mark super paid is hidden while run is still approved (not pushed).
  await expect(run.getByRole('button', { name: 'Mark super paid' })).toHaveCount(0);

  // Release: 409 server words shown (never bare code) and re-reads.
  await page.evaluate(() => {
    ZZRUN.postReply = { __reject: true, status: 409, body: { error: 'pay_run_xero_check_found_in_xero', message: 'The Xero check found this invoice in Xero, so it stays in the run.' } };
  });
  await row2.getByRole('button', { name: 'Release from run' }).click();
  await row2.locator('input[name="reason"]').fill('ZZTEST repayment changed');
  await row2.getByRole('button', { name: 'Yes, release from run' }).click();
  await expect(run.locator('[data-pr-error]')).toHaveText('The Xero check found this invoice in Xero, so it stays in the run.');
  await expect(run).not.toContainText('pay_run_xero_check_found_in_xero');

  // Release succeeds -> run moves to pushed -> Mark super paid appears.
  await row2.getByRole('button', { name: 'Release from run' }).click();
  await row2.locator('input[name="reason"]').fill('ZZTEST checked and cleared');
  await row2.getByRole('button', { name: 'Yes, release from run' }).click();
  await expect(run.locator('[data-pr-notice]')).toHaveText('Released ZZTEST-INV-2 back to review.');
  await expect(run.locator('[data-run-status]')).toContainText('Pay run pushed to Xero');
  await expect(row2.getByRole('button', { name: 'Release from run' })).toHaveCount(0);

  // Mark super paid: two-press confirm, remembers stamp even when backend pay_run omits super_marked_paid_at.
  await run.getByRole('button', { name: 'Mark super paid' }).click();
  await run.getByRole('button', { name: 'Yes, mark super paid' }).click();
  await expect(run.locator('[data-pr-notice]')).toHaveText('Super marked paid.');
  await expect(run.locator('[data-run-status]')).toContainText('Super marked paid on 19 Nov 2026');
  await expect(run.getByRole('button', { name: 'Mark super paid' })).toHaveCount(0);

  expect(await page.evaluate(() => ZZRUN.writes)).toEqual([
    { action: 'release_pay_run_invoice', body: { run_id: 'ZZTEST-run-2', invoice_id: 'ZZTEST-id-2', reason: 'ZZTEST repayment changed' } },
    { action: 'release_pay_run_invoice', body: { run_id: 'ZZTEST-run-2', invoice_id: 'ZZTEST-id-2', reason: 'ZZTEST checked and cleared' } },
    { action: 'mark_pay_run_super_paid', body: { run_id: 'ZZTEST-run-2' } }
  ]);

  // When backend pay_run already includes run.super_marked_paid_at, shows stamp and no button on load.
  await openRunWithWrites(page, payRunAnswer({
    enabled: true,
    run: { id: 'ZZTEST-run-3', week_start: '2026-11-16', status: 'pushed', super_marked_paid_at: '2026-11-18T16:30:00Z' },
    counts: { clean: 1, stopped: 0, late: 0 },
    invoices: [invoice(1, 'Fencing crew', { pushed: true })]
  }), { role: 'owner' });
  await expect(run.locator('[data-run-status]')).toContainText('Super marked paid on 19 Nov 2026');
  await expect(run.getByRole('button', { name: 'Mark super paid' })).toHaveCount(0);
});
