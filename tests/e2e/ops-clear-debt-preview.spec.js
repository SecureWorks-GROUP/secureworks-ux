// Clear Debt Today tab in layout B, the captain's pick (docs/clear-debt-desk.md). Layout B is live
// (CDD_LAYOUT_B_LIVE); this spec still opens it at ops.html?view=clear-debt-preview, which now shows
// no banner. ops-clear-debt-desk.spec.js guards the older morning list, kept until it is removed. Offline: ops-api is
// replaced by tests/fixtures/clear-debt-desk.js (made-up names, dates from today's Perth date).
//
// Contract under guard:
//  - The preview link opens Financials > Clear Debt in layout B with no banner; the plain tab is
//    layout B too.
//  - A dark "To do today" bar with a chip per kind of work and Next to do (the next unfinished row,
//    in menu order, wrapping); a left menu of sections in chase order with counts (broken
//    promises, Jan visits, calls, texts, builder statements, deposit reminders, then On hold and
//    Done today), opening on the first with work; a table, one line per payer; and a detail panel
//    for the row picked. Held payers are information only. Every send button is disabled, reads
//    "Sending off until Shaun says go" and carries no handler.
//  - The panel has ONE obvious button for the row's step; no draft yet reads "Draft coming -
//    nothing to do yet" with no button. Ticks sit on the table rows, across sections.
//  - Jan's morning text is the first row of Jan visits; approving it posts its own invoice ids and
//    its template_text, as on the live tab. Each Jan visit offers what Jan reports.
//  - What happened is laid open in the panel; the promise box opens only on Promised.
// Screenshots: CLEAR_DEBT_EVIDENCE_DIR=docs/evidence/<folder> npx playwright test tests/e2e/ops-clear-debt-preview.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');
const { buildClearDebtDeskFixture } = require('../fixtures/clear-debt-desk');

const EVIDENCE_DIR = process.env.CLEAR_DEBT_EVIDENCE_DIR
  ? path.resolve(process.cwd(), process.env.CLEAR_DEBT_EVIDENCE_DIR)
  : path.resolve(__dirname, '../../test-results/ops-clear-debt-preview');
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
  await page.mouse.move(0, 0); // no hover highlight in the shot
  await page.locator(selector).screenshot({ path: shot(name) });
}

test.use({ viewport: { width: 1360, height: 1000 } });

async function openDesk(page, { fixture = buildClearDebtDeskFixture(), drop = [] } = {}) {
  await page.goto('/ops.html?view=clear-debt-preview');
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
    // Boot routes the preview link straight to Clear Debt.
    restoreTab();
  }, { fixture, drop });
  await expect(page.locator('#subCleardebt')).toBeVisible();
}

// Item ids are the backend's (date:payer_key:group:step), so cards and rows are found by payer name.
// Today: pick a section on the left menu and a row in its table; the panel then holds that row.
async function pick(page, sec, name) {
  await page.locator('.cdd-side [data-cdd-sec="' + sec + '"]').click();
  await page.locator('tr[data-cdd-row]', { has: page.locator('.cdd-rn', { hasText: new RegExp('^' + name + '$') }) }).click();
  await expect(page.locator('#cddDetail .cdd-nm').first()).toHaveText(name);
  return page.locator('#cddDetail');
}
function rowNames(page) { return page.locator('tr[data-cdd-row] .cdd-rn').allTextContents(); }

test('layout B is live: the preview link still opens Clear Debt in layout B, now with no PREVIEW banner, and so does the plain tab', async ({ page }) => {
  await openDesk(page);
  await expect(page.locator('#subCleardebt')).toHaveClass(/active/);
  await expect(page.locator('#cddPreviewBanner')).toHaveCount(0);
  await expect(page.locator('#cddDesk')).toBeVisible();
  await page.evaluate(() => { window.__SW_CLEAR_DEBT_PREVIEW = false; cddRender(); });
  await expect(page.locator('#cddPreviewBanner')).toHaveCount(0);
  await expect(page.locator('#cddDesk')).toBeVisible();
  await expect(page.locator('[data-cdd-group="broken_promise"]')).toHaveCount(0); // not the older morning list
});

