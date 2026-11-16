const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

// Add job photos (job-photos.html, modules/job-photos.js): one job's photo
// upload from a link. The Trade app's own three upload calls and nothing else.

const JOB = '9de1d7b8-4aec-47d8-85bf-2c1ea72b6d53';
const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function detail(photoCount) {
  return {
    job: { id: JOB, job_number: 'SWMS-E2E-P1', site_address: '24 Fixture Way', site_suburb: 'West Swan', type: 'makesafe' },
    makesafe_details: { attendance_cycle_id: 'cycle-1' },
    media: Array.from({ length: photoCount }, (_, i) => ({ id: 'm' + i, type: 'photo', attendance_cycle_id: 'cycle-1', cycle_attribution: 'bound' }))
  };
}

async function openPage(page, { signedIn = true, search = '?jobId=' + JOB, photoCount = 3, failConfirmFor = [], detailStatus = 200 } = {}) {
  const calls = [];
  if (signedIn) {
    await installOpsSessionStub(page);
  } else {
    await page.addInitScript(() => {
      let session = null;
      window.supabase = {
        createClient() {
          return {
            auth: {
              async getSession() { return { data: { session }, error: null }; },
              async signInWithPassword({ email }) {
                if (email !== 'trade@example.test') return { data: {}, error: { message: 'Invalid login credentials' } };
                session = { access_token: 'e2e-token', user: { id: 'u1', email } };
                return { data: { session }, error: null };
              }
            }
          };
        }
      };
    });
  }
  // Nothing leaves the test: the library, ops-api and storage are all answered here.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:4173' : page.url()).origin || url.hostname === '127.0.0.1') {
      await route.fallback();
      return;
    }
    if (url.hostname === 'cdn.jsdelivr.net') {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return;
    }
    if (request.url().startsWith(OPS_API)) {
      const action = url.searchParams.get('action');
      const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
      calls.push({ method: request.method(), action, body, jobId: url.searchParams.get('jobId'), auth: request.headers().authorization });
      if (action === 'trade_job_detail') {
        if (detailStatus !== 200) {
          await route.fulfill({ status: detailStatus, contentType: 'application/json', body: JSON.stringify({ error: 'Not assigned to this job' }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(photoCount)) });
        return;
      }
      if (action === 'get_upload_url') {
        const n = calls.filter((c) => c.action === 'get_upload_url').length;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          uploadUrl: 'https://storage.example.invalid/upload/' + n, token: 'upload-token', publicUrl: 'https://storage.example.invalid/public/' + n + '.png', path: 'org/' + JOB + '/photos/' + n + '.png'
        }) });
        return;
      }
      if (action === 'confirm_upload') {
        const n = calls.filter((c) => c.action === 'confirm_upload').length;
        if (failConfirmFor.includes(n)) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'storage is down' }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'media-' + n }) });
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown action' }) });
      return;
    }
    if (url.hostname === 'storage.example.invalid') {
      calls.push({ method: request.method(), action: 'storage_put', auth: request.headers().authorization });
      await route.fulfill({ status: 200, body: '' });
      return;
    }
    await route.abort();
  });
  await page.goto('/job-photos.html' + search);
  return calls;
}

function files(n) {
  return Array.from({ length: n }, (_, i) => ({ name: 'IMG_' + (i + 1) + '.png', mimeType: 'image/png', buffer: PNG }));
}

test('signed in: the job is named, photos go up one at a time through the Trade app calls, and the count moves', async ({ page }) => {
  const calls = await openPage(page, { photoCount: 3 });
  await expect(page.locator('#jpJob')).toHaveText('SWMS-E2E-P1 · 24 Fixture Way, West Swan');
  await expect(page.locator('#jpCount')).toHaveText('3 photos on this visit. The report needs 5: 2 more.');
  await page.fill('#jpLabel', 'Cabinetry after removal');
  await page.setInputFiles('#jpInput', files(2));
  await expect(page.locator('#jpOutcome')).toHaveText('2 photos added.');
  await expect(page.locator('#jpCount')).toHaveText('5 photos on this visit. Enough for the report.');
  await expect(page.locator('.jp-thumb.done')).toHaveCount(2);
  expect(calls.map((c) => c.action)).toEqual([
    'trade_job_detail',
    'get_upload_url', 'storage_put', 'confirm_upload',
    'get_upload_url', 'storage_put', 'confirm_upload'
  ]);
  expect(calls[0]).toMatchObject({ method: 'GET', jobId: JOB, auth: 'Bearer e2e-ops-access-token' });
  expect(calls[1].body).toEqual({ jobId: JOB, fileName: 'IMG_1.png', contentType: 'image/png' });
  expect(calls[2].auth).toBe('Bearer upload-token');
  expect(calls[3].body).toEqual({
    jobId: JOB,
    publicUrl: 'https://storage.example.invalid/public/1.png',
    path: 'org/' + JOB + '/photos/1.png',
    label: 'Cabinetry after removal',
    phase: 'completion'
  });
  // The page files no report and calls nothing else.
  expect(calls.some((c) => /report|submit/.test(c.action))).toBe(false);
});

test('a photo that fails is named beside the ones that made it, and the rest still go', async ({ page }) => {
  await openPage(page, { photoCount: 0, failConfirmFor: [2] });
  await page.setInputFiles('#jpInput', files(3));
  await expect(page.locator('#jpOutcome')).toContainText('2 added, 1 did not go up. Pick the missing one again.');
  await expect(page.locator('#jpOutcome')).toContainText('storage is down');
  await expect(page.locator('.jp-thumb.done')).toHaveCount(2);
  await expect(page.locator('.jp-thumb.failed')).toHaveCount(1);
  await expect(page.locator('#jpCount')).toHaveText('2 photos on this visit. The report needs 5: 3 more.');
});

test('a link with no job id, or a job the person is not on, offers no upload', async ({ page }) => {
  let calls = await openPage(page, { search: '?jobId=SWMS-261710' });
  await expect(page.locator('#jpJob')).toHaveText('This link does not name a job. Ask for a new photo link.');
  await expect(page.locator('#jpUpload')).toBeHidden();
  expect(calls.length).toBe(0);

  await page.unroute('**/*');
  calls = await openPage(page, { detailStatus: 403 });
  await expect(page.locator('#jpJob')).toHaveText('Not assigned to this job');
  await expect(page.locator('#jpUpload')).toBeHidden();
});

test('not signed in: the Trade app sign-in is asked for first, then the job loads', async ({ page }) => {
  const calls = await openPage(page, { signedIn: false, photoCount: 5 });
  await expect(page.locator('#jpSignIn')).toBeVisible();
  await expect(page.locator('#jpMain')).toBeHidden();
  expect(calls.length).toBe(0);
  await page.fill('#jpEmail', 'wrong@example.test');
  await page.fill('#jpPassword', 'x');
  await page.click('#jpSignInButton');
  await expect(page.locator('#jpSignInError')).toHaveText('Invalid login credentials');
  await page.fill('#jpEmail', 'trade@example.test');
  await page.click('#jpSignInButton');
  await expect(page.locator('#jpJob')).toHaveText('SWMS-E2E-P1 · 24 Fixture Way, West Swan');
  await expect(page.locator('#jpCount')).toHaveText('5 photos on this visit. Enough for the report.');
});
