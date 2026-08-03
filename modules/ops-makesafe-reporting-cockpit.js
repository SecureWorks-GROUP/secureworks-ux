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
// identity (job number / builder / suburb / ref / family) is joined from the
// canonical makesafe_board feed already cached by the board load, and the
// status chip + invoice glance are enriched per card from
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
// ACTIONS (per-job only — never a multi-job release):
//   APPROVE INVOICE: approve_ses_invoice_revision (JWT, includes_authorise)
//     -> execute_ses_invoice_revision (creates + AUTHORISES the real Xero
//     invoice and binds the Xero PDF into a fresh docket that needs a new tick).
//   SEND IT: sign_off_ses_docket (JWT, hash-bound to the displayed pack) ->
//     prepare_ses_release_revision { job_ids: [job] } ->
//     approve_ses_release_revision (JWT) -> execute_ses_release_revision.
//     SEND IT releases ALL THREE routes (report + photo + invoice emails) at
//     once; the UI copy says so.
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
    makesafe_job_family_label: row.ses_family_label || null
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
    makesafe_job_family_label: card.ses_family_label || null
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
      'makesafe_job_family', 'makesafe_job_family_label'].forEach(function(k) {
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
  var chip = _msSesStatusChip(status);
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
  var html = '<div data-ms-reporting-card="' + escapeAttr(cardKey) + '" onclick="showMsReportingDetail(\'' + safeId + '\')" style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;padding:12px;margin:10px;cursor:pointer;box-shadow:0 1px 3px rgba(41,60,70,0.06);border-left:4px solid #94A3B8;">';

  // Top row: the SES status chip (enriched async from query_ses_review_cockpit).
  html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
  html += '<span id="msCardBadge_' + escapeAttr(cardKey) + '" style="font-size:9px;font-weight:800;letter-spacing:0.04em;padding:2px 7px;border-radius:10px;background:#6B7280;color:#fff;">CHECKING SES&#8230;</span>';
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

  // Review button. Same review mechanism as the board "Review job pack" action.
  html += '<div style="margin-top:10px;">';
  html += '<button onclick="event.stopPropagation();showMsReportingDetail(\'' + safeId + '\')" style="width:100%;background:#1F3A44;color:#fff;border:none;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Review job pack</button>';
  html += '</div>';

  html += '</div>';
  return html;
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
  } catch (e) {
    panel.innerHTML = _msSesRenderUnavailable(jobId, base, e, targetPanelId);
    return;
  }
  ctx.panelId = targetPanelId || 'msReportingDetailPanel';
  _msSesPackCache[jobId] = ctx;
  panel.innerHTML = _msSesRenderDetail(jobId, ctx, targetPanelId);
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
 * row can lag a fresh docket revision, so on a 409 we refresh the queue and
 * retry once before surfacing the refusal.
 */
async function _msSesLoadPackContext(jobId, retried) {
  var cockpit = await opsFetch('query_ses_review_cockpit', { job_id: jobId });
  var entry = _msSesReviewQueue[jobId] || null;
  if (!entry && !retried) {
    await _msSesRefreshReviewQueue();
    entry = _msSesReviewQueue[jobId] || null;
  }
  var ctx = {
    jobId: jobId,
    cockpit: cockpit,
    queueEntry: entry,
    pack: null,
    docketRevisionId: entry ? entry.docket_revision_id : null,
    outputHash: entry ? (entry.docket_output_content_hash || null) : null,
    // No queue entry + a loading cockpit means the current docket has already
    // passed the needs_review queue, i.e. its Docs Ready tick is recorded.
    reviewState: entry ? (entry.review_state || 'needs_review') : 'signed_off',
    fetchedAt: 0
  };
  if (entry) {
    try {
      ctx.pack = await opsFetch('get_ses_reviewable_pack', { docket_revision_id: entry.docket_revision_id });
      ctx.fetchedAt = Date.now();
      if (ctx.pack && ctx.pack.docket && ctx.pack.docket.output_content_hash) {
        ctx.outputHash = ctx.pack.docket.output_content_hash;
      }
      if (ctx.pack && ctx.pack.review && ctx.pack.review.review_state) {
        ctx.reviewState = ctx.pack.review.review_state;
      }
    } catch (e) {
      if (_msSesIsStale(e) && !retried) {
        await _msSesRefreshReviewQueue();
        return _msSesLoadPackContext(jobId, true);
      }
      throw e;
    }
  }
  return ctx;
}

// A 409 from the SES reads/actions means the displayed pack or tick no longer
// matches the current docket bytes (stale_review and friends) — re-fetch and
// re-render rather than acting on stale bytes.
function _msSesIsStale(e) {
  return !!(e && (e.status === 409 || (e.refusal && e.refusal.code === 'stale_review')));
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
    html += '<div style="font-size:14px;font-weight:800;color:var(--sw-dark);">No reviewable SES pack persisted yet</div>';
    html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:8px;line-height:1.55;">The legacy approve/send path is retired server-side (it answers 410). This panel reviews SES docket packs only: a pack appears here once the SES reporting routine assembles a docket for this job. Nothing on this screen can send, authorise, or charge.</div>';
  } else {
    html += '<div style="font-size:14px;font-weight:800;color:#991B1B;">The SES review cockpit could not be loaded</div>';
    html += '<div style="font-size:12px;color:#7F1D1D;margin-top:8px;line-height:1.55;">' + escapeHtml(msg || 'Unknown error') + '</div>';
    html += '<button onclick="showMsReportingDetail(\'' + _msJsAttr(jobId) + '\'' + (targetPanelId ? ',\'' + _msJsAttr(targetPanelId) + '\'' : '') + ')" style="margin-top:10px;background:#1F3A44;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Retry</button>';
  }
  html += '</div>';
  return html;
}

/**
 * Render the SES review pack. Top-to-bottom: job header (type chip + SES status
 * chip), HOLD/stale banners, doc tabs + PDF stage (byte-exact pack artifacts),
 * invoice review (SES proposal / Xero binding), source evidence, trade notes,
 * the three exact email routes, the fixed photo set (display-only), feedback,
 * then the cockpit-controls action block.
 */
