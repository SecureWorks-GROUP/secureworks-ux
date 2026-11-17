// P1-09.4: office-only repayment management. The server owns every balance.
(function () {
  'use strict';
  var section, rows = null, canEdit = false, denied = false, busy = false, error = '', sequence = 0;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function staff() {
    var cloud = window.SECUREWORKS_CLOUD;
    var role = cloud && cloud.auth && cloud.auth.getRole();
    return ['admin', 'owner', 'ops_manager', 'estimator', 'sales'].indexOf(role) !== -1;
  }
  function editable() { return staff() && canEdit && !denied && !busy && rows !== null; }
  function money(value) {
    return value === null || value === undefined || value === '' || !isFinite(Number(value)) ? 'Not read' :
      Number(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  }
  function date(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : 'Not read';
  }
  function stopped(row) { return row.active === false || !!row.stopped_at; }
  function draw() {
    if (!section) return;
    var html = '<div class="trp-head"><h3>Repayments</h3>';
    if (editable()) html += '<button type="button" data-set>Set a repayment</button>';
    html += '</div><div data-alert' + (error ? ' role="alert"' : '') + '>' + esc(error) + '</div>';
    if (busy) html += '<p role="status">Reading repayments...</p>';
    else if (rows === null) html += '<button type="button" data-retry>Try again</button>';
    else if (!rows.length) html += '<p>No repayments.</p>';
    else {
      html += '<div class="data-table-wrap"><table class="data-table"><caption class="trp-sr">Repayments and balances from the office records</caption>' +
        '<thead><tr><th scope="col">Trade</th><th scope="col">What for</th><th scope="col">Each week</th><th scope="col">Total</th><th scope="col">Left to repay</th><th scope="col">Started</th><th scope="col">Status</th></tr></thead><tbody>';
      html += rows.map(function (row, i) {
        var status = stopped(row) ? 'Stopped' : row.balance_left === 0 ? 'Repaid' : row.active === true ? 'Active' : 'Not read';
        return '<tr data-repayment-row><td>' + esc(row.trade_name || 'Trade not recorded') + '</td><td>' + esc(row.label) + '</td>' +
          '<td class="trp-money">' + esc(money(row.amount)) + '</td><td class="trp-money">' + esc(money(row.balance_total)) + '</td>' +
          '<td class="trp-money" data-balance>' + esc(money(row.balance_left)) + '</td><td>' + esc(date(row.first_week_start)) + '</td><td>' + status +
          (editable() && row.active === true && !stopped(row) ? ' <button type="button" data-stop="' + i + '">Stop</button>' : '') + '</td></tr>';
      }).join('');
      html += '</tbody></table></div>';
    }
    section.innerHTML = html + '<div data-editor></div>';
  }
  function refusal(err) {
    if (err && err.status === 403) { denied = true; canEdit = false; }
    return err && err.message || 'The repayment could not be saved. Read the current repayments before trying again.';
  }
  async function refresh() {
    var request = ++sequence;
    if (!staff()) { if (section) section.remove(); section = null; return; }
    rows = null; canEdit = false; busy = true; error = ''; draw();
    try {
      var answer = await window.opsFetch('list_trade_repayments');
      if (!answer || !Array.isArray(answer.repayments)) throw new Error('Unreadable repayments');
      if (request !== sequence) return;
      rows = answer.repayments;
      if (!denied) {
        try {
          var settings = await window.opsFetch('trade_pay_settings');
          if (request !== sequence) return;
          canEdit = settings && settings.can_edit === true;
        } catch (err) { if (request !== sequence) return; error = refusal(err); }
      }
    } catch (err) {
      if (request !== sequence) return;
      error = err.status === 403 ? refusal(err) : 'Repayments could not be read. Try again.';
    }
    if (request !== sequence) return;
    busy = false; draw();
  }
  function field(label, name, attrs) {
    return '<label>' + label + '<input name="' + name + '" ' + (attrs || 'type="text"') + ' required></label>';
  }
  function showError(message) {
    var alert = section.querySelector('[data-alert]');
    alert.setAttribute('role', 'alert'); alert.textContent = message;
  }
  async function setForm() {
    if (!editable()) return;
    var request = sequence;
    var editor = section.querySelector('[data-editor]');
    editor.innerHTML = '<p role="status">Reading trades...</p>';
    try {
      var answer = await window.opsFetch('list_users');
      if (request !== sequence || !editable()) return;
      if (!answer || !Array.isArray(answer.users)) throw new Error('Trades could not be read. Try again.');
      editor.innerHTML = '<form data-set-form><h4>Set a repayment</h4><div class="trp-fields"><div><label for="trp-trade">Trade</label><select id="trp-trade" name="user_id" required><option value="">Choose a trade</option>' +
        answer.users.map(function (u) {
          return '<option value="' + esc(u.id) + '">' + esc(u.name || 'Trade') + '</option>';
        }).join('') + '</select></div>' + field('What for', 'label', 'type="text" maxlength="60"') +
        field('Amount each week', 'amount', 'type="number" min="0.01" step="0.01" inputmode="decimal"') +
        field('Total to repay', 'balance_total', 'type="number" min="0.01" step="0.01" inputmode="decimal"') +
        field('First pay week', 'first_week_start', 'type="date" aria-describedby="trp-monday"') +
        field('Xero account code', 'xero_account_code') + '<label>Note<textarea name="note" rows="2"></textarea></label></div>' +
        '<p id="trp-monday">Choose a Monday. Ask the bookkeeper for the Xero account code.</p><div class="trp-actions"><button type="submit">Save</button><button type="button" data-cancel>Cancel</button></div></form>';
      editor.querySelector('select').focus();
    } catch (err) {
      if (request !== sequence) return;
      error = refusal(err); if (denied) draw(); else { editor.innerHTML = ''; showError(error); }
    }
  }
  async function save(event) {
    event.preventDefault();
    if (!editable()) return;
    var form = event.target, data = new FormData(form), body, action;
    if (form.hasAttribute('data-set-form')) {
      var week = data.get('first_week_start');
      var input = form.elements.first_week_start;
      input.setCustomValidity(new Date(week + 'T00:00:00Z').getUTCDay() === 1 ? '' : 'Choose a Monday.');
      if (!form.reportValidity()) return;
      body = { user_id: data.get('user_id'), label: data.get('label').trim(), amount: Number(data.get('amount')),
        balance_total: Number(data.get('balance_total')), first_week_start: week,
        xero_account_code: data.get('xero_account_code').trim(), note: data.get('note').trim() };
      action = 'set_trade_repayment';
    } else {
      body = { id: rows[Number(form.getAttribute('data-stop-form'))].id, reason: data.get('reason').trim() };
      if (!body.reason) { form.reportValidity(); return; }
      action = 'stop_trade_repayment';
    }
    busy = true;
    section.querySelectorAll('input,select,textarea,button').forEach(function (el) { el.disabled = true; });
    try {
      var answer = await window.opsPost(action, body);
      if (!answer || answer.success === false || answer.error) throw new Error(answer && answer.error || 'The repayment was not saved.');
      await refresh();
    } catch (err) {
      busy = false; error = refusal(err);
      if (denied) draw();
      else {
        section.querySelectorAll('input,select,textarea,button').forEach(function (el) { el.disabled = false; });
        showError(error);
      }
    }
  }
  function mount(host) {
    if (!host || !staff()) { if (section) section.remove(); section = null; return Promise.resolve(); }
    if (!document.getElementById('trade-repayments-style')) {
      var style = document.createElement('style'); style.id = 'trade-repayments-style';
      style.textContent = '[data-repayments]{margin-top:32px;color:var(--sw-text);font-size:14px;line-height:1.5}[data-repayments] .trp-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}[data-repayments] h3{font-size:18px;margin:0}[data-repayments] h4{font-size:16px;margin:0 0 16px}[data-repayments] button{min-height:40px;padding:8px 14px;border:1px solid var(--sw-border);border-radius:6px;background:var(--sw-card);color:inherit;cursor:pointer}[data-repayments] button:hover{background:var(--sw-light)}[data-repayments] button:disabled{opacity:.55;cursor:wait}[data-repayments] .trp-money{font-variant-numeric:tabular-nums;white-space:nowrap}[data-repayments] [role=alert]{color:var(--sw-red);margin-bottom:12px}[data-repayments] form{margin-top:24px;padding-top:20px;border-top:1px solid var(--sw-border)}[data-repayments] .trp-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}[data-repayments] label{display:flex;flex-direction:column;gap:6px;font-weight:600}[data-repayments] input,[data-repayments] select,[data-repayments] textarea{width:100%;min-height:44px;box-sizing:border-box;border:1px solid var(--sw-mid);border-radius:6px;padding:8px;background:var(--sw-card);color:inherit;font:inherit}[data-repayments] :is(input,select,textarea,button):focus-visible{outline:2px solid var(--sw-mid);outline-offset:2px}[data-repayments] .trp-actions{display:flex;gap:8px;margin-top:16px}[data-repayments] .trp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:600px){[data-repayments] .trp-fields{grid-template-columns:1fr}[data-repayments] .trp-head{flex-wrap:wrap}}';
      document.head.appendChild(style);
    }
    section = host.querySelector('[data-repayments]');
    if (!section) { section = document.createElement('section'); section.setAttribute('data-repayments', ''); section.setAttribute('aria-label', 'Repayments'); host.appendChild(section); }
    section.onclick = function (event) {
      var button = event.target.closest('button');
      if (!button || busy) return;
      if (button.hasAttribute('data-retry')) { refresh(); return; }
      if (button.hasAttribute('data-cancel')) { section.querySelector('[data-editor]').innerHTML = ''; return; }
      if (!editable()) return;
      if (button.hasAttribute('data-set')) { setForm(); return; }
      if (button.hasAttribute('data-stop')) {
        var index = Number(button.getAttribute('data-stop'));
        section.querySelector('[data-editor]').innerHTML = '<form data-stop-form="' + index + '"><h4>Stop repayment: ' + esc(rows[index].label) + '</h4>' +
          field('Reason for stopping', 'reason') + '<div class="trp-actions"><button type="submit">Stop repayment</button><button type="button" data-cancel>Cancel</button></div></form>';
        section.querySelector('[name=reason]').focus();
      }
    };
    section.oninput = function (event) { if (event.target.name === 'first_week_start') event.target.setCustomValidity(''); };
    section.onsubmit = save;
    return refresh();
  }
  window.TradeRepayments = { mount: mount };
})();
