// 2026-09-08 — a trade can reopen their submitted make-safe report until the
// office sends it; afterwards only a separate attendance is offered.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const JOB = 'e2e-ms-unlock';
const SIG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function detail(state) {
  return {
    access_tier: 'allocated',
    job: { id: JOB, job_number: 'SWMS-261386', type: 'makesafe', status: 'scheduled', client_name: 'Major Loss Builders', site_address: '151 Deanmore Road', site_suburb: 'Scarborough', metadata: {} },
    crew: [{ id: 'asn-1', user_id: 'e2e-installer', users: { id: 'e2e-installer', name: 'E2E Installer' }, status: 'complete', scheduled_date: '2026-09-08' }],
    purchaseOrders: [], notes: [], media: [], documents: [],
    makesafe_details: { makesafe_type: 'Roof / tarp', substatus: state.unlocked ? 'waiting_on_trade_report' : 'admin_to_send_report', cycle_number: 1, report_sent_at: state.sent ? '2026-09-08T03:00:00Z' : null },
    serviceReport: state.unlocked
      ? { status: 'draft', checklist_json: { work_done: 'Tarped the roof', labour_hours: 2, damage_description: 'Make-safe type: Roof / tarp\nDamage: Lifted sheets' } }
      : { status: 'submitted', submitted_at: '2026-09-08T01:00:00Z', submitted_by: 'e2e-installer', signature_data: SIG, checklist_json: { work_done: 'Tarped the roof', labour_hours: 2 } },
  };
}

function wire(page, state) {
  return page.route(`${OPS_API}**`, async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'trade_job_detail') return json(detail(state));
    if (action === 'unlock_makesafe_report') {
      state.log.push(req.postDataJSON());
      if (state.sent) return json({ error: 'The office has already sent this report to the builder. Submit a separate attendance instead.' }, 409);
      state.unlocked = true;
      return json({ ok: true, report_id: 'r-1', substatus: 'waiting_on_trade_report' });
    }
    await route.fallback();
  });
}

test.describe('Trade app: reopen a submitted make-safe report', () => {
  test.use({ persona: 'installer' });

  test('Edit this report reopens it and the form comes back prefilled; signature is shown while submitted', async ({ appPage: page }) => {
    const state = { log: [], unlocked: false, sent: false };
    await wire(page, state);
    await signIn(page, PERSONAS.installer);
    await page.evaluate((jobId) => window.openJobReport(jobId, 'asn-1'), JOB);
    const content = page.locator('#makesafeReportDirectContent');
    await expect(content).toContainText('Report Submitted');
    await expect(content.locator('[data-ms-signature]')).toBeVisible();
    await expect(content.locator('[data-ms-reattend]')).toBeVisible();
    await content.locator('[data-ms-unlock]').click();
    await content.locator('[data-ms-unlock-yes]').click();
    await expect.poll(() => state.log.length).toBe(1);
    expect(state.log[0]).toEqual({ job_id: JOB });
    // Reloaded from the server: the form is back, prefilled from the saved report.
    await expect(content).toContainText('Make-Safe Report');
    await expect(content.locator('#msrWorkDone')).toHaveValue('Tarped the roof');
    await expect(content.locator('[data-ms-unlock]')).toHaveCount(0);
  });

  test('once the office has sent the report there is no Edit, only a separate attendance', async ({ appPage: page }) => {
    const state = { log: [], unlocked: false, sent: true };
    await wire(page, state);
    await signIn(page, PERSONAS.installer);
    await page.evaluate((jobId) => window.openJobReport(jobId, 'asn-1'), JOB);
    const content = page.locator('#makesafeReportDirectContent');
    await expect(content).toContainText('Report Submitted');
    await expect(content.locator('[data-ms-unlock]')).toHaveCount(0);
    await expect(content.locator('[data-ms-reattend]')).toBeVisible();
    await expect(content).toContainText('locked');
  });
});
