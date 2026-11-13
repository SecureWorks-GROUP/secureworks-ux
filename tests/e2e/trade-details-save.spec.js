// 2026-11-11: My Details (Profile) once answered "Saved locally" when
// `update_trade_profile` failed, so a trade walked away believing his ABN and
// pay details were on his account when the office had nothing. A failed save
// now says it did not save, keeps what he typed, and only a confirmed server
// save reads "Saved to your account". A missing ABN stays a warning: the
// server takes an invoice without one.
// Search `<trade-details-save>` in trade.html.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const NOT_SAVED = 'Not saved. Your details did not reach your account. Check your connection and tap Save Details again.';
const ABN_MISSING = 'No ABN yet. Your invoices go to the office without one, which can hold up your pay. Add it and save.';
// A test ABN and made-up contact details only. No bank details are typed.
const ABN = '36 332 272 781';

// `answer` decides what each update_trade_profile call gets; every body the
// app posts is kept in `posted`.
async function stubProfileSave(page, answer) {
  const posted = [];
  await page.route(`${OPS_API}**`, async (route) => {
    const req = route.request();
    if (new URL(req.url()).searchParams.get('action') !== 'update_trade_profile') return route.fallback();
    const body = req.postDataJSON();
    posted.push(body);
    return answer(route, body, posted.length);
  });
  return posted;
}

const saved = (route, body) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ success: true, profile: { abn: body.abn || null, trade_details: body, gst_registered: body.gstRegistered === true } })
});

async function openProfile(page) {
  await signIn(page, PERSONAS.installer);
  await page.evaluate(() => { try { localStorage.removeItem('sw_trade_details'); } catch (e) {} window.showView('profile'); });
  await expect(page.locator('#tdAbn')).toBeVisible();
}

test.describe('Trade app: My Details save tells the truth', () => {
  test.use({ persona: 'installer' });

  test('a save the server refuses says Not saved, keeps what was typed, and saves on the next try', async ({ appPage: page }) => {
    const posted = await stubProfileSave(page, (route, body, call) => (call === 1
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'profile write failed' }) })
      : saved(route, body)));
    await openProfile(page);
    await page.locator('#tdFullName').fill('Test Installer');
    await page.locator('#tdAbn').fill(ABN);
    await page.getByRole('button', { name: 'Save Details' }).click();

    const status = page.locator('#tdSaveStatus');
    await expect(status).toHaveText(NOT_SAVED);
    await expect(status).not.toContainText('Saved');
    await expect(page.locator('#toast')).toHaveText('Not saved. Try again.');
    await expect(page.locator('#toast')).toHaveClass(/error/);
    expect(posted).toHaveLength(1);

    // What he typed is still there, on the form and after leaving and coming back.
    await expect(page.locator('#tdAbn')).toHaveValue(ABN);
    await page.evaluate(() => { window.showView('today'); window.showView('profile'); });
    await expect(page.locator('#tdFullName')).toHaveValue('Test Installer');
    await expect(page.locator('#tdAbn')).toHaveValue(ABN);

    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect(page.locator('#tdSaveStatus')).toHaveText('Saved to your account');
    expect(posted).toHaveLength(2);
    expect(posted[1].abn).toBe(ABN);
  });

  test('a save that never reaches the server says Not saved', async ({ appPage: page }) => {
    await stubProfileSave(page, (route) => route.abort('internetdisconnected'));
    await openProfile(page);
    await page.locator('#tdAbn').fill(ABN);
    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect(page.locator('#tdSaveStatus')).toHaveText(NOT_SAVED);
    await expect(page.locator('#tdAbn')).toHaveValue(ABN);
  });

  test('an answer that does not confirm the save is not reported as saved', async ({ appPage: page }) => {
    await stubProfileSave(page, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queued: true }) }));
    await openProfile(page);
    await page.locator('#tdAbn').fill(ABN);
    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect(page.locator('#tdSaveStatus')).toHaveText(NOT_SAVED);
    await expect(page.locator('#toast')).not.toHaveText('Details saved');
  });

  test('a confirmed save with no ABN is saved, with a plain warning about pay', async ({ appPage: page }) => {
    const posted = await stubProfileSave(page, saved);
    await openProfile(page);
    await page.locator('#tdAbn').fill('');
    await page.locator('#tdFullName').fill('Test Installer');
    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect(page.locator('#tdSaveStatus')).toHaveText('Saved to your account. ' + ABN_MISSING);
    expect(posted).toHaveLength(1);
    expect(posted[0].abn).toBe('');

    await page.locator('#tdAbn').fill(ABN);
    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect(page.locator('#tdSaveStatus')).toHaveText('Saved to your account');
  });

  test('the weekly invoice warns about a missing ABN in the same words, and stops once one is saved', async ({ appPage: page }) => {
    await stubProfileSave(page, saved);
    await openProfile(page);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const warning = page.locator('[data-invoice-abn-warning]');
    await expect(warning).toContainText('No ABN entered. This invoice goes to the office without one, which can hold up your pay.');
    await expect(warning.getByRole('link', { name: 'Add it in Profile' })).toBeVisible();
    // Still a warning: the invoice builder is open and usable below it.
    await expect(page.getByRole('button', { name: '+ Add amount' })).toBeVisible();

    await warning.getByRole('link', { name: 'Add it in Profile' }).click();
    await page.locator('#tdAbn').fill(ABN);
    await page.getByRole('button', { name: 'Save Details' }).click();
    await expect(page.locator('#tdSaveStatus')).toHaveText('Saved to your account');
    // Back on the invoice he left open: the ABN is on it and the warning is gone.
    await page.locator('[data-view="hours"]').click();
    await expect(page.getByRole('button', { name: '+ Add amount' })).toBeVisible();
    await expect(page.locator('#hoursContent')).toContainText(ABN);
    await expect(page.locator('[data-invoice-abn-warning]')).toHaveCount(0);
  });
});
