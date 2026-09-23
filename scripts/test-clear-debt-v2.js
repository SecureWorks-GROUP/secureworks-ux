// Guard for the Clear Debt screen (read-only debtor work list, 24 Sep 2026).
// Runs in the PR gate. It executes the real module with every network and
// write path replaced by a recording spy, opens the tab the way
// Financials > Clear Debt does (loadClearDebt), and checks what happens:
// exactly one debt_worklist read, no write or network call, the synthetic
// book rendered with its counts, and an undeployed read shown as not connected
// rather than as a zero. The page wiring in ops.html (host element, module and
// stylesheet loaded with a fresh cache-bust) is checked in a real browser by
// tests/e2e/ops-clear-debt.spec.js; behaviour by modules/ops-clear-debt-v2.test.cjs.
const fs = require('fs');
const vm = require('vm');
const makeWorklist = require('../tests/fixtures/clear-debt/worklist.js');

function fail(m) { console.error('FAIL clear-debt-v2: ' + m); process.exit(1); }

function openTab(answer) {
  const reads = [];
  const outbound = [];
  const root = { innerHTML: '', addEventListener() {}, querySelector() { return null; }, contains() { return true; } };
  const ctx = {
    document: { getElementById: (id) => (id === 'clearDebtRoot' ? root : null) },
    opsFetch: async (action, params) => { reads.push([action, params]); return answer(); },
    opsPost: async (action) => { outbound.push(['opsPost', action]); throw new Error('write attempted'); },
    opsPostJwt: async (action) => { outbound.push(['opsPostJwt', action]); throw new Error('write attempted'); },
    fetch: async (url) => { outbound.push(['fetch', String(url)]); throw new Error('network attempted'); },
    XMLHttpRequest: function () { outbound.push(['XMLHttpRequest']); throw new Error('network attempted'); },
    confirm: () => { outbound.push(['confirm']); return false; },
    Intl, Promise, console
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('modules/ops-clear-debt-v2.js', 'utf8'), ctx, { filename: 'modules/ops-clear-debt-v2.js' });
  if (typeof ctx.loadClearDebt !== 'function') fail('loadClearDebt (called by Financials > Clear Debt) is missing');
  return ctx.loadClearDebt().then(() => ({ reads, outbound, html: root.innerHTML, api: ctx.ClearDebt }));
}

(async () => {
  const ok = await openTab(() => makeWorklist());
  if (ok.reads.length !== 1 || ok.reads[0][0] !== 'debt_worklist' || ok.reads[0][1].timeline !== 'recent') fail('tab load must make one debt_worklist read with timeline=recent, got ' + JSON.stringify(ok.reads));
  if (ok.outbound.length) fail('tab load wrote or reached the network: ' + JSON.stringify(ok.outbound));
  const text = ok.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const want of ['101 open invoices', '$122,209.52 due', '77 of 101 overdue', '90 of 101 linked to a job', '11 not linked', '21 of 101 with facts']) {
    if (!text.includes(want)) fail('rendered counts must include "' + want + '"');
  }
  if ((ok.html.match(/data-cd="debtor"/g) || []).length !== 78) fail('every debtor must be listed once');

  const missing = await openTab(() => { const e = new Error('Unknown action'); e.status = 400; throw e; });
  if (missing.reads.length !== 1) fail('an undeployed read must still be one attempt');
  if (!/data-cd-state="not-connected"/.test(missing.html)) fail('an undeployed debt_worklist must show the not-connected line');
  if (/open invoices|\$0\.00/.test(missing.html)) fail('an undeployed read must never show counts or a zero');
  if (missing.outbound.length) fail('the not-connected state wrote or reached the network');

  console.log('PASS clear-debt-v2: one debt_worklist read, no write or network call, book rendered with its counts, undeployed read shown as not connected');
})().catch((e) => fail(e.stack || e.message));
