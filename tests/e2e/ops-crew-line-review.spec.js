// Office review of a crew invoice line before the Xero bill.
// Flag off (no office_review_status) paints no controls. An unknown action
// removes them. The review block has no Send and no agreed labour. A trade
// render shows no pay.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

function job(lines) {
  const wo = {
    id: 'wo-1', job_id: 'job-1', wo_number: 'WO-1', kind: 'job', status: 'approved',
    agreed_labour_ex: 2000, scope_items: [], updated_at: '2026-10-21T00:00:00.000Z',
  };
  return {
    job: {
      id: 'job-1', type: 'fencing', job_number: 'SWF-1', status: 'accepted',
      client_name: 'Fixture Client', site_suburb: 'Dianella',
    },
    documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [], purchase_orders: [],
    job_work_order: {
      work_order: wo,
      figures: { agreed_ex: 2000, billed_to_date_ex: 400, remaining_ex: 1600, over_agreed: false },
      lines: [],
      variations: [],
    },
    _lines: lines,
  };
}

async function openOverview(page, data, answers, role) {
  await page.route('https://marninms98-dotcom.github.io/**', (route) => route.fulfill({ status: 200, body: '' }));
  await revealOpsStaticFixture(page);
  await page.evaluate(({ data, answers, role }) => {
    window.__calls = [];
    window.__answers = answers;
    _opsUserEmail = 'shaun@secureworkswa.com.au';
    if (role) {
      window.SECUREWORKS_CLOUD = { auth: { getRole: function () { return role; }, isLoggedIn: function () { return true; } } };
    }
    window.opsFetch = async function (action, params) {
      window.__calls.push({ method: 'GET', action, params });
      const a = window.__answers[action];
      if (a && a.reject) {
        const e = new Error(a.reject.message);
        e.code = a.reject.code;
        throw e;
      }
      return JSON.parse(JSON.stringify(a || {}));
    };
    window.opsPost = async function (action, body) {
      window.__calls.push({ method: 'POST', action, body });
      const a = window.__answers[action];
      if (a && a.reject) {
        const e = new Error(a.reject.message);
        e.code = a.reject.code;
        e.status = a.reject.status;
        throw e;
      }
      return JSON.parse(JSON.stringify(a || {}));
    };
    _currentJobId = data.job.id;
    _currentJobData = data;
    document.getElementById('jobDetailView').classList.add('active');
    showJobSubView('overview');
  }, { data, answers, role: role || '' });
}

test('a line with no office review status paints no controls', async ({ page }) => {
  await page.goto('/ops.html');
  const data = job();
  delete data._lines;
  await openOverview(page, data, {
    job_work_order: data.job_work_order,
    list_trade_invoice_lines: {
      office_review_enabled: false,
      lines: [
        { id: 'line-null', trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', line_total_ex: 400, office_review_status: null, trade_invoices: { status: 'acknowledged' } },
        { id: 'line-missing', trade_name: 'Pat Crew', description: 'Second day', line_type: 'labour', line_total_ex: 880, review_state: 'approved', trade_invoices: { status: 'acknowledged' } },
      ],
    },
  });
  const card = page.locator('#jdOverview [data-job-wo-overview-card]');
  await expect(card).toContainText('Sam Crew');
  await expect(card.locator('[data-office-line-review]')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Query' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Send' })).toHaveCount(0);
});

test('an awaiting line can be approved, and the review block has no send and no agreed labour', async ({ page }) => {
  await page.goto('/ops.html');
  const data = job();
  delete data._lines;
  await openOverview(page, data, {
    job_work_order: data.job_work_order,
    list_trade_invoice_lines: {
      lines: [
        { id: 'line-1', trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', line_total_ex: 400, office_review_status: 'awaiting', other_share: 7777, agreed_labour_ex: 2000, trade_invoices: { status: 'pending_acknowledgment' } },
        { id: 'line-old', trade_name: 'Old Crew', description: 'Historical day', line_type: 'labour', line_total_ex: 880, office_review_status: null, trade_invoices: { status: 'acknowledged' } },
      ],
    },
    review_crew_invoice_line: {
      line_id: 'line-1', office_review_status: 'approved', invoice_status: 'pending_acknowledgment', ready_for_xero_push: false,
    },
  });
  const block = page.locator('[data-office-line-review="line-1"]');
  await expect(block).toContainText('Awaiting office review');
  await expect(block.locator('button')).toHaveText(['Approve', 'Query', 'Reject']);
  await expect(block).not.toContainText('Send');
  await expect(block).not.toContainText('Agreed labour');
  await expect(block).not.toContainText('7777');
  await expect(block).not.toContainText('$');
  await expect(page.locator('[data-office-line-review="line-old"]')).toHaveCount(0);

  await block.locator('[data-office-line-note]').fill('Check the hours');
  await block.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter((c) => c.method === 'POST').length)).toBe(1);
  const post = await page.evaluate(() => window.__calls.find((c) => c.method === 'POST'));
  expect(post.action).toBe('review_crew_invoice_line');
  expect(post.body).toEqual({ line_id: 'line-1', decision: 'approve', note: 'Check the hours' });
  await expect(block).toContainText('Approved for the bill');
});

