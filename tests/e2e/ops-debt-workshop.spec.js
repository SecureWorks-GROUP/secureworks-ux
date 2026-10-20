// Debt Workshop screen (docs/debt-workshop.md; contract secureworks-wiki
// coding/capabilities/debt-follow-up/debt-workshop-spec.md section 9).
// Offline: ops-api is replaced by tests/fixtures/debt-workshop.js (made-up names, dates from
// today's Perth date). An action missing from the stub answers "Unknown action", exactly as
// ops-api does before the backend deploys.
//
// Contract under guard:
//  - The Debt tab is hidden unless ?debt=1, localStorage sw_debt_ws = '1', or tab_visible.
//  - W1: the donut and legend (by amount) pick the list; job type filters change both; rows show
//    the payer label (with "(neighbour of X)"), a job type badge, the invoice, the day, the
//    amount and the next step (orange when a draft is ready); a notice marker when flag_count > 0.
//  - Insurance shows company rows with statement status, Preview (statement in a modal) and
//    Approve (disabled with the reason when sending is off or there is no email).
//  - Bad debt shows Jan's visit list with Remove; the footer opens Paid this week and Needs a look.
//  - Total owed to us (20 Oct 2026) sits under the chart: the backend's lines, which add up to
//    it, each opening its invoices; "Matches Xero" or which invoices differ; drafts not in the
//    total. It posts nothing, and an older backend shows no card.
//  - W2: status strip with the ladder; story, money and documents (opened in a modal); agent
//    notices with Dismiss; a move card; a Link contact card; notes with a promise date.
//  - The chat window (approved 16 Oct 2026): a bar with who we text, "Texts go from 771", the
//    invoice, amount and day, and two chips (the payer only, or everyone on the job); the thread
//    oldest first with transcripts folded, emails marked read only, notes as yellow lines; the
//    reply box with the proposed step's text typed in word for word, a green "Proposed: ..."
//    label, Put the proposed text back, Add a note, Send text, Skip this step and Why this one;
//    Send disabled while sending is off; a possible payment offers Send anyway; Write my own
//    text instead posts a manual text (step "manual" with a client_ref); when nothing may go,
//    why in words in place of the box.
//  - Owner-only controls are disabled for staff; refusals are shown in plain words.
//  - An undeployed backend reads as a calm "not switched on yet".
//  - The debt report: "Debt report" (top right) opens the live report as its own view, read
//    fresh; Download PDF saves the backend's PDF; Send to Marnin is owner only, asks first, then
//    posts debt_ws_report_send and shows "Last sent"; refusals in words.
// Screenshots: DEBT_WS_EVIDENCE_DIR=docs/evidence/<folder> npx playwright test tests/e2e/ops-debt-workshop.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { buildDebtWorkshopFixture } = require('../fixtures/debt-workshop');

const EVIDENCE_DIR = process.env.DEBT_WS_EVIDENCE_DIR
  ? path.resolve(process.cwd(), process.env.DEBT_WS_EVIDENCE_DIR)
  : path.resolve(__dirname, '../../test-results/ops-debt-workshop');
function shotPath(name) { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); return path.join(EVIDENCE_DIR, name); }
// Evidence only: hide the page's own fixed chrome so it does not float over the element shot.
async function shot(page, name, selector = '#viewDebt') {
  await page.evaluate(() => {
    const keep = document.getElementById('viewDebt');
    document.querySelectorAll('body *').forEach((el) => {
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'sticky') && !el.contains(keep) && !keep.contains(el) && el.id !== 'dwModal' && !el.closest('#dwModal')) el.style.visibility = 'hidden';
    });
    document.body.style.paddingTop = '0';
  });
  await page.locator(selector).screenshot({ path: shotPath(name) });
}

test.use({ viewport: { width: 1360, height: 1000 } });

// Opens ops.html with the stubbed API. posts: { action: { resolve } | { reject: {message, code, status, body} } }.
async function openDebt(page, { fixture = buildDebtWorkshopFixture(), drop = [], posts = {}, url = '/ops.html', show = true } = {}) {
  await page.goto(url);
  await revealOpsStaticFixture(page);
  await page.evaluate(({ fixture, drop, posts, show }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__dwPosts = []; window.__dwFetches = []; window.__dwPostAnswers = posts;
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const unknown = () => { const e = new Error('Unknown action'); e.status = 400; return Promise.reject(e); };
    window.opsFetch = (action, params) => {
      window.__dwFetches.push({ action, params });
      if (drop.indexOf(action) >= 0) return unknown();
      const p = params || {};
      const found = {
        debt_ws_overview: fixture.overview,
        debt_ws_job: p.conversation === 'all' && fixture.jobsAll && fixture.jobsAll[p.xero_invoice_id] ? fixture.jobsAll[p.xero_invoice_id] : fixture.jobs[p.xero_invoice_id],
        debt_ws_jan_list: fixture.janList,
        debt_ws_statement_preview: fixture.statements[p.company_key],
        debt_ws_document: fixture.documents[p.document_id],
        get_invoice_pdf: fixture.invoicePdf,
        debt_ws_report: fixture.report,
        debt_ws_report_pdf: fixture.reportPdf,
      }[action];
      return found ? Promise.resolve(clone(found)) : unknown();
    };
    window.opsPost = (action, body) => {
      window.__dwPosts.push({ action, body });
      if (drop.indexOf(action) >= 0) return unknown();
      const a = (window.__dwPostAnswers || {})[action];
      if (a && a.reject) { const e = new Error(a.reject.message || ''); Object.assign(e, a.reject); return Promise.reject(e); }
      return Promise.resolve(clone((a && a.resolve) || { ok: true }));
    };
    if (show) showView('debt');
  }, { fixture, drop, posts, show });
  if (show) await expect(page.locator('#viewDebt')).toBeVisible();
}
const posts = (page) => page.evaluate(() => window.__dwPosts);
const fixtureCasey = () => { const f = buildDebtWorkshopFixture(); return f.jobs[f.ids.casey]; };
function rowByName(page, name) { return page.locator('#dwList .dw-row').filter({ hasText: name }); }
async function openJob(page, name, cat) {
  if (cat) await page.locator('#dwLegend .dw-lg', { hasText: cat }).click();
  await rowByName(page, name).click();
  await expect(page.locator('#dwStrip')).toContainText(name);
}

test('the Debt tab is hidden until it is switched on', async ({ page }) => {
  await openDebt(page, { show: false });
  await expect(page.locator('.header-nav [data-view="debt"]')).toBeHidden();
  // tab_visible from a quiet overview read reveals it
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { tab_visible: true } });
  await page.evaluate((ov) => { window.opsFetch = () => Promise.resolve(ov); return debtWsProbeVisibility(); }, fixture.overview);
  await expect(page.locator('.header-nav [data-view="debt"]')).toBeVisible();
  // a failed read later keeps the tab as last seen (it never comes and goes)
  const failRead = () => { window.opsFetch = () => Promise.reject(Object.assign(new Error('Unknown action'), { status: 400 })); return debtWsProbeVisibility(); };
  await page.evaluate(failRead);
  await expect(page.locator('.header-nav [data-view="debt"]')).toBeVisible();
  // tab_visible false hides it and forgets it
  const off = buildDebtWorkshopFixture(undefined, { settings: { tab_visible: false } });
  await page.evaluate((ov) => { window.opsFetch = () => Promise.resolve(ov); return debtWsProbeVisibility(); }, off.overview);
  await expect(page.locator('.header-nav [data-view="debt"]')).toBeHidden();
  // with nothing remembered, a failed read keeps it hidden
  await page.evaluate(failRead);
  await expect(page.locator('.header-nav [data-view="debt"]')).toBeHidden();
});

