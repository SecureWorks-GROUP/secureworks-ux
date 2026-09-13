const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'modules/ops-how-it-works-contract.json'), 'utf8'));
const debtJs = fs.readFileSync(path.join(root, 'modules/ops-clear-debt-v2.js'));
const hostJs = fs.readFileSync(path.join(root, 'modules/ops-debt-host.js'), 'utf8');
const opsHtml = fs.readFileSync(path.join(root, 'ops.html'), 'utf8');

test('host Clear Debt module matches Debt UX pin c89d6e4', () => {
  assert.equal(
    crypto.createHash('sha256').update(debtJs).digest('hex'),
    'fbf8320d4eaa2394a93d0d676f62b625104f39d1078364f0a4ff3667cdce0e37'
  );
});

test('How it works debt adapter matches wiki skill JSON and forbids receipt RPC', () => {
  const debt = contract.workflows.debt;
  assert.equal(debt.definition_status, 'owner_definition_reviewed');
  assert.equal(debt.skill_version, 'clear-debt-workflow/2026-09-13');
  assert.equal(debt.ux_pin, 'c89d6e46fac85994794feace96dd8941f7cca0b7');
  assert.equal(debt.backend_pin, 'e04145b5');
  assert.equal(debt.wiki_pin, '08afbb57');
  assert.match(debt.technical.api, /debt_proposal_save/);
  assert.match(debt.technical.api, /must not call record_workflow_refresh_receipt/);
  assert.match(debt.technical.api, /start\(debt\) is unavailable/);
  assert.match(debt.technical.api, /ea0beae5 is not completion-safe/);
  assert.match(debt.business.join(' '), /does not send/i);
});

test('ops.html mounts Debt host glue and mail root without a send control', () => {
  assert.match(opsHtml, /id="debtMailRoot"/);
  assert.match(opsHtml, /ops-debt-host\.js/);
  assert.match(opsHtml, /ops-clear-debt-v2\.js/);
});

test('Debt host mail selection uses invoice_id and never posts a refresh receipt', async () => {
  const posts = [];
  const context = {
    CD: {
      selectedInvoice: 'c4c98644-4986-4371-a59d-0155d6b49734',
      rows: [{
        xero_invoice_id: 'c4c98644-4986-4371-a59d-0155d6b49734',
        invoice_number: 'INV-1477',
        job_id: '7daa5692-bed9-4836-92af-09d1e0ddf52a'
      }]
    },
    document: {
      getElementById: id => id === 'debtMailRoot' ? { innerHTML: '' } : null
    },
    OpsContextMail: {
      pendingHTML() { return 'pending'; },
      async load(kind, sel) { return { capability: 'connected', records: [], coverage: { complete: false }, selection: sel, kind }; },
      render(kind, sel) { return `mail:${kind}:${sel.invoice_id}:${sel.job_id}`; }
    },
    opsPost: async (action) => { posts.push(action); }
  };
  vm.runInNewContext(hostJs, context);
  const sel = context.OpsDebtHost.selection();
  assert.equal(sel.kind, 'debt');
  assert.equal(sel.invoice_id, 'c4c98644-4986-4371-a59d-0155d6b49734');
  assert.equal(sel.job_id, '7daa5692-bed9-4836-92af-09d1e0ddf52a');
  assert.equal(context.OpsDebtHost.refreshIsPictureGet, true);
  assert.equal(context.OpsDebtHost.mustNotCallReceipt, true);
  assert.equal(context.OpsDebtHost.workflowRefreshUnavailable, true);
  assert.equal(posts.includes('record_workflow_refresh_receipt'), false);
});

test('workflow_refresh start(debt) is unavailable and does not POST receipt', async () => {
  const posts = [];
  const context = {
    opsPost: async (action) => { posts.push(action); return { outcome: 'completed' }; }
  };
  const refreshSrc = fs.readFileSync(path.join(root, 'modules/ops-workflow-refresh.js'), 'utf8');
  vm.runInNewContext(refreshSrc, context);
  const run = await context.OpsWorkflowRefresh.start('debt', {}, { assertIdentity() {} });
  assert.equal(run.outcome, 'unavailable');
  assert.match(run.reason, /debt_cannot_register|start\(debt\) unavailable/);
  assert.equal(posts.length, 0);
});
