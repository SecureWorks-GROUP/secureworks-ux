// ════════════════════════════════════════════════════════════
// MAKESAFE REPORTING COCKPIT - APPROVALS VIEW (right column)
// The INFORMED-APPROVE CONTENT GATE for make-safe report packs, rewired onto the
// SES docket actions. The legacy combined approve/send path is RETIRED
// server-side (makesafe_send_pack / makesafe_send_photo_followup return 410
// legacy_combined_release_retired) and this module NEVER calls it, nor the
// legacy resume actions (makesafe_resume_close / makesafe_reset_failed_pack).
//
// LIST: the SES Docs Ready queue itself (list_ses_docs_ready_reviews — every
// job with a current needs_review docket). The queue row carries only
// job_id / docket_revision_id / stage / hashes / timestamps, so each card's
// identity (job number / builder / suburb / ref / family) and exact pack truth
// are joined from the canonical makesafe_board feed already cached by the
// board load, and the status chip + invoice glance are enriched per card from
// query_ses_review_cockpit. The legacy makesafe_report_drafts read is DROPPED
// from this surface: it returns zero drafts in production and its combined
// approve/send path is retired server-side (410), so a card rendered from it
// could only ever be a ghost.
// DETAIL: query_ses_review_cockpit (status / controls / routes / money) plus
// get_ses_reviewable_pack (byte-exact docs + photos + the hash the Docs Ready
// tick binds to), discovered via list_ses_docs_ready_reviews
// (job_id -> docket_revision_id; needs_review dockets only — a signed-off
// docket has already passed that queue, so the exact-pack view is offered only
// while the pack is in the queue).
// ACTION (per-job only — never a multi-job release): ONE CONTROL, with every
// server guard, recorded approval and hash binding unchanged:
//   1. approve_ses_invoice_revision (JWT, includes_authorise)
//      -> execute_ses_invoice_revision (AUTHORISES the Xero draft invoice the
//      agents already minted and binds the Xero PDF into a FRESH docket) — only
//      when the backend arms approve_invoice; the fresh pack is then re-read,
//      repainted and left for renewed Captain review. Nothing sends on this
//      first pass because its exact bytes were not visible before the press.
//   2. sign_off_ses_docket (JWT, hash-bound to the displayed pack).
//   3. prepare_ses_release_revision { job_ids: [job] }.
//   4. approve_ses_release_revision (JWT) — the send approval.
//   5. execute_ses_release_revision — releases every route the release carries
//      (today still report + photo + invoice) at once. For AJS the UI may
//      PREVIEW the intended two-email shape (report+invoice, then photos) when
//      the backend still builds three; that preview is labelled and never
//      presented as the send truth.
// A refusal stops the chain AT that step and shows the server's words verbatim;
// earlier recorded approvals stand and pressing again resumes from there.
//
// Globals consumed (all defined in ops.html):
//   opsFetch, opsPost, opsPostJwt, showToast, escapeHtml, escapeAttr
// ════════════════════════════════════════════════════════════

var _msReportingCache = {};
// SES state, keyed by job_id:
//   _msSesReviewQueue  — job_id -> Docs Ready queue row (needs_review dockets).
//   _msSesCockpitCache — job_id -> cockpit view (card badge enrichment).
//   _msSesPackCache    — job_id -> the open detail context
//                        { jobId, panelId, cockpit, queueEntry, pack,
//                          docketRevisionId, outputHash, reviewState, fetchedAt }.
var _msSesReviewQueue = {};
var _msSesCockpitCache = {};
var _msSesPackCache = {};
var _msSesPackCompletenessById = {};
// job_id -> the last docket_revision_id this session actually saw in the review
// queue. The queue only lists needs_review dockets, so the moment a tick is
// recorded (which the send pass does) the job drops out of it and the byte-exact
// pack — every document tab, including the portal capture — would vanish from
// this pane for the rest of the session. The remembered id is offered back to
// get_ses_reviewable_pack, which validates it server-side and refuses with a 409
// if it is no longer the current pack; nothing here decides the pack is current.
var _msSesLastKnownDocket = {};
// When _msSesReviewQueue was last successfully read (0 = never). The board door
// uses it to re-read a stale queue before deciding a job has no reviewable pack.
var _msSesReviewQueueFetchedAt = 0;

// JS-STRING escape for values interpolated INSIDE a single-quoted JS string in an
// inline onclick handler. escapeAttr/escapeHtml are HTML-context escapes (entities
// are decoded by the parser BEFORE the handler runs), so they do NOT protect the JS
// string boundary. This escapes the chars that break out of a '...'-quoted JS string
// (backslash, single quote) so a value carrying a quote can never inject handler JS.
// (job_ids are UUIDs and our photo URLs are clean, but this fails closed against any
// future field that isn't.) Pair with escapeAttr when the result also sits in an
// HTML attribute: jsAttr(v) = escapeAttr applied to the JS-escaped value.
function _msJsStr(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function _msJsAttr(s) {
  // Safe for: onclick="fn('<HERE>')" — JS-escape first, then HTML-attr-escape so the
  // double-quoted attribute and the single-quoted JS string are both intact.
  return escapeAttr(_msJsStr(s));
}

function _msSesPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _msSesHasOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function _msSesReportIsSelected(report) {
  if (!report || typeof report !== 'object') return false;
  var state = String(report.state || report.status || '').trim().toLowerCase();
  return state === 'submitted' || state === 'approved';
}

// Project the exact canonical inputs the readiness door is allowed to trust.
// The board's `report` field is already selected for the current attendance
// cycle server-side; only a submitted/approved selection counts here. A coarse
// has_report_doc flag is deliberately ignored because attachment is not bind.
function makesafePackTruthFromCanonicalRow(row) {
  row = (row && typeof row === 'object') ? row : {};
  var pack = _msSesPlainObject(row.pack)
    ? row.pack
    : (_msSesPlainObject(row.report_pack) ? row.report_pack : {});
  var selected = pack.has_selected_current_cycle_trade_report;
  if (selected !== true && selected !== false) {
    selected = _msSesReportIsSelected(row.report);
  }
  var truth = {
    drafted: pack.drafted === true,
    presentation_kind: pack.presentation_kind || null,
    presentation_reason: pack.presentation_reason || null,
    report_doc_id: pack.report_doc_id || row.report_doc_id || null,
    invoice_doc_id: pack.invoice_doc_id || row.invoice_doc_id || null,
    swms_doc_id: pack.swms_doc_id || row.swms_doc_id || null,
    report_doc_resolved: pack.report_doc_resolved,
    has_selected_current_cycle_trade_report: selected === true
  };
  // Copy the engine's requirement resolution envelope verbatim. An explicit
  // unresolved marker outranks any stray map value and may never be repaired in
  // the browser by guessing from family, builder or document pointers.
  if (_msSesHasOwn(pack, 'required_documents_resolved')) {
    truth.required_documents_resolved = pack.required_documents_resolved;
  }
  if (_msSesHasOwn(pack, 'required_documents')) {
    truth.required_documents = pack.required_documents;
  }
  if (_msSesHasOwn(pack, 'required_documents_unresolved_reason')) {
    truth.required_documents_unresolved_reason = pack.required_documents_unresolved_reason;
  }
  if (_msSesHasOwn(pack, 'closeout_documents')) {
    truth.closeout_documents = pack.closeout_documents;
  }
  return truth;
}

// ONE document-honesty verdict owns the board card, whole-card open path and
// Approvals card. It has two deliberately separate answers:
//   - `reviewable`: a real drafted pack exists, so the Captain may open it;
//   - `complete`: the payload positively proves every declared requirement.
//
// Missing, partial or malformed document truth is a visible caveat, never a
// client-side wall around Captain review/send authority. Live v1.2 publishes
// required_documents (null when unresolved). A v1 payload, or unresolved v1.2
// requirements, must remain visible without hiding the review door or the
// backend-armed APPROVE AND SEND control.
// The engine owns which document types the pack requires. This consumer only
// compares that map with closeout/proof truth; it never derives requirements
// from family, builder, presentation state or pointers.
function makesafePackCompletenessVerdict(pack) {
  pack = (pack && typeof pack === 'object') ? pack : {};
  var presentationKind = String(pack.presentation_kind || '').trim().toLowerCase();
  var documentKeys = ['report', 'invoice', 'swms'];
  var requiredCandidate = _msSesPlainObject(pack.required_documents)
    ? pack.required_documents
    : null;
  var required = requiredCandidate && documentKeys.every(function(key) {
    return typeof requiredCandidate[key] === 'boolean';
  }) ? requiredCandidate : null;
  var closeout = _msSesPlainObject(pack.closeout_documents) ? pack.closeout_documents : null;
  var requirementsResolved = pack.required_documents_resolved !== false && !!required;
  var closeoutWellFormed = !!closeout && documentKeys.every(function(key) {
    return typeof closeout[key] === 'boolean';
  });
  var proofPointers = {
    report: String(pack.report_doc_id || '').trim(),
    invoice: String(pack.invoice_doc_id || '').trim(),
    swms: String(pack.swms_doc_id || '').trim()
  };
  var reportProofResolved = pack.report_doc_resolved !== false
    && pack.has_selected_current_cycle_trade_report === true;
  var missingRequired = [];
  if (requirementsResolved && closeoutWellFormed) {
    documentKeys.forEach(function(key) {
      if (required[key] !== true) return;
      var proofResolved = key !== 'report' || reportProofResolved;
      if (closeout[key] !== true || !proofPointers[key] || !proofResolved) {
        missingRequired.push(key);
      }
    });
  }
  var complete = requirementsResolved
    && closeoutWellFormed
    && presentationKind === 'ready'
    && missingRequired.length === 0;
  var reviewable = pack.drafted === true;
  var reason = '';
  var warningLabel = '';
  if (!reviewable) {
    reason = 'No drafted pack is available to review.';
    warningLabel = 'NO PACK DRAFTED';
  } else if (!complete) {
    if (!requirementsResolved) {
      var unresolvedReason = String(pack.required_documents_unresolved_reason || '').trim();
      reason = 'Requirements unknown.'
        + (unresolvedReason ? ' ' + unresolvedReason : '')
        + ' Review the documents and send preview below before sending.';
      warningLabel = 'REQUIREMENTS UNKNOWN';
    } else if (!closeoutWellFormed) {
      reason = 'Closeout document truth is empty or malformed. Review the documents and send preview below.';
      warningLabel = 'PACK INCOMPLETE';
    } else if (missingRequired.length) {
      reason = 'Required document truth reports missing or unresolved: ' + missingRequired.join(', ') + '. Review this caveat before sending.';
      warningLabel = 'PACK INCOMPLETE';
    } else {
      reason = String(pack.presentation_reason || '').trim()
        || 'The pack is not presented as complete. Review the documents and send preview below.';
      warningLabel = 'PACK INCOMPLETE';
    }
  }
  return {
    // `ready` remains as a compatibility alias for the review door. New callers
    // should say `reviewable`; document claims must use `complete`.
    ready: reviewable,
    reviewable: reviewable,
    complete: complete,
    requirements_resolved: requirementsResolved,
    required_documents: requirementsResolved ? required : null,
    closeout_documents: closeout,
    presentation_kind: presentationKind,
    missing_required: missingRequired,
    warning_label: warningLabel,
    reason: reason,
    evidence: complete
      ? 'document_maps'
      : (!requirementsResolved ? 'requirements_unknown' : 'incomplete')
  };
}

function _msReportingCanonicalBuilderName(d) {
  var name = d && (d.builder || d.requesting_company_name || d.builder_company || '');
  var ref = String(d && (d.external_ref || d.builder_ref || d.reference || '') || '').toUpperCase();
  var norm = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (
    /(^|[^A-Z0-9])MLB[-\s]*\d+/.test(ref) ||
    ref.indexOf('MLB-') === 0 ||
    norm === 'mlbuilders' ||
    norm === 'mlbuilder' ||
    norm === 'majorlossbuilder' ||
    norm === 'majorlossbuilders'
  ) {
    return 'Major Loss Builders';
  }
  return name || '(no builder)';
}

// ────────────────────────────────────────────────────────────
// 1. LIST PANEL - load + render the reporting column
// ────────────────────────────────────────────────────────────

/**
 * Load the SES Docs Ready review queue and render the cockpit column from it.
 * The queue (list_ses_docs_ready_reviews) is the ONLY read that maps
 * job_id -> current needs_review docket, so it owns which cards exist; the
 * retired legacy drafts feed is never read here. Identity facts the queue does
 * not carry (job number / builder / suburb / ref / family) are joined from the
 * canonical makesafe_board feed (see _msSesBoardIdentity), and each card's
 * status chip + invoice glance are enriched from query_ses_review_cockpit.
 * Returns the count of queued packs (resolves to 0 on error).
 */
async function loadMakesafeReportingCockpit() {
  var body = document.getElementById('msReportingListBody');
  if (body) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--sw-text-sec);font-size:13px;">Loading the SES review queue&#8230;</div>';
  }
  try {
    var identityPromise = _msSesBoardIdentity();
    await _msSesRefreshReviewQueue();
    var identityById = await identityPromise;
    _msReportingCache = {};
    // Queue order is the server's review_state_changed_at ascending — the pack
    // waiting longest sits on top. Object.keys preserves the insertion order
    // _msSesRefreshReviewQueue built the map in (job ids are UUIDs).
    var rows = [];
    Object.keys(_msSesReviewQueue).forEach(function(jobId) {
      var row = _msSesQueueCardRow(jobId, _msSesReviewQueue[jobId], identityById[jobId]);
      _msReportingCache[jobId] = row;
      rows.push(row);
    });

    if (body) {
      if (rows.length === 0) {
        body.innerHTML = '<div style="padding:40px 20px;text-align:center;">'
          + '<div style="font-size:36px;opacity:0.3;margin-bottom:12px;">&#128203;</div>'
          + '<div style="font-size:14px;font-weight:600;color:var(--sw-dark);">No packs awaiting review</div>'
          + '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:6px;">Packs appear here when the SES reporting routine assembles a docket and it enters Docs Ready review.</div>'
          + '</div>';
      } else {
        var html = '';
        rows.forEach(function(d) { html += renderMsReportingCard(d); });
        body.innerHTML = html;
        // Enrich each card's status chip + invoice glance with the SES cockpit
        // view (async; failures land on an honest fallback chip, never a
        // legacy action).
        _msSesEnrichCards(rows);
      }
    }

    refreshMsReportingBadge(rows.length);
    return rows.length;
  } catch (e) {
    if (body) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:#E74C3C;font-size:13px;">Failed to load the SES review queue: ' + escapeHtml(e.message || String(e)) + '</div>';
    }
    refreshMsReportingBadge(0);
    return 0;
  }
}

/**
 * Refresh the SES Docs Ready review queue (needs_review dockets). This is the
 * ONLY dispatched read that maps job_id -> exact current docket_revision_id;
 * a signed-off docket has legitimately dropped out of it. Failures keep the
 * previous map (the detail open re-tries on a miss).
 */
async function _msSesRefreshReviewQueue() {
  try {
    var data = await opsFetch('list_ses_docs_ready_reviews', { limit: 100 });
    var map = {};
    ((data && data.dockets) || []).forEach(function(r) {
      if (r && r.job_id) map[r.job_id] = r;
    });
    _msSesReviewQueue = map;
    _msSesReviewQueueFetchedAt = Date.now();
  } catch (_e) {
    // Degrade honestly: without the queue the detail renders from the cockpit
    // view alone (no byte-exact pack, no hash-bound tick).
  }
}

// The queue read goes stale quickly (a persist run can add a docket at any
// time), so the board door re-reads it before concluding a job has no pack.
function _msSesReviewQueueStale(ms) {
  return !_msSesReviewQueueFetchedAt || (Date.now() - _msSesReviewQueueFetchedAt) > (ms || 30000);
}

// ── CARD IDENTITY (joined, never invented) ──────────────────────────────────
// The SES queue row carries no identity facts. Every identity field on a card
// comes from the canonical makesafe_board feed — the same rows the board
// renders — preferring the enrichment-joined mapped cards when the make-safe
// board is the loaded tab (they carry the true site_suburb), else the raw
// canonical rows (suburb from the contact.address tail, the board's own
// degraded-path rule). When neither is in memory (Approvals tab opened before
// the board) the same canonical feed is read once — a read-only GET, the same
// one ensureMakesafeCanonicalStages uses for deep links.

// Project one raw canonical `makesafe-board.v1` row onto the identity shape the
// card + detail header read. Mirrors the board's own mapCanonicalMakesafeRow
// fallbacks; a fact the feed does not carry stays null and renders as a gap.
function _msSesIdentityFromCanonicalRow(row) {
  var contact = (row && row.contact) || {};
  var builder = (row && row.builder) || {};
  var lineage = (row && row.lineage) || {};
  var builderName = builder.name || null;
  return {
    job_id: row.id,
    job_number: row.job_number || null,
    builder: builderName,
    external_ref: builder.external_ref || lineage.builder_claim_ref || null,
    site_address: contact.address || null,
    site_suburb: (typeof makesafeSuburbFromAddress === 'function' ? makesafeSuburbFromAddress(contact.address) : '') || null,
    client_name: contact.client_name || null,
    requesting_company_name: builderName,
    requesting_company_slug: (typeof makesafeCompanySlugFallback === 'function' ? makesafeCompanySlugFallback(builderName) : null),
    makesafe_job_family: row.ses_family || row.makesafe_type || null,
    makesafe_job_family_label: row.ses_family_label || null,
    // Attendance-cycle identity: the capture tab needs it to say whether a
    // capture belongs to the visit under review or to an earlier one.
    attendance_cycle_id: row.attendance_cycle_id || null,
    cycle_number: (row.cycle_number != null ? row.cycle_number : null),
    is_reattend: !!(row.presentation && row.presentation.is_reattend),
    reattend_count: (row.presentation && row.presentation.reattend_count != null)
      ? row.presentation.reattend_count : null,
    last_reattend_at: (row.presentation && row.presentation.last_reattend_at) || null,
    pack_truth: makesafePackTruthFromCanonicalRow(row)
  };
}

// The same projection off a mapped board card (canonical row + close-out
// enrichment already joined by fetchMakesafeBoardData). These cards carry the
// true enriched site_suburb, so they win where they exist.
function _msSesIdentityFromBoardCard(card) {
  var builderName = card.requesting_company_name || (card.builder && card.builder.name) || null;
  return {
    job_id: card.id,
    job_number: card.job_number || null,
    builder: builderName,
    external_ref: card.external_ref || null,
    site_address: card.site_address || null,
    site_suburb: card.site_suburb || null,
    client_name: card.client_name || null,
    requesting_company_name: builderName,
    requesting_company_slug: card.requesting_company_slug || null,
    makesafe_job_family: card.ses_family || card.makesafe_job_family || null,
    makesafe_job_family_label: card.ses_family_label || null,
    attendance_cycle_id: card.attendance_cycle_id || null,
    cycle_number: (card.cycle_number != null ? card.cycle_number : null),
    is_reattend: !!card.is_reattend,
    reattend_count: (card.reattend_count != null ? card.reattend_count : null),
    last_reattend_at: card.last_reattend_at || null,
    pack_truth: makesafePackTruthFromCanonicalRow(card)
  };
}

/**
 * Build the job_id -> identity map from the board feed. Reads the page's
 * already-loaded canonical payload (_makesafeBoardPayload) and the mapped board
 * cards (_pipelineData when the make-safe board is the loaded tab); reads the
 * canonical feed once when neither is available. Never invents a field.
 */
async function _msSesBoardIdentity() {
  var byId = {};
  var payload = (typeof _makesafeBoardPayload !== 'undefined' && _makesafeBoardPayload && _makesafeBoardPayload.columns)
    ? _makesafeBoardPayload : null;
  var hasMappedCards = !!(typeof _pipelineTab !== 'undefined' && _pipelineTab === 'makesafes'
    && typeof _pipelineData !== 'undefined' && _pipelineData && _pipelineData.columns);
  if (!payload && !hasMappedCards) {
    // Approvals tab opened before the board: read the same canonical feed once.
    try {
      payload = await opsFetch('makesafe_board', { projection: 'ops' });
    } catch (e) {
      console.warn('MakeSafe reporting: board identity feed unavailable:', e && e.message);
      payload = null;
    }
  }
  if (payload && payload.columns) {
    Object.keys(payload.columns).forEach(function(stage) {
      (payload.columns[stage] || []).forEach(function(row) {
        if (row && row.id) byId[row.id] = _msSesIdentityFromCanonicalRow(row);
      });
    });
  }
  // The mapped, enrichment-joined cards win where they exist (true site_suburb).
  if (hasMappedCards) {
    Object.keys(_pipelineData.columns).forEach(function(stage) {
      (_pipelineData.columns[stage] || []).forEach(function(card) {
        if (card && card.id) byId[card.id] = _msSesIdentityFromBoardCard(card);
      });
    });
  }
  return byId;
}

/**
 * Build the list/cache row for one queued job: the SES queue facts plus the
 * joined board identity. This is the row renderMsReportingCard renders and the
 * detail header reads — it deliberately carries NO legacy send fields
 * (resume_action / pack_status / recipient / subject), so no legacy gate can
 * ever pick a queue card up.
 */
function _msSesQueueCardRow(jobId, entry, identity) {
  entry = entry || {};
  var row = {
    job_id: jobId,
    ses_docket_revision_id: entry.docket_revision_id || null,
    ses_docket_stage: entry.docket_stage || null,
    ses_queued_at: entry.review_state_changed_at || entry.docket_committed_at || null
  };
  if (identity) {
    ['job_number', 'builder', 'external_ref', 'site_suburb', 'site_address',
      'client_name', 'requesting_company_name', 'requesting_company_slug',
      'makesafe_job_family', 'makesafe_job_family_label',
      'attendance_cycle_id', 'cycle_number', 'is_reattend', 'reattend_count',
      'last_reattend_at', 'pack_truth'].forEach(function(k) {
      if (identity[k] != null) row[k] = identity[k];
    });
  }
  return row;
}

/**
 * Seed _msReportingCache[jobId] from the board identity join when the list has
 * not run yet (board-first entry through the door). Always seeds at least a
 * bare job_id row so the detail can open; the SES reads carry the review
 * content either way.
 */
async function _msSesSeedIdentityRow(jobId) {
  if (_msReportingCache[jobId]) return _msReportingCache[jobId];
  var identityById = {};
  try { identityById = await _msSesBoardIdentity(); } catch (_e) { /* bare row */ }
  var row = _msSesQueueCardRow(jobId, _msSesReviewQueue[jobId], identityById[jobId]);
  _msReportingCache[jobId] = row;
  return row;
}

/**
 * Enrich the rendered list cards from the SES cockpit view: the status chip,
 * the invoice glance (sections.money), and the job-number line when the board
 * join missed it (sections.job_story.job_number is the same fact). One bounded
 * read per card (the review queue is small); a job whose docket vanished
 * between the queue read and this read gets an honest NO SES PACK chip, a read
 * failure gets SES UNKNOWN.
 */
function _msSesEnrichCards(rows) {
  rows.forEach(function(d) {
    var jobId = d && d.job_id;
    if (!jobId) return;
    opsFetch('query_ses_review_cockpit', { job_id: jobId }).then(function(cockpit) {
      _msSesCockpitCache[jobId] = cockpit;
      _msSesUpdateCardBadge(jobId, cockpit && cockpit.status);
      _msSesUpdateCardMoney(jobId, cockpit);
      _msSesUpdateCardJobNumber(jobId, cockpit);
    }).catch(function(e) {
      var msg = String((e && e.message) || e || '');
      _msSesUpdateCardBadge(jobId, /No current SES docket revision/i.test(msg) ? 'NO_DOCKET' : 'UNKNOWN');
    });
  });
}

function _msSesUpdateCardBadge(jobId, status) {
  var el = document.getElementById('msCardBadge_' + _msDocTabKey(jobId));
  if (!el) return;
  var verdict = _msSesPackCompletenessById[jobId];
  var chip = status !== 'NO_DOCKET' && verdict && !verdict.complete
    ? {
      label: verdict.warning_label || 'PACK INCOMPLETE',
      bg: verdict.warning_label === 'PACK INCOMPLETE' ? '#991B1B' : '#B45309',
      fg: '#fff'
    }
    : _msSesStatusChip(status);
  el.textContent = chip.label;
  el.style.background = chip.bg;
  el.style.color = chip.fg;
}

// The card's invoice glance is the SES money truth: the docket's
// local_invoice_proposal total (inc GST), or an honest "no proposal" note.
function _msSesUpdateCardMoney(jobId, cockpit) {
  var el = document.getElementById('msCardMoney_' + _msDocTabKey(jobId));
  if (!el) return;
  var money = (cockpit && cockpit.sections && cockpit.sections.money) || {};
  var proposal = money.local_invoice_proposal || null;
  var total = (proposal && proposal.total_inc_gst != null) ? Number(proposal.total_inc_gst) : null;
  if (total != null && isFinite(total)) {
    el.innerHTML = escapeHtml(_msFmtAud(total)) + '<span style="font-size:10px;font-weight:600;color:var(--sw-text-sec);margin-left:4px;">inc GST</span>';
  } else {
    el.innerHTML = '<span style="font-size:11px;font-weight:600;color:var(--sw-text-sec);">No invoice proposal on this pack</span>';
  }
}

// Fill the job-number line only when the board join left it empty — the
// cockpit's job_story.job_number is the same fact from the docket side.
function _msSesUpdateCardJobNumber(jobId, cockpit) {
  var el = document.getElementById('msCardJob_' + _msDocTabKey(jobId));
  if (!el || el.textContent.trim()) return;
  var n = cockpit && cockpit.sections && cockpit.sections.job_story && cockpit.sections.job_story.job_number;
  if (n) el.innerHTML = '<strong>Job:</strong> ' + escapeHtml(n);
}

// The single status vocabulary for this surface: the SES cockpit status.
function _msSesStatusChip(status) {
  switch (status) {
    case 'SEND_READY': return { label: 'SEND READY', bg: '#27AE60', fg: '#fff' };
    case 'INVOICE_CREATE_READY': return { label: 'APPROVE INVOICE', bg: '#B45309', fg: '#fff' };
    case 'PRE_XERO_DOCS_READY': return { label: 'DOCS READY', bg: '#0E7C7B', fg: '#fff' };
    case 'HOLD': return { label: 'ON HOLD', bg: '#991B1B', fg: '#fff' };
    case 'NO_DOCKET': return { label: 'NO SES PACK', bg: '#6B7280', fg: '#fff' };
    default: return { label: 'SES UNKNOWN', bg: '#6B7280', fg: '#fff' };
  }
}