function _msSesRenderDetail(jobId, ctx, targetPanelId) {
  var base = _msReportingCache[jobId] || { job_id: jobId };
  var row = _msSesSynthRow(jobId, ctx);
  // The doc-tab switcher + evidence renderers read the synthesized row from the
  // shared cache; the list re-seeds the cache on every load.
  _msReportingCache[jobId] = row;
  var safeId = _msJsAttr(jobId);
  var safeJobKey = _msDocTabKey(jobId);
  var builder = _msReportingCanonicalBuilderName(base);
  var isOverlay = !!(targetPanelId && targetPanelId !== 'msReportingDetailPanel');
  var dismissAction = isOverlay ? 'closeMakesafeReportingOverlay()' : 'showMsReportingDetailEmpty()';
  var cockpit = ctx.cockpit || {};
  var sections = cockpit.sections || {};
  var statusChip = _msSesStatusChip(cockpit.status);

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
  html += '<div style="flex-shrink:0;display:flex;align-items:flex-start;gap:12px;padding:16px 20px;background:#fff;border-bottom:1px solid var(--sw-border);">';
  html += '<button onclick="' + dismissAction + '" style="background:none;border:none;color:var(--sw-orange);font-size:13px;font-weight:700;cursor:pointer;padding:4px 0;white-space:nowrap;">&#8592; Back</button>';
  html += '<div style="flex:1;min-width:0;">';
  html += '<div style="font-size:17px;font-weight:700;color:var(--sw-dark);display:flex;align-items:center;flex-wrap:wrap;gap:8px;">';
  html += '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">' + escapeHtml(builder) + (base.external_ref ? ' &middot; ' + escapeHtml(base.external_ref) : '') + '</span>';
  html += '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;background:#FDEBE4;color:var(--sw-orange);">' + escapeHtml(typeLabel) + '</span>';
  html += '</div>';
  var headerBits = [];
  if (base.job_number) headerBits.push('Job ' + base.job_number);
  if (base.client_name) headerBits.push(base.client_name);
  if (base.site_address) headerBits.push(base.site_address);
  else if (base.site_suburb) headerBits.push(base.site_suburb);
  html += '<div style="font-size:13px;color:var(--sw-text-sec);margin-top:3px;">' + escapeHtml(headerBits.join('  ·  ')) + '</div>';
  html += '</div>';
  html += '<div style="flex-shrink:0;"><span style="display:inline-block;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;background:' + statusChip.bg + ';color:' + statusChip.fg + ';white-space:nowrap;">' + escapeHtml(statusChip.label) + '</span></div>';
  html += '</div>';

  // Scrollable body (single scroll column - everything visible without leaving the panel)
  html += '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 0 16px;background:#F7FAFB;">';

  // ── HOLD banner: the backend's blocker facts, verbatim ────────────────────
  if (cockpit.status === 'HOLD') {
    var reasons = (sections.status && Array.isArray(sections.status.reasons)) ? sections.status.reasons : [];
    html += '<div style="margin:16px 20px 0;padding:10px 14px;border-radius:8px;border:1px solid #FECACA;background:#FEF2F2;font-size:12px;color:#991B1B;">';
    html += '<strong>On hold.</strong> The backend has not cleared this pack for invoice or release:';
    if (reasons.length) {
      html += '<ul style="margin:6px 0 0;padding-left:18px;">';
      reasons.forEach(function(r) { html += '<li style="margin-top:3px;">' + escapeHtml(r) + '</li>'; });
      html += '</ul>';
    }
    if (_msIsPortalBuilder(base)) {
      html += '<div style="margin-top:6px;">This builder uses a secure portal. Portal capture evidence is recorded by the capture tooling &mdash; this screen cannot submit to the builder portal (portal capture pending backend wiring).</div>';
    }
    html += '</div>';
  } else if (_msIsPortalBuilder(base)) {
    html += '<div style="margin:16px 20px 0;padding:10px 14px;border-radius:8px;border:1px solid #BBE0DF;background:#EAF4F4;font-size:12px;color:#0E5F5E;">';
    html += '<strong>Portal builder.</strong> Portal capture evidence is recorded by the capture tooling &mdash; this screen cannot submit to the builder portal (portal capture pending backend wiring).';
    html += '</div>';
  }

  // ── Stale banner (defensive: we never pass a displayed binding) ───────────
  if (cockpit.stale) {
    html += '<div style="margin:16px 20px 0;padding:10px 14px;border-radius:8px;border:1px solid #FDE68A;background:#FFFBEB;font-size:12px;color:#92400E;">';
    html += '<strong>This view is stale.</strong> The underlying readiness rows moved after this cockpit was read &mdash; close and reopen the pack before acting.';
    html += '</div>';
  }

  // ── DOCUMENTS — CLICK THROUGH (doc tabs + fit-to-page PDF stage) ───────────
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Documents &mdash; click through</div>';
  if (docTabs.length) {
    html += '<div id="msDocTabs_' + safeJobKey + '" style="display:flex;gap:8px;padding:0 20px 10px;flex-wrap:wrap;">';
    docTabs.forEach(function(t, i) {
      var active = (i === activeTab);
      var bg = active ? 'var(--sw-orange)' : '#fff';
      var fg = active ? '#fff' : 'var(--sw-dark)';
      var bd = active ? 'var(--sw-orange)' : 'var(--sw-border)';
      html += '<button type="button" data-tabidx="' + i + '" data-doc-url="' + escapeAttr(t.url || '') + '" onclick="_msSwitchDocTab(\'' + safeId + '\',' + i + ',\'' + escapeAttr(targetPanelId || 'msReportingDetailPanel') + '\')" style="border:1px solid ' + bd + ';background:' + bg + ';color:' + fg + ';padding:7px 13px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">' + escapeHtml(t.tabLabel) + '</button>';
    });
    html += '</div>';
    // PDF stage (whole-page). Signed URLs live 300s; tab switches past that age
    // re-fetch the pack first (see _msSwitchDocTab).
    html += '<div id="msDocStage_' + safeJobKey + '" style="margin:0 auto;width:calc(100% - 40px);max-width:980px;">' + _msRenderDocStage(docTabs, activeTab) + '</div>';
  } else {
    html += '<div style="margin:0 20px 4px;font-size:12px;color:var(--sw-text-sec);background:#fff;border:1px dashed var(--sw-border);border-radius:8px;padding:12px;">'
      + (ctx.pack
        ? 'No drafted documents attached to this pack yet.'
        : 'This pack has already passed Docs Ready review; the byte-exact pack view is available while the pack is in the review queue. The routes and money facts below are the current cockpit truth.')
      + '</div>';
  }

  // ── INVOICE REVIEW (SES proposal lines + totals / Xero binding) ────────────
  html += _msRenderInvoiceReview(row);

  // ── SOURCE EVIDENCE (work order / trade docs; photos are shown below) ─────
  html += _msRenderSourceEvidence(row);

  // ── TRADE NOTES (raw from submission, carried by the live feed) ───────────
  if (base.trade_notes && String(base.trade_notes).trim()) {
    html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Trade notes (raw from submission)</div>';
    html += '<div style="margin:0 20px 4px;background:#F7FAFC;border:1px solid var(--sw-border);border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.5;color:var(--sw-dark);white-space:pre-wrap;word-break:break-word;">' + escapeHtml(base.trade_notes) + '</div>';
  }

  // ── ROUTES — the exact emails SEND IT releases ─────────────────────────────
  html += _msSesRenderRoutes(ctx);

  // ── PHOTOS — the fixed photo-route set (display-only) ──────────────────────
  html += _msSesRenderPhotos(ctx);

  // ── REVIEW FEEDBACK ────────────────────────────────────────────────────────
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Feedback</div>';
  html += '<div id="msNotesPanel-' + safeId + '" style="padding:0 20px;"></div>';

  // ── ACTION BLOCK (cockpit controls) ────────────────────────────────────────
  html += '<div style="margin-top:16px;padding:16px 20px;border-top:1px solid var(--sw-border);background:#fff;display:flex;flex-direction:column;gap:8px;">';
  html += _msSesActionBlock(jobId, ctx, dismissAction);
  html += '</div>';

  html += '</div>'; // end scroll body

  return html;
}

