// Trade "Request Variation" (Scope tab, confirmed / in-progress assignment).
// A trade REQUESTS a variation; the office APPROVES it. ops-api
// (secureworks-backend#906) files every trade request pending office approval,
// withholds the customer share link, and refuses an unassigned / ghost /
// cancelled caller with 403 variation_requires_assignment. This spec pins the
// trade.html side of that contract with stubbed responses: what is sent, what
// the trade is told, that nothing reads as approved, that a refusal or a failed
// send is never "saved locally", that one press sends one request, and that no
// share link or client send action is ever touched.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const JOB_ID = 'e2e-job-1';

function detail(userId) {
  return {
    access_tier: 'allocated',
    quote_visible: false,
    job: {
      id: JOB_ID, job_number: 'E2E-JOB-001', type: 'fencing', status: 'scheduled',
      client_name: 'Fixture Homeowner', client_phone: '0400333444',
      site_address: '30 Fixture Road', site_suburb: 'Joondalup',
      scope_json: { job: { runs: [{ length: 12 }] } },
    },
    crew: [{ id: 'e2e-var-assignment', job_id: JOB_ID, user_id: userId || PERSONAS.installer.profile.id, status: 'confirmed', role: 'lead', scheduled_date: '2026-09-24' }],
    purchaseOrders: [], documents: [], notes: [], media: [],
  };
}

// createVariation answers each create_variation POST; every ops-api call is logged.
async function stub(page, createVariation, opts) {
  opts = opts || {};
  const calls = [];
  await page.route(`${OPS_API}**`, async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    let body = null;
    try { body = req.postDataJSON(); } catch (e) { body = null; }
    calls.push({ action, method: req.method(), body });
    if (action === 'trade_job_detail') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(opts.userId)) });
    }
    if (action === 'create_variation') return createVariation(route, body);
    if (action === 'get_upload_url') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        uploadUrl: `${OPS_API}?action=__storage_put`, token: 't', path: 'jobs/e2e-job-1/var.jpg',
        publicUrl: 'https://storage.example.test/jobs/e2e-job-1/var.jpg',
      }) });
    }
    if (action === '__storage_put') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (action === 'confirm_upload') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        success: true, url: 'https://storage.example.test/jobs/e2e-job-1/var.jpg',
      }) });
    }
    return route.fallback();
  });
  return calls;
}

async function openVariationForm(page, persona) {
  await signIn(page, persona || PERSONAS.installer);
  await page.locator('[data-view="myJobs"]').click();
  await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
  await page.locator('.jd-tab[data-tab="scope"]').click();
  await page.getByRole('button', { name: /Request Variation/ }).click();
  await expect(page.locator('#variationForm')).toBeVisible();
}

function assertNoClientSendOrShare(calls) {
  const touched = calls.map((c) => c.action).filter((a) => /send|share|sms|email|approve/i.test(String(a)));
  expect(touched).toEqual([]);
}

async function queuedCreateVariation(page) {
  return page.evaluate(() => Object.keys(localStorage).filter((k) => String(localStorage.getItem(k)).indexOf('create_variation') !== -1));
}

