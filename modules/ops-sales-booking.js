(function (global) {
  'use strict';

  var SEND_HOLD = true;
  var PX_PER_HOUR = 68;
  var DAY_START = 8;
  var DAY_END = 17;
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  var RESOURCES = {
    nithin: {
      id: 'nithin',
      name: 'Nithin',
      scoper_user_id: '5862cf1d-0a3b-4836-8fd1-d69f95aa2f73',
      lane: 'patio',
      sender: '+61489267774',
      sender_label: 'SecureWorks Patios 774',
      sender_resolved: true,
      sender_sources: ['secureworks-patio-scope-booking/SKILL.md'],
      desk_rules: { monday_from: 12, no_wednesday: true, last_start: 15.5, hours: '08:00-16:30 except Monday from 12:00, no Wednesday' }
    },
    marnin: {
      id: 'marnin',
      name: 'Marnin',
      scoper_user_id: '706c5258-70dd-483a-b36c-af6864b24498',
      lane: 'fencing',
      sender: null,
      sender_label: 'Unresolved Marnin sender (772 vs 776)',
      sender_resolved: false,
      sender_candidates: [
        { number: '+61489267772', label: 'SecureWorks Fencing Sales 772', source: 'CIO-to-FENCING_SALES-marnin-calendar-2026-09-11.md' },
        { number: '+61489267776', label: 'SecureWorks Group Ops 776', source: 'SALES-booking-page-audit.md; OPS.md automated booking-path exemption' }
      ],
      desk_rules: { monday_from: 8, no_wednesday: false, last_start: 15.5, hours: '08:00-16:30 Mon-Fri; Tuesday/Friday Stratco pattern is a fencing rule' }
    },
    khairo: {
      id: 'khairo',
      name: 'Khairo',
      scoper_user_id: 'be6c2188-2b7b-49c7-b6e4-5b0d0deb6415',
      lane: 'fencing',
      sender: '+61489267772',
      sender_label: 'SecureWorks Fencing Sales 772',
      sender_resolved: true,
      sender_sources: ['OPS.md fencing sales line'],
      desk_rules: { monday_from: 8, no_wednesday: false, last_start: 15.5, hours: '08:00-16:30 Mon-Fri; Calendly is not this calendar' }
    }
  };

  var state = {
    subtab: 'booking',
    resourceId: 'nithin',
    weekStart: '2026-09-14',
    loading: false,
    error: null,
    data: null,
    request: 0,
    selectedId: null,
    filter: 'all',
    search: '',
    layers: { confirmed: true, proposal: true, offer: true, availability: true },
    conversation: { contactId: null, caseId: null, loading: false, error: null, messages: [], generation: 0 },
    drafts: {},
    archives: {},
    sendAttempted: false,
    lastSendCall: null,
    lastArchiveCall: null
  };
  var convoAbort = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resource() {
    return RESOURCES[state.resourceId] || RESOURCES.nithin;
  }

  function resolveSender(res) {
    res = res || resource();
    if (res.sender_resolved === false) {
      return {
        resolved: false,
        number: null,
        label: res.sender_label || 'Sender unresolved',
        candidates: res.sender_candidates || [],
        reason: 'Authoritative sources disagree. Do not guess a line.'
      };
    }
    return {
      resolved: true,
      number: res.sender,
      label: res.sender_label,
      candidates: [],
      sources: res.sender_sources || []
    };
  }

  function mondayIso(iso) {
    var parts = String(iso).slice(0, 10).split('-').map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    var day = new Date(utc).getUTCDay();
    var delta = day === 0 ? -6 : 1 - day;
    var m = new Date(utc);
    m.setUTCDate(m.getUTCDate() + delta);
    return m.toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    var d = new Date(iso + 'T12:00:00+08:00');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function hourFromIso(iso) {
    if (!iso) return null;
    var m = String(iso).match(/T(\d{2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) + Number(m[2]) / 60;
  }

  function dayIndexFromIso(iso, weekStart) {
    if (!iso) return null;
    var date = String(iso).slice(0, 10);
    for (var i = 0; i < 5; i++) if (addDays(weekStart, i) === date) return i;
    return null;
  }

  function durationHours(startIso, endIso) {
    var a = hourFromIso(startIso);
    var b = hourFromIso(endIso);
    if (a == null || b == null) return 1;
    return Math.max(0.25, b - a);
  }

  function topPx(hour) {
    return (hour - DAY_START) * PX_PER_HOUR;
  }

  function cases() {
    return (state.data && state.data.cases) || [];
  }

  function events() {
    return (state.data && state.data.events) || [];
  }

  function selectedCase() {
    var id = state.selectedId;
    if (!id) return null;
    var list = cases();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function statusLabel(s) {
    return ({
      booked: 'Booked',
      confirmed: 'Booked',
      proposal: 'Ready to contact',
      offer: 'Waiting for reply',
      waiting: 'Waiting for reply',
      follow_up: 'Follow-up due',
      needs_decision: 'Needs a decision',
      repair: 'Needs a decision',
      ready: 'Ready to contact'
    })[s] || s || 'Needs a decision';
  }

  function isArchived(c) {
    return !!(c && (c.archived && !c.archived.restored || state.archives[c.id] && !state.archives[c.id].restored));
  }

  function isCompleted(c) {
    return !!(c && c.completed);
  }

  function matchesFilter(c) {
    var f = state.filter;
    if (f === 'archived') return isArchived(c);
    if (f === 'completed') return isCompleted(c);
    if (isArchived(c) || isCompleted(c)) return false;
    if (f === 'all') return true;
    if (f === 'ready') return c.status === 'proposal' || c.status === 'ready';
    if (f === 'waiting') return c.status === 'offer' || c.status === 'waiting';
    if (f === 'follow_up') return c.status === 'follow_up';
    if (f === 'booked') return c.status === 'booked' || c.status === 'confirmed';
    if (f === 'needs_decision') return c.status === 'needs_decision' || c.status === 'repair';
    return true;
  }

  function acceptedSlotStillCurrent(c) {
    if (!c || !c.exact_acceptance) return false;
    if (!c.accepted_start_iso || !c.proposal || !c.proposal.start_iso) return false;
    if (c.accepted_start_iso !== c.proposal.start_iso) return false;
    if (c.accepted_end_iso && c.proposal.end_iso && c.accepted_end_iso !== c.proposal.end_iso) return false;
    if (c.accepted_offer_id && c.proposal.offer_id && c.accepted_offer_id !== c.proposal.offer_id) return false;
    return true;
  }

  function actionKind(c) {
    if (!c) return 'none';
    if (c.status === 'repair') return 'repair';
    if (acceptedSlotStillCurrent(c) && c.status !== 'booked') return 'confirm_booking';
    if (c.status === 'booked') return 'none';
    return 'approve_offer';
  }

  function applyInboundReply(kind) {
    var c = selectedCase();
    if (!c) return { ok: false, reason: 'no_case' };
    var previous = c.status;
    if (kind === 'acceptance') {
      c.exact_acceptance = true;
      c.accepted_start_iso = c.proposal && c.proposal.start_iso || null;
      c.accepted_end_iso = c.proposal && c.proposal.end_iso || null;
      c.accepted_offer_id = c.proposal && c.proposal.offer_id || c.accepted_offer_id || null;
      c.status = 'needs_decision';
    } else if (kind === 'decline' || kind === 'new_availability') {
      c.exact_acceptance = false;
      c.status = 'ready';
    } else if (kind === 'cancellation') {
      c.exact_acceptance = false;
      c.status = 'repair';
    } else {
      c.status = 'needs_decision';
    }
    return {
      ok: true,
      previous: previous,
      status: c.status,
      action: actionKind(c),
      event_id: c.event_id || null,
      contact_id: c.contact_id
    };
  }

  function markSendResult(result) {
    var c = selectedCase();
    if (!c) return { ok: false, waiting: false };
    c.send_evidence = result;
    if (result === 'sent') c.status = 'waiting';
    return { ok: true, status: c.status, waiting: c.status === 'waiting' || c.status === 'offer', send_evidence: result };
  }

  function hasBlockingCommitment(c) {
    if (!c) return false;
    if (c.event_id) return true;
    if (c.proposal && (c.status === 'waiting' || c.status === 'offer')) return true;
    if (c.proposal && (c.exact_acceptance || c.accepted_start_iso)) return true;
    if (c.proposal && (c.send_evidence === 'sent' || c.status === 'follow_up')) return true;
    return false;
  }

  function suggestedDraft(c) {
    if (!c || !c.proposal || !c.proposal.start_iso) return '';
    var iso = c.proposal.start_iso;
    var date = String(iso).slice(0, 10);
    var hm = String(iso).slice(11, 16);
    var hour = Number(hm.slice(0, 2));
    var min = hm.slice(3);
    var ampm = hour >= 12 ? 'pm' : 'am';
    var h12 = hour % 12 || 12;
    var time = h12 + ':' + min + ampm;
    var suburb = c.suburb || 'the site';
    var who = resource().name;
    var lane = resource().lane === 'patio' ? 'SecureWorks Patios' : 'SecureWorks Fencing';
    return 'Hi, ' + date + ' at ' + time + ' in ' + suburb + ' works for me. Can someone be there then? ' + who + ', ' + lane;
  }

  function addHourIso(iso) {
    var hour = hourFromIso(iso);
    if (hour == null) return iso;
    var next = hour + 1;
    var h = Math.floor(next);
    var m = Math.round((next - h) * 60);
    var date = String(iso).slice(0, 10);
    return date + 'T' + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':00';
  }

  function reviseProposedTime(startIso) {
    var c = selectedCase();
    if (!c || !c.proposal) return { ok: false, reason: 'no_proposal' };
    var slotChanged = c.proposal.start_iso !== startIso || (c.accepted_end_iso && c.proposal.end_iso && c.accepted_end_iso !== c.proposal.end_iso);
    c.proposal.start_iso = startIso;
    c.proposal.end_iso = addHourIso(startIso);
    c.proposal.revision = (c.proposal.revision || 0) + 1;
    if (slotChanged && c.exact_acceptance && c.accepted_start_iso && c.accepted_start_iso !== startIso) {
      c.exact_acceptance = false;
      c.acceptance_invalidated = true;
      if (c.status === 'needs_decision') c.status = 'ready';
    }
    var d = draftFor(c);
    var suggested = suggestedDraft(c);
    if (d.humanEdited && d.text && d.text !== suggested) {
      d.conflict = true;
      d.suggested = suggested;
      d.revision = (d.revision || 0) + 1;
    } else {
      d.text = suggested;
      d.conflict = false;
      d.suggested = suggested;
      d.revision = (d.revision || 0) + 1;
      c.proposal.draft = suggested;
    }
    var route = resolveSender();
    d.sender = route.number;
    return { ok: true, conflict: !!d.conflict, revision: d.revision, text: d.text, suggested: suggested, exact_acceptance: !!c.exact_acceptance };
  }

  function archiveCase(reason, note) {
    var c = selectedCase();
    if (!c) return { ok: false, reason: 'no_case', crm_deleted: false };
    if (hasBlockingCommitment(c)) {
      state.lastArchiveCall = { ok: false, reason: 'commitment_visible', contact_id: c.contact_id, crm_deleted: false };
      return state.lastArchiveCall;
    }
    if (!reason) return { ok: false, reason: 'reason_required', crm_deleted: false };
    var rec = { reason: reason, note: note || '', at: new Date().toISOString(), actor: 'preview', restored: false, contact_id: c.contact_id };
    state.archives[c.id] = rec;
    c.archived = rec;
    state.lastArchiveCall = { ok: true, contact_id: c.contact_id, crm_deleted: false, reason: reason };
    return state.lastArchiveCall;
  }

  function restoreCase(id) {
    var rec = state.archives[id];
    var list = cases();
    var c = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) c = list[i];
    if (!c && !rec) return { ok: false, reason: 'not_archived' };
    if (rec) rec.restored = true;
    if (c && c.archived) c.archived.restored = true;
    return { ok: true, contact_id: (c && c.contact_id) || (rec && rec.contact_id), crm_deleted: false };
  }

  function matchesSearch(c) {
    var q = (state.search || '').trim().toLowerCase();
    if (!q) return true;
    return [c.display_name, c.suburb, c.contact_id, c.reason].join(' ').toLowerCase().indexOf(q) >= 0;
  }

  function visibleCases() {
    return cases().filter(function (c) { return matchesFilter(c) && matchesSearch(c); });
  }

  function root() {
    return global.document && global.document.getElementById('salesBookingRoot');
  }

  function draftKey(c) {
    if (!c) return '';
    return c.id || '';
  }

  function draftFor(c) {
    var key = typeof c === 'string' ? c : draftKey(c);
    if (!key) return { text: '', revision: 0, humanEdited: false, sender: null };
    if (!state.drafts[key]) state.drafts[key] = { text: '', revision: 0, humanEdited: false, sender: null, case_id: key };
    return state.drafts[key];
  }

  function bindDraft(c) {
    if (!c || !draftKey(c)) return;
    var d = draftFor(c);
    if (d.humanEdited) return;
    if (d.revision > 0) return;
    d.text = (c.proposal && c.proposal.draft) || d.text || '';
    d.sender = resolveSender().number;
  }

  function coverageGaps(data) {
    var gaps = [];
    if (!data) return ['No booking workspace read yet.'];
    var cov = data.coverage || {};
    (cov.gaps || []).forEach(function (g) { gaps.push(g); });
    if (cov.operational_leave === 'not_read' || (data.resource && data.resource.calendar && data.resource.calendar.leave === 'not_read')) {
      gaps.push('Operational leave was not read.');
    }
    if (cov.non_primary_calendars === 'not_read') gaps.push('Other calendars were not read.');
    if (cov.full_population !== true) gaps.push('This queue is not the full enquiry population.');
    if (!data.events) gaps.push('No provider events in this response.');
    return gaps;
  }

  function renderQueue() {
    var list = visibleCases();
    if (!list.length) {
      return '<div class="emptyqueue">' + (state.loading ? 'Loading cases…' : 'No cases in this filter. Empty is not a completed audit.') + '</div>';
    }
    return list.map(function (c) {
      return '<button type="button" class="lead" data-booking-case="' + esc(c.id) + '" aria-pressed="' + (c.id === state.selectedId) + '">' +
        '<div style="display:flex;justify-content:space-between;gap:8px"><span class="leadname">' + esc(c.display_name || 'Unnamed enquiry') + '</span><span class="status ' + esc(c.status || '') + '">' + esc(statusLabel(c.status)) + '</span></div>' +
        '<div class="location">' + esc(c.suburb || 'Suburb unknown') + '</div></button>';
    }).join('');
  }

  function renderEvent(block, kind) {
    if (!state.layers[kind] && kind !== 'confirmed') return '';
    if (kind === 'confirmed' && !state.layers.confirmed) return '';
    var hour = hourFromIso(block.start_iso);
    var day = dayIndexFromIso(block.start_iso, state.weekStart);
    if (hour == null || day == null) return '';
    var h = durationHours(block.start_iso, block.end_iso);
    var cls = 'event ' + kind + (block.id === state.selectedId ? ' selected' : '');
    return '<button type="button" class="' + cls + '" data-booking-case="' + esc(block.id) + '" style="top:' + topPx(hour) + 'px;height:' + (h * PX_PER_HOUR) + 'px">' +
      '<span class="evtime">' + esc(String(block.start_iso).slice(11, 16)) + '</span>' +
      '<span class="evname">' + esc(block.display_name || block.subject || 'Diary') + '</span>' +
      '<span class="evplace">' + esc(block.suburb || '') + '</span>' +
      '<span class="eventlabel">' + esc(kind === 'proposal' ? 'Unsent proposal' : kind === 'offer' ? 'Outstanding offer' : 'Provider event') + '</span></button>';
  }

  function renderWindows(c) {
    if (!state.layers.availability || !c.proposal || !c.proposal.window_start_iso) return '';
    var hour = hourFromIso(c.proposal.window_start_iso);
    var day = dayIndexFromIso(c.proposal.window_start_iso, state.weekStart);
    if (hour == null || day == null) return '';
    var h = durationHours(c.proposal.window_start_iso, c.proposal.window_end_iso || c.proposal.window_start_iso);
    return '<div class="window" style="top:' + topPx(hour) + 'px;height:' + Math.max(24, h * PX_PER_HOUR) + 'px"><b>Window</b>' + esc(c.proposal.window_label || '') + '</div>';
  }

  function renderCalendar() {
    var data = state.data;
    var res = resource();
    var cal = data && data.resource && data.resource.calendar;
    if (data && cal && cal.ok === false) {
      return '<div class="unknownstaff"><h3>Calendar not connected</h3><p>' + esc(cal.error || 'This resource has no verified provider calendar.') + '</p><p class="small">Missing coverage is not a free week.</p></div>';
    }
    var headers = '<div class="timezonelabel small">AWST</div>' + DAYS.map(function (name, i) {
      var iso = addDays(state.weekStart, i);
      var off = res.desk_rules.no_wednesday && i === 2;
      return '<div class="dayheader' + (off ? ' off' : '') + '">' + name.slice(0, 3) + '<b>' + iso.slice(8, 10) + '</b></div>';
    }).join('');
    var cols = '';
    for (var d = 0; d < 5; d++) {
      var off = res.desk_rules.no_wednesday && d === 2;
      var mondayBlock = res.desk_rules.monday_from > DAY_START && d === 0
        ? '<div class="block" style="top:0;height:' + ((res.desk_rules.monday_from - DAY_START) * PX_PER_HOUR) + 'px"><strong>Mon from 12:00</strong></div>'
        : '';
      var wed = off ? '<div class="block off"><strong>Unavailable</strong><span>Desk rule</span></div>' : mondayBlock;
      var body = '';
      events().forEach(function (ev) {
        if (dayIndexFromIso(ev.start_iso, state.weekStart) !== d) return;
        body += renderEvent({
          id: ev.case_id || ev.event_id,
          start_iso: ev.start_iso,
          end_iso: ev.end_iso,
          display_name: ev.display_name || ev.subject,
          suburb: ev.suburb || '',
          subject: ev.subject
        }, ev.layer || 'confirmed');
      });
      cases().forEach(function (c) {
        if (!c.proposal || dayIndexFromIso(c.proposal.start_iso, state.weekStart) !== d) return;
        var heldOffer = c.status === 'offer' || c.status === 'waiting' || c.status === 'follow_up' || c.send_evidence === 'sent' || ((c.exact_acceptance || c.accepted_start_iso) && !c.event_id);
        if (heldOffer) {
          body += renderWindows(c);
          body += renderEvent({
            id: c.id,
            start_iso: c.proposal.start_iso,
            end_iso: c.proposal.end_iso,
            display_name: c.display_name,
            suburb: c.suburb
          }, 'offer');
          return;
        }
        if (c.status === 'proposal' || c.status === 'ready' || c.status === 'needs_decision') {
          body += renderWindows(c);
          body += renderEvent({
            id: c.id,
            start_iso: c.proposal.start_iso,
            end_iso: c.proposal.end_iso,
            display_name: c.display_name,
            suburb: c.suburb
          }, 'proposal');
        }
      });
      cols += '<div class="daycolumn">' + wed + body + '</div>';
    }
    var times = '';
    for (var h = DAY_START; h <= DAY_END; h++) {
      times += '<div class="time small" style="position:absolute;right:6px;top:' + topPx(h) + 'px;transform:translateY(-50%)">' + (h < 10 ? '0' : '') + h + ':00</div>';
    }
    var evCount = events().length;
    var info = '<span>' + evCount + ' provider event' + (evCount === 1 ? '' : 's') + '</span>';
    if (evCount === 0) info += '<span class="repairtext">Empty diary is not spare capacity. Leave unread.</span>';
    return '<div class="layers">' +
      '<label class="layer"><input type="checkbox" data-booking-layer="confirmed"' + (state.layers.confirmed ? ' checked' : '') + '> Diary</label>' +
      '<label class="layer"><input type="checkbox" data-booking-layer="proposal"' + (state.layers.proposal ? ' checked' : '') + '> AI proposals</label>' +
      '<label class="layer"><input type="checkbox" data-booking-layer="offer"' + (state.layers.offer ? ' checked' : '') + '> Offers</label>' +
      '<label class="layer"><input type="checkbox" data-booking-layer="availability"' + (state.layers.availability ? ' checked' : '') + '> Window</label></div>' +
      '<div class="calendarinfo">' + info + '</div>' +
      '<div class="dayheaders">' + headers + '</div>' +
      '<div class="calendarbody"><div class="timeaxis" style="position:relative">' + times + '</div>' + cols + '</div>' +
      '<div class="dayselect">' + DAYS.map(function (name, i) {
        return '<button type="button" data-booking-day="' + i + '">' + name.slice(0, 3) + '<b>' + addDays(state.weekStart, i).slice(8, 10) + '</b></button>';
      }).join('') + '</div>' +
      '<div class="dayagenda">' + renderAgenda() + '</div>' +
      '<div class="calendarfoot">Solid blocks are provider events with actual duration. Dashed blocks are unsent proposals. Dotted blocks are outstanding offers. A window is not acceptance. Leave and other calendars are not in this read.</div>';
  }

  function renderAgenda() {
    var items = events().concat(cases().filter(function (c) { return c.proposal; }).map(function (c) {
      return { start_iso: c.proposal.start_iso, display_name: c.display_name, suburb: c.suburb, id: c.id, layer: c.status === 'offer' ? 'offer' : 'proposal' };
    }));
    items.sort(function (a, b) { return String(a.start_iso) < String(b.start_iso) ? -1 : 1; });
    if (!items.length) return '<div class="emptyqueue">No provider events or proposals in this week.</div>';
    return items.map(function (it) {
      return '<button type="button" class="lead" data-booking-case="' + esc(it.id || it.event_id) + '"><strong>' + esc(String(it.start_iso || '').slice(11, 16)) + '</strong> ' + esc(it.display_name || it.subject || '') + ' · ' + esc(it.suburb || '') + '</button>';
    }).join('');
  }

  function renderMessages() {
    var conv = state.conversation;
    var selected = selectedCase();
    if (!selected || !selected.contact_id) return '<div class="comms-empty">No GHL contact on this case. Thread is not shown.</div>';
    if (conv.contactId && conv.contactId !== selected.contact_id) return '<div class="comms-empty">Thread belongs to another case; it is not shown.</div>';
    if (conv.loading) return '<div class="comms-empty">Loading conversation…</div>';
    if (conv.error) return '<div class="comms-empty">Conversation failed: ' + esc(conv.error) + '</div>';
    if (!conv.contactId) return '<div class="comms-empty">Select a case with a GHL contact to open the thread.</div>';
    if (!conv.messages || !conv.messages.length) return '<div class="comms-empty">No messages in this bounded read. Pagination limits still apply.</div>';
    return conv.messages.map(function (msg) {
      var dir = msg.direction === 'outbound' ? 'outbound' : 'inbound';
      var ts = msg.timestamp ? String(msg.timestamp) : '';
      var type = String(msg.type || 'SMS');
      return '<div class="comms-msg ' + dir + '"><div>' + esc(msg.body || msg.subject || type) + '</div><div class="comms-msg-meta">' + esc(ts) + (msg.sender_name ? ' · ' + esc(msg.sender_name) : '') + ' · ' + esc(type) + '</div></div>';
    }).join('');
  }

  function renderDetail() {
    var c = selectedCase();
    var res = resource();
    if (!c) {
      return '<div class="detailhead"><p class="muted">No case selected</p><h2>Choose an enquiry</h2></div><div class="detailbody"><p class="muted">The thread, the interpreted window, and the draft stay together for one request.</p></div>';
    }
    bindDraft(c);
    var d = draftKey(c) ? draftFor(c) : { text: '' };
    var kind = actionKind(c);
    var holdNote = SEND_HOLD
      ? '<div class="holdnote">Send hold is active. This action does not send and does not write the diary.</div>'
      : '';
    var pick = c.proposal && c.proposal.start_iso ? String(c.proposal.start_iso).replace('T', ' ').slice(0, 16) : '';
    var windowLabel = (c.proposal && c.proposal.window_label) || 'No customer window extracted';
    var actionLabel = kind === 'confirm_booking' ? 'Confirm booking (held)' : kind === 'repair' ? 'Calendar repair (held)' : 'Approve offer (held)';
    var timeInput = c.proposal && c.proposal.start_iso
      ? '<label class="small muted">Proposed time<input data-booking-time type="text" value="' + esc(c.proposal.start_iso) + '" aria-label="Proposed time"></label>'
      : '<p class="small muted">No proposed time yet.</p>';
    var conflict = d.conflict
      ? '<div class="notice error">Time changed. Your edited draft was kept. Suggested text is ready for review, not applied.</div>'
      : '';
    var archiveBlock = hasBlockingCommitment(c)
      ? '<p class="small muted">Archive is blocked while a diary event or outstanding offer remains. Withdrawal is a separate held action.</p>'
      : '<div class="archive-row"><label class="small muted">Archive reason <select data-booking-archive-reason><option value="">Choose…</option><option value="out_of_service">Out of service</option><option value="declined">Declined</option><option value="duplicate">Duplicate</option><option value="no_longer_proceeding">No longer proceeding</option></select></label><button type="button" data-booking-archive="1">Archive</button></div>';
    if (isArchived(c)) archiveBlock = '<button type="button" data-booking-restore="' + esc(c.id) + '">Restore to workload</button>';
    return '<div class="detailhead"><span class="smalltag">' + esc(statusLabel(c.status)) + '</span><h2>' + esc(c.display_name || 'Enquiry') + '</h2><p class="muted">' + esc(c.suburb || '') + (c.contact_id ? '' : ' · no GHL contact') + '</p></div>' +
      '<div class="detailbody">' +
      '<div class="timing"><div><span>Customer window</span><strong>' + esc(windowLabel) + '</strong></div><div><span>Proposed time</span><strong>' + esc(pick || 'None') + '</strong></div>' + timeInput + '</div>' +
      '<div><h3>GHL conversation</h3><div class="thread" id="salesBookingThread">' + renderMessages() + '</div></div>' +
      '</div>' +
      '<div class="actionzone">' + holdNote + conflict +
      '<div class="senderline">' + senderLine(res) + ' · To this case only · Draft revision ' + esc((d.revision || 0)) + '</div>' +
      '<label class="small muted">Draft SMS</label>' +
      '<textarea data-booking-draft="1" aria-label="Draft SMS">' + esc(d.text || '') + '</textarea>' +
      '<button type="button" class="primary" data-booking-approve="1"' + (SEND_HOLD || kind === 'none' || !resolveSender(res).resolved ? ' disabled' : '') + '>' + esc(actionLabel) + '</button>' +
      archiveBlock +
      '<details class="inline-details"><summary>Evidence and coverage for this case</summary><p class="small muted">' + esc(c.reason || 'No reason filed') + (c.exact_acceptance ? ' Exact acceptance is recorded.' : ' Exact acceptance is not recorded.') + '</p></details>' +
      '<p class="small muted" style="margin-top:8px">Approve offer does not create a visit. Confirm booking needs exact acceptance and a fresh preflight. Both stay held.</p></div>';
  }

  function renderHTML() {
    var res = resource();
    var data = state.data;
    var cal = data && data.resource && data.resource.calendar;
    var mailbox = cal && cal.mailbox ? cal.mailbox : 'not retrieved';
    var notice = state.error
      ? '<div class="notice error" role="alert">' + esc(state.error) + '</div>'
      : (state.loading ? '<div class="notice" role="status">Reading the provider calendar…</div>' : '');
    var gaps = coverageGaps(data).map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('');
    return '<div class="page"><div class="pagehead"><div><h1>Build the week</h1><p>Customer windows, the diary, and the next conversation.</p></div>' +
      '<div class="right"><label class="stafflabel">Scoper <select data-booking-resource aria-label="Choose scoper">' +
      Object.keys(RESOURCES).map(function (id) {
        return '<option value="' + id + '"' + (id === state.resourceId ? ' selected' : '') + '>' + esc(RESOURCES[id].name) + '</option>';
      }).join('') +
      '</select></label></div></div>' + notice +
      '<div class="notice">Source ' + esc(mailbox) + ' · week of ' + esc(state.weekStart) + ' · Australia/Perth · rules: ' + esc(res.desk_rules.hours) + '</div>' +
      '<div class="workspace">' +
      '<section class="panel queue"><div class="panelhead"><h2>Unscoped work</h2><span class="count">' + visibleCases().length + '</span></div>' +
      '<div class="queuefilters"><div class="searchwrap"><input data-booking-search placeholder="Search" aria-label="Search enquiries" value="' + esc(state.search) + '"></div>' +
      '<select data-booking-filter aria-label="Filter work queue">' +
      [['all', 'All unscoped'], ['ready', 'Ready to contact'], ['waiting', 'Waiting for reply'], ['follow_up', 'Follow-up due'], ['booked', 'Booked'], ['needs_decision', 'Needs a decision'], ['archived', 'Archived'], ['completed', 'Completed']].map(function (opt) {
        return '<option value="' + opt[0] + '"' + (state.filter === opt[0] ? ' selected' : '') + '>' + opt[1] + '</option>';
      }).join('') +
      '</select></div><div class="queuelist">' + renderQueue() + '</div>' +
      '<div class="queuefoot">Not yet scoped, including booked visits until they happen.<br>CRM stage does not remove a row. Archive and completion are deliberate.</div></section>' +
      '<section class="panel calendar"><div class="calendarhead"><h2>' + esc(state.weekStart) + ' week</h2><p class="date">' + esc(res.name) + ' · ' + esc(res.desk_rules.hours) + '</p></div>' + renderCalendar() + '</section>' +
      '<aside class="panel detail" aria-label="Selected enquiry and GHL conversation">' + renderDetail() + '</aside></div>' +
      '<details class="notice" style="margin-top:16px"><summary>Coverage</summary><ul>' + gaps + '</ul>' +
      '<p class="small">495 opportunity rows remain an enumeration, not qualified visits. 152 stage-only unresolved cases stay on the audit queue.</p></details></div>';
  }

  function render() {
    var el = root();
    if (!el) return;
    el.innerHTML = renderHTML();
    var view = global.document.getElementById('viewSales');
    if (view) {
      view.classList.toggle('sales-sub-booking', state.subtab === 'booking');
      view.classList.toggle('sales-sub-performance', state.subtab === 'performance');
    }
  }

  function clearConversation() {
    state.conversation = { contactId: null, caseId: null, loading: false, error: null, messages: [], generation: state.conversation.generation + 1 };
    if (convoAbort && convoAbort.abort) convoAbort.abort();
    convoAbort = null;
  }

  function senderLine(res) {
    var route = resolveSender(res);
    if (!route.resolved) {
      var bits = (route.candidates || []).map(function (cand) { return cand.label + ' (' + cand.source + ')'; }).join(' vs ');
      return 'From unresolved: ' + esc(bits || route.label);
    }
    return 'From ' + esc(route.label) + ' (' + esc(route.number) + ')';
  }

  function selectCase(id) {
    state.selectedId = id;
    var c = selectedCase();
    if (!c || !c.contact_id) {
      clearConversation();
      render();
      return;
    }
    if (state.conversation.contactId !== c.contact_id || state.conversation.caseId !== c.id) {
      clearConversation();
      state.conversation.contactId = c.contact_id;
      state.conversation.caseId = c.id;
    }
    render();
    loadConversation(c.contact_id, c.id);
  }

  function switchResource(id) {
    if (!RESOURCES[id]) return;
    state.resourceId = id;
    state.selectedId = null;
    state.data = null;
    clearConversation();
    return load(id, state.weekStart);
  }

  async function bookingRead(params) {
    var preview = global.SALES_BOOKING_PREVIEW_URL;
    if (preview) {
      var url = preview + '?resource=' + encodeURIComponent(params.resource) + '&week_start=' + encodeURIComponent(params.week_start);
      var resp = await global.fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error('Preview calendar read failed (' + resp.status + ')');
      return resp.json();
    }
    if (typeof global.opsFetch !== 'function') throw new Error('Authenticated Ops read is not available.');
    return global.opsFetch('sales_booking_read', params);
  }

  async function load(resourceId, weekStart) {
    if (resourceId) state.resourceId = resourceId;
    if (weekStart) state.weekStart = mondayIso(weekStart);
    var request = ++state.request;
    state.loading = true;
    state.error = null;
    render();
    try {
      var data = await bookingRead({ resource: state.resourceId, week_start: state.weekStart, scoper_user_id: resource().scoper_user_id });
      if (request !== state.request) return;
      if (!data || data.ok === false) throw new Error((data && data.error) || 'Booking read was incomplete.');
      if (data.fixture) throw new Error('Fixture fallback is refused. Provider read required.');
      state.data = data;
      if (data.week_start) state.weekStart = data.week_start;
    } catch (e) {
      if (request !== state.request) return;
      state.error = e.message || 'Request failed';
      state.data = null;
    } finally {
      if (request === state.request) {
        state.loading = false;
        render();
      }
    }
  }

  async function loadConversation(contactId, caseId) {
    var generation = ++state.conversation.generation;
    state.conversation.contactId = contactId;
    state.conversation.caseId = caseId || null;
    state.conversation.loading = true;
    state.conversation.error = null;
    state.conversation.messages = [];
    if (convoAbort && convoAbort.abort) convoAbort.abort();
    convoAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    render();
    try {
      if (typeof global.opsAuthHeaders !== 'function') throw new Error('Sign in required for GHL conversation.');
      var base = global._commsGHLBase || ((global.window && global.window.SUPABASE_URL) ? global.window.SUPABASE_URL + '/functions/v1/ghl-proxy' : '');
      if (!base) throw new Error('GHL transport is not configured.');
      var headers = await global.opsAuthHeaders();
      var resp = await global.fetch(base + '?action=get_conversation&contactId=' + encodeURIComponent(contactId), {
        headers: headers,
        signal: convoAbort && convoAbort.signal
      });
      var data = await resp.json();
      if (generation !== state.conversation.generation) return;
      if (state.conversation.contactId !== contactId) return;
      if (caseId && state.conversation.caseId !== caseId) return;
      if (data.error) throw new Error(data.error);
      var msgs = data.messages || [];
      msgs.sort(function (a, b) { return String(a.timestamp || '') < String(b.timestamp || '') ? -1 : 1; });
      state.conversation.messages = msgs;
      state.conversation.loading = false;
    } catch (e) {
      if (generation !== state.conversation.generation) return;
      if (e && e.name === 'AbortError') return;
      state.conversation.loading = false;
      state.conversation.error = e.message || 'Conversation failed';
    }
    if (generation === state.conversation.generation) render();
  }

  function attemptApprove() {
    var c = selectedCase();
    var kind = actionKind(c);
    var d = c && draftKey(c) ? draftFor(c) : { text: '', revision: 0 };
    var route = resolveSender();
    var payload = {
      action: kind,
      case_id: c && c.id,
      contact_id: c && c.contact_id,
      sender: route.number,
      sender_resolved: route.resolved,
      resource: state.resourceId,
      revision: d.revision || 0,
      text: d.text || '',
      start_iso: c && c.proposal && c.proposal.start_iso,
      exact_acceptance: acceptedSlotStillCurrent(c)
    };
    state.lastSendCall = payload;
    if (!route.resolved) {
      return { ok: false, held: true, sent: false, booked: false, waiting: false, reason: 'sender_unresolved', action: kind };
    }
    if (kind === 'confirm_booking' && !payload.exact_acceptance) {
      return { ok: false, held: true, sent: false, booked: false, reason: 'no_exact_acceptance' };
    }
    if (SEND_HOLD) {
      state.sendAttempted = true;
      markSendResult('held');
      return { ok: false, held: true, sent: false, booked: false, waiting: false, reason: 'send_hold', action: kind };
    }
    markSendResult('uncertain');
    return { ok: false, held: false, sent: false, booked: false, waiting: false, reason: 'not_authorised', action: kind };
  }

  function showSales(tab) {
    state.subtab = tab === 'performance' ? 'performance' : 'booking';
    var view = global.document && global.document.getElementById('viewSales');
    if (view) {
      view.classList.add('active');
      view.classList.toggle('sales-sub-booking', state.subtab === 'booking');
      view.classList.toggle('sales-sub-performance', state.subtab === 'performance');
    }
    if (global.document && global.document.body) {
      global.document.body.classList.toggle('performance-view-active', state.subtab === 'performance');
      global.document.body.classList.toggle('sales-booking-view-active', state.subtab === 'booking');
    }
    if (state.subtab === 'performance') {
      if (global.SalesPerformance && global.SalesPerformance.load) global.SalesPerformance.load();
    } else {
      load(state.resourceId, state.weekStart);
    }
  }

  if (global.document) {
    global.document.addEventListener('click', function (e) {
      var tab = e.target.closest && e.target.closest('[data-sales-tab]');
      if (tab) {
        if (typeof global.showView === 'function') global.showView(tab.getAttribute('data-sales-tab'));
        else showSales(tab.getAttribute('data-sales-tab'));
        return;
      }
      var layer = e.target.closest && e.target.closest('[data-booking-layer]');
      if (layer && e.target.matches && e.target.matches('input[data-booking-layer]')) {
        state.layers[e.target.getAttribute('data-booking-layer')] = e.target.checked;
        render();
        return;
      }
      var approve = e.target.closest && e.target.closest('[data-booking-approve]');
      if (approve) {
        e.preventDefault();
        attemptApprove();
        render();
        return;
      }
      var arch = e.target.closest && e.target.closest('[data-booking-archive]');
      if (arch) {
        e.preventDefault();
        var reasonEl = root() && root().querySelector('[data-booking-archive-reason]');
        archiveCase(reasonEl && reasonEl.value, '');
        render();
        return;
      }
      var rest = e.target.closest && e.target.closest('[data-booking-restore]');
      if (rest) {
        e.preventDefault();
        restoreCase(rest.getAttribute('data-booking-restore'));
        render();
        return;
      }
      var lead = e.target.closest && e.target.closest('[data-booking-case]');
      if (lead && root() && root().contains(lead)) {
        selectCase(lead.getAttribute('data-booking-case'));
      }
    });
    global.document.addEventListener('change', function (e) {
      if (e.target.matches && e.target.matches('[data-booking-resource]')) switchResource(e.target.value);
      if (e.target.matches && e.target.matches('[data-booking-filter]')) {
        state.filter = e.target.value;
        render();
      }
      if (e.target.matches && e.target.matches('[data-booking-time]')) {
        reviseProposedTime(e.target.value);
        render();
      }
    });
    global.document.addEventListener('input', function (e) {
      if (e.target.matches && e.target.matches('[data-booking-search]')) {
        state.search = e.target.value;
        render();
      }
      if (e.target.matches && e.target.matches('[data-booking-draft]')) {
        var c = selectedCase();
        if (!c || !draftKey(c)) return;
        var d = draftFor(c);
        d.text = e.target.value;
        d.humanEdited = true;
        d.revision = (d.revision || 0) + 1;
        d.sender = resolveSender().number;
      }
    });
  }

  var api = {
    SEND_HOLD: SEND_HOLD,
    RESOURCES: RESOURCES,
    state: state,
    esc: esc,
    mondayIso: mondayIso,
    hourFromIso: hourFromIso,
    durationHours: durationHours,
    load: load,
    render: render,
    renderHTML: renderHTML,
    selectCase: selectCase,
    switchResource: switchResource,
    loadConversation: loadConversation,
    attemptApprove: attemptApprove,
    draftKey: draftKey,
    draftFor: draftFor,
    resolveSender: resolveSender,
    acceptedSlotStillCurrent: acceptedSlotStillCurrent,
    applyInboundReply: applyInboundReply,
    markSendResult: markSendResult,
    actionKind: actionKind,
    reviseProposedTime: reviseProposedTime,
    archiveCase: archiveCase,
    restoreCase: restoreCase,
    suggestedDraft: suggestedDraft,
    hasBlockingCommitment: hasBlockingCommitment,
    show: showSales,
    coverageGaps: coverageGaps,
    bookingRead: bookingRead
  };
  global.SalesBooking = api;
  global.SalesWorkspace = { show: showSales, subtab: function () { return state.subtab; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