test('?debt=1 and the browser flag show the tab', async ({ page }) => {
  await page.goto('/ops.html?debt=1');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => { document.getElementById('mainApp').style.display = ''; });
  await expect(page.locator('.header-nav [data-view="debt"]')).toBeVisible();
  await page.addInitScript(() => { try { localStorage.setItem('sw_debt_ws', '1'); } catch (e) {} });
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(() => { document.getElementById('mainApp').style.display = ''; });
  await expect(page.locator('.header-nav [data-view="debt"]')).toBeVisible();
});

test('W1: donut and legend pick the list; rows say who, what, how late and what next', async ({ page }) => {
  await openDebt(page);
  await expect(page.locator('#dwDonut circle.seg')).toHaveCount(5);
  await expect(page.locator('#dwSendingState')).toHaveText('Sending off');
  // Active by default: the first category with money in it, a ready draft in orange first.
  await expect(page.locator('#dwListTitle')).toHaveText('Active');
  await expect(page.locator('#dwList .dw-row')).toHaveCount(2);
  const avery = rowByName(page, 'Avery Lin');
  await expect(avery.locator('.dw-nx.ready')).toHaveText('Day 1 text ready');
  await expect(avery.locator('.dw-jt')).toHaveText('FENCING');
  await expect(avery).toContainText('no GHL contact');
  await expect(rowByName(page, 'Jordan Pike').locator('.dw-nx')).toHaveText(/Day 7 text \+ call on /);
  await expect(rowByName(page, 'Jordan Pike').locator('.dw-jt')).toHaveText('PATIO');
  // The legend picks the list; the donut segment does too.
  await page.locator('#dwLegend .dw-lg', { hasText: 'Escalating' }).click();
  await expect(page.locator('#dwListTitle')).toHaveText('Escalating');
  await expect(rowByName(page, 'Riley Shaw')).toContainText('Riley Shaw (neighbour of Taylor Brooks)');
  await expect(rowByName(page, 'Casey Morgan')).toContainText('day 12');
  await expect(rowByName(page, 'Casey Morgan')).toContainText('$1,420.37');
  await expect(rowByName(page, 'Casey Morgan').locator('.dw-flagm')).toHaveText('1 notice');
  await expect(rowByName(page, 'Sasha Cole').locator('.dw-nx.ready')).toHaveText('Suggestion ready');
  await expect(page.locator('#dwList')).toContainText('Coastline Building Group');
  await page.locator('#dwDonut circle.seg[data-k="rectification"]').dispatchEvent('click'); // the arc, not the hole in the middle
  await expect(page.locator('#dwListTitle')).toHaveText('Rectification');
  await expect(rowByName(page, 'Morgan Reid').locator('.dw-nx')).toHaveText('Waiting on the fix');
  // Job type filter: Fencing only.
  await page.locator('.dw-chip', { hasText: 'Fencing' }).click();
  await expect(page.locator('#dwTotal')).toHaveText('$7,488');
  await expect(page.locator('#dwList .dw-empty')).toHaveText('Nothing waiting on a fix.');
  await page.locator('.dw-chip', { hasText: 'All jobs' }).click();
  await page.locator('#dwLegend .dw-lg', { hasText: 'Active' }).click();
  await shot(page, '01-overview.png');
});

test('W1 footer: paid this week, needs a look with reasons, not due yet greyed', async ({ page }) => {
  await openDebt(page);
  await expect(page.locator('#dwPaid')).toContainText('$4,210.40 from 3 invoices');
  await page.locator('#dwPaid .dw-link').click();
  await expect(page.locator('#dwModal')).toContainText('Charlie Webb');
  await page.keyboard.press('Escape');
  await expect(page.locator('#dwModal')).toHaveCount(0);
  await page.locator('#dwLook .dw-link').click();
  await expect(page.locator('#dwModal')).toContainText('looks like a duplicate');
  await expect(page.locator('#dwModal')).toContainText('not linked to a job');
  await page.locator('#dwModal [data-dw="modal-close"]').click();
  await expect(page.locator('#dwNotDue')).toHaveClass(/grey/);
  await expect(page.locator('#dwNotDue')).toContainText('$6,200.00 from 2 invoices');
  await page.locator('#dwNotChased .dw-link').click();
  await expect(page.locator('#dwModal')).toContainText('Example Trade Services');
});

test('W1: Total owed to us sits under the chart; its lines add up, open their invoices, and say Matches Xero', async ({ page }) => {
  await openDebt(page);
  const owed = page.locator('#dwOwed');
  await expect(owed).toBeVisible();
  // Directly under the chart, before the list.
  const chart = await page.locator('.dw-ov').boundingBox();
  const card = await owed.boundingBox();
  const list = await page.locator('#dwList').boundingBox();
  expect(card.y).toBeGreaterThanOrEqual(chart.y + chart.height - 1);
  expect(list.y).toBeGreaterThanOrEqual(card.y + card.height - 1);
  // The chart and its figure are unchanged.
  await expect(page.locator('#dwTotal')).toHaveText('$20,140');
  await expect(page.locator('#dwOwedTotal')).toHaveText('$30,998.60');
  await expect(owed).toContainText('20 open invoices');
  const line = (k) => page.locator('#dwOwedLines [data-dw="owed"][data-k="' + k + '"]');
  await expect(line('debt')).toContainText('$20,139.85');
  await expect(line('debt')).toContainText('13 invoices');
  await expect(line('not_due')).toContainText('$5,900.00');
  await expect(line('companies')).toContainText('Companies on statements');
  await expect(line('deposits')).toContainText('$2,500.00');
  await expect(line('not_chased')).toContainText('Example Trade Services');
  await expect(line('needs_a_look')).toContainText('$1,292.50');
  // A line with nothing in it is shown at $0.00 and does not open.
  await expect(line('progress')).toBeDisabled();
  // Each line opens the invoices in it.
  await line('companies').click();
  await expect(page.locator('#dwModal')).toContainText('Northside Strata Services');
  await expect(page.locator('#dwModal')).toContainText('INV-9304');
  await page.locator('#dwModal [data-dw="modal-close"]').click();
  await line('debt').click();
  await expect(page.locator('#dwModal li')).toHaveCount(13);
  await page.keyboard.press('Escape');
  // The check against Xero, and the drafts that are not in the total.
  await expect(page.locator('#dwXeroCheck')).toHaveClass(/ok/);
  await expect(page.locator('#dwXeroCheck')).toContainText('Matches Xero');
  await expect(page.locator('#dwXeroCheck')).toContainText('checked 6:49am');
  await expect(page.locator('#dwDrafts')).toHaveText('Drafts not sent: 3 invoices, $4,120.00. Not in the total.');
  // With a job type filter, the chart narrows but the total stays all jobs, and says so.
  await page.locator('[data-dw="jt"][data-k="patio"]').click();
  await expect(page.locator('#dwOwedTotal')).toHaveText('$30,998.60');
  await expect(line('debt')).toContainText('All jobs. The chart above shows patio only');
  await shot(page, '20-total-owed.png', '#dwOwed');
  // Nothing was posted: the card only reads.
  expect(await posts(page)).toEqual([]);
});

