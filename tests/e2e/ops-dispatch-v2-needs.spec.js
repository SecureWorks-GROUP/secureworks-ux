// Dispatch v2, Needs you now (Tweak 3): the bar of chips under the Dispatch
// header, the tags on each job card, the chip filter and the count on the
// Dispatch tab, against the stubbed ops-api of the payment step tests.
// Nothing leaves: every read is answered by the stub, and the bar writes
// nothing. The counting rules themselves are unit tested in
// tests/unit/dispatch-needs-you.test.cjs.
// The jobs, clients and suppliers are made up.
const { test, expect } = require('@playwright/test');
const { JOB_ID, dayFrom, fakePayment, boot } = require('../helpers/dispatch-v2-payment');
const { PERTH_TODAY, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');

const NO_DASH = /[–—]/;
const QUIET = 'job-quiet';

// The payment fixture's job, plus a quiet job with no supplier orders that
// needs nothing. The quiet job is the newer one, so it is listed (and
// opened) first; Needs you now then lifts the other above it. Each job's
// replies read answers for that job only.
function twoJobs(fake, { emails = 0 } = {}) {
  const pipeline = fake.api.pipeline;
  const quietRow = () => {
    const r = fake.row();
    return Object.assign({}, r, {
      id: QUIET, job_number: 'SWR-930002', client_name: 'Jane Quiet', updated_at: '2026-11-01T00:00:00Z',
      board: Object.assign({}, r.board, {
        title: 'SWR-930002 · Jane Quiet',
        arrival: { today: PERTH_TODAY, install_day: null, orders: [], counts: { orders: 0, sent: 0, confirmed: 0, late: 0 }, all_confirmed_in_time: false, waiting_on_us: [] },
        waiting: { on_us: false, todo: [] },
      }),
    });
  };
  return {
    pipeline: (url, body) => {
      const out = pipeline(url, body);
      const main = Object.assign({}, out.columns.accepted[0], { updated_at: '2026-10-01T00:00:00Z' });
      return Object.assign({}, out, { columns: { accepted: [quietRow(), main] }, total: 2 });
    },
    dispatch_v2_replies: (url) => (url.searchParams.get('job_id') === JOB_ID ? fake.replies() : V2_EMPTY_READS.dispatch_v2_replies(url)),
    dispatch_v2_replies_unmatched: () => ({ ok: true, include_other: false, emails: [], counts: { needs_confirmation: 0, unmatched_order_desk: emails, unmatched_other: 0 } }),
  };
}

const card = (root, num) => root.locator('.dpc-job', { hasText: num });
const chip = (root, label) => root.locator('.dpc-needs-chip', { hasText: label });

test.describe('Dispatch v2: Needs you now', () => {
  test('the bar counts each kind, every card says why, and the tab carries the total', async ({ page }) => {
    const fake = fakePayment({ onAccount: true, fresh: true });
    const { root } = await boot(page, fake, { api: twoJobs(fake, { emails: 3 }) });
    const bar = root.locator('[data-dpc-region="needs"]');
    await expect(bar.locator('.dpc-needs-title')).toHaveText('Needs you now');
    await expect(bar.locator('.dpc-needs-chip')).toHaveText(['To order 1', 'To pay 1', 'Supplier replied 0', 'Follow up 0', 'Date at risk 0', 'Emails to sort 3']);
    await expect(chip(root, 'Supplier replied')).toBeDisabled();
    // The job with orders on us: one tag per reason, in chip order.
    await expect(card(root, 'SWR-930001').locator('.dpc-need')).toHaveText(['Order Metroll', 'Pay Lysaght', 'Pay Twinside Retaining']);
    await expect(card(root, 'SWR-930001').locator('.dpc-need-pay')).toHaveCount(2);
    // The quiet job has no tags and sits below.
    await expect(card(root, 'SWR-930002').locator('.dpc-need')).toHaveCount(0);
    const order = await root.locator('.dpc-job').evaluateAll((els) => els.map((e) => e.getAttribute('data-dpc-job')));
    expect(order).toEqual([JOB_ID, QUIET]);
    // One job needs something, and three emails wait in the tray.
    await expect(page.locator('.header-nav [data-view="dispatch"] .dpc-tab-n')).toHaveText('4');
    expect(await bar.innerText()).not.toMatch(NO_DASH);
    if (process.env.DPC_SHOT) {
      await page.screenshot({ path: process.env.DPC_SHOT + '-needs-bar.png' });
      await card(root, 'SWR-930001').scrollIntoViewIfNeeded();
      await root.locator('[data-dpc-region="queue"]').screenshot({ path: process.env.DPC_SHOT + '-needs-list.png' });
    }
  });

  test('a chip keeps only its jobs; pressed again, every job shows', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { root } = await boot(page, fake, { api: twoJobs(fake) });
    await expect(root.locator('.dpc-job')).toHaveCount(2);
    await chip(root, 'To pay').click();
    await expect(chip(root, 'To pay')).toHaveAttribute('aria-pressed', 'true');
    await expect(root.locator('.dpc-job')).toHaveCount(1);
    await expect(card(root, 'SWR-930001')).toBeVisible();
    await expect(root.locator('[data-dpc-region="needs"] .dpc-textbtn')).toHaveText('Show all jobs');
    await chip(root, 'To pay').click();
    await expect(chip(root, 'To pay')).toHaveAttribute('aria-pressed', 'false');
    await expect(root.locator('.dpc-job')).toHaveCount(2);
  });

  test('Show all jobs clears the chip, and Emails to sort opens the tray', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { root } = await boot(page, fake, { api: twoJobs(fake, { emails: 2 }) });
    await chip(root, 'To pay').click();
    await root.locator('[data-dpc-region="needs"] .dpc-textbtn').click();
    await expect(root.locator('.dpc-job')).toHaveCount(2);
    await chip(root, 'Emails to sort').click();
    await expect(root.locator('[data-dpc-region="tray"]')).toBeVisible();
    await expect(root.locator('.dpc-job')).toHaveCount(2);
  });

  test('a date suggestion to Accept counts once the job has been opened', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { root } = await boot(page, fake, { api: twoJobs(fake) });
    await expect(chip(root, 'Supplier replied')).toHaveText('Supplier replied 0');
    await card(root, 'SWR-930001').click();
    await expect(chip(root, 'Supplier replied')).toHaveText('Supplier replied 1');
    await expect(card(root, 'SWR-930001').locator('.dpc-need-replied')).toHaveText('Accept Lysaght date');
  });

  test('Follow up and Date at risk come from the sent day and the install day', async ({ page }) => {
    // Lysaght sent 29/10 and still at Sent to supplier; the install three
    // days away; Twinside has no date at all.
    const fake = fakePayment({ install: dayFrom(3), lysaght: { stage: 'sent', stageSource: 'worked_out' } });
    const { root } = await boot(page, fake, { api: twoJobs(fake) });
    const tags = card(root, 'SWR-930001').locator('.dpc-need');
    await expect(card(root, 'SWR-930001').locator('.dpc-need-follow')).toHaveText(/^Follow up Lysaght, \d+ days$/);
    await expect(card(root, 'SWR-930001').locator('.dpc-need-risk', { hasText: 'Lysaght' })).toHaveText('Lysaght due after install');
    await expect(card(root, 'SWR-930001').locator('.dpc-need-risk', { hasText: 'Twinside' })).toHaveText(/^Twinside Retaining date not confirmed, install in \d days?$/);
    await expect(chip(root, 'Follow up')).toHaveText('Follow up 1');
    await expect(chip(root, 'Date at risk')).toHaveText('Date at risk 1');
    expect(await tags.allInnerTexts()).not.toContain('Pay Lysaght');
  });

  test('nothing to do: the bar says so and the tab has no count', async ({ page }) => {
    const paid = { at: '2026-10-29T06:40:00.000Z', by: 'shaun@ops.test' };
    const fake = fakePayment({ lysaght: { paid }, twinside: { paid, date: dayFrom(6), confirmed: true } });
    const { root } = await boot(page, fake, { api: twoJobs(fake) });
    await expect(root.locator('[data-dpc-region="needs"] .dpc-needs-note')).toHaveText('Nothing needs you right now.');
    await expect(root.locator('.dpc-needs-chip:not([disabled])')).toHaveCount(0);
    await expect(page.locator('.header-nav [data-view="dispatch"] .dpc-tab-n')).toHaveCount(0);
  });

  test('a tray that could not be read hides Emails to sort rather than show 0', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const api = twoJobs(fake);
    api.dispatch_v2_replies_unmatched = () => ({ status: 500, body: { error: 'e2e' } });
    const { root } = await boot(page, fake, { api });
    await expect(chip(root, 'To pay')).toHaveText('To pay 1');
    await expect(chip(root, 'Emails to sort')).toHaveCount(0);
  });
});
