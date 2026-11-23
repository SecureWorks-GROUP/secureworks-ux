// 2026-11-20 — a new restoration job waits undated; the trade books the visit
// from the job (ops-api book_restoration_visit) once he has called the client.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const JOB = 'e2e-resto-book';

function detail(state, family) {
  return {
    access_tier: 'allocated',
    job: { id: JOB, job_number: 'SWRESTO-260001', type: 'makesafe', status: 'new', client_name: 'Test Client', site_address: '1 Test Street', site_suburb: 'Testville', metadata: { makesafe_job_family: family } },
    crew: [
      { id: 'asn-1', user_id: 'e2e-installer', users: { id: 'e2e-installer', name: 'E2E Installer' }, status: 'scheduled', scheduled_date: state.booked || null },
      { id: 'asn-2', user_id: 'e2e-other', users: { id: 'e2e-other', name: 'Marnin' }, status: 'scheduled', scheduled_date: state.booked || null },
    ],
    purchaseOrders: [], notes: [], media: [], documents: [],
    makesafe_details: { makesafe_type: 'Restoration', substatus: 'waiting_on_trade_report', cycle_number: 1 },
    serviceReport: null,
  };
}

function wire(page, state, family = 'restoration') {
  return page.route(`${OPS_API}**`, async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (action === 'trade_job_detail') return json(detail(state, family));
    if (action === 'book_restoration_visit') {
      const body = req.postDataJSON();
      state.log.push(body);
      state.booked = body.date;
      return json({ ok: true, job_number: 'SWRESTO-260001', date: body.date, start_time: body.start_time || null, bookings: [] });
    }
    await route.fallback();
  });
}

test.describe('Trade app: book the first visit on a restoration job', () => {
  test.use({ persona: 'installer' });

  test('an undated restoration booking shows Book the visit, and booking sends the date and time', async ({ appPage: page }) => {
    const state = { log: [], booked: null };
    await wire(page, state);
    await signIn(page, PERSONAS.installer);
    await page.evaluate((jobId) => window.openJobReport(jobId, 'asn-1'), JOB);
    const card = page.locator('[data-restoration-book]');
    await expect(card).toBeVisible();
    await card.locator('#restoBookBtn').click();
    await expect(card).toContainText('Pick the date');
    expect(state.log.length).toBe(0);
    const day = await page.evaluate(() => {
      const d = new Date(Date.now() + 3 * 86400000);
      return d.toISOString().slice(0, 10);
    });
    await card.locator('#restoBookDate').fill(day);
    await card.locator('#restoBookTime').fill('08:00');
    await card.locator('#restoBookBtn').click();
    await expect.poll(() => state.log.length).toBe(1);
    expect(state.log[0]).toEqual({ job_id: JOB, date: day, start_time: '08:00' });
    // Reloaded from the server: the booking is dated, so the card is gone.
    await expect(page.locator('[data-restoration-book]')).toHaveCount(0);
  });

  test('a make-safe that is not restoration never shows the booking card', async ({ appPage: page }) => {
    const state = { log: [], booked: null };
    await wire(page, state, '');
    await signIn(page, PERSONAS.installer);
    await page.evaluate((jobId) => window.openJobReport(jobId, 'asn-1'), JOB);
    await expect(page.locator('#makesafeReportDirectContent')).toBeVisible();
    await expect(page.locator('[data-restoration-book]')).toHaveCount(0);
  });
});
