const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.describe('Trade App authentication', () => {
  test('sign-in renders and bad credentials are rejected without a logout loop', async ({ appPage: page }) => {
    await expect(page.getByText('Sign in to continue', { exact: true })).toBeVisible();
    await expect(page.locator('#swAuthEmail')).toBeVisible();
    await expect(page.locator('#swAuthPassword')).toBeVisible();

    await page.locator('#swAuthEmail').fill('unknown@example.test');
    await page.locator('#swAuthPassword').fill('definitely-wrong');
    await page.locator('#swAuthSubmit').click();

    await expect(page.locator('#swAuthError')).toHaveText('Invalid login credentials');
    await expect(page.locator('#swAuthGate')).toBeVisible();
    await expect(page.locator('#bottomNav')).toBeHidden();
    await expect(page.locator('#swAuthSubmit')).toBeEnabled();

    await page.waitForTimeout(500);
    await expect(page.locator('#swAuthGate')).toBeVisible();
  });

  test.describe('calendar feed auth regression', () => {
    test.use({ persona: 'installer', feedScenario: 'access-denied' });

    test('a rejected read-only feed keeps the signed-in user out of the logout loop', async ({ appPage: page }) => {
      await signIn(page, PERSONAS.installer);

      await expect(page.locator('#ncalRoot [data-feed-failure="access"]')).toContainText('No trade access for this account');
      await expect(page.locator('#swAuthGate')).toHaveCount(0);
      await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
      await page.waitForTimeout(500);
      await expect(page.locator('#swAuthGate')).toHaveCount(0);
    });
  });
});
