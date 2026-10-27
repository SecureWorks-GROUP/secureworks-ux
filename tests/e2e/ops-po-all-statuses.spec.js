// Guard for "every purchase order is shown" (Captain 2026-10-12, `<po-board-columns>`
// and `<calendar-delivery-row>` in ops.html).
//
// The purchase order board in the Dispatch tab matched each order to a column by
// its exact status, and had no column for `sent`, `confirmed` or `delivered`, so
// those orders were counted in the badge and never drawn (6 of 22 on 12 Oct). The
// Calendar's Deliveries row read only the calendar feed, which sends just draft,
// submitted and authorised orders.
//
// These specs drive the real load paths (the list_pos and calendar reads are
// stubbed at the network) and check that:
//  - an order in every live status the back end allows is on the board, in the
//    column an ops person expects, and an unknown or blank status lands in "Other";
//  - a cancelled order stays off the board and the Calendar row, as it always did;
//  - the six columns look as they did when no unknown order exists;
//  - the status tick boxes work by column and can never hide "Other";
//  - an order in every live status with a delivery day is on the Calendar's
//    Deliveries row, the row still shows the feed's own rows if the order list
//    fails, and it drops an order that has left the order list;
//  - a failed order list read falls back to the calendar feed's fresh rows, not
//    to the list remembered from an earlier load;
//  - Financials > Purchase Orders files a sent, confirmed or delivered order
//    under its own chip, and the job's material ordering cards read its state;
//  - the job page's "Delivery tomorrow, not confirmed" alert leaves a confirmed
//    or delivered order alone;
//  - the Gate Ledger (Cap 1B preview) counts a sent, confirmed or delivered
//    order as materials ordered.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

// Every status purchase_orders_status_check allows that the board shows, and the
// column each sits in. `cancelled` is kept off on purpose and `deleted` is the
// soft-delete marker list_pos filters out.
const STATUS_COLUMN = {
  quote_requested: 'quote_requested',
  draft: 'draft',
  approved: 'approved',
  submitted: 'submitted',
  sent: 'submitted',
  authorised: 'authorised',
  confirmed: 'authorised',
  billed: 'billed',
  delivered: 'billed',
};
const KNOWN_STATUSES = Object.keys(STATUS_COLUMN);
const LEGACY_STATUSES = ['draft', 'approved', 'submitted', 'quote_requested', 'authorised', 'billed'];

function po(status, extra) {
  const slug = status || 'blank';
  const now = new Date().toISOString();
  return Object.assign({
    id: 'po-' + slug,
    po_number: 'PO-' + slug,
    supplier_name: 'Supplier ' + slug,
    status,
    total: 100,
    line_items: [],
    communications: [],
    // On a job still being worked, so the Dispatch board shows it (see
    // <po-board-active-jobs>).
    job_id: 'job-active',
    job_status: 'order_materials',
    created_at: now,
    updated_at: now,
  }, extra);
}

async function bootOps(page, { responses = {}, failures = {} } = {}) {
  const apiCalls = [];
  const bodies = Object.assign({ pipeline: { columns: {} } }, responses);
  await installOpsSessionStub(page);
  // These tests read the Crew view's Deliveries row over the default one-week
  // window. Calendar v3 opens a first-time browser on the job-based Month
  // (sw_cal_v3_intro), so pin the view and range this spec was written against.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sw_cal_v3_intro', '1');
      localStorage.setItem('sw_cal_view_mode', 'crew');
      localStorage.setItem('sw_cal_range', '1w');
    } catch (e) { /* storage unavailable: the page falls back to its defaults */ }
  });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (match) apiCalls.push(match[1]);
    if (match && failures[match[1]]) {
      return route.fulfill({ status: failures[match[1]], contentType: 'application/json', body: JSON.stringify({ error: 'e2e failure' }) });
    }
    const body = match && bodies[match[1]] ? bodies[match[1]] : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(OPS_FILE);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  return { apiCalls, bodies };
}

async function openDispatch(page) {
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
}

function boardCard(page, status) {
  return page.locator(`#materialsKanban .kanban-card[data-po-id="po-${status || 'blank'}"]`);
}