test('Today: the left menu lists the sections in chase order with counts, opens on the first with work, holds have nothing to press, send is off everywhere', async ({ page }) => {
  await openDesk(page);
  const secs = await page.locator('.cdd-side [data-cdd-sec]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cdd-sec') + ':' + e.querySelector('.cdd-cnt').textContent));
  expect(secs).toEqual(['broken_promise:1', 'jan:2', 'call:2', 'text:2', 'statement:1', 'deposit_reminder:1', 'hold:3', 'done:0']);
  await expect(page.locator('.cdd-side [data-cdd-sec="broken_promise"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.cdd-side [data-cdd-sec="broken_promise"]')).toContainText('Broken promises');
  await expect(page.locator('[data-cdd-sec-title]')).toHaveText('Broken promises - 1 to do');
  await expect(page.locator('#cddDetail .cdd-nm')).toHaveText('Theo Brennan'); // the first row is picked
  await expect(page.locator('tr[data-cdd-row].sel .cdd-rn')).toHaveText('Theo Brennan');
  await page.locator('.cdd-side [data-cdd-sec="hold"]').click();
  await expect(page.locator('[data-cdd-sec-title]')).toHaveText('On hold - 3 held, no draft');
  expect(await rowNames(page)).toEqual(['Ruby Castillo', 'Builderwest', 'Major Loss Builders']);
  await expect(page.locator('#cddDetail')).toContainText('Fix first.');
  const ruby = await pick(page, 'hold', 'Ruby Castillo');
  await expect(ruby.locator('.cdd-chip.step')).toHaveCount(0); // the backend's "Fix first: ..." label is not repeated as a chip
  await expect(ruby).toContainText('Job in rectification: gate latch to refit');
  await expect(ruby.locator('textarea')).toHaveCount(0);
  await expect(ruby.locator('input[type=checkbox]')).toHaveCount(0);
  await expect(ruby.locator('button, a.cdd-btn, details')).toHaveCount(0); // information only
  await expect(page.locator('[data-cdd-table="hold"] input[type=checkbox]')).toHaveCount(0);
  await expect(page.locator('#cddAlso')).toContainText('1 is paused on a promise to pay (see Promises)');
  await expect(page.locator('#cddAlso')).toContainText('2 waiting for a later chase or a due date');
  await expect(page.locator('#cddAlso')).toContainText('2 invoices are never chased');
  const sends = page.locator('button.send');
  expect(await sends.count()).toBeGreaterThan(0);
  for (const b of await sends.all()) {
    await expect(b).toBeDisabled();
    await expect(b).toHaveText('Sending off until Shaun says go');
    expect(await b.getAttribute('onclick')).toBeNull();
  }
});

test('Today opens with the dark To do today bar: a chip per kind of work, Next to do, and sending is off so approving only queues', async ({ page }) => {
  await openDesk(page);
  await expect(page.locator('#cddTodo > b')).toHaveText('To do today:');
  expect(await page.locator('#cddTodo [data-cdd-chip]').allTextContents()).toEqual(['2texts to approve', '2calls to make', "1Jan's text to approve", '1builder statement to approve']);
  await expect(page.locator('#cddTodo')).toHaveAttribute('aria-label', "2 texts to approve, 2 calls to make, Jan's text to approve (1 visit), 1 builder statement to approve. 3 on hold, just so you know.");
  await expect(page.locator('#cddTodo .cdd-tnote')).toHaveText('3 on hold');
  await expect(page.locator('#cddNext')).toHaveText('Next to do →');
  await expect(page.locator('#cddSendingOff')).toHaveText('Sending is off until Shaun says go - approving now just queues them.');
  await expect(page.locator('#cddBuilt')).toHaveText(/^Morning list for .+, built 07:05\.$/);
  await page.locator('#cddTodo [data-cdd-chip="call"]').click();
  await expect(page.locator('.cdd-side [data-cdd-sec="call"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#cddDetail .cdd-nm')).toHaveText('Mia Laurent');
  await page.locator('#cddTodo [data-cdd-chip="jan_text"]').click();
  await expect(page.locator('#cddDetail [data-cdd-jantext]')).toBeVisible();
  await shotDesk(page, '01-today.png');
});

test('Next to do walks the unfinished rows in menu order, skipping decided ones, and wraps round', async ({ page }) => {
  await openDesk(page);
  const seen = [];
  for (let n = 0; n < 7; n += 1) {
    await page.locator('#cddNext').click();
    seen.push(await page.locator('#cddDetail .cdd-nm').first().textContent());
  }
  // Oscar's text is already approved and Ivy's reminder skipped: nothing left to press there.
  expect(seen).toEqual(["Jan's morning text", 'Mia Laurent', 'AJ Building & Restoration', 'Harper Nguyen', 'Major Loss Builders', 'Theo Brennan', "Jan's morning text"]);
  // A call logged on this screen is done: Next to do moves past it, and the row says so.
  const mia = await pick(page, 'call', 'Mia Laurent');
  await mia.getByRole('button', { name: 'No answer', exact: true }).click();
  await expect(page.locator('tr[data-cdd-row].sel .cdd-rst')).toContainText('Logged: No answer');
  await page.locator('#cddNext').click();
  await expect(page.locator('#cddDetail .cdd-nm')).toHaveText('AJ Building & Restoration');
});

