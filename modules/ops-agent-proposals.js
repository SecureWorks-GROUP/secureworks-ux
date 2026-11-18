(function () {
  'use strict';
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function timeWords(value) {
    var d = new Date(value), now = new Date(), zone = { timeZone: 'Australia/Perth' };
    if (!value || !isFinite(d.getTime())) return 'Time not recorded';
    if (d.toLocaleDateString('en-AU', zone) === now.toLocaleDateString('en-AU', zone)) {
      return d.toLocaleTimeString('en-AU', Object.assign({}, zone, { hour: 'numeric', minute: '2-digit', hour12: true })).toLowerCase() + ' today';
    }
    return d.toLocaleDateString('en-AU', Object.assign({}, zone, { day: 'numeric', month: 'short', year: 'numeric' }));
  }
  function failure(err) {
    var detail = err.body && typeof err.body.message === 'string' && err.body.message.trim();
    if (detail) return detail;
    if (err.status === 403) return 'You do not have permission for this one. Ask an admin.';
    if (err.status === 409) return 'Someone has already decided this one.';
    if (err.status === 410) return 'This one has expired. Ask the agent again.';
    // Only the server can establish that a refused action changed nothing.
    if (err.body && err.body.changed === false) {
      return 'Could not be done: ' + String(err.body.error || err.message || 'the action was refused').replace(/\.$/, '') + '. Nothing was changed.';
    }
    return 'The action could not be confirmed. Check its records before asking again.';
  }
  function render(rows, phase) {
    var count = rows.filter(function (r) { return !r.finished; }).length;
    var h = '<div class="ap-wrap"><h2>Waiting for a press' + (count ? ' <span class="ap-count" aria-label="' + count + ' pending">' + count + '</span>' : '') + '</h2>' +
      '<p class="ap-lede">An agent asked for these. Nothing has changed yet.</p>';
    if (phase === 'loading') h += '<p role="status">Loading</p>';
    else if (phase === 'error') h += '<p role="alert">Could not load. Try again.</p><button type="button" data-ap="retry">Try again</button>';
    else if (!rows.length) h += '<p>Nothing is waiting for a press.</p>';
    else rows.forEach(function (r) {
      h += '<article class="ap-row" data-ap-id="' + esc(r.id) + '"><div class="ap-text"><div class="ap-summary">' + esc(r.summary) + '</div><div class="ap-meta">' +
        (r.job_id ? '<span>Job ' + esc(r.job_number || 'number not available') + '</span>' : '') +
        '<span>Asked by ' + esc(r.actor || 'agent') + '</span><span>' + esc(timeWords(r.created_at)) + '</span></div>';
      if (r.message) h += '<p class="ap-result" role="status">' + esc(r.message) + '</p>';
      if (r.mode === 'carry') h += '<div class="ap-confirm">Carry out: ' + esc(r.summary) + '<div class="ap-actions"><button type="button" data-ap="yes">Yes, carry out</button><button type="button" data-ap="cancel">Cancel</button></div></div>';
      if (r.mode === 'decline') h += '<form class="ap-confirm"><label>Why? (a few words)<input name="reason" minlength="3" maxlength="300" required autocomplete="off"></label><button type="submit" data-ap="no">Decline</button><button type="button" data-ap="cancel">Cancel</button></form>';
      h += '</div>';
      if (!r.finished) h += '<div class="ap-actions"><button type="button" data-ap="carry"' + (r.busy || r.mode ? ' disabled' : '') + '>Carry out</button><button type="button" data-ap="decline"' + (r.busy || r.mode ? ' disabled' : '') + '>Decline</button></div>';
      h += '</article>';
    });
    return h + '</div>';
  }
  function create(host) {
    var root, rows = [], phase = 'loading', reading = false, owner = null, generation = 0, denied = false;
    function active() { return !!(root && host.enabled() && host.visible() && host.identity()); }
    function paint() {
      if (!root) return;
      root.hidden = denied || !active();
      root.innerHTML = root.hidden ? '' : render(rows, phase);
    }
    async function refresh() {
      if (!active()) { generation++; owner = null; rows = []; paint(); return; }
      var who = host.identity();
      if (owner !== who) { generation++; rows = []; owner = who; reading = false; }
      if (reading || rows.some(function (r) { return r.busy || r.mode; })) return;
      reading = true; denied = false;
      var gen = generation;
      phase = 'loading'; paint();
      try {
        var res = await host.read('list_agent_proposals', { status: 'pending', limit: 100 });
        if (!res || !Array.isArray(res.proposals)) throw new Error('Missing proposals');
        var next = res.proposals.map(function (p) {
          if (!p || !p.id || typeof p.summary !== 'string') throw new Error('Missing proposal');
          return {
            id: p.id, summary: p.summary, actor: p.actor, created_at: p.created_at,
            job_id: p.job_id, job_number: p.job_number
          };
        }).sort(function (a, b) { return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0); });
        // Firstmate authorized the existing job_detail read, deduplicated in batches of four.
        var ids = Array.from(new Set(next.filter(function (r) { return r.job_id && !r.job_number; }).map(function (r) { return r.job_id; })));
        for (var i = 0; i < ids.length; i += 4) {
          if (gen !== generation || who !== host.identity() || !active()) return;
          await Promise.all(ids.slice(i, i + 4).map(async function (id) {
            try {
              var detail = await host.read('job_detail', { jobId: id });
              var job = detail && (detail.job || detail);
              next.forEach(function (r) { if (r.job_id === id) r.job_number = job && job.job_number; });
            } catch (_) { /* The row names the missing number; never substitute a UUID. */ }
          }));
        }
        if (gen !== generation || who !== host.identity()) return;
        rows = next; phase = 'list';
      } catch (err) {
        if (gen !== generation || who !== host.identity()) return;
        rows = []; phase = 'error'; denied = err.status === 401 || err.status === 403;
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
      if (action === 'carry' || action === 'decline') { row.mode = action; paint(); return; }
      if (action !== 'yes' && action !== 'no') return;
      if ((action === 'yes' && row.mode !== 'carry') || (action === 'no' && row.mode !== 'decline')) return;
      if (action === 'no' && (String(reason || '').trim().length < 3 || String(reason).trim().length > 300)) return;
      var who = owner, body = { proposal_id: row.id };
      if (action === 'no') body.reason = String(reason).trim();
      row.busy = true; row.mode = null; row.message = 'Working'; paint();
      try {
        var res = await host.post(action === 'yes' ? 'carry_out_agent_proposal' : 'decline_agent_proposal', body);
        if (!res || res.ok !== true || res.status !== (action === 'yes' ? 'carried_out' : 'declined')) {
          throw Object.assign(new Error('Unconfirmed outcome'), { body: res });
        }
        row.message = action === 'yes' ? 'Done.' : 'Declined.';
      } catch (err) { row.message = failure(err); }
      // Only a fresh pending list can offer this proposal again.
      row.busy = false; row.finished = true;
      if (who === host.identity()) paint(); else { rows = []; paint(); }
    }
    function mount(el) {
      root = el; if (!root) return;
      root.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-ap]');
        if (!b || !root.contains(b) || b.type === 'submit') return;
        var row = b.closest('[data-ap-id]');
        press(row && row.getAttribute('data-ap-id'), b.getAttribute('data-ap'));
      });
      root.addEventListener('submit', function (ev) {
        ev.preventDefault(); var row = ev.target.closest('[data-ap-id]');
        if (row) press(row.getAttribute('data-ap-id'), 'no', ev.target.elements.reason.value);
      });
      paint();
    }
    return { mount: mount, refresh: refresh, open: refresh, press: press };
  }
  if (typeof module !== 'undefined') module.exports = { create: create, render: render, failure: failure, timeWords: timeWords };
  if (typeof window === 'undefined') return;
  var host = {
    // Local preview switch stays off until the release and staff-notice gates are cleared.
    enabled: function () {
      var q = new URLSearchParams(window.location.search);
      if (q.has('proposals')) return q.get('proposals') === '1';
      try { return localStorage.getItem('sw_agent_proposals') === '1'; } catch (_) { return false; }
    },
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
  window.AgentProposals = { mount: api.mount, refresh: api.refresh, open: api.open };
  function sync() {
    if (timer) { clearInterval(timer); timer = null; }
    if (host.enabled() && host.visible() && host.identity()) {
      api.open(); timer = setInterval(api.refresh, 120000);
    } else api.refresh();
  }
  function start() {
    var root = document.getElementById('agentProposalsRoot');
    if (!root) return;
    var style = document.createElement('style');
    style.textContent = '.ap-wrap{max-width:880px;margin:0 auto;padding:24px 16px;border-top:1px solid var(--sw-border,#ddd)}.ap-wrap h2{font-size:20px;margin:0 0 4px}.ap-lede,.ap-meta{color:var(--sw-text,#1a272e);font-size:13px}.ap-lede{margin:0 0 16px}.ap-count{font-size:12px;padding:3px 8px;background:#eef5ff;color:#1f5fbf;border-radius:12px}.ap-row{display:flex;justify-content:space-between;gap:16px;padding:16px 0;border-top:1px solid var(--sw-border,#ddd)}.ap-text{min-width:0;flex:1;overflow-wrap:anywhere}.ap-summary{font-size:15px;font-weight:600}.ap-meta{display:flex;gap:4px 12px;flex-wrap:wrap;margin-top:6px}.ap-actions{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}.ap-wrap button,.ap-wrap input{font:inherit;font-size:14px;border:1px solid var(--sw-border,#bbb);border-radius:8px;padding:10px 12px;background:var(--sw-card,#fff);color:var(--sw-text,#222)}.ap-wrap button{cursor:pointer;min-height:44px}.ap-wrap button:hover{background:#eef5ff}.ap-wrap button:disabled{opacity:.5;cursor:default}.ap-wrap :focus-visible{outline:2px solid #1f5fbf;outline-offset:3px}.ap-confirm{margin-top:12px;padding:12px;background:#f3f7ff;border-radius:8px}.ap-confirm .ap-actions{margin-top:12px}.ap-confirm label,.ap-confirm input{display:block}.ap-confirm input{margin:8px 0;max-width:100%;box-sizing:border-box;width:100%}.ap-confirm>button{margin-right:8px}.ap-result{font-size:14px;margin:12px 0 0}@media(max-width:599px){.ap-row{flex-direction:column;gap:12px}.ap-row>.ap-actions{width:100%;flex-direction:column}.ap-row>.ap-actions button{width:100%}}';
    document.head.appendChild(style); api.mount(root);
    new MutationObserver(sync).observe(document.getElementById('viewRecon'), { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', sync);
    var cloud = window.SECUREWORKS_CLOUD;
    if (cloud && cloud.on) { cloud.on('auth:login', sync); cloud.on('auth:logout', sync); }
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
