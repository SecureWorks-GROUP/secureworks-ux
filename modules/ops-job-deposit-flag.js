// ════════════════════════════════════════════════════════════
// Deposit flag on fencing and patio jobs (voided or unpaid after the move)
// ════════════════════════════════════════════════════════════
// Backend: secureworks-backend supabase/functions/ops-api/job_deposit_advance.ts
// (docs/job-deposit-advance-v1.md). When a deposit moved a job on and that deposit
// is later voided, or no longer paid in full, the job is flagged and a person
// decides what to do. Nothing here moves a job or raises a flag.
//
// Reads only what ops-api sends:
//   pipeline card   deposit_flag: { reason, invoice_number, invoice_status, flagged_at }
//                   present only while a flag is open
//   job_detail      deposit_flag: the same block, or null when there is none
//                   deposit_flag_unreadable: true when the read failed
// reason is 'deposit_voided' or 'deposit_unpaid'; any other reason is shown as sent.
//
// One write: ops-api `clear_job_deposit_flag` { job_id } from the job page, after a
// confirm. It answers { ok, action: 'cleared' | 'no_open_flag' }; both mean the job
// has no open flag now. A failure with no HTTP status is said as unknown. The board is not re-read: the answer is written into every
// row the flag was drawn from.
// ════════════════════════════════════════════════════════════