/**
 * Format a number as AUD currency for display.
 */
function _msFmtAud(n) {
  var v = Number(n);
  if (!isFinite(v)) v = 0;
  return '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Render a single queued-pack card for the cockpit column. Identity facts come
 * from the canonical board feed join (a missing fact renders as a gap, never a
 * guess); the status chip, the invoice glance and a missing job number are
 * enriched from the SES cockpit view by _msSesEnrichCards.
 */
function renderMsReportingCard(d) {
  var builder = _msReportingCanonicalBuilderName(d);
  var ref = d.external_ref;
  var suburb = d.site_suburb;
  var jobNumber = d.job_number;

  var safeId = _msJsAttr(d.job_id);
  var cardKey = _msDocTabKey(d.job_id);
  var completeness = makesafePackCompletenessVerdict(d.pack_truth);
  _msSesPackCompletenessById[d.job_id] = completeness;
  var openAttr = completeness.reviewable ? ' onclick="showMsReportingDetail(\'' + safeId + '\')"' : '';
  var caveatColour = completeness.warning_label === 'PACK INCOMPLETE' ? '#991B1B' : '#B45309';
  var html = '<div data-ms-reporting-card="' + escapeAttr(cardKey) + '"' + openAttr + ' style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;padding:12px;margin:10px;cursor:' + (completeness.reviewable ? 'pointer' : 'default') + ';box-shadow:0 1px 3px rgba(41,60,70,0.06);border-left:4px solid ' + (completeness.complete ? '#94A3B8' : caveatColour) + ';">';

  // Top row: the SES status chip (enriched async from query_ses_review_cockpit).
  html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
  html += '<span id="msCardBadge_' + escapeAttr(cardKey) + '" style="font-size:9px;font-weight:800;letter-spacing:0.04em;padding:2px 7px;border-radius:10px;background:' + (completeness.complete ? '#6B7280' : caveatColour) + ';color:#fff;">' + (completeness.complete ? 'CHECKING SES&#8230;' : escapeHtml(completeness.warning_label || 'PACK INCOMPLETE')) + '</span>';
  html += '</div>';

  // Builder name
  html += '<div style="font-size:14px;font-weight:700;color:var(--sw-dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(builder) + '</div>';

  // Detail lines — only real facts render.
  if (ref) html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:3px;"><strong>Ref:</strong> ' + escapeHtml(ref) + '</div>';
  // The job-number line always carries its hook id: when the board join missed
  // the job, the cockpit enrichment fills it from job_story.job_number.
  html += '<div id="msCardJob_' + escapeAttr(cardKey) + '" style="font-size:12px;color:var(--sw-text-sec);margin-top:2px;">' + (jobNumber ? '<strong>Job:</strong> ' + escapeHtml(jobNumber) : '') + '</div>';
  if (suburb) html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:2px;"><strong>Suburb:</strong> ' + escapeHtml(suburb) + '</div>';

  // Invoice glance (inc GST) - prominent; filled by the SES cockpit enrichment
  // from sections.money.local_invoice_proposal.
  html += '<div id="msCardMoney_' + escapeAttr(cardKey) + '" style="margin-top:8px;font-size:18px;font-weight:800;color:var(--sw-dark);"></div>';

  // A drafted pack always opens for Captain review. Document gaps remain visible
  // on the card and again beside the exact documents/routes in the detail.
  if (completeness.reviewable) {
    html += '<div style="margin-top:10px;">';
    html += '<button onclick="event.stopPropagation();showMsReportingDetail(\'' + safeId + '\')" style="width:100%;background:#1F3A44;color:#fff;border:none;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Review job pack</button>';
    html += '</div>';
  }
  if (!completeness.complete && completeness.reason) {
    html += '<div style="margin-top:10px;font-size:11px;font-weight:600;color:#991B1B;">' + escapeHtml(completeness.reason) + '</div>';
  }

  html += '</div>';
  return html;
}

function _msSesPackCompletenessInput(jobId, ctx, base) {
  base = base || _msReportingCache[jobId] || {};
  var canonical = base.pack_truth || (
    typeof _makesafeCanonicalPackMetaById !== 'undefined'
      ? _makesafeCanonicalPackMetaById[jobId]
      : null
  ) || {};
  var hasFreshReviewPack = !!(ctx && _msSesPlainObject(ctx.pack));
  var reviewPack = hasFreshReviewPack ? ctx.pack : {};
  var presentation = _msSesPlainObject(reviewPack.presentation)
    ? reviewPack.presentation
    : {};
  var docket = _msSesPlainObject(reviewPack.docket) ? reviewPack.docket : {};
  // A loaded review pack is the byte-exact presentation boundary. Its document
  // truth may use the nested docket from that same response, but it must never
  // fall through to an older canonical board row. The cache is fallback only
  // while no fresh review pack exists.
  var documentTruthSources = hasFreshReviewPack
    ? [reviewPack, docket]
    : [canonical];

  function firstDefined() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return null;
  }

  function firstDefinedFrom(sources, key) {
    for (var i = 0; i < sources.length; i++) {
      if (sources[i][key] !== undefined && sources[i][key] !== null) {
        return sources[i][key];
      }
    }
    return null;
  }

  function firstOwnedFrom(sources, key) {
    for (var i = 0; i < sources.length; i++) {
      if (_msSesHasOwn(sources[i], key)) {
        return { supplied: true, value: sources[i][key] };
      }
    }
    return { supplied: false, value: undefined };
  }

  // Select the engine's resolution marker, map and refusal reason from one
  // payload object. Once the byte-exact review pack is loaded, an omitted
  // envelope stays omitted/unknown; a cached envelope cannot complete it.
  function firstRequirementEnvelope() {
    var keys = [
      'required_documents_resolved',
      'required_documents',
      'required_documents_unresolved_reason'
    ];
    var requirementSources = hasFreshReviewPack ? [reviewPack] : [canonical];
    for (var i = 0; i < requirementSources.length; i++) {
      var source = requirementSources[i];
      if (keys.some(function(key) { return _msSesHasOwn(source, key); })) return source;
    }
    return null;
  }

  var requirementEnvelope = firstRequirementEnvelope();
  var closeoutTruth = firstOwnedFrom(documentTruthSources, 'closeout_documents');
  var input = {
    drafted: firstDefined(reviewPack.drafted, docket.drafted, canonical.drafted) === true,
    presentation_kind: firstDefined(
      presentation.kind,
      reviewPack.presentation_kind,
      canonical.presentation_kind
    ),
    presentation_reason: firstDefined(
      presentation.reason,
      reviewPack.presentation_reason,
      canonical.presentation_reason
    ),
    report_doc_id: firstDefinedFrom(documentTruthSources, 'report_doc_id'),
    invoice_doc_id: firstDefinedFrom(documentTruthSources, 'invoice_doc_id'),
    swms_doc_id: firstDefinedFrom(documentTruthSources, 'swms_doc_id'),
    report_doc_resolved: firstDefinedFrom(documentTruthSources, 'report_doc_resolved'),
    has_selected_current_cycle_trade_report: firstDefinedFrom(
      documentTruthSources,
      'has_selected_current_cycle_trade_report'
    ) === true
  };
  if (requirementEnvelope) {
    [
      'required_documents_resolved',
      'required_documents',
      'required_documents_unresolved_reason'
    ].forEach(function(key) {
      if (_msSesHasOwn(requirementEnvelope, key)) input[key] = requirementEnvelope[key];
    });
  }
  if (closeoutTruth.supplied) input.closeout_documents = closeoutTruth.value;
  return input;
}

function _msSesPackCompleteness(jobId, ctx, base) {
  return makesafePackCompletenessVerdict(
    _msSesPackCompletenessInput(jobId, ctx, base)
  );
}

// ────────────────────────────────────────────────────────────
// 2. DETAIL PANEL - the SES-informed approve gate
// ────────────────────────────────────────────────────────────

/**
 * Render the SES review pack into the target panel. Async: loads the cockpit
 * view (status / controls / routes / money) and — while the docket is still in
 * the Docs Ready queue — the byte-exact reviewable pack (docs, photos, the hash
 * the sign-off binds to). A job with no current SES docket renders an honest
 * "no reviewable pack persisted yet" state and NEVER touches the retired 410
 * actions.
 *
 * Works in BOTH hosts: the board overlay (targetPanelId = ...Board) and the
 * inline Approvals-tab panel (targetPanelId = 'msReportingDetailPanel' /
 * undefined).
 */
async function showMsReportingDetail(jobId, targetPanelId) {
  var panel = document.getElementById(targetPanelId || 'msReportingDetailPanel');
  if (!panel) return;
  panel.innerHTML = '<div style="padding:32px 20px;text-align:center;color:var(--sw-text-sec);font-size:13px;">Loading the SES review pack&#8230;</div>';
  // Board-first entry (the list has not run): seed the identity row the header
  // reads from the canonical board feed rather than refusing to open. The SES
  // reads below carry the review content either way, and a job with no current
  // docket lands on the honest no-pack state.
  var base = _msReportingCache[jobId];
  if (!base) {
    try {
      base = await _msSesSeedIdentityRow(jobId);
    } catch (_e) {
      base = { job_id: jobId };
      _msReportingCache[jobId] = base;
    }
  }
  var ctx;
  try {
    ctx = await _msSesLoadPackContext(jobId);
    // When a bound Xero DRAFT/AUTHORISED has no pack PDF yet (backend pack
    // inject not deployed, or pack fetch failed), recover the real bytes via
    // get_invoice_pdf through the dashboard's signed-in user JWT. Never invent
    // HTML when this fails; the tab stays honest-unavailable.
    await _msSesHydrateBoundInvoicePdf(ctx);
    // The capture's own facts (when it was taken, what the observer saw). Never
    // fatal: without them the capture still renders and the stage says the
    // facts could not be read rather than implying the capture is current.
    await _msSesHydratePortalCaptureFacts(ctx);
  } catch (e) {
    panel.innerHTML = _msSesRenderUnavailable(jobId, base, e, targetPanelId);
    return;
  }
  // A direct Approvals/detail entry computes the same document-honesty verdict
  // as the board card and whole-card door. The detail renders every caveat. A
  // successful byte-exact pack read must also exist before backend controls can
  // arm the send stamp; required_documents completeness is not that read gate.
  ctx.packCompleteness = _msSesPackCompleteness(jobId, ctx, base);
  _msSesPackCompletenessById[jobId] = ctx.packCompleteness;
  ctx.panelId = targetPanelId || 'msReportingDetailPanel';
  _msSesPackCache[jobId] = ctx;
  panel.innerHTML = _msSesRenderDetail(jobId, ctx, targetPanelId);
  // Paint the PDF tile thumbnails + the inline viewer (pdf.js, lazy). Safe to
  // call unconditionally — it no-ops when there is no PDF surface.
  _msHydratePdfSurfaces(panel);
  // Populate the feedback thread after the container exists. Guarded so the
  // review panel still works if the feedback module is absent/still loading.
  if (typeof loadMsNotes === 'function') {
    loadMsNotes(jobId, 'msNotesPanel-' + jobId);
  }
}

/**
 * Load the full SES context for a job: the cockpit view first (the authority
 * for status + controls + routes), then the byte-exact reviewable pack when the
 * docket is still in the Docs Ready queue. One stale_review retry: the queue
 * row can lag a fresh docket revision, so on a stale_review refusal we refresh
 * the queue and retry once before surfacing the refusal.
 */
/**
 * When a bound Xero invoice has no signed PDF in the pack, fetch the real
 * Xero-rendered bytes through ops-api get_invoice_pdf and attach them as a
 * synthetic pack artifact so the Invoice tab iframes the bill.
 *
 * Auth note: the dashboard's opsFetch uses the signed-in Supabase user JWT.
 * This is "pack did not supply the document" recovery using that same read
 * path, not a separate browser credential.
 */
async function _msSesHydrateBoundInvoicePdf(ctx) {
  if (!ctx) return;
  var inv = _msSesMapInvoice(ctx);
  if (!inv || !inv.bound_xero || !inv.xero_invoice_id) return;
  var docs = _msSesDocsFromArtifacts(ctx.pack && ctx.pack.artifacts, ctx.portalCaptureFacts);
  var hasPdf = (docs.draft || []).some(function(d) {
    return d && d.kind === 'pdf' && /invoice/i.test(String(d.label || ''));
  });
  if (hasPdf) return;
  if (typeof opsFetch !== 'function') return;
  try {
    var res = await opsFetch('get_invoice_pdf', {
      xero_invoice_id: inv.xero_invoice_id,
    });
    if (!res || !res.success || !res.pdf_base64) return;
    var binary = atob(res.pdf_base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var blob = new Blob([bytes], { type: res.content_type || 'application/pdf' });
    var objectUrl = URL.createObjectURL(blob);
    if (ctx.invoicePdfObjectUrl) {
      try { URL.revokeObjectURL(ctx.invoicePdfObjectUrl); } catch (_e) { /* ignore */ }
    }
    ctx.invoicePdfObjectUrl = objectUrl;
    if (!ctx.pack) ctx.pack = { artifacts: [] };
    if (!Array.isArray(ctx.pack.artifacts)) ctx.pack.artifacts = [];
    // Drop any unavailable marker so the real PDF owns the Invoice tab.
    ctx.pack.artifacts = ctx.pack.artifacts.filter(function(a) {
      return !(a && a.role === 'xero_invoice_pdf' && !a.signed_url);
    });
    var fileName = res.filename || ((inv.invoice_number || 'invoice') + '.pdf');
    ctx.pack.artifacts.push({
      role: 'xero_invoice_pdf',
      media_type: 'application/pdf',
      signed_url: objectUrl,
      object_key: 'xero-invoice-pdfs/' + fileName,
      metadata: {
        xero_invoice_id: inv.xero_invoice_id,
        invoice_number: inv.invoice_number || null,
        status: inv.status || null,
        source: 'get_invoice_pdf_client_fallback',
      },
    });
    if (!ctx.pack.invoice_pdf) {
      ctx.pack.invoice_pdf = {
        source: 'get_invoice_pdf_client_fallback',
        pdf_unavailable: false,
        xero_invoice_id: inv.xero_invoice_id,
        invoice_number: inv.invoice_number || null,
      };
    }
  } catch (e) {
    // Leave the tab on honest unavailable — never invent a tax-invoice HTML page.
    console.warn('[ses] get_invoice_pdf fallback failed for bound invoice', e);
  }
}

/**
 * Read the portal capture MANIFEST (the JSON `portal_roof_report` artifact)
 * off the pack so the capture tab can state when the capture was taken, what
 * the observer actually saw, and which portal share it came from.
 *
 * These are facts about EVIDENCE, so a failed read must never be papered over:
 * on failure the tab still shows the capture and says the capture facts could
 * not be read, which is different from — and never rendered as — "captured
 * now" or "current". The manifest is a few hundred bytes and its signed URL is
 * already in the pack, so this costs one small GET on capture-bearing packs.
 */
async function _msSesHydratePortalCaptureFacts(ctx) {
  if (!ctx || !ctx.pack || !Array.isArray(ctx.pack.artifacts)) return;
  var manifests = [];
  ctx.pack.artifacts.forEach(function(a) {
    if (!a || a.role !== 'portal_roof_report' || !a.signed_url) return;
    // Bytes decide: JSON is the manifest, a PDF/PNG under this role is the
    // capture itself and is handled as a document, not read for facts.
    if (_msSesArtifactIsDocumentBytes(a)) return;
    manifests.push(a);
  });
  if (!manifests.length) return;
  if (typeof fetch !== 'function') { ctx.portalCaptureFactsFailed = true; return; }
  // EVERY manifest is kept: a retake pack can carry one manifest per capture,
  // and each capture's facts must come from the manifest that describes IT
  // (matched by content fingerprint in _msSesCaptureDocs), never inherited
  // from whichever manifest happened to be read last.
  var factsList = [];
  for (var mi = 0; mi < manifests.length; mi++) {
    try {
      var res = await fetch(manifests[mi].signed_url, { cache: 'no-store' });
      if (!res || !res.ok) { ctx.portalCaptureFactsFailed = true; continue; }
      var body = await res.json();
      // The producer writes either the object or a one-entry list of it.
      var facts = Array.isArray(body) ? (body[0] || null) : body;
      if (facts && typeof facts === 'object') factsList.push(facts);
      else ctx.portalCaptureFactsFailed = true;
    } catch (e) {
      ctx.portalCaptureFactsFailed = true;
      console.warn('[ses] portal capture manifest read failed', e);
    }
  }
  if (factsList.length) ctx.portalCaptureFacts = factsList;
}

// Restoration / repair cards can carry a typed job_documents SWMS even when
// the SES docket did not mint a swms_artifact (family recipe says not
// required). The review tabs read docket artifacts only, so that file would
// never appear. Pull the live job document so the SWMS tab still shows.
async function _msSesLoadJobSwmsDoc(jobId) {
  try {
    var data = await opsFetch('job_detail', { jobId: jobId });
    var docs = (data && data.documents) || [];
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!d) continue;
      var type = String(d.type || '').toLowerCase();
      var name = String(d.file_name || d.name || '').toLowerCase();
      if (type !== 'swms' && !/\bswms\b/.test(name)) continue;
      var url = d.pdf_url || d.url || d.storage_url || '';
      if (url && /^https?:\/\//i.test(String(url))) {
        return { url: String(url), file_name: d.file_name || 'SWMS' };
      }
    }
  } catch (_e) {
    /* leave the pane on docket artifacts only */
  }
  return null;
}

function _msSesCanonicalPackDocket(jobId) {
  var meta = (typeof _makesafeCanonicalPackMetaById !== 'undefined')
    ? _makesafeCanonicalPackMetaById[jobId] : null;
  return (meta && meta.docket_revision_id) || null;
}

// Publish pack-derived chip facts onto the board so the card face cannot say
// WO missing / 2/5 while this overlay says 5 of 5 including the work order.
function _msSesStampBoardPackChips(jobId, pack) {
  if (!jobId || !pack) return;
  if (typeof makesafeChipFactsFromSesPack === 'function'
      && typeof _makesafePackChipById !== 'undefined') {
    _makesafePackChipById[jobId] = makesafeChipFactsFromSesPack(pack);
  }
}

async function _msSesLoadPackContext(jobId, retried) {
  var cockpit = await opsFetch('query_ses_review_cockpit', { job_id: jobId });
  var entry = _msSesReviewQueue[jobId] || null;
  if (!entry && !retried) {
    await _msSesRefreshReviewQueue();
    entry = _msSesReviewQueue[jobId] || null;
  }
  var rowDocket = _msSesCanonicalPackDocket(jobId);
  if (!entry && rowDocket) {
    entry = { job_id: jobId, docket_revision_id: rowDocket };
  }
  var ctx = {
    jobId: jobId,
    cockpit: cockpit,
    queueEntry: entry,
    pack: null,
    docketRevisionId: entry ? entry.docket_revision_id : null,
    outputHash: entry ? (entry.docket_output_content_hash || null) : null,
    // No queue entry and no canonical docket means the current docket has
    // already passed the needs_review queue, i.e. its Docs Ready tick is recorded.
    // A drafted pack whose docket id rides on the canonical row is still reviewable.
    reviewState: entry ? (entry.review_state || 'needs_review') : 'signed_off',
    fetchedAt: 0
  };
  if (entry) {
    _msSesLastKnownDocket[jobId] = entry.docket_revision_id;
    try {
      ctx.pack = await opsFetch('get_ses_reviewable_pack', { docket_revision_id: entry.docket_revision_id });
      ctx.fetchedAt = Date.now();
      if (ctx.pack && ctx.pack.docket && ctx.pack.docket.output_content_hash) {
        ctx.outputHash = ctx.pack.docket.output_content_hash;
      }
      if (ctx.pack && ctx.pack.review && ctx.pack.review.review_state) {
        ctx.reviewState = ctx.pack.review.review_state;
      }
      _msSesStampBoardPackChips(jobId, ctx.pack);
    } catch (e) {
      if (_msSesIsStale(e) && !retried) {
        await _msSesRefreshReviewQueue();
        return _msSesLoadPackContext(jobId, true);
      }
      throw e;
    }
    ctx.jobSwmsDoc = await _msSesLoadJobSwmsDoc(jobId);
    return ctx;
  }
  // Signed off: out of the needs_review queue, so nothing on this surface maps
  // the job to its current docket any more. Offer back the revision this
  // session last saw — the server decides whether it is still the current pack
  // (a 409 means it is not, and the documents stay honestly unavailable).
  var remembered = _msSesLastKnownDocket[jobId];
  if (remembered) {
    try {
      var pack = await opsFetch('get_ses_reviewable_pack', { docket_revision_id: remembered });
      ctx.pack = pack;
      ctx.fetchedAt = Date.now();
      ctx.docketRevisionId = remembered;
      if (pack && pack.docket && pack.docket.output_content_hash) {
        ctx.outputHash = pack.docket.output_content_hash;
      }
      if (pack && pack.review && pack.review.review_state) {
        ctx.reviewState = pack.review.review_state;
      }
      _msSesStampBoardPackChips(jobId, pack);
    } catch (_e) {
      // The remembered revision is no longer the current pack (or cannot be
      // read). Leave the honest no-documents state rather than showing an
      // older pack's bytes as though they were this one's.
      ctx.packRecoveryFailed = true;
    }
  }
  ctx.jobSwmsDoc = await _msSesLoadJobSwmsDoc(jobId);
  return ctx;
}

// A 409 from the SES reads/actions is stale ONLY when the server names
// stale_review — the displayed pack or tick no longer matches the current
// docket bytes, so re-fetch and re-render rather than acting on stale bytes.
// Every other 409 (docket_pricing_stale, pricing_evidence_missing, an
// already-bound invoice, a superseded obligation, ...) is a distinct,
// differently-actionable refusal and must fall through to
// _msSesChainStopped(), which prints the server's own words verbatim instead
// of the stale-pack text.
function _msSesIsStale(e) {
  return !!(e && e.refusal && e.refusal.code === 'stale_review');
}

// The operator label recorded on api_key-allowed SES writes (prepare/execute).
// JWT actions take their identity from the verified session server-side.
function _msSesActor() {
  return (typeof _opsUserEmail !== 'undefined' && _opsUserEmail) || null;
}

/**
 * The honest non-SES state: either the job has no current SES docket (the
 * legacy path is retired; nothing here can send) or the cockpit read failed
 * (retry offered). Never calls a legacy action.
 */
function _msSesRenderUnavailable(jobId, base, err, targetPanelId) {
  var isOverlay = !!(targetPanelId && targetPanelId !== 'msReportingDetailPanel');
  var dismissAction = isOverlay ? 'closeMakesafeReportingOverlay()' : 'showMsReportingDetailEmpty()';
  var builder = _msReportingCanonicalBuilderName(base || {});
  var msg = String((err && err.message) || err || '');
  var noDocket = /No current SES docket revision/i.test(msg);
  var html = '';
  html += '<div style="flex-shrink:0;display:flex;align-items:flex-start;gap:12px;padding:16px 20px;background:#fff;border-bottom:1px solid var(--sw-border);">';
  html += '<button onclick="' + dismissAction + '" style="background:none;border:none;color:var(--sw-orange);font-size:13px;font-weight:700;cursor:pointer;padding:4px 0;white-space:nowrap;">&#8592; Back</button>';
  html += '<div style="flex:1;min-width:0;font-size:15px;font-weight:700;color:var(--sw-dark);">' + escapeHtml(builder) + (base && base.external_ref ? ' &middot; ' + escapeHtml(base.external_ref) : '') + '</div>';
  html += '</div>';
  html += '<div style="margin:24px 20px;padding:16px;border-radius:8px;border:1px solid ' + (noDocket ? 'var(--sw-border)' : '#FECACA') + ';background:' + (noDocket ? '#fff' : '#FEF2F2') + ';">';
  if (noDocket) {
    // Mockup State B: the honest not-ready refusal, in its words.
    html += '<div style="font-size:15px;font-weight:700;color:var(--sw-dark);">Draft pack not ready yet</div>';
    html += '<div style="font-size:13px;color:var(--sw-text-sec);margin-top:8px;line-height:1.6;max-width:62ch;">The make-safe report and invoice have not been drafted for this job. Once the reporting routine builds the draft, this same screen turns into the review-and-send pack. Nothing to send yet &mdash; nothing on this screen can send, authorise or charge.</div>';
    html += '<div style="font-size:11.5px;color:var(--sw-mid);margin-top:10px;line-height:1.5;">Technical note: the legacy combined approve/send path is retired server-side (it answers 410) and this screen never calls it.</div>';
  } else {
    html += '<div style="font-size:14px;font-weight:800;color:#991B1B;">The SES review cockpit could not be loaded</div>';
    html += '<div style="font-size:12px;color:#7F1D1D;margin-top:8px;line-height:1.55;">' + escapeHtml(msg || 'Unknown error') + '</div>';
    html += '<button onclick="showMsReportingDetail(\'' + _msJsAttr(jobId) + '\'' + (targetPanelId ? ',\'' + _msJsAttr(targetPanelId) + '\'' : '') + ')" style="margin-top:10px;background:#1F3A44;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Retry</button>';
  }
  html += '</div>';
  return html;
}

// Small drawn marks (stroke inherits currentColor). Real drawn icons, one
// consistent 2px stroke — never unicode stand-ins.
var _MS_SES_ICONS = {
  check: '<svg class="msr-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg class="msr-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  clip: '<svg class="msr-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.2 7.8 8 12a3 3 0 0 1-4.2-4.2L9 2.6a2.1 2.1 0 0 1 3 3L6.9 10.7a1.05 1.05 0 0 1-1.5-1.5l4.2-4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg class="msr-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 14.6 13H1.4L8 2.2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.4v3.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.4" r=".9" fill="currentColor"/></svg>'
};

/**
 * Render the SES review pack. Compact reading order for one-screen approve:
 * identity, ONE next action, hold story when held, document tabs over a short
 * stage (invoice is a DOCUMENT tab), condensed email previews, then photos /
 * trade notes / feedback collapsed by default. PRIMARY ACTIONS sit at the
 * BOTTOM (one APPROVE AND SEND control), armed only when a byte-exact pack and
 * outgoing route preview are visible and the backend control flags allow the
 * next pass. Invoice authorisation repaints a fresh revision for a second
 * Captain review before any send. A disabled stamp stays visible with its
 * reason. No retired 410 combined action.
 */
// Hours/wording edits on the review pane. Applying an edit RECORDS it on the
// exact docket revision via record_ses_review_feedback — the same channel as
// the Feedback composer — so the revised pack the reporting routine assembles
// carries the edit, and APPROVE AND SEND only ever sends a pack that matches
// what is on screen. Until the revised pack lands, the edited values overlay
// this view as an explicit in-flight preview keyed to the docket revision they
// were recorded against, and the press stays locked (see _msSesPreviewOf).
// Nothing here authorises an invoice or releases a route.
var _msSesSendPreview = {};