test('an order in every status is on the board, in the column an ops person expects', async ({ page }) => {
  const orders = KNOWN_STATUSES.map((s) => po(s)).concat([po('cancelled')]);
  await bootOps(page, { responses: { list_pos: { purchase_orders: orders } } });
  await openDispatch(page);

  for (const status of KNOWN_STATUSES) {
    const card = page.locator(`#materialsKanban [data-po-col="${STATUS_COLUMN[status]}"] .kanban-card[data-po-id="po-${status}"]`);
    await expect(card, `${status} order`).toBeVisible();
    await expect(card).toContainText('Supplier ' + status);
  }
  await expect(page.locator('#materialsKanban .kanban-card')).toHaveCount(KNOWN_STATUSES.length);
  await expect(page.locator('#materialsCount')).toHaveText(String(KNOWN_STATUSES.length));

  // The newer words share the column of the older word they replaced.
  await expect(page.locator('#materialsKanban .kanban-col-header')).toHaveText([
    'Draft1', 'Approved1', 'Sent · Awaiting approval in Xero2', 'Quote asked1', 'Supplier confirmed · Approved in Xero2', 'Billed · Delivered2',
  ]);
  // Each order reads its own status word, so two statuses in one column differ.
  // A billed order is never Delivered (doc 3 section 5).
  const word = (status) => boardCard(page, status).locator('.po-status-word');
  await expect(word('sent')).toHaveText('Sent');
  await expect(word('submitted')).toHaveText('Awaiting approval in Xero');
  await expect(word('quote_requested')).toHaveText('Quote asked');
  await expect(word('confirmed')).toHaveText('Supplier confirmed');
  await expect(word('authorised')).toHaveText('Approved in Xero');
  await expect(word('delivered')).toHaveText('Delivered');
  await expect(word('billed')).toHaveText('Billed');
  // A cancelled order is off the board and out of the badge, as before.
  await expect(boardCard(page, 'cancelled')).toHaveCount(0);
});

test('an unknown or blank status lands in a visible Other column and names itself', async ({ page }) => {
  const orders = [po('draft'), po('back_ordered'), po(null), po('deleted')];
  await bootOps(page, { responses: { list_pos: { purchase_orders: orders } } });
  await openDispatch(page);

  const other = page.locator('#materialsKanban [data-po-col="other"]');
  await expect(other.locator('.kanban-col-header')).toHaveText('Other2');
  await expect(other.locator('.kanban-card[data-po-id="po-back_ordered"] .po-status-word')).toHaveText('Status: back ordered');
  await expect(other.locator('.kanban-card[data-po-id="po-blank"] .po-status-word')).toHaveText('Status: No status');
  // A soft-deleted order is not a purchase order any more; it stays off the board.
  await expect(boardCard(page, 'deleted')).toHaveCount(0);
  await expect(page.locator('#materialsCount')).toHaveText('3');
});

test('with no unknown order the board is the same six columns as before', async ({ page }) => {
  await bootOps(page, { responses: { list_pos: { purchase_orders: LEGACY_STATUSES.map((s) => po(s)) } } });
  await openDispatch(page);
  await expect(page.locator('#materialsKanban .kanban-col-header')).toHaveText([
    'Draft1', 'Approved1', 'Sent · Awaiting approval in Xero1', 'Quote asked1', 'Supplier confirmed · Approved in Xero1', 'Billed · Delivered1',
  ]);
  await expect(page.locator('#materialsKanban [data-po-col="other"]')).toHaveCount(0);
});

test('an empty board still draws its six columns', async ({ page }) => {
  await bootOps(page, { responses: { list_pos: { purchase_orders: [] } } });
  await openDispatch(page);
  await expect(page.locator('#materialsKanban .kanban-col-header')).toHaveText([
    'Draft0', 'Approved0', 'Sent · Awaiting approval in Xero0', 'Quote asked0', 'Supplier confirmed · Approved in Xero0', 'Billed · Delivered0',
  ]);
});

