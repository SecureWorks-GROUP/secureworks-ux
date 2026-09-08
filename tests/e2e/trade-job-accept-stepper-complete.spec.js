// Trade job view: accept gate, one-tap job stepper, quote lines, and the
// fencing completion wizard with neighbour sign-off (Captain 2026-09-08).
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const UPLOAD_URL = `${SUPABASE_ORIGIN}/storage/v1/object/upload/sign/job-photos/e2e`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const shot = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

function fenceDetail(assignmentStatus, extra) {
  return Object.assign({
    access_tier: 'allocated',
    quote_visible: false,
    job: {
      id: 'e2e-job-1', job_number: 'E2E-JOB-001', type: 'fencing', status: 'processing',
      client_name: 'Fixture Homeowner', client_phone: '0400333444', ghl_contact_id: 'c-1',
      site_address: '20 Trappers Dr', site_suburb: 'Woodvale',
      scope_json: { job: { runs: [{ name: 'RHS', length: 7.1, sheetHeight: 1800 }], profile: 'Ridgeside', colour: 'Domain', neighbours: [{ id: 'nb-1', firstName: 'Sue', lastName: 'Lee' }] } },
    },
    crew: [{ id: 'e2e-assignment-1', user_id: 'e2e-installer', users: { id: 'e2e-installer', name: 'E2E Installer' }, scheduled_date: '2026-09-09', start_time: '07:00', status: assignmentStatus }],
    purchaseOrders: [], documents: [], notes: [], media: [],
    quote_packs: [{
      quote_number: 'Q-0708', job_document_id: 'doc-q', status: 'sent', sent_at: '2026-08-26T06:25:18Z', source: 'frozen',
      summary: 'RHS - Colorbond install 1800mm 7.1m',
      items: [{ kind: 'install_m', description: 'RHS - Colorbond install 1800mm', quantity: 7.1, unit: 'm' }],
      quote_lines: [
        { description: 'Domain Ridgeside fencing — 7.1m', quantity: 7.1, unit: 'm' },
        { description: 'Retaining plinths (150mm)', quantity: 3, unit: 'ea' },
        { description: 'Jack hammering to make room for footings', quantity: 1, unit: 'job' },
        { description: 'Removal of roots and vegetation', quantity: 1, unit: 'job' },
      ],
      quote_notes: ['7m Colorbond Fencing — 1800mm Domain — Woodvale', 'Our assessment is that a plinth is required to stop rust occurring.', 'Deep ocean rails and plinths'],
    }],
    quote_extracts: [],
    completion_evidence: { job_id: 'e2e-job-1', applies: true, satisfied: false, photos: 0, photos_required: 3, signoffs: 0, signoffs_required: 1, named_neighbours: 1, waived: false, waiver_reason: null, missing: ['completion_photos', 'neighbour_signoff'], read_failed: false },
    workOrder: null,
  }, extra || {});
}

