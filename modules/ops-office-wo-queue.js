// Office queue of blank and draft job work orders (backend
// list_office_job_work_orders, fill_job_work_order_allowance,
// approve_office_job_work_order). Flag job_work_order_office_fill_v1.
// While that flag is off, or the action is not deployed, this paints nothing.
// A failed read always clears the queue. The error line is shown only after
// a successful read has said the switch is on.
// No send control: a job work order is approved, not sent.
//
// <office-wo-fill-core>
var OfficeWoFillCore = (function () {
  'use strict';

  var TRADE_ROLES = { installer: 1, lead_installer: 1, crew: 1, trade: 1, subcontractor: 1 };

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var neg = v < 0;
    var parts = Math.abs(Math.round(v * 100) / 100).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts[0] + '.' + parts[1];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function isTradeRole(role) {
    return !!TRADE_ROLES[String(role || '').toLowerCase()];
  }

  // The queue is absent when the server says the flag is off, or the action
  // is not deployed yet. A real read failure is not this.
  function isOff(res, err) {
    if (res && res.enabled === false) return true;
    if (!err) return false;
    var code = String(err.code || '');
    var msg = String(err.message || '');
    return code === 'unknown_action' || /unknown action/i.test(msg);
  }

  function fillBody(row, amount) {
    return {
      work_order_id: row.id,
      expected_updated_at: row.updated_at,
      agreed_labour_ex: amount
    };
  }

  function approveBody(row) {
    return {
      work_order_id: row.id,
      expected_updated_at: row.updated_at
    };
  }

  function parseAllowance(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return { error: 'Set the labour allowance. Use 0 when there is none.' };
    var amount = Number(text);
    if (!isFinite(amount) || amount < 0) return { error: 'The labour allowance must be zero or more.' };
    return { amount: Math.round(amount * 100) / 100 };
  }

  // The queue holds every job type's drafts in one list (fencing, patio,
  // repair, make-safe and the rest), oldest first. The type buttons let the
  // office see one type at a time, so a repair is not lost among make-safes.
  // They are drawn only when the list holds more than one type.
  var TYPE_ORDER = ['fencing', 'patio', 'repair', 'makesafe', 'other'];
  var TYPE_WORDS = { fencing: 'Fencing', patio: 'Patio', repair: 'Repair', makesafe: 'Make-safe', other: 'Other' };

  function typeKey(row) {
    var t = String((row && row.job_type) || '').trim().toLowerCase();
    if (t === 'fencing' || t === 'patio' || t === 'repair') return t;
    if (t === 'makesafe' || t === 'makesafes' || t === 'make-safe' || t === 'make safe') return 'makesafe';
    return 'other';
  }

  function typeCounts(rows) {
    var counts = {};
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row) return;
      var k = typeKey(row);
      counts[k] = (counts[k] || 0) + 1;
    });
    return TYPE_ORDER.filter(function (k) { return counts[k] > 0; }).map(function (k) {
      return { key: k, label: TYPE_WORDS[k], count: counts[k] };
    });
  }

  // The type on screen: the one asked for while it still has a draft,
  // otherwise every type. A type whose last draft was just approved never
  // leaves an empty list behind.
  function activeType(rows, wanted) {
    var w = String(wanted || '').toLowerCase();
    var has = typeCounts(rows).some(function (c) { return c.key === w; });
    return has ? w : 'all';
  }

  function typeButtonsHtml(rows, active) {
    var counts = typeCounts(rows);
    if (counts.length < 2) return '';
    var total = counts.reduce(function (n, c) { return n + c.count; }, 0);
    var h = '<div class="owf-types" data-office-wo-types role="group" aria-label="Show one job type">';
    [{ key: 'all', label: 'All', count: total }].concat(counts).forEach(function (c) {
      h += '<button type="button" class="owf-type" data-office-wo-type="' + esc(c.key) + '" aria-pressed="' +
        (c.key === active ? 'true' : 'false') + '">' + esc(c.label) + ' (' + c.count + ')</button>';
    });
    return h + '</div>';
  }

  function queueHtml(rows, wantedType) {
    var all = Array.isArray(rows) ? rows : [];
    var active = activeType(all, wantedType);
    var list = active === 'all' ? all : all.filter(function (row) { return row && typeKey(row) === active; });
    var h = '<section class="owf" data-office-wo-fill-queue aria-label="Work orders to fill">';
    h += '<div class="owf-title">Work orders to fill</div>';
    if (!all.length) {
      h += '<div class="owf-empty" data-office-wo-fill-empty>No draft job work orders to fill.</div></section>';
      return h;
    }
    h += typeButtonsHtml(all, active);
    list.forEach(function (row) {
      if (!row) return;
      var needs = row.needs_allowance === true || row.agreed_labour_ex == null;
      var amount = needs ? '' : money(row.agreed_labour_ex);
      h += '<article class="owf-row" data-office-wo-fill="' + esc(row.id) + '" data-updated-at="' + esc(row.updated_at || '') + '" data-needs-allowance="' + (needs ? '1' : '0') + '">';
      h += '<div class="owf-id"><b>' + esc(row.wo_number || 'Draft') + '</b>';
      h += ' <span>' + esc(row.job_number || '') + '</span>';
      if (row.job_type) h += ' <span>' + esc(row.job_type) + '</span>';
      h += '</div>';
      h += '<div class="owf-who">' + esc(row.client_name || 'Client') + (row.site_suburb ? ' · ' + esc(row.site_suburb) : '') + '</div>';
      h += '<label class="owf-allow">Labour allowance';
      h += '<input data-office-wo-allowance inputmode="decimal" value="' + esc(needs ? '' : String(row.agreed_labour_ex)) + '" aria-label="Labour allowance">';
      h += '</label>';
      h += '<div class="owf-fig" data-office-wo-allowance-shown>' + (needs ? 'Needs a labour allowance' : esc(amount)) + '</div>';
      h += '<div class="owf-actions">';
      h += '<button type="button" class="btn btn-secondary btn-sm" data-office-wo-fill-save>Save allowance</button>';
      if (!needs) h += '<button type="button" class="btn btn-primary btn-sm" data-office-wo-fill-approve>Approve</button>';
      h += '</div>';
      h += '<div class="owf-msg" data-office-wo-fill-msg hidden></div>';
      h += '</article>';
    });
    h += '</section>';
    return h;
  }

  return {
    money: money,
    isTradeRole: isTradeRole,
    isOff: isOff,
    fillBody: fillBody,
    approveBody: approveBody,
    parseAllowance: parseAllowance,
    typeKey: typeKey,
    typeCounts: typeCounts,
    activeType: activeType,
    queueHtml: queueHtml
  };
})();
// </office-wo-fill-core>

