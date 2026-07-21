const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'installer' });

test('My Jobs renders an installer assignment and opens its job detail', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="myJobs"]').click();

  await expect(page.locator('#viewMyJobs')).toHaveClass(/active/);
  await expect(page.locator('#myJobsList')).toContainText('Today Route (1)');
  const jobCard = page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' });
  await expect(jobCard).toContainText('Fixture Homeowner');
  await expect(page.locator('#navBoard')).toBeVisible();

  await jobCard.click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
  await expect(page.locator('#jobDetailContent')).toContainText('E2E-JOB-001');
  await expect(page.locator('#jobDetailContent')).toContainText('Fixture Homeowner');
  await expect(page.getByRole('button', { name: /Back to Jobs/ })).toBeVisible();
});
