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
//  - an order in every status the back end allows is on the board, in the column
//    an ops person expects, and an unknown or blank status lands in "Other";
//  - the six columns look as they did when no cancelled or unknown order exists;
//  - the status tick boxes work by column and can never hide "Other";
//  - an order in every status with a delivery day is on the Calendar's Deliveries
//    row, and the row still shows the feed's own rows if the order list fails.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

// Every status purchase_orders_status_check allows, except the soft-delete
// marker `deleted` (list_pos filters it out), and the board column each sits in.
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
  cancelled: 'cancelled',
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
    created_at: now,
    updated_at: now,
  }, extra);
}

async function bootOps(page, { responses = {}, failures = {} } = {}) {
  const apiCalls = [];
  const bodies = Object.assign({ pipeline: { columns: {} } }, responses);
  await installOpsSessionStub(page);
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
  const orders = KNOWN_STATUSES.map((s) => po(s));
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
    'Draft1', 'Approved1', 'Sent2', 'Quoted1', 'Confirmed2', 'Delivered2', 'Cancelled1',
  ]);
  // A sent order reads as Sent on its card, not as a draft.
  await expect(boardCard(page, 'sent')).toContainText('Sent');
  await expect(boardCard(page, 'confirmed')).toContainText('Confirmed');
  await expect(boardCard(page, 'delivered')).toContainText('Delivered');
  // A cancelled order says so and is not chased for a supplier invoice.
  await expect(boardCard(page, 'cancelled').locator('.po-status-word')).toHaveText('Status: Cancelled');
  await expect(boardCard(page, 'cancelled')).not.toContainText('Awaiting invoice');
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

test('with no cancelled or unknown order the board is the same six columns as before', async ({ page }) => {
  await bootOps(page, { responses: { list_pos: { purchase_orders: LEGACY_STATUSES.map((s) => po(s)) } } });
  await openDispatch(page);
  await expect(page.locator('#materialsKanban .kanban-col-header')).toHaveText([
    'Draft1', 'Approved1', 'Sent1', 'Quoted1', 'Confirmed1', 'Delivered1',
  ]);
  await expect(page.locator('#materialsKanban [data-po-col="cancelled"]')).toHaveCount(0);
  await expect(page.locator('#materialsKanban [data-po-col="other"]')).toHaveCount(0);
});

test('an empty board still draws its six columns', async ({ page }) => {
  await bootOps(page, { responses: { list_pos: { purchase_orders: [] } } });
  await openDispatch(page);
  await expect(page.locator('#materialsKanban .kanban-col-header')).toHaveText([
    'Draft0', 'Approved0', 'Sent0', 'Quoted0', 'Confirmed0', 'Delivered0',
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
  await expect(boardCard(page, 'cancelled')).toBeVisible();
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
  // One block per order: an order in both the feed and the order list is not doubled.
  await expect(page.locator('#calendarBody .cal-delivery-block')).toHaveCount(dated.length + 1);

  // The tooltip names the status; a cancelled order is struck through.
  await expect(deliveryBlock(page, 'sent')).toHaveAttribute('title', 'PO-sent — Supplier sent — Sent');
  await expect(deliveryBlock(page, 'confirmed')).toHaveAttribute('title', 'PO-confirmed — Supplier confirmed — Confirmed');
  await expect(deliveryBlock(page, 'back_ordered')).toHaveAttribute('title', 'PO-back_ordered — Supplier back_ordered — back ordered');
  await expect(deliveryBlock(page, 'cancelled')).toHaveClass(/cancelled/);
  await expect(deliveryBlock(page, 'sent')).not.toHaveClass(/cancelled/);
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
