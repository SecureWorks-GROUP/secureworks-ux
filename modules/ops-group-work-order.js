// Office view of a group work order: the pot, every share, and the client's
// ratings. Paints nothing for a trade role, and nothing on any error.
// The office read runs only after the server has said the switch is on.
// Reopen the split is the only write. Nothing here sends.
(function () {
  'use strict';
  var TRADE_ROLES = { installer: 1, lead_installer: 1, crew: 1, trade: 1, subcontractor: 1 };
  var bound = false;
  var shownJobId = '';

  function core() { return window.GroupWorkOrderCore; }

  function role() {
    try {
      var cloud = window.SECUREWORKS_CLOUD;
      if (cloud && cloud.auth && typeof cloud.auth.getRole === 'function') return String(cloud.auth.getRole() || '').toLowerCase();
    } catch (e) { /* empty role stays office */ }
    return '';
  }

  function host() {
    var found = document.querySelector('#jdOverview [data-office-group-wo]');
    if (found) return found;
    var root = document.getElementById('jdOverview');
    if (!root) return null;
    var el = document.createElement('div');
    el.setAttribute('data-office-group-wo', '');
    root.appendChild(el);
    return el;
  }

  function css() {
    if (document.getElementById('officeGroupWoCss')) return;
    var style = document.createElement('style');
    style.id = 'officeGroupWoCss';
    style.textContent = '[data-office-group-wo-card]{margin:0 0 12px;padding:12px;border:1px solid var(--sw-border,#e5e7eb);background:var(--sw-card,#fff)}' +
      '[data-office-group-wo-card] .gwo-title{font-size:13px;font-weight:700;margin-bottom:6px}' +
      '[data-office-group-wo-card] li{font-size:13px;margin:2px 0}';
    document.head.appendChild(style);
  }

  function paint(data) {
    var C = core();
    var el = host();
    if (!el) return;
    if (!C || TRADE_ROLES[role()] || !data || !data.job || typeof opsFetch !== 'function') {
      el.innerHTML = '';
      return;
    }
    if (!C.switchOn(data)) {
      if (!data || !data.job || String(data.job.id) !== shownJobId) { el.innerHTML = ''; return; }
    } else {
      shownJobId = String(data.job.id);
    }
    css();
    var jobId = data.job.id;
    opsFetch('group_work_order_office', { job_id: jobId }).then(function (res) {
      if (!host() || (data.job && data.job.id !== jobId)) return;
      if (C.isOff(res) || !res || !res.group_id) { host().innerHTML = ''; return; }
      host().innerHTML = C.officeHtml(res);
      host().setAttribute('data-group-id', res.group_id);
    }).catch(function () {
      var box = host();
      if (box) box.innerHTML = '';
    });
  }

  function onClick(ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('[data-group-wo-unfreeze]');
    if (!btn) return;
    var box = btn.closest('[data-office-group-wo]');
    var C = core();
    if (!box || !C || typeof opsPost !== 'function') return;
    var groupId = box.getAttribute('data-group-id') || '';
    opsPost('unfreeze_group_work_order', { group_id: groupId }).then(function () {
      var data = (typeof _currentJobData !== 'undefined' && _currentJobData) || null;
      paint(data);
    }).catch(function () { box.innerHTML = ''; });
  }

  if (!bound) {
    bound = true;
    document.addEventListener('click', onClick);
  }

  window.GroupWorkOrderOffice = { paint: paint };
})();
