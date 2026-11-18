// Receipts sent by someone not booked on their job (backend #1656, #1662).
// The office sees each one with its mark and approves it only with a deliberate
// second press, which sends confirm_unbooked: true. Query and reject need no
// confirm. Nothing is approved in bulk and nothing is sent by default.
(function () {
  'use strict';
  var STATUSES = ['pending', 'queried'];
  var READ_LIMIT = 200;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(value) {
    var n = Number(value);
    return isFinite(n) ? '$' + n.toFixed(2) : 'Amount not read';
  }
  // Marked and not yet confirmed: the same rule as the server's expenseHeldNotBooked.
  function waiting(row) {
    if (!row || !row.id || !row.unbooked_job_id) return false;
    var status = String(row.status || '').toLowerCase();
    return status !== 'approved' && status !== 'pushed_to_xero' && status !== 'rejected';
  }
  // The server's own words; a bare machine code is never shown.
  function failure(err) {
    var body = (err && err.body) || {};
    var words = [body.userMessage, body.message, body.error].find(function (w) {
      return typeof w === 'string' && w.trim() && !/^[a-z0-9_]+$/.test(w.trim());
    });
    if (words) return words.trim();
    if (err && err.status === 403) return 'You do not have permission to approve this receipt.';
    return 'The office could not save this. Reload the list and check the receipt before trying again.';
  }
  function render(rows, phase, more) {
    var open = rows.filter(function (r) { return !r.finished; }).length;
    var h = '<div class="rc-wrap"><h2>Receipts to confirm' + (open ? ' <span class="rc-count" aria-label="' + open + ' waiting">' + open + '</span>' : '') + '</h2>' +
      '<p class="rc-lede">The person who sent each of these is not booked on its job. Check the job before approving.</p>';
    if (phase === 'loading') h += '<p role="status">Loading</p>';
    else if (phase === 'error') h += '<p role="alert">Could not load the receipts. Nothing is shown as waiting until they load.</p><button type="button" data-rc="retry">Try again</button>';
    else if (!rows.length) h += '<p>No receipt is waiting for a confirm.</p>';
    else rows.forEach(function (r) {
      var job = (r.jobs && r.jobs.job_number) || 'number not available';
      h += '<article class="rc-row" data-rc-id="' + esc(r.id) + '"><div class="rc-text">' +
        '<div class="rc-mark" data-rc-mark>Not booked on this job</div>' +
        '<div class="rc-summary">' + esc(r.vendor_name || 'Supplier not read') + ', ' + esc(money(r.total_amount)) + '</div>' +
        '<div class="rc-meta"><span>Job ' + esc(job) + '</span><span>Receipt date ' + esc(r.receipt_date || 'not read') + '</span>' +
        (String(r.status).toLowerCase() === 'queried' ? '<span>Queried</span>' : '') + '</div>';
      if (r.message) h += '<p class="rc-result" role="status">' + esc(r.message) + '</p>';
      if (r.mode === 'approve') {
        h += '<div class="rc-confirm" data-rc-confirm>The person who sent this receipt is not booked on job ' + esc(job) +
          '. Approving it puts it on that job\'s costs and lets it be paid back.' +
          '<div class="rc-actions"><button type="button" data-rc="confirm">Yes, approve on job ' + esc(job) + '</button><button type="button" data-rc="cancel">Cancel</button></div></div>';
      }
      if (r.mode === 'query' || r.mode === 'reject') {
        h += '<form class="rc-confirm" data-rc-form="' + r.mode + '"><label>' + (r.mode === 'query' ? 'What is the question?' : 'Why is it sent back?') +
          '<input name="reason" minlength="3" maxlength="500" required autocomplete="off"></label>' +
          '<button type="submit">' + (r.mode === 'query' ? 'Send question' : 'Send back') + '</button><button type="button" data-rc="cancel">Cancel</button></form>';
      }
      h += '</div>';
      if (!r.finished) {
        var off = r.busy || r.mode ? ' disabled' : '';
        h += '<div class="rc-actions"><button type="button" data-rc="approve"' + off + '>Approve</button><button type="button" data-rc="query"' + off + '>Query</button><button type="button" data-rc="reject"' + off + '>Send back</button></div>';
      }
      h += '</article>';
    });
    if (phase === 'list' && rows.some(function (r) { return r.finished; })) h += '<button type="button" data-rc="retry">Reload the list</button>';
    if (phase === 'list' && more) h += '<p class="rc-lede" role="status">More receipts may be waiting than this list shows. Clear these, then reload.</p>';
    return h + '</div>';
  }
  function create(host) {
    var root, rows = [], phase = 'loading', more = false, reading = false, owner = null, generation = 0;
    function active() { return !!(root && host.visible() && host.identity()); }
    function paint() {
      if (!root) return;
      // Hidden only when the office has nothing to do here; an error always shows.
      root.hidden = !active() || (phase === 'list' && !rows.length) || phase === 'loading';
      root.innerHTML = root.hidden ? '' : render(rows, phase, more);
    }
    async function refresh() {
      if (!active()) { generation++; owner = null; rows = []; phase = 'loading'; paint(); return; }
      var who = host.identity();
      if (owner !== who) { generation++; rows = []; owner = who; reading = false; }
      if (reading || rows.some(function (r) { return r.busy || r.mode; })) return;
      reading = true;
      var gen = generation;
      try {
        var answers = await Promise.all(STATUSES.map(function (status) {
          return host.read('list_expenses', { status: status, limit: READ_LIMIT });
        }));
        var next = [], full = false;
        answers.forEach(function (res) {
          if (!res || !Array.isArray(res.expenses)) throw new Error('Missing receipts');
          if (res.expenses.length >= READ_LIMIT) full = true;
          res.expenses.forEach(function (r) { if (waiting(r)) next.push(r); });
        });
        if (gen !== generation || who !== host.identity()) return;
        rows = next.sort(function (a, b) { return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0); });
        more = full; phase = 'list';
      } catch (_) {
        if (gen !== generation || who !== host.identity()) return;
        rows = []; phase = 'error';
      } finally {
        if (gen === generation) { reading = false; paint(); }
      }
    }
    async function press(id, action, reason) {
      if (!active() || host.identity() !== owner) { paint(); return; }
      if (action === 'retry') return refresh();
      var row = rows.find(function (r) { return r.id === id; });
      if (reading || !row || row.busy || row.finished) return;
      if (action === 'cancel') { row.mode = null; paint(); return; }
      if (action === 'approve' || action === 'query' || action === 'reject') { row.mode = action; row.message = null; paint(); return; }
      var body = { expense_id: row.id };
      if (action === 'confirm') {
        if (row.mode !== 'approve') return;
        body.confirm_unbooked = true;
      } else if (action === 'query_send' || action === 'reject_send') {
        var kind = action === 'query_send' ? 'query' : 'reject';
        var text = String(reason || '').trim();
        if (row.mode !== kind || text.length < 3 || text.length > 500) return;
        body.intent = kind === 'query' ? 'queried' : 'rejected';
        body[kind === 'query' ? 'query_reason' : 'rejection_reason'] = text;
      } else return;
      var who = owner;
      row.busy = true; row.mode = null; row.message = 'Saving'; paint();
      try {
        var res = await host.post('approve_expense', body);
        var want = body.intent || 'approved';
        if (!res || res.success !== true || res.status !== want) throw Object.assign(new Error('Unconfirmed'), { body: res });
        row.message = want === 'approved' ? 'Approved on job ' + ((row.jobs && row.jobs.job_number) || '') + '.' : want === 'queried' ? 'Question sent.' : 'Sent back.';
        row.finished = true;
      } catch (err) {
        // Nothing is retried on its own: a refusal or an unknown answer waits for a reload.
        row.message = failure(err); row.finished = true;
      }
      row.busy = false;
      if (who === host.identity()) paint(); else { rows = []; paint(); }
    }
    function mount(el) {
      root = el; if (!root) return;
      root.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-rc]');
        if (!b || !root.contains(b) || b.type === 'submit') return;
        var row = b.closest('[data-rc-id]');
        press(row && row.getAttribute('data-rc-id'), b.getAttribute('data-rc'));
      });
      root.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var row = ev.target.closest('[data-rc-id]');
        var kind = ev.target.getAttribute('data-rc-form');
        if (row && kind) press(row.getAttribute('data-rc-id'), kind + '_send', ev.target.elements.reason.value);
      });
      paint();
    }
    return { mount: mount, refresh: refresh, press: press };
  }
  if (typeof module !== 'undefined') module.exports = { create: create, render: render, failure: failure, waiting: waiting };
  if (typeof window === 'undefined') return;
  var host = {
    identity: function () {
      var auth = window.SECUREWORKS_CLOUD && window.SECUREWORKS_CLOUD.auth;
      if (!auth || !auth.isLoggedIn() || ['admin', 'owner', 'ops_manager'].indexOf(auth.getRole()) < 0) return null;
      var user = auth.getUser(); return user && user.id;
    },
    visible: function () {
      var view = document.getElementById('viewRecon');
      return document.visibilityState !== 'hidden' && !!(view && view.classList.contains('active'));
    },
    read: function (action, params) { return window.opsFetch(action, params); },
    post: function (action, body) { return window.opsPost(action, body); }
  };
  var api = create(host), timer = null;
  window.ReceiptConfirm = { refresh: api.refresh };
  function sync() {
    if (timer) { clearInterval(timer); timer = null; }
    api.refresh();
    if (host.visible() && host.identity()) timer = setInterval(api.refresh, 120000);
  }
  function start() {
    var root = document.getElementById('receiptConfirmRoot');
    if (!root) return;
    var style = document.createElement('style');
    style.textContent = '.rc-wrap{max-width:880px;margin:0 auto;padding:24px 16px;border-top:1px solid var(--sw-border,#ddd)}.rc-wrap h2{font-size:20px;margin:0 0 4px}.rc-lede,.rc-meta{color:var(--sw-text,#1a272e);font-size:13px}.rc-lede{margin:0 0 16px}.rc-count{font-size:12px;padding:3px 8px;background:#fff4e5;color:#8a4b00;border-radius:12px}.rc-row{display:flex;justify-content:space-between;gap:16px;padding:16px 0;border-top:1px solid var(--sw-border,#ddd)}.rc-text{min-width:0;flex:1;overflow-wrap:anywhere}.rc-mark{display:inline-block;font-size:12px;font-weight:700;padding:3px 8px;border-radius:6px;background:#fff4e5;color:#8a4b00;margin-bottom:6px}.rc-summary{font-size:15px;font-weight:600}.rc-meta{display:flex;gap:4px 12px;flex-wrap:wrap;margin-top:6px}.rc-actions{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}.rc-wrap button,.rc-wrap input{font:inherit;font-size:14px;border:1px solid var(--sw-border,#bbb);border-radius:8px;padding:10px 12px;background:var(--sw-card,#fff);color:var(--sw-text,#222)}.rc-wrap button{cursor:pointer;min-height:44px}.rc-wrap button:disabled{opacity:.5;cursor:default}.rc-wrap :focus-visible{outline:2px solid #1f5fbf;outline-offset:3px}.rc-confirm{margin-top:12px;padding:12px;background:#fff8ee;border-radius:8px;font-size:14px}.rc-confirm .rc-actions{margin-top:12px}.rc-confirm label,.rc-confirm input{display:block}.rc-confirm input{margin:8px 0;width:100%;box-sizing:border-box}.rc-confirm>button{margin-right:8px}.rc-result{font-size:14px;margin:12px 0 0}@media(max-width:599px){.rc-row{flex-direction:column;gap:12px}.rc-row>.rc-actions{width:100%;flex-direction:column}.rc-row>.rc-actions button{width:100%}}';
    document.head.appendChild(style); api.mount(root);
    new MutationObserver(sync).observe(document.getElementById('viewRecon'), { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', sync);
    var cloud = window.SECUREWORKS_CLOUD;
    if (cloud && cloud.on) { cloud.on('auth:login', sync); cloud.on('auth:logout', sync); }
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
