// Dispatch v2 item 19 (Shaun, 18 Nov 2026): Read now, in the corner where
// "Switch back to v1" was (ops.html <dispatch-version>,
// modules/dispatch-read-now.js; backend contract section 3j).
//
// One press sends dispatch_v2_read_now once (the ops-api reads Outlook and
// matches supplier replies), then the screen reads the board, the tray and
// the open job again without a page refresh, and says what happened in one
// line. Against the stubbed ops-api of the payment step tests: nothing
// leaves, and Read now itself is answered by the stub. Made-up jobs.
const { test, expect } = require('@playwright/test');
const { JOB_ID, fakePayment, boot } = require('../helpers/dispatch-v2-payment');

const NO_DASH = new RegExp('[\\u2013\\u2014]');
// 06:32 UTC is 2:32pm in Perth.
const ANSWER = (over) => Object.assign({
  ok: true, read_at: '2026-11-18T06:32:05.000Z', lane: 'on', reused: false, left_to_sort: 3,
  mail: { status: 'read', emails_read: 4, mailboxes: 11, mailboxes_not_read: 0 },
  replies: { status: 'scanned', stored: 2, matched: 1, needs_confirmation: 1, unmatched: 0, suggestions: 0 },
}, over);

// The reads Read now must send again after its answer, for the open job.
const RELOADS = ['pipeline', 'dispatch_v2_replies_unmatched', 'dispatch_v2_materials', 'dispatch_v2_replies', 'dispatch_arrival', 'job_notes'];

function counts(calls) {
  const n = {};
  calls.forEach((c) => { n[c.action] = (n[c.action] || 0) + 1; });
  return n;
}

async function marked(page) {
  await page.evaluate(() => { window.__noRefresh = 'same page'; });
}

test.describe('Dispatch v2: Read now', () => {
  test('one press reads, is off while it runs, then reloads the board, tray and open job with no page refresh', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    let release;
    const gate = new Promise((r) => { release = r; });
    let left = 1;
    const { root, calls, of } = await boot(page, fake, {
      api: {
        dispatch_v2_read_now: async () => { await gate; left = 3; return ANSWER(); },
        dispatch_v2_replies_unmatched: () => ({ ok: true, include_other: false, emails: [], counts: { needs_confirmation: 1, unmatched_order_desk: left - 1, unmatched_other: 4 } }),
      },
    });
    const bar = page.locator('#dispatchVersionBar');
    const btn = bar.locator('[data-dispatch-read-now]');
    const chip = root.locator('.dpc-needs-chip', { hasText: 'Emails to sort' });
    await expect(chip).toHaveText('Emails to sort 1');
    await marked(page);
    const before = counts(calls);

    await btn.click();
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveText('Reading...');
    await expect(bar.locator('[data-dispatch-read-line]')).toHaveText('Reading Outlook and matching supplier emails...');
    // A second press while it runs sends nothing more.
    await btn.click({ force: true });
    release();

    await expect(bar.locator('[data-dispatch-read-line]')).toHaveText('Read 2:32pm. 2 new supplier emails. 3 emails to sort.');
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText('Read now');
    await expect(chip).toHaveText('Emails to sort 3');
    expect(of('dispatch_v2_read_now').map((c) => c.method)).toEqual(['POST']);
    await expect.poll(() => {
      const after = counts(calls);
      return RELOADS.filter((a) => !((after[a] || 0) > (before[a] || 0)));
    }).toEqual([]);
    // The open job's reads are for the open job.
    expect(of('dispatch_v2_materials').at(-1).url.searchParams.get('job_id')).toBe(JOB_ID);
    expect(of('dispatch_v2_replies').at(-1).url.searchParams.get('job_id')).toBe(JOB_ID);
    // No page refresh, and the only write is Read now itself.
    expect(await page.evaluate(() => window.__noRefresh)).toBe('same page');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.action)).toEqual(['dispatch_v2_read_now']);
    await expect(bar).not.toContainText(NO_DASH);
  });

  test('a paused capture lane says so; the board is still reloaded', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { of } = await boot(page, fake, { api: { dispatch_v2_read_now: () => ANSWER({ lane: 'paused', mail: null, replies: null, left_to_sort: 0 }) } });
    const bar = page.locator('#dispatchVersionBar');
    const reads = of('pipeline').length;
    await bar.locator('[data-dispatch-read-now]').click();
    await expect(bar.locator('[data-dispatch-read-line]')).toHaveText('Read 2:32pm. Email reading is paused, so nothing new was read.');
    await expect.poll(() => of('pipeline').length).toBeGreaterThan(reads);
  });

  test('slow Outlook is a plain line, not a hang', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { of } = await boot(page, fake, { api: { dispatch_v2_read_now: () => ANSWER({ mail: { status: 'slow' }, replies: { status: 'scanned', stored: 0 }, left_to_sort: 0 }) } });
    const bar = page.locator('#dispatchVersionBar');
    await bar.locator('[data-dispatch-read-now]').click();
    await expect(bar.locator('[data-dispatch-read-line]')).toHaveText('Read 2:32pm. No new supplier emails. Outlook was slow, so some new mail may only show at the next read.');
    expect(of('dispatch_v2_read_now')).toHaveLength(1);
  });

  test('an ops-api that never answers ends at the screen cap with a plain line, and the button comes back', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { of } = await boot(page, fake, { api: { dispatch_v2_read_now: () => new Promise((r) => setTimeout(() => r(ANSWER()), 4000)) } });
    await page.evaluate(() => { window.OpsDispatchReadNow.capMs = 300; });
    const bar = page.locator('#dispatchVersionBar');
    const btn = bar.locator('[data-dispatch-read-now]');
    const reads = of('pipeline').length;
    await btn.click();
    await expect(bar.locator('[data-dispatch-read-line]')).toHaveText('Outlook is slow. The board is reloaded; try Read now again in a minute.');
    await expect(btn).toBeEnabled();
    await expect.poll(() => of('pipeline').length).toBeGreaterThan(reads);
  });

  test('a refused or failed press (an ops-api without Read now yet) is a plain line, and the board is still reloaded', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { of } = await boot(page, fake, { api: { dispatch_v2_read_now: () => ({ status: 400, body: { error: 'Unknown action: dispatch_v2_read_now' } }) } });
    const bar = page.locator('#dispatchVersionBar');
    const reads = of('dispatch_v2_replies_unmatched').length;
    await bar.locator('[data-dispatch-read-now]').click();
    await expect(bar.locator('[data-dispatch-read-line]')).toHaveText('Could not read the email just now. The board is reloaded with what was already read.');
    await expect(bar).not.toContainText('Unknown action');
    await expect(bar.locator('[data-dispatch-read-now]')).toBeEnabled();
    await expect.poll(() => of('dispatch_v2_replies_unmatched').length).toBeGreaterThan(reads);
  });
});
