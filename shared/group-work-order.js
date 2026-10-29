// Group work order (backend docs/group-work-orders-v1.md).
// A trade sees pot_total and my_share only. The client page shows no pay.
// There is no send control: the client-link sender is not built.
//
// <group-work-order-core>
var GroupWorkOrderCore = (function () {
  'use strict';

  var NOTICE = 'These ratings go to the office. They are not viewed by the installers.';
  var RATINGS = [
    ['sales_process', 'Sales process'],
    ['communication', 'Communication'],
    ['cleanliness', 'Cleanliness'],
    ['punctuality', 'Punctuality'],
    ['crew', 'Crew on site']
  ];

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var neg = v < 0;
    var parts = Math.abs(Math.round(v * 100) / 100).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts[0] + '.' + parts[1];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // The server has said the switch is on. A 401, 403, 404 or any other error
  // is not that, so those stay off.
  function switchOn(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.group_work_order_enabled === true || data.enabled === true) return true;
    if (data.job && data.job.group_work_order_enabled === true) return true;
    if (data.group_work_order && data.group_work_order.enabled === true) return true;
    return false;
  }

  function isOff(res, err) {
    if (err) return true;
    if (res && res.enabled === false) return true;
    return false;
  }

  // Create and Join only from a successful read that says the switch is on.
  // A share payload (group id or the two amounts) is that read. A bare
  // not-found is an error and never reaches here.
  function tradeMode(res) {
    if (!res || res.enabled === false) return 'off';
    if (res.enabled === true && !res.group_id) return res.participant === false ? 'join' : 'create';
    if (res.group_id || res.needs_hours === true || res.pot_total != null || res.my_share != null) {
      return res.needs_hours ? 'hours' : 'share';
    }
    return 'off';
  }

  function errCode(err) {
    if (!err) return '';
    return String(err.code || (err.body && err.body.code) || '');
  }

  // The only fields a trade card may use. Anything else on the payload,
  // including another person's share or agreed labour, is dropped.
  function closedShare(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var needs = src.needs_hours === true;
    return {
      pot_total: needs ? null : finiteOrNull(src.pot_total),
      my_share: needs ? null : finiteOrNull(src.my_share),
      needs_hours: needs,
      client_signed: src.client_signed === true,
      awaiting: String(src.awaiting || ""),
      group_id: src.group_id == null ? '' : String(src.group_id)
    };
  }

  function finiteOrNull(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function hoursForm() {
    return '<div data-group-wo-hours>' +
      '<label>Date worked <input data-group-wo-date type="date" aria-label="Date worked"></label>' +
      '<label>Start <input data-group-wo-start type="time" aria-label="Start"></label>' +
      '<label>Finish <input data-group-wo-finish type="time" aria-label="Finish"></label>' +
      '<label>Break minutes <input data-group-wo-break inputmode="numeric" aria-label="Break minutes"></label>' +
      '<button type="button" data-group-wo-action="save-hours">Save hours</button>' +
      '</div>';
  }

  function tradeHtml(mode, raw, message) {
    if (mode === 'off') return '';
    var h = '<section data-group-wo aria-label="Group work order">';
    h += '<div class="gwo-title">Group work order</div>';
    if (mode === 'create') {
      h += '<p>No group on this job yet.</p>';
      h += '<button type="button" data-group-wo-action="create">Create</button>';
    } else if (mode === 'join') {
      h += '<p>You are not on this group yet.</p>';
      h += '<button type="button" data-group-wo-action="join">Join</button>';
    } else if (mode === 'error') {
      h += '<p data-group-wo-msg>' + esc(message || 'That could not be read.') + '</p>';
    } else {
      var view = closedShare(raw);
      h += '<p data-group-wo-signed>' + (view.client_signed ? 'Client sign-off recorded.' : 'Waiting for client sign-off or an office override.') + '</p>';
      if (view.pot_total != null) h += '<p data-group-wo-total>Total ' + esc(money(view.pot_total)) + '</p>';
      if (view.my_share != null) h += '<p data-group-wo-share>Your share ' + esc(money(view.my_share)) + '</p>';
      if (view.needs_hours) h += '<p data-group-wo-needs-hours>Save your hours to see your share.</p>';
      var waiting = {
        awaiting_signoff: 'The office needs to record client sign-off before your share can be finalised.',
        awaiting_others: 'Waiting for the remaining crew hours.',
        awaiting_rate: 'The office needs to confirm crew rates.',
        ready: 'Hours and sign-off are ready. Your share has not been finalised yet.',
        frozen: 'Your share is finalised.'
      };
      if (waiting[view.awaiting]) h += '<p data-group-wo-status>' + esc(waiting[view.awaiting]) + '</p>';
      if (view.awaiting !== 'frozen') h += hoursForm();
    }
    if (message && mode !== 'error') h += '<p data-group-wo-msg>' + esc(message) + '</p>';
    h += '</section>';
    return h;
  }

  function parseHours(fields) {
    fields = fields || {};
    var date = String(fields.work_date || '').trim();
    var start = String(fields.start_time || '').trim();
    var finish = String(fields.finish_time || '').trim();
    if (!date || !start || !finish) return { error: 'Enter the date, the start and the finish.' };
    var br = String(fields.break_minutes == null ? '' : fields.break_minutes).trim();
    if (br && (!isFinite(Number(br)) || Number(br) < 0)) return { error: 'Break minutes must be zero or more.' };
    return { work_date: date, start_time: start, finish_time: finish, break_minutes: br ? Math.round(Number(br)) : null };
  }

  function hoursBody(groupId, parsed) {
    var body = {
      group_id: groupId,
      work_date: parsed.work_date,
      start_time: parsed.start_time,
      finish_time: parsed.finish_time
    };
    if (parsed.break_minutes != null) body.break_minutes = parsed.break_minutes;
    return body;
  }

  function publicHtml(read) {
    if (!read || read.enabled === false) return '';
    var h = '<section data-group-sign aria-label="Sign the job">';
    h += '<h1>Sign the job</h1>';
    var who = read.job_number || 'Job';
    if (read.site_suburb) who += ' · ' + read.site_suburb;
    h += '<p data-group-sign-job>' + esc(who) + '</p>';
    if (read.job_type) h += '<p data-group-sign-type>' + esc(read.job_type) + '</p>';
    h += '<p data-group-sign-notice>' + esc(read.office_only_notice || NOTICE) + '</p>';
    if (!read.client_signed) {
      h += '<label>Your name <input data-group-sign-name aria-label="Your name"></label>';
      h += '<canvas data-group-sign-pad width="320" height="140"></canvas>';
      h += '<div><button type="button" data-group-sign-clear>Clear</button> ';
      h += '<button type="button" data-group-sign-submit>Sign</button></div>';
    } else if (read.feedback_submitted) {
      h += '<p data-group-sign-done>The office has your ratings.</p>';
    } else {
      h += ratingsForm();
    }
    h += '<p data-group-sign-msg hidden></p></section>';
    return h;
  }

  function ratingsForm() {
    var h = '<div data-group-sign-ratings>';
    RATINGS.forEach(function (pair) {
      h += '<fieldset><legend>' + esc(pair[1]) + '</legend>';
      for (var n = 1; n <= 5; n++) {
        h += '<label><input type="radio" name="gwo_' + esc(pair[0]) + '" value="' + n + '" data-group-sign-rating="' + esc(pair[0]) + '"> ' + n + '</label>';
      }
      h += '<label>Comment <input data-group-sign-comment="' + esc(pair[0]) + '" aria-label="' + esc(pair[1]) + ' comment"></label>';
      h += '</fieldset>';
    });
    h += '<label>Anything else <textarea data-group-sign-free aria-label="Anything else"></textarea></label>';
    h += '<button type="button" data-group-sign-save>Save ratings</button></div>';
    return h;
  }

  function feedbackBody(token, fields) {
    var body = { share_token: token, submitted_via: 'share_link' };
    var free = String(fields.free_text || '').trim();
    if (free) body.free_text = free;
    RATINGS.forEach(function (pair) {
      var key = pair[0];
      var row = { rating: fields[key] };
      var comment = String(fields[key + '_comment'] || '').trim();
      if (comment) row.comment = comment;
      body[key] = row;
    });
    return body;
  }

  function shareName(read, row) {
    var id = row && row.user_id != null ? String(row.user_id) : '';
    var people = (read && read.participants) || [];
    for (var i = 0; i < people.length; i++) {
      if (people[i] && String(people[i].user_id) === id && (people[i].name || people[i].signature_name)) return String(people[i].name || people[i].signature_name);
    }
    return 'Crew member';
  }

  function officeHtml(read) {
    if (!read || read.enabled === false) return '';
    var h = '<section data-office-group-wo-card aria-label="Group work order">';
    h += '<div class="gwo-title">Group work order</div>';
    if (finiteOrNull(read.pot_total) != null) h += '<p data-office-group-total>Total ' + esc(money(read.pot_total)) + '</p>';
    h += '<p>' + (read.client_signed ? 'Client sign-off recorded.' : 'Waiting for client sign-off or an office override.') + '</p>';
    if (read.client_signoff_method === 'office_waiver') {
      h += '<p data-office-group-override>Recorded by the office: ' + esc(read.client_signoff_reason || '') + '</p>';
    }
    var people = Array.isArray(read.participants) ? read.participants : [];
    var hours = Array.isArray(read.hours) ? read.hours : [];
    if (people.length) {
      h += '<ul aria-label="Crew hours">';
      people.forEach(function (person) {
        var total = hours.filter(function (row) { return row.user_id === person.user_id; }).reduce(function (sum, row) { return sum + (Number(row.hours) || 0); }, 0);
        h += '<li>' + esc(shareName(read, person)) + ': ' + esc(total) + ' hours saved</li>';
      });
      h += '</ul>';
    }
    if (!read.client_signed) {
      h += '<form data-office-signoff-form>';
      h += '<label>Reason for office sign-off <textarea data-office-signoff-reason required minlength="3" maxlength="2000" placeholder="Who confirmed the client approval, and when?"></textarea></label>';
      h += '<p>This records an office override. It does not create a client signature or submit invoices.</p>';
      h += '<button type="submit">Record office sign-off</button></form>';
    }
    h += '<p data-office-group-message role="status" aria-live="polite"></p>';
    var shares = Array.isArray(read.shares) ? read.shares : [];
    if (!shares.length) h += '<p data-office-group-shares>' + (read.client_signed ? 'Sign-off recorded. Shares have not been finalised yet.' : 'Shares are waiting for sign-off.') + '</p>';
    else {
      h += '<ul data-office-group-shares>';
      shares.forEach(function (row) {
        if (!row) return;
        h += '<li>' + esc(shareName(read, row));
        if (finiteOrNull(row.share_ex) != null) h += ' ' + esc(money(row.share_ex));
        h += '</li>';
      });
      h += '</ul>';
    }
    var fb = read.feedback;
    if (!fb) h += '<p data-office-group-feedback>No ratings yet.</p>';
    else {
      h += '<div data-office-group-feedback>';
      RATINGS.forEach(function (pair) {
        var value = fb[pair[0] + '_rating'];
        h += '<p>' + esc(pair[1]) + ': ' + esc(value == null ? '' : value) + '</p>';
      });
      if (fb.free_text) h += '<p>' + esc(fb.free_text) + '</p>';
      h += '</div>';
    }
    if (read.split_frozen) h += '<button type="button" data-group-wo-unfreeze>Reopen the split</button>';
    h += '</section>';
    return h;
  }

  return {
    NOTICE: NOTICE,
    money: money,
    esc: esc,
    switchOn: switchOn,
    isOff: isOff,
    tradeMode: tradeMode,
    errCode: errCode,
    closedShare: closedShare,
    tradeHtml: tradeHtml,
    parseHours: parseHours,
    hoursBody: hoursBody,
    publicHtml: publicHtml,
    feedbackBody: feedbackBody,
    officeHtml: officeHtml
  };
})();
// </group-work-order-core>

if (typeof window !== 'undefined') window.GroupWorkOrderCore = GroupWorkOrderCore;
if (typeof module !== 'undefined' && module.exports) module.exports = GroupWorkOrderCore;
