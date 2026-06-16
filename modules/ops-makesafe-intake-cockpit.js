// ════════════════════════════════════════════════════════════
// MAKESAFE INTAKE COCKPIT — APPROVALS VIEW (right column)
// Kanban-style intake review surface that lives alongside the council
// approvals split-pane. Renders into #msIntakeListBody (left column) and
// #msIntakeDetailPanel (right detail). This is a SEPARATE surface from the
// jobs-view intake review (loadMakesafeIntake / renderMakesafeIntakeReview) —
// it reuses the global intake* helpers and renderIntakeReviewInput, but uses
// data-ms-cockpit-field attributes so the two surfaces never collide.
//
// Globals consumed (all defined in ops.html):
//   opsFetch, opsPost, showToast, escapeHtml, escapeAttr,
//   intakeFieldValue, intakeMissingFields, intakeAttachments,
//   intakeFirstPdfUrl, intakeConfidenceColor, renderIntakeReviewInput
// ════════════════════════════════════════════════════════════

var _msCockpitDraftCache = {};

// ────────────────────────────────────────────────────────────
// 1. LIST PANEL — load + render the intake column
// ────────────────────────────────────────────────────────────

/**
 * Load intake drafts and render the cockpit column.
 * Returns the count of drafts (resolves to 0 on error).
 */
async function loadMakesafeIntakeCockpit() {
  var body = document.getElementById('msIntakeListBody');
  if (body) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--sw-text-sec);font-size:13px;">Loading intake drafts...</div>';
  }
  try {
    var data = await opsFetch('list_intake_drafts', { status: 'draft,needs_review' });
    var drafts = (data && data.drafts) || [];
    _msCockpitDraftCache = {};
    drafts.forEach(function(d) { _msCockpitDraftCache[d.id] = d; });

    // Sort: needs_review first, then draft; within each group created_at desc.
    drafts.sort(function(a, b) {
      var rank = function(s) { return (s === 'needs_review') ? 0 : 1; };
      var ra = rank(a.status);
      var rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      var ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      var tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    if (body) {
      if (drafts.length === 0) {
        body.innerHTML = '<div style="padding:40px 20px;text-align:center;">'
          + '<div style="font-size:36px;opacity:0.3;margin-bottom:12px;">&#9993;</div>'
          + '<div style="font-size:14px;font-weight:600;color:var(--sw-dark);">No pending intake drafts</div>'
          + '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:6px;">Use Scan Now to pull new make-safe work orders from the SES inbox.</div>'
          + '</div>';
      } else {
        var html = '';
        drafts.forEach(function(d) { html += renderMsIntakeCard(d); });
        body.innerHTML = html;
      }
    }

    refreshMsIntakeBadge(drafts.length);
    return drafts.length;
  } catch (e) {
    if (body) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:#E74C3C;font-size:13px;">Failed to load intake drafts: ' + escapeHtml(e.message || String(e)) + '</div>';
    }
    refreshMsIntakeBadge(0);
    return 0;
  }
}

/**
 * Render a single intake draft card for the cockpit column.
 */
