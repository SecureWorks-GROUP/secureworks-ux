// Made-up receipt week for the narrow UI check and offline WebKit picture.
async function setupReceiptWeek(page, { enabled = true } = {}) {
  await page.waitForFunction(() => Boolean(window.__crewDemo) && Boolean(document.querySelector('.appbar')));
  await page.evaluate(async ({ enabled }) => {
    const { db, ops } = window.__crewDemo;
    db.flags.reimbursements = enabled;
    db.me.name = 'Crew member';
    const store = await import('/crew/js/lib/store.js');
    store.setState({ user: { ...store.getState().user, name: 'Crew member' } });
    db.rate = 70;
    const a = db.assignments.find((r) => r.user_id === db.me.id);
    const j = db.job(a.job_id);
    Object.assign(j, { job_number: 'ZZTEST-1', site_suburb: 'ZZTEST', client_name: 'Client', site_address: '' });
    Object.assign(a, { scheduled_date: '2026-11-09', invoice_mode: 'hourly' });
    const myHours = ops.my_hours;
    ops.my_hours = (p) => {
      const r = myHours(p);
      const card = r.assignments.find((r) => r.id === a.id);
      Object.assign(card, { invoice_mode: 'hourly', can_claim_commission: false, logged_time_entry: { work_date: '2026-11-09', start_time: '07:00', finish_time: '15:00', break_minutes: 0 } });
      return { ...r, assignments: [card], group_route_jobs: [], recurring_deduction_week: null };
    };
    db.expenses = [{ id: 'receipt-zztest', submitted_by: db.me.id, vendor_name: 'Supplier', receipt_date: '2026-11-09', total_amount: 80,
      status: 'pending', payment_method: 'personal_card', receipt_storage_path: 'demo-receipt', job_id: j.id, created_at: '2026-11-09T01:00:00Z' },
    { id: 'receipt-no-photo', submitted_by: db.me.id, vendor_name: 'No photo', receipt_date: '2026-11-09', total_amount: 12,
      status: 'pending', payment_method: 'personal_card', job_id: j.id, created_at: '2026-11-09T01:00:00Z' }];
    const generate = ops.generate_trade_invoice;
    ops.generate_trade_invoice = (p, b) => { db.receiptSubmitBody = b; return generate(p, b); };
    // Let the profile update finish before the hash router changes screens.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    location.hash = '#/pay/week/2026-11-09/invoice';
  }, { enabled });
}
module.exports = { setupReceiptWeek };
