// Crew fixes (20 Nov 2026):
//  - a group work order day can be any past day, not only this week or last;
//  - a send refused because the trade is not on a job offers "Add yourself"
//    for a line that holds only a job number, using the job id the refusal names.
// ZZTEST wording only. Runs on the in-browser demo server.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');
const { setupReceiptWeek } = require('../helpers/crew-receipts');

test.use(PHONE);

test('a group day can be any past day, picked from the date box', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(() => {
    const { ops } = window.__crewDemo;
    window.__dayBodies = [];
    const real = ops.submit_group_work_order_hours;
    ops.submit_group_work_order_hours = (p, b) => { window.__dayBodies.push(JSON.parse(JSON.stringify(b))); return real(p, b); };
    location.hash = '#/pay/group/j-dunc';
  });
  await page.getByRole('button', { name: 'Add a day you worked' }).click();
  const day = page.getByRole('dialog', { name: 'Add a day you worked' });
  await expect(day.getByText('This week', { exact: true })).toBeVisible();
  // Quick picks stay: this week and last week.
  await day.getByRole('button', { name: 'It was last week' }).click();
  await expect(day.getByText('Last week', { exact: true })).toBeVisible();
  await day.getByRole('button', { name: 'Back to this week' }).click();

  const box = day.locator('[data-group-day-date]');
  await expect(box).toHaveAttribute('max', '2026-11-13');
  // A day after today is not taken.
  await box.fill('2026-11-20');
  await day.locator('input[type="time"]').first().fill('07:00');
  await day.locator('input[type="time"]').nth(1).fill('15:30');
  await day.getByRole('button', { name: '30 min', exact: true }).click();
  await expect(day.getByRole('button', { name: 'Save the day' })).toBeDisabled();

  await box.fill('2026-10-21');
  await expect(day.getByText('Week of Mon 19 Oct', { exact: true })).toBeVisible();
  await expect(day.locator('.daypick[aria-pressed="true"]')).toHaveCount(1);
  await day.getByRole('button', { name: /^Save Wed 21 Oct/ }).click();
  await expect.poll(() => page.evaluate(() => window.__dayBodies.length)).toBe(1);
  const body = (await page.evaluate(() => window.__dayBodies))[0];
  expect(body.work_date).toBe('2026-10-21');
  expect(body.start_time).toBe('07:00');
  expect(body.finish_time).toBe('15:30');
  expect(body.break_minutes).toBe(30);
  expect(errors).toEqual([]);
});

test('a refused line with only a job number is booked from the job id in the refusal', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await setupReceiptWeek(page, { enabled: false, review: false });
  const jobNumber = await page.evaluate(() => {
    const { db, ops } = window.__crewDemo;
    const mine = new Set(db.assignments.filter((a) => a.user_id === db.me.id).map((a) => a.job_id));
    const job = db.jobs.find((j) => !mine.has(j.id) && j.type !== 'makesafe' && j.job_number);
    job.job_number = 'ZZTEST-404';
    window.__selfBooked = [];
    const book = ops.self_allocate_for_invoice;
    ops.self_allocate_for_invoice = (p, b) => { window.__selfBooked.push(JSON.parse(JSON.stringify(b))); return book(p, b); };
    window.__typedJobId = job.id;
    // The week's draft as the old app saves it, with a line typed with a job number and no job id.
    ops.save_running_invoice_draft({}, { week_start: '2026-11-09', draft_builder: { version: 1, weekStart: '2026-11-09', weekEnd: '2026-11-15', jobCards: [], invLumpLines: [], dismissedKeys: [], notes: '', gst_on: false,
      invRows: [{ date: '2026-11-10', job_id: null, job_text: 'ZZTEST-404', description: 'ZZTEST drive', division: '', hours: 0, rate: 0, amount: 40,
        start_time: '', finish_time: '', break_minutes: 0, client_name: '', _source: 'crew_app', crew_line: { key: 'add:zztest-typed', type: 'Travel', title: 'ZZTEST-404', suburb: '', vertical: 'other' } }] } });
    Object.keys(localStorage).filter((k) => k.startsWith('crew:week:')).forEach((k) => localStorage.removeItem(k));
    location.hash = '#/jobs';
    return job.job_number;
  });
  await page.evaluate(() => { location.hash = '#/pay/week/2026-11-09/invoice'; });
  await expect(page.getByText('ZZTEST drive')).toBeVisible();
  await page.getByRole('button', { name: 'Send invoice', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Send/ }).click();
  const ask = page.getByRole('dialog', { name: `Add yourself to ${jobNumber}?` });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Add me and send' }).click();
  await expect.poll(() => page.evaluate(() => window.__selfBooked.length)).toBe(1);
  const booked = (await page.evaluate(() => window.__selfBooked))[0];
  expect(booked).toEqual({ job_id: await page.evaluate(() => window.__typedJobId), work_date: '2026-11-10' });
  expect(errors).toEqual([]);
});