async function stub(page, payload, log) {
  await page.route(`${UPLOAD_URL}**`, (route) => route.fulfill({ status: 200, body: '' }));
  await page.route(`${OPS_API}**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action');
    const body = req.method() === 'POST' ? (req.postDataJSON() || {}) : null;
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'trade_job_detail') return json(payload());
    if (action === 'update_my_assignment') { log.push([action, body.status]); return json({ assignment: { id: body.assignmentId, status: body.status } }); }
    if (action === 'clock_event') {
      log.push([action, body.event]);
      const now = new Date().toISOString();
      const a = body.event === 'clock_on'
        ? { id: body.assignment_id, status: 'in_progress', started_at: now, clocked_on_at: now }
        : { id: body.assignment_id, status: 'complete', completed_at: now, clocked_off_at: now };
      return json({ success: true, assignment: a });
    }
    if (action === 'get_upload_url') return json({ uploadUrl: UPLOAD_URL + '/' + Date.now(), token: 't', publicUrl: SUPABASE_ORIGIN + '/storage/v1/object/public/job-photos/e2e/' + body.fileName, path: 'e2e/' + body.fileName });
    if (action === 'confirm_upload') { log.push([action, body.phase, body.label || '']); return json({ id: 'm-' + log.length, phase: body.phase }); }
    if (action === 'waive_neighbour_signoff') { log.push([action, body.reason]); return json({ ok: true }); }
    if (action === 'complete_my_job') { log.push([action, body.jobId]); return json({ success: true, completion_evidence: { satisfied: true } }); }
    if (['send_client_update', 'generate_completion_pack', 'add_note'].includes(action)) return json({ ok: true });
    return route.fallback();
  });
}

async function openJob(page) {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="myJobs"]').click();
  await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
}

test.describe('Accept gate and job stepper', () => {
  test.use({ persona: 'installer' });

  test('a scheduled job shows only suburb, date and scope until the installer is on it', async ({ appPage: page }) => {
    const log = [];
    let status = 'scheduled';
    await stub(page, () => fenceDetail(status), log);
    await openJob(page);
    const gate = page.locator('[data-accept-gate]');
    await expect(gate).toBeVisible();
    await expect(gate).toContainText('Woodvale');
    await expect(gate).toContainText('7.1m');
    await expect(page.locator('#jobDetailContent')).not.toContainText('Trappers');
    await expect(page.locator('#jobDetailContent')).not.toContainText('Fixture Homeowner');
    await expect(page.locator('#jobDetailContent')).not.toContainText('0400333444');
    await expect(page.locator('.jd-tabs')).toHaveCount(0);
    await expect(page.locator('[data-quote-packs]')).toHaveCount(0);

    status = 'confirmed';
    await gate.locator('[data-accept-yes]').click();
    await expect(page.locator('#toast')).toContainText('Job accepted');
    expect(log).toContainEqual(['update_my_assignment', 'confirmed']);
    await expect(page.locator('[data-accept-gate]')).toHaveCount(0);
    await expect(page.locator('#jobDetailContent')).toContainText('Trappers');
    await expect(page.locator('.jd-action-bar a.act-call')).toBeVisible();
    await expect(page.locator('[data-job-stepper]')).toHaveAttribute('data-stepper-state', 'accepted');
    await expect(page.locator('[data-stepper-start]')).toHaveText('Start work');
  });

  test('Start work clocks on; working state offers Job complete and End my day', async ({ appPage: page }) => {
    const log = [];
    await stub(page, () => fenceDetail('confirmed'), log);
    await openJob(page);
    await page.locator('[data-stepper-start]').click();
    await expect(page.locator('#toast')).toContainText('Clocked On');
    expect(log).toContainEqual(['clock_event', 'clock_on']);
    const stepper = page.locator('[data-job-stepper]');
    await expect(stepper).toHaveAttribute('data-stepper-state', 'working');
    await expect(stepper.locator('#timerElapsed')).toBeVisible();
    await expect(stepper.locator('[data-stepper-finish]')).toHaveText('Job complete');
    await expect(stepper.locator('[data-stepper-endday]')).toContainText('End my day');
    await expect(stepper.locator('[data-stepper-start]')).toHaveCount(0);
  });

  test('Scope of works shows the quote rows and writing, installer lines under Install summary', async ({ appPage: page }) => {
    const log = [];
    await stub(page, () => fenceDetail('confirmed'), log);
    await openJob(page);
    const quote = page.locator('#jdTab_scope [data-quote-packs]');
    const lines = quote.locator('[data-quote-lines] .sow-item');
    await expect(lines).toHaveCount(4);
    await expect(lines.nth(0)).toContainText('Domain Ridgeside fencing');
    await expect(lines.nth(0)).toContainText('7.1 m');
    await expect(lines.nth(2)).toContainText('Jack hammering to make room for footings');
    await expect(quote.locator('[data-quote-note]')).toHaveCount(3);
    await expect(quote.locator('[data-quote-note]').first()).toContainText('From the quote');
    await expect(quote).toContainText('Deep ocean rails and plinths');
    const install = quote.locator('[data-install-summary]');
    await expect(install).toBeVisible();
    await expect(install).not.toHaveAttribute('open', '');
    await expect(install).toContainText('RHS - Colorbond install 1800mm');
    await expect(quote).not.toContainText('$');
  });

  test('fencing completion wizard: photos, neighbour sign-off screenshot, then complete_my_job', async ({ appPage: page }) => {
    const log = [];
    await stub(page, () => fenceDetail('in_progress', { crew: [{ id: 'e2e-assignment-1', user_id: 'e2e-installer', users: { id: 'e2e-installer', name: 'E2E Installer' }, scheduled_date: '2026-09-09', status: 'in_progress', started_at: '2026-09-09T00:00:00Z', clocked_on_at: '2026-09-09T00:00:00Z' }] }), log);
    await openJob(page);
    await page.locator('[data-stepper-finish]').click();
    await page.locator('#confirmOk').click();
    const wiz = page.locator('#wizOverlay');
    await expect(wiz).toHaveClass(/active/);
    await expect(page.locator('#wizStepLabel')).toHaveText('Step 1 of 5');

    // Step 1: three photos through the dynamically created file inputs.
    const prompts = ['Full fence run', 'Gate operation', 'Post bases and plinths'];
    for (const label of prompts) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('.wiz-photo-prompt').filter({ hasText: label }).locator('.wiz-photo-btn-lib').click(),
      ]);
      await chooser.setFiles(shot(label.replace(/\s+/g, '-') + '.png'));
    }
    await page.locator('#wizFooter .wiz-btn-primary').click();

    // Step 2: neighbour sign-off, one slot per named neighbour, gated until filled.
    await expect(page.locator('#wizStepLabel')).toHaveText('Step 2 of 5');
    await expect(page.locator('[data-neighbour-slot="0"]')).toContainText('Sue Lee');
    await expect(page.locator('[data-neighbour-next]')).toBeDisabled();
    const [nsChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-neighbour-slot="0"] .wiz-photo-btn-lib').click(),
    ]);
    await nsChooser.setFiles(shot('sue-signoff.png'));
    await expect(page.locator('[data-neighbour-next]')).toBeEnabled();
    await page.locator('[data-neighbour-next]').click();

    // Step 3: client sign-off (rating), Step 4: checklist, Step 5: submit.
    await expect(page.locator('#wizStepLabel')).toHaveText('Step 3 of 5');
    await page.locator('#wizBody button').filter({ hasText: '☆' }).nth(4).click();
    await page.locator('#wizFooter .wiz-btn-primary').click();
    await expect(page.locator('#wizStepLabel')).toHaveText('Step 4 of 5');
    for (const cb of await page.locator('#wizBody input[type="checkbox"]').all()) await cb.check();
    await page.locator('#wizFooter .wiz-btn-primary').click();
    await expect(page.locator('#wizStepLabel')).toHaveText('Step 5 of 5');
    await expect(page.locator('[data-neighbour-summary]')).toHaveText('1 screenshot');
    await page.locator('#wizCompleteBtn').click();

    await expect(page.locator('#wizBody')).toContainText(/complete/i, { timeout: 15000 });
    const confirms = log.filter((e) => e[0] === 'confirm_upload');
    expect(confirms.filter((e) => e[1] === 'completion')).toHaveLength(3);
    expect(confirms.filter((e) => e[1] === 'neighbour_signoff')).toEqual([['confirm_upload', 'neighbour_signoff', 'Neighbour sign-off: Sue Lee']]);
    const completeIdx = log.findIndex((e) => e[0] === 'complete_my_job');
    const lastUploadIdx = Math.max(...log.map((e, i) => (e[0] === 'confirm_upload' ? i : -1)));
    expect(completeIdx).toBeGreaterThan(lastUploadIdx);
    expect(log.some((e) => e[0] === 'waive_neighbour_signoff')).toBe(false);
  });

  test('fencing completion wizard: a waiver with a reason replaces the screenshot', async ({ appPage: page }) => {
    const log = [];
    await stub(page, () => fenceDetail('in_progress', { crew: [{ id: 'e2e-assignment-1', user_id: 'e2e-installer', users: { id: 'e2e-installer', name: 'E2E Installer' }, scheduled_date: '2026-09-09', status: 'in_progress', started_at: '2026-09-09T00:00:00Z' }] }), log);
    await openJob(page);
    await page.locator('[data-stepper-finish]').click();
    await page.locator('#confirmOk').click();
    for (const label of ['Full fence run', 'Gate operation', 'Post bases and plinths']) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('.wiz-photo-prompt').filter({ hasText: label }).locator('.wiz-photo-btn-lib').click(),
      ]);
      await chooser.setFiles(shot(label + '.png'));
    }
    await page.locator('#wizFooter .wiz-btn-primary').click();
    await page.locator('[data-neighbour-waive]').click();
    await expect(page.locator('[data-neighbour-next]')).toBeDisabled();
    await page.locator('[data-neighbour-waiver-reason]').fill('Front boundary fence, no neighbour');
    await expect(page.locator('[data-neighbour-next]')).toBeEnabled();
    await page.locator('[data-neighbour-next]').click();
    await page.locator('#wizBody button').filter({ hasText: '☆' }).nth(4).click();
    await page.locator('#wizFooter .wiz-btn-primary').click();
    for (const cb of await page.locator('#wizBody input[type="checkbox"]').all()) await cb.check();
    await page.locator('#wizFooter .wiz-btn-primary').click();
    await expect(page.locator('[data-neighbour-summary]')).toContainText('Waived: Front boundary fence');
    await page.locator('#wizCompleteBtn').click();
    await expect(page.locator('#wizBody')).toContainText(/complete/i, { timeout: 15000 });
    expect(log).toContainEqual(['waive_neighbour_signoff', 'Front boundary fence, no neighbour']);
    expect(log.some((e) => e[0] === 'confirm_upload' && e[1] === 'neighbour_signoff')).toBe(false);
    expect(log.some((e) => e[0] === 'complete_my_job')).toBe(true);
  });
});

test.describe('Vertical manager is not gated', () => {
  test.use({ persona: 'fencing_manager' });
  test('a fencing manager with a scheduled assignment still sees the full job', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('#navBoard').click();
    await page.locator('#boardContent .jc').filter({ hasText: 'FENCE-HENRY-001' }).locator('.jc-place').click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('[data-accept-gate]')).toHaveCount(0);
    await expect(page.locator('.jd-tabs')).toBeVisible();
  });
});