test('Next to do reads All done for now when the open row is the only one left; a row with no amount does not blank the section total', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const m = fixture.debt_morning_list;
  m.items = m.items.filter((i) => i.payer_name === 'Mia Laurent' || i.payer_name === 'Oscar Patel' || i.payer_name === 'Harper Nguyen');
  m.items.find((i) => i.payer_name === 'Harper Nguyen').draft.status = 'approved';
  delete m.items.find((i) => i.payer_name === 'Oscar Patel').amount;
  m.jan_text = null;
  await openDesk(page, { fixture });
  await expect(page.locator('#cddDetail .cdd-nm')).toHaveText('Mia Laurent');
  await expect(page.locator('#cddNext')).toHaveText('All done for now');
  await expect(page.locator('#cddNext')).toBeDisabled();
  await page.locator('.cdd-side [data-cdd-sec="text"]').click();
  await expect(page.locator('.cdd-tbar .cdd-tsum')).toHaveText('$6,480');
  await expect(page.locator('#cddNext')).toHaveText('Next to do →');
  await page.locator('#cddNext').click();
  await expect(page.locator('#cddDetail .cdd-nm')).toHaveText('Mia Laurent');
});

test('the table is one line per payer and the keyboard walks it', async ({ page }) => {
  await openDesk(page);
  await page.locator('.cdd-side [data-cdd-sec="text"]').click();
  await expect(page.locator('[data-cdd-table="text"] thead th')).toHaveText(['Tick', 'Customer', 'Invoice', 'Overdue', 'Message', 'Last contact', 'Owing']);
  const harper = page.locator('tr[data-cdd-row]', { hasText: 'Harper Nguyen' });
  await expect(harper).toContainText('INV-9001');
  await expect(harper.locator('.cd-pill')).toHaveText('2 days');
  await expect(harper.locator('td.msgp')).toContainText('Hi Harper, a friendly reminder');
  await expect(harper.locator('td.amt')).toHaveText('$6,480.00');
  await expect(page.locator('tr[data-cdd-row]', { hasText: 'Oscar Patel' }).locator('.cdd-rst')).toHaveText('Approved, queued');
  await page.locator('.cdd-side [data-cdd-sec="call"]').click();
  await expect(page.locator('[data-cdd-table="call"] thead th')).toHaveText(['Customer', 'Invoice', 'Overdue', 'Last contact', 'Owing']); // a call is never ticked
  await expect(page.locator('tr[data-cdd-row]', { hasText: 'Mia Laurent' }).locator('td.lc')).toHaveText(/^No answer, /);
  await page.locator('tr[data-cdd-row].sel').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#cddDetail .cdd-nm')).toHaveText('AJ Building & Restoration');
  await expect(page.locator('tr[data-cdd-row].sel')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#cddDetail .cdd-nm')).toHaveText('Mia Laurent');
  await shotDesk(page, '09-calls.png');
});

test('the panel shows one obvious button for the row picked', async ({ page }) => {
  await openDesk(page);
  const primary = async (sec, name) => (await pick(page, sec, name)).locator('[data-cdd-primary]').allTextContents();
  expect(await primary('text', 'Harper Nguyen')).toEqual(['Approve text']);
  expect(await primary('broken_promise', 'Theo Brennan')).toEqual(['Approve text']);
  expect(await primary('call', 'Mia Laurent')).toEqual(['Call now']);
  expect(await primary('jan', 'Nina Hollis')).toEqual([]); // listed in Jan's text, approved once there
  expect(await primary('jan', "Jan's morning text")).toEqual(["Approve Jan's text"]);
  expect(await primary('statement', 'Major Loss Builders')).toEqual(['Approve statement']);
  expect(await primary('text', 'Oscar Patel')).toEqual([]); // already approved
  expect(await primary('deposit_reminder', 'Ivy Okafor')).toEqual([]); // already skipped
});

test('the panel holds the call, its history and the drafted message, with What happened laid open', async ({ page }) => {
  await openDesk(page);
  const mia = await pick(page, 'call', 'Mia Laurent');
  await expect(mia.locator('a[data-cdd-primary]')).toHaveAttribute('href', 'tel:0400000103');
  await expect(mia.locator('.cdd-wh')).toHaveText('What happened?');
  await expect(mia.locator('[data-cdd-history]')).toHaveText(/^History: last time No answer, .*, Shaun\.$/);
  const aj = await pick(page, 'call', 'AJ Building & Restoration');
  await expect(aj.locator('[data-cdd-primary]')).toHaveCount(0);
  await expect(aj.locator('[data-cdd-nophone]')).toBeVisible();
  await expect(aj.locator('[data-cdd-history]')).toHaveText('History: nothing logged yet.');
  // The drafted message is shown above its button; Edit and Skip are small links beside it.
  const harper = await pick(page, 'text', 'Harper Nguyen');
  await expect(harper.locator('.cdd-msg')).toContainText('Hi Harper, a friendly reminder');
  await expect(harper.locator('textarea')).toHaveCount(0);
  await expect(harper.locator('button.cdd-link.sm')).toHaveText(['Edit', 'Skip']);
  // What happened is open in the panel; the promise box waits for Promised.
  for (const name of ['No answer', 'Spoke', 'Promised', 'Disputed', 'Says paid']) await expect(harper.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(harper.locator('details')).toHaveCount(0);
  await expect(harper.getByLabel('Promised amount')).toBeHidden();
  await expect(harper.getByLabel('Note')).toBeVisible();
  await shotDesk(page, '10-texts.png');
});

test('a builder statement shows its text above one Approve statement button', async ({ page }) => {
  await openDesk(page);
  const mlb = await pick(page, 'statement', 'Major Loss Builders');
  await expect(mlb.locator('.cdd-msg')).toContainText('Statement for Major Loss Builders');
  await expect(mlb.locator('button.cdd-link.sm')).toHaveText(['Edit', 'Skip']);
  await mlb.getByRole('button', { name: 'Approve statement' }).click();
  await expect(mlb).toContainText('Approved by ops-e2e');
  await expect(page.locator('tr[data-cdd-row].sel .cdd-rst')).toHaveText('Approved, queued');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_draft_decide'));
  expect(post.body).toMatchObject({ draft_id: 'draft-mlb-statement', decision: 'approve' });
});

test('approve a draft, then tick rows across sections and approve ticked in one go', async ({ page }) => {
  await openDesk(page);
  const harper = await pick(page, 'text', 'Harper Nguyen');
  await harper.getByRole('button', { name: 'Edit', exact: true }).click();
  await harper.locator('textarea').fill('Hi Harper, a friendly reminder about INV-9001. Thanks, SecureWorks WA');
  await harper.getByRole('button', { name: 'Approve text', exact: true }).click();
  await expect(harper).toContainText('Approved by ops-e2e');
  const tick = async (sec, name) => {
    await page.locator('.cdd-side [data-cdd-sec="' + sec + '"]').click();
    await page.locator('tr[data-cdd-row]', { has: page.locator('.cdd-rn', { hasText: new RegExp('^' + name + '$') }) }).locator('input[type=checkbox]').check();
  };
  await tick('broken_promise', 'Theo Brennan');
  await page.locator('.cdd-side [data-cdd-sec="jan"]').click();
  await expect(page.locator('tr[data-cdd-row]', { hasText: 'Nina Hollis' }).locator('input[type=checkbox]')).toHaveCount(0); // Jan's text is ticked, not the visit
  await tick('jan', "Jan's morning text");
  await tick('statement', 'Major Loss Builders');
  await expect(page.locator('#cddApproveTicked')).toHaveText('Approve ticked (3)');
  await page.locator('#cddApproveTicked').click();
  await expect(await pick(page, 'broken_promise', 'Theo Brennan')).toContainText('Approved');
  await expect(await pick(page, 'jan', "Jan's morning text")).toContainText('Approved');
  await expect(await pick(page, 'statement', 'Major Loss Builders')).toContainText('Approved');
  const posts = await page.evaluate(() => window.__cddPosts);
  expect(posts.map((p) => p.action)).toEqual(['debt_draft_decide', 'debt_draft_decide', 'debt_draft_decide', 'debt_draft_decide']);
  expect(posts[0].body).toMatchObject({ draft_id: 'draft-harper', decision: 'approve', text: 'Hi Harper, a friendly reminder about INV-9001. Thanks, SecureWorks WA' });
  await expect(page.locator('#cddTodo [data-cdd-chip]')).toHaveText(['2calls to make']);
});

test('outcome buttons and the promise box log against the payer\'s invoices', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  await openDesk(page, { fixture });
  const mia = await pick(page, 'call', 'Mia Laurent');
  await expect(mia.getByLabel('Promised amount')).toBeHidden(); // the promise box opens only on Promised
  await mia.getByRole('button', { name: 'Promised', exact: true }).click();
  await expect(mia.getByLabel('Promised amount')).toBeVisible();
  await shotDesk(page, '11-what-happened.png', '#cddDetail');
  await mia.getByRole('button', { name: 'Save promise' }).click();
  await expect(mia.locator('.cdd-out [data-cdd-said]')).toHaveText('Put the promised amount in first');
  await mia.getByLabel('Promised amount').fill('500');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date());
  await mia.getByLabel('Promised date').fill(today);
  await mia.getByRole('button', { name: 'Save promise' }).click();
  await expect(mia.locator('.cdd-out [data-cdd-said]')).toContainText('Logged: Promised $500.00');
  await mia.getByRole('button', { name: 'No answer' }).click();
  await expect(mia.locator('.cdd-out [data-cdd-said]')).toContainText('Logged: No answer');
  const posts = await page.evaluate(() => window.__cddPosts.filter((p) => p.action === 'debt_log_outcome'));
  expect(posts[0].body.payer_key).toBe(fixture.debt_morning_list.items.find((i) => i.payer_name === 'Mia Laurent').payer_key);
  expect(posts[0].body).toMatchObject({ outcome_code: 'promised', promised_amount: 500, promised_date: today, channel: 'call', schedule_step: 'call', xero_invoice_ids: [fixture.debt_book.invoices[2].xero_invoice_id] });
  expect(posts[1].body.outcome_code).toBe('no_answer');
  expect(posts[1].body.schedule_step).toBe('call');
});

