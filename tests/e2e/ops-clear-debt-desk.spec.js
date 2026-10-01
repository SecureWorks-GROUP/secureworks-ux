// Clear Debt desk screen (docs/clear-debt-desk.md; backend plan docs/debt-book/PLAN.md step 4).
// Offline: ops-api is replaced by the fixture in tests/fixtures/clear-debt-desk.js (made-up
// names, dates derived from today's Perth date). An action missing from the fixture answers
// "Unknown action", exactly as ops-api does before that backend step deploys.
//
// Contract under guard:
//  - OVERDUE is the big number and includes held invoices, so it matches Xero; check first
//    and fix first are their own figures beside it; "Texts waiting for Marnin" is gone.
//  - Tabs: Today | Debt book | Promises | Jan | Deposits, Today first and the default.
//  - Today orders broken promises, Jan, calls, texts, statements, deposit reminders, then
//    held payers in "On hold, no draft" with their reason and nothing to draft or tick; every
//    send button (desk drafts and the Debt book payer record) is disabled, reads "Sending off
//    until Shaun says go" and carries no handler.
//  - Each card has ONE obvious button for its step (Approve text, Call now, Approve Jan's visit,
//    Approve reminder, Review statement); no draft yet reads "Draft coming - nothing to do yet"
//    with no button; held cards have nothing to press. A line at the top of Today counts the
//    work and says sending is off, so approving only queues.
//  - Outcome buttons, the promise box and the note sit behind "Log what happened" ("What
//    happened?" on a call card); the promise box opens only on Promised. They post
//    debt_log_outcome; a promise needs $ and date.
//    Only a call or Jan visit card logs its schedule_step; a text card and the Debt book payer
//    record log none, so an outcome never marks an unsent text as done.
//  - Deposits leave the morning list's not_chased invoices out of the total, shown apart; without
//    the morning list the tab says they cannot be set apart and shows no 60-day pill.
//  - An undeployed action is a plain "not live yet", never a guessed number.
//  - The Today overdue card opens Clear Debt.
// Screenshots: CLEAR_DEBT_EVIDENCE_DIR=docs/evidence/<folder> npx playwright test tests/e2e/ops-clear-debt-desk.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { buildClearDebtDeskFixture } = require('../fixtures/clear-debt-desk');

const EVIDENCE_DIR = process.env.CLEAR_DEBT_EVIDENCE_DIR
  ? path.resolve(process.cwd(), process.env.CLEAR_DEBT_EVIDENCE_DIR)
  : path.resolve(__dirname, '../../test-results/ops-clear-debt-desk');
function shot(name) { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); return path.join(EVIDENCE_DIR, name); }
// Evidence shots only: the page's own fixed chrome (top bar, Jarvis bar, SMS panel, toasts)
// floats over an element screenshot, so hide everything fixed or sticky outside Clear Debt.
async function shotDesk(page, name, selector = '#subCleardebt') {
  await page.evaluate(() => {
    const desk = document.getElementById('subCleardebt');
    document.querySelectorAll('body *').forEach((el) => {
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'sticky') && !el.contains(desk) && !desk.contains(el)) el.style.visibility = 'hidden';
    });
    document.body.style.paddingTop = '0';
  });
  await page.locator(selector).screenshot({ path: shot(name) });
}

test.use({ viewport: { width: 1360, height: 1000 } });

