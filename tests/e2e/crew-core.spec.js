// SecureWorks Crew: the on-site daily loop, end to end on the demo server.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, slide, PHONE } = require('../helpers/crew');

test.use(PHONE);

test('today shows the next job and clocks on and off with saved times', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/today'));
  await expect(page.getByRole('heading', { name: 'Friday' })).toBeVisible();
  await expect(page.locator('.nowcard')).toContainText('Joondalup');

  await slide(page);
  await expect(page.locator('.clockbar')).toContainText('On the clock');
  await expect(page.locator('.nowcard .bigtimer')).toBeVisible();

  await page.locator('.clockbar .off').click();
  const sheet = page.getByRole('dialog', { name: 'Clock off' });
  await expect(sheet).toBeVisible();
  await sheet.locator('input[type="time"]').first().fill('07:00');
  await sheet.locator('input[type="time"]').nth(1).fill('15:30');
  await sheet.getByRole('button', { name: '30 min' }).click();
  await expect(sheet.locator('.hoursout')).toContainText('8 h');
  await sheet.getByRole('button', { name: /Clock off, save 8 h/ }).click();
  await expect(page.locator('.clockbar')).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: '8 h saved' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('any job can be found and opened, and a trade can add themselves', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await page.getByLabel('Search every job').fill('kinross');
  await page.getByRole('button', { name: /Kinross/ }).click();
  await expect(page.getByRole('heading', { name: 'Kinross' })).toBeVisible();
  // Looking only: no customer number, and the scope is readable.
  await expect(page.getByText('Add yourself to clock on')).toBeVisible();
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByText('Gable patio 6.0 x 3.6 m')).toBeVisible();

  await page.getByRole('button', { name: 'I am on this job' }).click();
  const sheet = page.getByRole('dialog', { name: 'Which days?' });
  await sheet.getByRole('button', { name: 'Add me' }).click();
  await expect(page.getByText('You are on it').first()).toBeVisible();
  await expect(page.locator('.slide')).toBeVisible();
  await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('job page: scope, a note, and a problem report', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/job/j-joon'));
  await expect(page.getByRole('heading', { name: 'Joondalup' })).toBeVisible();
  await expect(page.getByText('Hand dig the first three posts')).toBeVisible();
  await expect(page.getByText('Strip old fence, rear and left')).toBeVisible();

  await page.getByRole('tab', { name: /Notes/ }).click();
  await page.getByPlaceholder('Write a note for the office and crew').fill('Gate code is 4410');
  await page.getByRole('button', { name: 'Send note' }).click();
  await expect(page.locator('.note').first()).toContainText('Gate code is 4410');

  await page.getByRole('button', { name: 'Problem' }).click();
  const sheet = page.getByRole('dialog', { name: 'Tell the office' });
  await sheet.getByRole('button', { name: 'Materials missing' }).click();
  await sheet.getByRole('button', { name: 'Send to the office' }).click();
  await expect(page.locator('.toast', { hasText: 'Sent to the office' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('no price reaches a trade on the job page', async ({ page }) => {
  await page.goto(crewUrl('#/job/j-joon'));
  await expect(page.getByRole('heading', { name: 'Joondalup' })).toBeVisible();
  for (const tab of ['Scope', 'Files', 'Crew']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await expect(page.locator('main.page')).not.toContainText('$');
  }
});
