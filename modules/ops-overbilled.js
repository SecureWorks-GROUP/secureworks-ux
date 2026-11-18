// Financials > Work Orders: Billed over the agreed amount (follow-up 49 item
// 9(d)). The office's first overcharge review. Read only, needs no switch.
//
// Reads:  ops-api list_overbilled_job_work_orders?days=<window> ON DEMAND only
//         (director 16:58): opening the Work Orders tab paints the window
//         picker and a "Show jobs billed over the agreed amount" press and
//         reads nothing, because the read walks every job billed in the window
//         through the cap sum. One read per press, and once per change of the
//         window after the list is shown, never before
//         (secureworks-backend work_order_overbilled.ts). Staff only on the
//         server (403 otherwise). The server checks the jobs a trade billed in
//         the last `days` (90 unless picked here) and answers:
//         - jobs[]: approved job work orders whose job is billed more than the
//           agreed labour: job number, agreed, billed and the gap (billed less
//           agreed), largest gap first. Billed is the job's whole count, the
//           one the invoice doors refuse by.
//         - no_agreed_amount[]: jobs billed in the window that cannot be
//           judged (no work order, not approved, or no agreed amount).
//         - 422 overbilled_window_too_wide when the window holds more jobs than
//           it will check: the page says to pick a shorter window, plainly.
// Writes: nothing. A job number opens the existing job page (openJobDetail).
// Shows no trade, rate, hours, invoice or line: the answer carries none and
// this page asks for none. A failed read says so and never draws an empty
// list or $0.00.
//
// <overbilled-core>
var OverbilledCore = (function () {
  'use strict';

  var WINDOWS = [30, 90, 180, 365];
  var DEFAULT_DAYS = 90;

  var APART_WORDS = {
    none: 'No work order',
    not_approved: 'Work order not approved',
    no_amount: 'No agreed amount on the work order'
  };

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

  // A window the page offers, else the default.
  function windowDays(v) {
    var n = Number(v);
    return WINDOWS.indexOf(n) !== -1 ? n : DEFAULT_DAYS;
  }

  function jobNumberOf(j) {
    return j.job_number == null || j.job_number === '' ? null : String(j.job_number);
  }

  // The answer as the page draws it, or null when it is not a usable answer
  // (no jobs list, or a listed job without its three figures). Null is a
  // failed read, never an empty list. A missing no-agreed-amount list leaves
  // that section unread (apart null), never empty.
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
        job_number: jobNumberOf(j),
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
    var apart = null;
    if (Array.isArray(data.no_agreed_amount)) {
      apart = [];
      for (var k = 0; k < data.no_agreed_amount.length; k++) {
        var a = data.no_agreed_amount[k];
        if (!a || !a.job_id) { apart = null; break; }
        apart.push({ job_id: String(a.job_id), job_number: jobNumberOf(a), why: String(a.work_order || '') });
      }
      if (apart) {
        apart.sort(function (x, y) {
          return String(x.job_number || x.job_id).localeCompare(String(y.job_number || y.job_id));
        });
      }
    }
    return {
      rows: rows,
      apart: apart,
      days: num(data.window_days),
      from: data.window_from ? String(data.window_from) : null,
      billedJobs: num(data.billed_jobs),
      checked: num(data.checked_work_orders),
      totalGap: num(data.total_gap_ex)
    };
  }

  function jobLink(jobId, jobNumber) {
    return '<a href="#" class="obl-job" data-overbilled-job="' + esc(jobId) + '">' +
      esc(jobNumber || 'Job with no number') + '</a>';
  }

  function rowHtml(r) {
    return '<tr data-overbilled-row="' + esc(r.job_id) + '">' +
      '<td>' + jobLink(r.job_id, r.job_number) +
      (r.covered ? ' <span class="obl-muted" data-overbilled-covered>approved changes cover it</span>' : '') + '</td>' +
      '<td class="obl-num">' + money(r.agreed) + '</td>' +
      '<td class="obl-num">' + money(r.billed) + '</td>' +
      '<td class="obl-num obl-gap" data-overbilled-gap>' + money(r.gap) + '</td>' +
      '</tr>';
  }

  function apartRowHtml(a) {
    return '<tr data-overbilled-apart-row="' + esc(a.job_id) + '">' +
      '<td>' + jobLink(a.job_id, a.job_number) + '</td>' +
      '<td>' + esc(APART_WORDS[a.why] || 'Cannot be checked') + '</td></tr>';
  }

  function summary(ans) {
    var n = ans.rows.length;
    var parts = [];
    parts.push(n === 1 ? '1 job billed over its agreed amount' : n + ' jobs billed over their agreed amount');
    if (n && ans.totalGap !== null) parts.push(money(ans.totalGap) + ' over in all');
    if (ans.billedJobs !== null) parts.push(ans.billedJobs + (ans.billedJobs === 1 ? ' job' : ' jobs') + ' billed in the window');
    if (ans.checked !== null) parts.push(ans.checked + ' with an agreed amount checked');
    return parts.join(' · ');
  }

  function windowWords(days, from) {
    return 'Jobs a trade billed in the last ' + days + ' days' + (from ? ' (since ' + from + ')' : '') +
      '. Billed is everything billed on the job, not only in the window.';
  }

  // A refused or failed read in words. Never a code, never a zero.
  function failedWords(err, days) {
    if (err && err.status === 403) return 'Only staff can see this list.';
    if (err && (err.code === 'overbilled_window_too_wide' || err.status === 422)) {
      return 'Too many jobs were billed in the last ' + days + ' days to check them all. Pick a shorter window above.';
    }
    return 'Billed over the agreed amount could not be read. Press Read again to try again.';
  }

  return {
    WINDOWS: WINDOWS, DEFAULT_DAYS: DEFAULT_DAYS,
    esc: esc, num: num, money: money, windowDays: windowDays, readAnswer: readAnswer,
    rowHtml: rowHtml, apartRowHtml: apartRowHtml, summary: summary,
    windowWords: windowWords, failedWords: failedWords
  };
})();
// </overbilled-core>