test('W1: Does not match Xero names the invoices and lists them; an older backend shows no card', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { xeroCheck: {
    status: 'differs', words: 'Does not match Xero: 2 invoices differ (INV-0034, INV-0177)', differ_count: 2,
    xero: { count: 22, amount: 32085.08 },
    differences: [
      { invoice_number: 'INV-0034', contact_name: 'Sample Client', xero_amount_due: 734.48, copy_amount_due: null, words: 'Xero says $734.48 is owed; our copy says deleted' },
      { invoice_number: 'INV-0177', contact_name: 'Another Client', xero_amount_due: 352, copy_amount_due: null, words: 'Xero says $352.00 is owed; our copy says deleted' },
    ],
  } });
  await openDebt(page, { fixture });
  const check = page.locator('#dwXeroCheck');
  await expect(check).toHaveClass(/warn/);
  await expect(check).toContainText('Does not match Xero: 2 invoices differ (INV-0034, INV-0177)');
  await check.click();
  await expect(page.locator('#dwModal')).toContainText('INV-0034');
  await expect(page.locator('#dwModal')).toContainText('our copy says deleted');
  await expect(page.locator('#dwModal')).toContainText('Xero says $32,085.08 across 22 invoices');
  await page.locator('#dwModal [data-dw="modal-close"]').click();
  // An older backend sends no total_owed: the tab reads exactly as before.
  const old = buildDebtWorkshopFixture();
  delete old.overview.total_owed; delete old.overview.xero_check;
  await openDebt(page, { fixture: old });
  await expect(page.locator('#dwTotal')).toHaveText('$20,140');
  await expect(page.locator('#dwOwed')).toHaveCount(0);
});

test('Insurance: company statements with Preview and Approve, each refusal said plainly', async ({ page }) => {
  await openDebt(page);
  await page.locator('.dw-chip', { hasText: 'Insurance' }).click();
  await expect(page.locator('#dwListTitle')).toHaveText('Company statements');
  await expect(page.locator('#dwList .dw-co')).toHaveCount(3);
  await expect(page.locator('#dwList .dw-co').first()).toContainText('Harbour Restoration'); // biggest past due first
  const harbour = page.locator('.dw-co', { hasText: 'Harbour Restoration' });
  await expect(harbour.locator('.dw-nx')).toHaveText('Statement ready');
  await expect(harbour.locator('[data-dw="approve"]')).toBeDisabled();
  await expect(harbour.locator('.why')).toHaveText('Sending is off until you switch it on');
  const coast = page.locator('.dw-co', { hasText: 'Coastline' });
  await expect(coast.locator('.dw-nx')).toHaveText('No accounts email set');
  await expect(coast.locator('.why')).toHaveCount(0); // said once, not twice
  await harbour.locator('[data-dw="preview"].dw-btn').click();
  await expect(page.locator('#dwModal .to')).toContainText('accounts@harbour.example');
  await expect(page.locator('#dwModal iframe[sandbox]')).toHaveAttribute('srcdoc', /Statement for Harbour Restoration/);
  await page.locator('#dwModal [data-dw="modal-close"]').click();
  await shot(page, '07-insurance.png');
});

test('Insurance: with sending on, Approve sends the statement', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  await openDebt(page, { fixture, posts: { debt_ws_statement_send: { resolve: { ok: true, to_email: 'accounts@harbour.example' } } } });
  await page.locator('.dw-chip', { hasText: 'Insurance' }).click();
  const harbour = page.locator('.dw-co', { hasText: 'Harbour Restoration' });
  await harbour.locator('[data-dw="approve"]').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_statement_send').map((p) => p.body.company_key)).toEqual([fixture.ids.harbour]);
  // A refusal reads in words on the row.
  await page.evaluate(() => { window.__dwPostAnswers.debt_ws_statement_send = { reject: { message: 'This week\'s statement was already sent', status: 409, code: 'already_sent' } }; });
  await harbour.locator('[data-dw="approve"]').click();
  await expect(harbour.locator('.dw-refuse')).toHaveText('This was already sent, so it was not sent again.');
});

test('Insurance: a statement refused for a possible payment lists the invoices and offers Send anyway', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  const refusal = { message: 'There may already be a payment for INV-9301. Match it in Xero, or send anyway', status: 409, code: 'possible_payment',
    body: { ok: false, code: 'possible_payment', possible_payments: [{ xero_invoice_id: fixture.ids.harbourInvoice, invoice_number: 'INV-9301', possible_payments: [{ bank_transaction_id: 'b1', date: fixture.overview.paid_this_week.items[0].paid_on, amount: 1332.1, payer_text: 'HARBOUR RESTO', reason: 'amount matches' }] }] } };
  await openDebt(page, { fixture, posts: { debt_ws_statement_send: { reject: refusal } } });
  await page.locator('.dw-chip', { hasText: 'Insurance' }).click();
  const harbour = page.locator('.dw-co', { hasText: 'Harbour Restoration' });
  await harbour.locator('[data-dw="approve"]').click();
  const warn = harbour.locator('[data-stmt-possible]');
  await expect(warn).toContainText('INV-9301: $1,332.10');
  await expect(warn).toContainText('from HARBOUR RESTO');
  await page.evaluate(() => { window.__dwPostAnswers.debt_ws_statement_send = { resolve: { ok: true, sent: true, to_email: 'accounts@harbour.example' } }; });
  await warn.locator('[data-dw="approve-anyway"]').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_statement_send').map((p) => p.body)).toEqual([
    { company_key: fixture.ids.harbour }, { company_key: fixture.ids.harbour, override_possible_payment: true },
  ]);
  await expect(page.locator('[data-stmt-possible]')).toHaveCount(0);
});

test('Bad debt shows Jan\'s visit list with Remove', async ({ page }) => {
  await openDebt(page);
  await page.locator('#dwLegend .dw-lg', { hasText: 'Bad debt' }).click();
  await expect(page.locator('#dwJan')).toContainText('2 people');
  await expect(page.locator('#dwJan')).toContainText('Open. Locks Friday 9am');
  await expect(page.locator('#dwJan .dw-jan-p')).toHaveCount(2);
  await expect(page.locator('#dwJan')).toContainText('Texted 1st, 3rd, 7th, 12th, 17th');
  await expect(page.locator('#dwList')).toContainText('Harbour Restoration Pty Ltd');
  await shot(page, '08-bad-debt-jan-list.png');
  await page.locator('#dwJan .dw-jan-p', { hasText: 'Drew Ellis' }).locator('[data-dw="jan-remove"]').click();
  const fixture = buildDebtWorkshopFixture();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_jan_list_remove').map((p) => p.body.share_key)).toEqual([fixture.ids.drew]);
});

