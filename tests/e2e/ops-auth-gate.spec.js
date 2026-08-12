const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { installSupabaseAuthStub } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPERATOR = {
  email: 'ops-auth-gate@example.test',
  password: 'e2e-password',
  profile: {
    id: '00000000-0000-4000-8000-000000000099',
    email: 'ops-auth-gate@example.test',
    name: 'E2E Ops',
    role: 'ops_manager',
    org_id: '00000000-0000-4000-8000-000000000001',
  },
};

test('public dashboard sources contain no operator-key credential path', async () => {
  const root = path.resolve(__dirname, '../..');
  const files = [
    'ops.html', 'ceo.html', 'sale.html', 'sale-preview.html', 'trade.html',
    'shared/cloud.js', ...fs.readdirSync(path.join(root, 'modules'))
      .filter((name) => /^ops-.*\.js$/.test(name))
      .map((name) => `modules/${name}`),
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    expect(source, `${file} must not define a browser operator key`).not.toMatch(/(?:SW_API_KEY|_swApiKey)\s*=/);
    expect(source, `${file} must not send x-api-key`).not.toMatch(/['"]x-api-key['"]\s*:/);
  }
});

test('clean profile sees login only and sends no operator-data requests', async ({ page }) => {
  await installSupabaseAuthStub(page, {
    users: { [OPERATOR.email]: OPERATOR },
    profileEndpoint: `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy`,
  });

  const sensitiveRequests = [];
  page.on('request', (request) => {
    if (/\/functions\/v1\/(?:ops-api|daily-digest|reporting-api|ghl-proxy|send-po-email)/.test(request.url())) {
      sensitiveRequests.push(request.url());
    }
  });

  await page.goto('/ops.html');
  await expect(page.locator('#swAuthGate')).toBeVisible();
  await expect(page.getByText('Sign in to continue', { exact: true })).toBeVisible();
  await expect(page.locator('#mainApp')).toBeHidden();
  await page.waitForTimeout(750);

  expect(sensitiveRequests).toEqual([]);
});

test('signed-in operator calls makesafe_board with user JWT only', async ({ page }) => {
  await installSupabaseAuthStub(page, {
    users: { [OPERATOR.email]: OPERATOR },
    profileEndpoint: `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy`,
  });

  const opsRequests = [];
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/ops-api**`, async (route) => {
    const request = route.request();
    const action = new URL(request.url()).searchParams.get('action');
    opsRequests.push({ action, headers: request.headers() });
    const body = action === 'makesafe_board'
      ? {
          contract_version: 'makesafe-board.v1',
          projection: 'ops',
          columns: { new: [], allocated: [], trade_report_in: [], report_ready: [], completed: [], archive: [], cancelled: [] },
          rows: [],
        }
      : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route(`${SUPABASE_ORIGIN}/functions/v1/daily-digest**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"alerts":[]}',
  }));

  await page.goto('/ops.html');
  await page.locator('#swAuthEmail').fill(OPERATOR.email);
  await page.locator('#swAuthPassword').fill(OPERATOR.password);
  await page.locator('#swAuthSubmit').click();
  await expect(page.locator('#swAuthGate')).toHaveCount(0);

  await page.evaluate(() => opsFetch('makesafe_board', { projection: 'ops' }));
  const boardRequest = opsRequests.find((request) => request.action === 'makesafe_board');
  expect(boardRequest).toBeTruthy();
  expect(boardRequest.headers.authorization).toBe('Bearer e2e-access-token');
  expect(boardRequest.headers['x-api-key']).toBeUndefined();
});