// <job-deposit-flag-core>
var DepositFlagCore = (function () {
  'use strict';

  function str(v) { return v == null ? '' : String(v); }
  function esc(v) {
    return str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // The open flag, only when it is an object with a reason.
  function flagOf(block) {
    if (!block || typeof block !== 'object') return null;
    if (!str(block.reason).trim()) return null;
    return block;
  }

  var REASON_WORDS = {
    deposit_voided: 'Deposit voided after move',
    deposit_unpaid: 'Deposit no longer paid after move'
  };

  // The flag's own reason, in words. An unknown reason is shown as sent.
  function reasonWords(reason) {
    var r = str(reason).trim();
    if (REASON_WORDS[r]) return REASON_WORDS[r];
    return 'Deposit flag: ' + r.replace(/_/g, ' ');
  }

  function label(flag) { return reasonWords(flag.reason) + ' - check'; }

  // The invoice the flag is about, in words, or ''.
  function invoiceWords(flag) {
    var num = str(flag.invoice_number).trim();
    var st = str(flag.invoice_status).trim();
    if (!num && !st) return '';
    return 'Invoice ' + (num || 'number not known') + (st ? ' is ' + st : '');
  }

  function titleOf(flag) {
    var bits = [invoiceWords(flag), 'A person decides what happens to this job.'].filter(Boolean);
    return bits.join('. ');
  }

  var BADGE_STYLE = 'background:rgba(231,76,60,0.12);color:#C0392B;font-weight:600;';

  function cardHtml(job) {
    var flag = flagOf(job && job.deposit_flag);
    if (!flag) return '';
    return '<div class="kanban-deposit-flag-wrap" data-deposit-flag-job="' + esc(job.id) + '" style="margin-top:4px;">' +
      '<span class="kanban-meta-badge deposit-flag" data-deposit-flag="' + esc(flag.reason) + '" style="' + BADGE_STYLE +
      '" title="' + esc(titleOf(flag)) + '">' + esc(label(flag)) + '</span></div>';
  }

  // The job page: the flag with a Mark dealt with button, "couldn't check" when
  // the read failed, nothing when there is no flag.
  function detailHtml(jobId, flag, unreadable) {
    var open = '<div class="jd-deposit-flag" data-deposit-flag-job="' + esc(jobId) + '" style="padding:8px 12px;margin-bottom:4px;display:flex;align-items:center;gap:8px;';
    if (unreadable) {
      return open + 'background:rgba(143,164,178,0.12);border-left:3px solid var(--sw-mid);">' +
        '<span class="jd-deposit-flag-text" style="font-size:13px;flex:1;">Deposit flag: couldn\'t check</span></div>';
    }
    flag = flagOf(flag);
    if (!flag) return '';
    var inv = invoiceWords(flag);
    return open + 'background:rgba(231,76,60,0.06);border-left:3px solid var(--sw-red);">' +
      '<span class="jd-deposit-flag-text" style="font-size:13px;flex:1;"><strong>' + esc(label(flag)) + '</strong>' +
      (inv ? '<br><span style="font-size:12px;color:var(--sw-text-sec);">' + esc(inv) + '. A person decides what happens to this job.</span>' : '') +
      '</span>' +
      '<button class="btn btn-sm btn-secondary" data-deposit-flag-clear="' + esc(jobId) + '" onclick="DepositFlagOps.clear(this)">Mark dealt with</button></div>';
  }

  // Whether a clear_job_deposit_flag answer means no flag is open now.
  function clearedBy(res) {
    return !!res && res.ok === true && (res.action === 'cleared' || res.action === 'no_open_flag');
  }

  // A failed clear_job_deposit_flag, in words. Only an HTTP refusal is known to
  // have changed nothing; a lost connection or an answer we cannot read is unknown.
  function refusalWords(err) {
    if (!err || !err.status) return 'Could not tell whether the deposit flag was cleared. Refresh the job to check.';
    var code = str(err && (err.code || (err.body && err.body.code))).trim();
    if (code === 'operator_access_required') return 'Only signed-in office staff can clear a deposit flag. Nothing was changed.';
    return 'The deposit flag could not be cleared. Nothing was changed.';
  }

  return {
    flagOf: flagOf,
    reasonWords: reasonWords,
    label: label,
    invoiceWords: invoiceWords,
    cardHtml: cardHtml,
    detailHtml: detailHtml,
    clearedBy: clearedBy,
    refusalWords: refusalWords
  };
})();
// </job-deposit-flag-core>

var DepositFlagOps = (function () {
  'use strict';

  // Every row (board card or job_detail answer) a job's flag was drawn from, so a
  // clear is written into each of them.
  var _seen = {};

  function remember(id, holder) {
    var list = _seen[id] || (_seen[id] = []);
    if (list.indexOf(holder) === -1) list.push(holder);
  }

  // A flag must never break a card: any throw draws nothing.
  function cardHtml(job, status) {
    try {
      if (!job || !job.deposit_flag) return '';
      remember(job.id, job);
      return DepositFlagCore.cardHtml(job);
    } catch (e) { return ''; }
  }

  // job_detail: the block beside the job, or on it.
  function detailHtml(data) {
    try {
      if (!data || !data.job) return '';
      var job = data.job;
      var holder = data.deposit_flag !== undefined || data.deposit_flag_unreadable ? data : job;
      remember(job.id, holder);
      return DepositFlagCore.detailHtml(job.id, holder.deposit_flag, holder.deposit_flag_unreadable === true);
    } catch (e) { return ''; }
  }

  function say(message, type) {
    try { if (typeof showToast === 'function') showToast(message, type); } catch (e) { /* no toast host */ }
  }

  function dropFlag(jobId) {
    (_seen[jobId] || []).forEach(function (h) { h.deposit_flag = null; });
    document.querySelectorAll('[data-deposit-flag-job]').forEach(function (el) {
      if (el.getAttribute('data-deposit-flag-job') === String(jobId)) el.remove();
    });
  }

  // One press: ask ops-api, then draw what it answered. Never optimistic.
  function send(btn, jobId) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    return Promise.resolve()
      .then(function () { return opsPost('clear_job_deposit_flag', { job_id: jobId }); })
      .then(function (res) {
        if (!DepositFlagCore.clearedBy(res)) throw new Error('unexpected answer');
        dropFlag(jobId);
        say(res.action === 'cleared' ? 'Deposit flag marked as dealt with.' : 'This deposit flag was already cleared.', 'success');
        return res;
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        say(DepositFlagCore.refusalWords(err), 'warning');
        return null;
      });
  }

  function clear(btn) {
    try {
      if (!btn || btn.disabled) return Promise.resolve(null);
      var jobId = btn.getAttribute('data-deposit-flag-clear');
      // The page's own confirm modal lives inside the Calendar view, hidden here.
      if (!window.confirm('Mark the deposit flag as dealt with? It stops showing on the board and the job page. The job stays where it is.')) {
        return Promise.resolve(null);
      }
      return send(btn, jobId);
    } catch (e) { return Promise.resolve(null); }
  }

  return {
    cardHtml: cardHtml,
    detailHtml: detailHtml,
    clear: clear
  };
})();

if (typeof window !== 'undefined') {
  window.DepositFlagCore = DepositFlagCore;
  window.DepositFlagOps = DepositFlagOps;
}
