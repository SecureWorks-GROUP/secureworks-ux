/* ════════════════════════════════════════════════════════════════
   sw-state-machine.js — Cap 1 canonical state machine (browser mirror)

   ⚠️ MIRROR OF: secureworks-site/shared/job-state-machine.ts ⚠️
   DO NOT EDIT INDEPENDENTLY. Any change to STATUS_MAP, FENCING_STAGES,
   PATIO_STAGES, DECKING_STAGES, QUICK_QUOTE_STAGES, or the helper
   functions MUST be made in the canonical TS source first, then
   mirrored here. Cap 1B will land an automated drift test.

   Browser shape: IIFE that exports `window.SW_STATE_MACHINE` with
   the same data + functions as the TS source.
   Node-compat: also exports via `module.exports` so tooling/tests
   can `require()` it.

   Authority: secureworks-docs/operations/cap-1-stage-gate-contract.md
   ════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SW_STATE_MACHINE = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS_MAP = {
    draft:               { bucket: 'quote',          stage_order: 1,  human: 'Draft',                 color: '#8FA4B2', owner: 'sales',  jarvis_posture: 'read_only' },
    quoted:              { bucket: 'waiting_client', stage_order: 2,  human: 'Quoted',                color: '#9B59B6', owner: 'sales',  jarvis_posture: 'suggest' },
    partially_accepted:  { bucket: 'waiting_client', stage_order: 3,  human: 'Partially Accepted',    color: '#9B59B6', owner: 'sales',  jarvis_posture: 'suggest' },
    accepted:            { bucket: 'packet_prep',    stage_order: 4,  human: 'Accepted',              color: '#3498DB', owner: 'sales',  jarvis_posture: 'suggest' },
    awaiting_deposit:    { bucket: 'packet_prep',    stage_order: 5,  human: 'Awaiting Deposit',      color: '#F39C12', owner: 'sales',  jarvis_posture: 'suggest' },
    deposit:             { bucket: 'packet_prep',    stage_order: 5,  human: 'Deposit',               color: '#F39C12', owner: 'sales',  jarvis_posture: 'suggest', legacy: true },
    approvals:           { bucket: 'packet_prep',    stage_order: 6,  human: 'Approvals',             color: '#1ABC9C', owner: 'office', jarvis_posture: 'suggest' },
    order_materials:     { bucket: 'materials',      stage_order: 7,  human: 'Order Materials',       color: '#E67E22', owner: 'office', jarvis_posture: 'suggest' },
    processing:          { bucket: 'materials',      stage_order: 7,  human: 'Processing',            color: '#E74C3C', owner: 'office', jarvis_posture: 'suggest', legacy: true },
    awaiting_supplier:   { bucket: 'materials',      stage_order: 8,  human: 'Awaiting Supplier',     color: '#95A5A6', owner: 'office', jarvis_posture: 'suggest' },
    order_confirmed:     { bucket: 'materials',      stage_order: 9,  human: 'Order Confirmed',       color: '#1ABC9C', owner: 'office', jarvis_posture: 'suggest' },
    schedule_install:    { bucket: 'ready',          stage_order: 10, human: 'Schedule Install',      color: '#3498DB', owner: 'shaun',  jarvis_posture: 'suggest', derived_view: true },
    scheduled:           { bucket: 'ready',          stage_order: 11, human: 'Scheduled',             color: '#E67E22', owner: 'shaun',  jarvis_posture: 'suggest' },
    in_progress:         { bucket: 'in_progress',    stage_order: 12, human: 'In Progress',           color: '#F15A29', owner: 'crew',   jarvis_posture: 'read_only' },
    rectification:       { bucket: 'in_progress',    stage_order: 13, human: 'Rectification',        color: '#E74C3C', owner: 'shaun',  jarvis_posture: 'read_only', legacy: true },
    complete:            { bucket: 'done',           stage_order: 14, human: 'Complete',              color: '#27AE60', owner: 'system', jarvis_posture: 'suggest' },
    final_payment:       { bucket: 'done',           stage_order: 15, human: 'Final Payment',         color: '#F39C12', owner: 'office', jarvis_posture: 'suggest', derived_view: true },
    invoiced:            { bucket: 'done',           stage_order: 16, human: 'Invoiced',              color: '#7F8C8D', owner: 'system', jarvis_posture: 'read_only' },
    get_review:          { bucket: 'done',           stage_order: 17, human: 'Get Review',            color: '#9B59B6', owner: 'sales',  jarvis_posture: 'suggest', derived_view: true },
    cancelled:           { bucket: 'terminal',       stage_order: 98, human: 'Cancelled',             color: '#E74C3C', owner: 'sales',  jarvis_posture: 'read_only' },
    lost:                { bucket: 'terminal',       stage_order: 99, human: 'Lost',                  color: '#95A5A6', owner: 'sales',  jarvis_posture: 'read_only', legacy: true },
    archived:            { bucket: 'terminal',       stage_order: 99, human: 'Archived',              color: '#7F8C8D', owner: 'system', jarvis_posture: 'read_only' }
  };

  var STATUS_LABELS = {};
  var STATUS_COLORS = {};
  Object.keys(STATUS_MAP).forEach(function (k) {
    STATUS_LABELS[k] = STATUS_MAP[k].human;
    STATUS_COLORS[k] = STATUS_MAP[k].color;
  });

  var FENCING_STAGES = [
    'draft', 'quoted', 'partially_accepted', 'accepted', 'awaiting_deposit',
    'order_materials', 'awaiting_supplier', 'order_confirmed',
    'scheduled', 'in_progress', 'complete', 'invoiced',
    'cancelled', 'archived'
  ];

  var PATIO_STAGES = [
    'draft', 'quoted', 'accepted', 'awaiting_deposit', 'approvals',
    'order_materials', 'awaiting_supplier', 'order_confirmed',
    'scheduled', 'in_progress', 'complete', 'invoiced',
    'cancelled', 'archived'
  ];

  var DECKING_STAGES = PATIO_STAGES.slice();

  var QUICK_QUOTE_STAGES = ['draft', 'quoted', 'accepted', 'cancelled', 'archived'];

  var MAKESAFE_STAGES = ['accepted', 'scheduled', 'in_progress', 'complete', 'invoiced'];

  // Insurance repair jobs. These are jobs.status values, NOT the nine Repairs
  // board stages — the board stages live in jobs.metadata.repair_stage and are
  // written only by update_repair_stage. Without this case a repair job fell
  // through to PATIO_STAGES, which offered it approvals/deposit/get_review: a
  // patio money ladder on an insurance work order. Repair travels the same spine
  // as make-safe (both are minted at 'accepted' off an SES work order), plus
  // 'processing', where every live repair card currently sits.
  var REPAIR_STAGES = [
    'accepted', 'processing', 'scheduled', 'in_progress',
    'complete', 'invoiced', 'cancelled', 'archived'
  ];

  function isLegalForType(status, type) {
    var arr = getStagesForType(type);
    return arr.indexOf(status) !== -1;
  }

  function getStagesForType(type) {
    switch (type) {
      case 'fencing':     return FENCING_STAGES;
      case 'patio':       return PATIO_STAGES;
      case 'decking':     return DECKING_STAGES;
      case 'quick_quote': return QUICK_QUOTE_STAGES;
      case 'makesafe':    return MAKESAFE_STAGES;
      case 'repair':      return REPAIR_STAGES;
      default:            return PATIO_STAGES;
    }
  }

  var ALL_CANONICAL_STATUSES = Object.keys(STATUS_MAP);
  var ACTIVE_STATUSES = ALL_CANONICAL_STATUSES.filter(function (s) {
    return STATUS_MAP[s].bucket !== 'terminal';
  });

  function mapStatus(status) {
    if (status == null || status === '') {
      return {
        source_status: status == null ? null : status,
        normalized_status: null,
        frontend_bucket: 'status_mapping_gap',
        status_mapped_for_pipeline: false,
        legacy: false,
        derived_view: false,
        reason: 'missing',
        human: null,
        color: null,
        owner: null,
        jarvis_posture: null
      };
    }
    var key = String(status).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(STATUS_MAP, key)) {
      var e = STATUS_MAP[key];
      return {
        source_status: status,
        normalized_status: key,
        frontend_bucket: e.bucket,
        status_mapped_for_pipeline: true,
        legacy: !!e.legacy,
        derived_view: !!e.derived_view,
        reason: 'mapped',
        human: e.human,
        color: e.color,
        owner: e.owner,
        jarvis_posture: e.jarvis_posture
      };
    }
    return {
      source_status: status,
      normalized_status: null,
      frontend_bucket: 'status_mapping_gap',
      status_mapped_for_pipeline: false,
      legacy: false,
      derived_view: false,
      reason: 'unknown',
      human: null,
      color: null,
      owner: null,
      jarvis_posture: null
    };
  }

  return {
    STATUS_MAP: STATUS_MAP,
    STATUS_LABELS: STATUS_LABELS,
    STATUS_COLORS: STATUS_COLORS,
    FENCING_STAGES: FENCING_STAGES,
    PATIO_STAGES: PATIO_STAGES,
    DECKING_STAGES: DECKING_STAGES,
    QUICK_QUOTE_STAGES: QUICK_QUOTE_STAGES,
    MAKESAFE_STAGES: MAKESAFE_STAGES,
    REPAIR_STAGES: REPAIR_STAGES,
    ALL_CANONICAL_STATUSES: ALL_CANONICAL_STATUSES,
    ACTIVE_STATUSES: ACTIVE_STATUSES,
    isLegalForType: isLegalForType,
    getStagesForType: getStagesForType,
    mapStatus: mapStatus,
    VERSION: 'cap1a-state-machine-2026-05-01'
  };
}));
