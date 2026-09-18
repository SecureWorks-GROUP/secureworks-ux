(function (global) {
  'use strict';

  var SEND_HOLD = true;
  var MOVE_HOLD = true;
  var PX_PER_HOUR = 68;
  var DAY_START = 8;
  var DAY_END = 17;
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  var BOOKING_READ_TIMEOUT_MS = 60000;
  // Live GHL stage ids copied from wiki origin/main
  // harness/ops/skills/secureworks-scope-booking/profiles/{patio-nithin,fencing-stratco-marnin}.json
  // pinned by https://github.com/SecureWorks-GROUP/secureworks-wiki/pull/438
  var PIPELINE_STAGE_SOURCE = 'wiki origin/main harness/ops/skills/secureworks-scope-booking/profiles (https://github.com/SecureWorks-GROUP/secureworks-wiki/pull/438)';
  var PATIO_PIPELINE_STAGES = [
    { id: '09759a42-f80a-4947-bca4-71df5dd770da', name: 'Client Needs To Be Contacted', bucket: 'need' },
    { id: '4d3bcf9a-185d-4a90-98e0-e0805fdf4a02', name: 'Contacted Waiting on Response', bucket: 'need' },
    { id: '637c165f-93a3-496b-8e86-970eb8935044', name: 'Needs Scope / Quote', bucket: 'need' },
    { id: '1c312cc2-b6f6-4aad-b3c0-a4b14784a5c5', name: 'Scope Booked', bucket: 'booked' },
    { id: '9b9e5313-8e0e-4ed6-8654-d50413b99885', name: 'Scope Complete / Quote to be Sent', bucket: 'quote' },
    { id: 'd2fb3af7-91e5-4317-b778-2be117341f07', name: 'Quote Sent / Follow up', bucket: 'fold' },
    { id: 'a0f3002f-db71-4b69-842a-12930bdd7591', name: 'Job Won / Move to Execution', bucket: 'fold' },
    { id: '2d3a57e2-3869-46f4-af10-ba2b53be802a', name: 'Nurture / On Hold (Nithin)', bucket: 'fold' },
    { id: '52b35bd6-34fa-4bbb-8b43-67f4cc0f1029', name: 'Outside Service Area (Too Small)', bucket: 'fold' },
    { id: '0f3c9b6b-2701-4fda-9cec-4da4a3530278', name: ' Job Lost/Archive', bucket: 'fold' },
    { id: 'f9d4f3a3-f6bd-42c8-827d-340983ce0c87', name: 'Not Relevant /Archive', bucket: 'fold' }
  ];
  var FENCING_PIPELINE_STAGES = [
    { id: 'cc401467-4743-4dbd-a7d7-e8f2ff023dd2', name: 'New Lead (Call + Qualify)', bucket: 'need' },
    { id: '7f863a14-1d9f-4a18-b73c-0e1780390bd7', name: 'New Lead (Replied/ Contacted)', bucket: 'need' },
    { id: '8c43212e-5e58-4f0d-b7f7-96c6ee644d6e', name: 'Stale Lead', bucket: 'need' },
    { id: '341d6a77-6a35-4338-b2b0-09236c7c80f9', name: 'Called, No Answer', bucket: 'need' },
    { id: '52c70bff-5cf3-447b-b891-03c30486aed8', name: 'Call Answered (presentation not made)', bucket: 'need' },
    { id: '6b101809-a4f9-440d-ac4c-0be669b8173e', name: 'Presentation Made (scope not booked)', bucket: 'need' },
    { id: 'bfdba902-0a92-4a90-95a5-af27d7502a90', name: 'Needs On Site Scope Urgently', bucket: 'need' },
    { id: '09eeb872-fa46-41fc-a96b-8a8d2bc12215', name: 'Lead Closed (scope booked)', bucket: 'booked' },
    { id: '4dc3da8f-d713-4bd4-851c-8e89b6682a4e', name: 'Scope Scheduled', bucket: 'booked' },
    { id: '418534d4-6356-4c20-a274-51fbb892c2fa', name: 'Scope Complete', bucket: 'quote' },
    { id: '02476ea1-6ef4-4b73-80fa-7d685c016bf7', name: 'Following up Quote Sent (Site visit)', bucket: 'fold' },
    { id: '338b7dd7-7220-4abc-bc0b-b8d9ea44f40e', name: 'Job Accepted -> Move to Execution', bucket: 'fold' },
    { id: '9cae7ae3-142a-4864-9a2e-bb04a3fb94fb', name: 'On Hold', bucket: 'fold' },
    { id: '005d078d-047d-436f-abdf-584a3b794584', name: 'Job Lost', bucket: 'fold' }
  ];
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
      desk_rules: { monday_from: 12, no_wednesday: true, last_start: 15.5, hours: '08:00-16:30 except Monday from 12:00, no Wednesday' },
      pipeline_stages: PATIO_PIPELINE_STAGES,
      pipeline_stages_source: PIPELINE_STAGE_SOURCE
    },
    marnin: {
      id: 'marnin',
      name: 'Marnin',
      scoper_user_id: '706c5258-70dd-483a-b36c-af6864b24498',
      lane: 'fencing',
      // Captain ruling 2026-09-16: the 772-vs-776 disagreement is settled for v1 by a
      // captain default, not by code guessing. Both source claims stay on the record so
      // the line is flippable tomorrow without re-deriving where they came from.
      sender: '+61489267776',
      sender_label: 'SecureWorks Group Ops 776',
      sender_resolved: true,
      sender_default: { by: 'captain', on: '2026-09-16', scope: 'v1', flippable: true },
      sender_sources: ['Captain default 2026-09-16 (v1)'],
      sender_candidates: [
        { number: '+61489267772', label: 'SecureWorks Fencing Sales 772', source: 'CIO-to-FENCING_SALES-marnin-calendar-2026-09-11.md' },
        { number: '+61489267776', label: 'SecureWorks Group Ops 776', source: 'SALES-booking-page-audit.md; OPS.md automated booking-path exemption' }
      ],
      desk_rules: { monday_from: 8, no_wednesday: false, days: [1, 4], lane_note: 'Stratco scopes are offered Tue and Fri', last_start: 15.5, protected_band: { day: 1, from: 13, to: 15.5, label: 'Canning Vale band', note: '13:00 to 15:30 protected' }, hours: 'Stratco lane is Tuesday and Friday; Canning Vale band Tue 13:00 to 15:30 protected' },
      pipeline_stages: FENCING_PIPELINE_STAGES,
      pipeline_stages_source: PIPELINE_STAGE_SOURCE
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
      desk_rules: { monday_from: 8, no_wednesday: false, last_start: 15.5, hours: '08:00-16:30 Mon-Fri; Calendly is not this calendar' },
      pipeline_stages: FENCING_PIPELINE_STAGES,
      pipeline_stages_source: PIPELINE_STAGE_SOURCE
    }
  };

  // v1 scoper list is a captain default, not a capability limit. Khairo stays fully
  // configured above so tomorrow's flip is one entry in this array.
  var V1_SCOPERS = ['nithin', 'marnin'];
  var CAPTAIN_DEFAULTS = {
    scopers: 'Nithin plus Marnin',
    scopes_done_window: 'this week plus last',
    stratco_sender_line: '776',
    stamp_board: 'agent-driven, human-typed later'
  };
  // Every customer-facing or diary-facing write on this surface. Rendered disabled with
  // this reason; the captain stamps KEEP or CUT and ops auto-book performs the write.
  var HOLD_REASON = 'Held. This surface does not send, approve, confirm or write a diary.';

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
    layers: { confirmed: true, proposal: true, offer: true, blocked: true, personal: true, availability: true },
    stamp: { approved: [], rejected: [], decisions: {}, stage_moves: {} },
    showArchived: false,
    conversation: { contactId: null, caseId: null, loading: false, error: null, messages: [], generation: 0 },
    drafts: {},
    archives: {},
    sendAttempted: false,
    lastSendCall: null,
    lastStampCall: null,
    lastArchiveCall: null,
    cache: {},
    stale: false,
    lastReadMs: 0,
    readKind: null
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

  function pad2(n) {
    n = Number(n);
    return (n < 10 ? '0' : '') + n;
  }

  function clockToIso(day, clock) {
    var raw = String(clock || '').trim();
    if (!raw || !day) return null;
    if (/T/.test(raw)) return raw;
    var m = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    var h = Number(m[1]);
    var min = m[2] != null ? Number(m[2]) : 0;
    var ap = (m[4] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    var date = String(day).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return date + 'T' + pad2(h) + ':' + pad2(min) + ':00';
  }

  function isoDateOf(value) {
    var s = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/T/.test(s) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }

  // Live pack windows are ISO datetimes (day may only say "Fri"). An undated
  // weekday stays undated; it is never mapped onto the week on screen.
  function proposalDayIso(p) {
    if (!p) return null;
    return isoDateOf(p.day)
      || isoDateOf(p.start_iso)
      || isoDateOf(p.window_start)
      || isoDateOf(p.window_start_iso);
  }

  function packWeekStart(data) {
    data = data || state.data;
    var pack = data && data.pack;
    var raw = (pack && pack.week_start) || (data && data.week_start);
    return raw ? mondayIso(raw) : state.weekStart;
  }

  function packOpportunityId(raw) {
    var id = String(raw == null ? '' : raw).replace(/^\s+|\s+$/g, '');
    if (!id) return '';
    if (id.indexOf('opp:') === 0) return id.slice(4);
    return id;
  }

  function isPackOffer(raw) {
    if (!raw || typeof raw !== 'object') return false;
    return raw.offer === true || raw.disposition === 'offer';
  }

  // Pack proposals use {disposition, day, window, draft, offer, name, suburb}
  // or the flattened {window_start, window_end} shape. The week grid still
  // paints from start_iso/end_iso, so fill those when the pack shape arrives
  // and leave an already-normalised proposal untouched.
  function flattenPackWindow(p) {
    if (!p || typeof p !== 'object') return p;
    var window = p.window;
    if (window && typeof window === 'object') {
      if (!isoDateOf(p.day) && (window.date || window.day)) p.day = window.date || window.day;
      if (!p.window_start && window.start) p.window_start = window.start;
      if (!p.window_end && window.end) p.window_end = window.end;
      if (!p.window_label && window.label) p.window_label = window.label;
    }
    return p;
  }

  function normaliseProposal(p) {
    if (!p || typeof p !== 'object') return p;
    flattenPackWindow(p);
    var day = proposalDayIso(p);
    var start = p.start_iso || clockToIso(day, p.window_start) || p.window_start_iso || null;
    var end = p.end_iso || clockToIso(day, p.window_end) || p.window_end_iso || null;
    if (start && !p.start_iso) p.start_iso = start;
    if (end && !p.end_iso) p.end_iso = end;
    if (p.window_start && !p.window_start_iso) {
      var ws = clockToIso(day, p.window_start);
      if (ws) p.window_start_iso = ws;
    }
    if (p.window_end && !p.window_end_iso) {
      var we = clockToIso(day, p.window_end);
      if (we) p.window_end_iso = we;
    }
    if (isPackOffer(p) && p.disposition == null) p.disposition = 'offer';
    return p;
  }

  function proposalFromPackRaw(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var p = {
      disposition: raw.disposition || (isPackOffer(raw) ? 'offer' : null),
      offer: isPackOffer(raw),
      day: raw.day || null,
      window: raw.window,
      window_start: raw.window_start,
      window_end: raw.window_end,
      window_start_iso: raw.window_start_iso,
      window_end_iso: raw.window_end_iso,
      window_label: raw.window_label,
      start_iso: raw.start_iso,
      end_iso: raw.end_iso,
      draft: raw.draft || null,
      why: [].concat(raw.why || [], raw.failures || []),
      suburb: raw.suburb || null,
      name: raw.name || raw.display_name || null,
      job: raw.job || raw.job_type || null
    };
    return normaliseProposal(p);
  }

  function packOfferEntries() {
    var data = state.data;
    var pack = data && data.pack;
    var src = pack && pack.proposals;
    if (!src || typeof src !== 'object' || Array.isArray(src)) return [];
    var entries = [];
    Object.keys(src).forEach(function (key) {
      var raw = src[key];
      if (!raw || typeof raw !== 'object') return;
      if (!isPackOffer(raw)) return;
      var id = packOpportunityId(raw.opportunity_id || raw.id || key);
      if (!id) return;
      entries.push({ id: id, raw: raw });
    });
    return entries;
  }

  function overlayPackOnCase(c, raw, opts) {
    opts = opts || {};
    var next = proposalFromPackRaw(raw);
    if (!next) return c;
    c.proposal = Object.assign({}, c.proposal || {}, next);
    normaliseProposal(c.proposal);
    if (!blankPlace(c.display_name)) {
      // Keep the roster name when the opportunity was in this read.
    } else {
      c.display_name = raw.name || raw.display_name || c.display_name;
    }
    if (!caseSuburb(c) && (raw.suburb || next.suburb)) c.suburb = raw.suburb || next.suburb;
    if (!c.job && (raw.job || raw.job_type || next.job)) c.job = raw.job || raw.job_type || next.job;
    if (!c.contact_id && raw.contact_id) c.contact_id = raw.contact_id;
    if (!c.opportunity_id) c.opportunity_id = packOpportunityId(raw.opportunity_id || raw.id || c.id);
    c.not_in_this_read = !!opts.notInThisRead;
    return c;
  }

  function synthesisePackOfferCase(entry) {
    var raw = entry.raw || {};
    var row = {
      id: entry.id,
      opportunity_id: entry.id,
      contact_id: raw.contact_id || null,
      display_name: raw.name || raw.display_name || 'Enquiry',
      suburb: raw.suburb || null,
      job: raw.job || raw.job_type || null,
      status: 'ready',
      reason: 'Pack offer. This opportunity was not among the enumerated cases in this read.',
      proposal: null,
      stamp_state: 'none',
      not_in_this_read: true
    };
    overlayPackOnCase(row, raw, { notInThisRead: true });
    return row;
  }

  function mergePackOffers(list, data) {
    var entries = packOfferEntries();
    if (!entries.length) return list;
    if (!data._packOnlyById || typeof data._packOnlyById !== 'object') data._packOnlyById = {};
    var seen = {};
    list.forEach(function (c) {
      var id = packOpportunityId(c.opportunity_id || c.id);
      if (id) seen[id] = c;
    });
    entries.forEach(function (entry) {
      var existing = seen[entry.id];
      if (existing) {
        overlayPackOnCase(existing, entry.raw, { notInThisRead: false });
        return;
      }
      var row = data._packOnlyById[entry.id];
      if (!row) {
        row = synthesisePackOfferCase(entry);
        data._packOnlyById[entry.id] = row;
      } else {
        overlayPackOnCase(row, entry.raw, { notInThisRead: true });
      }
      list.push(row);
      seen[entry.id] = row;
    });
    return list;
  }

  function cases() {
    var data = state.data;
    if (!data) return [];
    var raw = data.cases;
    if (!Array.isArray(raw)) {
      throw new TypeError('Booking read cases must be an array');
    }
    var list = raw.filter(function (c) { return c && typeof c === 'object'; }).map(function (c) {
      if (c.proposal) normaliseProposal(c.proposal);
      return c;
    });
    return mergePackOffers(list, data);
  }

  function isPackOfferCase(c) {
    if (!c) return false;
    if (c.not_in_this_read && c.proposal) return true;
    var id = packOpportunityId(c.opportunity_id || c.id);
    if (!id) return isPackOffer(c.proposal);
    return packOfferEntries().some(function (entry) { return entry.id === id; });
  }

  function stampableOfferList() {
    var live = cases().filter(function (c) {
      return !isArchived(c) && !isCompleted(c) && !isFoldedStage(c);
    });
    if (packOfferEntries().length) {
      return live.filter(function (c) { return isPackOfferCase(c) && !stampBlockReason(c); });
    }
    return live.filter(function (c) { return isAssessed(c) && !stampBlockReason(c); });
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
    if (!c.accepted_start_iso || !c.accepted_end_iso || !c.accepted_offer_id) return false;
    if (!c.proposal || !c.proposal.start_iso || !c.proposal.end_iso || !c.proposal.offer_id) return false;
    if (c.accepted_start_iso !== c.proposal.start_iso) return false;
    if (c.accepted_end_iso !== c.proposal.end_iso) return false;
    if (c.accepted_offer_id !== c.proposal.offer_id) return false;
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

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Clock label for a decimal hour. 13.5 -> '1:30pm'.
  function clockLabel(hour, withMeridiem) {
    if (hour == null) return '';
    var h = Math.floor(hour);
    var m = Math.round((hour - h) * 60);
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + (withMeridiem === false ? '' : ampm);
  }

  // The customer is promised an ARRIVAL WINDOW, never an exact minute (standing rule).
  // 90 minutes from the proposed start unless the slot itself is longer.
  function arrivalWindow(startIso, endIso, joiner) {
    var start = hourFromIso(startIso);
    if (start == null) return '';
    var span = durationHours(startIso, endIso);
    var width = span && span > 1.5 ? span : 1.5;
    var end = start + width;
    var sameHalf = (start >= 12) === (end >= 12);
    return clockLabel(start, !sameHalf) + ' ' + (joiner || 'to') + ' ' + clockLabel(end);
  }

  function longDate(iso) {
    var date = String(iso || '').slice(0, 10);
    var parts = date.split('-').map(Number);
    if (parts.length !== 3 || !parts[0]) return date;
    var day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return names[day] + ' ' + parts[2] + ' ' + MONTHS[parts[1] - 1];
  }

  function blankPlace(value) {
    var s = String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
    if (!s || /^not given$/i.test(s)) return '';
    return s;
  }

  // GHL cases in the live read carry suburb: null. The pack proposal has it.
  function caseSuburb(c) {
    return blankPlace(c && c.suburb) || blankPlace(c && c.proposal && c.proposal.suburb);
  }

  // Backend PR 858 returns job_type on every case (patio, fencing, or "not given").
  function jobTypeLabel(c) {
    var type = String(c && c.job_type != null ? c.job_type : '').replace(/^\s+|\s+$/g, '');
    if (type) return type;
    var job = String(c && c.job != null ? c.job : '').replace(/^\s+|\s+$/g, '');
    if (job) return job;
    return 'not given';
  }

  function proposalSlotLabel(c) {
    var p = c && c.proposal;
    if (!p || !p.start_iso) return '';
    var when = longDate(p.start_iso);
    var window = arrivalWindow(p.start_iso, p.end_iso);
    return window ? when + ' · arrive ' + window : when;
  }

  // SMS hours are 08:00 to 18:00 Perth. A draft outside them is still drafted; the
  // surface says so rather than silently holding a text the captain cannot see.
  function outsideSmsHours() {
    var now = new Date();
    var perth = Number(now.toLocaleString('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', hour12: false }));
    if (isNaN(perth)) return false;
    return perth < 8 || perth >= 18;
  }

  function suggestedDraft(c) {
    if (!c || !c.proposal || !c.proposal.start_iso) return '';
    var iso = c.proposal.start_iso;
    var who = resource().name;
    var lane = resource().lane === 'patio' ? 'SecureWorks Patios' : 'SecureWorks Fencing';
    var suburb = caseSuburb(c) || 'your place';
    var first = String(c.display_name || '').trim().split(/\s+/)[0] || 'there';
    return 'Hi ' + first + ', it is ' + who + ' from ' + lane + '. I can come out to ' + suburb +
      ' on ' + longDate(iso) + ' between ' + arrivalWindow(iso, c.proposal.end_iso, 'and') +
      ' to measure and quote. Does that suit?';
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
    var nextEnd = (startIso === c.proposal.start_iso && c.proposal.end_iso)
      ? c.proposal.end_iso
      : addHourIso(startIso);
    var slotChanged = c.proposal.start_iso !== startIso
      || c.proposal.end_iso !== nextEnd
      || (c.accepted_end_iso && nextEnd !== c.accepted_end_iso)
      || (c.accepted_start_iso && startIso !== c.accepted_start_iso);
    c.proposal.start_iso = startIso;
    c.proposal.end_iso = nextEnd;
    c.proposal.revision = (c.proposal.revision || 0) + 1;
    if (slotChanged && c.exact_acceptance) {
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
    return { ok: true, conflict: !!d.conflict, revision: d.revision, text: d.text, suggested: suggested, exact_acceptance: !!c.exact_acceptance, end_iso: c.proposal.end_iso };
  }

  function reviseProposedSlot(startIso, endIso) {
    var c = selectedCase();
    if (!c || !c.proposal) return { ok: false, reason: 'no_proposal' };
    c.proposal.start_iso = startIso;
    c.proposal.end_iso = endIso;
    c.proposal.revision = (c.proposal.revision || 0) + 1;
    if (c.exact_acceptance) {
      var same = c.accepted_start_iso === startIso && c.accepted_end_iso === endIso;
      if (!same) {
        c.exact_acceptance = false;
        c.acceptance_invalidated = true;
        if (c.status === 'needs_decision') c.status = 'ready';
      }
    }
    return { ok: true, exact_acceptance: !!c.exact_acceptance, start_iso: startIso, end_iso: endIso };
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
    return [c.display_name, caseSuburb(c), c.contact_id, c.reason].join(' ').toLowerCase().indexOf(q) >= 0;
  }

  function visibleCases() {
    return cases().filter(function (c) {
      if (!matchesFilter(c) || !matchesSearch(c)) return false;
      if (isFoldedStage(c)) return false;
      return true;
    });
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
    if (!data) return ['No booking workspace read yet.'];
    var cov = data.coverage || {};
    var gaps = [];
    (cov.gaps || []).forEach(function (g) { gaps.push(String(g)); });
    if (!data.pack || data.pack.present !== true) {
      gaps.push('No proposals published yet for this week');
    }
    return gaps;
  }

  function coverageLooksRateLimited(data) {
    return coverageGaps(data).some(function (g) {
      return /429|too many requests|rate.?limit/i.test(String(g));
    });
  }

  function cacheKey(resourceId, weekStart) {
    return String(resourceId || state.resourceId) + '|' + mondayIso(weekStart || state.weekStart);
  }

  function classifyReadError(err) {
    var status = err && err.status;
    var kind = err && err.kind;
    var msg = String((err && err.message) || err || 'Request failed');
    if (kind === 'fixture' || /fixture fallback is refused/i.test(msg)) {
      return { kind: 'fixture', keepLastGood: false, message: msg };
    }
    if (kind === 'incomplete' || /was incomplete/i.test(msg)) {
      return { kind: 'incomplete', keepLastGood: false, message: msg };
    }
    var rateLimited = status === 429
      || /429|too many requests|rate.?limit/i.test(msg)
      || (status === 500 && /429|too many requests|rate.?limit/i.test(msg));
    if (rateLimited) {
      return {
        kind: 'rate_limited',
        keepLastGood: true,
        message: status === 500
          ? 'GHL rate limited this read (provider 429 returned as HTTP 500). Showing the last complete week, not an empty one.'
          : 'GHL rate limited this read (HTTP ' + (status || 429) + '). Showing the last complete week, not an empty one.'
      };
    }
    if (/timed out/i.test(msg)) {
      return {
        kind: 'timeout',
        keepLastGood: true,
        message: msg + (state.data ? ' Showing the last complete week.' : '')
      };
    }
    return { kind: 'error', keepLastGood: true, message: msg };
  }

  function calendarUnread(data) {
    if (!data) return false;
    if (data.diary_read && data.diary_read.read_ok === false) return true;
    if (data.coverage && data.coverage.diary_read_ok === false) return true;
    var cal = data.resource && data.resource.calendar;
    if (cal && cal.ok === false) return true;
    return false;
  }

  function calendarMailbox(data) {
    var diary = data && data.diary_read;
    if (diary && diary.calendar_email) return diary.calendar_email;
    var cal = data && data.resource && data.resource.calendar;
    if (cal && cal.mailbox) return cal.mailbox;
    if (diary && diary.source) return diary.source;
    return 'not retrieved';
  }

  // ---------------------------------------------------------------------------
  // Diary: the backend contract ships scoper events as `diary[]` with a kind of
  // busy | leave | personal. PR #312's preview ships them as `events[]` with a
  // layer. Both are read here so the surface works before and after the backend
  // lands, and neither shape is allowed to silently drop the other's rows.
  // ---------------------------------------------------------------------------
  function layerForKind(kind) {
    var k = String(kind || '').toLowerCase();
    if (k === 'personal') return 'personal';
    if (k === 'leave') return 'leave';
    if (k === 'confirmed') return 'confirmed';
    return 'busy';
  }

  function diary() {
    var data = state.data;
    if (!data) return [];
    var out = [];
    var push = function (ev, source) {
      var id = ev.case_id || ev.event_id || ev.id || null;
      if (id && out.some(function (o) { return o.id === id; })) return;
      var title = ev.title || ev.subject || ev.display_name || '';
      out.push({
        id: id,
        event_id: ev.event_id || ev.id || null,
        case_id: ev.case_id || null,
        opportunity_id: ev.opportunity_id || null,
        contact_id: ev.contact_id || null,
        start_iso: ev.start || ev.start_iso,
        end_iso: ev.end || ev.end_iso,
        title: title,
        display_name: ev.display_name || title,
        address: ev.address || ev.location || '',
        suburb: ev.suburb || '',
        job: ev.job || ev.job_type || '',
        kind: ev.kind || null,
        show_as: ev.show_as || null,
        blocks_capacity: ev.blocks_capacity,
        is_all_day: !!ev.is_all_day,
        title_withheld: !!ev.title_withheld,
        layer: ev.layer || layerForKind(ev.kind),
        source: ev.source || source
      });
    };
    (data.events || []).forEach(function (ev) { push(ev, 'events'); });
    (data.diary || []).forEach(function (ev) { push(ev, 'diary'); });
    return out;
  }

  function diaryTitle(ev) {
    return String((ev && (ev.title || ev.subject || ev.display_name)) || '').replace(/^\s+|\s+$/g, '');
  }

  function titleStartsWithScope(ev) {
    if (ev && ev.title_withheld) return false;
    return /^scope:\s*/i.test(diaryTitle(ev));
  }

  function isQueueRow(c) {
    if (!c) return false;
    return !!(c.opportunity_id || c.contact_id || c.stage_id || c.stage_name
      || c.pipeline_stage || c.pipelineStage);
  }

  function diaryEventMatchesCase(ev, c) {
    if (!ev || !c) return false;
    var evOpp = ev.opportunity_id || ev.case_id || null;
    if (evOpp && (c.id === evOpp || c.opportunity_id === evOpp)) return true;
    if (ev.contact_id && c.contact_id && String(ev.contact_id) === String(c.contact_id)) return true;
    if (ev.id && c.event_id && String(c.event_id) === String(ev.id)) return true;
    if (ev.event_id && c.event_id && String(c.event_id) === String(ev.event_id)) return true;
    if (!isQueueRow(c)) return false;
    var name = String(ev.display_name || ev.title || ev.subject || '').replace(/^\s+|\s+$/g, '').toLowerCase();
    var suburb = String(ev.suburb || '').replace(/^\s+|\s+$/g, '').toLowerCase();
    if (!name || !suburb) return false;
    return name === String(c.display_name || '').replace(/^\s+|\s+$/g, '').toLowerCase()
      && suburb === caseSuburb(c).toLowerCase();
  }

  // CONFIRMED only when the event is a booked scope: it matches a queue case
  // (opportunity/contact id, else exact name and suburb) or the title starts
  // with "Scope:". Company diary (Payday, Outback Agreements, SecureWorks) is
  // not a booked visit.
  function diaryEventIsScopeBooking(ev) {
    if (!ev) return false;
    if (titleStartsWithScope(ev)) return true;
    var list = cases();
    for (var i = 0; i < list.length; i++) {
      if (diaryEventMatchesCase(ev, list[i])) return true;
    }
    return false;
  }

  function threadFacts(c) {
    var facts = (state.data && state.data.thread_facts) || {};
    return (c && facts[c.id]) || null;
  }

  function normaliseStageName(name) {
    return String(name || '').replace(/^\s+|\s+$/g, '').toLowerCase();
  }

  function stageOf(c) {
    if (!c) return null;
    var stages = (resource().pipeline_stages || []);
    var id = c.stage_id || c.pipeline_stage_id || c.pipelineStageId || '';
    var name = normaliseStageName(c.stage_name || c.pipeline_stage || c.pipelineStage);
    var found = null;
    stages.forEach(function (stage) {
      if (found) return;
      if (id && stage.id === id) found = stage;
      else if (name && normaliseStageName(stage.name) === name) found = stage;
    });
    return found;
  }

  function stageBucket(c) {
    var stage = stageOf(c);
    if (stage) return stage.bucket;
    if (isArchived(c) || (isCompleted(c) && c.quote_sent)) return 'fold';
    if (c && isCompleted(c) && !c.quote_sent) return 'quote';
    if (c && (c.status === 'booked' || c.status === 'confirmed')) return 'booked';
    return 'unmapped';
  }

  function isFoldedStage(c) {
    var bucket = stageBucket(c);
    return bucket === 'fold' || bucket === 'quote';
  }

  function firstStageInBucket(bucket, nameHint) {
    var stages = resource().pipeline_stages || [];
    var named = null;
    if (nameHint) {
      stages.forEach(function (s) {
        if (named) return;
        if (normaliseStageName(s.name) === normaliseStageName(nameHint)) named = s;
      });
      if (named) return named;
    }
    var found = null;
    stages.forEach(function (s) {
      if (found) return;
      if (s.bucket === bucket) found = s;
    });
    return found;
  }

  function pipelineBoardColumns() {
    var stages = resource().pipeline_stages || [];
    var cols = [];
    stages.forEach(function (s) {
      if (s.bucket === 'fold') return;
      cols.push({ id: s.id, name: String(s.name || '').replace(/^\s+/, ''), bucket: s.bucket, stageIds: [s.id] });
    });
    var fold = stages.filter(function (s) { return s.bucket === 'fold'; });
    if (fold.length) {
      cols.push({
        id: 'fold',
        name: 'Quoted and archived',
        bucket: 'fold',
        stageIds: fold.map(function (s) { return s.id; })
      });
    }
    return cols;
  }

  function pipelineColumnOf(c) {
    var stage = stageOf(c);
    var cols = pipelineBoardColumns();
    var found = null;
    cols.forEach(function (col) {
      if (found) return;
      if (stage && col.stageIds.indexOf(stage.id) !== -1) found = col;
    });
    return found || { id: 'unmapped', name: 'Unmapped', bucket: 'unmapped', stageIds: [] };
  }

  function caseHasConfirmedDiary(c) {
    if (!c) return false;
    var found = false;
    diary().forEach(function (ev) {
      if (found) return;
      if (diaryLayerFor(ev) !== 'confirmed') return;
      if (diaryEventMatchesCase(ev, c)) found = true;
    });
    return found;
  }

  // Thread and diary say where the card belongs. Null means we do not have
  // enough evidence to contradict the GHL stage, so the card stays in step.
  function impliedStage(c) {
    if (!c) return null;
    var res = resource();
    if (caseHasConfirmedDiary(c)) {
      return firstStageInBucket('booked', res.lane === 'patio' ? 'Scope Booked' : 'Lead Closed (scope booked)');
    }
    if (quoteOutstanding(c) || isCompleted(c)) return firstStageInBucket('quote');
    if (isWaiting(c)) {
      return firstStageInBucket('need', res.lane === 'patio'
        ? 'Contacted Waiting on Response'
        : 'New Lead (Replied/ Contacted)');
    }
    var facts = threadFacts(c);
    if (facts && facts.read_ok && facts.classification === 'ready_to_contact') {
      return firstStageInBucket('need', res.lane === 'patio'
        ? 'Client Needs To Be Contacted'
        : 'New Lead (Call + Qualify)');
    }
    return null;
  }

  function stageDrift(c) {
    var have = stageOf(c);
    var want = impliedStage(c);
    if (!have || !want) return null;
    if (have.id === want.id) return null;
    return { have: have, want: want };
  }

  function pipelineBoardCases() {
    return cases().filter(function (c) {
      if (isNonScopeDiaryMirror(c)) return false;
      return !!(stageOf(c) || c.opportunity_id || c.contact_id);
    });
  }

  // ---------------------------------------------------------------------------
  // Queue grouping, urgency and the follow-through counts.
  // ---------------------------------------------------------------------------
  function isBooked(c) {
    if (!c || isNonScopeDiaryMirror(c)) return false;
    if (stageBucket(c) === 'booked') return true;
    return c.status === 'booked' || c.status === 'confirmed';
  }

  function isNonScopeDiaryMirror(c) {
    if (!c) return false;
    var found = null;
    diary().forEach(function (ev) {
      if (found) return;
      if (ev.id && (String(ev.id) === String(c.id) || String(ev.id) === String(c.event_id))) found = ev;
    });
    if (!found) return false;
    return !diaryEventIsScopeBooking(found);
  }

  function bookedCount() {
    var seen = {};
    var n = 0;
    diary().forEach(function (ev) {
      if (diaryLayerFor(ev) !== 'confirmed') return;
      var matched = false;
      cases().forEach(function (c) {
        if (matched || isArchived(c)) return;
        if (diaryEventMatchesCase(ev, c)) matched = true;
      });
      if (!matched) return;
      var key = ev.id || ev.opportunity_id || (String(ev.start_iso) + String(ev.display_name));
      if (seen[key]) return;
      seen[key] = true;
      n += 1;
    });
    return n;
  }

  function bookedTileReason() {
    if (bookedCount() > 0) return 'diary events matched to a case';
    var data = state.data;
    if (data && data.diary_read && data.diary_read.read_ok === true && diary().length === 0) {
      return 'GHL calendar empty this week';
    }
    return 'diary not read';
  }

  function quoteStageLabel() {
    var names = (resource().pipeline_stages || []).filter(function (s) {
      return s.bucket === 'quote';
    }).map(function (s) { return String(s.name || '').replace(/^\s+/, ''); }).filter(Boolean);
    return names.length ? 'in ' + names.join(', ') : 'in the quote stage';
  }

  function derivedStatus(c) {
    var facts = threadFacts(c);
    if (facts && facts.read_ok) {
      if (facts.classification === 'waiting_reply') return 'waiting';
      if (facts.classification === 'follow_up_due') return 'follow_up';
      if (facts.classification === 'ready_to_contact') return 'ready';
    }
    return (c && c.status) || 'needs_decision';
  }

  function needsDecision(c) {
    var status = derivedStatus(c);
    return !!c && (status === 'needs_decision' || status === 'repair');
  }

  function isWaiting(c) {
    var status = derivedStatus(c);
    if (c && (status === 'waiting' || status === 'offer')) return true;
    var id = c && (c.stage_id || c.pipeline_stage_id || c.pipelineStageId);
    if (id === '4d3bcf9a-185d-4a90-98e0-e0805fdf4a02') return true;
    var name = normaliseStageName(c && (c.stage_name || c.pipeline_stage || c.pipelineStage));
    return name === normaliseStageName('Contacted Waiting on Response');
  }

  // A row in a known pipeline stage is visit/reply/quote demand. Engine
  // reason/proposal still marks a row assessed when the stage map missed it.
  function isAssessed(c) {
    if (!c) return false;
    if (typeof c.assessed === 'boolean') return c.assessed;
    if (stageOf(c)) return true;
    return !!(c.reason || c.proposal);
  }

  function isToBook(c) {
    if (!c || isArchived(c) || isCompleted(c) || isBooked(c) || isFoldedStage(c)) return false;
    return stageBucket(c) === 'need';
  }

  function quoteOutstanding(c) {
    if (stageBucket(c) === 'quote') return true;
    return !!c && isCompleted(c) && !c.quote_sent;
  }

  // Days since the enquiry landed. Returns null when the feed did not carry a date;
  // an unknown wait is said out loud, never rendered as a fresh enquiry.
  function daysWaiting(c) {
    var raw = c && (c.enquiry_date || c.created_at || c.enquiry_at);
    if (!raw) return null;
    var date = String(raw).slice(0, 10);
    var parts = date.split('-').map(Number);
    if (parts.length !== 3 || !parts[0]) return null;
    var then = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    var now = new Date();
    var today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    var days = Math.round((today - then) / 86400000);
    return days < 0 ? 0 : days;
  }

  function enquiryLine(c) {
    var raw = c && (c.enquiry_date || c.created_at || c.enquiry_at);
    if (!raw) return 'Enquiry date not read';
    var days = daysWaiting(c);
    return 'Came in ' + longDate(raw) + (days == null ? '' : ' (' + days + ' day' + (days === 1 ? '' : 's') + ' ago)');
  }

  function urgency(c) {
    if (isArchived(c)) return ['', 'Archived'];
    if (!isAssessed(c)) return ['', 'Not assessed'];
    if (isCompleted(c)) return c.quote_sent ? ['ok', 'Quoted'] : ['warn', 'Quote to send'];
    if (isBooked(c)) return ['ok', 'Booked'];
    if (quoteOutstanding(c)) return ['warn', 'Quote to send'];
    if (isWaiting(c)) return ['q', 'Waiting'];
    if (c.status === 'follow_up' || derivedStatus(c) === 'follow_up') return ['bad', 'Overdue'];
    if (c && (c.proposal || c.status === 'repair')) return ['bad', 'Act today'];
    var days = daysWaiting(c);
    if (days == null) return ['q', 'Wait unknown'];
    if (days >= 5) return ['warn', 'Waited ' + days + ' days'];
    return ['ai', 'This week'];
  }

  function queueGroups() {
    var list = visibleCases();
    var stages = (resource().pipeline_stages || []).filter(function (stage) {
      return stage.bucket === 'need' || stage.bucket === 'booked';
    });
    var grouped = stages.map(function (stage) {
      return [stage.name, list.filter(function (c) {
        var found = stageOf(c);
        return !!(found && found.id === stage.id);
      }).sort(function (a, b) {
        var rank = function (c) { return needsDecision(c) ? 0 : derivedStatus(c) === 'follow_up' ? 1 : isWaiting(c) ? 3 : 2; };
        var d = rank(a) - rank(b);
        if (d) return d;
        return (daysWaiting(b) || 0) - (daysWaiting(a) || 0);
      })];
    });
    var placed = {};
    grouped.forEach(function (g) {
      g[1].forEach(function (c) { placed[c.id] = true; });
    });
    grouped.push(['Enumerated, not yet assessed', list.filter(function (c) {
      return !placed[c.id];
    })]);
    return grouped;
  }

  function foldedCases() {
    return cases().filter(function (c) {
      return isArchived(c) || (isCompleted(c) && c.quote_sent) || isFoldedStage(c);
    });
  }

  // Follow-through counts. Captain default for v1 is the "this week plus last" window;
  // it is the window the backend was asked for, so the tiles count what came back.
  function followThrough() {
    var all = cases().filter(function (c) { return !isArchived(c); });
    return {
      to_book: all.filter(function (c) { return isToBook(c) && !isWaiting(c); }).length,
      waiting: all.filter(isWaiting).length,
      booked: bookedCount(),
      quotes: all.filter(quoteOutstanding).length,
      unassessed: all.filter(function (c) { return stageBucket(c) === 'unmapped' && !(c.reason || c.proposal); }).length
    };
  }

  // ---------------------------------------------------------------------------
  // The captain stamp. KEEP or CUT records a local decision. Send POSTs
  // sales_booking_stamp_write keyed to the pack week, not the Monday on screen.
  // Approve, Confirm, diary writes and any customer send stay held.
  // ---------------------------------------------------------------------------
  function stampListHas(list, c) {
    if (!c || !Array.isArray(list)) return false;
    var ids = [c.id, c.opportunity_id].filter(Boolean).map(String);
    return list.some(function (x) { return ids.indexOf(String(x)) !== -1; });
  }

  function stampStateOf(c) {
    if (!c) return 'none';
    if (c.stamp_state === 'approved') return 'keep';
    if (c.stamp_state === 'rejected') return 'cut';
    if (stampListHas(state.stamp.rejected, c)) return 'cut';
    if (stampListHas(state.stamp.approved, c)) return 'keep';
    if (isBooked(c)) return 'booked';
    return 'none';
  }

  function stampCase(id, decision) {
    var list = cases();
    var found = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) found = list[i];
    if (!found) return { ok: false, reason: 'no_case' };
    if (caseLayer(found) === 'blocked') return { ok: false, reason: 'slot_blocked', sent: false, wrote_calendar: false };
    if (blockingDiaryEvent(found)) return { ok: false, reason: 'slot_still_held', sent: false, wrote_calendar: false };
    if (!found.proposal || !found.proposal.start_iso) return { ok: false, reason: 'no_proposed_time', sent: false, wrote_calendar: false };
    state.stamp.approved = state.stamp.approved.filter(function (x) { return x !== id; });
    state.stamp.rejected = state.stamp.rejected.filter(function (x) { return x !== id; });
    if (decision === 'keep') state.stamp.approved.push(id);
    else if (decision === 'cut') state.stamp.rejected.push(id);
    else return { ok: true, decision: 'cleared', sent: false, wrote_calendar: false };
    var d = draftKey(found) ? draftFor(found) : null;
    if (d) state.stamp.decisions[id] = { text: d.text || '', revision: d.revision || 0, sender: resolveSender().number };
    return { ok: true, decision: decision, case_id: id, sent: false, wrote_calendar: false, held: true };
  }

  function stampRecord() {
    var res = resource();
    var key = function (id) { return 'opp:' + id; };
    var mine = function (id) { return cases().some(function (c) { return c.id === id; }); };
    var decisions = {};
    Object.keys(state.stamp.decisions).forEach(function (id) {
      if (mine(id)) decisions[key(id)] = state.stamp.decisions[id];
    });
    return {
      captain: 'marnin',
      profile: res.lane === 'patio' ? 'patio-' + res.id : 'fencing-' + res.id,
      week_start: state.weekStart,
      approved: state.stamp.approved.filter(mine).map(key),
      rejected: state.stamp.rejected.filter(mine).map(key),
      decisions: decisions,
      sent: false,
      calendar_written: false
    };
  }

  function stampWriteBody() {
    var idOf = function (id) {
      var list = cases();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id || list[i].opportunity_id === id) return list[i].opportunity_id || list[i].id;
      }
      return id;
    };
    var mine = function (id) {
      return cases().some(function (c) { return c.id === id || c.opportunity_id === id; });
    };
    var decisions = {};
    Object.keys(state.stamp.decisions || {}).forEach(function (id) {
      var val = state.stamp.decisions[id];
      if (val === 'hold' || val === 'replace') decisions[idOf(id)] = val;
    });
    return {
      captain: 'marnin',
      approved: state.stamp.approved.filter(mine).map(idOf),
      rejected: state.stamp.rejected.filter(mine).map(idOf),
      decisions: decisions,
      stage_moves: []
    };
  }

  async function postStamp(body) {
    var previewApi = global.SALES_BOOKING_PREVIEW_API;
    if (previewApi && typeof global.fetch === 'function') {
      var join = String(previewApi).indexOf('?') >= 0 ? '&' : '?';
      var resp = await global.fetch(String(previewApi) + join + 'action=sales_booking_stamp_write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sales_booking_stamp_write',
          resource: body.resource,
          week_start: body.week_start,
          stamp: body.stamp
        }),
        cache: 'no-store'
      });
      var json = {};
      try { json = await resp.json(); } catch (readErr) { json = {}; }
      if (!resp.ok || json.ok === false) {
        var previewFail = new Error((json && json.error) || ('stamp_write_failed (' + resp.status + ')'));
        previewFail.status = resp.status;
        throw previewFail;
      }
      return json;
    }
    if (typeof global.opsPost === 'function') {
      return global.opsPost('sales_booking_stamp_write', body);
    }
    var missing = new Error('no_stamp_transport');
    missing.kind = 'no_transport';
    throw missing;
  }

  async function writeStamp(id, decision) {
    var local = stampCase(id, decision);
    if (!local.ok) return local;
    local.sent = false;
    local.wrote_calendar = false;
    var body = {
      resource: state.resourceId,
      week_start: packWeekStart(),
      stamp: stampWriteBody()
    };
    state.lastStampCall = { action: 'sales_booking_stamp_write', body: body };
    try {
      await postStamp(body);
      local.posted = true;
      await load(state.resourceId, state.weekStart);
    } catch (e) {
      if (e && e.kind === 'no_transport') {
        local.posted = false;
        return local;
      }
      local.ok = false;
      local.posted = false;
      local.reason = e && e.message ? e.message : 'stamp_write_failed';
      state.error = local.reason;
    }
    return local;
  }

  // Standing rule: cancelled in the thread with the event still in the diary is a
  // BLOCKED SLOT until the delete reads back. That is occupancy, so it holds against
  // any proposal landing on those minutes, not only against the same customer's row.
  function blockingDiaryEvent(c) {
    if (!c || !c.proposal || !c.proposal.start_iso) return null;
    var start = String(c.proposal.start_iso);
    var end = String(c.proposal.end_iso || c.proposal.start_iso);
    var found = null;
    diary().forEach(function (ev) {
      if (found || diaryLayerFor(ev) !== 'blocked') return;
      var evStart = String(ev.start_iso || '');
      var evEnd = String(ev.end_iso || ev.start_iso || '');
      if (!evStart) return;
      if (evStart < end && start < evEnd) found = ev;
    });
    return found;
  }

  function stampBlockReason(c) {
    if (caseLayer(c) === 'blocked') {
      return 'Cancelled in the thread with the diary event still present. The slot stays blocked until the delete reads back.';
    }
    var clash = blockingDiaryEvent(c);
    if (clash) {
      return 'This time is still held by a cancelled booking (' + (clash.display_name || 'diary event') + ') that has not been deleted yet.';
    }
    if (!c || !c.proposal || !c.proposal.start_iso) return 'No proposed time on this case, so there is nothing to stamp.';
    return null;
  }

  // The why-stamp checklist. These are the engine's OWN reasons, verbatim, and they
  // are shown so the captain can weigh them, never used to hide the row. A coverage
  // gap or an undated customer is a caution on a stampable proposal; only a cancelled
  // slot and a missing proposal actually remove the stamp.
  // The engine emits the same fact in several wordings (its own warning, its review
  // reason, and the structured gap list). Deduping on exact text let all three through
  // and turned the card into the essay the captain has already rejected once. Each
  // fact is therefore keyed by what it MEANS, and the first, shortest statement wins.
  function checklistTopic(text) {
    var t = String(text || '').toLowerCase();
    if (/coverage|unobserved|not execution-ready/.test(t)) return 'coverage';
    if (/ai[- ]proposed|customer date unspecified|weekday without a calendar date|time without a date/.test(t)) return 'ai_date';
    if (/exact acceptance|not bound to a preceding sent offer|qualified yes/.test(t)) return 'acceptance';
    if (/cancelled|blocked|delete reads back/.test(t)) return 'blocked';
    if (/lane/.test(t)) return 'lane';
    return 'other:' + t;
  }

  function stampChecklist(c) {
    var out = [];
    var seen = {};
    var push = function (level, text) {
      var t = String(text || '').trim();
      if (!t) return;
      var key = checklistTopic(t);
      if (seen[key]) return;
      seen[key] = true;
      out.push({ level: level, text: t });
    };
    var p = (c && c.proposal) || null;
    var clash = blockingDiaryEvent(c);
    if (clash) push('bad', 'This time is still held by a cancelled booking (' + (clash.display_name || 'diary event') + ') awaiting delete readback.');
    if (p) {
      (p.coverage_gaps || []).length
        ? push('warn', 'Coverage not read: ' + (p.coverage_gaps || []).join(', '))
        : push('ok', 'Calendar, leave and travel coverage read.');
      if (p.date_source === 'ai_proposed' || p.customer_date_specified === false) {
        push('warn', 'AI-proposed date. The customer did not name this day.');
      } else if (p.customer_date_specified) {
        push('ok', 'Customer named this date.');
      }
    }
    // Anything the engine said that is not already covered above still gets through.
    (c && c.review_reasons
      ? c.review_reasons
      : (c && c.proposal && Array.isArray(c.proposal.why)
        ? c.proposal.why
        : (c && c.reason ? [c.reason] : []))).forEach(function (r) {
      push('warn', r);
    });
    push(c && c.exact_acceptance ? 'ok' : 'warn',
      c && c.exact_acceptance
        ? 'Exact acceptance is bound to a sent offer. Confirm booking is available.'
        : 'No exact acceptance yet, so this stamp offers a time. It does not confirm one.');
    return out;
  }

  // Evidence chips: the short facts behind the checklist.
  function evidenceChips(c) {
    var p = (c && c.proposal) || null;
    var facts = threadFacts(c);
    var chips = [];
    chips.push([p && !(p.coverage_gaps || []).length ? 'ok' : 'warn',
      p && (p.coverage_gaps || []).length ? 'Coverage partial' : 'Coverage read']);
    chips.push([p && p.customer_date_specified ? 'ok' : 'warn',
      p && p.customer_date_specified ? 'Customer date' : 'AI date']);
    chips.push([c && c.exact_acceptance ? 'ok' : '', c && c.exact_acceptance ? 'Acceptance bound' : 'No acceptance']);
    if (facts && facts.read_ok === false) chips.push(['bad', 'Thread not read']);
    else if (facts && facts.quiet_window) {
      chips.push(['warn', 'Quiet ' + (typeof facts.quiet_window === 'string' ? facts.quiet_window : 'window')]);
    }
    if (c && c.send_evidence === 'sent') chips.push(['warn', 'Offer already out']);
    if (blockingDiaryEvent(c)) chips.push(['bad', 'Slot still held']);
    if (c && c.not_in_this_read) chips.push(['warn', 'not in this read']);
    return chips;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function deskDays(res) {
    if (res.desk_rules.days) return res.desk_rules.days;
    var out = [];
    for (var i = 0; i < 5; i++) if (!(res.desk_rules.no_wednesday && i === 2)) out.push(i);
    return out;
  }

  function renderQueueRow(c) {
    var u = urgency(c);
    var stamped = stampStateOf(c);
    var slot = proposalSlotLabel(c);
    var facts = threadFacts(c);
    var quiet = facts && facts.read_ok === false
      ? ' · thread not read'
      : (facts && facts.quiet_window ? ' · quiet ' + esc(typeof facts.quiet_window === 'string' ? facts.quiet_window : 'window') : '');
    return '<button type="button" class="lead" data-booking-case="' + esc(c.id) + '" aria-pressed="' + (c.id === state.selectedId) + '">' +
      '<span class="top"><span class="name">' + esc(c.display_name || 'Unnamed enquiry') + ' · ' + esc(caseSuburb(c) || 'Suburb unknown') + ' · ' + esc(jobTypeLabel(c)) + '</span>' +
      '<span class="pill ' + esc(u[0]) + '">' + esc(stamped === 'keep' ? 'KEEP' : stamped === 'cut' ? 'CUT' : u[1]) + '</span></span>' +
      '<div class="sub">' + esc(enquiryLine(c)) + (slot ? ' · ' + esc(slot) : '') + quiet + '</div></button>';
  }

  function renderQueue() {
    var groups = queueGroups();
    var html = '';
    groups.forEach(function (g) {
      html += '<div class="qgroup">' + esc(g[0]) + '<span class="count">' + g[1].length + '</span></div>';
      html += g[1].length
        ? g[1].map(renderQueueRow).join('')
        : '<div class="qempty">Nobody here. Empty is not a completed audit.</div>';
    });
    var fold = foldedCases();
    html += '<button type="button" class="qgroup qtoggle" data-booking-fold="1">' +
      (state.showArchived ? 'Hide' : 'Show') + ' quoted and archived<span class="count">' + fold.length + '</span></button>';
    if (state.showArchived) {
      html += fold.length ? fold.map(renderQueueRow).join('') : '<div class="qempty">Nothing quoted or archived in this read.</div>';
    }
    return html;
  }

  function stageTag(layer, stamped) {
    if (layer === 'confirmed') return 'CONFIRMED';
    if (layer === 'blocked') return 'CANCELLED';
    if (layer === 'offer') return 'OFFERED · NO REPLY';
    if (layer === 'personal') return 'PERSONAL';
    if (layer === 'busy') return 'Busy';
    if (layer === 'leave') return 'LEAVE';
    return stamped === 'keep' ? 'STAMPED KEEP' : 'PROPOSED';
  }

  // One calendar card: stage tag, then time and name, then address and suburb, then job.
  function renderEvent(block, kind) {
    if (!layerEnabled(kind)) return '';
    var hour = hourFromIso(block.start_iso);
    var day = dayIndexFromIso(block.start_iso, state.weekStart);
    if (hour == null || day == null) return '';
    var h = durationHours(block.start_iso, block.end_iso);
    var stamped = stampStateOf({ id: block.id });
    var cls = 'ev ' + kind + (kind === 'proposal' && stamped === 'keep' ? ' stamped' : '') + (block.id && block.id === state.selectedId ? ' sel' : '');
    var place = (block.address ? block.address + ', ' : '') + (block.suburb || '');
    // Overlapping cards share the column rather than stacking: a proposal hidden under
    // another proposal is a line the captain never gets to stamp.
    var lanes = Math.max(1, block.lanes || 1);
    var lane = block.lane || 0;
    var width = 100 / lanes;
    var geom = 'left:calc(' + (lane * width) + '% + 3px);width:calc(' + width + '% - 6px);right:auto;';
    return '<button type="button" class="' + cls + ' event ' + kind + '" data-booking-case="' + esc(block.id || '') + '"' +
      (block.not_in_this_read ? ' data-not-in-read="1"' : '') +
      ' style="' + geom + 'top:' + topPx(hour) + 'px;height:' + Math.max(44, h * PX_PER_HOUR) + 'px">' +
      '<span class="stage">' + esc(stageTag(kind, stamped)) + '</span>' +
      '<span class="t evtime">' + esc(clockLabel(hour)) + ' · ' + esc(block.display_name || 'Diary') + '</span>' +
      '<span class="n evname">' + esc(place || 'Address not given yet') + '</span>' +
      (block.not_in_this_read ? '<span class="readtag">not in this read</span>' : '') +
      '<span class="j evplace">' + esc(block.job || '') + '</span></button>';
  }

  function renderWindows(c) {
    if (!state.layers.proposal || !c.proposal || !c.proposal.window_start_iso) return '';
    var hour = hourFromIso(c.proposal.window_start_iso);
    var day = dayIndexFromIso(c.proposal.window_start_iso, state.weekStart);
    if (hour == null || day == null) return '';
    var h = durationHours(c.proposal.window_start_iso, c.proposal.window_end_iso || c.proposal.window_start_iso);
    return '<div class="window" style="top:' + topPx(hour) + 'px;height:' + Math.max(24, h * PX_PER_HOUR) + 'px"><b>Window</b>' + esc(c.proposal.window_label || '') + '</div>';
  }

  // Which layer a case paints on. A cancelled thread whose diary event is still there
  // is 'blocked': the slot stays occupied until the delete reads back.
  function caseLayer(c) {
    if (c.status === 'repair' && c.event_id) return 'blocked';
    if (isBooked(c) || c.event_id) return 'confirmed';
    var heldOffer = c.status === 'offer' || c.status === 'waiting' || c.status === 'follow_up'
      || c.send_evidence === 'sent' || ((c.exact_acceptance || c.accepted_start_iso) && !c.event_id);
    if (heldOffer) return 'offer';
    return 'proposal';
  }

  function layerEnabled(kind) {
    if (kind === 'busy') return !!state.layers.personal;
    return !!state.layers[kind];
  }

  // A busy diary block whose case has been cancelled in the thread is NOT a confirmed
  // booking. The slot stays occupied until the delete reads back, but it must read as
  // cancelled, or the week shows a visit nobody is attending. Company and personal
  // events never become CONFIRMED unless they are a booked scope.
  function diaryLayerFor(ev) {
    if (!ev) return 'personal';
    var kind = String(ev.kind || '').toLowerCase();
    if (kind === 'leave' || ev.layer === 'leave') return 'leave';
    if (kind === 'personal' || ev.layer === 'personal') return 'personal';
    if (diaryEventIsScopeBooking(ev)) {
      var list = cases();
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!diaryEventMatchesCase(ev, c) && c.id !== ev.id && c.event_id !== ev.id) continue;
        if (caseLayer(c) === 'blocked') return 'blocked';
      }
      return 'confirmed';
    }
    if (kind === 'busy' || String(ev.show_as || '').toLowerCase() === 'busy' || ev.layer === 'busy') return 'busy';
    return 'personal';
  }

  function diaryOccupiesDay(ev) {
    if (!ev) return false;
    if (ev.blocks_capacity === false) return false;
    if (ev.blocks_capacity === true) return true;
    var layer = diaryLayerFor(ev);
    return layer === 'confirmed' || layer === 'blocked' || layer === 'leave' || layer === 'busy';
  }

  // Assign each card a lane so overlapping cards sit side by side. Cards that clash
  // share the column width; a card alone on its minutes keeps the full width.
  function packLanes(cards) {
    var visible = cards.filter(function (card) {
      return layerEnabled(card.kind) && hourFromIso(card.block.start_iso) != null;
    });
    visible.sort(function (a, b) { return String(a.block.start_iso) < String(b.block.start_iso) ? -1 : 1; });
    var spanOf = function (card) {
      var start = hourFromIso(card.block.start_iso);
      return { start: start, end: start + Math.max(0.5, durationHours(card.block.start_iso, card.block.end_iso)) };
    };
    // Group into clusters of mutually overlapping cards, then lane within a cluster.
    var clusters = [];
    var current = null;
    visible.forEach(function (card) {
      var sp = spanOf(card);
      if (current && sp.start < current.end) {
        current.cards.push(card);
        current.end = Math.max(current.end, sp.end);
      } else {
        current = { cards: [card], end: sp.end };
        clusters.push(current);
      }
    });
    clusters.forEach(function (cluster) {
      var laneEnds = [];
      cluster.cards.forEach(function (card) {
        var sp = spanOf(card);
        var lane = 0;
        while (lane < laneEnds.length && laneEnds[lane] > sp.start) lane += 1;
        laneEnds[lane] = sp.end;
        card.block.lane = lane;
      });
      cluster.cards.forEach(function (card) { card.block.lanes = laneEnds.length; });
    });
    return visible;
  }

  function renderCalendar() {
    var data = state.data;
    var res = resource();
    var cal = data && data.resource && data.resource.calendar;
    if (calendarUnread(data)) {
      var reason = (data.diary_read && (data.diary_read.reason || data.diary_read.source))
        || (cal && cal.error)
        || 'This resource has no verified provider calendar.';
      return '<div class="unknown unknownstaff"><h3>Calendar not connected</h3><p>' + esc(reason) + '</p><p class="small">Missing coverage is not a free week.</p></div>';
    }
    if (data && cal && cal.ok === false) {
      return '<div class="unknown unknownstaff"><h3>Calendar not connected</h3><p>' + esc(cal.error || 'This resource has no verified provider calendar.') + '</p><p class="small">Missing coverage is not a free week.</p></div>';
    }
    var days = deskDays(res);
    var headers = '<span></span>' + DAYS.map(function (name, i) {
      var iso = addDays(state.weekStart, i);
      var off = days.indexOf(i) === -1;
      return '<div class="dayheader' + (off ? ' off' : '') + '">' + name.slice(0, 3) + '<b>' + iso.slice(8, 10) + '</b></div>';
    }).join('');
    var cols = '';
    for (var d = 0; d < 5; d++) {
      var off = days.indexOf(d) === -1;
      var body = '';
      if (off) {
        // A desk rule says where new work may be OFFERED. It does not overrule the
        // diary: when the provider already has events on an off-lane day, the full
        // hatch would paint real bookings as an impossible day, so the rule is stated
        // as a banner instead and the events keep the column.
        var busy = diary().some(function (ev) {
          return dayIndexFromIso(ev.start_iso, state.weekStart) === d && diaryOccupiesDay(ev);
        });
        body += busy
          ? '<div class="block rulebanner" style="top:0;height:' + Math.round(PX_PER_HOUR * 0.55) + 'px"><strong>Outside the ' + esc(res.name) + ' lane</strong><span>' + esc(res.desk_rules.lane_note || 'No new scopes offered here') + '</span></div>'
          : '<div class="block off"><strong>' + (res.desk_rules.days ? 'Not a ' + esc(res.name) + ' day' : 'Unavailable') + '</strong><span>' + esc(res.desk_rules.days ? 'Tue and Fri only' : 'Desk rule') + '</span></div>';
      } else if (res.desk_rules.monday_from > DAY_START && d === 0) {
        body += '<div class="block" style="top:0;height:' + ((res.desk_rules.monday_from - DAY_START) * PX_PER_HOUR) + 'px"><strong>Not available</strong><span>Monday before ' + res.desk_rules.monday_from + ':00</span></div>';
      }
      var band = res.desk_rules.protected_band;
      if (band && band.day === d) {
        body += '<div class="block band" style="top:' + topPx(band.from) + 'px;height:' + ((band.to - band.from) * PX_PER_HOUR) + 'px"><strong>' + esc(band.label) + '</strong><span>' + esc(band.note) + '</span></div>';
      }
      var dayCards = [];
      diary().forEach(function (ev) {
        if (dayIndexFromIso(ev.start_iso, state.weekStart) !== d) return;
        dayCards.push({ block: ev, kind: diaryLayerFor(ev) });
      });
      cases().forEach(function (c) {
        if (!c.proposal || dayIndexFromIso(c.proposal.start_iso, state.weekStart) !== d) return;
        body += renderWindows(c);
        dayCards.push({
          block: {
            id: c.id,
            start_iso: c.proposal.start_iso,
            end_iso: c.proposal.end_iso,
            display_name: c.display_name,
            address: c.address || '',
            suburb: caseSuburb(c),
            job: c.job || '',
            not_in_this_read: !!c.not_in_this_read
          },
          kind: caseLayer(c)
        });
      });
      packLanes(dayCards).forEach(function (card) {
        body += renderEvent(card.block, card.kind);
      });
      cols += '<div class="daycol daycolumn">' + body + '</div>';
    }
    var times = '';
    for (var h = DAY_START; h <= DAY_END; h++) {
      times += '<div class="time small" style="position:absolute;right:6px;top:' + topPx(h) + 'px;transform:translateY(-50%)">' + (h < 10 ? '0' : '') + h + ':00</div>';
    }
    var evCount = diary().length;
    var info = '<span>' + evCount + ' provider event' + (evCount === 1 ? '' : 's') + '</span>';
    if (evCount === 0) info += '<span class="repairtext">Empty diary is not spare capacity. Leave unread.</span>';
    var legend = [
      ['confirmed', '', 'Confirmed booking'],
      ['proposal', 'proposal', 'Proposed, not sent'],
      ['offer', 'offer', 'Offered, waiting on reply'],
      ['blocked', 'blocked', 'Cancelled, still in diary'],
      ['personal', 'personal', 'Personal']
    ].map(function (l) {
      return '<label class="layer"><input type="checkbox" data-booking-layer="' + l[0] + '"' + (state.layers[l[0]] ? ' checked' : '') + '>' +
        '<span class="legendline ' + l[1] + '"></span>' + l[2] + '</label>';
    }).join('');
    return '<div class="layers">' + legend + '</div>' +
      '<div class="calendarinfo">' + info + '</div>' +
      '<div class="dayheaders">' + headers + '</div>' +
      '<div class="calbody calendarbody"><div class="timeaxis" style="position:relative">' + times + '</div>' + cols + '</div>' +
      '<div class="dayselect">' + DAYS.map(function (name, i) {
        return '<button type="button" data-booking-day="' + i + '">' + name.slice(0, 3) + '<b>' + addDays(state.weekStart, i).slice(8, 10) + '</b></button>';
      }).join('') + '</div>' +
      '<div class="dayagenda">' + renderAgenda() + '</div>' +
      '<div class="calfoot calendarfoot">The customer is promised the window, never the minute. A window is not acceptance. Leave and other calendars are not in this read.</div>';
  }

  function renderAgenda() {
    var items = diary().concat(cases().filter(function (c) {
      return c.proposal && dayIndexFromIso(c.proposal.start_iso, state.weekStart) != null;
    }).map(function (c) {
      return { start_iso: c.proposal.start_iso, display_name: c.display_name, suburb: caseSuburb(c), id: c.id, layer: caseLayer(c) };
    }));
    items.sort(function (a, b) { return String(a.start_iso) < String(b.start_iso) ? -1 : 1; });
    if (!items.length) return '<div class="emptyqueue qempty">No provider events or proposals in this week.</div>';
    return items.map(function (it) {
      return '<button type="button" class="lead" data-booking-case="' + esc(it.id || '') + '"><strong>' + esc(String(it.start_iso || '').slice(11, 16)) + '</strong> ' + esc(it.display_name || '') + ' · ' + esc(it.suburb || '') + '</button>';
    }).join('');
  }

  function renderMessages() {
    var conv = state.conversation;
    var selected = selectedCase();
    if (!selected || !selected.contact_id) return '<div class="comms-empty msg sys">No GHL contact on this case. Thread is not shown.</div>';
    if (conv.contactId && conv.contactId !== selected.contact_id) return '<div class="comms-empty msg sys">Thread belongs to another case; it is not shown.</div>';
    if (conv.loading) return '<div class="comms-empty msg sys">Loading conversation…</div>';
    if (conv.error) return '<div class="comms-empty msg sys">Conversation failed: ' + esc(conv.error) + '</div>';
    if (!conv.contactId) return '<div class="comms-empty msg sys">Select a case with a GHL contact to open the thread.</div>';
    if (!conv.messages || !conv.messages.length) return '<div class="comms-empty msg sys">No messages in this bounded read. Pagination limits still apply.</div>';
    return conv.messages.map(function (msg) {
      var dir = msg.direction === 'outbound' ? 'out' : 'in';
      var ts = msg.timestamp ? String(msg.timestamp) : '';
      var type = String(msg.type || 'SMS');
      var who = dir === 'in' ? (selected.display_name || 'Customer') : (msg.sender_name || resource().name);
      return '<div class="msg comms-msg ' + dir + ' ' + (dir === 'out' ? 'outbound' : 'inbound') + '">' +
        '<small class="comms-msg-meta">' + esc(who) + ' · ' + esc(ts) + ' · ' + esc(type) + '</small>' +
        esc(msg.body || msg.subject || type) + '</div>';
    }).join('');
  }

  // Detail panel, trimmed to the captain's list: name, address, job, proposed text,
  // thread, Send and Edit. Send and Confirm are hard-held.
  function renderDetail() {
    var c = selectedCase();
    var res = resource();
    if (!c) {
      return '<div class="detailhead"><p class="muted">No case selected</p><h2>Choose an enquiry</h2></div>' +
        '<div class="detailbody"><p class="muted">The thread, the proposed time and the draft stay together for one request.</p></div>';
    }
    bindDraft(c);
    var d = draftKey(c) ? draftFor(c) : { text: '' };
    var kind = actionKind(c);
    var route = resolveSender(res);
    var u = urgency(c);
    var stamped = stampStateOf(c);
    var pill = stamped === 'keep' ? '<span class="pill ok">Stamped KEEP · not sent</span>'
      : stamped === 'cut' ? '<span class="pill bad">Stamped CUT</span>'
      : '<span class="pill ' + esc(u[0]) + '">' + esc(u[1]) + '</span>';
    var place = (c.address ? c.address + ', ' : '') + (caseSuburb(c) || '');
    var slot = proposalSlotLabel(c) || 'No proposed time yet';
    var conflict = d.conflict
      ? '<div class="notice error">Time changed. Your edited draft was kept. Suggested text is ready for review, not applied.</div>'
      : '';
    var actionLabel = kind === 'confirm_booking' ? 'Confirm booking' : kind === 'repair' ? 'Calendar repair' : 'Approve offer';
    var compose = c.proposal
      ? '<div class="compose"><div class="row" style="justify-content:space-between"><h3>Proposed text</h3>' +
        '<span class="small muted">from ' + esc(route.label) + ' · edit it right here</span></div>' +
        '<textarea data-booking-draft="1" aria-label="Draft SMS">' + esc(d.text || '') + '</textarea></div>'
      : '<div class="compose"><h3>Proposed text</h3><p class="small muted">No proposed time yet, so there is no text to review.</p></div>';
    var timeInput = c.proposal && c.proposal.start_iso
      ? '<label class="small muted">Proposed time<input data-booking-time type="text" value="' + esc(c.proposal.start_iso) + '" aria-label="Proposed time"></label>'
      : '';
    // The stamp must be unavailable on the same terms everywhere. A cancelled job whose
    // diary event is still there is not a time to offer, and a case with no proposed
    // time has nothing to decide, so neither surface offers a stamp for them.
    var stampRow;
    var blockReason = stampBlockReason(c);
    if (blockReason) {
      stampRow = '<p class="fine">' + esc(blockReason) + '</p>';
    } else {
      stampRow = '<div class="stamprow"><button type="button" class="keep" data-booking-stamp="keep" data-booking-stamp-id="' + esc(c.id) + '">Stamp KEEP</button>' +
        '<button type="button" class="cut" data-booking-stamp="cut" data-booking-stamp-id="' + esc(c.id) + '">Cut</button>' +
        (stamped === 'keep' || stamped === 'cut' ? '<button type="button" data-booking-stamp="clear" data-booking-stamp-id="' + esc(c.id) + '">Undo</button>' : '') + '</div>' +
        '<p class="fine">Send message writes the captain stamp. It does not send a customer text, approve an offer, confirm a visit or write the diary.</p>';
    }
    var sendDisabled = !!blockReason;
    return '<div class="detailhead"><div class="row">' + pill + '</div>' +
      '<h2>' + esc(c.display_name || 'Enquiry') + '</h2>' +
      '<p class="sub muted">' + esc(place || '') + (c.address ? '' : (place ? '' : 'Address not given yet')) + ' · ' + esc(jobTypeLabel(c)) + (c.contact_id ? '' : ' · no GHL contact') +
      (c.not_in_this_read ? ' · <span class="readtag">not in this read</span>' : '') + '</p>' +
      '<p class="sub muted">' + esc(enquiryLine(c)) + ' · ' + esc(slot) + '</p></div>' +
      '<div class="thread big" id="salesBookingThread">' + renderMessages() + '</div>' +
      compose +
      '<div class="actionzone">' +
      '<div class="holdnote">' + esc(HOLD_REASON) + '</div>' + conflict +
      '<div class="senderline small muted">' + senderLine(res) + ' · To this case only · Draft revision ' + esc(d.revision || 0) + (outsideSmsHours() ? ' · outside 08:00 to 18:00 Perth' : '') + '</div>' +
      '<button type="button" class="primary" data-booking-stamp-send="1" data-booking-stamp-id="' + esc(c.id) + '"' +
      (sendDisabled ? ' disabled title="' + esc(blockReason || HOLD_REASON) + '"' : '') +
      '>Send message</button>' +
      '<button type="button" data-booking-confirm="1" disabled title="' + esc(HOLD_REASON) + '">' + esc(actionLabel) + ' (held)</button>' +
      stampRow +
      timeInput +
      '<details class="inline-details"><summary>Evidence and coverage for this case</summary><p class="small muted">' + esc(c.reason || 'No reason filed') + (c.exact_acceptance ? ' Exact acceptance is recorded.' : ' Exact acceptance is not recorded.') + '</p></details>' +
      '</div>';
  }

  function renderTiles() {
    var f = followThrough();
    return [
      ['Enquiries still to book', f.to_book, f.unassessed
        ? 'GHL stages that still need a booking. ' + f.unassessed + ' more CRM rows are enumerated but not assessed, so they are not counted here'
        : 'GHL stages that still need a booking'],
      ['Waiting on a reply', f.waiting, 'GHL stage or thread classified as waiting'],
      ['Booked to quote this week', f.booked, bookedTileReason()],
      ['Quotes to send', f.quotes, quoteStageLabel()]
    ].map(function (t) {
      return '<div class="tile"><div class="k">' + esc(t[0]) + '</div><div class="v">' + t[1] + '</div><div class="s">' + esc(t[2]) + '</div></div>';
    }).join('') +
      '<div class="tile sales"><div class="k">Sales side</div>' +
      '<div class="v" style="font-size:15px;margin-top:6px"><button type="button" class="linklike" data-sales-tab="performance">Open Performance</button></div>' +
      '<div class="s">Weekly numbers live there, not here.</div></div>';
  }

  function renderWeekTruth() {
    var data = state.data;
    if (!data) return '';
    var list = cases();
    var offers = stampableOfferList();
    var bits = [];
    bits.push('<span class="ok">' + bookedCount() + ' booked</span>');
    bits.push(list.filter(function (c) { return caseLayer(c) === 'blocked'; }).length + ' cancelled still in diary');
    bits.push(offers.length + ' proposals unsent');
    bits.push(list.filter(isWaiting).length + ' texts out with no reply');
    var cov = data.coverage || {};
    if (cov.full_population !== true) bits.push('<strong>' + esc(cov.total == null ? 'CRM rows' : cov.total + ' CRM rows') + '</strong> are not visit demand');
    return '<div class="weektruth"><strong>Week truth</strong>' + bits.map(function (b) { return '<span>' + b + '</span>'; }).join('') + '</div>';
  }

  function renderStampBoard() {
    // Only lines that carry a proposed time are stampable: a KEEP on a case with no
    // proposal would decide nothing. The count of live cases held back is stated so a
    // short board never reads as a short week.
    var live = cases().filter(function (c) {
      return !isArchived(c) && !isCompleted(c) && !isFoldedStage(c);
    });
    // A cancelled job whose diary event is still there is not a line to offer; the slot
    // is blocked until the delete reads back. Everything else with a proposed time is
    // stampable, cautions and all. When the pack published offers, that list is the
    // board, not the enumerated roster.
    var list = stampableOfferList();
    var listed = {};
    list.forEach(function (c) { listed[c.id] = true; });
    // Every line this board does not offer says WHY, grouped by the reason and naming
    // the people. A withheld row must never just vanish into a count.
    var withheldGroups = {};
    live.forEach(function (c) {
      if (listed[c.id]) return;
      var why = isPackOfferCase(c) && stampBlockReason(c)
        ? stampBlockReason(c)
        : (isAssessed(c) ? stampBlockReason(c) || 'Enumerated CRM row the engine has not assessed yet.' : 'Enumerated CRM row the engine has not assessed yet.');
      if (!why) why = 'Enumerated CRM row the engine has not assessed yet.';
      if (!withheldGroups[why]) withheldGroups[why] = [];
      withheldGroups[why].push(c.display_name || c.id);
    });
    var rec = stampRecord();
    var rows = list.map(function (c) {
      var st = stampStateOf(c);
      bindDraft(c);
      var d = draftKey(c) ? draftFor(c) : { text: '' };
      var slot = proposalSlotLabel(c) || 'No proposed time';
      var chips = evidenceChips(c).map(function (ch) {
        return '<span class="chip ' + esc(ch[0]) + '">' + esc(ch[1]) + '</span>';
      }).join('');
      var checklist = stampChecklist(c).map(function (item) {
        return '<li class="' + esc(item.level) + '">' + esc(item.text) + '</li>';
      }).join('');
      return '<div class="stampcard' + (st === 'keep' ? ' stamped' : st === 'cut' ? ' weak' : needsDecision(c) ? ' conflict' : '') + '"' +
        (c.not_in_this_read ? ' data-not-in-read="1"' : '') + '>' +
        '<div><button type="button" class="linklike" data-booking-case="' + esc(c.id) + '"><b>' + esc(c.display_name || 'Enquiry') + ' · ' + esc(caseSuburb(c) || '') + '</b></button>' +
        (c.not_in_this_read ? '<div class="readtag">not in this read</div>' : '') +
        '<div class="slot">' + esc(slot) + '</div><div class="why">' + esc(c.job || jobTypeLabel(c)) + ' · ' + esc(statusLabel(c.status)) + '</div>' +
        '<div class="chips">' + chips + '</div></div>' +
        '<div><div class="small muted">' + esc(d.text ? d.text : 'No draft for this case.') + '</div>' +
        '<ul class="whylist">' + checklist + '</ul></div>' +
        '<div class="actions"><button type="button" class="keep" data-booking-stamp="keep" data-booking-stamp-id="' + esc(c.id) + '"' + (st === 'keep' ? ' aria-pressed="true"' : '') + '>KEEP</button>' +
        '<button type="button" class="cut" data-booking-stamp="cut" data-booking-stamp-id="' + esc(c.id) + '"' + (st === 'cut' ? ' aria-pressed="true"' : '') + '>Cut</button>' +
        (st === 'keep' || st === 'cut' ? '<button type="button" data-booking-stamp="clear" data-booking-stamp-id="' + esc(c.id) + '">Undo</button>' : '') + '</div></div>';
    }).join('');
    return '<section class="stampboard"><div class="sbhead">' +
      '<div><h2>Captain stamp board</h2><p>KEEP or CUT each proposed time. The checklist is the engine\'s own reasons, shown so you can weigh them. A caution never removes a line. A stamp is a recorded decision, not a send. ' +
      esc(CAPTAIN_DEFAULTS.stamp_board.charAt(0).toUpperCase() + CAPTAIN_DEFAULTS.stamp_board.slice(1)) + '.</p></div>' +
      '<span class="count">' + rec.approved.length + ' keep · ' + rec.rejected.length + ' cut · ' + list.length + ' line' + (list.length === 1 ? '' : 's') + '</span></div>' +
      Object.keys(withheldGroups).map(function (why) {
        var who = withheldGroups[why];
        var names = who.length > 6 ? who.slice(0, 6).join(', ') + ' and ' + (who.length - 6) + ' more' : who.join(', ');
        return '<div class="qempty"><strong>' + who.length + ' not offered here.</strong> ' + esc(why) + ' They stay in the work queue: ' + esc(names) + '.</div>';
      }).join('') +
      (rows || '<div class="qempty">No line in this read carries a stampable proposed time.</div>') +
      '<details class="filedetails"><summary>Show the file the terminal reads (stamp.json)</summary>' +
      '<div class="stampfile">' + esc(JSON.stringify(rec, null, 1)) + '</div></details></section>';
  }

  function renderPipelineBoard() {
    var list = pipelineBoardCases();
    var cols = pipelineBoardColumns();
    var byCol = {};
    cols.forEach(function (col) { byCol[col.id] = []; });
    var unmapped = [];
    list.forEach(function (c) {
      var col = pipelineColumnOf(c);
      if (!byCol[col.id]) unmapped.push(c);
      else byCol[col.id].push(c);
    });
    if (unmapped.length) {
      cols = cols.concat([{ id: 'unmapped', name: 'Unmapped', bucket: 'unmapped', stageIds: [] }]);
      byCol.unmapped = unmapped;
    }
    var driftN = 0;
    list.forEach(function (c) { if (stageDrift(c)) driftN += 1; });
    var html = '<section class="stampboard pipeboard" data-booking-pipeline="1">' +
      '<div class="sbhead"><div><h2>GHL sales pipeline · two way</h2>' +
      '<p>Left to right is the GHL pipeline as it reads right now, using the live stage names. Orange means the thread and the diary say the card belongs somewhere else. Move is held: it does not write GHL.</p></div>' +
      '<span class="count">' + list.length + ' cards · ' + driftN + ' out of step · Move held</span></div>' +
      '<div class="pipe" style="grid-template-columns:repeat(' + cols.length + ',220px)">';
    cols.forEach(function (col) {
      var cards = byCol[col.id] || [];
      html += '<div class="pcol"><div class="pcolhead">' + esc(col.name) + '<span class="count">' + cards.length + '</span></div>';
      cards.forEach(function (c) {
        var drift = stageDrift(c);
        html += '<div class="pcard' + (drift ? ' off' : '') + (c.id === state.selectedId ? ' sel' : '') + '">' +
          '<button type="button" class="pcard-open" data-booking-case="' + esc(c.id) + '"><b>' +
          esc(c.display_name || 'Enquiry') + ' · ' + esc(caseSuburb(c) || 'Suburb unknown') + '</b>' +
          '<span class="small muted">' + esc(jobTypeLabel(c)) + (c.not_in_this_read ? ' · not in this read' : '') + '</span></button>';
        if (drift) {
          html += '<div class="drift">Thread and diary say <b>' + esc(String(drift.want.name || '').replace(/^\s+/, '')) + '</b>' +
            '<button type="button" class="primary" disabled title="' + esc(HOLD_REASON) + '" data-booking-move-held="1">Move (held)</button></div>';
        }
        html += '</div>';
      });
      html += '</div>';
    });
    html += '</div></section>';
    return html;
  }

  function renderHTML() {
    var res = resource();
    var data = state.data;
    var mailbox = calendarMailbox(data);
    var notice = '';
    if (state.error) {
      notice = '<div class="notice error" role="alert">' + esc(state.error) + '</div>';
    } else if (state.loading && data && state.stale) {
      notice = '<div class="notice" role="status">Refreshing this week. The last complete read stays on screen so a slow or rate-limited day is not painted as empty.</div>';
    } else if (state.loading) {
      notice = '<div class="notice" role="status">Reading the provider calendar and GHL enquiries. This can take up to a minute.</div>';
    }
    if (state.loading && !data) {
      return '<div class="page"><div class="pagehead">' +
        '<div><h1>Build the week</h1><p>' + esc(state.weekStart) + ' week · ' + esc(res.name) + ' · ' + esc(res.lane) + '</p></div></div>' +
        notice +
        '<div class="unknown"><h3>Reading this week</h3><p>Live booking read is in flight. Tiles stay blank until that read returns, so an empty week is not shown as a finished one.</p></div></div>';
    }
    var gaps = coverageGaps(data);
    var gapStrip = gaps.length
      ? '<div class="notice' + (coverageLooksRateLimited(data) ? ' warn' : '') + '" role="status"><strong>Coverage</strong>' +
        (coverageLooksRateLimited(data) ? ' <span class="pill warn">GHL rate limited</span>' : '') +
        '<ul>' + gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul></div>'
      : '';
    var route = resolveSender(res);
    var scopers = V1_SCOPERS.map(function (id) {
      return '<button type="button" data-booking-resource-btn="' + id + '" aria-pressed="' + (id === state.resourceId) + '">' + esc(RESOURCES[id].name) + '</button>';
    }).join('');
    var hidden = Object.keys(RESOURCES).filter(function (id) { return V1_SCOPERS.indexOf(id) === -1; })
      .map(function (id) { return RESOURCES[id].name; });
    return '<div class="page"><div class="pagehead">' +
      '<div><h1>Build the week</h1><p>' + esc(state.weekStart) + ' week · ' + esc(res.name) + ' · ' + esc(res.lane) + ' · texts go from ' + esc(route.resolved ? route.label : 'an unresolved line') + '</p></div>' +
      '<div class="row"><span class="muted small">Scoper</span>' +
      '<div class="scopers" role="group" aria-label="Scoper">' + scopers + '</div>' +
      '<span class="lane ' + esc(res.lane) + '">' + esc(res.lane === 'patio' ? 'Patio' : 'Fencing') + ' · ' + esc(route.resolved ? route.number.slice(-3) : 'line unresolved') + '</span>' +
      (hidden.length ? '<span class="pill q" title="Captain default for v1. Flip V1_SCOPERS to add them.">v1: ' + esc(CAPTAIN_DEFAULTS.scopers) + ' · ' + esc(hidden.join(', ')) + ' later</span>' : '') +
      '</div></div>' + notice + gapStrip +
      '<div class="notice">Source ' + esc(mailbox) + ' · week of ' + esc(state.weekStart) + ' · Australia/Perth · rules: ' + esc(res.desk_rules.hours) + '</div>' +
      renderWeekTruth() +
      '<div class="scopesdone">' + renderTiles() + '</div>' +
      '<div class="workspace">' +
      '<section class="panel queue"><div class="panelhead"><h2>Work queue</h2><span class="count">' + visibleCases().length + ' people</span></div>' +
      '<div class="queuefilters"><div class="searchwrap"><input data-booking-search placeholder="Search" aria-label="Search enquiries" value="' + esc(state.search) + '"></div></div>' +
      '<div class="queuelist">' + renderQueue() + '</div>' +
      '<div class="queuefoot">Only people who need a visit, a reply or a quote. Never the whole CRM.<br>Quoted, won, lost and archived stages are folded. Stages copied from ' + esc(res.pipeline_stages_source || 'the live GHL profile') + '.</div></section>' +
      '<section class="panel calendar"><div class="calhead calendarhead"><div class="row"><h2>' + esc(state.weekStart) + ' week</h2><div class="grow"></div><div class="weeknav" role="group" aria-label="Week"><button type="button" data-booking-week="-7">Previous week</button><button type="button" data-booking-week="7">Next week</button></div></div>' +
      '<p class="date">' + esc(res.name) + ' · ' + esc(res.desk_rules.hours) + '</p></div>' + renderCalendar() + '</section>' +
      '<aside class="panel detail" aria-label="Selected enquiry and GHL conversation">' + renderDetail() + '</aside></div>' +
      renderStampBoard() +
      renderPipelineBoard() +
      '</div>';
  }

  function render() {
    var el = root();
    if (!el) return;
    try {
      el.innerHTML = renderHTML();
    } catch (err) {
      el.innerHTML = '<div class="notice error" role="alert">Booking door failed to render: ' + esc(err && err.message ? err.message : err) + '</div>';
    }
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
    state.stamp = { approved: [], rejected: [], decisions: {}, stage_moves: {} };
    state.resourceId = id;
    state.selectedId = null;
    var cached = state.cache[cacheKey(id, state.weekStart)];
    if (cached) {
      state.data = cached;
      state.stale = true;
      state.readKind = 'cache';
      applyServerStamp(cached);
      applyServerDrafts(cached);
    } else {
      state.data = null;
      state.stale = false;
    }
    clearConversation();
    return load(id, state.weekStart);
  }

  function switchWeek(deltaDays) {
    var next = mondayIso(addDays(state.weekStart, Number(deltaDays) || 0));
    return load(state.resourceId, next);
  }

  async function bookingRead(params) {
    var preview = global.SALES_BOOKING_PREVIEW_URL;
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (controller && typeof global.setTimeout === 'function') {
      timer = global.setTimeout(function () {
        controller.abort();
      }, BOOKING_READ_TIMEOUT_MS);
    }
    try {
      if (preview) {
        var url = preview + '?resource=' + encodeURIComponent(params.resource) + '&week_start=' + encodeURIComponent(params.week_start);
        var resp = await global.fetch(url, { cache: 'no-store', signal: controller && controller.signal });
        if (!resp.ok) {
          var previewErr = new Error('Preview calendar read failed (' + resp.status + ')');
          previewErr.status = resp.status;
          throw previewErr;
        }
        return resp.json();
      }
      if (typeof global.opsFetch !== 'function') throw new Error('Authenticated Ops read is not available.');
      return await global.opsFetch('sales_booking_read', params, controller ? { signal: controller.signal } : undefined);
    } catch (e) {
      if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')))) {
        var timeout = new Error('Booking read timed out after ' + Math.round(BOOKING_READ_TIMEOUT_MS / 1000) + ' seconds.');
        timeout.kind = 'timeout';
        throw timeout;
      }
      throw e;
    } finally {
      if (timer && typeof global.clearTimeout === 'function') global.clearTimeout(timer);
    }
  }

  async function load(resourceId, weekStart) {
    if (resourceId) state.resourceId = resourceId;
    if (weekStart) state.weekStart = mondayIso(weekStart);
    var request = ++state.request;
    var key = cacheKey(state.resourceId, state.weekStart);
    var cached = state.cache[key];
    state.loading = true;
    state.error = null;
    if (cached && !state.data) {
      state.data = cached;
      state.stale = true;
      state.readKind = 'cache';
      applyServerStamp(cached);
      applyServerDrafts(cached);
    }
    render();
    try {
      var t0 = Date.now();
      var data = await bookingRead({ resource: state.resourceId, week_start: state.weekStart, scoper_user_id: resource().scoper_user_id });
      var ms = Date.now() - t0;
      if (request !== state.request) return;
      if (!data || data.ok === false) {
        var incomplete = new Error((data && data.error) || 'Booking read was incomplete.');
        incomplete.kind = 'incomplete';
        throw incomplete;
      }
      if (data.fixture) {
        var fixture = new Error('Fixture fallback is refused. Provider read required.');
        fixture.kind = 'fixture';
        throw fixture;
      }
      if (data.pack && data.pack.present === true && !data.pack.week_start) {
        var priorPack = state.data && state.data.pack;
        data.pack.week_start = (priorPack && priorPack.present === true && priorPack.week_start) || data.week_start;
      }
      state.data = data;
      state.cache[key] = data;
      state.stale = false;
      state.lastReadMs = ms;
      state.readKind = 'fresh';
      applyServerStamp(data);
      applyServerDrafts(data);
    } catch (e) {
      if (request !== state.request) return;
      var info = classifyReadError(e);
      state.error = info.message;
      if (info.keepLastGood && state.data) {
        state.stale = true;
        state.readKind = 'stale';
      } else {
        state.data = null;
        state.stale = false;
        state.readKind = null;
      }
    } finally {
      if (request === state.request) {
        state.loading = false;
        render();
      }
    }
  }

  function applyServerStamp(data) {
    if (!data) return;
    var packWeek = packWeekStart(data);
    var stampWeek = (data.stamp && data.stamp.week_start) || data.week_start;
    if (stampWeek && mondayIso(stampWeek) !== packWeek) return;
    var s = data.stamp;
    if (s && s.present === true) {
      state.stamp.approved = Array.isArray(s.approved) ? s.approved.slice() : [];
      state.stamp.rejected = Array.isArray(s.rejected) ? s.rejected.slice() : [];
      state.stamp.decisions = s.decisions && typeof s.decisions === 'object' ? Object.assign({}, s.decisions) : {};
      state.stamp.stage_moves = Array.isArray(s.stage_moves) ? s.stage_moves.slice() : [];
    }
    (data.cases || []).forEach(function (c) {
      if (!c) return;
      var id = c.opportunity_id || c.id;
      if (!id) return;
      if (c.stamp_state === 'approved' && state.stamp.approved.indexOf(id) === -1) state.stamp.approved.push(id);
      if (c.stamp_state === 'rejected' && state.stamp.rejected.indexOf(id) === -1) state.stamp.rejected.push(id);
    });
  }

  function applyServerDrafts(data) {
    var drafts = data && data.drafts;
    if (!drafts || typeof drafts !== 'object') return;
    Object.keys(drafts).forEach(function (id) {
      var raw = drafts[id];
      var text = typeof raw === 'string' ? raw : (raw && raw.text) || '';
      if (!text) return;
      var d = draftFor(id);
      if (d.humanEdited) return;
      d.text = text;
      d.case_id = id;
    });
    (data.cases || []).forEach(function (c) {
      if (c && c.proposal && c.proposal.draft) bindDraft(c);
    });
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
      var weekNav = e.target.closest && e.target.closest('[data-booking-week]');
      if (weekNav) {
        e.preventDefault();
        switchWeek(Number(weekNav.getAttribute('data-booking-week')));
        return;
      }
      var stampSend = e.target.closest && e.target.closest('[data-booking-stamp-send]');
      if (stampSend) {
        e.preventDefault();
        if (stampSend.disabled || stampSend.hasAttribute('disabled')) return;
        writeStamp(stampSend.getAttribute('data-booking-stamp-id') || state.selectedId, 'keep');
        return;
      }
      var moveHeld = e.target.closest && e.target.closest('[data-booking-move-held]');
      if (moveHeld) {
        e.preventDefault();
        return;
      }
      var stampBtn = e.target.closest && e.target.closest('[data-booking-stamp]');
      if (stampBtn) {
        e.preventDefault();
        writeStamp(stampBtn.getAttribute('data-booking-stamp-id'), stampBtn.getAttribute('data-booking-stamp'));
        return;
      }
      var fold = e.target.closest && e.target.closest('[data-booking-fold]');
      if (fold) {
        e.preventDefault();
        state.showArchived = !state.showArchived;
        render();
        return;
      }
      var scoper = e.target.closest && e.target.closest('[data-booking-resource-btn]');
      if (scoper) {
        e.preventDefault();
        switchResource(scoper.getAttribute('data-booking-resource-btn'));
        return;
      }
      // Approve, Confirm and Send are rendered disabled. If a stale or scripted click
      // still reaches here, attemptApprove refuses on SEND_HOLD and records the attempt.
      var approve = e.target.closest && e.target.closest('[data-booking-approve], [data-booking-confirm]');
      if (approve) {
        e.preventDefault();
        attemptApprove();
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
    MOVE_HOLD: MOVE_HOLD,
    RESOURCES: RESOURCES,
    state: state,
    esc: esc,
    mondayIso: mondayIso,
    addDays: addDays,
    switchWeek: switchWeek,
    caseSuburb: caseSuburb,
    proposalSlotLabel: proposalSlotLabel,
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
    reviseProposedSlot: reviseProposedSlot,
    archiveCase: archiveCase,
    restoreCase: restoreCase,
    suggestedDraft: suggestedDraft,
    hasBlockingCommitment: hasBlockingCommitment,
    show: showSales,
    coverageGaps: coverageGaps,
    calendarUnread: calendarUnread,
    bookingRead: bookingRead,
    BOOKING_READ_TIMEOUT_MS: BOOKING_READ_TIMEOUT_MS,
    PIPELINE_STAGE_SOURCE: PIPELINE_STAGE_SOURCE,
    stageOf: stageOf,
    stageBucket: stageBucket,
    cases: cases,
    V1_SCOPERS: V1_SCOPERS,
    CAPTAIN_DEFAULTS: CAPTAIN_DEFAULTS,
    HOLD_REASON: HOLD_REASON,
    arrivalWindow: arrivalWindow,
    clockLabel: clockLabel,
    longDate: longDate,
    diary: diary,
    diaryEventIsScopeBooking: diaryEventIsScopeBooking,
    diaryEventMatchesCase: diaryEventMatchesCase,
    diaryOccupiesDay: diaryOccupiesDay,
    bookedCount: bookedCount,
    bookedTileReason: bookedTileReason,
    jobTypeLabel: jobTypeLabel,
    normaliseProposal: normaliseProposal,
    caseLayer: caseLayer,
    diaryLayerFor: diaryLayerFor,
    packLanes: packLanes,
    urgency: urgency,
    isAssessed: isAssessed,
    daysWaiting: daysWaiting,
    queueGroups: queueGroups,
    foldedCases: foldedCases,
    followThrough: followThrough,
    stampCase: stampCase,
    stampRecord: stampRecord,
    stampWriteBody: stampWriteBody,
    writeStamp: writeStamp,
    stampStateOf: stampStateOf,
    stampChecklist: stampChecklist,
    checklistTopic: checklistTopic,
    blockingDiaryEvent: blockingDiaryEvent,
    stampBlockReason: stampBlockReason,
    evidenceChips: evidenceChips,
    stampableOfferList: stampableOfferList,
    isPackOfferCase: isPackOfferCase,
    packOpportunityId: packOpportunityId,
    classifyReadError: classifyReadError,
    cacheKey: cacheKey,
    pipelineBoardColumns: pipelineBoardColumns,
    pipelineColumnOf: pipelineColumnOf,
    impliedStage: impliedStage,
    stageDrift: stageDrift,
    pipelineBoardCases: pipelineBoardCases,
    renderPipelineBoard: renderPipelineBoard,
    postStamp: postStamp
  };
  global.SalesBooking = api;
  global.SalesWorkspace = { show: showSales, subtab: function () { return state.subtab; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
