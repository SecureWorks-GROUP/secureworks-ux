// ════════════════════════════════════════════════════════════
// MAKESAFE FEEDBACK NOTES - Draft Pack / Revise Pack feedback loop
//
// A self-contained notes panel that hangs off the reporting cockpit detail panel
// (ops-makesafe-reporting-cockpit.js: showMsReportingDetail). The reviewer can
// type natural-language feedback on the draft pack: report wording, invoice lines,
// selected photos, or proposed rule changes. The primary button saves the note and
// requests a Revise Pack pass. The approve/send button remains separate.
//
// DRAFT-STAGE ONLY. Nothing here authorises an invoice, sends email, closes a job,
// or charges a builder; that stays on makesafe_send_pack behind Marnin's click.
//
// Globals consumed (all defined in ops.html / reporting cockpit):
//   opsFetch, opsPost, showToast, escapeHtml, escapeAttr
//   _msReportingCache, _msGetAllPhotos, _msPhotoApprovalState (optional)
// ════════════════════════════════════════════════════════════

// Keyed by job_id -> notes array (last loaded thread).
var _msNotesCache = {};

// The author label used for a human note added from the dashboard. The backend
// records operator_email too; this is the display name in the thread.
var _MS_NOTES_DEFAULT_AUTHOR = "Ops";

// Mirrors makesafe_draft_notes.ts AGENT_REPLY_PREFIX. Used only for display.
var _MS_AGENT_REPLY_PREFIX = "MAKESAFE_AGENT_REPLY |";

// ────────────────────────────────────────────────────────────
// 1. LOAD - read the thread for a job and render it into a container
// ────────────────────────────────────────────────────────────

async function loadMsNotes(jobId, containerElId) {
  var el = document.getElementById(containerElId);
  if (el) {
    el.innerHTML =
      '<div style="padding:10px 0;font-size:12px;color:var(--sw-text-sec);">Loading feedback...</div>';
  }
  try {
    var data = await opsFetch("list_draft_notes", { job_id: jobId });
    var notes = (data && data.notes) || [];
    _msNotesCache[jobId] = notes;
    if (el) {
      el.innerHTML = renderMsNotesPanel(jobId, notes, {
        showRerunButton: true,
      });
    }
    return notes;
  } catch (e) {
    if (el) {
      el.innerHTML =
        '<div style="padding:10px 0;font-size:12px;color:#E74C3C;">Feedback could not load yet: ' +
        escapeHtml(e.message || String(e)) +
        "</div>" +
        renderMsNotesPanel(jobId, [], { showRerunButton: true });
    }
    return [];
  }
}

// ────────────────────────────────────────────────────────────
// 2. ADD NOTE - a human note on the draft
// ────────────────────────────────────────────────────────────

async function addMsNote(jobId, noteBody, authorName) {
  if (noteBody == null) {
    var ta = document.getElementById("msNoteInput-" + jobId);
    noteBody = ta ? ta.value : "";
  }
  noteBody = String(noteBody == null ? "" : noteBody).trim();
  if (!noteBody) {
    showToast("Type feedback before saving it.", "error");
    return false;
  }
  var author = (authorName && String(authorName).trim()) ||
    _MS_NOTES_DEFAULT_AUTHOR;

  var btn = document.getElementById("msAddNoteBtn-" + jobId);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }
  try {
    var result = await opsPost("add_draft_note", {
      job_id: jobId,
      draft_kind: "makesafe_report",
      author: author,
      role: "human",
      note_body: noteBody,
    });
    if (ta) ta.value = "";
    showToast("Feedback saved.", "success");
    await loadMsNotes(jobId, "msNotesPanel-" + jobId);
    return result || true;
  } catch (e) {
    showToast("Failed to save feedback: " + (e.message || e), "error");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Add note only";
    }
    return false;
  }
}

async function addMsNoteAndRerun(jobId) {
  var btn = document.getElementById("msReviseBtn-" + jobId);
  var ta = document.getElementById("msNoteInput-" + jobId);
  var noteBody = ta ? ta.value : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving feedback...";
  }
  var saved = await addMsNote(jobId, noteBody);
  if (!saved) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save feedback + Revise Pack";
    }
    return;
  }
  if (btn) btn.textContent = "Requesting Revise Pack...";
  var selectedPhotoUrls = _msSelectedPhotoUrlsForFeedback(jobId);
  var rerunResult = await triggerMsRerun(jobId, { selectedPhotoUrls: selectedPhotoUrls });
  if (!rerunResult || rerunResult.skipped) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save feedback + Revise Pack";
    }
  }
}

