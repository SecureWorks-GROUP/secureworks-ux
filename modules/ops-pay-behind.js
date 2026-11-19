// Who is behind, and office entry of a missing crew member's days (G3 / G4).
// Reads ops-api pay_run_who_is_behind. Writes office_enter_group_hours only
// from the Enter days confirm. A 403, a 404, an unknown action, or
// enabled: false draws nothing, so the pay run is unchanged until the read
// is there for this approver. Hours are worked out from start and finish.
// A bare hours number is never sent. No rate and no amount is drawn.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root.window !== 'undefined') root.window.PayBehind = api;
  else if (typeof window !== 'undefined') window.PayBehind = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var OFF_MESSAGE = 'Office day entry is currently switched off';
  var STATUS_LABEL = {
    missing: 'Missing',
    draft: 'Draft',
    submitted: 'Submitted',
    approved: 'Approved',
    paid: 'Paid',
    held: 'Held'
  };
  var STEP_LABEL = {
    disputed: 'Disputed',
    needs_hours: 'Needs hours',
    awaiting_others: 'Waiting on the crew',
    awaiting_crew_approval: 'Waiting on crew approval'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function shortDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1];
  }
  function statusLabel(status) {
    var key = String(status || '').toLowerCase();
    return STATUS_LABEL[key] || (key ? key.replace(/_/g, ' ') : 'Not known');
  }
  function stepLabel(step) {
    var key = String(step || '');
    return STEP_LABEL[key] || (key ? key.replace(/_/g, ' ') : 'Not known');
  }
  function minutesOf(value) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
    if (!m) return NaN;
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h > 23 || min > 59) return NaN;
    return h * 60 + min;
  }
  function hoursBetween(start, finish, breakMinutes) {
    var a = minutesOf(start);
    var b = minutesOf(finish);
    var brk = Number(breakMinutes) || 0;
    if (!isFinite(a) || !isFinite(b) || b <= a || brk < 0) return null;
    var left = b - a - brk;
    if (!(left > 0) || left > 24 * 60) return null;
    return Math.round((left / 60) * 100) / 100;
  }
  function hoursText(hours) {
    if (hours == null) return '';
    var rounded = Math.round(hours * 100) / 100;
    var text = Math.abs(rounded * 10 - Math.round(rounded * 10)) < 0.001 ? rounded.toFixed(1) : rounded.toFixed(2);
    return text + ' h';
  }
  function countText(value) {
    if (value == null || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? String(n) : null;
  }
  function sumWeek(weeks, key) {
    var seen = false;
    var total = 0;
    (weeks || []).forEach(function (week) {
      var n = countText(week[key]);
      if (n == null) return;
      seen = true;
      total += Number(n);
    });
    return seen ? String(total) : 'Not read';
  }
  function bagOf(err) {
    var bag = [];
    if (!err) return bag;
    bag.push(err.status, err.code, err.message);
    var body = err.body;
    if (body && typeof body === 'object') bag.push(body.status, body.code, body.error, body.message);
    return bag.map(function (v) { return String(v == null ? '' : v); });
  }
  function isOfficeEntryOff(err) {
    var bag = bagOf(err);
    if (bag.some(function (v) { return v === 'group_office_day_entry_disabled' || v.indexOf('group_office_day_entry_disabled') >= 0; })) return true;
    return bag[0] === '409' && bag.some(function (v) { return /switched off/i.test(v); });
  }
  function classifyRead(answer, err) {
    if (err) {
      var bag = bagOf(err);
      var status = Number(bag[0]);
      var text = bag.join(' ');
      if (status === 403 || status === 404 || /unknown action/i.test(text)) return { kind: 'hidden' };
      return { kind: 'error' };
    }
    if (!answer || typeof answer !== 'object' || answer.enabled === false) return { kind: 'hidden' };
    if (!Array.isArray(answer.behind_trades) && !Array.isArray(answer.stuck_groups)) return { kind: 'hidden' };
    return { kind: 'show' };
  }
  function entryFromDays(groupId, userId, days, reason) {
    var why = String(reason || '').trim();
    if (why.length < 3 || why.length > 500) return { error: 'Say why these days were entered (3 to 500 characters).' };
    if (!groupId || !userId) return { error: 'Choose the crew member again.' };
    var entries = [];
    var seen = {};
    (days || []).forEach(function (day) {
      var date = String((day && day.work_date) || '').slice(0, 10);
      var start = String((day && day.start_time) || '').slice(0, 5);
      var finish = String((day && day.finish_time) || '').slice(0, 5);
      var rawBreak = String(day && day.break_minutes != null ? day.break_minutes : '').trim();
      if (!date && !start && !finish && rawBreak === '') return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(finish)) {
        entries.push({ error: 'Each day needs a date, a start and a finish.' });
        return;
      }
      if (seen[date]) {
        entries.push({ error: date + ' is entered twice.' });
        return;
      }
      seen[date] = true;
      var breakMin = rawBreak === '' ? 0 : Number(rawBreak);
      if (!Number.isFinite(breakMin) || breakMin < 0) {
        entries.push({ error: 'The break is a number of minutes.' });
        return;
      }
      if (hoursBetween(start, finish, breakMin) == null) {
        entries.push({ error: 'The finish must be after the start, and the break has to leave some hours.' });
        return;
      }
      var entry = { work_date: date, start_time: start, finish_time: finish };
      if (breakMin) entry.break_minutes = breakMin;
      entries.push(entry);
    });
    var bad = entries.find(function (entry) { return entry.error; });
    if (bad) return { error: bad.error };
    if (!entries.length || entries.length > 31) return { error: 'Enter 1 to 31 days.' };
    return { body: { group_id: groupId, target_user_id: userId, entries: entries, reason: why } };
  }
  function failureText(err) {
    if (isOfficeEntryOff(err)) return OFF_MESSAGE;
    var body = err && err.body;
    var msg = body && (typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : '');
    if (!msg) msg = err && typeof err.message === 'string' ? err.message : '';
    if (!msg || msg === 'group_office_day_entry_disabled' || /^[a-z0-9_]+$/.test(msg)) return 'Those days could not be entered.';
    return msg;
  }
  function weekBadges(weeks) {
    return (weeks || []).map(function (week) {
      var status = String(week.invoice_status || week.status || '').toLowerCase();
      var label = statusLabel(status);
      var when = shortDay(week.week_start || week.week || '');
      return '<span class="pb-badge" data-status="' + esc(status || 'unknown') + '">' +
        (when ? '<span class="pb-when">' + esc(when) + '</span>' : '') + '<span>' + esc(label) + '</span></span>';
    }).join('');
  }
  function tradeRow(trade) {
    var weeks = Array.isArray(trade.weeks) ? trade.weeks : [];
    var missing = countText(trade.missing_weeks_count);
    if (missing == null) missing = countText(trade.missing_weeks);
    if (missing == null) missing = String(weeks.filter(function (w) { return String(w.invoice_status || w.status) === 'missing'; }).length);
    var drafts = countText(trade.unsent_draft_count);
    if (drafts == null) drafts = countText(trade.unsent_drafts);
    if (drafts == null) drafts = String(weeks.filter(function (w) { return String(w.invoice_status || w.status) === 'draft'; }).length);
    var held = sumWeek(weeks, 'held_lines_count');
    if (held === 'Not read') held = countText(trade.held_lines) || 'Not read';
    var unpriced = sumWeek(weeks, 'unpriced_wo_lines_count');
    if (unpriced === 'Not read') unpriced = countText(trade.unpriced_wo_lines) || countText(trade.unpriced_work_order_lines) || 'Not read';
    var name = trade.display_name || trade.trade_name || trade.name || 'Trade';
    return '<tr><th scope="row">' + esc(name) + '</th><td><div class="pb-weeks">' + (weekBadges(weeks) || '<span class="pb-muted">No weeks</span>') +
      '</div></td><td class="pb-num">' + esc(missing) + '</td><td class="pb-num">' + esc(drafts) +
      '</td><td class="pb-num">' + esc(held) + '</td><td class="pb-num">' + esc(unpriced) + '</td></tr>';
  }
  function dayFields(day, index, many) {
    var hours = hoursBetween(day.start_time, day.finish_time, day.break_minutes || 0);
    return '<fieldset class="pb-day" data-pb-day><legend>Day ' + (index + 1) + '</legend>' +
      '<label>Work date<input type="date" data-pb-date value="' + esc(day.work_date || '') + '"></label>' +
      '<label>Started<input type="time" data-pb-start value="' + esc(day.start_time || '') + '"></label>' +
      '<label>Finished<input type="time" data-pb-finish value="' + esc(day.finish_time || '') + '"></label>' +
      '<label>Break (minutes)<input type="number" data-pb-break min="0" max="600" step="1" value="' + esc(day.break_minutes || '') + '"></label>' +
      '<p class="pb-hours" data-pb-hours>' + (hours == null ? 'Hours appear once the times are in.' : esc(hoursText(hours))) + '</p>' +
      (many ? '<button type="button" data-pb-remove-day>Remove this day</button>' : '') +
      '</fieldset>';
  }
  function modalHtml(modal) {
    if (!modal) return '';
    var days = modal.days && modal.days.length ? modal.days : [{ work_date: '', start_time: '', finish_time: '', break_minutes: '' }];
    return '<div class="pb-modal"><div class="pb-dialog" role="dialog" aria-modal="true" aria-labelledby="pb-entry-title">' +
      '<h3 id="pb-entry-title">Enter days for ' + esc(modal.name || 'this crew member') + '</h3>' +
      '<p class="pb-muted">' + esc(modal.jobNumber || 'Group work order') + (modal.suburb ? ' · ' + esc(modal.suburb) : '') +
      '. Hours are worked out from the start, finish and break.</p>' +
      (modal.error ? '<p role="alert" class="pb-error">' + esc(modal.error) + '</p>' : '') +
      '<form data-pb-form>' +
      days.map(function (day, i) { return dayFields(day, i, days.length > 1); }).join('') +
      '<button type="button" data-pb-add-day>Add another day</button>' +
      '<label class="pb-reason">Why were these days entered?<textarea data-pb-reason maxlength="500">' + esc(modal.reason || '') + '</textarea></label>' +
      '<p class="pb-muted">3 to 500 characters.</p>' +
      '<div class="pb-actions"><button type="submit" class="pb-primary"' + (modal.busy ? ' disabled' : '') + '>' + (modal.busy ? 'Saving...' : 'Save the days') + '</button>' +
      '<button type="button" data-pb-cancel' + (modal.busy ? ' disabled' : '') + '>Cancel</button></div></form></div></div>';
  }
  function panelHtml(answer, ui) {
    ui = ui || {};
    var trades = Array.isArray(answer.behind_trades) ? answer.behind_trades : [];
    var groups = Array.isArray(answer.stuck_groups) ? answer.stuck_groups : [];
    var tab = ui.tab === 'stuck' ? 'stuck' : 'behind';
    var behind = trades.length
      ? '<div class="pb-table-wrap"><table><caption>Who is behind</caption><thead><tr><th scope="col">Trade</th><th scope="col">Last 4 weeks</th><th scope="col">Missing weeks</th><th scope="col">Unsent drafts</th><th scope="col">Held lines</th><th scope="col">Unpriced work order lines</th></tr></thead><tbody>' +
        trades.map(tradeRow).join('') + '</tbody></table></div>'
      : '<p>Nobody is behind on invoicing.</p>';
    var stuck = groups.length
      ? groups.map(function (group) {
        var missing = Array.isArray(group.crew_missing) ? group.crew_missing : [];
        var people = missing.map(function (person) {
          var item = typeof person === 'string' ? { display_name: person } : (person || {});
          var name = item.display_name || item.name || 'Crew member';
          var note = item.disputed ? 'Disputed' : (Number(item.hours_entered) > 0 ? '' : 'No hours yet');
          var button = item.user_id
            ? '<button type="button" data-pb-enter data-group-id="' + esc(group.group_id || '') + '" data-user-id="' + esc(item.user_id) +
              '" data-name="' + esc(name) + '" data-job="' + esc(group.job_number || '') + '" data-suburb="' + esc(group.site_suburb || group.suburb || '') +
              '">Enter days</button>'
            : '';
          return '<li><span>' + esc(name) + (note ? '<span class="pb-muted"> ' + esc(note) + '</span>' : '') + '</span>' + button + '</li>';
        }).join('');
        var days = Number(group.days_stuck);
        var daysText = Number.isFinite(days) ? (days === 1 ? '1 day' : days + ' days') : 'Days not known';
        return '<article data-stuck-group="' + esc(group.group_id || '') + '"><h3>' + esc(group.job_number || 'Job number not known') +
          '</h3><p>' + esc(group.site_suburb || group.suburb || 'Suburb not known') + '</p><p>' + esc(stepLabel(group.stuck_step || group.step)) +
          '</p><p>' + esc(daysText) + '</p>' + (people ? '<ul>' + people + '</ul>' : '<p>No missing crew members.</p>') + '</article>';
      }).join('')
      : '<p>No group work orders are stuck.</p>';
    return '<section aria-label="Who is behind">' +
      (ui.notice ? '<p class="pb-notice" role="status">' + esc(ui.notice) + '</p>' : '') +
      '<div role="tablist"><button type="button" role="tab" data-pb-tab="behind" aria-selected="' + (tab === 'behind' ? 'true' : 'false') + '">Who is behind</button>' +
      '<button type="button" role="tab" data-pb-tab="stuck" aria-selected="' + (tab === 'stuck' ? 'true' : 'false') + '">Stuck group work orders</button></div>' +
      '<div data-pb-panel="behind"' + (tab === 'behind' ? '' : ' hidden') + '>' + behind + '</div>' +
      '<div data-pb-panel="stuck"' + (tab === 'stuck' ? '' : ' hidden') + '>' + stuck + '</div>' +
      modalHtml(ui.modal) + '</section>';
  }

  function mountPayBehindPanel(container, opts) {
    if (!container) return Promise.resolve();
    opts = opts || {};
    var fetchFn = opts.fetch || function (action, params) { return window.opsFetch(action, params); };
    var postFn = opts.post || function (action, body) { return window.opsPost(action, body); };
    if (!container._pbBound) {
      container._pbBound = true;
      container.addEventListener('click', onClick);
      container.addEventListener('submit', onSubmit);
      container.addEventListener('input', onInput);
    }
    var state = container._pb || (container._pb = { kind: 'loading', tab: 'behind', answer: null, modal: null, notice: '', read: 0 });
    ensureStyle();
    function draw() {
      if (state.kind === 'hidden' || state.kind === 'loading') {
        container.innerHTML = '';
        return;
      }
      if (state.kind === 'error') {
        container.innerHTML = '<div data-pay-behind><p role="alert" class="pb-error">Who is behind could not be read.</p><button type="button" data-pb-retry>Try again</button></div>';
        return;
      }
      container.innerHTML = '<div data-pay-behind>' + panelHtml(state.answer, state) + '</div>';
    }
    function readModal() {
      var form = container.querySelector('[data-pb-form]');
      if (!form || !state.modal) return;
      var days = [];
      form.querySelectorAll('[data-pb-day]').forEach(function (row) {
        days.push({
          work_date: row.querySelector('[data-pb-date]').value,
          start_time: row.querySelector('[data-pb-start]').value,
          finish_time: row.querySelector('[data-pb-finish]').value,
          break_minutes: row.querySelector('[data-pb-break]').value
        });
      });
      state.modal.days = days;
      state.modal.reason = form.querySelector('[data-pb-reason]').value;
    }
    function onClick(event) {
      var button = event.target.closest('button');
      if (!button || button.disabled || !container.contains(button)) return;
      if (button.hasAttribute('data-pb-retry')) { load(); return; }
      if (button.hasAttribute('data-pb-tab')) {
        state.tab = button.getAttribute('data-pb-tab') === 'stuck' ? 'stuck' : 'behind';
        state.modal = null;
        draw();
        return;
      }
      if (button.hasAttribute('data-pb-enter')) {
        state.tab = 'stuck';
        state.modal = {
          groupId: button.getAttribute('data-group-id'),
          userId: button.getAttribute('data-user-id'),
          name: button.getAttribute('data-name'),
          jobNumber: button.getAttribute('data-job'),
          suburb: button.getAttribute('data-suburb'),
          days: [{ work_date: '', start_time: '', finish_time: '', break_minutes: '' }],
          reason: '',
          error: '',
          busy: false
        };
        draw();
        return;
      }
      if (button.hasAttribute('data-pb-add-day') && state.modal) {
        readModal();
        state.modal.days.push({ work_date: '', start_time: '', finish_time: '', break_minutes: '' });
        state.modal.error = '';
        draw();
        return;
      }
      if (button.hasAttribute('data-pb-remove-day') && state.modal) {
        readModal();
        var row = button.closest('[data-pb-day]');
        var rows = Array.prototype.slice.call(container.querySelectorAll('[data-pb-day]'));
        var index = rows.indexOf(row);
        if (index >= 0) state.modal.days.splice(index, 1);
        draw();
        return;
      }
      if (button.hasAttribute('data-pb-cancel')) {
        state.modal = null;
        draw();
      }
    }
    function onInput(event) {
      var row = event.target.closest && event.target.closest('[data-pb-day]');
      if (!row || !container.contains(row)) return;
      var slot = row.querySelector('[data-pb-hours]');
      if (!slot) return;
      var hours = hoursBetween(row.querySelector('[data-pb-start]').value, row.querySelector('[data-pb-finish]').value, row.querySelector('[data-pb-break]').value);
      slot.textContent = hours == null ? 'Hours appear once the times are in.' : hoursText(hours);
    }
    function onSubmit(event) {
      var form = event.target;
      if (!form || !form.hasAttribute('data-pb-form')) return;
      event.preventDefault();
      if (!state.modal || state.modal.busy) return;
      readModal();
      var built = entryFromDays(state.modal.groupId, state.modal.userId, state.modal.days, state.modal.reason);
      if (built.error) { state.modal.error = built.error; draw(); return; }
      state.modal.busy = true;
      state.modal.error = '';
      draw();
      postFn('office_enter_group_hours', built.body).then(function () {
        state.modal = null;
        state.notice = 'Days entered.';
        draw();
        return load();
      }).catch(function (err) {
        if (!state.modal) return;
        state.modal.busy = false;
        state.modal.error = failureText(err);
        draw();
      });
    }
    function load() {
      var token = ++state.read;
      state.kind = 'loading';
      return Promise.resolve().then(function () { return fetchFn('pay_run_who_is_behind', { weeks: 4 }); }).then(function (answer) {
        if (token !== state.read) return;
        var gate = classifyRead(answer, null);
        state.kind = gate.kind;
        state.answer = gate.kind === 'show' ? answer : null;
        if (gate.kind !== 'show') state.modal = null;
        draw();
      }).catch(function (err) {
        if (token !== state.read) return;
        var gate = classifyRead(null, err);
        state.kind = gate.kind;
        state.answer = null;
        if (gate.kind !== 'show') state.modal = null;
        draw();
      });
    }
    return load();
  }

  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById('pay-behind-style')) return;
    var style = document.createElement('style');
    style.id = 'pay-behind-style';
    style.textContent = '[data-pay-behind]{margin-top:28px;color:var(--text,#1e293b);font-size:14px;line-height:1.5} [data-pay-behind] h3{font-size:16px;margin:0 0 4px} [data-pay-behind] p{margin:4px 0} [data-pay-behind] [role=tablist]{display:flex;gap:8px;margin:0 0 12px} [data-pay-behind] button{border:1px solid var(--border,#cbd5e1);background:#fff;color:inherit;border-radius:6px;min-height:40px;padding:6px 14px;cursor:pointer} [data-pay-behind] button[aria-selected=true]{background:#1f5fbf;color:#fff;border-color:#1f5fbf} [data-pay-behind] button:disabled{opacity:.55;cursor:wait} [data-pay-behind] button:focus-visible,[data-pay-behind] input:focus-visible,[data-pay-behind] textarea:focus-visible{outline:2px solid #2563eb;outline-offset:2px} [data-pay-behind] .pb-table-wrap{overflow-x:auto} [data-pay-behind] table{width:100%;border-collapse:collapse} [data-pay-behind] caption{text-align:left;font-weight:700;font-size:16px;margin-bottom:8px} [data-pay-behind] th,[data-pay-behind] td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border,#e2e8f0);vertical-align:top} [data-pay-behind] .pb-num{font-variant-numeric:tabular-nums;white-space:nowrap} [data-pay-behind] .pb-weeks{display:flex;flex-wrap:wrap;gap:6px} [data-pay-behind] .pb-badge{display:inline-flex;gap:4px;align-items:center;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;background:#eef2f6} [data-pay-behind] .pb-badge[data-status=missing]{background:#fde8e8;color:#9f2424} [data-pay-behind] .pb-badge[data-status=draft]{background:#fff4e5;color:#8a4b00} [data-pay-behind] .pb-badge[data-status=submitted]{background:#e8f1fb;color:#1f5fbf} [data-pay-behind] .pb-badge[data-status=approved]{background:#e7f6ee;color:#157347} [data-pay-behind] .pb-badge[data-status=paid]{background:#e7f6ee;color:#157347} [data-pay-behind] .pb-badge[data-status=held]{background:#fff4e5;color:#8a4b00} [data-pay-behind] .pb-when{font-weight:600} [data-pay-behind] .pb-muted{color:#526071;font-size:13px;font-weight:500} [data-pay-behind] article{padding:12px 0;border-bottom:1px solid var(--border,#e2e8f0)} [data-pay-behind] ul{list-style:none;padding:0;margin:8px 0 0} [data-pay-behind] li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:6px 0} [data-pay-behind] .pb-error{color:#9f2424} [data-pay-behind] .pb-notice{background:#eaf6ee;color:#1d5b33;padding:8px 12px;border-radius:6px;font-weight:600} [data-pay-behind] .pb-modal{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:flex-end;justify-content:center;z-index:80;padding:12px} [data-pay-behind] .pb-dialog{background:#fff;width:min(520px,100%);max-height:min(92vh,760px);overflow:auto;border-radius:12px;padding:16px} [data-pay-behind] fieldset{border:1px solid #e2e8f0;border-radius:8px;margin:0 0 12px;padding:10px} [data-pay-behind] label{display:grid;gap:4px;font-weight:600;margin:8px 0} [data-pay-behind] input,[data-pay-behind] textarea{font:inherit;min-height:40px;border:1px solid #94a3b8;border-radius:6px;padding:6px 8px} [data-pay-behind] textarea{min-height:88px;resize:vertical} [data-pay-behind] .pb-actions{display:flex;gap:8px;margin-top:12px} [data-pay-behind] .pb-primary{background:#1f5fbf;color:#fff;border-color:#1f5fbf} @media(max-width:700px){[data-pay-behind] li{flex-wrap:wrap}}';
    document.head.appendChild(style);
  }

  if (typeof window !== 'undefined' && window._opsAppStarted) {
    var view = document.getElementById('subPayrun');
    if (view && view.classList.contains('active')) mountPayBehindPanel(document.getElementById('payBehindHost'));
  }

  return {
    mountPayBehindPanel: mountPayBehindPanel,
    panelHtml: panelHtml,
    classifyRead: classifyRead,
    entryFromDays: entryFromDays,
    isOfficeEntryOff: isOfficeEntryOff,
    failureText: failureText,
    statusLabel: statusLabel,
    hoursBetween: hoursBetween,
    OFF_MESSAGE: OFF_MESSAGE
  };
});