function renderMsIntakeCard(d) {
  var status = (d.status === 'needs_review') ? 'needs_review' : 'draft';
  var statusBg = status === 'needs_review' ? '#0E7C7B' : '#9CA3AF';
  var statusLabel = status === 'needs_review' ? 'NEEDS REVIEW' : 'DRAFT';

  var builder = intakeFieldValue(d, 'requesting_company_name') || d.from_name || '';
  var ref = intakeFieldValue(d, 'external_ref');
  var client = intakeFieldValue(d, 'client_name');
  var suburb = intakeFieldValue(d, 'site_suburb');
  var confColor = intakeConfidenceColor(d.confidence);
  var missing = intakeMissingFields(d);

  var safeId = escapeAttr(d.id);
  var html = '<div onclick="showMsIntakeDetail(\'' + safeId + '\')" style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;padding:12px;margin:10px;cursor:pointer;box-shadow:0 1px 3px rgba(41,60,70,0.06);border-left:4px solid ' + statusBg + ';">';

  // Top row: status badge + confidence pill
  html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
  html += '<span style="font-size:9px;font-weight:800;letter-spacing:0.04em;padding:2px 7px;border-radius:10px;background:' + statusBg + ';color:#fff;">' + statusLabel + '</span>';
  html += '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;background:' + confColor + ';color:#fff;text-transform:uppercase;">' + escapeHtml(d.confidence || 'low') + '</span>';
  html += '</div>';

  // Builder name
  html += '<div style="font-size:14px;font-weight:700;color:var(--sw-dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(builder || '(no builder)') + '</div>';

  // Detail lines
  if (ref) html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:3px;"><strong>Ref:</strong> ' + escapeHtml(ref) + '</div>';
  if (client) html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:2px;"><strong>Client:</strong> ' + escapeHtml(client) + '</div>';
  if (suburb) html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:2px;"><strong>Suburb:</strong> ' + escapeHtml(suburb) + '</div>';

  // Missing fields warning
  if (missing.length > 0) {
    html += '<div style="font-size:11px;color:#B91C1C;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:5px 8px;margin-top:8px;">Missing: ' + escapeHtml(missing.join(', ')) + '</div>';
  }

  // Review button
  html += '<div style="margin-top:10px;">';
  html += '<button onclick="event.stopPropagation();showMsIntakeDetail(\'' + safeId + '\')" style="width:100%;background:#1F3A44;color:#fff;border:none;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Review</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

// ────────────────────────────────────────────────────────────
// 2. DETAIL PANEL — review one draft
// ────────────────────────────────────────────────────────────

/**
 * Render the cockpit-flavoured review input. Mirrors renderIntakeReviewInput
 * but swaps data-intake-field for data-ms-cockpit-field and wires the status
 * recompute to the cockpit handler.
 */
function renderMsCockpitInput(field, label, value, required, multiline, helper) {
  var html = renderIntakeReviewInput(field, label, value, required, multiline, helper);
  html = html.split('data-intake-field').join('data-ms-cockpit-field');
  html = html.split('updateMakesafeIntakeReviewStatus()').join('updateMsCockpitReviewStatus()');
  html = html.split('id="msi_').join('id="mscockpit_');
  return html;
}

/**
 * Render the full review panel for a draft into #msIntakeDetailPanel.
 */
function showMsIntakeDetail(draftId) {
  var d = _msCockpitDraftCache[draftId];
  var panel = document.getElementById('msIntakeDetailPanel');
  if (!panel) return;
  if (!d) {
    panel.innerHTML = '<div style="padding:20px;color:#E74C3C;font-size:13px;">Draft not loaded. <button onclick="loadMakesafeIntakeCockpit()" style="margin-left:8px;">Reload</button></div>';
    return;
  }

  var attachments = intakeAttachments(d);
  var pdfUrl = intakeFirstPdfUrl(d);
  var safeId = escapeAttr(d.id);

  var html = '';

  // Header
  html += '<div style="flex-shrink:0;display:flex;align-items:flex-start;gap:12px;padding:14px 18px;background:#fff;border-bottom:1px solid var(--sw-border);">';
  html += '<button onclick="showMsIntakeDetailEmpty()" style="background:none;border:none;color:var(--sw-orange);font-size:13px;font-weight:600;cursor:pointer;padding:4px 0;white-space:nowrap;">&#8592; Back</button>';
  html += '<div style="flex:1;min-width:0;">';
  html += '<div style="font-size:15px;font-weight:700;color:var(--sw-dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(d.subject || '(no subject)') + '</div>';
  html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:2px;">From: ' + escapeHtml(d.from_name || d.from_email || '') + '</div>';
  html += '</div></div>';

  // Two-column body (scrollable)
  html += '<div style="flex:1;overflow:hidden;display:flex;min-height:0;">';

  // LEFT: source evidence / PDF
  html += '<div style="width:48%;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--sw-border);background:#F7FAFB;">';
  html += '<div style="padding:12px 16px;flex-shrink:0;border-bottom:1px solid var(--sw-border);">';
  html += '<div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Source work order</div>';
  html += '<div style="font-size:12px;color:var(--sw-text-sec);margin-top:4px;">' + attachments.length + ' work order file(s)</div>';
  if (pdfUrl) {
    html += '<a href="' + escapeAttr(pdfUrl) + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;background:#4C6A7C;color:#fff;text-decoration:none;padding:6px 12px;border-radius:6px;font-weight:700;font-size:12px;">Open PDF</a>';
  }
  html += '</div>';
  if (pdfUrl) {
    html += '<div style="flex:1;min-height:0;">';
    html += '<iframe title="Work order PDF" src="' + escapeAttr(pdfUrl) + '" style="width:100%;height:100%;border:0;display:block;"></iframe>';
    html += '</div>';
  } else {
    html += '<div style="padding:24px 16px;color:#B91C1C;background:#FFF7ED;margin:16px;border:1px dashed #FED7AA;border-radius:8px;font-size:13px;">No PDF preview URL found. Hold or reject unless a work order is attached elsewhere.</div>';
  }
  if (d.body_preview) {
    html += '<details style="padding:12px 16px;flex-shrink:0;border-top:1px solid var(--sw-border);"><summary style="cursor:pointer;font-weight:700;color:#48697A;font-size:12px;">Email body preview</summary><div style="white-space:pre-wrap;font-size:12px;color:#4B5563;margin-top:8px;">' + escapeHtml(d.body_preview) + '</div></details>';
  }
  html += '</div>';

  // RIGHT: editable fields + actions
  html += '<div style="flex:1;min-width:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 18px;background:#fff;">';
  html += '<div id="msCockpitReviewStatus" style="margin-bottom:14px;"></div>';
  html += '<div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;margin-bottom:10px;">SecureSuite fields to approve</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
  html += renderMsCockpitInput('requesting_company_name', 'Builder / requesting company', intakeFieldValue(d, 'requesting_company_name'), true, false);
  html += renderMsCockpitInput('external_ref', 'Builder ref / PO', intakeFieldValue(d, 'external_ref'), true, false);
  html += renderMsCockpitInput('client_name', 'Client / homeowner', intakeFieldValue(d, 'client_name'), true, false);
  html += renderMsCockpitInput('client_phone', 'Client phone', intakeFieldValue(d, 'client_phone'), false, false);
  html += renderMsCockpitInput('client_email', 'Client email', intakeFieldValue(d, 'client_email'), false, false);
  html += renderMsCockpitInput('site_suburb', 'Suburb', intakeFieldValue(d, 'site_suburb'), false, false);
  html += '</div>';
  html += renderMsCockpitInput('site_address', 'Site address', intakeFieldValue(d, 'site_address'), true, false);
  html += renderMsCockpitInput('makesafe_type', 'MakeSafe type', intakeFieldValue(d, 'makesafe_type'), false, false, 'Example: temp fence, roof make safe, ceiling collapse, structural make safe.');
  html += renderMsCockpitInput('description', 'Scope / work-order summary', intakeFieldValue(d, 'description'), false, true);
  html += renderMsCockpitInput('safety_requirements', 'Safety / access notes', intakeFieldValue(d, 'safety_requirements'), false, true);

  // Actions
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;border-top:1px solid #EEF2F5;padding-top:14px;">';
  html += '<button id="msCockpitApproveBtn" onclick="approveMsIntakeDraftCockpit(\'' + safeId + '\', true)" style="background:#27AE60;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">Approve + create MakeSafe</button>';
  html += '<button onclick="rejectMsIntakeDraftCockpit(\'' + safeId + '\')" style="background:#E74C3C;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">Reject</button>';
  html += '<button onclick="showMsIntakeDetailEmpty()" style="background:#E5EEF3;color:#1F3A44;border:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Hold for later</button>';
  html += '</div>';

  html += '</div>'; // end right column
  html += '</div>'; // end two-column body

  panel.innerHTML = html;
  updateMsCockpitReviewStatus();
}

/**
 * Reset #msIntakeDetailPanel to the empty state.
 */
function showMsIntakeDetailEmpty() {
  var panel = document.getElementById('msIntakeDetailPanel');
  if (!panel) return;
  panel.innerHTML = '<div class="approvals-empty-state">'
    + '<div style="font-size:36px;opacity:0.3;margin-bottom:12px;">&#9993;</div>'
    + '<div style="font-size:13px;color:var(--sw-text-sec);">Select a draft to review</div>'
    + '</div>';
}

/**
 * Collect the cockpit reviewed field values keyed by field name.
 */
function getMsCockpitReviewedFields() {
  var fields = {};
  var nodes = document.querySelectorAll('[data-ms-cockpit-field]');
  nodes.forEach(function(node) { fields[node.getAttribute('data-ms-cockpit-field')] = node.value || ''; });
  return fields;
}

/**
 * Recompute the review status banner + approve-button gate from current inputs.
 */
function updateMsCockpitReviewStatus() {
  var status = document.getElementById('msCockpitReviewStatus');
  var approveBtn = document.getElementById('msCockpitApproveBtn');
  if (!status) return;
  var draftIdMatch = approveBtn && approveBtn.getAttribute('onclick')
    ? approveBtn.getAttribute('onclick').match(/approveMsIntakeDraftCockpit\('([^']+)'/)
    : null;
  var draft = draftIdMatch ? _msCockpitDraftCache[draftIdMatch[1]] : null;
  var reviewed = getMsCockpitReviewedFields();
  var missing = intakeMissingFields(draft || {}, reviewed);
  var ok = missing.length === 0;
  status.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:10px;border:1px solid ' + (ok ? '#BBF7D0' : '#FECACA') + ';background:' + (ok ? '#F0FDF4' : '#FEF2F2') + ';">'
    + '<div style="font-weight:800;color:' + (ok ? '#15803D' : '#B91C1C') + ';font-size:13px;">' + (ok ? 'Core information looks ready to approve' : 'Missing before approve: ' + escapeHtml(missing.join(', '))) + '</div>'
    + '<div style="font-size:11px;color:#6B7280;white-space:nowrap;">PDF vs fields gate</div>'
    + '</div>';
  if (approveBtn) {
    approveBtn.disabled = !ok;
    approveBtn.style.opacity = ok ? '1' : '.45';
    approveBtn.style.cursor = ok ? 'pointer' : 'not-allowed';
  }
}

// ────────────────────────────────────────────────────────────
// 3. ACTIONS — approve / reject
// ────────────────────────────────────────────────────────────

/**
 * Approve the draft after comparing source PDF to fields, creating a job.
 */
async function approveMsIntakeDraftCockpit(draftId, fromReview) {
  var draft = _msCockpitDraftCache[draftId] || {};
  var reviewedFields = fromReview ? getMsCockpitReviewedFields() : {};
  var missing = intakeMissingFields(draft, reviewedFields);
  if (missing.length > 0) {
    showToast('Cannot approve; missing: ' + missing.join(', '), 'error');
    return;
  }
  if (!confirm('Approve this intake as correct and create a new make-safe job?')) return;
  try {
    var result = await opsPost('approve_intake_draft', {
      draft_id: draftId,
      approved_by: 'ops_dashboard',
      reviewed_fields: reviewedFields,
      review_notes: 'Approved after comparing source work order/PDF to SecureSuite fields.'
    });
    showToast('Job created: ' + (result.job && result.job.job_number || ''), 'success');
    loadMakesafeIntakeCockpit();
    showMsIntakeDetailEmpty();
  } catch (e) {
    showToast('Approve failed: ' + (e.message || e), 'error');
  }
}

/**
 * Reject the draft with an optional reason.
 */
async function rejectMsIntakeDraftCockpit(draftId) {
  var notes = prompt('Reject reason (what is wrong or missing?):');
  if (notes === null) return;
  try {
    await opsPost('reject_intake_draft', { draft_id: draftId, rejected_by: 'ops_dashboard', review_notes: notes || null });
    showToast('Draft rejected', 'success');
    loadMakesafeIntakeCockpit();
    showMsIntakeDetailEmpty();
  } catch (e) {
    showToast('Reject failed: ' + (e.message || e), 'error');
  }
}

// ────────────────────────────────────────────────────────────
// 4. BADGE
// ────────────────────────────────────────────────────────────

/**
 * Update the MakeSafe tab badge with the draft count. Hidden when 0.
 */
function refreshMsIntakeBadge(count) {
  var badge = document.getElementById('msIntakeBadge');
  if (!badge) return;
  if (count && count > 0) {
    badge.textContent = String(count);
    badge.style.display = '';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

// SMOKE TEST (manual, run in browser console):
// 1. showView('approvals') -- approvals view loads
// 2. Click "MakeSafe" tab -- intake cockpit renders, shows loading state
// 3. loadMakesafeIntakeCockpit() returns a count (0 or N)
// 4. If drafts exist: clicking a card renders detail with PDF iframe and approve button
// 5. approveBtn.disabled === true when required fields empty
// 6. After valid fields: approveBtn.disabled === false
// 7. approving a valid draft calls opsPost('approve_intake_draft', ...) and shows toast
// 8. rejecting calls opsPost('reject_intake_draft', ...) and shows toast