test('the status tick boxes hide a whole column and never hide Other', async ({ page }) => {
  const orders = KNOWN_STATUSES.map((s) => po(s)).concat([po('back_ordered')]);
  await bootOps(page, { responses: { list_pos: { purchase_orders: orders } } });
  await openDispatch(page);
  await expect(boardCard(page, 'sent')).toBeVisible();

  await page.locator('#matFilterToggle').click();
  await page.locator('.mat-status-cb[value="submitted"]').uncheck();

  await expect(boardCard(page, 'sent')).toHaveCount(0);
  await expect(boardCard(page, 'submitted')).toHaveCount(0);
  await expect(boardCard(page, 'confirmed')).toBeVisible();
  await expect(boardCard(page, 'back_ordered')).toBeVisible();
  await expect(page.locator('#materialsCount')).toHaveText(String(orders.length - 2));

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(boardCard(page, 'sent')).toBeVisible();
  await expect(page.locator('#materialsCount')).toHaveText(String(orders.length));
});

// The calendar window is today-forward. The delivery days are read from the
// page's own window at run time, so these fixtures cannot date-rot.
async function calendarDays(page) {
  return page.evaluate(() => {
    const range = getCalRange();
    return getCalDays(range).slice(0, 2);
  });
}

async function openCalendarCrewView(page) {
  await page.evaluate(() => { localStorage.setItem('sw_cal_view_mode', 'crew'); });
  await page.locator('.header-nav button[data-view="calendar"]').click();
  await expect(page.locator('#viewCalendar')).toHaveClass(/active/);
}

function deliveryBlock(page, status) {
  return page.locator(`#calendarBody .cal-delivery-block[data-po-id="po-${status || 'blank'}"]`);
}

test('an order in every status with a delivery day is on the Calendar Deliveries row', async ({ page }) => {
  const { bodies } = await bootOps(page);
  const [day0, day1] = await calendarDays(page);
  const dated = KNOWN_STATUSES.concat(['back_ordered']).map((s) => po(s, { delivery_date: day0 }));
  const orders = dated.concat([
    // No requested date: sits on the day the supplier confirmed.
    po('confirmed', { id: 'po-supplier-day', delivery_date: null, confirmed_delivery_date: day1 }),
    // No delivery day at all: nothing to put on the row.
    po('sent', { id: 'po-undated', delivery_date: null }),
    po('deleted', { delivery_date: day0 }),
    po('cancelled', { delivery_date: day0 }),
  ]);
  bodies.list_pos = { purchase_orders: orders };
  // What the calendar feed sends today: only draft / submitted / authorised.
  bodies.calendar = {
    events: [],
    deliveries: dated.filter((o) => ['draft', 'submitted', 'authorised'].includes(o.status))
      .map(({ id, po_number, supplier_name, delivery_date, status, total }) => ({ id, po_number, supplier_name, delivery_date, status, total })),
  };
  await openCalendarCrewView(page);

  for (const status of KNOWN_STATUSES.concat(['back_ordered'])) {
    const block = deliveryBlock(page, status);
    await expect(block, `${status} delivery`).toHaveCount(1);
    await expect(block).toBeVisible();
    await expect(block).toHaveText('Supplier ' + status);
  }
  await expect(page.locator('#calendarBody .cal-delivery-block[data-po-id="po-supplier-day"]')).toBeVisible();
  await expect(page.locator('#calendarBody .cal-delivery-block[data-po-id="po-undated"]')).toHaveCount(0);
  await expect(deliveryBlock(page, 'deleted')).toHaveCount(0);
  await expect(deliveryBlock(page, 'cancelled')).toHaveCount(0);
  // One block per order: an order in both the feed and the order list is not doubled.
  await expect(page.locator('#calendarBody .cal-delivery-block')).toHaveCount(dated.length + 1);

  // The tooltip names the status.
  await expect(deliveryBlock(page, 'sent')).toHaveAttribute('title', 'PO-sent — Supplier sent — Sent');
  await expect(deliveryBlock(page, 'confirmed')).toHaveAttribute('title', 'PO-confirmed — Supplier confirmed — Supplier confirmed');
  await expect(deliveryBlock(page, 'back_ordered')).toHaveAttribute('title', 'PO-back_ordered — Supplier back_ordered — back ordered');
});

