// Matching screen (modules/ops-recon.js; backend secureworks-backend migration
// 20261020160000_context_recon_daily_list, ops-api recon_daily_list / recon_record_decision).
// Offline: opsFetch and opsPost are replaced in the page. Names are made up.
//
// Contract under guard:
//  - The Matching tab is hidden unless ?recon=1 or localStorage sw_recon = '1'.
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
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

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

async function openRecon(page, { fetchAnswer, post, url = '/ops.html', show = true, jobItems = JOB_ITEMS } = {}) {
  await page.goto(url);
  await revealOpsStaticFixture(page);
  await page.evaluate(({ data, jobItems, fetchAnswer, post, show }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__rcFetches = []; window.__rcPosts = [];
    window.opsFetch = (action, params) => {
      window.__rcFetches.push({ action, params });
      if (action === 'recon_job_items') return Promise.resolve(JSON.parse(JSON.stringify(jobItems)));
      if (action !== 'recon_daily_list') return Promise.reject(Object.assign(new Error('Unknown action'), { status: 400 }));
      if (fetchAnswer && fetchAnswer.reject) return Promise.reject(Object.assign(new Error(fetchAnswer.reject.message || ''), fetchAnswer.reject));
      return Promise.resolve(JSON.parse(JSON.stringify(data)));
    };
    window.opsPost = (action, body) => {
      window.__rcPosts.push({ action, body });
      if (post && post.reject) return Promise.reject(Object.assign(new Error(post.reject.message || ''), post.reject));
      return Promise.resolve({ recorded: true, decision_id: 1 });
    };
    if (show) showView('recon');
  }, { data: list(), jobItems, fetchAnswer, post, show });
  if (show) await expect(page.locator('#viewRecon')).toBeVisible();
}
const posts = (page) => page.evaluate(() => window.__rcPosts);
const reads = (page) => page.evaluate(() => window.__rcFetches.filter((f) => f.action === 'recon_daily_list').length);
const card = (page, id) => page.locator(`#viewRecon [data-rc-subject="${id}"]`);

test('the Matching tab is hidden until it is switched on', async ({ page }) => {
  await openRecon(page, { show: false });
  await expect(page.locator('.header-nav [data-view="recon"]')).toBeHidden();
  await page.goto('/ops.html?recon=1');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => { document.getElementById('mainApp').style.display = ''; });
  await expect(page.locator('.header-nav [data-view="recon"]')).toBeVisible();
});

test('the list shows the three bands, most at stake first', async ({ page }) => {
  await openRecon(page);
  await expect(page.locator('#viewRecon [data-rc-band]')).toHaveText([/Owed invoices with no job \(1\)/, /Messages from someone who owes us \(1\)/, /Recent customer messages \(1\)/]);
  const inv = card(page, '11111111-0000-4000-8000-000000000001');
  await expect(inv).toContainText('INV-9001');
  await expect(inv).toContainText('Pat Example');
  await expect(inv).toContainText('$1,650.00 owed');
  await expect(inv).toContainText('Waiting 21 days');
  await expect(inv.locator('[data-rc-job]')).toHaveText('It is SWF-1001 (Sampleton, accepted)');
  await expect(card(page, '22222222-0000-4000-8000-000000000002')).toContainText('They owe $400.00');
  await expect(card(page, '33333333-0000-4000-8000-000000000003')).toContainText('With Sales');
  await expect(card(page, '33333333-0000-4000-8000-000000000003')).toContainText('Is the gate going to match the fence');
});

test('an invoice tap asks once, then records correct with the hash shown', async ({ page }) => {
  await openRecon(page);
  const inv = card(page, '11111111-0000-4000-8000-000000000001');
  await inv.locator('[data-rc-job]').click();
  await expect(inv.locator('.rc-confirm')).toContainText('Record that this invoice is for SWF-1001 (Sampleton, accepted)? Finance will link it in Xero. Nothing changes in Xero from here.');
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
  await expect(msg.locator('.rc-confirm')).toContainText('belongs to SWP-2002 (Exampleby, complete)?');
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
  await expect(row.locator('.rc-confirm')).toContainText('Record that this message belongs to SWF-1001 and SWP-2002? It will show on each of them.');
  await row.locator('[data-rc-yes]').click();
  await expect.poll(async () => (await posts(page)).length).toBe(1);
  expect((await posts(page))[0]).toEqual({ action: 'recon_record_decision', body: {
    subject_kind: 'event', subject_id: '44444444-0000-4000-8000-000000000004', shown_hash: '00112233445566778899aabbccddeeff',
    action: 'split', job_ids: [JOB_A.job_id, JOB_B.job_id], cause: 'defect:no_identity',
  } });
  await page.locator('#viewRecon [data-rc-clear]').click();
  await expect(page.locator('#viewRecon [data-rc-jobband]')).toHaveCount(0);
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