test('a typed note and promise survive the panel repainting and another row being picked, and clear once logged', async ({ page }) => {
  await openDesk(page);
  let harper = await pick(page, 'text', 'Harper Nguyen');
  await harper.getByRole('button', { name: 'Promised', exact: true }).click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date());
  await harper.getByLabel('Promised amount').fill('250');
  await harper.getByLabel('Promised date').fill(today);
  await harper.getByLabel('Note').fill('Paying Friday');
  await harper.getByRole('button', { name: 'Edit', exact: true }).click(); // repaints the panel
  await expect(harper.locator('textarea')).toBeVisible();
  await expect(harper.getByLabel('Note')).toHaveValue('Paying Friday');
  await pick(page, 'broken_promise', 'Theo Brennan');
  harper = await pick(page, 'text', 'Harper Nguyen');
  await expect(harper.getByLabel('Note')).toHaveValue('Paying Friday');
  await expect(harper.getByLabel('Promised amount')).toHaveValue('250');
  await expect(harper.getByLabel('Promised date')).toHaveValue(today);
  await harper.getByRole('button', { name: 'Save promise' }).click();
  await expect(harper.locator('.cdd-out [data-cdd-said]')).toContainText('Logged: Promised $250.00');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_log_outcome'));
  expect(post.body).toMatchObject({ outcome_code: 'promised', promised_amount: 250, promised_date: today, note: 'Paying Friday' });
  await expect(harper.getByLabel('Note')).toHaveValue('');
  await expect(harper.getByLabel('Promised amount')).toHaveValue('');
});

