// The Dispatch v1 / v2 switch (<dispatch-version> in ops.html): v2 is the
// default; ?dispatch_version=v1 in the address loads the kept v1 screen
// (modules/ops-dispatch-v1.*) instead, remembered in this browser, and the
// v1 screen's Switch to v2 comes back. Since 18 Nov 2026 (item 19) v2 has no
// Switch back to v1: Read now sits in that corner. Only one of the two is ever loaded. Against a stubbed ops-api.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { V2_ANSWER, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

async function boot(page, { query = '', stored = null } = {}) {
  const pipelineReads = [];
  await installOpsSessionStub(page);
  if (stored) await page.addInitScript((v) => { try { localStorage.setItem('sw_dispatch_version', v); } catch (e) { /* none */ } }, stored);
  await page.route('**/*', async (route) => {
    const raw = route.request().url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    const action = /\/functions\/v1\/ops-api$/.test(url.pathname) ? url.searchParams.get('action') : null;
    if (action === 'pipeline') {
      pipelineReads.push(Object.fromEntries(url.searchParams));
      const v2 = url.searchParams.get('board') === 'v2';
      const reply = v2 ? V2_ANSWER({ columns: {} }, url.searchParams.get('view') || 'active') : { columns: {}, total: 0, dispatch_stages: 'ok', todo_total: 0 };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
    }
    const empty = action && V2_EMPTY_READS[action] ? V2_EMPTY_READS[action](url) : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(empty) });
  });
  await page.goto(OPS_FILE + query + '#dispatch');
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const scripts = () => page.evaluate(() => Array.from(document.scripts).map((s) => s.getAttribute('src') || '').filter((s) => /ops-dispatch/.test(s)).map((s) => s.split('?')[0]));
  const styles = () => page.evaluate(() => Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.getAttribute('href') || '').filter((s) => /ops-dispatch/.test(s)).map((s) => s.split('?')[0]));
  return { pipelineReads, scripts, styles, root: page.locator('#dispatchRoot'), bar: page.locator('#dispatchVersionBar') };
}

test('v2 is the default: only the v2 files load, the list reads the v2 board, and the corner has Read now, not Switch back to v1', async ({ page }) => {
  const { pipelineReads, scripts, styles, root, bar } = await boot(page);
  expect(await scripts()).toEqual(['modules/ops-dispatch.js']);
  expect(await styles()).toEqual(['modules/ops-dispatch.css']);
  await expect(root.locator('[data-dpc-mode="active"]')).toBeVisible();
  expect(pipelineReads.every((r) => r.board === 'v2')).toBe(true);
  await expect(bar.locator('[data-dispatch-read-now]')).toHaveText('Read now');
  await expect(bar.locator('[data-dispatch-switch]')).toHaveCount(0);
  await expect(bar).not.toContainText('Switch back to v1');
});

// (Switch to v2 coming back, and v2 then having no switch, is the
// ?dispatch_version=v1 test below: this stub re-saves v1 on every load.)
test('a browser kept on v1 loads the v1 screen, with Switch to v2 and no Read now', async ({ page }) => {
  const { scripts, styles, root, bar } = await boot(page, { stored: 'v1' });
  await expect(bar.locator('[data-dispatch-version]')).toHaveText('Dispatch v1 (the old screen)');
  expect(await scripts()).toEqual(['modules/ops-dispatch-v1.js']);
  expect(await styles()).toEqual(['modules/ops-dispatch-v1.css']);
  await expect(root.locator('[data-dpc-mode="todo"]')).toBeVisible();
  await expect(bar.locator('[data-dispatch-read-now]')).toHaveCount(0);
  await expect(bar.locator('[data-dispatch-switch]')).toHaveText('Switch to v2');
});

test('v1 reads the old list (no board=v2) and the job page card comes from v1', async ({ page }) => {
  const { pipelineReads, root } = await boot(page, { stored: 'v1' });
  await expect(root.locator('[data-dpc-mode="all"]')).toBeVisible();
  expect(pipelineReads.length).toBeGreaterThan(0);
  expect(pipelineReads.some((r) => r.board === 'v2')).toBe(false);
  expect(await page.evaluate(() => typeof window.OpsDispatch.stageForJob)).toBe('function');
});

test('?dispatch_version=v1 picks v1 and is remembered; switching away drops it from the address', async ({ page }) => {
  const { scripts, bar } = await boot(page, { query: '?dispatch_version=v1' });
  expect(await scripts()).toEqual(['modules/ops-dispatch-v1.js']);
  expect(await page.evaluate(() => localStorage.getItem('sw_dispatch_version'))).toBe('v1');
  await bar.locator('[data-dispatch-switch]').click();
  await expect(bar.locator('[data-dispatch-read-now]')).toHaveText('Read now');
  await expect(bar.locator('[data-dispatch-switch]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sw_dispatch_version'))).toBe('v2');
  expect(page.url()).not.toContain('dispatch_version');
  expect(await scripts()).toEqual(['modules/ops-dispatch.js']);
});
