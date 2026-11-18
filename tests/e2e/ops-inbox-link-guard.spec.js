const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const question = 'This invoice is on SWF-990001. Move it to SWP-990002?';
const replace = [409, { error: 'link_would_replace', message: question }];

async function openInbox(page, answers, shared = false) {
  const posts = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname !== '/fixture-api') return route.continue();
    if (route.request().method() === 'GET') return route.fulfill({ json: { items: [] } });
    expect(url.searchParams.get('action')).toBe('resolve_annotation');
    posts.push(route.request().postDataJSON());
    const [status, json] = answers.shift();
    await route.fulfill({ status, json });
  });
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  if (shared) await page.addScriptTag({ url: '/modules/ops-shared.js' });
  await page.evaluate(() => {
    _opsApiBase = '/fixture-api';
    window.opsAuthHeaders = window._getAuthHeaders = async () => ({ 'Content-Type': 'application/json' });
    window.refreshInboxBadge = () => {};
    const ann = { id: 'fixture', title: 'Invoice link', category: 'finance',
      response_options: [{ label: 'Link', value: 'link', style: 'primary' }] };
    document.querySelectorAll('.view.active').forEach(el => el.classList.remove('active'));
    document.querySelector('#viewInbox').classList.add('active');
    _annotationCache.global = { data: [ann] };
    renderInboxList([ann]);
  });
  return posts;
}

for (const shared of [false, true]) {
  test('asks before replacing and retries only by choice (' + (shared ? 'shared' : 'inline') + ')', async ({ page }, info) => {
    const posts = await openInbox(page, [replace, replace, [200, { success: true }]], shared);
    const link = page.getByRole('button', { name: 'Link', exact: true });
    await link.click();
    const dialog = page.getByRole('dialog', { name: 'Move invoice?' });
    await expect(dialog.locator('p')).toHaveText(question);
    expect(posts).toHaveLength(1);
    expect(posts[0]).not.toHaveProperty('confirm_replace');
    if (!shared && info.project.name === 'webkit-desktop') {
      const path = info.outputPath('invoice-move-desktop.png');
      await page.screenshot({ path });
      await info.attach('invoice-move-desktop', { path, contentType: 'image/png' });
    }
    await dialog.getByText('Leave it').click();
    await expect(dialog).toHaveCount(0);
    expect(posts).toHaveLength(1);
    await link.click();
    await dialog.getByText('Move it', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => _annotationCache.global.data.length)).toBe(0);
    expect(posts).toEqual([posts[0], posts[0], { ...posts[0], confirm_replace: true }]);
  });
}

test('routes a bill to Reconcile without retrying', async ({ page }) => {
  const posts = await openInbox(page, [[409, { error: 'use_reconcile' }]]);
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Bills are placed in Reconcile.');
  await page.getByRole('button', { name: 'Open Reconcile' }).click();
  await expect(page.locator('#viewRecon')).toBeVisible();
  expect(posts).toHaveLength(1);
});

test('keeps the annotation on refusal, failed read, or an unconfirmed answer', async ({ page }) => {
  const refused = 'The invoice could not be read.';
  const posts = await openInbox(page, [
    replace, [409, { error: 'job_not_live' }], [500, { error: 'read_failed', message: refused }], [200, {}]
  ]);
  const messages = [];
  page.on('dialog', async dlg => { messages.push(dlg.message()); await dlg.accept(); });
  const link = page.getByRole('button', { name: 'Link', exact: true });
  await link.click();
  await page.getByRole('button', { name: 'Move it', exact: true }).click();
  await expect.poll(() => messages.slice()).toEqual(['That job is not live.']);
  await link.click();
  await expect.poll(() => messages.length).toBe(2);
  await link.click();
  await expect.poll(() => messages.slice()).toEqual(['That job is not live.', refused, 'Invoice link was not confirmed.']);
  expect(posts.map(p => p.confirm_replace)).toEqual([undefined, true, undefined, undefined]);
  expect(await page.evaluate(() => _annotationCache.global.data.length)).toBe(1);
});