test('an outcome on a text card logs no schedule_step, so the unsent text is not marked done', async ({ page }) => {
  await openDesk(page);
  const harper = await pick(page, 'text', 'Harper Nguyen');
  await harper.getByRole('button', { name: 'No answer' }).click();
  await expect(harper.locator('.cdd-out [data-cdd-said]')).toContainText('Logged: No answer');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_log_outcome'));
  expect(post.body).toMatchObject({ outcome_code: 'no_answer', schedule_step: null });
  await expect(harper.locator('[data-cdd-primary]')).toHaveText('Approve text'); // the text still waits for its decision
});

test('step 2 as built: no drafts yet is said plainly with no button, and an unstable Xero read is flagged', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  fixture.debt_morning_list.items.forEach((i) => { i.draft = null; });
  fixture.debt_morning_list.jan_text = null;
  fixture.debt_book.read_stable = false;
  fixture.debt_book.read_warning = 'Xero changed during the read, retrying next run';
  await openDesk(page, { fixture });
  await expect(page.locator('.cdd-fig', { hasText: 'Waiting for Shaun' })).toContainText('no drafts written yet');
  await expect(page.locator('.cdd-fig', { hasText: 'Waiting for Shaun' }).locator('.v')).toHaveText('0');
  await expect(page.locator('.cdd-side [data-cdd-sec="call"]')).toHaveAttribute('aria-selected', 'true'); // the first section with something to do
  for (const [sec, name] of [['text', 'Harper Nguyen'], ['jan', 'Nina Hollis'], ['statement', 'Major Loss Builders']]) {
    const p = await pick(page, sec, name);
    await expect(p).toContainText('Draft coming - nothing to do yet');
    await expect(p.locator('[data-cdd-primary]')).toHaveCount(0);
    await expect(p.locator('.cdd-wh')).toHaveText(sec === 'jan' ? 'What did Jan report?' : 'What happened?');
    await expect(page.locator('tr[data-cdd-row].sel .cdd-rst')).toHaveText('Draft coming');
  }
  for (const name of ['Mia Laurent', 'AJ Building & Restoration']) await expect(await pick(page, 'call', name)).not.toContainText('Draft coming');
  await expect((await pick(page, 'call', 'Mia Laurent')).locator('[data-cdd-primary]')).toHaveText('Call now'); // a call needs no draft
  await expect(page.locator('#cddTodo [data-cdd-chip]')).toHaveText(['2calls to make']);
  await expect(page.locator('#cddTodo .cdd-tnote')).toHaveText('6 waiting for a draft · 3 on hold');
  await expect(page.locator('#cddTodo')).toHaveAttribute('aria-label', '2 calls to make. 6 waiting for a draft, nothing to do yet. 3 on hold, just so you know.');
  await expect(page.locator('#subCleardebt')).not.toContainText('No draft for this step yet');
  await expect(page.locator('#cddReadWarning')).toContainText('Xero changed during the read, retrying next run');
  await pick(page, 'text', 'Harper Nguyen');
  await shotDesk(page, '12-draft-coming.png');
});

