#!/usr/bin/env node
// 2026-09-08 — complete-to-invoice on the wizard success screen.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
const startMark = '// <trade-complete-invoice>';
const endMark = '// </trade-complete-invoice>';
const start = html.indexOf(startMark);
const end = html.indexOf(endMark, start + startMark.length);
assert(start !== -1 && end !== -1 && end > start, 'trade-complete-invoice sentinels exist');
const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end + endMark.length), context);
const C = context.CompleteInvoiceCore;
assert(C, 'CompleteInvoiceCore exported');
let passed = 0;
function check(name, cond) { assert(cond, name); passed += 1; }

const wo = { id: 'wo-1', wo_number: 'WO-261314', business_date: '2026-09-08', week_end: '2026-09-13', priced: true };
check('per-metre + priced WO -> weekly auto-add', C.plan({ lane: 'weekly_work_order', work_orders: [wo] }).kind === 'weekly');
check('per-metre + unpriced WO -> hours, WO listed as unpriced', (function () { var p = C.plan({ lane: 'weekly_work_order', work_orders: [{ id: 'x', priced: false }], hours_logged: null }); return p.kind === 'hours' && p.unpriced.length === 1; })());
check('hourly lane carries hours logged', C.plan({ lane: 'hours', hours_logged: '2' }).hoursLogged === 2 && C.plan({ lane: 'hours' }).hoursLogged === null);
check('no queue -> none', C.plan(null).kind === 'none' && C.plan({ lane: null }).kind === 'none');

const adding = C.weeklyCardHTML(wo, 'adding');
check('adding card names WO and week', adding.indexOf('Work order WO-261314 complete') !== -1 && adding.indexOf('w/e Sun 13 Sep') !== -1 && /data-wiz-invoice-state="adding"/.test(adding));
check('added card says it is on the draft', /On your weekly invoice draft/.test(C.weeklyCardHTML(wo, 'added')));
check('failed card gives the manual path', /Add it from My Work Orders/.test(C.weeklyCardHTML(wo, 'failed', 'not ready')) && /not ready/.test(C.weeklyCardHTML(wo, 'failed', 'not ready')));
check('review button targets the WO and date', adding.indexOf("wizReviewWeeklyInvoice('wo-1','2026-09-08')") !== -1);
check('escapes', C.weeklyCardHTML({ id: "a'b", wo_number: '<x>' }, 'added').indexOf('&lt;x&gt;') !== -1);
check('hours intro when hours exist, nothing when not', /2 hrs on your week/.test(C.hoursIntroHTML(2)) && /1 hr on your week/.test(C.hoursIntroHTML(1)) && C.hoursIntroHTML(null) === '');
check('weekLabel', C.weekLabel('2026-09-13') === 'w/e Sun 13 Sep' && C.weekLabel('') === '');
check('no em dash, no old brand', [adding, C.weeklyCardHTML(wo, 'added')].join('').indexOf('—') === -1);
console.log('trade-complete-invoice: ' + passed + ' checks passed');
