// ════════════════════════════════════════════════════════════
// CALENDAR TAB — Three-Layer Scheduling
// ════════════════════════════════════════════════════════════

// Calendar state
var _calRangeMode = localStorage.getItem('sw_cal_range') || '1w'; // '1w', '2w', 'month'
var _calDivFilter = localStorage.getItem('sw_cal_div') || 'all'; // 'all', 'patio', 'fencing'
var _calUnschedOpen = false;
var _calAvailability = {}; // { 'CrewName_date': { status, note } }
var _calReadiness = {};   // { jobId: { score, status, blockers, warnings, completeness } }
var _calPopupAssignment = null; // currently open popup data
var _calMonthView = 'swimlane'; // 'swimlane' or 'compact'

// TODO Phase 2: BOM Perth weather strip along top of calendar — temperature and rain probability per day
// TODO Phase 2: Estimated job duration auto-populated from scope_json based on job size

// ── Readiness labels — plain English (overrides backend keys) ──
var READINESS_LABELS = {
  'crew_assigned': { missing: 'No crew assigned', done: 'Crew assigned' },
  'pos_created': { missing: 'No purchase order for materials', done: 'Materials PO created' },
  'work_order': { missing: 'No work order yet', done: 'Work order created' },
  'materials_confirmed': { missing: 'Delivery not confirmed', done: 'Delivery confirmed' },
  'deposit_received': { missing: 'No deposit received', done: 'Deposit received' },
  'supplier_quote_doc': { missing: 'No supplier quote uploaded', done: 'Supplier quote uploaded' },
  'site_photos_doc': { missing: 'No site photos', done: 'Site photos uploaded' },
  'council_plans_doc': { missing: 'No council plans', done: 'Council plans uploaded' },
  'engineering_doc': { missing: 'No engineering cert', done: 'Engineering cert uploaded' },
  'asbestos_clearance': { missing: 'No asbestos clearance', done: 'Asbestos clearance done' },
};

// ── Type icons (inline SVG) ──
function calTypeIconSvg(divType) {
  var svgs = {
    patio: '<svg class="cal-type-icon" viewBox="0 0 12 10" style="color:var(--sw-orange);"><path d="M1 9V5L6 1l5 4v4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    fencing: '<svg class="cal-type-icon" viewBox="0 0 12 10" style="color:var(--sw-mid);"><path d="M1 2v7M4 1v8M7 1v8M10 2v7M0 4h12M0 7h12" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    decking: '<svg class="cal-type-icon" viewBox="0 0 12 10" style="color:#E67E22;"><path d="M0 2h12M0 5h12M0 8h12" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  };
  return svgs[divType] || svgs['patio'];
}

// ── Readiness display label (plain English) ──
function readinessDisplayLabel(key, met) {
  var entry = READINESS_LABELS[key];
  if (entry) return met ? entry.done : entry.missing;
  // Fallback: humanise the key
  var label = key.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  return met ? label : 'No ' + label.toLowerCase();
}

function setCalRange(mode) {
  _calRangeMode = mode;
  localStorage.setItem('sw_cal_range', mode);
  document.querySelectorAll('[id^="btnRange"]').forEach(function(b) { b.className = ''; });
  var btnId = mode === '1w' ? 'btnRange1w' : mode === '2w' ? 'btnRange2w' : 'btnRangeMonth';
  document.getElementById(btnId).className = 'active';
  loadCalendar();
}

function setCalDivision(div) {
  _calDivFilter = div;
  localStorage.setItem('sw_cal_div', div);
  document.querySelectorAll('.cal-div-pill').forEach(function(b) {
    b.classList.toggle('active', b.dataset.caldiv === div);
  });
  if (_calEvents) renderCalendar();
}

function toggleCalUnsched() {
  _calUnschedOpen = !_calUnschedOpen;
  var sidebar = document.getElementById('calUnschedSidebar');
  var wrap = document.getElementById('calSwimWrap');
  sidebar.classList.toggle('open', _calUnschedOpen);
  wrap.classList.toggle('with-sidebar', _calUnschedOpen);
}

async function loadCalendar() {
  var range = getCalRange();
  try {
    var fetches = [
      opsFetch('calendar', { from: range.from, to: range.to, include_financials: 'true' }),
      opsFetch('pipeline'),
      opsFetch('get_crew_availability', { from: range.from, to: range.to }),
    ];

    var results = await Promise.all(fetches);
    var data = results[0];
    _calEvents = (data.events || []).filter(function(ev) {
      // Filter out legacy GHL imports and completed-without-job-number ghosts
      if (ev.legacy === true) return false;
      if (ev.job_status === 'complete' && !ev.job_number) return false;
      return true;
    });
    _calDeliveries = data.deliveries || [];
    _calReadiness = data.readiness || {};

    // Extract unscheduled jobs (accepted/approvals/processing — jobs needing scheduling)
    if (results[1]) {
      var cols = results[1].columns || {};
      _unschedJobs = [].concat(cols.accepted || [], cols.approvals || [], cols.processing || []);
    }

    // Parse crew availability → keyed by "CrewName_date"
    _calAvailability = {};
    // ops-api returns { availability: [...] }, never a bare array, so the old
    // Array.isArray test never passed and availability never painted. Tolerate
    // a bare array too, so this survives a future shape change.
    var availRows = (results[2] && results[2].availability)
      || (Array.isArray(results[2]) ? results[2] : []);
    if (availRows.length) {
      // Build userId→name lookup from crew list
      var userIdToName = {};
      _crewList.forEach(function(u) { userIdToName[u.id] = u.name; });
      availRows.forEach(function(a) {
        var name = userIdToName[a.user_id];
        if (name) {
          _calAvailability[name + '_' + a.date] = { status: a.status, note: a.note || '' };
        }
      });
    }

    renderCalendar();
  } catch (e) {
    console.error('loadCalendar error:', e);
  }
}

function getCalRange() {
  var d = new Date(_calDate);
  var day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1); // Monday
  var from = d.toISOString().slice(0, 10);
  if (_calRangeMode === '2w') {
    d.setDate(d.getDate() + 13);
  } else if (_calRangeMode === 'month') {
    var y = _calDate.getFullYear(), m = _calDate.getMonth();
    from = new Date(y, m, 1).toISOString().slice(0, 10);
    d = new Date(y, m + 1, 0);
  } else {
    d.setDate(d.getDate() + 6);
  }
  return { from: from, to: d.toISOString().slice(0, 10) };
}

