const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const PHOTO_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function makesafeReportDetail(media = []) {
  return {
    job: {
      id: 'e2e-makesafe-allocated',
      job_number: 'E2E-MS-002',
      type: 'makesafe',
      status: 'scheduled',
      client_name: 'Allocated Client',
      site_address: '20 Fixture Avenue',
      site_suburb: 'Fremantle'
    },
    crew: [],
    purchaseOrders: [],
    documents: [],
    notes: [],
    media,
    makesafe_details: {
      makesafe_type: 'Roof / tarp',
      substatus: 'waiting_on_trade_report'
    },
    serviceReport: {
      status: 'draft',
      checklist_json: {
        arrival_time: '2026-07-24 09:00',
        damage_description: 'Make-safe type: Roof / tarp\nDamage: Roof sheets lifted in storm',
        job_type: 'Roof / tarp',
        damage_cause: 'Storm / wind',
        work_done: 'Installed and secured a temporary tarp',
        materials_used: ['Heavy-duty tarp x 1'],
        labour_hours: 2,
        trade_count: 2,
        access_issues: 'None'
      }
    }
  };
}

async function openReport(page) {
  await signIn(page, PERSONAS.allocator);
  await page.evaluate(() => window.openJobReport('e2e-makesafe-allocated', 'e2e-ms-assignment'));
  await expect(page.locator('#makesafeReportDirectContent')).toContainText('Make-Safe Report');
}

