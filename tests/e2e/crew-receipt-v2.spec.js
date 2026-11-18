// SecureWorks Crew: P2-06.5 receipt capture across both switch states of
// spend_capture_v2 and trade_reimbursement_line_v1.
// Uses only made-up ZZTEST job numbers, generic roles and in-browser demo answers.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors } = require('../helpers/crew');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function setupReceiptDemo(page, opts = {}) {
  const {
    spendCaptureV2 = true,
    reimbursements = false,
    onlyFencing = false,
    noBookings = false,
    managed = [],
    failBookingsOnce = false,
    unreadTotal = false,
    suggestForeignJob = false
  } = opts;
  await page.goto(crewUrl('#/today', 'crew'));
  await page.waitForFunction(() => Boolean(window.__crewDemo) && Boolean(document.querySelector('.appbar')));
  await page.evaluate(async (cfg) => {
    const { db, ops } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    const auth = await import('/crew/js/lib/auth.js');

    db.flags.spendCaptureV2 = cfg.spendCaptureV2;
    db.flags.reimbursements = cfg.reimbursements;
    db.me.name = 'Crew member';
    db.me.managed_verticals = cfg.managed;
    store.setState({ user: auth.decorate({ ...db.me, name: 'Crew member', managed_verticals: cfg.managed }) });

    db.jobs.splice(0, db.jobs.length,
      { id: 'zz-fence-1', type: 'fencing', status: 'scheduled', job_number: 'SWF-990001', client_name: 'Client A', site_suburb: 'ZZTEST North', site_address: '' },
      { id: 'zz-patio-2', type: 'patio', status: 'in_progress', job_number: 'SWP-990002', client_name: 'Client B', site_suburb: 'ZZTEST East', site_address: '' },
      { id: 'zz-ins-3', type: 'makesafe', status: 'in_progress', job_number: 'SWMS-990003', client_name: 'Client C', site_suburb: 'ZZTEST South', site_address: '' },
      { id: 'zz-other-4', type: 'patio', status: 'scheduled', job_number: 'SWP-990004', client_name: 'Other Crew Client', site_suburb: 'ZZTEST Foreign', site_address: '' }
    );

    const today = '2026-11-13';
    db.assignments.splice(0, db.assignments.length);
    if (!cfg.noBookings) {
      db.assignments.push({
        id: 'asg-1', job_id: 'zz-fence-1', user_id: db.me.id, scheduled_date: today,
        start_time: '07:00', status: 'confirmed', role: 'crew', assignment_type: 'install'
      });
      if (!cfg.onlyFencing) {
        db.assignments.push(
          { id: 'asg-2', job_id: 'zz-patio-2', user_id: db.me.id, scheduled_date: today, start_time: '09:00', status: 'confirmed', role: 'crew', assignment_type: 'install' },
          { id: 'asg-3', job_id: 'zz-ins-3', user_id: db.me.id, scheduled_date: '2026-11-12', start_time: '08:00', status: 'complete', role: 'crew', assignment_type: 'install' }
        );
      }
    }
    // Another trade's booking: must never show for this trade.
    db.assignments.push({
      id: 'asg-foreign', job_id: 'zz-other-4', user_id: 'other-trade', scheduled_date: today,
      start_time: '07:00', status: 'confirmed', role: 'crew', assignment_type: 'install'
    });

    db.expenses.splice(0, db.expenses.length);
    window.__updates = [];

    const origSubmit = ops.submit_expense;
    ops.submit_expense = (p, b) => {
      const res = origSubmit(p, b);
      res.extraction = cfg.unreadTotal
        ? { vendor_name: 'ZZTEST Supplier', receipt_date: today, total_amount: null, gst_amount: null, line_items: [] }
        : { vendor_name: 'ZZTEST Supplier', receipt_date: today, total_amount: 55, gst_amount: 5, line_items: [{ description: 'Fixings pack', quantity: 1, unit_price: 55, total: 55 }] };
      const saved = db.expenses.find((x) => x.id === res.expense_id);
      if (saved) Object.assign(saved, { vendor_name: res.extraction.vendor_name, receipt_date: today, total_amount: res.extraction.total_amount, gst_amount: res.extraction.gst_amount });
      return res;
    };

    const origSuggest = ops.suggest_job_for_expense;
    ops.suggest_job_for_expense = (p, b) => {
      const res = origSuggest(p, b);
      if (cfg.suggestForeignJob) {
        res.suggestions.unshift({
          job_id: 'zz-other-4', job_number: 'SWP-990004', client_name: 'Other Crew Client',
          site_suburb: 'ZZTEST Foreign', score: 0.99, reason: 'PO with same supplier'
        });
      }
      return res;
    };

    const origUpdate = ops.update_expense;
    ops.update_expense = (p, b) => {
      window.__updates.push(JSON.parse(JSON.stringify(b)));
      if (window.__forceUpdateError) {
        const err = window.__forceUpdateError;
        window.__forceUpdateError = null;
        throw err;
      }
      return origUpdate(p, b);
    };

    if (cfg.failBookingsOnce) {
      const apiLib = await import('/crew/js/lib/api.js');
      window.__failMyJobs = true;
      const origMyJobs = ops.my_jobs;
      ops.my_jobs = (p) => {
        if (window.__failMyJobs) {
          throw new apiLib.ApiError('Jobs could not be read.', { status: 503, body: { error: 'Jobs could not be read.' } });
        }
        return origMyJobs(p);
      };
    }

    store.clearQueries();
    Object.keys(localStorage).filter((k) => k.startsWith('crew:q:')).forEach((k) => localStorage.removeItem(k));
    location.hash = '#/pay/receipt';
  }, { spendCaptureV2, reimbursements, onlyFencing, noBookings, managed, failBookingsOnce, unreadTotal, suggestForeignJob });
  await expect(page.getByRole('heading', { name: 'Add a receipt' })).toBeVisible();
}