test('Jan\'s list: Remove still works once locked, and stops once it is sending or sent', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture();
  fixture.janList.status = 'locked';
  await openDebt(page, { fixture });
  await page.locator('#dwLegend .dw-lg', { hasText: 'Bad debt' }).click();
  await expect(page.locator('#dwJan')).toContainText('Locked. Goes to Jan Sunday 7pm.');
  const drew = page.locator('#dwJan .dw-jan-p', { hasText: 'Drew Ellis' }).locator('[data-dw="jan-remove"]');
  await expect(drew).toBeEnabled();
  await drew.click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_jan_list_remove').length).toBe(1);
  for (const [status, words] of [['sending', 'Sending to Jan now.'], ['sent', 'Sent to Jan']]) {
    await page.evaluate((st) => { window.opsFetch = ((orig) => (a, p) => a === 'debt_ws_jan_list' ? orig(a, p).then((j) => Object.assign(j, { status: st })) : orig(a, p))(window.opsFetch); DW.janLoaded = false; DW.jan = null; dwRender(); }, status);
    await expect(page.locator('#dwJan')).toContainText(words);
    await expect(page.locator('#dwJan [data-dw="jan-remove"]').first()).toBeDisabled();
    await expect(page.locator('#dwJan [data-dw="jan-remove"]').first()).toHaveAttribute('title', 'The list has gone to Jan');
  }
});

test('W2: the job screen shows the strip, ladder, story, conversation, notice, suggestion and notes', async ({ page }) => {
  await openDebt(page);
  await openJob(page, 'Casey Morgan', 'Escalating');
  await expect(page.locator('#dwStrip .dw-pill')).toHaveText('Escalating · day 12');
  await expect(page.locator('#dwOwing')).toHaveText('$1,420.37');
  await expect(page.locator('#dwLadder .dw-stp')).toHaveCount(7);
  await expect(page.locator('#dwLadder .dw-stp.done')).toHaveCount(4);
  await expect(page.locator('#dwLadder .dw-stp.due')).toContainText('ready now');
  await expect(page.locator('#dwStory')).toContainText('walkthrough done');
  await expect(page.locator('#dwMoney')).toContainText('Owing on this job');
  // The chat bar: who we are texting, from 771, the invoice, amount and day; the payer chip on.
  await expect(page.locator('#dwChatWho')).toHaveText('Casey Morgan · 0400 000 003');
  await expect(page.locator('#dwChatSub')).toHaveText('Texts go from 771 · INV-9003 · $1,420.37 · day 12');
  await expect(page.locator('#dwChipPayer')).toHaveText('Casey only');
  await expect(page.locator('#dwChipPayer')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#dwChipAll')).toHaveText('Everyone on this job');
  // Conversation: oldest first, newest at the bottom, transcript folded away.
  const msgs = page.locator('#dwThread .dw-msg');
  await expect(msgs.first()).toContainText('Fence looks great');
  await expect(msgs.last()).toContainText('gate still drags');
  const call = page.locator('#dwThread .dw-msg.call');
  await expect(call).toContainText('Call out · 0:31 · no answer');
  await expect(call).not.toContainText('Voicemail greeting');
  await call.locator('[data-dw="transcript"]').click();
  await expect(page.locator('#dwThread .dw-msg.call')).toContainText('Voicemail greeting');
  // Our texts on the right, theirs on the left; an email is marked read only.
  await expect(page.locator('#dwThread .dw-msg.out').first()).toContainText('enjoying the new fence');
  await expect(page.locator('#dwThread .dw-msg.in').first()).toContainText('Fence looks great');
  await expect(page.locator('#dwThread .dw-msg.mail')).toContainText('Email, read only. Reply in Outlook.');
  // The Debt log's note is a yellow line at its own time; the auto records stay out of the thread.
  const noteLine = page.locator('#dwThread .dw-msg.dlog');
  await expect(noteLine).toHaveCount(1);
  await expect(noteLine).toContainText('Note by Shaun: Called at lunch, voicemail. Try later in the day.');
  // The agent notice, the proposed text in the reply box, sending off.
  await expect(page.locator('.dw-notice')).toContainText('call rather than text');
  await expect(page.locator('#dwProposed')).toContainText('Proposed: day 12 reminder');
  await expect(page.locator('#dwProposed')).toContainText('From the template');
  const J = fixtureCasey();
  await expect(page.locator('#dwReply')).toHaveValue(J.suggestion.text); // the template, word for word
  await expect(page.locator('#dwRevert')).toBeDisabled();
  await expect(page.locator('#dwAddNote')).toBeVisible();
  await expect(page.locator('#dwSend')).toBeDisabled();
  await expect(page.locator('#dwSend')).toHaveText('Sending is off until you switch it on');
  await page.locator('#dwCompose [data-dw="why"]').click();
  await expect(page.locator('#dwWhy')).toContainText('No reply to the day 1, 3 or 7 texts');
  // Notes: human notes plain, auto rows muted.
  await expect(page.locator('#dwNotes .dw-note:not(.auto)')).toHaveCount(1);
  await expect(page.locator('#dwNotes .dw-note.auto').first()).toContainText('Day 7 text + call sent');
  await page.locator('[data-dw="why"]').click();
  await page.locator('#dwThread').evaluate((el) => { el.scrollTop = el.scrollHeight; }); // evidence: newest at the bottom
  await shot(page, '02-job.png');
  await shot(page, '12-chat-window.png', '#dwChat');
  // Add a note brings the note box into view, cursor in it.
  await page.locator('#dwAddNote').click();
  await expect(page.locator('#dwNoteIn')).toBeFocused();
  // Next and Back.
  await expect(page.locator('.dw-crumb .pos')).toHaveText('1 of 3');
  await page.locator('#dwNext').click();
  await expect(page.locator('#dwStrip')).not.toContainText('Casey Morgan');
  await page.locator('#dwBack').click();
  await expect(page.locator('#dwListTitle')).toHaveText('Escalating');
});

test('W2: edit and send, a refusal in plain words, notice dismissed, a note with a promise date', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  await openDebt(page, { fixture });
  await openJob(page, 'Casey Morgan', 'Escalating');
  // The box is the editor: type over the proposed text, then put it back, then edit again.
  const proposed = fixture.jobs[fixture.ids.casey].suggestion.text;
  await page.locator('#dwReply').fill('Hi Casey, a quick note about the invoice.\n\nCheers,\nShaun');
  await expect(page.locator('#dwProposed .src')).toContainText('edited');
  await expect(page.locator('#dwRevert')).toBeEnabled();
  await page.locator('#dwRevert').click();
  await expect(page.locator('#dwReply')).toHaveValue(proposed);
  await expect(page.locator('#dwProposed .src')).not.toContainText('edited');
  await page.locator('#dwReply').fill('Hi Casey, a quick note about the invoice.\n\nCheers,\nShaun');
  // First try refused: part paid since the draft was written.
  await page.evaluate(() => { window.__dwPostAnswers.debt_ws_decide = { reject: { message: 'Part paid since the draft', status: 409, code: 'part_paid' } }; });
  await page.locator('#dwSend').click();
  await expect(page.locator('#dwRefusal')).toHaveText(/part paid since the message was written/);
  await page.evaluate(() => { window.__dwPostAnswers.debt_ws_decide = { resolve: { ok: true, sent: true } }; });
  await page.locator('#dwSend').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_decide' && p.body.action === 'send').length).toBe(2);
  const sent = (await posts(page)).filter((p) => p.action === 'debt_ws_decide').pop().body;
  expect(sent).toMatchObject({ xero_invoice_id: fixture.ids.casey, step: 'd12', suggestion_id: fixture.ids.caseySuggestion, action: 'send', channel: 'sms', amount: 1420.37 });
  expect(sent.text).toContain('a quick note');
  expect(sent.override_possible_payment).toBeUndefined();
  // Dismiss the agent notice.
  await page.locator('.dw-notice [data-dw="dismiss"]').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.body.action === 'dismiss').map((p) => p.body)).toEqual([{ xero_invoice_id: fixture.ids.casey, suggestion_id: fixture.ids.caseyFlag, action: 'dismiss' }]);
  // A note with a promise date.
  await page.locator('#dwNoteIn').fill('Spoke to Casey, paying Friday.');
  const promise = fixture.overview.jan_list.visit_date;
  await page.locator('#dwPromise').fill(promise);
  await page.locator('#dwNoteSave').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_note').map((p) => [p.body.note, p.body.promise_date, p.body.xero_invoice_id])).toEqual([['Spoke to Casey, paying Friday.', promise, fixture.ids.casey]]);
});

