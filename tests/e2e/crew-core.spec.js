// SecureWorks Crew: the daily loop on the demo server. Today, Schedule and Jobs.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

test('today shows the next job and clocks on and off with saved times', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/today'));
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  const card = page.locator('.nowjob');
  await expect(card).toContainText('42 Lakeside Drive, Joondalup');
  await expect(card.locator('.jobtag')).toHaveText('SWF-26767');
  // Today is only "now": the calendar lives in Schedule.
  await expect(page.locator('.week')).toHaveCount(0);

  await card.getByRole('button', { name: 'Clock on' }).click();
  await expect(card).toContainText('Time on site');
  await expect(card.locator('.badge')).toContainText('On site');

  await card.getByRole('button', { name: 'Clock off' }).click();
  const sheet = page.getByRole('dialog', { name: 'Clock off' });
  await expect(sheet).toBeVisible();
  await sheet.locator('input[type="time"]').first().fill('07:00');
  await sheet.locator('input[type="time"]').nth(1).fill('15:30');
  await sheet.locator('select').selectOption('30');
  await expect(sheet).toContainText('8.0 h');
  await sheet.getByRole('button', { name: 'Save to timesheet' }).click();
  await expect(page.getByText('Done for today')).toBeVisible();
  expect(errors).toEqual([]);
});

test('schedule: the week, the month, and confirming a booking', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/schedule'));
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByText('9 to 15 Nov 2026')).toBeVisible();
  // Every day of the week is a row, booked or not.
  for (const dow of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) await expect(page.locator('.daycell', { hasText: dow }).first()).toBeVisible();
  await expect(page.locator('.item.today')).toContainText('Joondalup');
  // A trade sees only their own bookings: no Everyone switch.
  await expect(page.getByRole('button', { name: 'Everyone' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.getByText('November 2026')).toBeVisible();
  await expect(page.getByText('Free weekdays')).toBeVisible();

  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: 'Later week' }).click();
  const row = page.locator('.item', { hasText: 'Hillarys' }).first();
  await expect(row.locator('.badge')).toHaveText('To confirm');
  await row.click();
  await expect(page.getByRole('heading', { name: 'Booking' })).toBeVisible();
  await expect(page.getByText('Allocated')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('.badge', { hasText: 'Confirmed' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('any job can be found and opened, and a trade can add themselves', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await page.getByLabel('Search every job').fill('kinross');
  await page.locator('.item', { hasText: 'Kinross' }).first().click();
  // Looking only: no customer number, and the scope is readable.
  await expect(page.getByText('Add yourself to clock on')).toBeVisible();
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Scope' }).click();
  await expect(page.getByText('Gable patio 6.0 x 3.6 m')).toBeVisible();

  await page.getByRole('button', { name: 'Add me to this job' }).click();
  const sheet = page.getByRole('dialog', { name: 'Which days?' });
  await sheet.getByRole('button', { name: 'Add me' }).click();
  await expect(page.locator('.foot').getByRole('button', { name: 'Clock on' })).toBeVisible();
  await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('job record: overview, scope, a note, and a problem report', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/job/j-joon'));
  await expect(page.getByRole('heading', { name: 'SWF-26767' })).toBeVisible();
  await expect(page.getByText('42 Lakeside Drive, Joondalup')).toBeVisible();
  await expect(page.getByText('Your work on this job')).toBeVisible();
  // Pay type comes from the server's answer for the job, never from the app.
  await expect(page.locator('.kvrow', { hasText: 'Pay type' })).toBeVisible();

  await page.getByRole('tab', { name: 'Scope' }).click();
  await expect(page.getByText('Hand dig the first three posts')).toBeVisible();
  await expect(page.getByText('Strip old fence, rear and left')).toBeVisible();

  await page.getByRole('tab', { name: /Notes/ }).click();
  await page.getByPlaceholder('Write a note for the office and crew').fill('Gate code is 4410');
  await page.getByRole('button', { name: 'Send note' }).click();
  await expect(page.getByText('Gate code is 4410')).toBeVisible();

  await page.getByRole('button', { name: 'Problem' }).click();
  const sheet = page.getByRole('dialog', { name: 'Tell the office' });
  await sheet.getByRole('button', { name: 'Materials missing' }).click();
  await sheet.getByRole('button', { name: 'Send to the office' }).click();
  await expect(page.locator('.toast', { hasText: 'Sent to the office' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('no price reaches a trade on the job page', async ({ page }) => {
  await page.goto(crewUrl('#/job/j-joon'));
  await expect(page.getByRole('heading', { name: 'SWF-26767' })).toBeVisible();
  for (const tab of ['Overview', 'Scope', 'Files']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await expect(page.locator('main.page')).not.toContainText('$');
  }
});

test('a manager sees who is where and the board; a trade does not', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/schedule', 'lead'));
  await page.getByRole('button', { name: 'Everyone' }).click();
  await expect(page.getByText('To schedule')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allocate' }).first()).toBeVisible();
  await page.goto(crewUrl('#/jobs/board', 'lead'));
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toBeVisible();
  // A plain trade who lands on the managers' view gets their own week.
  await page.goto(crewUrl('#/schedule/everyone', 'crew'));
  await page.reload();
  await expect(page.getByText('9 to 15 Nov 2026')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Everyone' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
