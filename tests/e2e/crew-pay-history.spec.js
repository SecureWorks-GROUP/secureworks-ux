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
  expect(expected.super.not_in_xero_count).toBe(0);

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
  // The office marked the run's super paid: the screen says so with the day, as the server words it, and never that it reached the fund.
  const marked = expected.super.by_invoice.filter((i) => i.status === 'marked_paid_by_office');
  expect(marked.length).toBeGreaterThan(0);
  for (const inv of marked) expect(inv.words).toMatch(/^Marked paid by the office on \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  await expect(superSec).toContainText(marked[0].words);
  await expect(superSec).not.toContainText('Paid to your fund');
  await expect(page.getByText(/Super not recorded on/)).toHaveCount(0);
  await expect(page.getByText(/not yet processed/)).toHaveCount(0);

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
        xero_bill_id: `xb-cap-${day}`,
        pay_run_id: i % 2 === 0 ? 'ZZTEST-run-paid' : null,
        pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, gst: 0, repayment: null, into_bank: 100, tax_set_aside: null },
        super_amount: 12,
        net_pay: 100
      });
    }
    db.paidSuperRuns.set('ZZTEST-run-paid', '2026-07-20T01:00:00Z');
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
      xero_bill_id: 'xb-other-99',
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
  await expect(superItems.filter({ hasText: 'ZZTEST-CAP-12' }).locator('.pay-fundstate')).toHaveText('Marked paid by the office on 20 Jul 2026');
  await expect(superItems.filter({ hasText: 'ZZTEST-CAP-11' }).locator('.pay-fundstate')).toHaveText('To be paid to your fund');
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
          super: { this_fy: 120, since_start: 120, not_recorded_count: 0, not_in_xero_count: 0, by_invoice: [] },
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
        // An older ops-api still sends 'paid_to_fund' for the office's mark, with no day.
        super: { this_fy: 120, since_start: 180, not_recorded_count: 0, not_in_xero_count: 0, by_invoice: [{ invoice_id: 'zz-1', invoice_number: 'ZZTEST-RETRY-1', week_start: '2026-11-02', amount: 120, status: 'paid_to_fund' }] },
        tax_set_aside: null,
        rate_history: [{ effective_from: '2026-07-01', hourly_rate: 11.2 }]
      };
    });
    store.primeQuery('payhistory', {
      weeks: [{ week_start: '2026-11-02', total_inc_super: 560, paid_to_super: 60, paid_to_you: 500, reimbursements: 0, paid_into_bank: 500, invoices: 1 }],
      months: [], years: [],
      this_year_vs_last: { this_fy: { paid_to_you: 500, paid_to_super: 60 }, last_fy_same_point: { paid_to_you: 0, paid_to_super: 0 } },
      super: { this_fy: 60, since_start: 60, not_recorded_count: 0, not_in_xero_count: 0, by_invoice: [] }, tax_set_aside: null, rate_history: []
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
  await expect(page.locator('.pay-hsuper').first().locator('.pay-fundstate')).toHaveText('Marked paid by the office');
  await expect(page.locator('main.page')).not.toContainText('Paid to your fund');
  await expect(page.getByText(/Super not recorded on/)).toHaveCount(0);
});