test('W2: a possible payment warns and offers Send anyway', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  fixture.jobs[fixture.ids.casey].possible_payments = [{ date: fixture.overview.paid_this_week.items[0].paid_on, amount: 1420.37, payer: 'C MORGAN', reason: 'amount matches, name unclear' }];
  await openDebt(page, { fixture });
  await openJob(page, 'Casey Morgan', 'Escalating');
  await expect(page.locator('#dwPossible')).toContainText('$1,420.37');
  await expect(page.locator('#dwPossible')).toContainText('from C MORGAN');
  await expect(page.locator('#dwSend')).toHaveCount(0);
  await shot(page, '04-possible-payment.png', '#dwMiddle');
  await page.locator('#dwSendAnyway').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_decide').map((p) => p.body.override_possible_payment)).toEqual([true]);
});

test('W2: a move suggestion is a purple card: Move + send reply, or Keep chasing', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  await openDebt(page, { fixture });
  await openJob(page, 'Sasha Cole', 'Escalating');
  await expect(page.locator('#dwMove')).toContainText('Looks like something to fix');
  await expect(page.locator('#dwMove')).toContainText('gutter at the back corner');
  await expect(page.locator('#dwMoveBtn')).toHaveText('Move to Rectification + send reply');
  await shot(page, '03-move-card.png', '#dwMiddle');
  await page.locator('#dwKeepBtn').click();
  await expect.poll(async () => (await posts(page)).map((p) => [p.action, p.body.category])).toEqual([['debt_ws_set_category', 'clear']]);
  await page.locator('#dwMoveBtn').click();
  await expect.poll(async () => (await posts(page)).map((p) => [p.action, p.body.category || p.body.action])).toEqual([
    ['debt_ws_set_category', 'clear'], ['debt_ws_set_category', 'rectification'], ['debt_ws_decide', 'send'],
  ]);
  const reply = (await posts(page)).pop().body;
  expect(reply).toMatchObject({ suggestion_id: fixture.ids.sashaSuggestion, step: 'reply_problem', action: 'send', amount: 2101 });
  expect(reply.text).toContain('sort the gutter');
});

test('W2: no GHL contact shows Link contact with candidates', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  await openDebt(page, { fixture });
  await openJob(page, 'Avery Lin');
  await expect(page.locator('#dwLinkCard .dw-cand')).toHaveCount(2);
  await expect(page.locator('#dwSend')).toBeDisabled();
  await expect(page.locator('#dwCompose .dw-gate')).toContainText('Link Avery\'s contact first');
  await page.locator('#dwLinkCard .dw-cand', { hasText: 'phone matches' }).locator('[data-dw="link"]').click();
  await expect.poll(async () => (await posts(page)).map((p) => [p.action, p.body.ghl_contact_id, p.body.xero_invoice_id])).toEqual([['debt_ws_link_contact', fixture.ids.averyContact, fixture.ids.avery]]);
});

test('W2: a shared fence is the neighbour\'s own: their phone, the shares, no borrowed conversation, link them', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  await openDebt(page, { fixture });
  await openJob(page, 'Riley Shaw', 'Escalating');
  await expect(page.locator('#dwStrip h2')).toContainText('(neighbour of Taylor Brooks)');
  await expect(page.locator('#dwShares')).toHaveText('Shared fence: Riley (B) owes $1,025.06 · Taylor (A) paid');
  // The neighbour's own phone, never the job's (Taylor's).
  await expect(page.locator('#dwPayerPhone')).toHaveText('0400 000 404');
  await expect(page.locator('#dwChatWho')).toHaveText('Riley Shaw (B) · 0400 000 404');
  await expect(page.locator('#dwChipPayer')).toHaveText('Riley only');
  await expect(page.locator('#dwMiddle')).not.toContainText('0400 000 004');
  // Not linked: no conversation with Riley, and never Taylor's thread in its place.
  await expect(page.locator('#dwThread')).toHaveCount(0);
  await expect(page.locator('#dwThreadEmpty')).toHaveText('No conversation with Riley yet. Link Riley\'s GoHighLevel contact to see it and text them.');
  await expect(page.locator('#dwMiddle')).not.toContainText('I have paid my half');
  // Send is off until Riley is linked, and says so.
  await expect(page.locator('#dwSend')).toBeDisabled();
  await expect(page.locator('#dwCompose .dw-gate')).toContainText('Link Riley\'s contact first');
  await expect(page.locator('#dwLinkCard')).toContainText('Riley has no GoHighLevel contact linked');
  await shot(page, '06-shared-fence.png', '#dwJob');
  // Everyone on this job on request, other people's messages named.
  await page.locator('#dwChipAll').click();
  await expect(page.locator('#dwThread .dw-msg')).toHaveCount(3);
  await expect(page.locator('#dwThread .dw-msg.other').first()).toContainText('Shaun to Taylor Brooks');
  await expect(page.locator('#dwThread')).toContainText('Taylor Brooks · text');
  await expect.poll(async () => page.evaluate(() => window.__dwFetches.filter((f) => f.action === 'debt_ws_job').map((f) => (f.params || {}).conversation || 'payer'))).toEqual(['payer', 'all']);
  await expect(page.locator('#dwChipAll')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#dwChipPayer')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#dwChipPayer').click();
  await expect(page.locator('#dwThreadEmpty')).toBeVisible();
  // Link: the invoice decides whose contact this is (Riley's own row, never the job).
  await page.locator('#dwLinkCard [data-dw="link"]').click();
  await expect.poll(async () => (await posts(page)).map((p) => [p.action, p.body.xero_invoice_id, p.body.ghl_contact_id])).toEqual([['debt_ws_link_contact', fixture.ids.riley, fixture.ids.rileyContact]]);
});

