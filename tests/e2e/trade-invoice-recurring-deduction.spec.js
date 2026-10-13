// A trade who hires a ute from us has a weekly amount taken off what he is paid
// (Captain, 2026-10-13). ops-api owns the rule and the money; the contract is
// secureworks-backend docs/trade-recurring-deductions-2026-10-13.md. The app
// shows the deduction as its own row and pays the server's `trade_payable`,
// never a figure it works out. A trade with no deduction, and a server that
// does not send the fields, see exactly what they saw before.
// Search `// <trade-recurring-deduction>` in trade.html.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { fillCardTime } = require('../helpers/invoice-time');

const MOBILE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const COMES_OFF_NOTE = (amount) => 'Ute hire −' + amount + ' comes off what you are paid for this week, after super and GST. It is applied when you submit. SecureWorks confirms the amount you are paid then.';
const COMES_OFF_CONFIRM = (amount) => 'Ute hire −' + amount + ' comes off what you are paid for this week. It is applied when you submit.';
const SUPER_NOTE = 'Your job amounts are not changed. Only half the super comes out of what you earned; the company covers the other half. The full 12% still goes into your super fund each week.';

async function installPdfRecorder(page) {
  await page.evaluate(() => {
    window.__invoicePdfText = [];
    class FakeJsPdf {
      setFillColor() {}
      rect() {}
      setTextColor() {}
      setFontSize() {}
      setFont() {}
      text(value) { window.__invoicePdfText.push(String(value)); }
      setDrawColor() {}
      setLineWidth() {}
      line() {}
      addPage() {}
      output() { return 'data:application/pdf;base64,JVBERi1QRVJTSVNURUQ='; }
      save() {}
    }
    window.jspdf = { jsPDF: FakeJsPdf };
  });
}

// Open this week's Weekly Invoice and enter an 8 hour day on the fixture job.
async function openBuilderWithDay(page) {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await fillCardTime(page.locator('.jc-card').filter({ hasText: 'SWF-26767' }), 8);
}

// Press Submit, read the confirm, tick the one-invoice-a-week statement, send.
async function submitAndReadConfirm(page) {
  await installPdfRecorder(page);
  await page.locator('#invSubmitBtn').click();
  const confirm = await page.locator('#confirmMsg').innerText();
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();
  await expect(page.getByText('Invoice Submitted')).toBeVisible();
  return confirm;
}

// The totals block of the PDF the app builds and attaches to the Xero bill.
async function pdfTotals(page) {
  const text = await page.evaluate(() => window.__invoicePdfText);
  return text.slice(text.indexOf('Earned'));
}

