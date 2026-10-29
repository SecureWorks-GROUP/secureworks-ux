// Matching screen (modules/ops-recon.js; backend secureworks-backend migration
// 20261020160000_context_recon_daily_list, ops-api recon_daily_list / recon_record_decision).
// Offline: opsFetch and opsPost are replaced in the page. Names are made up.
//
// Contract under guard:
//  - TP-11: the tab is on by default for whoever the server lets read recon_daily_list, hidden
//    when the server refuses, off with ?recon=0 and forced on with ?recon=1.
//  - TP-11: Needs a person lists Bills to place below the daily list with the best guess, its
//    reason and which keys agreed or disagreed; Decide opens that bill in Bill Reconciliation.
//  - The list shows the three bands in order with their counts; an invoice card shows the
//    invoice, the contact, the amount owed and the wait; a message card shows its preview.
//  - A tap asks once, in words, then posts recon_record_decision with the hash and cause the
//    card was shown with, never a person; the list is read again after.
//  - A message picks a suggested job as confirm and another job (the dropdown) as correct.
//  - A changed item is refused in words and the list is read again; a non-staff read shows why.
//  - An undeployed backend reads as "not switched on yet".
//  - Find by job reads recon_job_items for a typed job number, shows rows the list leaves
//    out, and a message with two suggested jobs can be recorded on both (split).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { installOpsSessionStub, revealOpsStaticFixture } = require('../helpers/ops-auth');

const JOB_A = { job_id: 'aaaaaaaa-0000-4000-8000-000000000001', job_number: 'SWF-1001', type: 'fencing', status: 'accepted', suburb: 'Sampleton', live: true };
const JOB_B = { job_id: 'bbbbbbbb-0000-4000-8000-000000000002', job_number: 'SWP-2002', type: 'patio', status: 'complete', suburb: 'Exampleby', live: false };
function list() {
  return {
    as_of: '2026-10-20T00:00:00.000Z', limit: 50, count: 3,
    items: [
      { band: 1, band_label: 'owed_invoice_no_job', subject_kind: 'invoice', subject_id: '11111111-0000-4000-8000-000000000001', evidence_hash: '0123456789abcdef0123456789abcdef',
        amount: 1650, waiting_days: 21.4, cause: 'ambiguity:invoice_no_job', decision_state: 'undecided', last_action: null, owner: 'context_resolver',
        summary: { invoice_number: 'INV-9001', reference: 'Back fence', contact_name: 'Pat Example', total: 1650, amount_due: 1650, status: 'AUTHORISED', invoice_date: '2026-09-29', due_date: '2026-10-06' },
        offered_jobs: [JOB_A], other_jobs: [] },
      { band: 2, band_label: 'owing_contact', subject_kind: 'event', subject_id: '22222222-0000-4000-8000-000000000002', evidence_hash: 'fedcba9876543210fedcba9876543210',
        amount: 400, waiting_days: 3, cause: 'ambiguity:several_candidates', decision_state: 'undecided', last_action: null, owner: 'context_resolver',
        summary: { channel: 'sms', direction: 'inbound', occurred_at: '2026-10-17T02:00:00Z', from: 'Sam Sample', subject: null, preview: 'Can you send the invoice again please' },
        offered_jobs: [JOB_A], other_jobs: [JOB_B] },
      { band: 3, band_label: 'recent_customer_live_job', subject_kind: 'event', subject_id: '33333333-0000-4000-8000-000000000003', evidence_hash: 'aaaabbbbccccddddaaaabbbbccccdddd',
        amount: null, waiting_days: 1, cause: 'ambiguity:several_candidates', decision_state: 'decided', last_action: 'escalate', owner: 'sales',
        summary: { channel: 'email', direction: 'inbound', occurred_at: '2026-10-19T02:00:00Z', from: 'lee@example.test', subject: 'Gate height', preview: 'Is the gate going to match the fence' },
        offered_jobs: [JOB_A], other_jobs: [] },
    ],
  };
}

const JOB_ITEMS = {
  job_id: JOB_A.job_id, job_number: 'SWF-1001',
  items: [{ event_id: '44444444-0000-4000-8000-000000000004', channel: 'email', direction: 'inbound', occurred_at: '2026-10-08T09:10:21Z',
    from_address: 'orders@supplier.example', subject: 'Material Order Ref SWF-1001 & SWP-2002', preview: 'Delivery moved to Friday',
    counterpart_role: 'supplier', cause: 'defect:no_identity', decision_state: 'none', last_action: null,
    shown_hash: '00112233445566778899aabbccddeeff', offered: [{ job_id: JOB_A.job_id, job_number: 'SWF-1001' }, { job_id: JOB_B.job_id, job_number: 'SWP-2002' }] }],
};