async function openDesk(page, { fixture = buildClearDebtDeskFixture(), drop = [] } = {}) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ fixture, drop }) => {
    try { localStorage.removeItem('sw_cd_tab'); } catch (e) {}
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__cddPosts = [];
    const answer = (action) => {
      if (Object.prototype.hasOwnProperty.call(fixture, action) && drop.indexOf(action) < 0) return Promise.resolve(JSON.parse(JSON.stringify(fixture[action])));
      const e = new Error('Unknown action'); e.status = 400; return Promise.reject(e);
    };
    window.opsFetch = (action) => answer(action);
    window.opsPost = (action, body) => {
      window.__cddPosts.push({ action, body });
      if (drop.indexOf(action) >= 0) { const e = new Error('Unknown action'); e.status = 400; return Promise.reject(e); }
      if (action === 'debt_draft_decide') return Promise.resolve({ ok: true, draft: { id: body.draft_id, status: body.decision === 'approve' ? 'approved' : 'skipped', text: body.text, approved_by: 'ops-e2e' } });
      if (action === 'debt_log_outcome') return Promise.resolve({ ok: true, logged: body.xero_invoice_ids.length });
      return Promise.reject(new Error('Unknown action'));
    };
    // The Today overdue card is the way in.
    document.getElementById('statOverdue').click();
  }, { fixture, drop });
  await expect(page.locator('#subCleardebt')).toBeVisible();
}

// Item ids are the backend's (date:payer_key:group:step), so cards are found by payer name.
function card(page, name, nth = 0) {
  return page.locator('[data-cdd-item]').filter({ has: page.locator('.cdd-nm', { hasText: new RegExp('^' + name + '$') }) }).nth(nth);
}

function expectedOverdue(fixture) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date());
  let cents = 0, n = 0;
  for (const i of fixture.debt_book.invoices) if (i.is_debt && i.due_date && i.due_date < today) { cents += Math.round(i.amount_due * 100); n += 1; }
  return { text: '$' + Math.round(cents / 100).toLocaleString('en-AU'), n };
}

test('header: overdue is the big number with holds included, check first and fix first beside it, stamp matches Xero', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  await openDesk(page, { fixture });
  const want = expectedOverdue(fixture);
  await expect(page.locator('#cddOverdue')).toContainText(want.text);
  await expect(page.locator('#cddOverdue')).toContainText(want.n + ' invoices');
  await expect(page.locator('#cddStamp')).toContainText('Matches Xero, read 07:02');
  const labels = await page.locator('.cdd-fig .l').allTextContents();
  expect(labels).toEqual(['Debt, by your definition', 'Open in Xero', 'Not debt', 'Check first', 'Fix first', 'Waiting for Shaun']);
  await expect(page.locator('.cdd-fig', { hasText: 'Check first' }).locator('.v')).toHaveText('$3,225');
  await expect(page.locator('.cdd-fig', { hasText: 'Fix first' }).locator('.v')).toHaveText('$2,860');
  await expect(page.locator('.cdd-fig', { hasText: 'Waiting for Shaun' }).locator('.v')).toHaveText('4'); // Harper, Theo, Nina's Jan visit, the MLB statement; Mia's call script is not a decision
  await expect(page.locator('#subCleardebt')).not.toContainText('Texts waiting for Marnin');
  await shotDesk(page, '01-today.png');
});

test('a copy that differs from Xero says by how much', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  fixture.debt_book.copy_check = { matches: false, differs_by: 3583.48, invoice_count: 6 };
  await openDesk(page, { fixture });
  await expect(page.locator('#cddStamp')).toHaveText('Differs by $3,583.48 on 6 invoices');
});

test('tabs are Today, Debt book, Promises, Jan, Deposits with Today first and open', async ({ page }) => {
  await openDesk(page);
  const tabs = await page.locator('[data-cdd-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cdd-tab')));
  expect(tabs).toEqual(['today', 'book', 'promises', 'jan', 'deposits']);
  await expect(page.locator('[data-cdd-tab="today"]')).toHaveAttribute('aria-selected', 'true');
});

