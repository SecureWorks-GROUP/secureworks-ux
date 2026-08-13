const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.describe('Trade App authentication', () => {
  // trade.html ships its OWN Trade Login (PR 260) and must NOT fall back to the
  // ops auth-gate overlay. This is the logged-out smoke: the trade fields are
  // present, the ops gate is absent, and a bad password is rejected in place
  // without kicking the user into a force-logout loop.
  test('logged-out trade shows Trade Login (not ops gate) and rejects bad credentials without a logout loop', async ({ appPage: page }) => {
    await expect(page.getByRole('heading', { name: 'Trade Login' })).toBeVisible();
    await expect(page.locator('#loginEmail')).toBeVisible();
    await expect(page.locator('#loginPassword')).toBeVisible();
    await expect(page.locator('#btnLogin')).toBeVisible();
    // The ops auth-gate must never appear on the trade surface.
    await expect(page.locator('#swAuthGate')).toHaveCount(0);

    await page.locator('#loginEmail').fill('unknown@example.test');
    await page.locator('#loginPassword').fill('definitely-wrong');
    await page.locator('#btnLogin').click();

    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#viewLogin')).toHaveClass(/active/);
    await expect(page.locator('#bottomNav')).toBeHidden();
    await expect(page.locator('#btnLogin')).toBeEnabled();

    await page.waitForTimeout(500);
    await expect(page.locator('#viewLogin')).toHaveClass(/active/);
    await expect(page.locator('#swAuthGate')).toHaveCount(0);
  });

  // A stubbed crew signs in and STAYS in — the make-safe read comes back fine,
  // so nothing trips the session-expiry force-logout.
  test('stubbed crew can sign in and stay without a force-logout loop', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);

    await expect(page.locator('#viewLogin')).not.toHaveClass(/active/);
    await expect(page.locator('#bottomNav')).toBeVisible();
    await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
    await expect(page.locator('#swAuthGate')).toHaveCount(0);

    await page.waitForTimeout(500);
    await expect(page.locator('#viewLogin')).not.toHaveClass(/active/);
    await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
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
