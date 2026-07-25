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
});