test("Jan's morning text: the first row of Jan visits, to Jan's mobile listing the visits, approved once with its own invoice ids", async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const jt = fixture.debt_morning_list.jan_text;
  await openDesk(page, { fixture });
  await page.locator('.cdd-side [data-cdd-sec="jan"]').click();
  expect(await rowNames(page)).toEqual(["Jan's morning text", 'Nina Hollis']);
  const card0 = (await pick(page, 'jan', "Jan's morning text")).locator('[data-cdd-jantext]');
  await expect(card0.locator('.cdd-nm')).toHaveText("Jan's morning text");
  await expect(card0.locator('[data-cdd-jan-phone]')).toHaveText('0411 222 333');
  await expect(card0.locator('[data-cdd-visits] li')).toHaveText(['Nina Hollis, 12 Example Street, Exampleton INV-9017 · $1,573.68 · 8 days overdue']);
  await expect(card0.locator('.cdd-msg')).toContainText('Please tell Shaun how each visit goes.');
  await expect(card0.locator('button.cdd-link.sm')).toHaveText(['Edit', 'Skip']);
  await expect(card0.locator('input[type=checkbox]')).toHaveCount(0); // the tick lives on the table row
  await shotDesk(page, '17-jan-text.png');
  const nina = await pick(page, 'jan', 'Nina Hollis');
  await expect(nina.locator('[data-cdd-injan]')).toHaveText("In Jan's text, waiting for your approval. Log what Jan reports below.");
  await expect(nina).not.toContainText('Draft coming');
  await expect(page.locator('tr[data-cdd-row].sel .cdd-rst')).toHaveText("In Jan's text");
  await pick(page, 'jan', "Jan's morning text");
  await card0.getByRole('button', { name: "Approve Jan's text" }).click();
  await expect(card0).toContainText('Approved by ops-e2e. Queued until sending is switched on.');
  await expect((await pick(page, 'jan', 'Nina Hollis')).locator('[data-cdd-injan]')).toContainText("In Jan's text, approved, queued until sending is switched on.");
  await expect(page.locator('#cddTodo')).toHaveAttribute('aria-label', '2 texts to approve, 2 calls to make, 1 builder statement to approve. 3 on hold, just so you know.');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_draft_decide'));
  expect(post.body).toEqual({ draft_id: jt.id, decision: 'approve', text: jt.text, xero_invoice_ids: jt.xero_invoice_ids, template_text: jt.template_text });
});