// The ONE derivation of "this job has an active edit preview". Keyed to the
// docket revision + output hash the edit was recorded against: a ctx carrying
// a different revision (the revised pack, or the invoice-bound repack) clears
// the preview here in the resolver, so a stale edit can never overlay a fresh
// pack's money or routes.
function _msSesPreviewOf(jobId, ctx) {
  var preview = (_msSesSendPreview && _msSesSendPreview[jobId]) || null;
  if (!preview) return null;
  if (ctx && ((preview.docketRevisionId || null) !== (ctx.docketRevisionId || null)
      || (preview.outputHash || null) !== (ctx.outputHash || null))) {
    delete _msSesSendPreview[jobId];
    return null;
  }
  return preview;
}

// A line is labour only when it says so: an explicit labour line type, or a
// description carrying a labour/attendance/make-safe work word without a
// non-labour noun (hire, materials, surcharge...). Never "the first line" and
// never a bare "hour" match — an After Hours Surcharge or a Temp Fence Hire
// line must not be rewritten by an hours edit. Make-safe work lines (e.g.
// SAMPLE-AJS-WALK "…temporary fencing make-safe - 2 trades x 2 hours") are
// labour even when they omit the words labour/attendance.
function _msSesInvoiceLineIsLabour(li) {
  if (!li) return false;
  var typed = String(li.line_type || li.type || '').toLowerCase();
  if (/labou?r/.test(typed)) return true;
  if (typed) return false;
  var desc = String(li.description || '').toLowerCase();
  if (/surcharge|material|hire|equipment|delivery|travel|disposal|skip bin/.test(desc)) return false;
  return /\blabou?r\b|\battendance\b|\bmake[-\s]?safe\b/.test(desc);
}

// Labour hours as the pack itself states them — never the preview.
function _msSesPackLabourHours(ctx) {
  var money = (ctx && ctx.cockpit && ctx.cockpit.sections && ctx.cockpit.sections.money) || {};
  if (money.labour_hours != null && isFinite(Number(money.labour_hours))) {
    return Number(money.labour_hours);
  }
  var proposal = (ctx && ctx.pack && ctx.pack.docket && ctx.pack.docket.local_invoice_proposal)
    || money.local_invoice_proposal || null;
  var lines = proposal && Array.isArray(proposal.line_items) ? proposal.line_items : [];
  for (var i = 0; i < lines.length; i++) {
    var li = lines[i] || {};
    if (li.quantity != null && isFinite(Number(li.quantity)) && _msSesInvoiceLineIsLabour(li)) {
      return Number(li.quantity);
    }
  }
  return null;
}

function _msSesLabourHoursFromCtx(ctx) {
  var preview = ctx && _msSesPreviewOf(ctx.jobId, ctx);
  if (preview && preview.hours != null && isFinite(Number(preview.hours))) {
    return Number(preview.hours);
  }
  return _msSesPackLabourHours(ctx);
}

function _msSesApplyPreviewToProposal(proposal, hours) {
  if (!proposal || hours == null || !isFinite(Number(hours))) return proposal;
  hours = Number(hours);
  var src = proposal;
  var out = {};
  Object.keys(src).forEach(function(k) { out[k] = src[k]; });
  var lines = Array.isArray(src.line_items) ? src.line_items.map(function(li) {
    li = li || {};
    var copy = {};
    Object.keys(li).forEach(function(k) { copy[k] = li[k]; });
    if (!_msSesInvoiceLineIsLabour(li)) return copy;
    var unit = (li.unit_price_ex_gst != null ? Number(li.unit_price_ex_gst) : Number(li.unit_price));
    copy.quantity = hours;
    if (isFinite(unit)) {
      copy.unit_price_ex_gst = unit;
      copy.amount_ex_gst = Math.round(hours * unit * 100) / 100;
    }
    return copy;
  }) : [];
  out.line_items = lines;
  var sub = 0;
  lines.forEach(function(li) {
    if (li && li.amount_ex_gst != null && isFinite(Number(li.amount_ex_gst))) {
      sub += Number(li.amount_ex_gst);
    }
  });
  if (lines.length) {
    out.subtotal_ex_gst = Math.round(sub * 100) / 100;
    out.total_inc_gst = Math.round(sub * 1.1 * 100) / 100;
  }
  return out;
}

function _msSesApplyPreviewToRoutes(routes, preview) {
  if (!Array.isArray(routes) || !preview || !preview.routes) return routes;
  return routes.map(function(r) {
    r = r || {};
    var over = preview.routes[r.route_kind] || preview.routes[String(r.route_kind || '')];
    if (!over) return r;
    var copy = {};
    Object.keys(r).forEach(function(k) { copy[k] = r[k]; });
    if (over.subject != null) copy.subject = over.subject;
    if (over.body != null) copy.body = over.body;
    return copy;
  });
}

function _msSesCtxWithPreview(ctx) {
  if (!ctx) return ctx;
  var preview = _msSesPreviewOf(ctx.jobId, ctx);
  if (!preview) return ctx;
  var out = {};
  Object.keys(ctx).forEach(function(k) { out[k] = ctx[k]; });
  var cockpit = ctx.cockpit ? {} : null;
  if (ctx.cockpit) {
    Object.keys(ctx.cockpit).forEach(function(k) { cockpit[k] = ctx.cockpit[k]; });
    var sections = ctx.cockpit.sections ? {} : null;
    if (ctx.cockpit.sections) {
      Object.keys(ctx.cockpit.sections).forEach(function(k) { sections[k] = ctx.cockpit.sections[k]; });
      if (Array.isArray(sections.email_drafts)) {
        sections.email_drafts = _msSesApplyPreviewToRoutes(sections.email_drafts, preview);
      }
      if (sections.money) {
        var money = {};
        Object.keys(sections.money).forEach(function(k) { money[k] = sections.money[k]; });
        if (preview.hours != null) money.labour_hours = Number(preview.hours);
        if (money.local_invoice_proposal) {
          money.local_invoice_proposal = _msSesApplyPreviewToProposal(
            money.local_invoice_proposal, preview.hours);
        }
        sections.money = money;
      }
      cockpit.sections = sections;
    }
    out.cockpit = cockpit;
  }
  if (ctx.pack && ctx.pack.docket && preview.hours != null) {
    var pack = {};
    Object.keys(ctx.pack).forEach(function(k) { pack[k] = ctx.pack[k]; });
    var docket = {};
    Object.keys(ctx.pack.docket).forEach(function(k) { docket[k] = ctx.pack.docket[k]; });
    if (docket.local_invoice_proposal) {
      docket.local_invoice_proposal = _msSesApplyPreviewToProposal(
        docket.local_invoice_proposal, preview.hours);
    }
    pack.docket = docket;
    out.pack = pack;
  }
  return out;
}

function _msSesRenderSendEditors(jobId, ctx) {
  var routes = ((ctx.cockpit && ctx.cockpit.sections) || {}).email_drafts || [];
  var hours = _msSesLabourHoursFromCtx(ctx);
  var preview = _msSesPreviewOf(jobId, ctx);
  var safeId = _msJsAttr(jobId);
  var html = '<div class="msr-edit" id="msSesEdit-' + safeId + '">';
  html += '<div class="msr-edit-h"><h3>Hours &amp; wording</h3>';
  html += '<span class="msr-sec-note">Edits this pack. Does not send.</span></div>';
  html += '<div class="msr-edit-row">';
  html += '<label class="hours">Hours<input type="number" step="0.5" min="0" id="msSesHours-' + safeId + '" value="'
    + (hours != null ? escapeAttr(String(hours)) : '') + '"></label>';
  html += '<button type="button" class="msr-edit-apply" id="msSesEditApply-' + safeId + '" onclick="_msSesApplySendPreview(\'' + safeId + '\')">Update send pack</button>';
  html += '</div>';
  if (Array.isArray(routes) && routes.length) {
    routes.forEach(function(r, idx) {
      r = r || {};
      var kind = String(r.route_kind || ('route' + idx));
      var label = r.label || _MS_SES_ROUTE_LABELS[r.route_kind] || kind;
      html += '<label>' + escapeHtml(label) + ' subject';
      html += '<input type="text" data-ses-edit="subject" data-route-kind="' + escapeAttr(kind) + '" value="'
        + escapeAttr(r.subject || '') + '"></label>';
      html += '<label>' + escapeHtml(label) + ' wording';
      html += '<textarea data-ses-edit="body" data-route-kind="' + escapeAttr(kind) + '">'
        + escapeHtml(r.body || '') + '</textarea></label>';
    });
  }
  html += '<p class="msr-edit-note' + (preview ? ' ok' : '') + '">';
  html += preview
    ? 'Your edits are recorded on this docket and shown below as the send preview. APPROVE AND SEND stays locked until the revised pack carrying them lands here. Nothing has been sent or authorised.'
    : 'Change hours or wording, then Update send pack. The edit is recorded on this exact docket, the emails and invoice below preview it, and the press unlocks on the revised pack that carries it.';
  html += '</p></div>';
  return html;
}

// The route edits actually entered, compared against what the pack itself says.
// Only a CHANGED subject/body counts — an untouched field is not an edit.
function _msSesCollectRouteEdits(jobId, ctx) {
  var edits = {};
  var host = _msSesScopedEl(jobId, 'msSesEdit-' + jobId);
  if (!host || !host.querySelectorAll) return edits;
  var byKind = {};
  var routes = ((ctx.cockpit && ctx.cockpit.sections) || {}).email_drafts || [];
  (Array.isArray(routes) ? routes : []).forEach(function(r) {
    if (r && r.route_kind != null) byKind[String(r.route_kind)] = r;
  });
  host.querySelectorAll('[data-ses-edit][data-route-kind]').forEach(function(el) {
    var kind = el.getAttribute('data-route-kind');
    var field = el.getAttribute('data-ses-edit');
    if (!kind || (field !== 'subject' && field !== 'body')) return;
    var base = byKind[kind] ? String(byKind[kind][field] || '') : '';
    var entered = String(el.value == null ? '' : el.value);
    if (entered === base) return;
    if (!edits[kind]) edits[kind] = {};
    edits[kind][field] = entered;
  });
  return edits;
}

