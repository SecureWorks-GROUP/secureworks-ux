// Guard for the Clear Debt screen (read-only debtor work list, 24 Sep 2026).
// Runs in the PR gate: checks ops.html hosts and loads the module and its
// stylesheet with cache-busters, that the old category-dashboard markup and
// module are gone, that the module parses and makes exactly one read
// (debt_worklist) with no write or send path, and that no user-facing text
// carries an em dash. Behaviour is covered by modules/ops-clear-debt-v2.test.cjs
// and the browser spec tests/e2e/ops-clear-debt.spec.js.
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('modules/ops-clear-debt-v2.js', 'utf8');
const css = fs.readFileSync('modules/ops-clear-debt-v2.css', 'utf8');
const html = fs.readFileSync('ops.html', 'utf8');
function fail(m) { console.error('FAIL clear-debt-v2: ' + m); process.exit(1); }

if (!/\{t:'js', u:'modules\/ops-clear-debt-v2\.js\?v=\d+'\}/.test(html)) fail('ops.html must load modules/ops-clear-debt-v2.js through __swOpsStampAssets');
if (!/\{t:'css', u:'modules\/ops-clear-debt-v2\.css\?v=\d+'\}/.test(html)) fail('ops.html must load modules/ops-clear-debt-v2.css through __swOpsStampAssets');
if (/modules\/ops-clear-debt\.js["?]/.test(html)) fail('ops.html still loads the old modules/ops-clear-debt.js');
if (!/<div id="subCleardebt" class="sub-view">\s*<div id="clearDebtRoot"><\/div>\s*<\/div>/.test(html)) fail('#subCleardebt must host exactly <div id="clearDebtRoot"></div>');
if (/clearDebtStats|clearDebtFilters|clearDebtCards/.test(html)) fail('old Clear Debt host markup is still in ops.html');
if (/—/.test(src) || /—/.test(css)) fail('em dash found in the Clear Debt module or stylesheet');
if (/[^#]\.(db|lead|tl)\b[^{]*\{/.test(css.replace(/#clearDebtRoot[^{]*\{/g, ''))) fail('every Clear Debt rule must be scoped under #clearDebtRoot');

for (const banned of ['opsPost', 'send_chase_sms', 'send_invoice_email', 'add_debt_note', 'debt_proposal_mark', 'get_invoice_pdf', 'list_debt_picture', 'debt_context_coverage', "'invoice_context'", "'debt_notes'", 'confirm(']) {
  if (src.includes(banned)) fail('the read-only screen must not reference ' + banned);
}
const reads = src.match(/opsFetch\(\s*'([a-z_]+)'/g) || [];
if (reads.length !== 1 || !/opsFetch\(\s*'debt_worklist'/.test(reads[0])) fail('exactly one read, debt_worklist, expected; got ' + JSON.stringify(reads));

const calls = [];
const root = { innerHTML: '', addEventListener() {}, querySelector() { return null; }, contains() { return true; } };
const ctx = {
  document: { getElementById: (id) => (id === 'clearDebtRoot' ? root : null) },
  opsFetch: async (action, params) => { calls.push([action, params]); throw new Error('Unknown action'); },
  opsPost: async () => { throw new Error('write attempted'); },
  Intl, Promise, console
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
if (typeof ctx.loadClearDebt !== 'function') fail('loadClearDebt (called by Financials > Clear Debt) is missing');
ctx.loadClearDebt().then(() => {
  if (calls.length !== 1 || calls[0][0] !== 'debt_worklist' || calls[0][1].timeline !== 'recent') fail('tab load must make one debt_worklist read with timeline=recent, got ' + JSON.stringify(calls));
  if (!/data-cd-state="not-connected"/.test(root.innerHTML)) fail('an undeployed debt_worklist must show the not-connected line');
  console.log('PASS clear-debt-v2: mounted with css and js, old markup gone, one debt_worklist read, no write path, honest not-connected state');
}).catch((e) => fail(e.message));
