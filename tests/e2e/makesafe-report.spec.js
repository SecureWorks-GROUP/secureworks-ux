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

async function openReport(page, persona = PERSONAS.allocator, expectedText = 'Make-Safe Report') {
  await signIn(page, persona);
  await page.evaluate(() => window.openJobReport('e2e-makesafe-allocated', 'e2e-ms-assignment'));
  await expect(page.locator('#makesafeReportDirectContent')).toContainText(expectedText);
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

test.describe('Trade App self-started MakeSafe reattendance', () => {
  test.use({ persona: 'installer' });

  test('an assigned trade starts visit two with a reason and lands in its separate report', async ({ appPage: page }) => {
    const firstReport = {
      id: 'report-visit-1',
      job_id: 'e2e-makesafe-allocated',
      status: 'submitted',
      cycle_number: 1,
      attendance_cycle_id: 'cycle-visit-1',
      cycle_attribution: 'bound',
      submitted_at: '2026-07-27T01:00:00Z',
      checklist_json: {
        damage_description: 'Fence was unsafe.',
        work_done: 'Secured the fence on visit one.',
        materials_used: ['star pickets'],
        labour_hours: 2,
        trade_count: 1
      }
    };
    let reattendancePayload = null;
    let visitTwoStarted = false;

    await page.route(`${OPS_API}**`, async (route) => {
      const request = route.request();
      const action = new URL(request.url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        const detail = makesafeReportDetail(Array.from({ length: 5 }, (_, index) => ({
          id: `visit-1-photo-${index + 1}`,
          job_id: 'e2e-makesafe-allocated',
          type: 'photo',
          phase: 'completion',
          attendance_cycle_id: 'cycle-visit-1',
          cycle_attribution: 'bound',
          storage_url: PHOTO_DATA_URL
        })));
        detail.serviceReport = visitTwoStarted ? null : firstReport;
        detail.serviceReports = [firstReport];
        detail.makesafe_details = {
          substatus: visitTwoStarted ? 'waiting_on_trade_report' : 'admin_to_send_report',
          report_received_at: visitTwoStarted ? null : firstReport.submitted_at,
          cycle_number: visitTwoStarted ? 2 : 1,
          reattend_count: visitTwoStarted ? 1 : 0,
          attendance_cycle_id: visitTwoStarted ? 'cycle-visit-2' : 'cycle-visit-1',
          cycle_attribution: 'bound',
          last_reattend_reason: visitTwoStarted ? 'storm loosened the temporary fence' : null
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
        return;
      }
      if (action === 'reattend_makesafe') {
        reattendancePayload = request.postDataJSON();
        visitTwoStarted = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            reattended: true,
            cycle_number: 2,
            reattend_count: 1,
            attendance_cycle_id: 'cycle-visit-2',
            authorization_relationship: 'assigned_trade'
          })
        });
        return;
      }
      await route.fallback();
    });

    await openReport(page, PERSONAS.installer, 'Report Submitted');
    await expect(page.getByRole('button', { name: 'Create reattendance report' })).toBeVisible();
    await page.getByRole('button', { name: 'Create reattendance report' }).click();
    await page.locator('#reattendReason').fill('storm loosened the temporary fence');
    await page.getByRole('button', { name: 'Start reattendance' }).click();

    await expect.poll(() => reattendancePayload).not.toBeNull();
    expect(reattendancePayload).toEqual({
      job_id: 'e2e-makesafe-allocated',
      reason: 'storm loosened the temporary fence'
    });
    await expect(page.locator('#makesafeReattendBar')).toContainText('Re-attend · visit 2');
    await expect(page.locator('#makesafeReportDirectContent')).toContainText('Photo gate: 0/5 photos uploaded.');
    await expect(page.locator('#makesafeReportDirectContent')).not.toContainText('Secured the fence on visit one.');
  });

  test('surfaces a server-side relationship authorization rejection', async ({ appPage: page }) => {
    let rejectedPayload = null;

    await page.route(`${OPS_API}**`, async (route) => {
      const request = route.request();
      const action = new URL(request.url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        const detail = makesafeReportDetail(Array.from({ length: 5 }, (_, index) => ({
          id: `visit-1-photo-${index + 1}`,
          job_id: 'e2e-makesafe-allocated',
          type: 'photo',
          phase: 'completion',
          attendance_cycle_id: 'cycle-visit-1',
          cycle_attribution: 'bound',
          storage_url: PHOTO_DATA_URL
        })));
        detail.serviceReport = {
          id: 'report-visit-1',
          job_id: 'e2e-makesafe-allocated',
          status: 'submitted',
          checklist_json: { damage_description: 'Fence was unsafe.' }
        };
        detail.makesafe_details = { substatus: 'admin_to_send_report', report_received_at: '2026-07-27T01:00:00Z' };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
        return;
      }
      if (action === 'reattend_makesafe') {
        rejectedPayload = request.postDataJSON();
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not authorized: unrelated user cannot re-attend this job' })
        });
        return;
      }
      await route.fallback();
    });

    await openReport(page, PERSONAS.installer, 'Report Submitted');
    await page.getByRole('button', { name: 'Create reattendance report' }).click();
    await page.locator('#reattendReason').fill('unrelated-user authorization check');
    await page.getByRole('button', { name: 'Start reattendance' }).click();

    await expect.poll(() => rejectedPayload).not.toBeNull();
    expect(rejectedPayload).toEqual({
      job_id: 'e2e-makesafe-allocated',
      reason: 'unrelated-user authorization check'
    });
    await expect(page.locator('#toast')).toContainText('Could not start reattendance');
    await expect(page.locator('#toast')).toContainText('unrelated user');
  });
});

test.describe('Trade App MakeSafe cancellation authority', () => {
  test('a make-safe manager can cancel with a reason and note', async ({ appPage: page }) => {
    let cancelPayload = null;
    await page.route(`${OPS_API}**`, async (route) => {
      const request = route.request();
      const action = new URL(request.url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makesafeReportDetail()) });
        return;
      }
      if (action === 'cancel_makesafe') {
        cancelPayload = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fallback();
    });

    await openReport(page, PERSONAS.allocator);
    await page.getByRole('button', { name: 'Cancel job' }).click();
    await page.locator('#cancelNote').fill('Builder recalled the job');
    await page.getByRole('button', { name: 'Cancel this job' }).click();
    await expect(page.locator('#cancelConfirmMsg')).toContainText('E2E Allocator');
    await page.getByRole('button', { name: 'Yes, cancel this job' }).click();

    await expect.poll(() => cancelPayload).not.toBeNull();
    expect(cancelPayload).toEqual({
      job_id: 'e2e-makesafe-allocated',
      reason_code: 'builder_recalled',
      note: 'Builder recalled the job'
    });
  });

  test.use({ persona: 'installer' });

  test('a non-manager has no cancellation control', async ({ appPage: page }) => {
    await page.route(`${OPS_API}**`, async (route) => {
      const action = new URL(route.request().url()).searchParams.get('action');
      if (action === 'trade_job_detail') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makesafeReportDetail()) });
        return;
      }
      await route.fallback();
    });

    await openReport(page, PERSONAS.installer);
    await expect(page.locator('#makesafeCancelBar')).toBeEmpty();
    await expect(page.getByRole('button', { name: 'Cancel job' })).toHaveCount(0);
  });
});
