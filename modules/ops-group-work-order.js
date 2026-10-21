// Office view of a group work order: the pot, every share, and the client's
// ratings. Paints nothing for a trade role, an unknown action, or enabled: false.
// Reopen the split is the only write. Nothing here sends.
(function () {
  'use strict';
  var TRADE_ROLES = { installer: 1, lead_installer: 1, crew: 1, trade: 1, subcontractor: 1 };
  var bound = false;

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
    css();
    var jobId = data.job.id;
    opsFetch('group_work_order_office', { job_id: jobId }).then(function (res) {
      if (!host() || (data.job && data.job.id !== jobId)) return;
      // A catch-all stub answers {}. A real group always carries group_id.
      if (C.isOff(res) || !res || !res.group_id) { host().innerHTML = ''; return; }
      host().innerHTML = C.officeHtml(res);
      host().setAttribute('data-group-id', res.group_id);
    }).catch(function (e) {
      var box = host();
      if (!box) return;
      if (C.isOff(null, e) || (e && e.status === 403)) { box.innerHTML = ''; return; }
      if (C.errCode(e) === 'group_work_order_not_found') {
        box.innerHTML = '<p data-office-group-empty>No group work order on this job.</p>';
        return;
      }
      if (e && e.status === 404) { box.innerHTML = ''; return; }
      box.innerHTML = '<p data-office-group-error>The group work order could not be read.</p>';
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
    }).catch(function (e) {
      if (C.isOff(null, e)) { box.innerHTML = ''; return; }
      var msg = document.createElement('p');
      msg.setAttribute('data-office-group-msg', '');
      msg.textContent = (e && e.message) || 'The split could not be reopened.';
      box.appendChild(msg);
    });
  }

  if (!bound) {
    bound = true;
    document.addEventListener('click', onClick);
  }

  window.GroupWorkOrderOffice = { paint: paint };
})();
