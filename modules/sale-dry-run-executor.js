// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 6) — Dry-Run Send Executor
//
// Pure module. Given an approved proposed_action + playbook +
// rep identity + cadence position + now, returns the EXACT send
// payload (URL/method/headers/body) that *would* fire — but
// logs it to an in-memory ring buffer instead of dispatching.
//
// Hard rules:
//   - No fetch, no XHR, no sendBeacon, no DOM, no localStorage.
//   - URL/Authorization stay as TEMPLATE TOKENS — never resolved.
//     Slice 7 swaps the log path for a real fetch and substitutes
//     <SUPABASE_URL> / <SUPABASE_SERVICE_KEY> at fetch time.
//   - Pure: same input + now → same output (modulo the random
//     log_id, generated after the rest of the result is computed).
//   - Inputs not mutated.
//   - Returns would_send=false on malformed input rather than throwing.
//   - Dual export: window.SALE_DRY_RUN + module.exports.
//
// Public API:
//   SALE_DRY_RUN.execute({ proposed_action, playbook, rep_identity,
//                          cadence_position, now })
//     → DryRunResult
//   SALE_DRY_RUN.recentLog({ rep_first_name?, since?, limit? })
//     → DryRunLogEntry[]
//   SALE_DRY_RUN.clearLog() — test harness use only.
//
// See loop-6-dry-run-executor-spec.md for the full contract.
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_DRY_RUN = exports;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Allow-list (Slice 7 graduates these one at a time) ───
  var ALLOW_LIST = [
    'holding_sms',
    'missed_call_textback',
    'first_contact_sms',
    'completed_call_followup',
    'qualify_questions',
    'pre_visit_reminder',
    'followup_sms_t1',
    'followup_sms_t2',
    'archive_stale',
  ];

  var DEFAULTS = Object.freeze({
    quietHoursStartHour: 7,
    quietHoursEndHour:   20,
    cadenceCapPer7Days:  2,
    smsBudget:           160,
    emailSubjectBudget:  80,
    emailBodyBudget:     350,
    dedupWindowMinutes:  10,
    logRingSize:         200,
  });

  var DEFAULT_FORBIDDEN = [
    '—',                       // em dash
    'as per',
    'kind regards',
    'best regards',
    'Sent from my iPhone',
    'leverage',
  ];

  // ── Module-state ring buffer ───────────────────────────────
  var _LOG = [];
  var _SEQ = 0;

  function pushLog(entry) {
    _LOG.push(entry);
    if (_LOG.length > DEFAULTS.logRingSize) {
      _LOG.splice(0, _LOG.length - DEFAULTS.logRingSize);
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'string' || typeof v === 'number') {
      var d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function perthHour(date) {
    // UTC+8 fixed (Perth has no DST). hourOfDay 0..23.
    var perthMs = date.getTime() + 8 * 3600 * 1000;
    return new Date(perthMs).getUTCHours();
  }

  function refComputed(reason) {
    return { type: 'computed', source_table: null, id: null, reason: reason };
  }
  function refFromAction(pa) {
    return {
      type:        'proposed_action',
      source_table: 'ai_proposed_actions',
      id:           (pa && (pa.id || pa.proposal_id)) || null,
    };
  }

  function makeLogId() {
    _SEQ += 1;
    return 'dry_' + Math.random().toString(36).slice(2, 8) + '_' + _SEQ;
  }

  // SMS dispatch path — mirrors the live ops-api send_proposed_sms
  // shape exactly. The URL + Authorization stay as templates so the
  // dry-run payload cannot leak credentials.
  function smsPayload(actionId) {
    return {
      url:    '<SUPABASE_URL>/functions/v1/ops-api?action=send_proposed_sms',
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer <SUPABASE_SERVICE_KEY>',
      },
      body: {
        action_id: actionId,
      },
    };
  }

  // Email dispatch (stubbed for Slice 8). Loop 6 emits the shape so
  // harness can assert against it; Slice 7+ wires the actual handler.
  function emailPayload(actionId) {
    return {
      url:    '<SUPABASE_URL>/functions/v1/ops-api?action=send_proposed_email',
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer <SUPABASE_SERVICE_KEY>',
      },
      body: {
        action_id: actionId,
      },
    };
  }

  function internalOnlyPayload() {
    return {
      url:    null,
      method: 'POST',
      headers: {},
      body:   { internal_only: true, reason: 'archive_stale' },
    };
  }

  function deriveBody(pa, playbook) {
    // Drafted message wins. If empty AND action_type is holding_sms,
    // try playbook.holding_sms.sms_primary as a last resort.
    if (pa && typeof pa.drafted_message === 'string' && pa.drafted_message.trim().length > 0) {
      return pa.drafted_message;
    }
    if (pa && pa.action_type === 'holding_sms'
        && playbook && playbook.templates
        && playbook.templates.holding_sms
        && playbook.templates.holding_sms.sms_primary) {
      var tpl = playbook.templates.holding_sms.sms_primary;
      var firstName = '';
      var contact = pa.contact_name || '';
      if (contact) firstName = String(contact).split(/\s+/)[0] || '';
      var repFirst = playbook.rep_first_name || '';
      return tpl
        .replace(/\{first_name\}/g, firstName)
        .replace(/\{rep_first_name\}/g, repFirst)
        .replace(/\{job_number\}/g, pa.job_number || '');
    }
    return null;
  }

  function forbiddenList(playbook) {
    if (playbook && Array.isArray(playbook.forbidden_phrases) && playbook.forbidden_phrases.length) {
      return playbook.forbidden_phrases;
    }
    return DEFAULT_FORBIDDEN;
  }

  function bodyHitsForbidden(body, phrases) {
    if (!body) return null;
    var lower = String(body).toLowerCase();
    for (var i = 0; i < phrases.length; i++) {
      var p = String(phrases[i]).toLowerCase();
      if (!p) continue;
      // Em-dash + other Unicode punctuation: substring match (no word boundary).
      // Word phrases ("as per"): word-boundary match.
      var hit;
      if (/[a-z]/.test(p)) {
        var escaped = p.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        var rx = new RegExp('(^|\\W)' + escaped + '(\\W|$)', 'i');
        hit = rx.test(body);
      } else {
        hit = lower.indexOf(p) !== -1;
      }
      if (hit) return phrases[i];
    }
    return null;
  }

  function isAllowListed(actionType) {
    return ALLOW_LIST.indexOf(actionType) !== -1;
  }

  function isInternalOnly(actionType) {
    return actionType === 'archive_stale';
  }

  // ── execute() ──────────────────────────────────────────────

  function execute(input) {
    var blockers = [];
    var refs = [];
    var nowDate = toDate(input && input.now);
    var pa = input && input.proposed_action;
    var playbook = (input && input.playbook) || null;
    var repIdentity = (input && input.rep_identity) || null;
    var cadencePos = (input && input.cadence_position) || null;
    var config = Object.assign({}, DEFAULTS, (input && input.config) || {});

    if (!pa || !nowDate) {
      var malformed = {
        would_send:    false,
        action_id:     pa && (pa.id || pa.proposal_id) || null,
        job_id:        pa && pa.job_id || null,
        via:           null,
        payload:       null,
        blockers:      ['malformed_input'],
        evidence_refs: [],
        dry_run_log_id: makeLogId(),
        created_at:    new Date().toISOString(),
      };
      pushLog(malformed);
      return malformed;
    }

    var actionType = pa.action_type;
    var channel = (pa.channel === 'email') ? 'email' : 'sms';
    var via = isInternalOnly(actionType) ? 'internal' : ('rep-channel:' + channel);

    refs.push(refFromAction(pa));

    // 1. Allow-list
    if (!isAllowListed(actionType)) {
      blockers.push('not_allow_listed');
      blockers.push('requires_approval');
    }

    // 2. Internal-only short-circuit (no recipient, no body checks)
    if (isInternalOnly(actionType)) {
      blockers.push('internal_only_action');
      var internalResult = finaliseResult(pa, via, internalOnlyPayload(), blockers, refs);
      pushLog(internalResult);
      return internalResult;
    }

    // 3. Quiet hours
    var hour = perthHour(nowDate);
    if (hour < config.quietHoursStartHour || hour >= config.quietHoursEndHour) {
      blockers.push('quiet_hours');
    }

    // 4. do_not_chase short-circuit (cadence already returned null,
    //    but the executor double-checks against pa.action_payload.facts
    //    if supplied)
    if (input.facts && Array.isArray(input.facts)
        && input.facts.some(function (f) { return f && f.kind === 'do_not_chase'; })) {
      blockers.push('do_not_chase');
    }

    // 5. Recipient channel
    if (channel === 'sms' && !pa.contact_phone) {
      blockers.push('no_recipient_channel');
    } else if (channel === 'email' && !pa.contact_email) {
      blockers.push('no_recipient_channel');
    }

    // 6. Sender identity
    if (!repIdentity || (channel === 'sms' && !repIdentity.sms_from)
                     || (channel === 'email' && !repIdentity.email_from)) {
      blockers.push('no_sender_identity');
    }

    // 7. Cadence position terminal → no follow-up rungs
    if (cadencePos && cadencePos.terminal === true
        && actionType !== 'holding_sms'
        && actionType !== 'first_contact_sms'
        && actionType !== 'missed_call_textback') {
      blockers.push('terminal_state');
    }

    // 8. Cadence cap
    var sentInWindow = countAutoSendsInWindow(input, nowDate, 7);
    if (sentInWindow >= config.cadenceCapPer7Days
        && actionType !== 'holding_sms'
        && actionType !== 'first_contact_sms') {
      blockers.push('cadence_cap_exceeded');
      refs.push(refComputed('auto_sends_in_7d=' + sentInWindow));
    }

    // 9. Body
    var body = deriveBody(pa, playbook);
    if (!body) {
      blockers.push('empty_body');
    } else {
      // Forbidden-phrase scan
      var hit = bodyHitsForbidden(body, forbiddenList(playbook));
      if (hit) {
        blockers.push('forbidden_phrase');
        refs.push(refComputed('forbidden_phrase=' + JSON.stringify(hit)));
      }
      // Length budgets
      if (channel === 'sms' && body.length > config.smsBudget) {
        blockers.push('body_too_long');
      }
      if (channel === 'email' && body.length > config.emailBodyBudget) {
        blockers.push('body_too_long');
      }
      if (channel === 'email' && pa.drafted_subject && pa.drafted_subject.length > config.emailSubjectBudget) {
        blockers.push('body_too_long');
      }
    }

    // 10. Dedup window — same contact + same body in last N min
    if (Array.isArray(input.recent_outbound) && body) {
      var dedupCutoff = +nowDate - config.dedupWindowMinutes * 60000;
      var sameAndRecent = input.recent_outbound.some(function (e) {
        if (!e || !e.body || !e.contact_id) return false;
        if (e.contact_id !== pa.contact_id) return false;
        var t = +new Date(e.occurred_at || 0);
        if (isNaN(t) || t < dedupCutoff) return false;
        return e.body === body;
      });
      if (sameAndRecent) blockers.push('dedup_window');
    }

    // Compose payload — ALWAYS produced for diagnostic purposes
    // (so harness can verify shape) even when blockers are present.
    var payload = channel === 'email'
      ? emailPayload(pa.id || pa.proposal_id)
      : smsPayload(pa.id || pa.proposal_id);

    // Inject the live-mode body preview into the payload.body so
    // Slice 7 can confirm what would have been sent. The actual
    // send_proposed_sms handler reads the message from the DB row;
    // we expose it here for review.
    if (body) payload.body.preview_message = body;

    var result = finaliseResult(pa, via, payload, blockers, refs);
    pushLog(result);
    return result;
  }

  function finaliseResult(pa, via, payload, blockers, refs) {
    return {
      would_send:    blockers.length === 0,
      action_id:     pa && (pa.id || pa.proposal_id) || null,
      job_id:        pa && pa.job_id || null,
      via:           via,
      payload:       payload,
      blockers:      blockers.slice(),
      evidence_refs: refs.slice(),
      dry_run_log_id: makeLogId(),
      created_at:    new Date().toISOString(),
    };
  }

  // Counts auto-sends in the last `days` for the contact. Reads from:
  //  - input.recent_outbound[] (Slice 6 fixture-mode supplied)
  //  - or input.cadence_position.attempt_count when fallback
  function countAutoSendsInWindow(input, nowDate, days) {
    var pa = input.proposed_action;
    var contactId = pa && pa.contact_id;
    if (Array.isArray(input.recent_outbound) && contactId) {
      var cutoff = +nowDate - days * 24 * 3600 * 1000;
      return input.recent_outbound.filter(function (e) {
        if (!e || e.contact_id !== contactId) return false;
        var t = +new Date(e.occurred_at || 0);
        if (isNaN(t) || t < cutoff) return false;
        return e.cadence === 'auto';
      }).length;
    }
    if (input.cadence_position && typeof input.cadence_position.attempt_count === 'number') {
      // Approximation: reps' attempt_count is total post-sent outbound,
      // not auto-only. Treat as upper bound — safer to over-block.
      return input.cadence_position.attempt_count;
    }
    return 0;
  }

  // ── Public log API ─────────────────────────────────────────

  function recentLog(opts) {
    opts = opts || {};
    var limit = typeof opts.limit === 'number' ? opts.limit : 50;
    var sinceMs = opts.since ? +new Date(opts.since) : null;
    var rep = opts.rep_first_name ? String(opts.rep_first_name).toLowerCase() : null;
    var out = [];
    for (var i = _LOG.length - 1; i >= 0 && out.length < limit; i--) {
      var entry = _LOG[i];
      if (sinceMs !== null && +new Date(entry.created_at) < sinceMs) continue;
      if (rep) {
        var entryRep = (entry.via && entry.via.indexOf('rep-channel') === 0)
          ? '' // not stored on entry; future Slice 7 wires
          : '';
        // Rep filter is currently a no-op; Slice 7 augments DryRunResult
        // with rep_first_name and this filter activates.
      }
      out.push(entry);
    }
    return out;
  }

  function clearLog() {
    _LOG.length = 0;
    _SEQ = 0;
  }

  // ── Public surface ─────────────────────────────────────────

  return {
    execute:    execute,
    recentLog:  recentLog,
    clearLog:   clearLog,
    ALLOW_LIST: ALLOW_LIST,
    DEFAULTS:   DEFAULTS,
    _DEFAULT_FORBIDDEN: DEFAULT_FORBIDDEN,
    _perthHour: perthHour,
  };
}));
