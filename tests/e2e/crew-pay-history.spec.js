// SecureWorks Crew: My pay (#/pay/history) across weeks, months and financial
// years, year-on-year comparison, super status by invoice, rate history and
// bad-path handling on the in-browser demo server. Roles and ZZTEST data only.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

function fmtCash(n) {
  const v = Number(n);
  const s = Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}$${s}`;
}

async function scrubNamesForProof(page) {
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    db.me.name = 'Crew';
    db.others.forEach((p) => { p.name = 'Crew'; });
    db.jobs.forEach((j) => { j.client_name = 'Customer'; j.site_address = ''; j.site_suburb = 'ZZTEST'; j.client_phone = ''; });
    db.invoices.forEach((inv, idx) => {
      if (inv.invoice_number) inv.invoice_number = `ZZTEST-INV-${String(idx + 1).padStart(2, '0')}`;
    });
    store.setState({ user: { ...store.getState().user, name: 'Crew', label: 'Crew' } });
    store.clearQueries();
  });
}

test('Pay links to My pay, three tabs render demo totals, year card shows both years, and tapping a week opens it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await scrubNamesForProof(page);
  await page.evaluate(() => { location.hash = '#/pay'; });

  await page.getByRole('button', { name: /My pay over time/ }).click();
  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();

  const expected = await page.evaluate(() => window.__crewDemo.ops.my_pay_history({ years: 2 }));
  expect(expected.weeks).toHaveLength(8);
  expect(expected.years).toHaveLength(2);
  expect(expected.super.not_recorded_count).toBe(0);

  // Weeks tab: 8 rows, each with period, bar width, and the three figures.
  const weeksTab = page.getByRole('tab', { name: 'Weeks', exact: true });
  const monthsTab = page.getByRole('tab', { name: 'Months', exact: true });
  const yearsTab = page.getByRole('tab', { name: 'Years', exact: true });
  await expect(weeksTab).toHaveAttribute('aria-selected', 'true');

  const rows = page.locator('.pay-hrow');
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText('Total (includes super)');
  await expect(rows.first()).toContainText(fmtCash(expected.weeks[0].total_inc_super));
  await expect(rows.first()).toContainText('Paid to you');
  await expect(rows.first()).toContainText(fmtCash(expected.weeks[0].paid_to_you));
  await expect(rows.first()).toContainText('Paid to your super fund');
  await expect(rows.first()).toContainText(fmtCash(expected.weeks[0].paid_to_super));
  await expect(rows.nth(7)).toContainText(fmtCash(expected.weeks[7].paid_to_you));

  const barStyle = await rows.first().locator('.pay-hbar-fill').getAttribute('style');
  expect(barStyle).toMatch(/^width:\s*\d+(\.\d+)?%;?$/);
  await expect(page.locator('main.page svg, main.page canvas')).toHaveCount(0);

  if (process.env.CREW_PAY_HISTORY_PROOF) {
    for (const [label, width, height] of [['phone-390', 390, 844], ['ipad-820', 820, 1180], ['desktop-1280', 1280, 900]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-weeks-${label}.png`, animations: 'disabled' });
    }
    await page.setViewportSize(PHONE.viewport);
  }

  // Months tab renders demo month totals.
  await monthsTab.click();
  await expect(monthsTab).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveCount(expected.months.length);
  await expect(rows.first()).toContainText(expected.months[0].label);
  await expect(rows.first()).toContainText(fmtCash(expected.months[0].total_inc_super));
  await expect(rows.first()).toContainText(fmtCash(expected.months[0].paid_to_you));
  await expect(rows.first()).toContainText(fmtCash(expected.months[0].paid_to_super));

  // Years tab renders both financial years.
  await yearsTab.click();
  await expect(yearsTab).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(expected.years[0].fy_label);
  await expect(rows.nth(0)).toContainText(fmtCash(expected.years[0].paid_to_you));
  await expect(rows.nth(1)).toContainText(expected.years[1].fy_label);
  await expect(rows.nth(1)).toContainText(fmtCash(expected.years[1].paid_to_you));

  if (process.env.CREW_PAY_HISTORY_PROOF) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-years-phone-390.png`, animations: 'disabled' });
    await page.evaluate(() => { const m = document.querySelector('main.page'); if (m) m.scrollTop = m.scrollHeight; });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-cards-phone-390.png`, animations: 'disabled' });
    await page.evaluate(() => { const m = document.querySelector('main.page'); if (m) m.scrollTop = 0; });
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-years-ipad-820.png`, animations: 'disabled' });
    await page.setViewportSize(PHONE.viewport);
  }

  // This year and last year card: side by side with both Paid to you and super figures.
  const compare = page.locator('.pay-hcompare');
  await expect(compare).toContainText('So far this financial year');
  await expect(compare).toContainText('Same point last year');
  const cols = compare.locator('.pay-hcol');
  await expect(cols).toHaveCount(2);
  await expect(cols.nth(0)).toContainText(fmtCash(expected.this_year_vs_last.this_fy.paid_to_you));
  await expect(cols.nth(0)).toContainText(fmtCash(expected.this_year_vs_last.this_fy.paid_to_super));
  await expect(cols.nth(1)).toContainText(fmtCash(expected.this_year_vs_last.last_fy_same_point.paid_to_you));
  await expect(cols.nth(1)).toContainText(fmtCash(expected.this_year_vs_last.last_fy_same_point.paid_to_super));
  const leftBox = await cols.nth(0).boundingBox();
  const rightBox = await cols.nth(1).boundingBox();
  expect(leftBox.x).toBeLessThan(rightBox.x);
  expect(Math.abs(leftBox.y - rightBox.y)).toBeLessThan(4);

  // Super card: this FY, since start, and per-invoice fund statuses.
  const superSec = page.locator('section.sec', { has: page.getByRole('heading', { name: 'Super', exact: true }) });
  await expect(superSec).toContainText('This financial year');
  await expect(superSec).toContainText(fmtCash(expected.super.this_fy));
  await expect(superSec).toContainText('Since you started');
  await expect(superSec).toContainText(fmtCash(expected.super.since_start));
  await expect(superSec).toContainText('To be paid to your fund');
  await expect(superSec).toContainText('Paid to your fund');
  await expect(page.getByText(/Super not recorded on/)).toHaveCount(0);

  // Your rate card: newest effective_from first.
  const rateSec = page.locator('section.sec', { has: page.getByRole('heading', { name: 'Your rate', exact: true }) });
  const rateRows = rateSec.locator('.kvrow');
  await expect(rateRows).toHaveCount(2);
  await expect(rateRows.nth(0)).toContainText('1 Jul 2026');
  await expect(rateRows.nth(1)).toContainText('1 Jul 2025');

  // Approved pay words only, no em dashes.
  const bodyText = await page.locator('main.page').innerText();
  expect(bodyText).not.toMatch(/taken off|take off|withheld|deducted|weekly deduction/i);
  expect(bodyText).not.toContain('\u2014');

  // Tapping a week row opens #/pay/week/<monday>.
  await weeksTab.click();
  const targetMonday = expected.weeks[0].week_start;
  await rows.first().click();
  await expect(page).toHaveURL(new RegExp(`#/pay/week/${targetMonday}$`));
  await expect(page.getByRole('heading', { name: 'Timesheet', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('My pay has no sideways scroll at 360 wide across all three tabs', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(crewUrl('#/pay/history'));
  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();
  await expect(page.locator('.pay-hrow').first()).toBeVisible();

  for (const name of ['Weeks', 'Months', 'Years']) {
    await page.getByRole('tab', { name, exact: true }).click();
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main.page');
      return {
        doc: document.documentElement.scrollWidth - window.innerWidth,
        page: main ? main.scrollWidth - main.clientWidth : 0
      };
    });
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});

test('ZZTEST empty history, empty rate, 10-invoice Super cap, and per-trade isolation', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay/history', 'new'));
  await expect(page.getByText('Nothing paid yet. Your first invoice will show here.')).toBeVisible();
  await expect(page.getByText('No hourly rate on file. Work order jobs pay the agreed amount.')).toBeVisible();

  // Seed 12 synthetic ZZTEST invoices for the signed-in trade plus 1 for another trade.
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    for (let i = 1; i <= 12; i++) {
      const day = String(i).padStart(2, '0');
      const wk = `2026-07-${day}`;
      db.invoices.push({
        id: `zz-inv-${day}`,
        user_id: db.me.id,
        week_start: wk,
        week_end: wk,
        invoice_number: `ZZTEST-CAP-${day}`,
        status: 'paid',
        gst_on: false,
        gross_earned: 112,
        amount_paid: 100,
        pay_run_id: i % 2 === 0 ? 'ZZTEST-run-paid' : null,
        pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, gst: 0, repayment: null, into_bank: 100, tax_set_aside: null },
        super_amount: 12,
        net_pay: 100
      });
    }
    db.paidSuperRuns.add('ZZTEST-run-paid');
    db.invoices.push({
      id: 'zz-other',
      user_id: 'u-other-trade',
      week_start: '2026-10-05',
      week_end: '2026-10-11',
      invoice_number: 'ZZTEST-OTHER-99',
      status: 'paid',
      gst_on: false,
      gross_earned: 1120,
      amount_paid: 1000,
      pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 1120, paid_to_super: 120, paid_to_you: 1000, reimbursements: 0, gst: 0, repayment: null, into_bank: 1000, tax_set_aside: null },
      super_amount: 120,
      net_pay: 1000
    });
    db.payRates.push(
      { user_id: db.me.id, effective_from: '2025-07-01', hourly_rate: 11.2 },
      { user_id: db.me.id, effective_from: '2026-07-01', hourly_rate: 22.4 },
      { user_id: 'u-other-trade', effective_from: '2026-08-01', hourly_rate: 99.9 }
    );
    store.invalidate('payhistory');
  });

  const superItems = page.locator('.pay-hsuper');
  await expect(superItems).toHaveCount(10);
  await expect(superItems.first()).toContainText('ZZTEST-CAP-12');
  await expect(superItems.nth(9)).toContainText('ZZTEST-CAP-03');
  await expect(page.locator('main.page')).not.toContainText('ZZTEST-CAP-02');
  await expect(page.locator('main.page')).not.toContainText('ZZTEST-OTHER-99');
  await expect(page.locator('main.page')).not.toContainText('$99.90');
  expect(errors).toEqual([]);
});

