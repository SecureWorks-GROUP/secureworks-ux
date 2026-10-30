const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

// A group job on site: the group sits in the job's own card, the crew approve
// each other's hours, the client rates and signs on the phone, then each share
// unlocks and the whole crew is sent for payment together. Crew see hours,
// never anyone else's pay. Server owns every figure.
test.describe.configure({ timeout: 60_000 });
test.use({ persona: 'fencing_manager', feedScenario: 'henry-job-centric-submit', timezoneId: 'Australia/Perth', appWeekDay: 6, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const groupId = '33333333-3333-4333-8333-333333333333';
const groupJob = '44444444-4444-4444-8444-444444444444';
const shots = process.env.GROUP_RELEASE_SHOTS || '';
// Other trades' money rides on the fixture rows so a leak would show.
const OTHER_PAY = ['1,002.72', '1002.72', '805.72', '62.00', '$62', '48.00', '$48'];
const base = {
  group_id: groupId, job_id: groupJob, job_number: 'SWP-261247', client_name: 'Clive Allen', site_suburb: 'South Perth',
  pot_total: 2720, needs_hours: false, group_share_office_review_required: true, pay_basis: 'all_in_12_v2', budget_includes_super: true,
  crew_approval_required: true, projected_my_budget: 911.56, projected_cash_pay: 813.89, projected_super: 97.67, projected_my_share: 813.89,
};
const hours = henryApproved => [
  { name: 'Henry', me: true, hours: 18, approved: henryApproved },
  { name: 'Isaac', me: false, hours: 18, approved: true, rate: 62, pay: 1002.72 },
  { name: 'Ryan', me: false, hours: 18.5, approved: true, rate: 48, pay: 805.72 },
];
const crew = (henry, isaac, ryan) => [
  { name: 'Henry', me: true, state: henry }, { name: 'Isaac', me: false, state: isaac, share: 1002.72 }, { name: 'Ryan', me: false, state: ryan, share: 805.72 },
];
const release = extra => ({ released: false, ready: false, signoff: null, invoiced: 0, approved: 0, total: 3, hold: [], ...extra });
const byClive = { kind: 'client', name: 'Clive Allen', at: '2026-10-20T07:42:00.000Z', happy: true };
const byOffice = { kind: 'office', name: null, at: '2026-10-20T08:10:00.000Z', happy: null };
const frozenMoney = { my_budget: 911.56, my_share: 813.89, my_cash_pay: 813.89, my_super: 97.67 };
const invoice = { invoice_id: 'group-invoice', invoice_number: 'SW-INV-H-261030-001', status: 'pending_acknowledgment', review: 'awaiting' };
const PHASES = {
  approve: { ...base, awaiting: 'awaiting_crew_approval', client_signed: false, client_signoff: null, my_hours_approved: false, crew_hours: hours(false),
    crew_status: crew('not_invoiced', 'not_invoiced', 'not_invoiced'), release: release({ hold: ['Waiting on Henry to approve the hours.'] }) },
  unsigned: { ...base, awaiting: 'awaiting_signoff', client_signed: false, client_signoff: null, my_hours_approved: true, crew_hours: hours(true),
    crew_status: crew('not_invoiced', 'not_invoiced', 'not_invoiced'), release: release({ hold: ['Waiting on the client to sign.'] }) },
  ready: { ...base, awaiting: 'ready', client_signed: true, client_signoff: byClive, my_hours_approved: true, crew_hours: hours(true),
    crew_status: crew('not_invoiced', 'not_invoiced', 'not_invoiced'), release: release({ signoff: 'client', hold: ['Waiting on the crew to submit.'] }) },
};
PHASES.officeHours = { ...PHASES.unsigned, hours_office_approved: true,
  crew_hours: hours(true).map(row => ({ ...row, approved_by_office: true })) };
PHASES.frozen = { ...PHASES.ready, ...frozenMoney, awaiting: 'frozen', crew_status: crew('not_invoiced', 'submitted', 'not_invoiced'), release: release({ signoff: 'client', invoiced: 1, hold: ['Waiting on Henry and Ryan to submit.'] }) };
PHASES.submitted = { ...PHASES.frozen, submitted: invoice, crew_status: crew('submitted', 'approved', 'not_invoiced'), release: release({ signoff: 'client', invoiced: 2, approved: 1, hold: ['Waiting on Ryan to submit.'] }) };
PHASES.released = { ...PHASES.submitted, client_signoff: byOffice, submitted: { ...invoice, status: 'draft_in_xero' },
  crew_status: crew('released', 'released', 'released'), release: release({ released: true, ready: true, signoff: 'office', invoiced: 3, approved: 3 }) };

function henryHours() {
  const monday = perthWeekMonday();
  const job = (id, number, client, suburb, type) => ({ id, job_number: number, client_name: client, site_suburb: suburb, type });
  return {
    week_start: monday, week_ending: addIsoDays(monday, 6), invoice_type: 'per_metre', is_per_metre: true, rate: 55, rate_resolved: true,
    assignments: [
      { id: 'e2e-henry-group-assignment', job_id: groupJob, scheduled_date: monday, jobs: job(groupJob, 'SWP-261247', 'Clive Allen', 'South Perth', 'patio') },
      { id: 'e2e-henry-assignment', job_id: 'fence-job-henry', scheduled_date: addIsoDays(monday, 1), jobs: job('fence-job-henry', 'FENCE-HENRY-001', 'Henry Client', 'Balcatta', 'fencing') },
    ],
    total_hours: 0, already_submitted: false,
  };
}

async function fixtures(page, initial) {
  let phase = initial;
  const posts = [];
  await page.route('**/functions/v1/ops-api?**', async route => {
    const req = route.request(), action = new URL(req.url()).searchParams.get('action');
    const json = obj => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'my_hours') return json(henryHours());
    if (action === 'my_group_work_orders') return json({ enabled: true, group_job_ids: [groupJob], groups: [PHASES[phase]] });
    const post = () => posts.push({ action, body: req.postDataJSON() });
    if (action === 'sign_group_work_order_crew') { post(); phase = 'unsigned'; return json({ ok: true }); }
    if (action === 'capture_group_client_signoff') { post(); phase = 'ready'; return json({ ok: true }); }
    if (action === 'freeze_group_work_order') { post(); phase = 'frozen'; return json({ ...PHASES.frozen }); }
    if (action === 'generate_trade_invoice') {
      post(); phase = 'submitted';
      return json({ ok: true, success: true, invoice_id: 'group-invoice', invoice_number: 'SW-INV-H-261030-001', xero_bill_id: null, group_release: { released: false, hold: ['Waiting on Ryan to submit.'] } });
    }
    return route.fallback();
  });
  return { posts };
}

// Put the job card's title just under the app bar.
async function toCard(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.jc-card[data-group-job-card]');
    el.style.scrollMarginTop = '64px';
    el.scrollIntoView({ block: 'start' });
  });
}