/**
 * Merge the live feed row (identity facts) with the SES-derived review content
 * into the row shape the shared renderers (doc tabs, invoice review, source
 * evidence) consume. Legacy send fields are stripped so no legacy gate can
 * pick them up.
 */
function _msSesSynthRow(jobId, ctx) {
  var base = _msReportingCache[jobId] || { job_id: jobId };
  var row = {};
  Object.keys(base).forEach(function(k) { row[k] = base[k]; });
  var docs = _msSesDocsFromArtifacts(ctx.pack && ctx.pack.artifacts);
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

/**
 * Map the reviewable pack's artifacts to viewer docs. Only real document bytes
 * become tabs/evidence: the rendered report PDF, the bound Xero invoice PDF,
 * the SWMS, source attachments (work order), and the photo set. JSON/text plan
 * artifacts (invoice_proposal, photo_selection, *_email_draft, review_spec,
 * envelope, ...) are not viewer docs — the routes + invoice sections render
 * their content.
 */
function _msSesDocsFromArtifacts(artifacts) {
  var draft = [];
  var source = [];
  var photos = [];
  (artifacts || []).forEach(function(a) {
    if (!a || !a.signed_url) return;
    var fileName = String(a.object_key || '').split('/').pop() || 'Document';
    var label = fileName.replace(/\.[a-z0-9]+$/i, '');
    var meta = a.metadata || {};
    if (a.role === 'supporting_report_pdf') {
      draft.push({ label: 'Make safe report', url: a.signed_url, kind: 'pdf' });
    } else if (a.role === 'xero_invoice_pdf') {
      draft.push({ label: 'Xero invoice', url: a.signed_url, kind: 'pdf' });
    } else if (a.role === 'swms_artifact') {
      draft.push({ label: 'SWMS', url: a.signed_url, kind: 'pdf' });
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
    }
  });
  photos.sort(function(x, y) {
    return (x.order == null ? 9999 : x.order) - (y.order == null ? 9999 : y.order);
  });
  return { draft: draft, source: source, photos: photos };
}

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
  var xero = (ctx.pack && ctx.pack.docket && ctx.pack.docket.xero_binding) || money.xero || null;
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
  return {
    invoice_number: (xero && xero.invoice_number) || null,
    status: xero ? (xero.status || 'BOUND') : 'SES proposal (not yet in Xero)',
    lines: lines,
    total_ex_gst: proposal ? proposal.subtotal_ex_gst : null,
    total_inc_gst: proposal ? proposal.total_inc_gst : null,
    lines_unavailable: !lines.length
  };
}

// ── ROUTES + PHOTOS (the exact release content) ─────────────────────────────

var _MS_SES_ROUTE_ORDER = { report: 0, photo: 1, invoice: 2 };
var _MS_SES_ROUTE_LABELS = { report: 'Report email', photo: 'Photo email', invoice: 'Invoice email' };

/**
 * Render the three exact email routes the release carries (report + photo +
 * invoice), straight from the cockpit's resolved routes: recipients, cc,
 * subject, body excerpt, attachment count, and the backend's ready flag.
 */