var Overbilled = (function () {
  'use strict';
  var C = OverbilledCore;
  var state = { seq: 0, days: C.DEFAULT_DAYS, shown: false };
  var SHOW_WORDS = 'Show jobs billed over the agreed amount';

  function host() { return document.getElementById('woOverbilled'); }

  function injectCss() {
    if (document.getElementById('oblCss')) return;
    var s = document.createElement('style');
    s.id = 'oblCss';
    s.textContent =
      '#woOverbilled{margin-top:24px}#woOverbilled h3{font-size:16px;margin:0 0 4px}' +
      '#woOverbilled h4{font-size:14px;margin:20px 0 4px}' +
      '#woOverbilled .obl-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin-bottom:4px}' +
      '#woOverbilled .obl-head label{font-size:12px;color:var(--sw-text-sec,#6b7280)}' +
      '#woOverbilled .obl-head select{font-size:12px;padding:4px 8px;width:auto;margin-left:6px}' +
      '#woOverbilled .obl-note{font-size:12px;color:var(--sw-text-sec,#6b7280);margin:0 0 10px}' +
      '#woOverbilled .obl-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '#woOverbilled th.obl-num{text-align:right}' +
      '#woOverbilled .obl-gap{color:var(--sw-red,#c0392b);font-weight:600}' +
      '#woOverbilled .obl-muted{font-size:12px;color:var(--sw-text-sec,#6b7280)}' +
      '#woOverbilled .obl-job{font-weight:600;white-space:nowrap;color:var(--sw-mid,#293c46)}' +
      '#woOverbilled .obl-show{font-size:13px;padding:6px 12px;cursor:pointer}' +
      '#woOverbilled .obl-refused{font-size:14px;color:var(--sw-text,#293c46);font-weight:600;padding:16px}';
    document.head.appendChild(s);
  }

  function headHtml() {
    var opts = C.WINDOWS.map(function (d) {
      return '<option value="' + d + '"' + (d === state.days ? ' selected' : '') + '>Last ' + d + ' days</option>';
    }).join('');
    return '<div class="obl-head"><h3>Billed over the agreed amount</h3>' +
      '<label>Billed in <select class="form-input" data-overbilled-window aria-label="Billed in">' + opts + '</select></label>' +
      '<button type="button" class="btn btn-secondary obl-show" data-overbilled-show>' + (state.shown ? 'Read again' : SHOW_WORDS) + '</button></div>';
  }

  function table(body) {
    return '<div class="data-table-wrap"><table class="data-table" id="oblTable">' +
      '<thead><tr><th>Job #</th><th class="obl-num" title="Labour the office agreed, ex GST">Agreed</th>' +
      '<th class="obl-num" title="Billed on the job by every trade, except commission, ex GST">Billed</th>' +
      '<th class="obl-num" title="Billed less agreed">Gap</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
  }

  function apartHtml(apart) {
    var body;
    if (apart === null) {
      body = '<tr><td colspan="2" class="empty-state" data-overbilled-apart-failed>This list could not be read. Press Read again to try again.</td></tr>';
    } else if (!apart.length) {
      body = '<tr><td colspan="2" class="empty-state" data-overbilled-apart-empty>Every job billed in the window has an agreed amount.</td></tr>';
    } else {
      body = apart.map(C.apartRowHtml).join('');
    }
    return '<section data-overbilled-apart><h4>Billed with no agreed amount</h4>' +
      '<p class="obl-note">These jobs were billed in the window but have nothing agreed to check against.' +
      (apart && apart.length ? ' ' + apart.length + (apart.length === 1 ? ' job.' : ' jobs.') : '') + '</p>' +
      '<div class="data-table-wrap"><table class="data-table" id="oblApartTable">' +
      '<thead><tr><th>Job #</th><th>Why it cannot be checked</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></section>';
  }

  // Tab open: the picker and the press only. Nothing is read.
  function paintIdle() {
    var h = host();
    if (!h) return;
    h.innerHTML = headHtml() + '<p class="obl-note" data-overbilled-idle>Not loaded. Pick a window and press ' + SHOW_WORDS +
      '. It checks every job a trade billed in that window, so it is read only when asked.</p>';
  }

  function paintLoading() {
    var h = host();
    if (!h) return;
    h.innerHTML = headHtml() + '<p class="obl-note">Amounts are ex GST.</p>' +
      table('<tr><td colspan="4" class="empty-state">Loading...</td></tr>');
  }

  function paintFailed(err) {
    var h = host();
    if (!h) return;
    var tooWide = err && (err.code === 'overbilled_window_too_wide' || err.status === 422);
    h.innerHTML = headHtml() +
      (tooWide
        ? '<p class="obl-refused" role="status" data-overbilled-too-wide>' + C.esc(C.failedWords(err, state.days)) + '</p>'
        : table('<tr><td colspan="4" class="empty-state" data-overbilled-failed>' + C.esc(C.failedWords(err, state.days)) + '</td></tr>'));
  }

  function paint(ans) {
    var h = host();
    if (!h) return;
    var note = C.esc(C.windowWords(ans.days || state.days, ans.from)) + ' ' +
      C.esc(C.summary(ans)) + '. Amounts are ex GST.';
    var body = ans.rows.length
      ? ans.rows.map(C.rowHtml).join('')
      : '<tr><td colspan="4" class="empty-state" data-overbilled-empty>No job billed in the window is over its agreed amount.</td></tr>';
    h.innerHTML = headHtml() + '<p class="obl-note" data-overbilled-note>' + note + '</p>' +
      table(body) + apartHtml(ans.apart);
  }

  function wire() {
    var h = host();
    if (!h || h.__oblWired) return;
    h.__oblWired = true;
    h.addEventListener('click', function (e) {
      var show = e.target.closest('[data-overbilled-show]');
      if (show) { state.shown = true; load(); return; }
      var a = e.target.closest('[data-overbilled-job]');
      if (!a) return;
      e.preventDefault();
      var id = a.getAttribute('data-overbilled-job');
      if (id && typeof window.openJobDetail === 'function') window.openJobDetail(id);
    });
    h.addEventListener('change', function (e) {
      var sel = e.target.closest && e.target.closest('[data-overbilled-window]');
      if (!sel) return;
      state.days = C.windowDays(sel.value);
      // Before the press a window change only picks; after it, it reads again.
      if (state.shown) load(); else paintIdle();
    });
  }

  // Called on every open of the Work Orders tab: paints the press, reads nothing,
  // and drops any read still in flight from an earlier open.
  function mount() {
    if (!host()) return;
    injectCss();
    wire();
    state.seq++;
    state.shown = false;
    paintIdle();
  }

  async function load() {
    if (!host()) return;
    injectCss();
    wire();
    var my = ++state.seq;
    paintLoading();
    try {
      var data = await window.opsFetch('list_overbilled_job_work_orders', { days: state.days });
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

  return { mount: mount, load: load };
})();

window.OverbilledCore = OverbilledCore;
window.Overbilled = Overbilled;
