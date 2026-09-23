const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Captain rule 2026-09-23: a non-office job manager (Henry / fencing, Ryan /
// make-safe) sees no quote or job values and no other trade's pay or rates,
// but keeps other trades' HOURS for sign-off and their own pay. Office
// (admin / ops_manager) sees everything. Guard for <trade-office-money-door>.

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const PROFILE_API = `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy`;
const QUOTE_PDF = `${SUPABASE_ORIGIN}/storage/v1/object/sign/docs/e2e-quote.pdf?token=e2e`;

function jobDetail(workOrderId) {
  return {
    access_tier: 'division_manager',
    quote_visible: true,
    job: {
      id: 'e2e-job-1',
      job_number: 'E2E-JOB-001',
      type: 'fencing',
      status: 'scheduled',
      client_name: 'Fixture Homeowner',
      site_address: '30 Fixture Road',
      site_suburb: 'Joondalup',
      pricing_json: { total: 8800 },
      metadata: { external_ref: 'REF-1', pricing_correction: { new_total_inc_gst: 8800 } },
      scope_json: {
        totalMetres: 42,
        pricing: { labour: { days: 2, dayRate: 650 }, extras: [{ sell: 8800 }] },
        _pricing_json: { quoteTotal: 8800 },
      },
    },
    crew: [],
    purchaseOrders: [],
    documents: [
      { type: 'quote', file_name: 'Quote-Q-4412.pdf', pdf_url: QUOTE_PDF, storage_url: QUOTE_PDF, visible_to_trades: true, version: 1 },
    ],
    notes: [],
    media: [],
    quote_packs: [
      { quote_number: 'Q-4412', status: 'accepted', items: [{ description: 'Colorbond fence', quantity: 42, unit: 'm', unit_price: 8800 }] },
    ],
    workOrder: {
      id: workOrderId,
      wo_number: workOrderId === 'wo-own' ? 'WO-OWN' : 'WO-OTHER',
      scope_items: [{ description: 'Fence panels', quantity: 42, unit: 'm', unit_price: 18.5, total: 777 }],
    },
  };
}

function workOrders(viewerId) {
  return [
    {
      id: 'wo-own', wo_number: 'WO-OWN', job_id: 'e2e-job-1', job_number: 'E2E-JOB-001',
      assigned_user_id: viewerId, assigned_user_name: 'Me', status: 'sent', site_address: '30 Fixture Road',
      scope_items: [{ description: 'Own fence run', quantity: 10, rate: 50, total: 500 }],
      subtotal: 500, gst: 50, total: 550, negative_charges: [], available_negative_charge_total_ex: 0,
      already_invoiced: false, can_invoice: false, can_add_to_weekly_invoice: false,
    },
    {
      id: 'wo-other', wo_number: 'WO-OTHER', job_id: 'e2e-job-1', job_number: 'E2E-JOB-001',
      assigned_user_id: 'e2e-other-trade', assigned_user_name: 'Sam Offsider', status: 'sent', site_address: '30 Fixture Road',
      scope_items: [{ description: 'Other fence run', quantity: 42, rate: 18.5, total: 777 }],
      subtotal: 777, gst: 77.7, total: 854.7, negative_charges: [], available_negative_charge_total_ex: 0,
      already_invoiced: false, can_invoice: true, can_add_to_weekly_invoice: true,
    },
  ];
}

const CREW_CHARGES = {
  charges: [{
    line_id: 'cc-1', trade_name: 'Sam Offsider', job_id: 'e2e-job-1', job_number: 'E2E-JOB-001',
    total_hours: 6.5, hourly_rate: 45, line_total_ex: 292.5, acknowledgment_status: 'pending',
    override_amount: null, override_note: null, line_date: '2026-09-22', description: 'Fence install',
    invoice_status: 'submitted',
  }],
};

async function stubMoney(page, persona, opts) {
  opts = opts || {};
  const profile = Object.assign({}, persona.profile, opts.profile || {});
  const woModes = [];
  if (opts.profile) {
    await page.route(`${PROFILE_API}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') !== 'get_profile') return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile }) });
    });
  }
  await page.route(`${OPS_API}**`, async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    let body = null;
    if (action === 'trade_job_detail') body = jobDetail(opts.workOrderId || 'wo-other');
    if (action === 'my_work_orders') {
      woModes.push(url.searchParams.get('mode'));
      const rows = workOrders(profile.id);
      body = { schema: 'trade-work-orders.v1', work_orders: url.searchParams.get('mode') === 'mine' ? rows.filter((r) => r.assigned_user_id === profile.id) : rows };
    }
    if (action === 'crew_charges_on_my_jobs') body = CREW_CHARGES;
    if (!body) return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { woModes };
}

async function openWorkTab(page) {
  await page.evaluate(() => window.openJob('e2e-job-1'));
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
  await page.locator('.jd-tab[data-tab="workorder"]').click();
  return page.locator('#jdTab_workorder');
}

async function openWorkOrderHub(page) {
  await page.locator('[data-view="hours"]').click();
  await expect(page.locator('[data-financial-hub]')).toBeVisible();
  await page.getByRole('button', { name: 'My Work Orders' }).click();
  await expect(page.locator('[data-work-order-card]')).toHaveCount(2);
}

test.describe('office sees every figure', () => {
  test.use({ persona: 'allocator' });

  test('job detail shows the other trade work order money and crew rates', async ({ appPage: page }) => {
    const seen = await stubMoney(page, PERSONAS.allocator);
    await signIn(page, PERSONAS.allocator);
    const work = await openWorkTab(page);
    const cost = work.locator('#woJobCostBreakdown');
    await expect(cost).toContainText('Total: $854.70');
    const crew = work.locator('#woJobCrewCharges');
    await expect(crew).toContainText('Sam Offsider');
    await expect(crew).toContainText('6.5hrs');
    await expect(crew).toContainText('$292.50');
    expect(seen.woModes).toContain('all');
  });
});

test.describe('vertical manager (non-office) sees hours, never money', () => {
  test.use({ persona: 'fencing_manager' });

  test('tier-3 manager: crew hours for sign-off, no rates, totals or other trade work order pay', async ({ appPage: page }) => {
    const seen = await stubMoney(page, PERSONAS.fencing_manager, { profile: { trade_tier: 3 }, workOrderId: 'wo-other' });
    await signIn(page, PERSONAS.fencing_manager);
    const work = await openWorkTab(page);
    const crew = work.locator('#woJobCrewCharges');
    await expect(crew).toContainText('Sam Offsider');
    await expect(crew).toContainText('6.5hrs');
    await expect(crew.locator('.crew-btn-approve')).toHaveCount(1);
    await expect(crew).not.toContainText('$');
    await expect(crew).not.toContainText('292');
    await expect(work.locator('#woJobCostBreakdown')).toHaveCount(0);
    expect(seen.woModes).toEqual(['mine']);
    await expect(work).not.toContainText('854');
    await expect(work).not.toContainText('777');
    await expect(work).not.toContainText('8800');
    await expect(work).not.toContainText('8,800');
    await expect(page.locator('#viewJob')).not.toContainText('$');
    await page.locator('.jd-tab[data-tab="scope"]').click();
    await expect(page.locator('#jdTab_scope')).toContainText('Q-4412');
    await expect(page.locator('#jdTab_scope')).not.toContainText('$');
    await page.locator('.jd-tab[data-tab="files"]').click();
    await expect(page.locator('#jdTab_files')).not.toContainText('Quote-Q-4412.pdf');
    await expect(page.locator(`#viewJob a[href="${QUOTE_PDF}"]`)).toHaveCount(0);
  });

  test('tier-3 manager keeps their OWN work order pay in the job detail', async ({ appPage: page }) => {
    await stubMoney(page, PERSONAS.fencing_manager, { profile: { trade_tier: 3 }, workOrderId: 'wo-own' });
    await signIn(page, PERSONAS.fencing_manager);
    const work = await openWorkTab(page);
    const cost = work.locator('#woJobCostBreakdown');
    await expect(cost).toContainText('Own fence run');
    await expect(cost).toContainText('Total: $550.00');
  });

  test('Pay: crew review shows hours only and the work order hub hides the other trade pay', async ({ appPage: page }) => {
    await stubMoney(page, PERSONAS.fencing_manager);
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    const review = page.locator('#crewReviewSection');
    await expect(review).toContainText('Sam Offsider');
    await expect(review).toContainText('6.5hrs');
    await expect(review).not.toContainText('$');
    await expect(review).not.toContainText('292');

    await page.getByRole('button', { name: 'My Work Orders' }).click();
    await expect(page.locator('[data-work-order-card]')).toHaveCount(2);
    const own = page.locator('[data-work-order-card]').filter({ hasText: 'WO-OWN' });
    await expect(own).toContainText('Total: $550.00');
    const other = page.locator('[data-work-order-card]').filter({ hasText: 'WO-OTHER' });
    await expect(other).toContainText('Other fence run');
    await expect(other.locator('[data-work-order-money-withheld]')).toContainText('Sam Offsider');
    await expect(other).not.toContainText('$');
    await expect(other).not.toContainText('777');
    await expect(other).not.toContainText('854');
    await expect(other.getByRole('button')).toHaveCount(0);
  });
});

test.describe('hourly crew is unchanged', () => {
  test.use({ persona: 'installer' });

  test('own work order pay stays visible and no crew review is requested', async ({ appPage: page }) => {
    await stubMoney(page, PERSONAS.installer);
    let crewReads = 0;
    await page.route(`${OPS_API}**`, async (route) => {
      if (new URL(route.request().url()).searchParams.get('action') === 'crew_charges_on_my_jobs') crewReads++;
      await route.fallback();
    });
    await signIn(page, PERSONAS.installer);
    await openWorkOrderHub(page);
    const own = page.locator('[data-work-order-card]').filter({ hasText: 'WO-OWN' });
    await expect(own).toContainText('Total: $550.00');
    await expect(page.locator('#crewReviewSection')).toHaveCount(0);
    expect(crewReads).toBe(0);
  });
});
