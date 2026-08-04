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
//     SEND IT releases every route the release carries (today still report +
//     photo + invoice — three emails) at once. For AJS the UI may PREVIEW the
//     intended two-email shape (report+invoice, then photos) when the backend
//     still builds three; that preview is labelled and never presented as the
//     send truth.
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
 * BOTTOM (APPROVE INVOICE then SEND IT), armed only by backend control flags.
 * A disabled stamp stays visible with its reason. No combined Approve-and-Send.
 */
function _msSesRenderDetail(jobId, ctx, targetPanelId) {
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
  html += '</div>';
  html += '<div class="msr-state"><span class="msr-chip" style="background:' + statusChip.bg + ';color:' + statusChip.fg + ';">' + escapeHtml(statusChip.label) + '</span></div>';
  html += '</div>';

  // Scrollable body — proof only. Stamps live in the sticky foot below.
  html += '<div class="msr-body">';

  // ── ONE clear next action ─────────────────────────────────────────────────
  html += _msSesNextAction(cockpit);

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
  html += '<div class="msr-sec"><h3>Documents</h3><span class="msr-sec-note">click a tab</span></div>';
  if (docTabs.length) {
    html += '<div id="msDocTabs_' + safeJobKey + '" class="msr-tabs" role="tablist" aria-label="Pack documents">';
    docTabs.forEach(function(t, i) {
      var active = (i === activeTab);
      html += '<button type="button" role="tab" class="msr-tab" aria-selected="' + (active ? 'true' : 'false') + '" data-tabidx="' + i + '" data-doc-url="' + escapeAttr(t.url || '') + '" onclick="_msSwitchDocTab(\'' + safeId + '\',' + i + ',\'' + escapeAttr(targetPanelId || 'msReportingDetailPanel') + '\')">' + escapeHtml(t.tabLabel) + '</button>';
    });
    html += '</div>';
    // Stage (fit-to-page). Signed URLs live 300s; tab switches past that age
    // re-fetch the pack first (see _msSwitchDocTab).
    html += '<div id="msDocStage_' + safeJobKey + '" class="msr-stage-wrap">' + _msRenderDocStage(docTabs, activeTab, row) + '</div>';
  } else {
    html += '<div class="msr-panel"><div class="msr-empty-note">'
      + (ctx.pack
        ? 'No documents are attached to this pack yet.'
        : 'This pack has already passed Docs Ready review; the byte-exact pack view is available while the pack is in the review queue. The emails below are the current truth.')
      + '</div></div>';
  }
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

  // ── PRIMARY ACTIONS AT THE BOTTOM — sticky foot; flags arm the stamps ─────
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
 * The one next action, chosen from the backend control flags alone. It never
 * names an action the backend has not enabled.
 */
function _msSesNextAction(cockpit) {
  var controls = (cockpit && cockpit.controls) || {};
  var onHold = cockpit && cockpit.status === 'HOLD';
  var cls = '';
  var text;
  if (onHold) {
    cls = ' hold';
    var n = _msSesHoldBlockers(cockpit).length;
    text = n
      ? ('Clear <strong>' + n + ' blocker' + (n === 1 ? '' : 's') + '</strong> below &mdash; nothing can be approved or sent until then.')
      : 'The system stopped this pack &mdash; nothing can be approved or sent until it clears.';
  } else if (controls.send_it && controls.send_it.enabled) {
    text = 'Read the pack, then press <strong>SEND IT</strong>. It emails the report, the photos and the invoice exactly as shown below.';
  } else if (controls.approve_invoice && controls.approve_invoice.enabled) {
    text = 'Check the Invoice tab, then press <strong>APPROVE INVOICE</strong>. That creates the real Xero invoice; the pack comes back here once more before anything sends.';
  } else {
    text = 'Nothing to press yet &mdash; the system is still preparing this pack. Review it and leave feedback if something looks wrong.';
  }
  return '<div class="msr-next' + cls + '"><span class="msr-next-k">Next</span><span class="msr-next-v">' + text + '</span></div>';
}

// ── HOLD STORY (verbatim facts + plain-English clear paths) ─────────────────

/**
 * The deduped hold blockers, verbatim from the cockpit's status.reasons.
 * The backend can emit the same blocker once per route (this is how "builder
 * email draft missing" printed twice on the captain's screen), so duplicates
 * are collapsed case-insensitively before anything renders.
 */
function _msSesHoldBlockers(cockpit) {
  var sections = (cockpit && cockpit.sections) || {};
  var raw = (sections.status && Array.isArray(sections.status.reasons)) ? sections.status.reasons : [];
  var seen = {};
  var out = [];
  raw.forEach(function(r) {
    var t = String(r == null ? '' : r).trim();
    if (!t) return;
    var key = t.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
    if (seen[key]) return;
    seen[key] = true;
    out.push(t);
  });
  return out;
}

// Known blocker shapes -> the plain-English path that clears them. These are
// PROCESS explanations (how this pipeline works), not claims about the job's
// state — the blocker fact itself always renders verbatim above the clear
// path. An unrecognised blocker gets the honest generic path. Order matters:
// more specific patterns sit above the catch-all /report/ one.
var _MS_SES_BLOCKER_CLEARS = [
  [/work\s*order|builder\s*instruction/i,
    'Get the builder’s work order onto this job — attach it, or ask the builder to resend it. The pack rebuilds and re-checks on its own.'],
  [/email\s*draft/i,
    'The system still has to draft this email. It normally clears on the next run of the reporting routine; if it stays stuck, say so in Feedback below.'],
  [/xero\s*invoice/i,
    'This clears from this screen: APPROVE INVOICE creates the invoice in Xero. Clear any other blockers first and the stamp unlocks.'],
  [/rate|price|pricing|schedule|labour|invoice\s*line/i,
    'Confirm the right figure in Feedback below. The next pack rebuild re-prices the invoice and this check runs again.'],
  [/photo/i,
    'The photos have to reach this job (trade upload, or attach them from the intake email); the next pack rebuild picks them up.'],
  [/swms/i,
    'The SWMS has to be generated or attached before this pack can go.'],
  [/completion\s*report|report/i,
    'The system has to draft the completion report from the trade submission. If it keeps failing, say so in Feedback below.']
];

function _msSesBlockerClears(reason) {
  for (var i = 0; i < _MS_SES_BLOCKER_CLEARS.length; i++) {
    if (_MS_SES_BLOCKER_CLEARS[i][0].test(reason)) return _MS_SES_BLOCKER_CLEARS[i][1];
  }
  return 'Fix the thing it names, then the pack rebuilds and re-checks itself. If you cannot fix it from here, say so in Feedback below.';
}

/**
 * The single amber hold block: numbered blockers, deduped, each stating the
 * backend's fact VERBATIM plus the plain-English path that clears it.
 */
function _msSesRenderHoldBanner(cockpit) {
  var blockers = _msSesHoldBlockers(cockpit);
  var n = blockers.length;
  var html = '<div class="msr-hold">';
  html += '<div class="msr-hold-h">On hold &mdash; '
    + (n ? (n + ' thing' + (n === 1 ? '' : 's') + ' must clear before this pack can move') : 'this pack cannot move yet')
    + '</div>';
  html += '<div class="msr-hold-lede">The system stopped this pack because something is missing or looks wrong. There is no override on this screen.</div>';
  if (n) {
    html += '<ol class="msr-blockers">';
    blockers.forEach(function(r) {
      html += '<li><div class="msr-blocker-fact">' + escapeHtml(r) + '</div>';
      html += '<div class="msr-clears"><b>What clears it</b>' + escapeHtml(_msSesBlockerClears(r)) + '</div></li>';
    });
    html += '</ol>';
  }
  html += '<div class="msr-hold-foot">Blockers clear on their own the next time the pack rebuilds. If one of them is wrong, say so in Feedback at the bottom.</div>';
  html += '</div>';
  return html;
}

/**
 * RV-1: a missing document is NAMED in one quiet sentence under the tabs,
 * never an empty frame. Facts come from the pack's own artifacts; SWMS is the
 * one deliberately soft clause — no feed on this surface states whether a job
 * OWES a SWMS, so an absent SWMS is "not in this pack", never "not required".
 */
function _msSesMissingLine(row, ctx) {
  if (!ctx || !ctx.pack) return '';
  var draft = Array.isArray(row.draft_docs) ? row.draft_docs : [];
  var source = Array.isArray(row.source_docs) ? row.source_docs : [];
  function hasDraft(re) {
    return draft.some(function(d) { return d && re.test(String(d.label || '')); });
  }
  var missing = [];
  if (!hasDraft(/make\s*safe|completion|report/i)) missing.push('the completion report');
  if (!source.some(function(s) {
    return s && s.kind !== 'image' && /work[\s_-]*order|works[\s_-]*order|^wo\b/i.test(String(s.label || ''));
  })) missing.push('the builder work order');
  if (!(Array.isArray(row.photos) && row.photos.length)) missing.push('site photos');
  if (!row.invoice) missing.push('a draft invoice');
  var invoicePdfMissing = row.invoice && !hasDraft(/invoice/i);
  var swmsAbsent = !hasDraft(/swms/i);
  if (!missing.length && !invoicePdfMissing && !swmsAbsent) return '';
  var bits = [];
  if (missing.length) bits.push('<b>Not in this pack:</b> ' + escapeHtml(missing.join(', ')) + '.');
  if (invoicePdfMissing) bits.push('The Invoice tab shows the drafted figures &mdash; the Xero PDF is created at APPROVE INVOICE.');
  if (swmsAbsent) bits.push('No SWMS in the pack; this screen cannot tell whether one is owed.');
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
 *   preview — never as if SEND IT already sent that shape — and the REAL
 *   routes SEND IT releases today stay one click away in a collapsed truth
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
    html += '<div class="msr-sec"><h3>Outgoing emails</h3><span class="msr-sec-note">what SEND IT releases</span></div>';
    html += '<div class="msr-lede">SEND IT sends <strong>all ' + realCountWord
      + ' email' + realPlural + ' at once</strong> to the people below.</div>';
    routes.forEach(function(r) {
      html += _msSesRenderCondensedMail(r, byHash);
    });
    return html;
  }

  var intended = _msSesAjsIntendedEmails(routes);
  html += '<div class="msr-sec"><h3>Outgoing emails</h3><span class="msr-sec-note">AJS send shape (preview)</span></div>';
  html += '<div class="msr-banner info msr-preview-note">';
  html += '<div class="msr-banner-title">Preview of the intended AJS shape &mdash; not what SEND IT sends today</div>';
  html += 'AJS packs should go as <strong>two emails</strong>: report + invoice together, then photos as a follow-up. ';
  html += 'The backend still builds <strong>' + escapeHtml(realCountWord) + ' route' + realPlural
    + '</strong> right now; SEND IT still releases all ' + escapeHtml(realCountWord) + '. ';
  html += 'A separate ship will land the two-email shape &mdash; until then this is a layout preview only. ';
  html += 'Open <strong>What SEND IT actually sends today</strong> below to read the real emails.';
  html += '</div>';
  intended.emails.forEach(function(r) {
    html += _msSesRenderCondensedMail(r, byHash);
  });
  // A route the two-email shape cannot absorb is shown as itself, never dropped.
  if (intended.leftovers.length) {
    html += '<div class="msr-lede"><strong>' + _msSmallNumberWord(intended.leftovers.length)
      + ' further route' + (intended.leftovers.length === 1 ? '' : 's')
      + '</strong> the two-email shape does not absorb. '
      + 'SEND IT releases ' + (intended.leftovers.length === 1 ? 'it' : 'them') + ' too, exactly as below.</div>';
    intended.leftovers.forEach(function(r) {
      html += _msSesRenderCondensedMail(r, byHash);
    });
  }
  // The truth, one click away: the real routes SEND IT releases today.
  html += '<details class="msr-fold">';
  html += '<summary class="msr-sec"><h3>What SEND IT actually sends today</h3>'
    + '<span class="msr-sec-note">' + escapeHtml(realCountWord) + ' real email' + realPlural
    + ' &mdash; open to read them</span></summary>';
  html += '<div class="msr-lede">These are the backend&rsquo;s own routes. SEND IT releases <strong>all '
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
  var docs = _msSesDocsFromArtifacts(ctx.pack.artifacts);
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
    if (doc.kind === 'image') return; // photos stay in the photo section
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
  // The invoice is ALWAYS a document: when no invoice PDF is bound yet, the
  // drafted proposal renders as an invoice page on the stage (kind 'invdoc').
  var hasInvoiceTab = out.some(function(o) { return o.isInvoiceDoc; });
  if (!hasInvoiceTab && d && d.invoice) {
    out.push({ tabLabel: 'Invoice', url: null, kind: 'invdoc', isInvoiceDoc: true });
  }
  // Order: report first (the main document), money second, then the rest.
  // Note: use a has-own check, not `|| 9` — 'Make Safe Report' maps to 0 (falsy).
  var order = { 'Make Safe Report': 0, 'Invoice': 1, 'SWMS': 2, 'Work Order': 3, 'Raw Trade Report': 5, 'Trade Report': 6, 'Trade Report PDF': 7 };
  out.sort(function(a, b) {
    var oa = (order[a.tabLabel] != null) ? order[a.tabLabel] : (a.isWorkOrder ? 4 : 9);
    var ob = (order[b.tabLabel] != null) ? order[b.tabLabel] : (b.isWorkOrder ? 4 : 9);
    return oa - ob;
  });
  return out;
}

