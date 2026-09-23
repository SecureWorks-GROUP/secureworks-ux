// 2026-09-23 — Trade app must read ops-api (backend #865) super-split field
// names on the live My money and invoice-detail screens, prefer those figures
// over the local 12/6/6 derivation, and never paint a persisted full-carve-out
// net_pay as the boy's cash.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const fs = require('fs');
const path = require('path');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const EVIDENCE = '/Users/marninstobbe/.no-mistakes/evidence/01M36B0F4G4KS47FJQK4BPZBPN';

function moneyPayload(month, invoices) {
  return {
    today: '2026-09-23',
    fy_start: '2026-07-01',
    fy_label: 'FY 2026/27',
    profile: { name: 'E2E Installer', abn: '36 332 272 781', gst_registered: false, invoice_type: 'hourly', xero_linked: true },
    month,
    fytd: month,
    all_time: month,
    months: [],
    invoices
  };
}

async function stubMoneyAndInvoice(page, { month, invoices, invoiceById }) {
  await page.route(`${OPS_API}**`, async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'my_money') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(moneyPayload(month, invoices))
      });
    }
    if (action === 'get_trade_invoice') {
      const invoiceId = new URL(route.request().url()).searchParams.get('invoice_id');
      const invoice = invoiceById[invoiceId];
      if (!invoice) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown invoice' }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ invoice })
      });
    }
    await route.fallback();
  });
}

async function openMyMoney(page) {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.locator('[data-open-my-money]').click();
  await expect(page.locator('[data-mm-view]')).toBeVisible();
}

async function shot(page, locator, filename) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const dest = path.join(EVIDENCE, filename);
  await locator.screenshot({ path: dest });
  return dest;
}