test('the Deliveries row keeps the calendar feed rows when the order list cannot be read', async ({ page }) => {
  const { bodies, apiCalls } = await bootOps(page, { failures: { list_pos: 500 } });
  const [day0] = await calendarDays(page);
  bodies.calendar = {
    events: [],
    deliveries: [{ id: 'po-draft', po_number: 'PO-draft', supplier_name: 'Supplier draft', delivery_date: day0, status: 'draft', total: 100 }],
  };
  await openCalendarCrewView(page);
  await expect(deliveryBlock(page, 'draft')).toBeVisible();
  await expect.poll(() => apiCalls.includes('list_pos')).toBe(true);
  await expect(page.locator('#calendarBody .cal-delivery-block')).toHaveCount(1);
});

test('the Deliveries row drops an order that has left the order list', async ({ page }) => {
  const { bodies } = await bootOps(page);
  const [day0] = await calendarDays(page);
  bodies.list_pos = { purchase_orders: [po('sent', { delivery_date: day0 })] };
  bodies.calendar = { events: [], deliveries: [] };
  await openCalendarCrewView(page);
  await expect(deliveryBlock(page, 'sent')).toBeVisible();

  // The only dated order goes; the next calendar load must not keep its block.
  bodies.list_pos = { purchase_orders: [] };
  await page.locator('.header-nav button[data-view="jobs"]').click();
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  await page.locator('.header-nav button[data-view="calendar"]').click();
  await expect(page.locator('#viewCalendar')).toHaveClass(/active/);
  await expect(page.locator('#calendarBody .cal-delivery-block')).toHaveCount(0);
});

test('a failed order list read falls back to the fresh calendar feed, not the remembered list', async ({ page }) => {
  const failures = {};
  const { bodies } = await bootOps(page, { failures });
  const [day0] = await calendarDays(page);
  const order = po('draft', { delivery_date: day0 });
  bodies.list_pos = { purchase_orders: [order] };
  bodies.calendar = { events: [], deliveries: [order] };
  await openCalendarCrewView(page);
  await expect(deliveryBlock(page, 'draft')).toBeVisible();

  // The order is cancelled, so the feed drops it, and the order list read fails.
  bodies.calendar = { events: [], deliveries: [] };
  failures.list_pos = 500;
  await page.locator('.header-nav button[data-view="jobs"]').click();
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  await page.locator('.header-nav button[data-view="calendar"]').click();
  await expect(page.locator('#viewCalendar')).toHaveClass(/active/);
  await expect(page.locator('#calendarBody .cal-delivery-block')).toHaveCount(0);
});

async function openFinancialsPurchaseOrders(page) {
  await page.locator('.header-nav button[data-view="financials"]').click();
  await expect(page.locator('#viewFinancials')).toHaveClass(/active/);
  await page.locator('#viewFinancials .sub-tab[data-sub="pos"]').click();
}

function poChip(page, key) {
  return page.locator(`#subPos .filter-chip[data-po-status="${key}"]`);
}

function poRow(page, status) {
  return page.locator(`#poTableBody tr[data-po-id="po-${status}"]`);
}

test('Financials > Purchase Orders files a sent, confirmed or delivered order under its own chip', async ({ page }) => {
  const orders = KNOWN_STATUSES.map((s) => po(s));
  await bootOps(page, { responses: { list_pos: { purchase_orders: orders } } });
  await openFinancialsPurchaseOrders(page);
  await expect(page.locator('#poTableBody tr')).toHaveCount(orders.length);

  const chips = { draft: ['draft'], submitted: ['submitted', 'sent'], authorised: ['authorised', 'confirmed'], billed: ['billed', 'delivered'] };
  for (const [chip, statuses] of Object.entries(chips)) {
    await poChip(page, chip).click();
    await expect(page.locator('#poTableBody tr'), `${chip} chip`).toHaveCount(statuses.length);
    for (const status of statuses) await expect(poRow(page, status), `${status} under ${chip}`).toBeVisible();
  }

  // Each order reads with its own status word, not the stored one.
  await poChip(page, 'all').click();
  await expect(page.locator('#poTableBody tr')).toHaveCount(orders.length);
  await expect(poRow(page, 'sent').locator('.status-badge')).toHaveText('Sent');
  await expect(poRow(page, 'confirmed').locator('.status-badge')).toHaveText('Supplier confirmed');
  await expect(poRow(page, 'billed').locator('.status-badge')).toHaveText('Billed');
  await expect(poRow(page, 'delivered').locator('.status-badge')).toHaveText('Delivered');
});