// Apply the entered hours/wording: record them on the exact docket revision via
// record_ses_review_feedback (identified-operator JWT — the same channel and
// payload shape as the Feedback composer), then keep them as the on-screen send
// preview keyed to that revision. The backend invalidates the pack's readiness,
// the reporting routine assembles a revised pack carrying the edits, and the
// press unlocks on that pack — so what sends is always what the screen shows.
// Nothing here approves an invoice or releases a route.
async function _msSesApplySendPreview(jobId) {
  var ctx = _msSesPackCache[jobId];
  if (!ctx) return;
  if (!ctx.docketRevisionId) {
    showToast('This pack has already passed Docs Ready review, so edits can no longer be recorded on it.', 'error');
    return;
  }
  var hoursEl = _msSesScopedEl(jobId, 'msSesHours-' + jobId);
  var hoursVal = hoursEl ? parseFloat(hoursEl.value) : NaN;
  var baseHours = _msSesPackLabourHours(ctx);
  var routeEdits = _msSesCollectRouteEdits(jobId, ctx);
  var preview = {
    docketRevisionId: ctx.docketRevisionId || null,
    outputHash: ctx.outputHash || null,
    routes: routeEdits
  };
  var noteLines = [];
  if (isFinite(hoursVal) && hoursVal >= 0 && hoursVal !== baseHours) {
    preview.hours = hoursVal;
    noteLines.push('Set the invoice labour hours to ' + hoursVal
      + (baseHours != null ? ' (currently ' + baseHours + ')' : '') + '.');
  }
  Object.keys(routeEdits).forEach(function(kind) {
    var label = _MS_SES_ROUTE_LABELS[kind] || (kind + ' email');
    if (routeEdits[kind].subject != null) {
      noteLines.push('Use this subject for the ' + label + ': ' + routeEdits[kind].subject);
    }
    if (routeEdits[kind].body != null) {
      noteLines.push('Use this wording for the ' + label + ':\n' + routeEdits[kind].body);
    }
  });

  function repaint() {
    var panel = document.getElementById(ctx.panelId || 'msReportingDetailPanel');
    if (!panel) return;
    panel.innerHTML = _msSesRenderDetail(jobId, ctx, ctx.panelId);
    _msHydratePdfSurfaces(panel);
    if (typeof loadMsNotes === 'function') {
      loadMsNotes(jobId, 'msNotesPanel-' + jobId);
    }
  }

  if (!noteLines.length) {
    var recorded = _msSesPreviewOf(jobId, ctx);
    if (!recorded) {
      delete _msSesSendPreview[jobId];
      showToast('No changes to record — the pack already matches these values.', 'info');
      repaint();
      return;
    }
    // Retyping the pack's original values WITHDRAWS the recorded edit: the
    // withdrawal is itself recorded on the docket (the earlier note must not
    // be applied by the revise pass), and the press re-arms only from a fresh
    // pack read — never from this stale context.
    var withdrawLines = ['Withdraw the earlier review edits below — keep the pack as drafted.'];
    if (recorded.hours != null) {
      withdrawLines.push('Withdrawn: set the invoice labour hours to ' + recorded.hours + '.');
    }
    Object.keys(recorded.routes || {}).forEach(function(kind) {
      var wLabel = _MS_SES_ROUTE_LABELS[kind] || (kind + ' email');
      if (recorded.routes[kind].subject != null) {
        withdrawLines.push('Withdrawn: the edited subject for the ' + wLabel + '.');
      }
      if (recorded.routes[kind].body != null) {
        withdrawLines.push('Withdrawn: the edited wording for the ' + wLabel + '.');
      }
    });
    var wBtn = _msSesScopedEl(jobId, 'msSesEditApply-' + jobId);
    if (wBtn) { wBtn.disabled = true; wBtn.textContent = 'Recording...'; }
    var wAuthor = (typeof _MS_NOTES_DEFAULT_AUTHOR !== 'undefined' && _MS_NOTES_DEFAULT_AUTHOR) || 'Ops';
    try {
      await opsPostJwt('record_ses_review_feedback', {
        docket_revision_id: ctx.docketRevisionId,
        job_id: jobId,
        change_type: 'human_review_feedback',
        before: null,
        after: { note: withdrawLines.join('\n'), author: wAuthor }
      });
    } catch (e) {
      showToast('The withdrawal could not be recorded on the docket: ' + ((e && e.message) || e), 'error');
      if (wBtn) { wBtn.disabled = false; wBtn.textContent = 'Update send pack'; }
      return;
    }
    if (typeof _msSesEchoCache !== 'undefined' && _msSesEchoCache) {
      _msSesEchoCache[jobId] = (_msSesEchoCache[jobId] || []).concat([{
        role: 'human',
        author: wAuthor,
        body: withdrawLines.join('\n'),
        created_at: new Date().toISOString(),
        ses_recorded: true
      }]);
    }
    delete _msSesSendPreview[jobId];
    showToast('Earlier edits withdrawn on the SES docket. Re-reading the pack before the press can re-arm.', 'success');
    _msSesReloadDetail(jobId);
    return;
  }

  // Re-pressing with nothing new entered must not re-record the same feedback.
  var active = _msSesPreviewOf(jobId, ctx);
  if (active && JSON.stringify({ h: active.hours, r: active.routes })
      === JSON.stringify({ h: preview.hours, r: preview.routes })) {
    showToast('These edits are already recorded on this docket — waiting for the revised pack.', 'info');
    repaint();
    return;
  }

  var btn = _msSesScopedEl(jobId, 'msSesEditApply-' + jobId);
  if (btn) { btn.disabled = true; btn.textContent = 'Recording...'; }
  var author = (typeof _MS_NOTES_DEFAULT_AUTHOR !== 'undefined' && _MS_NOTES_DEFAULT_AUTHOR) || 'Ops';
  try {
    await opsPostJwt('record_ses_review_feedback', {
      docket_revision_id: ctx.docketRevisionId,
      job_id: jobId,
      change_type: 'human_review_feedback',
      before: null,
      after: { note: noteLines.join('\n'), author: author }
    });
  } catch (e) {
    showToast('The edit could not be recorded on the docket: ' + ((e && e.message) || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Update send pack'; }
    return;
  }
  // Echo into the session feedback thread (docket feedback has no read-back).
  if (typeof _msSesEchoCache !== 'undefined' && _msSesEchoCache) {
    _msSesEchoCache[jobId] = (_msSesEchoCache[jobId] || []).concat([{
      role: 'human',
      author: author,
      body: noteLines.join('\n'),
      created_at: new Date().toISOString(),
      ses_recorded: true
    }]);
  }
  _msSesSendPreview[jobId] = preview;
  showToast('Edits recorded on the SES docket. The revised pack will carry them; the send preview below shows them now.', 'success');
  repaint();
}

function _msSesRenderDetail(jobId, ctx, targetPanelId) {
  ctx = _msSesCtxWithPreview(ctx);
  var base = _msReportingCache[jobId] || { job_id: jobId };
  var row = _msSesSynthRow(jobId, ctx);
  // The doc-tab switcher + shared renderers read the synthesized row from the
  // shared cache; the list re-seeds the cache on every load.
  _msReportingCache[jobId] = row;
  var safeId = _msJsAttr(jobId);
  var safeJobKey = _msDocTabKey(jobId);
  var builder = _msReportingCanonicalBuilderName(base);
  var isOverlay = !!(targetPanelId && targetPanelId !== 'msReportingDetailPanel');
  var dismissAction = isOverlay ? 'closeMakesafeReportingOverlay()' : 'showMsReportingDetailEmpty()';
  var cockpit = ctx.cockpit || {};
  var statusChip = _msSesStatusChip(cockpit.status);
  if (cockpit.status === 'HOLD') {
    // The review pane uses amber for HOLD; the shared board-card chip remains unchanged.
    statusChip = { label: statusChip.label, bg: '#B45309', fg: '#fff' };
  }

  var docTabs = _msReportingDocTabs(row);
  if (typeof _msActiveDocTab[jobId] !== 'number' || _msActiveDocTab[jobId] >= docTabs.length) {
    _msActiveDocTab[jobId] = 0;
  }
  var activeTab = _msActiveDocTab[jobId];

  var html = '';

  // ── JOB HEADER ─────────────────────────────────────────────────────────────
  var _rawFamily = base.makesafe_job_family;
  var _familyLabel = base.makesafe_job_family_label ||
    (typeof getMakesafeFamilyLabel === 'function' ? getMakesafeFamilyLabel(_rawFamily) : '') ||
    (_rawFamily ? String(_rawFamily).replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) : '');
  var typeLabel = _familyLabel || base.makesafe_type || base.makesafe_type_detail || base.job_type || 'Make safe';
  typeLabel = String(typeLabel).toUpperCase();
  html += '<div class="msr-head">';
  html += '<button type="button" class="msr-back" onclick="' + dismissAction + '">&#8592; Back</button>';
  html += '<div class="msr-head-main">';
  html += '<h2 class="msr-title">';
  html += '<span class="msr-title-name">' + escapeHtml(builder) + '</span>';
  if (base.external_ref) html += '<span class="msr-ref">&middot; ' + escapeHtml(base.external_ref) + '</span>';
  html += '<span class="msr-chip family">' + escapeHtml(typeLabel) + '</span>';
  html += '</h2>';
  // Identity: job number + suburb only on this surface (no client name / street).
  var headerBits = [];
  if (base.job_number) headerBits.push(['Job', base.job_number]);
  if (base.site_suburb) headerBits.push(['Suburb', base.site_suburb]);
  if (headerBits.length) {
    html += '<div class="msr-submeta">';
    headerBits.forEach(function(pair) {
      html += '<span><b>' + escapeHtml(pair[0]) + '</b> ' + escapeHtml(String(pair[1])) + '</span>';
    });
    html += '</div>';
  }
  // Live portal reader capture: the stored screenshot + honest chip the board
  // card also shows, looked up by job id from the canonical board feed. The
  // pack-driven "Builder portal" evidence + capture doc tab below are unchanged;
  // this is the same at-a-glance thumb the kanban card carries. Defensive: only
  // when ops.html is present and the board has a capture for this job.
  if (typeof renderMakesafePortalThumbForJob === 'function') {
    var portalThumb = renderMakesafePortalThumbForJob(jobId, 'review');
    if (portalThumb) html += '<div class="msr-portal-thumb-row">' + portalThumb + '</div>';
  }
  html += '</div>';
  html += '<div class="msr-state"><span class="msr-chip" style="background:' + statusChip.bg + ';color:' + statusChip.fg + ';">' + escapeHtml(statusChip.label) + '</span></div>';
  html += '</div>';

  // Scrollable body — proof only. Stamps live in the pinned foot below
  // (.msr-actions-foot, a flex sibling of this body, NOT position:sticky).
  html += '<div class="msr-body">';

  // ── ONE clear next action ─────────────────────────────────────────────────
  html += _msSesNextAction(cockpit);

  // ── DONE checklist: what is complete on this pack, before any document ────
  html += _msSesRenderDoneStrip(row, ctx);
  html += _msSesPackTruthNotice(ctx);

  // ── Hours & wording: the send-preview editors. Feedback stays for the rest.
  html += _msSesRenderSendEditors(jobId, ctx);

  // ── The hold story: ONE amber block, numbered verbatim blockers, each with
  //    its plain-English clear path. Amber is a machine stop wanting a person;
  //    red stays reserved for a read that actually failed. ───────────────────
  if (cockpit.status === 'HOLD') {
    html += _msSesRenderHoldBanner(cockpit);
  }
  if (_msIsPortalBuilder(base)) {
    html += '<div class="msr-banner info">';
    html += '<div class="msr-banner-title">Portal builder</div>';
    html += 'Portal capture evidence is recorded by the capture tooling &mdash; this screen cannot submit to the builder portal (portal capture pending backend wiring).';
    html += '</div>';
  }

  // ── Stale banner (defensive: we never pass a displayed binding) ───────────
  if (cockpit.stale) {
    html += '<div class="msr-banner stop">';
    html += '<div class="msr-banner-title">This view is out of date</div>';
    html += 'The pack moved on after this screen was loaded &mdash; close and reopen it before acting.';
    html += '</div>';
  }

  // ── DOCUMENTS — tabs over ONE compact stage. The invoice is a document
  //    here: a tab like the report, never a separate section. ────────────────
  html += '<div class="msr-sec"><h3>Documents</h3><span class="msr-sec-note">click a tile to read it here</span></div>';
  if (docTabs.length) {
    html += '<div id="msDocTabs_' + safeJobKey + '" class="msr-tabs" role="tablist" aria-label="Pack documents">';
    docTabs.forEach(function(t, i) {
      var active = (i === activeTab);
      // TILE, not a word: a preview (the image itself, or a drawn page mark for
      // a PDF) over the stored file name, with the document's name last so the
      // tile still reads as its label. Clicking it opens the document INLINE on
      // the same stage below — the reading the captain kept.
      html += '<button type="button" role="tab" class="msr-tab tile" aria-selected="' + (active ? 'true' : 'false') + '" data-tabidx="' + i + '" data-doc-url="' + escapeAttr(t.url || '') + '" onclick="_msSwitchDocTab(\'' + safeId + '\',' + i + ',\'' + escapeAttr(targetPanelId || 'msReportingDetailPanel') + '\')">'
        + _msSesTileThumb(t)
        + '<span class="msr-tile-file">' + escapeHtml(_msSesTileFileName(t)) + '</span>'
        + escapeHtml(t.tabLabel) + '</button>';
    });
    html += '</div>';
    // Stage (fit-to-page). Signed URLs live 300s; tab switches past that age
    // re-fetch the pack first (see _msSwitchDocTab).
    html += '<div id="msDocStage_' + safeJobKey + '" class="msr-stage-wrap">' + _msRenderDocStage(docTabs, activeTab, row) + '</div>';
  } else {
    html += '<div class="msr-panel"><div class="msr-empty-note">'
      + (ctx.pack
        ? 'No documents are attached to this pack yet.'
        : 'The documents are not viewable here right now. This pack has already passed Docs Ready review, and the byte-exact pack (every document, including any portal capture) is only served while the pack sits in the review queue'
          + (ctx.packRecoveryFailed
            ? '. The revision this screen last saw is no longer the current one, so nothing here is shown in its place.'
            : '.')
          + ' This is an absence of the VIEW, not evidence that a document is missing. The emails below are the current truth.')
      + '</div></div>';
  }
  // The builder portal deliverables: observed state plus the live page.
  html += _msSesRenderPortalEvidence(row, ctx);
  // A card that owes a portal capture and has none says so HERE, where the
  // capture tab would be — an absent tab alone reads as "nothing to show".
  html += _msSesCaptureNotice(row, ctx);
  // RV-1: a missing document is NAMED, never an empty frame.
  html += _msSesMissingLine(row, ctx);

  // ── OUTGOING EMAILS — condensed previews (AJS may show intended 2-email shape) ─
  html += _msSesRenderRoutes(ctx, base);

  // ── PHOTOS — collapsed by default; calm grid when opened ──────────────────
  var photosHtml = _msSesRenderPhotos(ctx);
  if (photosHtml) {
    html += '<details class="msr-fold">';
    html += '<summary class="msr-sec"><h3>Photos</h3><span class="msr-sec-note">fixed in the release &mdash; open to view</span></summary>';
    html += photosHtml;
    html += '</details>';
  }

  // ── TRADE NOTES — collapsed by default ────────────────────────────────────
  if (base.trade_notes && String(base.trade_notes).trim()) {
    html += '<details class="msr-fold">';
    html += '<summary class="msr-sec"><h3>Trade notes</h3><span class="msr-sec-note">raw from the submission</span></summary>';
    html += '<div class="msr-panel"><div class="msr-notes">' + escapeHtml(base.trade_notes) + '</div></div>';
    html += '</details>';
  }

  // ── FEEDBACK — collapsed by default while the thread is empty and healthy.
  //    _msSesOnFeedbackThreadRendered opens it once the thread loads with
  //    something in it, or fails to load: a recorded note and a read failure
  //    must never be invisible inside a closed fold. ───────────────────────────
  html += '<details class="msr-fold" id="msFeedbackFold-' + safeId + '">';
  html += '<summary class="msr-sec"><h3>Feedback</h3><span class="msr-sec-note" id="msFeedbackFoldNote-' + safeId + '">' + _MS_SES_FEEDBACK_FOLD_NOTE + '</span></summary>';
  html += '<div id="msNotesPanel-' + safeId + '" class="msr-fb-host"></div>';
  html += '</details>';

  html += '<div class="msr-foot"><button type="button" class="msr-btn ghost" onclick="' + dismissAction + '">Hold for later</button></div>';

  html += '</div>'; // end scroll body

  // ── PRIMARY ACTIONS AT THE BOTTOM — pinned foot outside the scroll body
  //    (a flex sibling, not position:sticky); flags arm the stamps ───────────
  html += '<div class="msr-actions msr-actions-foot">';
  html += _msSesActionBlock(jobId, ctx, dismissAction);
  html += '</div>';

  return html;
}

// The Feedback fold's resting summary note, before the thread has loaded.
var _MS_SES_FEEDBACK_FOLD_NOTE = 'the next run reads what you write here';

/**
 * Resolve a per-job element inside the panel that OWNS the open detail
 * (`ctx.panelId`, recorded by showMsReportingDetail). This pane renders into
 * two hosts — the inline Approvals panel and the board overlay — and both can
 * hold the same job at once, so a bare getElementById returns whichever copy is
 * first in the DOM and writes land on the hidden one. Same hazard, and the same
 * defence, as _msSwitchDocTab's scoped stage lookup. Shared with the feedback
 * module, which resolves its own thread host and composer through it.
 */
function _msSesScopedEl(jobId, elementId) {
  var ctx = _msSesPackCache[jobId];
  var panelId = (ctx && ctx.panelId) || null;
  var panel = panelId ? document.getElementById(panelId) : null;
  if (panel && panel.querySelector) {
    var scoped = panel.querySelector('[id="' + String(elementId).replace(/["\\]/g, '\\$&') + '"]');
    if (scoped) return scoped;
  }
  return document.getElementById(elementId);
}

/**
 * Called by the feedback module every time it renders the thread for a job
 * (modules/ops-makesafe-feedback-notes.js: loadMsNotes). The fold stays
 * collapsed only while the thread is empty AND healthy: recorded feedback gets
 * a count on the summary and opens the fold, and a load failure opens it too,
 * because an error rendered inside a closed <details> is an invisible error.
 */
function _msSesOnFeedbackThreadRendered(jobId, state) {
  state = state || {};
  var fold = _msSesScopedEl(jobId, 'msFeedbackFold-' + jobId);
  var note = _msSesScopedEl(jobId, 'msFeedbackFoldNote-' + jobId);
  var count = Number(state.count) || 0;
  if (state.failed) {
    if (note) note.textContent = 'could not load — open to read the error';
    if (fold) fold.open = true;
    return;
  }
  if (count > 0) {
    if (note) note.textContent = count + ' recorded — open to read';
    if (fold) fold.open = true;
    return;
  }
  if (note) note.textContent = _MS_SES_FEEDBACK_FOLD_NOTE;
}

/**
 * The one next action, chosen from preview availability and backend controls.
 * It never names an action the backend has not enabled.
 */
function _msSesNextAction(cockpit) {
  var controls = (cockpit && cockpit.controls) || {};
  var hold = _msSesClassifyHold(cockpit);
  var routePreviewLoaded = _msSesHasRenderableRoutePreview(cockpit);
  var cls = '';
  var text;
  var caveatLead = hold.blockers.length
    ? ('Review <strong>' + hold.blockers.length + ' caveat' + (hold.blockers.length === 1 ? '' : 's') + '</strong> below, then ')
    : '';
  if ((controls.send_it && controls.send_it.enabled) ||
      (controls.approve_invoice && controls.approve_invoice.enabled)) {
    if (!routePreviewLoaded) {
      text = 'Nothing to press yet &mdash; the outgoing email preview is not available. Reopen this pack once its recipients and attachments are shown.';
    } else if (controls.send_it && controls.send_it.enabled &&
        !(controls.approve_invoice && controls.approve_invoice.enabled)) {
      text = caveatLead + 'press <strong>APPROVE AND SEND</strong>. It records your approval for this exact pack and emails the report, the photos and the invoice exactly as shown below.';
    } else {
      text = caveatLead + 'check the Invoice tile and press <strong>APPROVE AND SEND</strong>. This pass authorises the Xero draft invoice already prepared for the pack, then reloads the invoice-bound revision for you to review before a second press sends anything.';
    }
  } else {
    text = 'Nothing to press yet &mdash; the system is still preparing this pack. Review it and leave feedback if something looks wrong.';
  }
  return '<div class="msr-next' + cls + '"><span class="msr-next-k">Next</span><span class="msr-next-v">' + text + '</span></div>';
}

// ── HOLD STORY (verbatim facts + backend recovery_action when supplied) ─────

/**
 * Normalise one hold blocker to { fact, recovery_action, evidence }.
 * Prefer the structured verdict.blockers objects (PR 563 honesty fields);
 * fall back to sections.status.reasons strings when the structured list is
 * absent. Facts are never rewritten — only selected and deduped.
 */
function _msSesNormaliseBlocker(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    var s = String(raw).trim();
    return s ? { fact: s, recovery_action: null, evidence: null } : null;
  }
  if (typeof raw !== 'object') return null;
  var fact = String(raw.fact == null ? (raw.reason == null ? '' : raw.reason) : raw.fact).trim();
  if (!fact) return null;
  var recovery = raw.recovery_action != null ? String(raw.recovery_action).trim() : '';
  var evidence = (raw.evidence && typeof raw.evidence === 'object') ? raw.evidence : null;
  return {
    fact: fact,
    recovery_action: recovery || null,
    evidence: evidence
  };
}

/**
 * The route a blocker belongs to, as a short label for the fact line. The FACT
 * itself is never rewritten (it renders verbatim) — this is a separate tag, so
 * a photo-route refusal and a report-route refusal carrying the same generic
 * fact string read as two distinct holds instead of two identical lines.
 */
function _msSesBlockerRouteLabel(b) {
  var kind = (b && b.evidence && b.evidence.route_kind != null) ? String(b.evidence.route_kind).trim() : '';
  if (!kind) return '';
  var key = kind.toLowerCase();
  if (_MS_SES_ROUTE_LABELS[key]) return _MS_SES_ROUTE_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1) + ' route';
}

/**
 * Dedupe key = exactly what the list item RENDERS: the fact text
 * (case-insensitive), the route label, and the resolved clear path. Two
 * entries collapse only when the captain would see two byte-identical items —
 * the documented live bug where the backend emits the same blocker once per
 * route. A genuinely route-specific or differently-remedied hold survives.
 */
function _msSesBlockerDedupeKey(b) {
  var factKey = String(b.fact || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
  var route = _msSesBlockerRouteLabel(b).toLowerCase();
  var clears = String(_msSesBlockerClears(b) || '').toLowerCase().replace(/\s+/g, ' ');
  return factKey + '|' + route + '|' + clears;
}

function _msSesDedupeBlockers(raw) {
  var seen = {};
  var out = [];
  (Array.isArray(raw) ? raw : []).forEach(function(r) {
    var b = _msSesNormaliseBlocker(r);
    if (!b) return;
    var key = _msSesBlockerDedupeKey(b);
    if (seen[key]) return;
    seen[key] = true;
    out.push(b);
  });
  return out;
}

/**
 * The deduped hold blockers. Source of truth is cockpit.verdict.blockers when
 * the backend sends it (each entry may carry recovery_action + evidence.route_kind);
 * otherwise sections.status.reasons (legacy string list).
 * The structured list only wins when it actually YIELDS facts: a blockers array
 * whose entries all normalise away (no fact/reason text) must not silence the
 * reasons strings, or the hold block says "cannot move" and names nothing.
 */
function _msSesHoldBlockers(cockpit) {
  var verdict = (cockpit && cockpit.verdict) || {};
  var sections = (cockpit && cockpit.sections) || {};
  var out = _msSesDedupeBlockers(verdict.blockers);
  if (out.length) return out;
  return _msSesDedupeBlockers(sections.status && sections.status.reasons);
}

/**
 * Identify the outgoing-email-draft caveat so its line can say it normally
 * fills itself in on the next reporting run. Captain ruling 2026-08-24 makes
 * every listed issue a review caveat rather than a client-side send wall; this
 * predicate now controls only that explanatory hint.
 */
function _msSesBlockerIsSoftDraft(b) {
  var code = String((b && b.code) || '');
  // The coded refusal is the family. Regex on facts keeps missing the next
  // live phrasing (SWMS-261237: "report invoice email is not marked ready").
  if (code === 'route_draft_missing') return true;
  var fact = String((b && b.fact) || '').toLowerCase();
  // Every phrasing the backend uses for "an outgoing email is not drafted yet".
  // The old test only caught "email draft" and the exact "no draft on docket";
  // live packs say "REPORT/PHOTO/INVOICE EMAIL — no draft on CURRENT docket",
  // which slipped through and (wrongly) HARD-locked SEND. Match the family:
  //   - anything naming an email draft ("email draft", "email is not drafted"),
  //   - "no draft on [current] docket" with the optional interior word,
  //   - a "… EMAIL … no draft / not drafted / missing draft" caveat,
  //   - "email is not marked ready" (C11 on an AJS DRAFT pack).
  // The auto-fill hint is for outgoing EMAIL drafts only. A missing REPORT
  // DOCUMENT / invoice / work order remains a different caveat, so every branch
  // is anchored on "email" or the "no draft on docket" idiom — never on the
  // bare word "report"/"invoice".
  if (/email\s*draft/.test(fact)) return true;
  if (/no\s+draft\s+on\s+(?:\w+\s+)?docket/.test(fact)) return true;
  if (/\bemail\b/.test(fact) && /\b(no|not|missing|pending|awaiting)\b[^.]*\bdraft(?:ed)?\b/.test(fact)) return true;
  if (/\bemail\b/.test(fact) && /\bnot\s+marked\s+ready\b/.test(fact)) return true;
  return false;
}

/**
 * Classify a cockpit's hold for presentation. Captain ruling 2026-08-24 makes
 * every backend blocker a review caveat on this surface: missing artifacts,
 * route drafts and pricing warnings remain visible, but none becomes a second
 * client-side authority that can wall an otherwise backend-armed press.
 */
function _msSesClassifyHold(cockpit) {
  var onHold = !!(cockpit && cockpit.status === 'HOLD');
  var blockers = onHold ? _msSesHoldBlockers(cockpit) : [];
  return { onHold: onHold, blockers: blockers, soft: blockers.slice(), hard: [], hardHold: false };
}

// Fallback only — used when the backend does NOT supply recovery_action.
// These are PROCESS explanations (how this pipeline works), not claims about
// the job's state. A supplied recovery_action always wins and is never
// overwritten. Order matters: more specific patterns sit above the catch-all
// /report/ one.
var _MS_SES_BLOCKER_CLEARS = [
  [/work\s*order|builder\s*instruction/i,
    'Get the builder’s work order onto this job — attach it, or ask the builder to resend it. The pack rebuilds and re-checks on its own.'],
  [/email\s*draft/i,
    'The system still has to draft this email. It normally clears on the next run of the reporting routine; if it stays stuck, say so in Feedback below.'],
  [/xero\s*invoice/i,
    'This clears from this screen: APPROVE INVOICE authorises the Xero draft invoice already prepared for this pack. Clear any other blockers first and the stamp unlocks.'],
  [/rate|price|pricing|schedule|labour|invoice\s*line/i,
    'Confirm the right figure in Feedback below. The next pack rebuild re-prices the invoice and this check runs again.'],
  [/photo/i,
    'The photos have to reach this job (trade upload, or attach them from the intake email); the next pack rebuild picks them up.'],
  [/swms/i,
    'The SWMS has to be generated or attached before this pack can go.'],
  [/completion\s*report|report/i,
    'The system has to draft the completion report from the trade submission. If it keeps failing, say so in Feedback below.']
];

/**
 * The plain-English path that clears a blocker.
 * Prefer the backend's recovery_action when present; fall back to the local
 * pattern table only when it is genuinely absent.
 */
function _msSesBlockerClears(blocker) {
  var b = (blocker && typeof blocker === 'object') ? blocker : { fact: String(blocker || ''), recovery_action: null };
  if (b.recovery_action) return String(b.recovery_action);
  var reason = String(b.fact || '');
  for (var i = 0; i < _MS_SES_BLOCKER_CLEARS.length; i++) {
    if (_MS_SES_BLOCKER_CLEARS[i][0].test(reason)) return _MS_SES_BLOCKER_CLEARS[i][1];
  }
  return 'Fix the thing it names, then the pack rebuilds and re-checks itself. If you cannot fix it from here, say so in Feedback below.';
}

/**
 * The single amber hold block: numbered blockers, deduped, each stating the
 * backend's fact VERBATIM plus the recovery path (backend recovery_action
 * when supplied, else the local fallback table).
 */
function _msSesRenderHoldBanner(cockpit) {
  var cls = _msSesClassifyHold(cockpit);
  var blockers = cls.blockers;
  var n = blockers.length;
  if (!n) {
    // Held with nothing to name: one calm line, no essay.
    return '<div class="msr-hold soft"><div class="msr-hold-h">On hold</div>'
      + '<div class="msr-hold-oneline">The system paused this pack. If that looks wrong, say so in Feedback below.</div></div>';
  }
  // Every hold is a calm review warning. The exact backend facts stay verbatim;
  // only the rejected client-side hard-stop interpretation is gone.
  var html = '<div class="msr-hold soft">';
  html += '<div class="msr-hold-h">Review &mdash; '
    + n + ' caveat' + (n === 1 ? '' : 's') + '</div>';
  // Each caveat is ONE compact line: route tag + the backend fact, verbatim.
  // No per-blocker essay, no "what clears it" wall, no "no override" copy.
  html += '<ul class="msr-blockers">';
  blockers.forEach(function(b) {
    var route = _msSesBlockerRouteLabel(b);
    var isSoft = _msSesBlockerIsSoftDraft(b);
    html += '<li class="msr-blocker' + (isSoft ? ' soft' : '') + '">'
      + (route ? '<span class="msr-blocker-route">' + escapeHtml(route) + '</span> ' : '')
      + '<span class="msr-blocker-fact">' + escapeHtml(b.fact) + '</span>'
      + (isSoft ? '<span class="msr-blocker-auto">fills in on the next run</span>' : '')
      + '</li>';
  });
  html += '</ul>';
  html += '</div>';
  return html;
}

// <ses-roof-capture-absence>
/** The cockpit's family_evidence block, or {} when the read carries none. */
function _msSesFamilyEvidence(ctx) {
  var sections = (ctx && ctx.cockpit && ctx.cockpit.sections) || {};
  var fe = sections.family_evidence;
  return (fe && typeof fe === 'object') ? fe : {};
}

function _msSesRequiredDocumentOwed(ctx, key) {
  var verdict = ctx && ctx.packCompleteness;
  if (!verdict || verdict.requirements_resolved !== true) return null;
  var required = verdict.required_documents;
  return required && typeof required[key] === 'boolean' ? required[key] : null;
}

/**
 * Does this card OWE a portal capture? The backend's family_evidence answers it
 * (`roof_report_capture`, marked not_applicable on families that owe none); the
 * card's own roof family is the fallback when a cockpit read carries no
 * family_evidence at all. Anything else is "not owed", so ordinary make-safes
 * gain no new noise.
 */
function _msSesCaptureExpectation(ctx, row) {
  var entry = _msSesFamilyEvidence(ctx).roof_report_capture;
  if (entry && typeof entry === 'object') {
    var state = String(entry.state || '').toLowerCase();
    if (state === 'not_applicable') return { expected: false, entry: entry, state: state };
    return { expected: true, entry: entry, state: state };
  }
  var family = String((row && row.makesafe_job_family) || '').toLowerCase();
  var familyLabel = String((row && row.makesafe_job_family_label) || '').toLowerCase();
  if (/roof/.test(family) || /roof/.test(familyLabel)) {
    return { expected: true, entry: null, state: null };
  }
  return { expected: false, entry: null, state: null };
}

/**
 * MISSING EVIDENCE MUST LOOK MISSING. On a card that owes a portal capture and
 * has none in its pack, an absent tab reads as "nothing to show" and invites
 * approval on a false impression — so the gap is stated where the tabs are, in
 * the same place the capture would have been. Nothing is substituted: this
 * screen never borrows another card's document to fill the hole, and it changes
 * no gate. Returns '' when a capture is present, when none is owed, or when the
 * byte-exact pack is not in view at all (nothing to be sure about).
 */
function _msSesCaptureNotice(row, ctx) {
  if (!ctx || !ctx.pack) return '';
  var draft = Array.isArray(row.draft_docs) ? row.draft_docs : [];
  if (draft.some(function(d) { return d && d.isCapture; })) return '';
  var exp = _msSesCaptureExpectation(ctx, row);
  if (!exp.expected) return '';
  var html = '<div class="msr-evidence-gap">';
  html += '<div class="msr-evidence-gap-h">No portal capture in this pack</div>';
  html += '<div>This card is evidenced by the builder portal form, and no capture of that form is attached here. '
    + 'Nothing on this screen shows what was submitted, so do not read the other tabs as the roof report.</div>';
  var entry = exp.entry || {};
  if (entry.reason) {
    html += '<div class="msr-evidence-gap-fact"><b>The pack says</b>' + escapeHtml(String(entry.reason)) + '</div>';
  }
  if (entry.recovery_action) {
    html += '<div class="msr-evidence-gap-fact"><b>What clears it</b>' + escapeHtml(String(entry.recovery_action)) + '</div>';
  }
  html += '</div>';
  return html;
}
// </ses-roof-capture-absence>

// <ses-portal-link-openers>
// The builder portal deliverables this pane can open, in reading order. Each
// entry names the family_evidence item that CARRIES THE LIVE URL (the assembler
// writes `url:<link>` into the *_link item when it binds exactly one typed link)
// and the item that records whether the capture of that page succeeded.
var _MS_SES_PORTAL_ROLES = [
  { linkItem: 'roof_report_link', captureItem: 'roof_report_capture', label: 'Roof report', open: 'Open the roof report' },
  { linkItem: 'assessment_report_link', captureItem: 'assessment_report_capture', label: 'Assessment form', open: 'Open the assessment form' },
  { linkItem: 'assessment_scope_link', captureItem: 'assessment_scope_capture', label: 'Quote form', open: 'Open the quote form' },
  { linkItem: 'assessment_photos_link', captureItem: 'assessment_photos_capture', label: 'Photos form', open: 'Open the photos form' }
];

// The live builder-portal URL an evidence item carries, or null. The assembler
// records it as `url:<link>`; anything else (a file: pointer, a blocker) is not
// a link and must never be rendered as one.
function _msSesEvidenceUrl(entry) {
  var ev = entry && entry.evidence != null ? String(entry.evidence) : '';
  if (ev.indexOf('url:') !== 0) return null;
  var url = ev.slice(4).trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (typeof urlIsBuilderPortalLink === 'function' && !urlIsBuilderPortalLink(url)) return null;
  return url;
}

/**
 * The portal deliverables on this card, each with the live link (when the pack
 * bound one) and the OBSERVED state of the capture — never an inference. A role
 * the backend marks not_applicable is not on this card at all and is dropped.
 */
function _msSesPortalDeliverables(ctx, row) {
  var fe = _msSesFamilyEvidence(ctx);
  var captureDocs = (row && Array.isArray(row.draft_docs))
    ? row.draft_docs.filter(function(d) { return d && d.isCapture; })
    : [];
  var out = [];
  _MS_SES_PORTAL_ROLES.forEach(function(role) {
    var linkEntry = fe[role.linkItem] || null;
    var capEntry = fe[role.captureItem] || null;
    var linkState = String((linkEntry && linkEntry.state) || '').toLowerCase();
    var capState = String((capEntry && capEntry.state) || '').toLowerCase();
    if (!linkEntry && !capEntry) return;
    if (linkState === 'not_applicable' && (capState === 'not_applicable' || !capEntry)) return;
    out.push({
      key: role.linkItem,
      label: role.label,
      openLabel: role.open,
      url: _msSesEvidenceUrl(linkEntry),
      linkEntry: linkEntry,
      captureEntry: capEntry,
      captureState: capState,
      // The capture doc (and therefore its manifest facts) only exists while
      // the byte-exact pack is in view; the caption says so rather than
      // implying the capture is missing.
      captureDoc: captureDocs.length === 1 ? captureDocs[0] : null
    });
  });
  return out;
}

/**
 * The observed-state caption for one portal deliverable. PORTAL DONE is only
 * ever printed when the backend's own capture item says ready; everything else
 * reads NOT DONE and quotes the reason it gave.
 */
function _msSesPortalCaption(item) {
  if (item.captureState === 'ready') {
    var cap = item.captureDoc && item.captureDoc.capture;
    var when = cap && cap.capturedAt ? _msReportingFormatTimestamp(cap.capturedAt) : null;
    return {
      done: true,
      text: when ? ('PORTAL DONE - checked ' + when) : 'PORTAL DONE',
      detail: (cap && cap.signal) || null
    };
  }
  return {
    done: false,
    text: 'NOT DONE',
    detail: (item.captureEntry && (item.captureEntry.reason || item.captureEntry.recovery_action)) || null
  };
}

/**
 * The portal evidence strip: one tile per portal deliverable, carrying its
 * observed state and — when the pack bound a live link — an OPEN LINK button
 * straight into the builder portal. A deliverable with no bound link says so
 * instead of offering a dead button.
 */
function _msSesRenderPortalEvidence(row, ctx) {
  var items = _msSesPortalDeliverables(ctx, row);
  if (!items.length) return '';
  var html = '<div class="msr-sec"><h3>Builder portal</h3><span class="msr-sec-note">what the observer saw, and the live page</span></div>';
  html += '<div class="msr-portal">';
  items.forEach(function(item) {
    var cap = _msSesPortalCaption(item);
    html += '<div class="msr-portal-tile' + (cap.done ? ' done' : '') + '">';
    html += '<div class="msr-portal-name">' + escapeHtml(item.label) + '</div>';
    html += '<div class="msr-portal-state">' + escapeHtml(cap.text) + '</div>';
    if (cap.detail) html += '<div class="msr-portal-detail">' + escapeHtml(String(cap.detail)) + '</div>';
    if (item.url) {
      html += '<a class="msr-portal-open" href="' + escapeAttr(item.url) + '" target="_blank" rel="noopener">'
        + escapeHtml(item.openLabel) + ' &#8599;</a>';
    } else {
      html += '<div class="msr-portal-nolink">No live link is bound to this pack.</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}
// </ses-portal-link-openers>

// <ses-done-checklist>
// The strip at the top of the review: what is complete on this pack, in the
// captain's reading order. Presence comes from the pack's artifacts; document
// applicability comes only from the engine requirement map.
function _msSesDoneItems(row, ctx) {
  var draft = Array.isArray(row.draft_docs) ? row.draft_docs : [];
  var source = Array.isArray(row.source_docs) ? row.source_docs : [];
  function hasDraft(re) {
    return draft.some(function(d) { return d && !d.isCapture && re.test(String(d.label || '')); });
  }
  var items = [];
  function addDocument(label, key, present) {
    var owed = _msSesRequiredDocumentOwed(ctx, key);
    if (owed === false) {
      items.push({ label: label, na: true, note: 'not required for this pack' });
    } else if (owed === true) {
      items.push({ label: label, done: present });
    } else {
      items.push({
        label: label,
        done: present,
        unknown: true,
        note: present ? 'on pack; requirement unknown' : 'requirement unknown'
      });
    }
  }
  items.push({
    label: 'Work order',
    done: source.some(function(s) {
      return s && s.kind !== 'image' && /work[\s_-]*order|works[\s_-]*order|^wo\b/i.test(String(s.label || ''));
    })
  });
  addDocument('Report', 'report', hasDraft(/make\s*safe|completion|report/i));
  var capture = _msSesCaptureExpectation(ctx, row);
  if (capture.expected) {
    items.push({ label: 'Portal capture', done: draft.some(function(d) { return d && d.isCapture; }) });
  }
  addDocument('SWMS', 'swms', hasDraft(/swms/i));
  items.push({ label: 'Photos', done: !!(Array.isArray(row.photos) && row.photos.length) });
  addDocument('Draft invoice', 'invoice', !!row.invoice);
  return items;
}

function _msSesRenderDoneStrip(row, ctx) {
  // Without the byte-exact pack this screen cannot see the documents at all, so
  // a checklist here would be a list of false gaps.
  if (!ctx || !ctx.pack) return '';
  var items = _msSesDoneItems(row, ctx);
  var doneCount = items.filter(function(i) { return i.done && !i.unknown; }).length;
  var checkable = items.filter(function(i) { return !i.na && !i.unknown; }).length;
  var html = '<div class="msr-done">';
  html += '<div class="msr-done-h">' + doneCount + ' of ' + checkable + ' ready</div>';
  html += '<div class="msr-done-items">';
  items.forEach(function(i) {
    var cls = i.na ? 'na' : (i.unknown ? 'unknown' : (i.done ? 'ok' : 'gap'));
    var mark = i.na ? '&ndash;' : (i.unknown ? (i.done ? _MS_SES_ICONS.check : '?') : (i.done ? _MS_SES_ICONS.check : _MS_SES_ICONS.cross));
    html += '<span class="msr-done-item ' + cls + '">' + mark + ' ' + escapeHtml(i.label)
      + (i.note ? ' <em>(' + escapeHtml(i.note) + ')</em>' : '') + '</span>';
  });
  html += '</div></div>';
  return html;
}

// The payload-level document caveat sits beside the per-document checklist. It
// never claims an absent requirement is required, and never disables Captain
// review/send. The tabs, route attachment chips and missing line below remain
// the concrete truth the Captain weighs before pressing.
function _msSesPackTruthNotice(ctx) {
  var verdict = ctx && ctx.packCompleteness;
  if (!verdict || verdict.complete || !verdict.reviewable || !verdict.reason) return '';
  return '<div class="msr-missing"><b>'
    + escapeHtml(verdict.warning_label || 'CHECK DOCUMENTS')
    + ':</b> ' + escapeHtml(verdict.reason) + '</div>';
}
// </ses-done-checklist>

/**
 * RV-1: a missing document is NAMED in one quiet sentence under the tabs,
 * never an empty frame. Facts come from the pack's own artifacts. Applicability
 * comes only from the engine requirement map; unknown requirements are stated
 * by _msSesPackTruthNotice and never locally reconstructed.
 */
function _msSesMissingLine(row, ctx) {
  if (!ctx || !ctx.pack) return '';
  var draft = Array.isArray(row.draft_docs) ? row.draft_docs : [];
  var source = Array.isArray(row.source_docs) ? row.source_docs : [];
  function hasDraft(re) {
    // The capture is never matched by label here: "Roof Report Capture" must
    // not be read as the completion report, and its absence is named by
    // _msSesCaptureNotice rather than folded into this line's word list.
    return draft.some(function(d) { return d && !d.isCapture && re.test(String(d.label || '')); });
  }
  var missing = [];
  var reportOwed = _msSesRequiredDocumentOwed(ctx, 'report');
  var invoiceOwed = _msSesRequiredDocumentOwed(ctx, 'invoice');
  var swmsOwed = _msSesRequiredDocumentOwed(ctx, 'swms');
  if (reportOwed === true && !hasDraft(/make\s*safe|completion|report/i)) {
    missing.push('the completion report');
  }
  if (!source.some(function(s) {
    return s && s.kind !== 'image' && /work[\s_-]*order|works[\s_-]*order|^wo\b/i.test(String(s.label || ''));
  })) missing.push('the builder work order');
  if (!(Array.isArray(row.photos) && row.photos.length)) missing.push('site photos');
  if (invoiceOwed === true && !row.invoice) {
    missing.push('a draft invoice');
  }
  var invoicePdfMissing = invoiceOwed === true && row.invoice && !hasDraft(/invoice/i);
  var swmsAbsent = swmsOwed === true && !hasDraft(/swms/i);
  if (!missing.length && !invoicePdfMissing && !swmsAbsent) return '';
  var bits = [];
  if (missing.length) bits.push('<b>Not in this pack:</b> ' + escapeHtml(missing.join(', ')) + '.');
  if (invoicePdfMissing) {
    if (row.invoice && row.invoice.bound_xero) {
      // A Xero DRAFT PDF exists before APPROVE; the tab loads the real document
      // (pack inject or get_invoice_pdf). Never claim the PDF waits on APPROVE.
      bits.push('A Xero ' + escapeHtml(String(row.invoice.status || 'DRAFT')) +
        ' is bound' +
        (row.invoice.invoice_number ? ' (' + escapeHtml(row.invoice.invoice_number) + ')' : '') +
        ' &mdash; the Invoice tab loads the real PDF when available, and says so if it cannot.');
    } else {
      bits.push('No Xero invoice is bound yet &mdash; the Invoice tab shows the internal proposal until a DRAFT is minted.');
    }
  }
  if (swmsAbsent) bits.push('No SWMS in the pack; required document truth says SWMS is owed.');
  return '<div class="msr-missing">' + bits.join(' ') + '</div>';
}

// (Pack completeness now renders as the one-line _msSesMissingLine under the
// document tabs — the tabs themselves show what exists.)

/**
 * Merge the live feed row (identity facts) with the SES-derived review content
 * into the row shape the shared renderers (the document tabs, the invoice
 * document on the stage, the missing-documents line) consume. Legacy send
 * fields are stripped so no legacy gate can pick them up.
 */
function _msSesSynthRow(jobId, ctx) {
  var base = _msReportingCache[jobId] || { job_id: jobId };
  var row = {};
  Object.keys(base).forEach(function(k) { row[k] = base[k]; });
  var docs = _msSesDocsFromArtifacts(ctx.pack && ctx.pack.artifacts, ctx.portalCaptureFacts);
  var hasSwms = (docs.draft || []).some(function(d) {
    return d && /swms/i.test(String(d.label || ''));
  });
  if (!hasSwms && ctx.jobSwmsDoc && ctx.jobSwmsDoc.url) {
    docs.draft.push({
      label: 'SWMS',
      url: ctx.jobSwmsDoc.url,
      kind: 'pdf',
      isDraft: true
    });
  }
  row.draft_docs = docs.draft;
  row.source_docs = docs.source;
  row.photos = docs.photos;
  row.invoice = _msSesMapInvoice(ctx);
  row.recipient_email = null;
  row.cc = null;
  row.default_subject = null;
  row.default_html_body = null;
  row.resume_action = null;
  row.pack_status = null;
  row.needs_money_review = false;
  row.money_review = null;
  return row;
}

// <ses-pack-document-visibility>
/**
 * Does this artifact carry bytes a person READS as a page? PDFs and images do.
 * JSON/text/HTML plan artifacts (invoice_proposal, *_email_draft, review_spec,
 * envelope, review.html, ...) do not — the routes + invoice sections render
 * their content, so they must not become tabs.
 *
 * This predicate, not a role allowlist, decides what may become a document.
 * A role allowlist is what made the portal roof capture invisible: the pack
 * served it with a working signed URL and this screen dropped it because
 * nobody had added the role name. Byte-bearing roles are now visible by
 * DEFAULT and only their LABEL depends on knowing the role.
 */
function _msSesArtifactIsDocumentBytes(a) {
  if (!a || !a.signed_url) return false;
  var kind = _msSesMediaKind(a.media_type, a.object_key);
  return kind === 'pdf' || kind === 'image';
}

// The portal capture roles. `portal_roof_report` is the capture MANIFEST when
// it arrives as JSON (facts about the capture: captured_at, signal, share url)
// and the capture ITSELF when the producer attaches document bytes under that
// role instead — so the media type, never the role name, decides which it is.
var _MS_SES_CAPTURE_ROLES = {
  portal_roof_report_screenshot: true,
  portal_roof_report: true,
};

function _msSesIsCaptureRole(role) {
  return !!_MS_SES_CAPTURE_ROLES[String(role || '')];
}

/**
 * Collapse the pack's capture artifacts into viewer docs.
 *
 * TWO IDENTICAL CAPTURES ARE ONE PIECE OF EVIDENCE. A retake that only changed
 * the file name broke the producer's idempotency and left byte-identical rows
 * behind (live on Mindarie SWMS-261081), and two tabs would read as two
 * different observations of the roof — worse than one. So identical bytes
 * (same content_hash) collapse to ONE tab that SAYS how many copies are
 * stored; nothing is deleted, here or upstream.
 *
 * Captures whose bytes DIFFER are different evidence and each keep a tab —
 * hiding one would be the <makesafe-workorder-identity> mistake. Captures with
 * no content_hash cannot be proven identical, so they are never merged and the
 * stage says the pack did not record their hashes.
 */
function _msSesCaptureDocs(captures, facts) {
  if (!captures.length) return [];
  var factsList = Array.isArray(facts) ? facts.filter(Boolean) : (facts ? [facts] : []);
  var groups = [];
  var byHash = {};
  var unhashed = 0;
  captures.forEach(function(a) {
    var hash = a.content_hash || null;
    if (hash && byHash[hash]) { byHash[hash].copies++; return; }
    var g = { artifact: a, copies: 1, hash: hash };
    if (hash) byHash[hash] = g; else unhashed++;
    groups.push(g);
  });
  return groups.map(function(g, i) {
    var a = g.artifact;
    var fileName = String(a.object_key || '').split('/').pop() || 'Capture';
    // Facts are PER CAPTURE: a group takes only the manifest whose fingerprint
    // names its own bytes (or the pack's sole manifest when there is only one
    // capture to describe). A capture no manifest can be tied to states that
    // its facts are unknown — it never inherits another capture's time, cycle
    // or signal, which is exactly what would let stale evidence read as current.
    var gf = _msSesCaptureFactsFor(factsList, g.hash, groups.length);
    return {
      label: groups.length > 1 ? ('Roof Report Capture ' + (i + 1)) : 'Roof Report Capture',
      url: a.signed_url,
      kind: _msSesMediaKind(a.media_type, a.object_key),
      isDraft: true,
      isCapture: true,
      // An image capture IS the document here, so it must not be filtered out
      // with the photo set the way every other pack image is.
      isDocumentImage: true,
      capture: {
        fileName: fileName,
        copies: g.copies,
        variantCount: groups.length,
        unhashedCount: g.hash ? 0 : unhashed,
        contentHash: g.hash,
        capturedAt: (gf && gf.captured_at) || null,
        signal: (gf && gf.signal) || null,
        portalUrl: (gf && gf.url) || null,
        capturedBy: (gf && gf.captured_by) || null,
        cycleId: (gf && (gf.attendance_cycle_id || gf.cycle_id)) || null,
        cycleNumber: (gf && gf.cycle_number != null) ? gf.cycle_number : null,
        factsMissing: !gf,
      },
    };
  });
}

// The producer's manifest names the capture it describes by a (possibly
// truncated) content fingerprint. Normalised to bare hex; anything under 8 hex
// chars identifies nothing and is treated as absent.
function _msSesManifestFingerprintHex(f) {
  var fp = (f && (f.content_fingerprint || f.content_hash)) || null;
  if (!fp) return null;
  var hex = String(fp).replace(/^sha\d+:/i, '').toLowerCase();
  return /^[0-9a-f]{8,}$/.test(hex) ? hex : null;
}

function _msSesCaptureFactsFor(factsList, hash, groupCount) {
  if (!factsList.length) return null;
  var hex = hash ? String(hash).replace(/^sha\d+:/i, '').toLowerCase() : null;
  if (hex) {
    for (var i = 0; i < factsList.length; i++) {
      var fp = _msSesManifestFingerprintHex(factsList[i]);
      if (fp && (hex.indexOf(fp) === 0 || fp.indexOf(hex) === 0)) return factsList[i];
    }
  }
  // One capture, one manifest: there is no other capture the manifest could
  // describe, so it attaches even when the fingerprint is absent (the live
  // Mindarie shape). With several captures, only a fingerprint may claim one.
  if (factsList.length === 1 && groupCount === 1) return factsList[0];
  return null;
}

/**
 * Map the reviewable pack's artifacts to viewer docs. Every artifact carrying
 * READABLE bytes becomes a viewer doc (see _msSesArtifactIsDocumentBytes):
 * the rendered report PDF, the bound Xero invoice PDF, the SWMS, source
 * attachments (work order), the portal roof capture, the photo set, and
 * anything else the pack starts shipping. JSON/text plan artifacts are not
 * viewer docs. A role this screen does not recognise keeps its stored file
 * name and is marked so the stage can say the role is unlabelled — invisible
 * is never the default.
 */
function _msSesDocsFromArtifacts(artifacts, captureFacts) {
  var draft = [];
  var source = [];
  var photos = [];
  var captures = [];
  (artifacts || []).forEach(function(a) {
    if (!a) return;
    var fileName = String(a.object_key || '').split('/').pop() || 'Document';
    var label = fileName.replace(/\.[a-z0-9]+$/i, '');
    var meta = a.metadata || {};
    // Bound Xero invoice: real PDF when signed_url is present; honest
    // "unavailable" when the pack marks pdf_unavailable. Never invent HTML.
    if (a.role === 'xero_invoice_pdf') {
      if (a.signed_url) {
        draft.push({
          label: 'Xero invoice',
          url: a.signed_url,
          kind: 'pdf',
          isDraft: true,
          xero_invoice_id: meta.xero_invoice_id || null,
          invoice_number: meta.invoice_number || null,
        });
      } else if (a.pdf_unavailable === true || meta.unavailable === true || meta.reason === 'xero_draft_pdf_unavailable') {
        draft.push({
          label: 'Xero invoice',
          url: null,
          kind: 'invoice_unavailable',
          isDraft: true,
          xero_invoice_id: meta.xero_invoice_id || null,
          invoice_number: meta.invoice_number || null,
        });
      }
      return;
    }
    // A named DOCUMENT role that ships in the pack but whose signed URL was not
    // minted must not vanish: dropping it is how "closeout.report = true" still
    // rendered NO report tile and the pane lied "no trade report submitted"
    // (Captain live proof, Ellenbrook/Stratton). The tile EXISTS and says the
    // link could not be loaded (mirror of the Xero invoice_unavailable state),
    // so the captain sees the report is there and can Open document / retry.
    if (!a.signed_url) {
      if (a.role === 'supporting_report_pdf') {
        draft.push({ label: 'Make safe report', url: null, kind: 'doc_unavailable', isDraft: true, docLabel: 'report' });
      } else if (a.role === 'swms_artifact') {
        draft.push({ label: 'SWMS', url: null, kind: 'doc_unavailable', isDraft: true, docLabel: 'SWMS' });
      }
      return;
    }
    // The capture roles are decided by BYTES: JSON under portal_roof_report is
    // the manifest (read separately for the capture facts), not a document.
    if (_msSesIsCaptureRole(a.role)) {
      if (_msSesArtifactIsDocumentBytes(a)) captures.push(a);
      return;
    }
    if (a.role === 'supporting_report_pdf') {
      draft.push({ label: 'Make safe report', url: a.signed_url, kind: 'pdf', isDraft: true });
    } else if (a.role === 'swms_artifact') {
      draft.push({ label: 'SWMS', url: a.signed_url, kind: 'pdf', isDraft: true });
    } else if (a.role === 'source_attachment') {
      source.push({ label: label, url: a.signed_url, kind: _msSesMediaKind(a.media_type, a.object_key) });
    } else if (a.role === 'completion_photo' || a.role === 'sibling_photo_evidence') {
      var p = {
        label: label,
        url: a.signed_url,
        kind: 'image',
        content_hash: a.content_hash || null,
        role: a.role,
        order: (meta.order != null ? meta.order : null)
      };
      // Images in source_docs never become tabs or evidence links (the shared
      // renderers filter them); they feed _msGetAllPhotos for the feedback module.
      source.push(p);
      photos.push(p);
    } else if (_msSesArtifactIsDocumentBytes(a)) {
      // A role this screen has no label for, carrying real readable bytes.
      // It gets a tab under its stored file name rather than disappearing.
      source.push({
        label: label,
        url: a.signed_url,
        kind: _msSesMediaKind(a.media_type, a.object_key),
        isDocumentImage: true,
        isUnknownRole: true,
        roleName: a.role || null,
      });
    }
  });
  _msSesCaptureDocs(captures, captureFacts).forEach(function(c) { draft.push(c); });
  photos.sort(function(x, y) {
    return (x.order == null ? 9999 : x.order) - (y.order == null ? 9999 : y.order);
  });
  return { draft: draft, source: source, photos: photos };
}
// </ses-pack-document-visibility>

function _msSesMediaKind(mediaType, objectKey) {
  var mt = String(mediaType || '').toLowerCase();
  if (mt === 'application/pdf') return 'pdf';
  if (mt.indexOf('image/') === 0) return 'image';
  if (mt === 'text/html') return 'html';
  return _msReportingDocKind(objectKey || '');
}

/**
 * Map the SES money facts to the shared invoice-review shape. The proposal is
 * the docket's local_invoice_proposal (ses-local-invoice-proposal/v1:
 * line_items[{description, quantity, unit_price_ex_gst, amount_ex_gst}],
 * subtotal_ex_gst, total_inc_gst); once bound, the Xero status/number come from
 * xero_binding. Falls back to the cockpit money section when the byte-exact
 * pack is not in view (signed-off docket).
 */
function _msSesMapInvoice(ctx) {
  var sections = (ctx.cockpit && ctx.cockpit.sections) || {};
  var money = sections.money || {};
  var proposal = (ctx.pack && ctx.pack.docket && ctx.pack.docket.local_invoice_proposal) ||
    money.local_invoice_proposal || null;
  var xero = (ctx.pack && ctx.pack.docket && ctx.pack.docket.xero_binding) ||
    money.xero || money.bound_invoice || null;
  var packInvoicePdf = (ctx.pack && ctx.pack.invoice_pdf) || null;
  if (!proposal && !xero) return null;
  var lines = [];
  if (proposal && Array.isArray(proposal.line_items)) {
    lines = proposal.line_items.map(function(li) {
      li = li || {};
      return {
        description: li.description,
        quantity: li.quantity,
        unit_price: (li.unit_price_ex_gst != null ? li.unit_price_ex_gst : li.unit_price),
        line_total: (li.amount_ex_gst != null ? li.amount_ex_gst : li.line_total)
      };
    });
  }
  var boundXeroId = (xero && (xero.xero_invoice_id || xero.id)) ||
    (packInvoicePdf && packInvoicePdf.xero_invoice_id) || null;
  var xeroStatus = xero ? String(xero.status || 'BOUND').toUpperCase() : '';
  // A live Xero identity means the Invoice tab must show the real PDF (or say
  // it is unavailable) — never the local proposal table as if it were INV-n.
  var boundXero = !!(boundXeroId || (xeroStatus && xeroStatus !== 'SES PROPOSAL (NOT YET IN XERO)'));
  return {
    invoice_number: (xero && xero.invoice_number) ||
      (packInvoicePdf && packInvoicePdf.invoice_number) || null,
    xero_invoice_id: boundXeroId,
    status: xero ? (xero.status || 'BOUND') : 'SES proposal (not yet in Xero)',
    bound_xero: boundXero,
    pdf_available: packInvoicePdf
      ? packInvoicePdf.pdf_unavailable !== true
      : !!(xero && xero.pdf_content_hash),
    lines: lines,
    total_ex_gst: proposal ? proposal.subtotal_ex_gst : null,
    total_inc_gst: proposal ? proposal.total_inc_gst : null,
    lines_unavailable: !lines.length
  };
}

// ── ROUTES + PHOTOS (the exact release content) ─────────────────────────────

var _MS_SES_ROUTE_ORDER = { report: 0, photo: 1, invoice: 2 };
var _MS_SES_ROUTE_LABELS = { report: 'Report email', photo: 'Photo email', photos: 'Photo email', invoice: 'Invoice email' };
var _MS_SMALL_NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
function _msSmallNumberWord(n) {
  return (_MS_SMALL_NUMBER_WORDS[n] != null) ? _MS_SMALL_NUMBER_WORDS[n] : String(n);
}

/**
 * True when this job is an AJ / AJS builder (AJ Building & Restoration).
 * AJS packs are meant to ship as TWO emails (report+invoice, then photos).
 * The backend may still build three routes until a separate ship lands.
 */
function _msIsAjsBuilder(d) {
  var name = String((d && (d.builder || d.requesting_company_name)) || '').toLowerCase();
  var slug = String((d && d.requesting_company_slug) || '').toLowerCase();
  var ref = String((d && d.external_ref) || '').toUpperCase();
  if (slug === 'aj' || slug === 'ajs' || slug.indexOf('aj-building') === 0 || slug.indexOf('ajbuilding') === 0) {
    return true;
  }
  if (name.indexOf('aj building') >= 0 || /\bajs\b/.test(name)) return true;
  if (ref.indexOf('AJBR') === 0 || ref.indexOf('AJ-') === 0) return true;
  return false;
}

/**
 * True when the cockpit still carries the separate report/photo/invoice routes
 * the two-email preview is built from. It is a PRESENCE test only: a fourth
 * route or a duplicate kind still answers true, so the preview path must render
 * whatever it did not consume rather than assume the payload is exactly three
 * (see _msSesAjsIntendedEmails().leftovers and the truth fold).
 */
function _msSesHasThreeRouteShape(routes) {
  var kinds = {};
  (routes || []).forEach(function(r) {
    if (r && r.route_kind) kinds[r.route_kind] = true;
  });
  return !!(kinds.report && kinds.photo && kinds.invoice);
}

/**
 * Unique, order-preserving list of addresses (or any string keys).
 */
function _msSesUniqueList(arr) {
  var seen = {};
  var out = [];
  (arr || []).forEach(function(v) {
    if (!v) return;
    var k = String(v).toLowerCase();
    if (seen[k]) return;
    seen[k] = true;
    out.push(v);
  });
  return out;
}

/**
 * Unique list minus every address already carried by `exclude`. Used so a
 * merged Cc never repeats an address that the merged To already holds; an
 * address that appears ONLY on Cc is kept.
 */
function _msSesUniqueExcluding(arr, exclude) {
  var blocked = {};
  (exclude || []).forEach(function(v) {
    if (v) blocked[String(v).toLowerCase()] = true;
  });
  return _msSesUniqueList(arr).filter(function(v) {
    return !blocked[String(v).toLowerCase()];
  });
}

/**
 * Short body preview: first ~2 sentences / ~180 chars, no walls of text.
 */
function _msSesBodyExcerpt(body, maxLen) {
  var t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  maxLen = maxLen || 180;
  if (t.length <= maxLen) return t;
  var cut = t.slice(0, maxLen);
  var lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop >= 60) cut = cut.slice(0, lastStop + 1);
  else {
    var sp = cut.lastIndexOf(' ');
    if (sp > 40) cut = cut.slice(0, sp);
  }
  return cut.replace(/[.,;:\s]+$/, '') + '\u2026';
}

/**
 * Build the intended AJS two-email shape from the backend routes:
 *   1) report + invoice combined
 *   2) photos as a follow-up
 * This is a PREVIEW only, while the backend still builds three routes.
 *
 * The synthesis consumes AT MOST one report, one invoice and one photo route.
 * Anything it did not consume — a fourth route, a second invoice for a second
 * builder instruction — comes back as `leftovers` so the caller can show it:
 * no make-safe surface may reduce N backend items to a fixed two and hide the
 * rest (<makesafe-workorder-identity> is the same rule on work orders).
 *
 * Returns { emails: [combined, photos], leftovers: [...routes] }.
 */
function _msSesAjsIntendedEmails(routes) {
  var list = (Array.isArray(routes) ? routes : []).filter(Boolean);
  var consumed = [];
  function takeFirst(kind) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].route_kind === kind && consumed.indexOf(list[i]) < 0) {
        consumed.push(list[i]);
        return list[i];
      }
    }
    return null;
  }
  var report = takeFirst('report') || {};
  var invoice = takeFirst('invoice') || {};
  var photo = takeFirst('photo') || {};
  var combinedHashes = _msSesUniqueList(
    [].concat(report.attachment_hashes || [], invoice.attachment_hashes || [])
  );
  var reportBody = String(report.body || '').trim();
  var invoiceBody = String(invoice.body || '').trim();
  var combinedBody = reportBody;
  if (invoiceBody && invoiceBody !== reportBody) {
    combinedBody = reportBody
      ? (reportBody + '\n\n— Invoice note —\n' + invoiceBody)
      : invoiceBody;
  }
  var subject = report.subject || invoice.subject || '';
  if (report.subject && invoice.subject && report.subject !== invoice.subject) {
    subject = 'Make Safe Report & Invoice'
      + (report.subject.indexOf(' - ') >= 0
        ? report.subject.slice(report.subject.indexOf(' - '))
        : '');
  }
  // One merged To; the merged Cc drops only what To already carries, so a
  // Cc-only address (e.g. the ses@ copy) survives and nobody is listed twice.
  var combinedTo = _msSesUniqueList([].concat(report.recipients || [], invoice.recipients || []));
  var combinedCc = _msSesUniqueExcluding(
    [].concat(report.cc || [], invoice.cc || []),
    combinedTo
  );
  return {
    emails: [
      {
        route_kind: 'report_invoice',
        label: 'Report + invoice',
        recipients: combinedTo,
        cc: combinedCc,
        subject: subject,
        body: combinedBody,
        attachment_hashes: combinedHashes,
        ready: report.ready === true && invoice.ready === true
      },
      {
        route_kind: 'photo',
        label: 'Photos (follow-up)',
        recipients: Array.isArray(photo.recipients) ? photo.recipients.filter(Boolean) : [],
        cc: Array.isArray(photo.cc) ? photo.cc.filter(Boolean) : [],
        subject: photo.subject || '',
        body: photo.body || '',
        attachment_hashes: Array.isArray(photo.attachment_hashes) ? photo.attachment_hashes : [],
        ready: photo.ready === true
      }
    ],
    leftovers: list.filter(function(r) { return consumed.indexOf(r) < 0; })
  };
}

/**
 * One condensed email card: single-line To / Cc / Subject, short body excerpt,
 * attachment chips only. No "why this" essays and no walls of photo hashes.
 */
function _msSesRenderCondensedMail(r, byHash) {
  r = r || {};
  var label = r.label || _MS_SES_ROUTE_LABELS[r.route_kind] || String(r.route_kind || 'Email');
  var ready = r.ready === true;
  var recipients = Array.isArray(r.recipients) ? r.recipients.filter(Boolean) : [];
  var cc = Array.isArray(r.cc) ? r.cc.filter(Boolean) : [];
  var hashes = Array.isArray(r.attachment_hashes) ? r.attachment_hashes : [];
  var excerpt = _msSesBodyExcerpt(r.body);

  var html = '';
  html += '<section class="msr-mail condensed">';
  html += '<header class="msr-mail-top">';
  html += '<h4 class="msr-mail-name">' + escapeHtml(label) + '</h4>';
  html += '<span class="msr-chip ' + (ready ? 'ok' : 'warn') + '">' + (ready ? 'Ready' : 'Not ready') + '</span>';
  html += '</header>';

  html += '<div class="msr-mail-line">';
  html += '<span class="ml-bit"><b>To</b> '
    + (recipients.length ? escapeHtml(recipients.join(', ')) : '<em class="bad">none</em>')
    + '</span>';
  html += '<span class="ml-bit"><b>Cc</b> '
    + (cc.length ? escapeHtml(cc.join(', ')) : '<em>none</em>')
    + '</span>';
  html += '<span class="ml-bit subj"><b>Subject</b> '
    + (r.subject ? escapeHtml(r.subject) : '<em>none</em>')
    + '</span>';
  html += '</div>';

  if (excerpt) {
    html += '<div class="msr-mail-excerpt">' + escapeHtml(excerpt) + '</div>';
  } else {
    html += '<div class="msr-mail-excerpt empty">No body text.</div>';
  }

  html += '<div class="msr-att">';
  if (!hashes.length) {
    html += '<span class="msr-att-item">No attachments</span>';
  } else {
    hashes.forEach(function(h) {
      var a = byHash[h];
      if (a) {
        html += '<span class="msr-att-item">' + _MS_SES_ICONS.clip + ' ' + escapeHtml(a.fileName) + '</span>';
      } else {
        html += '<span class="msr-att-item unresolved">' + _MS_SES_ICONS.alert + ' Missing in pack</span>';
      }
    });
  }
  html += '</div>';
  html += '</section>';
  return html;
}

/**
 * Condensed email previews for the release routes.
 *
 * - Default: one card per backend route (truth), short TO/CC/subject + excerpt.
 * - AJS with the still-live 3-route backend: the INTENDED 2-email shape
 *   (report+invoice, then photos) is the HEADLINE, labelled plainly as a
 *   preview — never as if the press already sent that shape — and the REAL
 *   routes one press releases today stay one click away in a collapsed truth
 *   fold. Any route the synthesis did not consume is rendered as its own card
 *   in the headline too: a route is never dropped from this surface. When the
 *   backend has landed 2 routes, the truth IS the headline and there is no
 *   preview framing and no fold.
 * Attachments render as chips only. The "why this" essay block is not shown.
 */
function _msSesRenderRoutes(ctx, identity) {
  var sections = (ctx.cockpit && ctx.cockpit.sections) || {};
  var routes = Array.isArray(sections.email_drafts) ? sections.email_drafts.slice() : [];
  if (!routes.length) return '';
  routes.sort(function(a, b) {
    var oa = (a && _MS_SES_ROUTE_ORDER[a.route_kind] != null) ? _MS_SES_ROUTE_ORDER[a.route_kind] : 9;
    var ob = (b && _MS_SES_ROUTE_ORDER[b.route_kind] != null) ? _MS_SES_ROUTE_ORDER[b.route_kind] : 9;
    return oa - ob;
  });
  var byHash = _msSesArtifactsByHash(ctx);
  var isAjs = _msIsAjsBuilder(identity || {});
  var threeRoute = _msSesHasThreeRouteShape(routes);
  // Preview the intended AJS shape only while the backend still builds three.
  var useAjsPreview = isAjs && threeRoute;
  var realCount = routes.length;
  var realCountWord = _msSmallNumberWord(realCount);
  var realPlural = (realCount === 1 ? '' : 's');

  var html = '';
  if (!useAjsPreview) {
    html += '<div class="msr-sec"><h3>Outgoing emails</h3><span class="msr-sec-note">what one press releases</span></div>';
    html += '<div class="msr-lede">One press sends <strong>all ' + realCountWord
      + ' email' + realPlural + ' at once</strong> to the people below.</div>';
    routes.forEach(function(r) {
      html += _msSesRenderCondensedMail(r, byHash);
    });
    return html;
  }

  var intended = _msSesAjsIntendedEmails(routes);
  html += '<div class="msr-sec"><h3>Outgoing emails</h3><span class="msr-sec-note">AJS send shape (preview)</span></div>';
  html += '<div class="msr-banner info msr-preview-note">';
  html += '<div class="msr-banner-title">Preview of the intended AJS shape &mdash; not what one press sends today</div>';
  html += 'AJS packs should go as <strong>two emails</strong>: report + invoice together, then photos as a follow-up. ';
  html += 'The backend still builds <strong>' + escapeHtml(realCountWord) + ' route' + realPlural
    + '</strong> right now; one press still releases all ' + escapeHtml(realCountWord) + '. ';
  html += 'A separate ship will land the two-email shape &mdash; until then this is a layout preview only. ';
  html += 'Open <strong>What one press actually sends today</strong> below to read the real emails.';
  html += '</div>';
  intended.emails.forEach(function(r) {
    html += _msSesRenderCondensedMail(r, byHash);
  });
  // A route the two-email shape cannot absorb is shown as itself, never dropped.
  if (intended.leftovers.length) {
    html += '<div class="msr-lede"><strong>' + _msSmallNumberWord(intended.leftovers.length)
      + ' further route' + (intended.leftovers.length === 1 ? '' : 's')
      + '</strong> the two-email shape does not absorb. '
      + 'One press releases ' + (intended.leftovers.length === 1 ? 'it' : 'them') + ' too, exactly as below.</div>';
    intended.leftovers.forEach(function(r) {
      html += _msSesRenderCondensedMail(r, byHash);
    });
  }
  // The truth, one click away: the real routes SEND IT releases today.
  html += '<details class="msr-fold">';
  html += '<summary class="msr-sec"><h3>What one press actually sends today</h3>'
    + '<span class="msr-sec-note">' + escapeHtml(realCountWord) + ' real email' + realPlural
    + ' &mdash; open to read them</span></summary>';
  html += '<div class="msr-lede">These are the backend&rsquo;s own routes. One press releases <strong>all '
    + escapeHtml(realCountWord) + ' email' + realPlural + ' at once</strong>, exactly as below &mdash; '
    + 'the preview above is the shape a later ship will land, not this send.</div>';
  routes.forEach(function(r) {
    html += _msSesRenderCondensedMail(r, byHash);
  });
  html += '</details>';
  return html;
}

/**
 * Index the reviewable pack's artifacts by content hash, with the file name and
 * role each one carries. This is the only join between a route's
 * attachment_hashes and a human-readable attachment name.
 */
function _msSesArtifactsByHash(ctx) {
  var byHash = {};
  var artifacts = (ctx && ctx.pack && ctx.pack.artifacts) || [];
  artifacts.forEach(function(a) {
    if (!a || !a.content_hash) return;
    byHash[a.content_hash] = {
      fileName: String(a.object_key || '').split('/').pop() || 'Document',
      role: a.role || null
    };
  });
  return byHash;
}

/**
 * The photo set, as a calm grid. The set is FIXED by the SES release revision
 * (the photo route's attachment hashes), so this is display-only: a drawn
 * check badge marks a photo in the photo email; an evidence-only photo keeps
 * a quiet neutral badge. No include/exclude toggles — a control that cannot
 * change anything would be a fake one; changes go through Feedback + a
 * revised pack, never a send-time payload.
 */
function _msSesRenderPhotos(ctx) {
  if (!ctx.pack) return '';
  var sections = (ctx.cockpit && ctx.cockpit.sections) || {};
  var routes = Array.isArray(sections.email_drafts) ? sections.email_drafts : [];
  var photoRoute = null;
  routes.forEach(function(r) { if (r && r.route_kind === 'photo') photoRoute = r; });
  var routeHashes = {};
  ((photoRoute && photoRoute.attachment_hashes) || []).forEach(function(h) { routeHashes[h] = true; });
  var docs = _msSesDocsFromArtifacts(ctx.pack.artifacts, ctx.portalCaptureFacts);
  var photos = docs.photos;
  if (!photos.length) return '';
  var inRoute = photos.filter(function(p) { return p.content_hash && routeHashes[p.content_hash]; });
  var evidence = photos.filter(function(p) { return !(p.content_hash && routeHashes[p.content_hash]); });
  // Section title lives on the parent <details> summary so this body stays
  // content-only when the photos fold is closed by default.
  var html = '';
  html += '<div class="msr-photocount">';
  html += inRoute.length + ' of ' + photos.length + ' photo' + (photos.length === 1 ? '' : 's') + ' in the photo email';
  if (evidence.length) html += ' &middot; ' + evidence.length + ' kept as evidence only (not sent)';
  html += '</div>';
  html += '<div class="msr-photos">';
  inRoute.concat(evidence).forEach(function(p) {
    var sent = !!(p.content_hash && routeHashes[p.content_hash]);
    html += '<figure class="msr-photo ' + (sent ? 'ok' : 'ev') + '" title="' + escapeAttr(sent ? 'In the photo email' : 'Evidence only — not sent') + '">';
    html += '<img src="' + escapeAttr(p.url) + '" alt="' + escapeAttr(p.label || 'Site photo') + '" loading="lazy">';
    html += '<span class="mk" aria-hidden="true">' + (sent ? _MS_SES_ICONS.check : _MS_SES_ICONS.cross) + '</span>';
    html += '<figcaption>' + escapeHtml(p.label || 'Site photo') + '</figcaption>';
    html += '</figure>';
  });
  html += '</div>';
  html += '<div class="msr-lede">This set is fixed in the release revision &mdash; to swap or drop a photo, say so in Feedback and a revised pack comes back here.</div>';
  return html;
}

// ── DOC TABS (report / invoice / SWMS) ───────────────────────────────────────
// Module state: the active doc-tab index per job_id (default 0 = first doc).
var _msActiveDocTab = {};

// A DOM-safe key for element ids derived from a job id (no hyphens that break selectors).
function _msDocTabKey(jobId) {
  return String(jobId || '').replace(/[^A-Za-z0-9]/g, '_');
}

/**
 * Build the doc-tab list for a pack: the report, the INVOICE AS A DOCUMENT
 * (the bound Xero PDF when it exists, else the drafted proposal rendered as an
 * invoice page — the invoice is a tab like the report, never a separate
 * section), SWMS, then source inputs (Work Order / Trade Report). Photos stay
 * in the photo section (fixed set, display-only).
 *
 * WORK ORDERS ARE NEVER COLLAPSED: a make-safe card can carry the work orders
 * of two different builder instructions (AGENTS.md <makesafe-workorder-identity>
 * — no surface may pick one and hide the rest), so every work-order source doc
 * gets its own tab, discriminated by the PO ref in its file name when
 * `extractPoRef` can find one, else numbered.
 *
 * Each entry: { tabLabel, url, kind } where url already carries #view=Fit for
 * PDFs (via _msReportingBuildCarouselDocs).
 */
function _msReportingDocTabs(d) {
  var docs = _msReportingBuildCarouselDocs(d);
  var out = [];
  docs.forEach(function(doc) {
    var label = String(doc.label || '').toLowerCase();
    var tabLabel = null;
    var isWorkOrder = false;
    var isInvoiceDoc = false;
    // Photos stay in the photo section. A capture (or any other artifact whose
    // IMAGE bytes are the document) is not a photo and keeps its tab.
    if (doc.kind === 'image' && !doc.isDocumentImage) return;
    // The portal capture is a first-class document: it takes its own tab
    // before any label matching, so "…Report…" in its name cannot route it
    // into the completion-report slot.
    if (doc.isCapture) {
      out.push({
        tabLabel: doc.label || 'Roof Report Capture',
        url: doc.url,
        kind: doc.kind,
        isCapture: true,
        capture: doc.capture || null,
        srcLabel: doc.label || '',
      });
      return;
    }
    // Only a DRAFTED artifact (the pack's own xero_invoice_pdf) may claim the
    // Invoice slot: a builder SOURCE attachment named "invoice_*.pdf" is the
    // builder's paperwork, and taking the slot would hide the SES proposal page.
    if (doc.isDraft && /invoice/.test(label)) { tabLabel = 'Invoice'; isInvoiceDoc = true; }
    else if (/raw/.test(label) && /trade|service|report/.test(label)) tabLabel = 'Raw Trade Report';
    else if (/trade|service/.test(label) && /pdf/.test(label)) tabLabel = 'Trade Report PDF';
    else if (/trade|service|raw/.test(label)) tabLabel = 'Trade Report';
    else if (/work\S*\s*order|^wo$/.test(label)) { tabLabel = 'Work Order'; isWorkOrder = true; }
    else if (/make\s*safe|completion/.test(label) && /report/.test(label)) tabLabel = 'Make Safe Report';
    else if (/swms/.test(label)) tabLabel = 'SWMS';
    else if (/report/.test(label)) tabLabel = 'Trade Report';
    else tabLabel = doc.label || 'Document';
    // 'Invoice' is reserved for the drafted money document; a source file that
    // happens to be named that is relabelled rather than shown as a twin tab.
    if (!isInvoiceDoc && tabLabel === 'Invoice') tabLabel = 'Builder invoice';
    // De-dupe by tab label (one report, one invoice, one SWMS) — EXCEPT work
    // orders, where collapsing would hide a second builder instruction.
    if (!isWorkOrder && out.some(function(o) { return o.tabLabel === tabLabel; })) return;
    out.push({
      tabLabel: tabLabel,
      url: doc.url,
      kind: doc.kind,
      isWorkOrder: isWorkOrder,
      isInvoiceDoc: isInvoiceDoc,
      srcLabel: doc.label || '',
      created_at: doc.created_at || null,
      received_at: doc.received_at || null,
      source_type: doc.source_type || null,
      raw_report: doc.raw_report || null,
      isUnknownRole: !!doc.isUnknownRole,
      roleName: doc.roleName || null,
      docLabel: doc.docLabel || null,
    });
  });
  // Multiple work orders: discriminate by the PO ref embedded in the file name
  // (the builder claim ref is shared, so only the PO discriminates — same rule
  // as buildMakesafeWorkOrderSlots), else number them.
  var woTabs = out.filter(function(o) { return o.isWorkOrder; });
  if (woTabs.length > 1) {
    woTabs.forEach(function(o, i) {
      var po = (typeof extractPoRef === 'function') ? extractPoRef(o.srcLabel) : null;
      o.tabLabel = po ? ('Work Order ' + po) : ('Work Order ' + (i + 1));
    });
  }
  // Invoice tab rules (honest document, never a fake green):
  // - Real Xero PDF artifact → already pushed as Invoice/pdf above.
  // - Bound Xero DRAFT/AUTHORISED without PDF → "not available" (never invent).
  // - Pre-Xero proposal only → local invdoc page labelled as a proposal, not INV-n.
  var hasInvoiceTab = out.some(function(o) { return o.isInvoiceDoc; });
  if (!hasInvoiceTab && d && d.invoice) {
    if (d.invoice.bound_xero) {
      out.push({
        tabLabel: 'Invoice',
        url: null,
        kind: 'invoice_unavailable',
        isInvoiceDoc: true,
        invoice_number: d.invoice.invoice_number || null,
        xero_invoice_id: d.invoice.xero_invoice_id || null,
      });
    } else {
      out.push({ tabLabel: 'Invoice', url: null, kind: 'invdoc', isInvoiceDoc: true });
    }
  }
  // Order: report first (the main document), money second, then the rest.
  // Note: use a has-own check, not `|| 9` — 'Make Safe Report' maps to 0 (falsy).
  // On a roof-report card the capture IS the report, so it sits where the
  // completion report would: first, ahead of the money document.
  var order = { 'Make Safe Report': 0, 'Invoice': 1, 'SWMS': 2, 'Work Order': 3, 'Raw Trade Report': 5, 'Trade Report': 6, 'Trade Report PDF': 7 };
  function rank(t) {
    if (t.isCapture) return 0.5;
    return (order[t.tabLabel] != null) ? order[t.tabLabel] : (t.isWorkOrder ? 4 : 9);
  }
  out.sort(function(a, b) { return rank(a) - rank(b); });
  return out;
}

// The stored file name behind a tile, when the pack recorded one. The capture
// carries its own; every other tab keeps the label it was built from.
function _msSesTileFileName(t) {
  if (t && t.capture && t.capture.fileName) return t.capture.fileName;
  var src = String((t && t.srcLabel) || '').trim();
  if (src && src !== t.tabLabel) return src;
  if (t && t.kind === 'invdoc') return 'SES proposal';
  if (t && t.kind === 'invoice_unavailable') return 'not available';
  return t && t.url ? (String(t.url).split('?')[0].split('/').pop() || '') : '';
}

// ── PDF RENDERING (vendored pdf.js, lazy — TILE THUMBNAILS ONLY) ────────────
// The document tiles render a real first-page preview to <canvas> with pdf.js
// (a native <iframe> gives no thumbnail). The inline STAGE does NOT use this:
// it embeds the browser's built-in PDF viewer via <iframe> (Captain ruling
// 2026-08-14 — the native reader, just tall). Known trade-off carried from the
// 13-Aug history: the native plugin can refuse to render a signed URL inline
// when the storage host serves it with `Content-Disposition: attachment` (the
// pre-#262 "grey empty pane"); the Open-document hatch stays as the escape.
//
// The library (~1.5MB with its worker) loads LAZILY the first time a pack opens,
// from the vendored copy under shared/vendor/pdfjs/. If it cannot load, or a
// render throws, the tile keeps its drawn page glyph — nothing regresses.
// Search <makesafe-pdf-preview>.
var _MS_PDF_BASE = 'shared/vendor/pdfjs/';
var _msPdfLibPromise = null;
var _msPdfDocCache = {};

// Load pdf.js once and resolve window.pdfjsLib. Rejects if the vendored script
// is unreachable; callers catch and fall back.
function _msPdfEnsureLib() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('no DOM'));
  }
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_msPdfLibPromise) return _msPdfLibPromise;
  _msPdfLibPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = _MS_PDF_BASE + 'pdf.min.js';
    s.async = true;
    s.onload = function() {
      if (!window.pdfjsLib) { reject(new Error('pdfjsLib missing after load')); return; }
      try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = _MS_PDF_BASE + 'pdf.worker.min.js'; } catch (_e) { /* set best-effort */ }
      resolve(window.pdfjsLib);
    };
    s.onerror = function() { _msPdfLibPromise = null; reject(new Error('pdf.js failed to load')); };
    document.head.appendChild(s);
  });
  return _msPdfLibPromise;
}

