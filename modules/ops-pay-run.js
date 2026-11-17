// P1-06.7: the Pay run host mounts this section at its foot and passes its
// sub-tab button. Loading this file alone performs no read or write.
(function () {
  'use strict';
  var fields = [
    { key: 'tax_set_aside_percent', label: 'Tax set-aside guide (percent, from the accountant)', waits: 'Not set: trades see no tax guide.' },
    { key: 'reimbursement_account_code', label: 'Xero account for reimbursements', waits: 'Not set: invoices with a reimbursement are not sent to Xero.' },
    { key: 'repayment_account_code', label: 'Xero account for repayments', waits: 'Not set: each repayment needs its account typed.' },
    { key: 'not_job_work_account_code', label: 'Xero account for work not on a job', waits: 'Not set: approved not-job-work is not sent to Xero.' }
  ];
  var section, tab, data = null, editing = null, busy = false, error = '', readNumber = 0;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function unset(value) { return value === null || value === undefined || value === ''; }
  function valueText(field, value) {
    return unset(value) ? 'Not set' : String(value) + (field === 'tax_set_aside_percent' ? '%' : '');
  }
  function label(field) {
    var found = fields.find(function (f) { return f.key === field; });
    return found ? found.label : 'Pay setting';
  }
  function dateText(value) {
    if (!value) return 'Not recorded';
    var date = new Date(value);
    return isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString('en-AU', { timeZone: 'Australia/Perth' });
  }
  function tabText() {
    if (tab) tab.textContent = 'Pay run' + (data && data.missing.length ? ' (' + data.missing.length + ' settings missing)' : '');
  }
  function draw() {
    if (!section) return;
    tabText();
    var html = '<h3>Pay settings</h3>';
    if (error) html += '<p role="alert" class="prs-error">' + esc(error) + '</p>';
    if (!data) {
      section.innerHTML = html + (busy ? '<p role="status">Reading pay settings...</p>' : '<button type="button" data-retry>Try again</button>');
      return;
    }
    html += fields.map(function (f) {
      var missing = unset(data[f.key]);
      var row = '<div class="prs-row" data-pay-setting="' + f.key + '"><div><label for="prs-' + f.key + '">' + f.label + '</label>' +
        '<p data-value' + (missing ? ' class="prs-missing"' : '') + '>' + esc(valueText(f.key, data[f.key])) + '</p>' +
        (missing ? '<p class="prs-waits">' + f.waits + '</p>' : '') + '</div>';
      if (data.can_edit === true) {
        if (editing === f.key) {
          row += '<form data-edit="' + f.key + '"><input id="prs-' + f.key + '" aria-label="' + f.label + '" ' +
            (f.key === 'tax_set_aside_percent' ? 'type="number" min="0" max="60" step="0.01"' : 'type="text" maxlength="20"') +
            ' value="' + esc(missing ? '' : data[f.key]) + '"' + (busy ? ' disabled' : '') + '>' +
            '<button type="submit"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving...' : 'Save') + '</button>' +
            '<button type="button" data-cancel' + (busy ? ' disabled' : '') + '>Cancel</button></form>';
        } else {
          row += '<button type="button" data-set="' + f.key + '" aria-label="' + (missing ? 'Set' : 'Change') + '"' + (busy ? ' disabled' : '') + '>' + (missing ? 'Set' : 'Change') + '</button>';
        }
      }
      return row + '</div>';
    }).join('');
    if (!data.can_edit) html += '<p>Only the bookkeeper and the owner can change these.</p>';
    html += '<div class="prs-director"><p>Start date: ' + esc(data.inclusive_super_from || 'Not set') + '</p>' +
      '<p>Approvers: ' + (data.approvers_set === true ? 'set' : 'Not set') + '</p><p class="prs-waits">Set by the director on the owner\'s word.</p></div>';
    html += '<h4>Last changes</h4><div data-pay-changes>';
    if (!data.recent_changes.length) html += '<p>No changes recorded.</p>';
    else html += '<ul class="prs-changes">' + data.recent_changes.map(function (change) {
      // Never render a raw user id, name or an editable authority field.
      var who = ['owner', 'bookkeeper', 'admin', 'ops_manager'].indexOf(change.changed_by_role) >= 0 ? change.changed_by_role.replace('_', ' ') : 'Approver';
      return '<li><time>' + esc(dateText(change.changed_at)) + '</time><span>' + esc(who) + '</span><span>' + esc(label(change.field)) + '</span><span>' +
        esc(valueText(change.field, change.from_value)) + ' to ' + esc(valueText(change.field, change.to_value)) + '</span></li>';
    }).join('') + '</ul>';
    section.innerHTML = html + '</div>';
  }
  async function refresh() {
    var request = ++readNumber;
    data = null; busy = true; error = ''; editing = null; draw();
    try {
      var answer = await window.opsFetch('trade_pay_settings');
      if (!answer || answer.success === false || answer.error || typeof answer.can_edit !== 'boolean' || !Array.isArray(answer.missing) || !Array.isArray(answer.recent_changes)) throw new Error('Unreadable settings');
      if (request !== readNumber) return;
      data = answer;
    } catch (_) {
      if (request !== readNumber) return;
      error = 'Pay settings could not be read. Try again to see the current settings.';
    }
    busy = false; draw();
  }
  async function save(event) {
    event.preventDefault();
    if (!data || !data.can_edit || busy) return;
    var form = event.target;
    var field = form.getAttribute('data-edit');
    if (field !== editing || !fields.some(function (f) { return f.key === field; })) return;
    var value = form.querySelector('input').value.trim();
    busy = true; error = '';
    form.querySelectorAll('input,button').forEach(function (el) { el.disabled = true; });
    try {
      var answer = await window.opsPost('set_trade_pay_setting', { field: field, value: value === '' ? null : value });
      if (!answer || answer.success === false || answer.error) throw new Error(answer && answer.message || 'The setting was not saved. Try again.');
      await refresh();
    } catch (err) {
      busy = false;
      error = err.message === 'Only the bookkeeper and the owner can change pay settings.' ? err.message : 'The setting could not be saved. Read the current settings before trying again.';
      form.querySelectorAll('input,button').forEach(function (el) { el.disabled = false; });
      var alert = section.querySelector('[role="alert"]');
      if (!alert) { alert = document.createElement('p'); alert.setAttribute('role', 'alert'); alert.className = 'prs-error'; section.insertBefore(alert, section.children[1]); }
      alert.textContent = error;
    }
  }
  function mount(host, tabButton) {
    if (!host) throw new Error('A Pay run host is required');
    if (!document.getElementById('pay-settings-style')) {
      var style = document.createElement('style'); style.id = 'pay-settings-style';
      style.textContent = '[data-pay-settings]{margin-top:32px;color:var(--text,#1e293b);font-size:14px;line-height:1.5} [data-pay-settings] h3{font-size:18px;margin:0 0 16px} [data-pay-settings] h4{font-size:15px;margin:24px 0 8px} [data-pay-settings] p{margin:4px 0} [data-pay-settings] .prs-row{display:flex;justify-content:space-between;align-items:start;gap:20px;padding:16px 0;border-bottom:1px solid var(--border,#e2e8f0)} [data-pay-settings] label{font-weight:600} [data-pay-settings] [data-value]{font-variant-numeric:tabular-nums} [data-pay-settings] .prs-missing{color:#925c08;font-weight:600} [data-pay-settings] .prs-waits{color:var(--text-secondary,#526071);font-size:13px} [data-pay-settings] button{border:1px solid var(--border,#cbd5e1);background:var(--surface,#fff);color:inherit;border-radius:6px;min-height:40px;padding:6px 14px;cursor:pointer} [data-pay-settings] button:hover{background:#f1f5f9} [data-pay-settings] button:disabled{opacity:.55;cursor:wait} [data-pay-settings] input{width:150px;min-width:0;min-height:40px;border:1px solid #94a3b8;border-radius:6px;padding:6px 8px;color:inherit;background:#fff} [data-pay-settings] input:focus-visible,[data-pay-settings] button:focus-visible{outline:2px solid #2563eb;outline-offset:2px} [data-pay-settings] form{display:flex;flex-wrap:wrap;gap:8px;flex-shrink:0} [data-pay-settings] .prs-director{margin-top:24px} [data-pay-settings] .prs-error{color:#9f2424} [data-pay-settings] .prs-changes{list-style:none;padding:0;margin:0} [data-pay-settings] .prs-changes li{display:grid;grid-template-columns:170px 100px 1fr 140px;gap:12px;padding:10px 0;border-bottom:1px solid var(--border,#e2e8f0);overflow-wrap:anywhere} @media(max-width:700px){[data-pay-settings] .prs-row{flex-wrap:wrap;gap:10px} [data-pay-settings] .prs-changes li{grid-template-columns:1fr 1fr} [data-pay-settings] .prs-changes li span:nth-child(3){grid-column:1/-1}}';
      document.head.appendChild(style);
    }
    section = host.querySelector('[data-pay-settings]');
    if (!section) { section = document.createElement('section'); section.setAttribute('data-pay-settings', ''); section.setAttribute('aria-label', 'Pay settings'); host.appendChild(section); }
    tab = tabButton || null;
    section.onclick = function (event) {
      var button = event.target.closest('button');
      if (!button || busy) return;
      if (button.hasAttribute('data-retry')) { refresh(); return; }
      if (button.hasAttribute('data-cancel')) { editing = null; error = ''; draw(); return; }
      if (!data || !data.can_edit) return;
      if (button.hasAttribute('data-set')) {
        editing = button.getAttribute('data-set'); error = ''; draw();
        section.querySelector('input').focus();
      }
    };
    section.onsubmit = save;
    return refresh();
  }
  window.PayRunSettings = { mount: mount, refresh: refresh };
})();