(function () {
  'use strict';
  var C = OfficeWoFillCore;
  var bound = false;
  var switchOn = false;
  var lastRows = [];
  var TYPE_KEY = 'sw_owf_type';
  var typeWanted = 'all';
  // The chosen type is a per-browser convenience only. Storage can be
  // unavailable or throw, so every read and write is guarded.
  try { typeWanted = String(window.localStorage.getItem(TYPE_KEY) || 'all'); } catch (e) { typeWanted = 'all'; }

  function chooseType(key) {
    typeWanted = String(key || 'all');
    try { window.localStorage.setItem(TYPE_KEY, typeWanted); } catch (e) { /* not remembered */ }
    var el = host();
    if (el && switchOn) el.innerHTML = C.queueHtml(lastRows, typeWanted);
  }

  function noteSwitch(res) {
    if (res && (res.enabled === true || (res.enabled !== false && Array.isArray(res.work_orders)))) {
      switchOn = true;
      return;
    }
    switchOn = false;
  }

  function role() {
    try {
      var cloud = window.SECUREWORKS_CLOUD;
      if (cloud && cloud.auth && typeof cloud.auth.getRole === 'function') return String(cloud.auth.getRole() || '');
    } catch (e) { /* empty role stays office */ }
    return '';
  }

  function host() {
    return document.getElementById('officeWoFill');
  }

  function clear() {
    var el = host();
    if (el) el.innerHTML = '';
  }

  function showMsg(rowEl, text) {
    var msg = rowEl && rowEl.querySelector('[data-office-wo-fill-msg]');
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || '';
  }

  async function onClick(ev) {
    var typeBtn = ev.target.closest('[data-office-wo-type]');
    if (typeBtn) { chooseType(typeBtn.getAttribute('data-office-wo-type')); return; }
    var save = ev.target.closest('[data-office-wo-fill-save]');
    var approve = ev.target.closest('[data-office-wo-fill-approve]');
    if (!save && !approve) return;
    var rowEl = ev.target.closest('[data-office-wo-fill]');
    if (!rowEl || typeof opsPost !== 'function') return;
    var id = rowEl.getAttribute('data-office-wo-fill');
    var input = rowEl.querySelector('[data-office-wo-allowance]');
    var stamp = rowEl.getAttribute('data-updated-at') || '';
    var row = { id: id, updated_at: stamp };
    try {
      if (save) {
        var parsed = C.parseAllowance(input && input.value);
        if (parsed.error) { showMsg(rowEl, parsed.error); return; }
        await opsPost('fill_job_work_order_allowance', C.fillBody(row, parsed.amount));
      } else {
        await opsPost('approve_office_job_work_order', C.approveBody(row));
      }
      await paint();
    } catch (e) {
      if (C.isOff(null, e)) { switchOn = false; clear(); return; }
      showMsg(rowEl, (e && e.message) || 'That could not be saved.');
    }
  }

  function bind() {
    var el = host();
    if (!el || bound) return;
    bound = true;
    el.addEventListener('click', onClick);
    if (!document.getElementById('officeWoFillCss')) {
      var style = document.createElement('style');
      style.id = 'officeWoFillCss';
      style.textContent = '.owf{margin:0 0 16px;padding:12px;background:var(--sw-card,#fff);border:1px solid var(--sw-border,#e5e7eb)}' +
        '.owf-title{font-size:13px;font-weight:700;margin-bottom:8px}.owf-row{padding:10px 0;border-top:1px solid var(--sw-border,#e5e7eb)}' +
        '.owf-who,.owf-fig,.owf-msg{font-size:12px;color:var(--sw-text-sec,#4b5563);margin-top:4px}' +
        '.owf-allow{display:block;font-size:12px;margin-top:8px}.owf-allow input{display:block;margin-top:4px;padding:6px 8px;width:140px}' +
        '.owf-actions{display:flex;gap:8px;margin-top:8px}' +
        '.owf-types{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}' +
        '.owf-type{font:inherit;font-size:12px;padding:5px 10px;border-radius:999px;border:1px solid var(--sw-border,#e5e7eb);background:var(--sw-card,#fff);color:var(--sw-text,#1a2332);cursor:pointer}' +
        '.owf-type[aria-pressed="true"]{background:var(--sw-dark,#293c46);border-color:var(--sw-dark,#293c46);color:#fff;font-weight:700}' +
        '.owf-type:focus-visible{outline:2px solid var(--sw-orange,#f15a29);outline-offset:2px}';
      document.head.appendChild(style);
    }
  }

  async function paint() {
    bind();
    if (C.isTradeRole(role())) { clear(); return; }
    if (typeof opsFetch !== 'function') { clear(); return; }
    try {
      var res = await opsFetch('list_office_job_work_orders');
      var el = host();
      if (!el) return;
      if (C.isOff(res)) { switchOn = false; el.innerHTML = ''; return; }
      noteSwitch(res);
      lastRows = (res && Array.isArray(res.work_orders)) ? res.work_orders : [];
      el.innerHTML = C.queueHtml(lastRows, typeWanted);
    } catch (e) {
      clear();
      if (C.isOff(null, e)) { switchOn = false; return; }
      if (!switchOn) return;
      var elFail = host();
      if (elFail) elFail.innerHTML = '<div data-office-wo-fill-error>Work orders to fill could not be read.</div>';
    }
  }

  window.OfficeWoFill = { paint: paint, core: C };
})();
