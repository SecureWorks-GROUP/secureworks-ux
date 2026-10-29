// Office view of a group work order: the pot, every share, and the client's
// ratings. Paints nothing for a trade role, and nothing on any error.
// The office read runs only after the server has said the switch is on.
// Office sign-off records an attributed waiver; reopening the split is separate. Nothing here sends.
(function () {
  'use strict';
  var TRADE_ROLES = { installer: 1, lead_installer: 1, crew: 1, trade: 1, subcontractor: 1 };
  var bound = false;
  var shownJobId = '';

  function currentJob(jobId) {
    return shownJobId === String(jobId) &&
      (typeof _currentJobId === 'undefined' || String(_currentJobId) === String(jobId));
  }

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
      '[data-office-group-wo-card] li{font-size:13px;margin:2px 0}' +
      '[data-office-signoff-form] textarea{display:block;width:100%;max-width:40rem;min-height:5rem;margin:8px 0;padding:8px;font:inherit}' +
      '[data-office-signoff-form] button{min-height:44px;padding:8px 16px}';
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
    shownJobId = String(data.job.id);
    if (!C.switchOn(data)) { el.innerHTML = ''; return; }
    css();
    var jobId = data.job.id;
    opsFetch('group_work_order_office', { job_id: jobId }).then(function (res) {
      if (!host() || !currentJob(jobId)) return;
      if (C.isOff(res) || !res || !res.group_id) { host().innerHTML = ''; return; }
      host().innerHTML = C.officeHtml(res);
      host().setAttribute('data-group-id', res.group_id);
      host().setAttribute('data-job-id', jobId);
    }).catch(function () {
      if (!currentJob(jobId)) return;
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
    var jobId = box.getAttribute('data-job-id');
    if (!currentJob(jobId)) return;
    var groupId = box.getAttribute('data-group-id') || '';
    opsPost('unfreeze_group_work_order', { group_id: groupId }).then(function () {
      if (!currentJob(jobId)) return;
      var data = (typeof _currentJobData !== 'undefined' && _currentJobData) || null;
      paint(data);
    }).catch(function () { if (currentJob(jobId)) box.innerHTML = ''; });
  }

  function onSubmit(ev) {
    var form = ev.target && ev.target.closest && ev.target.closest('[data-office-signoff-form]');
    if (!form) return;
    ev.preventDefault();
    var box = form.closest('[data-office-group-wo]');
    if (!box || typeof opsPost !== 'function') return;
    var jobId = box.getAttribute('data-job-id');
    if (!currentJob(jobId)) return;
    var reason = (form.querySelector('[data-office-signoff-reason]').value || '').trim();
    var msg = box.querySelector('[data-office-group-message]');
    var btn = form.querySelector('button');
    if (reason.length < 3) { msg.textContent = 'Record who confirmed the approval and why the office is signing off.'; return; }
    btn.disabled = true;
    msg.textContent = 'Recording office sign-off...';
    opsPost('waive_client_signoff', { job_id: jobId, reason: reason }).then(function () {
      if (!currentJob(jobId)) return;
      paint((typeof _currentJobData !== 'undefined' && _currentJobData) || null);
    }).catch(function () {
      if (!currentJob(jobId)) return;
      btn.disabled = false;
      msg.textContent = 'The sign-off could not be confirmed. Refresh the job to check before trying again.';
    });
  }

  if (!bound) {
    bound = true;
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
  }

  window.GroupWorkOrderOffice = { paint: paint };
})();
