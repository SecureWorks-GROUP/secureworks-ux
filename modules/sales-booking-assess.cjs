'use strict';

var VERSION = 'sales-booking-assess-v1';
var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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
  var parts = String(iso).slice(0, 10).split('-').map(Number);
  var utc = Date.UTC(parts[0], parts[1] - 1, parts[2] + n);
  return new Date(utc).toISOString().slice(0, 10);
}

function hourFromIso(iso) {
  var m = String(iso || '').match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

function isoAt(date, hour) {
  var h = Math.floor(hour);
  var min = Math.round((hour - h) * 60);
  if (min === 60) { h += 1; min = 0; }
  return date + 'T' + (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min + ':00';
}

function sortMessages(messages) {
  return (messages || []).slice().sort(function (a, b) {
    return String(a.timestamp || '') < String(b.timestamp || '') ? -1 : 1;
  });
}

function bodyOf(msg) {
  return String((msg && (msg.body || msg.text || msg.subject)) || '');
}

function lastOf(messages, direction) {
  for (var i = messages.length - 1; i >= 0; i--) {
    if ((messages[i].direction || 'inbound') === direction) return messages[i];
  }
  return null;
}

function classifyInbound(text, lastOutbound) {
  var lower = String(text || '').toLowerCase();
  if (/cancel|can'?t do (tuesday|it|that)|don'?t come|not going ahead|call(ed)? it off/.test(lower)) {
    return 'cancellation';
  }
  if (/another (day|time)|different day|later in the week|can'?t do that time|not thursday|not friday/.test(lower)) {
    return 'new_availability';
  }
  var outbound = bodyOf(lastOutbound).toLowerCase();
  var offerPending = /\b(\d{1,2}(:\d{2})?\s*(am|pm)|thursday|friday|monday|tuesday)\b/.test(outbound);
  if (offerPending && /^(yes|yep|yeah|ok+|okay|that works|see you|perfect|confirmed)\b/.test(lower.trim())) {
    return 'acceptance';
  }
  if (offerPending && /\b(yes|that works|see you then|that'?s fine)\b/.test(lower)) {
    return 'acceptance';
  }
  return 'ordinary';
}

function extractWindows(text, weekStart) {
  var lower = String(text || '').toLowerCase();
  var windows = [];
  function weekdayOffset(name) {
    var idx = WEEKDAYS.indexOf(name);
    if (idx <= 0) return null;
    return idx - 1;
  }
  var after = /after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(lower);
  var before = /before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(lower);
  var at = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(lower);
  function hourFromMatch(m, fallback) {
    if (!m) return fallback;
    var h = Number(m[1]);
    var min = m[2] ? Number(m[2]) : 0;
    var ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap && h <= 7) h += 12;
    return h + min / 60;
  }
  var names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  names.forEach(function (name) {
    if (lower.indexOf(name) === -1 && !(name === 'thursday' && /thu\b/.test(lower)) && !(name === 'friday' && /fri\b/.test(lower))) return;
    var day = addDays(weekStart, weekdayOffset(name));
    var start = 8;
    var end = 16.5;
    if (/morning/.test(lower)) { start = 8; end = 11; }
    if (/afternoon/.test(lower) || /after lunch/.test(lower)) { start = 13; end = 16.5; }
    if (after) start = Math.max(start, hourFromMatch(after, start));
    if (before) end = Math.min(end, hourFromMatch(before, end));
    if (at && !after && !before) {
      var h = hourFromMatch(at, 9);
      start = h;
      end = Math.min(16.5, h + 2);
    }
    if (end <= start) end = Math.min(16.5, start + 2);
    windows.push({
      start_iso: isoAt(day, start),
      end_iso: isoAt(day, end),
      label: name + ' ' + start + '–' + end
    });
  });
  if (!windows.length && /morning|afternoon|after \d|before \d/.test(lower)) {
    windows.push({
      start_iso: isoAt(weekStart, /afternoon/.test(lower) ? 13 : 8),
      end_iso: isoAt(weekStart, /afternoon/.test(lower) ? 16.5 : 11),
      label: 'weekday window, day not specified'
    });
  }
  return windows;
}

function overlaps(startA, endA, startB, endB) {
  return !(endA <= startB || endB <= startA);
}

function occupiedRanges(events, offers) {
  var ranges = [];
  (events || []).concat(offers || []).forEach(function (ev) {
    var s = ev.start_iso || ev.start;
    var e = ev.end_iso || ev.end;
    if (s && e) ranges.push({ start: s, end: e });
  });
  return ranges;
}

function legalStart(hour, rules, dayIndex) {
  if (hour < 8 || hour > (rules.last_start != null ? rules.last_start : 15.5)) return false;
  if (rules.no_wednesday && dayIndex === 2) return false;
  if (dayIndex === 0 && rules.monday_from != null && hour < rules.monday_from) return false;
  return true;
}

function proposeSlot(windows, events, offers, rules, weekStart) {
  var busy = occupiedRanges(events, offers);
  var starts = [];
  (windows || []).forEach(function (w) {
    var day = String(w.start_iso).slice(0, 10);
    var dayIndex = Math.round((new Date(day + 'T00:00:00Z') - new Date(weekStart + 'T00:00:00Z')) / 86400000);
    var from = hourFromIso(w.start_iso);
    var to = hourFromIso(w.end_iso);
    if (from == null || to == null) return;
    for (var h = from; h + 1 <= to + 0.001; h += 0.25) {
      if (!legalStart(h, rules || {}, dayIndex)) continue;
      var start = isoAt(day, h);
      var end = isoAt(day, h + 1);
      var clash = busy.some(function (b) { return overlaps(start, end, b.start, b.end); });
      if (!clash) {
        starts.push({ start_iso: start, end_iso: end, window_start_iso: w.start_iso, window_end_iso: w.end_iso, window_label: w.label });
        break;
      }
    }
  });
  return starts[0] || null;
}

function suggestedDraft(slot, suburb, resource) {
  if (!slot) return '';
  var hm = String(slot.start_iso).slice(11, 16);
  var hour = Number(hm.slice(0, 2));
  var min = hm.slice(3);
  var ampm = hour >= 12 ? 'pm' : 'am';
  var h12 = hour % 12 || 12;
  var who = (resource && resource.name) || 'SecureWorks';
  var lane = resource && resource.lane === 'fencing' ? 'SecureWorks Fencing' : 'SecureWorks Patios';
  return 'Hi, ' + String(slot.start_iso).slice(0, 10) + ' at ' + h12 + ':' + min + ampm + ' in ' + (suburb || 'the site') + ' works for me. Can someone be there then? ' + who + ', ' + lane;
}

function assess(input) {
  input = input || {};
  var messages = sortMessages(input.messages);
  var lastIn = lastOf(messages, 'inbound');
  var lastOut = lastOf(messages, 'outbound');
  var inboundText = bodyOf(lastIn);
  var replyKind = lastIn ? classifyInbound(inboundText, lastOut) : 'none';
  var weekStart = mondayIso(input.week_start || new Date().toISOString().slice(0, 10));
  var windows = extractWindows(inboundText + ' ' + bodyOf(lastOut), weekStart);
  var tags = (input.tags || []).map(function (t) { return String(t).toLowerCase(); });
  var wrongLane = input.resource && input.resource.lane === 'patio' && tags.some(function (t) { return t.indexOf('fencing') >= 0 && t.indexOf('patio') < 0; });
  var quoted = !!input.quoted;
  var rules = (input.resource && input.resource.desk_rules) || { monday_from: 12, no_wednesday: true, last_start: 15.5 };
  var slot = null;
  var status = 'needs_decision';
  var exact = false;
  var reason = 'Unreviewed. Conversation has not produced a next action yet.';

  if (wrongLane) {
    status = 'needs_decision';
    reason = 'Lane is unresolved. Do not send Patio-branded outreach.';
  } else if (quoted) {
    status = 'needs_decision';
    reason = 'Already quoted. Confirm whether this is a new request before offering a visit.';
  } else if (replyKind === 'cancellation') {
    status = 'repair';
    reason = 'Customer cancelled or withdrew. Diary commitment stays until authorised repair readback.';
  } else if (replyKind === 'acceptance') {
    status = 'needs_decision';
    exact = true;
    reason = 'Exact acceptance of the preceding offer. Confirm booking is the next action.';
    if (lastOut) windows = windows.concat(extractWindows(bodyOf(lastOut), weekStart));
  } else if (replyKind === 'new_availability' || replyKind === 'ordinary' || replyKind === 'none') {
    slot = proposeSlot(windows, input.events, input.pending_offers, rules, weekStart);
    var leftWaiting = (input.prior_status === 'waiting' || input.prior_status === 'follow_up' || input.prior_status === 'offer') && replyKind === 'ordinary';
    if (leftWaiting) {
      status = 'needs_decision';
      reason = 'New reply left waiting/follow-up. Recalculate the next action from this message.';
    } else if (slot && windows.length) {
      status = 'ready';
      reason = 'Customer window supports a proposed offer. This is not exact acceptance.';
    } else if (!windows.length) {
      status = 'needs_decision';
      reason = 'No customer window extracted. Needs a decision or more information.';
    } else {
      status = 'ready';
      reason = 'Window extracted. Proposed time is a suggestion, not a booking.';
    }
  }

  if (input.send_evidence && input.send_evidence !== 'sent' && status === 'waiting') {
    status = 'ready';
    reason = 'Send is not evidenced. Cannot sit in Waiting for reply.';
  }
  if (input.send_evidence === 'sent' && !lastIn) {
    status = 'waiting';
    reason = 'Offer sent; waiting for reply.';
    slot = slot || (input.outstanding_offer || null);
  }

  var draft = suggestedDraft(slot, input.suburb, input.resource);
  return {
    version: VERSION,
    week_start: weekStart,
    reply_kind: replyKind,
    exact_acceptance: exact,
    status: status,
    reason: reason,
    windows: windows,
    proposal: slot ? {
      start_iso: slot.start_iso,
      end_iso: slot.end_iso,
      window_start_iso: slot.window_start_iso,
      window_end_iso: slot.window_end_iso,
      window_label: slot.window_label,
      draft: draft,
      kind: exact ? 'accepted' : 'proposal'
    } : null,
    draft: draft,
    evidence: {
      last_inbound_at: lastIn && lastIn.timestamp || null,
      last_outbound_at: lastOut && lastOut.timestamp || null,
      message_count: messages.length,
      wrong_lane: wrongLane,
      quoted: quoted
    }
  };
}

function applyReplyToStatus(currentStatus, replyKind) {
  if (replyKind === 'acceptance') return { status: 'needs_decision', exact_acceptance: true, action: 'confirm_booking' };
  if (replyKind === 'new_availability' || replyKind === 'decline') return { status: 'ready', exact_acceptance: false, action: 'approve_offer' };
  if (replyKind === 'cancellation') return { status: 'repair', exact_acceptance: false, action: 'repair' };
  if (currentStatus === 'waiting' || currentStatus === 'follow_up' || currentStatus === 'offer') {
    return { status: 'needs_decision', exact_acceptance: false, action: 'approve_offer' };
  }
  return { status: currentStatus || 'needs_decision', exact_acceptance: false, action: 'approve_offer' };
}

module.exports = {
  VERSION: VERSION,
  mondayIso: mondayIso,
  classifyInbound: classifyInbound,
  extractWindows: extractWindows,
  proposeSlot: proposeSlot,
  assess: assess,
  applyReplyToStatus: applyReplyToStatus,
  suggestedDraft: suggestedDraft
};
