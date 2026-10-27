const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Scope Engine T42: "Scope a job" in the user menu. Office roles only.
// SCOPER_LINK_ENABLED ships switched on (rollout, 27 Oct 2026).

async function openMenu(page) {
  await page.locator('#headerUser').click();
  await expect(page.locator('#userMenu')).toBeVisible();
}

test('the office link ships switched on', async () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'trade.html'), 'utf8');
  expect(html).toContain('var SCOPER_LINK_ENABLED = true;');
});

test.describe('Scope a job link, office', () => {
  test.use({ persona: 'allocator' });

  test('office staff see it and it opens the scoper', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await openMenu(page);
    const link = page.locator('#userMenuScoper');
    await expect(link).toBeVisible();
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    expect(new URL(popup.url()).pathname).toMatch(/\/scopers\/practice\/$/);
    await popup.close();
  });
});

test.describe('Scope a job link, crew', () => {
  test.use({ persona: 'installer' });

  test('a trade does not see it', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await openMenu(page);
    await expect(page.locator('#userMenuScoper')).toBeHidden();
  });
});
