// SecureWorks Crew: every screen, as each kind of person, at iPhone sizes.
// Each page must load with no script error and nothing wider than the screen.
const { test, expect } = require('@playwright/test');
const { crewUrl } = require('../helpers/crew');

const IPHONE = { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true };
const SMALL = { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true };
const COMMON = ['#/today', '#/jobs', '#/pay', '#/me', '#/me/details', '#/me/availability'];
const WORK = [
  '#/job/j-joon', '#/job/j-joon?tab=photos', '#/job/j-joon?tab=notes', '#/job/j-joon?tab=files', '#/job/j-joon?tab=crew', '#/job/j-kinr',
  '#/pay/week/2026-11-09', '#/pay/invoice/inv-last', '#/pay/money', '#/pay/receipt', '#/pay/receipts', '#/pay/group/j-dunc',
  '#/job/j-joon/finish', '#/job/j-morl/report', '#/job/j-hill/report', '#/job/j-hill/roof', '#/job/j-wemb/service'
];
const PEOPLE = {
  crew: [...COMMON, ...WORK],
  lead: [...COMMON, ...WORK, '#/team', '#/board', '#/pay/work-orders', '#/pay/charges'],
  office: [...COMMON, '#/team', '#/board', '#/job/j-hill', '#/job/j-joon'],
  new: [...COMMON, '#/pay/week/2026-11-09', '#/pay/money', '#/pay/receipts', '#/job/j-joon']
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

test.describe('small iPhone', () => {
  test.use(SMALL);
  test('every screen fits for a crew member', async ({ page }) => {
    test.setTimeout(150_000);
    await walk(page, 'crew', PEOPLE.crew);
  });
});

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
    await page.getByRole('button', { name: /Joondalup/ }).click();
    await expect(page.getByText('Strip old fence, rear and left')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
