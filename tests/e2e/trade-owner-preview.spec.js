const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { loadJsonFixture } = require('../helpers/feed-stub');

PERSONAS.owner_preview = {
  email: 'marnin@secureworkswa.com.au', password: 'e2e-password',
  profile: { id: 'e2e-owner', email: 'marnin@secureworkswa.com.au', name: 'Marnin', role: 'admin', org_id: '00000000-0000-0000-0000-000000000001', managed_verticals: [] }
};
const henry = { ...PERSONAS.installer.profile, id: '11111111-1111-4111-8111-111111111111', name: 'Henry preview' };
const isaac = { ...PERSONAS.installer.profile, id: '22222222-2222-4222-8222-222222222222', name: 'Isaac preview' };
test.use({ persona: 'owner_preview' });

test('owner views a selected trade’s real screen read-only and exits without changing identity', async ({ appPage: page }) => {
  const reads = [];
  const mutations = [];
  await page.route('**/functions/v1/ops-api?**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.searchParams.get('action');
    const target = url.searchParams.get('preview_trade_user_id');
    const profile = target === isaac.id ? isaac : henry;
    const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'trade_preview_context') {
      return reply(url.searchParams.get('user_id') ? { preview: true, read_only: true, profile } : { can_preview: true, trades: [henry, isaac] });
    }
    if (!target) return route.fallback();
    reads.push({ action, target });
    if (request.method() === 'POST' && action !== 'group_work_order_my_share') mutations.push(action);
    if (action === 'my_jobs') {
      const feed = loadJsonFixture('my-jobs.json');
      feed.today[0].user_id = profile.id;
      return reply(feed);
    }
    if (action === 'trade_job_detail') {
      const detail = loadJsonFixture('job-detail.json');
      detail.crew[0].user_id = profile.id;
      detail.group_work_order_enabled = true;
      return reply(detail);
    }
    if (action === 'group_work_order_my_share') return reply({
      group_id: 'fixture-group', client_signed: true, needs_hours: false,
      awaiting: 'frozen', pot_total: 2160, my_share: target === isaac.id ? 796.28 : 723.89,
      group_share_office_review_required: true
    });
    return route.fallback();
  });
  await signIn(page, PERSONAS.owner_preview);

  async function choose(profile) {
    await page.locator('#headerUser').click();
    await page.locator('#viewAsTradeBtn').click();
    await page.locator('#tradePreviewSelect').selectOption(profile.id);
    await expect(page).toHaveURL(new RegExp('preview_trade_user_id=' + profile.id));
    // The auth fixture does not persist sessions over a document reload.
    await signIn(page, PERSONAS.owner_preview);
    await expect(page.locator('#tradePreviewBanner')).toContainText('Viewing ' + profile.name);
    await expect(page.locator('#headerUser')).toContainText(profile.name);
  }
  async function inspectShare(amount) {
    await page.locator('#bottomNav [data-view="myJobs"]').click();
    await page.locator('#myJobsList').getByText(/E2E-JOB-001/).first().click();
    const group = page.locator('[data-group-wo]');
    await expect(group).toContainText(amount);
    await expect(group).toContainText(/2,?160\.00/);
    await expect(group.locator('[data-group-wo-action="invoice"]')).toBeDisabled();
    await expect(group.locator('[data-group-wo-gst]')).toBeDisabled();
    await page.locator('#bottomNav [data-view="hours"]').click();
    await expect(page.locator('[data-financial-hub]')).toContainText('Pay');
  }

  await choose(henry);
  const queued = JSON.stringify([{ id: 'owner-offline-invoice', action: 'generate_trade_invoice', body: { week_start: '2026-10-19' }, user_id: 'e2e-owner' }]);
  const clock = JSON.stringify({ assignment_id: 'owner-assignment', event: 'clock_off' });
  await page.evaluate(({ queued, clock }) => {
    localStorage.setItem('sw_action_queue', queued);
    localStorage.setItem('sw_pending_clock_owner', clock);
    window.dispatchEvent(new Event('online'));
  }, { queued, clock });
  await inspectShare('723.89');
  expect(await page.evaluate(() => localStorage.getItem('sw_action_queue'))).toBe(queued);
  expect(await page.evaluate(() => localStorage.getItem('sw_pending_clock_owner'))).toBe(clock);
  // Remove the disposable fixtures before returning to the real owner lens.
  await page.evaluate(() => { localStorage.removeItem('sw_action_queue'); localStorage.removeItem('sw_pending_clock_owner'); });
  await choose(isaac);
  await inspectShare('796.28');
  expect(reads.filter(r => r.action === 'group_work_order_my_share').map(r => r.target)).toEqual(expect.arrayContaining([henry.id, isaac.id]));
  expect(mutations).toEqual([]);
  await page.getByRole('button', { name: 'Exit preview', exact: true }).click();
  await expect(page).not.toHaveURL(/preview_trade_user_id/);
  await signIn(page, PERSONAS.owner_preview);
  await expect(page.locator('#headerUser')).toContainText('Marnin');
  await expect(page.locator('#tradePreviewBanner')).toHaveCount(0);
});
