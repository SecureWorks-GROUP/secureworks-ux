// Daily hours nudge for the Trade App.
// A small reminder when today's start and finish are not on the weekly draft.
// It never submits, sends, or chases. The running-draft flag decides who sees it.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TradeDailyHoursNudge = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var CLOSED = { cancelled: 1, canceled: 1, declined: 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function dismissKey(userId) {
    var id = String(userId || '');
    return id ? 'sw_hours_nudge_day:' + id : 'sw_hours_nudge_day';
  }

  function minutes(value) {
    var match = /^(\d{1,2}):(\d{2})/.exec(String(value == null ? '' : value).trim());
    if (!match || +match[1] > 23 || +match[2] > 59) return null;
    return +match[1] * 60 + +match[2];
  }

  // A draft line has today's hours when the date is today and the finish is
  // after the start. Work-order and commission lines are not hours.
  function timeComplete(line, today) {
    if (!line || line.wo_mode || line.commission_mode || line.included === false) return false;
    var day = String(line.work_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    if (today && day !== today) return false;
    var start = minutes(line.start_time);
    var finish = minutes(line.finish_time);
    return start != null && finish != null && finish > start;
  }

  function jobsFromAssignments(rows, today) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function (row) {
      if (!row) return;
      var status = String(row.status || '').toLowerCase();
      if (CLOSED[status]) return;
      if (String(row.role || '').toLowerCase() === 'observer') return;
      var day = String(row.scheduled_date || '').slice(0, 10);
      if (today && day !== today) return;
      var job = row.jobs || {};
      var item = {
        assignment_id: String(row.id || row.assignment_id || ''),
        job_id: String(row.job_id || job.id || ''),
        job_number: String(job.job_number || row.job_number || ''),
        client_name: String(job.client_name || row.client_name || ''),
        site_suburb: String(job.site_suburb || row.site_suburb || ''),
        scheduled_date: day
      };
      if (!item.assignment_id && !item.job_id) return;
      var key = item.assignment_id ? 'as:' + item.assignment_id : 'job:' + item.job_id;
      if (seen[key]) return;
      seen[key] = 1;
      out.push(item);
    });
    return out;
  }

  function lineCovers(line, job, today) {
    if (!timeComplete(line, today) || !job) return false;
    if (job.assignment_id && line.assignment_id && String(line.assignment_id) === String(job.assignment_id)) return true;
    if (job.job_id && line.job_id && String(line.job_id) === String(job.job_id)) return true;
    return false;
  }

  function missing(jobs, lines, today) {
    return (jobs || []).filter(function (job) {
      return !(lines || []).some(function (line) { return lineCovers(line, job, today); });
    });
  }

  // lines null means the draft has not been read yet. Stay quiet rather than
  // tell someone their hours are missing when we do not know.
  function shouldShow(state) {
    state = state || {};
    if (!state.flagOn) return false;
    if (!state.today) return false;
    if (state.dismissedDay && state.dismissedDay === state.today) return false;
    if (state.weekSubmitted) return false;
    if (state.lines == null) return false;
    var jobs = state.jobsToday || [];
    if (!jobs.length) return false;
    return missing(jobs, state.lines, state.today).length > 0;
  }

  function copy(count) {
    var n = Number(count) || 0;
    var tail = ' Save keeps the draft. It does not send the invoice.';
    if (n > 1) {
      return {
        title: "Add today's hours",
        body: n + ' jobs today still need a start and finish on your weekly draft.' + tail
      };
    }
    return {
      title: "Add today's hours",
      body: "Add today's start and finish on your weekly draft, then check it." + tail
    };
  }

  function bannerHTML(state) {
    var jobs = missing((state && state.jobsToday) || [], (state && state.lines) || [], state && state.today);
    var text = copy(jobs.length);
    return '<div class="hours-nudge" data-hours-nudge>'
      + '<div class="hours-nudge-title">' + esc(text.title) + '</div>'
      + '<div class="hours-nudge-body">' + esc(text.body) + '</div>'
      + '<div class="hours-nudge-actions">'
      + '<button type="button" class="hours-nudge-go" data-hours-nudge-go onclick="openDailyHoursNudge()">Add hours</button>'
      + '<button type="button" class="hours-nudge-later" data-hours-nudge-later onclick="dismissDailyHoursNudge()">Not today</button>'
      + '</div></div>';
  }

  function landHTML(job) {
    var name = job && (job.job_number || job.client_name) ? String(job.job_number || job.client_name) : '';
    var which = name ? ' on ' + name : '';
    return '<div class="hours-nudge hours-nudge-land" data-hours-nudge-land>'
      + '<div class="hours-nudge-body">Add today\'s start and finish' + esc(which) + '. Then check the draft. Save keeps it. It does not send the invoice.</div>'
      + '<div class="hours-nudge-actions"><button type="button" class="hours-nudge-later" data-hours-nudge-check onclick="scrollDailyHoursDraft()">Check draft</button></div>'
      + '</div>';
  }

  return {
    dismissKey: dismissKey,
    timeComplete: timeComplete,
    jobsFromAssignments: jobsFromAssignments,
    missing: missing,
    shouldShow: shouldShow,
    copy: copy,
    bannerHTML: bannerHTML,
    landHTML: landHTML
  };
});