test.describe('Trade Request Variation', () => {
  test.use({ persona: 'installer' });

  test('an assigned trade request is sent once and reads as pending office approval, never approved', async ({ appPage: page }) => {
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const calls = await stub(page, async (route) => {
      await hold;
      // share_token should never reach a trade; if a response ever carried one
      // the page must still not show or use it.
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true, variation_id: 'var-1', variation_number: 3,
          needs_approval: true, auto_approved: false, share_token: 'tok-secret-share',
          message: 'Variation #3 sent to the office for approval.',
        }),
      });
    });
    await openVariationForm(page);

    const form = page.locator('#variationForm');
    await expect(form).not.toContainText(/auto-approved/i);
    await expect(form).toContainText('The office reviews every variation');
    await page.locator('.variation-preset-btn', { hasText: 'Rock/Limestone' }).click();
    await page.locator('#variationDesc').fill('Rock/Limestone: two post holes hit limestone, need core drilling');
    await page.locator('#variationCost').fill('150');

    const send = page.locator('#variationSubmitBtn');
    await expect(send).toHaveText('Send request to office');
    await send.click();
    await expect(send).toBeDisabled();
    await expect(send).toHaveText('Sending...');
    // A second press (and a direct call) while the first is in flight sends nothing.
    await page.evaluate((id) => window.submitVariation(id), JOB_ID);
    release();

    const result = page.locator('#variationResult');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Sent to the office for approval');
    await expect(result).toContainText('Variation #3 sent to the office for approval.');
    await expect(result).toContainText('Not approved yet');
    await expect(result).not.toContainText(/\bapproved\b(?! yet)/i);
    await expect(form).toBeHidden();
    await expect(page.locator('#variationDesc')).toHaveValue('');

    const creates = calls.filter((c) => c.action === 'create_variation');
    expect(creates).toHaveLength(1);
    expect(creates[0].method).toBe('POST');
    expect(creates[0].body).toEqual({
      job_id: JOB_ID,
      description: 'Rock/Limestone: two post holes hit limestone, need core drilling',
      estimated_cost: 150,
    });
    expect(creates[0].body).not.toHaveProperty('user_id');

    // Nothing rendered, stored or linked carries the share token or a share link.
    const rendered = await page.evaluate(() => ({
      view: document.getElementById('viewJob').innerHTML,
      text: document.body.innerText,
      storage: Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n')
        + Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)).join('\n'),
      links: Array.from(document.querySelectorAll('a[href]')).map((a) => a.href).join('\n'),
    }));
    for (const value of Object.values(rendered)) expect(value).not.toContain('tok-secret-share');
    expect(rendered.view).not.toMatch(/share_token|view_shared|accept_variation/i);
    expect(calls.some((c) => JSON.stringify(c).includes('tok-secret-share') && c.action !== 'create_variation')).toBe(false);
    assertNoClientSendOrShare(calls);
  });

  test('a 403 variation_requires_assignment refusal says so, keeps the text and saves nothing locally', async ({ appPage: page }) => {
    const calls = await stub(page, (route) => route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Only crew assigned to this job can request a variation', code: 'variation_requires_assignment' }),
    }));
    await openVariationForm(page);
    await page.locator('#variationDesc').fill('Gate moved 1m left at client request');
    await page.locator('#variationSubmitBtn').click();

    const error = page.locator('#variationError');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Not sent');
    await expect(error).toContainText('Only crew assigned to this job can request a variation');
    await expect(page.locator('#variationResult')).toBeHidden();
    await expect(page.locator('#variationDesc')).toHaveValue('Gate moved 1m left at client request');
    await expect(page.locator('#variationSubmitBtn')).toBeEnabled();
    await expect(page.locator('body')).not.toContainText(/saved locally/i);
    expect(await queuedCreateVariation(page)).toEqual([]);
    expect(calls.filter((c) => c.action === 'create_variation')).toHaveLength(1);
    assertNoClientSendOrShare(calls);
  });

  test('a network failure says nothing was sent, keeps the text and queues nothing', async ({ appPage: page }) => {
    const calls = await stub(page, (route) => route.abort('internetdisconnected'));
    await openVariationForm(page);
    await page.locator('#variationDesc').fill('Service clash: water main under run B');
    await page.locator('#variationCost').fill('80');
    await page.locator('#variationSubmitBtn').click();

    const error = page.locator('#variationError');
    await expect(error).toContainText('Not sent. Could not reach the office');
    await expect(page.locator('#variationResult')).toBeHidden();
    await expect(page.locator('#variationDesc')).toHaveValue('Service clash: water main under run B');
    await expect(page.locator('#variationCost')).toHaveValue('80');
    await expect(page.locator('#variationSubmitBtn')).toBeEnabled();
    await expect(page.locator('body')).not.toContainText(/saved locally/i);
    expect(await queuedCreateVariation(page)).toEqual([]);
    assertNoClientSendOrShare(calls);
  });

  test('an optional photo is uploaded first and sent with the request', async ({ appPage: page }) => {
    const calls = await stub(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, variation_number: 4, needs_approval: true, auto_approved: false, message: 'Variation #4 sent to the office for approval.' }),
    }));
    await openVariationForm(page);
    await page.locator('#variationDesc').fill('Access issue: side gate too narrow for the auger');
    // 1x1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.locator('#variationPhoto').setInputFiles({ name: 'gate.png', mimeType: 'image/png', buffer: png });
    await page.locator('#variationSubmitBtn').click();

    await expect(page.locator('#variationResult')).toContainText('Sent to the office for approval');
    const creates = calls.filter((c) => c.action === 'create_variation');
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toEqual({
      job_id: JOB_ID,
      description: 'Access issue: side gate too narrow for the auger',
      photo_url: 'https://storage.example.test/jobs/e2e-job-1/var.jpg',
    });
    const order = calls.map((c) => c.action).filter((a) => ['get_upload_url', 'confirm_upload', 'create_variation'].includes(a));
    expect(order).toEqual(['get_upload_url', 'confirm_upload', 'create_variation']);
    assertNoClientSendOrShare(calls);
  });

  test('a later failed send hides the previous success banner', async ({ appPage: page }) => {
    let n = 0;
    const calls = await stub(page, (route) => {
      n += 1;
      if (n === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true, variation_number: 3,
            needs_approval: true, auto_approved: false,
            message: 'Variation #3 sent to the office for approval.',
          }),
        });
      }
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Only crew assigned to this job can request a variation', code: 'variation_requires_assignment' }),
      });
    });
    await openVariationForm(page);
    await page.locator('#variationDesc').fill('First extra: limestone');
    await page.locator('#variationSubmitBtn').click();
    const result = page.locator('#variationResult');
    await expect(result).toContainText('Sent to the office for approval');

    await page.getByRole('button', { name: /Request Variation/ }).click();
    await expect(page.locator('#variationForm')).toBeVisible();
    await page.locator('#variationDesc').fill('Second extra: gate moved');
    await page.locator('#variationSubmitBtn').click();

    await expect(page.locator('#variationError')).toContainText('Not sent');
    await expect(result).toBeHidden();
    await expect(result).toHaveText('');
    expect(calls.filter((c) => c.action === 'create_variation')).toHaveLength(2);
    assertNoClientSendOrShare(calls);
  });
});