const BILLS = {
  ok: true, status: 'open', proposals: 'ok', stats: { open: 3 },
  rows: [
    { id: 'q-small', status: 'open', xero_invoice_id: 'x-small', contact_name: 'Sample Steel', invoice_number: 'SS-11', invoice_date: '2026-10-20', sub_total: 120.5, suggestion_reason: 'no_ref_no_po' },
    { id: 'q-big', status: 'open', xero_invoice_id: 'x-big', contact_name: 'Example Timber', invoice_number: 'ET-22', invoice_date: '2026-10-21', sub_total: 980,
      proposal: { kind: 'review', rule: 'several_candidates', outcome: 'queued_for_review', candidates: [{ job_id: JOB_A.job_id, job_number: 'SWF-1001', signals: ['po_number'] }, { job_id: JOB_B.job_id, job_number: 'SWP-2002', signals: ['site_suburb'] }] } },
  ],
};
const AI_LEFT = { ok: true, view: 'left', placements: [
  { id: 'p1', xero_invoice_id: 'x-small', decision: 'job', job_number: 'SWF-1001', confidence: 0.72, reason: 'Delivery address matches the job site', outcome: 'left_for_person', second_check_status: 'disagreed', second_check: { decision: 'job', job_number: 'SWP-2002' } },
] };

async function openRecon(page, { fetchAnswer, post, url = '/ops.html', show = true, jobItems = JOB_ITEMS, data = list(), bills = null, ai = null, billsReject = null, jobs = {}, postRejectFor = {} } = {}) {
  await page.goto(url);
  await revealOpsStaticFixture(page);
  await page.evaluate(({ data, jobItems, fetchAnswer, post, show, bills, ai, billsReject, jobs, postRejectFor }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__rcFetches = []; window.__rcPosts = [];
    window.opsFetch = (action, params) => {
      window.__rcFetches.push({ action, params });
      if (action === 'recon_job_items') return Promise.resolve(JSON.parse(JSON.stringify(jobItems)));
      if (action === 'materials_recon_queue' && billsReject) return Promise.reject(Object.assign(new Error(billsReject.message || ''), billsReject));
      if (action === 'materials_recon_queue' && bills) return Promise.resolve(JSON.parse(JSON.stringify(bills)));
      if (action === 'materials_ai_placements' && ai) return Promise.resolve(JSON.parse(JSON.stringify(ai)));
      if (action === 'job_detail' && jobs[params.jobId]) return Promise.resolve(JSON.parse(JSON.stringify(jobs[params.jobId])));
      if (action === 'get_xero_invoice') return Promise.resolve({ invoice: { invoice_number: params.xero_invoice_id, line_items: [{ description: 'Posts', account_code: '310', line_amount: 120.5 }] } });
      if (action !== 'recon_daily_list') return Promise.reject(Object.assign(new Error('Unknown action'), { status: 400 }));
      if (fetchAnswer && fetchAnswer.reject) return Promise.reject(Object.assign(new Error(fetchAnswer.reject.message || ''), fetchAnswer.reject));
      return Promise.resolve(JSON.parse(JSON.stringify(data)));
    };
    window.opsPost = (action, body) => {
      window.__rcPosts.push({ action, body });
      if (post && post.reject) return Promise.reject(Object.assign(new Error(post.reject.message || ''), post.reject));
      if (postRejectFor[action]) return Promise.reject(Object.assign(new Error(postRejectFor[action].message || ''), postRejectFor[action]));
      if (/^materials_recon_/.test(action)) return Promise.resolve({ ok: true });
      return Promise.resolve({ recorded: true, decision_id: 1 });
    };
    if (show) showView('recon');
  }, { data, jobItems, fetchAnswer, post, show, bills, ai, billsReject, jobs, postRejectFor });
  if (show) await expect(page.locator('#viewRecon')).toBeVisible();
}
const posts = (page) => page.evaluate(() => window.__rcPosts);
const reads = (page) => page.evaluate(() => window.__rcFetches.filter((f) => f.action === 'recon_daily_list').length);
const card = (page, id) => page.locator(`#viewRecon [data-rc-subject="${id}"]`);

test('signed out, the tab stays hidden; ?recon=1 forces it on and ?recon=0 keeps it off', async ({ page }) => {
  await openRecon(page, { show: false });
  await expect(page.locator('.header-nav [data-view="recon"]')).toBeHidden();
  await page.goto('/ops.html?recon=1');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => { document.getElementById('mainApp').style.display = ''; });
  await expect(page.locator('.header-nav [data-view="recon"]')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('sw_recon_seen', '1'));
  await page.goto('/ops.html?recon=0');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => { document.getElementById('mainApp').style.display = ''; });
  await expect(page.locator('.header-nav [data-view="recon"]')).toBeHidden();
});

// TP-11: a signed-in boot of ops.html, every ops-api call answered here.
const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
async function bootSignedIn(page, { query = '', daily = { status: 200, body: { items: [] } } } = {}) {
  const calls = [];
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith('file://')) return route.continue();
    const m = u.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (m) calls.push(u);
    if (m && m[1] === 'recon_daily_list') return route.fulfill({ status: daily.status, contentType: 'application/json', body: JSON.stringify(daily.body) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m && m[1] === 'pipeline' ? { columns: {} } : {}) });
  });
  await page.goto(OPS_FILE + query);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  return calls;
}
const dailyReads = (calls) => calls.filter((u) => /action=recon_daily_list/.test(u));