/**
 * Render the fit-to-page stage for the doc at index idx. Dark stage with the
 * page centered + a "fit to page" tag (mockup .pdfstage / .pdffit). PDFs embed
 * an iframe with the Fit-fragment URL; images render contained; the drafted
 * invoice (kind 'invdoc') renders as an invoice page from the row's own
 * figures; anything else gets an open-in-new-tab fallback.
 *
 * The stage is deliberately short (density). A PDF or image therefore carries
 * an "Open document" escape hatch to a full-size read in a new tab, so nothing
 * on this screen is only readable at stage size.
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
  var inner;
  if (t && t.kind === 'invdoc') {
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

/**
 * The drafted invoice AS A DOCUMENT: an invoice page rendered on the stage
 * from the SES proposal figures (or the Xero binding facts when present but
 * the PDF is not in this pack). Read-only presentation of backend numbers —
 * figure changes go through Feedback, never a send-time edit.
 */
function _msSesRenderInvoiceDoc(d) {
  var inv = (d && d.invoice) || {};
  var lines = Array.isArray(inv.lines) ? inv.lines : [];
  var statusLine = inv.invoice_number
    ? escapeHtml(inv.invoice_number) + (inv.status ? ' &middot; ' + escapeHtml(inv.status) : '')
    : 'DRAFT &mdash; SES proposal, not yet in Xero';

  var html = '<div class="msr-invpage">';
  html += '<div class="msr-invpage-band"></div>';
  html += '<div class="msr-invpage-body">';
  html += '<div class="msr-invpage-head"><h4>Tax Invoice</h4><span class="msr-invpage-status">' + statusLine + '</span></div>';
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
  html += '<div class="msr-invpage-foot">Figures are read-only here. To change pricing, say so in Feedback &mdash; the next pack rebuild re-prices before anything is approved.</div>';
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
      var active = (Number(btns[i].getAttribute('data-tabidx')) === idx);
      btns[i].style.background = active ? 'var(--sw-orange)' : '#fff';
      btns[i].style.color = active ? '#fff' : 'var(--sw-dark)';
      btns[i].style.borderColor = active ? 'var(--sw-orange)' : 'var(--sw-border)';
    }
  }
  var stage = (root.querySelector && root.querySelector('#msDocStage_' + key)) || document.getElementById('msDocStage_' + key);
  if (stage) stage.innerHTML = _msRenderDocStage(docTabs, idx, d);
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
      isDraft: !!isDraft,
      created_at: meta.created_at || null,
      received_at: meta.received_at || meta.created_at || null,
      source_type: meta.source_type || null,
      raw_report: meta.raw_report || null,
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
 * The two-step stamp rail, rendered at the BOTTOM of the pane (sticky foot).
 * BOTH primary actions are always VISIBLE; only the backend control flags
 * decide which is pressable:
 *   controls.approve_invoice.enabled -> APPROVE INVOICE live -> approveSesInvoice
 *   controls.send_it.enabled         -> SEND IT live         -> sendSesRelease
 * Order is always APPROVE INVOICE, then SEND IT. An enabled stamp's note
 * renders the BACKEND'S OWN plan text verbatim when the cockpit carries one.
 * A disabled stamp carries no id and no onclick — nothing for a click or a
 * script to reach — with the plain reason under it. A HOLD points back at the
 * amber block above. The mockup's single combined "Approve & send pack"
 * button is the RETIRED 410 path and is deliberately NOT ported.
 */
