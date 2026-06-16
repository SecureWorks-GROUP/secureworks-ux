// ════════════════════════════════════════════════════════════
// COUNCIL & ENGINEERING APPROVALS — DESKTOP SPLIT-PANE
// Layout: #approvalsListPanel (340px) | #approvalsDetailPanel (flex:1)
// No full-screen overlays. Everything renders inline.
// ════════════════════════════════════════════════════════════

var _councilSubmissions = [];
var _councilFilter = null;        // null = all, 'active'|'blocked'|'complete'
var _councilDetailSubId = null;   // currently selected submission ID
var _councilActivePartyFilter = null; // email address filter for conversation
var _councilActiveStepFilter = -1;    // step index filter (-1 = all)

// ────────────────────────────────────────────────────────────
// 1. DATA LOADING
// ────────────────────────────────────────────────────────────

/**
 * Fetch all council submissions and render the list panel.
 * Entry point called when the Approvals tab activates.
 */
async function loadApprovals() {
  try {
    var resp = await opsFetch('list_council_submissions');
    _councilSubmissions = (resp.submissions || []).map(function(sub) {
      // Normalize joined job data to top level
      if (sub.jobs) {
        sub.client_name = sub.client_name || sub.jobs.client_name;
        sub.job_number = sub.job_number || sub.jobs.job_number;
        sub.suburb = sub.suburb || sub.jobs.suburb;
        sub.type = sub.type || sub.jobs.type;
      }
      return sub;
    });
    renderListPanel();

    // If we had a detail open, refresh it too
    if (_councilDetailSubId) {
      var still = _councilSubmissions.find(function(s) { return s.id === _councilDetailSubId; });
      if (still) selectApproval(_councilDetailSubId);
    }

    // Load intake count for badge
    if (typeof loadMakesafeIntakeCockpit === 'function') {
      loadMakesafeIntakeCockpit().then(function(count) {
        if (typeof refreshMsIntakeBadge === 'function') refreshMsIntakeBadge(count || 0);
      }).catch(function() {});
    }
  } catch (e) {
    if (typeof refreshMsIntakeBadge === 'function') refreshMsIntakeBadge(0);
    console.error('loadApprovals error:', e);
    var lp = document.getElementById('approvalsListPanel');
    if (lp) lp.innerHTML = '<div style="text-align:center;padding:40px;color:#8FA4B2;">Failed to load council submissions.</div>';
  }
}

// ────────────────────────────────────────────────────────────
// HELPERS (kept from previous version)
// ────────────────────────────────────────────────────────────

/**
 * Compute urgency tier + scoring for a submission.
 * Returns { tier, score, daysInStep, unreadCount }
 */
function computeUrgency(sub) {
  var steps = sub.steps || [];
  var currentStep = steps[sub.current_step_index] || steps[0];
  var emails = sub.email_threads || [];

  var daysInStep = 0;
  if (currentStep && currentStep.started_at && sub.overall_status !== 'complete') {
    daysInStep = Math.floor((Date.now() - new Date(currentStep.started_at).getTime()) / 86400000);
  }

  var unreadCount = emails.filter(function(em) {
    return (em.direction === 'inbound' || em.direction === 'received') && !em.read_at;
  }).length;

  var tier, score;
  if (sub.overall_status === 'complete') {
    tier = 'complete'; score = 0;
  } else if (sub.overall_status === 'blocked' || (currentStep && currentStep.status === 'blocked')) {
    tier = 'blocked'; score = 500 + daysInStep;
  } else if (unreadCount > 0) {
    tier = 'unread'; score = 400 + unreadCount;
  } else if (daysInStep > 7) {
    tier = 'stalled'; score = 300 + daysInStep;
  } else {
    tier = 'active'; score = 200 - daysInStep;
  }

  return { tier: tier, score: score, daysInStep: daysInStep, unreadCount: unreadCount };
}

/**
 * SVG circular progress ring for list cards.
 */
function renderProgressRingSVG(completed, total, status) {
  var size = 36;
  var sw = 3;
  var r = (size - sw) / 2;
  var circ = 2 * Math.PI * r;
  var progress = total > 0 ? completed / total : 0;
  var offset = circ * (1 - progress);

  var color = status === 'complete' ? '#27AE60' :
              status === 'blocked' ? '#E74C3C' :
              progress > 0 ? '#F15A29' : '#CCC';

  var pct = total > 0 ? Math.round(progress * 100) : 0;

  return '<div style="width:36px;height:36px;flex-shrink:0;position:relative;">' +
    '<svg width="36" height="36" style="transform:rotate(-90deg);">' +
      '<circle cx="18" cy="18" r="' + r + '" stroke="#EDF1F4" stroke-width="' + sw + '" fill="none"/>' +
      '<circle cx="18" cy="18" r="' + r + '" stroke="' + color + '" stroke-width="' + sw + '" fill="none" ' +
        'stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="round"/>' +
    '</svg>' +
    '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#293C46;">' + pct + '%</div>' +
  '</div>';
}

/**
 * Relative time string: "now", "2m", "3h", "5d", etc.
 */