test("Jan's text that cannot be approved shows the reason, a disabled button with no handler, and only Skip", async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  Object.assign(fixture.debt_morning_list.jan_text, { to_phone: null, mobile_source: null, approvable: false, problem: "Jan's mobile not set: no staff record named Jan has a mobile. Add the mobile to Jan's staff record, or set JAN_MOBILE" });
  await openDesk(page, { fixture });
  const card0 = (await pick(page, 'jan', "Jan's morning text")).locator('[data-cdd-jantext]');
  await expect(card0.locator('[data-cdd-jan-phone]')).toHaveText("Jan's mobile not set");
  await expect(card0.locator('[data-cdd-jan-problem]')).toContainText("Cannot approve yet. Jan's mobile not set: no staff record named Jan has a mobile.");
  const approve = card0.getByRole('button', { name: "Approve Jan's text" });
  await expect(approve).toBeDisabled();
  expect(await approve.getAttribute('onclick')).toBeNull();
  await expect(card0.locator('[data-cdd-primary]')).toHaveCount(0);
  await expect(page.locator('tr[data-cdd-row="jan_text"] input[type=checkbox]')).toHaveCount(0);
  await expect(page.locator('tr[data-cdd-row="jan_text"] .cdd-rst')).toHaveText('Cannot approve yet');
  await expect(card0.locator('button.cdd-link.sm')).toHaveText(['Skip']);
  await expect(page.locator('#cddTodo [data-cdd-chip="jan_text"]')).toHaveText("Jan's text cannot be approved yet");
  await shotDesk(page, '14-jan-text-no-mobile.png', '#cddDetail');
  await card0.getByRole('button', { name: 'Skip' }).click();
  await expect(card0).toContainText('Skipped for today.');
  const posts = await page.evaluate(() => window.__cddPosts.filter((p) => p.action === 'debt_draft_decide'));
  expect(posts.map((p) => p.body)).toEqual([{ draft_id: fixture.debt_morning_list.jan_text.id, decision: 'skip', text: fixture.debt_morning_list.jan_text.text, xero_invoice_ids: fixture.debt_morning_list.jan_text.xero_invoice_ids }]);
});

test("an edited Jan's text is approved from the panel with the edited text and the list's own template_text", async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const jt = fixture.debt_morning_list.jan_text;
  await openDesk(page, { fixture });
  const card0 = (await pick(page, 'jan', "Jan's morning text")).locator('[data-cdd-jantext]');
  await card0.getByRole('button', { name: 'Edit', exact: true }).click();
  const edited = jt.text.replace('Please tell Shaun', 'Please text Shaun');
  await card0.locator('textarea').fill(edited);
  await card0.getByRole('button', { name: "Approve Jan's text" }).click();
  await expect(card0).toContainText('Approved by ops-e2e');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_draft_decide'));
  expect(post.body).toEqual({ draft_id: jt.id, decision: 'approve', text: edited, xero_invoice_ids: jt.xero_invoice_ids, template_text: jt.template_text });
});

test('a Jan visit row offers what Jan reports and logs it as a visit at the Jan step', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const ninaItem = fixture.debt_morning_list.items.find((i) => i.payer_name === 'Nina Hollis');
  ninaItem.last_outcome = { code: 'no_answer', label: 'No one home', at: ninaItem.invoices[0].due_date + 'T10:15:00+08:00', by: 'Shaun' };
  await openDesk(page, { fixture });
  const nina = await pick(page, 'jan', 'Nina Hollis');
  await expect(nina.locator('[data-cdd-history]')).toContainText('History: last time No one home');
  await expect(page.locator('tr[data-cdd-row].sel td.lc')).toHaveText(/^No one home, /);
  await expect(nina.locator('.cdd-wh')).toHaveText('What did Jan report?');
  await expect(nina.locator('.cdd-obtns').first().locator('button')).toHaveText(['Visited: paid', 'Visited: promised', 'No one home', 'Visited: disputed']);
  await expect(nina.getByRole('button', { name: 'Spoke', exact: true })).toHaveCount(0);
  await shotDesk(page, '15-jan-visit-outcomes.png', '#cddDetail');
  await nina.getByRole('button', { name: 'No one home' }).click();
  await expect(nina.locator('.cdd-out [data-cdd-said]')).toContainText('Logged: No one home');
  const post = await page.evaluate(() => window.__cddPosts.find((p) => p.action === 'debt_log_outcome'));
  expect(post.body).toMatchObject({ outcome_code: 'no_answer', channel: 'visit', schedule_step: 'jan_visit', xero_invoice_ids: [ninaItem.invoices[0].xero_invoice_id] });
});

test("a Jan visit today's sent Jan text does not cover goes on tomorrow's; an unlabelled last outcome reads as the call words", async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const m = fixture.debt_morning_list, jt = m.jan_text;
  const ninaItem = m.items.find((i) => i.payer_name === 'Nina Hollis');
  ninaItem.last_outcome = { code: 'no_answer', at: ninaItem.invoices[0].due_date + 'T10:15:00+08:00', by: 'Shaun' };
  Object.assign(jt, { status: 'sent', approvable: false, decided_at: m.perth_date + 'T07:40:00+08:00', visits: jt.visits.filter((v) => v.item_id !== ninaItem.id) });
  await openDesk(page, { fixture });
  const nina = await pick(page, 'jan', 'Nina Hollis');
  await expect(nina.locator('[data-cdd-item]')).toHaveAttribute('data-cdd-kind', 'not_in_jan_text');
  await expect(nina.locator('.cdd-wait')).toHaveText("Not in today's text to Jan - goes on tomorrow's");
  await expect(nina.locator('[data-cdd-primary]')).toHaveCount(0);
  await expect(page.locator('tr[data-cdd-row].sel input[type=checkbox]')).toHaveCount(0);
  await expect(page.locator('tr[data-cdd-row].sel .cdd-rst')).toHaveText("On tomorrow's Jan text");
  await expect(nina.locator('[data-cdd-history]')).toHaveText(/^History: last time No answer, /);
  await expect(page.locator('#cddTodo')).not.toContainText('Jan visit');
});

