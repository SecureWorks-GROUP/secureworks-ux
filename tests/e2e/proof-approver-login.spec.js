// Proof (director 16:46, Follow-up 56): a named pay approver who signs in to
// Ops sees the Pay run tab, Repayments and Pay settings; a staff login that is
// not on the approver list is refused on each and is shown no figure.
//
// The real ops.html boots with a mocked Supabase session per person (its own
// access token and user id). A stand-in ops-api answers by that token alone,
// as the server does: the approver list is the server's, the app sends no
// person. Roles only, made-up amounts, no network.
//
// Pay settings: on main, PayRunSettings (modules/ops-pay-run.js) is loaded but
// not yet mounted in the Pay run tab (open faults, Follow-up 31), so this spec
// mounts it into the Pay run host itself, as the one-line mount would.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const SHOTS = process.env.PROOF_SHOT_DIR || '';

const PEOPLE = {
  approver: { token: 'zztest-approver-token', id: '00000000-0000-4000-8000-0000000000a1', email: 'approver@example.test', role: 'owner' },
  staff: { token: 'zztest-staff-token', id: '00000000-0000-4000-8000-0000000000b2', email: 'staff@example.test', role: 'ops_manager' }
};
// The server's approver list (pay_run_approver_user_ids). Only this id is on it.
const APPROVER_IDS = new Set([PEOPLE.approver.id]);
const REFUSAL = 'Only a pay run approver can read this.';

function payRun() {
  const codes = ['pay_equals_job_cost', 'nobody_above_work_order', 'super_is_12_over_112',
    'no_paid_line_without_work_order', 'nothing_lost', 'crew_accepted'];
  const row = (n, trade) => ({ invoice_id: `ZZTEST-id-${n}`, invoice_number: `ZZTEST-INV-${n}`, kind: 'standard',
    trade_name: trade, user_id: `ZZTEST-user-${n}`, week_start: '2026-11-09', total_inc_super: 1120, paid_to_you: 1000,
    super_amount: 120, reimbursements: 0, gst: 0, into_bank: 1000, verdict: 'clean', stops: [], xero_bill_id: null, pushed: false });
  return {
    ok: true, week_start: '2026-11-09', cut_off: '2026-11-15T23:59:59+08:00', stage: 'before_xero', run: null, can_approve: true,
    counts: { clean: 2, stopped: 0, late: 0 },
    totals: { total_inc_super: 2240, paid_to_you: 2000, super: 240, gst: 0, reimbursements: 0, into_bank: 2000 },
    held: { lines_waiting: 0, amount_ex: 0, by_reason: [] },
    invoices: [row(1, 'Fencing crew'), row(2, 'Patio crew')], late_invoices: [],
    super_by_person: [{ user_id: 'ZZTEST-user-1', trade_name: 'Fencing crew', super_amount: 120 },
      { user_id: 'ZZTEST-user-2', trade_name: 'Patio crew', super_amount: 120 }],
    standing: codes.map((code) => ({ code, pass: true, checked: 2, failed: 0, skipped: 0 })),
    run_blocked: false, run_blocked_words: null, clean_ids_hash: 'ZZTEST'
  };
}
const REPAYMENTS = { repayments: [{ id: 'ZZTEST-rp-1', user_id: 'ZZTEST-user-1', trade_name: 'Fencing crew', label: 'Ute hire',
  amount: 150, balance_total: 1500, balance_left: 1050, first_week_start: '2026-10-05', active: true, stopped_at: null }] };
const SETTINGS = { tax_set_aside_percent: 20, reimbursement_account_code: 'ZZ-400', repayment_account_code: 'ZZ-401',
  not_job_work_account_code: 'ZZ-402', inclusive_super_from: '2026-11-23', approvers_set: true, can_edit: true,
  missing: [], recent_changes: [] };
const APPROVER_ONLY = { pay_run: payRun, list_trade_repayments: () => REPAYMENTS, trade_pay_settings: () => SETTINGS };

