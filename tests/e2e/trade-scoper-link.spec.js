const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Scope Engine T42: "Scope a job" in the user menu. Office roles only, and only
// once SCOPER_LINK_ENABLED is switched on. The switch-on cases serve trade.html
// with the switch flipped, so the shipped default stays off.

async function switchOn(page) {
  await page.route('**/trade.html*', async route => {
    const res = await route.fetch();
    const body = (await res.text()).replace('var SCOPER_LINK_ENABLED = false;', 'var SCOPER_LINK_ENABLED = true;');
    await route.fulfill({ response: res, body });
  });
}

async function openMenu(page) {
  await page.locator('#headerUser').click();
  await expect(page.locator('#userMenu')).toBeVisible();
}

test.describe('Scope a job link, switch off (as shipped)', () => {
  test.use({ persona: 'allocator' });

  test('office staff do not see it', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await openMenu(page);
    await expect(page.locator('#userMenuScoper')).toBeHidden();
  });
});

test.describe('Scope a job link, switch on, office', () => {
  test.use({ persona: 'allocator' });

  test('office staff see it and it opens the scoper', async ({ appPage: page }) => {
    await switchOn(page);
    await page.reload();
    await signIn(page, PERSONAS.allocator);
    await openMenu(page);
    const link = page.locator('#userMenuScoper');
    await expect(link).toBeVisible();
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    expect(new URL(popup.url()).pathname).toMatch(/\/scopers\/practice\/$/);
    await popup.close();
  });
});

test.describe('Scope a job link, switch on, crew', () => {
  test.use({ persona: 'installer' });

  test('a trade does not see it', async ({ appPage: page }) => {
    await switchOn(page);
    await page.reload();
    await signIn(page, PERSONAS.installer);
    await openMenu(page);
    await expect(page.locator('#userMenuScoper')).toBeHidden();
  });
});