test.describe('Trade App MakeSafe final report', () => {
  test.use({ persona: 'allocator' });

  test('uses persisted job photos for the gate and attributes submit to the signed-in trade', async ({ appPage: page }) => {
    const persistedPhotos = Array.from({ length: 11 }, (_, index) => ({
      id: `persisted-photo-${index + 1}`,
      job_id: 'e2e-makesafe-allocated',
      type: 'photo',
      phase: 'completion',
      storage_url: PHOTO_DATA_URL
    }));
    let submittedPayload = null;

    await page.route(`${OPS_API}**`, async (route) => {
      const request = route.request();
      const action = new URL(request.url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makesafeReportDetail(persistedPhotos.concat({
            id: 'persisted-receipt',
            job_id: 'e2e-makesafe-allocated',
            type: 'receipt',
            storage_url: PHOTO_DATA_URL
          })))
        });
        return;
      }
      if (action === 'submit_makesafe_report') {
        submittedPayload = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fallback();
    });

    await openReport(page);

    await expect(page.locator('#msrPhotoGrid img')).toHaveCount(11);
    await expect(page.locator('#makesafeReportDirectContent')).toContainText('Photo gate: 11/5 photos uploaded.');

    await page.getByRole('button', { name: 'Submit MakeSafe report' }).click();
    await expect.poll(() => submittedPayload).not.toBeNull();
    expect(submittedPayload.userId).toBe(PERSONAS.allocator.profile.id);
    expect(submittedPayload.job_id).toBe('e2e-makesafe-allocated');
  });

  test('counts only confirmed uploads and refreshes the visible photo gate without losing the form', async ({ appPage: page }) => {
    let uploadNumber = 0;
    const confirmedUploads = [];
    let submittedPayload = null;

    await page.route('https://storage.example.test/**', async (route) => {
      await route.fulfill({ status: 200, body: '' });
    });
    await page.route(`${OPS_API}**`, async (route) => {
      const request = route.request();
      const action = new URL(request.url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makesafeReportDetail()) });
        return;
      }
      if (action === 'get_upload_url') {
        uploadNumber += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            uploadUrl: `https://storage.example.test/upload/photo-${uploadNumber}`,
            publicUrl: `https://storage.example.test/public/photo-${uploadNumber}.jpg`,
            path: `e2e/photo-${uploadNumber}.jpg`,
            token: 'e2e-upload-token'
          })
        });
        return;
      }
      if (action === 'confirm_upload') {
        const body = request.postDataJSON();
        confirmedUploads.push(body);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, url: body.publicUrl })
        });
        return;
      }
      if (action === 'submit_makesafe_report') {
        submittedPayload = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fallback();
    });

    await openReport(page);
    await expect(page.locator('#makesafeReportDirectContent')).toContainText('Photo gate: 0/5 photos uploaded.');

    await page.locator('#msrPhotoInput').setInputFiles(
      Array.from({ length: 5 }, (_, index) => ({
        name: `completion-${index + 1}.jpg`,
        mimeType: 'image/jpeg',
        buffer: Buffer.from(`confirmed-photo-${index + 1}`)
      }))
    );

    await expect.poll(() => confirmedUploads.length).toBe(5);
    await expect(page.locator('#makesafeReportDirectContent')).toContainText('Photo gate: 5/5 photos uploaded.');
    await expect(page.locator('#msrDamageDesc')).toHaveValue('Roof sheets lifted in storm');

    await page.getByRole('button', { name: 'Submit MakeSafe report' }).click();
    await expect.poll(() => submittedPayload).not.toBeNull();
    expect(submittedPayload.userId).toBe(PERSONAS.allocator.profile.id);
    expect(confirmedUploads.every((upload) => upload.jobId === 'e2e-makesafe-allocated')).toBe(true);
  });

  // Field failure (Hugo, 2026-07-26): on site with weak signal one photo in a
  // batch fails, and the crew is then locked out of submitting the report even
  // though the rest of the batch reached job_media. Photos that the server has
  // confirmed must always count toward the gate, whatever happened to the rest
  // of the batch.
  test('keeps the photos that reached the server when one upload in the batch fails', async ({ appPage: page }) => {
    let urlNumber = 0;
    const confirmedUploads = [];

    await page.route('https://storage.example.test/**', async (route) => {
      await route.fulfill({ status: 200, body: '' });
    });
    await page.route(`${OPS_API}**`, async (route) => {
      const request = route.request();
      const action = new URL(request.url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makesafeReportDetail()) });
        return;
      }
      if (action === 'get_upload_url') {
        urlNumber += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            uploadUrl: `https://storage.example.test/upload/photo-${urlNumber}`,
            publicUrl: `https://storage.example.test/public/photo-${urlNumber}.jpg`,
            path: `e2e/photo-${urlNumber}.jpg`,
            token: 'e2e-upload-token'
          })
        });
        return;
      }
      if (action === 'confirm_upload') {
        const body = request.postDataJSON();
        // The fifth photo of the batch never registers. The first four did.
        if (confirmedUploads.length >= 4) {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'storage write failed' })
          });
          return;
        }
        confirmedUploads.push(body);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, url: body.publicUrl })
        });
        return;
      }
      await route.fallback();
    });

    await openReport(page);
    await expect(page.locator('#makesafeReportDirectContent')).toContainText('Photo gate: 0/5 photos uploaded.');

    await page.locator('#msrPhotoInput').setInputFiles(
      Array.from({ length: 5 }, (_, index) => ({
        name: `weak-signal-${index + 1}.jpg`,
        mimeType: 'image/jpeg',
        buffer: Buffer.from(`weak-signal-photo-${index + 1}`)
      }))
    );

    await expect.poll(() => confirmedUploads.length).toBe(4);
    // The four confirmed photos are on the job. The gate must say so rather
    // than throwing the crew's work away and reporting nothing uploaded.
    await expect(page.locator('#makesafeReportDirectContent')).toContainText('Photo gate: 4/5 photos uploaded.');
    // The typed report survives the failed batch.
    await expect(page.locator('#msrDamageDesc')).toHaveValue('Roof sheets lifted in storm');
  });

  // The gate is the crew's only signal that the report is submittable, so it
  // must never refuse on a stale local count when the job already holds enough
  // confirmed photos. A failed batch is exactly when the local count goes stale.
  test('a failed batch does not permanently block a report whose photos are on the job', async ({ appPage: page }) => {
    let urlNumber = 0;
    let failNextConfirm = true;
    const persisted = [];
    let submittedPayload = null;

    await page.route('https://storage.example.test/**', async (route) => {
      await route.fulfill({ status: 200, body: '' });
    });
    await page.route(`${OPS_API}**`, async (route) => {
      const request = route.request();
      const action = new URL(request.url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makesafeReportDetail(persisted.slice()))
        });
        return;
      }
      if (action === 'get_upload_url') {
        urlNumber += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            uploadUrl: `https://storage.example.test/upload/photo-${urlNumber}`,
            publicUrl: `https://storage.example.test/public/photo-${urlNumber}.jpg`,
            path: `e2e/photo-${urlNumber}.jpg`,
            token: 'e2e-upload-token'
          })
        });
        return;
      }
      if (action === 'confirm_upload') {
        const body = request.postDataJSON();
        // Only the very last photo of the first batch fails.
        if (failNextConfirm && persisted.length >= 5) {
          failNextConfirm = false;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'storage write failed' })
          });
          return;
        }
        persisted.push({
          id: `persisted-${persisted.length + 1}`,
          job_id: 'e2e-makesafe-allocated',
          type: 'photo',
          phase: 'completion',
          storage_url: PHOTO_DATA_URL
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, url: body.publicUrl })
        });
        return;
      }
      if (action === 'submit_makesafe_report') {
        submittedPayload = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fallback();
    });

    await openReport(page);
    await page.locator('#msrPhotoInput').setInputFiles(
      Array.from({ length: 6 }, (_, index) => ({
        name: `batch-${index + 1}.jpg`,
        mimeType: 'image/jpeg',
        buffer: Buffer.from(`batch-photo-${index + 1}`)
      }))
    );

    // Five photos are registered against the job; the sixth failed.
    await expect.poll(() => persisted.length).toBe(5);

    await page.getByRole('button', { name: 'Submit MakeSafe report' }).click();
    await expect.poll(() => submittedPayload, { timeout: 10_000 }).not.toBeNull();
    expect(submittedPayload.job_id).toBe('e2e-makesafe-allocated');
  });

  // SAFETY: the gate exists so a make-safe report cannot be filed without
  // evidence. Recovering from a failed batch must never become a way around it.
  test('still refuses to submit when the job genuinely has too few photos', async ({ appPage: page }) => {
    let urlNumber = 0;
    const persisted = [];
    let submittedPayload = null;

    await page.route('https://storage.example.test/**', async (route) => {
      await route.fulfill({ status: 200, body: '' });
    });
    await page.route(`${OPS_API}**`, async (route) => {
      const request = route.request();
      const action = new URL(request.url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(makesafeReportDetail(persisted.slice()))
        });
        return;
      }
      if (action === 'get_upload_url') {
        urlNumber += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            uploadUrl: `https://storage.example.test/upload/photo-${urlNumber}`,
            publicUrl: `https://storage.example.test/public/photo-${urlNumber}.jpg`,
            path: `e2e/photo-${urlNumber}.jpg`,
            token: 'e2e-upload-token'
          })
        });
        return;
      }
      if (action === 'confirm_upload') {
        const body = request.postDataJSON();
        // Only two of the four ever register.
        if (persisted.length >= 2) {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'storage write failed' })
          });
          return;
        }
        persisted.push({
          id: `persisted-${persisted.length + 1}`,
          job_id: 'e2e-makesafe-allocated',
          type: 'photo',
          phase: 'completion',
          storage_url: PHOTO_DATA_URL
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, url: body.publicUrl })
        });
        return;
      }
      if (action === 'submit_makesafe_report') {
        submittedPayload = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fallback();
    });

    await openReport(page);
    await page.locator('#msrPhotoInput').setInputFiles(
      Array.from({ length: 4 }, (_, index) => ({
        name: `short-${index + 1}.jpg`,
        mimeType: 'image/jpeg',
        buffer: Buffer.from(`short-photo-${index + 1}`)
      }))
    );

    await expect.poll(() => persisted.length).toBe(2);
    await expect(page.locator('#makesafeReportDirectContent')).toContainText('Photo gate: 2/5 photos uploaded.');

    await page.getByRole('button', { name: 'Submit MakeSafe report' }).click();
    await expect(page.locator('#toast')).toContainText('at least 5 photos');
    await page.waitForTimeout(1500);
    expect(submittedPayload).toBeNull();
  });
});
