// 2026-09-08 — My money view + GST registered from the server profile.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';

const MONEY = {
  today: '2026-09-08', fy_start: '2026-07-01', fy_label: 'FY 2026/27',
  profile: { name: 'E2E Installer', abn: '36 332 272 781', gst_registered: true, invoice_type: 'hourly', xero_linked: true },
  month: { month: '2026-09', label: 'Sep 2026', invoices: 1, gross_earned: 1000, super_amount: 120, gst: 100, payable: 980, paid_total: 0, outstanding: 980, figures_incomplete: 0 },
  fytd: { invoices: 2, gross_earned: 3470, super_amount: 416.4, gst: 347, payable: 3400.6, paid_total: 2420.6, outstanding: 980, figures_incomplete: 0 },
  all_time: { invoices: 2, gross_earned: 3470, super_amount: 416.4, gst: 347, payable: 3400.6, paid_total: 2420.6, outstanding: 980, figures_incomplete: 0 },
  months: [
    { month: '2026-09', label: 'Sep 2026', invoices: 1, gross_earned: 1000, super_amount: 120, gst: 100, payable: 980, paid_total: 0, outstanding: 980, figures_incomplete: 0 },
    { month: '2026-08', label: 'Aug 2026', invoices: 1, gross_earned: 2470, super_amount: 296.4, gst: 247, payable: 2420.6, paid_total: 2420.6, outstanding: 0, figures_incomplete: 0 },
  ],
  invoices: [
    { id: 'i-owed', invoice_number: 'SW-INV-E-260904-026', week_end: '2026-09-06', status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED', paid: false, amount_paid: 0, payable: 980, outstanding: 980, figures_ok: true, counts: true },
    { id: 'i-paid', invoice_number: 'SW-INV-E-260801-020', week_end: '2026-08-02', status: 'paid', xero_bill_status: 'PAID', paid: true, paid_at: '2026-08-10', amount_paid: 2420.6, payable: 2420.6, outstanding: 0, figures_ok: true, counts: true },
  ],
};

test.describe('Trade app: My money + GST from profile', () => {
  test.use({ persona: 'installer' });

  test('My money shows earned, paid, owed, super, by month, and every invoice with its Xero state', async ({ appPage: page }) => {
    let calls = 0;
    await page.route(`${OPS_API}**`, async (route) => {
      const action = new URL(route.request().url()).searchParams.get('action');
      if (action === 'my_money') { calls += 1; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MONEY) }); }
      await route.fallback();
    });
    await signIn(page, PERSONAS.installer);
    await page.evaluate(() => { window.showView('hours'); window.openMyMoney(); });

    const view = page.locator('[data-mm-view]');
    await expect(view).toBeVisible();
    expect(calls).toBe(1);
    await expect(view.locator('[data-mm-gst]')).toHaveAttribute('data-mm-gst', 'on');
    await expect(view).toContainText('ABN 36 332 272 781');
    const fy = view.locator('[data-mm-period="fytd"]');
    await expect(fy).toContainText('FY 2026/27 to date');
    await expect(fy).toContainText('$3,470.00');
    await expect(fy).toContainText('$2,420.60');
    await expect(fy).toContainText('$980.00');
    await expect(fy).toContainText('Super $416.40');
    await expect(view.locator('[data-mm-months] tbody tr')).toHaveCount(2);
    await expect(view.locator('[data-mm-invoice="i-paid"]')).toContainText('Paid 10 Aug 2026');
    await expect(view.locator('[data-mm-invoice="i-owed"]')).toContainText('Approved, awaiting payment');
  });

  test('GST registered toggle saves explicitly and the server profile wins over browser storage', async ({ appPage: page }) => {
    let saved = null;
    await page.route(`${OPS_API}**`, async (route) => {
      const req = route.request();
      const action = new URL(req.url()).searchParams.get('action');
      if (action === 'update_trade_profile') {
        saved = req.postDataJSON();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, profile: { abn: saved.abn, trade_details: Object.assign({ gstRegistered: saved.gstRegistered }, saved), gst_registered: saved.gstRegistered } }) });
      }
      await route.fallback();
    });
    await signIn(page, PERSONAS.installer);
    // A stale browser copy claims GST on; the server profile says nothing, so the form starts at No.
    await page.evaluate(() => { try { localStorage.setItem('sw_trade_details', JSON.stringify({ gstRegistered: true, fullName: 'Old Phone' })); } catch (e) {} window.showView('profile'); });
    const gst = page.locator('#tdGst');
    await expect(gst).toHaveAttribute('data-value', 'no');
    await gst.locator('[data-td-gst="yes"]').click();
    await expect(gst).toHaveAttribute('data-value', 'yes');
    await page.locator('#tdAbn').fill('36 332 272 781');
    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect.poll(() => saved).not.toBeNull();
    expect(saved.gstRegistered).toBe(true);
    expect(saved.abn).toBe('36 332 272 781');
    await expect(page.locator('#tdSaveStatus')).toContainText('Saved to your account');
  });
});