test.describe('a week that carries the deduction', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-recurring-deduction', appWeekDay: 6, ...MOBILE });

  test('the weekly invoice says what comes off before he submits, then shows the row and the server paid figure', async ({ appPage: page, feedRequests }, testInfo) => {
    await openBuilderWithDay(page);

    // Before submit: this week carries the deduction, and how much. The app
    // does not work out what he is paid; the server confirms it at submit.
    const preview = page.locator('[data-invoice-money-summary]');
    await expect(preview).toContainText('Earned$400.00');
    await expect(preview.locator('[data-invoice-after-super]')).toHaveText('After super$376.00');
    await expect(preview.locator('[data-invoice-deduction-week]')).toHaveText('Ute hire (comes off this week)−$100.00');
    await expect(preview.locator('[data-invoice-deduction-note]')).toHaveText(COMES_OFF_NOTE('$100.00'));
    await expect(preview).not.toContainText('You get paid');
    await expect(preview).not.toContainText('$276.00');
    const builderShot = testInfo.outputPath('trade-invoice-deduction-builder.png');
    await page.locator('#hoursContent').screenshot({ path: builderShot });
    await testInfo.attach('Weekly invoice before submit', { path: builderShot, contentType: 'image/png' });

    const confirm = await submitAndReadConfirm(page);
    expect(confirm).toContain(COMES_OFF_CONFIRM('$100.00'));

    // After submit: its own row with a minus amount, and the server's figure.
    const saved = page.locator('[data-invoice-money-summary]');
    await expect(saved.locator('.inv-money-row')).toHaveText([
      'Earned$400.00',
      'Super (12%) paid into your super fund$48.00',
      'Your share of super (6%)−$24.00',
      'Company covers the other 6%$24.00',
      'After super$376.00',
      'GSTOff',
      'Invoice total$376.00',
      'Payable before Ute hire$376.00',
      'Ute hire−$100.00',
      'You get paid$276.00'
    ]);
    await expect(saved.locator('[data-invoice-paid]')).toHaveClass(/net/);
    await expect(saved.locator('[data-invoice-deduction-note]')).toHaveText('Ute hire −$100.00 came off this invoice after super and GST.');
    const savedShot = testInfo.outputPath('trade-invoice-deduction-submitted.png');
    await page.locator('#hoursContent').screenshot({ path: savedShot });
    await testInfo.attach('Weekly invoice after submit', { path: savedShot, contentType: 'image/png' });

    // The PDF carries the same row and the same paid figure as the bill.
    expect(await pdfTotals(page)).toEqual([
      'Earned', '$400.00',
      'Super (12%) paid into your super fund', '$48.00',
      'Your share of super (6%)', '-$24.00',
      'Company covers the other 6%', '$24.00',
      'After super', '$376.00',
      'GST', 'Off',
      'Payable before Ute hire', '$376.00',
      'Ute hire', '-$100.00',
      'TOTAL', '$276.00'
    ]);

    const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
    expect(submit).toBeTruthy();
    ['trade_payable', 'recurring_deduction', 'payable_before_deduction', 'recurring_deduction_week'].forEach((field) => {
      expect(submit.body).not.toHaveProperty(field);
    });
    const attach = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'attach_invoice_pdf');
    expect(attach).toBeTruthy();
    expect(attach.body.xero_bill_id).toBe('xero-e2e-ute');
    await expect(page.getByText('the PDF attachment needs office follow-up')).toHaveCount(0);
  });

  test('with GST on, the deduction still comes off after GST and the paid figure is the server one', async ({ appPage: page }) => {
    await openBuilderWithDay(page);
    await page.getByRole('switch', { name: 'Add GST to this invoice' }).click();
    // Changing GST repaints the estimate; the deduction row stays on it.
    await expect(page.locator('[data-invoice-deduction-week]')).toHaveText('Ute hire (comes off this week)−$100.00');
    await submitAndReadConfirm(page);

    const saved = page.locator('[data-invoice-money-summary]');
    await expect(saved).toContainText('After super$376.00');
    await expect(saved).toContainText('GST$40.00');
    await expect(saved).toContainText('Invoice total$440.00');
    await expect(saved.locator('[data-invoice-before-deduction]')).toHaveText('Payable before Ute hire$416.00');
    await expect(saved.locator('[data-invoice-deduction]')).toHaveText('Ute hire−$100.00');
    await expect(saved.locator('[data-invoice-paid]')).toHaveText('You get paid$316.00');

    const totals = await pdfTotals(page);
    expect(totals.slice(-8)).toEqual(['GST', '$40.00', 'Payable before Ute hire', '$416.00', 'Ute hire', '-$100.00', 'TOTAL', '$316.00']);
    expect(totals).not.toContain('You get paid');
  });

  test('Recent activity, Invoice history, the invoice detail and Profile show the reduced figure and name the deduction', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();

    const recent = page.locator('.inv-history-item').filter({ hasText: 'SW-INV-UTE-PREV' });
    await expect(recent).toContainText('$276.00');
    await expect(recent.locator('[data-inv-deduction]')).toHaveText('Ute hire −$100.00');
    await expect(recent).not.toContainText('$376.00');

    await page.getByRole('button', { name: 'View All' }).click();
    const history = page.locator('.inv-history-item').filter({ hasText: 'SW-INV-UTE-PREV' });
    await expect(history).toContainText('$276.00');
    await expect(history.locator('[data-inv-deduction]')).toHaveText('Ute hire −$100.00');

    await history.click();
    await expect(page.getByText('Invoice Detail')).toBeVisible();
    const detail = page.locator('[data-invoice-money-summary]');
    await expect(detail.locator('[data-invoice-before-deduction]')).toHaveText('Payable before Ute hire$376.00');
    await expect(detail.locator('[data-invoice-deduction]')).toHaveText('Ute hire−$100.00');
    await expect(detail.locator('[data-invoice-paid]')).toHaveText('You get paid$276.00');

    await page.locator('[data-view="profile"]').click();
    const profile = page.locator('[data-profile-invoice="invoice-ute-last-week"]');
    await expect(profile).toContainText('$276.00');
    await expect(profile.locator('[data-inv-deduction]')).toHaveText('Ute hire −$100.00');
    await expect(profile).not.toContainText('$376.00');
  });
});

