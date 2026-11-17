const { test, expect } = require('@playwright/test');
const { installSupabaseAuthStub } = require('../helpers/auth');

async function openBoard(page) {
  // All external traffic stays offline, including auth and background modules.
  await page.route('https://**/*', route => route.abort());
  await installSupabaseAuthStub(page, { users: {}, profileEndpoint: 'https://offline.invalid/profile' });
  await page.goto('/ops.html');
  await page.evaluate(() => {
    _opsAppStarted = true;
    _pipelineTab = 'fencing';
    _jobView = 'kanban';
    window.boardReads = 0;
    window.stampReads = 0;
    window.nextStamp = 'revision-1';
    window.stampFails = false;
    window.opsFetch = async action => {
      if (action === 'pipeline_stamp') {
        stampReads++;
        if (stampFails) throw new Error('Offline stamp failure');
        return { stamp: nextStamp };
      }
      if (action === 'pipeline') {
        boardReads++;
        return { columns: {} };
      }
      throw new Error('Unexpected read: ' + action);
    };
  });
}

const counts = page => page.evaluate(() => ({ board: boardReads, stamp: stampReads }));

test('unchanged stamps skip the board until 30 minutes; changes and person loads refresh', async ({ page }) => {
  await openBoard(page);
  await page.clock.install();
  await page.evaluate(async () => { await loadJobs({ background: true }); await loadJobs({ background: true }); });
  expect(await counts(page)).toEqual({ board: 1, stamp: 2 });
  await page.evaluate(async () => { nextStamp = 'revision-2'; await loadJobs({ background: true }); });
  expect(await counts(page)).toEqual({ board: 2, stamp: 3 });
  await page.clock.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
  await page.evaluate(() => loadJobs({ background: true }));
  expect(await counts(page)).toEqual({ board: 3, stamp: 4 });
  await page.evaluate(() => loadJobs());
  expect(await counts(page)).toEqual({ board: 4, stamp: 5 });
  await page.evaluate(() => loadJobs({ background: true }));
  expect(await counts(page)).toEqual({ board: 4, stamp: 6 });
});

test('a hidden page reads nothing; returning to the open Jobs tab checks once', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await loadJobs({ background: true });
  });
  expect(await counts(page)).toEqual({ board: 0, stamp: 0 });
  await page.evaluate(() => {
    localStorage.setItem('sw_ops_tab', 'jobs');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => counts(page)).toEqual({ board: 1, stamp: 1 });
  await page.evaluate(() => {
    localStorage.setItem('sw_ops_tab', 'calendar');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await counts(page)).toEqual({ board: 1, stamp: 1 });
});

test('a failed or null stamp never suppresses the board read', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => loadJobs({ background: true }));
  await page.evaluate(async () => { stampFails = true; await loadJobs({ background: true }); });
  expect(await counts(page)).toEqual({ board: 2, stamp: 2 });
  await page.evaluate(async () => { stampFails = false; nextStamp = null; await loadJobs({ background: true }); await loadJobs({ background: true }); });
  expect(await counts(page)).toEqual({ board: 4, stamp: 4 });
});

for (const tab of ['fencing', 'makesafes']) {
  test(`a person load checks the stamp before the ${tab} board and detects an in-flight change`, async ({ page }) => {
    await openBoard(page);
    await page.evaluate(tab => {
      _pipelineTab = tab;
      // Exercise the real loader, keeping the board data and paint offline.
      renderJobs = () => {};
      loadMakesafeBoardIntakeDrafts = loadMakesafeBoardStory =
        loadMakesafeBoardReviewAffordances = loadMakesafeBoardPackChips = () => {};
      window.readOrder = [];
      window.opsFetch = async action => {
        readOrder.push(action);
        if (action === 'pipeline_stamp') {
          stampReads++;
          await new Promise(resolve => { window.finishStamp = resolve; });
          return { stamp: nextStamp };
        }
        if (action === 'pipeline') return readBoard();
        throw new Error('Unexpected read: ' + action);
      };
      window.readBoard = async () => {
        boardReads++;
        // The board snapshot precedes a change committed while it is in flight.
        nextStamp = 'revision-2';
        return { columns: {} };
      };
      fetchMakesafeBoardData = () => { readOrder.push('makesafe_board'); return readBoard(); };
      window.personLoad = loadJobs();
    }, tab);
    expect(await counts(page)).toEqual({ board: 0, stamp: 1 });
    await page.evaluate(async () => { finishStamp(); await personLoad; });
    expect(await page.evaluate(() => readOrder)).toEqual(['pipeline_stamp', tab === 'makesafes' ? 'makesafe_board' : 'pipeline']);
    expect(await page.evaluate(() => _pipelineStamp)).toBe('revision-1');
    await page.evaluate(() => { window.refreshLoad = loadJobs({ background: true }); });
    await page.evaluate(async () => { finishStamp(); await refreshLoad; });
    expect(await counts(page)).toEqual({ board: 2, stamp: 2 });
    expect(await page.evaluate(() => _pipelineStamp)).toBe('revision-2');
  });
}

test('a failed person stamp clears the cached stamp so the next refresh reads the board', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => loadJobs());
  await page.evaluate(async () => { stampFails = true; await loadJobs(); });
  expect(await page.evaluate(() => _pipelineStamp)).toBeNull();
  await page.evaluate(async () => { stampFails = false; await loadJobs({ background: true }); });
  expect(await counts(page)).toEqual({ board: 3, stamp: 3 });
});
