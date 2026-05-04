/* ════════════════════════════════════════════════════════════════
   ops-readiness-fixtures.js — T6 Cap 1 Readiness Engine fixtures

   Ten named release-packet fixtures shaped to the T1 contract at
   cio/reports/2026-04-30-job-release-packet-v1/release-packet-contract-v1.md
   §9. All data is synthetic. No PII. No real client names.

   Each fixture: { id, label, packet, supplemental, expected }
     - `packet`        matches T1 ReleasePacket shape
     - `supplemental`  carries data the packet does not expose:
                       { assignments, job_context, deposit }
     - `expected`      drives the test harness asserts

   Fixtures 9 and 10 implement the Pipeline Visibility Guard
   (feedback_pipeline_visibility_guard.md, 2026-05-01): a known
   backend status that the frontend pipeline historically dropped,
   and an unknown future status. Both MUST remain visible.

   Computed-at anchor for deterministic install-window math:
     2026-05-01T08:00:00+08:00 (Perth AWST).
   ════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SW_READINESS_FIXTURES = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NOW_ISO = '2026-05-01T00:00:00.000Z'; // 08:00 AWST

  function inDays(days) {
    var d = new Date(NOW_ISO);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  }

  // Reusable scope/pricing snapshot shells (kept minimal — only the
  // fields the readiness engine reads).
  function scopeSnapshot(extra) {
    return Object.assign({
      access_notes: null,
      no_special_access: null,
      panels: 12,
      type: 'patio',
      site_meta: { complex_access: false }
    }, extra || {});
  }

  function pricingSnapshot(total) {
    return {
      total_inc_gst: total,
      total_ex_gst: Math.round(total / 1.1),
      margin_pct: 0.32,
      lines: [{ label: 'Base scope', amount: total }]
    };
  }

  function makeRevision(jobId, opts) {
    opts = opts || {};
    return {
      id: 'rev-' + jobId,
      job_id: jobId,
      revision_number: opts.revision_number || 1,
      source_tool: opts.source_tool || 'patio',
      sent_at: opts.sent_at !== undefined ? opts.sent_at : inDays(-2),
      recipient_email: opts.recipient_email || 'customer@example.com',
      scope_snapshot: opts.scope_snapshot || scopeSnapshot(),
      pricing_snapshot: opts.pricing_snapshot || pricingSnapshot(opts.total || 12500),
      scope_hash: 'sha256:scope-' + jobId,
      pricing_hash: 'sha256:pricing-' + jobId,
      margin_pct: 0.32,
      total_inc_gst: opts.total || 12500,
      total_ex_gst: Math.round((opts.total || 12500) / 1.1),
      created_by: 'sales-1',
      created_at: inDays(-3)
    };
  }

  function makeDocument(jobId, opts) {
    opts = opts || {};
    return {
      id: 'doc-' + jobId,
      pdf_url: 'https://example.test/quote/' + jobId + '.pdf',
      share_token: 'tok-' + jobId,
      quote_number: 'Q-' + jobId,
      sent_at: opts.sent_at !== undefined ? opts.sent_at : inDays(-2),
      viewed_at: opts.viewed_at !== undefined ? opts.viewed_at : inDays(-1),
      accepted_at: opts.accepted_at !== undefined ? opts.accepted_at : null,
      declined_at: opts.declined_at !== undefined ? opts.declined_at : null
    };
  }

  function makePO(jobId, idx, opts) {
    opts = opts || {};
    return {
      id: 'po-' + jobId + '-' + idx,
      po_number: 'PO-' + jobId + '-' + idx,
      po_type: opts.po_type || 'material',
      supplier_name: opts.supplier_name || 'Bondor (test)',
      line_items: opts.line_items || [{ desc: 'Insulated panel', qty: 8, unit_price: 320 }],
      subtotal: opts.subtotal || 2560,
      tax: opts.tax || 256,
      total: opts.total || 2816,
      status: opts.status || 'draft',
      delivery_date: opts.delivery_date || null,
      confirmed_delivery_date: opts.confirmed_delivery_date || null,
      quote_revision_id: 'rev-' + jobId
    };
  }

  function makeWO(jobId, opts) {
    opts = opts || {};
    return {
      id: 'wo-' + jobId,
      wo_number: 'WO-' + jobId,
      status: opts.status || 'draft',
      scope_items: opts.scope_items || [],
      special_instructions: opts.special_instructions || '',
      materials_summary_derived: opts.materials_summary_derived || [],
      share_token: 'wotok-' + jobId,
      scheduled_date: opts.scheduled_date || null,
      assigned_user_id: opts.assigned_user_id || null,
      quote_revision_id: 'rev-' + jobId
    };
  }

  function makeCustomer(opts) {
    opts = opts || {};
    return {
      name: opts.name || 'Customer A',
      email: opts.email || 'customer@example.com',
      mobile: opts.mobile !== undefined ? opts.mobile : '+61400000001',
      ghl_contact_id: opts.ghl_contact_id || 'ghl-' + (opts.name || 'A')
    };
  }

  function makeSite(opts) {
    opts = opts || {};
    return {
      address: opts.address !== undefined ? opts.address : '12 Test Street',
      suburb: opts.suburb !== undefined ? opts.suburb : 'Bayswater',
      lat: opts.lat !== undefined ? opts.lat : -31.92,
      lng: opts.lng !== undefined ? opts.lng : 115.92
    };
  }

  function makeJob(jobId, opts) {
    opts = opts || {};
    return {
      id: jobId,
      job_number: opts.job_number || 'SWP-' + jobId.replace(/[^0-9]/g, '').slice(0, 5).padStart(5, '0'),
      type: opts.type || 'patio',
      status: opts.status,
      quoted_at: opts.quoted_at !== undefined ? opts.quoted_at : inDays(-2),
      accepted_at: opts.accepted_at !== undefined ? opts.accepted_at : null,
      completed_at: opts.completed_at !== undefined ? opts.completed_at : null,
      scheduled_date: opts.scheduled_date || null
    };
  }

  function makePacket(parts) {
    return {
      revision: parts.revision || null,
      document: parts.document || null,
      purchase_orders: parts.purchase_orders || [],
      work_order: parts.work_order || null,
      media: parts.media || [],
      events: parts.events || [],
      customer: parts.customer || makeCustomer(),
      site: parts.site || makeSite(),
      job: parts.job,
      staged: parts.staged !== undefined ? parts.staged : false
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  Fixtures
  // ══════════════════════════════════════════════════════════════

  var fixtures = [];

  // 1. quoted_not_accepted → QUOTED_WAITING_CLIENT
  fixtures.push({
    id: 'quoted_not_accepted',
    label: 'Quoted, awaiting client decision',
    packet: makePacket({
      revision: makeRevision('26101', { sent_at: inDays(-2) }),
      document: makeDocument('26101', { accepted_at: null, declined_at: null }),
      job: makeJob('26101', { status: 'quoted', accepted_at: null })
    }),
    supplemental: { assignments: [], job_context: [], deposit: { deposit_paid: false } },
    expected: {
      state: 'QUOTED_WAITING_CLIENT',
      severity: 'info',
      owner: 'sales',
      frontend_bucket: 'waiting_client',
      blocker_ids_includes: [],
      top_next_action_owner: 'sales'
    }
  });

  // 2. accepted_no_packet_bindings → ACCEPTED_NEEDS_PACKET
  fixtures.push({
    id: 'accepted_no_packet_bindings',
    label: 'Accepted, no POs and no work order',
    packet: makePacket({
      revision: makeRevision('26102', { sent_at: inDays(-5) }),
      document: makeDocument('26102', { accepted_at: inDays(-3) }),
      purchase_orders: [],
      work_order: null,
      job: makeJob('26102', { status: 'accepted', accepted_at: inDays(-3) })
    }),
    supplemental: { assignments: [], job_context: [], deposit: { deposit_paid: false } },
    expected: {
      state: 'ACCEPTED_NEEDS_PACKET',
      severity: 'red',
      owner: 'office',
      frontend_bucket: 'packet_prep',
      blocker_ids_includes: ['materials_ordered', 'crew_assigned', 'crew_confirmed_attendance', 'client_confirmed'],
      top_next_action_owner: 'office'
    }
  });

  // 3. accepted_revision_draft_po_no_wo → NEEDS_MATERIAL_ORDER
  fixtures.push({
    id: 'accepted_revision_draft_po_no_wo',
    label: 'Accepted, draft material PO present but not sent yet',
    packet: makePacket({
      revision: makeRevision('26103', { sent_at: inDays(-5) }),
      document: makeDocument('26103', { accepted_at: inDays(-3) }),
      purchase_orders: [makePO('26103', 1, { status: 'draft', po_type: 'material' })],
      work_order: null,
      job: makeJob('26103', { status: 'order_materials', accepted_at: inDays(-3) })
    }),
    supplemental: { assignments: [], job_context: [], deposit: { deposit_paid: true } },
    expected: {
      state: 'NEEDS_MATERIAL_ORDER',
      severity: 'amber',
      owner: 'office',
      frontend_bucket: 'materials',
      blocker_ids_includes: ['materials_ordered', 'crew_assigned', 'crew_confirmed_attendance', 'client_confirmed'],
      top_next_action_owner: 'office'
    }
  });

  // 4. materials_pending_supplier_ack → MATERIALS_PENDING
  fixtures.push({
    id: 'materials_pending_supplier_ack',
    label: 'Material PO sent but no confirmed delivery date',
    packet: makePacket({
      revision: makeRevision('26104', { sent_at: inDays(-7) }),
      document: makeDocument('26104', { accepted_at: inDays(-5) }),
      purchase_orders: [makePO('26104', 1, { status: 'sent', po_type: 'material', delivery_date: inDays(7), confirmed_delivery_date: null })],
      work_order: null,
      job: makeJob('26104', { status: 'awaiting_supplier', accepted_at: inDays(-5) })
    }),
    supplemental: { assignments: [], job_context: [], deposit: { deposit_paid: true } },
    expected: {
      state: 'MATERIALS_PENDING',
      severity: 'amber',
      owner: 'office',
      frontend_bucket: 'materials',
      blocker_ids_includes: ['supplier_logistics_confirmed', 'crew_assigned', 'crew_confirmed_attendance', 'client_confirmed'],
      top_next_action_owner: 'office'
    }
  });

  // 5. ready_for_shaun_review → READY_FOR_SHAUN_REVIEW
  fixtures.push({
    id: 'ready_for_shaun_review',
    label: 'POs + WO done, scheduled >5 biz days out, awaiting Shaun pre-check',
    packet: makePacket({
      revision: makeRevision('26105', { sent_at: inDays(-12) }),
      document: makeDocument('26105', { accepted_at: inDays(-10) }),
      purchase_orders: [makePO('26105', 1, { status: 'sent', po_type: 'material', delivery_date: inDays(8), confirmed_delivery_date: inDays(8) })],
      work_order: makeWO('26105', { status: 'sent', scheduled_date: inDays(11) }),
      job: makeJob('26105', { status: 'scheduled', accepted_at: inDays(-10), scheduled_date: inDays(11) })
    }),
    supplemental: {
      assignments: [{ id: 'a-1', user_id: 'crew-1', confirmation_status: 'confirmed', scheduled_date: inDays(11) }],
      job_context: [
        { id: 'jc-1', kind: 'client_confirmation', value: { channel: 'sms', confirmed_at: inDays(-1) } },
        { id: 'jc-2', kind: 'access_note', value: { text: 'side gate, dog in yard' } }
      ],
      deposit: { deposit_paid: true }
    },
    expected: {
      state: 'READY_FOR_SHAUN_REVIEW',
      severity: 'amber',
      owner: 'shaun',
      frontend_bucket: 'ready',
      blocker_ids_includes: [],
      top_next_action_owner: null
    }
  });

  // 6. blocked_missing_site_customer_media → PACKET_INCOMPLETE
  fixtures.push({
    id: 'blocked_missing_site_customer_media',
    label: 'Accepted but customer mobile + site address missing',
    packet: makePacket({
      revision: makeRevision('26106', { sent_at: inDays(-6) }),
      document: makeDocument('26106', { accepted_at: inDays(-4) }),
      purchase_orders: [],
      work_order: null,
      customer: makeCustomer({ name: 'Customer F', mobile: null }),
      site: makeSite({ address: null, suburb: null, lat: null, lng: null }),
      job: makeJob('26106', { status: 'accepted', accepted_at: inDays(-4) })
    }),
    supplemental: { assignments: [], job_context: [], deposit: { deposit_paid: false } },
    expected: {
      state: 'PACKET_INCOMPLETE',
      severity: 'red',
      owner: 'office',
      frontend_bucket: 'packet_prep',
      blocker_ids_includes: ['customer_mobile_present', 'site_address_present', 'materials_ordered', 'crew_assigned'],
      top_next_action_owner: 'office'
    }
  });

  // 7. declined_terminal → DECLINED
  fixtures.push({
    id: 'declined_terminal',
    label: 'Client declined — terminal-soft state',
    packet: makePacket({
      revision: makeRevision('26107', { sent_at: inDays(-9) }),
      document: makeDocument('26107', { accepted_at: null, declined_at: inDays(-2) }),
      job: makeJob('26107', { status: 'quoted', accepted_at: null })
    }),
    supplemental: { assignments: [], job_context: [], deposit: { deposit_paid: false } },
    expected: {
      state: 'DECLINED',
      severity: 'terminal-soft',
      owner: 'sales',
      frontend_bucket: 'waiting_client',
      blocker_ids_includes: [],
      top_next_action_owner: 'sales'
    }
  });

  // 8. stale_or_ambiguous → NOT_RELEASED, confidence='low'
  fixtures.push({
    id: 'stale_or_ambiguous',
    label: 'Revision present but staged=true, no decline, no send',
    packet: makePacket({
      revision: makeRevision('26108', { sent_at: null }),
      document: makeDocument('26108', { sent_at: null, viewed_at: null, accepted_at: null, declined_at: null }),
      staged: true,
      job: makeJob('26108', { status: 'draft', quoted_at: null })
    }),
    supplemental: { assignments: [], job_context: [], deposit: { deposit_paid: false } },
    expected: {
      state: 'NOT_RELEASED',
      severity: 'info',
      owner: 'sales',
      frontend_bucket: 'quote',
      blocker_ids_includes: ['revision_released'],
      confidence: 'low'
    }
  });

  // 9. PIPELINE VISIBILITY GUARD — known backend status historically
  // dropped from frontend pipeline (`schedule_install`). Engine
  // MUST map it correctly and the job MUST remain visible.
  fixtures.push({
    id: 'pipeline_status_mismatch_schedule_install',
    label: 'Pipeline guard #1 — backend status "schedule_install" must remain visible',
    packet: makePacket({
      revision: makeRevision('26109', { sent_at: inDays(-14) }),
      document: makeDocument('26109', { accepted_at: inDays(-12) }),
      purchase_orders: [makePO('26109', 1, { status: 'sent', po_type: 'material', delivery_date: inDays(4), confirmed_delivery_date: inDays(4) })],
      work_order: makeWO('26109', { status: 'sent', scheduled_date: inDays(4) }),
      job: makeJob('26109', { status: 'schedule_install', accepted_at: inDays(-12), scheduled_date: inDays(4) })
    }),
    supplemental: {
      assignments: [{ id: 'a-9', user_id: 'crew-1', confirmation_status: 'confirmed', scheduled_date: inDays(4) }],
      job_context: [
        { id: 'jc-9a', kind: 'client_confirmation', value: { channel: 'sms', confirmed_at: inDays(-1) } },
        { id: 'jc-9b', kind: 'access_note', value: { text: 'no special access' } }
      ],
      deposit: { deposit_paid: true }
    },
    expected: {
      // schedule_install maps to 'ready' bucket; install in window;
      // all five contributing signals green → READY_TO_SCHEDULE.
      state: 'READY_TO_SCHEDULE',
      severity: 'green',
      owner: 'shaun',
      frontend_bucket: 'ready',
      normalized_status: 'schedule_install',
      blocker_ids_includes: [],
      visibility: 'must_be_visible'
    }
  });

  // 10. PIPELINE VISIBILITY GUARD — unknown future status. Must
  // NOT be dropped. Lands in the "Status mapping gap" diagnostic
  // bucket with confidence='low' and a next_action prompting the
  // map update.
  fixtures.push({
    id: 'pipeline_status_unknown_future',
    label: 'Pipeline guard #2 — unknown status "waiting_on_new_stage" must remain visible',
    packet: makePacket({
      revision: makeRevision('26110', { sent_at: inDays(-3) }),
      document: makeDocument('26110', { accepted_at: inDays(-1) }),
      purchase_orders: [],
      work_order: null,
      job: makeJob('26110', { status: 'waiting_on_new_stage', accepted_at: inDays(-1) })
    }),
    supplemental: { assignments: [], job_context: [], deposit: { deposit_paid: false } },
    expected: {
      // Lifecycle still computes (accepted, no POs/WO) → ACCEPTED_NEEDS_PACKET
      // but frontend_bucket MUST be status_mapping_gap and confidence='low',
      // and a status_mapped_for_pipeline blocker MUST appear.
      state: 'ACCEPTED_NEEDS_PACKET',
      frontend_bucket: 'status_mapping_gap',
      confidence: 'low',
      blocker_ids_includes: ['status_mapped_for_pipeline', 'materials_ordered'],
      visibility: 'must_be_visible'
    }
  });

  return {
    NOW_ISO: NOW_ISO,
    fixtures: fixtures,
    byId: fixtures.reduce(function (acc, f) { acc[f.id] = f; return acc; }, {})
  };
}));