test('Today: groups in chase order, held payers last with no draft, send is off everywhere', async ({ page }) => {
  await openDesk(page);
  const groups = await page.locator('[data-cdd-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cdd-group')));
  expect(groups).toEqual(['broken_promise', 'jan', 'call', 'text', 'statement', 'deposit_reminder', 'hold']);
  await expect(page.locator('[data-cdd-group="hold"]')).toContainText('On hold, no draft');
  const ruby = card(page, 'Ruby Castillo');
  await expect(ruby).toContainText('Fix first.');
  await expect(ruby.locator('.cdd-chip.step')).toHaveCount(0); // the backend's "Fix first: ..." label is not repeated as a chip
  await expect(ruby).toContainText('Job in rectification: gate latch to refit');
  await expect(ruby.locator('textarea')).toHaveCount(0);
  await expect(ruby.locator('input[type=checkbox]')).toHaveCount(0);
  await expect(ruby.locator('button, a.cdd-btn, details')).toHaveCount(0); // information only
  const heldNames = await page.locator('.cdd-item.hold .cdd-nm').allTextContents();
  expect(heldNames).toEqual(['Ruby Castillo', 'Builderwest', 'Major Loss Builders']);
  await expect(page.locator('#cddAlso')).toContainText('1 is paused on a promise to pay (see Promises)');
  await expect(page.locator('#cddAlso')).toContainText('2 waiting for a later step or a due date');
  await expect(page.locator('#cddAlso')).toContainText('2 invoices are never chased');
  const sends = page.locator('button.send');
  expect(await sends.count()).toBeGreaterThan(0);
  for (const b of await sends.all()) {
    await expect(b).toBeDisabled();
    await expect(b).toHaveText('Sending off until Shaun says go');
    expect(await b.getAttribute('onclick')).toBeNull();
  }
});

test('Today opens with one line of what to do, and says sending is off so approving only queues', async ({ page }) => {
  await openDesk(page);
  await expect(page.locator('#cddTodo')).toHaveText('2 texts to approve, 2 calls to make, 1 Jan visit to approve, 1 builder statement to review. 3 on hold, just so you know.');
  await expect(page.locator('#cddSendingOff')).toHaveText('Sending is off until Shaun says go - approving now just queues them.');
});

test('each card shows one obvious button for its step, with everything else folded away', async ({ page }) => {
  await openDesk(page);
  const primary = async (name) => card(page, name).locator('[data-cdd-primary]').allTextContents();
  expect(await primary('Harper Nguyen')).toEqual(['Approve text']);
  expect(await primary('Theo Brennan')).toEqual(['Approve text']);
  expect(await primary('Mia Laurent')).toEqual(['Call now']);
  expect(await primary('Nina Hollis')).toEqual(["Approve Jan's visit"]);
  expect(await primary('Major Loss Builders')).toEqual(['Review statement']);
  expect(await primary('Oscar Patel')).toEqual([]); // already approved
  expect(await primary('Ivy Okafor')).toEqual([]); // already skipped
  await expect(card(page, 'Mia Laurent').locator('a[data-cdd-primary]')).toHaveAttribute('href', 'tel:0400000103');
  await expect(card(page, 'Mia Laurent').locator('summary')).toHaveText('What happened?');
  const aj = card(page, 'AJ Building & Restoration');
  await expect(aj.locator('[data-cdd-primary]')).toHaveCount(0);
  await expect(aj.locator('[data-cdd-nophone]')).toBeVisible();
  // The drafted message is shown above its button; Edit and Skip are small links beside it.
  const harper = card(page, 'Harper Nguyen');
  await expect(harper.locator('.cdd-msg')).toContainText('Hi Harper, a friendly reminder');
  await expect(harper.locator('textarea')).toHaveCount(0);
  await expect(harper.locator('button.cdd-link.sm')).toHaveText(['Edit', 'Skip']);
  // What happened is folded behind one small link on every card.
  await expect(harper.locator('summary')).toHaveText('Log what happened');
  for (const name of ['No answer', 'Spoke', 'Promised', 'Disputed', 'Says paid']) await expect(harper.getByRole('button', { name, exact: true })).toBeHidden();
  await expect(harper.getByLabel('Promised amount')).toBeHidden();
  await expect(harper.getByLabel('Note')).toBeHidden();
  await shotDesk(page, '09-one-button-cards.png', '#clearDebtCards');
});

