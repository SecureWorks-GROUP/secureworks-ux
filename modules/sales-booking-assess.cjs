'use strict';

var VERSION = 'sales-booking-assess-v2.1';
var INTERPRETER_FALLBACK = 'conservative-fallback';
var TZ_PERTH = 'Australia/Perth';
var MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8,
  sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
};
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

function bodyOf(msg) {
  return String((msg && (msg.body || msg.text || msg.subject)) || '');
}

function hasOffset(iso) {
  return /Z$|[+-]\d{2}:\d{2}$/.test(String(iso || ''));
}

function toInstant(iso) {
  if (!iso) return null;
  var s = String(iso);
  if (hasOffset(s)) {
    var ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    var msPerth = Date.parse(s + '+08:00');
    return Number.isFinite(msPerth) ? msPerth : null;
  }
  return null;
}

function perthParts(ms) {
  var fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ_PERTH,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  var map = {};
  fmt.formatToParts(new Date(ms)).forEach(function (p) { map[p.type] = p.value; });
  return {
    date: map.year + '-' + map.month + '-' + map.day,
    hour: Number(map.hour) + Number(map.minute) / 60
  };
}

function isoPerth(date, hour) {
  var h = Math.floor(hour);
  var min = Math.round((hour - h) * 60);
  if (min === 60) { h += 1; min = 0; }
  var local = date + 'T' + (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min + ':00';
  return { local: local, instant: toInstant(local) };
}

function sortMessages(messages) {
  return (messages || []).slice().sort(function (a, b) {
    var ia = toInstant(a.timestamp) || 0;
    var ib = toInstant(b.timestamp) || 0;
    if (ia !== ib) return ia - ib;
    return String(a.id || '') < String(b.id || '') ? -1 : 1;
  });
}

function yearFrom(input) {
  var w = String(input.week_start || '').slice(0, 4);
  if (w) return Number(w);
  return 2026;
}

function parseClock(text) {
  var m = String(text).toLowerCase().match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!m) return null;
  var h = Number(m[1]);
  var min = m[2] ? Number(m[2]) : 0;
  var ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h + min / 60;
}

function parseExplicitDate(text, year) {
  var t = String(text);
  var iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  var named = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i);
  if (!named) named = t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (!named) return null;
  var day, month;
  if (MONTHS[named[1].toLowerCase()] != null) {
    month = MONTHS[named[1].toLowerCase()];
    day = Number(named[2]);
  } else {
    day = Number(named[1]);
    month = MONTHS[named[2].toLowerCase()];
  }
  if (month == null || !day) return null;
  var dt = new Date(Date.UTC(year, month, day));
  return dt.toISOString().slice(0, 10);
}

function weekdayName(text) {
  var lower = String(text).toLowerCase();
  for (var i = 1; i <= 5; i++) {
    if (lower.indexOf(WEEKDAYS[i]) >= 0) return WEEKDAYS[i];
  }
  return null;
}

function negatedCancel(text) {
  return /\b(do not|don't|dont|please do not|please don't|not to)\s+cancel\b/i.test(text);
}

function isUnqualifiedYes(text) {
  var t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (/\b(but|only|except|unless|after|before|if |maybe|might|not sure)\b/.test(t)) return false;
  return /^(yes that works|yes please|yes|yep|yeah|ok|okay|that works|see you( then)?|perfect|confirmed)[.! ]*$/.test(t);
}