// A cached pdf.js document promise per URL (the tile thumbnail and the stage
// viewer for the same doc then share one fetch/parse).
function _msPdfGetDoc(url) {
  if (_msPdfDocCache[url]) return _msPdfDocCache[url];
  var p = _msPdfEnsureLib().then(function(lib) {
    return lib.getDocument({ url: url }).promise;
  });
  p.catch(function() { delete _msPdfDocCache[url]; }); // let a transient failure retry
  _msPdfDocCache[url] = p;
  return p;
}

// Fallback raster width when a thumbnail host has no measurable width yet.
var _MS_PDF_STAGE_WIDTH = 700;

// Render one pdf.js page into a canvas sized to `cssWidth` (device-pixel aware).
// A zero/absent cssWidth (a not-yet-laid-out or hidden host) would collapse the
// canvas to a 1px sliver, so it clamps to a readable default instead of 0.
function _msPdfPaintPage(page, canvas, cssWidth) {
  var base = page.getViewport({ scale: 1 });
  var w = (cssWidth && cssWidth > 40) ? cssWidth : _MS_PDF_STAGE_WIDTH;
  var scale = w / base.width;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
  var viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  var ctx2d = canvas.getContext('2d');
  return page.render({ canvasContext: ctx2d, viewport: viewport }).promise;
}