test('TP-11: signed in as someone the server lets match, the tab is on by default', async ({ page }) => {
  const calls = await bootSignedIn(page);
  await expect(page.locator('.header-nav [data-view="recon"]')).toBeVisible();
  expect(dailyReads(calls).length).toBeGreaterThanOrEqual(1);
  expect(dailyReads(calls)[0]).toContain('limit=1');
});

test('TP-11: when the server refuses the person, the tab stays hidden', async ({ page }) => {
  const calls = await bootSignedIn(page, { daily: { status: 403, body: { error: 'forbidden', code: 'operator_access_required' } } });
  await expect.poll(() => dailyReads(calls).length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(200);
  await expect(page.locator('.header-nav [data-view="recon"]')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('sw_recon_seen'))).toBe(null);
});

test('TP-11: ?recon=0 keeps the tab off and reads nothing to decide it', async ({ page }) => {
  const calls = await bootSignedIn(page, { query: '?recon=0' });
  await page.waitForTimeout(300);
  await expect(page.locator('.header-nav [data-view="recon"]')).toBeHidden();
  expect(dailyReads(calls).length).toBe(0);
});

test('TP-11: Needs a person lists bills to place with the best guess, its reason and the keys, largest first', async ({ page }) => {
  await openRecon(page, { bills: BILLS, ai: AI_LEFT });
  await expect(page.locator('#viewRecon h2')).toHaveText('Needs a person');
  await expect(page.locator('#viewRecon [data-np-summary]')).toContainText('3 messages or invoices to match');
  await expect(page.locator('#viewRecon [data-np-summary]')).toContainText('2 bills to place ($1,100.50 ex GST)');
  await expect(page.locator('#viewRecon [data-np-band]')).toContainText('Bills to place (2)');
  await expect(page.locator('#viewRecon [data-np-bill]')).toHaveCount(2);
  const ids = await page.locator('#viewRecon [data-np-bill]').evaluateAll((els) => els.map((e) => e.getAttribute('data-np-bill')));
  expect(ids).toEqual(['q-big', 'q-small']);
  const small = page.locator('#viewRecon [data-np-bill="q-small"]');
  await expect(small).toContainText('Sample Steel');
  await expect(small).toContainText('$120.50 ex GST');
  await expect(small.locator('[data-np-guess]')).toContainText('SWF-1001 (AI, sure 72%)');
  await expect(small.locator('[data-np-reason]')).toContainText('Delivery address matches the job site');
  await expect(small.locator('[data-np-keys]')).toContainText('Disagrees: Second check disagreed: says SWP-2002');
  const big = page.locator('#viewRecon [data-np-bill="q-big"]');
  await expect(big.locator('[data-np-guess]')).toContainText('No pick: 2 possible jobs (Bill agent)');
  await expect(big.locator('[data-np-reason]')).toContainText('more than one job fits');
  await expect(big.locator('[data-np-keys]')).toContainText('SWF-1001: po number');
  // The daily list and its decision controls are still there, above the bills.
  await expect(page.locator('#viewRecon [data-rc-band]')).toHaveCount(3);
  expect(await page.evaluate(() => window.__rcPosts.length)).toBe(0);
});

test('TP-11: Decide in Bills to place opens that bill in Bill Reconciliation with its lines', async ({ page }) => {
  await openRecon(page, { bills: BILLS, ai: AI_LEFT });
  await page.locator('#viewRecon [data-np-bill="q-small"] [data-np-open]').click();
  await expect(page.locator('#subBillrecon')).toBeVisible();
  await expect(page.locator('#matReconBody [data-mrq-detail="q-small"]')).toBeVisible();
  await expect(page.locator('#matReconBody [data-mrq-detail="q-small"]')).toContainText('Posts');
  const lineReads = await page.evaluate(() => window.__rcFetches.filter((f) => f.action === 'get_xero_invoice').map((f) => f.params.xero_invoice_id));
  expect(lineReads).toEqual(['x-small']);
  expect(await page.evaluate(() => window.__rcPosts.length)).toBe(0);
});

test('TP-11: a failed bill read says so and is never counted as none', async ({ page }) => {
  await openRecon(page, { billsReject: { status: 500, message: 'boom' } });
  await expect(page.locator('#viewRecon [data-np-err]')).toContainText('could not be read');
  await expect(page.locator('#viewRecon [data-np-summary]')).toContainText('Bills to place not known');
  await expect(page.locator('#viewRecon [data-np-bill]')).toHaveCount(0);
  await expect(page.locator('#viewRecon [data-np-empty]')).toHaveCount(0);
});

