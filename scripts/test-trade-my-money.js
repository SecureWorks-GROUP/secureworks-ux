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

check('status: paid names the day', M.statusOf({ paid: true, paid_at: '2026-08-10' }).label === 'Paid 10 Aug 2026');
check('status: PAID bill without our flag is still paid', M.statusOf({ xero_bill_status: 'PAID' }).cls === 'paid');
check('status: authorised bill is approved awaiting payment', M.statusOf({ status: 'pushed_to_xero', xero_bill_status: 'AUTHORISED' }).label === 'Approved, awaiting payment');
check('status: voided', M.statusOf({ xero_bill_status: 'VOIDED' }).label === 'Voided');
check('status: draft / review / with office', M.statusOf({ status: 'draft' }).label === 'Draft' && M.statusOf({ status: 'pending_ops_review' }).label === 'Under review' && M.statusOf({ status: 'pushed_to_xero', xero_bill_status: 'DRAFT' }).label === 'With the office');
check('status: part paid', M.statusOf({ status: 'pushed_to_xero', amount_paid: 100, outstanding: 50 }).label === 'Part paid');

const profileOn = M.profileHTML({ name: 'Hugo', abn: '36 332 272 781', gst_registered: true });
check('profile shows ABN and GST registered', profileOn.indexOf('ABN 36 332 272 781') !== -1 && /data-mm-gst="on"/.test(profileOn));
check('profile without GST says so', /Not GST registered/.test(M.profileHTML({ name: 'Isaac', gst_registered: false })));
check('profile escapes', M.profileHTML({ name: '<b>' }).indexOf('&lt;b&gt;') !== -1);

const t = { invoices: 2, gross_earned: 3470, super_amount: 416.4, gst: 347, payable: 3400.6, paid_total: 2420.6, outstanding: 980, figures_incomplete: 1 };
const card = M.periodHTML('FY 2026/27 to date', t, { key: 'fytd' });
check('period card shows earned, paid, owed', card.indexOf('$3,470.00') !== -1 && card.indexOf('$2,420.60') !== -1 && card.indexOf('$980.00') !== -1);
check('period card shows super and GST', card.indexOf('Super $416.40') !== -1 && card.indexOf('GST $347.00') !== -1);
check('period card flags incomplete legacy rows', card.indexOf('1 older invoice without a super split') !== -1);
check('period card without GST omits it', M.periodHTML('x', { gst: 0 }, {}).indexOf('GST') === -1);

const months = M.monthsHTML([{ month: '2026-09', label: 'Sep 2026', gross_earned: 1000, super_amount: 120, paid_total: 0, outstanding: 980 }, { month: '2026-08', label: 'Aug 2026', gross_earned: 2470, super_amount: 296.4, paid_total: 2420.6, outstanding: 0 }]);
check('months table has one row per month with owed highlighted', (months.match(/data-mm-month=/g) || []).length === 2 && /class="owed">\$980\.00/.test(months));
check('no months means no table', M.monthsHTML([]) === '');

const row = M.invoiceRowHTML({ id: 'i1', invoice_number: 'SW-INV-H-260801-020', week_end: '2026-08-02', status: 'paid', paid: true, paid_at: '2026-08-10', payable: 2420.6, figures_ok: true });
check('invoice row: week, number, amount, paid', row.indexOf('Week ending 2 Aug 2026') !== -1 && row.indexOf('SW-INV-H-260801-020') !== -1 && row.indexOf('$2,420.60') !== -1 && /data-mm-status="paid"/.test(row));
check('invoice row opens detail; a draft opens the draft', row.indexOf("viewInvoiceDetail('i1')") !== -1 && M.invoiceRowHTML({ id: 'd', status: 'draft' }).indexOf("openInvoiceDraft('d')") !== -1);
check('invoice row: figures unavailable when nothing is known', M.invoiceRowHTML({ id: 'x', figures_ok: false, trade_payable: null, total_inc: null }).indexOf('Figures unavailable') !== -1);
check('invoice row: not counted marker', M.invoiceRowHTML({ id: 'v', counts: false, xero_bill_status: 'VOIDED' }).indexOf('(not counted)') !== -1);

const view = M.viewHTML({ profile: { name: 'Hugo', abn: '1', gst_registered: true }, fy_label: 'FY 2026/27', month: { label: 'Sep 2026', invoices: 1, gross_earned: 1000, super_amount: 120, gst: 100, payable: 980, paid_total: 0, outstanding: 980 }, fytd: t, months: [], invoices: [{ id: 'i1', status: 'paid', paid: true, payable: 10 }] });
check('view has header, both period cards and the list', view.indexOf('My money') !== -1 && /data-mm-period="month"/.test(view) && /data-mm-period="fytd"/.test(view) && /data-mm-invoice="i1"/.test(view));
check('view explains where paid comes from', view.indexOf('comes from Xero') !== -1);
check('empty view is honest', M.viewHTML({ invoices: [] }).indexOf('No invoices yet') !== -1);
check('no em dash, no old brand', view.indexOf('—') === -1 && view.indexOf('SecureWorks WA') === -1);

console.log('trade-my-money: ' + passed + ' checks passed');
