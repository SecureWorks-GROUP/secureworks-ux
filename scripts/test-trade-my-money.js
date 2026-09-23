#!/usr/bin/env node
// 2026-09-08 — My money (earned / paid / owed / super) for the trade app.
// Runs the shipped // <trade-my-money> block from trade.html.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
const startMark = '// <trade-my-money>';
const endMark = '// </trade-my-money>';
const start = html.indexOf(startMark);
const end = html.indexOf(endMark, start + startMark.length);
assert(start !== -1 && end !== -1 && end > start, 'trade-my-money sentinels exist');
const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end + endMark.length), context);
const M = context.MyMoneyCore;
assert(M, 'MyMoneyCore exported');

let passed = 0;
function check(name, cond) { assert(cond, name); passed += 1; }

check('money formats thousands and cents', M.money(2420.6) === '$2,420.60' && M.money(0) === '$0.00' && M.money(-15) === '-$15.00' && M.money('nope') === '$0.00');
check('dateShort is day Mon year', M.dateShort('2026-08-10') === '10 Aug 2026' && M.dateShort('') === '');

const captain = M.resolveSuperSplit({ gross_earned: 1000, super_rate: 0.12 });
check('captain $1000: fund still 12%', captain.super_amount === 120);
check('captain $1000: worker withhold is half the rate', captain.worker_withhold === 60);
check('captain $1000: company contribution is the remainder', captain.company_contribution === 60);
check('captain $1000: cash is $940', captain.amount_payable === 940);

// Exact money shape ops-api returns since secureworks-backend #865
// (trade_invoice_money.ts tradeInvoiceMoneyResponse).
const backend865 = M.resolveSuperSplit({
  gst_on: false, super_rate: 0.12, super_amount: 120, gross_earned: 1000, net_pay: 940,
  gst: 0, trade_payable: 940, total_inc: 1000, submitted_total: 1000, amount_payable: 940,
  worker_withhold: 60, company_contribution: 60, company_total_out: 1060
});
check('backend #865 shape: 1000 -> 120/60/60/940',
  backend865.super_amount === 120 && backend865.worker_withhold === 60 &&
  backend865.company_contribution === 60 && backend865.amount_payable === 940 &&
  backend865.legacy_full_carve_out === false);

// A backend that computes a different split must reach the screen, not the
// gross * rate / 2 derivation.
const backendOther = M.resolveSuperSplit({
  gross_earned: 1000, super_rate: 0.12, super_amount: 120, net_pay: 950,
  amount_payable: 950, worker_withhold: 50, company_contribution: 70
});
check('backend worker_withhold wins over derivation', backendOther.worker_withhold === 50);
check('backend company_contribution wins over derivation', backendOther.company_contribution === 70);
check('backend amount_payable wins over derivation', backendOther.amount_payable === 950);
const netOnly = M.resolveSuperSplit({ gross_earned: 1000, super_rate: 0.12, super_amount: 120, net_pay: 950 });
check('persisted new-contract net_pay alone is cash, withhold follows it', netOnly.amount_payable === 950 && netOnly.worker_withhold === 50 && netOnly.company_contribution === 70);

const unmigrated = M.resolveSuperSplit({ gross_earned: 1000, super_rate: 0.12, super_amount: 120, net_pay: 880 });
check('legacy net_pay (gross minus full super) is refused as cash', unmigrated.amount_payable === 940 && unmigrated.net_pay === 880 && unmigrated.legacy_full_carve_out === true);
check('legacy row still shows 12% to the fund, 6/6 split', unmigrated.super_amount === 120 && unmigrated.worker_withhold === 60 && unmigrated.company_contribution === 60);
const legacyDerived = M.resolveSuperSplit({ gross_earned: 1000, super_rate: 0.12, super_amount: 120, net_pay: 880, worker_withhold: 120, company_contribution: 0 });
check('legacy full-fund worker_withhold is refused too', legacyDerived.worker_withhold === 60 && legacyDerived.company_contribution === 60 && legacyDerived.amount_payable === 940);
const legacyNoRate = M.resolveSuperSplit({ gross_earned: 1000, super_amount: 120, net_pay: 880 });
check('legacy guard fires without a rate (halves the fund)', legacyNoRate.worker_withhold === 60 && legacyNoRate.amount_payable === 940);

