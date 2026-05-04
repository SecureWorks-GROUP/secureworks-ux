// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 2) — Proposed Action Generator
//
// Pure module. Takes a JobBrainIndex payload + config; returns
// SalesActionCard[]. Method-agnostic — no sales copy, no rep tone,
// no persuasion. The generator says "this job needs a Follow Up
// at priority N because of these events"; the playbook (Loop 3)
// generates the message body / talk track later.
//
// Hard rules (enforced inline + by harness):
//   • No fetch, no XHR, no sendBeacon — pure derivation.
//   • Every emitted card has evidence_refs[] with ≥ 1 entry.
//   • do_not_chase reroutes everything for that job to a single
//     snooze_or_dismiss card on the Call lane.
//   • Stop-word inbound replies (word-boundary match, last 90 days only),
//     fully unreachable jobs (no client_phone AND no client_email),
//     and unresolvable senders (decking / general / unknown type)
//     → blocked snooze_or_dismiss. These are hard reroutes — they fire
//     before any active emitter and short-circuit the rest of the pass
//     for that job. Substring-only or partial-channel checks are NOT
//     enough; the block must be safe for the worst case.
//   • payment_agreement suppresses the generic deposit_follow_up
//     trigger (Loop 2 surfaces an informational card; real
//     "is the agreement satisfied?" parsing belongs to a later loop).
//   • Suppression is automatic — re-running the generator after
//     resolving evidence (e.g., quote.viewed) drops the card.
//   • No writes to ai_proposed_actions or any backend table.
//   • No execution path. Cards have status='proposed'.
//
// Public API:
//   SALE_ACTION_GENERATOR.generate({
//     index:  JobBrainIndex,
//     config?: GeneratorConfig,
//     now?:   Date | ISO string,
//   }) → { cards: SalesActionCard[], diagnostics: { ... } }
//
// SalesActionCard contract (matches roadmap §"Sales Action Card"):
//   {
//     id:                string,        // generated; stable per (job_id + action_type + trigger)
//     job_id:            string,
//     job_number:        string,
//     owner_user_id:     string | null, // type-based sender (Nithin/Khairo) or null on unresolved
//     owner_label:       string,        // 'Nithin (patio)' / 'Khairo (fencing)' / 'Unassigned'
//     lane:              'book' | 'send' | 'call',  // 'send' is the legacy id; UI label is 'Follow Ups'
//     action_type:       string,        // book_scope | send_follow_up | call_client | …
//     priority:          number,        // 0..100, higher = more urgent
//     due_at:            string | null, // ISO; for time-bound cards (appointment_confirm etc.)
//     customer_name:     string,
//     suburb:            string,
//     job_type:          string,
//     value_inc_gst:     number | null,
//     why_now:           string,        // 1-line human-readable reason
//     evidence_refs:     EvidenceRef[],
//     policy_verdict:    'auto_ok' | 'approval_required' | 'blocked' | 'internal',
//     playbook_id:       string | null, // null in Loop 2; Loop 3 fills in
//     rep_profile_id:    string | null, // null in Loop 2; Loop 3 fills in
//     status:            'proposed',    // initial; lifecycle handled by Slices 6/7
//     created_at:        string,        // ISO; uses 'now' from input
//   }
//
// EvidenceRef shape:
//   {
//     type:         'event' | 'fact' | 'job' | 'proposed_action' | 'calendar_slot' | 'computed',
//     source_table: string | null,
//     id:           string | null,
//     occurred_at?: string,
//     kind?:        string,
//     event_type?:  string,
//     reason?:      string,
//   }
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_ACTION_GENERATOR = exports;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ── Config ─────────────────────────────────────────────────

  var DEFAULT_CONFIG = Object.freeze({
    firstContactMaxHours:        24,
    bookingMaxDays:              5,
    siteVisitToScopeMaxDays:     7,
    sentNotViewedDays:           1,
    viewedNoReplyDays:           3,
    staleQuoteDays:              14,
    appointmentConfirmHoursBefore: 24,
    depositFollowupHoursAfter:   24,
    replyResponseMaxHours:       4,
    highValueThreshold:          20000,    // for call upgrade
    holdingSmsMaxMinutes:        5,        // Loop 5 hot-lead pager window
    holdingSmsGraceMinutes:      5,        // grace before first_contact_sms takes over
    // Phrase-only entries. Bare "stop" is too ambiguous in casual English
    // ("stop by Tuesday", "bus stop", "I had to stop and think") and would
    // permanently block legitimate jobs on a false-positive substring match.
    // Each entry must encode unambiguous opt-out intent.
    stopWords: [
      'unsubscribe', 'not interested', 'please remove',
      "don't contact", 'do not contact', 'leave me alone', 'wrong number',
      'please stop', 'stop messaging', 'stop contacting', 'stop sending',
      'stop emailing', 'stop calling', 'lose my number',
    ],
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
  function hoursBetween(later, earlier) {
    var a = toDate(later); var b = toDate(earlier);
    if (!a || !b) return null;
    return (a.getTime() - b.getTime()) / (60 * 60 * 1000);
  }
  function daysBetween(later, earlier) {
    var h = hoursBetween(later, earlier);
    return h === null ? null : h / 24;
  }
  function eventsFor(events, jobId) {
    if (!Array.isArray(events)) return [];
    return events.filter(function (e) { return e && e.job_id === jobId; });
  }
  function lastEvent(jobEvents, type) {
    var matches = jobEvents.filter(function (e) { return e && e.event_type === type; });
    if (!matches.length) return null;
    matches.sort(function (a, b) {
      return +new Date(b.occurred_at || b.created_at || 0) - +new Date(a.occurred_at || a.created_at || 0);
    });
    return matches[0];
  }
  function hasEvent(jobEvents, type) { return !!lastEvent(jobEvents, type); }
  function hasFact(facts, kind) {
    if (!Array.isArray(facts)) return false;
    return facts.some(function (f) { return f && f.kind === kind; });
  }
  function findFact(facts, kind) {
    if (!Array.isArray(facts)) return null;
    return facts.find(function (f) { return f && f.kind === kind; }) || null;
  }
  function senderForType(t) {
    var type = (t || '').toLowerCase();
    if (type === 'fencing') return { user_id: 'fix-khairo', label: 'Khairo (fencing)', valid: true };
    if (type === 'patio' || type === 'combo' || type === 'decking' || type === 'general') {
      return { user_id: 'fix-nithin', label: 'Nithin (' + type + ')', valid: true };
    }
    return { user_id: null, label: 'Unassigned (' + (type || 'unknown') + ')', valid: false };
  }
  // Stop-word match must be word-boundary aware so casual phrases like
  // "stop by tomorrow" or "no problem, please send the quote" do not
  // silently block a job. Each entry is matched as a word-bounded token
  // (or token sequence). Inbound is also bounded to the last 90 days
  // so an ancient reply cannot block a re-engaged job forever.
  function buildStopWordRegexes(stopWords) {
    return (stopWords || []).map(function (s) {
      var escaped = String(s).toLowerCase().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      return new RegExp('(^|\\W)' + escaped + '(\\W|$)', 'i');
    });
  }
  function inboundStopWordEvent(jobEvents, stopWords, now) {
    var regexes = buildStopWordRegexes(stopWords);
    var nowMs = +toDate(now);
    var horizonMs = isNaN(nowMs) ? null : nowMs - 90 * 24 * 3600 * 1000;
    for (var i = 0; i < jobEvents.length; i++) {
      var ev = jobEvents[i];
      if (!ev || ev.event_type !== 'client.reply') continue;
      var occurredMs = +new Date(ev.occurred_at || ev.created_at || 0);
      if (horizonMs !== null && !isNaN(occurredMs) && occurredMs < horizonMs) continue;
      var text = (ev.payload && (ev.payload.message_text || ev.payload.text)) || '';
      for (var j = 0; j < regexes.length; j++) {
        if (regexes[j].test(text)) return ev;
      }
    }
    return null;
  }
  function isUnreachable(job) {
    return !job.client_phone && !job.client_email;
  }

  // ── Evidence-ref builders ──────────────────────────────────

  function refFromEvent(ev) {
    return {
      type:        'event',
      source_table: 'business_events',
      id:           ev.id || null,
      occurred_at:  ev.occurred_at || null,
      event_type:   ev.event_type,
    };
  }
  function refFromFact(fact) {
    return {
      type:         'fact',
      source_table: 'job_context',
      id:           fact.id || null,
      kind:         fact.kind,
    };
  }
  function refFromJob(job) {
    return {
      type:         'job',
      source_table: 'jobs',
      id:           job.id || null,
    };
  }
  function refFromProposal(pa) {
    return {
      type:         'proposed_action',
      source_table: 'ai_proposed_actions',
      id:           pa.proposal_id || pa.id || null,
    };
  }
  function refComputed(reason) {
    return {
      type:    'computed',
      source_table: null,
      id:           null,
      reason:       reason,
    };
  }

  // ── Card factory ───────────────────────────────────────────

  function makeCard(opts) {
    return {
      id:               opts.id,
      job_id:           opts.job.id,
      job_number:       opts.job.job_number,
      owner_user_id:    opts.sender.user_id,
      owner_label:      opts.sender.label,
      lane:             opts.lane,
      action_type:      opts.action_type,
      priority:         opts.priority,
      due_at:           opts.due_at || null,
      customer_name:    opts.job.client_name || '',
      suburb:           opts.job.site_suburb || opts.job.suburb || '',
      job_type:         opts.job.type || 'unknown',
      value_inc_gst:    typeof opts.job.value_inc_gst === 'number' ? opts.job.value_inc_gst : null,
      why_now:          opts.why_now,
      evidence_refs:    opts.evidence_refs,
      policy_verdict:   opts.policy_verdict,
      playbook_id:      null,
      rep_profile_id:   null,
      status:           'proposed',
      created_at:       opts.now.toISOString(),
    };
  }

  function cardId(jobId, actionType, triggerKey) {
    return 'gen_' + jobId + '_' + actionType + (triggerKey ? '_' + triggerKey : '');
  }

  // ── Suppression checks ─────────────────────────────────────
  //
  // For every emit candidate, run the relevant suppression check.
  // If suppressed, return null (caller skips emission). All checks
  // operate against the freshest data the generator was given —
  // re-running the generator after later evidence resolves the
  // trigger automatically drops the card.

  function repAnsweredAfter(jobEvents, sinceMs) {
    var outbound = ['client.sms_out', 'client.email_out', 'client.call_complete'];
    for (var i = 0; i < jobEvents.length; i++) {
      var ev = jobEvents[i];
      if (!ev || outbound.indexOf(ev.event_type) === -1) continue;
      var t = +new Date(ev.occurred_at || ev.created_at || 0);
      if (!isNaN(t) && t > sinceMs) return ev;
    }
    return null;
  }

  function clientReplyAfter(jobEvents, sinceMs) {
    for (var i = 0; i < jobEvents.length; i++) {
      var ev = jobEvents[i];
      if (!ev) continue;
      if (ev.event_type !== 'client.reply' && ev.event_type !== 'client.question') continue;
      var t = +new Date(ev.occurred_at || ev.created_at || 0);
      if (!isNaN(t) && t > sinceMs) return ev;
    }
    return null;
  }

  // ── Per-action emitters ────────────────────────────────────

  function emitDoNotChase(job, jobEvents, jobFacts, sender, now, _config) {
    var dncFact = findFact(jobFacts, 'do_not_chase');
    if (!dncFact) return null;
    return makeCard({
      id:             cardId(job.id, 'snooze_or_dismiss', 'dnc'),
      job:            job,
      sender:         sender,
      lane:           'call',
      action_type:    'snooze_or_dismiss',
      priority:       5,
      why_now:        '[DO NOT CHASE] paused — human-confirmed override.',
      evidence_refs:  [refFromFact(dncFact), refFromJob(job)],
      policy_verdict: 'internal',
      now:            now,
    });
  }

  function emitStopWord(job, jobEvents, sender, now, config) {
    var swEv = inboundStopWordEvent(jobEvents, config.stopWords, now);
    if (!swEv) return null;
    return makeCard({
      id:             cardId(job.id, 'snooze_or_dismiss', 'stopword'),
      job:            job,
      sender:         sender,
      lane:           'send',  // legacy id; UI label "Follow Ups"
      action_type:    'snooze_or_dismiss',
      priority:       8,
      why_now:        'Stop-word reply detected — human review required before any further outbound.',
      evidence_refs:  [refFromEvent(swEv), refFromJob(job)],
      policy_verdict: 'blocked',
      now:            now,
    });
  }

  function emitUnresolvedSender(job, sender, now) {
    if (sender.valid) return null;
    return makeCard({
      id:             cardId(job.id, 'snooze_or_dismiss', 'no_sender'),
      job:            job,
      sender:         sender,
      lane:           'send',
      action_type:    'snooze_or_dismiss',
      priority:       7,
      why_now:        'No rep assigned for job.type="' + (job.type || 'unknown') + '" — only patio/combo→Nithin and fencing→Khairo are wired.',
      evidence_refs:  [refFromJob(job), refComputed('unresolved sender for type=' + (job.type || 'unknown'))],
      policy_verdict: 'blocked',
      now:            now,
    });
  }

  // Hard block: job has neither client_phone nor client_email. No channel
  // is reachable, so every send_*-flavoured emitter must short-circuit.
  // The block applies at every lifecycle stage (cold lead, qualified,
  // quoted, accepted) — not just first contact.
  function emitNoContactChannel(job, sender, now) {
    if (!isUnreachable(job)) return null;
    return makeCard({
      id:             cardId(job.id, 'snooze_or_dismiss', 'no_channel'),
      job:            job,
      sender:         sender,
      lane:           'send',
      action_type:    'snooze_or_dismiss',
      priority:       6,
      why_now:        'No client_phone and no client_email — no channel is reachable. Backfill contact details before any further outbound.',
      evidence_refs:  [refFromJob(job), refComputed('client_phone is null AND client_email is null')],
      policy_verdict: 'blocked',
      now:            now,
    });
  }

  // Loop 5: Holding SMS — the sub-5-min hot-lead pager card. Fires when a
  // fresh enquiry lands and no outbound has been sent yet. The card is
  // dry-run only in Loop 5 (Slice 6 wires the real send). The cadence
  // engine's holdingSmsDryRun() consumes this card to compute the
  // would-have-been-send payload.
  function emitHoldingSms(job, jobEvents, sender, now, config) {
    if (!job.client_phone) return null;            // no SMS channel
    if (jobEvents.length > 0) {
      // Any outbound rep event disqualifies the holding window.
      var anyOutbound = jobEvents.some(function (e) {
        return e && (e.event_type === 'client.sms_out'
                  || e.event_type === 'client.email_out'
                  || e.event_type === 'client.call_complete');
      });
      if (anyOutbound) return null;
    }
    // Anchor is contact.created if present, else job.created_at.
    var anchorMs = null;
    var anchorEv = lastEvent(jobEvents, 'contact.created');
    if (anchorEv) anchorMs = +new Date(anchorEv.occurred_at);
    if (anchorMs === null && job.created_at) anchorMs = +new Date(job.created_at);
    if (anchorMs === null || isNaN(anchorMs)) return null;
    var ageMin = (+now - anchorMs) / 60000;
    if (ageMin < 0) return null;
    if (ageMin > config.holdingSmsMaxMinutes + config.holdingSmsGraceMinutes) return null;
    var refs = [];
    if (anchorEv) refs.push(refFromEvent(anchorEv));
    refs.push(refFromJob(job));
    refs.push(refComputed('age_minutes=' + Math.round(ageMin)));
    return makeCard({
      id:             cardId(job.id, 'holding_sms'),
      job:            job,
      sender:         sender,
      lane:           'send',                    // legacy id; UI label "Follow Ups"
      action_type:    'holding_sms',
      priority:       95,                        // top of lane
      why_now:        'Fresh enquiry ' + Math.round(ageMin) + 'min ago, no outbound yet. Hold them with a sub-5min ack.',
      evidence_refs:  refs,
      policy_verdict: 'auto_ok',                 // allow-listed for Slice 7 dry-run
      now:            now,
    });
  }

  function emitNoFirstContact(job, jobFacts, jobEvents, sender, now, config) {
    var ageHours = hoursBetween(now, job.created_at);
    if (ageHours === null || ageHours < config.firstContactMaxHours) return null;
    // Suppression: any business_event on this job means the rep / system
    // has already touched it (outbound SMS/email/call, site visit, quote
    // sent, GHL note, appointment, etc.). "no first contact" only applies
    // to genuinely cold enquiries.
    if (jobEvents.length > 0) return null;
    // Suppression: a `qualified` fact means the rep has spoken with them
    // (the fact gets promoted from a first-contact call/SMS); the matching
    // emitter is emitBookScope, not no_first_contact.
    if (hasFact(jobFacts, 'qualified')) return null;
    // Note: full unreachability (no phone + no email) is already handled
    // upstream by emitNoContactChannel as a hard reroute. Phone-only or
    // email-only is enough to make a first contact attempt.
    return makeCard({
      id:             cardId(job.id, 'call_client', 'no_first_contact'),
      job:            job,
      sender:         sender,
      lane:           'call',
      action_type:    'call_client',
      priority:       80 + Math.min(40, ageHours - config.firstContactMaxHours),
      why_now:        'Lead arrived ' + Math.round(ageHours) + 'h ago, no outbound recorded. Phone first; SMS as backup.',
      evidence_refs:  [refFromJob(job), refComputed('hours_since_created=' + Math.round(ageHours) + ' > ' + config.firstContactMaxHours + 'h')],
      policy_verdict: 'internal', // rep dials manually
      now:            now,
    });
  }

  function emitBookScope(job, jobEvents, jobFacts, sender, now, config) {
    var qFact = findFact(jobFacts, 'qualified');
    if (!qFact) return null;
    if (hasEvent(jobEvents, 'client.appointment')) return null;
    if (hasEvent(jobEvents, 'site_visit.completed')) return null;
    if (hasFact(jobFacts, 'council_hold')) {
      var chFact = findFact(jobFacts, 'council_hold');
      return makeCard({
        id:             cardId(job.id, 'snooze_or_dismiss', 'council_hold'),
        job:            job,
        sender:         sender,
        lane:           'book',
        action_type:    'snooze_or_dismiss',
        priority:       30,
        why_now:        'Job paused for council. Booking suppressed until clearance.',
        evidence_refs:  [refFromFact(chFact), refFromJob(job)],
        policy_verdict: 'internal',
        now:            now,
      });
    }
    var refs = [refFromFact(qFact), refFromJob(job)];
    ['client_preference', 'access_note', 'availability_window', 'unusual_scope'].forEach(function (k) {
      var f = findFact(jobFacts, k);
      if (f) refs.push(refFromFact(f));
    });
    var daysSinceQualified = qFact.provenance && qFact.provenance.promoted_at
      ? daysBetween(now, qFact.provenance.promoted_at)
      : null;
    var urgencyBoost = (daysSinceQualified !== null && daysSinceQualified > config.bookingMaxDays) ? 20 : 0;
    var valueBoost = typeof job.value_inc_gst === 'number' ? Math.min(30, job.value_inc_gst / 1000) : 0;
    return makeCard({
      id:             cardId(job.id, 'book_scope'),
      job:            job,
      sender:         sender,
      lane:           'book',
      action_type:    'book_scope',
      priority:       50 + valueBoost + urgencyBoost,
      why_now:        'Qualified, no site visit booked. Propose 2-3 windows.',
      evidence_refs:  refs,
      policy_verdict: 'approval_required',
      now:            now,
    });
  }

  function emitSiteVisitNoScope(job, jobEvents, sender, now, config) {
    var svEv = lastEvent(jobEvents, 'site_visit.completed');
    if (!svEv) return null;
    if (hasEvent(jobEvents, 'quote.sent')) return null; // suppression
    var ageDays = daysBetween(now, svEv.occurred_at);
    if (ageDays === null || ageDays < config.siteVisitToScopeMaxDays) return null;
    return makeCard({
      id:             cardId(job.id, 'call_client', 'site_visit_no_scope'),
      job:            job,
      sender:         sender,
      lane:           'call',
      action_type:    'call_client',
      priority:       60 + ageDays,
      why_now:        'Site visit completed ' + Math.round(ageDays) + 'd ago, scoping tool not opened. Coaching call.',
      evidence_refs:  [refFromEvent(svEv), refFromJob(job), refComputed('days_since_site_visit=' + Math.round(ageDays))],
      policy_verdict: 'internal',
      now:            now,
    });
  }

  function emitFollowUpOrCall(job, jobEvents, jobFacts, sender, now, config) {
    var sentEv = lastEvent(jobEvents, 'quote.sent');
    if (!sentEv) return null;
    if (hasEvent(jobEvents, 'quote.accepted') || hasEvent(jobEvents, 'quote.declined')) return null; // terminal
    var sentAtMs = +new Date(sentEv.occurred_at);
    var viewedEv = lastEvent(jobEvents, 'quote.viewed');
    var lastClientQuestionEv = lastEvent(jobEvents, 'client.question');
    var lastClientReplyEv = lastEvent(jobEvents, 'client.reply');
    // Suppress if client.question after sent + no rep reply (handled by emitReplyNeeded, not here)
    if (lastClientQuestionEv && +new Date(lastClientQuestionEv.occurred_at) > sentAtMs) {
      var repAns = repAnsweredAfter(jobEvents, +new Date(lastClientQuestionEv.occurred_at));
      if (!repAns) return null; // emitReplyNeeded will pick it up
    }
    if (lastClientReplyEv && +new Date(lastClientReplyEv.occurred_at) > sentAtMs) {
      var repAns2 = repAnsweredAfter(jobEvents, +new Date(lastClientReplyEv.occurred_at));
      if (!repAns2) return null; // emitReplyNeeded will pick it up
    }
    var ageDays = daysBetween(now, sentEv.occurred_at);

    // Stale (>= staleQuoteDays)
    if (ageDays >= config.staleQuoteDays) {
      return makeCard({
        id:             cardId(job.id, 'stale_quote_recovery'),
        job:            job,
        sender:         sender,
        lane:           'send',
        action_type:    'stale_quote_recovery',
        priority:       25 + Math.round(ageDays / 7),
        why_now:        'Quote sent ' + Math.round(ageDays) + 'd ago, no decision. Soft nurture / archive prompt.',
        evidence_refs:  [refFromEvent(sentEv), refFromJob(job)],
        policy_verdict: 'approval_required',
        now:            now,
      });
    }

    // Viewed-no-reply path
    if (viewedEv) {
      var viewedAtMs = +new Date(viewedEv.occurred_at);
      if (lastClientReplyEv && +new Date(lastClientReplyEv.occurred_at) > viewedAtMs) return null;
      if (repAnsweredAfter(jobEvents, viewedAtMs)) return null;
      var viewedAgo = daysBetween(now, viewedEv.occurred_at);
      if (viewedAgo === null) return null;
      // Decision: high-value upgrades to call; >= viewedNoReplyDays upgrades to call.
      var goCall = false;
      if (viewedAgo >= config.viewedNoReplyDays) goCall = true;
      if (typeof job.value_inc_gst === 'number'
          && job.value_inc_gst >= config.highValueThreshold
          && viewedAgo >= 1) goCall = true;
      if (goCall) {
        return makeCard({
          id:             cardId(job.id, 'call_client', 'viewed_no_reply'),
          job:            job,
          sender:         sender,
          lane:           'call',
          action_type:    'call_client',
          priority:       65 + viewedAgo + (typeof job.value_inc_gst === 'number' ? job.value_inc_gst / 1000 : 0),
          why_now:        'Opened ' + Math.round(viewedAgo) + 'd ago, no reply. Phone beats SMS at this stage' + (job.value_inc_gst >= config.highValueThreshold ? ' (high-value)' : '') + '.',
          evidence_refs:  [refFromEvent(viewedEv), refFromEvent(sentEv), refFromJob(job)],
          policy_verdict: 'internal',
          now:            now,
        });
      }
      // Light nudge SMS (still under viewedNoReplyDays)
      return makeCard({
        id:             cardId(job.id, 'send_follow_up', 'viewed_light'),
        job:            job,
        sender:         sender,
        lane:           'send',
        action_type:    'send_follow_up',
        priority:       45 + viewedAgo,
        why_now:        'Opened ' + Math.round(viewedAgo) + 'd ago, no questions yet. Light SMS nudge.',
        evidence_refs:  [refFromEvent(viewedEv), refFromEvent(sentEv), refFromJob(job)],
        policy_verdict: 'auto_ok',
        now:            now,
      });
    }

    // Sent-not-viewed path
    if (ageDays >= config.sentNotViewedDays) {
      var lastOutbound = repAnsweredAfter(jobEvents, sentAtMs);
      if (lastOutbound) return null; // suppression: rep already nudged
      return makeCard({
        id:             cardId(job.id, 'send_follow_up', 'sent_not_viewed'),
        job:            job,
        sender:         sender,
        lane:           'send',
        action_type:    'send_follow_up',
        priority:       40 + ageDays,
        why_now:        'Sent ' + Math.round(ageDays) + 'd ago, quote not opened. Light nudge.',
        evidence_refs:  [refFromEvent(sentEv), refFromJob(job)],
        policy_verdict: 'auto_ok',
        now:            now,
      });
    }

    return null;
  }

  function emitReplyNeeded(job, jobEvents, sender, now, config) {
    var lastInbound = lastEvent(jobEvents, 'client.question') || lastEvent(jobEvents, 'client.reply');
    if (!lastInbound) return null;
    var inboundMs = +new Date(lastInbound.occurred_at);
    if (repAnsweredAfter(jobEvents, inboundMs)) return null;
    // Only fire if the inbound is post-quote.sent (otherwise it's a pre-quote dialogue, treated elsewhere).
    var sentEv = lastEvent(jobEvents, 'quote.sent');
    if (sentEv && +new Date(sentEv.occurred_at) > inboundMs) return null;
    var hoursSince = hoursBetween(now, lastInbound.occurred_at);
    if (hoursSince === null || hoursSince < config.replyResponseMaxHours) return null;
    var isQuestion = lastInbound.event_type === 'client.question';
    var daysSince = hoursSince / 24;
    // Lane upgrade to Call for high-value + >1d unanswered.
    var goCall = (typeof job.value_inc_gst === 'number'
                  && job.value_inc_gst >= config.highValueThreshold
                  && daysSince > 1);
    return makeCard({
      id:             cardId(job.id, 'reply_needed', isQuestion ? 'q' : 'r'),
      job:            job,
      sender:         sender,
      lane:           goCall ? 'call' : 'send',
      action_type:    'reply_needed',
      priority:       90 + (isQuestion ? 10 : 0),
      why_now:        (isQuestion ? 'Client asked a question ' : 'Client replied ') + Math.round(hoursSince) + 'h ago, no rep response yet.',
      evidence_refs:  [refFromEvent(lastInbound), refFromJob(job)],
      policy_verdict: 'approval_required',
      now:            now,
    });
  }

  function emitDepositFollowUp(job, jobEvents, jobFacts, sender, now, config) {
    var acceptedEv = lastEvent(jobEvents, 'quote.accepted');
    if (!acceptedEv) return null;
    var paymentRecvEv = lastEvent(jobEvents, 'payment.received');
    if (paymentRecvEv) return null;
    var hoursSince = hoursBetween(now, acceptedEv.occurred_at);
    if (hoursSince === null || hoursSince < config.depositFollowupHoursAfter) return null;
    var paymentAgreement = findFact(jobFacts, 'payment_agreement');
    if (paymentAgreement) {
      // Don't auto-chase. Surface informational.
      return makeCard({
        id:             cardId(job.id, 'snooze_or_dismiss', 'payment_agreement'),
        job:            job,
        sender:         sender,
        lane:           'send',
        action_type:    'snooze_or_dismiss',
        priority:       20,
        why_now:        'payment_agreement covers deposit terms. Manual follow-up if needed.',
        evidence_refs:  [refFromFact(paymentAgreement), refFromEvent(acceptedEv), refFromJob(job)],
        policy_verdict: 'internal',
        now:            now,
      });
    }
    return makeCard({
      id:             cardId(job.id, 'deposit_follow_up'),
      job:            job,
      sender:         sender,
      lane:           'send',
      action_type:    'deposit_follow_up',
      priority:       60 + hoursSince / 24,
      why_now:        'Quote accepted ' + Math.round(hoursSince) + 'h ago, no deposit received. Follow up.',
      evidence_refs:  [refFromEvent(acceptedEv), refFromJob(job)],
      policy_verdict: 'approval_required',
      now:            now,
    });
  }

  function emitAppointmentConfirm(job, jobEvents, calendar, sender, now, config) {
    var apptEv = lastEvent(jobEvents, 'client.appointment');
    if (!apptEv) return null;
    // The appointment slot info may live on the event payload OR in the calendar fixture.
    var slotMs = null;
    if (apptEv.payload && apptEv.payload.scheduled_at) slotMs = +new Date(apptEv.payload.scheduled_at);
    if (!slotMs && calendar && Array.isArray(calendar.slots)) {
      var match = calendar.slots.find(function (s) {
        return s && s.kind === 'booked' && (s.job_id === job.id || s.job_number === job.job_number);
      });
      if (match && match.day && match.start) {
        slotMs = +new Date(match.day + 'T' + match.start + ':00+08:00');
      }
    }
    if (!slotMs || isNaN(slotMs)) return null;
    var nowMs = +new Date(now);
    var hoursUntil = (slotMs - nowMs) / 3600e3;
    if (hoursUntil <= 0) return null;
    if (hoursUntil > config.appointmentConfirmHoursBefore) return null;
    return makeCard({
      id:             cardId(job.id, 'appointment_confirm'),
      job:            job,
      sender:         sender,
      lane:           'book',
      action_type:    'appointment_confirm',
      priority:       70 + (config.appointmentConfirmHoursBefore - hoursUntil),
      due_at:         new Date(slotMs).toISOString(),
      why_now:        'Appointment in ' + Math.round(hoursUntil) + 'h. Send confirmation.',
      evidence_refs:  [refFromEvent(apptEv), refFromJob(job), refComputed('hours_until_slot=' + Math.round(hoursUntil))],
      policy_verdict: 'approval_required',
      now:            now,
    });
  }

  // ── Public: generate ───────────────────────────────────────

  function generate(input) {
    var index = (input && input.index) || {};
    var config = Object.assign({}, DEFAULT_CONFIG, (input && input.config) || {});
    var now = toDate((input && input.now) || index.generatedAt) || new Date();
    var jobs = index.jobs || [];
    var events = index.events || [];
    var jobContextMap = index.jobContext || {};
    var calendar = index.calendar || null;
    var existingProposals = index.proposedActions || [];

    var allCards = [];
    var diagnostics = { jobsConsidered: jobs.length, suppressedTerminal: 0, perAction: {} };

    function tally(card) {
      if (!card) return;
      var key = card.action_type;
      diagnostics.perAction[key] = (diagnostics.perAction[key] || 0) + 1;
      allCards.push(card);
    }

    jobs.forEach(function (job) {
      if (!job || !job.id) return;
      var status = (job.status || '').toLowerCase();
      if (status === 'lost' || status === 'cancelled' || status === 'done') {
        diagnostics.suppressedTerminal++;
        return;
      }
      var jobEvents = eventsFor(events, job.id);
      var jobFacts = jobContextMap[job.id] || [];
      var sender = senderForType(job.type);

      // ── Hard reroutes / blocks first ──
      var dnc = emitDoNotChase(job, jobEvents, jobFacts, sender, now, config);
      if (dnc) {
        tally(dnc);
        return; // do_not_chase suppresses everything else for this job
      }
      var sw = emitStopWord(job, jobEvents, sender, now, config);
      if (sw) {
        tally(sw);
        return; // stop-word suppresses everything else
      }
      var noSender = emitUnresolvedSender(job, sender, now);
      if (noSender) {
        tally(noSender);
        return; // unresolved sender suppresses everything else
      }
      var noChannel = emitNoContactChannel(job, sender, now);
      if (noChannel) {
        tally(noChannel);
        return; // no reachable channel suppresses everything else
      }

      // ── Active emitters ──
      tally(emitHoldingSms(job, jobEvents, sender, now, config));
      tally(emitNoFirstContact(job, jobFacts, jobEvents, sender, now, config));
      tally(emitBookScope(job, jobEvents, jobFacts, sender, now, config));
      tally(emitSiteVisitNoScope(job, jobEvents, sender, now, config));
      tally(emitFollowUpOrCall(job, jobEvents, jobFacts, sender, now, config));
      tally(emitReplyNeeded(job, jobEvents, sender, now, config));
      tally(emitDepositFollowUp(job, jobEvents, jobFacts, sender, now, config));
      tally(emitAppointmentConfirm(job, jobEvents, calendar, sender, now, config));
    });

    // ── Existing-proposal augmentation ──
    // If a proposal exists for (job, action_type) the generator
    // also produced, prefer the proposal's id and add it to refs.
    // Generator never overwrites an existing proposal's drafted_message
    // — that's a Loop 3 concern.
    var proposalMap = {};
    existingProposals.forEach(function (p) {
      if (!p || !p.job_id || !p.action_type) return;
      proposalMap[p.job_id + '::' + p.action_type] = p;
    });
    allCards.forEach(function (c) {
      var match = proposalMap[c.job_id + '::' + c.action_type];
      if (match) {
        c.evidence_refs.push(refFromProposal(match));
      }
    });

    // ── Final hygiene: every card must have ≥ 1 evidence_ref ──
    allCards = allCards.filter(function (c) {
      return c && Array.isArray(c.evidence_refs) && c.evidence_refs.length >= 1;
    });

    // ── Sort: priority desc, then created_at desc within ties ──
    allCards.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });

    diagnostics.cardsProduced = allCards.length;
    diagnostics.lanesPopulated = allCards.reduce(function (acc, c) {
      acc[c.lane] = (acc[c.lane] || 0) + 1;
      return acc;
    }, { book: 0, send: 0, call: 0 });

    return { cards: allCards, diagnostics: diagnostics };
  }

  return {
    generate: generate,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    // exposed for tests:
    _emitDoNotChase: emitDoNotChase,
    _emitStopWord: emitStopWord,
    _emitNoContactChannel: emitNoContactChannel,
    _emitHoldingSms: emitHoldingSms,
    _emitNoFirstContact: emitNoFirstContact,
    _emitBookScope: emitBookScope,
    _emitFollowUpOrCall: emitFollowUpOrCall,
    _emitReplyNeeded: emitReplyNeeded,
    _emitDepositFollowUp: emitDepositFollowUp,
    _emitAppointmentConfirm: emitAppointmentConfirm,
    _senderForType: senderForType,
  };
});