// Hydrate every not-yet-rendered PDF tile thumbnail under `root` (first page,
// cover-cropped). Idempotent — a surface is marked done so a re-scan never
// repaints it.
function _msHydratePdfSurfaces(root) {
  if (!root || !root.querySelectorAll) return;
  var nodes = root.querySelectorAll('[data-pdf-url]:not([data-pdf-done])');
  if (!nodes.length) return;
  Array.prototype.forEach.call(nodes, function(el) {
    el.setAttribute('data-pdf-done', '1');
    var url = el.getAttribute('data-pdf-url');
    if (!url) return;
    _msPdfGetDoc(url).then(function(doc) {
      return _msPdfFillThumb(el, doc);
    }).catch(function() {
      // Leave the drawn page glyph and mark the failure.
      el.setAttribute('data-pdf-failed', '1');
    });
  });
}

function _msPdfFillThumb(el, doc) {
  return doc.getPage(1).then(function(page) {
    var w = el.clientWidth || 120;
    var canvas = document.createElement('canvas');
    return _msPdfPaintPage(page, canvas, w).then(function() {
      el.classList.remove('glyph');
      el.innerHTML = '';
      el.appendChild(canvas);
    });
  });
}

// A tile preview: the real image for an image document, a real first-page PDF
// render for a PDF (hydrated after mount), a drawn page mark for everything
// else. Never a stand-in that could be mistaken for the document.
function _msSesTileThumb(t) {
  if (t && t.kind === 'image' && t.url) {
    return '<span class="msr-tile-thumb"><img src="' + escapeAttr(t.url) + '" alt="" loading="lazy"></span>';
  }
  if (t && t.kind === 'pdf' && t.url) {
    // Real first-page preview, hydrated by _msHydratePdfSurfaces. The page glyph
    // shows until it paints (and stays if pdf.js cannot load).
    return '<span class="msr-tile-thumb pdf glyph" data-pdf-url="' + escapeAttr(t.url) + '" data-pdf-role="thumb" aria-hidden="true">'
      + '<svg viewBox="0 0 16 16"><path d="M4 1.5h5l3 3v10H4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'
      + '<path d="M9 1.5v3h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>';
  }
  return '<span class="msr-tile-thumb glyph" aria-hidden="true">'
    + '<svg viewBox="0 0 16 16"><path d="M4 1.5h5l3 3v10H4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<path d="M9 1.5v3h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>';
}

/**
 * Render the fit-to-page stage for the doc at index idx. Dark stage with the
 * page centered + a "fit to page" tag (mockup .pdfstage / .pdffit). PDFs embed
 * an iframe with the Fit-fragment URL — the browser's built-in reader (Captain
 * ruling 2026-08-14: the native reader, just tall); images render contained;
 * the drafted invoice (kind 'invdoc') renders as an invoice page from the
 * row's own figures; anything else gets an open-in-new-tab fallback.
 *
 * The stage is a TALL fixed-height box (--msr-stage-h in ops.html). A PDF or
 * image carries an "Open document" escape hatch to a full-size read in a new
 * tab, so nothing on this screen is only readable at stage size.
 */
function _msRenderDocStage(docTabs, idx, row) {
  var t = docTabs[idx];
  var metaBits = [];
  if (t && t.received_at) metaBits.push('Received ' + _msReportingFormatTimestamp(t.received_at));
  if (t && t.created_at && t.created_at !== t.received_at) metaBits.push('Created ' + _msReportingFormatTimestamp(t.created_at));
  var metaHtml = metaBits.length
    ? '<div class="msr-stage-meta"><span class="k">' + escapeHtml(t.tabLabel || 'Document') + '</span>'
      + metaBits.map(function(m) { return '<span class="t">' + escapeHtml(m) + '</span>'; }).join('')
      + '</div>'
    : '';
  if (t && t.isCapture) metaHtml = _msSesCaptureStageMeta(t, row);
  else if (t && t.isUnknownRole) metaHtml = _msSesUnknownRoleStageMeta(t) + metaHtml;
  var inner;
  if (t && t.kind === 'invoice_unavailable') {
    inner = _msSesRenderInvoiceUnavailable(row || t);
  } else if (t && t.kind === 'doc_unavailable') {
    inner = _msSesRenderDocUnavailable(t);
  } else if (t && t.kind === 'invdoc') {
    // Pre-Xero proposal page only. Callers must not route a bound Xero DRAFT
    // here — that path is invoice_unavailable or the real PDF iframe.
    inner = _msSesRenderInvoiceDoc(row);
  } else if (!t || !t.url) {
    if (t && (t.kind === 'html' || t.raw_report)) {
      inner = _msRenderRawTradeReportDoc(t);
    } else {
      inner = '<div class="msr-stage-empty">Document not available.</div>';
    }
  } else if (t.kind === 'image') {
    inner = '<img src="' + escapeAttr(t.url) + '" alt="' + escapeAttr(t.tabLabel) + '" style="max-width:94%;max-height:94%;">';
  } else if (t.kind === 'pdf') {
    inner = '<iframe title="' + escapeAttr(t.tabLabel) + '" src="' + escapeAttr(t.url) + '" style="width:min(92%,720px);height:96%;background:#fff;"></iframe>';
  } else {
    inner = '<a href="' + escapeAttr(t.url) + '" target="_blank" rel="noopener" style="color:#fff;background:rgba(255,255,255,0.12);padding:10px 16px;text-decoration:none;font-size:13px;font-weight:700;">Open ' + escapeHtml(t.tabLabel) + ' &#8599;</a>';
  }
  var openHatch = '';
  if (t && t.url && (t.kind === 'pdf' || t.kind === 'image')) {
    var stageJobId = row && row.job_id;
    var freshnessGate = stageJobId
      ? ' onclick="return _msOpenDocFullSize(\'' + _msJsAttr(stageJobId) + '\',' + idx + ')"'
      : '';
    openHatch = '<a class="msr-stage-open" href="' + escapeAttr(t.url) + '" target="_blank" rel="noopener"'
      + freshnessGate + '>Open document &#8599;</a>';
  }
  return metaHtml + '<div class="msr-stage">' + openHatch + '<span class="msr-stage-tag">fit to page</span>' + inner + '</div>';
}

// <ses-roof-capture-provenance>
/**
 * Which attendance visit does this capture belong to?
 *
 * A capture from an earlier attendance must be LABELLED as one, never shown as
 * the current visit's evidence. The answer is only ever taken from recorded
 * facts, in descending order of strength:
 *   1. the capture names its own cycle and it differs from the card's -> prior;
 *   2. the capture predates this card's latest re-attendance -> prior;
 *   3. the card HAS been re-attended but nothing ties the capture to a visit
 *      -> say exactly that (unknown is a fact, "current" would be a guess);
 *   4. single-visit card -> no claim beyond the capture time itself.
 * Returns null when there is nothing honest to add.
 */
function _msSesCaptureCycleNote(cap, row) {
  if (!cap) return null;
  var jobCycleId = (row && row.attendance_cycle_id) || null;
  var jobCycleNo = (row && row.cycle_number != null) ? row.cycle_number : null;
  if (cap.cycleId && jobCycleId && cap.cycleId !== jobCycleId) {
    return { prior: true, text: 'From an EARLIER attendance visit — not the visit under review.' };
  }
  if (cap.cycleNumber != null && jobCycleNo != null && cap.cycleNumber !== jobCycleNo) {
    return {
      prior: true,
      text: 'From attendance visit ' + cap.cycleNumber + ' — this card is on visit ' + jobCycleNo + '.',
    };
  }
  var lastReattend = (row && row.last_reattend_at) || null;
  if (cap.capturedAt && lastReattend) {
    var capMs = new Date(cap.capturedAt).getTime();
    var reMs = new Date(lastReattend).getTime();
    if (isFinite(capMs) && isFinite(reMs) && capMs < reMs) {
      return {
        prior: true,
        text: 'Captured BEFORE this card was re-attended on ' +
          _msReportingFormatTimestamp(lastReattend) + ' — it is from an earlier visit.',
      };
    }
  }
  var reattended = !!(row && (row.is_reattend || (row.reattend_count || 0) > 0));
  if (reattended) {
    return {
      prior: false,
      text: 'This card has been re-attended and the capture does not record which visit it came from.',
    };
  }
  return null;
}

/**
 * The capture tab's provenance line. Everything on it is quoted from the
 * capture manifest; nothing is inferred. An unread manifest says so — a
 * capture with no stated time must never read as a fresh one.
 */
