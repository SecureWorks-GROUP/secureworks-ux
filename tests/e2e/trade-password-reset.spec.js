const fs = require('fs');
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SHOTS = '/opt/cursor/artifacts';

test.describe('Trade password reset', () => {
  test('the live trade app URL is the reset redirect', () => {
    const source = fs.readFileSync('trade.html', 'utf8');
    expect(source).toContain('https://secureworks-group.github.io/secureworks-ux/trade.html');
  });

  test('forgot password asks for an email and confirms without saying the account exists', async ({ appPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Trade Login' })).toBeVisible();
    await page.locator('#btnForgotPassword').click();
    await expect(page.getByRole('heading', { name: 'Forgot password?' })).toBeVisible();
    await expect(page.locator('#forgotEmail')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/trade-forgot-password.png` });

    await page.locator('#forgotEmail').fill('not-an-email');
    await page.locator('#btnSendReset').click();
    await expect(page.locator('#forgotError')).toHaveText('Enter the email on your account.');

    await page.locator('#forgotEmail').fill('crew@example.test');
    await page.locator('#btnSendReset').click();
    await expect(page.locator('#forgotSent')).toHaveText("If that email has an account, we've sent a reset link.");
    await expect(page.locator('#forgotError')).toBeHidden();
    await page.screenshot({ path: `${SHOTS}/trade-reset-sent.png` });

    const calls = await page.evaluate(() => window.__swResetCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].email).toBe('crew@example.test');
    expect(calls[0].redirectTo).toMatch(/\/trade\.html$/);
    expect(calls[0].redirectTo).not.toContain('#');
    expect(calls[0].redirectTo).not.toContain('?');

    await page.locator('#btnForgotBack').click();
    await expect(page.getByRole('heading', { name: 'Trade Login' })).toBeVisible();
    await expect(page.locator('#btnLogin')).toBeEnabled();
  });

  test('a recovery link sets a new password and opens the app', async ({ appPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // A hash-only change does not reload trade.html, so the recovery token has to arrive as a new document.
    await page.goto('/trade.html?e2e=recovery#access_token=e2e&type=recovery');
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    await expect(page.locator('#newPassword')).toBeVisible();
    await expect(page.locator('#bottomNav')).toBeHidden();
    await page.screenshot({ path: `${SHOTS}/trade-set-new-password.png` });

    await page.locator('#newPassword').fill('short');
    await page.locator('#confirmPassword').fill('short');
    await page.locator('#btnSetPassword').click();
    await expect(page.locator('#newPasswordError')).toHaveText('Use at least 8 characters.');

    await page.locator('#newPassword').fill('correct-horse');
    await page.locator('#confirmPassword').fill('other-horse');
    await page.locator('#btnSetPassword').click();
    await expect(page.locator('#newPasswordError')).toHaveText("Those passwords don't match.");

    await page.locator('#confirmPassword').fill('correct-horse');
    await page.locator('#btnSetPassword').click();
    await expect(page.locator('#bottomNav')).toBeVisible();
    await expect(page.locator('#viewLogin')).toBeHidden();
    await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
    await expect.poll(() => page.evaluate(() => window.__swPasswordUpdates)).toEqual(['correct-horse'.length]);
    expect(page.url()).not.toContain('type=recovery');
    expect(page.url()).not.toContain('access_token');
  });

  test('an expired reset link offers a new one', async ({ appPage: page }) => {
    await page.goto('/trade.html?e2e=expired#error=access_denied&error_code=otp_expired&error_description=expired');
    await expect(page.locator('#newPasswordLead')).toHaveText('This reset link has expired or is not valid.');
    await expect(page.locator('#newPassword')).toBeHidden();
    await page.locator('#btnRequestNewReset').click();
    await expect(page.getByRole('heading', { name: 'Forgot password?' })).toBeVisible();
  });

  test('profile can change the password while signed in', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="profile"]').click();
    await expect(page.locator('#profilePasswordCard')).toBeVisible();
    await page.locator('#profileNewPassword').fill('short');
    await page.locator('#profileConfirmPassword').fill('short');
    await page.locator('#btnProfilePassword').click();
    await expect(page.locator('#profilePasswordStatus')).toHaveText('Use at least 8 characters.');

    await page.locator('#profileNewPassword').fill('another-secret');
    await page.locator('#profileConfirmPassword').fill('another-secret');
    await page.locator('#btnProfilePassword').click();
    await expect(page.locator('#profilePasswordStatus')).toHaveText('Password updated. Use it next time you sign in.');
    await expect(page.locator('#viewLogin')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__swPasswordUpdates)).toEqual(['another-secret'.length]);
  });
});