function _msSesRenderRoutes(ctx) {
  var sections = (ctx.cockpit && ctx.cockpit.sections) || {};
  var routes = Array.isArray(sections.email_drafts) ? sections.email_drafts.slice() : [];
  if (!routes.length) return '';
  routes.sort(function(a, b) {
    var oa = (a && _MS_SES_ROUTE_ORDER[a.route_kind] != null) ? _MS_SES_ROUTE_ORDER[a.route_kind] : 9;
    var ob = (b && _MS_SES_ROUTE_ORDER[b.route_kind] != null) ? _MS_SES_ROUTE_ORDER[b.route_kind] : 9;
    return oa - ob;
  });
  var html = '';
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Routes &mdash; the exact emails SEND IT releases</div>';
  html += '<div style="margin:0 20px 4px;font-size:12px;color:var(--sw-text-sec);">SEND IT sends <strong>all three routes at once</strong> (report + photos + invoice) to the exact recipients below.</div>';
  routes.forEach(function(r) {
    r = r || {};
    var label = _MS_SES_ROUTE_LABELS[r.route_kind] || String(r.route_kind || 'Route');
    var ready = r.ready === true;
    var recipients = Array.isArray(r.recipients) ? r.recipients.filter(Boolean) : [];
    var cc = Array.isArray(r.cc) ? r.cc.filter(Boolean) : [];
    var attachments = Array.isArray(r.attachment_hashes) ? r.attachment_hashes.length : 0;
    var bodyExcerpt = String(r.body || '').replace(/\s+/g, ' ').trim();
    if (bodyExcerpt.length > 280) bodyExcerpt = bodyExcerpt.slice(0, 280) + '&#8230;';
    html += '<div style="margin:8px 20px 4px;background:#fff;border:1px solid ' + (ready ? '#CFE6D6' : '#FECACA') + ';border-radius:8px;padding:12px 14px;font-size:13px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
    html += '<b style="font-size:11px;color:var(--sw-mid);letter-spacing:0.4px;text-transform:uppercase;">' + escapeHtml(label) + '</b>';
    html += '<span style="font-size:9px;font-weight:800;letter-spacing:0.04em;padding:2px 7px;border-radius:10px;background:' + (ready ? '#27AE60' : '#B91C1C') + ';color:#fff;">' + (ready ? 'READY' : 'NOT READY') + '</span>';
    html += '</div>';
    html += '<div style="margin-top:6px;"><strong>To:</strong> ' + (recipients.length ? escapeHtml(recipients.join(', ')) : '<span style="color:#B91C1C;font-weight:700;">no recipient</span>') + '</div>';
    if (cc.length) html += '<div style="margin-top:2px;"><strong>Cc:</strong> ' + escapeHtml(cc.join(', ')) + '</div>';
    html += '<div style="margin-top:2px;"><strong>Subject:</strong> ' + escapeHtml(r.subject || '') + '</div>';
    if (bodyExcerpt) {
      html += '<div style="margin-top:4px;color:var(--sw-text-sec);font-size:12px;line-height:1.45;">' + escapeHtml(bodyExcerpt) + '</div>';
    }
    html += '<div style="margin-top:4px;color:var(--sw-text-sec);font-size:11px;">' + attachments + ' attachment' + (attachments === 1 ? '' : 's') + ' fixed in the release revision</div>';
    html += '</div>';
  });
  return html;
}

/**
 * The photo set is FIXED by the SES release revision (the photo route's
 * attachment hashes), so this section is a display-only affirmation: the photos
 * in the photo email (green) plus any other docket photos kept as evidence
 * (grey). No include/exclude toggles — changes go through feedback + a revised
 * pack, never through a send-time payload.
 */