test('a Financials chip marks only the chips, never a board card or a delivery block', async ({ page }) => {
  const { bodies } = await bootOps(page);
  const [day0] = await calendarDays(page);
  bodies.list_pos = { purchase_orders: [po('draft', { delivery_date: day0 })] };
  bodies.calendar = { events: [], deliveries: [] };
  await openDispatch(page);
  await expect(boardCard(page, 'draft')).toBeVisible();
  await openCalendarCrewView(page);
  await expect(deliveryBlock(page, 'draft')).toBeVisible();

  await openFinancialsPurchaseOrders(page);
  await poChip(page, 'draft').click();
  await expect(poChip(page, 'draft')).toHaveClass(/active/);
  await expect(poChip(page, 'all')).not.toHaveClass(/active/);
  await expect(boardCard(page, 'draft')).not.toHaveClass(/active/);
  await expect(deliveryBlock(page, 'draft')).not.toHaveClass(/active/);
});

test('a job material ordering card reads the state of a sent, confirmed or delivered order', async ({ page }) => {
  await bootOps(page);
  const job = { id: 'job-fence-1', type: 'fencing', scope_json: { gates: [{}] } };
  const stateOf = {
    draft: 'draft',
    approved: 'draft',
    quote_requested: 'quoted',
    submitted: 'sent',
    sent: 'sent',
    authorised: 'confirmed',
    confirmed: 'confirmed',
    billed: 'delivered',
    delivered: 'delivered',
  };
  const wordOf = {
    draft: 'Draft',
    approved: 'Approved',
    quote_requested: 'Quote asked',
    submitted: 'Awaiting approval in Xero',
    sent: 'Sent',
    authorised: 'Approved in Xero',
    confirmed: 'Supplier confirmed',
    billed: 'Billed',
    delivered: 'Delivered',
  };
  const gateCard = page.locator('#jdBuild .mat-order-card', { hasText: 'Gate Kits' });
  for (const [status, state] of Object.entries(stateOf)) {
    await page.evaluate(({ job, order }) => {
      document.getElementById('jdBuild').innerHTML = renderDispatchCards(job, [order]);
    }, { job, order: po(status, { line_items: [{ description: 'Gate kit' }] }) });
    await expect(gateCard, `${status} order`).toHaveAttribute('data-mat-state', state);
    await expect(gateCard).toContainText('PO-' + status);
    await expect(gateCard.locator('.status-badge'), `${status} badge`).toHaveText(wordOf[status]);
  }
  // A category with no order still reads as not ordered.
  await expect(page.locator('#jdBuild .mat-order-card', { hasText: 'Fixings' })).toHaveAttribute('data-mat-state', 'missing');
});

test('the job page flags a delivery tomorrow only when the order is not yet confirmed', async ({ page }) => {
  await bootOps(page);
  const flagged = await page.evaluate((statuses) => {
    // The alert's own "tomorrow", so the fixture cannot date-rot.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const day = tomorrow.toISOString().slice(0, 10);
    const out = {};
    statuses.forEach((status) => {
      const alerts = evaluateJobAlerts({
        job: { id: 'job-1', type: 'fencing', status: 'scheduled' },
        purchase_orders: [{ id: 'po-' + status, status, delivery_date: day, total: 0 }],
      });
      out[status] = alerts.some((a) => /Delivery tomorrow/.test(a.message));
    });
    return out;
  }, KNOWN_STATUSES);

  expect(flagged).toEqual({
    quote_requested: true,
    draft: true,
    approved: true,
    submitted: true,
    sent: true,
    authorised: false,
    confirmed: false,
    billed: false,
    delivered: false,
  });
});