async function openCheckWithPhoto(page) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Take a photo of the receipt' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.getByRole('heading', { name: 'Check the receipt' })).toBeVisible();
}

test('with spend_capture_v2 OFF, No job general business stays available for fuel, parking and meals and own-card words match trade_reimbursement_line_v1', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page, { spendCaptureV2: false, reimbursements: false });
  await openCheckWithPhoto(page);

  // Stock picker is hidden while spend_capture_v2 is off; "No job, general business" is available.
  await expect(page.getByRole('group', { name: 'Not for one job? Pick the stock:' })).toHaveCount(0);
  const jobGroup = page.getByRole('group', { name: 'Which job?' });
  const noJobBtn = jobGroup.getByRole('button', { name: 'No job, general business', exact: true });
  await expect(noJobBtn).toBeVisible();

  // Fuel with no job posts business_category: 'vehicle', job_id: null, and no capture_version or stock_division.
  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'I paid, pay me back', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Fuel', exact: true }).click();
  await noJobBtn.click();
  await page.getByRole('button', { name: 'Send receipt', exact: true }).click();

  // With trade_reimbursement_line_v1 OFF, keeps today's true "outside this app" words, never promising next-invoice reimbursement.
  await expect(page.getByRole('heading', { name: 'Receipt sent' })).toBeVisible();
  await expect(page.getByText('Once it is approved, the office pays you back. That happens outside this app and is not part of your weekly invoice', { exact: false })).toBeVisible();
  await expect(page.getByText('on your next invoice as a reimbursement', { exact: false })).toHaveCount(0);

  let updates = await page.evaluate(() => window.__updates);
  expect(updates[0]).toMatchObject({ category: 'fuel', payment_method: 'personal_card', job_id: null, business_category: 'vehicle' });
  expect(updates[0].capture_version).toBeUndefined();
  expect(updates[0].stock_division).toBeUndefined();

  // Parking also maps to vehicle under "No job, general business".
  await page.getByRole('button', { name: 'Add another receipt' }).click();
  await openCheckWithPhoto(page);
  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'Company card', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Parking', exact: true }).click();
  await page.getByRole('group', { name: 'Which job?' }).getByRole('button', { name: 'No job, general business', exact: true }).click();
  await page.getByRole('button', { name: 'Send receipt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Receipt sent' })).toBeVisible();

  // Meals maps to overhead under "No job, general business"; with trade_reimbursement_line_v1 ON on server, own-card photo receipt says next invoice.
  await page.evaluate(() => { window.__crewDemo.db.flags.reimbursements = true; });
  await page.getByRole('button', { name: 'Add another receipt' }).click();
  await openCheckWithPhoto(page);
  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'I paid, pay me back', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Meals', exact: true }).click();
  await page.getByRole('group', { name: 'Which job?' }).getByRole('button', { name: 'No job, general business', exact: true }).click();
  await page.getByRole('button', { name: 'Send receipt', exact: true }).click();
  await expect(page.getByText('Saved. It will be on your next invoice as a reimbursement.', { exact: true })).toBeVisible();
  await expect(page.getByText('outside this app', { exact: false })).toHaveCount(0);

  updates = await page.evaluate(() => window.__updates);
  expect(updates[1]).toMatchObject({ category: 'parking', payment_method: 'company_card', job_id: null, business_category: 'vehicle' });
  expect(updates[2]).toMatchObject({ category: 'meals', payment_method: 'personal_card', job_id: null, business_category: 'overhead' });
  expect(errors).toEqual([]);
});

