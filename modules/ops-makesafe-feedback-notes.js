// ════════════════════════════════════════════════════════════
// MAKESAFE FEEDBACK NOTES - review feedback on the SES docket
//
// A self-contained notes panel that hangs off the reporting cockpit detail panel
// (ops-makesafe-reporting-cockpit.js: showMsReportingDetail). The reviewer can
// type natural-language feedback on the review pack: report wording, invoice
// lines, the fixed photo set, or proposed rule changes.
//
// SES MODE (the reporting cockpit now renders SES docket packs): saving feedback
// records it on the exact docket revision via record_ses_review_feedback
// (opsPostJwt — an identified-operator JWT action). The legacy Revise Pack loop
// (rerun_draft_report) is NOT wired to SES dockets, so its buttons are hidden in
// SES mode. The legacy thread read (list_draft_notes) still renders history.
//
// DRAFT-STAGE ONLY. Nothing here authorises an invoice, sends email, closes a
// job, or charges a builder; that stays behind the cockpit's APPROVE INVOICE /
// SEND IT controls.
//
// Globals consumed (all defined in ops.html / reporting cockpit):
//   opsFetch, opsPost, opsPostJwt, showToast, escapeHtml, escapeAttr
//   _msReportingCache, _msGetAllPhotos, _msSesPackCache (optional)
// ════════════════════════════════════════════════════════════

// Keyed by job_id -> notes array (last loaded thread).
var _msNotesCache = {};

// SES feedback has no read-back action (ses_review_feedback_events is
// append-only), so notes recorded this session are echoed here and merged into
// the rendered thread (marked as recorded on the docket). Keyed by job_id.
var _msSesEchoCache = {};

// The author label used for a human note added from the dashboard. The backend
// records operator_email too; this is the display name in the thread.
var _MS_NOTES_DEFAULT_AUTHOR = "Ops";

// Mirrors makesafe_draft_notes.ts AGENT_REPLY_PREFIX. Used only for display.
var _MS_AGENT_REPLY_PREFIX = "MAKESAFE_AGENT_REPLY |";

// ────────────────────────────────────────────────────────────
// 1. LOAD - read the thread for a job and render it into a container
// ────────────────────────────────────────────────────────────

/**
 * The SES feedback context for a job, from the reporting cockpit's pack cache.
 * Returns { sesMode, docket_revision_id } — sesMode is true whenever the SES
 * detail rendered for this job (even when the exact docket revision is no
 * longer in the Docs Ready queue, in which case feedback cannot be recorded).
 */
function _msSesFeedbackContext(jobId) {
  if (
    typeof _msSesPackCache !== "undefined" &&
    _msSesPackCache &&
    _msSesPackCache[jobId]
  ) {
    var ctx = _msSesPackCache[jobId];
    return { sesMode: true, docket_revision_id: ctx.docketRevisionId || null };
  }
  return { sesMode: false, docket_revision_id: null };
}

/**
 * Tell the host surface what this thread render actually contains, so a
 * collapsed Feedback fold can open itself for a non-empty thread or a failed
 * read. Optional: the hook only exists on the SES review pane.
 */
function _msNotesAnnounceThread(jobId, count, failed) {
  if (typeof _msSesOnFeedbackThreadRendered !== "function") return;
  try {
    _msSesOnFeedbackThreadRendered(jobId, { count: count, failed: !!failed });
  } catch (_e) {
    /* a presentation hook must never break the thread render */
  }
}