test('the list shows the three bands, most at stake first', async ({ page }) => {
  await openRecon(page);
  await expect(page.locator('#viewRecon [data-rc-band]')).toHaveText([/Owed invoices with no job \(1\)/, /Messages from someone who owes us \(1\)/, /Recent customer messages \(1\)/]);
  const inv = card(page, '11111111-0000-4000-8000-000000000001');
  await expect(inv).toContainText('INV-9001');
  await expect(inv).toContainText('Pat Example');
  await expect(inv).toContainText('$1,650.00 owed');
  await expect(inv).toContainText('Waiting 21 days');
  await expect(inv.locator('[data-rc-job]')).toHaveText('It is SWF-1001 \u00b7 fencing \u00b7 Sampleton \u00b7 accepted');
  await expect(card(page, '22222222-0000-4000-8000-000000000002')).toContainText('They owe $400.00');
  await expect(card(page, '33333333-0000-4000-8000-000000000003')).toContainText('With Sales');
  await expect(card(page, '33333333-0000-4000-8000-000000000003')).toContainText('Is the gate going to match the fence');
});

test('an invoice tap asks once, then records correct with the hash shown', async ({ page }) => {
  await openRecon(page);
  const inv = card(page, '11111111-0000-4000-8000-000000000001');
  await inv.locator('[data-rc-job]').click();
  await expect(inv.locator('.rc-confirm')).toContainText('Record that this invoice is for SWF-1001 \u00b7 fencing \u00b7 Sampleton \u00b7 accepted? Finance will link it in Xero. Nothing changes in Xero from here.');
  expect(await posts(page)).toEqual([]);
  await inv.locator('[data-rc-back]').click();
  await expect(inv.locator('.rc-confirm')).toHaveCount(0);
  await inv.locator('[data-rc-job]').click();
  const before = await reads(page);
  await inv.locator('[data-rc-yes]').click();
  await expect.poll(() => reads(page)).toBe(before + 1);
  expect(await posts(page)).toEqual([{ action: 'recon_record_decision', body: {
    subject_kind: 'invoice', subject_id: '11111111-0000-4000-8000-000000000001', shown_hash: '0123456789abcdef0123456789abcdef',
    action: 'correct', job_ids: [JOB_A.job_id], cause: 'ambiguity:invoice_no_job',
  } }]);
});

test('a message: a suggested job is confirm, another job is correct, Pass to Finance escalates to finance', async ({ page }) => {
  await openRecon(page);
  const msg = card(page, '22222222-0000-4000-8000-000000000002');
  await msg.locator('[data-rc-job]').click();
  await msg.locator('[data-rc-yes]').click();
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  await msg.locator('[data-rc-other]').selectOption(JOB_B.job_id);
  await expect(msg.locator('.rc-confirm')).toContainText('belongs to SWP-2002 \u00b7 patio \u00b7 Exampleby \u00b7 complete?');
  await msg.locator('[data-rc-yes]').click();
  await expect.poll(async () => (await posts(page)).length).toBe(2);
  await msg.locator('[data-rc-kind="escalate"][data-rc-to="finance"]').click();
  await expect(msg.locator('.rc-confirm')).toContainText('Pass this message to Finance?');
  await msg.locator('[data-rc-yes]').click();
  await expect.poll(async () => (await posts(page)).length).toBe(3);
  const p = (await posts(page)).map((x) => [x.body.action, x.body.job_ids, x.body.escalate_to]);
  expect(p).toEqual([['confirm', [JOB_A.job_id], undefined], ['correct', [JOB_B.job_id], undefined], ['escalate', [], 'finance']]);
});

test('an invoice passes only to Finance; a recent message can pass to Finance too', async ({ page }) => {
  await openRecon(page);
  const inv = card(page, '11111111-0000-4000-8000-000000000001');
  await expect(inv.locator('[data-rc-kind="escalate"]')).toHaveText(['Pass to Finance']);
  await expect(inv.locator('[data-rc-to="sales"]')).toHaveCount(0);
  const recent = card(page, '33333333-0000-4000-8000-000000000003');
  await expect(recent.locator('[data-rc-kind="escalate"]')).toHaveText(['Pass to Finance', 'Pass to Sales']);
  await recent.locator('[data-rc-to="finance"]').click();
  await expect(recent.locator('.rc-confirm')).toContainText('Pass this message to Finance?');
  await recent.locator('[data-rc-yes]').click();
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  const b = (await posts(page))[0].body;
  expect([b.subject_id, b.action, b.escalate_to, b.shown_hash]).toEqual(['33333333-0000-4000-8000-000000000003', 'escalate', 'finance', 'aaaabbbbccccddddaaaabbbbccccdddd']);
});

test('a changed item is refused in words and the list is read again', async ({ page }) => {
  await openRecon(page, { post: { reject: { status: 409, code: 'evidence_changed', message: 'This item changed since it was shown.' } } });
  const inv = card(page, '11111111-0000-4000-8000-000000000001');
  await inv.locator('[data-rc-kind="unrelated"]').click();
  const before = await reads(page);
  await inv.locator('[data-rc-yes]').click();
  await expect(page.locator('#viewRecon [data-rc-msg]')).toContainText('changed since you opened the list');
  await expect.poll(() => reads(page)).toBe(before + 1);
});