function councilRelativeTime(dateStr) {
  if (!dateStr) return '';
  var diffMs = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  var days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd';
  var weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks + 'w';
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/**
 * Get emails filtered to a specific step index.
 */
function getStepEmails(sub, stepIdx) {
  var emails = sub.email_threads || [];
  var step = (sub.steps || [])[stepIdx];
  return emails.filter(function(em) {
    if (em.council_step_index === stepIdx) return true;
    if (em.council_step_index == null && step && em.subject && em.subject.indexOf(step.name) >= 0) return true;
    return false;
  });
}

/**
 * Format a date for date separators in conversation.
 */
function councilFormatDate(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return 'Today';
  var yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Format timestamp for message bubbles.
 */
function councilFormatTime(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (msgDay.getTime() === today.getTime()) return 'Today, ' + time;
  var dayStr = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  return dayStr + ', ' + time;
}

// ────────────────────────────────────────────────────────────
// 2. LIST PANEL
// ────────────────────────────────────────────────────────────

/**
 * Render the left list panel: header, summary pills, card list.
 * Targets #approvalsListPanel.
 */
function renderListPanel() {
  var panel = document.getElementById('approvalsListPanel');
  if (!panel) return;

  // Count submissions by category
  var counts = { active: 0, blocked: 0, complete: 0 };
  _councilSubmissions.forEach(function(sub) {
    if (sub.overall_status === 'complete') counts.complete++;
    else if (sub.overall_status === 'blocked') counts.blocked++;
    else counts.active++; // not_started + in_progress both count as active
  });

  // ── Header ──
  var html = '<div style="padding:16px 16px 12px;border-bottom:1px solid #D4DEE4;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
  html += '<span style="font-size:16px;font-weight:700;color:#293C46;">Approvals</span>';
  html += '<button onclick="openCouncilStartModalFromApprovals()" style="padding:5px 14px;background:#F15A29;color:#fff;border:none;font-size:11px;font-weight:600;cursor:pointer;">+ New</button>';
  html += '</div>';

  // ── Summary pills ──
  html += '<div style="display:flex;gap:6px;">';
  var pills = [
    { key: 'active', label: 'Active', count: counts.active },
    { key: 'blocked', label: 'Blocked', count: counts.blocked },
    { key: 'complete', label: 'Done', count: counts.complete }
  ];
  pills.forEach(function(p) {
    var isActive = _councilFilter === p.key;
    var bg = isActive ? '#293C46' : '#fff';
    var fg = isActive ? '#fff' : '#293C46';
    var border = isActive ? '#293C46' : '#D4DEE4';
    html += '<div onclick="toggleCouncilFilter(\'' + p.key + '\')" style="flex:1;text-align:center;padding:6px 4px;border:1px solid ' + border + ';background:' + bg + ';color:' + fg + ';cursor:pointer;transition:all 0.15s;">';
    html += '<div style="font-size:16px;font-weight:700;">' + p.count + '</div>';
    html += '<div style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.7;">' + p.label + '</div>';
    html += '</div>';
  });
  html += '</div>';
  html += '</div>'; // end header

  // ── Card list ──
  html += '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;">';

  // Sort by urgency
  var sorted = _councilSubmissions.slice().map(function(sub) {
    sub._urgency = computeUrgency(sub);
    return sub;
  });

  // Apply filter
  if (_councilFilter) {
    sorted = sorted.filter(function(sub) {
      if (_councilFilter === 'active') return sub.overall_status !== 'complete' && sub.overall_status !== 'blocked';
      return sub.overall_status === _councilFilter;
    });
  }

  sorted.sort(function(a, b) { return b._urgency.score - a._urgency.score; });

  if (sorted.length === 0) {
    html += '<div style="text-align:center;padding:40px;color:#8FA4B2;font-size:13px;">';
    html += _councilFilter ? 'No ' + _councilFilter + ' submissions.' : 'No council submissions yet.';
    html += '</div>';
  } else {
    sorted.forEach(function(sub) {
      var u = sub._urgency;
      var steps = sub.steps || [];
      var totalSteps = steps.length;
      var completedSteps = steps.filter(function(s) { return s.status === 'complete'; }).length;
      var currentStep = steps[sub.current_step_index] || steps[0];
      var currentStepName = currentStep ? currentStep.name : 'Unknown';
      var isSelected = sub.id === _councilDetailSubId;
      var emailCount = (sub.email_threads || []).length;

      // Card urgency border
      var urgencyClass = u.tier === 'blocked' || u.tier === 'stalled' ? 'urgency-stalled' : 'urgency-ok';
      if (sub.overall_status === 'complete') urgencyClass = '';

      // Left border color
      var leftBorder = isSelected ? '#F15A29' : 'transparent';
      var cardBg = isSelected ? '#FEF3EF' : 'transparent';

      html += '<div onclick="selectApproval(\'' + sub.id + '\')" data-sub-id="' + sub.id + '" style="' +
        'display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;' +
        'border-bottom:1px solid #EDF1F4;border-left:3px solid ' + leftBorder + ';' +
        'background:' + cardBg + ';transition:background 0.1s;" ' +
        'onmouseenter="if(this.getAttribute(\'data-sub-id\')!==\'' + (_councilDetailSubId || '') + '\')this.style.background=\'#F8F6F3\'" ' +
        'onmouseleave="if(this.getAttribute(\'data-sub-id\')!==\'' + (_councilDetailSubId || '') + '\')this.style.background=\'transparent\'">';

      // Progress ring
      html += renderProgressRingSVG(completedSteps, totalSteps, sub.overall_status);

      // Card info
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-size:13px;font-weight:600;color:#293C46;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        escapeHtml(sub.job_number || '') + ' — ' + escapeHtml(sub.client_name || '') + '</div>';
      html += '<div style="font-size:11px;color:#8FA4B2;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        'Step ' + (sub.current_step_index + 1) + '/' + totalSteps + ': ' + escapeHtml(currentStepName) + '</div>';
      html += '<div style="font-size:10px;color:#8FA4B2;margin-top:3px;display:flex;gap:8px;">';
      if (u.daysInStep > 0 && u.tier !== 'complete') {
        var badgeBg = u.daysInStep > 7 ? 'rgba(231,76,60,0.1)' : u.daysInStep > 3 ? 'rgba(241,90,41,0.1)' : 'rgba(149,165,166,0.15)';
        var badgeColor = u.daysInStep > 7 ? '#E74C3C' : u.daysInStep > 3 ? '#F15A29' : '#8FA4B2';
        html += '<span style="font-size:9px;padding:1px 6px;border-radius:100px;font-weight:600;background:' + badgeBg + ';color:' + badgeColor + ';">' + u.daysInStep + 'd</span>';
      }
      if (emailCount > 0) html += '<span>' + emailCount + ' email' + (emailCount !== 1 ? 's' : '') + '</span>';
      html += '</div>';
      html += '</div>';

      html += '</div>'; // end card
    });
  }

  html += '</div>'; // end list-items
  panel.innerHTML = html;
}

/**
 * Toggle filter by pill click.
 */
function toggleCouncilFilter(status) {
  _councilFilter = (_councilFilter === status) ? null : status;
  renderListPanel();
}

// ────────────────────────────────────────────────────────────
// 3. SELECT APPROVAL (detail panel)
// ────────────────────────────────────────────────────────────

/**
 * Called on card click. Highlights card in list, renders detail panel.
 */
function selectApproval(subId) {
  var sub = _councilSubmissions.find(function(s) { return s.id === subId; });
  if (!sub) return;

  _councilDetailSubId = subId;
  _councilActivePartyFilter = null;
  _councilActiveStepFilter = -1;

  // Re-render list to update highlight
  renderListPanel();

  // Render detail panel
  var panel = document.getElementById('approvalsDetailPanel');
  if (!panel) return;

  var steps = sub.steps || [];
  var totalSteps = steps.length;
  var completedSteps = steps.filter(function(s) { return s.status === 'complete'; }).length;

  var html = '';

  // ── Detail header ──
  html += '<div style="padding:14px 20px;background:#fff;border-bottom:1px solid #D4DEE4;display:flex;align-items:center;gap:16px;flex-shrink:0;">';
  html += '<div style="flex:1;">';
  html += '<div style="font-size:17px;font-weight:700;color:#293C46;">' + escapeHtml(sub.job_number || '') + ' — ' + escapeHtml(sub.client_name || '') + '</div>';
  html += '<div style="font-size:12px;color:#8FA4B2;margin-top:2px;">' +
    escapeHtml(sub.suburb || '') + (sub.type ? ' · ' + escapeHtml(sub.type) : '') +
    ' · ' + completedSteps + ' of ' + totalSteps + ' steps complete</div>';
  html += '</div>';
  if (sub.job_id) {
    html += '<button onclick="openJobQuickView(\'' + sub.job_id + '\')" style="font-size:11px;padding:5px 14px;border:1px solid #D4DEE4;background:#fff;color:#4C6A7C;cursor:pointer;font-weight:500;">View Job</button>';
  }
  html += '</div>';

  // ── Detail content: sidebar + conversation ──
  html += '<div style="flex:1;display:flex;overflow:hidden;">';
  html += renderDetailSidebar(sub);
  html += renderConversation(sub);
  html += '</div>';

  panel.innerHTML = html;

  // Inject pulse keyframes if not present
  if (!document.getElementById('councilPulseStyle')) {
    var style = document.createElement('style');
    style.id = 'councilPulseStyle';
    style.textContent = '@keyframes seg-pulse { 0%,100% { opacity:1; } 50% { opacity:0.55; } }';
    document.head.appendChild(style);
  }

  // Scroll conversation to bottom
  var msgContainer = document.getElementById('councilMessages');
  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
}

// ────────────────────────────────────────────────────────────
// 4. DETAIL SIDEBAR (progress + steps)
// ────────────────────────────────────────────────────────────

/**
 * Render the left sidebar of the detail panel (280px).
 * Contains: segmented progress bar, current step hero, advance button, step timeline.
 */
function renderDetailSidebar(sub) {
  var steps = sub.steps || [];
  var currentStep = steps[sub.current_step_index] || steps[0];
  var isComplete = sub.overall_status === 'complete';

  var html = '<div style="width:280px;flex-shrink:0;background:#fff;border-right:1px solid #EDF1F4;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;">';

  // ── Segmented progress bar ──
  html += '<div style="margin-bottom:16px;">';
  html += '<div style="display:flex;gap:2px;margin-bottom:8px;">';
  steps.forEach(function(step, idx) {
    var cls = '';
    if (step.status === 'complete') {
      html += '<div style="flex:1;height:4px;background:#27AE60;"></div>';
    } else if (idx === sub.current_step_index && !isComplete) {
      html += '<div style="flex:1;height:4px;background:#F15A29;animation:seg-pulse 2s ease-in-out infinite;"></div>';
    } else {
      html += '<div style="flex:1;height:4px;background:#EDF1F4;"></div>';
    }
  });
  html += '</div>';

  // ── Current step hero ──
  if (currentStep && !isComplete) {
    html += '<div style="font-size:9px;color:#F15A29;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Current Step</div>';
    html += '<div style="font-size:16px;font-weight:700;color:#293C46;margin-top:2px;">' + escapeHtml(currentStep.name) + '</div>';

    if (currentStep.vendor) {
      html += '<div style="font-size:11px;color:#8FA4B2;margin-top:3px;">' + escapeHtml(currentStep.vendor);
      if (currentStep.vendor_email) {
        html += ' — <span onclick="prefillComposeTo(\'' + escapeHtml(currentStep.vendor_email) + '\')" style="cursor:pointer;color:#F15A29;text-decoration:underline;">' + escapeHtml(currentStep.vendor_email) + '</span>';
      }
      html += '</div>';
    }

    if (currentStep.started_at) {
      var daysIn = Math.floor((Date.now() - new Date(currentStep.started_at).getTime()) / 86400000);
      if (daysIn > 0) {
        var daysColor = daysIn > 7 ? '#E74C3C' : daysIn > 3 ? '#D97706' : '#8FA4B2';
        html += '<div style="font-size:11px;margin-top:2px;color:' + daysColor + ';font-weight:' + (daysIn > 3 ? '600' : '400') + ';">' + daysIn + ' days in this step</div>';
      }
    }

    // Advance button
    html += '<button onclick="openCouncilAdvanceModal(\'' + sub.id + '\',' + sub.current_step_index + ')" style="margin-top:10px;padding:7px 16px;background:#27AE60;color:#fff;border:none;font-size:12px;font-weight:600;cursor:pointer;width:100%;">Complete &amp; Advance &#10003;</button>';
  } else if (isComplete) {
    html += '<div style="font-size:9px;color:#27AE60;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Complete</div>';
    html += '<div style="font-size:14px;font-weight:600;color:#293C46;margin-top:2px;">All steps done</div>';
  }

  html += '</div>'; // end progress section

  // ── Step timeline ──
  html += '<div style="font-size:10px;font-weight:700;color:#4C6A7C;text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 8px;padding-top:12px;border-top:1px solid #EDF1F4;">All Steps</div>';

  steps.forEach(function(step, idx) {
    var isDone = step.status === 'complete';
    var isActive = idx === sub.current_step_index && !isComplete;
    var isPending = !isDone && !isActive;

    // Step row
    html += '<div onclick="filterCouncilEmails(' + idx + ')" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;" onmouseenter="this.querySelector(\'.ss-name-el\').style.color=\'#F15A29\'" onmouseleave="this.querySelector(\'.ss-name-el\').style.color=\'' + (isDone ? '#8FA4B2' : isActive ? '#293C46' : '#293C46') + '\'">';

    // Dot
    if (isDone) {
      html += '<div style="width:18px;height:18px;border-radius:50%;background:#27AE60;color:#fff;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;flex-shrink:0;">&#10003;</div>';
    } else if (isActive) {
      html += '<div style="width:18px;height:18px;border-radius:50%;background:#F15A29;color:#fff;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;flex-shrink:0;">' + (idx + 1) + '</div>';
    } else {
      html += '<div style="width:18px;height:18px;border-radius:50%;border:1.5px solid #D4DEE4;color:#8FA4B2;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;flex-shrink:0;">' + (idx + 1) + '</div>';
    }

    // Name
    var nameStyle = 'font-size:12px;flex:1;';
    if (isDone) nameStyle += 'color:#8FA4B2;text-decoration:line-through;';
    else if (isActive) nameStyle += 'font-weight:700;color:#293C46;';
    else nameStyle += 'color:#293C46;';
    html += '<span class="ss-name-el" style="' + nameStyle + '">' + escapeHtml(step.name) + '</span>';

    // Badge
    if (isDone) {
      html += '<span style="font-size:9px;padding:1px 6px;border-radius:100px;font-weight:600;background:rgba(39,174,96,0.1);color:#27AE60;">Done</span>';
    } else if (isActive && step.started_at) {
      var stepDays = Math.floor((Date.now() - new Date(step.started_at).getTime()) / 86400000);
      if (stepDays > 0) {
        html += '<span style="font-size:9px;padding:1px 6px;border-radius:100px;font-weight:600;background:rgba(241,90,41,0.1);color:#F15A29;">' + stepDays + 'd</span>';
      }
    }

    html += '</div>'; // end step row

    // Vendor info line below step
    if (step.vendor) {
      html += '<div style="font-size:10px;color:#8FA4B2;margin-left:26px;margin-top:-2px;margin-bottom:4px;">' +
        escapeHtml(step.vendor);
      if (step.vendor_email) {
        html += ' — <span onclick="event.stopPropagation();prefillComposeTo(\'' + escapeHtml(step.vendor_email) + '\')" style="cursor:pointer;color:#F15A29;text-decoration:underline;">' + escapeHtml(step.vendor_email) + '</span>';
      }
      html += '</div>';
    }

    // Actions for pending steps: set vendor / skip
    if (isPending && !isDone) {
      html += '<div style="margin-left:26px;margin-bottom:4px;" id="councilVendorSet_' + idx + '">';
      if (!step.vendor) {
        html += '<button onclick="event.stopPropagation();toggleCouncilVendorEditor(\'' + sub.id + '\',' + idx + ')" style="font-size:10px;color:#F15A29;cursor:pointer;background:none;border:none;text-decoration:underline;">+ Set vendor</button>';
      }
      if (idx > sub.current_step_index) {
        html += '<button onclick="event.stopPropagation();skipCouncilStep(\'' + sub.id + '\',' + idx + ',\'' + escapeHtml(step.name).replace(/'/g, "\\'") + '\')" style="font-size:10px;color:#8FA4B2;cursor:pointer;background:none;border:none;text-decoration:underline;margin-left:6px;">Skip</button>';
      }
      html += '</div>';
    }
  });

  html += '</div>'; // end sidebar
  return html;
}

// ────────────────────────────────────────────────────────────
// 5. CONVERSATION PANEL
// ────────────────────────────────────────────────────────────

/**
 * Render the conversation area: filter chips, message bubbles, compose bar.
 * Returns HTML string for the right side of detail content.
 */
function renderConversation(sub) {
  var allEmails = (sub.email_threads || []).slice().sort(function(a, b) {
    return new Date(a.created_at || a.sent_at || 0) - new Date(b.created_at || b.sent_at || 0);
  });

  // Build party list from email addresses
  var parties = {};
  allEmails.forEach(function(em) {
    var addr = em.direction === 'inbound' || em.direction === 'received' ? em.from_email : em.to_email;
    if (addr && addr.indexOf('secureworks') === -1 && addr.indexOf('orders+') === -1) {
      var domain = addr.split('@')[1] || '';
      var label = domain.split('.')[0] || addr;
      // Match to vendor name if possible
      (sub.steps || []).forEach(function(s) {
        if (s.vendor_email === addr && s.vendor) label = s.vendor;
      });
      if (!parties[addr]) parties[addr] = { label: label, addr: addr };
    }
  });
  var partyList = Object.values(parties);

  var html = '<div style="flex:1;display:flex;flex-direction:column;min-width:0;">';

  // ── Filter chips ──
  html += '<div style="display:flex;gap:6px;padding:10px 20px;background:#FCFBFA;border-bottom:1px solid #EDF1F4;flex-shrink:0;flex-wrap:wrap;">';
  html += '<button onclick="filterCouncilEmails(-1)" class="council-filter-chip" data-filter="all" style="padding:4px 14px;border-radius:100px;border:1px solid #293C46;background:#293C46;color:#fff;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;">All (' + allEmails.length + ')</button>';
  partyList.forEach(function(p) {
    var count = allEmails.filter(function(em) { return em.from_email === p.addr || em.to_email === p.addr; }).length;
    html += '<button onclick="filterCouncilEmails(-1,\'' + escapeHtml(p.addr) + '\')" class="council-filter-chip" data-filter="' + escapeHtml(p.addr) + '" style="padding:4px 14px;border-radius:100px;border:1px solid #D4DEE4;background:#fff;color:#293C46;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;">' + escapeHtml(p.label) + ' (' + count + ')</button>';
  });
  html += '</div>';

  // ── Messages ──
  html += '<div id="councilMessages" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:20px;display:flex;flex-direction:column;gap:12px;">';

  if (allEmails.length === 0) {
    html += '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;color:#8FA4B2;text-align:center;padding:40px;">';
    html += '<div style="font-size:36px;margin-bottom:12px;opacity:0.4;">&#9993;</div>';
    html += '<div style="font-size:13px;">No emails yet. Send the first message below.</div>';
    html += '</div>';
  } else {
    var lastDateStr = '';
    allEmails.forEach(function(em) {
      var ts = em.created_at || em.sent_at || em.received_at;
      var isInbound = em.direction === 'inbound' || em.direction === 'received';
      var filterAddr = isInbound ? (em.from_email || '') : (em.to_email || '');
      var stepIdx = em.council_step_index != null ? em.council_step_index : -1;
      var stepName = stepIdx >= 0 && sub.steps[stepIdx] ? sub.steps[stepIdx].name : '';

      // Date separator
      var dateLabel = councilFormatDate(ts);
      if (dateLabel && dateLabel !== lastDateStr) {
        html += '<div style="text-align:center;font-size:10px;color:#8FA4B2;padding:8px 0;letter-spacing:0.3px;">' + dateLabel + '</div>';
        lastDateStr = dateLabel;
      }

      // Message container
      var align = isInbound ? 'flex-start' : 'flex-end';
      html += '<div class="council-msg-item" data-addr="' + escapeHtml(filterAddr) + '" data-step="' + stepIdx + '" style="display:flex;flex-direction:column;max-width:65%;' +
        'align-self:' + align + ';align-items:' + align + ';">';

      // Step badge
      if (stepName) {
        html += '<div style="font-size:9px;padding:2px 8px;border-radius:6px;background:rgba(41,60,70,0.05);color:#4C6A7C;font-weight:500;margin-bottom:3px;">' + escapeHtml(stepName) + '</div>';
      }

      // From/To/CC info
      if (isInbound) {
        html += '<div style="font-size:10px;color:#8FA4B2;margin-bottom:2px;padding:0 6px;">From: ' + escapeHtml(em.from_email || '') + '</div>';
      } else {
        var toInfo = 'To: ' + escapeHtml(em.to_email || '');
        var ccEmails = em.cc_emails || [];
        if (Array.isArray(ccEmails) && ccEmails.length > 0) {
          toInfo += ' · CC: ' + ccEmails.map(function(c) { return escapeHtml(c); }).join(', ');
        }
        html += '<div style="font-size:10px;color:#8FA4B2;margin-bottom:2px;padding:0 6px;">' + toInfo + '</div>';
      }

      // Bubble
      var bubbleBg = isInbound ? '#F0ECE8' : '#FEF3EF';
      var bubbleRadius = isInbound ? '14px 14px 14px 3px' : '14px 14px 3px 14px';
      html += '<div style="background:' + bubbleBg + ';border-radius:' + bubbleRadius + ';padding:10px 14px;font-size:13px;line-height:1.5;word-wrap:break-word;">';

      if (em.subject) {
        html += '<div style="font-size:11px;font-weight:700;color:#293C46;margin-bottom:3px;opacity:0.7;">' + escapeHtml(em.subject) + '</div>';
      }

      var bodyText = em.body_text || '';
      html += '<div style="white-space:pre-wrap;word-break:break-word;">' + escapeHtml(bodyText) + '</div>';

      // Attachments
      var atts = em.attachments_json || em.attachments || [];
      if (Array.isArray(atts) && atts.length > 0) {
        atts.forEach(function(att) {
          var name = att.filename || att.name || 'Document';
          var url = att.storage_url || att.url || '#';
          html += '<a href="' + escapeHtml(url) + '" target="_blank" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;margin-top:8px;background:rgba(255,255,255,0.6);border:1px solid #D4DEE4;border-radius:6px;font-size:11px;font-weight:600;color:#293C46;text-decoration:none;">&#128206; ' + escapeHtml(name) + '</a>';
        });
      }

      html += '</div>'; // end bubble

      // Timestamp
      var senderLabel = isInbound ? escapeHtml(em.from_email || '') : 'You';
      var timeLabel = councilFormatTime(ts);
      var statusLabel = '';
      if (!isInbound) {
        if (em.read_at) statusLabel = ' · Read';
        else if (em.sent_at) statusLabel = ' · Sent';
        else statusLabel = ' · Delivered &#10003;';
      }
      html += '<div style="font-size:10px;color:#8FA4B2;margin-top:3px;padding:0 6px;">' + senderLabel + ' · ' + timeLabel + statusLabel + '</div>';

      html += '</div>'; // end msg
    });
  }

  html += '</div>'; // end messages

  // ── Compose bar ──
  html += renderComposeBar(sub);

  html += '</div>'; // end convo column
  return html;
}

// ────────────────────────────────────────────────────────────
// 6. COMPOSE BAR
// ────────────────────────────────────────────────────────────

/**
 * Render the sticky compose bar at the bottom of the conversation.
 * Auto-fills To from last inbound sender or current step vendor.
 * Auto-fills CC from admin + last inbound CC parties.
 */
function renderComposeBar(sub) {
  var allEmails = (sub.email_threads || []).slice().sort(function(a, b) {
    return new Date(a.created_at || a.sent_at || 0) - new Date(b.created_at || b.sent_at || 0);
  });

  // Find last inbound for auto-fill
  var lastInbound = null;
  for (var i = allEmails.length - 1; i >= 0; i--) {
    if (allEmails[i].direction === 'inbound' || allEmails[i].direction === 'received') {
      lastInbound = allEmails[i];
      break;
    }
  }

  // Default To: last inbound sender, or current step vendor email
  var currentStep = (sub.steps || [])[sub.current_step_index];
  var defaultTo = '';
  if (lastInbound && lastInbound.from_email) {
    defaultTo = lastInbound.from_email;
  } else if (currentStep && currentStep.vendor_email) {
    defaultTo = currentStep.vendor_email;
  }

  // Default CC: admin@ + any CC'd parties from last inbound
  var ccParts = ['admin@secureworkswa.com.au'];
  if (lastInbound && Array.isArray(lastInbound.cc_emails)) {
    lastInbound.cc_emails.forEach(function(cc) {
      if (ccParts.indexOf(cc) === -1) ccParts.push(cc);
    });
  }
  var defaultCc = ccParts.join(', ');

  var html = '<div style="background:#fff;border-top:1px solid #D4DEE4;padding:10px 20px 12px;flex-shrink:0;">';

  // To / CC fields (inline labeled)
  html += '<div style="display:flex;gap:12px;margin-bottom:8px;">';
  html += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;flex:1;">';
  html += '<label style="font-weight:600;color:#4C6A7C;flex-shrink:0;">To:</label>';
  html += '<input type="text" id="councilDetailTo" value="' + escapeHtml(defaultTo) + '" style="flex:1;border:none;outline:none;font-size:12px;color:#293C46;padding:4px 0;border-bottom:1px solid #EDF1F4;min-width:0;font-family:inherit;" onfocus="this.style.borderBottomColor=\'#F15A29\'" onblur="this.style.borderBottomColor=\'#EDF1F4\'">';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;flex:1;">';
  html += '<label style="font-weight:600;color:#4C6A7C;flex-shrink:0;">CC:</label>';
  html += '<input type="text" id="councilDetailCc" value="' + escapeHtml(defaultCc) + '" style="flex:1;border:none;outline:none;font-size:12px;color:#293C46;padding:4px 0;border-bottom:1px solid #EDF1F4;min-width:0;font-family:inherit;" onfocus="this.style.borderBottomColor=\'#F15A29\'" onblur="this.style.borderBottomColor=\'#EDF1F4\'">';
  html += '</div>';
  html += '</div>';

  // Message row: textarea + send button
  html += '<div style="display:flex;align-items:flex-end;gap:10px;">';
  html += '<textarea id="councilDetailMsg" placeholder="Type a message..." rows="1" style="flex:1;padding:9px 16px;border:1px solid #D4DEE4;border-radius:20px;font-size:13px;font-family:inherit;resize:none;outline:none;max-height:120px;line-height:1.4;" oninput="this.style.height=\'auto\';this.style.height=Math.min(this.scrollHeight,120)+\'px\'" onfocus="this.style.borderColor=\'#F15A29\'" onblur="this.style.borderColor=\'#D4DEE4\'"></textarea>';
  html += '<button onclick="sendCouncilDetailMessage(\'' + sub.id + '\')" style="width:36px;height:36px;border-radius:50%;background:#F15A29;border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform 0.1s;" onmousedown="this.style.transform=\'scale(0.9)\'" onmouseup="this.style.transform=\'\'">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg></button>';
  html += '</div>';

  // Extras
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">';
  html += '<a style="font-size:10px;color:#8FA4B2;text-decoration:underline;cursor:pointer;">Attach files</a>';
  html += '<a onclick="openCouncilEmailCompose(\'' + sub.id + '\',' + sub.current_step_index + ')" style="font-size:10px;color:#8FA4B2;text-decoration:underline;cursor:pointer;">Open full compose</a>';
  html += '</div>';

  html += '</div>'; // end compose-bar
  return html;
}

// ────────────────────────────────────────────────────────────
// 7. SEND MESSAGE
// ────────────────────────────────────────────────────────────

/**
 * Send email from the compose bar in detail view.
 * After sending: refresh conversation, clear input, scroll to bottom.
 */
async function sendCouncilDetailMessage(subId) {
  var toEl = document.getElementById('councilDetailTo');
  var ccEl = document.getElementById('councilDetailCc');
  var msgEl = document.getElementById('councilDetailMsg');

  if (!msgEl || !toEl) return;
  var body = msgEl.value.trim();
  var toEmail = toEl.value.trim();

  if (!toEmail) { showToast('Enter recipient email', 'warning'); return; }
  if (!toEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { showToast('Invalid email', 'warning'); return; }
  if (!body) { showToast('Type a message first', 'warning'); return; }

  var ccList = ccEl ? ccEl.value.split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/); }) : [];

  var sub = _councilSubmissions.find(function(s) { return s.id === subId; });
  if (!sub) return;

  var stepIdx = sub.current_step_index || 0;

  // Check for existing thread
  var allEmails = (sub.email_threads || []).sort(function(a, b) {
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
  var lastEmail = allEmails.length > 0 ? allEmails[allEmails.length - 1] : null;
  var inReplyTo = lastEmail ? (lastEmail.message_id || '') : '';
  var subject = (allEmails.length > 0 ? 'Re: ' : '') + (sub.job_number || '') + ' — Council Approval — SecureWorks Group';

  // Clear input immediately
  msgEl.value = '';
  msgEl.style.height = 'auto';

  try {
    var payload = {
      submission_id: subId,
      step_index: stepIdx,
      to_email: toEmail,
      subject: subject,
      body_text: body,
    };
    if (inReplyTo) payload.in_reply_to = inReplyTo;
    if (ccList.length > 0) payload.cc = ccList;

    await opsPost('send_council_email', payload);
    showToast('Email sent to ' + toEmail, 'success');

    // Auto-save vendor email if step doesn't have one
    var step = (sub.steps || [])[stepIdx];
    if (step && !step.vendor_email) {
      try {
        await opsPost('update_council_status', { submission_id: subId, step_index: stepIdx, vendor_email: toEmail });
      } catch (e2) { /* non-critical */ }
    }

    // Refresh everything
    await loadApprovals();
    // loadApprovals will call selectApproval if _councilDetailSubId is set

    // Scroll conversation to bottom
    var msgContainer = document.getElementById('councilMessages');
    if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
  } catch (e) {
    showToast('Failed to send: ' + e.message, 'warning');
  }
}

// ────────────────────────────────────────────────────────────
// 8. FILTER EMAILS (data-attribute toggle, no re-render)
// ────────────────────────────────────────────────────────────

/**
 * Show/hide messages by step index or party email address.
 * Uses data-addr and data-step attributes on .council-msg-item elements.
 * @param {number} stepIdx - step index to filter by, or -1 for all
 * @param {string} [partyAddr] - email address to filter by
 */
function filterCouncilEmails(stepIdx, partyAddr) {
  var msgs = document.querySelectorAll('.council-msg-item');
  var chips = document.querySelectorAll('.council-filter-chip');

  _councilActiveStepFilter = stepIdx;
  _councilActivePartyFilter = partyAddr || null;

  // Update chip active states
  chips.forEach(function(chip) {
    var filterVal = chip.getAttribute('data-filter');
    var isMatch = false;
    if (partyAddr) {
      isMatch = filterVal === partyAddr;
    } else if (stepIdx === -1) {
      isMatch = filterVal === 'all';
    }
    chip.style.background = isMatch ? '#293C46' : '#fff';
    chip.style.color = isMatch ? '#fff' : '#293C46';
    chip.style.borderColor = isMatch ? '#293C46' : '#D4DEE4';
  });

  // Show/hide messages
  msgs.forEach(function(msg) {
    var show = true;
    if (partyAddr) {
      show = msg.getAttribute('data-addr') === partyAddr;
    } else if (stepIdx >= 0) {
      show = msg.getAttribute('data-step') === String(stepIdx);
    }
    msg.style.display = show ? '' : 'none';
  });

  // Also show/hide date separators intelligently
  var dateSeps = document.querySelectorAll('#councilMessages > div[style*="text-align:center"]');
  dateSeps.forEach(function(sep) {
    // Show separator if any visible message follows it (before next separator)
    var next = sep.nextElementSibling;
    var anyVisible = false;
    while (next && !next.style.textAlign) {
      if (next.classList && next.classList.contains('council-msg-item') && next.style.display !== 'none') {
        anyVisible = true;
        break;
      }
      next = next.nextElementSibling;
    }
    sep.style.display = (stepIdx === -1 && !partyAddr) ? '' : (anyVisible ? '' : 'none');
  });
}

// ────────────────────────────────────────────────────────────
// 9. PREFILL COMPOSE TO
// ────────────────────────────────────────────────────────────

/**
 * Called when clicking a vendor email in the sidebar.
 * Pre-fills the To field and scrolls compose bar into view.
 */
function prefillComposeTo(email) {
  var toEl = document.getElementById('councilDetailTo');
  if (toEl) {
    toEl.value = email;
    toEl.focus();
  }
  // Scroll compose bar into view
  var composeBar = toEl ? toEl.closest('div[style*="border-top"]') : null;
  if (composeBar) {
    composeBar.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}

// ────────────────────────────────────────────────────────────
// KEPT FUNCTIONS (from previous version)
// ────────────────────────────────────────────────────────────

/**
 * Toggle inline vendor editor on a step in the sidebar.
 */
function toggleCouncilVendorEditor(subId, stepIdx) {
  var el = document.getElementById('councilVendorSet_' + stepIdx);
  if (!el) return;
  var sub = _councilSubmissions.find(function(s) { return s.id === subId; });
  var step = sub && sub.steps ? sub.steps[stepIdx] : null;

  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">' +
    '<input type="text" id="councilVendorName_' + stepIdx + '" placeholder="Vendor name (e.g. PS Engineering)" value="' + escapeHtml((step && step.vendor) || '') + '" style="padding:6px 10px;border:1px solid #D4DEE4;border-radius:6px;font-size:11px;font-family:inherit;width:100%;box-sizing:border-box;">' +
    '<input type="email" id="councilVendorEmail_' + stepIdx + '" placeholder="Vendor email" value="' + escapeHtml((step && step.vendor_email) || '') + '" style="padding:6px 10px;border:1px solid #D4DEE4;border-radius:6px;font-size:11px;font-family:inherit;width:100%;box-sizing:border-box;">' +
    '<div style="display:flex;gap:6px;">' +
    '<button onclick="saveCouncilVendor(\'' + subId + '\',' + stepIdx + ')" style="padding:4px 12px;background:#F15A29;color:#fff;border:none;border-radius:4px;font-size:10px;cursor:pointer;">Save</button>' +
    '<button onclick="selectApproval(\'' + subId + '\')" style="padding:4px 12px;background:#D4DEE4;color:#293C46;border:none;border-radius:4px;font-size:10px;cursor:pointer;">Cancel</button>' +
    '</div></div>';
}

/**
 * Save vendor name + email for a step.
 */
async function saveCouncilVendor(subId, stepIdx) {
  var nameEl = document.getElementById('councilVendorName_' + stepIdx);
  var emailEl = document.getElementById('councilVendorEmail_' + stepIdx);
  var vendor = nameEl ? nameEl.value.trim() : '';
  var vendorEmail = emailEl ? emailEl.value.trim() : '';

  if (!vendor) { showToast('Enter vendor name', 'warning'); return; }

  try {
    await opsPost('update_council_status', {
      submission_id: subId,
      step_index: stepIdx,
      vendor: vendor,
      vendor_email: vendorEmail
    });
    showToast('Vendor saved: ' + vendor, 'success');
    await loadApprovals();
  } catch (e) {
    showToast('Failed to save vendor: ' + e.message, 'warning');
  }
}

/**
 * Skip a council step with confirmation.
 */
async function skipCouncilStep(subId, stepIdx, stepName) {
  if (!confirm('Skip "' + stepName + '"? This will mark it as complete and move to the next step.')) return;

  try {
    await opsPost('update_council_status', {
      submission_id: subId,
      step_index: stepIdx,
      status: 'complete',
      notes: 'Skipped'
    });
    showToast('Skipped: ' + stepName, 'success');
    await loadApprovals();
  } catch (e) {
    showToast('Failed to skip step: ' + e.message, 'warning');
  }
}

/**
 * Open the full email compose modal (repurposed PO compose).
 */
function openCouncilEmailCompose(submissionId, stepIndex) {
  var sub = _councilSubmissions.find(function(s) { return s.id === submissionId; });
  if (!sub) return;
  var idx = (stepIndex !== undefined) ? stepIndex : sub.current_step_index;
  var step = (sub.steps || [])[idx] || {};
  var toEmail = step.vendor_email || '';
  var subject = (sub.job_number || '') + ' — ' + (step.name || 'Council Application') + ' — SecureWorks Group';
  var body = 'Hi,\n\nRegarding the ' + (step.name || 'application') + ' for ' + (sub.job_number || '') + ' — ' + (sub.client_name || '') + '.\n\n\n\nThanks,\nSecureWorks Group';

  document.getElementById('poComposeTitle').textContent = 'Email — ' + (step.name || 'Council Step');
  document.getElementById('poComposeTo').value = toEmail;
  document.getElementById('poComposeSubject').value = subject;
  document.getElementById('poComposeBody').value = body;
  document.getElementById('poComposePoId').value = '';
  document.getElementById('poComposeJobId').value = sub.job_id || '';
  document.getElementById('poComposeAttachPDF').checked = false;
  document.getElementById('poComposeAttachPDF').parentElement.style.display = 'none';  // Hide PO-specific option
  document.getElementById('poComposeTemplate').value = 'custom';
  document.getElementById('poComposeFiles').value = '';
  document.getElementById('poComposeFileList').textContent = '';
  var ccEl = document.getElementById('poComposeCc');
  if (ccEl) ccEl.value = '';

  window._councilComposeContext = { submission_id: submissionId, step_index: idx };

  var formView = document.getElementById('poComposeFormView');
  var previewView = document.getElementById('poComposePreviewView');
  if (formView) formView.style.display = '';
  if (previewView) previewView.style.display = 'none';

  document.getElementById('poEmailComposeModal').classList.add('active');
}

/**
 * Open council start modal from the "+ New" button.
 * Builds a quick job picker from patio jobs without existing submissions.
 */
function openCouncilStartModalFromApprovals() {
  var existingJobIds = _councilSubmissions.map(function(s) { return s.job_id; });
  var patioJobs = (typeof _allJobs !== 'undefined' ? _allJobs : []).filter(function(j) {
    return j.type === 'patio' && existingJobIds.indexOf(j.id) < 0 && ['cancelled', 'lost'].indexOf(j.status) < 0;
  });

  if (patioJobs.length === 0) {
    alert('No patio jobs available for council process (all either have one started or are cancelled).');
    return;
  }

  var options = patioJobs.map(function(j) { return (j.job_number || '') + ' — ' + (j.client_name || '') + ' (' + (j.suburb || '') + ')'; });
  var choice = prompt('Select a patio job (enter number):\n\n' + options.map(function(o, i) { return (i + 1) + '. ' + o; }).join('\n'));
  if (!choice) return;
  var idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= patioJobs.length) { alert('Invalid selection.'); return; }

  openCouncilStartModal(patioJobs[idx].id);
}