async function loadMsNotes(jobId, containerElId) {
  var el = document.getElementById(containerElId);
  if (el) {
    el.innerHTML =
      '<div style="padding:10px 0;font-size:12px;color:var(--sw-text-sec);">Loading feedback...</div>';
  }
  var ses = _msSesFeedbackContext(jobId);
  try {
    var data = await opsFetch("list_draft_notes", { job_id: jobId });
    var notes = (data && data.notes) || [];
    // SES mode: the legacy thread renders history; this session's docket-
    // recorded feedback is merged in (it has no read-back action).
    if (ses.sesMode && _msSesEchoCache[jobId]) {
      notes = notes.concat(_msSesEchoCache[jobId]);
    }
    _msNotesCache[jobId] = notes;
    if (el) {
      el.innerHTML = renderMsNotesPanel(jobId, notes, {
        showRerunButton: !ses.sesMode,
        sesMode: ses.sesMode,
      });
    }
    _msNotesAnnounceThread(jobId, notes.length, false);
    return notes;
  } catch (e) {
    if (el) {
      el.innerHTML =
        '<div style="padding:10px 0;font-size:12px;color:#E74C3C;">Feedback could not load yet: ' +
        escapeHtml(e.message || String(e)) +
        "</div>" +
        renderMsNotesPanel(jobId, [], {
          showRerunButton: !ses.sesMode,
          sesMode: ses.sesMode,
        });
    }
    _msNotesAnnounceThread(jobId, 0, true);
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

  var ses = _msSesFeedbackContext(jobId);
  var btn = document.getElementById("msAddNoteBtn-" + jobId);
  var btnLabel = ses.sesMode ? "Record feedback" : "Add note only";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }
  try {
    if (ses.sesMode) {
      // SES MODE: record the feedback on the exact docket revision via
      // record_ses_review_feedback (opsPostJwt — an identified-operator JWT
      // action; x-api-key callers are refused). The backend appends an
      // append-only ses_review_feedback_events row and INVALIDATES the pack's
      // readiness, so the reporting routine assembles a revised pack from it.
      if (!ses.docket_revision_id) {
        showToast(
          "This pack has already passed Docs Ready review, so feedback can no longer be recorded on it.",
          "error",
        );
        if (btn) {
          btn.disabled = false;
          btn.textContent = btnLabel;
        }
        return false;
      }
      var sesResult = await opsPostJwt("record_ses_review_feedback", {
        docket_revision_id: ses.docket_revision_id,
        job_id: jobId,
        change_type: "human_review_feedback",
        before: null,
        after: { note: noteBody, author: author },
      });
      if (ta) ta.value = "";
      showToast(
        "Feedback recorded on the SES docket. The pack's readiness is invalidated until the reporting routine assembles a revised pack.",
        "success",
      );
      // No read-back action exists for docket feedback: echo the saved note
      // into the session cache so the thread shows what was recorded.
      var echo = {
        role: "human",
        author: author,
        body: noteBody,
        created_at: new Date().toISOString(),
        ses_recorded: true,
      };
      _msSesEchoCache[jobId] = (_msSesEchoCache[jobId] || []).concat([echo]);
      await loadMsNotes(jobId, "msNotesPanel-" + jobId);
      // Readiness was invalidated server-side: reload the detail so the
      // cockpit controls reflect the fresh state (guarded — the cockpit
      // module owns the reload helper).
      if (typeof _msSesReloadDetail === "function") {
        _msSesReloadDetail(jobId);
      }
      return sesResult || true;
    }
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
      btn.textContent = btnLabel;
    }
    return false;
  }
}