// ────────────────────────────────────────────────────────────
// 3. REVISE PACK - ask the draft producer to refresh from feedback
// ────────────────────────────────────────────────────────────

function _msSelectedPhotoUrlsForFeedback(jobId) {
  try {
    if (
      typeof _msReportingCache === "undefined" ||
      typeof _msGetAllPhotos !== "function" ||
      typeof _msPhotoApprovalState === "undefined"
    ) return [];
    var d = _msReportingCache[jobId];
    if (!d) return [];
    var allPhotos = _msGetAllPhotos(d) || [];
    var state = (typeof _msGetPhotoApprovalState === "function")
      ? _msGetPhotoApprovalState(jobId, allPhotos)
      : (_msPhotoApprovalState[jobId] || { approved: {} });
    return allPhotos.filter(function (p) {
      return p && p.url && !!state.approved[p.url];
    }).map(function (p) {
      return p.url;
    });
  } catch (_e) {
    return [];
  }
}

function _msNotifyRevisionInFlight(jobId) {
  if (typeof _msReportingHideJobFromActiveList === "function") {
    _msReportingHideJobFromActiveList(
      jobId,
      "Feedback saved. The pack is with the MakeSafe Agent for a revise pass and will return here when a fresh draft is ready.",
    );
  }
}


async function _msRefreshReportingAfterRevision(jobId) {
  if (typeof loadMakesafeReportingCockpit !== "function") return false;
  try {
    await loadMakesafeReportingCockpit();
    if (
      typeof _msReportingCache !== "undefined" &&
      _msReportingCache &&
      _msReportingCache[jobId] &&
      typeof showMsReportingDetail === "function"
    ) {
      if (typeof _msActiveDocTab !== "undefined") _msActiveDocTab[jobId] = 0;
      showMsReportingDetail(jobId);
      return true;
    }
  } catch (_e) {
    return false;
  }
  return false;
}

async function triggerMsRerun(jobId, opts) {
  opts = opts || {};
  var btn = document.getElementById("msRerunBtn-" + jobId);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Requesting Revise Pack...";
  }
  try {
    var selectedPhotoUrls = Object.prototype.hasOwnProperty.call(opts, "selectedPhotoUrls")
      ? (opts.selectedPhotoUrls || [])
      : _msSelectedPhotoUrlsForFeedback(jobId);
    var result = await opsPost("rerun_draft_report", {
      job_id: jobId,
      draft_kind: "makesafe_report",
      selected_photo_urls: selectedPhotoUrls,
    });
    if (result && result.skipped) {
      showToast(
        "Nothing to revise: no unaddressed feedback on this draft.",
        "info",
      );
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Revise Pack now";
      }
    } else {
      _msNotifyRevisionInFlight(jobId);
      var refreshed = await _msRefreshReportingAfterRevision(jobId);
      showToast(
        refreshed
          ? "Revised pack loaded with fresh PDFs."
          : ("Revise Pack requested from " +
            ((result && result.addressed_count) || 0) +
            " feedback note(s)."),
        "success",
      );
    }
    await loadMsNotes(jobId, "msNotesPanel-" + jobId);
    return result || true;
  } catch (e) {
    showToast("Revise Pack failed: " + (e.message || e), "error");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Revise Pack now";
    }
    if (typeof loadMakesafeReportingCockpit === "function") {
      loadMakesafeReportingCockpit();
    }
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// 4. RENDER - the panel + a single note
// ────────────────────────────────────────────────────────────

