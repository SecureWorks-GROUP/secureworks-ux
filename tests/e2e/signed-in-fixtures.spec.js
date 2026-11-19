const { test, expect } = require('@playwright/test');
const {
  installSignedInSession,
  createConsoleErrorCollector,
} = require('./helpers/signed-in');
const {
  ZZTEST_QUOTE_TOKEN,
  ZZTEST_QUOTE_VIEW_PAYLOAD,
  installQuoteLinkMock,
} = require('../fixtures/quote-link');

test('ops.html renders signed in behind #swAuthGate without real login or permission errors', async ({ page }) => {
  const errors = createConsoleErrorCollector(page);
  const session = await installSignedInSession(page);

  await page.goto('/ops.html');

  await expect(page.locator('#swAuthGate')).toHaveCount(0);
  await expect(page.locator('#mainApp')).toBeVisible();
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);

  // Ops Realtime alerts channel subscribes on the mocked client.
  await expect.poll(async () => {
    const ch = await session.getChannel('alerts');
    return Boolean(ch && ch.subscribed);
  }).toBe(true);

  const alertsChannel = await session.getChannel('alerts');
  expect(alertsChannel.onSharedClient).toBe(true);
  expect(alertsChannel.bindings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'postgres_changes',
        filter: expect.objectContaining({ event: 'INSERT', table: 'ai_alerts' }),
      }),
    ]),
  );

  // All backend calls stayed local and no permission/auth errors were logged.
  expect(session.blockedRequests).toEqual([]);
  expect(session.requests.some((r) => r.fn === 'ghl-proxy' && r.action === 'get_profile')).toBe(true);
  expect(session.requests.some((r) => r.fn === 'ops-api')).toBe(true);
  expect(errors.getPermissionErrors()).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('ceo.html renders signed in behind #authGate and subscribes ceo-alerts on the mocked client', async ({ page }) => {
  const errors = createConsoleErrorCollector(page);
  const session = await installSignedInSession(page);

  await page.goto('/ceo.html');

  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('#mainApp')).toBeVisible();
  await expect(page.locator('#reportContent')).toBeVisible();
  await expect(page.locator('#glanceCard')).toContainText('$120K');
  await expect(page.locator('#ceoNarrative')).toContainText('ZZTEST morning brief fixture.');

  // CEO Realtime channel subscribes on the mocked shared client.
  await expect.poll(async () => {
    const ch = await session.getChannel('ceo-alerts');
    return Boolean(ch && ch.subscribed);
  }).toBe(true);

  const ceoChannel = await session.getChannel('ceo-alerts');
  expect(ceoChannel).not.toBeNull();
  expect(ceoChannel.subscribed).toBe(true);
  expect(ceoChannel.onSharedClient).toBe(true);
  expect(await session.getClientCount()).toBe(1);
  expect(ceoChannel.bindings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'postgres_changes',
        filter: expect.objectContaining({ event: 'INSERT', schema: 'public', table: 'ai_alerts' }),
      }),
    ]),
  );

  // Realtime WebSocket endpoint is routed locally and never reaches live Supabase.
  const wsReply = await page.evaluate(() => new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://kevgrhcjxspbxgovpmfl.supabase.co/realtime/v1/websocket?vsn=1.0.0');
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ topic: 'realtime:ceo-alerts', event: 'phx_join', payload: {}, ref: '1' }));
    });
    ws.addEventListener('message', (ev) => {
      ws.close();
      resolve(JSON.parse(ev.data));
    });
    ws.addEventListener('error', () => reject(new Error('WebSocket failed')));
  }));
  expect(wsReply).toMatchObject({
    topic: 'realtime:ceo-alerts',
    event: 'phx_reply',
    payload: { status: 'ok' },
    ref: '1',
  });
  expect(session.websockets).toHaveLength(1);

  expect(session.blockedRequests).toEqual([]);
  expect(session.requests.some((r) => r.fn === 'reporting-api' && r.action === 'ceo_report')).toBe(true);
  expect(session.requests.some((r) => r.fn === 'daily-digest')).toBe(true);
  expect(errors.getPermissionErrors()).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('customer quote link renders ZZTEST fixture via quote-viewer.html and send-quote/view route mock', async ({ page }) => {
  const errors = createConsoleErrorCollector(page);
  const quoteMock = await installQuoteLinkMock(page);

  // Render via quote-viewer.html?src=<send-quote/view?token=ZZTEST-FIXTURE-TOKEN>
  await page.goto(quoteMock.viewerPath);

  const root = page.locator('[data-testid="zztest-quote-view"]');
  await expect(root).toBeVisible();
  await expect(root).toHaveAttribute('data-token', ZZTEST_QUOTE_TOKEN);
  await expect(page.locator('[data-testid="quote-job-number"]')).toHaveText(ZZTEST_QUOTE_VIEW_PAYLOAD.job_number);
  await expect(page.locator('[data-testid="quote-client-name"]')).toHaveText(ZZTEST_QUOTE_VIEW_PAYLOAD.client_name);
  await expect(page.locator('[data-testid="quote-site-address"]')).toHaveText(ZZTEST_QUOTE_VIEW_PAYLOAD.site_address);
  await expect(page.locator('[data-testid="quote-total"]')).toHaveText('$1,100.00');

  expect(quoteMock.requests).toHaveLength(1);
  expect(quoteMock.requests[0].token).toBe(ZZTEST_QUOTE_TOKEN);

  // Direct navigation to the customer quote link URL also renders locally.
  await page.goto(quoteMock.url);
  await expect(page.locator('[data-testid="zztest-quote-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="quote-job-number"]')).toHaveText(ZZTEST_QUOTE_VIEW_PAYLOAD.job_number);

  expect(quoteMock.requests).toHaveLength(2);
  expect(errors.getPermissionErrors()).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
