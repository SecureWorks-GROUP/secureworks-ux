// SecureWorks Crew: P2-06.5 receipt capture against a job or a division's stock.
// Uses only made-up ZZTEST job numbers, generic roles and in-browser demo answers.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors } = require('../helpers/crew');

async function setupReceiptDemo(page, opts = {}) {
  const {
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

    // Replace every demo label with role-only ZZTEST fixtures.
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
      const res = origUpdate(p, b);
      if (window.__overrideNextStep !== undefined) {
        const step = window.__overrideNextStep;
        window.__overrideNextStep = undefined;
        return { ...res, next_step: step };
      }
      return res;
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
  }, { onlyFencing, noBookings, managed, failBookingsOnce, unreadTotal, suggestForeignJob });
  await expect(page.getByRole('heading', { name: 'Add a receipt' })).toBeVisible();
}

async function openCheckStep(page) {
  // Drive the non-camera "no receipt" or synthetic photo input into the check step.
  await page.getByRole('button', { name: 'I do not have a receipt' }).click();
  const sheet = page.getByRole('dialog', { name: 'No receipt' });
  await sheet.locator('textarea').fill('Faded thermal slip');
  await sheet.getByRole('button', { name: 'Carry on' }).click();
  await expect(page.getByRole('heading', { name: 'Check the receipt' })).toBeVisible();
}