test('W2: a message not yet filed on a job shows normally with a quiet label; the GHL first name is hinted', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture();
  const J = Object.values(fixture.jobs).find((j) => j.row && j.row.payer_name === 'Casey Morgan');
  // Drafts greet Casey by the GoHighLevel first name, which differs from Xero's.
  Object.assign(J.payer_contact, { greeting_name: 'Cass', greeting_name_source: 'ghl', first_name: 'Cass', ghl_name: 'Cass Morgan' });
  await openDebt(page, { fixture });
  await openJob(page, 'Casey Morgan', 'Escalating');
  const held = page.locator('#dwThread .dw-msg[data-msg="bev:u1"]');
  await expect(held).toContainText('So sorry to bother you');
  await expect(held.locator('.dw-unpl')).toHaveText('not yet filed on a job');
  // Only that message carries the label; the others read as before.
  await expect(page.locator('#dwThread .dw-unpl')).toHaveCount(1);
  await expect(page.locator('#dwThread .dw-msg').last()).toContainText('gate still drags');
  await expect(page.locator('#dwGhlName')).toHaveText('(GHL: Cass)');
});

test('W2: a linked neighbour is texted from here, at their own contact', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  const J = fixture.jobs[fixture.ids.riley];
  J.payer_contact.ghl_contact_id = fixture.ids.rileyContact;
  J.contact.ghl_contact_id = fixture.ids.rileyContact;
  J.send_block = null;
  J.conversation = { messages: [{ id: 'bev:r1', channel: 'sms', direction: 'inbound', occurred_at: fixture.overview.read_at, author: 'Riley Shaw', body: 'Will pay next week.', is_payer: true, party_name: 'Riley Shaw' }], mode: 'payer', all_job_messages_count: 4, payer_messages_count: 1, reason: null };
  await openDebt(page, { fixture, posts: { debt_ws_decide: { resolve: { ok: true, sent: true } } } });
  await openJob(page, 'Riley Shaw', 'Escalating');
  await expect(page.locator('#dwThread .dw-msg')).toHaveCount(1);
  await expect(page.locator('#dwThread')).toContainText('Will pay next week.');
  await expect(page.locator('#dwLinkCard')).toHaveCount(0);
  await expect(page.locator('#dwCompose .dw-gate')).toHaveCount(0);
  await expect(page.locator('#dwSend')).toBeEnabled();
  await page.locator('#dwSend').click();
  // The send names Riley's invoice only; the backend texts Riley's own contact and checks it is on the job.
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_decide' && p.body.action === 'send').map((p) => p.body.xero_invoice_id)).toEqual([fixture.ids.riley]);
  await expect(page.locator('#dwChipAll')).toHaveText('Everyone on this job');
});

test('W2: documents and invoices open in a modal', async ({ page }) => {
  await openDebt(page);
  await openJob(page, 'Casey Morgan', 'Escalating');
  await page.locator('#dwDocs .dw-doc', { hasText: 'Quote QT-9003' }).click();
  await expect(page.locator('#dwModal iframe')).toHaveAttribute('src', /^blob:/);
  await page.locator('#dwModal [data-dw="modal-close"]').click();
  await page.locator('#dwDocs .dw-doc', { hasText: 'Completion photo' }).click();
  await expect(page.locator('#dwModal img')).toHaveAttribute('src', /^blob:/);
  await page.locator('#dwModal [data-dw="modal-close"]').click();
  await page.locator('#dwDocs .dw-doc', { hasText: 'Final invoice INV-9003' }).click();
  await expect(page.locator('#dwModal iframe')).toHaveAttribute('src', /^blob:/);
  const fetched = await page.evaluate(() => window.__dwFetches.filter((f) => f.action === 'get_invoice_pdf' || f.action === 'debt_ws_document').map((f) => f.action));
  expect(fetched).toEqual(['debt_ws_document', 'debt_ws_document', 'get_invoice_pdf']);
});

test('W2: Change beside the pill sets or clears a category by hand, Rectification asks first', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture();
  await openDebt(page, { fixture, posts: { debt_ws_set_category: { resolve: { ok: true, category: 'says_paid', note: null } } } });
  await openJob(page, 'Casey Morgan', 'Escalating');
  await expect(page.locator('#dwCatMenu')).toHaveCount(0);
  await page.locator('#dwCatChange').click();
  await expect(page.locator('#dwCatMenu [role="menuitem"]')).toHaveText(['Says paid', 'Move to Rectification']);
  await shot(page, '09-change-category.png', '#dwJob');
  await page.locator('#dwCatMenu [data-k="says_paid"]').click();
  await expect.poll(async () => (await posts(page)).map((p) => [p.action, p.body])).toEqual([['debt_ws_set_category', { xero_invoice_id: fixture.ids.casey, category: 'says_paid' }]]);
  // Rectification moves the job card, so it asks first; Cancel posts nothing.
  await page.locator('#dwCatChange').click();
  await page.locator('#dwCatMenu [data-k="rectification"]').click();
  await expect(page.locator('#dwModal')).toContainText('This moves the job card to Rectification');
  await page.locator('#dwModal [data-dw="modal-close"]').last().click();
  await expect(page.locator('#dwModal')).toHaveCount(0);
  await page.locator('#dwCatChange').click();
  await page.locator('#dwCatMenu [data-k="rectification"]').click();
  await page.locator('#dwCatConfirm').click();
  await expect.poll(async () => (await posts(page)).map((p) => p.body.category)).toEqual(['says_paid', 'rectification']);
  // A click elsewhere closes the menu.
  await page.locator('#dwCatChange').click();
  await page.locator('#dwOwing').click();
  await expect(page.locator('#dwCatMenu')).toHaveCount(0);
});

test('W2: Says paid offers Clear says paid; a paid invoice reads Paid with nothing to change', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture();
  fixture.jobs[fixture.ids.casey].row.open = false;
  await openDebt(page, { fixture });
  await openJob(page, 'Jamie Fox', 'Says paid');
  await page.locator('#dwCatChange').click();
  await expect(page.locator('#dwCatMenu [role="menuitem"]')).toHaveText(['Clear says paid', 'Move to Rectification']);
  await page.locator('#dwCatMenu [data-k="clear"]').click();
  await expect.poll(async () => (await posts(page)).map((p) => [p.action, p.body])).toEqual([['debt_ws_set_category', { xero_invoice_id: fixture.ids.jamie, category: 'clear' }]]);
  await page.locator('#dwBack').click();
  await openJob(page, 'Casey Morgan', 'Escalating');
  await expect(page.locator('#dwStrip .dw-pill')).toHaveText('Paid');
  await expect(page.locator('#dwStrip .dw-pill')).toHaveClass(/paid/);
  await expect(page.locator('#dwCatChange')).toHaveCount(0);
});