test('ZZTEST bad paths: loading skeleton, failed or incomplete read never renders zero, and Retry recovers', async ({ page }) => {
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));

  // 1. Loading state renders skeleton and no zero figures.
  await page.evaluate(async () => {
    const { setDemoHandler } = await import('/crew/js/lib/api.js');
    const store = await import('/crew/js/lib/store.js');
    await import('/crew/js/screens/payhistory.js');
    store.clearQueries();
    setDemoHandler(async (kind, action, params) => {
      if (action === 'my_pay_history') {
        return new Promise((resolve, reject) => { window.__pendingPayHistory = { resolve, reject, params }; });
      }
      return {};
    });
    location.hash = '#/pay/history';
  });
  await page.waitForFunction(() => Boolean(window.__pendingPayHistory));
  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();
  await expect(page.locator('.skel').first()).toBeVisible();
  await expect(page.locator('main.page')).not.toContainText('$0.00');

  // 2. Server refusal (503 pay_history_unreadable) shows exact error words + Retry, even if cache had old data.
  await page.evaluate(async () => {
    const { ApiError, setDemoHandler } = await import('/crew/js/lib/api.js');
    const store = await import('/crew/js/lib/store.js');
    let call = 0;
    setDemoHandler(async (_kind, action) => {
      if (action !== 'my_pay_history') return {};
      call += 1;
      if (call === 1) {
        // Missing figure (paid_to_you: null) must refuse rather than show $0.00.
        return {
          weeks: [{ week_start: '2026-11-02', total_inc_super: 1120, paid_to_super: 120, paid_to_you: null, reimbursements: 0, paid_into_bank: 1000, invoices: 1 }],
          months: [],
          years: [],
          this_year_vs_last: { this_fy: { paid_to_you: 1000, paid_to_super: 120 }, last_fy_same_point: { paid_to_you: 0, paid_to_super: 0 } },
          super: { this_fy: 120, since_start: 120, not_recorded_count: 0, by_invoice: [] },
          tax_set_aside: null,
          rate_history: []
        };
      }
      // 3. Retry after office record update returns updated server totals cleanly.
      return {
        weeks: [{ week_start: '2026-11-02', total_inc_super: 1120, paid_to_super: 120, paid_to_you: 1000, reimbursements: 0, paid_into_bank: 1000, invoices: 1 }],
        months: [{ month: '2026-11', label: 'Nov 2026', total_inc_super: 1120, paid_to_super: 120, paid_to_you: 1000, reimbursements: 0, paid_into_bank: 1000, invoices: 1 }],
        years: [{ fy_label: 'FY 2026/27', total_inc_super: 1120, paid_to_super: 120, paid_to_you: 1000, reimbursements: 0, paid_into_bank: 1000, invoices: 1 }],
        this_year_vs_last: { this_fy: { paid_to_you: 1000, paid_to_super: 120 }, last_fy_same_point: { paid_to_you: 500, paid_to_super: 60 } },
        super: { this_fy: 120, since_start: 180, not_recorded_count: 0, by_invoice: [{ invoice_id: 'zz-1', invoice_number: 'ZZTEST-RETRY-1', week_start: '2026-11-02', amount: 120, status: 'paid_to_fund' }] },
        tax_set_aside: null,
        rate_history: [{ effective_from: '2026-07-01', hourly_rate: 11.2 }]
      };
    });
    store.primeQuery('payhistory', {
      weeks: [{ week_start: '2026-11-02', total_inc_super: 560, paid_to_super: 60, paid_to_you: 500, reimbursements: 0, paid_into_bank: 500, invoices: 1 }],
      months: [], years: [],
      this_year_vs_last: { this_fy: { paid_to_you: 500, paid_to_super: 60 }, last_fy_same_point: { paid_to_you: 0, paid_to_super: 0 } },
      super: { this_fy: 60, since_start: 60, not_recorded_count: 0, by_invoice: [] }, tax_set_aside: null, rate_history: []
    }, { persist: true });
    window.__pendingPayHistory.reject(new ApiError('Could not read your pay history. Try again.', { status: 503, code: 'pay_history_unreadable' }));
  });

  await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toBeVisible();
  await expect(page.locator('main.page')).not.toContainText('$');

  // First Retry receives incomplete data (paid_to_you: null) -> stays in error state, no $0.00.
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toBeVisible();
  await expect(page.locator('main.page')).not.toContainText('$0.00');

  // Second Retry receives the clean updated server response -> renders it.
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.pay-hrow').first()).toContainText('$1,120.00');
  await expect(page.locator('.pay-hsuper').first()).toContainText('ZZTEST-RETRY-1');
  await expect(page.locator('.pay-hsuper').first()).toContainText('Paid to your fund');
  await expect(page.getByText(/Super not recorded on/)).toHaveCount(0);
});

