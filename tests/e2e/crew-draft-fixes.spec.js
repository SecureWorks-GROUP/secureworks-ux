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
  // Opened straight on the group work order: a hash moved right after start-up
  // was sometimes missed, leaving the Jobs screen up.
  await page.goto(crewUrl('#/pay/group/j-dunc'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(() => {
    const { ops } = window.__crewDemo;
    window.__dayBodies = [];
    const real = ops.submit_group_work_order_hours;
    ops.submit_group_work_order_hours = (p, b) => { window.__dayBodies.push(JSON.parse(JSON.stringify(b))); return real(p, b); };
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
  await expect(box).toHaveAttribute('min', '2025-11-13');
  // A day after today is not taken.
  await box.fill('2026-11-20');
  await day.locator('input[type="time"]').first().fill('07:00');
  await day.locator('input[type="time"]').nth(1).fill('15:30');
  await day.getByRole('button', { name: '30 min', exact: true }).click();
  await expect(day.getByRole('button', { name: 'Save the day' })).toBeDisabled();
  // A day more than a year back is said in words, not just refused.
  await box.fill('2025-06-01');
  await expect(day.getByText('That day is more than a year ago, so it cannot be added here. Ask the office to add it.')).toBeVisible();
  await expect(day.getByRole('button', { name: 'Save the day' })).toBeDisabled();

  await box.fill('2026-10-21');
  await expect(day.getByText('That day is more than a year ago', { exact: false })).toHaveCount(0);
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

// The week's draft replaced in another place (the Trade App, the office agent).
async function replacedWeek(page, { always = false } = {}) {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay/week/2026-11-09'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate((always) => {
    const { db, ops } = window.__crewDemo;
    window.__saves = []; window.__reads = 0;
    const save = ops.save_running_invoice_draft;
    ops.save_running_invoice_draft = (p, b) => {
      window.__saves.push({ draft_id: b.draft_id || null, builder: JSON.parse(JSON.stringify(b.draft_builder)) });
      if (always && b.draft_id && db.running[b.week_start]) db.running[b.week_start].id = 'zz-other-' + window.__saves.length;
      return save(p, b);
    };
    const read = ops.get_running_invoice_draft;
    ops.get_running_invoice_draft = (p) => { window.__reads++; return read(p); };
  }, always);
  const times = async (re, a, b, brk) => {
    await page.getByRole('main').getByRole('button', { name: re }).click();
    const d = page.getByRole('dialog');
    await d.locator('input[type="time"]').nth(0).fill(a); await d.locator('input[type="time"]').nth(1).fill(b);
    await d.getByRole('button', { name: brk, exact: true }).click();
    await d.getByRole('button', { name: 'Save' }).click(); await d.waitFor({ state: 'hidden' });
  };
  await times(/^Tue 10 Wembley/, '07:00', '14:00', 'No break');
  await expect(page.getByText('Draft saved to your account. Not sent.')).toBeVisible({ timeout: 8000 });
  // Another place replaces the week's draft, with a note of its own and new times
  // on a booked day this phone has not edited.
  const { oldId, otherNumber } = await page.evaluate(() => {
    const d = window.__crewDemo.db.running['2026-11-09'];
    const old = d.id; d.id = 'zz-other-draft';
    const cards = JSON.parse(JSON.stringify(d.builder.jobCards));
    const other = cards.find((c) => c.assignment_id && c.job_number !== 'SWD-26088' && c.job_number !== 'SWF-26767');
    if (other) Object.assign(other, { work_date: other.scheduled_date, start_time: '06:15', finish_time: '11:45', break_minutes: 0, hours: 5.5, mode_picked: true });
    d.builder = { ...d.builder, jobCards: cards, notes: 'ZZTEST from the other place' };
    return { oldId: old, otherNumber: other ? other.job_number + '|' + other.assignment_id : null };
  });
  expect(otherNumber).toBeTruthy();
  return { errors, times, oldId, otherAssignment: otherNumber.split('|')[1] };
}

test('a draft replaced elsewhere is read again, keeps what was typed here, and saves once under the new id', async ({ page }) => {
  const { errors, times, oldId, otherAssignment } = await replacedWeek(page);
  const before = await page.evaluate(() => window.__saves.length);
  await times(/^Fri 13 Joondalup/, '07:00', '15:30', '30 min');
  await expect.poll(() => page.evaluate(() => window.__saves.length), { timeout: 12000 }).toBe(before + 2);
  await expect(page.getByText('Draft saved to your account. Not sent.')).toBeVisible({ timeout: 8000 });
  const saves = (await page.evaluate(() => window.__saves)).slice(before);
  expect(saves[0].draft_id).toBe(oldId);
  expect(saves[1].draft_id).toBe('zz-other-draft');
  // Every save names a draft: none goes out blind while the week is read again.
  expect(saves.every((s) => s.draft_id)).toBe(true);
  const cards = saves[1].builder.jobCards;
  const card = (n) => cards.find((c) => c.job_number === n) || {};
  expect(card('SWF-26767').start_time).toBe('07:00');
  expect(card('SWF-26767').finish_time).toBe('15:30');
  expect(card('SWD-26088').finish_time).toBe('14:00');
  expect(saves[1].builder.notes).toBe('ZZTEST from the other place');
  // Times the other place put on a day this phone never touched are kept.
  const other = cards.find((c) => c.assignment_id === otherAssignment) || {};
  expect(other.start_time).toBe('06:15');
  expect(other.finish_time).toBe('11:45');
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => window.__saves.length)).toBe(before + 2);
  expect(errors).toEqual([]);
});