function _msSesActionBlock(jobId, ctx, dismissAction) {
  var cockpit = ctx.cockpit || {};
  var sections = cockpit.sections || {};
  var controls = cockpit.controls || {};
  var approveInvoice = controls.approve_invoice || {};
  var sendIt = controls.send_it || {};
  var onHold = cockpit.status === 'HOLD';
  var blockerCount = onHold ? _msSesHoldBlockers(cockpit).length : 0;
  var xero = (sections.money && sections.money.xero) ||
    (ctx.pack && ctx.pack.docket && ctx.pack.docket.xero_binding) || null;
  var safeId = _msJsAttr(jobId);
  var html = '';

  var holdReason = 'Locked by the hold above'
    + (blockerCount ? ' &mdash; blocker' + (blockerCount === 1 ? ' 1' : 's 1&#8211;' + blockerCount) + ' must clear first' : '')
    + '. There is no override.';
  var captainNote = controls.captain_only ? ' Captain authority is required for this pack.' : '';

  var approveNote;
  if (approveInvoice.enabled) {
    approveNote = escapeHtml(approveInvoice.plan || 'Creates the real Xero invoice for the figures on the Invoice tab.')
      + ' Your click, every time.';
  } else if (onHold) {
    approveNote = holdReason;
  } else if (xero && (xero.invoice_number || xero.status)) {
    approveNote = 'Already done &mdash; invoice ' + escapeHtml(xero.invoice_number || '')
      + (xero.status ? ' is ' + escapeHtml(String(xero.status)) : '') + ' in Xero.';
  } else {
    approveNote = 'The system has not unlocked this step for this pack yet.' + captainNote;
  }

  var sendNote;
  if (sendIt.enabled) {
    sendNote = escapeHtml(sendIt.plan || 'Sends the emails below exactly as shown.')
      + ' Irreversible. Your click, every time.';
  } else if (onHold) {
    sendNote = holdReason;
  } else if (approveInvoice.enabled) {
    sendNote = 'Unlocks after APPROVE INVOICE &mdash; the invoice email needs the authorised Xero invoice before anything can send.';
  } else {
    sendNote = 'The system has not unlocked sending for this pack yet.' + captainNote;
  }

  html += '<div class="msr-steps">';
  html += _msSesStamp({ step: 1, word: 'APPROVE INVOICE', kind: 'approve', enabled: !!approveInvoice.enabled, id: 'msSesApproveInvoiceBtn', onclick: 'approveSesInvoice(\'' + safeId + '\')', note: approveNote });
  html += _msSesStamp({ step: 2, word: 'SEND IT', kind: 'send', enabled: !!sendIt.enabled, id: 'msSesSendItBtn', onclick: 'sendSesRelease(\'' + safeId + '\')', note: sendNote });
  html += '</div>';

  // The Docs Ready tick state, bound to the exact displayed pack hash. This is
  // the captain's per-job approval record (blueprint: "the approve control is
  // your decision" / RV-10): a tick that dies the moment the pack's bytes
  // change, never a running approve-all. On hold there is nothing to record.
  if (!onHold) {
    var tickPending = (ctx.reviewState === 'needs_review' && ctx.docketRevisionId && ctx.outputHash);
    html += '<div class="msr-tick' + (tickPending ? ' pending' : '') + '">';
    if (tickPending) {
      html += '<span>Your Docs Ready approval is <b>not yet recorded</b>. Pressing SEND IT records it against exactly this version of the pack (<code>' + escapeHtml(String(ctx.outputHash).slice(0, 27)) + '&#8230;</code>) &mdash; if the pack changes afterwards, that approval is void and the pack comes back here.</span>';
    } else {
      html += '<span>Your Docs Ready approval is <b>already recorded</b> for exactly this version of the pack.</span>';
    }
    html += '</div>';
  }
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
  // The backend control flag is the only thing that can arm this action: a
  // disabled stamp has no onclick, and even a programmatic call stops here.
  var approveCtl = ctx.cockpit && ctx.cockpit.controls && ctx.cockpit.controls.approve_invoice;
  if (!(approveCtl && approveCtl.enabled)) {
    showToast('APPROVE INVOICE is not enabled for this pack.', 'error');
    return;
  }
  if (!confirm('This records your SES approval and creates + AUTHORISES the real Xero invoice for this exact invoice revision, then binds the Xero PDF into a fresh pack for final review. Continue?')) return;

  var btn = document.getElementById('msSesApproveInvoiceBtn');
  if (btn) { btn.disabled = true; _msSesStampProgress(btn, 'Recording approval...'); }

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
    if (btn) _msSesStampProgress(btn, 'Authorising in Xero...');
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
    if (btn) { btn.disabled = false; _msSesStampProgress(btn, 'APPROVE INVOICE'); }
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
  // Same fail-closed rule as approveSesInvoice: only the backend's send_it
  // flag can arm a send, whatever invoked this function.
  var sendCtl = ctx.cockpit && ctx.cockpit.controls && ctx.cockpit.controls.send_it;
  if (!(sendCtl && sendCtl.enabled)) {
    showToast('SEND IT is not enabled for this pack.', 'error');
    return;
  }
  var needsSignoff = ctx.reviewState === 'needs_review' && !!ctx.docketRevisionId && !!ctx.outputHash;
  var confirmMsg = 'SEND IT releases ALL THREE routes at once (report + photos + invoice emails) to the exact recipients shown'
    + (needsSignoff
      ? ', after recording your Docs Ready tick bound to the exact displayed pack hash'
      : ' (the Docs Ready tick is already recorded for the current pack)')
    + '. This is irreversible. Send now?';
  if (!confirm(confirmMsg)) return;

  var btn = document.getElementById('msSesSendItBtn');
  if (btn) { btn.disabled = true; _msSesStampProgress(btn, 'Working...'); }

  try {
    if (needsSignoff) {
      if (btn) _msSesStampProgress(btn, 'Recording Docs Ready tick...');
      await opsPostJwt('sign_off_ses_docket', {
        docket_revision_id: ctx.docketRevisionId,
        expected_output_content_hash: ctx.outputHash
      });
    }
    if (btn) _msSesStampProgress(btn, 'Preparing release...');
    var prepBody = { job_ids: [jobId] };
    var actor = _msSesActor();
    if (actor) prepBody.created_by = actor;
    var prepared = await opsPost('prepare_ses_release_revision', prepBody);
    var releaseRevisionId = prepared && prepared.release && prepared.release.id;
    if (!releaseRevisionId) {
      throw new Error('The release revision id was not returned by prepare_ses_release_revision.');
    }
    if (btn) _msSesStampProgress(btn, 'Approving release...');
    await opsPostJwt('approve_ses_release_revision', { release_revision_id: releaseRevisionId });
    if (btn) _msSesStampProgress(btn, 'Sending all three routes...');
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
    if (btn) { btn.disabled = false; _msSesStampProgress(btn, 'SEND IT'); }
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