test.describe('Staff Request Variation', () => {
  test.use({ persona: 'allocator' });

  test('showVariationForm returns when the Scope form is not painted', async ({ appPage: page }) => {
    await stub(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, needs_approval: true, auto_approved: false }),
    }), { userId: PERSONAS.allocator.profile.id });
    await signIn(page, PERSONAS.allocator);
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('.jd-tab.active')).toHaveAttribute('data-tab', 'workorder');
    await expect(page.locator('#variationForm')).toHaveCount(0);

    await page.evaluate((id) => window.showVariationForm(id, 'fencing'), JOB_ID);

    await expect(page.locator('#variationForm')).toHaveCount(0);
    await expect(page.locator('.jd-tab.active')).toHaveAttribute('data-tab', 'workorder');
    await expect(page.locator('#jdTab_scope')).not.toHaveClass(/active/);
  });

  test('an office auto-approved request shows the server message as approved', async ({ appPage: page }) => {
    const message = 'Variation #5 auto-approved (under $200).';
    const calls = await stub(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true, variation_id: 'var-5', variation_number: 5,
        needs_approval: false, auto_approved: true, message,
      }),
    }), { userId: PERSONAS.allocator.profile.id });
    await openVariationForm(page, PERSONAS.allocator);
    await page.locator('#variationDesc').fill('Extra metre of plinth after the retaining wall');
    await page.locator('#variationCost').fill('180');
    await page.locator('#variationSubmitBtn').click();

    const result = page.locator('#variationResult');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Approved');
    await expect(result).toContainText(message);
    await expect(result).not.toContainText('Not approved yet');
    await expect(result).not.toContainText('Sent to the office for approval');
    await expect(page.locator('#variationForm')).toBeHidden();

    const creates = calls.filter((c) => c.action === 'create_variation');
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toEqual({
      job_id: JOB_ID,
      description: 'Extra metre of plinth after the retaining wall',
      estimated_cost: 180,
    });
    assertNoClientSendOrShare(calls);
  });
});
