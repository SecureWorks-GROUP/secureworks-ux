// 2026-09-23 — Invoice history / Recent activity / Profile list checked against
// live trade_invoices + Xero mirror fields. Each row below is an anonymised
// copy of a real production shape (my_trade_invoices response) that the app
// used to show wrongly:
//   - 186 of 231 invoices predate the super split: every one read "Figures
//     unavailable" instead of its amount.
//   - GST-registered split invoices read "Figures unavailable" (the API sends
//     `gst`, the helper only read `gst_amount`).
//   - Bills deleted/voided in Xero read "pushed to xero" / "approved".
//   - Part-paid bills (Xero keeps them AUTHORISED) read "approved, awaiting payment".
//   - Paid invoices showed the invoiced figure, not what Xero paid.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';

const legacy = { gst_on: null, super_rate: null, super_amount: null, gross_earned: null, net_pay: null, trade_payable: null };

const INVOICES = [
  // Split, GST registered, approved in Xero, unpaid: cash 940 + GST 100.
  { id: 'a-gst-split', invoice_number: 'SW-INV-T-260921-031', week_end: '2026-09-20', week_ending: '2026-09-20', status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED', amount_paid: 0, paid_at: null, paid: false,
    gst_on: true, super_rate: 0.12, super_amount: 120, gross_earned: 1000, net_pay: 940, gst: 100, subtotal_ex: 1000, total_inc: 1100, trade_payable: 1040, total: 1100, subtotal: 1000 },
  // Pre-split invoice waiting on the office.
  { id: 'b-legacy-pending', invoice_number: 'SW-INV-T-260918-030', week_end: '2026-09-13', week_ending: '2026-09-13', status: 'pending_acknowledgment', xero_bill_status: null, amount_paid: 0, paid: false,
    ...legacy, gst: 0, subtotal_ex: 800, total_inc: 800, total: 800, subtotal: 800 },
  // Pre-split bill Xero shows part paid (still AUTHORISED).
  { id: 'c-part-paid', invoice_number: 'SW-INV-T-260822-018', week_end: '2026-07-12', week_ending: '2026-07-12', status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED', amount_paid: 1718.58, paid: false,
    ...legacy, gst: 0, subtotal_ex: 1916.4, total_inc: 1916.4, total: 1916.4, subtotal: 1916.4 },
  // Pre-split bill deleted in Xero.
  { id: 'd-deleted', invoice_number: 'SW-INV-T-260701-012', week_end: '2026-06-28', week_ending: '2026-06-28', status: 'pushed_to_xero', xero_bill_status: 'DELETED', amount_paid: 0, paid: false,
    ...legacy, gst: 50, subtotal_ex: 500, total_inc: 550, total: 550, subtotal: 500 },
  // Split row the office approved, then its Xero bill was deleted.
  { id: 'e-approved-deleted', invoice_number: 'SW-INV-T-260615-009', week_end: '2026-06-14', week_ending: '2026-06-14', status: 'approved', xero_bill_status: 'DELETED', amount_paid: 0, paid: false,
    gst_on: false, super_rate: 0.12, super_amount: 60, gross_earned: 500, net_pay: 470, gst: 0, subtotal_ex: 500, total_inc: 500, trade_payable: 470, total: 500, subtotal: 500 },
  // Pre-split GST invoice Xero paid ex-GST.
  { id: 'f-legacy-paid', invoice_number: 'SW-INV-T-260411-003', week_end: '2026-04-12', week_ending: '2026-04-12', status: 'paid', xero_bill_status: 'PAID', amount_paid: 1556, paid_at: '2026-04-17', paid: true,
    ...legacy, gst: 155.6, subtotal_ex: 1556, total_inc: 1711.6, total: 1711.6, subtotal: 1556 },
];

test.use({ persona: 'installer' });

test('every invoice shows its real amount and Xero state in Invoice history, Recent activity and Profile', async ({ appPage: page }) => {
  await page.route(`${OPS_API}**`, async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'my_trade_invoices') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoices: INVOICES }) });
    }
    await route.fallback();
  });
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();

  // Recent activity: the newest three, same wording as history.
  const recent = page.locator('#hoursRecentActivity');
  await expect(recent.locator('[data-inv-history="a-gst-split"]')).toContainText('$1,040.00');
  await expect(recent.locator('[data-inv-history="a-gst-split"]')).toContainText('Approved, awaiting payment');
  await expect(recent.locator('[data-inv-history="b-legacy-pending"]')).toContainText('$800.00');
  await expect(recent.locator('[data-inv-history="b-legacy-pending"]')).toContainText('Waiting on office');
  await expect(recent.locator('[data-inv-history="c-part-paid"]')).toContainText('Part paid');
  await expect(recent).not.toContainText('Figures unavailable');

  await page.getByRole('button', { name: 'View All' }).click();
  const history = page.locator('#hoursContent');
  await expect(history.locator('.inv-history-item')).toHaveCount(INVOICES.length);
  await expect(history).not.toContainText('Figures unavailable');
  await expect(history).not.toContainText(/pushed to xero|pending acknowledgment/i);

  const row = (id) => history.locator(`[data-inv-history="${id}"]`);
  await expect(row('a-gst-split')).toContainText('$1,040.00');
  await expect(row('b-legacy-pending')).toContainText('$800.00');
  await expect(row('c-part-paid')).toContainText('$197.82 owed');
  await expect(row('c-part-paid')).toContainText('Paid $1,718.58 of $1,916.40');
  await expect(row('c-part-paid')).toContainText('Part paid');
  await expect(row('c-part-paid')).not.toContainText('awaiting payment');
  await expect(row('d-deleted')).toContainText('Voided');
  await expect(row('e-approved-deleted')).toContainText('Voided');
  await expect(row('f-legacy-paid')).toContainText('$1,556.00');
  await expect(row('f-legacy-paid')).toContainText('Invoiced $1,711.60');
  await expect(row('f-legacy-paid')).toContainText('Paid 17 Apr 2026');

  await page.locator('[data-view="profile"]').click();
  const profile = page.locator('#profileInvoiceList');
  await expect(profile.locator('[data-profile-invoice]')).toHaveCount(INVOICES.length);
  await expect(profile).not.toContainText('Figures unavailable');
  await expect(profile.locator('[data-profile-invoice="f-legacy-paid"]')).toContainText('$1,556.00');
  await expect(profile.locator('[data-profile-invoice="f-legacy-paid"]')).toContainText('Paid 17 Apr 2026');
  await expect(profile.locator('[data-profile-invoice="d-deleted"]')).toContainText('Voided');
});

test('a full page of 100 invoices says it is the latest 100, not everything', async ({ appPage: page }) => {
  const many = Array.from({ length: 100 }, (_, i) => ({
    id: 'inv-' + i, invoice_number: 'SW-INV-T-' + i, week_end: '2026-09-20', week_ending: '2026-09-20',
    status: 'paid', xero_bill_status: 'PAID', paid: true, paid_at: '2026-09-25', amount_paid: 100, ...legacy, total_inc: 100
  }));
  await page.route(`${OPS_API}**`, async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'my_trade_invoices') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoices: many }) });
    }
    await route.fallback();
  });
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'View All' }).click();
  await expect(page.locator('[data-inv-history-capped]')).toContainText('Showing your latest 100 invoices');
});
