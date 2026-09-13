/* Host glue for Debt Collection. Does not edit the Debt module.
   Refresh stays picture GET. JWT never calls record_workflow_refresh_receipt. */
(function (root) {
  'use strict';
  let generation = 0;

  function selection() {
    const CD = root.CD;
    if (!CD || !CD.rows) return null;
    const xid = CD.selectedInvoice;
    const row = CD.rows.find(r => r.xero_invoice_id === xid) || (xid ? null : CD.rows[0]);
    if (!row) return null;
    const jobId = row.job_id || (row.invoice_context && row.invoice_context.link && row.invoice_context.link.job_id) || null;
    return {
      kind: 'debt',
      invoice_id: row.xero_invoice_id,
      job_id: jobId,
      job_number: row.invoice_number || row.job_number,
      stale_proposals: row.debt_proposal_stale || null
    };
  }

  async function syncMail() {
    const host = document.getElementById('debtMailRoot');
    if (!host || !root.OpsContextMail) return;
    const sel = selection();
    const started = ++generation;
    if (!sel || !sel.job_id) {
      host.innerHTML = root.OpsContextMail.pendingHTML('debt', sel || {}, sel && !sel.job_id ? 'Invoice has no linked job. Email history needs a job_id.' : 'Select an invoice.');
      return;
    }
    const state = await root.OpsContextMail.load('debt', sel);
    if (started !== generation) return;
    host.innerHTML = root.OpsContextMail.render('debt', sel, state);
  }

  function wrap(name) {
    const original = root[name];
    if (typeof original !== 'function') return;
    root[name] = function () {
      const result = original.apply(this, arguments);
      Promise.resolve(result).then(syncMail, syncMail);
      return result;
    };
  }

  ['cdSelectInvoice', 'cdToggle', 'cdGo', 'cdRefreshPicture', 'loadClearDebt'].forEach(wrap);
  root.OpsDebtHost = {
    syncMail,
    selection,
    refreshIsPictureGet: true,
    mustNotCallReceipt: true
  };
})(typeof window !== 'undefined' ? window : globalThis);
