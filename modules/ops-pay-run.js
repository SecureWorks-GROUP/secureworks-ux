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

// P1-10.6: the weekly pay run screen (read only). The Financials "Pay run" sub
// tab calls PayRun.open(host, tabButton). It reads ops-api pay_run and shows the
// server's figures as they come: nothing is added up or worked out here. It
// never writes. The pay settings section (above) is NOT mounted here yet: its
// save path has open faults to fix first (scope-director followups-17nov.md,
// Follow-up 31), and mounting it is one line in open(). Loading this file
// alone performs no read or write.
(function () {
  'use strict';
  var CHECKS = [
    ['pay_equals_job_cost', 'Pay equals job cost'],
    ['nobody_above_work_order', 'Nobody above a work order total'],
    ['super_is_12_over_112', 'Super is 12/112 of every line'],
    ['no_paid_line_without_work_order', 'No paid line without a work order'],
    ['nothing_lost', 'Nothing a trade sent is lost'],
    ['crew_accepted', 'Nobody paid on a job whose crew did not accept them']
  ];
  var host, section, tab, data = null, state = 'idle', week = null, readNumber = 0;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function money(value) {
    var n = Number(value);
    return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function isMoney(value) { return typeof value === 'number' && isFinite(value); }
  function dayText(iso) {
    // Written out by hand so every browser shows the same words.
    var d = new Date(iso + 'T00:00:00Z');
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' +
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function stepWeek(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  // An answer is shown only when every figure the screen paints is there.
  function readable(a) {
    if (!a || a.ok !== true || !/^\d{4}-\d{2}-\d{2}$/.test(a.week_start || '')) return false;
    if (!a.counts || !a.totals || !a.held || !Array.isArray(a.invoices) || !Array.isArray(a.super_by_person) || !Array.isArray(a.standing)) return false;
    if (!['clean', 'stopped', 'late'].every(function (k) { return Number.isInteger(a.counts[k]); })) return false;
    if (!['total_inc_super', 'paid_to_you', 'super', 'gst', 'reimbursements', 'into_bank'].every(function (k) { return isMoney(a.totals[k]); })) return false;
    if (!Number.isInteger(a.held.lines_waiting) || !isMoney(a.held.amount_ex)) return false;
    if (typeof a.run_blocked !== 'boolean') return false;
    var byCode = {};
    a.standing.forEach(function (c) { if (c && typeof c.code === 'string') byCode[c.code] = c; });
    if (!CHECKS.every(function (c) { var k = byCode[c[0]]; return k && typeof k.pass === 'boolean' && Number.isInteger(k.checked); })) return false;
    return a.invoices.every(function (i) {
      return i && (i.verdict === 'clean' || i.verdict === 'stopped') && Array.isArray(i.stops) &&
        (i.verdict === 'stopped' || ['total_inc_super', 'paid_to_you', 'super_amount', 'into_bank'].every(function (k) { return isMoney(i[k]); }));
    }) && a.super_by_person.every(function (p) { return p && isMoney(p.super_amount); });
  }
  function figure(value) { return isMoney(value) ? money(value) : '<span class="pr-none">Not read</span>'; }
  function weekBar() {
    var label = week ? 'Week of ' + esc(dayText(week)) : 'Pay week';
    var off = state === 'loading' || !week ? ' disabled' : '';
    return '<div class="pr-week"><button type="button" data-week="-7" aria-label="Previous week"' + off + '>&larr; Previous</button>' +
      '<strong data-week-label>' + label + '</strong>' +
      '<button type="button" data-week="7" aria-label="Next week"' + off + '>Next &rarr;</button></div>';
  }
  function draw() {
    if (!section) return;
    var top = '<p class="pr-top">Invoices in by Sunday night. Approve and upload the bank file on Wednesday. Paid on Friday.</p>';
    if (state === 'loading') { section.innerHTML = '<h3>Pay run</h3>' + weekBar() + top + '<p role="status">Reading the pay run...</p>'; return; }
    if (state === 'error' || !data) {
      section.innerHTML = '<h3>Pay run</h3>' + weekBar() + top +
        '<p role="alert" class="pr-error">The pay run could not be read, so nothing is shown. Try again.</p>' +
        '<button type="button" data-retry>Try again</button>';
      return;
    }
    var d = data, html = '';
    if (d.run_blocked) {
      html += '<div class="pr-blocked" role="alert" data-run-blocked><strong>The pay run is stopped.</strong><p>' + esc(d.run_blocked_words || '') +
        '</p><p>Nobody is paid until this is clear. Open the pay run again when it is fixed.</p></div>';
    }
    html += '<h3>Pay run</h3>' + weekBar() + top;
    var byCode = {};
    d.standing.forEach(function (c) { byCode[c.code] = c; });
    html += '<ul class="pr-checks" data-standing>' + CHECKS.map(function (c) {
      var k = byCode[c[0]];
      return '<li data-check="' + c[0] + '" class="' + (k.pass ? 'pr-pass' : 'pr-fail') + '"><span aria-hidden="true">' + (k.pass ? '&#10003;' : '&#10007;') + '</span>' +
        '<span>' + c[1] + '</span><span class="pr-muted">' + (k.pass ? 'Passed' : 'Failed') + ', checked ' + plural(k.checked, 'invoice', 'invoices') +
        (Number.isInteger(k.skipped) && k.skipped > 0 ? ', skipped ' + k.skipped : '') + '</span></li>';
    }).join('') + '</ul>';
    // Held out: the invoices a standing check stopped (their stops carry the
    // check's code), counted from the rows the server sent.
    var heldOut = d.invoices.filter(function (i) {
      return i.verdict === 'stopped' && i.stops.some(function (s) { return s && /^standing_/.test(String(s.code || '')); });
    }).length;
    if (heldOut > 0) html += '<p class="pr-held-out" data-held-out>' + heldOut + ' invoice(s) held out of this run. Everyone else is paid as normal.</p>';
    html += '<div class="pr-counts" data-counts>' +
      '<span>Clean <b>' + d.counts.clean + '</b></span><span>Stopped <b>' + d.counts.stopped + '</b></span><span>Late <b>' + d.counts.late + '</b></span>' +
      '<span>To pay <b>' + money(d.totals.into_bank) + '</b></span><span>Super <b>' + money(d.totals.super) + '</b></span></div>';
    if (!d.invoices.length) {
      html += '<p class="pr-empty" data-empty>No invoices for this pay week.</p>';
    } else {
      var rows = d.invoices.slice().sort(function (a, b) { return (a.verdict === 'stopped' ? 0 : 1) - (b.verdict === 'stopped' ? 0 : 1); });
      html += '<div class="data-table-wrap"><table class="data-table pr-table" data-pay-run-table><thead><tr><th>Trade</th><th>Invoice</th>' +
        '<th class="pr-num">Total (includes super)</th><th class="pr-num">Paid to you</th><th class="pr-num">Super</th><th class="pr-num">Into bank</th><th>Result</th></tr></thead><tbody>' +
        rows.map(function (i) {
          var follow = i.kind === 'follow_on' && /^\d{4}-\d{2}-\d{2}$/.test(i.week_start || '')
            ? '<div class="pr-muted">Approved lines from week of ' + esc(dayText(i.week_start)) + '</div>' : '';
          var result = i.verdict === 'clean'
            ? '<span class="pr-clean">Clean</span>'
            : '<span class="pr-stopped">Stopped</span><ul class="pr-stops">' + i.stops.map(function (s) { return '<li>' + esc(s && s.words) + '</li>'; }).join('') + '</ul>';
          return '<tr data-invoice="' + esc(i.invoice_number) + '" data-verdict="' + i.verdict + '"><td>' + esc(i.trade_name) + '</td><td>' + esc(i.invoice_number) + follow + '</td>' +
            '<td class="pr-num">' + figure(i.total_inc_super) + '</td><td class="pr-num">' + figure(i.paid_to_you) + '</td><td class="pr-num">' + figure(i.super_amount) +
            '</td><td class="pr-num">' + figure(i.into_bank) + '</td><td>' + result + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    // The held lines panel (P1-05.13) is not built yet, so this line links nowhere.
    html += '<p class="pr-office" data-held-lines>Still with the office: ' + plural(d.held.lines_waiting, 'line', 'lines') + ', ' + money(d.held.amount_ex) + '</p>';
    html += '<h4>Super for this run</h4><div class="data-table-wrap"><table class="data-table pr-table" data-super-table><thead><tr><th>Trade</th><th class="pr-num">Super</th></tr></thead><tbody>' +
      d.super_by_person.map(function (p) { return '<tr><td>' + esc(p.trade_name) + '</td><td class="pr-num">' + money(p.super_amount) + '</td></tr>'; }).join('') +
      '<tr class="pr-total"><td>Total</td><td class="pr-num">' + money(d.totals.super) + '</td></tr></tbody></table></div>';
    section.innerHTML = html;
  }
  async function read(nextWeek) {
    var request = ++readNumber;
    if (nextWeek) week = nextWeek;
    state = 'loading'; data = null; draw();
    try {
      var answer = await window.opsFetch('pay_run', week ? { week_start: week } : null);
      if (request !== readNumber) return;
      if (!readable(answer)) throw new Error('Unreadable pay run');
      data = answer; week = answer.week_start; state = 'ready';
    } catch (_) {
      if (request !== readNumber) return;
      data = null; state = 'error';
    }
    draw();
  }
  function open(hostEl, tabButton) {
    if (!hostEl) throw new Error('A Pay run host is required');
    if (!document.getElementById('pay-run-style')) {
      var style = document.createElement('style'); style.id = 'pay-run-style';
      style.textContent = '[data-pay-run]{color:var(--text,#1e293b);font-size:14px;line-height:1.5} [data-pay-run] h3{font-size:18px;margin:0 0 12px} [data-pay-run] h4{font-size:15px;margin:24px 0 8px} [data-pay-run] p{margin:6px 0} [data-pay-run] .pr-top{font-weight:600} [data-pay-run] .pr-week{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px} [data-pay-run] button{border:1px solid var(--border,#cbd5e1);background:var(--surface,#fff);color:inherit;border-radius:6px;min-height:40px;padding:6px 14px;cursor:pointer} [data-pay-run] button:disabled{opacity:.55;cursor:wait} [data-pay-run] button:focus-visible{outline:2px solid #2563eb;outline-offset:2px} [data-pay-run] .pr-checks{list-style:none;padding:0;margin:12px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:6px 16px} [data-pay-run] .pr-checks li{display:grid;grid-template-columns:20px 1fr;column-gap:8px} [data-pay-run] .pr-checks li .pr-muted{grid-column:2} [data-pay-run] .pr-pass>span:first-child{color:#15803d;font-weight:700} [data-pay-run] .pr-fail>span:first-child{color:#b91c1c;font-weight:700} [data-pay-run] .pr-muted{color:var(--text-secondary,#526071);font-size:13px} [data-pay-run] .pr-held-out{color:#925c08;font-weight:600} [data-pay-run] .pr-counts{display:flex;flex-wrap:wrap;gap:8px 24px;margin:16px 0;padding:12px 0;border-top:1px solid var(--border,#e2e8f0);border-bottom:1px solid var(--border,#e2e8f0)} [data-pay-run] .pr-counts b{font-variant-numeric:tabular-nums;margin-left:4px} [data-pay-run] .pr-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap} [data-pay-run] .pr-clean{color:#15803d;font-weight:600} [data-pay-run] .pr-stopped{color:#b91c1c;font-weight:600} [data-pay-run] .pr-stops{margin:4px 0 0;padding-left:18px;color:#7f1d1d;font-size:13px} [data-pay-run] .pr-none{color:var(--text-secondary,#526071)} [data-pay-run] .pr-total td{font-weight:700} [data-pay-run] .pr-error{color:#9f2424} [data-pay-run] .pr-blocked{background:#fef2f2;border:2px solid #b91c1c;color:#7f1d1d;border-radius:8px;padding:12px 16px;margin:0 0 16px} [data-pay-run] .pr-blocked strong{font-size:16px} [data-pay-run] .data-table-wrap{overflow-x:auto}';
      document.head.appendChild(style);
    }
    if (hostEl !== host) {
      host = hostEl; tab = tabButton || null;
      // The tab's "did not load" words (ops.html) go once the screen is here.
      Array.prototype.slice.call(host.childNodes).forEach(function (n) { if (n.nodeType === 3) host.removeChild(n); });
      section = host.querySelector('[data-pay-run]');
      if (!section) { section = document.createElement('section'); section.setAttribute('data-pay-run', ''); section.setAttribute('aria-label', 'Pay run'); host.insertBefore(section, host.firstChild); }
      section.onclick = function (event) {
        var button = event.target.closest('button');
        if (!button || button.disabled) return;
        if (button.hasAttribute('data-retry')) { read(); return; }
        if (button.hasAttribute('data-week') && week) read(stepWeek(week, Number(button.getAttribute('data-week'))));
      };
    }
    return read();
  }
  window.PayRun = { open: open, read: read };
})();
