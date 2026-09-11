// Smoke test for the Clear Debt v2 module (design accepted 11 Sep 2026).
// Runs in the PR gate: parses the module, checks ops.html mounts it with a cache-buster
// and no longer mounts the old module, exercises the grouping on fixture rows, and
// refuses em dashes in any user-facing string.
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('modules/ops-clear-debt-v2.js', 'utf8');
const html = fs.readFileSync('ops.html', 'utf8');
function fail(m) { console.error('FAIL clear-debt-v2: ' + m); process.exit(1); }
if (!/modules\/ops-clear-debt-v2\.js\?v=\d+/.test(html)) fail('ops.html must load modules/ops-clear-debt-v2.js with a ?v= cache-buster');
if (/modules\/ops-clear-debt\.js"/.test(html)) fail('ops.html still loads the old modules/ops-clear-debt.js');
const strings = src.replace(/\/—\//g, '');
if (/—/.test(strings)) fail('em dash found in user-facing text');
const ctx = { document: { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) }, window: {}, opsFetch: async () => ({}), opsPost: async () => ({}), showToast() {}, openJobDetail() {}, confirm: () => false, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
for (const fn of ['loadClearDebt', 'cdGroups', 'cdRender', 'cdKindOf', 'cdSubOf', 'cdAddNote', 'cdSendText']) if (typeof ctx[fn] !== 'function') fail('missing function ' + fn);
const rows = [
  { xero_invoice_id: 'a', xero_contact_id: 'c1', contact_name: 'A', amount_due: 100, days_overdue: 10, debt_classification: 'genuine_debt', debt_type: 'deposit', debt_owner: 'DEBT' },
  { xero_invoice_id: 'b', xero_contact_id: 'c1', contact_name: 'A', amount_due: 50, days_overdue: -3, debt_classification: 'genuine_debt', debt_type: 'final_balance', debt_owner: 'DEBT' },
  { xero_invoice_id: 'c', xero_contact_id: 'c2', contact_name: 'B', amount_due: 70, days_overdue: 40, debt_classification: 'blocked_by_us', debt_blocker: 'paid_unallocated', debt_owner: 'BOOKKEEPING' },
  { xero_invoice_id: 'd', xero_contact_id: 'c3', contact_name: 'C', amount_due: 30, days_overdue: 5, debt_classification: 'blocked_by_us', debt_blocker: 'rectification', debt_owner: 'OPERATIONS' },
  { xero_invoice_id: 'e', xero_contact_id: 'c4', contact_name: 'D', amount_due: 20, days_overdue: 90, debt_classification: 'in_dispute', debt_owner: 'INSURANCE' },
  { xero_invoice_id: 'f', xero_contact_id: 'c5', contact_name: 'E', amount_due: 10, days_overdue: 200, debt_classification: 'not_owed', debt_void_proposed: true, debt_owner: 'MARNIN' },
  { xero_invoice_id: 'g', xero_contact_id: 'c6', contact_name: 'F', amount_due: 5, days_overdue: 300, debt_classification: 'bad_debt', debt_owner: 'MARNIN' },
  { xero_invoice_id: 'h', xero_contact_id: 'c7', contact_name: 'G', amount_due: 1, days_overdue: 1, debt_classification: null },
];
ctx.CD.rows = rows;
const k = ctx.cdGroups();
const expect = { chase: 1, due: 1, paid: 1, blocked: 1, dispute: 1, notowed: 1, bad: 1, unclass: 1 };
for (const key of Object.keys(expect)) if (k[key].n !== expect[key]) fail(`kind ${key} expected ${expect[key]} invoice, got ${k[key].n}`);
if (k.chase.subs[0].key !== 'deposit' || k.due.subs[0].key !== 'final_balance') fail('chase and due must group by debt_type');
if (k.blocked.subs[0].key !== 'rectification' || k.paid.subs[0].key !== 'paid_unallocated') fail('blocked and paid must group by blocker');
if (k.chase.subs[0].payers[0].xero_contact_id !== 'c1') fail('payers must key by xero_contact_id');
const total = Object.values(k).reduce((a, K) => a + K.amount, 0);
if (Math.abs(total - 286) > 0.001) fail('totals must add up, got ' + total);
console.log('PASS clear-debt-v2: module parses, mount correct, 8 kinds grouped, sub-groups by type and blocker, payers keyed by contact id');