async function signIn(page, who) {
  const person = PEOPLE[who];
  const calls = [];
  await page.addInitScript((p) => {
    const user = { id: p.id, email: p.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
    const session = { access_token: p.token, refresh_token: 'zztest-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user };
    const auth = {
      async getSession() { return { data: { session }, error: null }; },
      async getUser() { return { data: { user }, error: null }; },
      async refreshSession() { return { data: { session }, error: null }; },
      async signInWithPassword() { return { data: { user, session }, error: null }; },
      async signInWithOtp() { return { data: {}, error: null }; },
      async signOut() { return { error: null }; },
      onAuthStateChange(listener) { setTimeout(() => listener('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; }
    };
    const query = {
      select() { return query; }, insert() { return query; }, update() { return query; }, delete() { return query; },
      eq() { return query; }, order() { return query; }, limit() { return query; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
    };
    window.supabase = { createClient() { return { auth, from() { return query; }, channel() { return { on() { return this; }, subscribe() { return this; } }; } }; } };
  }, person);

  // The stand-in server: who is asking comes from the bearer token only.
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith('file://')) return route.continue();
    const token = String(req.headers().authorization || '').replace(/^Bearer /, '');
    const caller = Object.values(PEOPLE).find((p) => p.token === token) || null;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (/\/functions\/v1\/ghl-proxy\?action=get_profile/.test(url)) {
      if (!caller) return json(401, { error: 'Sign in required' });
      return json(200, { profile: { id: caller.id, email: caller.email, name: 'ZZTEST ' + caller.role, role: caller.role, org_id: '00000000-0000-0000-0000-000000000001' } });
    }
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (match) {
      const action = match[1];
      const params = Object.fromEntries(new URL(url).searchParams);
      calls.push({ action, method: req.method(), caller: caller && caller.role, params });
      if (APPROVER_ONLY[action]) {
        if (!caller || !APPROVER_IDS.has(caller.id)) return json(403, { error: REFUSAL, message: REFUSAL, code: 'pay_run_approver_required' });
        return json(200, APPROVER_ONLY[action]());
      }
      if (action === 'list_trade_invoices') return json(200, { invoices: [], rates: [] });
      return json(200, action === 'pipeline' ? { columns: {} } : {});
    }
    return json(200, {});
  });
  await page.goto(OPS_FILE);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  await expect.poll(() => calls.filter((c) => c.action === 'pay_run').length).toBeGreaterThanOrEqual(1);
  return calls;
}

async function openFinancials(page) {
  await page.locator('.header-nav button[data-view="financials"]').click();
  await expect(page.locator('#viewFinancials')).toHaveClass(/active/);
}

async function mountPaySettings(page) {
  // Not mounted on main yet; mount it into the Pay run host the way open() would.
  await page.evaluate(() => window.PayRunSettings.mount(document.getElementById('payRunHost'), null));
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
}

test.use({ viewport: { width: 1280, height: 900 } });

test('a named pay approver sees the Pay run tab, Repayments and Pay settings', async ({ page }) => {
  const calls = await signIn(page, 'approver');
  await openFinancials(page);

  // Pay run tab: shown after the server answered pay_run for this login.
  const tab = page.locator('#viewFinancials .sub-tab[data-sub="payrun"]');
  await expect(tab).toBeVisible();
  await tab.click();
  const run = page.locator('#subPayrun [data-pay-run]');
  await expect(run.locator('[data-week-label]')).toHaveText('Week of Mon 9 Nov 2026');
  await expect(run.locator('[data-counts]')).toContainText('To pay $2,000.00');
  await expect(run.locator('[data-pay-run-table] tbody tr')).toHaveCount(2);
  await shot(page, 'approver-pay-run.png');

  // Pay settings, in the Pay run host.
  await mountPaySettings(page);
  const settings = page.locator('#payRunHost [data-pay-settings]');
  await expect(settings.locator('[data-pay-setting]')).toHaveCount(4);
  await expect(settings.locator('[data-pay-setting="tax_set_aside_percent"] [data-value]')).toHaveText('20%');
  await expect(settings.locator('[data-pay-setting="repayment_account_code"] [data-value]')).toHaveText('ZZ-401');
  await settings.scrollIntoViewIfNeeded();
  await shot(page, 'approver-pay-settings.png');

  // Repayments, on the Trade Bills sub tab.
  await page.locator('#viewFinancials .sub-tab[data-sub="tradebills"]').click();
  const repay = page.locator('#subTradebills [data-repayments]');
  await expect(repay.locator('[data-repayment-row]')).toHaveCount(1);
  await expect(repay.locator('[data-repayment-row]')).toContainText('Ute hire');
  await expect(repay.locator('[data-balance]')).toHaveText('$1,050.00');
  await expect(repay.getByRole('button', { name: 'Set a repayment' })).toBeVisible();
  await repay.scrollIntoViewIfNeeded();
  await shot(page, 'approver-repayments.png');

  // Every approver read came from this login, sent no person, and nothing was written.
  const pay = calls.filter((c) => APPROVER_ONLY[c.action]);
  expect(new Set(pay.map((c) => c.action))).toEqual(new Set(['pay_run', 'list_trade_repayments', 'trade_pay_settings']));
  for (const c of pay) {
    expect(c.caller).toBe('owner');
    expect(c.method).toBe('GET');
    expect(Object.keys(c.params).filter((k) => /user|trade_id|approver/.test(k))).toEqual([]);
  }
});

test('a staff login not on the approver list is refused on the Pay run tab, Repayments and Pay settings', async ({ page }) => {
  const calls = await signIn(page, 'staff');
  await openFinancials(page);

  // Pay run tab: the server refused pay_run for this login, so the tab is not shown.
  await expect(page.locator('#viewFinancials .sub-tab[data-sub="payrun"]')).toBeHidden();
  // Opening the screen anyway (a stale link) shows the server's refusal, no figures.
  await page.evaluate(() => window.PayRun.open(document.getElementById('payRunHost'), null));
  await page.evaluate(() => {
    document.querySelectorAll('#viewFinancials .sub-view').forEach((v) => v.classList.remove('active'));
    document.getElementById('subPayrun').classList.add('active');
  });
  const run = page.locator('#subPayrun [data-pay-run]');
  await expect(run.locator('[role="alert"]')).toHaveText(REFUSAL);
  await expect(run.locator('table')).toHaveCount(0);
  await expect(run).not.toContainText('$');
  await shot(page, 'staff-pay-run-refused.png');

  // Pay settings: the read is refused, so no setting and no value is shown.
  await mountPaySettings(page);
  const settings = page.locator('#payRunHost [data-pay-settings]');
  await expect(settings.locator('[role="alert"]')).toHaveText('Pay settings could not be read. Try again to see the current settings.');
  await expect(settings.locator('[data-pay-setting]')).toHaveCount(0);
  await expect(settings).not.toContainText('ZZ-401');
  await expect(settings).not.toContainText('20%');
  await settings.scrollIntoViewIfNeeded();
  await shot(page, 'staff-pay-settings-refused.png');

  // Repayments: refused in the server's words, no rows, no control.
  await page.locator('#viewFinancials .sub-tab[data-sub="tradebills"]').click();
  const repay = page.locator('#subTradebills [data-repayments]');
  await expect(repay.locator('[role="alert"]')).toHaveText(REFUSAL);
  await expect(repay.locator('[data-repayment-row]')).toHaveCount(0);
  await expect(repay).not.toContainText('Ute hire');
  await expect(repay.getByRole('button', { name: 'Set a repayment' })).toHaveCount(0);
  await repay.scrollIntoViewIfNeeded();
  await shot(page, 'staff-repayments-refused.png');

  const pay = calls.filter((c) => APPROVER_ONLY[c.action]);
  expect(new Set(pay.map((c) => c.action))).toEqual(new Set(['pay_run', 'list_trade_repayments', 'trade_pay_settings']));
  for (const c of pay) {
    expect(c.caller).toBe('ops_manager');
    expect(c.method).toBe('GET');
  }
});
