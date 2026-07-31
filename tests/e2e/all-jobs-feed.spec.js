const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Captain ruling (2026-07-31), server contract in secureworks-backend
// `docs/trade-all-means-all-v1.md`: "when they go to all, all needs to mean all".
// ops-api now returns the whole company job feed for an EMPTY query and pages it
// with next_offset. These specs guard the client half:
//   1. a company viewer/manager gets the complete feed, paged in on scroll, and
//      the pager stops cleanly at the end;
//   2. an installer's All tab is unchanged — it never asks for the company feed;
//   3. the SERVER is the authority: a response whose lens is not 'company' is
//      never painted as "all jobs";
//   4. typed All-tab search keeps its existing behaviour and copy.

const searchAllJobsRequests = (feedRequests) => feedRequests
  .filter((entry) => entry.action === 'search_all_jobs')
  .map((entry) => new URL(entry.url).searchParams);

async function openAllTab(page) {
  await page.locator('[data-view="myJobs"]').click();
  await expect(page.locator('#jobSearchBar')).toBeVisible();
  await page.locator('.filter-chip[data-filter="all"]').click();
}

async function scrollToBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

test.describe('All tab — whole-company feed (company viewer/manager)', () => {
  test.use({ persona: 'allocator', feedScenario: 'all-jobs-feed' });

  test('empty-query All pages the complete feed in on scroll and stops at the end', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.allocator);
    await openAllTab(page);

    // Page 1: the count is honest about the whole feed, not just the rows shown.
    await expect(page.locator('#myJobsList')).toContainText('All jobs · whole company');
    await expect(page.locator('#myJobsList')).toContainText('Showing 30 of 90 jobs');
    await expect(page.locator('#myJobsList .jcsr')).toHaveCount(30);
    await expect(page.locator('#globalJobPager')).toContainText('Keep scrolling to load more jobs');

    // Page 2 + 3 arrive by scrolling, not by a button press.
    await scrollToBottom(page);
    await expect(page.locator('#myJobsList .jcsr')).toHaveCount(60);
    await scrollToBottom(page);
    await expect(page.locator('#myJobsList .jcsr')).toHaveCount(90);

    // Stops cleanly: end marker, no further request, every job rendered once.
    await expect(page.locator('#globalJobPager')).toContainText('End of the list — all 90 jobs loaded.');
    await expect(page.locator('#myJobsList')).toContainText('90 jobs — showing all 90');
    await expect(page.locator('#myJobsList .jcsr').filter({ hasText: 'SWALL-1000' })).toHaveCount(1);
    await expect(page.locator('#myJobsList .jcsr').filter({ hasText: 'SWALL-1089' })).toHaveCount(1);

    await scrollToBottom(page);
    const requests = searchAllJobsRequests(feedRequests);
    expect(requests.map((params) => params.get('offset'))).toEqual([null, '30', '60']);
    expect(requests.every((params) => params.get('q') === null)).toBe(true);
  });

  test('typed All-tab search is unchanged — its own copy, its own results', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await openAllTab(page);
    await expect(page.locator('#myJobsList')).toContainText('All jobs · whole company');

    await page.locator('#jobSearchInput').fill('SWALL-1005');
    await expect(page.locator('#myJobsList')).toContainText('All database · all jobs');
    await expect(page.locator('#myJobsList')).toContainText('1 match — showing all 1');
    await expect(page.locator('#myJobsList')).not.toContainText('All jobs · whole company');

    // Clearing the box returns to the full company feed.
    await page.locator('#jobSearchInput').fill('');
    await expect(page.locator('#myJobsList')).toContainText('Showing 30 of 90 jobs');
  });
});

test.describe('All tab — the company lens is the server\'s grant', () => {
  test.use({ persona: 'allocator', feedScenario: 'all-jobs-feed-denied' });

  test('a non-company lens response is never painted as the whole-company feed', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await openAllTab(page);

    await expect(page.locator('#myJobsList')).toContainText('The whole-company job list is not available for this account.');
    await expect(page.locator('#myJobsList .jcsr')).toHaveCount(0);
    await expect(page.locator('#globalJobPager')).toHaveCount(0);
  });
});

test.describe('All tab — installer views unchanged', () => {
  test.use({ persona: 'installer', feedScenario: 'all-jobs-feed' });

  test('an installer never requests the company feed on an empty All tab', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await openAllTab(page);

    // Their own assignment still renders; the company feed does not appear.
    await expect(page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' })).toHaveCount(1);
    await expect(page.locator('#myJobsList')).not.toContainText('All jobs · whole company');
    await expect(page.locator('#globalJobPager')).toHaveCount(0);
    await scrollToBottom(page);
    expect(searchAllJobsRequests(feedRequests)).toHaveLength(0);

    // Typed search still reaches the job database exactly as it did before.
    await page.locator('#jobSearchInput').fill('SWALL-1005');
    await expect(page.locator('#myJobsList')).toContainText('All database · all jobs');
    await expect(page.locator('#myJobsList')).toContainText('1 match — showing all 1');
  });
});
