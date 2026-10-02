// Invoice job search: a trade must find the job they worked (2026-09-30).
//
// A trade trying to invoice typed "SWF - 26168" (a completed fencing job) and
// "40398" (a make-safe's builder claim ref) into the weekly invoice's
// "+ Add job" search and was told "No active jobs match." ops-api matches the
// query as one substring of job_number, so the spaced number matched nothing,
// and the copy said "active", so the trade read it as "completed jobs are not
// allowed". A failed search read showed the same line. These specs pin:
//  - the number is found however it is spaced or dashed, completed included;
//  - a make-safe is found by its claim ref (ops-api's external_ref match);
//  - an empty result says what to do, and a failed read says it failed.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({
  persona: 'installer',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  timezoneId: 'Australia/Perth',
  feedScenario: 'trade-invoice-multi-week'
});

async function openDaySearch(page) {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.locator('#invoiceWeekContinue').click();
  await page.locator('button[onclick="jcOpenJobSearch(1)"]').click();
  return page.locator('#jcSearchInput_1');
}

function searchQueries(feedRequests) {
  return feedRequests
    .filter((entry) => entry.action === 'search_all_jobs')
    .map((entry) => new URL(entry.url).searchParams.get('q'));
}

test.describe('weekly invoice job search', () => {
  for (const typed of ['SWF - 26168', 'SWF-26168', 'swf 26168', 'SWF26168', 'SWF – 26168', '26168']) {
    test(`"${typed}" finds the completed job and adds it`, async ({ appPage: page, feedRequests }) => {
      const input = await openDaySearch(page);
      await input.fill(typed);
      const hit = page.locator('.jc-job-search-hit').filter({ hasText: 'SWF-26168' });
      await expect(hit).toBeVisible();
      expect(searchQueries(feedRequests)).toContain(typed === '26168' ? '26168' : 'SWF-26168');
      await hit.click();
      await expect(page.locator('.jc-card').filter({ hasText: 'SWF-26168' })).toBeVisible();
    });
  }

  test('a make-safe is found by its claim ref', async ({ appPage: page }) => {
    const input = await openDaySearch(page);
    await input.fill('40398');
    const hit = page.locator('.jc-job-search-hit').filter({ hasText: 'SWMS-261290' });
    await expect(hit).toBeVisible();
    await expect(hit).toContainText('Ref: MLB-40398');
  });

  test('no match says what to do, never "active"', async ({ appPage: page }) => {
    const input = await openDaySearch(page);
    await input.fill('SWF-99999');
    const empty = page.locator('[data-jc-search-empty]');
    await expect(empty).toContainText('No jobs match. Completed jobs show here too.');
    await expect(empty).toContainText('ask the office to add you to it');
    await expect(page.locator('#jcSearchResults_1')).not.toContainText('active');
  });

  test('a failed search says it failed and can be retried', async ({ appPage: page }) => {
    let fail = true;
    const input = await openDaySearch(page);
    await page.route((url) => url.pathname.endsWith('/ops-api') && url.searchParams.get('action') === 'search_all_jobs', async (route) => {
      if (!fail) return route.fallback();
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'search unavailable' }) });
    });
    await input.fill('SWF-26168');
    const error = page.locator('[data-jc-search-error]');
    await expect(error).toContainText('Search did not load');
    await expect(page.locator('[data-jc-search-empty]')).toHaveCount(0);
    fail = false;
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.jc-job-search-hit').filter({ hasText: 'SWF-26168' })).toBeVisible();
  });
});
