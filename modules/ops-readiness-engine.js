/* ════════════════════════════════════════════════════════════════
   ops-readiness-engine.js — T6 Cap 1 Shaun Readiness Engine (v1)

   Pure module: NO fetch, NO DOM, NO network, NO globals (besides the
   single namespace export at the bottom). Consumes a release packet
   shaped to the T1 Cap 0 contract (release-packet-contract-v1.md §9)
   plus a `supplemental` blob for data that the packet does not
   expose (assignments, job_context overrides, deposit truth).

   Returns a `ReadinessResult` object with twelve possible `state`
   values, a check ledger, ranked next_actions, and explicit
   `source_status` / `normalized_status` / `frontend_bucket` so jobs
   can NEVER disappear from the pipeline due to backend/frontend
   status drift. Unmapped statuses are surfaced in a visible
   "status_mapping_gap" diagnostic bucket — never filtered out.

   Design source:  cio/reports/2026-04-29-cap-1-readiness-engine-audit/
                   readiness-engine-audit.md
                   operations/capability-roadmap.md (Cap 1 spec)
                   release-packet-contract-v1.md §9 (T1 contract)
                   feedback_pipeline_visibility_guard.md (Marnin rule,
                   2026-05-01)

   Status: fixture-only consumer until T1 ships
   `sw_get_release_packet`. This module does not write, deploy, or
   replace the live readiness engine in `ops-api/index.ts`.
   ════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SW_READINESS_ENGINE = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // 1. Backend status -> frontend bucket map (Cap 1A)
  //
  // Cap 1A refactor: STATUS_MAP and mapStatus are now imported from
  // the canonical state-machine source (sw-state-machine.js, mirror
  // of secureworks-site/shared/job-state-machine.ts). The T6
  // readiness engine consumes the same map every other surface uses.
  //
  // Marnin's anti-disappearance rule (2026-05-01): every known
  // backend status maps to a frontend bucket. Anything unmapped
  // falls into `status_mapping_gap` with confidence='low' and a
  // next_action prompting "Update backend/frontend status map".
  // No silent filtering. Ever.
  // ══════════════════════════════════════════════════════════════

  var __SW_STATE_MACHINE = (function () {
    if (typeof module === 'object' && module.exports) {
      try { return require('./sw-state-machine.js'); }
      catch (e) { /* fall through to globals */ }
    }
    if (typeof self !== 'undefined' && self.SW_STATE_MACHINE) return self.SW_STATE_MACHINE;
    if (typeof window !== 'undefined' && window.SW_STATE_MACHINE) return window.SW_STATE_MACHINE;
    return null;
  })();

  if (!__SW_STATE_MACHINE) {
    throw new Error('[ops-readiness-engine] Canonical sw-state-machine.js not loaded — load it before ops-readiness-engine.js or require it in node tests.');
  }

  var STATUS_MAP = __SW_STATE_MACHINE.STATUS_MAP;

  function mapStatus(rawStatus) {
    var canonical = __SW_STATE_MACHINE.mapStatus(rawStatus);
    // Adapt to the prior T6 readiness shape, which exposes a flat
    // {source_status, normalized_status, frontend_bucket, mapped, reason,
    //  stage_order, human}. The canonical mapStatus already carries all
    // those fields plus extras (legacy, derived_view, owner, jarvis_posture).
    return {
      source_status: canonical.source_status,
      normalized_status: canonical.normalized_status,
      frontend_bucket: canonical.frontend_bucket,
      mapped: canonical.status_mapped_for_pipeline,
      reason: canonical.reason,
      stage_order: canonical.normalized_status ? STATUS_MAP[canonical.normalized_status].stage_order : null,
      human: canonical.human,
      legacy: canonical.legacy,
      derived_view: canonical.derived_view
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 2. The twelve readiness states
  // ══════════════════════════════════════════════════════════════

  var STATES = {
    NOT_RELEASED:           'NOT_RELEASED',
    QUOTED_WAITING_CLIENT:  'QUOTED_WAITING_CLIENT',
    DECLINED:               'DECLINED',
    ACCEPTED_NEEDS_PACKET:  'ACCEPTED_NEEDS_PACKET',
    PACKET_INCOMPLETE:      'PACKET_INCOMPLETE',
    NEEDS_MATERIAL_ORDER:   'NEEDS_MATERIAL_ORDER',
    MATERIALS_PENDING:      'MATERIALS_PENDING',
    WORK_ORDER_NEEDED:      'WORK_ORDER_NEEDED',
    READY_FOR_SHAUN_REVIEW: 'READY_FOR_SHAUN_REVIEW',
    READY_TO_SCHEDULE:      'READY_TO_SCHEDULE',
    BLOCKED:                'BLOCKED',
    DONE:                   'DONE'
  };

  var STATE_OWNER = {
    NOT_RELEASED:           'sales',
    QUOTED_WAITING_CLIENT:  'sales',
    DECLINED:               'sales',
    ACCEPTED_NEEDS_PACKET:  'office',
    PACKET_INCOMPLETE:      'office',
    NEEDS_MATERIAL_ORDER:   'office',
    MATERIALS_PENDING:      'office',
    WORK_ORDER_NEEDED:      'office',
    READY_FOR_SHAUN_REVIEW: 'shaun',
    READY_TO_SCHEDULE:      'shaun',
    BLOCKED:                'shaun',
    DONE:                   'system'
  };

  var STATE_SEVERITY = {
    NOT_RELEASED:           'info',
    QUOTED_WAITING_CLIENT:  'info',
    DECLINED:               'terminal-soft',
    ACCEPTED_NEEDS_PACKET:  'red',
    PACKET_INCOMPLETE:      'red',
    NEEDS_MATERIAL_ORDER:   'amber',
    MATERIALS_PENDING:      'amber',
    WORK_ORDER_NEEDED:      'amber',
    READY_FOR_SHAUN_REVIEW: 'amber',
    READY_TO_SCHEDULE:      'green',
    BLOCKED:                'red',
    DONE:                   'terminal'
  };

  // ══════════════════════════════════════════════════════════════
  // 3. Helpers
  // ══════════════════════════════════════════════════════════════

  function isPresent(v) {
    return v !== null && v !== undefined && v !== '';
  }

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

  // Flat AWST business-day delta. v1 does NOT account for Perth
  // public holidays (audit risk noted in capability-1-spec.md).
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

  // ══════════════════════════════════════════════════════════════
  // 4. Check evaluators — one function per check id
  //
  // Each returns a `Check` row:
  //   { id, signal_number, label, status, severity, evidence,
  //     reason, next_action, owner }
  // status   ∈ green | amber | red | unknown | deferred
  // severity ∈ blocker | warning | informational | deferred
  // ══════════════════════════════════════════════════════════════

  function chk(id, signal_number, label, status, severity, evidence, reason, next_action, owner) {
    return {
      id: id,
      signal_number: signal_number,
      label: label,
      status: status,
      severity: severity,
      evidence: evidence || { source: null, ref: null, value: null },
      reason: reason || '',
      next_action: next_action || null,
      owner: owner || 'office'
    };
  }

  function checkRevisionPresent(packet) {
    var rev = safe(packet, 'revision', null);
    if (rev && isPresent(rev.id)) {
      return chk('revision_present', null, 'Quote revision exists', 'green', 'blocker',
        { source: 'packet.revision', ref: rev.id, value: rev.revision_number },
        'Quote revision #' + (rev.revision_number || '?') + ' present', null, 'sales');
    }
    return chk('revision_present', null, 'Quote revision exists', 'red', 'blocker',
      { source: 'packet.revision', ref: null, value: null },
      'No quote_revisions row for this job', 'Send quote via Patio/Fence/Quick Quote tool', 'sales');
  }

  function checkRevisionReleased(packet) {
    var sentAt = safe(packet, 'revision.sent_at', null);
    if (isPresent(sentAt)) {
      return chk('revision_released', null, 'Quote sent to client', 'green', 'blocker',
        { source: 'packet.revision.sent_at', ref: null, value: sentAt },
        'Sent ' + sentAt, null, 'sales');
    }
    return chk('revision_released', null, 'Quote sent to client', 'red', 'blocker',
      { source: 'packet.revision.sent_at', ref: null, value: null },
      'Revision is staged but not sent (sent_at IS NULL)', 'Trigger send from staged revision', 'sales');
  }

  function checkAccepted(packet) {
    var acceptedAt = safe(packet, 'document.accepted_at', null);
    var declinedAt = safe(packet, 'document.declined_at', null);
    if (isPresent(declinedAt)) {
      return chk('accepted', null, 'Client decision', 'red', 'informational',
        { source: 'packet.document.declined_at', ref: null, value: declinedAt },
        'Declined ' + declinedAt, 'Move job to lost/cancelled or open variation conversation', 'sales');
    }
    if (isPresent(acceptedAt)) {
      return chk('accepted', null, 'Client decision', 'green', 'informational',
        { source: 'packet.document.accepted_at', ref: null, value: acceptedAt },
        'Accepted ' + acceptedAt, null, 'sales');
    }
    return chk('accepted', null, 'Client decision', 'amber', 'informational',
      { source: 'packet.document', ref: null, value: null },
      'Awaiting client response', 'Sales follow-up via Secure Sale Send lane', 'sales');
  }

  function checkCustomerMobile(packet) {
    var mobile = safe(packet, 'customer.mobile', null);
    if (isPresent(mobile)) {
      return chk('customer_mobile_present', null, 'Customer mobile on file', 'green', 'blocker',
        { source: 'packet.customer.mobile', ref: null, value: mobile },
        'Mobile present', null, 'office');
    }
    return chk('customer_mobile_present', null, 'Customer mobile on file', 'red', 'blocker',
      { source: 'packet.customer.mobile', ref: null, value: null },
      'No mobile — install reminders + payment links cannot be sent',
      'Add customer mobile via sw_update_contact', 'office');
  }

  function checkSiteAddress(packet) {
    var addr = safe(packet, 'site.address', null);
    var suburb = safe(packet, 'site.suburb', null);
    if (isPresent(addr) && isPresent(suburb)) {
      return chk('site_address_present', null, 'Site address + suburb', 'green', 'blocker',
        { source: 'packet.site', ref: null, value: { address: addr, suburb: suburb } },
        'Address present', null, 'office');
    }
    return chk('site_address_present', null, 'Site address + suburb', 'red', 'blocker',
      { source: 'packet.site', ref: null, value: { address: addr, suburb: suburb } },
      'Site address or suburb missing', 'Confirm site address with client', 'office');
  }

  function checkSiteGeocoded(packet) {
    var lat = safe(packet, 'site.lat', null);
    var lng = safe(packet, 'site.lng', null);
    if (typeof lat === 'number' && typeof lng === 'number') {
      return chk('site_geocoded', null, 'Site geocoded', 'green', 'warning',
        { source: 'packet.site', ref: null, value: { lat: lat, lng: lng } },
        'Lat/lng present', null, 'office');
    }
    return chk('site_geocoded', null, 'Site geocoded', 'amber', 'warning',
      { source: 'packet.site', ref: null, value: { lat: lat, lng: lng } },
      'Lat/lng missing — calendar routing/weather lookups will be approximate',
      'Geocode the site address', 'office');
  }

  function checkAccessNotes(packet) {
    var access = safe(packet, 'revision.scope_snapshot.access_notes', null);
    if (isPresent(access)) {
      return chk('access_notes_present', null, 'Site access notes captured', 'green', 'warning',
        { source: 'packet.revision.scope_snapshot.access_notes', ref: null, value: access },
        'Access notes captured', null, 'office');
    }
    var explicit = safe(packet, 'revision.scope_snapshot.no_special_access', null);
    if (explicit === true) {
      return chk('access_notes_present', null, 'Site access notes captured', 'green', 'warning',
        { source: 'packet.revision.scope_snapshot.no_special_access', ref: null, value: true },
        'Marked "no special access"', null, 'office');
    }
    return chk('access_notes_present', null, 'Site access notes captured', 'amber', 'warning',
      { source: 'packet.revision.scope_snapshot', ref: null, value: null },
      'No access notes and no explicit "no special access"',
      'Confirm access (gate code / dog / parking / power / dropoff) with client', 'office');
  }

  function checkMaterialsOrdered(packet) {
    var pos = asArray(safe(packet, 'purchase_orders', []));
    if (pos.length === 0) {
      return chk('materials_ordered', 1, 'Materials ordered (PO sent)', 'red', 'blocker',
        { source: 'packet.purchase_orders', ref: null, value: { count: 0 } },
        'No purchase orders linked to this job',
        'Create + send material PO via sw_create_po + sw_send_po_email', 'office');
    }
    var sentMaterial = pos.filter(function (p) {
      var typedMaterial = (p.po_type === 'material');
      var sentStatus = (p.status === 'submitted' || p.status === 'authorised' || p.status === 'sent');
      return typedMaterial && sentStatus;
    });
    if (sentMaterial.length > 0) {
      return chk('materials_ordered', 1, 'Materials ordered (PO sent)', 'green', 'blocker',
        { source: 'packet.purchase_orders', ref: null, value: { sent_material_count: sentMaterial.length, total: pos.length } },
        sentMaterial.length + ' material PO(s) sent', null, 'office');
    }
    var anySent = pos.filter(function (p) {
      return p.status === 'submitted' || p.status === 'authorised' || p.status === 'sent';
    });
    if (anySent.length > 0) {
      return chk('materials_ordered', 1, 'Materials ordered (PO sent)', 'amber', 'blocker',
        { source: 'packet.purchase_orders', ref: null, value: { any_sent: anySent.length, total: pos.length, fallback: true } },
        anySent.length + ' PO(s) sent but po_type not bound — type-unknown fallback', null, 'office');
    }
    return chk('materials_ordered', 1, 'Materials ordered (PO sent)', 'red', 'blocker',
      { source: 'packet.purchase_orders', ref: null, value: { total: pos.length, sent: 0 } },
      pos.length + ' PO(s) on file but none sent yet',
      'Send the draft PO to the supplier via sw_send_po_email', 'office');
  }

  function checkMaterialsPaid() {
    return chk('materials_paid', 2, 'Materials paid (Cap 4)', 'deferred', 'deferred',
      { source: null, ref: null, value: null },
      'Deferred — supplier AP/PO payment join belongs to Cap 4 (Supplier Follow-up)', null, 'system');
  }

  function checkSupplierLogistics(packet, supplemental, options) {
    var pos = asArray(safe(packet, 'purchase_orders', [])).filter(function (p) {
      return p.po_type === 'material' || p.po_type == null; // include unbound during fallback
    });
    if (pos.length === 0) {
      return chk('supplier_logistics_confirmed', 3, 'Supplier logistics confirmed', 'unknown', 'blocker',
        { source: 'packet.purchase_orders', ref: null, value: null },
        'No material POs to confirm logistics for', null, 'office');
    }
    var allConfirmed = pos.every(function (p) {
      return isPresent(p.confirmed_delivery_date);
    });
    if (allConfirmed) {
      return chk('supplier_logistics_confirmed', 3, 'Supplier logistics confirmed', 'green', 'blocker',
        { source: 'packet.purchase_orders.confirmed_delivery_date', ref: null, value: pos.length },
        'All ' + pos.length + ' material PO(s) have confirmed delivery date', null, 'office');
    }
    // Look for manual override in supplemental.job_context
    var ctx = asArray(safe(supplemental, 'job_context', []));
    var override = ctx.find(function (c) {
      return (c.kind === 'readiness_override') &&
             ((c.value && c.value.signal === 'supplier_logistics') ||
              (c.value && c.value.signal === 'logistics'));
    });
    if (override) {
      return chk('supplier_logistics_confirmed', 3, 'Supplier logistics confirmed', 'green', 'blocker',
        { source: 'job_context.readiness_override', ref: override.id || null, value: override.value },
        'Manually confirmed via readiness_override', null, 'office');
    }
    var inWindow = options && options.install_in_window === true;
    var status = inWindow ? 'red' : 'amber';
    return chk('supplier_logistics_confirmed', 3, 'Supplier logistics confirmed', status, 'blocker',
      { source: 'packet.purchase_orders.confirmed_delivery_date', ref: null, value: { confirmed: 0, total: pos.length } },
      'Awaiting supplier ack for ' + pos.length + ' PO(s)' + (inWindow ? ' — install in window' : ''),
      'Chase supplier or apply manual "Logistics override" if confirmed verbally', 'office');
  }

  function checkWorkOrder(packet, options) {
    var wo = safe(packet, 'work_order', null);
    var inWindow = options && options.install_in_window === true;
    if (!wo) {
      return chk('work_order_present', null, 'Work order issued to crew', inWindow ? 'red' : 'amber',
        inWindow ? 'blocker' : 'warning',
        { source: 'packet.work_order', ref: null, value: null },
        'No work order created' + (inWindow ? ' (install in window)' : ''),
        'Create + send work order via sw_create_work_order + sw_send_work_order', 'office');
    }
    if (wo.status === 'sent' || wo.status === 'accepted' || wo.status === 'in_progress') {
      return chk('work_order_present', null, 'Work order issued to crew', 'green',
        inWindow ? 'blocker' : 'warning',
        { source: 'packet.work_order.status', ref: wo.id || null, value: wo.status },
        'Work order ' + (wo.wo_number || wo.id || '?') + ' is ' + wo.status, null, 'office');
    }
    if (wo.status === 'draft') {
      return chk('work_order_present', null, 'Work order issued to crew', 'amber',
        inWindow ? 'blocker' : 'warning',
        { source: 'packet.work_order.status', ref: wo.id || null, value: 'draft' },
        'Work order is still draft', 'Send work order to crew', 'office');
    }
    if (wo.status === 'complete') {
      return chk('work_order_present', null, 'Work order issued to crew', 'green',
        'informational',
        { source: 'packet.work_order.status', ref: wo.id || null, value: 'complete' },
        'Work order complete', null, 'system');
    }
    return chk('work_order_present', null, 'Work order issued to crew', 'amber', 'warning',
      { source: 'packet.work_order.status', ref: wo.id || null, value: wo.status || null },
      'Work order in unexpected status: ' + (wo.status || 'null'),
      'Review work order state', 'office');
  }

  function checkCrewAssigned(supplemental) {
    var assignments = asArray(safe(supplemental, 'assignments', []));
    if (assignments.length === 0) {
      return chk('crew_assigned', 4, 'Crew assigned', 'red', 'blocker',
        { source: 'supplemental.assignments', ref: null, value: { count: 0 } },
        'No crew assigned', 'Assign crew via sw_create_assignment', 'office');
    }
    return chk('crew_assigned', 4, 'Crew assigned', 'green', 'blocker',
      { source: 'supplemental.assignments', ref: null, value: { count: assignments.length } },
      assignments.length + ' crew member(s) assigned', null, 'office');
  }

  function checkCrewConfirmed(supplemental) {
    var assignments = asArray(safe(supplemental, 'assignments', []));
    if (assignments.length === 0) {
      // Precondition unmet AND signal is required — surface as red
      // blocker so it never disappears from the ledger.
      return chk('crew_confirmed_attendance', 5, 'Crew confirmed attendance', 'red', 'blocker',
        { source: 'supplemental.assignments', ref: null, value: { count: 0 } },
        'No assignments yet — cannot confirm attendance',
        'Assign crew first, then confirm attendance', 'office');
    }
    var confirmed = assignments.filter(function (a) { return a.confirmation_status === 'confirmed'; });
    if (confirmed.length === 0) {
      return chk('crew_confirmed_attendance', 5, 'Crew confirmed attendance (ops-confirmed)', 'red', 'blocker',
        { source: 'supplemental.assignments.confirmation_status', ref: null, value: 'tentative_or_placeholder' },
        'No assignments marked confirmed',
        'Confirm crew via Secure Ops or sw_update_assignment', 'office');
    }
    return chk('crew_confirmed_attendance', 5, 'Crew confirmed attendance (ops-confirmed)', 'green', 'blocker',
      { source: 'supplemental.assignments.confirmation_status', ref: null, value: 'confirmed' },
      confirmed.length + ' confirmed (ops-flipped — true crew-reply parsing is Cap 1 AI edge)', null, 'office');
  }

  function checkClientConfirmed(supplemental) {
    var ctx = asArray(safe(supplemental, 'job_context', []));
    var clientConf = ctx.find(function (c) { return c.kind === 'client_confirmation'; });
    var accessNote = ctx.find(function (c) { return c.kind === 'access_note'; });
    if (clientConf && accessNote) {
      return chk('client_confirmed', 6, 'Client confirmed install', 'green', 'blocker',
        { source: 'supplemental.job_context', ref: null, value: { client_confirmation: clientConf.id || true, access_note: accessNote.id || true } },
        'Client confirmed + access captured', null, 'office');
    }
    if (clientConf && !accessNote) {
      return chk('client_confirmed', 6, 'Client confirmed install', 'amber', 'blocker',
        { source: 'supplemental.job_context', ref: null, value: { client_confirmation: true, access_note: false } },
        'Client confirmed but access note missing',
        'Capture access details (gate / dog / parking)', 'office');
    }
    return chk('client_confirmed', 6, 'Client confirmed install', 'red', 'blocker',
      { source: 'supplemental.job_context', ref: null, value: null },
      'No client_confirmation row in job_context',
      'Use ops "Client confirmed" toggle (writes client_confirmation + access_note)', 'office');
  }

  function checkWeatherOk() {
    return chk('weather_ok', 7, 'Weather OK (BOM 3-day)', 'deferred', 'deferred',
      { source: null, ref: null, value: null },
      'Deferred — informational only per Cap 1 spec', null, 'system');
  }

  function checkDepositReceived(supplemental) {
    var deposit = safe(supplemental, 'deposit', null);
    if (deposit == null) {
      return chk('deposit_received', null, 'Deposit received', 'unknown', 'warning',
        { source: 'supplemental.deposit', ref: null, value: null },
        'Deposit truth not loaded', 'Wire sw_get_payment_truth post-Cap-0', 'office');
    }
    if (deposit.deposit_paid === true) {
      return chk('deposit_received', null, 'Deposit received', 'green', 'warning',
        { source: 'supplemental.deposit', ref: null, value: deposit },
        'Deposit recorded', null, 'office');
    }
    return chk('deposit_received', null, 'Deposit received', 'red', 'warning',
      { source: 'supplemental.deposit', ref: null, value: deposit },
      'Deposit not recorded',
      'Confirm deposit via Xero or capture payment_agreement override', 'office');
  }

  function checkStatusMapping(packet, statusMapping) {
    var rawStatus = safe(packet, 'job.status', null);
    if (statusMapping.mapped) {
      return chk('status_mapped_for_pipeline', null, 'Pipeline status mapping', 'green', 'warning',
        { source: 'packet.job.status', ref: null, value: rawStatus },
        'Mapped to bucket "' + statusMapping.frontend_bucket + '"', null, 'system');
    }
    if (statusMapping.reason === 'missing') {
      return chk('status_mapped_for_pipeline', null, 'Pipeline status mapping', 'red', 'blocker',
        { source: 'packet.job.status', ref: null, value: null },
        'jobs.status is null/empty — job will be invisible without explicit fallback bucket',
        'Update backend/frontend status map (jobs.status missing)', 'system');
    }
    return chk('status_mapped_for_pipeline', null, 'Pipeline status mapping', 'red', 'blocker',
      { source: 'packet.job.status', ref: null, value: rawStatus },
      'Unknown status "' + rawStatus + '" — falling back to status_mapping_gap bucket so job stays visible',
      'Update backend/frontend status map: add "' + rawStatus + '" -> bucket', 'system');
  }

  // ══════════════════════════════════════════════════════════════
  // 5. State derivation
  // ══════════════════════════════════════════════════════════════

  function pickState(packet, supplemental, options, contributingReds) {
    // Terminal first
    var status = safe(packet, 'job.status', null);
    var declinedAt = safe(packet, 'document.declined_at', null);
    if (isPresent(declinedAt) && status !== 'cancelled' && status !== 'archived' && status !== 'lost') {
      return STATES.DECLINED;
    }
    if (status === 'complete' || status === 'archived' || status === 'cancelled' || status === 'lost') {
      return STATES.DONE;
    }

    // Revision lifecycle
    var rev = safe(packet, 'revision', null);
    if (!rev || !isPresent(rev.id)) return STATES.NOT_RELEASED;
    var sentAt = safe(packet, 'revision.sent_at', null);
    var staged = safe(packet, 'staged', null);
    if (!isPresent(sentAt) || staged === true) return STATES.NOT_RELEASED;

    var acceptedAt = safe(packet, 'document.accepted_at', null);
    if (!isPresent(acceptedAt)) return STATES.QUOTED_WAITING_CLIENT;

    // Hard packet completeness gate
    var packetIncomplete = (
      !isPresent(safe(packet, 'customer.mobile', null)) ||
      !isPresent(safe(packet, 'site.address', null)) ||
      !isPresent(safe(packet, 'site.suburb', null))
    );
    if (packetIncomplete) return STATES.PACKET_INCOMPLETE;

    var pos = asArray(safe(packet, 'purchase_orders', []));
    var wo = safe(packet, 'work_order', null);
    var hasMaterialPo = pos.some(function (p) {
      return (p.po_type === 'material' || p.po_type == null) &&
             (p.status === 'submitted' || p.status === 'authorised' || p.status === 'sent');
    });
    var allLogisticsConfirmed = pos.length > 0 && pos.every(function (p) {
      return (p.po_type !== 'material' && p.po_type != null) ? true : isPresent(p.confirmed_delivery_date);
    });
    var hasUsableWO = wo && (wo.status === 'sent' || wo.status === 'accepted' || wo.status === 'in_progress');
    var inWindow = options && options.install_in_window === true;

    // Branch by upstream completeness
    if (pos.length === 0 && !wo) return STATES.ACCEPTED_NEEDS_PACKET;
    if (!hasMaterialPo) return STATES.NEEDS_MATERIAL_ORDER;
    if (!allLogisticsConfirmed) return STATES.MATERIALS_PENDING;
    if (!hasUsableWO) return STATES.WORK_ORDER_NEEDED;

    // Install-window gate. Only here do contributing-red counts decide.
    var redCount = contributingReds.length;
    if (inWindow) {
      if (redCount >= 3) return STATES.BLOCKED;
      if (redCount >= 1) return STATES.READY_FOR_SHAUN_REVIEW;
      return STATES.READY_TO_SCHEDULE;
    }
    return STATES.READY_FOR_SHAUN_REVIEW;
  }

  // ══════════════════════════════════════════════════════════════
  // 6. Public: evaluateReadiness
  // ══════════════════════════════════════════════════════════════

  function evaluateReadiness(packet, supplemental, options) {
    options = options || {};
    supplemental = supplemental || {};
    var now = options.now ? new Date(options.now) : new Date();

    // Pipeline-visibility guard: status map first, before anything
    // else, so jobs are NEVER dropped even if every other field is
    // junk.
    var rawStatus = safe(packet, 'job.status', null);
    var statusMapping = mapStatus(rawStatus);

    // Install window calculation (flat AWST business days, v1)
    var scheduledDate = safe(packet, 'work_order.scheduled_date', null) ||
                        safe(packet, 'job.scheduled_date', null) ||
                        (asArray(safe(supplemental, 'assignments', [])).map(function (a) { return a.scheduled_date; }).filter(isPresent)[0] || null);
    var installWindowDays = scheduledDate ? businessDaysBetween(now.toISOString(), scheduledDate) : null;
    var inWindow = (typeof installWindowDays === 'number' && installWindowDays >= 0 && installWindowDays <= 5);

    var rtOptions = { install_in_window: inWindow };

    // Build the check ledger
    var checks = [
      checkRevisionPresent(packet),
      checkRevisionReleased(packet),
      checkAccepted(packet),
      checkCustomerMobile(packet),
      checkSiteAddress(packet),
      checkSiteGeocoded(packet),
      checkAccessNotes(packet),
      checkMaterialsOrdered(packet),
      checkMaterialsPaid(),
      checkSupplierLogistics(packet, supplemental, rtOptions),
      checkWorkOrder(packet, rtOptions),
      checkCrewAssigned(supplemental),
      checkCrewConfirmed(supplemental),
      checkClientConfirmed(supplemental),
      checkWeatherOk(),
      checkDepositReceived(supplemental),
      checkStatusMapping(packet, statusMapping)
    ];

    // The Cap 1 spec contributing-red set: signals 1, 3, 4, 5, 6
    // (signal 2 deferred to Cap 4; signal 7 informational only).
    var contributingIds = ['materials_ordered', 'supplier_logistics_confirmed', 'crew_assigned', 'crew_confirmed_attendance', 'client_confirmed'];
    var contributingReds = checks.filter(function (c) {
      return contributingIds.indexOf(c.id) !== -1 && c.status === 'red' && c.severity === 'blocker';
    });

    // Pick the readiness state. Status mapping can override to a
    // diagnostic state, but never hides the job.
    var state;
    if (!statusMapping.mapped) {
      // Surface but keep visible. We still compute the lifecycle
      // state for downstream logic; the diagnostic flag rides on
      // the result.
      state = pickState(packet, supplemental, rtOptions, contributingReds);
    } else {
      state = pickState(packet, supplemental, rtOptions, contributingReds);
    }

    var blockers = checks.filter(function (c) {
      return c.severity === 'blocker' && (c.status === 'red' || c.status === 'amber') && c.id !== 'status_mapped_for_pipeline';
    });
    var warnings = checks.filter(function (c) {
      return (c.severity === 'warning' && (c.status === 'red' || c.status === 'amber'));
    });
    if (!statusMapping.mapped) {
      blockers.push(checks.find(function (c) { return c.id === 'status_mapped_for_pipeline'; }));
    }

    // Rank next actions:
    //   1. owner-of-state first (sales actions surface for sales states,
    //      office actions for office states, etc.). Keeps the top
    //      action aligned with whoever owns the lifecycle stage.
    //   2. blocker > warning > informational > deferred.
    //   3. original check order as a tie-breaker.
    var stateOwner = STATE_OWNER[state] || 'system';
    var nextActions = [];
    var seen = {};
    checks.forEach(function (c, idx) {
      if (c.next_action && !seen[c.id]) {
        seen[c.id] = true;
        nextActions.push({
          id: c.id,
          label: c.next_action,
          owner: c.owner,
          severity: c.severity,
          order: idx,
          mcp_tool: null,
          args_hint: null
        });
      }
    });
    nextActions.sort(function (a, b) {
      var ownerRank = function (o) { return o === stateOwner ? 0 : 1; };
      var sevRank   = { blocker: 0, warning: 1, informational: 2, deferred: 3 };
      var ao = ownerRank(a.owner), bo = ownerRank(b.owner);
      if (ao !== bo) return ao - bo;
      var as = sevRank[a.severity] || 9, bs = sevRank[b.severity] || 9;
      if (as !== bs) return as - bs;
      return a.order - b.order;
    });
    nextActions = nextActions.slice(0, 3).map(function (na) {
      delete na.order;
      return na;
    });

    // Confidence scoring (low cases evaluated before medium so the
    // explicit ambiguity signals win over generic warning counts).
    var confidence = 'high';
    var stagedAmbiguous = (
      state === STATES.NOT_RELEASED &&
      safe(packet, 'revision', null) &&
      !safe(packet, 'revision.sent_at', null) &&
      !safe(packet, 'document.declined_at', null)
    );
    if (!statusMapping.mapped) {
      confidence = 'low';
    } else if (stagedAmbiguous) {
      confidence = 'low';
    } else if (warnings.length >= 3) {
      confidence = 'medium';
    } else if (blockers.length >= 4) {
      // Many blockers → still high-confidence about what's broken,
      // but downgrade slightly since it's a fragile state.
      confidence = 'medium';
    }

    var evidenceRefs = {};
    checks.forEach(function (c) { evidenceRefs[c.id] = c.evidence; });

    return {
      job: {
        id: safe(packet, 'job.id', null),
        job_number: safe(packet, 'job.job_number', null),
        type: safe(packet, 'job.type', null),
        status: rawStatus
      },
      state: state,
      severity: STATE_SEVERITY[state] || 'info',
      owner: STATE_OWNER[state] || 'system',
      source_status: statusMapping.source_status,
      normalized_status: statusMapping.normalized_status,
      frontend_bucket: statusMapping.frontend_bucket,
      status_mapping: statusMapping,
      blockers: blockers,
      warnings: warnings,
      next_actions: nextActions,
      checks: checks,
      evidence_refs: evidenceRefs,
      install_window_days: installWindowDays,
      install_in_window: inWindow,
      confidence: confidence,
      computed_at: now.toISOString()
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 7. Frontend bucket -> readiness column key (for the preview
  //    board layout). Each bucket folds into a column id so
  //    diagnostic states stay visible.
  // ══════════════════════════════════════════════════════════════

  var COLUMN_FOR_STATE = {
    NOT_RELEASED:           'col_quote',
    QUOTED_WAITING_CLIENT:  'col_waiting_client',
    DECLINED:               'col_declined',
    ACCEPTED_NEEDS_PACKET:  'col_packet_incomplete',
    PACKET_INCOMPLETE:      'col_packet_incomplete',
    NEEDS_MATERIAL_ORDER:   'col_materials',
    MATERIALS_PENDING:      'col_materials',
    WORK_ORDER_NEEDED:      'col_work_order',
    READY_FOR_SHAUN_REVIEW: 'col_shaun_review',
    READY_TO_SCHEDULE:      'col_ready',
    BLOCKED:                'col_blocked',
    DONE:                   'col_done'
  };

  function columnFor(result) {
    if (!result || !result.state) return 'col_status_mapping_gap';
    if (result.frontend_bucket === 'status_mapping_gap') return 'col_status_mapping_gap';
    return COLUMN_FOR_STATE[result.state] || 'col_status_mapping_gap';
  }

  return {
    evaluateReadiness: evaluateReadiness,
    mapStatus: mapStatus,
    columnFor: columnFor,
    STATUS_MAP: STATUS_MAP,
    STATES: STATES,
    STATE_OWNER: STATE_OWNER,
    STATE_SEVERITY: STATE_SEVERITY,
    COLUMN_FOR_STATE: COLUMN_FOR_STATE,
    VERSION: 't6-cap1-readiness-v1-2026-05-01'
  };
}));
