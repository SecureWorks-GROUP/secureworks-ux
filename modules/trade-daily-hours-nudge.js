// Daily hours nudge for the Trade App.
// A small card when today's jobs do not yet have start and finish on the
// weekly draft. It never submits, sends, or scores anyone.
// Same switch as the running draft: off unless that flag is on.
// Hours match TradeTimeEntryCore: work_date today, finish after start.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TradeDailyHoursNudge = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function sourceKey(line) {
    var core = (typeof window !== 'undefined' && window.TradeInvoiceRunningDraft)
      || (typeof globalThis !== 'undefined' && globalThis.TradeInvoiceRunningDraft);
    if (core && typeof core.sourceKey === 'function') return core.sourceKey(line);
    if (!line || typeof line !== 'object') return '';
    if (line.source_key) return String(line.source_key);
    if (line.work_order_id) return 'wo:' + line.work_order_id;
    if (line.assignment_id) return 'as:' + line.assignment_id;
    var day = line.work_date || line.scheduled_date || line.line_date || '';
    if (line.job_id && day) return 'job:' + line.job_id + ':' + String(day).slice(0, 10);
    return '';
  }

  function minutesOf(value) {
    var match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value == null ? '' : value).trim());
    if (!match || +match[1] > 23 || +match[2] > 59) return null;
    return +match[1] * 60 + +match[2];
  }

  function hoursOf(start, finish, brk) {
    var s = minutesOf(start);
    var f = minutesOf(finish);
    var b = (brk == null || brk === '') ? 0 : Number(brk);
    if (s == null || f == null || !isFinite(b) || b < 0 || Math.floor(b) !== b) return null;
    if (f <= s || f - s - b <= 0) return null;
    return Math.round((f - s - b) / 60 * 100) / 100;
  }

  function dayOf(value) {
    return String(value || '').slice(0, 10);
  }

  function asSet(list) {
    var out = {};
    (list || []).forEach(function (key) { if (key) out[String(key)] = 1; });
    return out;
  }

  // A time line is logged only when the date worked is today and the times
  // work out to hours. A work-order or commission card for today is already
  // on the draft in its own way, so it does not keep asking for hours.
  function settled(line, today) {
    if (!line || line.included === false) return false;
    if (line.wo_mode || line.commission_mode) {
      var placed = dayOf(line.scheduled_date || line.work_date || line.date);
      return placed === today;
    }
    if (dayOf(line.work_date || line.date) !== today) return false;
    return hoursOf(line.start_time, line.finish_time, line.break_minutes) > 0;
  }

  function place(job) {
    var name = job.job_number || job.client_name || 'A job';
    if (job.site_suburb) return name + ' in ' + job.site_suburb;
    return name;
  }

  function detailFor(open) {
    if (open.length === 1) {
      return place(open[0]) + ' is on today. Add your start and finish, then look over the week. Nothing is sent.';
    }
    var shown = open.slice(0, 3).map(place).join(', ');
    var more = open.length > 3 ? ' and ' + (open.length - 3) + ' more' : '';
    return shown + more + ' still need your start and finish. Then look over the week. Nothing is sent.';
  }

  function decide(state) {
    state = state || {};
    var today = dayOf(state.today);
    if (!state.flag) return { show: false, reason: 'off', open: [] };
    if (!today) return { show: false, reason: 'no-day', open: [] };
    if (state.dismissedOn && dayOf(state.dismissedOn) === today) {
      return { show: false, reason: 'dismissed', open: [] };
    }
    if (state.weekSubmitted) return { show: false, reason: 'submitted', open: [] };

    var claimed = asSet(state.claimed);
    var dismissed = asSet(state.dismissed);
    var jobs = {};

    function consider(line) {
      if (!line || typeof line !== 'object') return;
      var key = sourceKey(line);
      if (!key || claimed[key] || dismissed[key]) return;
      var scheduled = dayOf(line.scheduled_date);
      var worked = dayOf(line.work_date || line.date);
      if (scheduled !== today && worked !== today) return;
      var row = jobs[key] || {
        key: key,
        job_number: '',
        client_name: '',
        site_suburb: '',
        logged: false
      };
      if (line.job_number) row.job_number = String(line.job_number);
      if (line.client_name) row.client_name = String(line.client_name);
      if (line.site_suburb) row.site_suburb = String(line.site_suburb);
      if (settled(line, today)) row.logged = true;
      jobs[key] = row;
    }

    (state.suggested || []).forEach(consider);
    (state.cards || []).forEach(consider);

    var open = Object.keys(jobs).map(function (key) { return jobs[key]; }).filter(function (job) {
      return !job.logged;
    }).sort(function (a, b) {
      return String(a.job_number).localeCompare(String(b.job_number));
    });
    var any = Object.keys(jobs).length;
    if (!any) return { show: false, reason: 'no-job', open: [] };
    if (!open.length) return { show: false, reason: 'logged', open: [] };
    return {
      show: true,
      reason: 'open',
      title: "Add today's hours",
      detail: detailFor(open),
      open: open
    };
  }

  return {
    sourceKey: sourceKey,
    hoursOf: hoursOf,
    decide: decide
  };
});