// my_hours works its outcome out from clocked hours, not from the hours he
// types on the invoice, so its "not taken" reason never reaches the screen
// before submit. Only the submit response, worked out from the whole invoice,
// may say the deduction was not taken.
test.describe('a week where the deduction was due and not taken', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-recurring-deduction-not-taken', appWeekDay: 6, ...MOBILE });

  test('before submit only what comes off is shown; the server reason shows once the invoice is submitted and paid in full', async ({ appPage: page }) => {
    const reason = 'Ute hire $500.00 was not taken: this invoice pays $376.00, which is less than the deduction. The office has been told.';
    await openBuilderWithDay(page);
    const preview = page.locator('[data-invoice-money-summary]');
    await expect(preview.locator('[data-invoice-deduction-week]')).toHaveText('Ute hire (comes off this week)−$500.00');
    await expect(preview.locator('[data-invoice-deduction-note]')).toHaveText(COMES_OFF_NOTE('$500.00'));
    await expect(preview).not.toContainText('not taken');
    await expect(page.locator('#hoursContent')).not.toContainText(reason);

    const confirm = await submitAndReadConfirm(page);
    expect(confirm).toContain(COMES_OFF_CONFIRM('$500.00'));
    expect(confirm).not.toContain('not taken');

    const saved = page.locator('[data-invoice-money-summary]');
    await expect(saved.locator('.inv-money-row')).toHaveText([
      'Earned$400.00',
      'Super (12%) paid into your super fund$48.00',
      'Your share of super (6%)−$24.00',
      'Company covers the other 6%$24.00',
      'You get paid$376.00',
      'GSTOff',
      'Invoice total$376.00'
    ]);
    await expect(saved.locator('[data-invoice-deduction]')).toHaveCount(0);
    await expect(saved.locator('[data-invoice-deduction-note]')).toHaveText(reason);
    expect((await pdfTotals(page)).slice(-6)).toEqual(['You get paid', '$376.00', 'GST', 'Off', 'TOTAL', '$376.00']);
  });
});

// A trade with no deduction sees EXACTLY what he saw before deductions
// existed. The strings below are the screens as they shipped before this
// change (captured from main, 13 Oct 2026), not a description of them: any
// new row, wording or figure for these trades fails here.
const BASELINE_BUILDER = '<div class="inv-money-summary" data-invoice-money-summary="" id="invMoneySummary">'
  + '<div class="inv-money-row"><span>Earned</span><span>$400.00</span></div>'
  + '<div class="inv-money-row"><span>Super (12%) paid into your super fund</span><span>$48.00</span></div>'
  + '<div class="inv-money-row"><span>Your share of super (6%)</span><span>−$24.00</span></div>'
  + '<div class="inv-money-row"><span>Company covers the other 6%</span><span>$24.00</span></div>'
  + '<div class="inv-money-row net"><span>You get paid</span><span>$376.00</span></div>'
  + '<div class="inv-gst-control"><div class="inv-gst-copy"><strong>Add GST to this invoice</strong><span>Turn on only if you are GST registered.</span></div>'
  + '<button type="button" class="inv-gst-switch" role="switch" aria-label="Add GST to this invoice" aria-checked="false" onclick="invGstChanged(!false)">'
  + '<span class="inv-gst-track" aria-hidden="true"><span class="inv-gst-thumb"></span></span><span data-invoice-gst-state="">Off</span></button></div>'
  + '<div class="inv-money-note">' + SUPER_NOTE + '</div>'
  + '<div class="inv-money-note">Estimate — SecureWorks confirms these figures when you submit.</div></div>';
