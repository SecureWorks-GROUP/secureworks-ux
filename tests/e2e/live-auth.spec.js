const { test, expect } = require('@playwright/test');
const { signIn } = require('../helpers/auth');

const accounts = [
  {
    role: 'installer',
    email: process.env.E2E_TRADE_INSTALLER_EMAIL,
    password: process.env.E2E_TRADE_INSTALLER_PASSWORD
  },
  {
    role: 'allocator',
    email: process.env.E2E_TRADE_ALLOCATOR_EMAIL,
    password: process.env.E2E_TRADE_ALLOCATOR_PASSWORD
  }
];

for (const account of accounts) {
  test(`dedicated ${account.role} account can authenticate against Supabase`, async ({ page }, testInfo) => {
    test.skip(
      !account.email || !account.password,
      `LIVE AUTH SKIPPED: add E2E_TRADE_${account.role.toUpperCase()}_EMAIL and E2E_TRADE_${account.role.toUpperCase()}_PASSWORD`
    );
    testInfo.annotations.push({
      type: 'safety',
      description: 'Read-only login check. The test never clicks a mutation control.'
    });

    const writes = [];
    page.on('request', (request) => {
      if (request.url().includes('/functions/v1/ops-api') && request.method() !== 'GET') {
        writes.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto('/trade.html');
    await signIn(page, account);
    await expect(page.locator('#viewLogin')).not.toHaveClass(/active/);
    await expect(page.locator('#headerUser')).not.toBeEmpty();
    expect(writes, 'live auth checks must not call an ops-api mutation').toEqual([]);
  });
}
