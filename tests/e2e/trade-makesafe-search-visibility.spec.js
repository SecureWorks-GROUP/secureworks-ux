const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const HIDDEN_REF = 'E2E-MS-HIDDEN-001';

const searchRequests = (feedRequests) => feedRequests
  .filter((entry) => entry.action === 'search_all_jobs');

async function expectHiddenMakesafeOpened(page) {
  await expect(page.locator('#viewReport')).toHaveClass(/active/);
  await expect(page.locator('#makesafeWorkOrderDirect')).toContainText(HIDDEN_REF);
}

test.describe('Trade MakeSafe search visibility', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-makesafe-search' });

  test('Today stays assignment-scoped while All finds and opens an unallocated make-safe', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="myJobs"]').click();
    await expect(page.locator('#jobSearchBar')).toBeVisible();

    await page.locator('#jobSearchInput').fill(HIDDEN_REF);
    await page.waitForTimeout(400);
    await expect(page.locator('#myJobsList')).not.toContainText(HIDDEN_REF);
    expect(searchRequests(feedRequests)).toHaveLength(0);

    await page.locator('.filter-chip[data-filter="all"]').click();
    const result = page.locator('#myJobsList .jcsr').filter({ hasText: HIDDEN_REF });
    await expect(result).toHaveCount(1);
    await result.click();
    await expectHiddenMakesafeOpened(page);

    const requests = searchRequests(feedRequests);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(new URL(requests[0].url).searchParams.get('q')).toBe(HIDDEN_REF.toLowerCase());
  });

  test('MakeSafe Board database search finds and opens a job outside its allocated feed', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('#navBoard').click();
    await expect(page.locator('#viewBoard')).toHaveClass(/active/);

    await page.locator('#boardSearchInput').fill(HIDDEN_REF);
    const result = page.locator('[data-makesafe-database-search] .jcsr').filter({ hasText: HIDDEN_REF });
    await expect(result).toHaveCount(1);
    await expect(page.locator('#boardSearchCount')).toContainText('0 board matches');
    await result.click();
    await expectHiddenMakesafeOpened(page);

    const requests = searchRequests(feedRequests);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(new URL(requests[0].url).searchParams.get('q')).toBe(HIDDEN_REF.toLowerCase());
  });
});
