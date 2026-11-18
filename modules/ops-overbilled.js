// Financials > Work Orders: Billed over the agreed amount (follow-up 49 item
// 9(d)). The office's first overcharge review. Read only, needs no switch.
//
// Reads:  ops-api list_overbilled_job_work_orders once per open of the Work
//         Orders tab (secureworks-backend work_order_overbilled.ts). Staff
//         only on the server (403 otherwise). One row per approved job work
//         order whose job is billed more than its agreed labour: job number,
//         agreed, billed and the gap (billed less agreed), largest gap first.
//         Billed is the same count the invoice doors refuse by.
// Writes: nothing. A job number opens the existing job page (openJobDetail).
// Shows no trade, rate, hours, invoice or line: the answer carries none and
// this page asks for none. A failed read says so and never draws an empty
// list or $0.00.
//
// <overbilled-core>
var OverbilledCore = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function money(v) {
    var n = num(v);
    if (n === null) return '';
    var neg = n < 0;
    var parts = Math.abs(Math.round(n * 100) / 100).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts[0] + '.' + parts[1];
  }

  // The answer as the page draws it, or null when it is not a usable answer
  // (no jobs list, or a listed job without its three figures). Null is a
  // failed read, never an empty list.
  function readAnswer(data) {
    if (!data || data.ok !== true || !Array.isArray(data.jobs)) return null;
    var rows = [];
    for (var i = 0; i < data.jobs.length; i++) {
      var j = data.jobs[i];
      if (!j || !j.job_id) return null;
      var agreed = num(j.agreed_labour_ex), billed = num(j.billed_ex), gap = num(j.gap_ex);
      if (agreed === null || billed === null || gap === null) return null;
      rows.push({
        job_id: String(j.job_id),
        job_number: j.job_number == null || j.job_number === '' ? null : String(j.job_number),
        agreed: agreed,
        billed: billed,
        gap: gap,
        covered: j.within_allowed === true
      });
    }
    rows.sort(function (a, b) {
      return (b.gap - a.gap) ||
        String(a.job_number || a.job_id).localeCompare(String(b.job_number || b.job_id));
    });
    return {
      rows: rows,
      checked: num(data.checked_work_orders),
      totalGap: num(data.total_gap_ex)
    };
  }

  function rowHtml(r) {
    var label = r.job_number || 'Job with no number';
    return '<tr data-overbilled-row="' + esc(r.job_id) + '">' +
      '<td><a href="#" class="obl-job" data-overbilled-job="' + esc(r.job_id) + '">' + esc(label) + '</a>' +
      (r.covered ? ' <span class="obl-muted" data-overbilled-covered>approved changes cover it</span>' : '') + '</td>' +
      '<td class="obl-num">' + money(r.agreed) + '</td>' +
      '<td class="obl-num">' + money(r.billed) + '</td>' +
      '<td class="obl-num obl-gap" data-overbilled-gap>' + money(r.gap) + '</td>' +
      '</tr>';
  }

  function summary(ans) {
    var n = ans.rows.length;
    var parts = [];
    parts.push(n === 1 ? '1 job billed over its agreed amount' : n + ' jobs billed over their agreed amount');
    if (n && ans.totalGap !== null) parts.push(money(ans.totalGap) + ' over in all');
    if (ans.checked !== null) parts.push(ans.checked + ' approved work orders checked');
    return parts.join(' · ');
  }

  // The words for a refused or failed read. Never a code, never a zero.
  function failedWords(err) {
    if (err && err.status === 403) return 'Only staff can see this list.';
    return 'Billed over the agreed amount could not be read. Reopen this tab to try again.';
  }

  return {
    esc: esc, num: num, money: money, readAnswer: readAnswer,
    rowHtml: rowHtml, summary: summary, failedWords: failedWords
  };
})();
// </overbilled-core>

var Overbilled = (function () {
  'use strict';
  var C = OverbilledCore;
  var state = { seq: 0 };

  function host() { return document.getElementById('woOverbilled'); }

  function injectCss() {
    if (document.getElementById('oblCss')) return;
    var s = document.createElement('style');
    s.id = 'oblCss';
    s.textContent =
      '#woOverbilled{margin-top:24px}#woOverbilled h3{font-size:16px;margin:0 0 4px}' +
      '#woOverbilled .obl-note{font-size:12px;color:var(--sw-text-sec,#6b7280);margin:0 0 10px}' +
      '#woOverbilled .obl-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '#woOverbilled th.obl-num{text-align:right}' +
      '#woOverbilled .obl-gap{color:var(--sw-red,#c0392b);font-weight:600}' +
      '#woOverbilled .obl-muted{font-size:12px;color:var(--sw-text-sec,#6b7280)}' +
      '#woOverbilled .obl-job{font-weight:600;white-space:nowrap;color:var(--sw-mid,#293c46)}';
    document.head.appendChild(s);
  }

  function frame(note, body) {
    return '<h3>Billed over the agreed amount</h3>' +
      '<p class="obl-note" data-overbilled-note>' + note + '</p>' +
      '<div class="data-table-wrap"><table class="data-table" id="oblTable">' +
      '<thead><tr><th>Job #</th><th class="obl-num" title="Labour the office agreed, ex GST">Agreed</th>' +
      '<th class="obl-num" title="Billed on the job by every trade, except commission, ex GST">Billed</th>' +
      '<th class="obl-num" title="Billed less agreed">Gap</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }

  function paintLoading() {
    var h = host();
    if (!h) return;
    h.innerHTML = frame('Amounts are ex GST.', '<tr><td colspan="4" class="empty-state">Loading...</td></tr>');
  }

  function paintFailed(err) {
    var h = host();
    if (!h) return;
    h.innerHTML = frame('', '<tr><td colspan="4" class="empty-state" data-overbilled-failed>' +
      C.esc(C.failedWords(err)) + '</td></tr>');
  }

  function paint(ans) {
    var h = host();
    if (!h) return;
    var note = C.esc(C.summary(ans)) + '. Amounts are ex GST. Billed is the same count the work order limit uses.';
    var body = ans.rows.length
      ? ans.rows.map(C.rowHtml).join('')
      : '<tr><td colspan="4" class="empty-state" data-overbilled-empty>No job is billed over its agreed amount.</td></tr>';
    h.innerHTML = frame(note, body);
  }

  function wire() {
    var h = host();
    if (!h || h.__oblWired) return;
    h.__oblWired = true;
    h.addEventListener('click', function (e) {
      var a = e.target.closest('[data-overbilled-job]');
      if (!a) return;
      e.preventDefault();
      var id = a.getAttribute('data-overbilled-job');
      if (id && typeof window.openJobDetail === 'function') window.openJobDetail(id);
    });
  }

  async function load() {
    if (!host()) return;
    injectCss();
    wire();
    var my = ++state.seq;
    paintLoading();
    try {
      var data = await window.opsFetch('list_overbilled_job_work_orders');
      if (my !== state.seq) return;
      var ans = C.readAnswer(data);
      if (!ans) throw new Error('no usable list in the answer');
      paint(ans);
    } catch (e) {
      if (my !== state.seq) return;
      console.error('Overbilled load error:', e && e.status, e && e.code);
      paintFailed(e);
    }
  }

  return { load: load };
})();

window.OverbilledCore = OverbilledCore;
window.Overbilled = Overbilled;