async function open(page) {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const card = page.locator('.jc-card[data-group-job-card]');
  await expect(card).toContainText('SWP-261247 · Clive Allen');
  await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);
  await toCard(page);
  return card;
}

async function noOtherPay(locator) {
  for (const text of OTHER_PAY) await expect(locator).not.toContainText(text);
}

async function shot(page, name) {
  if (!shots) return;
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${shots}/${name}.png` });
}

test('the group sits in its own job card and Henry approves everyone’s hours', async ({ appPage: page }) => {
  const f = await fixtures(page, 'approve');
  const card = await open(page);
  // One place for the group: the job's card, not a separate box.
  await expect(page.locator('[data-invoice-groups]')).toHaveCount(0);
  await expect(page.locator('.jc-card[data-group-job-card]')).toHaveCount(1);
  await expect(card.locator('[data-group-mode] [aria-pressed="true"]')).toHaveText('Group work order');
  await expect(card.getByRole('button', { name: 'Hours', exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Commission', exact: true })).toBeDisabled();
  const rows = card.locator('[data-group-crew-row]');
  await expect(rows).toHaveText([/Henry\s*\(you\)\s*18h\s*Your turn/, /Isaac\s*18h\s*✓ Approved/, /Ryan\s*18\.5h\s*✓ Approved/]);
  await expect(card.locator('[data-group-signed="no"]')).toContainText('Not signed yet');
  await expect(card.locator('[data-group-locked]')).toHaveText('Unlocks when all hours are approved and the client has signed.');
  await expect(card.locator('[data-group-allocation]')).toHaveCount(0);
  await expect(card).not.toContainText('911.56');
  await noOtherPay(card);
  await shot(page, 'v2-1-approve-hours');

  await card.getByRole('button', { name: /Approve everyone.s hours/ }).click();
  await expect.poll(() => f.posts.length).toBe(1);
  expect(f.posts[0]).toEqual({ action: 'sign_group_work_order_crew', body: { group_id: groupId, signer_name: 'Henry Fence' } });
  await expect(rows.first()).toHaveText(/Henry\s*\(you\)\s*18h\s*✓ Approved/);
  await expect(card.getByRole('button', { name: /Approve everyone/ })).toHaveCount(0);
  await expect(card.locator('[data-group-pill]')).toHaveText('Needs sign-off');
  await expect(card.locator('[data-group-locked]')).toHaveText('Unlocks when the client has signed.');
});

test('the client rates the job, leaves a note and signs on Henry’s phone', async ({ appPage: page }) => {
  const f = await fixtures(page, 'unsigned');
  const card = await open(page);
  await expect(card).toContainText('Client can’t sign? The office can sign off instead.');
  await card.getByRole('button', { name: 'Hand phone to client to sign', exact: true }).click();
  const sheet = page.locator('dialog[data-group-sign-dialog]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('SecureWorks crew: Henry, Isaac, Ryan');
  await noOtherPay(sheet);
  const signOff = sheet.getByRole('button', { name: /happy with the work\. Sign off/ });
  await expect(signOff).toBeDisabled();
  // Ratings are never defaulted.
  await expect(sheet.getByRole('radio', { checked: true })).toHaveCount(0);

  await sheet.getByLabel('Anything to tell us?').fill('Tidy site and a great crew.');
  await expect(sheet.getByLabel('Client’s name')).toHaveValue('Clive Allen');
  const pad = await sheet.locator('canvas[data-gw-sign-pad]').boundingBox();
  await page.mouse.move(pad.x + 30, pad.y + 80);
  await page.mouse.down();
  for (const [dx, dy] of [[60, 30], [110, 70], [160, 25], [210, 75], [260, 40]]) await page.mouse.move(pad.x + dx, pad.y + dy, { steps: 4 });
  await page.mouse.up();

  const ratings = [['Sales and quote', 5], ['Communication', 5], ['Cleanliness', 5], ['Punctuality', 4], ['The crew', 5]];
  for (const [label, n] of ratings) {
    await expect(signOff).toBeDisabled();
    await sheet.getByRole('radio', { name: `${label} ${n} of 5`, exact: true }).click();
  }
  await expect(signOff).toBeEnabled();
  await shot(page, 'v2-2-client-sign');

  await signOff.click();
  await expect.poll(() => f.posts.length).toBe(1);
  const { action, body } = f.posts[0];
  expect(action).toBe('capture_group_client_signoff');
  expect(body).toMatchObject({
    group_id: groupId, signer_name: 'Clive Allen', happy: true, satisfaction_rating: 5,
    ratings: { sales_process: 5, communication: 5, cleanliness: 5, punctuality: 4, crew: 5 }, note: 'Tidy site and a great crew.',
  });
  expect(body.signature_png).toMatch(/^data:image\/png;base64,/);
  expect(body.signature_png.length).toBeGreaterThan(1000);
  await expect(sheet).toBeHidden();

  const signed = card.locator('[data-group-signed="client"]');
  await expect(signed).toContainText('✓ Client signed off');
  await expect(signed).toContainText('Clive Allen · Tue 20 Oct, 3:42pm · Happy');
  await expect(card.locator('[data-group-locked]')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Finalise group shares', exact: true })).toBeVisible();
});

test('with every hour approved and the client signed, Henry’s share unlocks and he submits it', async ({ appPage: page }) => {
  const f = await fixtures(page, 'ready');
  const card = await open(page);
  await expect(card.locator('[data-group-signed="client"]')).toContainText('✓ Client signed off');
  await expect(card.locator('[data-group-crew-row]')).toHaveText([/Henry.*18h\s*✓ Approved/, /Isaac.*18h\s*✓ Approved/, /Ryan.*18\.5h\s*✓ Approved/]);
  await expect(card.locator('[data-group-allocation]')).toHaveText(/Your share\s*\$911.56/);
  await expect(card.locator('[data-group-pay]')).toHaveText(/Pay\s*\$813.89/);
  await expect(card.locator('[data-group-super]')).toHaveText(/Super 12%, paid by us\s*\$97.67/);
  await expect(card.locator('[data-group-pill]')).toHaveText('Ready to finalise');

  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: 'Finalise group shares', exact: true }).click();
  const submit = card.getByRole('button', { name: 'Submit my group share', exact: true });
  await expect(submit).toBeVisible();
  await expect(card.locator('[data-group-pill]')).toHaveText('Ready to invoice');
  await expect(card.locator('[data-invoice-group-select]')).toHaveCount(0);
  await noOtherPay(card);
  await toCard(page);
  await shot(page, 'v2-3-share-unlocked');

  page.once('dialog', dialog => dialog.accept());
  await submit.click();
  await expect.poll(() => f.posts.length).toBe(2);
  expect(f.posts.map(p => p.action)).toEqual(['freeze_group_work_order', 'generate_trade_invoice']);
  expect(f.posts[0].body).toEqual({ group_id: groupId });
  expect(f.posts[1].body.extra_items).toEqual([{ type: 'group share', group_id: groupId }]);
  await expect(card.locator('[data-group-pill]')).toHaveText('Submitted');
  await expect(card.locator('[data-group-submit-note]')).toHaveText('Saved. Paid together once the whole crew is in.');
  await expect(card).not.toContainText('office review');
  await expect(card).toContainText('Invoice SW-INV-H-261030-001');
  await expect(card.locator('[data-group-release="held"]')).toContainText('2 of 3 in · sent for payment when all are in');
  await expect(submit).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'View my invoice' })).toBeVisible();
  // The share is its own invoice; it never joins the weekly total.
  await expect(page.locator('#invMoneySummary')).not.toContainText('813.89');
});

test('Group status shows who is in and why pay is held, never anyone’s money', async ({ appPage: page }) => {
  await fixtures(page, 'submitted');
  const card = await open(page);
  await card.getByRole('button', { name: 'Group status', exact: true }).click();
  const dialog = page.locator('[data-group-status-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-group-crew]')).toHaveText([/Henry \(you\)\s*Submitted/, /Isaac\s*Submitted/, /Ryan\s*Not yet/]);
  await expect(dialog).not.toContainText('Approved');
  await expect(dialog).toContainText('Client signed off');
  await expect(dialog.locator('[data-group-hold]')).toContainText('Waiting on Ryan to submit.');
  await noOtherPay(dialog);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('once the whole crew is in, the card says sent for payment, never paid', async ({ appPage: page }) => {
  await fixtures(page, 'released');
  const card = await open(page);
  await expect(card.locator('[data-group-pill]')).toHaveText('Sent for payment');
  await expect(card.locator('[data-group-release="released"]')).toContainText('All 3 in · sent for payment together');
  const office = card.locator('[data-group-signed="office"]');
  await expect(office).toContainText('✓ Office signed off');
  await expect(office).toContainText('Tue 20 Oct, 4:10pm');
  await expect(card).not.toContainText(/paid together/i);
  await noOtherPay(card);
  await expect(page.locator('body')).not.toContainText('1,002.72');
  await toCard(page);
  await shot(page, 'v2-4-paid-together');
  await card.getByRole('button', { name: 'Group status', exact: true }).click();
  const dialog = page.locator('[data-group-status-dialog]');
  await expect(dialog.locator('[data-group-crew]')).toHaveText([/Henry \(you\)\s*Sent for payment/, /Isaac\s*Sent for payment/, /Ryan\s*Sent for payment/]);
  await expect(dialog).toContainText('Office signed off');
  await expect(dialog.locator('[data-group-released]')).toContainText('Sent for payment.');
});

test('when the office approves the hours for the crew, each row says so and Henry has nothing to approve', async ({ appPage: page }) => {
  await fixtures(page, 'officeHours');
  const card = await open(page);
  const rows = card.locator('[data-group-crew-row]');
  await expect(rows).toHaveText([/Henry\s*\(you\)\s*18h\s*✓ Office approved/, /Isaac\s*18h\s*✓ Office approved/, /Ryan\s*18\.5h\s*✓ Office approved/]);
  await expect(card.getByRole('button', { name: /Approve everyone/ })).toHaveCount(0);
  await expect(card.locator('[data-group-locked]')).toHaveText('Unlocks when the client has signed.');
  await noOtherPay(card);
});
