// Trade group work order: create, join, save hours, see Total and Your share.
// Paints nothing while the action is unknown or the server says enabled: false.
// Never posts a client send. Loaded by trade.html.
(function () {
  'use strict';
  var C = function () { return window.GroupWorkOrderCore; };
  var transport = null;
  var bound = false;

  function use(fn) { transport = fn; }

  function slot(jobId) {
    var nodes = document.querySelectorAll('[data-group-wo-slot]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-group-wo-slot') === String(jobId)) return nodes[i];
    }
    return null;
  }

  function css() {
    if (document.getElementById('groupWoTradeCss')) return;
    var style = document.createElement('style');
    style.id = 'groupWoTradeCss';
    style.textContent = '[data-group-wo]{margin:12px 0;padding:12px;border:1px solid var(--sw-border,#e5e7eb);background:var(--sw-card,#fff)}' +
      '.gwo-title{font-size:13px;font-weight:700;margin-bottom:6px}' +
      '[data-group-wo] label{display:block;font-size:12px;margin-top:8px}' +
      '[data-group-wo] input{display:block;margin-top:4px;padding:6px 8px}' +
      '[data-group-wo] button{margin-top:8px}';
    document.head.appendChild(style);
  }

  function call(action, params, body) {
    if (typeof transport !== 'function') return Promise.reject(new Error('Not connected'));
    return transport(action, params, body);
  }

  function paint(jobId) {
    var core = C();
    var el = slot(jobId);
    if (!core || !el) return Promise.resolve();
    css();
    return call('group_work_order_my_share', null, { job_id: jobId }).then(function (res) {
      if (core.isOff(res)) { el.innerHTML = ''; return; }
      el.setAttribute('data-group-id', (res && res.group_id) || '');
      el.innerHTML = core.tradeHtml(res && res.needs_hours ? 'hours' : 'share', res);
    }).catch(function (e) {
      if (!slot(jobId)) return;
      if (core.isOff(null, e)) { el.innerHTML = ''; return; }
      var code = core.errCode(e);
      if (code === 'group_work_order_not_found' || e.status === 404) {
        el.innerHTML = core.tradeHtml('create');
        return;
      }
      if (code === 'group_work_order_not_participant') {
        el.innerHTML = core.tradeHtml('join');
        return;
      }
      el.innerHTML = core.tradeHtml('error', null, (e && e.message) || 'That could not be read.');
    });
  }

  function slotHtml(jobId) {
    var id = String(jobId || '');
    if (!id) return '';
    Promise.resolve().then(function () { paint(id); });
    return '<div data-group-wo-slot="' + id.replace(/"/g, '') + '"></div>';
  }

  function showMsg(el, text) {
    var msg = el && el.querySelector('[data-group-wo-msg]');
    if (!msg) {
      msg = document.createElement('p');
      msg.setAttribute('data-group-wo-msg', '');
      var card = el && el.querySelector('[data-group-wo]');
      if (card) card.appendChild(msg);
    }
    if (msg) msg.textContent = text || '';
  }

  function onClick(ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('[data-group-wo-action]');
    if (!btn) return;
    var el = btn.closest('[data-group-wo-slot]');
    if (!el) return;
    var jobId = el.getAttribute('data-group-wo-slot');
    var action = btn.getAttribute('data-group-wo-action');
    var core = C();
    if (!core) return;
    if (action === 'create') {
      call('create_group_work_order', null, { job_id: jobId }).then(function () { return paint(jobId); }).catch(function (e) {
        if (core.isOff(null, e)) { el.innerHTML = ''; return; }
        showMsg(el, (e && e.message) || 'That could not be created.');
      });
      return;
    }
    if (action === 'join') {
      call('join_group_work_order', null, { job_id: jobId }).then(function () { return paint(jobId); }).catch(function (e) {
        if (core.isOff(null, e)) { el.innerHTML = ''; return; }
        showMsg(el, (e && e.message) || 'That could not be joined.');
      });
      return;
    }
    if (action === 'save-hours') {
      var parsed = core.parseHours({
        work_date: (el.querySelector('[data-group-wo-date]') || {}).value,
        start_time: (el.querySelector('[data-group-wo-start]') || {}).value,
        finish_time: (el.querySelector('[data-group-wo-finish]') || {}).value,
        break_minutes: (el.querySelector('[data-group-wo-break]') || {}).value
      });
      if (parsed.error) { showMsg(el, parsed.error); return; }
      var groupId = el.getAttribute('data-group-id') || '';
      call('submit_group_work_order_hours', null, core.hoursBody(groupId, parsed)).then(function (res) {
        if (core.isOff(res)) { el.innerHTML = ''; return; }
        el.setAttribute('data-group-id', (res && res.group_id) || groupId);
        el.innerHTML = core.tradeHtml(res && res.needs_hours ? 'hours' : 'share', res);
      }).catch(function (e) {
        if (core.isOff(null, e)) { el.innerHTML = ''; return; }
        showMsg(el, (e && e.message) || 'Those hours could not be saved.');
      });
    }
  }

  if (!bound) {
    bound = true;
    document.addEventListener('click', onClick);
  }

  window.GroupWorkOrderTrade = { use: use, slotHtml: slotHtml, paint: paint };
})();