test('a non-staff read and an undeployed backend are shown in words', async ({ page }) => {
  await openRecon(page, { fetchAnswer: { reject: { status: 403, code: 'operator_access_required', message: 'Operator access required' } } });
  await expect(page.locator('#viewRecon [data-rc-err]')).toHaveText('Only an admin, owner or ops manager can use this list.');
  await openRecon(page, { fetchAnswer: { reject: { status: 400, message: 'Unknown action' } } });
  await expect(page.locator('#viewRecon [data-rc-err]')).toHaveText('This list is not switched on yet.');
});

test('Find by job shows a message the list leaves out and records it on both jobs', async ({ page }) => {
  await openRecon(page);
  await page.locator('#viewRecon #rcJobNo').fill('swf-1001');
  await page.locator('#viewRecon [data-rc-find] button[type="submit"]').click();
  await expect(page.locator('#viewRecon [data-rc-jobband]')).toContainText('Waiting on SWF-1001 (1)');
  const fetched = await page.evaluate(() => window.__rcFetches.filter((f) => f.action === 'recon_job_items'));
  expect(fetched).toEqual([{ action: 'recon_job_items', params: { job_number: 'SWF-1001' } }]);
  const row = card(page, '44444444-0000-4000-8000-000000000004');
  await expect(row).toContainText('No contact on this message, so it was never matched');
  await expect(row).toContainText('Delivery moved to Friday');
  await row.locator('[data-rc-kind="split"]').click();
  await expect(row.locator('.rc-confirm')).toContainText('Record that this message belongs to SWF-1001 and SWP-2002? Any amount in it is unknown for each job: money is read from Xero only, and how a bill shared between jobs is split is on hold for Finance.');
  await row.locator('[data-rc-yes]').click();
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  expect((await posts(page))[0]).toEqual({ action: 'recon_record_decision', body: {
    subject_kind: 'event', subject_id: '44444444-0000-4000-8000-000000000004', shown_hash: '00112233445566778899aabbccddeeff',
    action: 'split', job_ids: [JOB_A.job_id, JOB_B.job_id], cause: 'defect:no_identity',
  } });
  await expect(page.locator('#viewRecon [data-rc-recorded]')).toHaveText(/^Recorded by you at \d{1,2}:\d{2}(am|pm): on SWF-1001 and SWP-2002\.$/);
  await expect(page.locator('#viewRecon [data-rc-todayband]')).toHaveText(/^Today's list/);
  await page.locator('#viewRecon [data-rc-clear]').click();
  await expect(page.locator('#viewRecon [data-rc-jobband]')).toHaveCount(0);
  await expect(page.locator('#viewRecon [data-rc-todayband]')).toHaveCount(0);
  // The recorded line stays after Find by job is cleared.
  await expect(page.locator('#viewRecon [data-rc-recorded]')).toHaveCount(1);
});

test('AC-M1: an empty daily list names what it leaves out and points to Find by job', async ({ page }) => {
  const empty = { as_of: '2026-10-20T00:00:00.000Z', limit: 50, count: 0, more: false, items: [] };
  await openRecon(page, { data: { ...empty, left_out: { no_identity: 3, never_asked: 0, not_ranked: 1, backlog: 0 }, left_out_unreadable: false } });
  const lo = page.locator('#viewRecon [data-rc-leftout]');
  await expect(lo).toHaveText("Nothing is on today's list, but 4 messages are left off it: 3 with no contact to match them by, 1 that fit no group here (nothing owed, no live job, or older than 30 days). Find by job lists everything waiting on a job you know.");
  await expect(page.locator('#viewRecon')).not.toContainText('Nothing needs matching right now.');
  await openRecon(page, { data: { ...empty, left_out: null, left_out_unreadable: true } });
  await expect(lo).toContainText('what it leaves out could not be read');
  await expect(page.locator('#viewRecon')).not.toContainText('Nothing needs matching right now.');
  await openRecon(page, { data: { ...empty, left_out: { no_identity: 0, never_asked: 0, not_ranked: 0, backlog: 0 }, left_out_unreadable: false } });
  await expect(lo).toHaveText('Nothing needs matching right now.');
  await openRecon(page, { data: { ...list(), more: false, left_out: { no_identity: 0, never_asked: 2, not_ranked: 0, backlog: 5 }, left_out_unreadable: false } });
  await expect(lo).toHaveText("Also waiting, left off today's list: 2 loaded from history and never matched, 5 captured before matching started. Find by job lists everything waiting on a job you know.");
});

test('AC-M3 to M5 and M7: Find by job shows each job in words, why it is offered, the sender and Perth time', async ({ page }) => {
  const items = JSON.parse(JSON.stringify(JOB_ITEMS));
  items.items[0].offered = [
    { job_id: JOB_A.job_id, job_number: 'SWF-1001', type: 'fencing', suburb: 'Sampleton', status: 'in_progress', reasons: ['candidate', 'job_number_in_message'] },
    { job_id: JOB_B.job_id, job_number: 'SWP-2002', type: 'patio', suburb: 'Exampleby', status: 'complete', reasons: ['job_number_in_message'] },
  ];
  await openRecon(page, { jobItems: items });
  await page.locator('#viewRecon #rcJobNo').fill('SWF-1001');
  await page.locator('#viewRecon [data-rc-find] button[type="submit"]').click();
  const row = card(page, '44444444-0000-4000-8000-000000000004');
  await expect(row.locator('[data-rc-job]').first()).toHaveText('It is SWF-1001 \u00b7 fencing \u00b7 Sampleton \u00b7 in progress');
  await expect(row.locator('[data-rc-why]')).toHaveText('Why these jobs: SWF-1001: the system listed this job as possible; the job number is in the message. SWP-2002: the job number is in the message.');
  await expect(row.locator('.rc-meta').first()).toContainText('Supplier');
  await expect(row.locator('.rc-meta').first()).toContainText('8 Oct 2026, 5:10pm');
  await expect(row).not.toContainText('in_progress');
});

test('Find by job says when a job has more than it shows, and never reads a bad answer as empty', async ({ page }) => {
  await openRecon(page, { jobItems: { ...JOB_ITEMS, more: true } });
  await page.locator('#viewRecon #rcJobNo').fill('SWF-1001');
  await page.locator('#viewRecon [data-rc-find] button[type="submit"]').click();
  await expect(page.locator('#viewRecon [data-rc-jobmore]')).toHaveText('Showing the newest 1. Older ones on SWF-1001 are not shown here yet.');
  await openRecon(page, { jobItems: { job_number: 'SWF-1001' } });
  await page.locator('#viewRecon #rcJobNo').fill('SWF-1001');
  await page.locator('#viewRecon [data-rc-find] button[type="submit"]').click();
  await expect(page.locator('#viewRecon [data-rc-joberr]')).toHaveText('Something went wrong. Please try again.');
  await expect(page.locator('#viewRecon [data-rc-jobempty]')).toHaveCount(0);
});

test('the daily list says when it was cut, and never reads a bad answer as nothing to match', async ({ page }) => {
  await openRecon(page, { data: { ...list(), more: true } });
  await expect(page.locator('#viewRecon [data-rc-more]')).toHaveText('Showing the first 3, most urgent first. There are more waiting; they show here as these are matched.');
  await openRecon(page, { data: { ...list(), more: false } });
  await expect(page.locator('#viewRecon [data-rc-band]').first()).toBeVisible();
  await expect(page.locator('#viewRecon [data-rc-more]')).toHaveCount(0);
  await openRecon(page, { data: { as_of: '2026-10-20T00:00:00.000Z', limit: 50 } });
  await expect(page.locator('#viewRecon [data-rc-err]')).toHaveText('Something went wrong. Please try again.');
  await expect(page.locator('#viewRecon')).not.toContainText('Nothing needs matching right now.');
});

test('AC-M6: Open the original shows an email with its files, a call with no words, and a refusal in words', async ({ page }) => {
  await openRecon(page);
  await page.evaluate(() => {
    const before = window.opsFetch;
    window.opsFetch = (action, params) => {
      if (action !== 'context_message_original') return before(action, params);
      window.__rcFetches.push({ action, params });
      const id = params && params.event_id;
      if (id === '33333333-0000-4000-8000-000000000003') {
        return Promise.resolve({ event_id: id, kind: 'email', direction: 'inbound', at: '2026-10-19T02:00:00Z', read_only: true,
          email: { subject: 'Gate height', from: 'lee@example.test', to: ['fencing@secureworkswa.com.au'], cc: [], mailbox: 'fencing@secureworkswa.com.au',
            body: 'Subject: Gate height\n\nIs the gate going to match the fence height out the back?', body_source: 'message' },
          attachments: { read: 'ok', items: [{ file_name: 'plans.pdf', size_bytes: 120000, saved: true, status: 'stored', status_words: 'Saved' }],
            copies_not_listed: 0, more_not_listed: false, on_message: 1, files: 'not_available',
            files_note: 'Opening the file itself is not available yet: the files are kept private.' } });
      }
      return Promise.resolve({ event_id: id, kind: 'call', direction: 'inbound', at: '2026-10-17T02:00:00Z', read_only: true,
        call: { duration_seconds: 184, status: 'completed', line: '+61489267771', words_shown: false, words_note: 'Call words are not shown here.',
          where_to_listen: 'In GoHighLevel: open this contact\'s conversation and play the call at this time.' } });
    };
  });
  const email = card(page, '33333333-0000-4000-8000-000000000003');
  await email.getByRole('button', { name: 'Open the original' }).click();
  const panel = email.locator('[data-rc-orig]');
  await expect(panel.locator('[data-rc-orig-body]')).toContainText('match the fence height out the back');
  await expect(panel).toContainText('lee@example.test');
  await expect(panel.locator('[data-rc-orig-files]')).toContainText('plans.pdf');
  await expect(panel.locator('[data-rc-orig-files]')).toContainText('Opening the file itself is not available yet');
  await expect(panel.locator('a')).toHaveCount(0);
  await expect(email.getByRole('button', { name: 'Close the original' })).toBeVisible();

  const call = card(page, '22222222-0000-4000-8000-000000000002');
  await call.getByRole('button', { name: 'Open the original' }).click();
  const cp = call.locator('[data-rc-orig]');
  await expect(cp.locator('[data-rc-orig-callnote]')).toHaveText('Call words are not shown here.');
  await expect(cp).toContainText('3 min 4 s');
  await expect(cp.locator('[data-rc-orig-listen]')).toContainText('In GoHighLevel');
  await expect(cp.locator('[data-rc-orig-body]')).toHaveCount(0);

  // Close, then a refusal from the staff-only door reads in words.
  await call.getByRole('button', { name: 'Close the original' }).click();
  await expect(call.locator('[data-rc-orig]')).toHaveCount(0);
  await page.evaluate(() => {
    window.opsFetch = (action) => action === 'context_message_original'
      ? Promise.reject(Object.assign(new Error('Forbidden'), { status: 403, code: 'operator_access_required' }))
      : Promise.reject(new Error('no'));
  });
  await call.getByRole('button', { name: 'Open the original' }).click();
  await expect(call.locator('[data-rc-orig-err]')).toHaveText('Only an admin, owner or ops manager can use this list.');
  expect(await posts(page)).toEqual([]);
});

// TP-11 slice 2: bills are decided on their card, with Bill Reconciliation's own panel and checks.
const JOB_C = { job_id: 'cccccccc-0000-4000-8000-000000000003', job_number: 'SWP-3003' };
const FOUR_BILLS = {
  ok: true, status: 'open', proposals: 'ok', stats: { open: 4, open_total_ex: 2600, assigned: 0, not_job_related: 0 },
  rows: [
    { id: 'q-sugg', status: 'open', xero_invoice_id: 'x-sugg', contact_name: 'Sample Steel', invoice_number: 'SS-1', invoice_date: '2026-10-20', sub_total: 1000,
      suggested_job_id: JOB_A.job_id, suggested_job_number: 'SWF-1001', suggestion_reason: 'no_po_match' },
    { id: 'q-ai', status: 'open', xero_invoice_id: 'x-ai', contact_name: 'Example Timber', invoice_number: 'ET-2', invoice_date: '2026-10-21', sub_total: 800 },
    { id: 'q-file', status: 'open', xero_invoice_id: 'x-file', contact_name: 'Office Supplies Co', invoice_number: 'OS-3', invoice_date: '2026-10-22', sub_total: 500 },
    { id: 'q-keep', status: 'open', xero_invoice_id: 'x-keep', contact_name: 'Later Bills Ltd', invoice_number: 'LB-4', invoice_date: '2026-10-23', sub_total: 300 },
  ],
};
const FOUR_AI = { ok: true, view: 'left', placements: [
  { id: 'p-ai', xero_invoice_id: 'x-ai', decision: 'job', job_id: JOB_C.job_id, job_number: 'SWP-3003', confidence: 0.81, reason: 'Delivery address is the job site', outcome: 'left_for_person' },
] };
const JOBS = {
  [JOB_A.job_id]: { job: { id: JOB_A.job_id, job_number: 'SWF-1001', client_name: 'Pat Example', type: 'fencing', status: 'accepted' }, xero_project: { project_name: 'SWF-1001', total_expenses: 0 } },
  [JOB_C.job_id]: { job: { id: JOB_C.job_id, job_number: 'SWP-3003', client_name: 'Lee Sample', type: 'patio', status: 'accepted' }, xero_project: null },
};
const billCard = (page, id) => page.locator(`#viewRecon [data-np-bill="${id}"]`);
async function decide(page, id) {
  await billCard(page, id).locator('[data-np-decide]').click();
  // The bill's lines are read before anything can be placed, as in Bill Reconciliation.
  await expect(billCard(page, id).locator('[data-np-detail] [data-mrq-line]')).toHaveCount(1);
}
const billPosts = (page) => page.evaluate(() => window.__rcPosts.filter((p) => /^materials_recon_/.test(p.action)).map((p) => ({ action: p.action, body: p.body })));

test('TP-11: the bookkeeper clears several bills in a row on the list, with the same checks as Bill Reconciliation', async ({ page }) => {
  await openRecon(page, { bills: FOUR_BILLS, ai: FOUR_AI, jobs: JOBS });
  const summary = page.locator('#viewRecon [data-np-summary]');
  await expect(summary).toContainText('4 bills to place ($2,600.00 ex GST)');

  // 1. Use the suggestion: an empty Xero Project, so one press places it.
  await decide(page, 'q-sugg');
  await billCard(page, 'q-sugg').locator('[data-mrq-act="usesuggest"]').click();
  await expect(billCard(page, 'q-sugg').locator('[data-mrq-project="empty"]')).toBeVisible();
  await billCard(page, 'q-sugg').locator('[data-mrq-act="place"]').click();
  await expect(billCard(page, 'q-sugg')).toHaveCount(0);
  await expect(summary).toContainText('3 bills to place ($1,600.00 ex GST)');
  await expect(page.locator('#viewRecon [data-np-done]').first()).toContainText('placed on SWF-1001');

  // 2. Pick the AI's guess: its Xero Project cannot be confirmed, so Place takes two presses.
  await decide(page, 'q-ai');
  await billCard(page, 'q-ai').locator('[data-np-aipick]').click();
  await expect(billCard(page, 'q-ai').locator('[data-mrq-project="unconfirmed"]')).toBeVisible();
  const place = billCard(page, 'q-ai').locator('[data-mrq-act="place"]');
  await place.click();
  await expect(place).toContainText('Confirm: place on SWP-3003 without Xero Projects');
  expect((await billPosts(page)).length).toBe(1);
  await page.waitForTimeout(750);
  await place.click();
  await expect(billCard(page, 'q-ai')).toHaveCount(0);
  await expect(summary).toContainText('2 bills to place ($800.00 ex GST)');

  // 3. Not job related: the first press arms, a second press after the gap files it.
  await decide(page, 'q-file');
  const notjob = billCard(page, 'q-file').locator('[data-mrq-act="notjob"]');
  // A double-click (two presses inside the gap) only arms, so it never files.
  await page.evaluate(() => {
    const q = () => document.querySelector('#viewRecon [data-np-bill="q-file"] [data-mrq-act="notjob"]');
    q().click(); q().click();
  });
  await expect(billCard(page, 'q-file').locator('[data-mrq-notjob-armed]')).toBeVisible();
  expect((await billPosts(page)).length).toBe(2);
  await page.waitForTimeout(750);
  await notjob.click();
  await expect(billCard(page, 'q-file')).toHaveCount(0);
  await expect(summary).toContainText('1 bill to place ($300.00 ex GST)');

  expect(await billPosts(page)).toEqual([
    { action: 'materials_recon_assign', body: { queue_id: 'q-sugg', use_suggestion: true } },
    { action: 'materials_recon_assign', body: { queue_id: 'q-ai', job_id: JOB_C.job_id } },
    { action: 'materials_recon_not_job_related', body: { queue_id: 'q-file' } },
  ]);
  // Never left the list: the Matching view is still the one on screen.
  await expect(page.locator('#viewRecon')).toBeVisible();
  await expect(page.locator('#subBillrecon')).toBeHidden();
  await expect(billCard(page, 'q-keep')).toBeVisible();
  // The message cards are still there, untouched.
  await expect(page.locator('#viewRecon [data-rc-band]')).toHaveCount(3);
  expect(await page.evaluate(() => window.__rcPosts.filter((p) => p.action === 'recon_record_decision').length)).toBe(0);
});

test('TP-11: a refused bill write is shown as refused on its card, and the bill stays', async ({ page }) => {
  await openRecon(page, { bills: FOUR_BILLS, ai: FOUR_AI, jobs: JOBS,
    postRejectFor: { materials_recon_assign: { status: 409, message: 'bill x-sugg is split across jobs; change it with Split, not a single placement' } } });
  const summary = page.locator('#viewRecon [data-np-summary]');
  await decide(page, 'q-sugg');
  await billCard(page, 'q-sugg').locator('[data-mrq-act="usesuggest"]').click();
  await expect(billCard(page, 'q-sugg').locator('[data-mrq-project="empty"]')).toBeVisible();
  await billCard(page, 'q-sugg').locator('[data-mrq-act="place"]').click();
  await expect(billCard(page, 'q-sugg').locator('[data-mrq-err]')).toContainText('Not placed: bill x-sugg is split across jobs');
  await expect(billCard(page, 'q-sugg').locator('[data-mrq-err-next]')).toContainText('still on this list');
  await expect(billCard(page, 'q-sugg')).toHaveCount(1);
  await expect(summary).toContainText('4 bills to place ($2,600.00 ex GST)');
  await expect(page.locator('#viewRecon [data-np-done]')).toHaveCount(0);
});

test('TP-11: a bill job search typed on the card is the one searched', async ({ page }) => {
  await openRecon(page, { bills: FOUR_BILLS, ai: FOUR_AI, jobs: JOBS });
  await page.evaluate(() => {
    const prev = window.opsFetch;
    window.opsFetch = (action, params) => {
      if (action === 'search_jobs') { window.__rcFetches.push({ action, params }); return Promise.resolve({ results: [{ id: 'cccccccc-0000-4000-8000-000000000003', job_number: 'SWP-3003', client_name: 'Lee Sample' }] }); }
      return prev(action, params);
    };
  });
  await decide(page, 'q-keep');
  const box = billCard(page, 'q-keep').locator('[data-mrq-q="q-keep"]');
  await box.fill('SWP-3003');
  await billCard(page, 'q-keep').locator('[data-mrq-act="find"]').click();
  await expect(billCard(page, 'q-keep').locator('[data-mrq-act="pick"]')).toContainText('SWP-3003');
  const q = await page.evaluate(() => window.__rcFetches.filter((f) => f.action === 'search_jobs').map((f) => f.params.q));
  expect(q).toEqual(['SWP-3003']);
  await expect(box).toHaveValue('SWP-3003');
});