test('Save stays disabled with no destination, keeps the four payment choices, and posts job_id or stock_division with capture_version 2', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page);
  await openCheckStep(page);

  // Exact four "how it was paid" choices preserved.
  const paidGroup = page.getByRole('group', { name: 'How was it paid?' });
  for (const label of ['I paid, pay me back', 'Company card', 'Company cash', 'Supplier account']) {
    await expect(paidGroup.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  // Legacy "no job" button is gone; stock group has the three stock buttons.
  await expect(page.getByRole('button', { name: /No job/i })).toHaveCount(0);
  const stockGroup = page.getByRole('group', { name: 'Not for one job? Pick the stock:' });
  for (const label of ['Patio stock', 'Fencing stock', 'Insurance stock']) {
    await expect(stockGroup.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await paidGroup.getByRole('button', { name: 'Company card', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Materials', exact: true }).click();

  // Save is disabled with no job or stock chosen, and shows the required prompt under Save.
  const saveBtn = page.getByRole('button', { name: /Save/ });
  await expect(saveBtn).toBeDisabled();
  await expect(page.locator('.foot')).toContainText('Pick the job or the stock this was for');

  // Choosing a job posts job_id and capture_version: 2, and shows saved_against_job words.
  await page.getByRole('group', { name: 'Which job?' }).getByRole('button', { name: 'ZZTEST North' }).click();
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(page.getByText('Saved against SWF-990001.')).toBeVisible();

  let updates = await page.evaluate(() => window.__updates);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({
    capture_version: 2,
    job_id: 'zz-fence-1',
    category: 'materials',
    payment_method: 'company_card'
  });
  expect(updates[0].stock_division).toBeUndefined();
  expect(updates[0].business_category).toBeUndefined();

  // Add a second receipt and choose "Fencing stock": posts stock_division: 'fencing' and no job_id.
  await page.getByRole('button', { name: 'Add another receipt' }).click();
  await openCheckStep(page);
  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'Company card', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Consumables', exact: true }).click();
  await page.getByRole('group', { name: 'Not for one job? Pick the stock:' }).getByRole('button', { name: 'Fencing stock', exact: true }).click();
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved to fencing stock.')).toBeVisible();

  updates = await page.evaluate(() => window.__updates);
  expect(updates).toHaveLength(2);
  expect(updates[1]).toMatchObject({
    capture_version: 2,
    stock_division: 'fencing',
    category: 'consumables',
    payment_method: 'company_card'
  });
  expect('job_id' in updates[1]).toBe(false);
  expect(updates[1].business_category).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a trade sees only their own jobs and only the divisions they work for', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page, { onlyFencing: true, suggestForeignJob: true });
  await openCheckStep(page);

  // Even when suggest_job_for_expense suggests another crew's job, only the trade's own job appears.
  const jobGroup = page.getByRole('group', { name: 'Which job?' });
  await expect(jobGroup.getByRole('button', { name: 'ZZTEST North' })).toBeVisible();
  await expect(jobGroup.getByRole('button', { name: 'ZZTEST Foreign' })).toHaveCount(0);
  await expect(jobGroup.getByRole('button', { name: 'ZZTEST East' })).toHaveCount(0);

  // Only the division this trade works for (Fencing stock) is shown.
  const stockGroup = page.getByRole('group', { name: 'Not for one job? Pick the stock:' });
  await expect(stockGroup.getByRole('button', { name: 'Fencing stock', exact: true })).toBeVisible();
  await expect(stockGroup.getByRole('button', { name: 'Patio stock', exact: true })).toHaveCount(0);
  await expect(stockGroup.getByRole('button', { name: 'Insurance stock', exact: true })).toHaveCount(0);

  // Searching in "Another job" also excludes other trades' jobs.
  await jobGroup.getByRole('button', { name: 'Another job' }).click();
  const sheet = page.getByRole('dialog', { name: 'Which job was it for?' });
  await sheet.getByPlaceholder('Suburb, name or job number').fill('ZZTEST');
  await expect(sheet.getByRole('button', { name: /ZZTEST North/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /ZZTEST Foreign/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('each next_step shows its exact saved words', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page);

  const cases = [
    ['I paid, pay me back', 'job', 'ZZTEST North', 'Saved. It will be on your next invoice as a reimbursement.'],
    ['Company cash', 'stock', 'Patio stock', 'Saved. The office will see it.'],
    ['Supplier account', 'job', 'ZZTEST North', "Saved. It will be matched to the supplier's bill."]
  ];

  for (let i = 0; i < cases.length; i++) {
    const [paidLabel, kind, pickLabel, expectedWords] = cases[i];
    if (i > 0) await page.getByRole('button', { name: 'Add another receipt' }).click();
    await openCheckStep(page);
    await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: paidLabel, exact: true }).click();
    await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Materials', exact: true }).click();
    const grp = kind === 'job' ? 'Which job?' : 'Not for one job? Pick the stock:';
    await page.getByRole('group', { name: grp }).getByRole('button', { name: pickLabel, exact: true }).click();
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByText(expectedWords, { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('409 expense_needs_job_or_division and office-edit refusals show server words under Save and retry cleanly', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page);
  await openCheckStep(page);

  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'I paid, pay me back', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Materials', exact: true }).click();
  await page.getByRole('group', { name: 'Not for one job? Pick the stock:' }).getByRole('button', { name: 'Insurance stock', exact: true }).click();

  // 1. Server returns 409 expense_needs_job_or_division in P2-06.4's exact body shape.
  await page.evaluate(async () => {
    const { ApiError } = await import('/crew/js/lib/api.js');
    window.__forceUpdateError = new ApiError('expense_needs_job_or_division', {
      status: 409,
      body: { error: 'expense_needs_job_or_division', message: 'Pick the job or the stock this was for.' }
    });
  });
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.locator('.foot [role="alert"]')).toHaveText('Pick the job or the stock this was for.');
  const outboxLen = await page.evaluate(() => JSON.parse(localStorage.getItem('crew:outbox') || '[]').length);
  expect(outboxLen).toBe(0);

  // 2. Office changed the record in the meantime -> 409 conflict words shown under Save.
  await page.evaluate(async () => {
    const { ApiError } = await import('/crew/js/lib/api.js');
    window.__forceUpdateError = new ApiError('The receipt changed. Reload it and try again.', {
      status: 409,
      body: { error: 'The receipt changed. Reload it and try again.' }
    });
  });
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.locator('.foot [role="alert"]')).toHaveText('The receipt changed. Reload it and try again.');

  // 3. Retry after refusal succeeds and shows saved words.
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved. It will be on your next invoice as a reimbursement.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('failed jobs read shows the error state instead of zero, and unread total stays blank', async ({ page }) => {
  const errors = watchErrors(page);
  await setupReceiptDemo(page, { failBookingsOnce: true, unreadTotal: true });
  await openCheckStep(page);

  // Failed my_jobs read shows LoadError, never zero jobs or divisions, and disables Save.
  await expect(page.getByText('Could not load your jobs')).toBeVisible();
  await expect(page.getByRole('button', { name: /Save/ })).toBeDisabled();

  // Retry loads jobs and divisions; unread total is blank (never 0), keeping Save disabled until filled.
  await page.evaluate(() => { window.__failMyJobs = false; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('group', { name: 'Which job?' }).getByRole('button', { name: 'ZZTEST North' })).toBeVisible();
  const totalInput = page.getByLabel('Total paid');
  await expect(totalInput).toHaveValue('');
  await page.getByRole('group', { name: 'How was it paid?' }).getByRole('button', { name: 'Company card', exact: true }).click();
  await page.getByRole('group', { name: 'What was it for?' }).getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('group', { name: 'Which job?' }).getByRole('button', { name: 'ZZTEST North' }).click();
  await expect(page.getByRole('button', { name: /Save/ })).toBeDisabled();
  await expect(page.locator('.foot')).toContainText('Add the total');

  // Offline save keeps the entered fields and sends capture_version: 2 + destination when back in range.
  await totalInput.fill('44');
  await page.evaluate(async () => {
    const { ApiError } = await import('/crew/js/lib/api.js');
    window.__forceUpdateError = new ApiError('No signal', { offline: true });
  });
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.locator('.foot [role="alert"]')).toContainText('No signal.');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved against SWF-990001.')).toBeVisible();
  expect(errors).toEqual([]);
});
