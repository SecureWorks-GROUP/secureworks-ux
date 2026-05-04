// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale Slice 2 — Safety Policy
//
// Pure module. No DOM, no fetch, no localStorage, no Supabase.
// Evaluates a single proposed action against the surrounding job
// context and returns a verdict explaining whether it can auto-send,
// requires human approval, is internal-only (rep workflow only), or
// is fully blocked.
//
// Contract:
//   evaluate({
//     action,        // canonical proposed-action object (see below)
//     job,           // job row (jobs.* shape)
//     facts,         // job_context array for this job
//     recentEvents,  // business_events array for this job (last ~30d)
//     now,           // Date or ISO string — REQUIRED for deterministic tests
//     config?,       // see DEFAULT_CONFIG below
//   }) →
//   {
//     auto_ok:           boolean,   // safe to auto-send right now
//     approval_required: boolean,   // human must approve before send
//     blocked:           boolean,   // never send (do_not_chase, stop_word, etc.)
//     internal_only:     boolean,   // internal rep workflow; never reaches client
//     reasons:           string[],  // human-readable trail of policy decisions
//     trust:             'green'|'amber'|'red',
//   }
//
// Slice 2 amendments encoded:
//   • Sender identity is unconditional and type-based:
//       patio  → Nithin
//       fencing → Khairo
//       combo  → Nithin (default until decking has its own owner)
//     jobs.created_by is metrics/ownership only and never routes sends.
//   • archive_stale is internal-only (proposal that opens a nurture
//     follow-up draft for human approval; never auto-changes job state).
//   • call_now_prompt is internal-only (rep dials manually; no auto-call).
//   • Stop-words / do_not_chase facts → blocked.
//   • Quiet hours → not auto_ok (still allowed via approval).
//   • Per-contact cadence limit (≥3 auto-messages in 7d) → approval.
//
// Action shape consumed by evaluate():
//   {
//     action_type:    'first_contact_sms' | 'missed_call_textback' |
//                     'completed_call_followup' | 'qualify_questions' |
//                     'collect_photos' | 'propose_booking_window' |
//                     'confirm_booking' | 'pre_visit_reminder' |
//                     're_propose_window' |
//                     'followup_sms_t1' | 'followup_sms_t2' |
//                     'call_now_prompt' | 'objection_response' |
//                     'value_frame_message' | 'urgency_message' |
//                     'booking_for_acceptance' | 'archive_stale',
//     channel:        'sms' | 'email' | 'call' | 'internal',
//     drafted_message?: string,
//     job_id:         string,
//     contact_id?:    string,
//     action_payload: { angle?, template_id?, ... },
//   }
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_POLICY = exports;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────

  var DEFAULT_CONFIG = Object.freeze({
    // Quiet hours in Perth local (24h). Outside this window, no auto-send.
    quietHoursStart: 20, // 20:00
    quietHoursEnd:   7,  // 07:00
    // Per-contact cadence cap. ≥ this many auto-sends in trailing window
    // demotes to approval-required.
    autoMsgCapPerContact: 3,
    autoMsgCapWindowDays: 7,
    // Stop words. Phrase-only entries; bare "stop" is too ambiguous in
    // casual English ("stop by Tuesday", "bus stop", "had to stop and
    // think") and would permanently block legitimate jobs on a false-
    // positive substring match. Each entry must encode unambiguous
    // opt-out intent. Matched as word-bounded tokens, bounded to the
    // last `stopWordHorizonDays` (default 90) of inbound replies.
    stopWords: [
      'unsubscribe', 'not interested', 'please remove',
      "don't contact", 'do not contact', 'leave me alone', 'wrong number',
      'please stop', 'stop messaging', 'stop contacting', 'stop sending',
      'stop emailing', 'stop calling', 'lose my number',
    ],
    stopWordHorizonDays: 90,
  });

  // ── Helpers ────────────────────────────────────────────────

  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'string' || typeof v === 'number') {
      var d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  // Sender identity is unconditional and type-based. See Slice 1
  // amendment §3 in cio/evidence/secure-sale-cockpit-2026-04-30/README.md.
  function senderForJob(job) {
    if (!job || typeof job !== 'object') return null;
    var t = (job.type || '').toLowerCase();
    if (t === 'fencing') {
      return { name: 'Khairo', label: 'Khairo (fencing)', user_id: 'fix-khairo' };
    }
    if (t === 'patio' || t === 'combo' || t === 'decking' || t === 'general') {
      return { name: 'Nithin', label: 'Nithin (' + t + ')', user_id: 'fix-nithin' };
    }
    // Truly unknown type → no default sender; outbound blocks.
    return null;
  }

  function isInQuietHours(now, config) {
    var d = toDate(now);
    if (!d) return false;
    var hour = d.getHours();
    var qs = config.quietHoursStart;
    var qe = config.quietHoursEnd;
    // Window wraps midnight: e.g. 20:00 → 07:00 next day.
    if (qs > qe) return hour >= qs || hour < qe;
    return hour >= qs && hour < qe;
  }

  // Word-boundary regexes per stop-word phrase. Substring matching
  // ("stop" inside "stop by Tuesday" / "bus stop") is unsafe and would
  // permanently block legitimate jobs.
  function buildStopWordRegexes(stopWords) {
    return (stopWords || []).map(function (s) {
      var escaped = String(s).toLowerCase().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      return new RegExp('(^|\\W)' + escaped + '(\\W|$)', 'i');
    });
  }
  function inboundReplyHasStopWord(recentEvents, stopWords, now, horizonDays) {
    if (!Array.isArray(recentEvents)) return false;
    var regexes = buildStopWordRegexes(stopWords);
    var nowMs = +toDate(now);
    var horizon = (typeof horizonDays === 'number' && horizonDays > 0) ? horizonDays : 90;
    var horizonMs = isNaN(nowMs) ? null : nowMs - horizon * 24 * 3600 * 1000;
    for (var i = 0; i < recentEvents.length; i++) {
      var ev = recentEvents[i];
      if (!ev || ev.event_type !== 'client.reply') continue;
      var occurredMs = +new Date(ev.occurred_at || ev.created_at || 0);
      if (horizonMs !== null && !isNaN(occurredMs) && occurredMs < horizonMs) continue;
      var text = (ev.payload && (ev.payload.message_text || ev.payload.text)) || '';
      for (var j = 0; j < regexes.length; j++) {
        if (regexes[j].test(text)) return true;
      }
    }
    return false;
  }

  function hasFact(facts, kind) {
    if (!Array.isArray(facts)) return false;
    return facts.some(function (f) { return f && f.kind === kind; });
  }

  function autoMsgsInWindow(recentEvents, contactId, now, windowDays) {
    if (!Array.isArray(recentEvents)) return 0;
    var nowMs = toDate(now);
    if (!nowMs) return 0;
    var cutoff = nowMs.getTime() - windowDays * 24 * 60 * 60 * 1000;
    var n = 0;
    for (var i = 0; i < recentEvents.length; i++) {
      var ev = recentEvents[i];
      if (!ev) continue;
      var et = ev.event_type;
      if (et !== 'client.sms_out' && et !== 'client.email_out') continue;
      if (contactId && ev.payload && ev.payload.contact_id && ev.payload.contact_id !== contactId) continue;
      var meta = ev.payload || {};
      if (meta.cadence !== 'auto') continue;
      var occurred = toDate(ev.occurred_at || ev.created_at);
      if (!occurred) continue;
      if (occurred.getTime() >= cutoff) n++;
    }
    return n;
  }

  // ── Action-type taxonomy ──────────────────────────────────

  // Action types whose channel is 'internal' — they never reach the client.
  var INTERNAL_ONLY = {
    'call_now_prompt': true,
    'archive_stale':   true,
  };

  // Action types that MUST go through human approval before send,
  // regardless of cadence / quiet hours / sender / etc.
  var ALWAYS_APPROVAL = {
    'propose_booking_window':   true, // client commits to a specific time
    'confirm_booking':          true,
    're_propose_window':        true,
    'objection_response':       true,
    'value_frame_message':      true,
    'urgency_message':          true,
    'booking_for_acceptance':   true,
  };

  // Action types that can auto-send when all other gates pass.
  var AUTO_OK_TYPES = {
    'first_contact_sms':        true,
    'missed_call_textback':     true,
    'completed_call_followup':  true,
    'qualify_questions':        true,
    'collect_photos':           true,
    'pre_visit_reminder':       true,
    'followup_sms_t1':          true,
    'followup_sms_t2':          true,
  };

  // ── Public API ─────────────────────────────────────────────

  function evaluate(input) {
    var config = Object.assign({}, DEFAULT_CONFIG, (input && input.config) || {});
    var action = input && input.action;
    var job = input && input.job;
    var facts = (input && input.facts) || [];
    var recentEvents = (input && input.recentEvents) || [];
    var now = (input && input.now) || new Date();

    var verdict = {
      auto_ok: false,
      approval_required: false,
      blocked: false,
      internal_only: false,
      reasons: [],
      trust: 'amber',
    };

    function reason(s) { verdict.reasons.push(s); }

    // ── Pre-flight: malformed inputs → blocked ──
    if (!action || typeof action !== 'object' || !action.action_type) {
      verdict.blocked = true; verdict.trust = 'red';
      reason('malformed action — no action_type');
      return verdict;
    }
    if (!job || typeof job !== 'object' || !job.id) {
      verdict.blocked = true; verdict.trust = 'red';
      reason('malformed job — no id');
      return verdict;
    }

    var actionType = action.action_type;

    // ── Internal-only actions (call_now_prompt, archive_stale) ──
    if (INTERNAL_ONLY[actionType]) {
      verdict.internal_only = true;
      verdict.trust = 'amber';
      reason('action_type "' + actionType + '" is internal-only — never reaches the client');
      if (actionType === 'archive_stale') {
        reason('archive_stale never auto-changes job/pipeline state; rep approves and the system creates a nurture follow-up only');
      }
      // Internal actions do not need outbound sender / channel / cadence checks.
      return verdict;
    }

    // ── Sender identity (type-based, unconditional) ──
    var sender = senderForJob(job);
    if (!sender) {
      verdict.blocked = true; verdict.trust = 'red';
      reason('cannot resolve sender for job.type="' + (job.type || '') + '" (only patio/combo→Nithin and fencing→Khairo are wired)');
      return verdict;
    }
    reason('sender resolved: ' + sender.label);

    // ── Hard blocks: do_not_chase fact ──
    if (hasFact(facts, 'do_not_chase')) {
      verdict.blocked = true; verdict.trust = 'red';
      reason('job_context.do_not_chase is set — outbound blocked');
      return verdict;
    }

    // ── Hard blocks: stop-word reply ──
    if (inboundReplyHasStopWord(recentEvents, config.stopWords, now, config.stopWordHorizonDays)) {
      verdict.blocked = true; verdict.trust = 'red';
      reason('inbound stop-word reply detected — outbound blocked, alert human');
      return verdict;
    }

    // ── Hard blocks: missing channel-required contact field ──
    var ch = action.channel || (action.action_payload && action.action_payload.channel);
    if (ch === 'sms' && !job.client_phone) {
      verdict.blocked = true; verdict.trust = 'red';
      reason('SMS action but no client_phone on job');
      return verdict;
    }
    if (ch === 'email' && !job.client_email) {
      verdict.blocked = true; verdict.trust = 'red';
      reason('email action but no client_email on job');
      return verdict;
    }

    // ── Approval-required action types ──
    if (ALWAYS_APPROVAL[actionType]) {
      verdict.approval_required = true;
      verdict.trust = 'amber';
      reason('action_type "' + actionType + '" always requires human approval');
      return verdict;
    }

    // ── Auto-OK action types ──
    if (AUTO_OK_TYPES[actionType]) {
      // Quiet hours demote to approval (rep can still override).
      if (isInQuietHours(now, config)) {
        verdict.approval_required = true;
        verdict.trust = 'amber';
        reason('inside quiet hours (' + config.quietHoursStart + ':00–' + config.quietHoursEnd + ':00); auto-send paused');
        return verdict;
      }
      // Cadence cap demotes to approval.
      var contactId = action.contact_id || (action.action_payload && action.action_payload.contact_id);
      var n = autoMsgsInWindow(recentEvents, contactId, now, config.autoMsgCapWindowDays);
      if (n >= config.autoMsgCapPerContact) {
        verdict.approval_required = true;
        verdict.trust = 'amber';
        reason(n + ' auto-messages in last ' + config.autoMsgCapWindowDays + 'd to this contact; cap=' + config.autoMsgCapPerContact + ' — approval required');
        return verdict;
      }
      verdict.auto_ok = true;
      verdict.trust = 'green';
      reason('auto-send permitted (cadence ok, quiet hours clear, sender resolved, no block flags)');
      return verdict;
    }

    // ── Unknown action_type → fail-closed ──
    verdict.blocked = true;
    verdict.trust = 'red';
    reason('unknown action_type "' + actionType + '" — fail-closed (not in INTERNAL_ONLY, ALWAYS_APPROVAL, or AUTO_OK_TYPES)');
    return verdict;
  }

  return {
    evaluate: evaluate,
    senderForJob: senderForJob,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    INTERNAL_ONLY: INTERNAL_ONLY,
    ALWAYS_APPROVAL: ALWAYS_APPROVAL,
    AUTO_OK_TYPES: AUTO_OK_TYPES,
    // exposed for tests:
    _isInQuietHours: isInQuietHours,
    _hasFact: hasFact,
    _inboundReplyHasStopWord: inboundReplyHasStopWord,
    _autoMsgsInWindow: autoMsgsInWindow,
  };
});
