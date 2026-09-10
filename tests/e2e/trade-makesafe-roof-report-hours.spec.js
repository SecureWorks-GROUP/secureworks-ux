// 2026-09-08 — SecureWorks roof report from inside the trade app, and one-tap
// hours after a report is done (portal, make-safe, or roof report).
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const JOB = 'e2e-ms-roof';

const TEMPLATE = {
  template: {
    version: 1, pack_kind: 'roof',
    sections: [
      { key: 'inspection', title: 'Inspection Details' },
      { key: 'property', title: 'Property Details' },
      { key: 'findings', title: 'Roof Findings' },
      { key: 'photos', title: 'Photo Evidence' },
    ],
    fields: [
      { key: 'inspection_date', label: 'Date of inspection', type: 'date', section: 'inspection', required: true },
      { key: 'inspected_by', label: 'Inspected by', type: 'text', section: 'inspection', required: true },
      { key: 'storeys', label: 'Number of storeys', type: 'select', section: 'property', required: true, options: ['Single Storey', 'Double Storey'] },
      { key: 'roof_type', label: 'Roof type', type: 'select', section: 'property', options: ['Terracotta Tiles', 'Colorbond'] },
      { key: 'water_leak', label: 'Water leak through the roof', type: 'toggle', section: 'findings' },
      { key: 'overall_findings', label: 'Roof condition and findings', type: 'textarea', section: 'findings' },
      { key: 'photos', label: 'Photo evidence', type: 'photos', section: 'photos' },
    ],
    pricing: { storey_field: 'storeys' },
  },
  job: { id: JOB, job_number: 'SWMS-261386' },
  draft: null,
};

function detail(opts) {
  opts = opts || {};
  const family = opts.family || null;
  return {
    access_tier: 'allocated',
    job: {
      id: JOB, job_number: 'SWMS-261386', type: 'makesafe', status: 'scheduled',
      client_name: 'Major Loss Builders', site_address: '151 Deanmore Road', site_suburb: 'Scarborough',
      metadata: family ? { makesafe_job_family: family } : {},
    },
    crew: [{ id: 'asn-1', user_id: 'e2e-installer', users: { id: 'e2e-installer', name: 'E2E Installer' }, status: opts.asnStatus || 'confirmed', scheduled_date: '2026-09-08', hours_worked: opts.hours == null ? null : opts.hours }],
    purchaseOrders: [], notes: [], media: [],
    documents: opts.documents || [],
    makesafe_details: Object.assign({
      makesafe_type: 'Roof / tarp', substatus: 'waiting_on_trade_report', cycle_number: 1,
      external_links: [{ label: 'Builder Portal', url: 'https://prime.example.test/share/abc123', kind: 'builder_portal' }],
    }, opts.details || {}),
    serviceReport: opts.report || { status: 'draft', checklist_json: {} },
  };
}

function wire(page, state) {
  return page.route(`${OPS_API}**`, async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const body = req.method() === 'POST' ? (req.postDataJSON() || {}) : null;
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'trade_job_detail') return json(state.detail());
    if (action === 'roof_report_template') return json(Object.assign({}, TEMPLATE, { draft: state.draft }));
    if (action === 'save_roof_report') { state.log.push(['save', body]); state.draft = { status: 'draft', fields_json: body.fields }; return json({ ok: true, status: 'draft', saved: true, draft_id: 'd-1' }); }
    if (action === 'submit_roof_report') { state.log.push(['submit', body]); state.draft = { status: 'submitted', fields_json: body.fields, report_doc_id: 'doc-roof', submitted_at: new Date().toISOString() }; state.roofDoc = true; return json({ ok: true, status: 'submitted', draft_id: 'd-1', report_doc_id: 'doc-roof', file_name: 'Roof Inspection Report.pdf', board_sync: { ok: true, skipped: true, reason: 'not_report_type' } }); }
    if (action === 'log_my_job_hours') { state.log.push(['hours', body]); state.hours = body.hours; return json({ ok: true, hours: body.hours, assignment: { id: 'asn-1', status: 'complete', scheduled_date: '2026-09-08', hours_worked: body.hours }, week_ending: '2026-09-13' }); }
    if (action === 'mark_makesafe_portal_report_done') { state.log.push(['portal_done', body]); state.portalDone = true; return json({ ok: true, substatus: 'admin_to_send_report' }); }
    await route.fallback();
  });
}