test('a builder statement is reviewed before it can be approved', async ({ page }) => {
  await openDesk(page);
  const mlb = card(page, 'Major Loss Builders');
  await expect(mlb.locator('.cdd-msg')).toHaveCount(0);
  await mlb.getByRole('button', { name: 'Review statement' }).click();
  await expect(mlb.locator('.cdd-msg')).toContainText('Statement for Major Loss Builders');
  await mlb.getByRole('button', { name: 'Approve statement' }).click();
  await expect(mlb).toContainText('Approved by ops-e2e');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_draft_decide'));
  expect(post.body).toMatchObject({ draft_id: 'draft-mlb-statement', decision: 'approve' });
});

test('approve a draft, then approve ticked in one go', async ({ page }) => {
  await openDesk(page);
  const harper = card(page, 'Harper Nguyen');
  await harper.getByRole('button', { name: 'Edit', exact: true }).click();
  await harper.locator('textarea').fill('Hi Harper, a friendly reminder about INV-9001. Thanks, SecureWorks WA');
  await harper.getByRole('button', { name: 'Approve text', exact: true }).click();
  await expect(harper).toContainText('Approved by ops-e2e');
  await expect(card(page, 'Mia Laurent').locator('input[type=checkbox]')).toHaveCount(0); // a call is not ticked
  await expect(card(page, 'Major Loss Builders').locator('input[type=checkbox]')).toHaveCount(0); // a statement is reviewed first
  await card(page, 'Theo Brennan').locator('input[type=checkbox]').check();
  await card(page, 'Nina Hollis').locator('input[type=checkbox]').check();
  await page.locator('#cddApproveTicked').click();
  await expect(card(page, 'Theo Brennan')).toContainText('Approved');
  await expect(card(page, 'Nina Hollis')).toContainText('Approved');
  const posts = await page.evaluate(() => window.__cddPosts);
  expect(posts.map((p) => p.action)).toEqual(['debt_draft_decide', 'debt_draft_decide', 'debt_draft_decide']);
  expect(posts[0].body).toMatchObject({ draft_id: 'draft-harper', decision: 'approve', text: 'Hi Harper, a friendly reminder about INV-9001. Thanks, SecureWorks WA' });
});

test('outcome buttons and the promise box log against the payer\'s invoices', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  await openDesk(page, { fixture });
  const mia = card(page, 'Mia Laurent');
  await mia.getByText('What happened?').click();
  await expect(mia.getByLabel('Promised amount')).toBeHidden(); // the promise box opens only on Promised
  await mia.getByRole('button', { name: 'Promised', exact: true }).click();
  await expect(mia.getByLabel('Promised amount')).toBeVisible();
  await shotDesk(page, '10-what-happened.png', '[data-cdd-item]:has(.cdd-nm:text-is("Mia Laurent"))');
  await mia.getByRole('button', { name: 'Save promise' }).click();
  await expect(mia.locator('.cdd-out [data-cdd-said]')).toHaveText('Put the promised amount in first');
  await mia.getByLabel('Promised amount').fill('500');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date());
  await mia.getByLabel('Promised date').fill(today);
  await mia.getByRole('button', { name: 'Save promise' }).click();
  await expect(mia.locator('.cdd-out [data-cdd-said]')).toContainText('Logged: Promised $500.00');
  await mia.getByRole('button', { name: 'No answer' }).click();
  const posts = await page.evaluate(() => window.__cddPosts.filter((p) => p.action === 'debt_log_outcome'));
  expect(posts[0].body.payer_key).toBe(fixture.debt_morning_list.items.find((i) => i.payer_name === 'Mia Laurent').payer_key);
  expect(posts[0].body).toMatchObject({ outcome_code: 'promised', promised_amount: 500, promised_date: today, channel: 'call', schedule_step: 'call', xero_invoice_ids: [fixture.debt_book.invoices[2].xero_invoice_id] });
  expect(posts[1].body.outcome_code).toBe('no_answer');
  expect(posts[1].body.schedule_step).toBe('call');
});

