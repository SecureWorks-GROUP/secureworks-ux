// ════════════════════════════════════════════════════════════
// MAKESAFE FEEDBACK NOTES - threaded notes on a make-safe DRAFT (Wave 3)
//
// A self-contained notes panel that hangs off the reporting cockpit detail panel
// (ops-makesafe-reporting-cockpit.js: showMsReportingDetail). The reviewer leaves
// a note on a draft; the make-safe routine reads unaddressed human notes, re-runs
// the draft render in response, marks them addressed, and posts an agent reply
// note (role='agent', body starts with 'MAKESAFE_AGENT_REPLY |'). This panel
// renders the whole thread, lets a human add a note, and exposes a "Re-run now"
// button that fires rerun_draft_report (DRAFT-ONLY: never sends or authorises).
//
// DRAFT-STAGE ONLY. Nothing here authorises an invoice or emails a builder; that
// stays on the cockpit's "Approve and send pack" button (makesafe_send_pack).
//
// Globals consumed (all defined in ops.html):
//   opsFetch, opsPost, showToast, escapeHtml, escapeAttr
// ════════════════════════════════════════════════════════════

// Keyed by job_id -> notes array (last loaded thread).
var _msNotesCache = {};

// The author label used for a human note added from the dashboard. The backend
// records who via operator_email; this is the display name in the thread.
var _MS_NOTES_DEFAULT_AUTHOR = 'Ops';

// The agent-reply prefix the backend stamps on every routine reply note. Mirrors
// makesafe_draft_notes.ts AGENT_REPLY_PREFIX. Used only for display tidy-up.
var _MS_AGENT_REPLY_PREFIX = 'MAKESAFE_AGENT_REPLY |';

// ────────────────────────────────────────────────────────────
// 1. LOAD - read the thread for a job and render it into a container
// ────────────────────────────────────────────────────────────

/**
 * Load the notes thread for a job and render it into the element with id
 * containerElId. Always shows the add-note form + a Re-run now button (the
 * panel is the human's draft-feedback surface).
 */
async function loadMsNotes(jobId, containerElId) {
  var el = document.getElementById(containerElId);
  if (el) {
    el.innerHTML = '<div style="padding:10px 0;font-size:12px;color:var(--sw-text-sec);">Loading notes...</div>';
  }
  try {
    var data = await opsFetch('list_draft_notes', { job_id: jobId });
    var notes = (data && data.notes) || [];
    _msNotesCache[jobId] = notes;
    if (el) {
      el.innerHTML = renderMsNotesPanel(jobId, notes, { showRerunButton: true });
    }
    return notes;
  } catch (e) {
    if (el) {
      el.innerHTML = '<div style="padding:10px 0;font-size:12px;color:#E74C3C;">Failed to load notes: '
        + escapeHtml(e.message || String(e))
        + '</div>'
        + renderMsNotesPanel(jobId, [], { showRerunButton: true });
    }
    return [];
  }
}

// ────────────────────────────────────────────────────────────
// 2. ADD NOTE - a human note on the draft
// ────────────────────────────────────────────────────────────

/**
 * Add a new human note to a draft. Reads the note body from the panel textarea
 * when noteBody is not passed explicitly. Reloads the thread on success.
 */
async function addMsNote(jobId, noteBody, authorName) {
  // When called from the form button, pull the textarea value.
  if (noteBody == null) {
    var ta = document.getElementById('msNoteInput-' + jobId);
    noteBody = ta ? ta.value : '';
  }
  noteBody = String(noteBody == null ? '' : noteBody).trim();
  if (!noteBody) {
    showToast('Type a note before adding it.', 'error');
    return;
  }
  var author = (authorName && String(authorName).trim()) || _MS_NOTES_DEFAULT_AUTHOR;

  var btn = document.getElementById('msAddNoteBtn-' + jobId);
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
  try {
    await opsPost('add_draft_note', {
      job_id: jobId,
      draft_kind: 'makesafe_report',
      author: author,
      role: 'human',
      note_body: noteBody
    });
    showToast('Note added.', 'success');
    await loadMsNotes(jobId, 'msNotesPanel-' + jobId);
  } catch (e) {
    showToast('Failed to add note: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Add note'; }
  }
}

// ────────────────────────────────────────────────────────────
// 3. RE-RUN - ask the routine to re-render the draft in response to notes
// ────────────────────────────────────────────────────────────

/**
 * Trigger a re-run for a job: calls rerun_draft_report (marks unaddressed human
 * notes addressed + posts an agent-reply note; the actual draft re-render is a
 * separate routine step). DRAFT-ONLY: never sends or authorises. Reloads the
 * thread on success.
 */
async function triggerMsRerun(jobId) {
  var btn = document.getElementById('msRerunBtn-' + jobId);
  if (btn) { btn.disabled = true; btn.textContent = 'Re-running...'; }
  try {
    var result = await opsPost('rerun_draft_report', { job_id: jobId });
    if (result && result.skipped) {
      showToast('Nothing to re-run: no unaddressed notes on this draft.', 'info');
    } else {
      showToast('Re-run requested. ' + ((result && result.addressed_count) || 0) + ' note(s) marked addressed.', 'success');
    }
    await loadMsNotes(jobId, 'msNotesPanel-' + jobId);
  } catch (e) {
    showToast('Re-run failed: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Re-run now'; }
  }
}