const BASELINE_SUBMITTED = '<div class="inv-money-summary" data-invoice-money-summary="">'
  + '<div class="inv-money-row"><span>Earned</span><span>$272.00</span></div>'
  + '<div class="inv-money-row"><span>Super (12%) paid into your super fund</span><span>$32.64</span></div>'
  + '<div class="inv-money-row"><span>Your share of super (6%)</span><span>−$16.32</span></div>'
  + '<div class="inv-money-row"><span>Company covers the other 6%</span><span>$16.32</span></div>'
  + '<div class="inv-money-row net"><span>You get paid</span><span>$255.68</span></div>'
  + '<div class="inv-money-row"><span>GST</span><span>$23.94</span></div>'
  + '<div class="inv-money-row total"><span>Invoice total</span><span>$263.30</span></div>'
  + '<div class="inv-money-note">' + SUPER_NOTE + '</div></div>';
const BASELINE_PDF_TOTALS = [
  'Earned', '$272.00',
  'Super (12%) paid into your super fund', '$32.64',
  'Your share of super (6%)', '-$16.32',
  'Company covers the other 6%', '$16.32',
  'You get paid', '$255.68',
  'GST', '$23.94',
  'TOTAL', '$263.30'
];
const DEDUCTION_MARKS = '[data-invoice-deduction], [data-invoice-deduction-week], [data-invoice-deduction-note], [data-invoice-paid], [data-invoice-after-super]';
const BASELINE_CONFIRM = /^Submit 1 job for .+ \(\$400\.00 before super\)\.\n\nManual hours are verified by the office before payment\.\n\nThis is your ONE invoice for the week of .+\. Once you submit it you cannot add to it or send another invoice for this week\. Your next invoice is for next week \(.+\)\.$/;

test.describe('a trade with no deduction: an older server response without the new fields', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-super-gst', appWeekDay: 6, ...MOBILE });

  test('the weekly invoice, the submitted invoice and the PDF are exactly what they were', async ({ appPage: page }) => {
    await openBuilderWithDay(page);
    const preview = page.locator('[data-invoice-money-summary]');
    await expect(preview).toContainText('You get paid$376.00');
    expect(await preview.evaluate((el) => el.outerHTML)).toBe(BASELINE_BUILDER);

    await page.getByRole('switch', { name: 'Add GST to this invoice' }).click();
    const confirm = await submitAndReadConfirm(page);
    expect(confirm).toMatch(BASELINE_CONFIRM);

    const saved = page.locator('[data-invoice-money-summary]');
    expect(await saved.evaluate((el) => el.outerHTML)).toBe(BASELINE_SUBMITTED);
    expect(await pdfTotals(page)).toEqual(BASELINE_PDF_TOTALS);
    await expect(page.locator(DEDUCTION_MARKS)).toHaveCount(0);
  });
});

