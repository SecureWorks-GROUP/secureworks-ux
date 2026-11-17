// P0-14.6: the Today panel reads the stored daily digest (built once a day by
// the server), sends one request at a time, keeps the last digest on a failed
// read and waits 5 minutes, hides itself before the first build, and says which
// Perth day the digest was built for.
const { test, expect } = require('@playwright/test');
const { installSupabaseAuthStub } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPERATOR = {
  email: 'ops-digest-read@example.test',
  password: 'e2e-password',
  profile: {
    id: '00000000-0000-4000-8000-000000000098',
    email: 'ops-digest-read@example.test',
    name: 'E2E Ops',
    role: 'ops_manager',
    org_id: '00000000-0000-4000-8000-000000000001',
  },
};

// Built at 23:00 UTC on Sunday 15 Nov: 07:00 Monday 16 Nov in Perth.
const BUILT_AT = '2026-11-15T23:00:00.000Z';
// The panel sits on the Today tab, which may not be the open tab, so read the
// panel's own display rather than whether it is on screen.
const panelDisplay = (page) => page.evaluate(() => document.getElementById('aiAlertsPanel').style.display);

const STORED = {
  alerts: [{ severity: 'red', title: 'Stand-in red alert', detail: 'Detail', action: 'Act' }],
  ai_narrative: 'Stand-in morning brief.',
  summary_text: '',
  built_at: BUILT_AT,
  digest_date: '2026-11-15',
  stored: true,
};

