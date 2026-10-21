/* ════════════════════════════════════════════════════════════════
   ops-stage-gate-engine.js — Cap 1B Stage-Gate Engine (v1)

   Read-only stage-gate engine. Layers ABOVE the canonical state
   machine (sw-state-machine.js) and BELOW the T6 readiness engine
   (ops-readiness-engine.js, which becomes a downstream consumer in
   Cap 1C). Pure module — no fetch, no DOM, no globals besides the
   namespace export.

   Three public entry points:

   1. evaluateStageGates(job, packet, supplemental, options)
      → StageGateResult — full gate ledger for a job, including
      applicability per gate, blockers, warnings, next_actions, and
      Pipeline Visibility Guard fields.

   2. canTransition(job, from, to, override?)
      → { allowed, direction, gates_passed, gates_failed, hard_blocked,
          requires_override, reasons } — the transition-legality
      arbiter.

   3. proposeNextStage(job, packet, supplemental)
      → { suggestion, reason, blockers, owner, jarvis_posture } — the
      JARVIS-input surface (suggest only; never auto-transitions).

   Inputs:
   - packet: T1 release packet shape per release-packet-contract-v1.md §9
   - supplemental: { assignments[], job_context[], deposit, business_events[] }
   - options: { now?, install_window_business_days? (default 5),
       po_column_of? (ops.html poBoardColumnOf: a purchase order status ->
       its board column) }

   Authority:
   - secureworks-docs/operations/cap-1-stage-gate-contract.md
   - secureworks-docs/cio/operations/2026-05-01-cap1-stage-gate-autonomous-roadmap.md
   - secureworks-docs/cio/operations/2026-05-01-cap0-cap1-stage-gate-understanding.md

   Marnin governance encoded in this module:
   - Sales hands over at deposit cash truth confirmed.
   - No material ordering before deposit truth, except Marnin/Shaun
     override (bank-confirmed deposit outside Xero).
   - Patio approvals gate marks `not_applicable` when no council
     required; never `failed` for that reason.
   - Multi-neighbour fencing all-or-nothing — partial decline reverts
     to `quoted`.
   - Cap 1 v1 overrides: Marnin/Shaun only; reason category +
     free-text required; no automatic expiry.
   - JARVIS posture: read_only / suggest only. Never auto-transition.
   ════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SW_STAGE_GATE_ENGINE = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Canonical state-machine import (browser global or node require) ──
  var SM = (function () {
    if (typeof module === 'object' && module.exports) {
      try { return require('./sw-state-machine.js'); } catch (e) { /* fall through */ }
    }
    if (typeof self !== 'undefined' && self.SW_STATE_MACHINE) return self.SW_STATE_MACHINE;
    if (typeof window !== 'undefined' && window.SW_STATE_MACHINE) return window.SW_STATE_MACHINE;
    return null;
  })();

  if (!SM) {
    throw new Error('[ops-stage-gate-engine] Canonical sw-state-machine.js not loaded — load it before ops-stage-gate-engine.js or require it in node tests.');
  }

  // ══════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════

  function isPresent(v) { return v !== null && v !== undefined && v !== ''; }

  function safe(obj, path, dflt) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return dflt;
      cur = cur[parts[i]];
    }
    return cur == null ? dflt : cur;
  }

  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v == null) return [];
    return [v];
  }

  function businessDaysBetween(fromIso, toIso) {
    if (!fromIso || !toIso) return null;
    var from = new Date(fromIso);
    var to = new Date(toIso);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
    var ms = to.getTime() - from.getTime();
    var sign = ms < 0 ? -1 : 1;
    var msAbs = Math.abs(ms);
    var dayMs = 24 * 60 * 60 * 1000;
    var totalDays = Math.floor(msAbs / dayMs);
    var days = 0;
    var d = new Date(from);
    for (var i = 0; i < totalDays; i++) {
      d = new Date(d.getTime() + sign * dayMs);
      var dow = d.getUTCDay(); // 0 Sun .. 6 Sat
      if (dow !== 0 && dow !== 6) days += 1;
    }
    return sign * days;
  }

  function findOverride(jobContext, gateId) {
    var rows = asArray(jobContext);
    return rows.find(function (c) {
      if (!c || (c.kind !== 'gate_override' && c.kind !== 'force_proceed_reason' && c.kind !== 'readiness_override')) return false;
      var v = c.value || {};
      return v.gate_id === gateId || v.signal === gateId ||
             (v.from_stage && v.gate_id === gateId);
    }) || null;
  }

  function findFact(jobContext, kind, predicate) {
    var rows = asArray(jobContext);
    var matched = rows.filter(function (c) { return c && c.kind === kind; });
    if (predicate) matched = matched.filter(predicate);
    return matched[0] || null;
  }

  // ══════════════════════════════════════════════════════════════
  // Stage families and ownership (from contract §2)
  // ══════════════════════════════════════════════════════════════

  var STAGE_FAMILY = {
    draft:               'quote',
    quoted:              'quote',
    partially_accepted:  'acceptance',
    accepted:            'acceptance',
    awaiting_deposit:    'pre_install_finance',
    deposit:             'pre_install_finance', // legacy
    approvals:           'pre_install_compliance',
    order_materials:     'materials',
    processing:          'materials',           // legacy umbrella
    awaiting_supplier:   'materials',
    order_confirmed:     'materials',
    schedule_install:    'install',             // derived view
    scheduled:           'install',
    in_progress:         'install',
    rectification:       'install',             // legacy flag-target
    complete:            'closeout',
    final_payment:       'closeout',            // derived view
    invoiced:            'closeout',
    get_review:          'closeout',            // derived view
    cancelled:           'terminal',
    lost:                'terminal',            // legacy
    archived:            'terminal'
  };

  // ══════════════════════════════════════════════════════════════
  // Per-type transition graph (Cap 1A vocabulary lock)
  //
  // Each entry: { forward: [stages], backward: [stages] }
  // Universal rules layered on top:
  //   - Any non-terminal → cancelled is always allowed.
  //   - Any → archived only from complete | cancelled.
  //   - cancelled → quoted is a soft override (Marnin/Shaun, re-open).
  // ══════════════════════════════════════════════════════════════

  var FENCING_TRANSITIONS = {
    draft:               { forward: ['quoted'],                                  backward: [] },
    quoted:              { forward: ['partially_accepted', 'accepted'],          backward: [] },
    partially_accepted:  { forward: ['accepted'],                                backward: ['quoted'] },
    accepted:            { forward: ['awaiting_deposit'],                        backward: ['quoted', 'partially_accepted'] },
    awaiting_deposit:    { forward: ['order_materials'],                         backward: ['accepted'] },
    order_materials:     { forward: ['awaiting_supplier'],                       backward: ['awaiting_deposit'] },
    awaiting_supplier:   { forward: ['order_confirmed'],                         backward: ['order_materials'] },
    order_confirmed:     { forward: ['scheduled'],                               backward: ['awaiting_supplier'] },
    scheduled:           { forward: ['in_progress'],                             backward: ['order_confirmed'] },
    in_progress:         { forward: ['complete'],                                backward: ['scheduled'] },
    complete:            { forward: ['invoiced', 'archived'],                    backward: [] },
    invoiced:            { forward: ['archived'],                                backward: [] },
    cancelled:           { forward: ['archived'],                                backward: [] },
    archived:            { forward: [],                                          backward: [] }
  };

  var PATIO_TRANSITIONS = {
    draft:               { forward: ['quoted'],                                  backward: [] },
    quoted:              { forward: ['accepted'],                                backward: [] },
    accepted:            { forward: ['awaiting_deposit'],                        backward: ['quoted'] },
    awaiting_deposit:    { forward: ['approvals', 'order_materials'],            backward: ['accepted'] },
    approvals:           { forward: ['order_materials'],                         backward: ['awaiting_deposit'] },
    order_materials:     { forward: ['awaiting_supplier'],                       backward: ['awaiting_deposit', 'approvals'] },
    awaiting_supplier:   { forward: ['order_confirmed'],                         backward: ['order_materials'] },
    order_confirmed:     { forward: ['scheduled'],                               backward: ['awaiting_supplier'] },
    scheduled:           { forward: ['in_progress'],                             backward: ['order_confirmed'] },
    in_progress:         { forward: ['complete'],                                backward: ['scheduled'] },
    complete:            { forward: ['invoiced', 'archived'],                    backward: [] },
    invoiced:            { forward: ['archived'],                                backward: [] },
    cancelled:           { forward: ['archived'],                                backward: [] },
    archived:            { forward: [],                                          backward: [] }
  };

  var QUICK_QUOTE_TRANSITIONS = {
    draft:               { forward: ['quoted'],                                  backward: [] },
    quoted:              { forward: ['accepted'],                                backward: [] },
    accepted:            { forward: ['archived'],                                backward: ['quoted'] }, // converts → fencing/patio
    cancelled:           { forward: ['archived'],                                backward: [] },
    archived:            { forward: [],                                          backward: [] }
  };

  function transitionsFor(type) {
    switch (type) {
      case 'fencing':     return FENCING_TRANSITIONS;
      case 'patio':       return PATIO_TRANSITIONS;
      case 'decking':     return PATIO_TRANSITIONS;
      case 'quick_quote': return QUICK_QUOTE_TRANSITIONS;
      default:            return PATIO_TRANSITIONS;
    }
  }

  // Stages that come AFTER `s` in the canonical pipeline (used for
  // applicability — e.g. "applies post-accept" means current stage
  // is `accepted` or later).
  function isStageAtOrAfter(currentStage, threshold, type) {
    var arr = SM.getStagesForType(type);
    var ci = arr.indexOf(currentStage);
    var ti = arr.indexOf(threshold);
    if (ci === -1 || ti === -1) return false;
    return ci >= ti;
  }

  // ══════════════════════════════════════════════════════════════
  // Gate library — 19 gates across 8 families
  //
  // Each gate:
  //   id, family, label, severity, hard_locked,
  //   applicability(ctx) → boolean,
  //   evaluate(ctx) → { status, evidence, reason, next_action,
  //                     owner, override_available }
  //
  // status values:
  //   'pass'           gate satisfied
  //   'fail'           gate not satisfied (severity decides whether
  //                    it blocks)
  //   'unknown'        applicability satisfied but evidence not loaded
  //                    (degraded confidence)
  //   'not_applicable' gate doesn't apply (e.g. patio without council)
  //   'overridden'     gate failed but a valid override exists
  //   'deferred'       gate intentionally deferred (e.g. signal 2/7
  //                    from T6 spec)
  // ══════════════════════════════════════════════════════════════

  function gateResult(id, status, severity, family, owner, evidence, reason, next_action, override_available, override) {
    return {
      gate_id: id,
      status: status,
      severity: severity,
      family: family,
      owner: owner || 'system',
      evidence: evidence || { source: null, ref: null, value: null },
      reason: reason || '',
      next_action: next_action || null,
      override_available: !!override_available,
      override: override || null
    };
  }

  // Gate 1 — Pipeline Visibility Guard. Always evaluated.
  function gate_status_mapped_for_pipeline(ctx) {
    var rawStatus = safe(ctx.packet, 'job.status', null);
    var mapping = SM.mapStatus(rawStatus);
    if (mapping.status_mapped_for_pipeline) {
      return gateResult('status_mapped_for_pipeline', 'pass', 'blocker', 'system', 'system',
        { source: 'packet.job.status', ref: null, value: rawStatus },
        'Status "' + rawStatus + '" maps to bucket "' + mapping.frontend_bucket + '"', null, false);
    }
    return gateResult('status_mapped_for_pipeline', 'fail', 'blocker', 'system', 'system',
      { source: 'packet.job.status', ref: null, value: rawStatus },
      'Status "' + (rawStatus || 'null') + '" is not in canonical map — falling back to status_mapping_gap bucket so job stays visible',
      'Update backend/frontend status map: add "' + rawStatus + '" → bucket', false);
  }

  // Gate 2 — quote_revision row exists.
  function gate_revision_present(ctx) {
    var applies = ctx.currentStage !== 'draft' && ctx.currentStage !== null;
    if (!applies) return gateResult('revision_present', 'not_applicable', 'blocker', 'cap0_release', 'sales');
    var rev = safe(ctx.packet, 'revision', null);
    if (rev && isPresent(rev.id)) {
      return gateResult('revision_present', 'pass', 'blocker', 'cap0_release', 'sales',
        { source: 'packet.revision.id', ref: rev.id, value: rev.revision_number },
        'Quote revision #' + (rev.revision_number || '?') + ' present', null, false);
    }
    return gateResult('revision_present', 'fail', 'blocker', 'cap0_release', 'sales',
      { source: 'packet.revision', ref: null, value: null },
      'No quote_revisions row for this job — Cap 0 release truth absent',
      'Send quote via Patio/Fence/Quick Quote tool', false);
  }

  // Gate 3 — quote was sent (sent_at IS NOT NULL).
  function gate_revision_released(ctx) {
    var applies = ctx.currentStage && ctx.currentStage !== 'draft' && ctx.currentStage !== 'quoted';
    if (!applies) return gateResult('revision_released', 'not_applicable', 'blocker', 'cap0_release', 'sales');
    var sentAt = safe(ctx.packet, 'revision.sent_at', null);
    if (isPresent(sentAt)) {
      return gateResult('revision_released', 'pass', 'blocker', 'cap0_release', 'sales',
        { source: 'packet.revision.sent_at', ref: null, value: sentAt },
        'Sent ' + sentAt, null, false);
    }
    return gateResult('revision_released', 'fail', 'blocker', 'cap0_release', 'sales',
      { source: 'packet.revision.sent_at', ref: null, value: null },
      'Revision is staged but not yet sent (sent_at IS NULL)',
      'Trigger send-quote on staged revision', false);
  }

  // Gate 4 — client accepted (document.accepted_at IS NOT NULL).
  function gate_accepted_at(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'accepted', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived' && ctx.currentStage !== 'lost';
    if (!applies) return gateResult('accepted_at', 'not_applicable', 'blocker', 'acceptance', 'sales');
    var declinedAt = safe(ctx.packet, 'document.declined_at', null);
    if (isPresent(declinedAt)) {
      return gateResult('accepted_at', 'fail', 'blocker', 'acceptance', 'sales',
        { source: 'packet.document.declined_at', ref: null, value: declinedAt },
        'Client declined ' + declinedAt + ' — operational stages cannot be entered',
        'Move job to cancelled or open variation conversation', false);
    }
    var acceptedAt = safe(ctx.packet, 'document.accepted_at', null);
    if (isPresent(acceptedAt)) {
      return gateResult('accepted_at', 'pass', 'blocker', 'acceptance', 'sales',
        { source: 'packet.document.accepted_at', ref: null, value: acceptedAt },
        'Accepted ' + acceptedAt, null, false);
    }
    return gateResult('accepted_at', 'fail', 'blocker', 'acceptance', 'sales',
      { source: 'packet.document.accepted_at', ref: null, value: null },
      'No client acceptance recorded',
      'Confirm client acceptance via share link or manual document update', false);
  }

  // Gate 5 — multi-neighbour fencing all-or-nothing rule.
  // partially_accepted is a holding state; it transitions to accepted
  // only when EVERY party has accepted. If any party declines, the job
  // reverts to quoted (per shared_fence_all_parties_required.md).
  function gate_partial_acceptance_complete(ctx) {
    if (ctx.type !== 'fencing') {
      return gateResult('partial_acceptance_complete', 'not_applicable', 'blocker', 'acceptance', 'sales',
        { source: null, ref: null, value: null },
        'Multi-neighbour rule applies to fencing only', null, false);
    }
    // Threshold is partially_accepted itself — when the job is in
    // partially_accepted, the gate is the active constraint that
    // governs whether it can advance to accepted.
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'partially_accepted', 'fencing');
    if (!applies) return gateResult('partial_acceptance_complete', 'not_applicable', 'blocker', 'acceptance', 'sales');

    // Look at scope_snapshot for shared_fence indicator + per-party
    // acceptance state. Conservative encoding: if scope_snapshot has
    // a `parties` array, every party must have accepted_at; if there
    // are no parties listed, we assume single-party fence and gate
    // collapses into accepted_at.
    var parties = asArray(safe(ctx.packet, 'revision.scope_snapshot.parties', []));
    if (parties.length === 0) {
      return gateResult('partial_acceptance_complete', 'pass', 'blocker', 'acceptance', 'sales',
        { source: 'packet.revision.scope_snapshot.parties', ref: null, value: 0 },
        'Single-party fence — multi-neighbour rule not engaged', null, false);
    }
    var declined = parties.filter(function (p) { return isPresent(p.declined_at); });
    if (declined.length > 0) {
      return gateResult('partial_acceptance_complete', 'fail', 'blocker', 'acceptance', 'sales',
        { source: 'packet.revision.scope_snapshot.parties', ref: null, value: { declined_count: declined.length } },
        declined.length + ' party/parties declined — job must revert to quoted with revised scope',
        'Re-quote with adjusted neighbour set OR move to cancelled', false);
    }
    var pending = parties.filter(function (p) { return !isPresent(p.accepted_at); });
    if (pending.length > 0) {
      return gateResult('partial_acceptance_complete', 'fail', 'blocker', 'acceptance', 'sales',
        { source: 'packet.revision.scope_snapshot.parties', ref: null, value: { pending_count: pending.length, total: parties.length } },
        pending.length + ' of ' + parties.length + ' parties still pending — operational stages cannot start (all-or-nothing)',
        'Continue sales follow-up with pending parties', false);
    }
    return gateResult('partial_acceptance_complete', 'pass', 'blocker', 'acceptance', 'sales',
      { source: 'packet.revision.scope_snapshot.parties', ref: null, value: { accepted: parties.length } },
      'All ' + parties.length + ' parties accepted', null, false);
  }

  // Gate 6 — customer mobile present (packet completeness).
  function gate_customer_mobile_present(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'accepted', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived';
    if (!applies) return gateResult('customer_mobile_present', 'not_applicable', 'blocker', 'packet', 'office');
    var mobile = safe(ctx.packet, 'customer.mobile', null);
    if (isPresent(mobile)) {
      return gateResult('customer_mobile_present', 'pass', 'blocker', 'packet', 'office',
        { source: 'packet.customer.mobile', ref: null, value: mobile },
        'Mobile present', null, false);
    }
    return gateResult('customer_mobile_present', 'fail', 'blocker', 'packet', 'office',
      { source: 'packet.customer.mobile', ref: null, value: null },
      'Customer mobile missing — install reminders and payment links cannot send',
      'Capture mobile via sw_update_contact', false);
  }

  // Gate 7 — site address + suburb present.
  function gate_site_address_present(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'accepted', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived';
    if (!applies) return gateResult('site_address_present', 'not_applicable', 'blocker', 'packet', 'office');
    var addr = safe(ctx.packet, 'site.address', null);
    var suburb = safe(ctx.packet, 'site.suburb', null);
    if (isPresent(addr) && isPresent(suburb)) {
      return gateResult('site_address_present', 'pass', 'blocker', 'packet', 'office',
        { source: 'packet.site', ref: null, value: { address: addr, suburb: suburb } },
        'Address + suburb present', null, false);
    }
    return gateResult('site_address_present', 'fail', 'blocker', 'packet', 'office',
      { source: 'packet.site', ref: null, value: { address: addr, suburb: suburb } },
      'Site address or suburb missing',
      'Confirm site address with client and update job', false);
  }

  // Gate 8 — site geocoded (lat/lng).
  function gate_site_geocoded(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'awaiting_deposit', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived';
    if (!applies) return gateResult('site_geocoded', 'not_applicable', 'warning', 'packet', 'office');
    var lat = safe(ctx.packet, 'site.lat', null);
    var lng = safe(ctx.packet, 'site.lng', null);
    if (typeof lat === 'number' && typeof lng === 'number') {
      return gateResult('site_geocoded', 'pass', 'warning', 'packet', 'office',
        { source: 'packet.site', ref: null, value: { lat: lat, lng: lng } },
        'Site geocoded', null, false);
    }
    return gateResult('site_geocoded', 'fail', 'warning', 'packet', 'office',
      { source: 'packet.site', ref: null, value: { lat: lat, lng: lng } },
      'Site lat/lng missing — calendar routing + weather lookups will be approximate',
      'Geocode the site address', true);
  }

  // Gate 9 — access notes present.
  function gate_access_note_present(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'accepted', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived';
    if (!applies) return gateResult('access_note_present', 'not_applicable', 'warning', 'packet', 'office');
    var snapshotAccess = safe(ctx.packet, 'revision.scope_snapshot.access_notes', null);
    var noSpecial = safe(ctx.packet, 'revision.scope_snapshot.no_special_access', null);
    var contextNote = findFact(ctx.supplemental.job_context, 'access_note');
    if (isPresent(snapshotAccess) || noSpecial === true || contextNote) {
      return gateResult('access_note_present', 'pass', 'warning', 'packet', 'office',
        { source: contextNote ? 'job_context.access_note' : 'packet.revision.scope_snapshot', ref: null, value: snapshotAccess || (contextNote && contextNote.value) || 'no_special_access' },
        'Access notes captured', null, false);
    }
    return gateResult('access_note_present', 'fail', 'warning', 'packet', 'office',
      { source: 'packet.revision.scope_snapshot.access_notes', ref: null, value: null },
      'No access notes and no explicit "no special access" — install crew may hit surprises',
      'Capture access notes (gate code / dog / parking / power)', true);
  }

  // Gate 10 — patio council/approvals (conditional applicability per Marnin).
  function gate_council_approval_received(ctx) {
    if (ctx.type !== 'patio' && ctx.type !== 'decking') {
      return gateResult('council_approval_received', 'not_applicable', 'blocker', 'compliance', 'office',
        { source: null, ref: null, value: null },
        'Council approvals apply to patio/decking only', null, false);
    }
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'awaiting_deposit', ctx.type);
    if (!applies) return gateResult('council_approval_received', 'not_applicable', 'blocker', 'compliance', 'office');

    // Marnin governance 2026-05-01: not_applicable when the patio
    // doesn't actually need council approval, NOT failed.
    var councilRequired = safe(ctx.packet, 'revision.scope_snapshot.council_required', null);
    var councilStatus = safe(ctx.packet, 'revision.scope_snapshot.council_status', null);
    if (councilRequired === false || councilStatus === 'not_required') {
      return gateResult('council_approval_received', 'not_applicable', 'blocker', 'compliance', 'office',
        { source: 'packet.revision.scope_snapshot.council_required', ref: null, value: false },
        'No council approval required for this patio (per scope snapshot)', null, false);
    }

    // Look at council_submissions or scope_snapshot.council_status.
    if (councilStatus === 'complete' || councilStatus === 'approved') {
      return gateResult('council_approval_received', 'pass', 'blocker', 'compliance', 'office',
        { source: 'packet.revision.scope_snapshot.council_status', ref: null, value: councilStatus },
        'Council approval ' + councilStatus, null, false);
    }
    var override = findOverride(ctx.supplemental.job_context, 'council_approval_received');
    if (override) {
      return gateResult('council_approval_received', 'overridden', 'blocker', 'compliance', 'office',
        { source: 'job_context.gate_override', ref: override.id || null, value: override.value },
        'Council requirement overridden (' + (override.value && override.value.reason || 'no reason') + ')',
        null, false, override);
    }
    return gateResult('council_approval_received', 'fail', 'blocker', 'compliance', 'office',
      { source: 'packet.revision.scope_snapshot.council_status', ref: null, value: councilStatus || 'pending' },
      'Council approval pending — operational stages cannot start',
      'Track council submission via sw_update_council_status', true);
  }

  // Gate 11 — deposit paid (KEY GOVERNANCE GATE).
  // Marnin: Never order materials before deposit truth, except where
  // Marnin/Shaun explicitly override (bank-confirmed deposit outside
  // Xero).
  function gate_deposit_paid(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'awaiting_deposit', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived';
    if (!applies) return gateResult('deposit_paid', 'not_applicable', 'blocker', 'finance', 'sales');

    // Truth via supplemental.deposit (xero_invoices reference match)
    var depositTruth = safe(ctx.supplemental, 'deposit', null);
    if (depositTruth && depositTruth.deposit_paid === true) {
      return gateResult('deposit_paid', 'pass', 'blocker', 'finance', 'sales',
        { source: 'supplemental.deposit', ref: null, value: depositTruth },
        'Deposit recorded in Xero', null, false);
    }

    // Override #1: payment_agreement (e.g. Chris Anderson cash deposit precedent)
    var paymentAgreement = findFact(ctx.supplemental.job_context, 'payment_agreement');
    if (paymentAgreement) {
      return gateResult('deposit_paid', 'overridden', 'blocker', 'finance', 'sales',
        { source: 'job_context.payment_agreement', ref: paymentAgreement.id || null, value: paymentAgreement.value },
        'Deposit handled via payment agreement (' + (paymentAgreement.value && paymentAgreement.value.type || 'documented') + ')',
        null, false, paymentAgreement);
    }

    // Override #2: explicit gate_override for deposit_paid (Marnin/Shaun bank-confirmed)
    var override = findOverride(ctx.supplemental.job_context, 'deposit_paid');
    if (override) {
      return gateResult('deposit_paid', 'overridden', 'blocker', 'finance', 'sales',
        { source: 'job_context.gate_override', ref: override.id || null, value: override.value },
        'Deposit override active (' + (override.value && override.value.reason || 'bank-confirmed outside Xero') + ')',
        null, false, override);
    }

    return gateResult('deposit_paid', 'fail', 'blocker', 'finance', 'sales',
      { source: 'supplemental.deposit', ref: null, value: depositTruth || null },
      'Deposit not recorded — materials cannot be ordered (Marnin/Shaun override required if bank-confirmed)',
      'Confirm deposit via Xero OR capture payment_agreement/gate_override', true);
  }

  // A purchase order is sent once it sits in the board's Sent, Confirmed or
  // Delivered column. With no po_column_of the status is read as its own column.
  var SENT_PO_COLUMNS = ['submitted', 'authorised', 'billed'];
  function poIsSent(ctx, p) {
    if (p.status === 'sent' || p.status === 'acked') return true;
    var col = ctx.poColumnOf ? ctx.poColumnOf(p.status) : p.status;
    return SENT_PO_COLUMNS.indexOf(col) >= 0;
  }

  // Gate 12 — materials ordered.
  function gate_materials_ordered(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'order_materials', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived';
    if (!applies) return gateResult('materials_ordered', 'not_applicable', 'blocker', 'materials', 'office');
    var pos = asArray(safe(ctx.packet, 'purchase_orders', []));
    if (pos.length === 0) {
      return gateResult('materials_ordered', 'fail', 'blocker', 'materials', 'office',
        { source: 'packet.purchase_orders', ref: null, value: { count: 0 } },
        'No purchase orders linked to this job',
        'Create + send material PO via sw_create_po + sw_send_po_email', false);
    }
    var sentMaterial = pos.filter(function (p) {
      return p.po_type === 'material' && poIsSent(ctx, p);
    });
    if (sentMaterial.length > 0) {
      return gateResult('materials_ordered', 'pass', 'blocker', 'materials', 'office',
        { source: 'packet.purchase_orders', ref: null, value: { sent_material_count: sentMaterial.length, total: pos.length } },
        sentMaterial.length + ' material PO(s) sent', null, false);
    }
    var anySent = pos.filter(function (p) { return poIsSent(ctx, p); });
    if (anySent.length > 0) {
      return gateResult('materials_ordered', 'pass', 'blocker', 'materials', 'office',
        { source: 'packet.purchase_orders', ref: null, value: { any_sent: anySent.length, total: pos.length, fallback: 'po_type_not_bound' } },
        anySent.length + ' PO(s) sent (po_type unbound — Cap 0.5 fallback)', null, false);
    }
    return gateResult('materials_ordered', 'fail', 'blocker', 'materials', 'office',
      { source: 'packet.purchase_orders', ref: null, value: { total: pos.length, sent: 0 } },
      pos.length + ' PO(s) on file but none sent yet',
      'Send the draft PO to the supplier via sw_send_po_email', false);
  }

  // Gate 13 — supplier logistics confirmed (delivery/pickup plan).
  function gate_supplier_logistics_confirmed(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'awaiting_supplier', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived' &&
                  ctx.currentStage !== 'complete' && ctx.currentStage !== 'invoiced';
    if (!applies) return gateResult('supplier_logistics_confirmed', 'not_applicable', 'blocker', 'logistics', 'office');
    var pos = asArray(safe(ctx.packet, 'purchase_orders', [])).filter(function (p) {
      return p.po_type === 'material' || p.po_type == null;
    });
    if (pos.length === 0) {
      return gateResult('supplier_logistics_confirmed', 'unknown', 'blocker', 'logistics', 'office',
        { source: 'packet.purchase_orders', ref: null, value: null },
        'No material POs on file to confirm logistics for', null, true);
    }
    var allConfirmed = pos.every(function (p) { return isPresent(p.confirmed_delivery_date) || p.po_type === 'subcontract'; });
    if (allConfirmed) {
      return gateResult('supplier_logistics_confirmed', 'pass', 'blocker', 'logistics', 'office',
        { source: 'packet.purchase_orders.confirmed_delivery_date', ref: null, value: pos.length },
        'All ' + pos.length + ' material PO(s) have confirmed delivery date', null, false);
    }
    var override = findOverride(ctx.supplemental.job_context, 'supplier_logistics');
    if (!override) override = findOverride(ctx.supplemental.job_context, 'supplier_logistics_confirmed');
    if (override) {
      return gateResult('supplier_logistics_confirmed', 'overridden', 'blocker', 'logistics', 'office',
        { source: 'job_context.gate_override', ref: override.id || null, value: override.value },
        'Logistics override active (' + (override.value && override.value.reason || 'verbal confirmation') + ')',
        null, false, override);
    }
    var inWindow = !!ctx.install_in_window;
    var severity = inWindow ? 'blocker' : 'warning';
    return gateResult('supplier_logistics_confirmed', 'fail', severity, 'logistics', 'office',
      { source: 'packet.purchase_orders.confirmed_delivery_date', ref: null, value: { confirmed: 0, total: pos.length } },
      'Awaiting supplier confirmation for ' + pos.length + ' PO(s)' + (inWindow ? ' — install in window' : ''),
      'Chase supplier OR apply Logistics override (Marnin/Shaun, verbal confirmation)', true);
  }

  // Gate 14 — work order issued.
  function gate_work_order_present(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'order_confirmed', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived';
    if (!applies) return gateResult('work_order_present', 'not_applicable', 'warning', 'materials', 'office');
    var inWindow = !!ctx.install_in_window;
    var severity = inWindow ? 'blocker' : 'warning';
    var wo = safe(ctx.packet, 'work_order', null);
    if (!wo) {
      return gateResult('work_order_present', 'fail', severity, 'materials', 'office',
        { source: 'packet.work_order', ref: null, value: null },
        'No work order created' + (inWindow ? ' (install in window)' : ''),
        'Open the job work order', !inWindow);
    }
    if (wo.status === 'sent' || wo.status === 'accepted' || wo.status === 'in_progress' || wo.status === 'complete' || wo.status === 'approved') {
      return gateResult('work_order_present', 'pass', severity, 'materials', 'office',
        { source: 'packet.work_order.status', ref: wo.id || null, value: wo.status },
        'Work order ' + (wo.wo_number || wo.id || '?') + ' is ' + wo.status, null, false);
    }
    if (wo.status === 'draft') {
      return gateResult('work_order_present', 'fail', severity, 'materials', 'office',
        { source: 'packet.work_order.status', ref: wo.id || null, value: 'draft' },
        'Work order still in draft', 'Open the job work order', !inWindow);
    }
    return gateResult('work_order_present', 'fail', severity, 'materials', 'office',
      { source: 'packet.work_order.status', ref: wo.id || null, value: wo.status || null },
      'Work order in unexpected status: ' + (wo.status || 'null'),
      'Review work order state', true);
  }

  // Gate 15 — crew assigned.
  function gate_crew_assigned(ctx) {
    var applies = ctx.currentStage && isStageAtOrAfter(ctx.currentStage, 'scheduled', ctx.type) &&
                  ctx.currentStage !== 'cancelled' && ctx.currentStage !== 'archived' &&
                  ctx.currentStage !== 'complete' && ctx.currentStage !== 'invoiced';
    if (!applies) return gateResult('crew_assigned', 'not_applicable', 'blocker', 'crew', 'shaun');
    var assignments = asArray(safe(ctx.supplemental, 'assignments', []));
    if (assignments.length === 0) {
      return gateResult('crew_assigned', 'fail', 'blocker', 'crew', 'shaun',
        { source: 'supplemental.assignments', ref: null, value: { count: 0 } },
        'No crew assigned to install',
        'Assign crew via sw_create_assignment', false);
    }
    return gateResult('crew_assigned', 'pass', 'blocker', 'crew', 'shaun',
      { source: 'supplemental.assignments', ref: null, value: { count: assignments.length } },
      assignments.length + ' crew member(s) assigned', null, false);
  }

  // Gate 16 — crew confirmed attendance (operator-flipped today).
  function gate_crew_confirmed_attendance(ctx) {
    var applies = ctx.currentStage === 'scheduled' || ctx.currentStage === 'in_progress';
    if (!applies) return gateResult('crew_confirmed_attendance', 'not_applicable', 'blocker', 'crew', 'shaun');
    var assignments = asArray(safe(ctx.supplemental, 'assignments', []));
    if (assignments.length === 0) {
      return gateResult('crew_confirmed_attendance', 'fail', 'blocker', 'crew', 'shaun',
        { source: 'supplemental.assignments', ref: null, value: { count: 0 } },
        'No assignments yet — cannot confirm attendance',
        'Assign crew first', false);
    }
    var confirmed = assignments.filter(function (a) { return a.confirmation_status === 'confirmed'; });
    var inWindow = !!ctx.install_in_window;
    if (confirmed.length === 0) {
      var override = findOverride(ctx.supplemental.job_context, 'crew_confirmed_attendance');
      if (override) {
        return gateResult('crew_confirmed_attendance', 'overridden', 'blocker', 'crew', 'shaun',
          { source: 'job_context.gate_override', ref: override.id || null, value: override.value },
          'Crew attendance override (' + (override.value && override.value.reason || 'operator-confirmed verbally') + ')',
          null, false, override);
      }
      var severity = inWindow ? 'blocker' : 'warning';
      return gateResult('crew_confirmed_attendance', 'fail', severity, 'crew', 'shaun',
        { source: 'supplemental.assignments.confirmation_status', ref: null, value: 'tentative_or_placeholder' },
        'No assignments confirmed (operator-flipped flag; real crew-reply parsing post-Cap-1)',
        'Confirm crew via Secure Ops or sw_update_assignment', true);
    }
    return gateResult('crew_confirmed_attendance', 'pass', 'blocker', 'crew', 'shaun',
      { source: 'supplemental.assignments.confirmation_status', ref: null, value: 'confirmed' },
      confirmed.length + ' confirmed (ops-flipped — real reply parsing is Cap 1+ AI edge)', null, false);
  }

  // Gate 17 — client confirmed install.
  // Per Marnin governance: "Client/access confirmation is usually a
  // warning, except where the job makes it necessary."
  function gate_client_confirmed_install(ctx) {
    var applies = ctx.currentStage === 'scheduled' || ctx.currentStage === 'in_progress';
    if (!applies) return gateResult('client_confirmed_install', 'not_applicable', 'warning', 'client', 'office');
    var clientConf = findFact(ctx.supplemental.job_context, 'client_confirmation');
    var accessNote = findFact(ctx.supplemental.job_context, 'access_note');
    var requiresStrict = findFact(ctx.supplemental.job_context, 'requires_strict_access');
    var inWindow = !!ctx.install_in_window;
    // Bumped to blocker when the job has a strict-access flag.
    var severity = requiresStrict ? 'blocker' : (inWindow ? 'warning' : 'informational');
    if (clientConf && accessNote) {
      return gateResult('client_confirmed_install', 'pass', severity, 'client', 'office',
        { source: 'supplemental.job_context', ref: null, value: { client_confirmation: true, access_note: true } },
        'Client confirmed + access captured', null, false);
    }
    if (clientConf && !accessNote) {
      return gateResult('client_confirmed_install', 'fail', severity, 'client', 'office',
        { source: 'supplemental.job_context', ref: null, value: { client_confirmation: true, access_note: false } },
        'Client confirmed but access note missing',
        'Capture access details (gate / dog / parking)', true);
    }
    return gateResult('client_confirmed_install', 'fail', severity, 'client', 'office',
      { source: 'supplemental.job_context', ref: null, value: null },
      'No client_confirmation row — install date not yet confirmed with client' + (requiresStrict ? ' (strict-access job — blocker)' : ' (warning)'),
      'Use ops "Client confirmed" toggle (writes client_confirmation + access_note)', true);
  }

  // Gate 18 — install started.
  function gate_install_started(ctx) {
    var applies = ctx.currentStage === 'in_progress' || ctx.currentStage === 'complete';
    if (!applies) return gateResult('install_started', 'not_applicable', 'blocker', 'install', 'crew');
    var events = asArray(safe(ctx.packet, 'events', []));
    var started = events.find(function (e) { return e.event_type === 'install.started'; });
    if (started) {
      return gateResult('install_started', 'pass', 'blocker', 'install', 'crew',
        { source: 'packet.events.install.started', ref: started.id || null, value: started.occurred_at },
        'Install started ' + started.occurred_at, null, false);
    }
    return gateResult('install_started', 'fail', 'blocker', 'install', 'crew',
      { source: 'packet.events', ref: null, value: null },
      'No install.started event — crew should tap "Start" in trade app',
      'Crew taps install start', false);
  }

  // Gate 19 — install completed.
  function gate_install_completed(ctx) {
    var applies = ctx.currentStage === 'complete' || ctx.currentStage === 'invoiced';
    if (!applies) return gateResult('install_completed', 'not_applicable', 'blocker', 'install', 'crew');
    var events = asArray(safe(ctx.packet, 'events', []));
    var completed = events.find(function (e) { return e.event_type === 'install.completed'; });
    if (completed) {
      return gateResult('install_completed', 'pass', 'blocker', 'install', 'crew',
        { source: 'packet.events.install.completed', ref: completed.id || null, value: completed.occurred_at },
        'Install completed ' + completed.occurred_at, null, false);
    }
    return gateResult('install_completed', 'fail', 'blocker', 'install', 'crew',
      { source: 'packet.events', ref: null, value: null },
      'No install.completed event — crew should tap "Complete" in trade app',
      'Crew taps install complete + client sign-off', false);
  }

  var GATES = [
    gate_status_mapped_for_pipeline,
    gate_revision_present,
    gate_revision_released,
    gate_accepted_at,
    gate_partial_acceptance_complete,
    gate_customer_mobile_present,
    gate_site_address_present,
    gate_site_geocoded,
    gate_access_note_present,
    gate_council_approval_received,
    gate_deposit_paid,
    gate_materials_ordered,
    gate_supplier_logistics_confirmed,
    gate_work_order_present,
    gate_crew_assigned,
    gate_crew_confirmed_attendance,
    gate_client_confirmed_install,
    gate_install_started,
    gate_install_completed
  ];

  // ══════════════════════════════════════════════════════════════
  // evaluateStageGates
  // ══════════════════════════════════════════════════════════════

  function evaluateStageGates(job, packet, supplemental, options) {
    options = options || {};
    supplemental = supplemental || {};
    var now = options.now ? new Date(options.now) : new Date();
    var windowDays = typeof options.install_window_business_days === 'number' ? options.install_window_business_days : 5;

    var rawStatus = safe(packet, 'job.status', null);
    var statusMapping = SM.mapStatus(rawStatus);
    var currentStage = statusMapping.normalized_status;
    var jobType = safe(packet, 'job.type', null) || (job && job.type) || null;

    // install_in_window calculation
    var scheduledDate = safe(packet, 'work_order.scheduled_date', null) ||
                        (asArray(safe(supplemental, 'assignments', []))
                          .map(function (a) { return a && a.scheduled_date; })
                          .filter(isPresent)[0] || null);
    var installWindowDays = scheduledDate ? businessDaysBetween(now.toISOString(), scheduledDate) : null;
    var installInWindow = (typeof installWindowDays === 'number' && installWindowDays >= 0 && installWindowDays <= windowDays);

    var ctx = {
      job: job || safe(packet, 'job', {}),
      type: jobType,
      currentStage: currentStage,
      packet: packet,
      supplemental: supplemental,
      poColumnOf: typeof options.po_column_of === 'function' ? options.po_column_of : null,
      install_in_window: installInWindow,
      install_window_days: installWindowDays,
      now: now
    };

    var gates = GATES.map(function (fn) { return fn(ctx); });

    // Blockers vs warnings (only those that apply, i.e. not 'not_applicable').
    var blockers = gates.filter(function (g) {
      return g.severity === 'blocker' && (g.status === 'fail');
    });
    var warnings = gates.filter(function (g) {
      return g.severity === 'warning' && (g.status === 'fail');
    });
    var overrides = gates.filter(function (g) { return g.status === 'overridden'; });

    // Next actions (top 3, ranked by stage-owner match then severity)
    var stageOwner = SM.STATUS_MAP && SM.STATUS_MAP[currentStage] && SM.STATUS_MAP[currentStage].owner;
    var nextActions = [];
    var seen = {};
    gates.forEach(function (g, idx) {
      if (g.next_action && !seen[g.gate_id]) {
        seen[g.gate_id] = true;
        nextActions.push({
          id: g.gate_id,
          label: g.next_action,
          owner: g.owner,
          severity: g.severity,
          order: idx
        });
      }
    });
    var sevRank = { blocker: 0, warning: 1, informational: 2, deferred: 3 };
    nextActions.sort(function (a, b) {
      var ao = a.owner === stageOwner ? 0 : 1;
      var bo = b.owner === stageOwner ? 0 : 1;
      if (ao !== bo) return ao - bo;
      var as = sevRank[a.severity] || 9;
      var bs = sevRank[b.severity] || 9;
      if (as !== bs) return as - bs;
      return a.order - b.order;
    });
    nextActions = nextActions.slice(0, 3).map(function (na) { delete na.order; return na; });

    // Confidence
    var confidence = 'high';
    if (!statusMapping.status_mapped_for_pipeline) confidence = 'low';
    else if (gates.filter(function (g) { return g.status === 'unknown'; }).length >= 2) confidence = 'low';
    else if (warnings.length >= 3) confidence = 'medium';
    else if (blockers.length >= 4) confidence = 'medium';

    // Legal next stages (forward + backward) per type, given current stage.
    var transitions = transitionsFor(jobType);
    var stageEntry = transitions[currentStage] || { forward: [], backward: [] };
    var legalForward = stageEntry.forward.slice();
    var legalBackward = stageEntry.backward.slice();
    // Universal: any non-terminal → cancelled is allowed.
    if (currentStage && currentStage !== 'cancelled' && currentStage !== 'archived' && currentStage !== 'lost' &&
        legalForward.indexOf('cancelled') === -1) {
      legalForward.push('cancelled');
    }

    // Stage owner / posture from canonical map.
    var stagePosture = SM.STATUS_MAP && SM.STATUS_MAP[currentStage] && SM.STATUS_MAP[currentStage].jarvis_posture;
    var stageBucket = statusMapping.frontend_bucket;
    var stageFamily = STAGE_FAMILY[currentStage] || null;

    var evidenceRefs = {};
    gates.forEach(function (g) { evidenceRefs[g.gate_id] = g.evidence; });

    return {
      job: {
        id: ctx.job.id || null,
        job_number: ctx.job.job_number || null,
        type: jobType,
        status: rawStatus
      },
      // Pipeline Visibility Guard fields (always present)
      source_status: statusMapping.source_status,
      normalized_status: statusMapping.normalized_status,
      frontend_bucket: stageBucket,
      status_mapped_for_pipeline: statusMapping.status_mapped_for_pipeline,
      // Stage context
      current_stage: currentStage,
      family: stageFamily,
      owner: stageOwner || 'system',
      jarvis_posture: stagePosture || 'read_only',
      // Gate ledger
      gates: gates,
      blockers: blockers,
      warnings: warnings,
      overrides: overrides,
      next_actions: nextActions,
      // Transitions
      legal_forward: legalForward,
      legal_backward: legalBackward,
      illegal_jumps: [], // derived on demand by canTransition
      // Window
      install_window_days: installWindowDays,
      install_in_window: installInWindow,
      // Meta
      confidence: confidence,
      evidence_refs: evidenceRefs,
      computed_at: now.toISOString()
    };
  }

  // ══════════════════════════════════════════════════════════════
  // canTransition
  // ══════════════════════════════════════════════════════════════

  function canTransition(job, from, to, override) {
    var jobType = (job && job.type) || 'patio';
    var fromMap = SM.mapStatus(from);
    var toMap = SM.mapStatus(to);
    var transitions = transitionsFor(jobType);

    var reasons = [];
    var hardBlocked = false;

    // Universal: any → cancelled is allowed (unless already terminal).
    var universalCancelAllowed = (to === 'cancelled' && from !== 'cancelled' && from !== 'archived' && from !== 'lost');

    // Type-legality check.
    var typeLegal = SM.isLegalForType(to, jobType);
    var fromTypeLegal = from == null || from === 'draft' || SM.isLegalForType(from, jobType);
    if (!typeLegal && !universalCancelAllowed && to !== 'archived') {
      reasons.push('Status "' + to + '" is not legal for type "' + jobType + '" (per-type validity from canonical map).');
      hardBlocked = true;
    }
    if (!fromTypeLegal && from !== null && from !== 'draft') {
      reasons.push('Status "' + from + '" is not legal for type "' + jobType + '" — cannot transition from an invalid stage.');
      hardBlocked = true;
    }

    // Mapping check.
    if (!toMap.status_mapped_for_pipeline) {
      reasons.push('Target status "' + to + '" is not in canonical map.');
      hardBlocked = true;
    }

    // Forward/backward classification.
    var entry = transitions[from] || { forward: [], backward: [] };
    var direction = 'illegal';
    if (entry.forward.indexOf(to) !== -1 || universalCancelAllowed) direction = 'forward';
    else if (entry.backward.indexOf(to) !== -1) direction = 'backward';
    else if (from === 'cancelled' && to === 'quoted') direction = 'forward'; // re-open
    else if ((from === 'complete' || from === 'cancelled') && to === 'archived') direction = 'forward';

    var allowed = direction !== 'illegal' && !hardBlocked;
    var requiresOverride = false;

    // cancelled → quoted (re-open) needs Marnin/Shaun override.
    if (from === 'cancelled' && to === 'quoted') {
      requiresOverride = true;
      if (!override || (override.role !== 'marnin' && override.role !== 'shaun' && override.role !== 'marnin_shaun')) {
        allowed = false;
        reasons.push('cancelled → quoted (re-open) requires Marnin/Shaun override with reason.');
      } else if (!override.reason || override.reason.length < 12) {
        allowed = false;
        reasons.push('Re-open override requires a free-text reason ≥ 12 chars.');
      }
    }

    // archived is one-way.
    if (from === 'archived') {
      hardBlocked = true;
      allowed = false;
      reasons.push('archived is a hard terminal — cannot transition out.');
    }

    // Forbidden specific jumps.
    if (from === 'complete' && (to === 'draft' || to === 'quoted' || to === 'accepted')) {
      hardBlocked = true;
      allowed = false;
      reasons.push('complete → ' + to + ' is forbidden (would corrupt finance reporting).');
    }
    if (from === 'invoiced' && to !== 'archived' && to !== 'cancelled') {
      hardBlocked = true;
      allowed = false;
      reasons.push('invoiced is a financial pseudo-terminal — reverse via Xero void, not status flip.');
    }

    // Skip > 2 stages without override (e.g. accepted → scheduled).
    var arr = SM.getStagesForType(jobType);
    var fi = arr.indexOf(from);
    var ti = arr.indexOf(to);
    if (fi !== -1 && ti !== -1 && direction === 'forward' && (ti - fi) > 2 && to !== 'cancelled' && to !== 'archived') {
      requiresOverride = true;
      if (!override) {
        allowed = false;
        reasons.push('Skip of ' + (ti - fi) + ' stages requires explicit override (Marnin/Shaun, reason category + free-text).');
      }
    }

    return {
      allowed: allowed,
      direction: direction,
      type_legal: typeLegal,
      from_type_legal: fromTypeLegal,
      gates_passed: [], // populated by caller from evaluateStageGates if desired
      gates_failed: [],
      hard_blocked: hardBlocked,
      requires_override: requiresOverride,
      override_role_required: requiresOverride ? 'marnin_shaun' : null,
      reasons: reasons
    };
  }

  // ══════════════════════════════════════════════════════════════
  // proposeNextStage
  // ══════════════════════════════════════════════════════════════

  function proposeNextStage(job, packet, supplemental) {
    var result = evaluateStageGates(job, packet, supplemental);
    var current = result.current_stage;
    var jobType = result.job.type;
    var transitions = transitionsFor(jobType);
    var entry = transitions[current] || { forward: [], backward: [] };

    if (entry.forward.length === 0) {
      return {
        suggestion: null,
        reason: 'No forward transitions available from "' + (current || 'unknown') + '"',
        blockers: [],
        owner: result.owner,
        jarvis_posture: result.jarvis_posture,
        evidence_refs: {}
      };
    }

    // Pick the first forward stage where canTransition is allowed
    // (or the first forward stage even if blocked, with blockers
    // surfaced).
    var candidates = entry.forward.filter(function (s) { return s !== 'cancelled'; });
    if (candidates.length === 0) candidates = entry.forward;

    var blockers = result.blockers.slice();
    var firstAllowed = null;
    var firstBlocked = candidates[0];
    for (var i = 0; i < candidates.length; i++) {
      var ct = canTransition({ type: jobType }, current, candidates[i]);
      if (ct.allowed && blockers.length === 0) { firstAllowed = candidates[i]; break; }
    }

    var suggestion = firstAllowed || firstBlocked;
    var reason;
    if (firstAllowed) {
      reason = 'All gates pass; ready to advance to "' + firstAllowed + '"';
    } else if (blockers.length > 0) {
      reason = 'Blocked from "' + suggestion + '" by ' + blockers.length + ' gate(s): ' +
               blockers.map(function (b) { return b.gate_id; }).join(', ');
    } else {
      reason = 'Next forward stage is "' + suggestion + '"';
    }

    return {
      suggestion: suggestion,
      reason: reason,
      blockers: blockers,
      owner: result.owner,
      jarvis_posture: result.jarvis_posture,
      evidence_refs: result.evidence_refs
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Namespace
  // ══════════════════════════════════════════════════════════════

  return {
    evaluateStageGates: evaluateStageGates,
    canTransition: canTransition,
    proposeNextStage: proposeNextStage,
    GATES: GATES,
    STAGE_FAMILY: STAGE_FAMILY,
    FENCING_TRANSITIONS: FENCING_TRANSITIONS,
    PATIO_TRANSITIONS: PATIO_TRANSITIONS,
    QUICK_QUOTE_TRANSITIONS: QUICK_QUOTE_TRANSITIONS,
    transitionsFor: transitionsFor,
    VERSION: 'cap1b-stage-gate-engine-2026-05-02'
  };
}));