test('staff who are not owners can read and add notes, not send or move', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true, viewer_is_owner: false } });
  await openDebt(page, { fixture });
  await openJob(page, 'Casey Morgan', 'Escalating');
  await expect(page.locator('#dwSend')).toBeDisabled();
  await expect(page.locator('#dwSkip')).toBeDisabled();
  await expect(page.locator('.dw-notice [data-dw="dismiss"]')).toHaveCount(0);
  await expect(page.locator('#dwReadOnly')).toBeVisible();
  await expect(page.locator('#dwCatChange')).toBeDisabled();
  await expect(page.locator('#dwNoteSave')).toBeEnabled();
});

test('an undeployed backend reads as a calm not switched on yet', async ({ page }) => {
  await openDebt(page, { drop: ['debt_ws_overview'] });
  await expect(page.locator('#viewDebt [data-dw-state="not-deployed"]')).toContainText('Not switched on yet');
});

test('phone: the donut shrinks, the list fits, the job columns stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDebt(page);
  const fit = await page.evaluate(() => { const r = document.getElementById('debtWorkshopRoot'); return r.scrollWidth <= r.clientWidth + 1; });
  expect(fit).toBe(true);
  const donut = await page.locator('#dwDonut').boundingBox();
  expect(donut.width).toBeLessThanOrEqual(180);
  // Total owed to us fits a phone: one column of lines, every amount inside the card.
  const owed = await page.locator('#dwOwed').boundingBox();
  const amounts = await page.locator('#dwOwedLines .am').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  amounts.forEach((right) => expect(right).toBeLessThanOrEqual(owed.x + owed.width + 1));
  await shot(page, '05-mobile-overview.png');
  await openJob(page, 'Casey Morgan', 'Escalating');
  const left = await page.locator('#dwLeft').boundingBox();
  const mid = await page.locator('#dwMiddle').boundingBox();
  const right = await page.locator('#dwRight').boundingBox();
  expect(mid.y).toBeGreaterThanOrEqual(left.y + left.height - 1);
  expect(right.y).toBeGreaterThanOrEqual(mid.y + mid.height - 1);
  const jobFit = await page.evaluate(() => { const r = document.getElementById('debtWorkshopRoot'); return r.scrollWidth <= r.clientWidth + 1; });
  expect(jobFit).toBe(true);
  await shot(page, '06-mobile-job.png');
  // The chat window on a phone: the reply box and its buttons fit inside it.
  const chat = await page.locator('#dwChat').boundingBox();
  const send = await page.locator('#dwSend').boundingBox();
  const reply = await page.locator('#dwReply').boundingBox();
  expect(send.x + send.width).toBeLessThanOrEqual(chat.x + chat.width + 1);
  expect(reply.x + reply.width).toBeLessThanOrEqual(chat.x + chat.width + 1);
  await shot(page, '15-mobile-chat-window.png', '#dwChat');
});

test('chat window: Write my own text instead sends a manual text, never the step', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  await openDebt(page, { fixture, posts: { debt_ws_decide: { resolve: { ok: true, sent: true, manual: true, step: 'manual' } } } });
  await openJob(page, 'Casey Morgan', 'Escalating');
  await page.locator('#dwOwn').click();
  await expect(page.locator('#dwProposed')).toContainText('Your own text');
  await expect(page.locator('#dwProposed')).toContainText('not a planned step, so the follow-up days do not move');
  await expect(page.locator('#dwReply')).toHaveValue('');
  await expect(page.locator('#dwReply')).toBeFocused();
  await expect(page.locator('#dwSkip')).toHaveCount(0);
  await page.locator('#dwReply').fill('Thanks Casey, Friday is fine.\n\nCheers,\nShaun');
  await shot(page, '13-own-text.png', '#dwChat');
  // A long dash is refused on screen before anything is posted.
  await page.locator('#dwReply').fill('Thanks Casey \u2014 Friday is fine'); // a long dash, written as an escape
  await page.locator('#dwSend').click();
  await expect(page.locator('#dwRefusal')).toHaveText('Take out the long dash or emoji before sending.');
  expect((await posts(page)).filter((p) => p.action === 'debt_ws_decide')).toHaveLength(0);
  await page.locator('#dwReply').fill('Thanks Casey, Friday is fine.\n\nCheers,\nShaun');
  await page.locator('#dwSend').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_decide').length).toBe(1);
  const body = (await posts(page)).find((p) => p.action === 'debt_ws_decide').body;
  expect(body).toMatchObject({ xero_invoice_id: fixture.ids.casey, step: 'manual', action: 'send', channel: 'sms', amount: 1420.37, text: 'Thanks Casey, Friday is fine.\n\nCheers,\nShaun' });
  expect(body.client_ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(body.suggestion_id).toBeUndefined();
  // After the send the box is back on the proposed step (the day 12 text is still due).
  await expect(page.locator('#dwProposed')).toContainText('Proposed: day 12 reminder');
  await expect(page.locator('#dwReply')).toHaveValue(fixture.jobs[fixture.ids.casey].suggestion.text);
  // Put the proposed text back leaves your own text.
  await page.locator('#dwOwn').click();
  await page.locator('#dwReply').fill('Another thought');
  await page.locator('#dwRevert').click();
  await expect(page.locator('#dwProposed')).toContainText('Proposed: day 12 reminder');
});

test('chat window: with no step due the box takes your own text; paused chasing says why above an empty box', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  await openDebt(page, { fixture });
  // Jordan: nothing due today (day 7 is in a few days), so the box is for your own text.
  await openJob(page, 'Jordan Pike');
  await expect(page.locator('#dwProposed')).toContainText('Your own text');
  await expect(page.locator('#dwNextLine')).toContainText('Nothing proposed today. Next: Day 7 text + call');
  await expect(page.locator('#dwRevert')).toHaveCount(0);
  await expect(page.locator('#dwReply')).toHaveAttribute('placeholder', 'Write a text to Jordan');
  await expect(page.locator('#dwSend')).toBeEnabled();
  await page.locator('#dwBack').click();
  // Jamie says they have paid: the steps wait and the reason shows, with an empty box below it
  // for a reply in Shaun's own words (Shaun, 16 Oct 2026). Nothing is proposed or pre-filled.
  await openJob(page, 'Jamie Fox', 'Says paid');
  await expect(page.locator('#dwNothing')).toHaveText('They say they have paid. Follow-ups are paused while Xero catches up. You can still reply in your own words.');
  await expect(page.locator('#dwProposed')).toContainText('Your own text');
  await expect(page.locator('#dwReply')).toHaveValue('');
  await expect(page.locator('#dwRevert')).toHaveCount(0);
  await expect(page.locator('#dwSkip')).toHaveCount(0);
  await expect(page.locator('#dwCompose #dwAddNote')).toBeVisible();
  await page.locator('#dwReply').fill('Thanks Jamie, we will keep an eye out for it.\n\nCheers,\nShaun');
  await shot(page, '14-paused-own-text.png', '#dwChat');
  await page.locator('#dwSend').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_decide').map((p) => [p.body.step, p.body.xero_invoice_id, p.body.amount])).toEqual([['manual', fixture.ids.jamie, 2433.75]]);
  await page.locator('#dwBack').click();
  // Quinn is on Jan's visit list: no more planned texts, but Shaun may still reply.
  await openJob(page, 'Quinn Harper', 'Bad debt');
  await expect(page.locator('#dwNothing')).toHaveText('On Jan\'s visit list. No more texts. You can still reply in your own words.');
  await expect(page.locator('#dwReply')).toHaveValue('');
  await expect(page.locator('#dwSend')).toBeEnabled();
});

