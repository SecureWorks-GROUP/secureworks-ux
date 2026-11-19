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

// P1-10.6 / F1: the weekly pay run screen. The Financials "Pay run" sub tab calls
// PayRun.open(host, tabButton). It reads ops-api pay_run and shows the server's
// figures as they come: nothing is added up or worked out here.
//
// Write controls (approve_pay_run, push_pay_run_invoice, release_pay_run_invoice,
// mark_pay_run_super_paid) are shown ONLY when the server answers enabled === true
// (trade_pay_run_v1 on) and the signed-in caller is an approver. While enabled is
// absent or false, no write button is shown and the screen is unchanged. Work-order
// notes show as warnings and never block approving or pushing a clean invoice.
//
// The tab is for the pay run approvers only, and the server's approver list is the
// only gate: PayRun.probe() reads pay_run once after sign in, shows the tab when it
// answers, hides it on a refusal (403), and on any other failure keeps what this
// browser last saw (sw_payrun_seen). Loading this file alone performs no read or write.
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
  var APPROVER_ROLES = ['admin', 'owner', 'ops_manager', 'bookkeeper'];
  var RELEASE_REASON_MIN = 3;
  var RELEASE_REASON_MAX = 500;
  var host, section, tab, data = null, state = 'idle', week = null, readNumber = 0, refusal = '';
  var probing = null, probeAnswered = false;
  var pending = null, busy = false, notice = '', actionError = '', superMarkedAt = {};
  function seen(value) {
    try {
      if (value === undefined) return localStorage.getItem('sw_payrun_seen');
      if (value === null) localStorage.removeItem('sw_payrun_seen'); else localStorage.setItem('sw_payrun_seen', value);
    } catch (_) {}
    return null;
  }
  function reveal(on) {
    document.querySelectorAll('[data-payrun-nav]').forEach(function (el) { el.style.display = on ? '' : 'none'; });
  }
  function refused(err) { return !!err && (err.status === 401 || err.status === 403); }
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
  function perthDayText(iso) {
    if (!iso) return '';
    var ms = Date.parse(String(iso));
    if (!isFinite(ms)) return '';
    var d = new Date(ms + 8 * 3600 * 1000);
    return d.getUTCDate() + ' ' +
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function stepWeek(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function canAct(d) {
    if (!d || d.enabled !== true || d.can_approve !== true) return false;
    var auth = window.SECUREWORKS_CLOUD && window.SECUREWORKS_CLOUD.auth;
    if (auth && typeof auth.isLoggedIn === 'function') {
      if (!auth.isLoggedIn()) return false;
      var role = String((typeof auth.getRole === 'function' ? auth.getRole() : '') || '').toLowerCase();
      if (APPROVER_ROLES.indexOf(role) < 0) return false;
    }
    return true;
  }
  function hasStopCode(inv, code) {
    return Array.isArray(inv.stops) && inv.stops.some(function (s) { return s && s.code === code; });
  }
  function notesOf(inv) {
    return Array.isArray(inv.notes) ? inv.notes.filter(function (n) { return n && typeof n.words === 'string' && n.words.trim(); }) : [];
  }
  function superPaidAt(run) {
    if (!run || !run.id) return null;
    if (typeof run.super_marked_paid_at === 'string' && run.super_marked_paid_at.trim()) return run.super_marked_paid_at;
    return superMarkedAt[run.id] || null;
  }
  function serverWords(err) {
    var body = (err && err.body) || {};
    var list = [body.userMessage, body.message, typeof body.error === 'string' ? body.error : null, err && err.message];
    for (var idx = 0; idx < list.length; idx++) {
      var w = list[idx];
      if (typeof w === 'string' && w.trim() && !/^[a-z0-9_]+$/.test(w.trim())) return w.trim();
    }
    return '';
  }
  function writeErrorWords(err, fallback) {
    if (!err || !err.status) {
      return 'The connection dropped before an answer came back. Read the pay run again before pressing again.';
    }
    var words = serverWords(err);
    if (words) return words;
    if (err.status === 403) return 'Only a pay run approver can do this.';
    if (err.status === 409) return 'This pay run changed. The pay run has been read again.';
    return fallback;
  }
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
    var off = state === 'loading' || busy || !week ? ' disabled' : '';
    return '<div class="pr-week"><button type="button" data-week="-7" aria-label="Previous week"' + off + '>&larr; Previous</button>' +
      '<strong data-week-label>' + label + '</strong>' +
      '<button type="button" data-week="7" aria-label="Next week"' + off + '>Next &rarr;</button></div>';
  }
  function actionsBarHtml(d) {
    if (!canAct(d)) return '';
    var dis = busy ? ' disabled' : '';
    var out = '<div class="pr-actions" data-pay-run-actions>';
    if (notice) out += '<p class="pr-notice" role="status" data-pr-notice>' + esc(notice) + '</p>';
    if (actionError) out += '<p class="pr-error" role="alert" data-pr-error>' + esc(actionError) + '</p>';
    if (!d.run) {
      if (!d.run_blocked && d.counts.clean > 0 && typeof d.clean_ids_hash === 'string' && d.clean_ids_hash) {
        if (pending && pending.kind === 'approve') {
          var warned = d.invoices.filter(function (i) { return i.verdict === 'clean' && notesOf(i).length > 0; }).length;
          out += '<div class="pr-confirm" data-pr-confirm="approve"><p>Approve this pay run for week of ' + esc(dayText(d.week_start)) + '? ' +
            esc(plural(d.counts.clean, 'clean invoice', 'clean invoices')) + ', ' + esc(money(d.totals.into_bank)) + ' into bank, ' + esc(money(d.totals.super)) +
            ' super. Nothing is sent to Xero until you push each invoice.</p>' +
            (warned > 0 ? '<p class="pr-warn-line" data-pr-warn-summary>Warning: ' + esc(plural(warned, 'clean invoice carries', 'clean invoices carry')) + ' a work-order warning. Approving still pays them.</p>' : '') +
            '<div class="pr-act-row"><button type="button" class="pr-primary" data-pr-act="approve_yes"' + dis + '>' + (busy === 'approve' ? 'Approving...' : 'Yes, approve pay run') + '</button>' +
            '<button type="button" data-pr-act="cancel"' + dis + '>Cancel</button></div></div>';
        } else {
          out += '<div class="pr-act-row"><button type="button" class="pr-primary" data-pr-act="approve"' + dis + '>Approve pay run</button></div>';
        }
      }
    } else if (d.run && d.run.id) {
      var paidAt = superPaidAt(d.run);
      var statusLabel = d.run.status === 'pushed' ? 'Pay run pushed to Xero' : 'Pay run approved';
      out += '<p class="pr-run-status" data-run-status><strong>' + esc(statusLabel) + '</strong>' +
        (paidAt ? ' &middot; Super marked paid on ' + esc(perthDayText(paidAt)) : '') + '</p>';
      if (d.run.status === 'pushed' && !paidAt) {
        if (pending && pending.kind === 'super') {
          out += '<div class="pr-confirm" data-pr-confirm="super"><p>Mark super paid for week of ' + esc(dayText(d.week_start)) + ' (' + esc(money(d.totals.super)) +
            ')? This records that the office marked super paid.</p>' +
            '<div class="pr-act-row"><button type="button" class="pr-primary" data-pr-act="super_yes"' + dis + '>' + (busy === 'super' ? 'Marking...' : 'Yes, mark super paid') + '</button>' +
            '<button type="button" data-pr-act="cancel"' + dis + '>Cancel</button></div></div>';
        } else {
          out += '<div class="pr-act-row"><button type="button" class="pr-primary" data-pr-act="super"' + dis + '>Mark super paid</button></div>';
        }
      }
    }
    return out + '</div>';
  }
  function rowActionsHtml(d, i) {
    if (!canAct(d) || !d.run || !d.run.id) return '';
    if (i.pushed) return '<div class="pr-row-status"><span class="pr-pushed" data-pushed>Pushed to Xero</span></div>';
    if (hasStopCode(i, 'released_from_run') || hasStopCode(i, 'xero_bill_found_at_release')) return '';
    var dis = busy ? ' disabled' : '';
    var invId = esc(i.invoice_id);
    if (pending && pending.invoiceId === i.invoice_id && pending.kind === 'push') {
      var pushWeek = /^\d{4}-\d{2}-\d{2}$/.test(i.week_start || '') ? i.week_start : d.week_start;
      return '<div class="pr-confirm" data-pr-confirm="push"><p>Push ' + esc(i.invoice_number) + ' (' + esc(i.trade_name) + ', week of ' + esc(dayText(pushWeek)) + ', ' +
        esc(isMoney(i.into_bank) ? money(i.into_bank) + ' into bank' : 'figure not read') + ') to Xero as a draft bill?</p>' +
        '<div class="pr-act-row"><button type="button" class="pr-primary" data-pr-act="push_yes" data-pr-invoice="' + invId + '"' + dis + '>' +
        (busy === 'push' ? 'Pushing...' : 'Yes, push draft bill') + '</button>' +
        '<button type="button" data-pr-act="cancel"' + dis + '>Cancel</button></div></div>';
    }
    if (pending && pending.invoiceId === i.invoice_id && pending.kind === 'release') {
      return '<form class="pr-confirm" data-pr-confirm="release" data-pr-release-form data-pr-invoice="' + invId + '">' +
        '<label>Why is ' + esc(i.invoice_number) + ' coming out of this run? (3 to 500 characters)' +
        '<input type="text" name="reason" minlength="' + RELEASE_REASON_MIN + '" maxlength="' + RELEASE_REASON_MAX + '" required autocomplete="off"' + dis + '></label>' +
        '<div class="pr-act-row"><button type="submit" class="pr-primary"' + dis + '>' + (busy === 'release' ? 'Releasing...' : 'Yes, release from run') + '</button>' +
        '<button type="button" data-pr-act="cancel"' + dis + '>Cancel</button></div></form>';
    }
    var btns = '';
    if (i.verdict === 'clean') {
      btns += '<button type="button" class="pr-primary" data-pr-act="push" data-pr-invoice="' + invId + '"' + dis + '>Push to Xero</button>';
    }
    btns += '<button type="button" data-pr-act="release" data-pr-invoice="' + invId + '"' + dis + '>Release from run</button>';
    return '<div class="pr-row-acts">' + btns + '</div>';
  }
  function draw() {
    if (!section) return;
    var top = '<p class="pr-top">Invoices in by Sunday night. Approve and upload the bank file on Wednesday. Paid on Friday.</p>';
    if (state === 'loading') { section.innerHTML = '<h3>Pay run</h3>' + weekBar() + top + '<p role="status">Reading the pay run...</p>'; return; }
    if (state === 'refused') {
      section.innerHTML = '<h3>Pay run</h3><p role="alert" class="pr-error">' + esc(refusal || 'Only a pay run approver can read the pay run.') + '</p>';
      return;
    }
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
    html += actionsBarHtml(d);
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
          if (d.enabled === true) {
            var notes = notesOf(i);
            if (notes.length) {
              result += '<ul class="pr-notes" data-notes>' + notes.map(function (n) {
                return '<li><span class="pr-warn-tag">Warning</span> ' + esc(n.words) + '</li>';
              }).join('') + '</ul>';
            }
          }
          result += rowActionsHtml(d, i);
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
  async function read(nextWeek, opts) {
    var request = ++readNumber;
    if (nextWeek) week = nextWeek;
    if (!(opts && opts.keepStatus)) { notice = ''; actionError = ''; }
    pending = null;
    state = 'loading'; data = null; draw();
    try {
      var answer = await window.opsFetch('pay_run', week ? { week_start: week } : null);
      if (request !== readNumber) return;
      if (!readable(answer)) throw new Error('Unreadable pay run');
      data = answer; week = answer.week_start; state = 'ready';
    } catch (err) {
      if (request !== readNumber) return;
      data = null; state = 'error';
      if (refused(err)) {
        // Not on the approver list (or signed out): no figures, no retry, and the tab goes.
        state = 'refused';
        refusal = err.body && typeof err.body.message === 'string' ? err.body.message : '';
        probeAnswered = true; seen(null); reveal(false);
      }
    }
    draw();
  }
  function findInvoice(invoiceId) {
    if (!data || !Array.isArray(data.invoices)) return null;
    for (var idx = 0; idx < data.invoices.length; idx++) {
      if (data.invoices[idx].invoice_id === invoiceId) return data.invoices[idx];
    }
    return null;
  }
  async function runWrite(kind, action, body, okMessage, failFallback, onSuccess) {
    if (!data || !canAct(data) || busy) return;
    var reqWeek = data.week_start;
    var reqRead = readNumber;
    busy = kind; notice = ''; actionError = ''; draw();
    var reread = false;
    try {
      var answer = await window.opsPost(action, body);
      if (reqRead !== readNumber) { busy = false; draw(); return; }
      if (!answer || answer.ok !== true) {
        throw Object.assign(new Error('Unconfirmed answer'), { status: 502, body: answer });
      }
      if (typeof onSuccess === 'function') onSuccess(answer);
      busy = false; pending = null; notice = okMessage; actionError = '';
      return read(reqWeek, { keepStatus: true });
    } catch (err) {
      if (reqRead !== readNumber) { busy = false; draw(); return; }
      busy = false; pending = null;
      actionError = writeErrorWords(err, failFallback);
      reread = !!(err && err.status === 409);
    }
    draw();
    if (reread) return read(reqWeek, { keepStatus: true });
  }
  async function handleAction(act, invoiceId) {
    if (!data || !canAct(data) || busy) return;
    actionError = ''; notice = '';
    if (act === 'cancel') { pending = null; draw(); return; }
    if (act === 'approve') {
      if (data.run || data.run_blocked || !data.counts.clean || !data.clean_ids_hash) return;
      pending = { kind: 'approve' }; draw(); return;
    }
    if (act === 'approve_yes') {
      if (!pending || pending.kind !== 'approve' || data.run || data.run_blocked || !data.clean_ids_hash) return;
      return runWrite('approve', 'approve_pay_run',
        { week_start: data.week_start, expected_clean_ids_hash: data.clean_ids_hash },
        'Pay run approved.', 'The pay run could not be approved. Read the pay run again before trying again.');
    }
    if (act === 'push') {
      var inv = findInvoice(invoiceId);
      if (!data.run || !data.run.id || !inv || inv.verdict !== 'clean' || inv.pushed) return;
      pending = { kind: 'push', invoiceId: inv.invoice_id }; draw(); return;
    }
    if (act === 'push_yes') {
      var pushInv = findInvoice(invoiceId);
      if (!pending || pending.kind !== 'push' || pending.invoiceId !== invoiceId || !data.run || !data.run.id || !pushInv || pushInv.pushed) return;
      return runWrite('push', 'push_pay_run_invoice',
        { run_id: data.run.id, invoice_id: pushInv.invoice_id },
        'Pushed ' + pushInv.invoice_number + ' to Xero as a draft bill.',
        'That invoice could not be pushed. Read the pay run again before trying again.');
    }
    if (act === 'release') {
      var relInv = findInvoice(invoiceId);
      if (!data.run || !data.run.id || !relInv || relInv.pushed || hasStopCode(relInv, 'released_from_run') || hasStopCode(relInv, 'xero_bill_found_at_release')) return;
      pending = { kind: 'release', invoiceId: relInv.invoice_id }; draw();
      var input = section && section.querySelector('[data-pr-release-form] input[name="reason"]');
      if (input) input.focus();
      return;
    }
    if (act === 'super') {
      if (!data.run || !data.run.id || data.run.status !== 'pushed' || superPaidAt(data.run)) return;
      pending = { kind: 'super' }; draw(); return;
    }
    if (act === 'super_yes') {
      if (!pending || pending.kind !== 'super' || !data.run || !data.run.id || data.run.status !== 'pushed') return;
      var runId = data.run.id;
      return runWrite('super', 'mark_pay_run_super_paid',
        { run_id: runId },
        'Super marked paid.', 'Super could not be marked paid. Read the pay run again before trying again.',
        function (ans) {
          superMarkedAt[runId] = (ans && typeof ans.super_marked_paid_at === 'string' && ans.super_marked_paid_at) || new Date().toISOString();
        });
    }
  }
  async function handleReleaseSubmit(form) {
    if (!data || !canAct(data) || busy || !data.run || !data.run.id) return;
    var invoiceId = form.getAttribute('data-pr-invoice');
    var inv = findInvoice(invoiceId);
    if (!pending || pending.kind !== 'release' || pending.invoiceId !== invoiceId || !inv || inv.pushed) return;
    var reason = String((form.elements && form.elements.reason && form.elements.reason.value) || '').trim();
    if (reason.length < RELEASE_REASON_MIN || reason.length > RELEASE_REASON_MAX) {
      actionError = 'Say why the invoice is coming out of the run (3 to 500 characters).';
      draw(); return;
    }
    return runWrite('release', 'release_pay_run_invoice',
      { run_id: data.run.id, invoice_id: inv.invoice_id, reason: reason },
      'Released ' + inv.invoice_number + ' back to review.',
      'That invoice could not be released. Read the pay run again before trying again.');
  }
  // One pay_run read after sign in decides whether this person sees the tab.
  // Only a whole, readable answer shows it; nothing from it is drawn here.
  function probe() {
    if (!probeAnswered) reveal(seen() === '1');
    if (typeof window.opsFetch !== 'function') return Promise.resolve(seen() === '1');
    if (probing) return probing;
    probing = (async function () {
      try {
        var answer = await window.opsFetch('pay_run');
        if (readable(answer)) { probeAnswered = true; seen('1'); reveal(true); return true; }
      } catch (err) {
        if (refused(err)) { probeAnswered = true; seen(null); reveal(false); return false; }
      }
      // Any other failure: keep what this browser last saw.
      return seen() === '1';
    })();
    probing.then(function () { probing = null; });
    return probing;
  }
  function open(hostEl, tabButton) {
    if (!hostEl) throw new Error('A Pay run host is required');
    if (!document.getElementById('pay-run-style')) {
      var style = document.createElement('style'); style.id = 'pay-run-style';
      style.textContent = '[data-pay-run]{color:var(--text,#1e293b);font-size:14px;line-height:1.5} [data-pay-run] h3{font-size:18px;margin:0 0 12px} [data-pay-run] h4{font-size:15px;margin:24px 0 8px} [data-pay-run] p{margin:6px 0} [data-pay-run] .pr-top{font-weight:600} [data-pay-run] .pr-week{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px} [data-pay-run] button{border:1px solid var(--border,#cbd5e1);background:var(--surface,#fff);color:inherit;border-radius:6px;min-height:40px;padding:6px 14px;cursor:pointer} [data-pay-run] button:disabled{opacity:.55;cursor:wait} [data-pay-run] button:focus-visible,[data-pay-run] input:focus-visible{outline:2px solid #2563eb;outline-offset:2px} [data-pay-run] .pr-primary{background:#1f5fbf;color:#fff;border-color:#1f5fbf} [data-pay-run] .pr-actions{margin:12px 0} [data-pay-run] .pr-act-row,[data-pay-run] .pr-row-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px} [data-pay-run] .pr-confirm{margin-top:8px;padding:12px;border-radius:8px;background:#f3f7ff;border:1px solid #c9dcf7} [data-pay-run] .pr-confirm label{display:block;font-size:13px} [data-pay-run] .pr-confirm input{display:block;width:100%;max-width:420px;box-sizing:border-box;min-height:40px;margin-top:6px;padding:6px 8px;border:1px solid #94a3b8;border-radius:6px;background:#fff;color:inherit} [data-pay-run] .pr-notice{background:#eaf6ee;color:#1d5b33;padding:8px 12px;border-radius:6px;font-weight:600} [data-pay-run] .pr-run-status{font-size:14px} [data-pay-run] .pr-pushed{color:#15803d;font-weight:600;font-size:13px} [data-pay-run] .pr-row-status{margin-top:4px} [data-pay-run] .pr-notes{margin:4px 0 0;padding-left:18px;color:#8a4b00;font-size:13px} [data-pay-run] .pr-warn-tag{display:inline-block;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;background:#fff4e5;color:#8a4b00;margin-right:4px} [data-pay-run] .pr-warn-line{color:#8a4b00;font-weight:600} [data-pay-run] .pr-checks{list-style:none;padding:0;margin:12px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:6px 16px} [data-pay-run] .pr-checks li{display:grid;grid-template-columns:20px 1fr;column-gap:8px} [data-pay-run] .pr-checks li .pr-muted{grid-column:2} [data-pay-run] .pr-pass>span:first-child{color:#15803d;font-weight:700} [data-pay-run] .pr-fail>span:first-child{color:#b91c1c;font-weight:700} [data-pay-run] .pr-muted{color:var(--text-secondary,#526071);font-size:13px} [data-pay-run] .pr-held-out{color:#925c08;font-weight:600} [data-pay-run] .pr-counts{display:flex;flex-wrap:wrap;gap:8px 24px;margin:16px 0;padding:12px 0;border-top:1px solid var(--border,#e2e8f0);border-bottom:1px solid var(--border,#e2e8f0)} [data-pay-run] .pr-counts b{font-variant-numeric:tabular-nums;margin-left:4px} [data-pay-run] .pr-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap} [data-pay-run] .pr-clean{color:#15803d;font-weight:600} [data-pay-run] .pr-stopped{color:#b91c1c;font-weight:600} [data-pay-run] .pr-stops{margin:4px 0 0;padding-left:18px;color:#7f1d1d;font-size:13px} [data-pay-run] .pr-none{color:var(--text-secondary,#526071)} [data-pay-run] .pr-total td{font-weight:700} [data-pay-run] .pr-error{color:#9f2424} [data-pay-run] .pr-blocked{background:#fef2f2;border:2px solid #b91c1c;color:#7f1d1d;border-radius:8px;padding:12px 16px;margin:0 0 16px} [data-pay-run] .pr-blocked strong{font-size:16px} [data-pay-run] .data-table-wrap{overflow-x:auto}';
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
        if (!button || button.disabled || button.type === 'submit') return;
        if (button.hasAttribute('data-retry')) { read(); return; }
        if (button.hasAttribute('data-week') && week) { read(stepWeek(week, Number(button.getAttribute('data-week')))); return; }
        var act = button.getAttribute('data-pr-act');
        if (act) handleAction(act, button.getAttribute('data-pr-invoice'));
      };
      section.onsubmit = function (event) {
        var form = event.target;
        if (!form || !form.hasAttribute('data-pr-release-form')) return;
        event.preventDefault();
        handleReleaseSubmit(form);
      };
    }
    return read();
  }
  window.PayRun = { open: open, read: read, probe: probe };
  // Loaded after sign in: probe now. Loaded before: ops.html calls probe() at start.
  if (window._opsAppStarted) probe();
})();