// ────────────────────────────────────────────────────────────
// 4. RENDER - the panel + a single note
// ────────────────────────────────────────────────────────────

/**
 * Render the notes panel HTML: the thread (oldest first), a Re-run now button
 * (when opts.showRerunButton), and an add-note textarea + button.
 */
function renderMsNotesPanel(jobId, notes, opts) {
  opts = opts || {};
  notes = notes || [];
  var safeId = escapeAttr(jobId);

  var html = '<div style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;overflow:hidden;">';

  // Header
  html += '<div style="padding:8px 12px;border-bottom:1px solid var(--sw-border);font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Draft feedback</div>';

  // Thread
  html += '<div style="padding:12px;display:flex;flex-direction:column;gap:8px;">';
  if (notes.length === 0) {
    html += '<div style="font-size:12px;color:var(--sw-text-sec);">No notes yet. Add a note below to ask for a change to this draft.</div>';
  } else {
    notes.forEach(function(n) { html += renderMsNote(n); });
  }
  html += '</div>';

  // Re-run now button (above the add-note form)
  if (opts.showRerunButton) {
    html += '<div style="padding:0 12px 12px;">';
    html += '<button id="msRerunBtn-' + safeId + '" onclick="triggerMsRerun(\'' + safeId + '\')" '
      + 'style="width:100%;background:#F15A29;color:#fff;border:none;padding:9px 14px;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;">Re-run now</button>';
    html += '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:5px;">Re-runs the draft in response to your notes. Does not send or authorise anything.</div>';
    html += '</div>';
  }

  // Add-note form
  html += '<div style="padding:12px;border-top:1px solid #EEF2F5;background:#F7FAFB;">';
  html += '<textarea id="msNoteInput-' + safeId + '" placeholder="Add a note on this draft (e.g. fix the address, widen the hire line)..." '
    + 'style="width:100%;box-sizing:border-box;min-height:60px;resize:vertical;border:1px solid var(--sw-border);border-radius:6px;padding:8px;font-size:13px;font-family:inherit;color:var(--sw-dark);"></textarea>';
  html += '<button id="msAddNoteBtn-' + safeId + '" onclick="addMsNote(\'' + safeId + '\')" '
    + 'style="margin-top:8px;background:#1F3A44;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Add note</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

/**
 * Render a single note row. Human notes get a light grey background; agent reply
 * notes (role='agent') get a light teal/blue background to distinguish them.
 */
function renderMsNote(note) {
  note = note || {};
  var isAgent = note.role === 'agent';
  var bg = isAgent ? '#E6F4F4' : '#F1F3F5';
  var border = isAgent ? '#0E7C7B' : '#CBD5DD';
  var author = note.author || (isAgent ? 'MakeSafe agent' : 'Unknown');
  var when = _msFmtNoteTime(note.created_at);

  // Body. Agent reply notes carry the 'MAKESAFE_AGENT_REPLY |' prefix; show the
  // full body as-is (the prefix renders inline, it is not stripped) so the thread
  // is honest about what the agent recorded.
  var body = note.body == null ? '' : String(note.body);

  var html = '<div style="border:1px solid ' + border + ';border-left:3px solid ' + border + ';background:' + bg + ';border-radius:6px;padding:8px 10px;">';
  html += '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px;">';
  html += '<span style="font-size:11px;font-weight:800;color:var(--sw-dark);">' + escapeHtml(author) + (isAgent ? ' <span style="font-weight:700;color:#0E7C7B;">(agent)</span>' : '') + '</span>';
  if (when) html += '<span style="font-size:10px;color:var(--sw-text-sec);white-space:nowrap;">' + escapeHtml(when) + '</span>';
  html += '</div>';
  html += '<div style="font-size:13px;color:var(--sw-dark);white-space:pre-wrap;word-break:break-word;">' + escapeHtml(body) + '</div>';
  html += '</div>';
  return html;
}

/**
 * Format a note timestamp for display. Tolerates a missing/invalid value.
 */
function _msFmtNoteTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return d.toISOString();
  }
}

// SMOKE TEST (manual, run in browser console):
// 1. Open a reporting pack detail; the "Draft feedback" panel renders below the PDFs.
// 2. Type a note and click "Add note" -> opsPost('add_draft_note', ...) fires; thread reloads.
// 3. Click "Re-run now" -> opsPost('rerun_draft_report', { job_id }) fires; thread reloads.
// 4. Agent reply notes render with a teal background and the (agent) tag.
//
// Automated smoke: modules/ops-makesafe-feedback-notes.smoke.mjs

// Export for the node smoke test (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadMsNotes: typeof loadMsNotes !== 'undefined' ? loadMsNotes : undefined
  };
}