function _msSesRenderPhotos(ctx) {
  if (!ctx.pack) return '';
  var sections = (ctx.cockpit && ctx.cockpit.sections) || {};
  var routes = Array.isArray(sections.email_drafts) ? sections.email_drafts : [];
  var photoRoute = null;
  routes.forEach(function(r) { if (r && r.route_kind === 'photo') photoRoute = r; });
  var routeHashes = {};
  ((photoRoute && photoRoute.attachment_hashes) || []).forEach(function(h) { routeHashes[h] = true; });
  var docs = _msSesDocsFromArtifacts(ctx.pack.artifacts);
  var photos = docs.photos;
  if (!photos.length) return '';
  var inRoute = photos.filter(function(p) { return p.content_hash && routeHashes[p.content_hash]; });
  var evidence = photos.filter(function(p) { return !(p.content_hash && routeHashes[p.content_hash]); });
  var html = '';
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Photos &mdash; fixed in the release revision</div>';
  html += '<div style="margin:0 20px 4px;font-size:12px;color:var(--sw-text-sec);">';
  html += inRoute.length + ' photo' + (inRoute.length === 1 ? '' : 's') + ' in the photo email';
  if (evidence.length) html += ' &middot; ' + evidence.length + ' kept as evidence only (not sent)';
  html += '. The photo set is fixed by the SES release revision and cannot be changed from this screen &mdash; record feedback to request a revised pack.';
  html += '</div>';
  html += '<div style="padding:0 20px;display:flex;flex-wrap:wrap;gap:10px;">';
  inRoute.concat(evidence).forEach(function(p) {
    var sent = !!(p.content_hash && routeHashes[p.content_hash]);
    html += '<div style="position:relative;width:120px;height:88px;border-radius:8px;overflow:hidden;outline:3px solid ' + (sent ? '#5E8B6E' : '#9CA3AF') + ';opacity:' + (sent ? '1' : '0.55') + ';flex-shrink:0;background:#5b6b73;" title="' + escapeAttr(sent ? 'In the photo email' : 'Evidence only — not sent') + '">';
    html += '<img src="' + escapeAttr(p.url) + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
    html += '<div style="position:absolute;top:5px;right:5px;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;background:' + (sent ? '#5E8B6E' : '#6B7280') + ';padding:0 4px;">' + (sent ? '&#10003;' : 'evidence') + '</div>';
    html += '</div>';
  });
  html += '</div>';
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
 * Build the doc-tab list for a pack: drafted outputs first (Make Safe Report /
 * Xero Invoice / Draft Invoice / SWMS), then source inputs (Trade Report /
 * Work Order). Photos remain in the photo section (fixed set, display-only).
 * Each entry: { tabLabel, url, kind } where url already carries #view=Fit for
 * PDFs (via _msReportingBuildCarouselDocs).
 */
function _msReportingDocTabs(d) {
  var docs = _msReportingBuildCarouselDocs(d);
  var out = [];
  docs.forEach(function(doc) {
    var label = String(doc.label || '').toLowerCase();
    var tabLabel = null;
    if (doc.kind === 'image') return; // photos stay in the photo section
    if (/xero/.test(label) && /invoice/.test(label)) tabLabel = 'Xero Invoice';
    else if (/raw/.test(label) && /trade|service|report/.test(label)) tabLabel = 'Raw Trade Report';
    else if (/trade|service/.test(label) && /pdf/.test(label)) tabLabel = 'Trade Report PDF';
    else if (/trade|service|raw/.test(label)) tabLabel = 'Trade Report';
    else if (/work\S*\s*order|^wo$/.test(label)) tabLabel = 'Work Order';
    else if (/make\s*safe|completion/.test(label) && /report/.test(label)) tabLabel = 'Make Safe Report';
    else if (/invoice/.test(label)) tabLabel = 'Draft Invoice';
    else if (/swms/.test(label)) tabLabel = 'SWMS';
    else if (/report/.test(label)) tabLabel = 'Trade Report';
    else tabLabel = doc.label || 'Document';
    // De-dupe by tab label (one report, one invoice, one SWMS).
    if (out.some(function(o) { return o.tabLabel === tabLabel; })) return;
    out.push({
      tabLabel: tabLabel,
      url: doc.url,
      kind: doc.kind,
      created_at: doc.created_at || null,
      received_at: doc.received_at || null,
      source_type: doc.source_type || null,
      raw_report: doc.raw_report || null,
    });
  });
  // Order: generated pack first, source evidence after it.
  // Note: use a has-own check, not `|| 9` — 'Make Safe Report' maps to 0 (falsy).
  var order = { 'Make Safe Report': 0, 'Xero Invoice': 1, 'Draft Invoice': 1, 'SWMS': 2, 'Raw Trade Report': 3, 'Trade Report': 4, 'Trade Report PDF': 5, 'Work Order': 6 };
  out.sort(function(a, b) {
    var oa = (order[a.tabLabel] != null) ? order[a.tabLabel] : 9;
    var ob = (order[b.tabLabel] != null) ? order[b.tabLabel] : 9;
    return oa - ob;
  });
  return out;
}

/**
 * Render the whole-page PDF stage for the doc at index idx. Dark stage with the
 * PDF page centered + a "whole page" badge in the corner (matches the design ref
 * .pdfstage / .pdffit). For PDFs we embed an iframe with the Fit-fragment URL; for
 * an image we render it contained; for anything else, an open-in-new-tab fallback.
 */
function _msRenderDocStage(docTabs, idx) {
  var t = docTabs[idx];
  var metaBits = [];
  if (t && t.received_at) metaBits.push('Received ' + _msReportingFormatTimestamp(t.received_at));
  if (t && t.created_at && t.created_at !== t.received_at) metaBits.push('Created ' + _msReportingFormatTimestamp(t.created_at));
  var metaHtml = metaBits.length
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 8px;color:var(--sw-text-sec);font-size:11px;">'
      + '<span style="font-weight:800;color:var(--sw-mid);text-transform:uppercase;letter-spacing:0.4px;">' + escapeHtml(t.tabLabel || 'Document') + '</span>'
      + metaBits.map(function(m) { return '<span style="background:#fff;border:1px solid var(--sw-border);border-radius:999px;padding:3px 8px;">' + escapeHtml(m) + '</span>'; }).join('')
      + '</div>'
    : '';
  var inner;
  if (!t || !t.url) {
    if (t && (t.kind === 'html' || t.raw_report)) {
      inner = _msRenderRawTradeReportDoc(t);
    } else {
      inner = '<div style="color:#cdd8df;font-size:13px;">Document not available.</div>';
    }
  } else if (t.kind === 'image') {
    inner = '<img src="' + escapeAttr(t.url) + '" alt="' + escapeAttr(t.tabLabel) + '" style="max-width:94%;max-height:94%;border-radius:3px;box-shadow:0 4px 18px rgba(0,0,0,.3);">';
  } else if (t.kind === 'pdf') {
    inner = '<iframe title="' + escapeAttr(t.tabLabel) + '" src="' + escapeAttr(t.url) + '" style="width:min(92%,720px);height:96%;border:none;border-radius:3px;box-shadow:0 4px 18px rgba(0,0,0,.3);background:#fff;"></iframe>';
  } else {
    inner = '<a href="' + escapeAttr(t.url) + '" target="_blank" rel="noopener" style="color:#fff;background:rgba(255,255,255,0.12);padding:10px 16px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">Open ' + escapeHtml(t.tabLabel) + ' &#8599;</a>';
  }
  return metaHtml + '<div style="background:#3a464d;border-radius:8px;height:clamp(680px,78vh,900px);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">'
    + '<div style="position:absolute;top:8px;right:14px;font-size:11px;color:#cdd8df;background:rgba(0,0,0,.3);padding:2px 8px;border-radius:5px;">whole page</div>'
    + inner
    + '</div>';
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

/**
 * Switch the active doc tab: update tab button styling + re-render just the PDF
 * stage. Signed pack URLs live 300s — a tab switch past that age re-fetches the
 * pack (full detail reload, preserving the clicked tab) instead of rendering a
 * dead iframe. Re-resolves the buttons + stage from the live panel so it works
 * in BOTH hosts.
 */
function _msSwitchDocTab(jobId, idx, panelId) {
  var ctx = _msSesPackCache[jobId];
  if (ctx && ctx.pack && ctx.fetchedAt && (Date.now() - ctx.fetchedAt) > 240000) {
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
      var active = (Number(btns[i].getAttribute('data-tabidx')) === idx);
      btns[i].style.background = active ? 'var(--sw-orange)' : '#fff';
      btns[i].style.color = active ? '#fff' : 'var(--sw-dark)';
      btns[i].style.borderColor = active ? 'var(--sw-orange)' : 'var(--sw-border)';
    }
  }
  var stage = (root.querySelector && root.querySelector('#msDocStage_' + key)) || document.getElementById('msDocStage_' + key);
  if (stage) stage.innerHTML = _msRenderDocStage(docTabs, idx);
}

// ── CAROUSEL + MONEY-REVIEW HELPERS ─────────────────────────────────────────

/**
 * Map the row's draft_docs[] + source_docs[] into the shared doc-viewer entry
 * shape ({label, url, kind, doc}). Draft outputs lead (report/invoice/SWMS),
 * then source docs (work order, photos).
 */
function _msReportingBuildCarouselDocs(d) {
  var out = [];
  var seen = {};
  function add(label, url, kind, meta) {
    meta = meta || {};
    if (!url && !meta.raw_report && kind !== 'html') return;
    var dedupeKey = url || [label || 'Document', meta.source_type || kind || '', meta.received_at || meta.created_at || ''].join('|');
    if (seen[dedupeKey]) return;
    seen[dedupeKey] = true;
    var k = kind || _msReportingDocKind(url);
    // For PDFs, append #view=Fit so the iframe opens to the whole page, not fit-width.
    var displayUrl = url;
    if (k === 'pdf' && url.indexOf('#') === -1) {
      displayUrl = url + '#view=Fit';
    }
    out.push({
      label: label || 'Document',
      url: displayUrl,
      kind: k,
      doc: null,
      created_at: meta.created_at || null,
      received_at: meta.received_at || meta.created_at || null,
      source_type: meta.source_type || null,
      raw_report: meta.raw_report || null,
    });
  }
  // Drafted outputs first.
  if (Array.isArray(d.draft_docs)) {
    d.draft_docs.forEach(function(dd) { if (dd) add(dd.label, dd.url, _msReportingNormaliseKind(dd.kind), dd); });
  }
  // Source docs next (work order, photos, etc.).
  if (Array.isArray(d.source_docs)) {
    d.source_docs.forEach(function(sd) { if (sd) add(sd.label, sd.url, _msReportingNormaliseKind(sd.kind), sd); });
  }
  return out;
}

function _msNeedsMoneyReview(d) {
  return !!(d && (d.needs_money_review === true ||
    (d.money_review && d.money_review.needs_money_review === true)));
}

// Normalise a feed kind ('pdf'|'image'|'html') to the viewer's kind vocabulary.
// Unknown kinds get classified by URL.
function _msReportingNormaliseKind(kind) {
  if (kind === 'pdf' || kind === 'image' || kind === 'html') return kind;
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

// Render the invoice facts inside the review panel so the operator can check
// the money before any approve click. Deliberately read-only: pricing changes
// go through feedback + a revised pack, never through a send-time edit.
function _msRenderInvoiceReview(d) {
  var inv = d && d.invoice;
  if (!inv) return '';
  var lines = Array.isArray(inv.lines) ? inv.lines : [];
  var flags = _msReportingFlaggedLineMap(d);
  var html = '';
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Invoice review</div>';
  html += '<div style="margin:0 20px 4px;background:#fff;border:1px solid var(--sw-border);border-radius:8px;overflow:hidden;font-size:12px;color:var(--sw-dark);">';
  if (inv.invoice_number || inv.status) {
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--sw-border);background:#F7FAFB;color:var(--sw-text-sec);">';
    if (inv.invoice_number) html += '<span><strong>Invoice:</strong> ' + escapeHtml(inv.invoice_number) + '</span>';
    if (inv.status) html += '<span><strong>Status:</strong> ' + escapeHtml(inv.status) + '</span>';
    html += '</div>';
  }
  if (lines.length) {
    html += '<div style="display:flex;flex-direction:column;">';
    lines.forEach(function(li, idx) {
      li = li || {};
      var flag = _msReportingLineFlag(flags, idx, li);
      var bg = flag ? '#FFFBEB' : '#fff';
      var bd = flag ? '#FCD34D' : 'var(--sw-border)';
      var desc = li.description || li.name || ('Line ' + (idx + 1));
      var qty = li.quantity != null ? Number(li.quantity) : null;
      var unit = li.unit_price != null ? Number(li.unit_price) : (li.unit_amount != null ? Number(li.unit_amount) : null);
      var total = li.line_total != null ? Number(li.line_total) : (li.amount != null ? Number(li.amount) : null);
      html += '<div style="padding:10px 12px;border-bottom:1px solid ' + bd + ';background:' + bg + ';">';
      html += '<div style="font-weight:700;">' + escapeHtml(desc) + '</div>';
      var bits = [];
      if (qty != null && isFinite(qty)) bits.push('Qty ' + qty);
      if (unit != null && isFinite(unit)) bits.push('Unit ' + _msFmtAud(unit));
      if (total != null && isFinite(total)) bits.push('Line ' + _msFmtAud(total));
      if (bits.length) html += '<div style="margin-top:3px;color:var(--sw-text-sec);">' + escapeHtml(bits.join(' · ')) + '</div>';
      if (flag) {
        var note = flag.note || flag.reason || flag.description || 'Check this line before sending.';
        html += '<div style="margin-top:5px;color:#92400E;font-weight:700;">Pricing note: ' + escapeHtml(note) + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  } else if (inv.lines_unavailable) {
    html += '<div style="padding:10px 12px;color:var(--sw-text-sec);">Invoice line detail is unavailable for this draft.</div>';
  }
  html += '<div style="display:flex;justify-content:flex-end;gap:18px;padding:10px 12px;background:#F7FAFB;font-weight:800;">';
  if (inv.total_ex_gst != null) html += '<span>ex GST ' + escapeHtml(_msFmtAud(inv.total_ex_gst)) + '</span>';
  if (inv.total_inc_gst != null) html += '<span>inc GST ' + escapeHtml(_msFmtAud(inv.total_inc_gst)) + '</span>';
  html += '</div>';
  html += '</div>';
  return html;
}

// Render non-photo source evidence links in the review panel. The photo set is
// shown in its own fixed-set section; work orders and trade/source PDFs stay
// visible for draft-vs-source checking.
function _msRenderSourceEvidence(d) {
  if (!d || !Array.isArray(d.source_docs)) return '';
  var docs = d.source_docs.filter(function(sd) {
    if (!sd || (!sd.url && !sd.raw_report && sd.kind !== 'html')) return false;
    var kind = sd.kind || _msReportingDocKind(sd.url || '');
    return kind !== 'image';
  });
  if (!docs.length) return '';
  var html = '';
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--sw-mid);text-transform:uppercase;padding:16px 20px 6px;">Source evidence</div>';
  html += '<div style="margin:0 20px 4px;background:#fff;border:1px solid var(--sw-border);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;font-size:12px;">';
  docs.forEach(function(sd) {
    var label = sd.label || 'Source document';
    var metaBits = [];
    if (sd.received_at) metaBits.push('Received ' + _msReportingFormatTimestamp(sd.received_at));
    if (sd.created_at && sd.created_at !== sd.received_at) metaBits.push('Created ' + _msReportingFormatTimestamp(sd.created_at));
    html += '<div style="display:flex;flex-direction:column;gap:2px;">';
    if (sd.url) {
      html += '<a href="' + escapeAttr(sd.url) + '" target="_blank" rel="noopener" data-source-url="' + escapeAttr(sd.url) + '" style="color:var(--sw-orange);font-weight:700;text-decoration:none;word-break:break-all;">' + escapeHtml(label) + ' ↗</a>';
    } else {
      html += '<div style="color:var(--sw-dark);font-weight:800;">' + escapeHtml(label) + '</div>';
    }
    if (metaBits.length) html += '<div style="color:var(--sw-text-sec);font-size:11px;">' + escapeHtml(metaBits.join(' · ')) + '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// Build a lookup of flagged invoice lines keyed by line_index. Defensive:
// absent money_review / flagged_lines returns an empty map (no highlights).
function _msReportingFlaggedLineMap(d) {
  var map = {};
  if (!_msNeedsMoneyReview(d) || !d.money_review) return map;
  var lines = d.money_review.flagged_lines;
  if (!Array.isArray(lines)) return map;
  lines.forEach(function(fl) {
    if (!fl) return;
    if (fl.line_index != null) map['i:' + fl.line_index] = fl;
    if (fl.description) map['d:' + String(fl.description).trim().toLowerCase()] = fl;
  });
  return map;
}

// Resolve a flagged line for one invoice row: match by line_index first, then by
// description (fallback). Returns the flag object or null.
function _msReportingLineFlag(map, idx, li) {
  if (!map) return null;
  if (map['i:' + idx]) return map['i:' + idx];
  if (li && li.description) {
    var key = 'd:' + String(li.description).trim().toLowerCase();
    if (map[key]) return map[key];
  }
  return null;
}

// ── STATE-AWARE ACTION BLOCK (SES cockpit controls) ─────────────────────────

/**
 * Build the primary-action block for the panel, keyed off the SES cockpit
 * status + controls:
 *   HOLD                          -> blocker facts, no money/send action
 *   controls.approve_invoice.on   -> "APPROVE INVOICE" -> approveSesInvoice
 *   controls.send_it.enabled      -> "SEND IT"         -> sendSesRelease
 *   neither                       -> honest waiting note (never a legacy action)
 */
function _msSesActionBlock(jobId, ctx, dismissAction) {
  var base = _msReportingCache[jobId] || {};
  var cockpit = ctx.cockpit || {};
  var sections = cockpit.sections || {};
  var controls = cockpit.controls || {};
  var approveInvoice = controls.approve_invoice || {};
  var sendIt = controls.send_it || {};
  var safeId = _msJsAttr(jobId);
  var html = '';

  // HOLD: the backend's blocker facts win — no approve/send action exists.
  if (cockpit.status === 'HOLD') {
    html += '<div style="padding:12px 14px;border-radius:8px;border:1px solid #FECACA;background:#FEF2F2;">';
    html += '<div style="font-size:13px;font-weight:800;color:#991B1B;">On hold &mdash; no approve/send action is available</div>';
    html += '<div style="font-size:12px;color:#991B1B;margin-top:4px;">Resolve the blocker facts listed above; the controls appear here when the backend clears the pack.</div>';
    html += '</div>';
    html += '<button onclick="' + dismissAction + '" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
    return html;
  }

  // The Docs Ready tick state, bound to the exact displayed pack hash.
  if (ctx.reviewState === 'needs_review' && ctx.docketRevisionId && ctx.outputHash) {
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">Docs Ready tick: <strong>not yet recorded</strong>. SEND IT first records your tick bound to the exact displayed pack hash <code style="font-size:10px;">' + escapeHtml(String(ctx.outputHash).slice(0, 27)) + '&#8230;</code></div>';
  } else {
    html += '<div style="font-size:11px;color:var(--sw-text-sec);">Docs Ready tick: <strong>already recorded</strong> for the exact current pack.</div>';
  }

  if (approveInvoice.enabled) {
    html += '<button id="msSesApproveInvoiceBtn" onclick="approveSesInvoice(\'' + safeId + '\')" style="width:100%;background:#B45309;color:#fff;border:none;padding:14px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">APPROVE INVOICE</button>';
    html += '<div style="font-size:12px;color:var(--sw-text-sec);text-align:center;">' + escapeHtml(approveInvoice.plan || 'Creates and authorises the real Xero invoice for this exact invoice revision.') + '</div>';
  }
  if (sendIt.enabled) {
    html += '<button id="msSesSendItBtn" onclick="sendSesRelease(\'' + safeId + '\')" style="width:100%;background:#27AE60;color:#fff;border:none;padding:14px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">SEND IT</button>';
    html += '<div style="font-size:12px;color:var(--sw-text-sec);text-align:center;">' + escapeHtml(sendIt.plan || 'Sends the approved routes for this exact release revision.') + ' Sends <strong>all three routes at once</strong> (report + photos + invoice). This is irreversible.</div>';
  }
  if (!approveInvoice.enabled && !sendIt.enabled) {
    html += '<div style="padding:12px 14px;border-radius:8px;border:1px solid var(--sw-border);background:#F7FAFB;">';
    html += '<div style="font-size:13px;font-weight:800;color:var(--sw-dark);">No action enabled yet</div>';
    html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:4px;">The backend has not enabled APPROVE INVOICE or SEND IT for this pack'
      + (controls.captain_only ? ' (Captain authority is required for this pack)' : '')
      + '. Review the documents and routes, record any feedback, and check back when the reporting routine advances the pack.</div>';
    html += '</div>';
  }
  html += '<button onclick="' + dismissAction + '" style="background:#E5EEF3;color:#1F3A44;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
  return html;
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
// 3. ACTIONS - APPROVE INVOICE + SEND IT (SES chains)
// ────────────────────────────────────────────────────────────

/**
 * APPROVE INVOICE: record the identified operator's approval of the exact
 * current invoice revision (JWT; includes authorise), then execute it — the
 * backend creates + AUTHORISES the real Xero invoice and binds the Xero PDF
 * into a fresh docket revision, which re-enters the Docs Ready queue for a new
 * tick before SEND IT.
 */
async function approveSesInvoice(jobId) {
  var ctx = _msSesPackCache[jobId];
  if (!ctx) { showToast('Pack not loaded; reopen the review panel.', 'error'); return; }
  if (!confirm('This records your SES approval and creates + AUTHORISES the real Xero invoice for this exact invoice revision, then binds the Xero PDF into a fresh pack for final review. Continue?')) return;

  var btn = document.getElementById('msSesApproveInvoiceBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Recording approval...'; }

  try {
    var approval = await opsPostJwt('approve_ses_invoice_revision', {
      job_id: jobId,
      includes_authorise: true
    });
    var obligationRevisionId = approval && approval.approval && approval.approval.invoice_obligation_revision_id;
    if (!obligationRevisionId) {
      var ob = await opsFetch('query_ses_invoice_obligation', { job_id: jobId });
      var revisions = (ob && ob.revisions) || [];
      obligationRevisionId = revisions.length ? revisions[0].id : null;
    }
    if (!obligationRevisionId) {
      throw new Error('The approved invoice obligation revision could not be resolved.');
    }
    if (btn) btn.textContent = 'Authorising in Xero...';
    var execBody = { job_id: jobId, invoice_obligation_revision_id: obligationRevisionId };
    var actor = _msSesActor();
    if (actor) execBody.actor = actor;
    var executed = await opsPost('execute_ses_invoice_revision', execBody);
    var invoiceNumber = executed && executed.invoice && executed.invoice.invoice_number;
    showToast('Invoice authorised in Xero' + (invoiceNumber ? ' (' + invoiceNumber + ')' : '') + '. The invoice-bound pack needs a fresh Docs Ready tick before SEND IT.', 'success');
    _msSesReloadDetail(jobId);
  } catch (e) {
    if (_msSesIsStale(e)) {
      showToast('The pack changed while you reviewed it. Reloading the fresh pack.', 'info');
      _msSesReloadDetail(jobId);
      return;
    }
    showToast('Approve invoice failed: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'APPROVE INVOICE'; }
  }
}

/**
 * SEND IT: the full release chain for THIS job only (never a multi-job
 * release):
 *   1. sign_off_ses_docket (JWT, hash-bound to the exact displayed pack) —
 *      skipped only when the tick is already recorded for the current bytes;
 *   2. prepare_ses_release_revision { job_ids: [jobId] };
 *   3. approve_ses_release_revision (JWT);
 *   4. execute_ses_release_revision — sends ALL THREE routes (report + photo +
 *      invoice emails), writes route proofs, and verifies the closeout.
 * A 409 stale_review anywhere aborts the chain and reloads the fresh pack.
 */
async function sendSesRelease(jobId) {
  var ctx = _msSesPackCache[jobId];
  if (!ctx) { showToast('Pack not loaded; reopen the review panel.', 'error'); return; }
  var needsSignoff = ctx.reviewState === 'needs_review' && !!ctx.docketRevisionId && !!ctx.outputHash;
  var confirmMsg = 'SEND IT releases ALL THREE routes at once (report + photos + invoice emails) to the exact recipients shown'
    + (needsSignoff
      ? ', after recording your Docs Ready tick bound to the exact displayed pack hash'
      : ' (the Docs Ready tick is already recorded for the current pack)')
    + '. This is irreversible. Send now?';
  if (!confirm(confirmMsg)) return;

  var btn = document.getElementById('msSesSendItBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Working...'; }

  try {
    if (needsSignoff) {
      if (btn) btn.textContent = 'Recording Docs Ready tick...';
      await opsPostJwt('sign_off_ses_docket', {
        docket_revision_id: ctx.docketRevisionId,
        expected_output_content_hash: ctx.outputHash
      });
    }
    if (btn) btn.textContent = 'Preparing release...';
    var prepBody = { job_ids: [jobId] };
    var actor = _msSesActor();
    if (actor) prepBody.created_by = actor;
    var prepared = await opsPost('prepare_ses_release_revision', prepBody);
    var releaseRevisionId = prepared && prepared.release && prepared.release.id;
    if (!releaseRevisionId) {
      throw new Error('The release revision id was not returned by prepare_ses_release_revision.');
    }
    if (btn) btn.textContent = 'Approving release...';
    await opsPostJwt('approve_ses_release_revision', { release_revision_id: releaseRevisionId });
    if (btn) btn.textContent = 'Sending all three routes...';
    var execBody = { release_revision_id: releaseRevisionId };
    if (actor) execBody.actor = actor;
    var executed = await opsPost('execute_ses_release_revision', execBody);
    var proofCount = executed && Array.isArray(executed.route_proofs) ? executed.route_proofs.length : 3;
    showToast('Pack released — ' + proofCount + ' routes sent (report, photos, invoice) and the closeout is verified.', 'success');
    _msReportingAfterSend();
  } catch (e) {
    if (_msSesIsStale(e)) {
      showToast('The pack changed while you reviewed it. Reloading the fresh pack — nothing was sent.', 'info');
      _msSesReloadDetail(jobId);
      return;
    }
    showToast('SEND IT failed: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'SEND IT'; }
  }
}

/**
 * Reload the list and reopen this job's detail against the fresh SES state
 * (used after a successful APPROVE INVOICE and after any stale_review).
 */
function _msSesReloadDetail(jobId) {
  var panelId = (_msSesPackCache[jobId] && _msSesPackCache[jobId].panelId) || 'msReportingDetailPanel';
  loadMakesafeReportingCockpit().then(function() {
    if (_msReportingCache[jobId]) {
      showMsReportingDetail(jobId, panelId);
    } else if (panelId === 'msReportingDetailPanel') {
      showMsReportingDetailEmpty();
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
//    and renders the doc tabs, invoice lines, the three exact routes, and the
//    fixed photo set
// 5. APPROVE INVOICE (when enabled) runs approve_ses_invoice_revision (JWT) ->
//    execute_ses_invoice_revision; SEND IT (when enabled) runs
//    sign_off_ses_docket (JWT, hash-bound) -> prepare_ses_release_revision ->
//    approve_ses_release_revision (JWT) -> execute_ses_release_revision
// 6. A job with no SES docket shows the honest "no reviewable pack" state and
//    never calls the retired 410 actions
//
// Automated smoke: modules/ops-makesafe-reporting-cockpit.smoke.mjs

// Export for the node smoke test (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadMakesafeReportingCockpit: typeof loadMakesafeReportingCockpit !== 'undefined' ? loadMakesafeReportingCockpit : undefined,
    renderMsReportingCard: typeof renderMsReportingCard !== 'undefined' ? renderMsReportingCard : undefined,
    _msSesQueueCardRow: typeof _msSesQueueCardRow !== 'undefined' ? _msSesQueueCardRow : undefined,
    _msSesReviewQueueStale: typeof _msSesReviewQueueStale !== 'undefined' ? _msSesReviewQueueStale : undefined
  };
}
