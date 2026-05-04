// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 5) — Cadence Engine
//
// Pure module. Given a SalesActionCard + JobBrain + parsed
// playbook + now, returns the cadence position (which ladder
// rung is due, attempt count, overdue minutes, terminal flag,
// nurture flag). Also exposes a holding-SMS dry-run executor
// that NEVER actually sends — it returns the would-have-sent
// payload for the harness + (eventually) Slice 6/7 wiring.
//
// Hard rules:
//   - No fetch, no XHR, no sendBeacon, no DOM, no localStorage.
//   - Pure: same input → same output. Inputs not mutated.
//   - Returns null on malformed input rather than throwing.
//   - Dual export: window.SALE_CADENCE + module.exports.
//
// Public API:
//   SALE_CADENCE.position({ card, job_brain, playbook, now })
//     → CadencePosition | null
//   SALE_CADENCE.overdueLadder({ jobs, events, jobContext, playbooks, now })
//     → { overdue, due_today, upcoming, terminal }
//   SALE_CADENCE.holdingSmsDryRun({ card, job_brain, playbook, now })
//     → { would_send, to_phone, body, via, blockers, evidence_refs }
//
// See loop-5-cadence-engine-spec.md for the full contract.
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_CADENCE = exports;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Defaults (used when playbook is null or missing fields) ──

  var FALLBACK_LADDER = [
    { offset_days: 0,  channel: 'sms',   template_id: 't0_sent' },
    { offset_days: 2,  channel: 'sms',   template_id: 't1_check_in' },
    { offset_days: 5,  channel: 'sms',   template_id: 't2_value_frame' },
    { offset_days: 10, channel: 'call',  template_id: 't3_phone_prompt' },
    { offset_days: 17, channel: 'email', template_id: 't4_close_or_archive' },
  ];

  var DEFAULT_NURTURE_AFTER = 5;

  // Holding-SMS contract defaults (Loop 5 fixture / dry-run only).
  var HOLDING_SMS_MAX_MINUTES   = 5;
  var HOLDING_SMS_GRACE_MINUTES = 5;

  // Cadence-governed action types. Anything outside this set returns
  // null from position() — those cards aren't on the follow-up ladder.
  var CADENCE_ACTION_TYPES = [
    'send_follow_up',
    'stale_quote_recovery',
    'reply_needed',
    'deposit_follow_up',
  ];

  // Outbound rep events that count as ladder-advancing attempts.
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

  function hasFact(facts, kind) {
    if (!Array.isArray(facts)) return false;
    return facts.some(function (f) { return f && f.kind === kind; });
  }

  function attemptCount(jobEvents, sinceMs) {
    if (!Array.isArray(jobEvents)) return 0;
    var n = 0;
    for (var i = 0; i < jobEvents.length; i++) {
      var ev = jobEvents[i];
      if (!ev || OUTBOUND_TYPES.indexOf(ev.event_type) === -1) continue;
      // direction defaults to 'outbound' when omitted (rep-side touches)
      if (ev.direction && ev.direction !== 'outbound') continue;
      var t = +new Date(ev.occurred_at || ev.created_at || 0);
      if (!isNaN(t) && t > sinceMs) n++;
    }
    return n;
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

  function ladderFromPlaybook(playbook) {
    if (playbook && Array.isArray(playbook.followup_ladder) && playbook.followup_ladder.length) {
      return playbook.followup_ladder;
    }
    return FALLBACK_LADDER;
  }

  function ladderIdFromPlaybook(playbook) {
    if (playbook && playbook.playbook_id) return playbook.playbook_id;
    return 'fallback.followup.v1';
  }

  function nurtureAfter(playbook) {
    if (playbook && playbook.constraints && typeof playbook.constraints.nurture_after_attempt === 'number') {
      return playbook.constraints.nurture_after_attempt;
    }
    return DEFAULT_NURTURE_AFTER;
  }

  // ── position() ─────────────────────────────────────────────

  function position(input) {
    if (!input || typeof input !== 'object') return null;
    var card = input.card;
    var jobBrain = input.job_brain;
    var playbook = input.playbook || null;
    var nowDate = toDate(input.now);
    if (!card || !jobBrain || !nowDate) return null;
    if (!card.action_type || CADENCE_ACTION_TYPES.indexOf(card.action_type) === -1) return null;

    // Hard short-circuit: do_not_chase paused → no cadence position.
    var facts = jobBrain.facts || (jobBrain.jobContext && card.job_id ? jobBrain.jobContext[card.job_id] : null);
    if (hasFact(facts, 'do_not_chase')) return null;

    // Hard short-circuit: card was emitted as blocked.
    if (card.policy_verdict === 'blocked') return null;

    var jobEvents = Array.isArray(jobBrain.events) ? jobBrain.events : [];
    // jobBrain may be the per-job shape (events filtered) OR the index
    // shape (events for many jobs); filter defensively.
    if (card.job_id) {
      jobEvents = jobEvents.filter(function (e) { return e && e.job_id === card.job_id; });
    }

    var sentEv = lastEvent(jobEvents, 'quote.sent');
    if (!sentEv) return null;
    var sentMs = +new Date(sentEv.occurred_at);
    if (isNaN(sentMs)) return null;

    var attempts = attemptCount(jobEvents, sentMs);
    var ladder = ladderFromPlaybook(playbook);
    var ladderId = ladderIdFromPlaybook(playbook);
    var nurtureCutoff = nurtureAfter(playbook);

    var clampedRung = Math.min(attempts, ladder.length);
    var terminal = attempts >= ladder.length;
    var nurtureMode = attempts >= nurtureCutoff;

    var dueAt = null;
    var nextTemplateId = null;
    var nextChannel = null;
    var overdueMinutes = 0;

    if (!terminal) {
      var rung = ladder[clampedRung];
      var dueMs = sentMs + (rung.offset_days * 24 * 3600 * 1000);
      dueAt = new Date(dueMs).toISOString();
      nextTemplateId = rung.template_id || null;
      nextChannel = rung.channel || null;
      var nowMs = +nowDate;
      overdueMinutes = Math.max(0, Math.floor((nowMs - dueMs) / 60000));
    }

    return {
      ladder_id:        ladderId,
      ladder_length:    ladder.length,
      attempt_count:    attempts,
      current_rung:     clampedRung,
      next_template_id: nextTemplateId,
      next_channel:     nextChannel,
      due_at:           dueAt,
      overdue_minutes:  overdueMinutes,
      terminal:         terminal,
      nurture_mode:     nurtureMode,
      evidence_refs: [
        refFromEvent(sentEv),
        refComputed('attempt_count=' + attempts),
        refComputed('ladder_id=' + ladderId),
        refComputed('current_rung=' + clampedRung),
      ],
    };
  }

  // ── overdueLadder() ────────────────────────────────────────

  function overdueLadder(input) {
    var result = { overdue: [], due_today: [], upcoming: [], terminal: [] };
    if (!input || typeof input !== 'object') return result;
    var jobs = Array.isArray(input.jobs) ? input.jobs : [];
    var events = Array.isArray(input.events) ? input.events : [];
    var jobContext = input.jobContext || {};
    var playbooks = input.playbooks || {};
    var nowDate = toDate(input.now);
    if (!nowDate) return result;
    var nowMs = +nowDate;

    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (!job || !job.id) continue;
      var jobEvents = eventsFor(events, job.id);
      var sentEv = lastEvent(jobEvents, 'quote.sent');
      if (!sentEv) continue;

      var pb = resolvePlaybookForJob(job, playbooks);
      var card = {
        job_id:      job.id,
        action_type: 'send_follow_up',
        policy_verdict: 'auto_ok',
      };
      var pos = position({
        card:      card,
        job_brain: { events: jobEvents, facts: jobContext[job.id] || [] },
        playbook:  pb,
        now:       nowDate,
      });
      if (!pos) continue;

      var entry = {
        job_id:     job.id,
        job_number: job.job_number || null,
        position:   pos,
      };

      if (pos.terminal) {
        result.terminal.push({ job_id: job.id, attempt_count: pos.attempt_count });
        continue;
      }

      var dueMs = +new Date(pos.due_at);
      var dueDeltaMs = dueMs - nowMs;
      if (pos.overdue_minutes > 0) {
        var bucket;
        if (pos.overdue_minutes < 24 * 60) bucket = '<24h';
        else if (pos.overdue_minutes < 48 * 60) bucket = '24-48h';
        else bucket = '>48h';
        entry.age_buckets = bucket;
        result.overdue.push(entry);
      } else if (dueDeltaMs < 24 * 3600 * 1000) {
        result.due_today.push(entry);
      } else {
        result.upcoming.push({ job_id: job.id, due_at: pos.due_at });
      }
    }

    // Sort overdue by overdue_minutes desc so most-overdue floats up.
    result.overdue.sort(function (a, b) {
      return b.position.overdue_minutes - a.position.overdue_minutes;
    });

    return result;
  }

  function resolvePlaybookForJob(job, playbooks) {
    if (!playbooks || typeof playbooks !== 'object') return null;
    var t = (job && job.type) ? String(job.type).toLowerCase() : '';
    var rep = (t === 'fencing') ? 'khairo' : 'nithin';
    // Prefer the followup playbook for this rep.
    for (var id in playbooks) {
      if (!Object.prototype.hasOwnProperty.call(playbooks, id)) continue;
      var pb = playbooks[id];
      if (!pb) continue;
      if (pb.rep_first_name && String(pb.rep_first_name).toLowerCase() === rep
          && Array.isArray(pb.covers_action_types)
          && pb.covers_action_types.indexOf('send_follow_up') !== -1) {
        return pb;
      }
    }
    return null;
  }

  // ── holdingSmsDryRun() ─────────────────────────────────────

  function holdingSmsDryRun(input) {
    var blockers = [];
    var refs = [];
    var would = false;
    var toPhone = null;
    var body = null;
    var via = 'rep-channel:sms';

    if (!input || typeof input !== 'object') {
      return { would_send: false, to_phone: null, body: null, via: via,
               blockers: ['malformed_input'], evidence_refs: [] };
    }
    var card = input.card;
    var jobBrain = input.job_brain;
    var playbook = input.playbook || null;
    var nowDate = toDate(input.now);
    if (!card || !jobBrain || !nowDate) {
      return { would_send: false, to_phone: null, body: null, via: via,
               blockers: ['malformed_input'], evidence_refs: [] };
    }

    if (card.action_type !== 'holding_sms') blockers.push('not_holding_sms_card');
    var job = jobBrain.job || {};
    if (!job.client_phone) blockers.push('no_client_phone');

    // do_not_chase short-circuit.
    var facts = jobBrain.facts || [];
    if (hasFact(facts, 'do_not_chase')) blockers.push('do_not_chase_active');

    var jobEvents = Array.isArray(jobBrain.events) ? jobBrain.events : [];
    if (card.job_id) {
      jobEvents = jobEvents.filter(function (e) { return e && e.job_id === card.job_id; });
    }

    // Cadence cap: any prior outbound disqualifies the holding window.
    var anyOutbound = jobEvents.some(function (e) {
      return e && OUTBOUND_TYPES.indexOf(e.event_type) !== -1
          && (!e.direction || e.direction === 'outbound');
    });
    if (anyOutbound) blockers.push('outbound_already_sent');

    // Find contact.created (or fall back to job.created_at).
    var anchorMs = null;
    var anchorEv = lastEvent(jobEvents, 'contact.created');
    if (anchorEv) {
      anchorMs = +new Date(anchorEv.occurred_at);
      refs.push(refFromEvent(anchorEv));
    } else if (job.created_at) {
      anchorMs = +new Date(job.created_at);
      refs.push(refComputed('job.created_at_anchor=' + job.created_at));
    }
    if (anchorMs === null || isNaN(anchorMs)) {
      blockers.push('no_anchor_event');
    } else {
      var ageMin = (+nowDate - anchorMs) / 60000;
      refs.push(refComputed('age_minutes=' + Math.round(ageMin)));
      if (ageMin > HOLDING_SMS_MAX_MINUTES + HOLDING_SMS_GRACE_MINUTES) {
        blockers.push('holding_window_expired');
      }
    }

    // Resolve template body from playbook.
    if (playbook && playbook.templates
        && playbook.templates.holding_sms
        && playbook.templates.holding_sms.sms_primary) {
      body = renderTemplate(playbook.templates.holding_sms.sms_primary, job, playbook);
    } else {
      blockers.push('no_holding_sms_template');
    }

    if (job.client_phone) toPhone = job.client_phone;
    would = blockers.length === 0;

    return {
      would_send:    would,
      to_phone:      toPhone,
      body:          body,
      via:           via,
      blockers:      blockers,
      evidence_refs: refs,
    };
  }

  // Minimal template renderer: replaces {first_name}, {rep_first_name},
  // {job_number}. Same shape Loop 3's playbook uses; kept local so the
  // dry-run executor doesn't need playbook.draft() pulled in.
  function renderTemplate(tpl, job, playbook) {
    if (typeof tpl !== 'string') return null;
    var firstName = (job.client_name || '').split(/\s+/)[0] || '';
    var repFirst = playbook && playbook.rep_first_name ? playbook.rep_first_name : '';
    return tpl
      .replace(/\{first_name\}/g, firstName)
      .replace(/\{rep_first_name\}/g, repFirst)
      .replace(/\{job_number\}/g, job.job_number || '');
  }

  // ── Public surface ─────────────────────────────────────────

  return {
    position:           position,
    overdueLadder:      overdueLadder,
    holdingSmsDryRun:   holdingSmsDryRun,
    // exposed for harness only
    _FALLBACK_LADDER:   FALLBACK_LADDER,
    _CADENCE_ACTION_TYPES: CADENCE_ACTION_TYPES,
    _HOLDING_SMS_MAX_MINUTES:   HOLDING_SMS_MAX_MINUTES,
    _HOLDING_SMS_GRACE_MINUTES: HOLDING_SMS_GRACE_MINUTES,
  };
}));