test("Done today lists what went out, Jan's as Jan's morning text; a sent Jan text offers no button", async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const m = fixture.debt_morning_list, jt = m.jan_text;
  const sentAt = m.perth_date + 'T07:40:00+08:00';
  Object.assign(jt, { status: 'sent', approvable: false, decided_at: sentAt, approved_by: 'Shaun', template_text: null, edited: null });
  m.sent_today = [
    { draft_id: jt.id, to: 'jan', payer_name: 'Jan', invoice_numbers: ['INV-9017'], step: 'jan_text', text: jt.text, at: sentAt, by: 'Shaun', provider_message_id: 'msg-1' },
    { draft_id: 'draft-zoe', to: 'client', payer_name: 'Zoe Archer', invoice_numbers: ['INV-9020'], step: 'friendly_text', text: 'Hi Zoe, a friendly reminder.', at: m.perth_date + 'T07:41:00+08:00', by: 'Shaun', provider_message_id: 'msg-2' },
  ];
  await openDesk(page, { fixture });
  await expect(page.locator('.cdd-side [data-cdd-sec="done"] .cdd-cnt')).toHaveText('2');
  await page.locator('.cdd-side [data-cdd-sec="done"]').click();
  await expect(page.locator('[data-cdd-sec-title]')).toHaveText('Done today - 2 sent');
  const rows = page.locator('#cddSentToday tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-cdd-sent', 'jan');
  await expect(rows.nth(0).locator('b')).toHaveText("Jan's morning text");
  await expect(rows.nth(0)).toContainText('07:40');
  await expect(rows.nth(1).locator('b')).toHaveText('Zoe Archer');
  await rows.nth(1).click();
  await expect(page.locator('#cddDetail')).toContainText('Sent 07:41 by Shaun · INV-9020');
  await expect(page.locator('#cddDetail .cdd-msg')).toHaveText('Hi Zoe, a friendly reminder.');
  await shotDesk(page, '16-done-today.png');
  const card0 = (await pick(page, 'jan', "Jan's morning text")).locator('[data-cdd-jantext]');
  await expect(card0).toContainText('Sent 07:40.');
  await expect(card0.locator('button')).toHaveCount(0);
  await expect((await pick(page, 'jan', 'Nina Hollis')).locator('[data-cdd-injan]')).toContainText("In Jan's text, sent to Jan.");
  await expect(page.locator('#cddTodo')).not.toContainText("Jan's text");
});

test('a group the screen does not know shows under Other, never dropped', async ({ page }) => {
  const fixture = buildClearDebtDeskFixture();
  const harper = fixture.debt_morning_list.items.find((i) => i.payer_name === 'Harper Nguyen');
  fixture.debt_morning_list.items.push(Object.assign({}, harper, { id: harper.id.replace(':text:', ':payment_plan:'), payer_name: 'Plan Payer', group: 'payment_plan', draft: Object.assign({}, harper.draft, { id: 'draft-plan' }) }));
  await openDesk(page, { fixture });
  await expect(page.locator('.cdd-side [data-cdd-sec="other"] .cdd-cnt')).toHaveText('1');
  const p = await pick(page, 'other', 'Plan Payer');
  await expect(p.locator('[data-cdd-primary]')).toHaveText('Approve text');
});

test('phone width: the menu becomes a select, the panel stacks under the table, nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openDesk(page);
  await expect(page.locator('#cddOverdue')).toBeVisible();
  await expect(page.locator('.cdd-side')).toBeHidden();
  await expect(page.locator('#cddSecSelect')).toBeVisible();
  await page.locator('#cddSecSelect').selectOption('call');
  await expect(page.locator('[data-cdd-sec-title]')).toHaveText('Calls - 2 to do');
  await expect(page.locator('#cddDetail .cdd-nm')).toHaveText('Mia Laurent');
  const table = await page.locator('.cdd-main').boundingBox(), panel = await page.locator('#cddDetail').boundingBox();
  expect(panel.y).toBeGreaterThanOrEqual(table.y + table.height - 1);
  const overflow = await page.evaluate(() => document.getElementById('subCleardebt').scrollWidth - document.getElementById('subCleardebt').clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shotDesk(page, '07-phone.png');
});
