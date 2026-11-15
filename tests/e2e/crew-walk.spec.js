// SecureWorks Crew: every screen, as each kind of person, at 360, 390 and 430 wide.
// Each page must load with no script error and nothing wider than the screen.
const { test, expect } = require('@playwright/test');
const { crewUrl } = require('../helpers/crew');

const IPHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const SMALL = { viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true };
const LARGE = { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true };
const COMMON = ['#/today', '#/schedule', '#/schedule/month', '#/schedule/availability', '#/jobs', '#/pay', '#/profile', '#/profile/details'];
const WORK = [
  '#/job/j-joon', '#/job/j-joon?tab=scope', '#/job/j-joon?tab=photos', '#/job/j-joon?tab=notes', '#/job/j-joon?tab=files', '#/job/j-kinr',
  '#/pay/week/2026-11-09', '#/pay/week/2026-11-09/invoice', '#/pay/invoices', '#/pay/invoice/inv-last', '#/pay/receipt', '#/pay/receipts', '#/pay/group/j-dunc',
  '#/job/j-joon/finish', '#/job/j-morl/report', '#/job/j-hill/report', '#/job/j-hill/roof', '#/job/j-wemb/service'
];
const PEOPLE = {
  crew: [...COMMON, ...WORK],
  lead: [...COMMON, ...WORK, '#/schedule/everyone', '#/jobs/board', '#/pay/work-orders', '#/pay/charges'],
  office: [...COMMON, '#/schedule/everyone', '#/jobs/board', '#/job/j-hill', '#/job/j-joon'],
  new: [...COMMON, '#/pay/week/2026-11-09', '#/pay/invoices', '#/pay/receipts', '#/job/j-joon']
};

async function walk(page, persona, routes) {
  const problems = [];
  let errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e && e.message)));
  for (const hash of routes) {
    errors = [];
    await page.goto(crewUrl(hash, persona));
    await page.reload();
    await expect(page.locator('main.page').first()).toBeVisible();
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => {
      const wide = [];
      if (document.documentElement.scrollWidth > window.innerWidth + 1) wide.push('document');
      document.querySelectorAll('main.page').forEach((p) => { if (p.scrollWidth > p.clientWidth + 1) wide.push('page'); });
      return { wide, text: (document.querySelector('main.page') || document.body).innerText.slice(0, 400) };
    });
    if (errors.length) problems.push(`${persona} ${hash}: ${errors[0]}`);
    if (state.wide.length) problems.push(`${persona} ${hash}: wider than the screen (${state.wide.join(', ')})`);
    if (/Could not open that|undefined|NaN|\[object/.test(state.text)) problems.push(`${persona} ${hash}: broken text on screen`);
  }
  expect(problems).toEqual([]);
}

test.describe('standard iPhone', () => {
  test.use(IPHONE);
  for (const [persona, routes] of Object.entries(PEOPLE)) {
    test(`every screen loads cleanly for ${persona}`, async ({ page }) => {
      test.setTimeout(150_000);
      await walk(page, persona, routes);
    });
  }
});

for (const [name, size] of [['narrow phone, 360 wide', SMALL], ['large iPhone, 430 wide', LARGE]]) {
  test.describe(name, () => {
    test.use(size);
    test('every screen fits for a crew member and a manager', async ({ page }) => {
      test.setTimeout(240_000);
      await walk(page, 'crew', PEOPLE.crew);
      await walk(page, 'lead', ['#/schedule/everyone', '#/jobs/board', '#/pay/work-orders']);
    });
  });
}

test.describe('before the server switches are on', () => {
  test.use(IPHONE);
  test('a job the trade is not on stays shut, in words, with no error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    await page.goto(`/crew/?demo=crew&switches=off&now=${encodeURIComponent('2026-11-13T09:00:00+08:00')}#/jobs`);
    await page.getByLabel('Search every job').fill('kinross');
    await expect(page.getByText('No job found')).toBeVisible();
    // Their own jobs still open fully.
    await page.getByLabel('Search every job').fill('joondalup');
    await page.locator('.item', { hasText: 'Joondalup' }).first().click();
    await page.getByRole('tab', { name: 'Scope' }).click();
    await expect(page.getByText('Strip old fence, rear and left')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
