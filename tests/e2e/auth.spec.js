const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.describe('Trade App authentication', () => {
  test('sign-in renders and bad credentials are rejected without a logout loop', async ({ appPage: page }) => {
    // trade.html signs in through its NATIVE login view — the ops auth-gate
    // was deliberately removed from this page (PR #260: it hid crew login).
    await expect(page.getByRole('heading', { name: 'Trade Login' })).toBeVisible();
    await expect(page.locator('#loginEmail')).toBeVisible();
    await expect(page.locator('#loginPassword')).toBeVisible();

    await page.locator('#loginEmail').fill('unknown@example.test');
    await page.locator('#loginPassword').fill('definitely-wrong');
    await page.locator('#btnLogin').click();

    await expect(page.locator('#loginError')).toContainText('Wrong email or password');
    await expect(page.locator('#viewLogin')).toBeVisible();
    await expect(page.locator('#bottomNav')).toBeHidden();
    await expect(page.locator('#btnLogin')).toBeEnabled();

    await page.waitForTimeout(500);
    await expect(page.locator('#viewLogin')).toBeVisible();
  });

  test.describe('calendar feed auth regression', () => {
    test.use({ persona: 'installer', feedScenario: 'access-denied' });

    test('a rejected read-only feed keeps the signed-in user out of the logout loop', async ({ appPage: page }) => {
      await signIn(page, PERSONAS.installer);

      await expect(page.locator('#ncalRoot [data-feed-failure="access"]')).toContainText('No trade access for this account');
      await expect(page.locator('#viewLogin')).toBeHidden();
      await expect(page.locator('#bottomNav')).toBeVisible();
      await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
      // _forceLogout repaints the login view on a 1500ms timeout — wait past it
      // so a relapsed logout loop cannot hide behind the delay.
      await page.waitForTimeout(1600);
      await expect(page.locator('#viewLogin')).toBeHidden();
      await expect(page.locator('#bottomNav')).toBeVisible();
      await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
    });
  });
});