async function openReport(page, persona) {
  await signIn(page, persona);
  await page.evaluate((jobId) => window.openJobReport(jobId, 'asn-1'), JOB);
  await expect(page.locator('#makesafeReportDirectContent')).toContainText(/Make-Safe Report|Roof Report|Report Submitted/);
}

test.describe('Trade app: roof report in the app + one-tap hours', () => {
  test.use({ persona: 'installer' });

  test('a normal make-safe offers the SecureWorks roof report: fill, autosave, submit, then 2 hrs on the week', async ({ appPage: page }) => {
    const state = { log: [], draft: null, hours: null, roofDoc: false };
    state.detail = () => detail({ documents: state.roofDoc ? [{ id: 'doc-roof', type: 'roof_report', visible_to_trades: true, file_name: 'roof.pdf', public_url: 'https://files.example.test/roof.pdf' }] : [], hours: state.hours });
    await wire(page, state);
    await openReport(page, PERSONAS.installer);

    const content = page.locator('#makesafeReportDirectContent');
    // The make-safe report form is untouched; the roof report is an option above it.
    await expect(content).toContainText('Make-Safe Report');
    await expect(content.locator('#msrJobType')).toBeVisible();
    const option = content.locator('#rrOption');
    await expect(option).toHaveAttribute('data-rr-state', 'none');
    await expect(option).toContainText('Need a roof report?');
    await option.locator('[data-rr-open]').click();

    const form = content.locator('#rrForm');
    await expect(form).toBeVisible();
    await expect(form).toContainText('SecureWorks roof report');
    await expect(form).toContainText('Inspection Details');
    await expect(form).toContainText('Photo Evidence');
    await expect(form).not.toContainText('$');
    // Today and the trade's name are prefilled.
    await expect(form.locator('[data-rr-field="inspection_date"]')).not.toHaveValue('');
    await expect(form.locator('[data-rr-field="inspected_by"]')).toHaveValue('E2E Installer');

    // Required check blocks an empty submit with a plain message.
    await form.locator('#rrSubmitBtn').click();
    await expect(form.locator('#rrErrors')).toContainText('Number of storeys is required');
    expect(state.log.filter((e) => e[0] === 'submit')).toHaveLength(0);

    await form.locator('[data-rr-field="storeys"]').selectOption('Single Storey');
    await form.locator('[data-rr-field="water_leak"] [data-rr-toggle="yes"]').click();
    await form.locator('[data-rr-field="overall_findings"]').fill('Cracked ridge capping, tarped.');
    // Autosave lands without a tap.
    await expect.poll(() => state.log.filter((e) => e[0] === 'save').length, { timeout: 5000 }).toBeGreaterThan(0);
    await expect(form.locator('#rrSaveState')).toHaveText('Saved');
    const saved = state.log.filter((e) => e[0] === 'save').pop()[1];
    expect(saved.job_id).toBe(JOB);
    expect(saved.fields.storeys).toBe('Single Storey');
    expect(saved.fields.water_leak).toBe(true);

    await form.locator('#rrSubmitBtn').click();
    const submitted = await expect.poll(() => (state.log.find((e) => e[0] === 'submit') || [])[1]).not.toBeUndefined().then(() => state.log.find((e) => e[0] === 'submit')[1]);
    expect(submitted.job_id).toBe(JOB);
    expect(submitted.fields.overall_findings).toBe('Cracked ridge capping, tarped.');
    expect(submitted.fields.inspected_by).toBe('E2E Installer');

    await expect(content.locator('#rrOption')).toHaveAttribute('data-rr-state', 'submitted');
    await expect(content.locator('#rrOption')).toContainText('Roof report submitted');
    await expect(content.locator('#rrOption [data-rr-pdf]')).toHaveAttribute('href', 'https://files.example.test/roof.pdf');

    // One tap: 2 hrs on the week.
    const hours = content.locator('#rrHours');
    await expect(hours).toBeVisible();
    await hours.locator('[data-rr-hour="2"]').click();
    await expect.poll(() => state.log.filter((e) => e[0] === 'hours').length).toBe(1);
    expect(state.log.find((e) => e[0] === 'hours')[1]).toMatchObject({ job_id: JOB, hours: 2 });
    await expect(content.locator('#rrHours')).toHaveAttribute('data-rr-hours-current', '2');
    await expect(content.locator('#rrHours')).toContainText('2 hrs on your week (w/e Sun 13 Sep)');
    await expect(content.locator('#rrHours [data-rr-hour="2"]')).toHaveClass(/\bon\b/);
  });

  test('a roof-report job done on the builder portal: mark done, then the hours row appears and logs 2 hrs', async ({ appPage: page }) => {
    const state = { log: [], draft: null, hours: null, portalDone: false };
    state.detail = () => detail({ family: 'roof_report', hours: state.hours, details: state.portalDone ? { portal_verified_at: '2026-09-08T02:00:00Z', portal_verified_cycle: 1 } : {} });
    await wire(page, state);
    await openReport(page, PERSONAS.installer);

    const content = page.locator('#makesafeReportDirectContent');
    await expect(content.locator('#reportDoneAskBtn')).toBeVisible();
    await expect(content.locator('#rrHours')).toHaveCount(0);
    // The in-app roof report is offered as the alternative to the portal.
    await expect(content.locator('#rrOption')).toContainText('Do the roof report in the app instead');
    await expect(content.locator('#rrOption [data-rr-open]')).toHaveText('Start roof report');

    await content.locator('#reportDoneAskBtn').click();
    await content.locator('#reportDoneYesBtn').click();
    await expect.poll(() => state.log.filter((e) => e[0] === 'portal_done').length).toBe(1);
    await expect(content).toContainText('Report completion recorded');
    await expect(content).not.toContainText('office will invoice');
    const hours = content.locator('#rrHours');
    await expect(hours).toBeVisible();
    await expect(hours).toContainText('Hours for this report');
    await hours.locator('[data-rr-hour="2"]').click();
    await expect.poll(() => state.log.filter((e) => e[0] === 'hours').length).toBe(1);
    expect(state.log.find((e) => e[0] === 'hours')[1]).toMatchObject({ job_id: JOB, hours: 2 });
    await expect(content.locator('#rrHours')).toContainText('2 hrs on your week');
  });

  test('a submitted make-safe report shows the hours row with the hours already logged, plus a custom amount', async ({ appPage: page }) => {
    const state = { log: [], draft: { status: 'draft', fields_json: { storeys: 'Double Storey' } }, hours: 3 };
    state.detail = () => detail({ hours: state.hours, asnStatus: 'complete', report: { status: 'submitted', submitted_at: '2026-09-08T01:00:00Z', checklist_json: { work_done: 'Tarped the roof', labour_hours: 3 } } });
    await wire(page, state);
    await openReport(page, PERSONAS.installer);

    const content = page.locator('#makesafeReportDirectContent');
    await expect(content).toContainText('Report Submitted');
    await expect(content.locator('#rrHours')).toHaveAttribute('data-rr-hours-current', '3');
    await expect(content.locator('#rrHours [data-rr-hour="3"]')).toHaveClass(/\bon\b/);
    await expect(content.locator('#rrOption [data-rr-open]')).toHaveText('Continue roof report');

    await content.locator('#rrHours [data-rr-hour="other"]').click();
    await content.locator('#rrHoursInput').fill('2.5');
    await content.locator('#rrHours [data-rr-hour-add]').click();
    await expect.poll(() => state.log.filter((e) => e[0] === 'hours').length).toBe(1);
    expect(state.log.find((e) => e[0] === 'hours')[1].hours).toBe(2.5);
    await expect(content.locator('#rrHours')).toHaveAttribute('data-rr-hours-current', '2.5');
    await expect(content.locator('#rrHours [data-rr-hour="other"]')).toHaveText('2.5 hrs');
  });
});