test('ZZTEST mixed legacy and current super renders not recorded (never $0), count 0 hides the line, and unknown values show the error state', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs', 'new'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await scrubNamesForProof(page);

  // Seed a mixed legacy + current history (1 current unpaid, 1 current paid, 1 in-window legacy, 1 older prior legacy).
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    db.paidSuperRuns.add('ZZTEST-run-paid');
    db.invoices.push(
      {
        id: 'zz-mix-cur-2',
        user_id: db.me.id,
        week_start: '2026-11-09',
        week_end: '2026-11-12',
        invoice_number: 'ZZTEST-MIX-03',
        status: 'pushed_to_xero',
        gst_on: false,
        gross_earned: 112,
        amount_paid: 0,
        pay_run_id: null,
        pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, gst: 0, repayment: null, into_bank: 100, tax_set_aside: null },
        super_amount: 12,
        net_pay: 100
      },
      {
        id: 'zz-mix-cur-1',
        user_id: db.me.id,
        week_start: '2026-08-31',
        week_end: '2026-09-06',
        invoice_number: 'ZZTEST-MIX-02',
        status: 'paid',
        gst_on: false,
        gross_earned: 112,
        amount_paid: 100,
        pay_run_id: 'ZZTEST-run-paid',
        pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, gst: 0, repayment: null, into_bank: 100, tax_set_aside: null },
        super_amount: 12,
        net_pay: 100
      },
      {
        id: 'zz-mix-leg-in',
        user_id: db.me.id,
        week_start: '2026-08-31',
        week_end: '2026-09-06',
        invoice_number: 'ZZTEST-MIX-01',
        status: 'paid',
        gst_on: true,
        super_amount: null,
        super_basis: null,
        net_pay: null,
        total_inc: 22.11,
        gst: 2.01,
        amount_paid: 22.11
      },
      {
        id: 'zz-mix-leg-prior',
        user_id: db.me.id,
        week_start: '2024-01-01',
        week_end: '2024-01-07',
        invoice_number: 'ZZTEST-MIX-00',
        status: 'paid',
        gst_on: true,
        super_amount: null,
        super_basis: null,
        net_pay: null,
        total_inc: 44.22,
        gst: 4.02,
        amount_paid: 44.22
      }
    );
    store.clearQueries();
    location.hash = '#/pay/history';
  });

  const payload = await page.evaluate(() => window.__crewDemo.ops.my_pay_history({ years: 2 }));
  expect(payload.super.not_recorded_count).toBe(2);
  expect(payload.super.by_invoice.find((i) => i.invoice_id === 'zz-mix-leg-in')).toEqual({
    invoice_id: 'zz-mix-leg-in',
    invoice_number: 'ZZTEST-MIX-01',
    week_start: '2026-08-31',
    amount: 0,
    status: 'not_recorded'
  });

  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();
  await expect(page.locator('.skel')).toHaveCount(0);
  await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toHaveCount(0);

  // Mixed week (2026-08-31: 1 current + 1 legacy) renders server totals cleanly.
  const mixedWeekRow = page.locator('.pay-hrow').nth(1);
  await expect(mixedWeekRow).toContainText('$134.11');
  await expect(mixedWeekRow).toContainText('$122.11');
  await expect(mixedWeekRow).toContainText('$12.00');

  const superItems = page.locator('.pay-hsuper');
  await expect(superItems).toHaveCount(3);
  await expect(superItems.nth(0)).toContainText('ZZTEST-MIX-03');
  await expect(superItems.nth(0)).toContainText('To be paid to your fund');
  await expect(superItems.nth(0).locator('.side')).toHaveText('$12.00');

  // Legacy invoice renders super as 'not recorded' (never $0 / $0.00) and shows no fund status words.
  const legacyItem = superItems.nth(1);
  await expect(legacyItem).toContainText('ZZTEST-MIX-01');
  await expect(legacyItem.locator('.side')).toHaveText('not recorded');
  expect(await legacyItem.innerText()).not.toContain('$0');
  await expect(legacyItem.locator('.pay-fundstate')).toHaveCount(0);

  await expect(superItems.nth(2)).toContainText('ZZTEST-MIX-02');
  await expect(superItems.nth(2)).toContainText('Paid to your fund');
  await expect(superItems.nth(2).locator('.side')).toHaveText('$12.00');

  await expect(page.getByText('Super not recorded on 2 invoices', { exact: true })).toBeVisible();

  if (process.env.CREW_PAY_HISTORY_PROOF) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { const m = document.querySelector('main.page'); if (m) m.scrollTop = m.scrollHeight; });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-mixed-legacy-super-phone-390.png`, animations: 'disabled' });
    await page.setViewportSize(PHONE.viewport);
  }

  // No sideways scroll at 360 wide with mixed legacy and current rows.
  await page.setViewportSize({ width: 360, height: 640 });
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main.page');
    return {
      doc: document.documentElement.scrollWidth - window.innerWidth,
      page: main ? main.scrollWidth - main.clientWidth : 0
    };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.page).toBeLessThanOrEqual(0);
  await page.setViewportSize(PHONE.viewport);

  // Singular count renders '1 invoice', and count 0 hides the line cleanly.
  await page.evaluate(async () => {
    const store = await import('/crew/js/lib/store.js');
    const cur = store.peekQuery('payhistory');
    store.primeQuery('payhistory', { ...cur, super: { ...cur.super, not_recorded_count: 1 } });
  });
  await expect(page.getByText('Super not recorded on 1 invoice', { exact: true })).toBeVisible();

  await page.evaluate(async () => {
    const store = await import('/crew/js/lib/store.js');
    const cur = store.peekQuery('payhistory');
    store.primeQuery('payhistory', {
      ...cur,
      super: {
        ...cur.super,
        not_recorded_count: 0,
        by_invoice: cur.super.by_invoice.filter((r) => r.status !== 'not_recorded')
      }
    });
  });
  await expect(page.locator('.pay-hsuper')).toHaveCount(2);
  await expect(page.getByText(/Super not recorded on/)).toHaveCount(0);
  await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toHaveCount(0);

  // Other unknown values still go to the error state and never render figures.
  const badCases = [
    // Unknown by_invoice[].status
    (base) => ({ ...base, super: { ...base.super, by_invoice: [{ ...base.super.by_invoice[0], status: 'pending_fund' }] } }),
    // Non-zero amount on a not_recorded invoice
    (base) => ({ ...base, super: { ...base.super, not_recorded_count: 1, by_invoice: [{ ...base.super.by_invoice[0], status: 'not_recorded', amount: 12 }] } }),
    // Missing not_recorded_count (even if an unapproved alias is present)
    (base) => {
      const { not_recorded_count, ...withoutCount } = base.super;
      return { ...base, super: { ...withoutCount, not_recorded_invoices: 1 } };
    },
    // Negative or non-integer not_recorded_count
    (base) => ({ ...base, super: { ...base.super, not_recorded_count: -1 } }),
    (base) => ({ ...base, super: { ...base.super, not_recorded_count: '2' } }),
    // Contradictory count 0 while by_invoice carries a not_recorded row
    (base) => ({ ...base, super: { ...base.super, not_recorded_count: 0, by_invoice: [{ ...base.super.by_invoice[0], status: 'not_recorded', amount: 0 }] } })
  ];

  const cleanBase = await page.evaluate(async () => {
    const store = await import('/crew/js/lib/store.js');
    return store.peekQuery('payhistory');
  });

  for (let idx = 0; idx < badCases.length; idx++) {
    const mutated = badCases[idx](structuredClone(cleanBase));
    await page.evaluate(async (bad) => {
      const store = await import('/crew/js/lib/store.js');
      store.primeQuery('payhistory', bad);
    }, mutated);
    await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toBeVisible();
    await expect(page.locator('main.page')).not.toContainText('$');
  }

  expect(errors).toEqual([]);
});