test('with spend_capture_v2 ON, Save stays disabled with no destination, keeps the four payment choices, and posts job_id or stock_division with capture_version 2', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page, { spendCaptureV2: true, reimbursements: false });
  await openCheckWithPhoto(page);

  const paidGroup = page.getByRole('group', { name: 'How was it paid?' });
  for (const label of ['I paid, pay me back', 'Company card', 'Company cash', 'Supplier account']) {
    await expect(paidGroup.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await expect(page.getByRole('button', { name: /No job/i })).toHaveCount(0);
  const stockGroup = page.getByRole('group', { name: 'Not for one job? Pick the stock:' });
  for (const label of ['Patio stock', 'Fencing stock', 'Insurance stock']) {
    await expect(stockGroup.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await paidGroup.getByRole('button', { name: 'Company card', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Materials', exact: true }).click();

  const saveBtn = page.getByRole('button', { name: 'Save receipt', exact: true });
  await expect(saveBtn).toBeDisabled();
  await expect(page.locator('.foot')).toContainText('Pick the job or the stock this was for');

  await page.getByRole('group', { name: 'Which job?' }).getByRole('button', { name: 'ZZTEST North' }).click();
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(page.getByText('Saved against SWF-990001.', { exact: true })).toBeVisible();

  let updates = await page.evaluate(() => window.__updates);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({ capture_version: 2, job_id: 'zz-fence-1', category: 'materials', payment_method: 'company_card' });
  expect(updates[0].stock_division).toBeUndefined();
  expect(updates[0].business_category).toBeUndefined();

  await page.getByRole('button', { name: 'Add another receipt' }).click();
  await openCheckWithPhoto(page);
  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'Company card', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Consumables', exact: true }).click();
  await page.getByRole('group', { name: 'Not for one job? Pick the stock:' }).getByRole('button', { name: 'Fencing stock', exact: true }).click();
  await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
  await expect(page.getByText('Saved to fencing stock.', { exact: true })).toBeVisible();

  updates = await page.evaluate(() => window.__updates);
  expect(updates).toHaveLength(2);
  expect(updates[1]).toMatchObject({ capture_version: 2, stock_division: 'fencing', category: 'consumables', payment_method: 'company_card' });
  expect('job_id' in updates[1]).toBe(false);
  expect(updates[1].business_category).toBeUndefined();
  expect(errors).toEqual([]);
});

test('with spend_capture_v2 ON, own-card receipts keep outside-this-app words while trade_reimbursement_line_v1 is OFF, and show next_step words when ON', async ({ page }) => {
  const errors = watchErrors(page);
  // 1. spend_capture_v2 ON + trade_reimbursement_line_v1 OFF -> must NOT promise next-invoice reimbursement.
  await setupReceiptDemo(page, { spendCaptureV2: true, reimbursements: false });
  await openCheckWithPhoto(page);
  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'I paid, pay me back', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Materials', exact: true }).click();
  await page.getByRole('group', { name: 'Which job?' }).getByRole('button', { name: 'ZZTEST North', exact: true }).click();
  await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
  await expect(page.getByText('Saved. The office will see it.', { exact: true })).toBeVisible();
  await expect(page.getByText('Once it is approved, the office pays you back. That happens outside this app and is not part of your weekly invoice', { exact: false })).toBeVisible();
  await expect(page.getByText('on your next invoice as a reimbursement', { exact: false })).toHaveCount(0);

  // 2. Server turns trade_reimbursement_line_v1 ON -> now shows exact next_step words for personal_card, cash and supplier_invoice.
  await page.evaluate(() => { window.__crewDemo.db.flags.reimbursements = true; });
  const cases = [
    ['I paid, pay me back', 'job', 'ZZTEST North', 'Saved. It will be on your next invoice as a reimbursement.'],
    ['Company cash', 'stock', 'Patio stock', 'Saved. The office will see it.'],
    ['Supplier account', 'job', 'ZZTEST North', "Saved. It will be matched to the supplier's bill."]
  ];
  for (const [paidLabel, kind, pickLabel, expectedWords] of cases) {
    await page.getByRole('button', { name: 'Add another receipt' }).click();
    await openCheckWithPhoto(page);
    await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: paidLabel, exact: true }).click();
    await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Materials', exact: true }).click();
    const grp = kind === 'job' ? 'Which job?' : 'Not for one job? Pick the stock:';
    await page.getByRole('group', { name: grp }).getByRole('button', { name: pickLabel, exact: true }).click();
    await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
    await expect(page.getByText(expectedWords, { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('a trade sees only their own jobs and only the divisions they work for', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page, { spendCaptureV2: true, onlyFencing: true, suggestForeignJob: true });
  await openCheckWithPhoto(page);

  const jobGroup = page.getByRole('group', { name: 'Which job?' });
  await expect(jobGroup.getByRole('button', { name: 'ZZTEST North' })).toBeVisible();
  await expect(jobGroup.getByRole('button', { name: 'ZZTEST Foreign' })).toHaveCount(0);
  await expect(jobGroup.getByRole('button', { name: 'ZZTEST East' })).toHaveCount(0);

  const stockGroup = page.getByRole('group', { name: 'Not for one job? Pick the stock:' });
  await expect(stockGroup.getByRole('button', { name: 'Fencing stock', exact: true })).toBeVisible();
  await expect(stockGroup.getByRole('button', { name: 'Patio stock', exact: true })).toHaveCount(0);
  await expect(stockGroup.getByRole('button', { name: 'Insurance stock', exact: true })).toHaveCount(0);

  await jobGroup.getByRole('button', { name: 'Another job' }).click();
  const sheet = page.getByRole('dialog', { name: 'Which job was it for?' });
  await sheet.getByPlaceholder('Suburb, name or job number').fill('ZZTEST');
  await expect(sheet.getByRole('button', { name: /ZZTEST North/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /ZZTEST Foreign/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('409 refusals, office-edit conflicts, failed jobs reads and unread totals behave safely', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page, { spendCaptureV2: true, reimbursements: true, failBookingsOnce: true, unreadTotal: true });
  await openCheckWithPhoto(page);

  // Failed my_jobs read shows LoadError, never zero jobs or divisions, and disables Save.
  await expect(page.getByText('Could not load your jobs')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save receipt', exact: true })).toBeDisabled();

  await page.evaluate(() => { window.__failMyJobs = false; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('group', { name: 'Which job?' }).getByRole('button', { name: 'ZZTEST North' })).toBeVisible();

  const totalInput = page.getByLabel('Total paid');
  await expect(totalInput).toHaveValue('');
  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'I paid, pay me back', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('group', { name: 'Not for one job? Pick the stock:' }).getByRole('button', { name: 'Insurance stock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save receipt', exact: true })).toBeDisabled();
  await expect(page.locator('.foot')).toContainText('Add the total');
  await totalInput.fill('55');

  // 409 expense_needs_job_or_division shows server words under Save and leaves outbox empty.
  await page.evaluate(async () => {
    const { ApiError } = await import('/crew/js/lib/api.js');
    window.__forceUpdateError = new ApiError('expense_needs_job_or_division', {
      status: 409,
      body: { error: 'expense_needs_job_or_division', message: 'Pick the job or the stock this was for.' }
    });
  });
  await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
  await expect(page.locator('.foot [role="alert"]')).toHaveText('Pick the job or the stock this was for.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crew:outbox') || '[]').length)).toBe(0);

  // Office-edit 409 conflict shows server words under Save, then retry succeeds.
  await page.evaluate(async () => {
    const { ApiError } = await import('/crew/js/lib/api.js');
    window.__forceUpdateError = new ApiError('The receipt changed. Reload it and try again.', {
      status: 409,
      body: { error: 'The receipt changed. Reload it and try again.' }
    });
  });
  await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
  await expect(page.locator('.foot [role="alert"]')).toHaveText('The receipt changed. Reload it and try again.');

  await page.getByRole('button', { name: 'Save receipt', exact: true }).click();
  await expect(page.getByText('Saved. It will be on your next invoice as a reimbursement.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