test('an outcome on a text card logs no schedule_step, so the unsent text is not marked done', async ({ page }) => {
  await openDesk(page);
  const harper = card(page, 'Harper Nguyen');
  await harper.getByText('Log what happened').click();
  await harper.getByRole('button', { name: 'No answer' }).click();
  await expect(harper.locator('.cdd-out [data-cdd-said]')).toContainText('Logged: No answer');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_log_outcome'));
  expect(post.body).toMatchObject({ outcome_code: 'no_answer', schedule_step: null });
});

test('Debt book tab: live split by payer and age, the bar from our copy, and the payer card outcome box', async ({ page }) => {
  await openDesk(page);
  await page.locator('[data-cdd-tab="book"]').click();
  await expect(page.locator('.cdd-tbl').first()).toContainText('MLB');
  await expect(page.locator('.cdd-tbl').nth(1)).toContainText('No due date');
  await expect(page.locator('#clearDebtBookHead .cd-legend')).toContainText('No due date');
  await expect(page.locator('#clearDebtBookHead')).not.toContainText('Texts waiting for Marnin');
  await shotDesk(page, '02-debt-book.png');
  await page.locator('#clearDebtBookHead .cd-legend button', { hasText: 'Chase now' }).click();
  await page.locator('.cd-row', { hasText: 'Harper Nguyen' }).click();
  await expect(page.locator('#cd-rec .cdd-out')).toBeVisible();
  await expect(page.locator('#cd-rec').getByRole('button', { name: 'Says paid' })).toBeHidden();
  await page.locator('#cd-rec').getByText('Log what happened').click();
  await expect(page.locator('#cd-rec').getByRole('button', { name: 'Says paid' })).toBeVisible();
  await expect(page.locator('#cd-rec').getByRole('button', { name: 'Send text' })).toHaveCount(0);
  await expect(page.locator('#cd-rec').getByRole('button', { name: 'Send invoice email' })).toHaveCount(0);
  const off = page.locator('#cd-rec .cd-reach button', { hasText: 'Sending off until Shaun says go' });
  await expect(off).toHaveCount(2);
  for (const b of await off.all()) {
    await expect(b).toBeDisabled();
    expect(await b.getAttribute('onclick')).toBeNull();
  }
  await expect(page.locator('#cd-rec').getByRole('button', { name: 'Add note' })).toBeEnabled();
  await shotDesk(page, '08-payer-record-send-off.png', '#cd-rec');
});

test('an outcome logged from the Debt book payer record uses the morning list payer key (mlb, not a contact id)', async ({ page }) => {
  await openDesk(page);
  await page.locator('[data-cdd-tab="book"]').click();
  await page.locator('#clearDebtBookHead .cd-legend button', { hasText: 'Chase now' }).click();
  await page.locator('.cd-row', { hasText: 'Major Loss Builders' }).first().click();
  await page.locator('#cd-rec').getByText('Log what happened').click();
  await page.locator('#cd-rec').getByRole('button', { name: 'No answer' }).click();
  await expect(page.locator('#cd-rec .cdd-out [data-cdd-said]')).toContainText('Logged: No answer');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_log_outcome'));
  expect(post.body.payer_key).toBe('mlb');
  expect(post.body.schedule_step).toBeNull();
});