function isExplicitCancel(text) {
  if (negatedCancel(text)) return false;
  return /\b(cancel(led)?|call(ed)? it off|not going ahead|can't make( it)?|cannot make( it)?)\b/i.test(text);
}

function coverageReady(coverage) {
  if (!coverage) return false;
  if (coverage.calendar === false) return false;
  if (coverage.leave === 'unavailable' || coverage.leave === 'not_read' || coverage.leave === false) return false;
  if (coverage.route === false || coverage.travel === false) return false;
  if (coverage.calendar !== true) return false;
  if (coverage.leave !== true && coverage.leave !== 'read') return false;
  if (coverage.route !== true && coverage.travel !== true) return false;
  return true;
}

function rangeOverlap(aStart, aEnd, bStart, bEnd) {
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return true;
  return !(aEnd <= bStart || bEnd <= aStart);
}

function busyInstants(events, offers) {
  var out = [];
  (events || []).concat(offers || []).forEach(function (ev) {
    var s = toInstant(ev.start_iso || ev.start);
    var e = toInstant(ev.end_iso || ev.end);
    if (s == null || e == null) return;
    out.push({ start: s, end: e, id: ev.event_id || ev.offer_id || null });
  });
  return out;
}

function precedingSentOffer(inbound, input, messages) {
  var inboundMs = toInstant(inbound.timestamp);
  var offers = input.sent_offers || [];
  var found = null;
  offers.forEach(function (off) {
    if (off.send_evidence !== 'sent') return;
    var sentMs = toInstant(off.sent_at || off.timestamp);
    if (inboundMs != null && sentMs != null && sentMs >= inboundMs) return;
    if (off.message_id) {
      var idxOffer = -1;
      var idxIn = -1;
      messages.forEach(function (m, i) {
        if (m.id === off.message_id) idxOffer = i;
        if (m.id === inbound.id || m === inbound) idxIn = i;
      });
      if (idxOffer >= 0 && idxIn >= 0 && idxOffer >= idxIn) return;
    }
    found = off;
  });
  if (found) return found;
  return null;
}

function conservativeExtract(input) {
  var messages = sortMessages(input.messages);
  var inbound = [];
  var outbound = [];
  messages.forEach(function (m) {
    if ((m.direction || 'inbound') === 'outbound') outbound.push(m);
    else inbound.push(m);
  });
  var lastIn = inbound.length ? inbound[inbound.length - 1] : null;
  var review = [];
  var windows = [];
  var facts = {
    date_specified: false,
    weekday: null,
    time_of_day: null,
    after_hour: null,
    before_hour: null,
    clock: null,
    explicit_date: null,
    source_message_id: lastIn && lastIn.id || null
  };
  var replyKind = lastIn ? 'ordinary' : 'none';
  var exact = false;
  var accepted = null;
  var year = yearFrom(input);

  if (lastIn) {
    var text = bodyOf(lastIn);
    if (isExplicitCancel(text)) {
      replyKind = 'cancellation';
    } else if (isUnqualifiedYes(text)) {
      var offer = precedingSentOffer(lastIn, input, messages);
      if (offer && offer.offer_id && offer.slot_revision != null) {
        replyKind = 'acceptance';
        exact = true;
        accepted = {
          offer_id: offer.offer_id,
          slot_revision: offer.slot_revision,
          start_iso: offer.start_iso,
          message_id: lastIn.id || null
        };
      } else {
        replyKind = 'ordinary';
        review.push('Yes is not bound to a preceding sent offer id and slot revision.');
      }
    } else if (/\byes\b/i.test(text) && /\b(but|only|after|before)\b/i.test(text)) {
      replyKind = 'new_availability';
      review.push('Qualified yes is not exact acceptance.');
    }

    var date = parseExplicitDate(text, year);
    var clock = parseClock(text);
    var dayName = weekdayName(text);
    var afternoonOnly = /\bafternoons?\b/i.test(text) && !date && !dayName;
    var morningOnly = /\bmornings?\b/i.test(text) && !date && !dayName;
    if (afternoonOnly || morningOnly) {
      facts.time_of_day = afternoonOnly ? 'afternoon' : 'morning';
      facts.date_specified = false;
      review.push('Customer date unspecified. Any chosen day is an AI proposal, not a customer-stated date.');
    } else if (date) {
      var startH = null;
      var endH = null;
      if (clock != null && /\bafter\b/i.test(text)) { startH = clock; endH = 16.5; }
      else if (clock != null && /\bbefore\b/i.test(text)) { startH = 8; endH = clock; }
      else if (clock != null) { startH = clock; endH = clock + 1; }
      else if (/\bmorning\b/i.test(text)) { startH = 8; endH = 12; }
      else if (/\bafternoon\b/i.test(text)) { startH = 13; endH = 16.5; }
      else review.push('Date without a time is not a unique slot.');
      if (startH != null) {
        facts.date_specified = true;
        facts.explicit_date = date;
        facts.clock = clock;
        facts.time_of_day = startH >= 13 ? 'afternoon' : (endH <= 12 ? 'morning' : null);
        var start = isoPerth(date, startH);
        var end = isoPerth(date, endH);
        windows.push({
          start_iso: start.local,
          end_iso: end.local,
          start_instant: start.instant,
          end_instant: end.instant,
          source_message_id: lastIn.id || null,
          explicit_date: true
        });
      }
    } else if (dayName && !date) {
      facts.weekday = dayName;
      facts.date_specified = false;
      facts.clock = clock;
      if (clock != null && /\bafter\b/i.test(text)) facts.after_hour = clock;
      if (clock != null && /\bbefore\b/i.test(text)) facts.before_hour = clock;
      review.push('Customer named a weekday without a calendar date. A slot on that weekday is an AI proposal.');
    } else if (!date && !dayName && clock != null) {
      facts.clock = clock;
      facts.date_specified = false;
      if (/\bafter\b/i.test(text)) facts.after_hour = clock;
      review.push('Customer named a time without a date. The chosen day is an AI proposal.');
    }
  }

  outbound.forEach(function () {});

  return {
    interpreter: INTERPRETER_FALLBACK,
    intelligent_automation: false,
    reply_kind: replyKind,
    exact_acceptance: exact,
    accepted_offer: accepted,
    windows: windows,
    customer_facts: facts,
    review_reasons: review,
    source_message_ids: messages.map(function (m) { return m.id || null; }).filter(Boolean)
  };
}

function addDaysIso(iso, n) {
  var parts = String(iso).slice(0, 10).split('-').map(Number);
  var utc = Date.UTC(parts[0], parts[1] - 1, parts[2] + n);
  return new Date(utc).toISOString().slice(0, 10);
}

function proposeCandidate(input, facts) {
  facts = facts || {};
  var weekStart = mondayIso(input.week_start || '2026-09-14');
  var rules = (input.resource && input.resource.desk_rules) || {};
  var busy = busyInstants(input.events, input.pending_offers);
  var days = [];
  if (facts.explicit_date) days = [facts.explicit_date];
  else {
    for (var i = 0; i < 5; i++) days.push(addDaysIso(weekStart, i));
    if (facts.weekday) {
      var want = WEEKDAYS.indexOf(facts.weekday);
      days = days.filter(function (d) {
        var parts = d.split('-').map(Number);
        var dow = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
        return dow === want;
      });
    }
  }
  var found = null;
  days.forEach(function (date) {
    if (found) return;
    var startH = 8;
    var endH = 16.5;
    if (facts.time_of_day === 'afternoon') { startH = 13; endH = 16.5; }
    else if (facts.time_of_day === 'morning') { startH = 8; endH = 12; }
    if (facts.after_hour != null) startH = Math.max(startH, facts.after_hour);
    if (facts.before_hour != null) endH = Math.min(endH, facts.before_hour);
    if (facts.clock != null && facts.after_hour == null && facts.before_hour == null && facts.time_of_day == null && facts.date_specified) {
      startH = facts.clock;
      endH = facts.clock + 1;
    } else if (facts.clock != null && facts.after_hour == null && facts.before_hour == null && facts.time_of_day == null && !facts.date_specified) {
      startH = facts.clock;
      endH = Math.min(16.5, facts.clock + 2);
    }
    var cursor = isoPerth(date, startH);
    var end = isoPerth(date, endH);
    if (cursor.instant == null || end.instant == null) return;
    var ms = cursor.instant;
    while (ms + 60 * 60 * 1000 <= end.instant + 1) {
      var local = perthParts(ms);
      if (!legalStart(local.hour, rules, local.date, weekStart)) {
        ms += 15 * 60 * 1000;
        continue;
      }
      var slotEnd = ms + 60 * 60 * 1000;
      var clash = busy.some(function (b) { return rangeOverlap(ms, slotEnd, b.start, b.end); });
      if (!clash) {
        found = {
          start_iso: isoPerth(local.date, local.hour).local,
          end_iso: isoPerth(local.date, local.hour + 1).local,
          start_instant: ms,
          end_instant: slotEnd,
          date_source: facts.date_specified ? 'customer' : 'ai_proposed',
          customer_date_specified: !!facts.date_specified,
          window_label: facts.date_specified ? 'customer date' : 'AI-proposed date, customer date unspecified'
        };
        return;
      }
      ms += 15 * 60 * 1000;
    }
  });
  return found;
}

function legalStart(hour, rules, perthDate, weekStart) {
  var parts = perthDate.split('-').map(Number);
  var utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  var dow = new Date(utc).getUTCDay();
  var dayIndex = dow === 0 ? 6 : dow - 1;
  if (hour < 8 || hour > (rules.last_start != null ? rules.last_start : 15.5)) return false;
  if (rules.no_wednesday && dayIndex === 2) return false;
  if (dayIndex === 0 && rules.monday_from != null && hour < rules.monday_from) return false;
  return true;
}

function proposeFromWindows(windows, input) {
  var rules = (input.resource && input.resource.desk_rules) || {};
  var busy = busyInstants(input.events, input.pending_offers);
  var weekStart = mondayIso(input.week_start || '2026-09-14');
  var found = null;
  (windows || []).forEach(function (w) {
    if (found) return;
    var startMs = w.start_instant != null ? w.start_instant : toInstant(w.start_iso);
    var endMs = w.end_instant != null ? w.end_instant : toInstant(w.end_iso);
    if (startMs == null || endMs == null) return;
    var cursor = startMs;
    while (cursor + 60 * 60 * 1000 <= endMs + 1) {
      var local = perthParts(cursor);
      if (!legalStart(local.hour, rules, local.date, weekStart)) {
        cursor += 15 * 60 * 1000;
        continue;
      }
      var slotEnd = cursor + 60 * 60 * 1000;
      var clash = busy.some(function (b) { return rangeOverlap(cursor, slotEnd, b.start, b.end); });
      if (!clash) {
        found = {
          start_iso: isoPerth(local.date, local.hour).local,
          end_iso: perthParts(slotEnd).date === local.date
            ? isoPerth(local.date, local.hour + 1).local
            : isoPerth(perthParts(slotEnd).date, perthParts(slotEnd).hour).local,
          start_instant: cursor,
          end_instant: slotEnd,
          window_label: w.source_message_id ? 'inbound ' + w.source_message_id : 'inbound window'
        };
        return;
      }
      cursor += 15 * 60 * 1000;
    }
  });
  return found;
}

function validate(extracted, input) {
  var reasons = (extracted.review_reasons || []).slice();
  var status = 'needs_decision';
  var exact = false;
  var proposal = null;
  var replyKind = extracted.reply_kind || 'unknown';

  var inboundBodies = sortMessages(input.messages).filter(function (m) {
    return (m.direction || 'inbound') !== 'outbound';
  }).map(bodyOf).join(' ');
  var explicitDate = parseExplicitDate(inboundBodies, yearFrom(input));
  if (extracted.windows) {
    extracted.windows = extracted.windows.filter(function (w) {
      if (w.source_message_id === 'outbound' || w.from_outbound === true) return false;
      if (explicitDate && w.start_iso && String(w.start_iso).slice(0, 10) !== explicitDate) {
        reasons.push('Proposed date does not match the inbound calendar date.');
        return false;
      }
      return true;
    });
  }
  if (!explicitDate) {
    extracted.windows = [];
  }
  if (extracted.customer_facts && extracted.customer_facts.date_specified === false) {
    extracted.windows = [];
  }
  if (!extracted.customer_facts) {
    extracted.customer_facts = { date_specified: !!explicitDate, explicit_date: explicitDate || null };
  }

  var tags = (input.tags || []).map(function (t) { return String(t).toLowerCase(); });
  var wrongLane = input.resource && input.resource.lane === 'patio' && tags.some(function (t) {
    return t.indexOf('fencing') >= 0 && t.indexOf('patio') < 0;
  });
  if (wrongLane) {
    reasons.push('Lane is unresolved. Do not send Patio-branded outreach.');
    replyKind = 'ordinary';
  }
  if (input.quoted) reasons.push('Already quoted. Confirm whether this is a new request.');

  if (extracted.exact_acceptance) {
    var acc = extracted.accepted_offer;
    if (!acc || !acc.offer_id || acc.slot_revision == null) {
      exact = false;
      reasons.push('Acceptance is not bound to a sent offer id and slot revision.');
      replyKind = 'ordinary';
    } else {
      exact = true;
    }
  }

  if (replyKind === 'cancellation' && !wrongLane) {
    status = 'repair';
  } else if (exact && !wrongLane) {
    status = 'needs_decision';
  } else {
    var slot = null;
    if (extracted.windows && extracted.windows.length) {
      slot = proposeFromWindows(extracted.windows, input);
      if (slot) {
        slot.date_source = 'customer';
        slot.customer_date_specified = true;
      }
    } else if (!wrongLane) {
      slot = proposeCandidate(input, extracted.customer_facts);
    }
    if (!coverageReady(input.coverage)) {
      reasons.push('Calendar, leave or travel coverage is missing. Not execution-ready.');
      status = 'needs_decision';
      proposal = null;
    } else if (!slot) {
      reasons.push('No feasible slot under current rules and occupancy.');
      status = 'needs_decision';
      proposal = null;
    } else if (wrongLane) {
      status = 'needs_decision';
      proposal = null;
    } else {
      status = 'ready';
      proposal = slot;
      if (slot.date_source === 'ai_proposed') {
        reasons.push('AI-proposed date, customer date unspecified.');
      }
    }
  }

  if (input.send_evidence && input.send_evidence !== 'sent' && status === 'waiting') {
    status = 'needs_decision';
    reasons.push('Send is not evidenced. Cannot sit in Waiting for reply.');
  }

  var draft = '';
  if (proposal && status === 'ready') {
    var hm = String(proposal.start_iso).slice(11, 16);
    var hour = Number(hm.slice(0, 2));
    var min = hm.slice(3);
    var ampm = hour >= 12 ? 'pm' : 'am';
    var h12 = hour % 12 || 12;
    var who = (input.resource && input.resource.name) || 'SecureWorks';
    var lane = input.resource && input.resource.lane === 'fencing' ? 'SecureWorks Fencing' : 'SecureWorks Patios';
    var when = String(proposal.start_iso).slice(0, 10) + ' at ' + h12 + ':' + min + ampm;
    if (proposal.date_source === 'ai_proposed') {
      draft = 'Hi, I can visit ' + when + ' in ' + (input.suburb || 'the site') + '. Does that suit? ' + who + ', ' + lane;
    } else {
      draft = 'Hi, ' + when + ' in ' + (input.suburb || 'the site') + ' works for me. Can someone be there then? ' + who + ', ' + lane;
    }
    proposal.draft = draft;
    proposal.kind = 'proposal';
  }

  return {
    version: VERSION,
    interpreter: extracted.interpreter || INTERPRETER_FALLBACK,
    intelligent_automation: extracted.intelligent_automation === true,
    week_start: mondayIso(input.week_start || '2026-09-14'),
    reply_kind: replyKind,
    exact_acceptance: exact,
    accepted_offer: exact ? extracted.accepted_offer : null,
    status: status,
    reason: reasons[0] || (status === 'ready' ? 'Candidate slot for approval. This is not exact acceptance.' : 'Needs a human decision.'),
    review_reasons: reasons,
    customer_facts: extracted.customer_facts || null,
    windows: extracted.windows || [],
    proposal: proposal,
    draft: draft,
    evidence: {
      source_message_ids: extracted.source_message_ids || [],
      accepted_offer_id: exact && extracted.accepted_offer ? extracted.accepted_offer.offer_id : null,
      slot_revision: exact && extracted.accepted_offer ? extracted.accepted_offer.slot_revision : null,
      coverage: input.coverage || null,
      rule_version: input.rule_version || 'desk-rules-inline',
      wrong_lane: !!wrongLane,
      quoted: !!input.quoted
    }
  };
}

function mergeReasoned(raw, input) {
  if (!raw || typeof raw !== 'object') return conservativeExtract(input);
  var windows = Array.isArray(raw.customer_windows) ? raw.customer_windows.map(function (w) {
    return {
      start_iso: w.start_iso,
      end_iso: w.end_iso,
      start_instant: toInstant(w.start_iso),
      end_instant: toInstant(w.end_iso),
      source_message_id: w.source_message_id,
      from_outbound: w.from_outbound === true
    };
  }) : [];
  return {
    interpreter: raw.interpreter || 'ops-ai-structured',
    intelligent_automation: raw.intelligent_automation === true,
    reply_kind: raw.reply_kind || 'unknown',
    exact_acceptance: !!raw.exact_acceptance,
    accepted_offer: raw.accepted_offer || null,
    windows: windows,
    customer_facts: raw.customer_facts || null,
    review_reasons: raw.review_reasons || [],
    source_message_ids: raw.source_message_ids || []
  };
}

function assess(input) {
  input = input || {};
  var extracted;
  if (typeof input.reason === 'function') {
    extracted = mergeReasoned(input.reason(input), input);
  } else {
    extracted = conservativeExtract(input);
  }
  return validate(extracted, input);
}

function reasonPrompt(input) {
  return {
    task: 'sales_booking_conversation_assessment',
    schema_version: VERSION,
    timezone: TZ_PERTH,
    instructions: [
      'Return JSON only.',
      'Separate customer facts from candidate scheduling.',
      'Customer constraints may come from inbound messages only.',
      'If the customer gives a time-of-day with no date, record that preference and you may suggest a verified-free slot labelled AI-proposed date, customer date unspecified.',
      'Do not write an AI-suggested day as a customer-declared window or exact acceptance.',
      'Initial outreach may propose a suitable slot pending approval without pretending the customer supplied availability.',
      'Exact acceptance requires the preceding sent offer id and slot revision.',
      'Do not map an explicit calendar date onto a different week.',
      'Ambiguous or negated language is never cancellation or exact acceptance.'
    ],
    input: {
      week_start: input.week_start,
      messages: sortMessages(input.messages).map(function (m) {
        return { id: m.id || null, direction: m.direction, timestamp: m.timestamp, body: bodyOf(m) };
      }),
      sent_offers: input.sent_offers || [],
      coverage: input.coverage || null,
      resource: input.resource ? { name: input.resource.name, lane: input.resource.lane } : null
    }
  };
}

async function assessWithReason(input) {
  input = input || {};
  var adapter = input.reasonAsync || (typeof globalThis !== 'undefined' && globalThis.SALES_BOOKING_REASON);
  if (typeof adapter !== 'function') return assess(input);
  var raw = await adapter(reasonPrompt(input));
  return validate(mergeReasoned(raw, input), input);
}

function applyReplyToStatus(currentStatus, replyKind, bound) {
  if (replyKind === 'acceptance' && bound) return { status: 'needs_decision', exact_acceptance: true, action: 'confirm_booking' };
  if (replyKind === 'acceptance' && !bound) return { status: 'needs_decision', exact_acceptance: false, action: 'approve_offer' };
  if (replyKind === 'new_availability' || replyKind === 'decline') return { status: 'ready', exact_acceptance: false, action: 'approve_offer' };
  if (replyKind === 'cancellation') return { status: 'repair', exact_acceptance: false, action: 'repair' };
  if (currentStatus === 'waiting' || currentStatus === 'follow_up' || currentStatus === 'offer') {
    return { status: 'needs_decision', exact_acceptance: false, action: 'approve_offer' };
  }
  return { status: currentStatus || 'needs_decision', exact_acceptance: false, action: 'approve_offer' };
}

module.exports = {
  VERSION: VERSION,
  INTERPRETER_FALLBACK: INTERPRETER_FALLBACK,
  mondayIso: mondayIso,
  toInstant: toInstant,
  conservativeExtract: conservativeExtract,
  validate: validate,
  assess: assess,
  assessWithReason: assessWithReason,
  reasonPrompt: reasonPrompt,
  applyReplyToStatus: applyReplyToStatus,
  coverageReady: coverageReady
};