function getCalDays(range) {
  var dates = [];
  var d = new Date(range.from + 'T00:00:00');
  var end = new Date(range.to + 'T00:00:00');
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function calPrev() {
  if (_calRangeMode === 'month') {
    _calDate.setMonth(_calDate.getMonth() - 1);
  } else if (_calRangeMode === '2w') {
    _calDate.setDate(_calDate.getDate() - 14);
  } else {
    _calDate.setDate(_calDate.getDate() - 7);
  }
  loadCalendar();
}

function calNext() {
  if (_calRangeMode === 'month') {
    _calDate.setMonth(_calDate.getMonth() + 1);
  } else if (_calRangeMode === '2w') {
    _calDate.setDate(_calDate.getDate() + 14);
  } else {
    _calDate.setDate(_calDate.getDate() + 7);
  }
  loadCalendar();
}

function calToday() {
  _calDate = new Date();
  loadCalendar();
}

function renderCalendar() {
  var range = getCalRange();
  var titleEl = document.getElementById('calTitle');
  if (_calRangeMode === 'month') {
    titleEl.textContent = MONTHS[_calDate.getMonth()] + ' ' + _calDate.getFullYear();
  } else {
    titleEl.textContent = (_calRangeMode === '2w' ? '2 Weeks from ' : 'Week of ') + fmtDate(range.from);
  }
  var container = document.getElementById('calendarBody');
  // Show/hide month view toggle
  var toggleBtn = document.getElementById('btnMonthViewToggle');
  if (_calRangeMode === 'month') {
    toggleBtn.style.display = '';
    toggleBtn.textContent = _calMonthView === 'swimlane' ? 'Day View' : 'Crew View';
  } else {
    toggleBtn.style.display = 'none';
    _calMonthView = 'swimlane'; // reset when leaving month mode
  }
  // Render compact or swimlane
  if (_calRangeMode === 'month' && _calMonthView === 'compact') {
    renderCompactMonth(container, range);
  } else {
    renderSwimlaneView(container, range);
  }
  renderCalSummary(range);
  renderCalUnschedSidebar();
}

// ── Swimlane View (replaces crew/week/month — unified 3-layer calendar) ──
function renderSwimlaneView(container, range) {
  var todayStr = new Date().toISOString().slice(0, 10);
  var dates = getCalDays(range);
  var numDays = dates.length;

  // Group events by crew, handle multi-day
  var crewMap = {};
  _calEvents.forEach(function(ev) {
    var crew = cleanCrewName(ev.crew_name || ev.assigned_to) || 'Unassigned';
    if (!crewMap[crew]) crewMap[crew] = { division: guessDivision(ev), events: {} };
    var startDate = ev.scheduled_date;
    var endDate = ev.scheduled_end || ev.scheduled_date;
    dates.forEach(function(dateStr) {
      if (dateStr >= startDate && dateStr <= endDate) {
        if (!crewMap[crew].events[dateStr]) crewMap[crew].events[dateStr] = [];
        var pos = 'multi-single';
        if (startDate !== endDate) {
          if (dateStr === startDate) pos = 'multi-start';
          else if (dateStr === endDate) pos = 'multi-end';
          else pos = 'multi-mid';
        }
        crewMap[crew].events[dateStr].push({ ev: ev, pos: pos });
      }
    });
  });

  // Build name→userId lookup from crew list
  var crewIdByName = {};
  _crewList.forEach(function(u) { crewIdByName[u.name] = u.id; });

  // Merge in all known crew members (even those without assignments this period)
  _crewList.forEach(function(u) {
    if (!crewMap[u.name]) {
      crewMap[u.name] = { division: u.division || '', events: {}, userId: u.id };
    } else {
      crewMap[u.name].userId = u.id;
    }
  });

  // Also attach userId to any crew entries that match by cleaned name
  Object.keys(crewMap).forEach(function(name) {
    if (!crewMap[name].userId && crewIdByName[name]) {
      crewMap[name].userId = crewIdByName[name];
    }
  });

  // Sort crew by division, then alphabetically; Unassigned last
  var crewNames = Object.keys(crewMap).sort(function(a, b) {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    var da = crewMap[a].division || 'zzz', db = crewMap[b].division || 'zzz';
    if (da !== db) return da.localeCompare(db);
    return a.localeCompare(b);
  });

  // ── Filter crew rows: field roles always show, office roles only if assigned ──
  var FIELD_ROLES = ['installer', 'trade', 'subcontractor', 'lead_installer'];
  var OFFICE_ONLY_NAMES = ['Marnin', 'Nithin', 'Khairo']; // fallback for roles marked 'estimator'
  var assignedNames = new Set();
  _calEvents.forEach(function(ev) {
    var cn = cleanCrewName(ev.crew_name || ev.assigned_to);
    if (cn) assignedNames.add(cn);
  });
  crewNames = crewNames.filter(function(name) {
    if (name === 'Unassigned') return true;
    var crew = crewMap[name];
    var role = '';
    if (crew && crew.userId) {
      var u = _crewList.find(function(c) { return c.id === crew.userId; });
      if (u) role = u.role || '';
    }
    // Field roles always show
    if (FIELD_ROLES.indexOf(role) !== -1) return true;
    // Known office names or office roles: only show if assigned
    if (OFFICE_ONLY_NAMES.indexOf(name) !== -1 || ['admin','owner','sales','scoper','estimator'].indexOf(role) !== -1) {
      return assignedNames.has(name);
    }
    return true;
  });

  if (crewNames.length === 0) crewNames = ['No assignments'];

  // Build delivery lookup — use confirmed_delivery_date if available, fall back to delivery_date
  var deliveryMap = {};
  _calDeliveries.forEach(function(del) {
    var effectiveDate = del.confirmed_delivery_date || del.delivery_date;
    if (!effectiveDate) return;
    del._effectiveDate = effectiveDate;
    del._isConfirmed = !!del.confirmed_delivery_date;
    if (!deliveryMap[effectiveDate]) deliveryMap[effectiveDate] = [];
    deliveryMap[effectiveDate].push(del);
  });

  // Detect conflicts: same crew, same date, 2+ different jobs
  var conflicts = {}; // 'crew_date' -> true
  Object.keys(crewMap).forEach(function(crew) {
    var evts = crewMap[crew].events;
    Object.keys(evts).forEach(function(dateStr) {
      var jobIds = {};
      evts[dateStr].forEach(function(e) { jobIds[e.ev.job_id] = true; });
      if (Object.keys(jobIds).length > 1) conflicts[crew + '_' + dateStr] = true;
    });
  });

  // Job start date lookup for material warnings
  var jobStartDates = {};
  _calEvents.forEach(function(ev) {
    if (!jobStartDates[ev.job_id] || ev.scheduled_date < jobStartDates[ev.job_id]) {
      jobStartDates[ev.job_id] = ev.scheduled_date;
    }
  });

  // Enrich crew division from _crewList (more reliable than event-based guessing)
  _crewList.forEach(function(u) {
    if (crewMap[u.name] && u.division) crewMap[u.name].division = u.division;
  });

  // Re-sort with enriched divisions: patio first, fencing second, empty last, Unassigned at end
  var divOrder = { patio: 0, trade: 0, decking: 1, fencing: 2 };
  crewNames.sort(function(a, b) {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    var da = crewMap[a].division || '', db = crewMap[b].division || '';
    var oa = divOrder[da] !== undefined ? divOrder[da] : 3;
    var ob = divOrder[db] !== undefined ? divOrder[db] : 3;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  // Ensure Unassigned is always present
  if (crewNames.indexOf('Unassigned') === -1) {
    crewMap['Unassigned'] = { division: '', events: {} };
    crewNames.push('Unassigned');
  }

  var prevDiv = null;
  var numCols = numDays + 1;
  var isMonthMode = _calRangeMode === 'month';

  var html = '<div class="cal-swimlane-grid' + (isMonthMode ? ' month-mode' : '') + '" style="grid-template-columns: 140px repeat(' + numDays + ', 1fr);">';

  // Header row
  html += '<div class="cal-swimlane-corner">Crew / Date</div>';
  dates.forEach(function(dateStr) {
    var dd = new Date(dateStr + 'T00:00:00');
    var dayIdx = (dd.getDay() + 6) % 7;
    var isToday = dateStr === todayStr;
    html += '<div class="cal-swimlane-day-header' + (isToday ? ' today' : '') + '">';
    html += '<div class="day-name">' + DAYS[dayIdx] + '</div>';
    html += '<div class="day-num">' + dd.getDate() + '</div>';
    if (!isMonthMode) html += weatherBadgeHtml(dateStr, true);
    html += '</div>';
  });

  // Track which division headers we've emitted
  var emittedDivs = {};

  // Crew rows
  crewNames.forEach(function(crew) {
    var crewData = crewMap[crew] || { division: '', events: {} };
    var div = crewData.division || '';
    var isDimmed = _calDivFilter !== 'all' && div && div !== _calDivFilter;

    // Division divider — always show PATIOS + FENCING headers
    var displayDiv = (div === 'trade' || div === 'patio' || div === 'decking') ? 'patio' : (div === 'fencing' ? 'fencing' : div);
    if (displayDiv !== prevDiv && crew !== 'Unassigned') {
      // If jumping to fencing and patio header hasn't been emitted, emit it first
      if (displayDiv === 'fencing' && !emittedDivs['patio']) {
        html += '<div class="cal-division-label">PATIOS</div>';
        emittedDivs['patio'] = true;
      }
      var divLabel = displayDiv === 'patio' ? 'PATIOS' : displayDiv === 'fencing' ? 'FENCING' : (displayDiv || '').toUpperCase();
      if (divLabel) {
        html += '<div class="cal-division-label">' + divLabel + '</div>';
        emittedDivs[displayDiv] = true;
        prevDiv = displayDiv;
      }
    }

    // Row label
    var initial = crew.charAt(0).toUpperCase();
    var crewBg = crewColor(crew);
    html += '<div class="cal-crew-label' + (isDimmed ? ' dimmed' : '') + '">';
    html += '<span class="crew-initial" style="background:' + crewBg + '">' + initial + '</span>';
    html += '<span style="overflow:hidden;text-overflow:ellipsis;">' + crew + '</span>';
    if (div) html += '<span class="division-badge ' + div + '">' + div + '</span>';
    html += '</div>';

    // Day cells
    dates.forEach(function(dateStr) {
      var dd = new Date(dateStr + 'T00:00:00');
      var dayIdx = (dd.getDay() + 6) % 7;
      var isToday = dateStr === todayStr;
      var isWeekend = dayIdx >= 5;

      // Layer 1: Availability background
      var availKey = crew + '_' + dateStr;
      var avail = _calAvailability[availKey];
      var cellClass = 'cal-swim-cell';
      if (isDimmed) cellClass += ' dimmed';
      if (isWeekend) cellClass += ' weekend';
      if (isToday) cellClass += ' today-col';
      if (!isMonthMode) {
        var cellWeather = getWeatherForDate(dateStr);
        if (cellWeather && (cellWeather.rain_pct > 40 || cellWeather.rain_mm > 2)) cellClass += ' weather-rain';
      }
      if (avail) {
        if (avail.status === 'available') cellClass += ' avail-available';
        else if (avail.status === 'unavailable') cellClass += ' avail-unavailable';
        else if (avail.status === 'leave') cellClass += ' avail-leave';
      }

      var hasConflict = conflicts[crew + '_' + dateStr];

      html += '<div class="' + cellClass + '"';
      html += ' data-date="' + dateStr + '" data-crew="' + crew.replace(/"/g, '&quot;') + '"';
      html += ' ondragover="event.preventDefault();this.classList.add(\'drag-over\')"';
      html += ' ondragleave="this.classList.remove(\'drag-over\')"';
      html += ' ondrop="handleCalDrop(event,this)"';
      html += ' onclick="handleCellClick(\'' + dateStr + '\',\'' + crew.replace(/'/g, "\\'") + '\',\'' + (crewData.userId || '') + '\')"';
      html += '>';

      // Leave badge
      if (avail && avail.status === 'leave') {
        html += '<span class="leave-badge">L</span>';
      }

      // Conflict warning
      if (hasConflict) {
        html += '<span class="cal-cell-warning conflict" title="Scheduling conflict — multiple jobs">&#9888;</span>';
      }

      // Layer 2 & 3: Job blocks
      var entries = crewData.events[dateStr] || [];
      entries.forEach(function(entry) {
        var ev = entry.ev;
        // Determine confirmation status
        var confStatus = ev.confirmation_status || 'tentative';
        if (ev.assignment_status === 'in_progress') confStatus = 'in_progress';
        if (ev.assignment_status === 'complete') confStatus = 'completed';
        // Live clock indicator: clocked on but not off = currently on site
        var isLiveOnSite = ev.clocked_on_at && !ev.clocked_off_at && ev.assignment_status !== 'complete';
        var isStaleOnSite = isLiveOnSite && (Date.now() - new Date(ev.clocked_on_at).getTime() > 14 * 3600000);

        var blockClass = 'cal-job-block ' + confStatus;
        // Readiness left border
        var jobReadiness = _calReadiness[ev.job_id];
        if (jobReadiness) blockClass += ' readiness-' + jobReadiness.status;
        if (entry.pos !== 'multi-single') blockClass += ' multi ' + entry.pos;
        else blockClass += ' multi-single';
        if (hasConflict) blockClass += ' conflict';

        // Lock drag: confirmed jobs are not draggable
        var isDraggable = confStatus !== 'confirmed';

        html += '<div class="' + blockClass + '"';
        html += ' draggable="' + isDraggable + '"';
        if (isDraggable) {
          html += ' ondragstart="handleBlockDragStart(event,\'' + ev.assignment_id + '\')"';
        } else {
          html += ' ondragstart="event.preventDefault();showToast(\'Confirmed — use Reschedule in popup\',\'warning\');return false;"';
        }
        html += ' onclick="event.stopPropagation();openCalJobPopup(event,\'' + ev.assignment_id + '\')"';
        var titleText = ev.client_name ? escapeHtml(ev.client_name) + ' — ' + escapeHtml(ev.site_suburb || '') : escapeHtml(ev.label || 'Internal');
        html += ' title="' + titleText + '"';
        html += '>';

        // Live on-site indicator
        if (isLiveOnSite && !isStaleOnSite) html += '<span style="display:inline-block;width:8px;height:8px;background:#22C55E;border-radius:50%;margin-right:4px;animation:pulse 1.5s infinite;" title="On site now"></span>';
        else if (isStaleOnSite) html += '<span style="display:inline-block;width:8px;height:8px;background:#F59E0B;border-radius:50%;margin-right:4px;" title="Clocked on 14h+ ago — may be stale"></span>';
        // Job name or label
        if (!ev.job_id) {
          // Job-less internal entry — grey dot + italic label
          html += '<span style="display:inline-block;width:8px;height:8px;background:#9CA3AF;border-radius:50%;margin-right:4px;"></span>';
          html += '<em>' + escapeHtml(ev.label || 'Internal') + '</em>';
        } else {
          if (!isMonthMode && ev.job_number) html += '<strong>' + ev.job_number + '</strong> ';
          html += escapeHtml(ev.client_name || 'Unknown');
        }
        // Lock icon on confirmed
        if (confStatus === 'confirmed') html += '<span class="cal-lock-icon">&#128274;</span>';
        // Type icon (inline SVG, week view only)
        if (!isMonthMode) {
          var divType = ev.job_type || 'patio';
          html += calTypeIconSvg(divType);
        }
        html += '</div>';
      });

      html += '</div>';
    });
  });

  // Ensure FENCING header appears even if no fencing crew visible
  if (!emittedDivs['fencing']) {
    if (!emittedDivs['patio']) html += '<div class="cal-division-label">PATIOS</div>';
    html += '<div class="cal-division-label">FENCING</div>';
  }

  // Delivery row
  var hasDeliveries = dates.some(function(ds) { return deliveryMap[ds] && deliveryMap[ds].length > 0; });
  if (hasDeliveries) {
    html += '<div class="cal-division-label">Deliveries</div>';
    html += '<div class="cal-crew-label">';
    html += '<span class="crew-initial" style="background:var(--sw-purple);">D</span>';
    html += '<span>Deliveries</span>';
    html += '</div>';
    dates.forEach(function(dateStr) {
      var dd = new Date(dateStr + 'T00:00:00');
      var dayIdx = (dd.getDay() + 6) % 7;
      var cellClass = 'cal-swim-cell';
      if (dayIdx >= 5) cellClass += ' weekend';
      if (dateStr === todayStr) cellClass += ' today-col';
      html += '<div class="' + cellClass + '">';
      var dels = deliveryMap[dateStr] || [];
      dels.forEach(function(del) {
        var effectiveDate = del._effectiveDate || del.delivery_date;
        var isWarning = del.job_id && jobStartDates[del.job_id] && effectiveDate > jobStartDates[del.job_id];
        var confirmedStyle = del._isConfirmed ? 'border-left:3px solid var(--sw-green);' : 'border-left:3px dashed var(--sw-orange);';
        html += '<div class="cal-delivery-block' + (isWarning ? ' warning' : '') + '" style="' + confirmedStyle + '" title="' + del.po_number + ' — ' + del.supplier_name + (del._isConfirmed ? ' (confirmed)' : ' (requested)') + '">';
        html += (del._isConfirmed ? '&#10003; ' : '') + del.supplier_name;
        if (isWarning) html += ' &#9888;';
        html += '</div>';
      });
      html += '</div>';
    });
  }

  html += '</div>';
  container.innerHTML = html;
}

// Guess crew division from their most common job type
function guessDivision(ev) {
  var t = ev.job_type || '';
  if (t === 'patio' || t === 'decking') return 'patio';
  if (t === 'fencing') return 'fencing';
  return t || '';
}

// ── Summary Bar (management metrics) ──
function renderCalSummary(range) {
  var dates = getCalDays(range);
  var lockedReady = 0, lockedExposed = 0, tentativeCount = 0, revenue = 0;
  var countedJobs = {};
  var conflictCount = 0;

  // Count conflicts
  var crewDateJobs = {};
  _calEvents.forEach(function(ev) {
    var crew = cleanCrewName(ev.crew_name || ev.assigned_to) || 'Unassigned';
    var start = ev.scheduled_date;
    var end = ev.scheduled_end || start;
    dates.forEach(function(ds) {
      if (ds >= start && ds <= end) {
        var key = crew + '_' + ds;
        if (!crewDateJobs[key]) crewDateJobs[key] = {};
        crewDateJobs[key][ev.job_id] = true;
      }
    });
  });
  Object.keys(crewDateJobs).forEach(function(k) {
    if (Object.keys(crewDateJobs[k]).length > 1) conflictCount++;
  });

  _calEvents.forEach(function(ev) {
    if (ev.scheduled_date >= dates[0] && ev.scheduled_date <= dates[dates.length - 1]) {
      if (!countedJobs[ev.job_id]) {
        countedJobs[ev.job_id] = true;
        var cs = ev.confirmation_status || 'tentative';
        var isLocked = cs === 'confirmed' || ev.assignment_status === 'in_progress';
        var rd = _calReadiness[ev.job_id];
        var isReady = rd && rd.status === 'ready';

        if (isLocked && isReady) lockedReady++;
        else if (isLocked && !isReady) lockedExposed++;
        else tentativeCount++;

        // Revenue from pricing_json
        var val = 0;
        if (ev.pricing_json) {
          try {
            var pj = typeof ev.pricing_json === 'string' ? JSON.parse(ev.pricing_json) : ev.pricing_json;
            val = parseFloat(pj.totalIncGST || pj.total || 0) || 0;
          } catch(e) {}
        }
        if (!val) val = ev.quote_value || 0;
        revenue += val;
      }
    }
  });

  var unschedCount = _unschedJobs.length;
  var bar = document.getElementById('calSummaryBar');
  var html = '';
  html += '<span class="stat" style="color:#22C55E"><span class="stat-val">' + lockedReady + '</span> Confirmed &amp; Ready</span>';
  html += '<span class="stat" style="color:#EF4444"><span class="stat-val">' + lockedExposed + '</span> Confirmed — Not Ready</span>';
  html += '<span class="stat" style="color:#F59E0B"><span class="stat-val">' + tentativeCount + '</span> Planned</span>';
  html += '<span class="stat"><span class="stat-val">' + unschedCount + '</span> Unscheduled</span>';
  if (revenue > 0) {
    html += '<span class="stat" style="margin-left:auto;"><span class="stat-val">$' + Math.round(revenue).toLocaleString() + '</span> revenue</span>';
  }
  if (conflictCount > 0) {
    html += '<span class="conflict-warn" onclick="highlightConflicts()">&#9888; ' + conflictCount + ' conflict' + (conflictCount > 1 ? 's' : '') + '</span>';
  }
  bar.innerHTML = html;
}

// ── Compact Month Grid (day-based view) ──
function renderCompactMonth(container, range) {
  var dates = getCalDays(range);
  var todayStr = new Date().toISOString().slice(0, 10);

  // Build a map: dateStr → [events]
  var dayEvents = {};
  _calEvents.forEach(function(ev) {
    if (_calDivFilter !== 'all') {
      var div = ev.job_type || 'patio';
      if (_calDivFilter === 'patio' && div !== 'patio' && div !== 'decking') return;
      if (_calDivFilter === 'fencing' && div !== 'fencing') return;
    }
    var start = ev.scheduled_date;
    var end = ev.scheduled_end || start;
    dates.forEach(function(ds) {
      if (ds >= start && ds <= end) {
        if (!dayEvents[ds]) dayEvents[ds] = [];
        // Avoid duplicate job entries per day
        var already = dayEvents[ds].some(function(x) { return x.job_id === ev.job_id && x.assignment_id === ev.assignment_id; });
        if (!already) dayEvents[ds].push(ev);
      }
    });
  });

  // Find the first Monday on or before the first date, and last Sunday on or after the last date
  var firstDate = new Date(dates[0] + 'T00:00:00');
  var lastDate = new Date(dates[dates.length - 1] + 'T00:00:00');
  // Go back to Monday
  var startDow = (firstDate.getDay() + 6) % 7;
  var gridStart = new Date(firstDate);
  gridStart.setDate(gridStart.getDate() - startDow);
  // Go forward to Sunday
  var endDow = (lastDate.getDay() + 6) % 7;
  var gridEnd = new Date(lastDate);
  gridEnd.setDate(gridEnd.getDate() + (6 - endDow));

  var html = '<div class="cal-compact-month">';
  // Header row
  var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  dayNames.forEach(function(d) { html += '<div class="cm-header">' + d + '</div>'; });

  // Day cells
  var cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    var ds = cursor.toISOString().slice(0, 10);
    var inRange = ds >= dates[0] && ds <= dates[dates.length - 1];
    var dow = (cursor.getDay() + 6) % 7;
    var cellClass = 'cm-cell';
    if (!inRange) cellClass += ' outside';
    if (ds === todayStr) cellClass += ' today';
    if (dow >= 5) cellClass += ' weekend';

    html += '<div class="' + cellClass + '" onclick="handleCompactDayClick(\'' + ds + '\')">';
    html += '<div class="cm-day-num">' + cursor.getDate() + '</div>';

    var evts = dayEvents[ds] || [];
    evts.forEach(function(ev) {
      var rd = _calReadiness[ev.job_id];
      var bgColor = 'var(--sw-card)';
      if (rd) {
        if (rd.status === 'ready') bgColor = 'rgba(34,197,94,0.15)';
        else if (rd.status === 'at_risk') bgColor = 'rgba(245,158,11,0.18)';
        else if (rd.status === 'blocked') bgColor = 'rgba(239,68,60,0.18)';
      }
      var cs = ev.confirmation_status || 'tentative';
      var borderStyle = cs === 'confirmed' ? '2px solid #27AE60' : cs === 'placeholder' ? '1px dashed #ccc' : '1px solid #8FA4B2';
      html += '<div class="cm-pill" style="background:' + bgColor + ';border:' + borderStyle + ';"';
      html += ' onclick="event.stopPropagation();openCalJobPopup(event,\'' + ev.assignment_id + '\')"';
      var cmTitle = ev.client_name ? escapeHtml(ev.client_name) + ' — ' + escapeHtml(ev.site_suburb || '') : escapeHtml(ev.label || 'Internal');
      html += ' title="' + cmTitle + '">';
      html += escapeHtml(ev.client_name || ev.label || 'Internal');
      if (cs === 'confirmed') html += ' 🔒';
      html += '</div>';
    });

    html += '</div>';
    cursor.setDate(cursor.getDate() + 1);
  }

  html += '</div>';
  container.innerHTML = html;
}

function toggleMonthView() {
  _calMonthView = _calMonthView === 'swimlane' ? 'compact' : 'swimlane';
  var btn = document.getElementById('btnMonthViewToggle');
  btn.textContent = _calMonthView === 'swimlane' ? 'Day View' : 'Crew View';
  loadCalendar();
}

function handleCompactDayClick(dateStr) {
  // Open assignment modal for that day
  openAssignmentModal(null, dateStr);
}

// ── Unscheduled Sidebar ──
function renderCalUnschedSidebar() {
  var sidebar = document.getElementById('calUnschedSidebar');
  document.getElementById('unschedCount').textContent = _unschedJobs.length;

  // Group by type
  var groups = {};
  _unschedJobs.forEach(function(j) {
    var t = j.type || 'other';
    if (!groups[t]) groups[t] = [];
    groups[t].push(j);
  });

  var html = '<div class="cal-unsched-header">Unscheduled<span class="count">' + _unschedJobs.length + '</span></div>';
  html += '<div class="cal-unsched-body">';

  if (_unschedJobs.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--sw-text-sec);font-size:12px;">All jobs scheduled</div>';
  }

  var groupOrder = ['patio', 'fencing', 'decking', 'miscellaneous', 'other'];
  var groupLabels = { patio: 'Patios', fencing: 'Fencing', decking: 'Decking', miscellaneous: 'Miscellaneous', other: 'Other' };
  groupOrder.forEach(function(type) {
    var jobs = groups[type];
    if (!jobs || jobs.length === 0) return;
    html += '<div class="cal-unsched-group">';
    html += '<div class="cal-unsched-group-title">' + (groupLabels[type] || type) + '</div>';
    jobs.forEach(function(j) {
      var val = j.value || 0;
      var daysAccepted = j.accepted_at ? Math.floor((Date.now() - new Date(j.accepted_at).getTime()) / 86400000) : 0;
      var isStale = daysAccepted > 7;
      html += '<div class="cal-unsched-card ' + (j.type || '') + (isStale ? ' stale' : '') + '"';
      html += ' draggable="true"';
      html += ' ondragstart="handleUnschedDragStart(event,\'' + j.id + '\')"';
      html += ' data-jobid="' + j.id + '"';
      html += '>';
      html += '<div class="cal-unsched-card-client">' + (j.client_name || 'Unknown') + '</div>';
      html += '<div class="cal-unsched-card-detail">' + (j.job_number || '') + ' · ' + (j.site_suburb || '') + '</div>';
      html += '<div class="cal-unsched-card-meta">';
      if (val > 0) html += '<span class="cal-unsched-card-value">' + fmt$(val) + '</span>';
      // Duration from scope_json
      var durText = '? days';
      // TODO Phase 2: Auto-populate from scope_json based on job size
      html += '<span class="cal-unsched-card-days' + (isStale ? ' overdue' : '') + '">' + (isStale ? daysAccepted + 'd since accepted' : durText) + '</span>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
  });

  html += '</div>';
  sidebar.innerHTML = html;
}

// ── Drag & Drop ──
var _calDragData = null;

function handleBlockDragStart(event, assignmentId) {
  _calDragData = { type: 'assignment', assignmentId: assignmentId };
  event.dataTransfer.effectAllowed = 'move';
  event.target.classList.add('dragging');
  setTimeout(function() { event.target.classList.remove('dragging'); }, 0);
}

function handleUnschedDragStart(event, jobId) {
  _calDragData = { type: 'unsched', jobId: jobId };
  event.dataTransfer.effectAllowed = 'copy';
  event.target.classList.add('dragging');
  setTimeout(function() { event.target.classList.remove('dragging'); }, 0);
}

function handleCalDrop(event, cell) {
  event.preventDefault();
  cell.classList.remove('drag-over');
  var date = cell.dataset.date;
  var crew = cell.dataset.crew;
  if (!_calDragData || !date) return;

  if (_calDragData.type === 'unsched') {
    // Show schedule modal
    openScheduleModal(_calDragData.jobId, crew, date);
  } else if (_calDragData.type === 'assignment') {
    // Move existing assignment
    moveAssignment(_calDragData.assignmentId, crew, date);
  }
  _calDragData = null;
}

function handleCellClick(date, crew, userId) {
  // Resolve userId — use passed value, or look up from crew list by name
  if (!userId && _crewList.length > 0) {
    var match = _crewList.find(function(u) { return u.name === crew; }) ||
      _crewList.find(function(u) { return u.name.toLowerCase() === crew.toLowerCase(); });
    if (match) userId = match.id;
  }
  openAssignmentModal(null, date, userId || crew);
}

// ── Schedule Modal (from sidebar drag) ──
function openScheduleModal(jobId, crew, date) {
  var job = _unschedJobs.find(function(j) { return j.id === jobId; });
  if (!job) return;
  var modal = document.getElementById('calSchedModal');
  var backdrop = document.getElementById('calSchedBackdrop');
  modal.innerHTML =
    '<div style="font-size:14px;font-weight:700;margin-bottom:12px;">Schedule Job</div>' +
    '<div style="font-size:12px;margin-bottom:6px;"><strong>' + escapeHtml(job.client_name || 'Unknown') + '</strong> — ' + escapeHtml(job.site_suburb || '') + '</div>' +
    '<div style="font-size:12px;margin-bottom:12px;color:var(--sw-text-sec);">' + (job.job_number || '') + ' · ' + typeBadgeLabel(job.type) + '</div>' +
    '<div class="form-group"><label class="form-label">Crew</label><input type="text" class="form-input" id="schedCrew" value="' + escapeHtml(crew || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Start Date</label><input type="date" class="form-input" id="schedDate" value="' + date + '"></div>' +
    '<div class="form-group"><label class="form-label">Duration (days)</label><input type="number" class="form-input" id="schedDuration" value="1" min="1" max="30"></div>' +
    '<div style="display:flex;gap:8px;margin-top:16px;">' +
    '<button class="btn btn-secondary" onclick="closeScheduleModal()">Cancel</button>' +
    '<button class="btn btn-primary" style="background:var(--sw-orange);" onclick="submitScheduleFromModal(\'' + jobId + '\')">Create Planned</button>' +
    '</div>';
  modal.classList.add('open');
  backdrop.classList.add('open');
}

function closeScheduleModal() {
  document.getElementById('calSchedModal').classList.remove('open');
  document.getElementById('calSchedBackdrop').classList.remove('open');
}

async function submitScheduleFromModal(jobId) {
  var crew = document.getElementById('schedCrew').value;
  var date = document.getElementById('schedDate').value;
  var dur = parseInt(document.getElementById('schedDuration').value) || 1;

  if (!crew || !date) { showToast('Crew and date required', 'warning'); return; }

  var endDate = new Date(date + 'T00:00:00');
  endDate.setDate(endDate.getDate() + dur - 1);
  var endStr = endDate.toISOString().slice(0, 10);

  try {
    await opsPost('create_assignment', {
      job_id: jobId,
      crew_name: crew,
      scheduled_date: date,
      scheduled_end: endStr,
      role: 'lead_installer',
      assignment_type: 'install',
    });
    closeScheduleModal();
    showToast('Assignment created (tentative)', 'success');
    loadCalendar();
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

async function moveAssignment(assignmentId, newCrew, newDate) {
  // Find the assignment in events
  var ev = _calEvents.find(function(e) { return e.assignment_id === assignmentId; });
  if (!ev) return;

  // Confirmed jobs cannot be dragged — must use Reschedule
  if (ev.confirmation_status === 'confirmed') {
    showToast('Confirmed — use Reschedule in the job popup', 'warning');
    return;
  }

  // Warn if target cell is unavailable/leave
  var availKey = newCrew + '_' + newDate;
  var avail = _calAvailability[availKey];
  if (avail && (avail.status === 'unavailable' || avail.status === 'leave')) {
    showConfirmModal(
      'Crew Unavailable',
      escapeHtml(newCrew) + ' is marked <strong>' + avail.status + '</strong> on ' + fmtDate(newDate) + '. Schedule anyway?',
      'Schedule Anyway',
      function() { doMoveAssignment(assignmentId, newCrew, newDate); }
    );
    return;
  }

  doMoveAssignment(assignmentId, newCrew, newDate);
}

async function doMoveAssignment(assignmentId, newCrew, newDate) {
  try {
    await opsPost('update_assignment', {
      assignmentId: assignmentId,
      crew_name: newCrew,
      scheduled_date: newDate,
    });
    showToast('Assignment moved', 'success');
    loadCalendar();
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

// ── Job Block Popup (Triage Card) — merged job info + calendar actions ──
async function openCalJobPopup(event, assignmentId) {
  event.stopPropagation();
  var ev = _calEvents.find(function(e) { return e.assignment_id === assignmentId; });
  if (!ev) return;
  _calPopupAssignment = ev;

  var popup = document.getElementById('calJobPopup');
  var confStatus = ev.confirmation_status || 'tentative';
  var statusLabels = { placeholder: 'Placeholder', tentative: 'Planned', confirmed: 'Confirmed' };

  var readiness = _calReadiness[ev.job_id];
  var rdColors = { blocked: '#EF4444', at_risk: '#F59E0B', ready: '#22C55E' };
  var isReady = readiness && readiness.status === 'ready';
  var isLocked = confStatus === 'confirmed';

  // Show overlay with loading state
  popup.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:start;"><div class="cal-job-popup-title">Loading...</div><button onclick="closeCalJobPopup()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--sw-text-sec);">&times;</button></div>';
  document.getElementById('calJobPopupOverlay').classList.add('open');

  // Fetch full job detail (job assignments only)
  var j = null;
  var jobDetail = null;
  if (ev.job_id) {
    try {
      jobDetail = await opsFetch('job_detail', { jobId: ev.job_id });
      j = jobDetail.job;
    } catch(e) {}
  }

  // ═══ TOP SECTION: Job Info ═══
  var html = '';

  // Title + close
  html += '<div style="display:flex;justify-content:space-between;align-items:start;gap:6px;">';
  if (ev.job_id) {
    html += '<div><strong style="font-size:15px;">' + escapeHtml(j ? j.client_name : ev.client_name || 'Unknown') + '</strong>';
    html += '<div style="font-size:12px;color:var(--sw-text-sec);">' + (ev.job_number || (j && j.job_number) || '') + ' &middot; ' + escapeHtml(j ? j.site_suburb || '' : ev.site_suburb || '') + '</div>';
  } else {
    html += '<div><strong style="font-size:15px;">' + escapeHtml(ev.label || 'Internal Event') + '</strong>';
    html += '<div style="font-size:12px;color:var(--sw-text-sec);">Internal / No Job</div>';
  }
  html += '</div>';
  html += '<button onclick="closeCalJobPopup()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--sw-text-sec);">&times;</button>';
  html += '</div>';

  if (j) {
    // Type
    html += '<div class="jd-qv-row"><span class="jd-qv-label">Type</span><span class="type-badge ' + j.type + '">' + typeBadgeLabel(j.type) + '</span></div>';
    // Status
    html += '<div class="jd-qv-row"><span class="jd-qv-label">Status</span><span class="status-badge ' + j.status + '">' + (STATUS_LABELS[j.status] || j.status) + '</span></div>';
    // Quote
    var quoteVal = j.pricing_json?.totalIncGST || j.pricing_json?.total || 0;
    if (quoteVal) html += '<div class="jd-qv-row"><span class="jd-qv-label">Quote</span><strong style="color:var(--sw-green)">' + fmt$(quoteVal) + '</strong></div>';
    // Address
    if (j.site_address) html += '<div class="jd-qv-row"><span class="jd-qv-label">Address</span><span style="font-size:12px">' + escapeHtml(j.site_address) + '</span></div>';
    // Phone
    if (j.client_phone) html += '<div class="jd-qv-row"><span class="jd-qv-label">Phone</span><a href="tel:' + j.client_phone + '">' + j.client_phone + '</a></div>';
    // Quick stats + Open Record
    html += '<div style="display:flex;gap:12px;margin-top:8px;font-size:12px;color:var(--sw-text-sec);align-items:center;">';
    html += '<span>' + (jobDetail.assignments || []).length + ' assignments</span>';
    html += '<span>' + (jobDetail.purchase_orders || []).length + ' POs</span>';
    html += '<span>' + (jobDetail.work_orders || []).length + ' WOs</span>';
    html += '<button onclick="closeCalJobPopup();openJobDetail(\'' + ev.job_id + '\')" style="margin-left:auto;padding:7px 14px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;background:var(--sw-orange);color:#fff;border:1px solid var(--sw-orange);">Open Record</button>';
    html += '</div>';

    // Alerts
    var alerts = evaluateJobAlerts(jobDetail);
    if (alerts.length > 0) {
      html += '<div style="margin-top:6px;">';
      alerts.slice(0, 3).forEach(function(a) {
        html += '<div class="jd-alert ' + a.level + '" style="margin-bottom:4px;">' + a.icon + ' ' + a.message + '</div>';
      });
      html += '</div>';
    }
  }

  // ═══ DIVIDER ═══
  html += '<hr style="border:none;border-top:1px solid var(--sw-border);margin:12px 0;">';

  // ═══ BOTTOM SECTION: Calendar-specific ═══

  // Schedule dates + crew
  var schedParts = [];
  if (ev.scheduled_date) {
    var schedStr = fmtDate(ev.scheduled_date);
    if (ev.scheduled_end && ev.scheduled_end !== ev.scheduled_date) schedStr += ' → ' + fmtDate(ev.scheduled_end);
    schedParts.push(schedStr);
  }
  var crewForJob = [];
  _calEvents.forEach(function(e) {
    var sameEntry = ev.job_id ? e.job_id === ev.job_id : e.assignment_id === ev.assignment_id;
    if (sameEntry) {
      var cn = cleanCrewName(e.crew_name || e.assigned_to);
      if (cn && cn !== 'Unassigned' && crewForJob.indexOf(cn) === -1) crewForJob.push(cn);
    }
  });
  if (crewForJob.length) schedParts.push(crewForJob.join(', '));
  if (schedParts.length) html += '<div class="cal-popup-meta">' + schedParts.join(' &middot; ') + '</div>';

  // Certainty + Readiness
  html += '<div class="cal-job-popup-row" style="display:flex;gap:8px;align-items:center;margin:8px 0;">';
  html += '<select id="popupCertainty" onchange="updateCertainty(\'' + assignmentId + '\',this.value)" style="font-size:12px;padding:3px 8px;border:1px solid var(--sw-border);border-radius:4px;font-weight:600">';
  ['placeholder','tentative','confirmed'].forEach(function(s) {
    html += '<option value="' + s + '"' + (confStatus === s ? ' selected' : '') + '>' + (statusLabels[s] || s) + '</option>';
  });
  html += '</select>';
  if (readiness) {
    var unmetCount = ((readiness.blockers || []).filter(function(b) { return !b.met; }).length) + ((readiness.warnings || []).filter(function(w) { return !w.met; }).length);
    var rdText = '';
    if (readiness.status === 'blocked') rdText = 'Not Ready — ' + unmetCount + ' item' + (unmetCount !== 1 ? 's' : '') + ' to do';
    else if (readiness.status === 'at_risk') rdText = unmetCount + ' item' + (unmetCount !== 1 ? 's' : '') + ' to do';
    else rdText = '✓ Ready';
    html += '<span style="font-size:12px;font-weight:600;color:' + (rdColors[readiness.status] || '#6B7280') + '">' + rdText + '</span>';
  }
  html += '</div>';

  // Blockers
  var unmetBlockers = readiness ? (readiness.blockers || []).filter(function(b) { return !b.met; }) : [];
  var unmetWarnings = readiness ? (readiness.warnings || []).filter(function(w) { return !w.met; }) : [];

  if (unmetBlockers.length > 0) {
    html += '<div class="cal-popup-blocker">';
    unmetBlockers.forEach(function(b) {
      html += '<div class="cal-popup-blocker-item">&#128308; ' + escapeHtml(readinessDisplayLabel(b.key, false));
      var fixBtn = getBlockerFixButton(b.key, ev.job_id);
      if (fixBtn) html += fixBtn;
      html += '</div>';
    });
    html += '</div>';
  }

  // Warnings
  if (unmetWarnings.length > 0) {
    html += '<details style="font-size:11px;margin-top:4px;"><summary style="cursor:pointer;color:#D97706;font-weight:600;">' + unmetWarnings.length + ' warning' + (unmetWarnings.length > 1 ? 's' : '') + '</summary>';
    unmetWarnings.forEach(function(w) {
      html += '<div style="padding:2px 0;color:#D97706;">&#128992; ' + escapeHtml(readinessDisplayLabel(w.key, false)) + '</div>';
    });
    html += '</details>';
  }

  // Calendar action buttons
  html += '<div class="cal-job-popup-actions" style="margin-top:10px;">';
  if (!isLocked) {
    html += '<button class="btn-primary-action" onclick="confirmAssignment(\'' + assignmentId + '\',true)">Confirm &amp; Notify Client</button>';
    html += '<button class="btn-secondary-action" onclick="confirmAssignment(\'' + assignmentId + '\',false)">Confirm Date</button>';
    html += '<button class="btn-secondary-action" onclick="closeCalJobPopup();openEditAssignmentModal(\'' + assignmentId + '\')">Edit Dates</button>';
    html += popupOverflow(assignmentId, ev.job_id, confStatus);
  } else {
    html += '<button class="btn-secondary-action" style="color:#D97706;" onclick="rescheduleLockedJob(\'' + assignmentId + '\')">Reschedule</button>';
  }
  html += '</div>';

  popup.innerHTML = html;
}

// Helper: blocker fix button
function getBlockerFixButton(key, jobId, primary) {
  var cls = primary ? 'btn-primary-action' : '';
  if (key === 'pos_created') return '<button class="' + cls + '" onclick="closeCalJobPopup();openJobQuickView(\'' + jobId + '\');setTimeout(function(){showJobSubView(\'money\')},300)">Create Materials PO</button>';
  if (key === 'work_order') return '<button class="' + cls + '" onclick="closeCalJobPopup();openJobQuickView(\'' + jobId + '\');setTimeout(function(){showJobSubView(\'build\')},300)">Create Work Order</button>';
  if (key && key.indexOf('_doc') !== -1) return '<button class="' + cls + '" onclick="closeCalJobPopup();openJobQuickView(\'' + jobId + '\');setTimeout(function(){showJobSubView(\'files\')},300)">Upload Document</button>';
  return '';
}

// Helper: overflow menu for secondary actions
function popupOverflow(assignmentId, jobId, confStatus) {
  var html = '<div style="position:relative;display:inline-block;">';
  html += '<button class="btn-overflow" onclick="event.stopPropagation();this.nextElementSibling.classList.toggle(\'open\')">More &#9662;</button>';
  html += '<div class="cal-popup-overflow">';
  if (confStatus !== 'confirmed') {
    html += '<button onclick="closeCalJobPopup();openEditAssignmentModal(\'' + assignmentId + '\')">Edit Dates</button>';
  }
  html += '<button class="btn-danger" onclick="removeAssignment(\'' + assignmentId + '\')">Remove</button>';
  html += '</div></div>';
  return html;
}

function closeCalJobPopup() {
  document.getElementById('calJobPopupOverlay').classList.remove('open');
  _calPopupAssignment = null;
}

// Close popup when clicking outside (handled by overlay onclick now)

// ── Confirm Modal (replaces browser confirm()) ──
function showConfirmModal(title, message, confirmText, onConfirm, opts) {
  opts = opts || {};
  var backdrop = document.getElementById('calConfirmBackdrop');
  var modal = document.getElementById('calConfirmModal');
  var html = '<h3>' + escapeHtml(title) + '</h3>';
  html += '<p>' + message + '</p>';
  html += '<div class="modal-actions">';
  html += '<button class="btn-cancel" onclick="closeConfirmModal()">Cancel</button>';
  html += '<button class="btn-proceed' + (opts.danger ? ' danger' : '') + '" id="confirmModalProceed">' + escapeHtml(confirmText) + '</button>';
  html += '</div>';
  modal.innerHTML = html;
  backdrop.classList.add('open');
  document.getElementById('confirmModalProceed').onclick = function() {
    closeConfirmModal();
    onConfirm();
  };
}

function closeConfirmModal() {
  document.getElementById('calConfirmBackdrop').classList.remove('open');
}

// ── Confirm / Lock Actions ──
async function confirmAssignment(assignmentId, notify) {
  // Check readiness — warn if blocked
  var ev = _calEvents.find(function(e) { return e.assignment_id === assignmentId; });
  if (ev) {
    var rd = _calReadiness[ev.job_id];
    if (rd && rd.status === 'blocked') {
      var blockerList = (rd.blockers || []).filter(function(b) { return !b.met; }).map(function(b) { return readinessDisplayLabel(b.key, false); }).join(', ');
      showConfirmModal(
        'Confirm with outstanding items?',
        'This job still has items to do: <strong>' + escapeHtml(blockerList) + '</strong>. Confirming the date means crew and client will expect this date.',
        'Confirm Anyway',
        function() { doConfirmAssignment(assignmentId, notify); },
        { danger: true }
      );
      return;
    }
  }

  doConfirmAssignment(assignmentId, notify);
}

async function doConfirmAssignment(assignmentId, notify) {
  try {
    // Find all assignments for the same job and confirm them all
    var ev = _calEvents.find(function(e) { return e.assignment_id === assignmentId; });
    var siblingIds = [];
    if (ev) {
      _calEvents.forEach(function(e) {
        if (e.job_id === ev.job_id && e.assignment_id !== assignmentId) {
          var cs = e.confirmation_status || 'tentative';
          if (cs !== 'confirmed') siblingIds.push(e.assignment_id);
        }
      });
    }

    // Confirm the primary assignment (with optional client notification)
    await opsPost('confirm_assignment', {
      assignmentId: assignmentId,
      notifyClient: notify,
    });

    // Silently confirm sibling assignments (same job, different crew)
    for (var i = 0; i < siblingIds.length; i++) {
      try {
        await opsPost('confirm_assignment', {
          assignmentId: siblingIds[i],
          notifyClient: false,
        });
      } catch(e) { /* best effort */ }
    }

    closeCalJobPopup();
    var msg = notify ? 'Confirmed & client notified' : 'Confirmed';
    if (siblingIds.length > 0) msg += ' (' + (siblingIds.length + 1) + ' crew assignments)';
    showToast(msg, 'success');
    loadCalendar();
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
}

window.updateCertainty = async function(assignmentId, newStatus) {
  var ev = _calEvents.find(function(e) { return e.assignment_id === assignmentId; });
  if (!ev) return;

  // If promoting to confirmed (locked), use confirm_assignment
  if (newStatus === 'confirmed') {
    confirmAssignment(assignmentId, false);
    return;
  }

  try {
    await opsPost('update_assignment', {
      assignmentId: assignmentId,
      confirmation_status: newStatus,
    });
    closeCalJobPopup();
    var labels = { placeholder: 'Placeholder', tentative: 'Planned' };
    showToast('Set to ' + (labels[newStatus] || newStatus), 'success');
    loadCalendar();
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
};

window.rescheduleLockedJob = function(assignmentId) {
  var ev = _calEvents.find(function(e) { return e.assignment_id === assignmentId; });
  if (!ev) return;

  showConfirmModal(
    'Reschedule Confirmed Job?',
    'This will move the job back to Planned status. The client was already notified for <strong>' + fmtDate(ev.scheduled_date) + '</strong>.',
    'Reschedule',
    async function() {
      try {
        await opsPost('update_assignment', {
          assignmentId: assignmentId,
          confirmation_status: 'tentative',
        });
        closeCalJobPopup();
        showToast('Back to Planned. Drag or edit dates to reschedule.', 'success');
        loadCalendar();
      } catch (e) {
        showToast('Error: ' + e.message, 'warning');
      }
    },
    { danger: true }
  );
};

function removeAssignment(assignmentId) {
  showConfirmModal(
    'Remove Assignment',
    'This will remove the assignment from the schedule. The job stays in the pipeline but will become unscheduled.',
    'Remove',
    async function() {
      try {
        await opsPost('delete_assignment', { assignmentId: assignmentId });
        closeCalJobPopup();
        showToast('Assignment removed', 'success');
        loadCalendar();
      } catch (e) {
        showToast('Error: ' + e.message, 'warning');
      }
    },
    { danger: true }
  );
}

// ── Bulk Confirm ──
function openBulkConfirm() {
  var unlockedCount = _calEvents.filter(function(ev) {
    var cs = ev.confirmation_status || 'tentative';
    return cs === 'tentative' || cs === 'placeholder';
  }).length;
  if (unlockedCount === 0) { showToast('No unconfirmed assignments', 'warning'); return; }
  document.getElementById('calBulkText').textContent = 'Confirm ' + unlockedCount + ' assignment' + (unlockedCount > 1 ? 's' : '') + '?';
  document.getElementById('calBulkBar').classList.add('open');
}

function closeBulkBar() {
  document.getElementById('calBulkBar').classList.remove('open');
}

async function executeBulkConfirm() {
  var unlocked = _calEvents.filter(function(ev) {
    var cs = ev.confirmation_status || 'tentative';
    return cs === 'tentative' || cs === 'placeholder';
  });
  closeBulkBar();

  // Use bulk_confirm endpoint
  var ids = unlocked.map(function(ev) { return ev.assignment_id; });
  try {
    await opsPost('bulk_confirm', { assignmentIds: ids });
    showToast(ids.length + ' assignments confirmed', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'warning');
  }
  loadCalendar();
}

function highlightConflicts() {
  // Scroll to first conflict cell and flash it
  var conflictCells = document.querySelectorAll('.cal-cell-warning.conflict');
  if (conflictCells.length > 0) {
    conflictCells[0].closest('.cal-swim-cell').scrollIntoView({ behavior: 'smooth', block: 'center' });
    conflictCells.forEach(function(w) {
      var cell = w.closest('.cal-swim-cell');
      cell.style.outline = '3px solid var(--sw-red)';
      setTimeout(function() { cell.style.outline = ''; }, 3000);
    });
  }
}

// Legacy stubs (old calendar views removed — now unified swimlane)
function renderMonthView() {}
function renderWeekView() {}
function setCalView(v) { setCalRange(v === 'crew' ? '1w' : v === 'week' ? '1w' : 'month'); }
function switchToWeekView(dateStr) { _calDate = new Date(dateStr + 'T00:00:00'); setCalRange('1w'); }

// ── End of calendar redesign ──
// Old calendar functions below removed:
// renderMonthView, renderWeekView (week column view), renderCrewView, renderUnschedSidebar
// These are now handled by the unified renderSwimlaneView + renderCalUnschedSidebar




