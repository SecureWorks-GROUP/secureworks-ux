// Financials > Work Orders: every job work order in one list, like Quotes and
// Invoices (Marnin, 16 Nov 2026: "Work orders should be a database type of
// setting in ops dash just like quotes invoices").
//
// Reads:  ops-api list_work_orders?kind=job once per open of the tab. Each
//         approved row with its agreed labour carries `cap` (secureworks-backend
//         work_order_total_cap.ts withWorkOrderCaps): allowed (agreed plus
//         approved customer variations), billed by every trade, left, billed
//         in full and over. That is the rule the invoice doors refuse by, so
//         this list and a refusal never disagree. The page works out no figure.
// Writes: none. A row opens the job's work order panel (JobWorkOrderOps
//         .openForJob). A draft's "Set amount" scrolls to its row in the
//         office fill queue (modules/ops-office-wo-queue.js), which owns the
//         fill and approve writes.
// A failed read says so and never draws an empty list. A cap the server could
// not read is "Not read", never $0.00.
//
// <work-orders-list-core>
var WorkOrdersListCore = (function () {
  'use strict';

  var TYPE_LABELS = {
    fencing: 'Fencing', patio: 'Patio', decking: 'Decking', makesafe: 'Make safe',
    repair: 'Repair', general: 'General', miscellaneous: 'Private', restoration: 'Restoration'
  };

  var STATUS_WORDS = {
    needs_amount: 'Needs an amount',
    draft: 'Draft',
    approved: 'Approved',
    billed_in_full: 'Billed in full',
    over: 'Over the work order'
  };

  var FILTERS = ['all', 'needs_amount', 'draft', 'approved', 'billed_in_full', 'over'];

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

  function cap(row) {
    return row && row.cap && typeof row.cap === 'object' ? row.cap : null;
  }

  // One status per row, from the row and its cap only.
  function statusOf(row) {
    var s = String(row && row.status || '').toLowerCase();
    if (s !== 'approved') {
      return num(row && row.agreed_labour_ex) === null ? 'needs_amount' : 'draft';
    }
    var c = cap(row);
    if (c && c.over === true) return 'over';
    if (c && c.billed_in_full === true) return 'billed_in_full';
    return 'approved';
  }

  // A filter chip matches its own status; Draft also takes drafts that still
  // need an amount, and Approved takes every approved row.
  function matchesFilter(row, filter) {
    if (!filter || filter === 'all') return true;
    var st = statusOf(row);
    if (filter === 'draft') return st === 'draft' || st === 'needs_amount';
    if (filter === 'approved') return st === 'approved' || st === 'billed_in_full' || st === 'over';
    return st === filter;
  }

  function matchesSearch(row, q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return true;
    var hay = [row.wo_number, row.job_number, row.client_name, row.site_suburb, row.site_address]
      .map(function (v) { return String(v || '').toLowerCase(); }).join(' ');
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function matchesType(row, type) {
    if (!type || type === 'all') return true;
    return String(row.job_type || '').toLowerCase() === type;
  }

  function visible(rows, view) {
    view = view || {};
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && matchesFilter(r, view.filter) && matchesType(r, view.type) && matchesSearch(r, view.search);
    });
  }

  function counts(rows) {
    var out = { all: 0, needs_amount: 0, draft: 0, approved: 0, billed_in_full: 0, over: 0 };
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r) return;
      out.all++;
      FILTERS.forEach(function (f) { if (f !== 'all' && matchesFilter(r, f)) out[f]++; });
    });
    return out;
  }

  function types(rows) {
    var seen = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var t = String(r && r.job_type || '').toLowerCase();
      if (t) seen[t] = true;
    });
    return Object.keys(seen).sort();
  }

  function typeLabel(t) {
    t = String(t || '').toLowerCase();
    return TYPE_LABELS[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : '-');
  }

  // Totals over approved rows only. Billed and left are summed only when every
  // approved row's cap was read; otherwise they are not known.
  function totals(rows, capRead) {
    var approved = (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && String(r.status || '').toLowerCase() === 'approved';
    });
    var allowed = 0, billed = 0, known = capRead === 'ok';
    approved.forEach(function (r) {
      var c = cap(r);
      if (!c) { if (num(r.agreed_labour_ex) !== null) known = false; return; }
      allowed += num(c.allowed_ex) || 0;
      billed += num(c.billed_ex) || 0;
    });
    return {
      approved: approved.length,
      allowed: known ? Math.round(allowed * 100) / 100 : null,
      billed: known ? Math.round(billed * 100) / 100 : null
    };
  }

  function badgeClass(st) {
    if (st === 'over') return 'overdue';
    if (st === 'billed_in_full') return 'paid';
    if (st === 'approved') return 'approved';
    return 'draft';
  }

  function capCells(row, capRead) {
    var st = String(row.status || '').toLowerCase();
    var c = cap(row);
    if (st !== 'approved' || num(row.agreed_labour_ex) === null) {
      return '<td class="wol-num">-</td><td class="wol-num">-</td><td class="wol-num">-</td>';
    }
    if (!c) {
      var why = capRead === 'failed' ? 'Not read' : 'Not known';
      return '<td class="wol-num wol-muted">' + why + '</td><td class="wol-num wol-muted">' + why + '</td><td class="wol-num wol-muted">' + why + '</td>';
    }
    var added = (num(c.allowed_ex) || 0) - (num(row.agreed_labour_ex) || 0);
    var left = num(c.remaining_ex);
    return '<td class="wol-num" data-sort="' + esc(added) + '">' + (Math.abs(added) >= 0.005 ? money(added) : '-') + '</td>' +
      '<td class="wol-num" data-wo-billed data-sort="' + esc(num(c.billed_ex)) + '">' + money(c.billed_ex) + '</td>' +
      '<td class="wol-num' + (left !== null && left < 0 ? ' wol-over' : '') + '" data-wo-left data-sort="' + esc(left) + '">' + money(left) + '</td>';
  }

  function rowHtml(row, capRead, fmtDay) {
    var st = statusOf(row);
    var agreed = num(row.agreed_labour_ex);
    var day = row.approved_at || row.created_at || '';
    var h = '<tr class="wol-row" data-wo-row="' + esc(row.id) + '" data-wo-status="' + st + '" data-job-id="' + esc(row.job_id) + '" tabindex="0">';
    h += '<td><strong>' + esc(row.wo_number || '-') + '</strong></td>';
    h += '<td>' + esc(row.job_number || '-') + '</td>';
    h += '<td>' + esc(row.client_name || '-') + '</td>';
    h += '<td>' + esc(row.site_suburb || '-') + '</td>';
    h += '<td>' + esc(typeLabel(row.job_type)) + '</td>';
    h += '<td><span class="status-badge ' + badgeClass(st) + '">' + esc(STATUS_WORDS[st]) + '</span></td>';
    h += '<td class="wol-num" data-sort="' + esc(agreed) + '">' + (agreed === null ? '<span class="wol-muted">Not set</span>' : money(agreed)) + '</td>';
    h += capCells(row, capRead);
    h += '<td data-sort="' + esc(String(day).slice(0, 10)) + '">' + (day && typeof fmtDay === 'function' ? esc(fmtDay(String(day).slice(0, 10))) : esc(String(day).slice(0, 10) || '-')) + '</td>';
    h += '<td>';
    if (st === 'needs_amount' || st === 'draft') {
      h += '<button type="button" class="btn btn-secondary btn-sm" data-wo-set-amount="' + esc(row.id) + '">' + (st === 'needs_amount' ? 'Set amount' : 'Approve') + '</button>';
    }
    h += '</td></tr>';
    return h;
  }

  function statsHtml(rows, capRead) {
    var c = counts(rows);
    var t = totals(rows, capRead);
    var notKnown = '<span class="wol-muted">Not known</span>';
    function card(label, value, extra) {
      return '<div class="stat-card' + (extra || '') + '"><div class="stat-body"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div></div></div>';
    }
    return card('Approved', String(t.approved)) +
      card('Allowed on approved', t.allowed === null ? notKnown : money(t.allowed)) +
      card('Billed by trades', t.billed === null ? notKnown : money(t.billed)) +
      card('Need an amount', String(c.needs_amount), c.needs_amount > 0 ? ' rag-amber' : '') +
      card('Over the work order', String(c.over), c.over > 0 ? ' rag-red' : ' rag-green');
  }

  return {
    statusOf: statusOf, matchesFilter: matchesFilter, visible: visible, counts: counts,
    types: types, typeLabel: typeLabel, totals: totals, rowHtml: rowHtml, statsHtml: statsHtml,
    money: money, FILTERS: FILTERS, STATUS_WORDS: STATUS_WORDS
  };
})();
// </work-orders-list-core>