test('step 2 as built: no drafts yet is said plainly with no button, and an unstable Xero read is flagged', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  fixture.debt_morning_list.items.forEach((i) => { i.draft = null; });
  fixture.debt_book.read_stable = false;
  fixture.debt_book.read_warning = 'Xero changed during the read, retrying next run';
  await openDesk(page, { fixture });
  await expect(page.locator('.cdd-fig', { hasText: 'Waiting for Shaun' })).toContainText('no drafts written yet');
  await expect(page.locator('.cdd-fig', { hasText: 'Waiting for Shaun' }).locator('.v')).toHaveText('0');
  for (const name of ['Harper Nguyen', 'Nina Hollis', 'Major Loss Builders']) {
    await expect(card(page, name)).toContainText('Draft coming - nothing to do yet');
    await expect(card(page, name).locator('[data-cdd-primary]')).toHaveCount(0);
    await expect(card(page, name).locator('summary')).toHaveText('Log what happened');
  }
  for (const name of ['Mia Laurent', 'AJ Building & Restoration']) await expect(card(page, name)).not.toContainText('Draft coming');
  await expect(card(page, 'Mia Laurent').locator('[data-cdd-primary]')).toHaveText('Call now'); // a call needs no draft
  await expect(page.locator('#cddTodo')).toHaveText('2 calls to make. 6 waiting for a draft, nothing to do yet. 3 on hold, just so you know.');
  await expect(page.locator('#subCleardebt')).not.toContainText('No draft for this step yet');
  await expect(page.locator('#cddReadWarning')).toContainText('Xero changed during the read, retrying next run');
  await shotDesk(page, '11-draft-coming.png', '#clearDebtCards');
});

test('Promises, Jan and Deposits tabs', async ({ page }) => {
  await openDesk(page);
  await page.locator('[data-cdd-tab="promises"]').click();
  const status = await page.locator('[data-cdd-promise]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cdd-promise')));
  expect(status).toEqual(['broken', 'open']); // Theo's broken promise rides on his item; Grace's open one is in paused[]
  await expect(page.locator('[data-cdd-promise="open"]')).toContainText('Grace Tan');
  await expect(page.locator('[data-cdd-promise="open"]')).toContainText('chasing resumes');
  await shotDesk(page, '03-promises.png');
  await page.locator('[data-cdd-tab="jan"]').click();
  await expect(page.locator('[data-cdd-item]')).toHaveCount(1);
  await expect(card(page, 'Nina Hollis')).toBeVisible();
  await expect(page.locator('[data-cdd-group="hold"]')).toHaveCount(0);
  await shotDesk(page, '04-jan.png');
  await page.locator('[data-cdd-tab="deposits"]').click();
  await expect(page.locator('#cddDeposits tbody tr')).toHaveCount(3);
  await expect(page.locator('#cddDepositsTotal')).toContainText('$14,270.01 on 3 invoices');
  await expect(page.locator('#cddDeposits')).not.toContainText('Eli Moreau');
  const apart = page.locator('#cddDepositsApart tbody tr');
  await expect(apart).toHaveCount(1);
  await expect(apart).toContainText('Eli Moreau');
  await expect(apart).toContainText('Deposit invoice made late to match a bank transfer already received');
  await expect(apart.locator('.cd-pill')).toHaveCount(0);
  await expect(page.locator('[data-cdd-tab="deposits"] em')).toHaveText('3');
  await expect(page.locator('#cddDepositsUnsorted')).toHaveCount(0);
  await expect(page.locator('#cddDeposits .cd-pill')).toHaveCount(1);
  await shotDesk(page, '05-deposits.png');
});

test('Jan tab lists held Jan-step payers below, with the reason and no draft', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const nina = fixture.debt_morning_list.items.find((i) => i.payer_name === 'Nina Hollis');
  // The backend's hold shape: group 'hold', step null, and held_step naming the step the payer would be on.
  fixture.debt_morning_list.items.push(Object.assign({}, nina, { id: nina.id.replace(':jan:jan_visit', ':hold:check_first') + ':INV-9017', payer_name: 'Held Jan Payer', group: 'hold', step: null, held_step: 'jan_visit',
    step_label: 'Check first: Says paid, checking the bank', hold: 'check_first', hold_reason: 'Says paid, checking the bank', draft: null }));
  await openDesk(page, { fixture });
  await page.locator('[data-cdd-tab="jan"]').click();
  const order = await page.locator('[data-cdd-item] .cdd-nm').allTextContents();
  expect(order).toEqual(['Nina Hollis', 'Held Jan Payer']);
  const held = card(page, 'Held Jan Payer');
  await expect(page.locator('[data-cdd-group="hold"]')).toContainText('On hold, no draft');
  await expect(held).toContainText('Check first.');
  await expect(held).toContainText('Says paid, checking the bank');
  await expect(held.locator('textarea')).toHaveCount(0);
  await expect(held.locator('input[type=checkbox]')).toHaveCount(0);
  await expect(page.locator('[data-cdd-tab="jan"] em')).toHaveText('1');
});

