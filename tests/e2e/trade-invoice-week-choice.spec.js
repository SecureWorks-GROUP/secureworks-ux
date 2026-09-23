// One invoice per trade per week (2026-09-23, Nithin; captain's running rule).
//
// Nithin, an hourly trade whose every line is a searched-in admin job,
// invoiced last week, then started another invoice, stepped the picker back
// onto that same week and hit ops-api's 409 WEEK_ALREADY_INVOICED with no way
// to see or change the week inside the builder. These specs pin:
//  - the week picker shows an invoiced week as done and will not open it;
//  - submitting is a deliberate confirm naming the ONE week (Mon to Sun) and
//    that the next invoice is for next week, disabled until ticked;
//  - after a successful submit the week shows as invoiced and the Pay hub and
//    picker move on to next week;
//  - the builder shows the week it posts under and can change it in place,
//    carrying searched-in jobs to the same weekday of the new week.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

test.use({
  persona: 'installer',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  timezoneId: 'Australia/Perth'
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function weekLabel(monday) {
  const day = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
  const start = day(monday);
  const end = day(addIsoDays(monday, 6));
  return `${start.d} ${MONTHS[start.m - 1]} – ${end.d} ${MONTHS[end.m - 1]} ${end.y}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekSpanLong(monday) {
  const fmt = (iso, withYear) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
  };
  return `${fmt(monday, false)} to ${fmt(addIsoDays(monday, 6), true)}`;
}

const thisMonday = perthWeekMonday();
const lastMonday = addIsoDays(thisMonday, -7);

async function openWeeklyInvoicePicker(page) {
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
}

async function addSearchedJob(page, dayIndex, query, jobNumber, hours, description) {
  await page.locator(`button[onclick="jcOpenJobSearch(${dayIndex})"]`).click();
  await page.locator(`#jcSearchInput_${dayIndex}`).fill(query);
  await page.locator('.jc-job-search-hit').filter({ hasText: jobNumber }).click();
  const card = page.locator('.jc-card').filter({ hasText: jobNumber });
  await card.locator('input[type="text"]').fill(description);
  await card.locator('input[type="text"]').blur();
  await card.locator('[data-cardhours]').fill(String(hours));
  await card.locator('[data-cardhours]').blur();
  return card;
}

async function confirmOneInvoice(page, monday) {
  const msg = page.locator('#confirmMsg');
  await expect(msg).toContainText(`This is your ONE invoice for the week of ${weekSpanLong(monday)}`);
  await expect(msg).toContainText(`Your next invoice is for next week (${weekLabel(addIsoDays(monday, 7))})`);
  // Deliberate, not a tap-through: Submit stays shut until the statement is ticked.
  await expect(page.locator('#confirmOk')).toBeDisabled();
  await expect(page.locator('#confirmAckWrap')).toContainText(`I have put everything for ${weekLabel(monday)} on this invoice.`);
  await page.locator('#confirmAck').check();
  await expect(page.locator('#confirmOk')).toBeEnabled();
  await page.locator('#confirmOk').click();
}

test.describe('Nithin: one invoice per week, all searched-in admin jobs', () => {
  test.use({ feedScenario: 'trade-invoice-multi-week' });

  test('the picker shows last week as invoiced and will not open it', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await openWeeklyInvoicePicker(page);
    await expect(page.locator('#invoiceWeekLabel')).toHaveText(weekLabel(thisMonday));
    await expect(page.locator('[data-invoice-week-status]')).toContainText('Not invoiced yet');
    await expect(page.locator('#invoiceWeekContinue')).toBeEnabled();

    // What Nithin did: one tap back onto the week he had already invoiced.
    await page.locator('button[onclick="shiftInvoiceWeek(-1)"]').click();
    await expect(page.locator('#invoiceWeekLabel')).toHaveText(weekLabel(lastMonday));
    await expect(page.locator('[data-invoice-week-invoiced]')).toContainText('Invoiced · SW-INV-N-260923-017');
    await expect(page.locator('[data-invoice-week-status]')).toContainText('one invoice per week');
    await expect(page.locator('#invoiceWeekContinue')).toBeDisabled();
    const hoursReadsBefore = feedRequests.filter((entry) => entry.action === 'my_hours').length;
    await page.locator('#invoiceWeekContinue').click({ force: true });
    await expect(page.locator('[data-invoice-week]')).toHaveCount(0);
    expect(feedRequests.filter((entry) => entry.action === 'my_hours').length).toBe(hoursReadsBefore);
  });

  test('submit is a deliberate one-invoice confirm; afterwards the week is done and the app moves to next week', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await openWeeklyInvoicePicker(page);
    await page.locator('#invoiceWeekContinue').click();

    const bar = page.locator('[data-invoice-week]');
    await expect(bar).toContainText('Invoice for the week');
    await expect(bar.locator('[data-invoice-week-label]')).toHaveText(weekLabel(thisMonday));
    await addSearchedJob(page, 1, 'Graham', 'SWP-26339', 1.5, 'Council approval');

    // Cancel is safe: nothing posts.
    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#confirmOk')).toBeDisabled();
    await page.locator('#confirmCancel').click();
    expect(feedRequests.some((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice')).toBe(false);

    await page.locator('#invSubmitBtn').click();
    await confirmOneInvoice(page, thisMonday);
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    await expect(page.locator('[data-invoice-week-done]')).toContainText(`${weekLabel(thisMonday)} is invoiced. Your next invoice is for ${weekLabel(addIsoDays(thisMonday, 7))}.`);

    const posts = feedRequests.filter((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
    expect(posts).toHaveLength(1);
    expect(posts[0].body.week_start).toBe(thisMonday);
    expect(posts[0].body.extra_items).toEqual([
      expect.objectContaining({ job_number: 'SWP-26339', date: addIsoDays(thisMonday, 1), quantity: 1.5, manually_added: true })
    ]);

    // Done: the Pay hub reads NEXT week, and the picker opens on it.
    await page.getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => feedRequests.filter((entry) => entry.action === 'my_hours').map((entry) => new URL(entry.url).searchParams.get('week_ending')).pop())
      .toBe(addIsoDays(thisMonday, 13));
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await expect(page.locator('#invoiceWeekLabel')).toHaveText(weekLabel(addIsoDays(thisMonday, 7)));
    await expect(page.locator('#invoiceWeekContinue')).toBeEnabled();
    await page.locator('button[onclick="shiftInvoiceWeek(-1)"]').click();
    await expect(page.locator('[data-invoice-week-invoiced]')).toContainText('Invoiced');
    await expect(page.locator('#invoiceWeekContinue')).toBeDisabled();
  });

  test('changing week in the builder keeps what was typed, and an invoiced week is shown as done', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await openWeeklyInvoicePicker(page);
    await page.locator('#invoiceWeekContinue').click();
    await addSearchedJob(page, 2, 'Emma', 'SWP-261183', 3, 'Material order');

    await page.locator('[data-invoice-week-prev]').click();
    const bar = page.locator('[data-invoice-week]');
    await expect(bar.locator('[data-invoice-week-label]')).toHaveText(weekLabel(lastMonday));
    await expect(page.locator('[data-invoice-week-taken]')).toContainText('is already invoiced');
    await expect(page.locator('[data-invoice-week-taken]')).toContainText('SW-INV-N-260923-017');
    const card = page.locator('.jc-card').filter({ hasText: 'SWP-261183' });
    await expect(card.locator('[data-cardhours]')).toHaveValue('3');
    await expect(card.locator('input[type="text"]')).toHaveValue('Material order');

    // Submitting on a done week is stopped before any confirm or POST.
    await page.locator('#invSubmitBtn').click();
    await expect(page.locator('#toast')).toContainText('is already invoiced (SW-INV-N-260923-017)');
    await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);

    await page.locator('[data-invoice-week-next]').click();
    await expect(bar.locator('[data-invoice-week-label]')).toHaveText(weekLabel(thisMonday));
    await expect(page.locator('[data-invoice-week-taken]')).toHaveCount(0);
    await expect(card.locator('[data-cardhours]')).toHaveValue('3');

    await page.locator('#invSubmitBtn').click();
    await confirmOneInvoice(page, thisMonday);
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    const posts = feedRequests.filter((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
    expect(posts).toHaveLength(1);
    expect(posts[0].body.week_start).toBe(thisMonday);
    expect(posts[0].body.extra_items[0].date).toBe(addIsoDays(thisMonday, 2));
  });

  test('a past week with no invoice can still be invoiced', async ({ appPage: page, feedRequests }) => {
    const twoWeeksAgo = addIsoDays(thisMonday, -14);
    await signIn(page, PERSONAS.installer);
    await openWeeklyInvoicePicker(page);
    await page.locator('button[onclick="shiftInvoiceWeek(-1)"]').click();
    await page.locator('button[onclick="shiftInvoiceWeek(-1)"]').click();
    await expect(page.locator('#invoiceWeekLabel')).toHaveText(weekLabel(twoWeeksAgo));
    await expect(page.locator('[data-invoice-week-status]')).toContainText('Not invoiced yet');
    await page.locator('#invoiceWeekContinue').click();
    await addSearchedJob(page, 4, 'Emma', 'SWP-261183', 2, 'Site check');
    await page.locator('#invSubmitBtn').click();
    await confirmOneInvoice(page, twoWeeksAgo);
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    const post = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
    expect(post.body.week_start).toBe(twoWeeksAgo);
    expect(post.body.extra_items[0].date).toBe(addIsoDays(twoWeeksAgo, 4));
  });
});
