const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Log In pressed before the app has finished loading (`// <trade-login-cloud-ready>`).
// trade.html picks up the cloud client in initApp, which first runs on a 100ms
// timer and retries every 200ms. Pressing Log In inside that window used to throw
// on a null client and leave the button stuck on "Logging in...".
//
// Each test holds the page in that window on purpose: an init script parks the
// timed initApp call (and, where named, hides the cloud client), so the press
// lands before load deterministically instead of by racing a timer. Everything
// is stubbed by the shared fixture; nothing reaches the live system.

const HOLD_INIT = `(() => {
  window.__heldInit = [];
  const realSetTimeout = window.setTimeout;
  window.setTimeout = function(fn, ms) {
    if (typeof fn === 'function' && fn.name === 'initApp' && !window.__releaseInit) {
      window.__heldInit.push(fn);
      return 0;
    }
    return realSetTimeout.apply(this, arguments);
  };
  window.__runHeldInit = () => {
    window.__releaseInit = true;
    const held = window.__heldInit.splice(0);
    held.forEach((fn) => fn());
  };
})();`;

// Keeps window.SECUREWORKS_CLOUD empty after shared/cloud.js sets it, until released.
const HIDE_CLOUD = `(() => {
  let held;
  Object.defineProperty(window, 'SECUREWORKS_CLOUD', {
    configurable: true,
    get() { return window.__releaseCloud ? held : undefined; },
    set(value) { held = value; }
  });
})();`;

function watchPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err && err.message || err)));
  return errors;
}

test.describe('Trade login before the app has loaded', () => {
  test('Log In before the cloud client exists shows a plain message and keeps the form', async ({ appPage: page }) => {
    const errors = watchPageErrors(page);
    await page.addInitScript(HOLD_INIT);
    await page.addInitScript(HIDE_CLOUD);
    await page.goto('/trade.html');
    await expect(page.getByRole('heading', { name: 'Trade Login' })).toBeVisible();
    expect(await page.evaluate(() => window.__heldInit.length)).toBeGreaterThan(0);

    const { email, password } = PERSONAS.installer;
    await page.locator('#loginEmail').fill(email);
    await page.locator('#loginPassword').fill(password);
    await page.locator('#btnLogin').click();

    await expect(page.locator('#loginError')).toHaveText('Still loading. Wait a moment and try again.');
    await expect(page.locator('#btnLogin')).toBeEnabled();
    await expect(page.locator('#btnLogin')).toHaveText('Log In');
    await expect(page.locator('#loginEmail')).toHaveValue(email);
    await expect(page.locator('#loginPassword')).toHaveValue(password);
    await expect(page.locator('#viewLogin')).toHaveClass(/active/);
    expect(errors).toEqual([]);

    // Once the client arrives and the app finishes loading, the same press signs in.
    await page.evaluate(() => { window.__releaseCloud = true; window.__runHeldInit(); });
    await page.locator('#btnLogin').click();
    await page.locator('#bottomNav').waitFor({ state: 'visible' });
    await expect(page.locator('#viewLogin')).toBeHidden();
    await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
    expect(errors).toEqual([]);
  });

  test('Log In after the client loads but before the app picks it up signs in once', async ({ appPage: page }) => {
    const errors = watchPageErrors(page);
    await page.addInitScript(HOLD_INIT);
    await page.addInitScript(`(() => {
      // Count how many times the app subscribes to the login event.
      window.__tradeLoginListeners = 0;
      document.addEventListener('DOMContentLoaded', () => {
        const c = window.SECUREWORKS_CLOUD;
        if (!c || typeof c.on !== 'function') return;
        const realOn = c.on;
        c.on = function(name) {
          if (name === 'auth:login') window.__tradeLoginListeners++;
          return realOn.apply(this, arguments);
        };
      });
    })();`);
    await page.goto('/trade.html');
    await expect(page.getByRole('heading', { name: 'Trade Login' })).toBeVisible();
    expect(await page.evaluate(() => Boolean(window.SECUREWORKS_CLOUD))).toBe(true);
    expect(await page.evaluate(() => window.__heldInit.length)).toBeGreaterThan(0);

    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
    await expect(page.locator('#loginError')).toBeHidden();

    // The parked timed call now runs late; it must not set the app up a second time.
    await page.evaluate(() => window.__runHeldInit());
    await page.waitForTimeout(300);
    await expect(page.locator('#bottomNav')).toBeVisible();
    await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
    expect(await page.evaluate(() => window.__tradeLoginListeners)).toBe(1);
    expect(errors).toEqual([]);
  });

  test('Log In after a normal load still signs in', async ({ appPage: page }) => {
    const errors = watchPageErrors(page);
    await expect(page.getByRole('heading', { name: 'Trade Login' })).toBeVisible();
    await page.waitForTimeout(400);
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#headerUser')).toHaveText('E2E Installer');
    await expect(page.locator('#loginError')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