test('Jan tab and its count include a broken promise that lands on the Jan visit', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const nina = fixture.debt_morning_list.items.find((i) => i.payer_name === 'Nina Hollis');
  fixture.debt_morning_list.items.push(Object.assign({}, nina, { id: nina.id.replace(':jan:jan_visit', ':broken_promise:jan_visit'), payer_key: 'broken-jan', payer_name: 'Broken Jan Payer', group: 'broken_promise', step: 'jan_visit',
    step_label: 'Promise broken: Jan visits', promise: { amount: 500, date: nina.invoices[0].due_date, status: 'broken' } }));
  await openDesk(page, { fixture });
  await page.locator('[data-cdd-tab="jan"]').click();
  const order = await page.locator('[data-cdd-item] .cdd-nm').allTextContents();
  expect(order).toEqual(['Broken Jan Payer', 'Nina Hollis']);
  await expect(page.locator('[data-cdd-tab="jan"] em')).toHaveText('2');
});

test('before the backend steps deploy: plain "not live yet", no guessed number, our copy still shown', async ({ page }) => {
  await openDesk(page, { drop: ['debt_book', 'debt_morning_list', 'debt_log_outcome'] });
  await expect(page.locator('#clearDebtStats')).toContainText('The live Xero read (debt_book) is not live yet.');
  await expect(page.locator('#cddOverdue')).toHaveCount(0);
  await expect(page.locator('#clearDebtCards')).toContainText('The morning list (debt_morning_list) is not live yet.');
  await shotDesk(page, '06-not-live-yet.png');
  await page.locator('[data-cdd-tab="book"]').click();
  await expect(page.locator('#clearDebtBookHead .cd-legend')).toBeVisible();
  await page.locator('#clearDebtBookHead .cd-legend button', { hasText: 'Chase now' }).click();
  await page.locator('.cd-row', { hasText: 'Harper Nguyen' }).click();
  await page.locator('#cd-rec').getByText('Log what happened').click();
  await page.locator('#cd-rec').getByRole('button', { name: 'Spoke' }).click();
  await expect(page.locator('#cd-rec .cdd-out [data-cdd-said]')).toHaveText('Logging what happened is not live yet. Nothing was saved; use Add note for now.');
});

test('Deposits without the morning list: says not-chased invoices cannot be set apart, and shows no 60-day pill', async ({ page }) => {
  await openDesk(page, { drop: ['debt_morning_list'] });
  await page.locator('[data-cdd-tab="deposits"]').click();
  await expect(page.locator('#cddDepositsUnsorted')).toContainText('cannot be set apart yet');
  await expect(page.locator('#cddDepositsUnsorted')).toContainText('This total may include them');
  await expect(page.locator('#cddDeposits tbody tr')).toHaveCount(4);
  await expect(page.locator('#cddDeposits')).toContainText('Eli Moreau');
  await expect(page.locator('#cddDeposits .cd-pill')).toHaveCount(0);
  await expect(page.locator('#cddDepositsApart')).toHaveCount(0);
});

test('phone width keeps the header and list readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openDesk(page);
  await expect(page.locator('#cddOverdue')).toBeVisible();
  const overflow = await page.evaluate(() => document.getElementById('subCleardebt').scrollWidth - document.getElementById('subCleardebt').clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shotDesk(page, '07-phone.png');
});
