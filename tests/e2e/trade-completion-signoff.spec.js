// Completion wizard client sign-off (trade app audit 2026-09-23, finding 8).
// The name box used oninput="_wizSigName=this.value", which inside trade.html's
// IIFE wrote window._wizSigName, so complete_my_job always got signatureName ''
// and the signature was saved as 'Client signature — ' with no name. A star tap
// re-rendered the step and wiped the typed name, and the sign-off gate was
// computed but never applied, so Next worked with no name or signature.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthDate } = require('../helpers/feed-stub');
const { drawSignature } = require('../helpers/wizard-signoff');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const UPLOAD_URL = `${SUPABASE_ORIGIN}/storage/v1/object/upload/sign/job-photos/e2e`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const shot = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const PHOTO_PROMPTS = ['Front view — full patio visible', 'Underside — beams and fixings', 'Gutter and downpipes'];

function patioDetail() {
  return {
    access_tier: 'allocated', quote_visible: false,
    job: {
      id: 'e2e-patio-1', job_number: 'E2E-PATIO-001', type: 'patio', status: 'processing',
      client_name: 'Fixture Homeowner', client_phone: '0400333444', site_address: '12 Fixture Way', site_suburb: 'Embleton',
      scope_json: {},
    },
    crew: [{ id: 'asn-p1', user_id: 'e2e-installer', users: { id: 'e2e-installer', name: 'E2E Installer' }, scheduled_date: perthDate(), status: 'in_progress', started_at: `${perthDate()}T00:00:00Z`, clocked_on_at: `${perthDate()}T00:00:00Z` }],
    purchaseOrders: [], documents: [], notes: [], media: [], quote_packs: [], quote_extracts: [],
    completion_evidence: null,
    workOrder: null,
  };
}

async function stub(page, log) {
  await page.route(`${UPLOAD_URL}**`, (route) => route.fulfill({ status: 200, body: '' }));
  await page.route(`${OPS_API}**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action');
    const body = req.method() === 'POST' ? (req.postDataJSON() || {}) : null;
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'trade_job_detail' && url.searchParams.get('jobId') === 'e2e-patio-1') return json(patioDetail());
    if (action === 'get_upload_url') return json({ uploadUrl: UPLOAD_URL + '/' + Date.now(), token: 't', publicUrl: SUPABASE_ORIGIN + '/storage/v1/object/public/job-photos/e2e/' + body.fileName, path: 'e2e/' + body.fileName });
    if (action === 'confirm_upload') { log.push([action, body]); return json({ success: true, media: { id: 'm-' + log.length, phase: body.phase } }); }
    if (action === 'complete_my_job') { log.push([action, body]); return json({ success: true, completion_evidence: { satisfied: true } }); }
    if (['send_client_update', 'generate_completion_pack', 'add_note'].includes(action)) return json({ ok: true });
    return route.fallback();
  });
}

async function openWizardAtSignoff(page) {
  await signIn(page, PERSONAS.installer);
  await page.evaluate(() => window.openJob('e2e-patio-1'));
  await page.locator('[data-stepper-finish]').click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#wizOverlay')).toHaveClass(/active/);
  for (const label of PHOTO_PROMPTS) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('.wiz-photo-prompt').filter({ hasText: label }).locator('.wiz-photo-btn-lib').click(),
    ]);
    await chooser.setFiles(shot('p.png'));
  }
  await page.locator('#wizFooter .wiz-btn-primary').click();
  await expect(page.locator('#wizBody .wiz-step-title')).toHaveText('Client Sign-Off');
}

test.describe('Completion wizard client sign-off', () => {
  test.use({ persona: 'installer' });

  test('Next stays shut until the client has rated, given their name and signed', async ({ appPage: page }) => {
    await stub(page, []);
    await openWizardAtSignoff(page);
    const next = page.locator('#wizSignoffNext');
    await expect(next).toBeDisabled();
    await expect(page.locator('#wizSignoffHint')).toHaveText("Add the client's rating, name and signature to continue");

    await page.locator('#wizBody button').filter({ hasText: '☆' }).nth(4).click();
    await expect(next).toBeDisabled();
    await expect(page.locator('#wizSignoffHint')).toHaveText("Add the client's name and signature to continue");

    await page.locator('#wizSigNameInput').fill('Jane Client');
    await expect(next).toBeDisabled();
    await expect(page.locator('#wizSignoffHint')).toHaveText("Add the client's signature to continue");

    // A forced wizNext() call (stale button, keyboard) is refused too.
    await page.evaluate(() => window.wizNext());
    await expect(page.locator('#wizBody .wiz-step-title')).toHaveText('Client Sign-Off');

    await drawSignature(page);
    await expect(next).toBeEnabled();
    await expect(page.locator('#wizSignoffHint')).toHaveText('');

    await page.locator('#wizSigNameInput').fill('   ');
    await expect(next).toBeDisabled();
  });

  test('a star tap after typing and signing keeps the name and the signature', async ({ appPage: page }) => {
    await stub(page, []);
    await openWizardAtSignoff(page);
    await page.locator('#wizSigNameInput').fill('Jane Client');
    await drawSignature(page);
    await page.locator('#wizBody button').filter({ hasText: '☆' }).nth(3).click();
    await expect(page.locator('#wizSigNameInput')).toHaveValue('Jane Client');
    await expect(page.locator('#wizSignoffNext')).toBeEnabled();
    // Changing the rating again re-renders once more; still intact.
    await page.locator('#wizBody button').filter({ hasText: '☆' }).first().click();
    await expect(page.locator('#wizSigNameInput')).toHaveValue('Jane Client');
    await expect(page.locator('#wizSignoffNext')).toBeEnabled();
  });

  test('the typed name reaches complete_my_job and labels the saved signature', async ({ appPage: page }) => {
    const log = [];
    await stub(page, log);
    await openWizardAtSignoff(page);
    await page.locator('#wizSigNameInput').fill('  Jane Client ');
    await drawSignature(page);
    await page.locator('#wizBody button').filter({ hasText: '☆' }).nth(4).click();
    await page.locator('#wizSignoffNext').click();
    for (const cb of await page.locator('#wizBody input[type="checkbox"]').all()) await cb.check();
    await page.locator('#wizFooter .wiz-btn-primary').click();
    await page.locator('#wizCompleteBtn').click();
    await expect(page.locator('#wizBody')).toContainText('Job Complete!', { timeout: 15000 });

    const complete = log.filter((e) => e[0] === 'complete_my_job').map((e) => e[1]);
    expect(complete).toHaveLength(1);
    expect(complete[0]).toMatchObject({ jobId: 'e2e-patio-1', signatureName: 'Jane Client', satisfaction_rating: 5 });
    const sigs = log.filter((e) => e[0] === 'confirm_upload' && e[1].phase === 'signature').map((e) => e[1].label);
    expect(sigs).toEqual(['Client signature — Jane Client']);
  });
});