test('the Gate Ledger counts a sent, confirmed or delivered order as materials ordered', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('sw_cap1b_enabled', '1'); });
  const { bodies } = await bootOps(page);
  const materialsRow = page.locator('#jdQvBody .cap1b-gate-ledger tr', { hasText: 'materials_ordered' });
  const expected = {
    draft: 'fail',
    approved: 'fail',
    quote_requested: 'fail',
    submitted: 'pass',
    sent: 'pass',
    authorised: 'pass',
    confirmed: 'pass',
    billed: 'pass',
    delivered: 'pass',
  };
  for (const [status, verdict] of Object.entries(expected)) {
    bodies.job_detail = {
      job: { id: 'job-' + status, type: 'fencing', status: 'scheduled', job_number: 'SWF-' + status, client_name: 'Fixture Client' },
      purchase_orders: [po(status)],
      assignments: [], work_orders: [], invoices: [], events: [], media: [], documents: [],
    };
    await page.evaluate((id) => openJobQuickView(id), 'job-' + status);
    await expect(page.locator('#jdQvTitle')).toContainText('SWF-' + status);
    await expect(materialsRow.locator('td').nth(1), `${status} order`).toHaveText(verdict);
    if (verdict === 'pass') await expect(materialsRow).not.toContainText('none sent yet');
    else await expect(materialsRow).toContainText('none sent yet');
  }
});

// <po-board-active-jobs> (Shaun, 26 Oct 2026): the Dispatch board shows only
// orders on jobs still being worked. Financials still lists every order.
test('the Dispatch board keeps orders on finished jobs, or with no job, off it; Financials still lists them', async ({ page }) => {
  const orders = [
    po('draft', { id: 'po-live', job_number: 'SWF-920100' }),
    po('draft', { id: 'po-archived', po_number: 'PO-683376', job_id: 'job-done', job_number: 'SWF-26824', job_status: 'archived' }),
    po('sent', { id: 'po-complete', job_id: 'job-complete', job_status: 'complete' }),
    po('authorised', { id: 'po-nojob', job_id: null, job_status: null }),
    // An older list_pos with no job_status: the order still shows.
    po('confirmed', { id: 'po-oldapi', job_status: undefined }),
    po('cancelled', { id: 'po-cancelled', job_status: 'archived' }),
  ];
  await bootOps(page, { responses: { list_pos: { purchase_orders: orders } } });
  await openDispatch(page);
  await expect(page.locator('#materialsKanban .kanban-card')).toHaveCount(2);
  await expect(page.locator('#materialsKanban .kanban-card[data-po-id="po-live"]')).toBeVisible();
  await expect(page.locator('#materialsKanban .kanban-card[data-po-id="po-oldapi"]')).toBeVisible();
  await expect(page.locator('#materialsCount')).toHaveText('2');
  // The cancelled order is off the board anyway, so it is not counted as hidden.
  await expect(page.locator('#matHiddenNote')).toHaveText('3 orders are on a finished job or no job. They are not shown here. Financials > Purchase Orders lists every order. Show them');
  await page.locator('#matFilterToggle').click();
  await expect(page.locator('#matFilterJob option')).toHaveText(['All Jobs', /^SWF-920100/]);

  // Show them puts the hidden orders back (Delete PO and Mark Paid live only
  // on this board); Hide them takes them off again.
  await page.locator('[data-mat-show-finished]').click();
  await expect(page.locator('#materialsKanban .kanban-card')).toHaveCount(5);
  await expect(page.locator('#materialsKanban .kanban-card[data-po-id="po-archived"]')).toBeVisible();
  await expect(page.locator('#materialsCount')).toHaveText('5');
  await expect(page.locator('#matHiddenNote')).toHaveText('3 orders are on a finished job or no job. They are shown below. Hide them');
  await page.locator('[data-mat-show-finished]').click();
  await expect(page.locator('#materialsKanban .kanban-card')).toHaveCount(2);

  await page.locator('.header-nav button[data-view="financials"]').click();
  await expect(page.locator('#viewFinancials')).toHaveClass(/active/);
  await page.locator('#viewFinancials .sub-tab[data-sub="pos"]').click();
  await expect(page.locator('#poTableBody tr[data-po-id="po-archived"]')).toBeVisible();
  await expect(page.locator('#poTableBody tr[data-po-id="po-nojob"]')).toBeVisible();
});

test('with every order on an active job there is no hidden-orders line', async ({ page }) => {
  await bootOps(page, { responses: { list_pos: { purchase_orders: [po('draft'), po('sent')] } } });
  await openDispatch(page);
  await expect(page.locator('#materialsKanban .kanban-card')).toHaveCount(2);
  await expect(page.locator('#matHiddenNote')).toBeHidden();
});