function _msSesCaptureStageMeta(t, row) {
  var cap = t.capture || {};
  var html = '<div class="msr-stage-meta"><span class="k">' + escapeHtml(t.tabLabel || 'Roof Report Capture') + '</span>';
  if (cap.capturedAt) {
    html += '<span class="t">Captured ' + escapeHtml(_msReportingFormatTimestamp(cap.capturedAt)) + '</span>';
  } else {
    html += '<span class="t">Capture time not recorded in this pack</span>';
  }
  if (cap.copies > 1) {
    html += '<span class="t">' + cap.copies + ' identical copies stored (same bytes) &mdash; shown once</span>';
  }
  if (cap.variantCount > 1) {
    html += '<span class="t">' + cap.variantCount + ' captures on this pack, and their bytes differ</span>';
  }
  html += '</div>';
  var cycle = _msSesCaptureCycleNote(cap, row);
  var lines = [];
  if (cycle) {
    lines.push('<div class="msr-capture-line' + (cycle.prior ? ' prior' : '') + '"><b>'
      + (cycle.prior ? 'Earlier visit' : 'Which visit') + '</b>' + escapeHtml(cycle.text) + '</div>');
  }
  if (cap.signal) {
    lines.push('<div class="msr-capture-line"><b>What the observer saw</b>' + escapeHtml(cap.signal) + '</div>');
  } else if (cap.factsMissing) {
    lines.push('<div class="msr-capture-line"><b>Capture facts</b>The capture manifest could not be read, so this screen cannot state when this capture was taken or what the observer saw. Read the page below on its own terms.</div>');
  }
  if (cap.unhashedCount) {
    lines.push('<div class="msr-capture-line"><b>Copies</b>This pack did not record a content hash for '
      + cap.unhashedCount + ' capture' + (cap.unhashedCount === 1 ? '' : 's')
      + ', so this screen cannot tell whether they are the same document.</div>');
  }
  // The capture is a picture of a form: text search finds nothing in it. Say
  // so, or an empty text search reads as an empty document.
  if (t.kind === 'image' || t.kind === 'pdf') {
    lines.push('<div class="msr-capture-line"><b>Read it as a page</b>The capture is an image of the portal form, so searching it for text finds nothing. That is not an empty document &mdash; open it full size to read the answers.</div>');
  }
  if (cap.portalUrl && (typeof urlIsBuilderPortalLink !== 'function' || urlIsBuilderPortalLink(cap.portalUrl))) {
    lines.push('<div class="msr-capture-line"><b>Portal share</b><a href="' + escapeAttr(cap.portalUrl)
      + '" target="_blank" rel="noopener">' + escapeHtml(cap.portalUrl) + '</a> &mdash; builder shares expire after about a month; an expired share is an aged job, not a broken capture.</div>');
  }
  return html + (lines.length ? '<div class="msr-capture-facts">' + lines.join('') + '</div>' : '');
}

/**
 * A document whose artifact role this screen carries no label for. It is shown
 * under its stored file name and says so, rather than being dropped — the
 * failure that hid the roof capture.
 */
function _msSesUnknownRoleStageMeta(t) {
  return '<div class="msr-capture-facts"><div class="msr-capture-line"><b>Unlabelled document</b>'
    + 'This pack ships a document under the role "' + escapeHtml(t.roleName || 'unknown')
    + '", which this screen has no name for. It is shown under its stored file name.</div></div>';
}
// </ses-roof-capture-provenance>

/**
 * Honest empty state when a Xero DRAFT/AUTHORISED is bound but its PDF could
 * not be recovered. Never invent a tax-invoice HTML table that looks like INV-n.
 */
function _msSesRenderInvoiceUnavailable(d) {
  var inv = (d && d.invoice) || d || {};
  var number = inv.invoice_number || inv.invoiceNumber || null;
  var status = inv.status || null;
  var html = '<div class="msr-invpage" style="display:flex;align-items:center;justify-content:center;">';
  html += '<div class="msr-invpage-body" style="text-align:center;max-width:28rem;">';
  html += '<div class="msr-invpage-head" style="justify-content:center;"><h4>Invoice document not available</h4></div>';
  if (number || status) {
    html += '<div class="msr-invpage-note" style="margin-top:8px;">';
    html += escapeHtml([number, status].filter(Boolean).join(' · '));
    html += ' is bound in Xero, but the real PDF could not be loaded for this view.</div>';
  } else {
    html += '<div class="msr-invpage-note" style="margin-top:8px;">The real Xero invoice PDF could not be loaded for this view.</div>';
  }
  html += '<div class="msr-invpage-foot" style="margin-top:12px;">This screen will not invent a tax invoice. Retry after the pack reloads, or open the invoice from Xero.</div>';
  html += '</div></div>';
  return html;
}

/**
 * Honest empty state for a named document (report / SWMS) that IS in the pack
 * but whose signed URL was not minted for this view. It keeps the tile present
 * (the document exists) and says the link could not be loaded — never the old
 * silent drop that read as "no report submitted" while the board closeout said
 * report = true.
 */
function _msSesRenderDocUnavailable(t) {
  var name = (t && t.docLabel) ? String(t.docLabel) : (t && t.tabLabel ? String(t.tabLabel) : 'document');
  var html = '<div class="msr-invpage" style="display:flex;align-items:center;justify-content:center;">';
  html += '<div class="msr-invpage-body" style="text-align:center;max-width:30rem;">';
  html += '<div class="msr-invpage-head" style="justify-content:center;"><h4>' + escapeHtml(t && t.tabLabel ? t.tabLabel : 'Document') + '</h4></div>';
  html += '<div class="msr-invpage-note" style="margin-top:8px;">This ' + escapeHtml(name)
    + ' is on the pack, but its file link could not be loaded for this view.</div>';
  html += '<div class="msr-invpage-foot" style="margin-top:12px;">Use <b>Open document</b> if a link is offered, or reopen this pack once it rebuilds. This screen will not invent the document.</div>';
  html += '</div></div>';
  return html;
}

/**
 * Pre-Xero proposal only: an invoice-shaped page from SES proposal figures.
 * Must never run when a live Xero DRAFT/AUTHORISED is bound — that is a
 * different document (the real PDF) or an honest unavailable state.
 */