async function addMsNoteAndRerun(jobId) {
  // SES MODE: the legacy Revise Pack loop (rerun_draft_report) is not wired to
  // SES dockets. Recording the feedback is the whole action — the readiness
  // invalidation it causes is what produces a revised pack.
  if (_msSesFeedbackContext(jobId).sesMode) {
    return addMsNote(jobId);
  }
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
    try {
      if (typeof loadMakesafeReportingCockpit === "function") {
        await loadMakesafeReportingCockpit();
      }
    } catch (_) {
      // Keep the explicit failure toast above and still refresh the notes panel.
    }
    await loadMsNotes(jobId, "msNotesPanel-" + jobId);
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
  var sesMode = opts.sesMode === true;
  // In SES mode the composer is offered only while the exact docket revision
  // is still in the Docs Ready queue (feedback binds to that revision).
  var sesCtx = sesMode ? _msSesFeedbackContext(jobId) : null;
  var sesCanRecord = sesMode && sesCtx && !!sesCtx.docket_revision_id;

  var html = '<div class="msr-fb">';

  html += '<div class="msr-fb-head">' +
    (sesMode ? "Review feedback" : "Revise Pack feedback") + "</div>";

  if (sesMode) {
    html +=
      '<div class="msr-fb-lede">Write it like chat: costing off, add/remove invoice line, take wording out of the report, a photo that should not go out, or a proposed rule update. Recorded feedback is appended to the exact docket revision and invalidates the pack&#8217;s readiness &mdash; the reporting routine assembles a revised pack from it.</div>';
  } else {
    html +=
      '<div class="msr-fb-lede">Write it like chat: costing off, add/remove invoice line, take wording out of the report, hide a photo, or propose a rule update. Rule updates become audited suggestions, not silent permanent changes.</div>';
  }

  html += '<div class="msr-fb-list">';
  if (notes.length === 0) {
    html +=
      '<div class="msr-fb-empty">No feedback yet. If the pack checks out, ignore this section and use ' +
      (sesMode ? "the cockpit controls below." : "Approve &amp; send below.") +
      "</div>";
  } else {
    notes.forEach(function (n) {
      html += renderMsNote(n);
    });
  }
  html += "</div>";

  if (opts.showRerunButton) {
    html += '<div style="padding:0 13px 13px;">';
    html += '<button type="button" id="msRerunBtn-' + safeId +
      '" onclick="triggerMsRerun(\'' + safeId + "')\" " +
      'class="msr-fb-btn brand" style="width:100%;">Revise Pack now</button>';
    html +=
      '<div class="msr-fb-hint" style="margin-top:5px;">Draft-only: refreshes the review pack from saved feedback and the current selected photos. Does not send, authorise, charge, or close.</div>';
    html += "</div>";
  }

  html += '<div class="msr-fb-foot">';
  if (sesMode && !sesCanRecord) {
    html +=
      '<div class="msr-fb-lede" style="padding:0;">This pack has already passed Docs Ready review, so feedback can no longer be recorded on it. The cockpit controls below are the current truth.</div>';
  } else {
    html += '<textarea id="msNoteInput-' + safeId +
      '" class="msr-fb-textarea" placeholder="Example: costing is slightly off — add 1 extra labour hour to the invoice, remove the risky wording from the MakeSafe report, and hide the blurry hallway photo."></textarea>';
    html += '<div class="msr-fb-row">';
    if (sesMode) {
      html += '<button type="button" id="msAddNoteBtn-' + safeId +
        '" onclick="addMsNote(\'' + safeId + "')\" " +
        'class="msr-fb-btn dark">Record feedback</button>';
      html +=
        '<span class="msr-fb-hint">Or leave blank and use the cockpit controls if all boxes check out.</span>';
    } else {
      html += '<button type="button" id="msReviseBtn-' + safeId +
        '" onclick="addMsNoteAndRerun(\'' + safeId + "')\" " +
        'class="msr-fb-btn brand">Save feedback + Revise Pack</button>';
      html += '<button type="button" id="msAddNoteBtn-' + safeId +
        '" onclick="addMsNote(\'' + safeId + "')\" " +
        'class="msr-fb-btn dark">Add note only</button>';
      html +=
        '<span class="msr-fb-hint">Or leave blank and approve/send if all boxes check out.</span>';
    }
    html += "</div>";
  }
  html += "</div>";

  html += "</div>";
  return html;
}

function renderMsNote(note) {
  note = note || {};
  var isAgent = note.role === "agent";
  var author = note.author || (isAgent ? "MakeSafe agent" : "Unknown");
  var when = _msFmtNoteTime(note.created_at);
  var body = note.body == null ? "" : String(note.body);

  var html = '<div class="msr-fb-note' + (isAgent ? " agent" : "") + '">';
  html += '<div class="msr-fb-note-top">';
  html +=
    '<span class="msr-fb-author">' +
    escapeHtml(author) +
    (isAgent ? ' <span class="tag">(agent)</span>' : "") +
    (note.ses_recorded
      ? ' <span class="rec">(recorded on the SES docket)</span>'
      : "") +
    "</span>";
  if (when) {
    html += '<span class="msr-fb-time">' + escapeHtml(when) + "</span>";
  }
  html += "</div>";
  html += '<div class="msr-fb-body">' + escapeHtml(body) + "</div>";
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