test('a draft replaced again right after the re-read is shown and not retried', async ({ page }) => {
  const { errors, times } = await replacedWeek(page, { always: true });
  const before = await page.evaluate(() => window.__saves.length);
  await times(/^Fri 13 Joondalup/, '07:00', '15:30', '30 min');
  await expect(page.getByText('This week changed in another place again, so it was not saved.', { exact: false }).first()).toBeVisible({ timeout: 12000 });
  const n = await page.evaluate(() => window.__saves.length);
  expect(n).toBe(before + 2);
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => window.__saves.length)).toBe(n);
  expect(errors).toEqual([]);
});

// A save naming no draft is answered with restored_agent_keys: agent lines the
// server put back because this phone's copy did not have them.
test('agent lines put back on a save are read again and kept by the next save', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/pay/week/2026-11-09'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(() => {
    const { db, ops } = window.__crewDemo;
    window.__saves = []; window.__reads = 0; window.__log = [];
    const mine = new Set(db.assignments.filter((a) => a.user_id === db.me.id).map((a) => a.job_id));
    const job = db.jobs.find((j) => !mine.has(j.id) && j.type === 'fencing' && j.job_number) || db.jobs.find((j) => !mine.has(j.id) && j.job_number);
    window.__agentJob = job.id;
    const save = ops.save_running_invoice_draft;
    ops.save_running_invoice_draft = (p, b) => {
      window.__saves.push({ draft_id: b.draft_id || null, builder: JSON.parse(JSON.stringify(b.draft_builder)) });
      window.__log.push('save');
      const res = save(p, b);
      if (b.draft_id) return res;
      // The server keeps the agent's lines this phone did not send: times on a booked
      // day the phone left empty, and a job the office added.
      const d = db.running[b.week_start];
      const keys = [];
      const fri = d.builder.jobCards.find((c) => c.job_number === 'SWF-26767');
      Object.assign(fri, { work_date: fri.scheduled_date, start_time: '06:30', finish_time: '12:00', break_minutes: 0, hours: 5.5, mode_picked: true, added_by_agent: true, description: 'ZZTEST agent times' });
      keys.push(fri.source_key);
      d.builder.jobCards.push({ assignment_id: null, job_id: job.id, job_number: job.job_number, client_name: job.client_name || '', site_suburb: 'ZZTEST Agentville', job_type: job.type || '',
        scheduled_date: '2026-11-11', work_date: '2026-11-11', start_time: '08:00', finish_time: '10:00', break_minutes: 0, hours: 2, included: true, added_by_agent: true, description: 'ZZTEST agent line' });
      keys.push('job:' + job.id + ':2026-11-11');
      return { ...res, draft_builder: d.builder, restored_agent_keys: keys };
    };
    const read = ops.get_running_invoice_draft;
    ops.get_running_invoice_draft = (p) => { window.__reads++; window.__log.push('read'); return read(p); };
  });
  const times = async (re, a, b, brk) => {
    await page.getByRole('main').getByRole('button', { name: re }).click();
    const d = page.getByRole('dialog');
    await d.locator('input[type="time"]').nth(0).fill(a); await d.locator('input[type="time"]').nth(1).fill(b);
    await d.getByRole('button', { name: brk, exact: true }).click();
    await d.getByRole('button', { name: 'Save' }).click(); await d.waitFor({ state: 'hidden' });
  };
  await expect.poll(() => page.evaluate(() => window.__reads)).toBe(1);
  await times(/^Tue 10 Wembley/, '07:00', '14:00', 'No break');
  // The save that got lines back is followed by a read, and nothing else goes out first.
  await expect.poll(() => page.evaluate(() => window.__log.join(',')), { timeout: 8000 }).toBe('read,save,read');
  await expect(page.getByText('ZZTEST Agentville')).toBeVisible();
  await expect(page.getByText('Draft saved to your account. Not sent.')).toBeVisible();

  await times(/^Tue 10 Wembley/, '07:00', '15:00', 'No break');
  await expect.poll(() => page.evaluate(() => window.__saves.length), { timeout: 8000 }).toBe(2);
  const second = (await page.evaluate(() => window.__saves))[1];
  expect(second.draft_id).toBeTruthy();
  const cards = second.builder.jobCards;
  const fri = cards.find((c) => c.job_number === 'SWF-26767') || {};
  expect(fri.start_time).toBe('06:30');
  expect(fri.finish_time).toBe('12:00');
  const agentJob = await page.evaluate(() => window.__agentJob);
  const agent = cards.find((c) => c.job_id === agentJob && c.included !== false) || {};
  expect(agent.start_time).toBe('08:00');
  expect(agent.description).toBe('ZZTEST agent line');
  expect(cards.find((c) => c.job_number === 'SWD-26088').finish_time).toBe('15:00');
  expect(errors).toEqual([]);
});