function _msSesRenderInvoiceDoc(d) {
  var inv = (d && d.invoice) || {};
  // Defence in depth: bound Xero identity never renders the proposal table.
  if (inv.bound_xero || inv.xero_invoice_id) {
    return _msSesRenderInvoiceUnavailable(d);
  }
  var lines = Array.isArray(inv.lines) ? inv.lines : [];
  var statusLine = 'SES proposal &mdash; not yet a Xero invoice';

  var html = '<div class="msr-invpage">';
  html += '<div class="msr-invpage-band"></div>';
  html += '<div class="msr-invpage-body">';
  html += '<div class="msr-invpage-head"><h4>Proposed invoice</h4><span class="msr-invpage-status">' + statusLine + '</span></div>';
  if (lines.length) {
    html += '<table class="msr-invpage-tbl"><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit ex</th><th class="n">Amount ex</th></tr></thead><tbody>';
    lines.forEach(function(li, idx) {
      li = li || {};
      var desc = li.description || li.name || ('Line ' + (idx + 1));
      var qty = li.quantity != null ? Number(li.quantity) : null;
      var unit = li.unit_price != null ? Number(li.unit_price) : (li.unit_amount != null ? Number(li.unit_amount) : null);
      var total = li.line_total != null ? Number(li.line_total) : (li.amount != null ? Number(li.amount) : null);
      html += '<tr>';
      html += '<td>' + escapeHtml(desc) + '</td>';
      html += '<td class="n">' + (qty != null && isFinite(qty) ? escapeHtml(String(qty)) : '') + '</td>';
      html += '<td class="n">' + (unit != null && isFinite(unit) ? escapeHtml(_msFmtAud(unit)) : '') + '</td>';
      html += '<td class="n">' + (total != null && isFinite(total) ? escapeHtml(_msFmtAud(total)) : '') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  } else if (inv.lines_unavailable) {
    html += '<div class="msr-invpage-note">Invoice line detail is unavailable for this draft.</div>';
  }
  html += '<div class="msr-invpage-tots">';
  if (inv.total_ex_gst != null) html += '<div class="row"><span>Subtotal ex GST</span><span>' + escapeHtml(_msFmtAud(inv.total_ex_gst)) + '</span></div>';
  if (inv.total_inc_gst != null) html += '<div class="row tot"><span>Total inc GST</span><span>' + escapeHtml(_msFmtAud(inv.total_inc_gst)) + '</span></div>';
  html += '</div>';
  html += '<div class="msr-invpage-foot">This is the internal proposal, not a Xero invoice. After mint, the Invoice tab shows the real Xero PDF. To change pricing, say so in Feedback.</div>';
  html += '</div></div>';
  return html;
}

function _msRenderRawTradeReportDoc(t) {
  var raw = (t && t.raw_report) || {};
  var cl = raw.checklist_json || {};
  var rows = [];
  function add(label, value) {
    if (value == null || value === '') return;
    if (Array.isArray(value)) value = value.join(', ');
    rows.push('<div style="display:grid;grid-template-columns:150px 1fr;gap:10px;padding:7px 0;border-bottom:1px solid #edf1f3;font-size:13px;">'
      + '<div style="font-weight:800;color:#4C6A7C;">' + escapeHtml(label) + '</div>'
      + '<div style="white-space:pre-wrap;color:#1A2332;">' + escapeHtml(String(value)) + '</div>'
      + '</div>');
  }
  if (raw.status) add('Status', raw.status);
  if (raw.submitted_at) add('Submitted', _msReportingFormatTimestamp(raw.submitted_at));
  if (raw.signature_name) add('Signature', raw.signature_name);
  if (cl && !Array.isArray(cl) && typeof cl === 'object') {
    add('Arrival', cl.arrival_time);
    add('Labour', cl.labour_hours ? String(cl.labour_hours) + ' hrs x ' + (cl.trade_count || 1) + ' trades' : '');
    add('Make-safe type', cl.job_type || cl.makesafe_type);
    add('Damage', cl.damage_description);
    add('Cause', cl.damage_cause);
    add('Work completed', cl.work_done);
    add('Materials', cl.materials_used);
    add('Extra notes', cl.extra_notes || cl.access_issues || cl.invoice_notes);
  } else if (Array.isArray(cl)) {
    var items = cl.map(function(item) {
      if (!item) return '';
      var tick = item.checked ? '&#10003;' : '&#8212;';
      return '<li style="padding:5px 0;border-bottom:1px solid #edf1f3;">' + tick + ' ' + escapeHtml(item.label || String(item)) + '</li>';
    }).join('');
    if (items) rows.push('<div style="padding:7px 0;font-size:13px;"><div style="font-weight:800;color:#4C6A7C;margin-bottom:4px;">Checklist</div><ul style="list-style:none;padding:0;margin:0;">' + items + '</ul></div>');
  }
  if (raw.notes) add('Notes', raw.notes);
  if (!rows.length) {
    rows.push('<pre style="white-space:pre-wrap;font-size:12px;background:#f7f8fa;padding:12px;border-radius:8px;overflow:auto;">' + escapeHtml(JSON.stringify(raw, null, 2)) + '</pre>');
  }
  return '<div style="width:min(92%,720px);height:96%;background:#fff;border-radius:3px;box-shadow:0 4px 18px rgba(0,0,0,.3);overflow:auto;padding:26px 30px;text-align:left;">'
    + '<div style="border-top:6px solid var(--sw-orange);padding-top:14px;margin-bottom:16px;">'
    + '<div style="font-size:22px;font-weight:900;color:#1A2332;">Raw Trade Report</div>'
    + '<div style="font-size:12px;color:#7C8898;margin-top:4px;">Trade-submitted source data before the AI close-out pack.</div>'
    + '</div>'
    + rows.join('')
    + '</div>';
}

// Signed pack URLs live 300s. Anything that hands one to the browser past this
// age re-fetches the pack first, so nobody ever follows a dead link.
var _MS_SES_SIGNED_URL_STALE_MS = 240000;

/** True when this job's cached pack URLs are too old to hand to the browser. */
function _msSesPackUrlsStale(jobId) {
  var ctx = _msSesPackCache[jobId];
  return !!(ctx && ctx.pack && ctx.fetchedAt &&
    (Date.now() - ctx.fetchedAt) > _MS_SES_SIGNED_URL_STALE_MS);
}

/** The signed URL currently behind doc tab `idx`, re-derived from the row. */
function _msDocTabUrlAt(jobId, idx) {
  var d = _msReportingCache[jobId];
  if (!d) return '';
  var docTabs = _msReportingDocTabs(d);
  var t = (idx >= 0 && idx < docTabs.length) ? docTabs[idx] : null;
  return (t && t.url) ? t.url : '';
}

/** Give up on a pending full-size read: close the waiting tab, say why. */
function _msAbandonDocFullSize(win, message) {
  if (win) {
    try { win.close(); } catch (_e) { /* already gone */ }
  }
  if (typeof showToast === 'function') showToast(message, 'error');
}

/**
 * The stage's "Open document" escape hatch, through the SAME freshness gate the
 * tab switcher uses. The pane has no auto-refresh, so a calm read longer than
 * the signed-URL lifetime would otherwise hand the new tab an expired link and
 * show a storage error instead of the invoice.
 *
 * Fresh pack: return true and let the anchor's own href open natively — no
 * popup blocker in play, and ctrl/middle-click still work (that native path is
 * the fresh-pack case only; a stale href is what this gate exists to stop).
 * Stale pack: open the blank tab synchronously inside the click gesture, re-read
 * the pack, and navigate ONLY once that re-read is PROVEN to have landed newer
 * URLs — showMsReportingDetail catches its own load failures and returns
 * normally, leaving the expired cache in place, so "it resolved" is not evidence
 * of a fresh link.
 */
function _msOpenDocFullSize(jobId, idx) {
  if (!_msSesPackUrlsStale(jobId)) return true;
  var ctx = _msSesPackCache[jobId];
  var panelId = (ctx && ctx.panelId) || 'msReportingDetailPanel';
  var expiredFetchedAt = ctx ? ctx.fetchedAt : 0;
  var win = null;
  if (typeof window !== 'undefined' && window.open) {
    win = window.open('', '_blank');
    if (win) {
      try { win.opener = null; } catch (_e) { /* older browsers */ }
    }
  }
  _msActiveDocTab[jobId] = idx;
  Promise.resolve(showMsReportingDetail(jobId, panelId)).then(function() {
    var refreshed = _msSesPackCache[jobId];
    var landedFreshUrls = !!(refreshed && refreshed.fetchedAt &&
      refreshed.fetchedAt !== expiredFetchedAt && !_msSesPackUrlsStale(jobId));
    if (!landedFreshUrls) {
      _msAbandonDocFullSize(win, 'That link had expired and the pack could not be re-read. Reopen the review and try again.');
      return;
    }
    var url = _msDocTabUrlAt(jobId, idx);
    if (!url) {
      _msAbandonDocFullSize(win, 'That document is not in the refreshed pack.');
      return;
    }
    if (win) win.location.replace(url);
    else if (typeof showToast === 'function') {
      showToast('Your browser blocked the new tab. The pack link is refreshed now, so press Open document again.', 'error');
    }
  }).catch(function() {
    _msAbandonDocFullSize(win, 'Could not refresh the pack link. Reopen the review and try again.');
  });
  return false;
}

/**
 * Switch the active doc tab: update tab button styling + re-render just the PDF
 * stage. Signed pack URLs live 300s — a tab switch past that age re-fetches the
 * pack (full detail reload, preserving the clicked tab) instead of rendering a
 * dead iframe. Re-resolves the buttons + stage from the live panel so it works
 * in BOTH hosts.
 */
function _msSwitchDocTab(jobId, idx, panelId) {
  if (_msSesPackUrlsStale(jobId)) {
    _msActiveDocTab[jobId] = idx;
    showMsReportingDetail(jobId, panelId);
    return;
  }
  var d = _msReportingCache[jobId];
  if (!d) return;
  var docTabs = _msReportingDocTabs(d);
  if (idx < 0 || idx >= docTabs.length) return;
  _msActiveDocTab[jobId] = idx;
  var key = _msDocTabKey(jobId);
  // Scope the lookup to the HOST PANEL so the inline approvals panel and the board
  // overlay (which can both contain the same job's msDocStage_<key>) never collide:
  // getElementById would return whichever is first in the DOM, so an overlay tab
  // click could update the hidden inline copy. Resolve within the panel passed from
  // the click (the same id used to render this panel); fall back to document scope.
  var root = (panelId && document.getElementById(panelId)) || document;
  var tabsWrap = root.querySelector
    ? (root.querySelector('#msDocTabs_' + key) || document.getElementById('msDocTabs_' + key))
    : document.getElementById('msDocTabs_' + key);
  if (tabsWrap) {
    var btns = tabsWrap.querySelectorAll('button[data-tabidx]');
    for (var i = 0; i < btns.length; i++) {
      // aria-selected is the ONLY selection state: the tile styling hangs off
      // it in CSS, so inline colour writes here would fight the stylesheet.
      var active = (Number(btns[i].getAttribute('data-tabidx')) === idx);
      if (btns[i].setAttribute) btns[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }
  var stage = (root.querySelector && root.querySelector('#msDocStage_' + key)) || document.getElementById('msDocStage_' + key);
  if (stage) {
    stage.innerHTML = _msRenderDocStage(docTabs, idx, d);
  }
}

// ── CAROUSEL HELPERS ────────────────────────────────────────────────────────

/**
 * Map the row's draft_docs[] + source_docs[] into the shared doc-viewer entry
 * shape ({label, url, kind, doc}). Draft outputs lead (report/invoice/SWMS),
 * then source docs (work order, photos).
 */
function _msReportingBuildCarouselDocs(d) {
  var out = [];
  var seen = {};
  function add(label, url, kind, meta, isDraft) {
    meta = meta || {};
    // invoice_unavailable / doc_unavailable have no URL by design — an honest
    // "the document is here but its link could not be loaded" tile, not a fake.
    if (!url && !meta.raw_report && kind !== 'html' && kind !== 'invoice_unavailable' && kind !== 'doc_unavailable') return;
    var dedupeKey = url || [label || 'Document', meta.source_type || kind || '', meta.received_at || meta.created_at || ''].join('|');
    if (seen[dedupeKey]) return;
    seen[dedupeKey] = true;
    var k = kind || _msReportingDocKind(url);
    // For PDFs, append #view=Fit so the iframe opens to the whole page, not fit-width.
    var displayUrl = url;
    if (k === 'pdf' && displayUrl && displayUrl.indexOf('#') === -1) {
      displayUrl = displayUrl + '#view=Fit';
    }
    out.push({
      label: label || 'Document',
      url: displayUrl,
      kind: k,
      doc: null,
      isDraft: !!isDraft,
      created_at: meta.created_at || null,
      received_at: meta.received_at || meta.created_at || null,
      source_type: meta.source_type || null,
      raw_report: meta.raw_report || null,
      xero_invoice_id: meta.xero_invoice_id || null,
      invoice_number: meta.invoice_number || null,
      // Document-visibility flags from _msSesDocsFromArtifacts: what makes an
      // image a document rather than a photo, and what the capture knows about
      // itself. Dropping them here would put the capture back in the dark.
      isCapture: !!meta.isCapture,
      isDocumentImage: !!meta.isDocumentImage,
      capture: meta.capture || null,
      isUnknownRole: !!meta.isUnknownRole,
      roleName: meta.roleName || null,
      docLabel: meta.docLabel || null,
    });
  }
  // Drafted outputs first.
  if (Array.isArray(d.draft_docs)) {
    d.draft_docs.forEach(function(dd) { if (dd) add(dd.label, dd.url, _msReportingNormaliseKind(dd.kind), dd, true); });
  }
  // Source docs next (work order, photos, etc.).
  if (Array.isArray(d.source_docs)) {
    d.source_docs.forEach(function(sd) { if (sd) add(sd.label, sd.url, _msReportingNormaliseKind(sd.kind), sd, false); });
  }
  return out;
}

// Normalise a feed kind to the viewer's kind vocabulary.
// Unknown kinds get classified by URL (null → doc-kind from URL).
function _msReportingNormaliseKind(kind) {
  if (kind === 'pdf' || kind === 'image' || kind === 'html' ||
      kind === 'invoice_unavailable' || kind === 'doc_unavailable') {
    return kind;
  }
  return null;
}

// Classify a URL when the feed didn't supply a kind.
function _msReportingDocKind(url) {
  var u = String(url || '').split('?')[0].toLowerCase();
  if (/\.pdf$/.test(u)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic)$/.test(u)) return 'image';
  return 'other';
}

function _msReportingFormatTimestamp(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// (The former standalone Draft-invoice section and Source-evidence link list
// are gone: the invoice is a DOCUMENT — the Invoice tab on the stage — and
// every work order and trade doc is its own tab, so nothing is reachable in
// fewer places than before.)

// (No per-line money-review highlighting here: no feed reaching this pane
// carries flagged_lines. The board card's amber "Check pricing" chip is driven
// by the enriched row's needs_money_review and remains the only money-review
// cue this repo can honestly render.)

// ── STATE-AWARE ACTION BLOCK (SES cockpit controls) ─────────────────────────

/**
 * Whether this context carries the byte-exact pack preview the Captain must
 * inspect before sending. A queue-backed context proves that relationship with
 * its docket id; a remembered signed-off pack proves it with a successful read
 * timestamp. A client-recovered invoice PDF alone is not the release pack.
 */
function _msSesHasReviewPackPreview(ctx) {
  if (!ctx || !ctx.pack || typeof ctx.pack !== 'object') return false;
  return !!(
    (ctx.queueEntry && ctx.docketRevisionId) ||
    (Number(ctx.fetchedAt) > 0 && ctx.docketRevisionId)
  );
}

/** A SEND preview exists only when at least one real outgoing route renders. */
function _msSesHasRenderableRoutePreview(cockpit) {
  var routes = cockpit && cockpit.sections && cockpit.sections.email_drafts;
  return Array.isArray(routes) && routes.some(function(route) {
    return !!(route && typeof route === 'object');
  });
}

/**
 * ONE CONTROL, rendered at the BOTTOM of the pane in the pinned
 * .msr-actions-foot — a flex sibling outside the scroll body, deliberately
 * NOT position:sticky (sticky overlays content on a full-page shot).
 *
 * The control runs the same guarded server actions as the old two stamps. When
 * invoice authorisation produces a fresh docket, the first pass stops after
 * repainting it; the Captain must review and press again before that revision
 * is signed off or sent. Both approvals stay separate, the sign-off remains
 * bound to the displayed hash, and a pack that changed still voids the press.
 *
 * The byte-exact pack and at least one outgoing route preview must be loaded,
 * then the backend control flags own whether the stamp is armed —
 * approve_invoice when the invoice still needs authorising, send_it when it
 * does not. Document and hold caveats remain visible above for Captain review
 * but do not become a second client-side veto. A disabled stamp carries no id
 * and no onclick, with the owning refusal underneath. The retired 410 combined
 * path is never called.
 */
function _msSesActionBlock(jobId, ctx, dismissAction) {
  var cockpit = ctx.cockpit || {};
  var sections = cockpit.sections || {};
  var controls = cockpit.controls || {};
  var approveInvoice = controls.approve_invoice || {};
  var sendIt = controls.send_it || {};
  var xero = (sections.money && sections.money.xero) ||
    (ctx.pack && ctx.pack.docket && ctx.pack.docket.xero_binding) || null;
  var safeId = _msJsAttr(jobId);
  // Recorded hours/wording edits the pack does not carry yet lock the press:
  // the screen shows the edited preview, so a send of the unedited pack would
  // send something other than what is shown.
  var previewLock = _msSesPreviewOf(jobId, ctx);
  var packPreviewLoaded = _msSesHasReviewPackPreview(ctx);
  var routePreviewLoaded = _msSesHasRenderableRoutePreview(cockpit);
  var armed = packPreviewLoaded && routePreviewLoaded && !previewLock &&
    !!(approveInvoice.enabled || sendIt.enabled);
  var routeCount = Array.isArray(sections.email_drafts) ? sections.email_drafts.length : null;
  var html = '';
  var captainNote = controls.captain_only ? ' Captain authority is required for this pack.' : '';

  // disabled_reason is the backend's honest closed-door text (PR 563). Prefer
  // it over local hold/xero guesses whenever the stamp is off. Never invent a
  // reason when the field is absent — fall through to the existing copy.
  function controlDisabledNote(ctrl, fallback) {
    var reason = ctrl && ctrl.disabled_reason != null ? String(ctrl.disabled_reason).trim() : '';
    return reason ? escapeHtml(reason) : fallback;
  }

  var note;
  var fullNote = '';
  if (armed) {
    var emailsPhrase = routeCount
      ? ('the ' + _msSmallNumberWord(routeCount) + ' email' + (routeCount === 1 ? '' : 's') + ' shown above')
      : 'the emails shown above';
    // Beside the stamp: ONE short line ending with the irreversibility warning
    // (captain ruling 2026-08-13: the preview owns the pane, the explanation
    // folds). The full sentence moves verbatim into "What one press does".
    note = approveInvoice.enabled
      ? 'This pass records your invoice approval, authorises the Xero draft invoice, then reloads the invoice-bound pack for review. Nothing sends until you review that revision and press again.'
      : ('One press records your send approval for this exact pack and sends ' + emailsPhrase + '.');
    note += ' Irreversible. Your press, every time.';
    note = escapeHtml(note);
    fullNote = approveInvoice.enabled
      ? 'Records your invoice approval for this exact pack and authorises the Xero draft invoice already prepared for it. The newly bound pack then replaces this view for review; this pass sends no email.'
      : ('Records your send approval for this exact pack and sends ' + emailsPhrase + '.');
  } else if (!packPreviewLoaded) {
    note = 'The byte-exact pack preview is not loaded, so this screen cannot show exactly what would be sent. Reopen the review pack before pressing.';
  } else if (!routePreviewLoaded) {
    note = 'The outgoing email preview is not loaded, so this screen cannot show the exact recipients and attachments. Reopen the review pack before pressing.';
  } else if (previewLock) {
    note = 'Your hours/wording edits are recorded on this docket, but this pack does not carry them yet. The press unlocks on the revised pack that does.';
  } else {
    // Not armed and not held: whichever control the backend would unlock next
    // owns the reason. Never invent one.
    var fallback;
    if (xero && (xero.invoice_number || xero.status)) {
      fallback = 'Nothing to press. Invoice ' + escapeHtml(xero.invoice_number || '')
        + (xero.status ? ' is ' + escapeHtml(String(xero.status)) : '')
        + ' in Xero and the system has not unlocked sending yet.' + captainNote;
    } else {
      fallback = 'The system has not unlocked this pack yet.' + captainNote;
    }
    note = controlDisabledNote(sendIt, controlDisabledNote(approveInvoice, fallback));
  }

  html += '<div class="msr-steps one">';
  html += _msSesStamp({
    word: 'APPROVE AND SEND',
    kind: 'send',
    enabled: armed,
    id: 'msSesApproveAndSendBtn',
    onclick: 'sesApproveAndSend(\'' + safeId + '\')',
    note: note
  });
  html += '</div>';

  // Where a stopped chain says which step refused and why, verbatim. Rendered
  // empty so a refusal never has to create structure while the pane is live.
  html += '<div class="msr-chain-error" id="msSesChainError-' + safeId + '" hidden></div>';

  if (armed) {
    html += '<details class="msr-what"><summary>What one press does</summary>';
    // The full press sentence, verbatim — folded here (not deleted) when the
    // beside-the-stamp note was condensed to keep the foot compact.
    html += '<p>' + escapeHtml(fullNote) + '</p>';
    html += '<ol>';
    if (approveInvoice.enabled) {
      html += '<li>Records your <b>invoice approval</b> for this exact invoice revision, then authorises the Xero draft invoice already prepared for it and binds its PDF into the pack.</li>';
      html += '<li>Reloads that invoice-bound pack into this pane and stops for your review. No email is sent on this pass.</li>';
    } else {
      html += '<li>Records your <b>Docs Ready sign-off</b>, bound to the exact pack hash on screen.</li>';
      html += '<li>Records your <b>send approval</b> for the release built from that pack.</li>';
      html += '<li>Sends the emails exactly as shown, and writes the send proofs.</li>';
    }
    html += '</ol>';
    // The backend's OWN plan text for each armed step, verbatim. It is the
    // system describing what it is about to do; this screen never rewrites it.
    var plans = [];
    if (approveInvoice.enabled && approveInvoice.plan) plans.push(approveInvoice.plan);
    if (!approveInvoice.enabled && sendIt.enabled && sendIt.plan) plans.push(sendIt.plan);
    plans.forEach(function(planText) {
      html += '<p class="msr-plan">The system&rsquo;s own words: ' + escapeHtml(String(planText)) + '</p>';
    });
    html += approveInvoice.enabled
      ? '<p>Invoice approval is recorded against this docket revision only. The send approval belongs to the refreshed revision you review next.</p>'
      : '<p>The Docs Ready and send approvals are recorded separately, against this docket revision only. If a step refuses, the press stops there, the earlier approvals stand, and pressing again picks up from the step that refused.</p>';
    html += '</details>';
  }

  // The Docs Ready tick state, bound to the exact displayed pack hash. This is
  // the captain's per-job approval record (blueprint: "the approve control is
  // your decision" / RV-10): a tick that dies the moment the pack's bytes
  // change, never a running approve-all. Caveats never hide the Captain's
  // manual-review record.
  var tickPending = (ctx.reviewState === 'needs_review' && ctx.docketRevisionId && ctx.outputHash);
  html += '<div class="msr-tick' + (tickPending ? ' pending' : '') + '">';
  if (tickPending) {
    html += '<span>Your Docs Ready approval is <b>not yet recorded</b>. '
      + (approveInvoice.enabled
        ? 'This invoice pass reloads the invoice-bound pack first; after you review it, the send pass records approval against that displayed version.'
        : 'This send pass records it against exactly this version of the pack (<code>' + escapeHtml(String(ctx.outputHash).slice(0, 27)) + '&#8230;</code>). If the pack changes afterwards, that approval is void and the pack comes back here.')
      + '</span>';
  } else {
    html += '<span>Your Docs Ready approval is <b>already recorded</b> for exactly this version of the pack.</span>';
  }
  html += '</div>';
  return html;
}

/**
 * One step of the stamp rail: the lavish rubber-stamp object (heavy border +
 * inset double rule, letterspaced caps — a captain-pinned element). An
 * enabled stamp is a live button; a disabled stamp stays fully visible so the
 * captain always sees what this screen CAN do, but carries no id and no
 * onclick — there is nothing to press, only the reason underneath.
 */
function _msSesStamp(o) {
  var html = '<div class="msr-step">';
  if (o.enabled) {
    html += '<button type="button" id="' + o.id + '" class="msr-stamp ' + o.kind + '" onclick="' + o.onclick + '"><span class="msr-stamp-word">' + o.word + '</span></button>';
  } else {
    html += '<button type="button" class="msr-stamp ' + o.kind + '" disabled aria-disabled="true"><span class="msr-stamp-word">' + o.word + '</span></button>';
  }
  html += '<div class="msr-stamp-note' + (o.enabled ? '' : ' locked') + '">' + o.note + '</div>';
  html += '</div>';
  return html;
}

// Write progress text into the stamp's word span (never the button itself:
// textContent on the button would delete the styled span and leave the stamp
// unstyled until the next full render). Falls back to the button in
// environments without querySelector (the node smoke's stub elements).
function _msSesStampProgress(btn, text) {
  if (!btn) return;
  var w = btn.querySelector ? btn.querySelector('.msr-stamp-word') : null;
  (w || btn).textContent = text;
}

/**
 * Reset #msReportingDetailPanel to the empty state.
 */
function showMsReportingDetailEmpty() {
  var panel = document.getElementById('msReportingDetailPanel');
  if (!panel) return;
  panel.innerHTML = '<div class="approvals-empty-state">'
    + '<div style="font-size:36px;opacity:0.3;margin-bottom:12px;">&#128203;</div>'
    + '<div style="font-size:13px;color:var(--sw-text-sec);">Select a pack to review</div>'
    + '</div>';
}

// ────────────────────────────────────────────────────────────
// 3. ACTION - ONE CONTROL (invoice pass, then separately reviewed send pass)
// ────────────────────────────────────────────────────────────

// The word on the resting stamp. Progress text replaces it during a press and
// a stopped chain resumes under RESUME, so the captain is never told to press
// something that would start again from the top.
var _MS_SES_PRESS_WORD = 'APPROVE AND SEND';
var _MS_SES_RESUME_WORD = 'RESUME';

/** The action control, resolved inside the panel that owns the detail. */
function _msSesPressButton(jobId) {
  return _msSesScopedEl(jobId, 'msSesApproveAndSendBtn');
}

function _msSesClearChainError(jobId) {
  var el = _msSesScopedEl(jobId, 'msSesChainError-' + jobId);
  if (!el) return;
  el.innerHTML = '';
  if ('hidden' in el) el.hidden = true;
}

/**
 * Stop the chain where it refused and SAY SO: which step, and the server's own
 * words verbatim. Whatever was recorded before this step stands — pressing
 * again re-runs the chain, and the server actions refuse or no-op the steps
 * already done, so a resume never double-records or double-sends.
 */
function _msSesChainStopped(jobId, stepLabel, factText, opts) {
  opts = opts || {};
  var el = _msSesScopedEl(jobId, 'msSesChainError-' + jobId);
  if (el) {
    var html = '<div class="msr-chain-h">Stopped at: ' + escapeHtml(stepLabel) + '</div>';
    html += '<div class="msr-chain-fact">' + escapeHtml(String(factText || 'The server refused without a reason.')) + '</div>';
    html += '<div class="msr-chain-foot">'
      + (opts.recorded
        ? 'What was already recorded stands. '
        : 'Nothing was recorded for the step that refused. ')
      + 'Press again once the reason above is cleared, and the press picks up from this step.</div>';
    el.innerHTML = html;
    if ('hidden' in el) el.hidden = false;
  }
  var btn = _msSesPressButton(jobId);
  if (btn) { btn.disabled = false; _msSesStampProgress(btn, _MS_SES_RESUME_WORD); }
  showToast('Stopped at ' + stepLabel + ': ' + String(factText || 'refused'), 'error');
}

/**
 * Re-read the SES context after invoice authorisation. The caller repaints this
 * exact revision and stops so the Captain sees it before any send pass.
 */
async function _msSesRefreshPackContext(jobId) {
  var panelId = (_msSesPackCache[jobId] && _msSesPackCache[jobId].panelId) || 'msReportingDetailPanel';
  await _msSesRefreshReviewQueue();
  var next = await _msSesLoadPackContext(jobId);
  await _msSesHydrateBoundInvoicePdf(next);
  await _msSesHydratePortalCaptureFacts(next);
  next.packCompleteness = _msSesPackCompleteness(
    jobId,
    next,
    _msReportingCache[jobId]
  );
  _msSesPackCompletenessById[jobId] = next.packCompleteness;
  next.panelId = panelId;
  _msSesPackCache[jobId] = next;
  return next;
}

/**
 * ONE CONTROL over two review-bound passes, with every server guard unchanged:
 *
 *   1. approve_ses_invoice_revision (JWT, includes_authorise)  ─┐ only when the
 *      execute_ses_invoice_revision (authorises the Xero draft) ┘ backend arms
 *      approve_invoice; the invoice bind produces a FRESH docket revision, so
 *      the pack is re-read, repainted, and this pass STOPS for Captain review.
 *   2. sign_off_ses_docket (JWT, bound to the exact displayed pack hash) —
 *      skipped only when the tick is already recorded for the current bytes.
 *   3. prepare_ses_release_revision { job_ids: [jobId] }  (this job only).
 *   4. approve_ses_release_revision (JWT) — the send approval.
 *   5. execute_ses_release_revision — sends the routes and writes the proofs.
 *
 * Both approvals are still recorded separately and per docket revision; the
 * hash binding is unchanged, so a pack that moved on still voids the press. On
 * any refusal the chain stops at that step and shows the server's words
 * verbatim; the earlier recorded approvals stand and pressing again resumes.
 */
/**
 * Exact review coordinates the approve door requires (ops-api T8).
 * Echoed from the pack on screen, never invented.
 */
function _msSesEchoedReviewCoordinates(ctx) {
  var story = ((ctx && ctx.cockpit && ctx.cockpit.sections) || {}).job_story || {};
  var packDock = (ctx && ctx.pack && ctx.pack.docket) || {};
  var money = ((ctx && ctx.cockpit && ctx.cockpit.sections) || {}).money || {};
  var bound = money.bound_invoice || money.xero || {};
  var packXero = packDock.xero_binding || {};
  return {
    expected_docket_revision_id: ctx.docketRevisionId || story.docket_revision_id || packDock.id || null,
    expected_output_content_hash: ctx.outputHash || story.docket_output_content_hash || packDock.output_content_hash || null,
    expected_invoice_obligation_revision_id: story.invoice_obligation_revision_id ||
      packDock.invoice_obligation_revision_id || null,
    expected_draft_pdf_content_hash: bound.pdf_content_hash || packXero.pdf_content_hash || null
  };
}

async function sesApproveAndSend(jobId) {
  var ctx = _msSesPackCache[jobId];
  if (!ctx) { showToast('Pack not loaded; reopen the review panel.', 'error'); return; }
  // A cockpit status and enabled controls are not a send preview. Refuse a
  // programmatic call unless this screen loaded the byte-exact pack whose
  // documents and route attachments the Captain is reviewing.
  if (!_msSesHasReviewPackPreview(ctx)) {
    showToast('The byte-exact pack preview is not loaded. Reopen the review pack before pressing.', 'error');
    return;
  }
  if (!_msSesHasRenderableRoutePreview(ctx.cockpit)) {
    showToast('The outgoing email preview is not loaded. Reopen the review pack before pressing.', 'error');
    return;
  }
  // Fail closed: only the backend control flags can arm a press, whatever
  // invoked this function. A disabled stamp has no id and no onclick, and even
  // a programmatic call stops here.
  var controls = (ctx.cockpit && ctx.cockpit.controls) || {};
  var approveCtl = controls.approve_invoice || {};
  var sendCtl = controls.send_it || {};
  // Captain-reviewed caveats are not a client-side veto. The backend flags and
  // every exact-revision guard in the chain below still own real execution.
  if (!(approveCtl.enabled || sendCtl.enabled)) {
    showToast('This pack is not armed to approve or send.', 'error');
    return;
  }
  // Fail closed while recorded hours/wording edits are still in flight: the
  // screen shows the edited preview, and this pack does not carry it. Sending
  // now would send something other than what is shown.
  if (_msSesPreviewOf(jobId, ctx)) {
    showToast('Your edits are recorded on this docket but this pack does not carry them yet. Wait for the revised pack, review it, then press.', 'error');
    return;
  }

  var needsInvoice = !!approveCtl.enabled;
  var confirmMsg = needsInvoice
    ? 'APPROVE AND SEND: this pass records your invoice approval for exactly this docket revision and AUTHORISES the Xero draft invoice already prepared for it. It then reloads the invoice-bound pack for review and sends no email. Invoice authorisation is irreversible. Continue?'
    : 'ONE PRESS: this records your send approval for exactly this docket revision and sends the emails shown to the exact recipients shown. This is irreversible. Continue?';
  if (!confirm(confirmMsg)) return;

  _msSesClearChainError(jobId);
  var btn = _msSesPressButton(jobId);
  if (btn) { btn.disabled = true; _msSesStampProgress(btn, 'Working...'); }
  var actor = _msSesActor();
  var invoiceRecorded = false;

  // Step 1 — the invoice approval, when the pack still needs one.
  if (needsInvoice) {
    try {
      if (btn) _msSesStampProgress(btn, 'Approving invoice...');
      var echo = _msSesEchoedReviewCoordinates(ctx);
      if (!echo.expected_invoice_obligation_revision_id) {
        var ob = await opsFetch('query_ses_invoice_obligation', { job_id: jobId });
        var revisions = (ob && ob.revisions) || [];
        echo.expected_invoice_obligation_revision_id = revisions.length ? revisions[0].id : null;
      }
      if (
        !echo.expected_docket_revision_id ||
        !echo.expected_invoice_obligation_revision_id ||
        !echo.expected_output_content_hash
      ) {
        throw new Error('This pack is missing the exact review coordinates needed to approve the invoice.');
      }
      var approveBody = {
        job_id: jobId,
        includes_authorise: true,
        expected_docket_revision_id: echo.expected_docket_revision_id,
        expected_invoice_obligation_revision_id: echo.expected_invoice_obligation_revision_id,
        expected_output_content_hash: echo.expected_output_content_hash
      };
      if (echo.expected_draft_pdf_content_hash) {
        approveBody.expected_draft_pdf_content_hash = echo.expected_draft_pdf_content_hash;
      }
      var approval = await opsPostJwt('approve_ses_invoice_revision', approveBody);
      invoiceRecorded = true;
      var obligationRevisionId = approval && approval.approval && approval.approval.invoice_obligation_revision_id;
      if (!obligationRevisionId) {
        var ob = await opsFetch('query_ses_invoice_obligation', { job_id: jobId });
        var revisions = (ob && ob.revisions) || [];
        obligationRevisionId = revisions.length ? revisions[0].id : null;
      }
      if (!obligationRevisionId) {
        throw new Error('The approved invoice obligation revision could not be resolved.');
      }
      if (btn) _msSesStampProgress(btn, 'Authorising in Xero...');
      var invExec = { job_id: jobId, invoice_obligation_revision_id: obligationRevisionId };
      if (actor) invExec.actor = actor;
      await opsPost('execute_ses_invoice_revision', invExec);
    } catch (e) {
      if (_msSesIsStale(e)) return _msSesChainStale(jobId, invoiceRecorded);
      _msSesChainStopped(jobId, 'approving the invoice', (e && e.message) || e, { recorded: invoiceRecorded });
      return;
    }

    // The invoice bind produced a NEW docket revision carrying the Xero PDF.
    // Repaint THAT pack and stop. It was not the revision visible when the
    // Captain pressed, so it cannot be signed off or sent until reviewed.
    try {
      if (btn) _msSesStampProgress(btn, 'Reloading the pack...');
      ctx = await _msSesRefreshPackContext(jobId);
    } catch (e) {
      _msSesChainStopped(jobId, 'reloading the invoice-bound pack', (e && e.message) || e, { recorded: true });
      return;
    }
    var refreshedPanel = document.getElementById(ctx.panelId || 'msReportingDetailPanel');
    if (refreshedPanel) {
      refreshedPanel.innerHTML = _msSesRenderDetail(jobId, ctx, ctx.panelId);
      _msHydratePdfSurfaces(refreshedPanel);
      if (typeof loadMsNotes === 'function') {
        loadMsNotes(jobId, 'msNotesPanel-' + jobId);
      }
    }
    showToast('Invoice authorised. Review the refreshed invoice-bound pack, then press APPROVE AND SEND again to send.', 'success');
    return;
  }

  // Step 2 — the Docs Ready sign-off, hash-bound to the pack in view.
  var releaseRevisionId = null;
  try {
    if (ctx.reviewState === 'needs_review' && ctx.docketRevisionId && ctx.outputHash) {
      if (btn) _msSesStampProgress(btn, 'Signing off...');
      await opsPostJwt('sign_off_ses_docket', {
        docket_revision_id: ctx.docketRevisionId,
        expected_output_content_hash: ctx.outputHash
      });
    }
  } catch (e) {
    if (_msSesIsStale(e)) return _msSesChainStale(jobId, invoiceRecorded);
    _msSesChainStopped(jobId, 'signing off the pack', (e && e.message) || e, { recorded: invoiceRecorded });
    return;
  }

  // Step 3 — build the release for THIS job only.
  try {
    if (btn) _msSesStampProgress(btn, 'Preparing the release...');
    var prepBody = { job_ids: [jobId] };
    if (actor) prepBody.created_by = actor;
    var prepared = await opsPost('prepare_ses_release_revision', prepBody);
    releaseRevisionId = prepared && prepared.release && prepared.release.id;
    if (!releaseRevisionId) {
      throw new Error('The release revision id was not returned by prepare_ses_release_revision.');
    }
  } catch (e) {
    if (_msSesIsStale(e)) return _msSesChainStale(jobId, true);
    _msSesChainStopped(jobId, 'preparing the release', (e && e.message) || e, { recorded: true });
    return;
  }

  // Step 4 — the send approval.
  try {
    if (btn) _msSesStampProgress(btn, 'Approving the send...');
    await opsPostJwt('approve_ses_release_revision', { release_revision_id: releaseRevisionId });
  } catch (e) {
    if (_msSesIsStale(e)) return _msSesChainStale(jobId, true);
    _msSesChainStopped(jobId, 'approving the send', (e && e.message) || e, { recorded: true });
    return;
  }

  // Step 5 — send.
  try {
    if (btn) _msSesStampProgress(btn, 'Sending...');
    var execBody = { release_revision_id: releaseRevisionId };
    if (actor) execBody.actor = actor;
    var executed = await opsPost('execute_ses_release_revision', execBody);
    var proofCount = executed && Array.isArray(executed.route_proofs) ? executed.route_proofs.length : null;
    showToast('Sent'
      + (proofCount != null ? ' — ' + proofCount + ' email' + (proofCount === 1 ? '' : 's') + ' released' : '')
      + (needsInvoice ? ', invoice authorised' : '')
      + ' and the closeout is verified.', 'success');
    _msReportingAfterSend();
  } catch (e) {
    if (_msSesIsStale(e)) return _msSesChainStale(jobId, true);
    _msSesChainStopped(jobId, 'sending', (e && e.message) || e, { recorded: true });
  }
}

/**
 * A 409 stale_review anywhere in the chain: the pack moved on, so the press is
 * void from that step. Nothing further is sent and the fresh pack is reloaded.
 */
function _msSesChainStale(jobId, recorded) {
  showToast('The pack changed while you reviewed it. Reloading the fresh pack — nothing further was sent.', 'info');
  _msSesChainStopped(
    jobId,
    'the pack changed',
    'This pack moved on after the screen loaded, so the press was voided at that step. Read the fresh pack and press again.',
    { recorded: !!recorded }
  );
  _msSesReloadDetail(jobId);
}

/**
 * Reload the list and reopen this job's detail against the fresh SES state
 * (used after a successful APPROVE INVOICE and after any stale_review).
 */
function _msSesReloadDetail(jobId) {
  var panelId = (_msSesPackCache[jobId] && _msSesPackCache[jobId].panelId) || 'msReportingDetailPanel';
  loadMakesafeReportingCockpit().then(function() {
    // Reopen whenever the host panel is still mounted — never only when the
    // needs_review queue re-seeded the cache row. A drafted pack can be
    // reviewable WITHOUT queue membership (docket id off the canonical row),
    // and showMsReportingDetail self-seeds identity when the row is absent;
    // skipping the reopen here would strand the pre-reload DOM.
    if (document.getElementById(panelId)) {
      showMsReportingDetail(jobId, panelId);
    }
  });
}

/**
 * Refresh whichever surface hosts the reporting review after a successful send.
 * Board overlay: close it and reload the unified kanban (the card moves out of
 * Report Ready). Inline approvals tab: reload the cockpit list + reset the detail
 * panel.
 */
function _msReportingAfterSend() {
  if (typeof closeMakesafeReportingOverlay === 'function' && document.getElementById('makesafeReportingOverlay')) {
    closeMakesafeReportingOverlay();
    if (typeof loadJobs === 'function') loadJobs();
    return;
  }
  loadMakesafeReportingCockpit();
  showMsReportingDetailEmpty();
}

/**
 * Hide a job from the active human-decision queue once it has been handed back
 * to the draft agent for a revise pass. This is intentionally UI-side and
 * reversible: a failed request reloads the feed; a successful request only
 * returns when makesafe_report_drafts surfaces a new actionable draft.
 */
function _msReportingHideJobFromActiveList(jobId, reason) {
  var safeId = _msDocTabKey(jobId);
  var card = document.querySelector('[data-ms-reporting-card="' + safeId + '"]');
  if (card && card.parentNode) card.parentNode.removeChild(card);
  if (_msReportingCache && _msReportingCache[jobId]) delete _msReportingCache[jobId];

  var count = _msReportingCache ? Object.keys(_msReportingCache).length : 0;
  refreshMsReportingBadge(count);

  var listBody = document.getElementById('msReportingListBody');
  if (listBody && count === 0) {
    listBody.innerHTML = '<div style="padding:40px 20px;text-align:center;">'
      + '<div style="font-size:36px;opacity:0.3;margin-bottom:12px;">&#9203;</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--sw-dark);">No report drafts waiting for your tick</div>'
      + '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:6px;">Revision requests are hidden until the draft agent returns the next pack.</div>'
      + '</div>';
  }

  var panel = document.getElementById('msReportingDetailPanel');
  if (panel) {
    panel.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--sw-text-sec);">'
      + '<div style="font-size:36px;opacity:0.35;margin-bottom:12px;">&#9889;</div>'
      + '<div style="font-size:15px;font-weight:800;color:var(--sw-dark);">Revision handed back to MakeSafe Agent</div>'
      + '<div style="font-size:12px;line-height:1.45;margin-top:8px;">' + escapeHtml(reason || 'This pack is hidden from the active review list until the next draft is ready.') + '</div>'
      + '</div>';
  }

  if (typeof closeMakesafeReportingOverlay === 'function' && document.getElementById('makesafeReportingOverlay')) {
    closeMakesafeReportingOverlay();
    if (typeof loadJobs === 'function') loadJobs();
  }
}

// ────────────────────────────────────────────────────────────
// 4. BADGE
// ────────────────────────────────────────────────────────────

/**
 * Update the Reporting tab badge with the pack count. Hidden when 0.
 */
function refreshMsReportingBadge(count) {
  var badge = document.getElementById('msReportingBadge');
  if (!badge) return;
  if (count && count > 0) {
    badge.textContent = String(count);
    badge.style.display = '';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

// ── PHOTO COLLECTION (shared with the feedback module) ──────────────────────

/**
 * Collect all photos from d.source_docs (kind=image) or d.photos[] as a fallback.
 * Returns [{url, label}] — used by the feedback module's photo reference list.
 */
function _msGetAllPhotos(d) {
  var photos = [];
  if (Array.isArray(d.source_docs)) {
    d.source_docs.forEach(function(sd) {
      if (sd && (sd.kind === 'image' || _msReportingDocKind(sd.url || '') === 'image')) {
        photos.push({ url: sd.url, label: sd.label || 'Photo' });
      }
    });
  }
  if (!photos.length && Array.isArray(d.photos)) {
    d.photos.forEach(function(p, i) {
      if (p && (p.url || p.thumbnail_url)) {
        photos.push({ url: p.url || p.thumbnail_url, label: p.label || ('Photo ' + (i + 1)) });
      }
    });
  }
  return photos;
}

// ── PORTAL BUILDER DETECTION ─────────────────────────────────────────────────

/**
 * Returns true if this job belongs to a portal-submission builder
 * (Western Building or Builderwest). These builders use a secure portal
 * (e.g. Prime) rather than email. In the SES flow the portal capture evidence
 * is recorded by the capture tooling; this screen only NOTES the portal branch
 * (it cannot submit to the portal).
 */
function _msIsPortalBuilder(d) {
  // MUST mirror the backend _isMakesafeWesternCompany (ops-api index.ts) exactly so
  // the UI and the send path agree on who is a portal builder. Backend matches:
  //   slug: builderwest / western-building
  //   name: builderwest / western building
  //   ref:  BWCWA* or WB-<digit> / WB <digit>
  var name = String((d.builder || d.requesting_company_name || '')).toLowerCase();
  var slug = String(d.requesting_company_slug || '').toLowerCase();
  var ref = String(d.external_ref || '').toUpperCase();
  if (slug.indexOf('builderwest') >= 0 || slug.indexOf('western-building') >= 0) return true;
  if (name.indexOf('builderwest') >= 0 || name.indexOf('western building') >= 0) return true;
  if (ref.indexOf('BWCWA') === 0 || /\bWB[-\s]?\d/.test(ref)) return true;
  return false;
}

// SMOKE TEST (manual, run in browser console):
// 1. showView('approvals') -- approvals view loads
// 2. Click "MakeSafe Reporting" tab -- reporting cockpit renders, loading state
// 3. loadMakesafeReportingCockpit() returns the SES queue count (0 or N); cards
//    render from the Docs Ready queue with board-joined identity, and chips
//    enrich to the SES cockpit status (DOCS READY / APPROVE INVOICE /
//    SEND READY / ON HOLD / NO SES PACK)
// 4. Clicking a card loads query_ses_review_cockpit + get_ses_reviewable_pack
//    and renders the DONE strip, the document tiles (inline stage), the portal
//    evidence tiles with their OPEN LINK buttons, the invoice lines, the exact
//    routes and the fixed photo set
// 5. ONE press (when armed) runs approve_ses_invoice_revision (JWT) ->
//    execute_ses_invoice_revision -> [pack re-read] -> sign_off_ses_docket
//    (JWT, hash-bound) -> prepare_ses_release_revision ->
//    approve_ses_release_revision (JWT) -> execute_ses_release_revision, and
//    stops at the first refusal naming the step and the server's own words
// 6. A job with no SES docket shows the honest "no reviewable pack" state and
//    never calls the retired 410 actions
//
// Automated smoke: modules/ops-makesafe-reporting-cockpit.smoke.mjs

// Export for the node smoke test (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadMakesafeReportingCockpit: typeof loadMakesafeReportingCockpit !== 'undefined' ? loadMakesafeReportingCockpit : undefined,
    renderMsReportingCard: typeof renderMsReportingCard !== 'undefined' ? renderMsReportingCard : undefined,
    makesafePackCompletenessVerdict: typeof makesafePackCompletenessVerdict !== 'undefined' ? makesafePackCompletenessVerdict : undefined,
    makesafePackTruthFromCanonicalRow: typeof makesafePackTruthFromCanonicalRow !== 'undefined' ? makesafePackTruthFromCanonicalRow : undefined,
    _msSesQueueCardRow: typeof _msSesQueueCardRow !== 'undefined' ? _msSesQueueCardRow : undefined,
    _msSesReviewQueueStale: typeof _msSesReviewQueueStale !== 'undefined' ? _msSesReviewQueueStale : undefined
  };
}