test('an unknown review action removes the controls', async ({ page }) => {
  await page.goto('/ops.html');
  const data = job();
  delete data._lines;
  await openOverview(page, data, {
    job_work_order: data.job_work_order,
    list_trade_invoice_lines: {
      lines: [
        { id: 'line-1', trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', line_total_ex: 400, office_review_status: 'awaiting', trade_invoices: { status: 'pending_acknowledgment' } },
      ],
    },
    review_crew_invoice_line: { reject: { message: 'Unknown action', code: 'unknown_action', status: 400 } },
  });
  const block = page.locator('[data-office-line-review]');
  await expect(block).toHaveCount(1);
  await block.getByRole('button', { name: 'Query' }).click();
  await expect(page.locator('[data-office-line-review]')).toHaveCount(0);
  await expect(page.locator('#jdOverview')).not.toContainText('Send');
  const post = await page.evaluate(() => window.__calls.find((c) => c.method === 'POST'));
  expect(post.body.decision).toBe('query');
  expect(post.body.note).toBeUndefined();
});

test('a trade role and a trade render show no review controls and no pay', async ({ page }) => {
  await page.goto('/ops.html');
  const data = job();
  delete data._lines;
  await openOverview(page, data, {
    job_work_order: data.job_work_order,
    list_trade_invoice_lines: {
      office_review_enabled: true,
      lines: [
        { id: 'line-1', trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', line_total_ex: 400, office_review_status: 'awaiting', trade_invoices: { status: 'pending_acknowledgment' } },
      ],
    },
  }, 'installer');
  await expect(page.locator('[data-job-wo-overview-card]')).toHaveCount(0);
  await expect(page.locator('[data-office-line-review]')).toHaveCount(0);
  await expect(page.locator('#jdOverview')).not.toContainText('Agreed labour');
  await expect(page.locator('#jdOverview')).not.toContainText('$400');
  await expect(page.locator('#jdOverview')).not.toContainText('$2,000');

  const rendered = await page.evaluate(() => {
    const quiet = JobWorkOrderCore.renderOverviewCard(
      { work_order: { id: 'wo-1', status: 'approved', wo_number: 'WO-1', agreed_labour_ex: 5000 } },
      null,
      {
        showMoney: false,
        linesState: 'ready',
        lines: [{
          id: 'line-1', trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour',
          line_total_ex: 400, office_review_status: 'awaiting', other_share: 7777, agreed_labour_ex: 5000,
        }],
      }
    );
    const trade = JobWorkOrderCore.renderTrade({
      work_order: {
        id: 'wo-1', wo_number: 'WO-1', status: 'approved', agreed_labour_ex: 5000,
        scope_items: [{ description: 'Install panels', hours: 2 }],
        other_shares: [{ name: 'Other crew', share: 2500 }],
        my_share: 2500,
        pot_total: 5000,
      },
    }, 'ready');
    return { quiet: quiet, trade: trade };
  });
  expect(rendered.quiet).not.toContain('data-office-line-review');
  expect(rendered.quiet).not.toContain('data-office-line-decision');
  expect(rendered.trade).not.toContain('data-office-line-review');
  expect(rendered.trade).not.toContain('data-office-line-decision');
  expect(rendered.quiet + rendered.trade).not.toContain('Send');
  expect(rendered.quiet + rendered.trade).not.toContain('$');
  expect(rendered.quiet + rendered.trade).not.toContain('Agreed labour');
  expect(rendered.quiet + rendered.trade).not.toContain('7777');
  expect(rendered.quiet + rendered.trade).not.toContain('2500');
  expect(rendered.quiet + rendered.trade).not.toContain('5000');
  expect(rendered.trade).toContain('Install panels');
});