test('Debt report: the button opens the live report as its own view; staff read and download, not send', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true, viewer_is_owner: false } });
  await openDebt(page, { fixture });
  await page.locator('#dwReportBtn').click();
  await expect(page.locator('#dwReportFrame')).toHaveAttribute('srcdoc', /Debt position/);
  await expect(page.locator('#dwReportFrame')).toHaveAttribute('sandbox', '');
  // Read fresh from the backend every time the view opens.
  const reads = async () => (await page.evaluate(() => window.__dwFetches)).filter((f) => f.action === 'debt_ws_report').length;
  expect(await reads()).toBe(1);
  await expect(page.locator('#dwReportMeta')).toContainText('Sends from admin@secureworkswa.com.au to marnin@secureworkswa.com.au, cc shaun@secureworkswa.com.au.');
  await expect(page.locator('#dwReportLast')).toHaveText('Last sent to Marnin: never');
  await expect(page.locator('#dwReportAuto')).toHaveText('Wednesday 12pm auto-send: off');
  await expect(page.locator('#dwReportSend')).toHaveText('Send to Marnin');
  await expect(page.locator('#dwReportSend')).toBeDisabled();
  await expect(page.locator('#dwReportWhy')).toHaveText('Only an owner can send the report.');
  // Download PDF saves the backend's PDF under its dated name.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#dwReportPdf').click()]);
  expect(download.suggestedFilename()).toBe(fixture.reportPdf.filename);
  await shot(page, '10-debt-report.png');
  // Back to the tab, and opening it again reads it again.
  await page.locator('[data-dw="report-back"]').click();
  await expect(page.locator('#dwLegend')).toBeVisible();
  await page.locator('#dwReportBtn').click();
  await expect(page.locator('#dwReportFrame')).toBeVisible();
  expect(await reads()).toBe(2);
  expect((await posts(page)).filter((p) => p.action === 'debt_ws_report_send')).toHaveLength(0);
});

test('Debt report: Send to Marnin asks first, then sends and shows Last sent; a refusal reads in words', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true, viewer_is_owner: true } });
  const sentAt = new Date().toISOString();
  await openDebt(page, { fixture, posts: { debt_ws_report_send: { resolve: { ok: true, sent: true, to: ['marnin@secureworkswa.com.au'], cc: ['shaun@secureworkswa.com.au'], sent_at: sentAt } } } });
  await page.locator('#dwReportBtn').click();
  await expect(page.locator('#dwReportSend')).toBeEnabled();
  await page.locator('#dwReportSend').click();
  // The first click only asks.
  await expect(page.locator('#dwReportConfirm')).toContainText('Send this report now?');
  expect((await posts(page)).filter((p) => p.action === 'debt_ws_report_send')).toHaveLength(0);
  await shot(page, '11-debt-report-confirm.png');
  // Cancel posts nothing.
  await page.locator('[data-dw="report-send-cancel"]').click();
  await expect(page.locator('#dwReportConfirm')).toHaveCount(0);
  await page.locator('#dwReportSend').click();
  await page.locator('#dwReportConfirmSend').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_report_send').length).toBe(1);
  await expect(page.locator('#dwReportMsg')).toHaveText('Sent to marnin@secureworkswa.com.au, cc shaun@secureworkswa.com.au.');
  await expect(page.locator('#dwReportLast')).toContainText('Last sent to Marnin: today');
  // The frame was not redrawn by the send (it keeps its place).
  await expect(page.locator('#dwReportFrame')).toHaveAttribute('srcdoc', /Debt position/);
  // A refusal from the backend reads in words.
  await page.evaluate(() => { window.__dwPostAnswers.debt_ws_report_send = { reject: { message: 'The report was just sent', status: 409, code: 'recently_sent' } }; });
  await page.locator('#dwReportSend').click();
  await page.locator('#dwReportConfirmSend').click();
  await expect(page.locator('#dwReportMsg')).toHaveText('The report was just sent. Wait two minutes before sending it again.');
  // A stale Xero copy (consolidate first) refuses in the backend's own words.
  const stale = "Our Xero copy of invoices was last synced at 11:39am Perth time, more than 20 minutes ago, so the report would not show today's debt. Wait for the next sync (every 15 minutes) and try again";
  await page.evaluate((m) => { window.__dwPostAnswers.debt_ws_report_send = { reject: { message: m, status: 409, code: 'xero_copy_stale' } }; }, stale);
  await page.locator('#dwReportSend').click();
  await page.locator('#dwReportConfirmSend').click();
  await expect(page.locator('#dwReportMsg')).toHaveText(stale + '.');
});

test('Debt report: the Wednesday 12pm auto-send reads on when it is switched on', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true, viewer_is_owner: true, report_auto_send: true } });
  await openDebt(page, { fixture });
  await page.locator('#dwReportBtn').click();
  await expect(page.locator('#dwReportAuto')).toHaveText('Wednesday 12pm auto-send: on');
});

test('Debt report: with sending off the owner sees why Send is off', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: false, viewer_is_owner: true } });
  await openDebt(page, { fixture });
  await page.locator('#dwReportBtn').click();
  await expect(page.locator('#dwReportSend')).toBeDisabled();
  await expect(page.locator('#dwReportWhy')).toHaveText('Sending is off until you switch it on.');
  await expect(page.locator('#dwReportPdf')).toBeEnabled();
});

test('Debt report: an undeployed backend reads as not switched on yet; the phone view fits', async ({ page }) => {
  await openDebt(page, { drop: ['debt_ws_report'] });
  await page.locator('#dwReportBtn').click();
  await expect(page.locator('#viewDebt [data-dw-state="not-deployed"]')).toContainText('Not switched on yet');
  await page.setViewportSize({ width: 390, height: 844 });
  await openDebt(page);
  await page.locator('#dwReportBtn').click();
  await expect(page.locator('#dwReportFrame')).toBeVisible();
  const fit = await page.evaluate(() => { const r = document.getElementById('debtWorkshopRoot'); return r.scrollWidth <= r.clientWidth + 1; });
  expect(fit).toBe(true);
});
