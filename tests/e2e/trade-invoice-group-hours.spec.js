// Trade invoicing W2 (6 Nov 2026). On the Weekly Invoice:
// - a failed group read holds only the group section, with a retry, and the
//   trade's ordinary jobs can still be submitted;
// - a crew member adds their own hours to a group job without leaving the
//   screen, through the same submit_group_work_order_hours action the job page
//   uses, and a refused save keeps what they typed and says why.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.describe.configure({ timeout: 60_000 });
test.use({ persona: 'fencing_manager', feedScenario: 'henry-job-centric-submit', timezoneId: 'Australia/Perth', appWeekDay: 6, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const groupId = '55555555-5555-4555-8555-555555555555';
const groupJob = '66666666-6666-4666-8666-666666666666';
const group = { group_id: groupId, job_id: groupJob, job_number: 'SWP-GROUP-HOURS', client_name: 'Group fixture client', site_suburb: 'South Perth', pot_total: 2000, awaiting: 'needs_hours', client_signed: false, crew_hours: [{ name: 'Me', me: true, hours: 0 }] };

async function openInvoice(page) {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('[data-pm-wo-hydrate="pending"]')).toHaveCount(0);
}

test('a failed group read holds only the group section; ordinary jobs still submit', async ({ appPage: page }) => {
  let fail = true;
  await page.route('**/functions/v1/ops-api?**', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'my_group_work_orders') {
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Something went wrong on our side.' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, group_job_ids: [groupJob], groups: [group] }) });
    }
    return route.fallback();
  });
  await openInvoice(page);
  const failed = page.locator('[data-group-read-failed]');
  await expect(failed).toContainText('Your other jobs can still be invoiced');
  await expect(page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' })).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('group-read-failed.png'), fullPage: true });

  fail = false;
  await failed.locator('[data-group-retry]').click();
  await expect(page.locator('[data-invoice-group]')).toContainText('SWP-GROUP-HOURS');
  await expect(page.locator('[data-group-read-failed]')).toHaveCount(0);
});

test('a member saves their own hours from the invoice; a refused save keeps the times', async ({ appPage: page }) => {
  const saves = [];
  let refuse = true;
  await page.route('**/functions/v1/ops-api?**', async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'my_group_work_orders') return json({ enabled: true, group_job_ids: [groupJob], groups: [group] });
    if (action === 'submit_group_work_order_hours') {
      saves.push(req.postDataJSON());
      if (refuse) return json({ ok: false, code: 'group_split_busy', error: 'Someone else on the crew is saving right now. Try again in a moment.' }, 409);
      return json({ ok: true, group_id: groupId });
    }
    return route.fallback();
  });
  await openInvoice(page);
  const form = page.locator('[data-group-hours-form]');
  await expect(form).toContainText('Any day you worked on this job');
  await form.locator('[data-group-hours-field="work_date"]').fill('2026-11-04');
  await form.locator('[data-group-hours-field="start_time"]').fill('07:00');
  await form.locator('[data-group-hours-field="finish_time"]').fill('15:30');
  await form.locator('[data-group-hours-field="break_minutes"]').fill('30');
  await form.locator('[data-group-hours-save]').click();

  await expect(page.locator('[data-group-hours-error]')).toContainText('Try again in a moment');
  await expect(page.locator('[data-group-hours-field="work_date"]')).toHaveValue('2026-11-04');
  await expect(page.locator('[data-group-hours-field="start_time"]')).toHaveValue('07:00');
  await expect(page.locator('[data-group-hours-field="finish_time"]')).toHaveValue('15:30');
  await page.screenshot({ path: test.info().outputPath('group-hours-refused.png'), fullPage: true });

  refuse = false;
  await page.locator('[data-group-hours-save]').click();
  await expect(page.locator('[data-group-hours-saved]')).toBeVisible();
  expect(saves).toHaveLength(2);
  expect(saves[1]).toMatchObject({ group_id: groupId, work_date: '2026-11-04', start_time: '07:00', finish_time: '15:30', break_minutes: 30 });
});

// Fix 4 (6 Nov 2026): a crew member the office removed is never offered Join.
const removedLine = 'The office removed you from this group. Ask the office if this is wrong.';
const outsider = (discovery, awaiting) => ({ group_id: groupId, job_id: groupJob, job_number: 'SWP-GROUP-HOURS', client_name: 'Group fixture client', site_suburb: 'South Perth', discovery, awaiting, pot_total: null, my_share: null, needs_hours: true, client_signed: null, group_share_office_review_required: true });

test('a removed member sees a plain line, not Join, when the server says so', async ({ appPage: page }) => {
  await page.route('**/functions/v1/ops-api?**', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'my_group_work_orders') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, groups: [outsider({ state: 'setup_required', reason: 'removed_by_office', message: 'The office removed you from this group.' }, 'awaiting_office')] }) });
    return route.fallback();
  });
  await openInvoice(page);
  const card = page.locator('[data-invoice-group]');
  await expect(card.locator('[data-group-removed]')).toHaveText(removedLine);
  await expect(card.getByRole('button', { name: 'Join group work order' })).toHaveCount(0);
  await expect(card.locator('[data-group-hours-form], [data-group-sign-open]')).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('group-removed.png') });
});

test('an older server offers Join; its removal refusal turns the button into the plain line', async ({ appPage: page }) => {
  const joins = [];
  await page.route('**/functions/v1/ops-api?**', async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'my_group_work_orders') return json({ enabled: true, groups: [outsider({ state: 'join' }, 'needs_join')] });
    if (action === 'join_group_work_order') { joins.push(req.postDataJSON()); return json({ ok: false, code: 'group_member_removed', error: 'The office removed you from this group.' }, 403); }
    return route.fallback();
  });
  await openInvoice(page);
  const card = page.locator('[data-invoice-group]');
  await card.getByRole('button', { name: 'Join group work order', exact: true }).click();
  await expect(card.locator('[data-group-removed]')).toHaveText(removedLine);
  await expect(card.getByRole('button', { name: 'Join group work order' })).toHaveCount(0);
  expect(joins).toEqual([{ group_id: groupId }]);
});

test('extras say plainly not to repeat the hours above', async ({ appPage: page }) => {
  await page.route('**/functions/v1/ops-api?**', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'my_group_work_orders') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, groups: [] }) });
    return route.fallback();
  });
  await openInvoice(page);
  await expect(page.getByText('Only add items that are not already in your hours above.', { exact: true })).toBeVisible();
  await expect(page.getByText(/clocked hours above/)).toHaveCount(0);
});
