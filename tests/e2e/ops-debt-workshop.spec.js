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
//  - W2: status strip with the ladder; story, money and documents (opened in a modal); the
//    conversation oldest first with transcripts folded; agent notices with Dismiss; the suggestion
//    with Send / Edit / Skip / Why this one; Send disabled while sending is off; a possible
//    payment offers Send anyway; a move card; a Link contact card; notes with a promise date.
//  - Owner-only controls are disabled for staff; refusals are shown in plain words.
//  - An undeployed backend reads as a calm "not switched on yet".
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
        debt_ws_job: fixture.jobs[p.xero_invoice_id],
        debt_ws_jan_list: fixture.janList,
        debt_ws_statement_preview: fixture.statements[p.company_key],
        debt_ws_document: fixture.documents[p.document_id],
        get_invoice_pdf: fixture.invoicePdf,
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
  // a failed read keeps it hidden
  await page.evaluate(() => { debtWsReveal(false); window.opsFetch = () => Promise.reject(Object.assign(new Error('Unknown action'), { status: 400 })); return debtWsProbeVisibility(); });
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
  await page.evaluate(() => { window.__dwPostAnswers.debt_ws_statement_send = { reject: { message: 'API error: 409', status: 409, code: 'already_sent_this_week' } }; });
  await harbour.locator('[data-dw="approve"]').click();
  await expect(harbour.locator('.dw-refuse')).toHaveText('This company\'s statement already went this week.');
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
  // Conversation: oldest first, newest at the bottom, transcript folded away.
  const msgs = page.locator('#dwThread .dw-msg');
  await expect(msgs.first()).toContainText('Fence looks great');
  await expect(msgs.last()).toContainText('gate still drags');
  const call = page.locator('#dwThread .dw-msg.call');
  await expect(call).toContainText('Call out · 0:31 · no answer');
  await expect(call).not.toContainText('Voicemail greeting');
  await call.locator('[data-dw="transcript"]').click();
  await expect(page.locator('#dwThread .dw-msg.call')).toContainText('Voicemail greeting');
  // The agent notice, the suggestion, sending off.
  await expect(page.locator('.dw-notice')).toContainText('call rather than text');
  await expect(page.locator('#dwSuggestion .dw-lab')).toContainText('Suggested day 12 text');
  await expect(page.locator('#dwSend')).toBeDisabled();
  await expect(page.locator('#dwSend')).toHaveText('Sending is off until you switch it on');
  await page.locator('#dwSuggestion [data-dw="why"]').click();
  await expect(page.locator('#dwWhy')).toContainText('No reply to the day 1, 3 or 7 texts');
  // Notes: human notes plain, auto rows muted.
  await expect(page.locator('#dwNotes .dw-note:not(.auto)')).toHaveCount(1);
  await expect(page.locator('#dwNotes .dw-note.auto').first()).toContainText('Day 7 text + call sent');
  await page.locator('[data-dw="why"]').click();
  await shot(page, '02-job.png');
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
  await page.locator('#dwEdit').click();
  await page.locator('#dwDraftEdit').fill('Hi Casey, a quick note about the invoice.\n\nCheers,\nShaun');
  await page.locator('#dwEdit').click();
  await expect(page.locator('#dwDraftText')).toContainText('a quick note');
  await expect(page.locator('#dwSuggestion .src')).toContainText('edited');
  // First try refused: part paid since the draft was written.
  await page.evaluate(() => { window.__dwPostAnswers.debt_ws_decide = { reject: { message: 'Part paid since the draft', status: 409, code: 'part_paid' } }; });
  await page.locator('#dwSend').click();
  await expect(page.locator('#dwRefusal')).toHaveText(/part paid since the message was written/);
  await page.evaluate(() => { window.__dwPostAnswers.debt_ws_decide = { resolve: { ok: true, sent: true } }; });
  await page.locator('#dwSend').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.action === 'debt_ws_decide' && p.body.action === 'send').length).toBe(2);
  const sent = (await posts(page)).filter((p) => p.action === 'debt_ws_decide').pop().body;
  expect(sent).toMatchObject({ xero_invoice_id: fixture.ids.casey, step: 'd12', suggestion_id: 'sug-casey-d12', action: 'send', channel: 'sms' });
  expect(sent.text).toContain('a quick note');
  expect(sent.override_possible_payment).toBeUndefined();
  // Dismiss the agent notice.
  await page.locator('.dw-notice [data-dw="dismiss"]').click();
  await expect.poll(async () => (await posts(page)).filter((p) => p.body.action === 'dismiss').map((p) => p.body)).toEqual([{ xero_invoice_id: fixture.ids.casey, suggestion_id: 'flag-casey-1', action: 'dismiss' }]);
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
  expect(reply).toMatchObject({ suggestion_id: 'sug-sasha-move', action: 'send' });
  expect(reply.text).toContain('sort the gutter');
});

test('W2: no GHL contact shows Link contact with candidates', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true } });
  await openDebt(page, { fixture });
  await openJob(page, 'Avery Lin');
  await expect(page.locator('#dwLinkCard .dw-cand')).toHaveCount(2);
  await expect(page.locator('#dwSend')).toBeDisabled();
  await expect(page.locator('#dwSuggestion .dw-gate')).toContainText('Link a contact first');
  await page.locator('#dwLinkCard .dw-cand', { hasText: 'phone matches' }).locator('[data-dw="link"]').click();
  await expect.poll(async () => (await posts(page)).map((p) => [p.action, p.body.ghl_contact_id])).toEqual([['debt_ws_link_contact', 'ghl-avery-1']]);
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

test('staff who are not owners can read and add notes, not send or move', async ({ page }) => {
  const fixture = buildDebtWorkshopFixture(undefined, { settings: { sending_on: true, viewer_is_owner: false } });
  await openDebt(page, { fixture });
  await openJob(page, 'Casey Morgan', 'Escalating');
  await expect(page.locator('#dwSend')).toBeDisabled();
  await expect(page.locator('#dwSkip')).toBeDisabled();
  await expect(page.locator('.dw-notice [data-dw="dismiss"]')).toHaveCount(0);
  await expect(page.locator('#dwReadOnly')).toBeVisible();
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
});
