const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

async function openCombinedHost(page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !local) return route.abort();
    return route.continue();
  });
  await page.goto('/ops.html#sales');
  await page.waitForFunction(() => window.OpsSalesHost && window.SalesBooking && window.SalesPerformance);
  await revealOpsStaticFixture(page);
  await page.evaluate(() => {
    const identity = { id: 'fixture-operator', org_id: 'fixture-org' };
    window.SW_AUTH_GATE.identity = () => identity;
    window.dispatchEvent(new CustomEvent('sw:auth-identity', { detail: identity }));
    window.SALES_BOOKING_PREVIEW_URL = 'http://127.0.0.1:4174/sales-booking-read';
    window.SALES_PERFORMANCE_PREVIEW_URL = 'http://127.0.0.1:4174/sales-performance-read';
    window.opsPost = async (action, body) => {
      if (action === 'workflow_refresh') {
        if (['claim', 'consume', 'finish'].includes(body && body.op)) throw new Error('operators may request or read a run, not claim or finish it');
        return { outcome: 'unavailable', reason: 'driver_not_registered', declared_output: 'dispatch_refresh/v1' };
      }
      throw new Error('unexpected write: ' + action);
    };
    window.opsFetch = async (action) => {
      if (action === 'sales_performance_read') {
        return {
          ok: true,
          unpublished: true,
          storage_provenance: null,
          rows: [],
          week_starts: [],
          available_weeks: [],
          week_start: null,
          fetched_at: '2026-09-13T03:10:38.718631Z'
        };
      }
      if (action === 'sales_booking_read') {
        return { ok: false, error: 'Authenticated Booking handler is Patio-owned. 4174/4175 JSON preview is not connected.' };
      }
      if (action === 'dispatch_list') return { jobs: [], coverage: { complete: true } };
      if (action === 'dispatch_calendar') return { events: [], undated: [], coverage: { complete: true } };
      if (action === 'dispatch_workflow') return { workflow: 'dispatch', worker: { intended_enabled: false, observed_enabled: false } };
      throw new Error('unexpected read: ' + action);
    };
  });
}

test('combined Sales host mounts Booking and unpublished Performance without preview ports', async ({ page }) => {
  await openCombinedHost(page);
  await page.evaluate(() => window.showView('sales'));
  await expect(page.locator('#salesPerformanceRoot')).toBeVisible();
  await expect(page.locator('#salesPerformanceHostNotice')).toContainText('not deployed');
  const preview = await page.evaluate(() => ({
    booking: window.SALES_BOOKING_PREVIEW_URL,
    performance: window.SALES_PERFORMANCE_PREVIEW_URL
  }));
  expect(preview.booking).toBeFalsy();
  expect(preview.performance).toBeFalsy();

  await page.locator('[data-sales-sub="booking"]').click();
  await expect(page.locator('#salesBookingRoot')).toBeVisible();
  await expect(page.locator('#salesBookingHostNotice')).toContainText('4174/4175');
  await expect(page.locator('#salesBookingRoot')).toContainText(/4174\/4175 JSON preview is not connected|Authenticated/);
});

test('Dispatch Workflow Refresh stays unavailable and does not claim a lease', async ({ page }) => {
  await openCombinedHost(page);
  await page.evaluate(async () => {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById('viewDispatch').classList.add('active');
    if (window.DispatchOps) await window.DispatchOps.load();
  });
  const refresh = page.locator('[data-action="workflow-refresh"]');
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(page.locator('[data-workflow-refresh="dispatch"]')).toContainText(/unavailable|driver_not_registered|pending/i);
});
