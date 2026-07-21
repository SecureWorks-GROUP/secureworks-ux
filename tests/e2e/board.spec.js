const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'allocator' });

test.describe('Trade App make-safe board', () => {
  test.beforeEach(async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await page.locator('#navBoard').click();
    await expect(page.locator('#viewBoard')).toHaveClass(/active/);
  });

  test('loads all make-safe columns and renders fixture job cards', async ({ appPage: page }) => {
    await expect(page.locator('#boardContent .tjb-colhead b')).toHaveText([
      'New',
      'Allocated',
      'Complete',
      'Archive'
    ]);
    await expect(page.locator('#boardContent .jc')).toHaveCount(2);
    const newCard = page.locator('#boardContent .jc').filter({ hasText: 'E2E-MS-001' });
    await expect(newCard).toBeVisible();
    await expect(newCard).toContainText('Nobody allocated');
  });

  test('opens a make-safe job detail from its board card', async ({ appPage: page }) => {
    await page.locator('#boardContent .jc').filter({ hasText: 'E2E-MS-001' }).click();

    await expect(page.locator('#msv5DetailOverlay')).toHaveClass(/active/);
    await expect(page.locator('#msv5DetailContent')).toContainText('E2E-MS-001');
    await expect(page.locator('#msv5DetailContent')).toContainText('Test Client');
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  });

  test('opens the allocation sheet for an allocator role without writing', async ({ appPage: page }) => {
    const card = page.locator('#boardContent .jc').filter({ hasText: 'E2E-MS-001' });
    await card.getByRole('button', { name: 'Allocate' }).click();

    await expect(page.locator('#allocOverlay')).toHaveClass(/active/);
    await expect(page.locator('#allocHead')).toContainText('New allocation');
    await expect(page.locator('#allocRoster .alloc-crew')).toHaveCount(2);
    await expect(page.locator('#allocConfirmBtn')).toBeEnabled();
  });
});
