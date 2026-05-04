// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 5) — Outcome Attribution
//
// Pure module. Given a JobBrain index payload (jobs, events,
// playbooks, now), returns deterministic per-job outcomes plus
// per-rep weekly + monthly rollups + a CEO leaderboard.
//
// Hard rules:
//   - No fetch, no XHR, no DOM, no localStorage.
//   - Pure: same input → same output. Inputs not mutated.
//   - Returns a fully-shaped result on malformed input rather
//     than throwing. Diagnostics carry the skip reasons.
//   - Dual export: window.SALE_OUTCOMES + module.exports.
//
// Public API:
//   SALE_OUTCOMES.attribute({ jobs, events, playbooks, now })
//     → AttributionResult
//
// See loop-5-outcome-attribution-spec.md for the full contract.
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_OUTCOMES = exports;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ATTRIBUTION_TOLERANCE_DAYS = 1;            // ±1 day rung map tolerance
  var ARCHIVE_THRESHOLD_DAYS     = 30;           // sent > N days w/ no terminal → archived
  var OUTBOUND_TYPES = ['client.sms_out', 'client.email_out', 'client.call_complete'];

  // ── Helpers ────────────────────────────────────────────────

  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'string' || typeof v === 'number') {
      var d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function eventsFor(events, jobId) {
    if (!Array.isArray(events)) return [];
    return events.filter(function (e) { return e && e.job_id === jobId; });
  }

  function lastEvent(jobEvents, type) {
    var matches = (jobEvents || []).filter(function (e) { return e && e.event_type === type; });
    if (!matches.length) return null;
    matches.sort(function (a, b) {
      return +new Date(b.occurred_at || b.created_at || 0) - +new Date(a.occurred_at || a.created_at || 0);
    });
    return matches[0];
  }

  // Like lastEvent, but only returns events whose occurred_at > sinceMs.
  // Used to prevent a re-sent quote from inheriting a stale terminal
  // event from a prior send cycle.
  function lastEventAfter(jobEvents, type, sinceMs) {
    var matches = (jobEvents || []).filter(function (e) {
      if (!e || e.event_type !== type) return false;
      var t = +new Date(e.occurred_at || e.created_at || 0);
      return !isNaN(t) && t > sinceMs;
    });
    if (!matches.length) return null;
    matches.sort(function (a, b) {
      return +new Date(b.occurred_at || b.created_at || 0) - +new Date(a.occurred_at || a.created_at || 0);
    });
    return matches[0];
  }

  function repForType(type) {
    var t = (type || '').toLowerCase();
    if (t === 'fencing') return 'Khairo';
    if (t === 'patio' || t === 'combo' || t === 'decking' || t === 'general') return 'Nithin';
    return 'Unassigned';
  }

  function refFromEvent(ev) {
    return {
      type:        'event',
      source_table: 'business_events',
      id:           ev.id || null,
      occurred_at:  ev.occurred_at || null,
      event_type:   ev.event_type,
    };
  }
  function refComputed(reason) {
    return { type: 'computed', source_table: null, id: null, reason: reason };
  }

  // Perth-week boundaries (Monday 00:00 +08:00 → following Monday).
  function perthWeekStart(nowDate) {
    var d = new Date(nowDate.getTime());
    // Convert to Perth (UTC+8), find Monday 00:00.
    var perthMs = d.getTime() + 8 * 3600 * 1000;
    var perthDate = new Date(perthMs);
    var dow = perthDate.getUTCDay();              // 0 Sun..6 Sat
    var daysSinceMonday = (dow + 6) % 7;          // Mon=0, Sun=6
    var perthMonday = new Date(Date.UTC(
      perthDate.getUTCFullYear(),
      perthDate.getUTCMonth(),
      perthDate.getUTCDate() - daysSinceMonday,
      0, 0, 0
    ));
    // Convert back from Perth midnight to actual UTC instant.
    return new Date(perthMonday.getTime() - 8 * 3600 * 1000);
  }

  function perthMonthStart(nowDate) {
    var perthMs = nowDate.getTime() + 8 * 3600 * 1000;
    var perthDate = new Date(perthMs);
    var perthFirst = new Date(Date.UTC(
      perthDate.getUTCFullYear(),
      perthDate.getUTCMonth(),
      1, 0, 0, 0
    ));
    return new Date(perthFirst.getTime() - 8 * 3600 * 1000);
  }

  function median(arr) {
    if (!arr.length) return null;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    if (n % 2 === 1) return sorted[(n - 1) / 2];
    return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }

  // ── Per-job outcome resolution ─────────────────────────────

  function resolveOutcome(jobEvents, sentMs, nowMs) {
    // Only count terminal events that occurred AFTER the most recent
    // quote.sent. Otherwise a re-sent quote would inherit a stale
    // accepted/declined outcome from a prior send cycle (Codex catch).
    var acceptedEv = lastEventAfter(jobEvents, 'quote.accepted', sentMs);
    var declinedEv = lastEventAfter(jobEvents, 'quote.declined', sentMs);
    if (acceptedEv && declinedEv) {
      // Whichever occurred later wins.
      return +new Date(acceptedEv.occurred_at) >= +new Date(declinedEv.occurred_at)
        ? { outcome: 'accepted', terminalEv: acceptedEv }
        : { outcome: 'declined', terminalEv: declinedEv };
    }
    if (acceptedEv) return { outcome: 'accepted', terminalEv: acceptedEv };
    if (declinedEv) return { outcome: 'declined', terminalEv: declinedEv };
    var ageDays = (nowMs - sentMs) / (24 * 3600 * 1000);
    if (ageDays >= ARCHIVE_THRESHOLD_DAYS) {
      return { outcome: 'archived', terminalEv: null };
    }
    return { outcome: 'in_flight', terminalEv: null };
  }

  function attemptCount(jobEvents, sinceMs) {
    var n = 0;
    for (var i = 0; i < jobEvents.length; i++) {
      var ev = jobEvents[i];
      if (!ev || OUTBOUND_TYPES.indexOf(ev.event_type) === -1) continue;
      if (ev.direction && ev.direction !== 'outbound') continue;
      var t = +new Date(ev.occurred_at || 0);
      if (!isNaN(t) && t > sinceMs) n++;
    }
    return n;
  }

  function lastOutboundBefore(jobEvents, beforeMs, sinceMs) {
    var best = null;
    var bestT = -Infinity;
    for (var i = 0; i < jobEvents.length; i++) {
      var ev = jobEvents[i];
      if (!ev || OUTBOUND_TYPES.indexOf(ev.event_type) === -1) continue;
      if (ev.direction && ev.direction !== 'outbound') continue;
      var t = +new Date(ev.occurred_at || 0);
      if (isNaN(t)) continue;
      if (t <= sinceMs) continue;          // must be after sent
      if (t > beforeMs) continue;          // must be before close
      if (t > bestT) { bestT = t; best = ev; }
    }
    return best;
  }

  function resolveAttributionRung(outcome, jobEvents, sentMs, terminalEv, playbook) {
    if (outcome === 'in_flight') return 'in_flight';
    if (!playbook || !Array.isArray(playbook.followup_ladder) || !playbook.followup_ladder.length) {
      return 'unknown';
    }
    if (!terminalEv) return 'unknown';     // archived without terminal event
    var closedMs = +new Date(terminalEv.occurred_at);
    var lastOut = lastOutboundBefore(jobEvents, closedMs, sentMs);
    if (!lastOut) return 't0_sent';        // no rep follow-ups; the quote itself closed
    var deltaDays = (+new Date(lastOut.occurred_at) - sentMs) / (24 * 3600 * 1000);
    var ladder = playbook.followup_ladder;
    var bestId = 'unknown_rung';
    var bestDelta = Infinity;
    for (var i = 0; i < ladder.length; i++) {
      var rung = ladder[i];
      var d = Math.abs(rung.offset_days - deltaDays);
      if (d <= ATTRIBUTION_TOLERANCE_DAYS && d < bestDelta) {
        bestId = rung.template_id;
        bestDelta = d;
      }
    }
    return bestId;
  }

  function pickPlaybookForJob(rep, playbooks) {
    if (!playbooks) return null;
    var lowered = String(rep || '').toLowerCase();
    for (var id in playbooks) {
      if (!Object.prototype.hasOwnProperty.call(playbooks, id)) continue;
      var pb = playbooks[id];
      if (!pb) continue;
      if (pb.rep_first_name && String(pb.rep_first_name).toLowerCase() === lowered
          && Array.isArray(pb.covers_action_types)
          && pb.covers_action_types.indexOf('send_follow_up') !== -1) {
        return pb;
      }
    }
    return null;
  }

  // ── attribute() ────────────────────────────────────────────

  function attribute(input) {
    var diagnostics = {
      counted_jobs:     0,
      skipped_no_sent:  0,
      skipped_no_owner: 0,
      week_window:      null,
    };
    var perJob = [];
    var perRepWeek = {};
    var perRepMonth = {};

    if (!input || typeof input !== 'object') {
      return { per_job: perJob, per_rep_week: perRepWeek, per_rep_month: perRepMonth,
               leaderboard: [], diagnostics: diagnostics };
    }
    var jobs = Array.isArray(input.jobs) ? input.jobs : [];
    var events = Array.isArray(input.events) ? input.events : [];
    var playbooks = input.playbooks || {};
    var nowDate = toDate(input.now);
    if (!nowDate) {
      return { per_job: perJob, per_rep_week: perRepWeek, per_rep_month: perRepMonth,
               leaderboard: [], diagnostics: diagnostics };
    }
    var nowMs = +nowDate;
    var weekStart = perthWeekStart(nowDate);
    var weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
    var priorWeekStart = new Date(weekStart.getTime() - 7 * 24 * 3600 * 1000);
    var monthStart = perthMonthStart(nowDate);
    diagnostics.week_window = { start_iso: weekStart.toISOString(), end_iso: weekEnd.toISOString() };

    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (!job || !job.id) continue;
      var jobEvents = eventsFor(events, job.id);
      var sentEv = lastEvent(jobEvents, 'quote.sent');
      if (!sentEv) {
        diagnostics.skipped_no_sent++;
        continue;
      }
      var sentMs = +new Date(sentEv.occurred_at);
      if (isNaN(sentMs)) {
        diagnostics.skipped_no_sent++;
        continue;
      }
      var rep = repForType(job.type);
      if (rep === 'Unassigned') {
        diagnostics.skipped_no_owner++;
        // still counted in per_job, just not in rep rollups
      }
      var resolved = resolveOutcome(jobEvents, sentMs, nowMs);
      var closedAt = resolved.terminalEv ? resolved.terminalEv.occurred_at : null;
      var timeToCloseH = null;
      if (resolved.terminalEv) {
        timeToCloseH = Math.round(((+new Date(closedAt) - sentMs) / 3600000) * 10) / 10;
      }
      var attempts = attemptCount(jobEvents, sentMs);
      var pb = pickPlaybookForJob(rep, playbooks);
      var attributionRung = resolveAttributionRung(resolved.outcome, jobEvents, sentMs, resolved.terminalEv, pb);

      var refs = [refFromEvent(sentEv), refComputed('attempt_count=' + attempts), refComputed('outcome=' + resolved.outcome)];
      if (resolved.terminalEv) refs.push(refFromEvent(resolved.terminalEv));

      var entry = {
        job_id:           job.id,
        job_number:       job.job_number || null,
        rep_first_name:   rep,
        job_type:         job.type || 'unknown',
        outcome:          resolved.outcome,
        sent_at:          sentEv.occurred_at,
        closed_at:        closedAt,
        time_to_close_h:  timeToCloseH,
        attempt_count:    attempts,
        attribution_rung: attributionRung,
        value_inc_gst:    typeof job.value_inc_gst === 'number' ? job.value_inc_gst : null,
        evidence_refs:    refs,
      };
      perJob.push(entry);
      diagnostics.counted_jobs++;

      if (rep !== 'Unassigned') {
        rollupInto(perRepWeek, rep, entry, sentMs, weekStart, weekEnd, attributionRung, 'week_start_iso', weekStart.toISOString());
        var monthEnd = perthMonthStart(new Date(monthStart.getTime() + 32 * 24 * 3600 * 1000));
        rollupInto(perRepMonth, rep, entry, sentMs, monthStart, monthEnd, attributionRung, 'month_start_iso', monthStart.toISOString());
      }
    }

    // Conversion + medians per rep week.
    Object.keys(perRepWeek).forEach(function (rep) {
      finaliseRollup(perRepWeek[rep]);
    });
    Object.keys(perRepMonth).forEach(function (rep) {
      finaliseRollup(perRepMonth[rep]);
    });

    // Leaderboard from current week + delta vs prior week.
    var priorWeekRollup = {};
    for (var j = 0; j < jobs.length; j++) {
      var pj = jobs[j];
      if (!pj || !pj.id) continue;
      var je = eventsFor(events, pj.id);
      var pse = lastEvent(je, 'quote.sent');
      if (!pse) continue;
      var psm = +new Date(pse.occurred_at);
      if (isNaN(psm)) continue;
      var prep = repForType(pj.type);
      if (prep === 'Unassigned') continue;
      var pres = resolveOutcome(je, psm, nowMs);
      var pcl = pres.terminalEv ? pres.terminalEv.occurred_at : null;
      if (pres.outcome === 'accepted' && pcl
          && +new Date(pcl) >= +priorWeekStart
          && +new Date(pcl) < +weekStart) {
        if (!priorWeekRollup[prep]) priorWeekRollup[prep] = 0;
        priorWeekRollup[prep] += (typeof pj.value_inc_gst === 'number' ? pj.value_inc_gst : 0);
      }
    }
    var leaderboard = Object.keys(perRepWeek).map(function (rep) {
      var w = perRepWeek[rep];
      return {
        rep_first_name:        rep,
        $_accepted_this_week:  w.$_accepted,
        conversion_pct:        w.conversion_pct,
        delta_vs_prior_week:   w.$_accepted - (priorWeekRollup[rep] || 0),
      };
    });
    leaderboard.sort(function (a, b) {
      if (b.$_accepted_this_week !== a.$_accepted_this_week) {
        return b.$_accepted_this_week - a.$_accepted_this_week;
      }
      if (b.conversion_pct !== a.conversion_pct) {
        return b.conversion_pct - a.conversion_pct;
      }
      return a.rep_first_name < b.rep_first_name ? -1 : 1;
    });
    leaderboard.forEach(function (row, idx) { row.rank = idx + 1; });

    return {
      per_job:       perJob,
      per_rep_week:  perRepWeek,
      per_rep_month: perRepMonth,
      leaderboard:   leaderboard,
      diagnostics:   diagnostics,
    };
  }

  function rollupInto(map, rep, entry, sentMs, windowStart, windowEnd, attributionRung, startKey, startIso) {
    if (!map[rep]) {
      map[rep] = {
        rep_first_name:         rep,
        quotes_sent:            0,
        quotes_accepted:        0,
        quotes_declined:        0,
        quotes_archived:        0,
        in_flight:              0,
        $_accepted:             0,
        conversion_pct:         0,
        median_time_to_close_h: null,
        attribution_breakdown:  {},
        _ttc_samples:           [],
      };
      map[rep][startKey] = startIso;
    }
    var rollup = map[rep];
    var sentInWindow = sentMs >= +windowStart && sentMs < +windowEnd;
    if (sentInWindow) rollup.quotes_sent++;
    if (entry.outcome === 'accepted' && entry.closed_at) {
      var closedMs = +new Date(entry.closed_at);
      if (closedMs >= +windowStart && closedMs < +windowEnd) {
        rollup.quotes_accepted++;
        rollup.$_accepted += entry.value_inc_gst || 0;
        if (entry.time_to_close_h !== null) rollup._ttc_samples.push(entry.time_to_close_h);
        rollup.attribution_breakdown[attributionRung] = (rollup.attribution_breakdown[attributionRung] || 0) + 1;
      }
    }
    if (entry.outcome === 'declined' && entry.closed_at) {
      var dMs = +new Date(entry.closed_at);
      if (dMs >= +windowStart && dMs < +windowEnd) rollup.quotes_declined++;
    }
    if (entry.outcome === 'archived' && sentInWindow) rollup.quotes_archived++;
    if (entry.outcome === 'in_flight' && sentInWindow) rollup.in_flight++;
  }

  function finaliseRollup(r) {
    var sent = r.quotes_sent;
    r.conversion_pct = sent > 0
      ? Math.round((r.quotes_accepted / sent) * 1000) / 10
      : 0;
    r.median_time_to_close_h = median(r._ttc_samples);
    delete r._ttc_samples;
  }

  // ── Public surface ─────────────────────────────────────────

  return {
    attribute:                  attribute,
    _ATTRIBUTION_TOLERANCE_DAYS: ATTRIBUTION_TOLERANCE_DAYS,
    _ARCHIVE_THRESHOLD_DAYS:    ARCHIVE_THRESHOLD_DAYS,
    _perthWeekStart:            perthWeekStart,
    _median:                    median,
  };
}));