test.describe('Trade app: backend #865 super-split fields reach the screen', () => {
  test.use({ persona: 'installer' });

  test('My money and invoice detail show the ruled $1000 12/6/6 split from CIO field names', async ({ appPage: page }) => {
    const month = {
      month: '2026-09',
      label: 'Sep 2026',
      invoices: 1,
      gross_earned: 1000,
      super_rate: 0.12,
      super_amount: 120,
      gst: 0,
      gst_on: false,
      net_pay: 940,
      amount_payable: 940,
      worker_withhold: 60,
      company_contribution: 60,
      company_total_out: 1060,
      trade_payable: 940,
      total_inc: 1000,
      paid_total: 0,
      outstanding: 940,
      figures_incomplete: 0
    };
    await stubMoneyAndInvoice(page, {
      month,
      invoices: [{
        id: 'inv-ruled-1000',
        invoice_number: 'SW-INV-CIO-1000',
        week_end: '2026-09-20',
        status: 'pushed_to_xero',
        xero_bill_status: 'AUTHORISED',
        paid: false,
        payable: 940,
        outstanding: 940,
        figures_ok: true,
        counts: true
      }],
      invoiceById: {
        'inv-ruled-1000': {
          id: 'inv-ruled-1000',
          invoice_number: 'SW-INV-CIO-1000',
          status: 'submitted',
          gst_on: false,
          ...month,
          lines: []
        }
      }
    });

    await openMyMoney(page);
    const period = page.locator('[data-mm-period="month"]');
    await expect(period).toContainText('Super $120.00 to your fund');
    await expect(period).toContainText('$60.00 from you');
    await expect(period).toContainText('company covers $60.00');
    await expect(period).toContainText('You get $940.00');
    await expect(period).not.toContainText('$880.00');
    await shot(page, page.locator('[data-mm-view]'), 'my-money-cio-1000-split.png');

    await page.locator('[data-mm-invoice="inv-ruled-1000"]').click();
    const summary = page.locator('[data-invoice-money-summary]');
    await expect(page.getByText('Invoice Detail')).toBeVisible();
    await expect(summary).toContainText('Earned$1000.00');
    await expect(summary).toContainText('Super (12%) paid into your super fund$120.00');
    await expect(summary).toContainText('Your share of super (6%)−$60.00');
    await expect(summary).toContainText('Company covers the other 6%$60.00');
    await expect(summary).toContainText('You get paid$940.00');
    await expect(summary).not.toContainText('$880.00');
    await shot(page, page.locator('#hoursContent'), 'invoice-detail-cio-1000-split.png');
  });

  test('backend figures that differ from gross times rate / 2 win on My money and invoice detail', async ({ appPage: page }) => {
    const month = {
      month: '2026-09',
      label: 'Sep 2026',
      invoices: 1,
      gross_earned: 1000,
      super_rate: 0.12,
      super_amount: 120,
      gst: 0,
      net_pay: 950,
      amount_payable: 950,
      worker_withhold: 50,
      company_contribution: 70,
      paid_total: 0,
      outstanding: 950,
      figures_incomplete: 0
    };
    await stubMoneyAndInvoice(page, {
      month,
      invoices: [{
        id: 'inv-backend-other',
        invoice_number: 'SW-INV-CIO-OTHER',
        week_end: '2026-09-20',
        status: 'pushed_to_xero',
        payable: 950,
        outstanding: 950,
        figures_ok: true,
        counts: true
      }],
      invoiceById: {
        'inv-backend-other': {
          id: 'inv-backend-other',
          invoice_number: 'SW-INV-CIO-OTHER',
          status: 'submitted',
          gst_on: false,
          ...month,
          lines: []
        }
      }
    });

    await openMyMoney(page);
    const period = page.locator('[data-mm-period="month"]');
    await expect(period).toContainText('$50.00 from you');
    await expect(period).toContainText('company covers $70.00');
    await expect(period).toContainText('You get $950.00');
    await expect(period).not.toContainText('$60.00 from you');
    await expect(period).not.toContainText('You get $940.00');
    await shot(page, page.locator('[data-mm-view]'), 'my-money-backend-figures-win.png');

    await page.locator('[data-mm-invoice="inv-backend-other"]').click();
    const summary = page.locator('[data-invoice-money-summary]');
    await expect(summary).toContainText('Your share of super (6%)−$50.00');
    await expect(summary).toContainText('Company covers the other 6%$70.00');
    await expect(summary).toContainText('You get paid$950.00');
    await expect(summary).not.toContainText('−$60.00');
    await expect(summary).not.toContainText('You get paid$940.00');
    await shot(page, page.locator('#hoursContent'), 'invoice-detail-backend-figures-win.png');
  });

  test('old-contract net_pay equal to gross minus the full super amount is never shown as cash', async ({ appPage: page }) => {
    const month = {
      month: '2026-09',
      label: 'Sep 2026',
      invoices: 1,
      gross_earned: 1000,
      super_rate: 0.12,
      super_amount: 120,
      gst: 0,
      net_pay: 880,
      paid_total: 0,
      outstanding: 940,
      figures_incomplete: 0
    };
    await stubMoneyAndInvoice(page, {
      month,
      invoices: [{
        id: 'inv-legacy-carve',
        invoice_number: 'SW-INV-LEGACY-880',
        week_end: '2026-09-13',
        status: 'paid',
        paid: true,
        payable: 940,
        outstanding: 0,
        figures_ok: true,
        counts: true
      }],
      invoiceById: {
        'inv-legacy-carve': {
          id: 'inv-legacy-carve',
          invoice_number: 'SW-INV-LEGACY-880',
          status: 'paid',
          gst_on: false,
          gross_earned: 1000,
          super_rate: 0.12,
          super_amount: 120,
          net_pay: 880,
          worker_withhold: 120,
          company_contribution: 0,
          lines: []
        }
      }
    });

    await openMyMoney(page);
    const period = page.locator('[data-mm-period="month"]');
    await expect(period).toContainText('Super $120.00 to your fund');
    await expect(period).toContainText('$60.00 from you');
    await expect(period).toContainText('company covers $60.00');
    await expect(period).toContainText('You get $940.00');
    await expect(period).not.toContainText('You get $880.00');
    await shot(page, page.locator('[data-mm-view]'), 'my-money-legacy-net-refused.png');

    await page.locator('[data-mm-invoice="inv-legacy-carve"]').click();
    const summary = page.locator('[data-invoice-money-summary]');
    await expect(summary).toContainText('You get paid$940.00');
    await expect(summary).toContainText('Your share of super (6%)−$60.00');
    await expect(summary).toContainText('Company covers the other 6%$60.00');
    await expect(summary).not.toContainText('You get paid$880.00');
    await expect(summary).not.toContainText('−$120.00');
    await shot(page, page.locator('#hoursContent'), 'invoice-detail-legacy-net-refused.png');
  });
});