function renderMsNotesPanel(jobId, notes, opts) {
  opts = opts || {};
  notes = notes || [];
  var safeId = escapeAttr(jobId);

  var html =
    '<div style="background:#fff;border:1px solid var(--sw-border);border-radius:8px;overflow:hidden;">';

  html +=
    '<div style="padding:9px 12px;border-bottom:1px solid var(--sw-border);font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#48697A;">Revise Pack feedback</div>';

  html +=
    '<div style="padding:10px 12px 0;font-size:12px;color:var(--sw-text-sec);line-height:1.45;">Write it like chat: costing off, add/remove invoice line, take wording out of the report, hide a photo, or propose a rule update. Rule updates become audited suggestions, not silent permanent changes.</div>';

  html +=
    '<div style="padding:12px;display:flex;flex-direction:column;gap:8px;">';
  if (notes.length === 0) {
    html +=
      '<div style="font-size:12px;color:var(--sw-text-sec);">No feedback yet. If the pack checks out, ignore this section and use Approve &amp; send below.</div>';
  } else {
    notes.forEach(function (n) {
      html += renderMsNote(n);
    });
  }
  html += "</div>";

  if (opts.showRerunButton) {
    html += '<div style="padding:0 12px 12px;">';
    html += '<button id="msRerunBtn-' + safeId +
      '" onclick="triggerMsRerun(\'' + safeId + "')\" " +
      'style="width:100%;background:#F15A29;color:#fff;border:none;padding:9px 14px;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;">Revise Pack now</button>';
    html +=
      '<div style="font-size:11px;color:var(--sw-text-sec);margin-top:5px;">Draft-only: refreshes the review pack from saved feedback and the current selected photos. Does not send, authorise, charge, or close.</div>';
    html += "</div>";
  }

  html +=
    '<div style="padding:12px;border-top:1px solid #EEF2F5;background:#F7FAFB;">';
  html += '<textarea id="msNoteInput-' + safeId +
    '" placeholder="Example: costing is slightly off — add 1 extra labour hour to the invoice, remove the risky wording from the MakeSafe report, and hide the blurry hallway photo." ' +
    'style="width:100%;box-sizing:border-box;min-height:76px;resize:vertical;border:1px solid var(--sw-border);border-radius:6px;padding:8px;font-size:13px;font-family:inherit;color:var(--sw-dark);"></textarea>';
  html +=
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">';
  html += '<button id="msReviseBtn-' + safeId +
    '" onclick="addMsNoteAndRerun(\'' + safeId + "')\" " +
    'style="background:#F15A29;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;">Save feedback + Revise Pack</button>';
  html += '<button id="msAddNoteBtn-' + safeId +
    '" onclick="addMsNote(\'' + safeId + "')\" " +
    'style="background:#1F3A44;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Add note only</button>';
  html +=
    '<span style="font-size:11px;color:var(--sw-text-sec);">Or leave blank and approve/send if all boxes check out.</span>';
  html += "</div>";
  html += "</div>";

  html += "</div>";
  return html;
}

function renderMsNote(note) {
  note = note || {};
  var isAgent = note.role === "agent";
  var bg = isAgent ? "#E6F4F4" : "#F1F3F5";
  var border = isAgent ? "#0E7C7B" : "#CBD5DD";
  var author = note.author || (isAgent ? "MakeSafe agent" : "Unknown");
  var when = _msFmtNoteTime(note.created_at);
  var body = note.body == null ? "" : String(note.body);

  var html = '<div style="border:1px solid ' + border +
    ";border-left:3px solid " + border + ";background:" + bg +
    ';border-radius:6px;padding:8px 10px;">';
  html +=
    '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px;">';
  html +=
    '<span style="font-size:11px;font-weight:800;color:var(--sw-dark);">' +
    escapeHtml(author) +
    (isAgent
      ? ' <span style="font-weight:700;color:#0E7C7B;">(agent)</span>'
      : "") +
    "</span>";
  if (when) {
    html +=
      '<span style="font-size:10px;color:var(--sw-text-sec);white-space:nowrap;">' +
      escapeHtml(when) + "</span>";
  }
  html += "</div>";
  html +=
    '<div style="font-size:13px;color:var(--sw-dark);white-space:pre-wrap;word-break:break-word;">' +
    escapeHtml(body) + "</div>";
  html += "</div>";
  return html;
}

function _msFmtNoteTime(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString("en-AU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return d.toISOString();
  }
}

// Export for the node smoke test (no-op in the browser).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    loadMsNotes: typeof loadMsNotes !== "undefined" ? loadMsNotes : undefined,
  };
}