test('ZZTEST mixed legacy, current and not_in_xero: older-only Weeks/Months/Years say not recorded, not_in_xero is out of paid totals with not yet processed, and unknown values show the error state', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs', 'new'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await scrubNamesForProof(page);

  // Seed mixed history across Weeks, Months and Years:
  // - 2026-11-09 (Nov 2026, FY 2026/27): 1 current unpaid in Xero ($100 + $12) + 1 unbilled (not_in_xero, left out of totals)
  // - 2026-10-05 (Oct 2026, FY 2026/27): 1 older legacy-only in Xero ($33.44) + 1 unbilled legacy (not_in_xero wins, left out)
  // - 2026-08-31..2026-09-06 (Sep 2026 boundary week, FY 2026/27): 1 current paid ($100 + $12) + 1 older legacy ($22.11)
  // - 2026-07-20..2026-07-26 (Jul 2026, FY 2026/27): 1 current zero-super reimbursement-only ($50 + $0.00 recorded super)
  // - 2025-09-01..2025-09-07 (Sep 2025, FY 2025/26): ONLY 1 older legacy invoice ($66.33) -> week, month and FY all say 'not recorded'
  // - 2024-01-01..2024-01-07 (prior to 2-FY window): 1 older legacy in Xero + 1 older unbilled (not_in_xero)
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    db.paidSuperRuns.set('ZZTEST-run-paid', '2026-11-11T17:30:00Z');
    db.invoices.push(
      {
        id: 'zz-mix-cur-2',
        user_id: db.me.id,
        week_start: '2026-11-09',
        week_end: '2026-11-12',
        invoice_number: 'ZZTEST-MIX-07',
        status: 'pushed_to_xero',
        xero_bill_id: 'xb-mix-07',
        gst_on: false,
        gross_earned: 112,
        amount_paid: 0,
        pay_run_id: null,
        pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, gst: 0, repayment: null, into_bank: 100, tax_set_aside: null },
        super_amount: 12,
        net_pay: 100
      },
      {
        id: 'zz-mix-unbilled-cur',
        user_id: db.me.id,
        week_start: '2026-11-09',
        week_end: '2026-11-12',
        invoice_number: 'ZZTEST-MIX-06',
        status: 'pending_acknowledgment',
        xero_bill_id: null,
        gst_on: false,
        gross_earned: 224,
        amount_paid: 0,
        pay_run_id: 'ZZTEST-run-paid',
        pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 224, paid_to_super: 24, paid_to_you: 200, reimbursements: 0, gst: 0, repayment: null, into_bank: 200, tax_set_aside: null },
        super_amount: 24,
        net_pay: 200
      },
      {
        id: 'zz-mix-leg-oct',
        user_id: db.me.id,
        week_start: '2026-10-05',
        week_end: '2026-10-11',
        invoice_number: 'ZZTEST-MIX-05',
        status: 'paid',
        xero_bill_id: 'xb-mix-05',
        gst_on: true,
        super_amount: null,
        super_basis: null,
        net_pay: null,
        total_inc: 33.44,
        gst: 3.04,
        amount_paid: 33.44
      },
      {
        id: 'zz-mix-unbilled-leg',
        user_id: db.me.id,
        week_start: '2026-10-05',
        week_end: '2026-10-11',
        invoice_number: 'ZZTEST-MIX-04',
        status: 'approved',
        xero_bill_id: '',
        gst_on: true,
        super_amount: null,
        super_basis: null,
        net_pay: null,
        total_inc: 55.66,
        gst: 5.06,
        amount_paid: 0
      },
      {
        id: 'zz-mix-cur-1',
        user_id: db.me.id,
        week_start: '2026-08-31',
        week_end: '2026-09-06',
        invoice_number: 'ZZTEST-MIX-03',
        status: 'paid',
        xero_bill_id: 'xb-mix-03',
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
        invoice_number: 'ZZTEST-MIX-02',
        status: 'paid',
        xero_bill_id: 'xb-mix-02',
        gst_on: true,
        super_amount: null,
        super_basis: null,
        net_pay: null,
        total_inc: 22.11,
        gst: 2.01,
        amount_paid: 22.11
      },
      {
        id: 'zz-mix-leg-fy25',
        user_id: db.me.id,
        week_start: '2025-09-01',
        week_end: '2025-09-07',
        invoice_number: 'ZZTEST-MIX-01',
        status: 'paid',
        xero_bill_id: 'xb-mix-01',
        gst_on: true,
        super_amount: null,
        super_basis: null,
        net_pay: null,
        total_inc: 66.33,
        gst: 6.03,
        amount_paid: 66.33
      },
      {
        id: 'zz-mix-leg-prior',
        user_id: db.me.id,
        week_start: '2024-01-01',
        week_end: '2024-01-07',
        invoice_number: 'ZZTEST-MIX-00',
        status: 'paid',
        xero_bill_id: 'xb-mix-00',
        gst_on: true,
        super_amount: null,
        super_basis: null,
        net_pay: null,
        total_inc: 44.22,
        gst: 4.02,
        amount_paid: 44.22
      },
      {
        id: 'zz-mix-unbilled-prior',
        user_id: db.me.id,
        week_start: '2024-01-08',
        week_end: '2024-01-14',
        invoice_number: 'ZZTEST-MIX-OLD-UNB',
        status: 'approved',
        xero_bill_id: null,
        gst_on: false,
        gross_earned: 112,
        super_amount: 12,
        net_pay: 100,
        amount_paid: 0
      }
    );
    store.clearQueries();
    location.hash = '#/pay/history';
  });

  const payload = await page.evaluate(() => window.__crewDemo.ops.my_pay_history({ years: 2 }));
  expect(payload.super.not_recorded_count).toBe(4);
  expect(payload.super.not_in_xero_count).toBe(3);
  expect(payload.super.since_start).toBe(24);
  expect(payload.super.this_fy).toBe(24);
  expect(payload.this_year_vs_last.this_fy.paid_to_you).toBe(255.55);
  expect(payload.super.by_invoice.filter((i) => i.status === 'not_in_xero')).toEqual([
    { invoice_id: 'zz-mix-unbilled-cur', invoice_number: 'ZZTEST-MIX-06', week_start: '2026-11-09', amount: 0, status: 'not_in_xero' },
    { invoice_id: 'zz-mix-unbilled-leg', invoice_number: 'ZZTEST-MIX-04', week_start: '2026-10-05', amount: 0, status: 'not_in_xero' }
  ]);

  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();
  await expect(page.locator('.skel')).toHaveCount(0);
  await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toHaveCount(0);

  // Unbilled invoices are out of the paid total, with '3 invoices not yet processed'.
  await expect(page.getByText('3 invoices not yet processed', { exact: true })).toBeVisible();
  await expect(page.getByText('Super not recorded on 4 invoices', { exact: true })).toBeVisible();

  const rows = page.locator('.pay-hrow');
  await expect(rows).toHaveCount(4);

  // Week 0 (2026-11-09): current billed ($112 / $100 / $12); unbilled $224/$200/$24 is left out.
  await expect(rows.nth(0)).toContainText('$112.00');
  await expect(rows.nth(0)).toContainText('$100.00');
  await expect(rows.nth(0)).toContainText('$12.00');

  // Week 1 (2026-10-05): older-only invoice ($33.44) -> super says 'not recorded', never $0.00.
  await expect(rows.nth(1)).toContainText('$33.44');
  await expect(rows.nth(1).locator('.pay-hkv').nth(2)).toContainText('not recorded');
  expect(await rows.nth(1).innerText()).not.toContain('$0');

  // Week 2 (2026-08-31..2026-09-06): mixed 1 current + 1 legacy -> $134.11 / $122.11 / $12.00.
  await expect(rows.nth(2)).toContainText('$134.11');
  await expect(rows.nth(2)).toContainText('$122.11');
  await expect(rows.nth(2)).toContainText('$12.00');

  // Week 3 (2025-09-01): older-only invoice ($66.33) -> super says 'not recorded', never $0.00.
  await expect(rows.nth(3)).toContainText('$66.33');
  await expect(rows.nth(3).locator('.pay-hkv').nth(2)).toContainText('not recorded');
  expect(await rows.nth(3).innerText()).not.toContain('$0');

  if (process.env.CREW_PAY_HISTORY_PROOF) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-mixed-weeks-phone-390.png`, animations: 'disabled' });
    await page.setViewportSize(PHONE.viewport);
  }

  // Months tab: Oct 2026 and Sep 2025 (older-only) say 'not recorded'; Nov 2026 and Sep 2026 show $12.00.
  await page.getByRole('tab', { name: 'Months', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Nov 2026');
  await expect(rows.nth(0)).toContainText('$12.00');
  await expect(rows.nth(1)).toContainText('Oct 2026');
  await expect(rows.nth(1).locator('.pay-hkv').nth(2)).toContainText('not recorded');
  expect(await rows.nth(1).innerText()).not.toContain('$0');
  await expect(rows.nth(2)).toContainText('Sep 2026');
  await expect(rows.nth(2)).toContainText('$12.00');
  await expect(rows.nth(3)).toContainText('Sep 2025');
  await expect(rows.nth(3).locator('.pay-hkv').nth(2)).toContainText('not recorded');
  expect(await rows.nth(3).innerText()).not.toContain('$0');

  if (process.env.CREW_PAY_HISTORY_PROOF) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-mixed-months-phone-390.png`, animations: 'disabled' });
    await page.setViewportSize(PHONE.viewport);
  }

  // Years tab: FY 2026/27 (mixed) shows $24.00; FY 2025/26 (older-only) and Same point last year say 'not recorded', never $0.00.
  await page.getByRole('tab', { name: 'Years', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('FY 2026/27');
  await expect(rows.nth(0)).toContainText('$24.00');
  await expect(rows.nth(1)).toContainText('FY 2025/26');
  await expect(rows.nth(1)).toContainText('$66.33');
  await expect(rows.nth(1).locator('.pay-hkv').nth(2)).toContainText('not recorded');
  expect(await rows.nth(1).innerText()).not.toContain('$0');
  await expect(page.locator('.pay-hcompare .pay-hcol').nth(1)).toContainText('not recorded');
  expect(await page.locator('.pay-hcompare .pay-hcol').nth(1).innerText()).not.toContain('$0');

  if (process.env.CREW_PAY_HISTORY_PROOF) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-mixed-years-phone-390.png`, animations: 'disabled' });
    await page.evaluate(() => { const m = document.querySelector('main.page'); if (m) m.scrollTop = m.scrollHeight; });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-mixed-legacy-super-phone-390.png`, animations: 'disabled' });
    await page.evaluate(() => { const m = document.querySelector('main.page'); if (m) m.scrollTop = 0; });
    await page.setViewportSize(PHONE.viewport);
  }

  // Super card rows: 'Not yet processed' (no $0, no fund state), 'not recorded' (no $0, no fund state), 'To be paid', 'Marked paid by the office on <day>'.
  const superItems = page.locator('.pay-hsuper');
  await expect(superItems).toHaveCount(7);

  const unbilledCur = superItems.filter({ hasText: 'ZZTEST-MIX-06' });
  await expect(unbilledCur.locator('.side')).toHaveText('Not yet processed');
  expect(await unbilledCur.innerText()).not.toContain('$0');
  await expect(unbilledCur.locator('.pay-fundstate')).toHaveCount(0);

  const unbilledLeg = superItems.filter({ hasText: 'ZZTEST-MIX-04' });
  await expect(unbilledLeg.locator('.side')).toHaveText('Not yet processed');
  expect(await unbilledLeg.innerText()).not.toContain('$0');
  await expect(unbilledLeg.locator('.pay-fundstate')).toHaveCount(0);

  const legacyItem = superItems.filter({ hasText: 'ZZTEST-MIX-02' });
  await expect(legacyItem.locator('.side')).toHaveText('not recorded');
  expect(await legacyItem.innerText()).not.toContain('$0');
  await expect(legacyItem.locator('.pay-fundstate')).toHaveCount(0);

  const toBePaidItem = superItems.filter({ hasText: 'ZZTEST-MIX-07' });
  await expect(toBePaidItem).toContainText('To be paid to your fund');
  await expect(toBePaidItem.locator('.side')).toHaveText('$12.00');

  const paidFundItem = superItems.filter({ hasText: 'ZZTEST-MIX-03' });
  // The office's stamp 17:30 UTC on 11 Nov is 12 Nov in Perth.
  await expect(paidFundItem.locator('.pay-fundstate')).toHaveText('Marked paid by the office on 12 Nov 2026');
  await expect(paidFundItem.locator('.side')).toHaveText('$12.00');

  // No sideways scroll at 360 wide across Weeks, Months and Years with mixed legacy and not_in_xero rows.
  await page.setViewportSize({ width: 360, height: 640 });
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
  await page.setViewportSize(PHONE.viewport);

  // Office pushes zz-mix-unbilled-cur to Xero: refetch includes it in paid and super totals and decrements not_in_xero_count.
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    db.invoices.find((i) => i.id === 'zz-mix-unbilled-cur').xero_bill_id = 'xb-pushed-06';
    store.invalidate('payhistory');
  });
  await expect(page.getByText('2 invoices not yet processed', { exact: true })).toBeVisible();
  await expect(superItems.filter({ hasText: 'ZZTEST-MIX-06' }).locator('.pay-fundstate')).toHaveText('Marked paid by the office on 12 Nov 2026');
  await expect(superItems.filter({ hasText: 'ZZTEST-MIX-06' }).locator('.side')).toHaveText('$24.00');

  // Boundary month (30 Jun to 6 Jul) holding only an older invoice also says 'not recorded' on Weeks, Months and Years.
  await page.evaluate(async () => {
    const store = await import('/crew/js/lib/store.js');
    store.primeQuery('payhistory', {
      weeks: [{ week_start: '2025-06-30', total_inc_super: 88.11, paid_to_super: 0, paid_to_you: 88.11, reimbursements: 0, paid_into_bank: 88.11, invoices: 1 }],
      months: [{ month: '2025-07', label: 'Jul 2025', total_inc_super: 88.11, paid_to_super: 0, paid_to_you: 88.11, reimbursements: 0, paid_into_bank: 88.11, invoices: 1 }],
      years: [{ fy_label: 'FY 2025/26', total_inc_super: 88.11, paid_to_super: 0, paid_to_you: 88.11, reimbursements: 0, paid_into_bank: 88.11, invoices: 1 }],
      this_year_vs_last: { this_fy: { paid_to_you: 0, paid_to_super: 0 }, last_fy_same_point: { paid_to_you: 88.11, paid_to_super: 0 } },
      super: {
        this_fy: 0,
        since_start: 0,
        not_recorded_count: 1,
        not_in_xero_count: 1,
        by_invoice: [
          { invoice_id: 'zz-bnd-1', invoice_number: 'ZZTEST-BND-1', week_start: '2025-06-30', amount: 0, status: 'not_recorded' },
          { invoice_id: 'zz-bnd-2', invoice_number: 'ZZTEST-BND-2', week_start: '2026-11-02', amount: 0, status: 'not_in_xero' }
        ]
      },
      tax_set_aside: null,
      rate_history: []
    });
  });
  // Singular counts render '1 invoice not yet processed' and 'Super not recorded on 1 invoice'.
  await expect(page.getByText('1 invoice not yet processed', { exact: true })).toBeVisible();
  await expect(page.getByText('Super not recorded on 1 invoice', { exact: true })).toBeVisible();
  for (const name of ['Weeks', 'Months', 'Years']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(rows.first().locator('.pay-hkv').nth(2)).toContainText('not recorded');
    expect(await rows.first().innerText()).not.toContain('$0');
  }

  // Count 0 hides both lines cleanly.
  await page.evaluate(async () => {
    const store = await import('/crew/js/lib/store.js');
    const cur = store.peekQuery('payhistory');
    store.primeQuery('payhistory', {
      ...cur,
      weeks: [{ week_start: '2026-11-02', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, paid_into_bank: 100, invoices: 1 }],
      months: [{ month: '2026-11', label: 'Nov 2026', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, paid_into_bank: 100, invoices: 1 }],
      years: [{ fy_label: 'FY 2026/27', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, paid_into_bank: 100, invoices: 1 }],
      super: {
        this_fy: 12,
        since_start: 12,
        not_recorded_count: 0,
        not_in_xero_count: 0,
        by_invoice: [{ invoice_id: 'zz-clean-1', invoice_number: 'ZZTEST-CLEAN-1', week_start: '2026-11-02', amount: 12, status: 'marked_paid_by_office', marked_paid_on: '2026-11-10', words: 'Marked paid by the office on 10 Nov 2026' }]
      }
    });
  });
  await expect(page.locator('.pay-hsuper')).toHaveCount(1);
  await expect(page.locator('.pay-hsuper .pay-fundstate')).toHaveText('Marked paid by the office on 10 Nov 2026');
  await expect(page.getByText(/Super not recorded on/)).toHaveCount(0);
  await expect(page.getByText(/not yet processed/)).toHaveCount(0);
  await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toHaveCount(0);

  // Unknown or malformed values still go to the error state and never render figures.
  const badCases = [
    // Unknown by_invoice[].status
    (base) => ({ ...base, super: { ...base.super, by_invoice: [{ ...base.super.by_invoice[0], status: 'pending_fund' }] } }),
    // Non-zero amount on a not_recorded invoice
    (base) => ({ ...base, super: { ...base.super, not_recorded_count: 1, by_invoice: [{ ...base.super.by_invoice[0], status: 'not_recorded', amount: 12 }] } }),
    // Non-zero amount on a not_in_xero invoice
    (base) => ({ ...base, super: { ...base.super, not_in_xero_count: 1, by_invoice: [{ ...base.super.by_invoice[0], status: 'not_in_xero', amount: 12 }] } }),
    // Missing not_recorded_count (even if an unapproved alias is present)
    (base) => {
      const { not_recorded_count, ...withoutCount } = base.super;
      return { ...base, super: { ...withoutCount, not_recorded_invoices: 1 } };
    },
    // Missing not_in_xero_count (even if an unapproved alias is present)
    (base) => {
      const { not_in_xero_count, ...withoutCount } = base.super;
      return { ...base, super: { ...withoutCount, not_in_xero_invoices: 1 } };
    },
    // Negative or non-integer counts
    (base) => ({ ...base, super: { ...base.super, not_recorded_count: -1 } }),
    (base) => ({ ...base, super: { ...base.super, not_recorded_count: '2' } }),
    (base) => ({ ...base, super: { ...base.super, not_in_xero_count: -1 } }),
    (base) => ({ ...base, super: { ...base.super, not_in_xero_count: '1' } }),
    // Contradictory count 0 while by_invoice carries a not_recorded or not_in_xero row
    (base) => ({ ...base, super: { ...base.super, not_recorded_count: 0, by_invoice: [{ ...base.super.by_invoice[0], status: 'not_recorded', amount: 0 }] } }),
    (base) => ({ ...base, super: { ...base.super, not_in_xero_count: 0, by_invoice: [{ ...base.super.by_invoice[0], status: 'not_in_xero', amount: 0 }] } }),
    // Marked paid by the office with its day missing, empty or not a date
    (base) => {
      const { marked_paid_on, ...withoutDay } = base.super.by_invoice[0];
      return { ...base, super: { ...base.super, by_invoice: [withoutDay] } };
    },
    (base) => ({ ...base, super: { ...base.super, by_invoice: [{ ...base.super.by_invoice[0], marked_paid_on: null }] } }),
    (base) => ({ ...base, super: { ...base.super, by_invoice: [{ ...base.super.by_invoice[0], marked_paid_on: '18 Nov 2026' }] } }),
    // Marked paid by the office with no amount
    (base) => ({ ...base, super: { ...base.super, by_invoice: [{ ...base.super.by_invoice[0], amount: null }] } })
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

test('ZZTEST fixture holding a single not_in_xero invoice renders cleanly with no error page', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs', 'new'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await scrubNamesForProof(page);

  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    db.invoices.push({
      id: 'zz-only-unbilled',
      user_id: db.me.id,
      week_start: '2026-11-02',
      week_end: '2026-11-08',
      invoice_number: 'ZZTEST-UNB-01',
      status: 'pending_acknowledgment',
      xero_bill_id: null,
      gst_on: false,
      gross_earned: 112,
      super_amount: 12,
      net_pay: 100,
      amount_paid: 0
    });
    store.clearQueries();
    location.hash = '#/pay/history';
  });

  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();
  await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toHaveCount(0);
  await expect(page.getByText('Nothing in this period.')).toBeVisible();
  await expect(page.getByText('1 invoice not yet processed', { exact: true })).toBeVisible();
  const superItems = page.locator('.pay-hsuper');
  await expect(superItems).toHaveCount(1);
  await expect(superItems.first()).toContainText('ZZTEST-UNB-01');
  await expect(superItems.first().locator('.side')).toHaveText('Not yet processed');
  await expect(superItems.first().locator('.pay-fundstate')).toHaveCount(0);
  expect(await superItems.first().innerText()).not.toContain('$0');
  if (process.env.CREW_PAY_HISTORY_PROOF) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-one-not-in-xero-phone-390.png`, animations: 'disabled', fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('ZZTEST payhistory does not persist to localStorage and sign-out clears all pay figures on a shared phone', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await scrubNamesForProof(page);

  await page.evaluate(() => { location.hash = '#/pay'; });
  await expect(page.getByRole('button', { name: /My pay over time/ })).toBeVisible();
  await expect(page.locator('.pay-inv').first()).toBeVisible();
  await page.getByRole('button', { name: /My pay over time/ }).click();
  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();
  await expect(page.locator('.pay-hrow').first()).toBeVisible();

  // While signed in: payhistory never writes to localStorage; other pay queries that did write will be wiped on sign-out.
  const beforeSignOut = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    return {
      payhistoryKeys: keys.filter((k) => k.includes('payhistory')),
      queryKeys: keys.filter((k) => k.startsWith('crew:q:'))
    };
  });
  expect(beforeSignOut.payhistoryKeys).toEqual([]);
  expect(beforeSignOut.queryKeys.length).toBeGreaterThan(0);

  // Start an in-flight persisted query right before signing out to verify late resolution cannot re-save figures.
  await page.evaluate(async () => {
    const store = await import('/crew/js/lib/store.js');
    const ops = window.__crewDemo.ops;
    const origMoney = ops.my_money;
    ops.my_money = (p) => new Promise((resolve) => {
      window.__resolveLateMoney = () => resolve(origMoney(p));
    });
    store.local.set('week:2026-11-09', { edits: { a1: { rate: 77 } } });
    store.local.set('profile', { id: 'zz-user', name: 'Crew' });
    store.invalidate('money');
    location.hash = '#/profile';
  });

  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  const afterSignOut = await page.evaluate(async () => {
    if (window.__resolveLateMoney) window.__resolveLateMoney();
    await new Promise((r) => setTimeout(r, 30));
    const store = await import('/crew/js/lib/store.js');
    const keys = Object.keys(localStorage);
    return {
      queryKeys: keys.filter((k) => k.startsWith('crew:q:')),
      weekKeys: keys.filter((k) => k.startsWith('crew:week:')),
      profileKey: localStorage.getItem('crew:profile'),
      clockKey: localStorage.getItem('crew:clock'),
      memPayHistory: store.peekQuery('payhistory'),
      memMoney: store.peekQuery('money'),
      memInvoices: store.peekQuery('invoices')
    };
  });

  expect(afterSignOut).toEqual({
    queryKeys: [],
    weekKeys: [],
    profileKey: null,
    clockKey: null,
    memPayHistory: undefined,
    memMoney: undefined,
    memInvoices: undefined
  });
  expect(errors).toEqual([]);
});

test('ZZTEST a lapsed session clears pay figures but keeps the unsent week and the clock, as on main', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await expect(page.locator('.pay-inv').first()).toBeVisible();

  const after = await page.evaluate(async () => {
    const store = await import('/crew/js/lib/store.js');
    const auth = await import('/crew/js/lib/auth.js');
    store.local.set('week:2026-11-09', { edits: { a1: { start_time: '07:00' } } });
    store.local.set('clock', { job_id: 'zz-job', started_at: '2026-11-13T07:00:00+08:00' });
    // The path ops-api's lost-sign-in hook takes (configureApi authLost).
    await auth.signOut({ keepDrafts: true });
    const keys = Object.keys(localStorage);
    return {
      queryKeys: keys.filter((k) => k.startsWith('crew:q:')),
      weekKeys: keys.filter((k) => k.startsWith('crew:week:')),
      profileKey: localStorage.getItem('crew:profile'),
      clockKept: localStorage.getItem('crew:clock') !== null,
      memMoney: store.peekQuery('money')
    };
  });
  expect(after).toEqual({ queryKeys: [], weekKeys: ['crew:week:2026-11-09'], profileKey: null, clockKept: true, memMoney: undefined });
  expect(errors).toEqual([]);
});

test('ZZTEST super the office marked paid says so with the Perth day, and an un-mark by the office goes back to to be paid', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs', 'new'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await scrubNamesForProof(page);
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    const inv = (n, wk, run) => ({
      id: `zz-mark-${n}`, user_id: db.me.id, week_start: wk, week_end: wk, invoice_number: `ZZTEST-MARK-${n}`, status: 'paid',
      gst_on: false, gross_earned: 112, amount_paid: 100, xero_bill_id: `xb-mark-${n}`, pay_run_id: run,
      pay_view: { basis: 'inclusive_12_112_v1', total_inc_super: 112, paid_to_super: 12, paid_to_you: 100, reimbursements: 0, gst: 0, repayment: null, into_bank: 100, tax_set_aside: null },
      super_amount: 12, net_pay: 100
    });
    db.invoices.push(inv(1, '2026-10-05', 'ZZTEST-run-mark-a'), inv(2, '2026-10-12', 'ZZTEST-run-mark-b'));
    // 15:59 UTC on 31 Oct is still 31 Oct in Perth; 16:00 UTC is 1 Nov.
    db.paidSuperRuns.set('ZZTEST-run-mark-a', '2026-10-31T15:59:00Z');
    db.paidSuperRuns.set('ZZTEST-run-mark-b', '2026-10-31T16:00:00Z');
    store.clearQueries();
    location.hash = '#/pay/history';
  });

  const superItems = page.locator('.pay-hsuper');
  await expect(superItems).toHaveCount(2);
  const a = superItems.filter({ hasText: 'ZZTEST-MARK-1' });
  const b = superItems.filter({ hasText: 'ZZTEST-MARK-2' });
  await expect(a.locator('.pay-fundstate')).toHaveText('Marked paid by the office on 31 Oct 2026');
  await expect(b.locator('.pay-fundstate')).toHaveText('Marked paid by the office on 1 Nov 2026');
  await expect(a.locator('.side')).toHaveText('$12.00');
  const served = await page.evaluate(() => window.__crewDemo.ops.my_pay_history({ years: 2 }).super.by_invoice);
  expect(served.map((i) => [i.invoice_number, i.status, i.marked_paid_on, i.words])).toEqual([
    ['ZZTEST-MARK-2', 'marked_paid_by_office', '2026-11-01', 'Marked paid by the office on 1 Nov 2026'],
    ['ZZTEST-MARK-1', 'marked_paid_by_office', '2026-10-31', 'Marked paid by the office on 31 Oct 2026']
  ]);
  await expect(page.locator('main.page')).not.toContainText('Paid to your fund');
  if (process.env.CREW_PAY_HISTORY_PROOF) {
    await superItems.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.CREW_PAY_HISTORY_PROOF}/my-pay-super-marked-paid-phone-390.png`, animations: 'disabled' });
  }

  // The longer words fit at 360 wide with no sideways scroll.
  await page.setViewportSize({ width: 360, height: 640 });
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main.page');
    return { doc: document.documentElement.scrollWidth - window.innerWidth, page: main ? main.scrollWidth - main.clientWidth : 0 };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.page).toBeLessThanOrEqual(0);
  await page.setViewportSize(PHONE.viewport);

  // The office takes the mark off one run: a fresh read says to be paid again, with no day.
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    db.paidSuperRuns.delete('ZZTEST-run-mark-b');
    store.invalidate('payhistory');
  });
  await expect(b.locator('.pay-fundstate')).toHaveText('To be paid to your fund');
  await expect(a.locator('.pay-fundstate')).toHaveText('Marked paid by the office on 31 Oct 2026');

  // An unreadable office stamp refuses the read rather than showing a made-up day.
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    db.paidSuperRuns.set('ZZTEST-run-mark-a', 'not a date');
    store.invalidate('payhistory');
  });
  await expect(page.getByText('Could not load your pay. Check your signal and try again.')).toBeVisible();
  await expect(page.locator('main.page')).not.toContainText('$');

  expect(errors.filter((e) => !/pay_history_unreadable|503/.test(String(e)))).toEqual([]);
});
