// Clear Debt screen: real-browser checks with trusted input only.
//
// Runs the real modules/ops-clear-debt-v2.js against the offline fixture
// (tests/fixtures/clear-debt/index.html): synthetic debtors, CSP
// connect-src 'none', the one debt_worklist read answered in page and recorded
// on window.fakeReads, any write recorded on window.fakeWrites. Clicks and
// typing go through Playwright's trusted input pipeline, never
// element.dispatchEvent, on a desktop and a phone viewport. Every browser
// request is logged too, so a provider call or a write cannot hide.
const { test, expect } = require('@playwright/test');

const PAGE = '/tests/fixtures/clear-debt/index.html';
const STATIC = /\/(tests\/fixtures\/clear-debt\/(index\.html|worklist\.js)|modules\/ops-clear-debt-v2\.(js|css))(\?.*)?$/;

const viewports = [
  { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
];

async function open(page, query) {
  const requests = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
  await page.goto(PAGE + (query || ''));
  return requests;
}
async function ledger(page) {
  return page.evaluate(() => ({ reads: window.fakeReads, writes: window.fakeWrites }));
}
function onlyStatic(requests) {
  return requests.filter((r) => r.method !== 'GET' || !STATIC.test(r.url));
}

for (const vp of viewports) {
  test.describe(`clear debt on ${vp.name}`, () => {
    test.use(vp.use);

    test('one read on tab load, honest counts, every debtor listed, nothing picked', async ({ page }) => {
      const requests = await open(page);
      await expect(page.locator('.db-list .lead').first()).toBeVisible();
      const counts = page.locator('.counts');
      await expect(counts).toContainText('101 open invoices');
      await expect(counts).toContainText('$122,209.52 due');
      await expect(counts).toContainText('77 of 101 overdue');
      await expect(counts).toContainText('90 of 101 linked to a job');
      await expect(counts).toContainText('11 not linked');
      await expect(counts).toContainText('21 of 101 with facts');
      await expect(page.locator('.db-title p')).toContainText('as of 10:00am Thu 24 Sep');
      await expect(page.locator('.db-list .lead')).toHaveCount(78);
      const { reads, writes } = await ledger(page);
      expect(reads).toEqual([{ action: 'debt_worklist', params: { timeline: 'recent' } }]);
      expect(writes).toEqual([]);
      expect(onlyStatic(requests)).toEqual([]);
      if (vp.name === 'desktop') await expect(page.locator('.db-card h2')).toHaveText('Pick a debtor');
      else await expect(page.locator('.db-card')).toBeHidden();
    });

    test('a debtor opens with no invoice picked; picking one binds the draft to exactly it; no further reads or writes', async ({ page }) => {
      const requests = await open(page);
      await page.locator('.db-list .lead', { hasText: 'Debtor 001' }).first().click();
      const card = page.locator('.db-card');
      await expect(card.locator('.cardhead h2')).toHaveText('Debtor 001');
      await expect(card.locator('input[data-cd="invoice"]')).toHaveCount(5);
      await expect(card.locator('input[data-cd="invoice"]:checked')).toHaveCount(0);
      await expect(card.locator('.compose')).toContainText('Pick an invoice above to draft a message about it.');
      await expect(card.locator('#cd-draft')).toHaveCount(0);
      await expect(card).toContainText('Also written as Debtor 001 Pty Ltd on the same Xero contact.');

      const inv = card.locator('label.inv', { hasText: 'INV-S1003' });
      await inv.click();
      await expect(inv.locator('input')).toBeChecked();
      await expect(card.locator('input[data-cd="invoice"]:checked')).toHaveCount(1);
      const compose = card.locator('.compose');
      await expect(compose.locator('.route').first()).toContainText('About INV-S1003 only: $527.68 due');
      await expect(compose.locator('[data-cd-route]')).toHaveText('Text to 0491 570 157');
      const draft = page.getByRole('textbox', { name: 'Text' });
      await expect(draft).toHaveValue('Synthetic draft text 3 about invoice INV-S1003 and its balance of $527.68.');
      await expect(compose.locator('[data-cd-missing]')).toHaveText('Not in this read yet: the line the text is sent from.');
      const send = compose.getByRole('button', { name: 'Approve and send' });
      await expect(send).toBeDisabled();
      await expect(compose.locator('.why')).toHaveText('Sending arrives with a later approval step. Nothing is sent, saved or approved from this screen.');

      // Typing keeps the caret and stays local.
      await draft.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Thanks.');
      await expect(draft).toBeFocused();
      await expect(draft).toHaveValue(/Thanks\.$/);
      await expect(compose).toContainText('Edited here. Your changes stay in this tab and are not saved.');
      await compose.getByRole('button', { name: 'Use the drafted words' }).click();
      await expect(draft).toHaveValue('Synthetic draft text 3 about invoice INV-S1003 and its balance of $527.68.');

      // Email names everything it cannot supply; a text never borrows an address.
      await compose.getByRole('button', { name: 'Email' }).click();
      await expect(compose.locator('[data-cd-route]')).toContainText('recipient not in this read');
      await expect(compose.locator('[data-cd-missing]')).toHaveText('Not in this read yet: the email address, the subject line, which invoice PDF is attached, the mailbox it is sent from.');
      await expect(compose.getByRole('button', { name: 'Approve and send' })).toBeDisabled();
      await compose.getByRole('button', { name: 'Note' }).click();
      await expect(compose.getByRole('button', { name: 'Save note' })).toBeDisabled();

      // Picking another invoice moves the draft's scope with it.
      await card.locator('label.inv', { hasText: 'INV-S1005' }).click();
      await expect(compose.locator('.route').first()).toContainText('About INV-S1005 only');
      await expect(card.locator('input[data-cd="invoice"]:checked')).toHaveCount(1);

      const { reads, writes } = await ledger(page);
      expect(reads).toHaveLength(1);
      expect(writes).toEqual([]);
      expect(onlyStatic(requests)).toEqual([]);
    });

    test('one timeline: chips filter the same stream, sources are labelled, scope narrows to the picked invoice', async ({ page }) => {
      const requests = await open(page);
      await page.locator('.db-list .lead', { hasText: 'Debtor 001' }).first().click();
      const card = page.locator('.db-card');
      const entries = card.locator('.thread > li.tl');
      await expect(entries).toHaveCount(12);
      await expect(card.locator('[data-cd-limits]')).toContainText('Only the newest 12 of 32 stored entries are in this read.');
      await expect(card.locator('[data-cd-limits]')).toContainText('Sent emails are not captured yet; that fix is under way.');
      await expect(card.locator('.tl.is-out', { hasText: 'Invoice emailed' }).first().locator('.tl-body')).toHaveText(/^Invoice INV-S\d+ emailed to debtor001@example\.invalid\.$/);
      await expect(card.locator('.nextstep')).toContainText('now overdue');
      await expect(card.locator('.tl .src').first()).toBeVisible();
      await expect(card.locator('.tl-foot', { hasText: 'Preview, cut at 500 characters' })).toHaveCount(1);
      await expect(card.locator('.tl-foot', { hasText: 'also in captured event' })).toHaveCount(1);

      for (const [label, group] of [['Texts', 'text'], ['Emails', 'email'], ['Notes', 'note'], ['Calls', 'call'], ['Invoices and Xero', 'xero'], ['Facts', 'facts']]) {
        const chip = card.locator('[data-cd="tl"][data-tl="' + group + '"]');
        await expect(chip).toContainText(label);
        await chip.click();
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        const n = Number(await chip.locator('.count').textContent());
        await expect(entries).toHaveCount(n);
        for (const g of await entries.evaluateAll((els) => els.map((e) => e.dataset.group))) expect(g).toBe(group);
      }
      // Captured facts are entries in the same stream, each with its value, state and source.
      await card.locator('[data-tl="facts"]').click();
      const facts = card.locator('.thread > li.tl.is-fact');
      expect(await facts.count()).toBeGreaterThan(0);
      await expect(facts.first().locator('.src')).toHaveText('Luna');
      await expect(facts.first().locator('.tl-kind')).toContainText('Captured fact:');
      await expect(facts.first().locator('.tl-foot')).toContainText(/(Current|Stale) captured facts · source fact-001-/);
      await card.locator('[data-tl="all"]').click();
      expect(await card.locator('.thread > li.tl.is-fact').count()).toBe(await facts.count());
      await expect(entries).toHaveCount(12);

      await card.locator('label.inv', { hasText: 'INV-S1003' }).click();
      await expect(entries).toHaveCount(12);
      await expect(card.getByLabel('Only INV-S1003')).toHaveCount(0);

      await expect(page.getByText(/no messages/i)).toHaveCount(0);
      const { reads, writes } = await ledger(page);
      expect(reads).toHaveLength(1);
      expect(writes).toEqual([]);
      expect(onlyStatic(requests)).toEqual([]);
    });

    test('search and filters narrow the list without moving the counts or losing the caret', async ({ page }) => {
      await open(page);
      const box = page.getByRole('searchbox', { name: 'Search debtors' });
      await box.click();
      await page.keyboard.type('Debtor 020');
      await expect(box).toBeFocused();
      await expect(page.locator('.db-list .lead')).toHaveCount(2);
      await expect(page.locator('.grouphead .count')).toHaveText('2 of 78');
      await box.fill('');
      await page.keyboard.type('INV-S1050');
      await expect(page.locator('.db-list .lead')).toHaveCount(1);
      await page.getByRole('button', { name: 'Show all' }).click();
      await expect(page.locator('.db-list .lead')).toHaveCount(78);
      await page.getByLabel('Show').selectOption('not_linked');
      await expect(page.locator('.db-list .lead')).toHaveCount(11);
      await page.getByLabel('Show').selectOption('stale');
      await expect(page.locator('.db-list .lead')).toHaveCount(3);
      await expect(page.locator('.db-list .lead', { hasText: 'Debtor 008' })).toHaveCount(1);
      await page.getByLabel('Show').selectOption('unconfirmed');
      await expect(page.locator('.db-list .lead')).toHaveCount(1);
      await expect(page.locator('.db-list .lead')).toContainText('Contact not confirmed');
      await expect(page.locator('.counts')).toContainText('101 open invoices');
      expect((await ledger(page)).reads).toHaveLength(1);
    });

    test('a faulted and a capped debtor say what is missing; nothing reads as a clean zero', async ({ page }) => {
      await open(page);
      await page.locator('.db-list .lead', { hasText: 'Debtor 004' }).first().click();
      const card = page.locator('.db-card');
      await expect(card.locator('.badge.bad')).toHaveText('GHL texts could not be read');
      await expect(card.locator('.cardhead .db-alert')).toContainText('ghl_cache: permission denied');
      await expect(card.locator('[data-cd-limits] li.is-bad')).toContainText('Stored GHL texts could not be read (owner CIO; fix: Retry the read');
      if (vp.name === 'phone') await card.getByRole('button', { name: 'All debtors' }).click();
      await page.locator('.db-list .lead', { hasText: 'Debtor 002' }).first().click();
      await expect(card.locator('[data-cd-limits]')).toContainText('only the newest 10 per job were read');
      if (vp.name === 'phone') await card.getByRole('button', { name: 'All debtors' }).click();
      await page.locator('.db-list .lead', { hasText: 'Debtor 006' }).first().click();
      await expect(card.locator('[data-cd-limits]')).toContainText('Captured facts could not be read for this timeline.');
      await expect(card.locator('[data-tl="facts"] .count')).toHaveCount(0);
      if (vp.name === 'phone') await card.getByRole('button', { name: 'All debtors' }).click();
      await page.locator('.db-list .lead', { hasText: 'Debtor 008' }).first().click();
      await expect(card.locator('.badge.bad')).toHaveText('GHL texts capture stale');
      await expect(card.locator('[data-cd-limits]')).toContainText('Stored GHL texts are stale: last captured 30 hours before this read, stale after 6h (owner CIO; fix: CIO: run the GHL message reconcile for the stale contact(s)).');
      expect((await ledger(page)).reads).toHaveLength(1);
    });

    test('an undeployed read shows one not-connected line; an unreadable book says so', async ({ page }) => {
      const requests = await open(page, '?mode=unknown');
      await expect(page.locator('[data-cd-state="not-connected"]')).toHaveText('The debtor work list is not connected yet: the server does not have the debt_worklist read. No debts are shown, and this is not a zero balance.');
      await expect(page.locator('.counts')).toHaveCount(0);
      await expect(page.locator('.lead')).toHaveCount(0);
      expect(onlyStatic(requests)).toEqual([]);
      await page.goto(PAGE + '?mode=fail');
      await expect(page.locator('[data-cd-state="failed"]')).toContainText('could not be read (timeout)');
    });

    if (vp.name === 'phone') {
      test('phone: the list, or the chosen debtor with Back, and no read on either', async ({ page }) => {
        await open(page);
        const list = page.locator('.db-list');
        await expect(list).toBeVisible();
        await page.locator('.db-list .lead', { hasText: 'Debtor 001' }).first().click();
        await expect(list).toBeHidden();
        await expect(page.locator('.db-card .cardhead h2')).toBeInViewport();
        await page.getByRole('button', { name: 'All debtors' }).click();
        await expect(list).toBeVisible();
        await expect(page.locator('.db-card')).toBeHidden();
        await expect(page.locator('.lead', { hasText: 'Debtor 001' })).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        expect((await ledger(page)).reads).toHaveLength(1);
      });
    }
  });
}

// The real page: ops.html hosts the screen, loads its module and stylesheet
// with a fresh cache-bust, and the Financials tab makes the one read.
test('ops.html hosts Clear Debt, loads it fresh, and the tab makes one read', async ({ page }) => {
  const assets = {};
  page.on('request', (r) => {
    let u;
    try { u = new URL(r.url()); } catch { return; }
    const m = u.pathname.match(/\/modules\/ops-clear-debt-v2\.(js|css)$/);
    if (m) assets[m[1]] = u.searchParams.get('v');
  });
  await page.goto('/ops.html');
  await expect(page.locator('#swAuthGate')).toBeVisible();
  await page.waitForFunction(() => typeof window.loadClearDebt === 'function' && Boolean(window.ClearDebt));
  expect(assets.js, 'clear debt js must load').toBeTruthy();
  expect(assets.css, 'clear debt css must load').toBeTruthy();
  expect(assets.js).not.toBe('1');
  await expect(page.locator('#subCleardebt > #clearDebtRoot')).toHaveCount(1);
  await page.addScriptTag({ url: '/tests/fixtures/clear-debt/worklist.js' });
  await page.evaluate(() => {
    window.fakeReads = [];
    window.fakeWrites = [];
    window.opsFetch = async (action, params) => { window.fakeReads.push({ action, params }); return makeClearDebtWorklist(); };
    window.opsPost = async (action, body) => { window.fakeWrites.push({ action, body }); throw new Error('writes are not allowed'); };
    showSubTab('cleardebt');
  });
  await expect(page.locator('#clearDebtRoot .counts')).toContainText('101 open invoices');
  await expect(page.locator('#clearDebtRoot .db-list .lead')).toHaveCount(78);
  const ledger = await page.evaluate(() => ({ reads: window.fakeReads, writes: window.fakeWrites }));
  expect(ledger.reads).toEqual([{ action: 'debt_worklist', params: { timeline: 'recent' } }]);
  expect(ledger.writes).toEqual([]);
});