// Today's server, for a trade with no deduction: it names the GST figure
// `gst`, always answers `trade_payable`, and sends no `recurring_deduction`
// key. This change reads none of that for him, so he sees what main shows.
test.describe('a trade with no deduction: today\'s server', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-super-gst-payable', appWeekDay: 6, ...MOBILE });

  test('with GST off, the weekly invoice, the submitted invoice and the PDF are exactly what they were', async ({ appPage: page }) => {
    await openBuilderWithDay(page);
    const preview = page.locator('[data-invoice-money-summary]');
    await expect(preview).toContainText('You get paid$376.00');
    expect(await preview.evaluate((el) => el.outerHTML)).toBe(BASELINE_BUILDER);

    const confirm = await submitAndReadConfirm(page);
    expect(confirm).toMatch(BASELINE_CONFIRM);

    expect(await page.locator('[data-invoice-money-summary]').evaluate((el) => el.outerHTML)).toBe(
      '<div class="inv-money-summary" data-invoice-money-summary="">'
      + '<div class="inv-money-row"><span>Earned</span><span>$400.00</span></div>'
      + '<div class="inv-money-row"><span>Super (12%) paid into your super fund</span><span>$48.00</span></div>'
      + '<div class="inv-money-row"><span>Your share of super (6%)</span><span>−$24.00</span></div>'
      + '<div class="inv-money-row"><span>Company covers the other 6%</span><span>$24.00</span></div>'
      + '<div class="inv-money-row net"><span>You get paid</span><span>$376.00</span></div>'
      + '<div class="inv-money-row"><span>GST</span><span>Off</span></div>'
      + '<div class="inv-money-row total"><span>Invoice total</span><span>$376.00</span></div>'
      + '<div class="inv-money-note">' + SUPER_NOTE + '</div></div>'
    );
    expect(await pdfTotals(page)).toEqual([
      'Earned', '$400.00',
      'Super (12%) paid into your super fund', '$48.00',
      'Your share of super (6%)', '-$24.00',
      'Company covers the other 6%', '$24.00',
      'You get paid', '$376.00',
      'GST', 'Off',
      'TOTAL', '$376.00'
    ]);
    await expect(page.locator(DEDUCTION_MARKS)).toHaveCount(0);
  });

  // Known gap, older than the weekly deduction and out of scope here: the app
  // reads the GST figure only as `gst_amount`, so a GST-on invoice with no
  // deduction reads unavailable and builds no PDF. What its face should show
  // (the bill is net pay plus GST, $416.00; total_inc is gross plus GST,
  // $440.00) is a decision filed as its own task. Until then this change must
  // not switch on a total that disagrees with the bill.
  test('with GST on, the submitted invoice reads as on main and no PDF is built for the bill', async ({ appPage: page, feedRequests }) => {
    await openBuilderWithDay(page);
    await page.getByRole('switch', { name: 'Add GST to this invoice' }).click();
    const confirm = await submitAndReadConfirm(page);
    expect(confirm).toMatch(BASELINE_CONFIRM);

    expect(await page.locator('[data-invoice-money-summary]').evaluate((el) => el.outerHTML)).toBe(
      '<div class="inv-money-summary" data-invoice-money-summary="">'
      + '<div class="inv-money-note">Submitted invoice totals are unavailable. Open the saved invoice for the confirmed figures.</div></div>'
    );
    await expect(page.locator('#hoursContent')).not.toContainText('$440.00');
    expect(await page.evaluate(() => window.__invoicePdfText)).toEqual([]);
    expect(feedRequests.some((entry) => entry.method === 'POST' && entry.action === 'attach_invoice_pdf')).toBe(false);
    await expect(page.locator(DEDUCTION_MARKS)).toHaveCount(0);
  });
});

test.describe('a trade with no deduction: invoice lists and detail', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-invoice-history-money-truth' });

  test('Recent activity, Invoice history and the invoice detail are exactly what they were', async ({ appPage: page }) => {
    const rowRight = '<div style="text-align:right"><div style="font-size:14px;font-weight:700;color:var(--sw-dark)">$376.00</div>'
      + '<span class="mm-status sent" data-inv-status="sent">Waiting on office</span></div>';
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    const recent = page.locator('.inv-history-item').filter({ hasText: 'INV-TRUTH-COMPLETE' });
    await expect(recent).toContainText('$376.00');
    expect(await recent.locator('> div').nth(1).evaluate((el) => el.outerHTML)).toBe(rowRight);

    await page.getByRole('button', { name: 'View All' }).click();
    const history = page.locator('.inv-history-item').filter({ hasText: 'INV-TRUTH-COMPLETE' });
    expect(await history.locator('> div').nth(1).evaluate((el) => el.outerHTML)).toBe(rowRight);

    await history.click();
    await expect(page.getByText('Invoice Detail')).toBeVisible();
    expect(await page.locator('[data-invoice-money-summary]').evaluate((el) => el.outerHTML)).toBe(
      '<div class="inv-money-summary" data-invoice-money-summary="">'
      + '<div class="inv-money-row"><span>Earned</span><span>$400.00</span></div>'
      + '<div class="inv-money-row"><span>Super (12%) paid into your super fund</span><span>$48.00</span></div>'
      + '<div class="inv-money-row"><span>Your share of super (6%)</span><span>−$24.00</span></div>'
      + '<div class="inv-money-row"><span>Company covers the other 6%</span><span>$24.00</span></div>'
      + '<div class="inv-money-row net"><span>You get paid</span><span>$376.00</span></div>'
      + '<div class="inv-money-row"><span>GST</span><span>Off</span></div>'
      + '<div class="inv-money-row total"><span>Invoice total</span><span>$376.00</span></div>'
      + '<div class="inv-money-note">' + SUPER_NOTE + '</div></div>'
    );

    await page.locator('[data-view="profile"]').click();
    await expect(page.locator('[data-profile-invoice="invoice-truth-complete"] > div').nth(1)).toHaveAttribute('style', 'font-size:14px;font-weight:700;color:var(--sw-dark)');
    await expect(page.locator('[data-inv-deduction]')).toHaveCount(0);
  });
});
