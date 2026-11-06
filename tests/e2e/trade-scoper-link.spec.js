const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// The standalone scoper menu entry is retired. Job-specific live links remain.
for (const persona of ['allocator', 'installer']) {
  test.describe(`scoper menu retirement, ${persona}`, () => {
    test.use({ persona });

    test('the user menu has no standalone scoper entry', async ({ appPage: page }) => {
      await signIn(page, PERSONAS[persona]);
      await page.locator('#headerUser').click();
      await expect(page.locator('#userMenu')).toBeVisible();
      await expect(page.locator('#userMenuScoper')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Scope a job', exact: true })).toHaveCount(0);
    });
  });
}