var WorkOrdersList = (function () {
  'use strict';
  var C = WorkOrdersListCore;
  var state = { rows: [], capRead: 'ok', loaded: false, failed: false, filter: 'all', type: 'all', search: '', seq: 0 };

  function el(id) { return document.getElementById(id); }

  function injectCss() {
    if (el('woListCss')) return;
    var s = document.createElement('style');
    s.id = 'woListCss';
    s.textContent =
      '#woJobTable .wol-num{text-align:right;font-family:var(--sw-font-num,inherit);white-space:nowrap}' +
      '#woJobTable .wol-muted,.wol-muted{color:var(--sw-text-sec,#6b7280)}' +
      '#woJobTable .wol-over{color:var(--sw-red,#c0392b);font-weight:600}' +
      '#woJobTable .wol-row{cursor:pointer}#woJobTable td:nth-child(-n+2){white-space:nowrap}' +
      '#woJobTable .wol-row:focus-visible{outline:2px solid var(--sw-orange,#f15a29);outline-offset:-2px}' +
      '.wol-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
      '.wol-bar select{font-size:12px;padding:4px 8px}' +
      '.wol-note{font-size:12px;color:var(--sw-text-sec,#6b7280);margin:6px 0 10px}' +
      '.wol-fold{margin-top:20px}.wol-fold>summary{cursor:pointer;font-weight:600;font-size:13px;padding:6px 0}' +
      '@media (max-width:700px){.wol-bar .filter-search{width:100%!important}}';
    document.head.appendChild(s);
  }

  function fmtDay(d) {
    return typeof window.fmtDate === 'function' ? window.fmtDate(d) : d;
  }

  function paintChips() {
    var c = C.counts(state.rows);
    document.querySelectorAll('[data-wo-filter]').forEach(function (b) {
      var f = b.getAttribute('data-wo-filter');
      b.classList.toggle('active', f === state.filter);
      var label = b.getAttribute('data-label') || b.textContent;
      b.setAttribute('data-label', label);
      b.textContent = state.loaded ? label + ' ' + (c[f] || 0) : label;
    });
    var sel = el('woTypeFilter');
    if (sel) {
      var cur = state.type;
      var opts = '<option value="all">All types</option>';
      C.types(state.rows).forEach(function (t) {
        opts += '<option value="' + t + '"' + (t === cur ? ' selected' : '') + '>' + C.typeLabel(t) + '</option>';
      });
      sel.innerHTML = opts;
      sel.value = cur;
    }
  }

  function paint() {
    var body = el('woJobTableBody');
    var stats = el('woJobStats');
    var note = el('woJobNote');
    if (!body) return;
    paintChips();
    if (state.failed) {
      if (stats) stats.innerHTML = '';
      body.innerHTML = '<tr><td colspan="12" class="empty-state" data-wo-job-failed>Work orders could not be read. Reopen this tab to try again.</td></tr>';
      if (note) note.textContent = '';
      return;
    }
    if (!state.loaded) {
      body.innerHTML = '<tr><td colspan="12" class="empty-state">Loading work orders...</td></tr>';
      return;
    }
    if (stats) stats.innerHTML = C.statsHtml(state.rows, state.capRead);
    if (note) {
      note.textContent = state.capRead === 'failed'
        ? 'What trades have billed could not be read, so Billed and Left say Not read.'
        : 'Amounts are ex GST. Billed counts every trade\'s invoices on the job except commission, the same rule that stops a trade billing over the work order.';
    }
    var rows = C.visible(state.rows, state);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="12" class="empty-state" data-wo-job-empty>' +
        (state.rows.length ? 'No work orders match.' : 'No job work orders yet.') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) { return C.rowHtml(r, state.capRead, fmtDay); }).join('');
  }

  function openRow(jobId) {
    if (!jobId) return;
    if (window.JobWorkOrderOps && typeof window.JobWorkOrderOps.openForJob === 'function') {
      window.JobWorkOrderOps.openForJob(jobId);
    } else if (typeof window.openJobDetail === 'function') {
      window.openJobDetail(jobId);
    }
  }

  function goToFill(woId) {
    var row = document.querySelector('[data-office-wo-fill="' + (window.CSS && CSS.escape ? CSS.escape(woId) : woId) + '"]');
    if (!row) {
      var r = state.rows.filter(function (x) { return x && String(x.id) === String(woId); })[0];
      if (r) openRow(r.job_id);
      return;
    }
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var input = row.querySelector('input');
    if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 300);
  }

  function wire() {
    var table = el('woJobTable');
    if (!table || table.__wolWired) return;
    table.__wolWired = true;
    table.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-wo-set-amount]');
      if (btn) { e.stopPropagation(); goToFill(btn.getAttribute('data-wo-set-amount')); return; }
      var tr = e.target.closest('[data-wo-row]');
      if (tr) openRow(tr.getAttribute('data-job-id'));
    });
    table.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var tr = e.target.closest && e.target.closest('[data-wo-row]');
      if (tr && !e.target.closest('button')) openRow(tr.getAttribute('data-job-id'));
    });
  }

  async function load() {
    injectCss();
    wire();
    var my = ++state.seq;
    state.failed = false;
    if (!state.loaded) paint();
    try {
      var data = await window.opsFetch('list_work_orders', { kind: 'job' });
      if (my !== state.seq) return;
      if (!data || !Array.isArray(data.work_orders)) throw new Error('no work orders in the answer');
      state.rows = data.work_orders;
      state.capRead = data.cap_read === 'ok' ? 'ok' : data.cap_read === 'failed' ? 'failed' : 'missing';
      state.loaded = true;
    } catch (e) {
      if (my !== state.seq) return;
      console.error('WorkOrdersList load error:', e);
      state.failed = true;
    }
    paint();
  }

  function setFilter(f) { state.filter = C.FILTERS.indexOf(f) === -1 ? 'all' : f; paint(); }
  function setType(t) { state.type = t || 'all'; paint(); }
  function setSearch(q) { state.search = String(q || ''); paint(); }

  return { load: load, paint: paint, setFilter: setFilter, setType: setType, setSearch: setSearch, _state: state };
})();

window.WorkOrdersListCore = WorkOrdersListCore;
window.WorkOrdersList = WorkOrdersList;