const migratedNet = M.resolveSuperSplit({ gross_earned: 1000, super_rate: 0.12, super_amount: 120, net_pay: 940 });
check('new-contract net_pay at gross minus 6% is kept as cash', migratedNet.amount_payable === 940 && migratedNet.legacy_full_carve_out === false);
const zeroFund = M.resolveSuperSplit({ gross_earned: 1000, super_amount: 0, net_pay: 1000 });
check('guard does not misfire when fund is zero', zeroFund.legacy_full_carve_out === false && zeroFund.amount_payable === 1000);

const period = M.periodHTML('This month', { invoices: 1, gross_earned: 1000, super_amount: 120, paid_total: 0, outstanding: 940 });
check('My money period line reads 120 / 60 / 60 / 940', period.indexOf('Super $120.00 to your fund &middot; $60.00 from you &middot; company covers $60.00') !== -1 && period.indexOf('You get $940.00') !== -1);

check('status: paid names the day', M.statusOf({ paid: true, paid_at: '2026-08-10' }).label === 'Paid 10 Aug 2026');
check('status: PAID bill without our flag is still paid', M.statusOf({ xero_bill_status: 'PAID' }).cls === 'paid');
check('status: authorised bill is approved awaiting payment', M.statusOf({ status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED' }).label === 'Approved, awaiting payment');
check('status: voided', M.statusOf({ xero_bill_status: 'VOIDED' }).label === 'Voided');
check('status: draft / review / waiting on office', M.statusOf({ status: 'draft' }).label === 'Draft' && M.statusOf({ status: 'pending_ops_review' }).label === 'Under review' && M.statusOf({ status: 'pushed_to_xero', xero_bill_status: 'DRAFT' }).label === 'Waiting on office');
check('status: part paid', M.statusOf({ status: 'pushed_to_xero', amount_paid: 100, outstanding: 50 }).label === 'Part paid');

const profileOn = M.profileHTML({ name: 'Hugo', abn: '36 332 272 781', gst_registered: true });
check('profile shows ABN and GST registered', profileOn.indexOf('ABN 36 332 272 781') !== -1 && /data-mm-gst="on"/.test(profileOn));
check('profile without GST says so', /Not GST registered/.test(M.profileHTML({ name: 'Isaac', gst_registered: false })));
check('profile escapes', M.profileHTML({ name: '<b>' }).indexOf('&lt;b&gt;') !== -1);

const t = { invoices: 2, gross_earned: 3470, super_amount: 416.4, gst: 347, payable: 3400.6, paid_total: 2420.6, outstanding: 980, figures_incomplete: 1 };
const card = M.periodHTML('FY 2026/27 to date', t, { key: 'fytd' });
check('period card shows earned, paid, owed', card.indexOf('$3,470.00') !== -1 && card.indexOf('$2,420.60') !== -1 && card.indexOf('$980.00') !== -1);
check('period card shows super and GST', card.indexOf('Super $416.40') !== -1 && card.indexOf('GST $347.00') !== -1);
check('period card names the 6/6 split and cash', card.indexOf('$208.20 from you') !== -1 && card.indexOf('company covers $208.20') !== -1 && card.indexOf('You get $3,261.80') !== -1);
check('period card does not show the old full-super payable as cash', card.indexOf('$3,400.60') === -1);
check('period card flags incomplete legacy rows', card.indexOf('1 older invoice without a super split') !== -1);
check('period card without GST omits it', M.periodHTML('x', { gst: 0 }, {}).indexOf('GST') === -1);

const months = M.monthsHTML([{ month: '2026-09', label: 'Sep 2026', gross_earned: 1000, super_amount: 120, paid_total: 0, outstanding: 980 }, { month: '2026-08', label: 'Aug 2026', gross_earned: 2470, super_amount: 296.4, paid_total: 2420.6, outstanding: 0 }]);
check('months table has one row per month with owed highlighted', (months.match(/data-mm-month=/g) || []).length === 2 && /class="owed">\$980\.00/.test(months));
check('months super column is the fund amount, not the worker deduction', months.indexOf('Super to fund') !== -1);
check('no months means no table', M.monthsHTML([]) === '');

const row = M.invoiceRowHTML({ id: 'i1', invoice_number: 'SW-INV-H-260801-020', week_end: '2026-08-02', status: 'paid', paid: true, paid_at: '2026-08-10', payable: 2420.6, figures_ok: true });
check('invoice row: week, number, amount, paid', row.indexOf('Week ending 2 Aug 2026') !== -1 && row.indexOf('SW-INV-H-260801-020') !== -1 && row.indexOf('$2,420.60') !== -1 && /data-mm-status="paid"/.test(row));
check('invoice row opens detail; a draft opens the draft', row.indexOf("viewInvoiceDetail('i1')") !== -1 && M.invoiceRowHTML({ id: 'd', status: 'draft' }).indexOf("openInvoiceDraft('d')") !== -1);
check('invoice row: figures unavailable when nothing is known', M.invoiceRowHTML({ id: 'x', figures_ok: false, trade_payable: null, total_inc: null }).indexOf('Figures unavailable') !== -1);
check('invoice row: not counted marker', M.invoiceRowHTML({ id: 'v', counts: false, xero_bill_status: 'VOIDED' }).indexOf('(not counted)') !== -1);

const view = M.viewHTML({ profile: { name: 'Hugo', abn: '1', gst_registered: true }, fy_label: 'FY 2026/27', month: { label: 'Sep 2026', invoices: 1, gross_earned: 1000, super_amount: 120, gst: 100, payable: 980, paid_total: 0, outstanding: 980 }, fytd: t, months: [], invoices: [{ id: 'i1', status: 'paid', paid: true, payable: 10 }] });
check('view has header, both period cards and the list', view.indexOf('My money') !== -1 && /data-mm-period="month"/.test(view) && /data-mm-period="fytd"/.test(view) && /data-mm-invoice="i1"/.test(view));
check('view explains where paid comes from', view.indexOf('comes from Xero') !== -1);
check('footer names the half-super ruling', view.indexOf('Half of that comes out of what you earned') !== -1 && view.indexOf('the company covers the other half') !== -1);
check('footer no longer says super comes out in full', view.indexOf('Super is paid to your fund separately and is shown so the numbers add up') === -1);
check('empty view is honest', M.viewHTML({ invoices: [] }).indexOf('No invoices yet') !== -1);
check('no em dash, no old brand', view.indexOf('—') === -1 && view.indexOf('SecureWorks WA') === -1);


// ── Live audit 2026-09-23 (anonymised shapes of real trade_invoices rows) ──
// Every status combination found in production, and what the trade must see.
const liveStatuses = [
  [{ status: 'paid', xero_bill_status: 'PAID', paid: true, paid_at: '2026-09-04T02:00:00Z' }, 'Paid 4 Sep 2026', 'paid'],
  [{ status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED', amount_paid: 0 }, 'Approved, awaiting payment', 'owed'],
  [{ status: 'pushed_to_xero', xero_bill_status: 'DRAFT', amount_paid: 0 }, 'Waiting on office', 'sent'],
  [{ status: 'pending_acknowledgment', xero_bill_status: null }, 'Waiting on office', 'sent'],
  [{ status: 'approved', xero_bill_status: null }, 'Waiting on office', 'sent'],
  [{ status: 'pushed_to_xero', xero_bill_status: 'DELETED' }, 'Voided', 'void'],
  [{ status: 'pushed_to_xero', xero_bill_status: 'VOIDED' }, 'Voided', 'void'],
  [{ status: 'approved', xero_bill_status: 'DELETED' }, 'Voided', 'void'],
  [{ status: 'ops-reject', xero_bill_status: null }, 'Not accepted', 'void'],
  // Xero keeps a part-paid bill AUTHORISED; 2 live rows had amount_paid > 0.
  [{ status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED', amount_paid: 1718.58 }, 'Part paid', 'owed'],
];
liveStatuses.forEach(function (c) {
  const got = M.statusOf(c[0]);
  check('live status ' + JSON.stringify(c[0]) + ' -> ' + c[1], got.label === c[1] && got.cls === c[2]);
});

// Paid: Xero's amount_paid is the headline, the invoiced figure sits beside it
// when they differ (55 live paid rows: e.g. GST-on bill paid ex-GST).
const paidEx = M.amountOf({ status: 'paid', xero_bill_status: 'PAID', paid: true, amount_paid: 1556, payable: 1711.6 });
check('paid row shows what Xero paid, with the invoiced figure', paidEx.main === '$1,556.00' && paidEx.sub === 'Invoiced $1,711.60');
const paidSame = M.amountOf({ status: 'paid', paid: true, amount_paid: 2420.6, payable: 2420.6 });
check('paid row with matching figures shows one amount', paidSame.main === '$2,420.60' && paidSame.sub === '');
const partPaid = M.amountOf({ status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED', amount_paid: 1718.58, payable: 1916.4 });
check('part paid shows what is still owed and what was paid', partPaid.main === '$197.82 owed' && partPaid.sub === 'Paid $1,718.58 of $1,916.40');
check('unpaid shows payable', M.amountOf({ status: 'pushed_to_xero', xero_bill_status: 'DRAFT', payable: 980 }).main === '$980.00');
check('nothing known stays unavailable', M.amountOf({ status: 'pushed_to_xero', payable: null }).main === 'Figures unavailable');
const partRow = M.invoiceRowHTML({ id: 'pp', status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED', amount_paid: 1718.58, payable: 1916.4, outstanding: 197.82, figures_ok: false, total_inc: 1916.4 });
check('part paid row renders owed, paid detail, and part paid pill', partRow.indexOf('$197.82 owed') !== -1 && partRow.indexOf('Paid $1,718.58 of $1,916.40') !== -1 && partRow.indexOf('Part paid') !== -1);

// Totals: all-time card (backend sends all_time; pre-July invoices were only in
// the month table), and the incomplete-split note names what it leaves out.
const allView = M.viewHTML({ fy_label: 'FY 2026/27', month: {}, fytd: {}, all_time: { invoices: 30, gross_earned: 2400, super_amount: 288, payable: 30000, paid_total: 27000, outstanding: 1200, figures_incomplete: 27 }, months: [], invoices: [] });
check('view shows an all-time card', /data-mm-period="all"/.test(allView) && allView.indexOf('All time') !== -1 && allView.indexOf('$27,000.00') !== -1);
check('incomplete note says earned/super leave old invoices out, paid/owed count them', allView.indexOf('27 older invoices without a super split. Earned and super leave them out; paid and still owed count them.') !== -1);
check('view without all_time has no all-time card', !/data-mm-period="all"/.test(M.viewHTML({ invoices: [] })));

function extractFunction(name) {
  const marker = 'function ' + name;
  const start = html.indexOf(marker);
  assert(start !== -1, name + ' exists');
  const next = html.indexOf('\n  function ', start + marker.length);
  return html.slice(start, next === -1 ? html.length : next);
}

context.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
};
vm.runInContext([
  extractFunction('_invoiceBool'),
  extractFunction('_invoiceSuperRate'),
  extractFunction('_invoiceHasPersistedNumber'),
  extractFunction('_invoicePersistedMoney'),
  extractFunction('_invoiceHistoryMoneyRow'),
  extractFunction('_invoiceDetailStatusHtml')
].join('\n'), context);

const detailDeleted = context._invoiceDetailStatusHtml({ status: 'pushed_to_xero', xero_bill_status: 'DELETED' });
check('detail pill: deleted Xero bill is Voided', detailDeleted.indexOf('Voided') !== -1 && !/pushed to xero/i.test(detailDeleted) && /data-inv-status="void"/.test(detailDeleted));
const detailApprovedDeleted = context._invoiceDetailStatusHtml({ status: 'approved', xero_bill_status: 'DELETED' });
check('detail pill: approved row with deleted bill is Voided', detailApprovedDeleted.indexOf('Voided') !== -1 && !/approved/i.test(detailApprovedDeleted));
const detailPartPaid = context._invoiceDetailStatusHtml({ status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED', amount_paid: 1718.58 });
check('detail pill: authorised part-paid bill is Part paid', detailPartPaid.indexOf('Part paid') !== -1 && !/pushed to xero/i.test(detailPartPaid) && /data-inv-status="owed"/.test(detailPartPaid));
const detailWeeklyDeleted = context._invoiceDetailStatusHtml({ invoice_source: 'weekly_work_order', status: 'pushed_to_xero', xero_bill_status: 'DELETED', to_be_paid: 1916.4 });
check('detail pill: weekly deleted bill is Voided', detailWeeklyDeleted.indexOf('Voided') !== -1 && !/pushed to xero/i.test(detailWeeklyDeleted));

console.log('trade-my-money: ' + passed + ' checks passed');