async function signIn(page, digestReply) {
  await installSupabaseAuthStub(page, {
    users: { [OPERATOR.email]: OPERATOR },
    profileEndpoint: `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy`,
  });
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/ops-api**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }));
  const digestCalls = [];
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/daily-digest**`, async (route) => {
    const request = route.request();
    digestCalls.push({ url: request.url(), method: request.method() });
    const reply = await digestReply(digestCalls.length);
    await route.fulfill({
      status: reply.status || 200,
      contentType: 'application/json',
      body: JSON.stringify(reply.body || {}),
    });
  });
  await page.goto('/ops.html');
  await page.locator('#swAuthEmail').fill(OPERATOR.email);
  await page.locator('#swAuthPassword').fill(OPERATOR.password);
  await page.locator('#swAuthSubmit').click();
  await expect(page.locator('#swAuthGate')).toHaveCount(0);
  return digestCalls;
}

test('the panel shows the stored digest and the Perth day it was built for', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T01:00:00.000Z') });
  const calls = await signIn(page, () => ({ body: STORED }));
  await page.evaluate(() => loadAiAlerts());
  await expect(page.locator('#aiRedAlerts')).toContainText('Stand-in red alert');
  expect(await panelDisplay(page)).toBe('block');
  await expect(page.locator('#aiNarrative')).toContainText('Built for Monday 16 November.');
  await expect(page.locator('#aiNarrative')).not.toContainText('has not been built yet');
  // Every digest request is a plain read: no build action, never a POST.
  for (const call of calls) {
    expect(call.method).toBe('GET');
    expect(new URL(call.url).searchParams.get('action')).toBeNull();
  }
});

test('a digest more than a day old says today has not been built yet', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T01:00:00.000Z') });
  await signIn(page, () => ({ body: STORED }));
  await page.evaluate(() => loadAiAlerts());
  await expect(page.locator('#aiNarrative')).toContainText(
    "Built for Monday 16 November. Today's digest has not been built yet.",
  );
});

test('the all-clear line has no dash and carries the built line', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T01:00:00.000Z') });
  await signIn(page, () => ({ body: { ...STORED, alerts: [], ai_narrative: '' } }));
  await page.evaluate(() => loadAiAlerts());
  await expect(page.locator('#aiNarrative')).toContainText('All clear. No issues detected this morning.');
  await expect(page.locator('#aiNarrative')).toContainText('Built for Monday 16 November.');
  expect(await page.locator('#aiNarrative').innerText()).not.toContain('\u2014');
});

test('before the first build the panel stays hidden, never an all clear', async ({ page }) => {
  await signIn(page, () => ({
    body: { alerts: [], summary_text: '', stored: true, digest_date: null, not_built_yet: true },
  }));
  await page.evaluate(() => loadAiAlerts());
  expect(await panelDisplay(page)).toBe('none');
  await expect(page.locator('#aiNarrative')).not.toContainText('All clear');
});

test('one request at a time: overlapping loads send one read', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = await signIn(page, async (n) => {
    if (n > 1) await gate; // hold the second and later reads open
    return { body: STORED };
  });
  const before = calls.length;
  await page.evaluate(() => {
    _digestCache = null; _digestCacheTime = 0; _digestFailedAt = 0;
    loadAiAlerts(); loadAiAlerts(); loadAiAlerts();
  });
  await page.waitForTimeout(300);
  expect(calls.length - before).toBe(1);
  release();
});

test('a failed read keeps the last digest on screen and waits 5 minutes', async ({ page }) => {
  let fail = false;
  const calls = await signIn(page, () => (fail ? { status: 500, body: { error: 'down' } } : { body: STORED }));
  await page.evaluate(() => loadAiAlerts());
  await expect(page.locator('#aiRedAlerts')).toContainText('Stand-in red alert');

  // The 30 minute cache has run out and the next read fails: the last digest stays.
  fail = true;
  let n = calls.length;
  await page.evaluate(() => { _digestCacheTime = 0; return loadAiAlerts(); });
  expect(calls.length).toBe(n + 1);
  expect(await panelDisplay(page)).toBe('block');
  await expect(page.locator('#aiRedAlerts')).toContainText('Stand-in red alert');

  // Four minutes after the failure: no new read goes out.
  n = calls.length;
  await page.evaluate(() => { _digestFailedAt = Date.now() - 4 * 60 * 1000; return loadAiAlerts(); });
  expect(calls.length).toBe(n);
  await expect(page.locator('#aiRedAlerts')).toContainText('Stand-in red alert');

  // Six minutes after: it tries again.
  fail = false;
  await page.evaluate(() => { _digestFailedAt = Date.now() - 6 * 60 * 1000; return loadAiAlerts(); });
  expect(calls.length).toBe(n + 1);
});

// ── CEO page: the same stored read, guard and built line ─────────────────

async function openCeo(page, digestReply) {
  // No sign-in: the page's own functions are called with a stand-in header,
  // so no whitelisted address appears in the test.
  await installSupabaseAuthStub(page, { users: {}, profileEndpoint: `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy` });
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/reporting-api**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }));
  const digestCalls = [];
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/daily-digest**`, async (route) => {
    digestCalls.push({ url: route.request().url(), method: route.request().method() });
    const reply = await digestReply(digestCalls.length);
    await route.fulfill({ status: reply.status || 200, contentType: 'application/json', body: JSON.stringify(reply.body || {}) });
  });
  await page.goto('/ceo.html');
  await page.evaluate(() => {
    window.ceoAuthHeaders = async () => ({ Authorization: 'Bearer e2e-access-token' });
  });
  return digestCalls;
}

test('CEO page: the stored digest shows its Perth built day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T01:00:00.000Z') });
  const calls = await openCeo(page, () => ({ body: STORED }));
  await page.evaluate(() => loadCeoAlerts());
  await expect(page.locator('#ceoRedAlerts')).toContainText('Stand-in red alert');
  await expect(page.locator('#ceoNarrative')).toContainText(
    "Built for Monday 16 November. Today's digest has not been built yet.",
  );
  expect(calls.every((c) => c.method === 'GET' && new URL(c.url).searchParams.get('action') === null)).toBe(true);
});

test('CEO page: before the first build the panel stays hidden', async ({ page }) => {
  await openCeo(page, () => ({
    body: { alerts: [], summary_text: '', stored: true, digest_date: null, not_built_yet: true },
  }));
  await page.evaluate(() => loadCeoAlerts());
  expect(await page.evaluate(() => document.getElementById('ceoAlertsPanel').style.display)).toBe('none');
});

test('CEO page: overlapping loads send one read', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = await openCeo(page, async () => { await gate; return { body: STORED }; });
  await page.evaluate(() => { loadCeoAlerts(); loadCeoAlerts(); loadCeoAlerts(); });
  await page.waitForTimeout(300);
  expect(calls.length).toBe(1);
  release();
});
