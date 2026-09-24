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

  // Every configured scoper is selectable; the signed-in UUID owns the default.
  var V1_SCOPERS = ['nithin', 'marnin', 'khairo'];
  var CAPTAIN_DEFAULTS = {
    scopers: 'Nithin plus Marnin',
    scopes_done_window: 'this week plus last',
    stratco_sender_line: '776',
    stamp_board: 'agent-driven, human-typed later'
  };
  // Legacy direct-send/diary actions stay held. New content-bound approvals use
  // separate channels and never invoke a provider from the browser.
  var HOLD_REASON = 'Held. This surface does not send, approve, confirm or write a diary.';

  var state = {
    subtab: 'booking',
    resourceId: null,
    weekStart: currentPerthWeek(),
    opened: false,
    visitForms: {},
    visitPending: {},
    visitUncertain: {},
    visitRecorded: {},
    visitErrors: {},
    shownVisits: {},
    approvalPending: {},
    approvalErrors: {},
    shownApprovals: {},
    approvalIds: {},
    pressPending: {},
    pressResults: {},
    ownerVisits: {},
    ownerPreviews: {},
    ownerPickOpen: {},
    ownerOccupancy: [],
    threads: {},
    dayIndex: null,
    showConversation: false,
    lastFreshAt: 0,
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

  function sameContent(left, right) {
    function ordered(value) {
      if (Array.isArray(value)) return value.map(ordered);
      if (value && typeof value === 'object') return Object.keys(value).sort().reduce(function (out, key) { out[key] = ordered(value[key]); return out; }, {});
      return value;
    }
    return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
  }

  // Mirrors backend canonicalBookingJson + bookingHash (ops-api
  // sales_booking_confirmation.ts): key-sorted JSON, string bytes untouched,
  // SHA-256 hex. An edited text is bound by the same hash the server computes,
  // so an approval covers the edited words and nothing else.
  function canonicalJson(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + canonicalJson(value[key]);
      }).join(',') + '}';
    }
    var s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }

  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var low = str.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) { code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00); i += 1; }
        else code = 0xfffd;
      } else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return out;
  }

  function sha256Hex(str) {
    var bytes = utf8Bytes(String(str));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var t = 0; t < 16; t++) w[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) | (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
      for (t = 16; t < 64; t++) {
        var x = w[t - 15], y = w[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var t1 = (k + S1 + ((e & f) ^ (~e & g)) + SHA_K[t] + w[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
    }
    return h.map(function (n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }).join('');
  }

  function bookingContentHash(snapshot) {
    var binding = {};
    Object.keys(snapshot || {}).forEach(function (key) { if (key !== 'content_hash') binding[key] = snapshot[key]; });
    return sha256Hex(canonicalJson(binding));
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

  function currentPerthWeek(now) {
    return mondayIso(new Date((now == null ? Date.now() : Number(now)) + 8 * 3600000).toISOString().slice(0, 10));
  }

  function signedInResource(user) {
    if (!user) return null;
    return Object.keys(RESOURCES).find(function (id) {
      return user.id === RESOURCES[id].scoper_user_id || user.scoper_user_id === RESOURCES[id].scoper_user_id;
    }) || null;
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
      reason: 'Proposal only. This lead was not in the GHL list for this read.',
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
    return mergePackOffers(list, data).map(function (c) {
      var model = decisionModel(c);
      if (model) c.proposal = model.proposal ? Object.assign({}, model.proposal, { draft: model.message && model.message.text || '' }) : null;
      return c;
    });
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
    var window = c.booking_read_model && p.window_start_iso && p.window_end_iso
      ? clockLabel(hourFromIso(p.window_start_iso)) + ' to ' + clockLabel(hourFromIso(p.window_end_iso))
      : arrivalWindow(p.start_iso, p.end_iso);
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

  function payloadMatchesRequest(data, resourceId, weekStart) {
    if (!data) return false;
    var key = cacheKey(resourceId, weekStart);
    if (state.cache[key] === data) return true;
    var rid = data.resource && data.resource.id;
    if (!rid || !data.week_start) return false;
    return cacheKey(rid, data.week_start) === key;
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

  function calendarReadState(data) {
    var flow = data && data.booking_flow;
    var read = flow && flow.calendar_read;
    if (flow && (!data.resource || data.resource.id !== state.resourceId || data.week_start !== state.weekStart)) return {state:'could_not_read',reason:'Calendar read belongs to another scoper or week.'};
    if (read) return { state: read.state === 'read' ? 'read' : read.state === 'not_configured' ? 'not_configured' : 'could_not_read', reason: read.reason || '' };
    var diaryRead = data && data.diary_read;
    var cal = data && data.resource && data.resource.calendar;
    if ((diaryRead && diaryRead.read_ok === false) || (cal && cal.ok === false) || (data && data.coverage && data.coverage.diary_read_ok === false)) {
      return { state: cal && cal.configured === false ? 'not_configured' : 'could_not_read', reason: (diaryRead && diaryRead.reason) || (cal && cal.error) || 'Calendar availability could not be verified.' };
    }
    return { state: diaryRead && diaryRead.read_ok === true || cal && cal.ok === true ? 'read' : 'could_not_read', reason: 'Calendar read not confirmed.' };
  }

  function calendarUnread(data) {
    return calendarReadState(data).state !== 'read';
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
    commitmentSlots().forEach(function (slot) {
      out.push({ id: slot.id, contact_id: slot.contact_id, start_iso: slot.start_iso, end_iso: slot.end_iso,
        reservation_state: slot.state, display_name: 'Taken · ' + (slot.state === 'agreed' ? 'customer agreed' : 'previously offered'),
        title: 'Taken', job: '', layer: 'offer', kind: 'reservation', blocks_capacity: true });
    });
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

  function sameGhlId(a, b) {
    return a != null && b != null && String(a) !== '' && String(a) === String(b);
  }

  function diaryEventMatchesCase(ev, c) {
    if (!ev || !c) return false;
    if (sameGhlId(ev.contact_id, c.contact_id)) return true;
    if (sameGhlId(ev.opportunity_id, c.opportunity_id) || sameGhlId(ev.opportunity_id, c.id)) return true;
    return sameGhlId(ev.event_id || ev.id, c.event_id);
  }

  // CONFIRMED only when the event is a booked scope: it matches a queue case
  // by exact GHL contact_id, opportunity_id or event_id, or the title starts
  // with "Scope:". Name and suburb never match. Company diary (Payday,
  // Outback Agreements, SecureWorks) is not a booked visit.
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
    if (quoteOutstanding(c) || isCompleted(c)) return firstStageInBucket('quote');
    var have = stageOf(c);
    if (have && have.bucket === 'fold') return have;
    if (caseHasConfirmedDiary(c)) {
      if (have && have.bucket === 'booked') return have;
      return firstStageInBucket('booked', res.lane === 'patio' ? 'Scope Booked' : 'Lead Closed (scope booked)');
    }
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
  // The server's word that this lead already has a live scope visit in a
  // scoper's GHL calendar, possibly someone else's (backend lead-owner rule):
  // case.scope_appointment = { start_iso, end_iso?, owner_name?,
  // owner_resource_id?, status? }. Read only when the server sends it; the
  // screen never infers a booking elsewhere from names, stages or threads.
  function scopeAppointment(c) {
    var a = c && c.scope_appointment;
    if (!a || typeof a !== 'object' || !a.start_iso || isNaN(Date.parse(a.start_iso))) return null;
    if (/cancel|no.?show|invalid|deleted/i.test(String(a.status || ''))) return null;
    return a;
  }

  function bookedElsewhere(c) {
    var a = scopeAppointment(c);
    return !!(a && a.owner_resource_id && a.owner_resource_id !== state.resourceId) ? a : null;
  }

  function scopeAppointmentWords(c) {
    var a = scopeAppointment(c);
    if (!a) return '';
    var who = bookedElsewhere(c) ? a.owner_name || 'another scoper' : '';
    return 'Booked' + (who ? ' with ' + who : '') + ', ' + shortDate(a.start_iso) + ' ' + clockLabel(hourFromIso(a.start_iso), true);
  }

  function bookedElsewhereBlock(c) {
    return bookedElsewhere(c) ? scopeAppointmentWords(c) + '. No new time can be offered or booked from here.' : '';
  }

  function isBooked(c) {
    if (!c || isNonScopeDiaryMirror(c)) return false;
    if (scopeAppointment(c)) return true;
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
    if (state.data && state.data.booking_flow) return calendarUnread(state.data) ? 'calendar not read' : bookedCount() ? 'diary events matched to a case' : 'No confirmed visits in the GHL read';
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
  // Legacy local stamp helpers remain for read compatibility. The combined
  // persistence boundary below is retired and refuses every call.
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

  async function postStamp() {
    return { ok: false, reason: 'Legacy combined stamp retired. Calendar and exact text require separate approvals.' };
  }

  async function writeStamp() {
    return postStamp();
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
    if (ev.kind === 'reservation') return 'offer';
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

  // booking-confirm.v1 adapter. See docs/booking-confirm-contract.md and the
  // offline fixture. No legacy stamp is translated into either approval channel.
  function decisionModel(c) {
    var raw = c && c.booking_read_model;
    if (!raw || raw.schema !== 'scope-booking-lead.v1') return null;
    var p = raw.proposal, cal = raw.calendar_write || {}, msg = raw.message || {};
    var preview = cal.preview || {}, routing = msg.routing || {};
    var checks = raw.validation && raw.validation.checks;
    var reasons = raw.validation && raw.validation.reasons || [];
    // The producer owns the decision and arrival window. The UI does not pick
    // a slot, manufacture passed checks, or translate old stamps into approval.
    return {
      version: raw.schema, proposal_id: raw.id, revision: raw.pack_revision,
      profile: raw.profile, contact_id: raw.contact_id,
      confident: !!(p && raw.validation && raw.validation.ok === true),
      reason: reasons.join('; ') || 'No validated AI proposal in this read.',
      expires_at: raw.expires_at,
      proposal: p && p.window ? {
        start_iso: preview.start || p.window.start, end_iso: preview.end,
        window_start_iso: p.window.start, window_end_iso: p.window.end
      } : null,
      evidence: (raw.evidence_quotes || []).map(function (e) { return { message_id: e.message_id, contact_id: raw.contact_id, quote: e.quote }; }),
      validation: Array.isArray(checks) ? checks : reasons.map(function (reason) { return {label:'Validation',passed:false,reason:reason}; }),
      calendar: { provider: preview.provider, calendar_id: preview.calendar_id, assigned_user_id: preview.assigned_user_id,
        title: preview.title, address: preview.site_address, content_hash: preview.content_hash,
        targets: preview.targets || cal.targets || null },
      message: { template_locked: typeof msg.template_text === 'string', text: msg.template_text,
        sender: routing.from_number, recipient: routing.to_number, content_hash: routing.message_sha256 },
      commitment_id: p && p.commitment_id
    };
  }

  function commitmentSlots() {
    var flow = state.data && state.data.booking_flow;
    return ((flow && flow.commitments) || []).filter(function (s) {
      return s && s.contact_id && (s.state === 'offered' || s.state === 'agreed') && s.start_iso && s.end_iso;
    });
  }

  // The owner's edit, when there is one, is the text. Typing the proposed words
  // back exactly returns to the producer's own template and its own hash.
  function editedText(c) {
    var d = c && state.drafts[draftKey(c)];
    if (!d || !d.humanEdited || typeof d.text !== 'string') return null;
    var m = decisionModel(c);
    if (m && m.message && d.text === m.message.text) return null;
    return d.text;
  }

  function selectedMessage(c) {
    var m = decisionModel(c);
    if (!m) return null;
    var msg = Object.assign({}, m.message, { variant: 'template' });
    var edited = editedText(c);
    if (edited != null) {
      msg.text = edited;
      msg.variant = 'edited';
      msg.content_hash = null;
    }
    return msg;
  }

  function approvalSnapshot(c, kind) {
    var m = decisionModel(c);
    if (!m) return null;
    var target = kind === 'calendar' ? m.calendar : kind === 'message' ? selectedMessage(c) : null;
    if (!target) return null;
    var snap = {
      schema: 'scope-booking-approval.v1', step: kind, case_id: c.id, contact_id: c.contact_id,
      resource: state.resourceId, scoper_user_id: resource().scoper_user_id,
      week_start: state.weekStart, id: m.proposal_id, profile: m.profile, pack_revision: m.revision,
      content_hash: target.content_hash,
      content: kind === 'calendar' ? {
        provider: target.provider, calendar_id: target.calendar_id, assigned_user_id: target.assigned_user_id,
        start_iso: m.proposal && m.proposal.start_iso, end_iso: m.proposal && m.proposal.end_iso,
        window_start_iso: m.proposal && m.proposal.window_start_iso,
        window_end_iso: m.proposal && m.proposal.window_end_iso,
        title: target.title, address: target.address
      } : { text: target.text, sender: target.sender, recipient: target.recipient, variant: target.variant }
    };
    if (kind === 'message' && target.variant === 'edited') snap.content_hash = bookingContentHash(snap);
    return snap;
  }

  function approvalKey(c, kind) {
    return state.resourceId + '|' + state.weekStart + '|' + c.id + '|' + kind;
  }

  function approvalState(c, kind) {
    var raw = c && c.booking_read_model, channel = raw && raw[kind === 'calendar' ? 'calendar_write' : 'message'];
    var a = channel && channel.approval;
    var snapshot = approvalSnapshot(c, kind);
    if (!channel || channel.state === 'awaiting_approval') return { state: 'not_approved', reason: channel && channel.reason || '' };
    if (!a) return { state: 'not_approved', reason: 'Approval binding unavailable.' };
    if (!snapshot || !sameContent(a.ui_snapshot, snapshot)) return { state: 'not_approved', reason: 'Proposal changed. Review it again.' };
    return { state: ({ succeeded:'done', approved:'approved', refused:'refused', held:'held', pending:'pending', failed:'failed', unknown:'unknown' })[channel.state] || 'not_approved', reason: channel.reason || channel.receipt && (channel.receipt.error || channel.receipt.reason) || '' };
  }

  // What a proposed visit runs into, named. Occupied calendar time first, then a
  // hold for another GHL contact. Null when the time is clear.
  function clashFor(c) {
    var m = decisionModel(c);
    var p = m && m.proposal;
    if (!p || !p.start_iso || !p.end_iso) return null;
    return clashForSpan(c, p.start_iso, p.end_iso, m.commitment_id);
  }

  // The same check for any span: the engine's proposal or a time the owner picked.
  function clashForSpan(c, startIso, endIso, commitmentId, skipOwnHold) {
    var a = Date.parse(startIso), b = Date.parse(endIso);
    if (!(b > a)) return null;
    var ev = diary().filter(function (row) {
      if (row.kind === 'reservation' || !diaryOccupiesDay(row)) return false;
      if (c && ((row.contact_id && row.contact_id === c.contact_id) || diaryEventMatchesCase(row, c))) return false;
      return Date.parse(row.start_iso) < b && Date.parse(row.end_iso) > a;
    })[0];
    if (ev) return { kind: 'calendar', label: eventTitle(ev), at: clockLabel(hourFromIso(ev.start_iso)), source: sourceLabel(ev) };
    var hold = commitmentSlots().filter(function (s) {
      if (c && s.contact_id === c.contact_id && (skipOwnHold || (s.id === commitmentId && s.start_iso === startIso && s.end_iso === endIso))) return false;
      return Date.parse(s.start_iso) < b && Date.parse(s.end_iso) > a;
    })[0];
    if (hold) {
      var who = cases().filter(function (row) { return row.contact_id === hold.contact_id; })[0];
      return { kind: 'hold', label: (who && who.display_name ? who.display_name + ', ' : '') + (hold.state === 'agreed' ? 'customer agreed this time' : 'time already offered'), at: clockLabel(hourFromIso(hold.start_iso)) };
    }
    return null;
  }

  function clashSentence(clash) {
    if (!clash) return '';
    if (clash.kind === 'hold') return 'Slot taken by a prior offer: ' + clash.label + ' at ' + clash.at + '.';
    return 'Clashes with ' + clash.label + ' at ' + clash.at + (clash.source ? ' (' + clash.source + ')' : '') + '.';
  }

  // Shared fail-closed gates. Calendar unread, expiry, hours, the protected
  // band and a clash apply to Book it only; Send this text stays pressable
  // with the clash named beside the text.
  // steady: the lasting answer only (no loading, stale or in-flight notes), so
  // choosing between the engine and the owner's own path cannot flip mid-press.
  function approvalBlock(c, kind, refusing, steady) {
    var flow = state.data && state.data.booking_flow;
    var m = decisionModel(c);
    var verb = kind === 'calendar' ? 'booked' : 'sent';
    if (!refusing && bookedElsewhere(c)) return bookedElsewhereBlock(c);
    if (!steady && state.loading) return 'Reading the latest list. Wait a moment.';
    if (!steady && (state.stale || state.error)) return 'This list may be out of date. Press Refresh first.';
    if (!flow || flow.version !== 'booking-confirm.v1' || flow.approval_write !== 'separate-v1') return 'Approvals are not connected for this list yet, so nothing can be ' + verb + ' from here.';
    if (!m || !m.proposal_id || m.revision == null || !c.contact_id || m.contact_id !== c.contact_id) return 'No checked proposal for this lead yet, so nothing can be ' + verb + ' from here.';
    if (!state.data.resource || state.data.resource.id !== state.resourceId || state.data.week_start !== state.weekStart) return 'This list belongs to another person or week. Press Refresh.';
    if (packOpportunityId(m.proposal_id) !== packOpportunityId(c.opportunity_id || c.id) || cases().filter(function (row) { return row.contact_id === c.contact_id; }).length !== 1) return 'This GHL contact appears more than once. Sort it out in GHL first.';
    if (m.profile !== 'fencing-stratco-marnin' || state.resourceId !== 'marnin') return 'Only Marnin\'s Stratco leads can be approved here for now.';
    var snap = approvalSnapshot(c, kind);
    if (!snap || !snap.content_hash) return 'The exact ' + (kind === 'calendar' ? 'booking' : 'text') + ' could not be pinned down. Press Refresh.';
    if (!steady && state.approvalPending[approvalKey(c, kind)]) return 'Recording your approval…';
    if (refusing) return '';
    var status = approvalState(c, kind);
    if (steady && status.state !== 'not_approved') return '';
    if (status.state === 'done') return kind === 'calendar' ? 'Already booked.' : 'Already sent.';
    if (status.state === 'pending') return 'Still in progress. Press Refresh to see the result.';
    if (status.state === 'unknown') return 'The last result is unknown. Check GHL before trying again.';
    if (status.state === 'approved' || status.state === 'held') return 'Already approved for this exact ' + (kind === 'calendar' ? 'booking' : 'text') + '.';
    if (status.state === 'refused') return 'You said no to this. Ask for a new proposal.';
    if (kind === 'calendar') {
      if (calendarUnread(state.data)) return calendarReadState(state.data).state === 'not_configured' ? 'The calendar is not set up, so no time can be confirmed.' : 'The calendar could not be read, so no time can be confirmed.';
      if (!flow.calendar_read || flow.calendar_read.provider !== 'ghl') return 'The GHL calendar has not been read, so no time can be confirmed.';
      if (!Array.isArray(flow.commitments) || flow.commitments.some(function (slot) { return !slot.contact_id || !slot.id || ['offered', 'agreed'].indexOf(slot.state) < 0 || !(Date.parse(slot.end_iso) > Date.parse(slot.start_iso)); })) return 'Earlier offers could not all be read, so no time can be confirmed.';
      if (!m.expires_at || !(Date.parse(m.expires_at) > Date.now())) return 'This proposal has expired. Press Refresh for a new one.';
    }
    if (!m.proposal || m.confident !== true) return 'Needs a person: ' + (m.reason || 'no confident proposal.');
    if (!Array.isArray(m.validation) || !m.validation.length || m.validation.some(function (v) { return v.passed !== true; })) return 'A check did not pass. See the checks below.';
    if (!Array.isArray(m.evidence) || !m.evidence.length || m.evidence.some(function (e) { return !e.quote || !e.message_id || e.contact_id !== c.contact_id; })) return 'The customer\'s own words are missing, or belong to another contact.';
    if (kind === 'calendar') {
      var p = m.proposal;
      if (!/\+08:00$/.test(p.start_iso || '') || !/\+08:00$/.test(p.end_iso || '') || !(Date.parse(p.start_iso) > Date.now()) || !(Date.parse(p.end_iso) > Date.parse(p.start_iso))) return 'The proposed visit must be a future Perth time.';
      if (!p.window_start_iso || !p.window_end_iso || !(Date.parse(p.window_end_iso) > Date.parse(p.window_start_iso))) return 'The arrival window is missing.';
      var index = dayIndexFromIso(p.start_iso, state.weekStart);
      var startHour = hourFromIso(p.start_iso), endHour = hourFromIso(p.end_iso);
      var rules = resource().desk_rules;
      if (index == null || deskDays(resource()).indexOf(index) < 0 || startHour < (index === 0 ? rules.monday_from : 8) || startHour > rules.last_start || endHour > 16.5 || p.start_iso.slice(0, 10) !== p.end_iso.slice(0, 10)) return 'The proposed visit is outside ' + resource().name + '\'s days or hours.';
      if (rules.protected_band && rules.protected_band.day === index && startHour < rules.protected_band.to && endHour > rules.protected_band.from) return 'The proposed visit overlaps the protected Canning Vale band.';
      var clash = clashFor(c);
      if (clash) return clashSentence(clash);
      if (!m.calendar || m.calendar.provider !== 'ghl' || !m.calendar.calendar_id || !m.calendar.assigned_user_id || !m.calendar.title || !m.calendar.address) return 'The GHL calendar or the site address is missing.';
    }
    if (kind === 'message') {
      var msg = selectedMessage(c);
      if (m.message.template_locked !== true) return 'There is no proposed text for this lead yet.';
      if (!msg.text || !String(msg.text).trim()) return 'The text is empty.';
      if (!msg.sender || !msg.recipient) return 'The sending line or the customer\'s phone is missing.';
    }
    return '';
  }

  async function recordApproval(id, kind, decision, reason) {
    var c = cases().find(function (row) { return row.id === id; });
    if (!c || ['calendar', 'message'].indexOf(kind) < 0 || ['approved', 'refused'].indexOf(decision) < 0) return { ok: false, reason: 'Invalid decision' };
    var key = approvalKey(c, kind);
    var blocked = approvalBlock(c, kind, decision === 'refused');
    var snap = approvalSnapshot(c, kind);
    if (!blocked && decision === 'refused' && !String(reason || '').trim()) blocked = 'Say why, in a few words.';
    if (!blocked && !sameContent(state.shownApprovals[key], snap)) blocked = 'This changed after it was shown. Check it again before pressing.';
    if (blocked) {
      state.approvalErrors[key] = blocked;
      render();
      return { ok: false, reason: blocked };
    }
    var body = { snapshot: snap, decision: decision, reason: decision === 'refused' ? String(reason).trim() : null };
    state.approvalPending[key] = true;
    delete state.approvalErrors[key];
    render();
    try {
      if (typeof global.opsPost !== 'function') throw new Error('Approvals are not reachable from this page. Nothing was recorded.');
      var result = await global.opsPost('sales_booking_approval_write', body);
      if (!result || result.ok !== true || !result.approval || !sameContent(result.approval.snapshot, snap) || result.approval.state !== decision || (decision === 'refused' && result.approval.reason !== body.reason)) throw new Error('The server did not confirm your approval. Nothing was sent. Press Refresh before trying again.');
      if (!sameContent(approvalSnapshot(c, kind), snap)) {
        state.approvalErrors[key] = 'This changed after it was shown. Check it again before pressing.';
        return { ok: false, reason: state.approvalErrors[key] };
      }
      var channel = c.booking_read_model[kind === 'calendar' ? 'calendar_write' : 'message'];
      channel.state = decision;
      channel.reason = result.approval.reason || null;
      channel.approval = { ui_snapshot: result.approval.snapshot };
      if (kind === 'message' && decision === 'approved') { channel.chosen = snap.content.variant; channel.approved_text = snap.content.text; }
      var approvalId = result.approval.id || result.approval.binding_hash || null;
      if (decision === 'approved' && approvalId) state.approvalIds[key] = { id: approvalId, snapshot: snap };
      return { ok: true, state: decision, sent: false, booked: false, approval_id: approvalId, approval: result.approval };
    } catch (err) {
      var code = String((err && err.message) || '');
      state.approvalErrors[key] = snap.content && snap.content.variant === 'edited' && /approval_snapshot_changed/.test(code)
        ? 'The server only accepts the proposed text for now, so your edited text was not approved. Nothing was sent.'
        : /^[a-z0-9_:]+$/.test(code) ? 'Not approved: ' + reasonWords(code) + ' Nothing was sent or booked.'
        : code || 'Approval failed. Press Refresh before trying again.';
      return { ok: false, reason: state.approvalErrors[key] };
    } finally {
      delete state.approvalPending[key];
      render();
    }
  }

  function bookedVisits() {
    return (state.data && Array.isArray(state.data.booked_visits) ? state.data.booked_visits : []).filter(function (v) {
      return v && v.booking_key && v.contact_id && v.scoper_user_id === resource().scoper_user_id;
    });
  }

  function visitOutcomeRecords() {
    var live = state.data && Array.isArray(state.data.visit_outcomes) ? state.data.visit_outcomes.slice() : [];
    Object.keys(state.visitRecorded || {}).forEach(function (k) {
      var rec = state.visitRecorded[k];
      if (!rec || !rec.id || live.some(function (r) { return r && r.id === rec.id; })) return;
      live.push(rec);
    });
    return live;
  }

  function latestVisitOutcome(bookingKey) {
    var records = visitOutcomeRecords();
    var mine = records.filter(function (r) { return r.booking_key === bookingKey && r.scoper_user_id === resource().scoper_user_id; });
    var superseded = mine.map(function (r) { return r.supersedes; }).filter(Boolean);
    var current = mine.filter(function (r) { return superseded.indexOf(r.id) < 0; });
    return current.length === 1 ? current[0] : null;
  }

  function visitKey(v) { return state.resourceId + '|' + v.booking_key; }

  function visitWriteBlock(v) {
    var flow = state.data && state.data.booking_flow;
    if (state.loading || state.stale || state.error) return 'Refresh before recording an outcome.';
    if (!flow || flow.visit_outcome_write !== 'append-only-v1' || flow.visit_outcomes_read !== 'complete') return 'Visit outcomes are not connected yet. Nothing has been recorded.';
    if (!v || !v.booking_key || !v.contact_id || v.scoper_user_id !== resource().scoper_user_id) return 'Verified booking and GHL contact required.';
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(v.visit_start || '') || !Number.isFinite(Date.parse(v.visit_start))) return 'Visit time is missing.';
    if (Date.parse(v.visit_start) > Date.now()) return 'This visit has not started yet.';
    var cloud = global.SECUREWORKS_CLOUD;
    var user = cloud && cloud.auth && cloud.auth.getUser();
    if (!user || !user.id) return 'Sign in to record a visit outcome.';
    if (state.visitUncertain[visitKey(v)]) return 'Outcome not verified. Refresh before recording another outcome.';
    if (visitOutcomeRecords().some(function (r) { return r.booking_key === v.booking_key; }) && !latestVisitOutcome(v.booking_key)) return 'Outcome history is ambiguous. Reconcile it before adding a correction.';
    if (state.visitPending[visitKey(v)]) return 'Recording outcome…';
    return '';
  }

  // The outcome API owns identity/provenance and normalizes text/timestamptz.
  // Verify the submitted facts, then retain its actual row for corrections.
  function verifiedVisitOutcome(result, submitted, actorId) {
    var row = result && result.visit_outcome;
    if (!result || result.ok === false || result.error || !row) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id || '') || row.id === submitted.supersedes) return null;
    if (row.recorded_by_user_id !== actorId || row.source !== 'booking_screen' ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(row.recorded_at || '') || !Number.isFinite(Date.parse(row.recorded_at))) return null;
    var matches = Object.keys(submitted).every(function (field) {
      var expected = submitted[field];
      if (field === 'visit_start') return /(Z|[+-]\d{2}:\d{2})$/.test(row[field] || '') && Date.parse(row[field]) === Date.parse(expected);
      if (typeof expected === 'string') expected = expected.trim();
      if (field === 'note' && !expected) expected = null;
      return row[field] === expected;
    });
    return matches ? row : null;
  }

  async function recordVisitOutcome(bookingKey, outcome, reason, note, quoteOwed) {
    var v = bookedVisits().find(function (visit) { return visit.booking_key === bookingKey; });
    if (!v) return {ok:false,reason:'Booking not found'};
    var key = visitKey(v), blocked = visitWriteBlock(v);
    var previous = latestVisitOutcome(bookingKey);
    if (!blocked && bookedVisits().filter(function (visit) { return visit.booking_key === bookingKey; }).length !== 1) blocked = 'Booking identity is ambiguous.';
    if (!blocked && !sameContent(state.shownVisits[key], v)) blocked = 'Booking changed. Review the visit again.';
    if (!blocked && previous && !state.visitForms[key]) blocked = 'Outcome already recorded. Use Correct outcome.';
    if (!blocked && ['happened','did_not_happen'].indexOf(outcome) < 0) blocked = 'Choose a visit outcome.';
    if (!blocked && outcome === 'did_not_happen' && ['customer_not_home','we_did_not_attend','rescheduled'].indexOf(reason) < 0) blocked = 'Choose why the visit did not happen.';
    note = String(note || '');
    if (!blocked && (Array.from(note.trim()).length > 200 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(note))) blocked = 'Keep the note to one line, at most 200 characters.';
    if (blocked) { state.visitErrors[key] = blocked; render(); return {ok:false,reason:blocked}; }
    // Live record_visit_outcome 400s on whitespace-only; same empty-note rule as verifiedVisitOutcome.
    note = note.trim() || null;
    var user = global.SECUREWORKS_CLOUD.auth.getUser();
    var submitted = {
      booking_key: v.booking_key, appointment_id: v.appointment_id || null,
      contact_id: v.contact_id, opportunity_id: v.opportunity_id || null, job_id: v.job_id || null,
      scoper_user_id: v.scoper_user_id, scoper_name: resource().name, visit_start: v.visit_start,
      outcome: outcome, reason: outcome === 'happened' ? null : reason, note: note,
      quote_owed: outcome === 'happened' && quoteOwed !== false, supersedes: previous && previous.id || null
    };
    state.visitPending[key] = true; delete state.visitErrors[key]; render();
    try {
      if (typeof global.opsPost !== 'function') throw new Error('Visit outcome service unavailable. Nothing recorded.');
      var result = await global.opsPost('record_visit_outcome', submitted);
      var record = verifiedVisitOutcome(result, submitted, user.id);
      if (!record) throw new Error('Outcome not verified. Refresh before trying again.');
      state.visitRecorded[key] = record;
      var current = state.data;
      var present = current && (current.booked_visits || []).some(function (visit) { return visit && visit.booking_key === record.booking_key; });
      if (present) {
        current.visit_outcomes = current.visit_outcomes || [];
        if (!current.visit_outcomes.some(function (row) { return row && row.id === record.id; })) current.visit_outcomes.push(record);
      }
      delete state.visitForms[key];
      return {ok:true,visit_outcome:record,sent:false};
    } catch (err) {
      state.visitUncertain[key] = true;
      state.visitErrors[key] = err.message || 'Outcome failed. Refresh before trying again.';
      return {ok:false,reason:state.visitErrors[key]};
    } finally { delete state.visitPending[key]; render(); }
  }

  function renderVisitRow(v) {
    var key = visitKey(v), previous = latestVisitOutcome(v.booking_key), block = visitWriteBlock(v);
    state.shownVisits[key] = Object.assign({}, v);
    var form = state.visitForms[key];
    var labels = {customer_not_home:'Customer not home',we_did_not_attend:'We did not attend',rescheduled:'Rescheduled'};
    var status = previous ? (previous.outcome === 'happened' ? 'Happened' : 'Did not happen · ' + labels[previous.reason]) + (previous.quote_owed ? ' · Quote owed' : '') : 'No outcome recorded';
    return '<div class="visit-row" data-visit-row="' + esc(v.booking_key) + '"><div><strong>' + esc(v.display_name || 'Booked visit') + '</strong> · ' + esc(longDate(v.visit_start.slice(0,10))) + ' ' + esc(v.visit_start.slice(11,16)) + ' Perth</div><p role="status">' + esc(status) + '</p>' +
      (state.visitErrors[key] ? '<p role="alert">' + esc(state.visitErrors[key]) + '</p>' : '') +
      (previous && !form ? '<p>' + esc(previous.note || '') + '</p><button data-visit-edit="' + esc(v.booking_key) + '">Correct outcome</button>' :
      '<div class="visit-inputs"><label>Note <span>(optional)</span><input name="visit-note" data-visit-note maxlength="200" value="' + esc(form && form.note || '') + '" placeholder="One line, up to 200 characters"></label><label class="visit-quote"><input type="checkbox" data-visit-quote' + (!form || form.quote_owed !== false ? ' checked' : '') + '> Quote owed if happened</label></div>' +
      '<div class="row"><button data-visit-outcome="happened" data-booking-key="' + esc(v.booking_key) + '"' + (block ? ' disabled' : '') + '>Happened</button><button data-visit-no="' + esc(v.booking_key) + '"' + (block ? ' disabled' : '') + '>Did not happen</button></div>' +
      (form && form.showReasons ? '<div class="row visit-reasons">' + Object.keys(labels).map(function (reason) { return '<button data-visit-outcome="did_not_happen" data-visit-reason="' + reason + '" data-booking-key="' + esc(v.booking_key) + '"' + (block ? ' disabled' : '') + '>' + labels[reason] + '</button>'; }).join('') + '</div>' : '')) +
      (block ? '<p class="small">' + esc(block) + '</p>' : '') + '</div>';
  }

  function renderVisitOutcomes() {
    var flow = state.data && state.data.booking_flow;
    if (!flow || flow.visit_outcomes_read !== 'complete') return '<section class="visit-outcomes" aria-label="Visit outcomes"><p>Visit outcomes are not connected yet</p></section>';
    var visits = bookedVisits(), now = Date.now();
    var missing = visits.filter(function (v) { var at = Date.parse(v.visit_start); return at <= now && at >= now - 7 * 86400000 && !latestVisitOutcome(v.booking_key); });
    var others = visits.filter(function (v) { return missing.indexOf(v) < 0; });
    return (missing.length ? '<section class="visit-outcomes notice warn" aria-label="Visits missing an outcome"><h2>' + missing.length + ' visit' + (missing.length === 1 ? ' needs' : 's need') + ' an outcome</h2><p>Last 7 days · Recording an outcome sends no customer message.</p>' + missing.map(renderVisitRow).join('') + '</section>' : '') +
      (others.length ? '<details class="visit-outcomes"><summary>Booked visits and outcomes · ' + others.length + '</summary><p>Recording an outcome sends no customer message. Corrections add a record; history is kept.</p>' + others.map(renderVisitRow).join('') + '</details>' : '');
  }

  // ---------------------------------------------------------------------------
  // Render: a dispatcher's work list, phone first. One line of counts, the
  // people to contact (loudest first), one card for the chosen person, and the
  // day as a column. Every press records the owner's approval of the exact
  // content first, then asks the server to act, then says what happened.
  // ---------------------------------------------------------------------------
  var ACTIONS = { message: 'sales_booking_send', calendar: 'sales_booking_book' };
  // Live GHL calendar ids (wiki booking review, 23 Sep 2026). Unknown ids are
  // named as "GHL calendar", never guessed.
  var CALENDAR_NAMES = {
    dEQKVKHthsjSYaen1fiE: 'GHL Stratco Fencing calendar',
    i6j9vaCy6c94n3i93cir: 'GHL SW Fencing Scope calendar',
    RSQnT8cQdEE8azb5Chlq: 'GHL Nithin Scope calendar'
  };
  var ICONS = {
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    send: '<path d="M4 12l16-8-6 17-3-7z"/><path d="M11 14l9-10"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>'
  };

  function icon(name) {
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function shortDate(iso) {
    var date = String(iso || '').slice(0, 10);
    var parts = date.split('-').map(Number);
    if (parts.length !== 3 || !parts[0]) return date;
    var day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] + ' ' + parts[2] + ' ' + MONTHS[parts[1] - 1].slice(0, 3);
  }

  function timeRange(startIso, endIso) {
    var s = hourFromIso(startIso), e = hourFromIso(endIso);
    if (s == null) return '';
    if (e == null || e <= s) return clockLabel(s);
    return clockLabel(s, (s >= 12) !== (e >= 12)) + ' to ' + clockLabel(e);
  }

  function perthClockNow() {
    var d = new Date(Date.now() + 8 * 3600000);
    return clockLabel(d.getUTCHours() + d.getUTCMinutes() / 60);
  }

  // Written from the booking read's instant, so a bubble says "Tue 22 Sep, 2:14pm".
  function whenWords(raw) {
    if (raw == null || raw === '') return '';
    var ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
    if (!isFinite(ms)) return String(raw);
    var d = new Date(ms + 8 * 3600000);
    return shortDate(d.toISOString().slice(0, 10)) + ', ' + clockLabel(d.getUTCHours() + d.getUTCMinutes() / 60);
  }

  function sourceLabel(ev) {
    var s = String(ev && (ev.source || ev.provider || '') || '').toLowerCase();
    return /outlook|graph|microsoft|m365|office365/.test(s) ? 'Outlook' : 'GHL';
  }

  function eventTitle(ev) {
    if (ev && ev.title_withheld) return 'Private event';
    return diaryTitle(ev) || (ev && ev.display_name) || 'Busy';
  }

  function phoneEnding(number) {
    var digits = String(number || '').replace(/\D/g, '');
    return digits ? digits.slice(-3) : '';
  }

  function senderShort(number, label) {
    var route = resolveSender();
    if (!label && route.resolved && route.number === number) label = route.label;
    var tail = phoneEnding(number);
    return label ? label : tail ? 'line ' + tail : 'the sales line';
  }

  // ---- ordering: the loudest customer first --------------------------------
  function unansweredSince(c) {
    var f = threadFacts(c);
    var lastIn = Date.parse((f && f.last_inbound_at) || (c && c.last_inbound_at) || '');
    if (!isFinite(lastIn)) return null;
    var lastOut = Date.parse((f && f.last_human_outbound_at) || (c && c.last_human_outbound_at) || '');
    return (!isFinite(lastOut) || lastIn > lastOut) ? lastIn : null;
  }

  function loudnessRank(c) {
    if (unansweredSince(c) != null) return 0;
    if (needsDecision(c)) return 1;
    if (derivedStatus(c) === 'follow_up') return 2;
    if (c && c.proposal && c.proposal.start_iso) return 3;
    return 4;
  }

  function byLoudness(a, b) {
    var d = loudnessRank(a) - loudnessRank(b);
    if (d) return d;
    var ua = unansweredSince(a), ub = unansweredSince(b);
    if (ua != null && ub != null && ua !== ub) return ua - ub;
    return (daysWaiting(b) || 0) - (daysWaiting(a) || 0);
  }

  // The customer's own latest words, verbatim. Read field first, then a thread
  // already opened this session, then the proposal's quoted evidence.
  function lastWords(c) {
    if (!c) return null;
    var f = threadFacts(c) || {};
    var direct = c.last_inbound_text || c.last_inbound_body || f.last_inbound_text || f.last_inbound_body || f.last_inbound_excerpt;
    if (direct) return String(direct);
    var thread = c.contact_id && state.threads[c.contact_id];
    if (thread && thread.length) {
      for (var i = thread.length - 1; i >= 0; i--) {
        var msg = thread[i];
        if (msg && msg.direction !== 'outbound' && (msg.body || msg.subject)) return String(msg.body || msg.subject);
      }
    }
    var m = decisionModel(c);
    var quotes = m && m.evidence || [];
    if (quotes.length && quotes[quotes.length - 1].quote) return String(quotes[quotes.length - 1].quote);
    return null;
  }

  function listGroupsFrom(list) {
    var booked = [], waiting = [], contact = [], unsorted = [];
    list.forEach(function (c) {
      if (isNonScopeDiaryMirror(c)) return;
      if (isBooked(c)) booked.push(c);
      else if (isWaiting(c)) waiting.push(c);
      else if (isAssessed(c)) contact.push(c);
      else unsorted.push(c);
    });
    contact.sort(byLoudness);
    waiting.sort(byLoudness);
    return { contact: contact, waiting: waiting, booked: booked, unsorted: unsorted };
  }

  function listGroups() {
    return listGroupsFrom(visibleCases());
  }

  function weekListGroups() {
    return listGroupsFrom(cases().filter(function (c) {
      return matchesFilter(c) && !isFoldedStage(c);
    }));
  }

  function statusPill(c) {
    if (isArchived(c)) return ['', 'Archived'];
    if (quoteOutstanding(c)) return ['', 'Quote to send'];
    if (scopeAppointment(c)) return ['ok', scopeAppointmentWords(c)];
    if (isBooked(c)) return ['ok', 'Booked'];
    if (unansweredSince(c) != null) return ['hot', 'No answer yet'];
    if (needsDecision(c)) return ['', 'Needs a person'];
    if (derivedStatus(c) === 'follow_up') return ['hot', 'Follow-up due'];
    if (isWaiting(c)) return ['', 'Offer out'];
    if (c.proposal && c.proposal.start_iso) return ['accent', 'Proposed ' + shortDate(c.proposal.start_iso)];
    if (!isAssessed(c)) return ['', 'Not sorted'];
    return null;
  }

  function waitWords(c) {
    var days = daysWaiting(c);
    if (days == null) return '';
    return days === 0 ? 'Today' : plural(days, 'day');
  }

  function jobWord(job) {
    return /^(patio|patios|fencing|decking|fence)$/i.test(job) ? job.toLowerCase() : job;
  }

  function renderLeadRow(c) {
    var pill = statusPill(c);
    var words = lastWords(c);
    var facts = threadFacts(c);
    var quiet = !words && facts && facts.read_ok && !facts.last_inbound_at;
    var place = [caseSuburb(c) || 'Suburb not given', jobTypeLabel(c) === 'not given' ? '' : jobWord(jobTypeLabel(c))].filter(Boolean).join(' · ');
    return '<button type="button" class="lead' + (c.id === state.selectedId ? ' is-on' : '') + '" data-booking-case="' + esc(c.id) + '" aria-pressed="' + (c.id === state.selectedId) + '">' +
      '<span class="lead-top"><span class="lead-name">' + esc(c.display_name || 'Unnamed enquiry') + '</span>' +
      '<span class="lead-wait" title="' + esc(enquiryLine(c)) + '">' + esc(waitWords(c) || 'Date not read') + '</span></span>' +
      '<span class="lead-place">' + esc(place) + '</span>' +
      (words ? '<span class="lead-words">“' + esc(words) + '”</span>' : quiet ? '<span class="lead-words is-quiet">No reply from them yet</span>' : '') +
      (pill ? '<span class="lead-tags"><span class="pill ' + pill[0] + '">' + esc(pill[1]) + '</span>' +
        (pill[1].indexOf('Proposed') !== 0 && !isBooked(c) && c.proposal && c.proposal.start_iso ? '<span class="pill">Proposed ' + esc(shortDate(c.proposal.start_iso)) + '</span>' : '') +
        (c.not_in_this_read ? '<span class="pill">Proposal only, not in GHL list</span>' : '') + '</span>' : '') +
      '</button>';
  }

  function renderListBody() {
    if (state.loading && !state.data) {
      return '<div class="skeleton" aria-hidden="true">' + [0, 1, 2, 3].map(function () { return '<span class="sk-row"><i></i><i></i><i></i></span>'; }).join('') + '</div>';
    }
    if (!state.data) return '<p class="empty">Nothing to show until the list is read.</p>';
    var g = listGroups();
    var html = '';
    var section = function (title, rows, open) {
      if (!rows.length) return '';
      return '<h3 class="grouphead">' + esc(title) + '<span class="count">' + rows.length + '</span></h3>' + rows.map(renderLeadRow).join('');
    };
    html += g.contact.length
      ? section('To contact', g.contact)
      : '<h3 class="grouphead">To contact<span class="count">0</span></h3><p class="empty">' + (state.search ? 'Nobody matches that search.' : 'Nobody waiting to be contacted.') + '</p>';
    html += section('Waiting on a reply', g.waiting);
    html += section('Booked', g.booked);
    if (g.unsorted.length) {
      html += '<details class="fold"' + (state.search ? ' open' : '') + '><summary>Not sorted yet<span class="count">' + g.unsorted.length + '</span></summary>' +
        '<p class="fine">In GHL but not in a booking stage. They are not counted above.</p>' + g.unsorted.map(renderLeadRow).join('') + '</details>';
    }
    var fold = foldedCases().filter(matchesSearch);
    html += '<button type="button" class="foldtoggle" data-booking-fold="1" aria-expanded="' + state.showArchived + '">' +
      (state.showArchived ? 'Hide' : 'Show') + ' quoted and archived<span class="count">' + fold.length + '</span></button>';
    if (state.showArchived) html += fold.length ? fold.map(renderLeadRow).join('') : '<p class="empty">Nothing quoted or archived in this list.</p>';
    return html;
  }

  function renderList() {
    var g = state.data ? weekListGroups() : null;
    var people = g ? g.contact.length + g.waiting.length + g.booked.length + g.unsorted.length : 0;
    return '<section class="bk-list" aria-label="People to contact">' +
      '<div class="listhead"><h2>To book</h2>' + (g ? '<span class="count">' + plural(people, 'person', 'people') + '</span>' : '') + '</div>' +
      '<label class="search">' + icon('search') + '<span class="sr">Search</span>' +
      '<input type="search" data-booking-search data-focus-key="search" placeholder="Search name or suburb" autocomplete="off" value="' + esc(state.search) + '"></label>' +
      '<div class="listbody" data-booking-list-body>' + renderListBody() + '</div>' + renderVisitsDue() + '</section>';
  }

  // ---- counts, alert, details ------------------------------------------------
  function bookedByDay() {
    var days = {};
    var seen = {};
    diary().forEach(function (ev) {
      if (diaryLayerFor(ev) !== 'confirmed') return;
      var d = dayIndexFromIso(ev.start_iso, state.weekStart);
      if (d == null) return;
      var key = ev.id || String(ev.start_iso) + String(ev.display_name);
      if (seen[key]) return;
      seen[key] = true;
      days[d] = (days[d] || 0) + 1;
    });
    return days;
  }

  function renderCounts() {
    if (!state.data) return '';
    var f = followThrough();
    var parts = ['<span><b>' + weekListGroups().contact.length + '</b> to contact</span>', '<span><b>' + f.waiting + '</b> waiting on a reply</span>'];
    if (calendarUnread(state.data)) {
      parts.push('<span class="is-bad">Booked: calendar not read</span>');
    } else {
      var byDay = bookedByDay();
      var shown = deskDays(resource()).slice();
      Object.keys(byDay).forEach(function (d) { d = Number(d); if (byDay[d] && shown.indexOf(d) < 0) shown.push(d); });
      shown.sort();
      parts.push('<span>Booked ' + shown.map(function (d) {
        return DAYS[d].slice(0, 3) + ' <b>' + (byDay[d] || 0) + '</b>';
      }).join(', ') + '</span>');
    }
    if (f.quotes) parts.push('<span><b>' + f.quotes + '</b> ' + (f.quotes === 1 ? 'quote' : 'quotes') + ' to send</span>');
    var notes = coverageGaps(state.data).length;
    return '<div class="bk-counts"><p class="counts" role="status">' + parts.join('<i aria-hidden="true">·</i>') + '</p>' +
      '<button type="button" class="detailsbtn" data-booking-details aria-expanded="' + !!state.showDetails + '">Details' +
      (notes ? '<span class="count">' + notes + '</span>' : '') + icon('chevron') + '</button></div>';
  }

  function readProblem() {
    if (state.error) {
      return state.stale && state.data
        ? 'Could not read the latest booking list: ' + state.error.replace(/\s*Showing the last complete week(, not an empty one)?\.?/i, '') + ' This is the last good read.'
        : 'Could not read the booking list: ' + state.error;
    }
    if (state.data && calendarUnread(state.data)) {
      var read = calendarReadState(state.data);
      return read.state === 'not_configured'
        ? resource().name + '\'s calendar is not set up, so free times are unknown and nothing can be booked.'
        : 'Could not read ' + resource().name + '\'s calendar' + (read.reason ? ' (' + read.reason + ')' : '') + ', so free times are unknown and nothing can be booked.';
    }
    return '';
  }

  function renderDetails() {
    if (!state.showDetails || !state.data) return '';
    var data = state.data;
    var res = resource();
    var route = resolveSender(res);
    var gaps = coverageGaps(data);
    var read = calendarReadState(data);
    return '<section class="bk-details" aria-label="Details">' +
      '<div class="dgrid">' +
      '<div><h3>What this read could not see</h3>' + (coverageLooksRateLimited(data) ? '<p><strong>GHL rate limited part of this read.</strong></p>' : '') + (gaps.length ? '<ul>' + gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' : '<p>Nothing missing.</p>') + '</div>' +
      '<div><h3>Where this comes from</h3><ul>' +
      '<li>Calendar: ' + esc(calendarMailbox(data)) + ' · ' + esc(read.state === 'read' ? 'read' : read.state === 'not_configured' ? 'not set up' : 'could not read') + '</li>' +
      '<li>Leads: GHL, ' + esc(res.lane) + ' pipeline</li>' +
      '<li>Texts go from ' + esc(route.resolved ? route.label + ' (' + route.number + ')' : 'an unresolved line') + '</li>' +
      '<li>' + esc(res.name) + '\'s hours: ' + esc(res.desk_rules.hours) + '</li>' +
      (state.lastReadMs >= 1000 ? '<li>Last read took ' + plural(Math.round(state.lastReadMs / 1000), 'second') + '</li>' : '') +
      '</ul><button type="button" class="linklike" data-sales-tab="performance">Weekly numbers are on Performance</button></div>' +
      '<div>' + renderVisitHistory() + '</div>' +
      '</div>' + renderPipelineBoard() + '</section>';
  }

  // ---- visits that still owe an outcome ---------------------------------------
  function visitsDue() {
    var flow = state.data && state.data.booking_flow;
    if (!flow || flow.visit_outcomes_read !== 'complete') return [];
    var now = Date.now();
    return bookedVisits().filter(function (v) { var at = Date.parse(v.visit_start); return at <= now && at >= now - 7 * 86400000 && !latestVisitOutcome(v.booking_key); });
  }

  function renderVisitsDue() {
    var due = visitsDue();
    if (!due.length) return '';
    return '<section class="visit-outcomes is-due" aria-label="Visits missing an outcome"><h2>' + plural(due.length, 'visit') + ' to close out</h2>' +
      '<p class="fine">Did it happen? Recording this sends no message.</p>' + due.map(renderVisitRow).join('') + '</section>';
  }

  function renderVisitHistory() {
    var flow = state.data && state.data.booking_flow;
    if (!flow || flow.visit_outcomes_read !== 'complete') return '<h3>Visit outcomes</h3><p>Visit outcomes are not connected yet</p>';
    var due = visitsDue();
    var others = bookedVisits().filter(function (v) { return due.indexOf(v) < 0; });
    if (!others.length) return '<h3>Visit outcomes</h3><p>No other booked visits in this read.</p>';
    return '<details class="visit-outcomes"><summary>Booked visits and outcomes · ' + others.length + '</summary><p class="fine">Recording an outcome sends no message. A correction adds a record and keeps the old one.</p>' + others.map(renderVisitRow).join('') + '</details>';
  }

  // Compatibility: both halves, as the outcome tests read them.
  function renderVisitOutcomes() {
    var flow = state.data && state.data.booking_flow;
    if (!flow || flow.visit_outcomes_read !== 'complete') return '<section class="visit-outcomes" aria-label="Visit outcomes"><p>Visit outcomes are not connected yet</p></section>';
    return renderVisitsDue() + renderVisitHistory();
  }

  // ---- the GHL pipeline, read only, inside Details ----------------------------
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
      cols = cols.concat([{ id: 'unmapped', name: 'Stage not recognised', bucket: 'unmapped', stageIds: [] }]);
      byCol.unmapped = unmapped;
    }
    var drifted = list.filter(function (c) { return !!stageDrift(c); });
    return '<section class="pipeboard" data-booking-pipeline="1"><h3>GHL pipeline</h3>' +
      '<p class="fine">Read from GHL as it is now. Stages are not moved from this screen.' + (drifted.length ? ' ' + plural(drifted.length, 'card') + ' may be in the wrong stage.' : '') + '</p>' +
      '<div class="pipe">' + cols.filter(function (col) { return (byCol[col.id] || []).length; }).map(function (col) {
        var cards = byCol[col.id] || [];
        return '<div class="pcol"><h4>' + esc(col.name) + '<span class="count">' + cards.length + '</span></h4>' + cards.map(function (c) {
          var drift = stageDrift(c);
          return '<button type="button" class="pcard' + (drift ? ' is-off' : '') + '" data-booking-case="' + esc(c.id) + '"><b>' + esc(c.display_name || 'Enquiry') + '</b><span>' + esc(caseSuburb(c) || 'Suburb not given') + '</span>' +
            (drift ? '<span class="drift">Thread and calendar say ' + esc(String(drift.want.name || '').replace(/^\s+/, '')) + '</span>' : '') + '</button>';
        }).join('') + '</div>';
      }).join('') + '</div></section>';
  }

  // ---- the card -----------------------------------------------------------------
  function renderThread(c) {
    var conv = state.conversation;
    if (!c.contact_id) return '<p class="thread-note">No GHL contact on this lead, so there are no messages to show.</p>';
    if (conv.contactId && conv.contactId !== c.contact_id) return '<p class="thread-note">Loading messages…</p>';
    if (conv.loading) return '<div class="thread-sk" aria-label="Loading messages"><i></i><i></i><i></i></div>';
    if (conv.error) return '<p class="thread-note is-bad">Could not read the messages: ' + esc(conv.error) + '</p>';
    if (!conv.contactId) return '<p class="thread-note">Messages open with the lead.</p>';
    var msgs = conv.messages || [];
    if (!msgs.length) return '<p class="thread-note">No messages with this person yet.</p>';
    var shown = state.showConversation ? msgs : msgs.slice(-3);
    return (msgs.length > 3 ? '<button type="button" class="linklike threadmore" data-booking-thread-all aria-expanded="' + !!state.showConversation + '">' + (state.showConversation ? 'Show the last 3 only' : 'Show all ' + msgs.length + ' messages') + '</button>' : '') +
      '<ol class="thread">' + shown.map(function (msg) {
        var out = msg.direction === 'outbound';
        var who = out ? (msg.sender_name || 'SecureWorks') : (c.display_name || 'Customer');
        var type = String(msg.type || '').replace(/^TYPE_/, '');
        return '<li class="bubble ' + (out ? 'is-out' : 'is-in') + '"><small>' + esc(who) + ' · ' + esc(whenWords(msg.timestamp || msg.dateAdded)) + (type && !/sms/i.test(type) ? ' · ' + esc(type.toLowerCase()) : '') + '</small>' +
          '<span class="body">' + esc(msg.body || msg.subject || '(no text)') + '</span></li>';
      }).join('') + '</ol>';
  }

  // What the read says already happened to this exact content, in words.
  function channelLine(c, kind) {
    var last = state.pressResults[approvalKey(c, kind)];
    if (last && last.done) return '';
    var status = approvalState(c, kind);
    var what = kind === 'calendar' ? 'booking' : 'text';
    var notYet = 'Not ' + (kind === 'calendar' ? 'booked' : 'sent') + ' yet.';
    var line = {
      approved: ['Approved', 'You approved this exact ' + what + '. ' + notYet],
      held: ['Approved', 'You approved this exact ' + what + '. ' + notYet],
      done: ['Done', kind === 'calendar' ? 'This visit is booked.' : 'This text was sent.'],
      refused: ['Refused', 'You said no' + (status.reason ? ': ' + status.reason : '') + '.'],
      pending: ['In progress', 'Press Refresh to see the result.'],
      failed: ['Failed', 'It did not go through' + (status.reason ? ': ' + status.reason : '') + '.'],
      unknown: ['Result unknown', 'Check GHL before trying again.']
    }[status.state];
    if (!line) return '';
    return '<p class="chanstate is-' + status.state + '" role="status"><strong>' + line[0] + '</strong> ' + esc(line[1]) + '</p>';
  }

  // Lock the draft while an approval or press is in flight so the words on
  // screen stay the approved snapshot: the box is disabled, restoreFocus will
  // not return to it, and Use the proposed text is omitted and ignored.
  function composeBusy(c) {
    if (!c) return false;
    if (state.ownerPreviews[approvalKey(c, 'message')]) return true;
    return ['message', 'calendar'].some(function (kind) {
      var key = approvalKey(c, kind);
      return !!(state.approvalPending[key] || state.pressPending[key]);
    });
  }

  function pressBlock(c, kind) {
    if (bookedElsewhere(c)) return bookedElsewhereBlock(c);
    var key = approvalKey(c, kind);
    if (state.pressPending[key]) return kind === 'calendar' ? 'Booking…' : 'Sending…';
    var last = state.pressResults[key];
    if (last && last.uncertain) return 'The last press has no confirmed result. Check GHL, then press Refresh.';
    if (last && last.done && sameContent(last.snapshot, approvalSnapshot(c, kind))) return kind === 'calendar' ? 'Already booked.' : 'Already sent.';
    var status = approvalState(c, kind);
    var held = state.approvalIds[key];
    if ((status.state === 'approved' || status.state === 'held') && held && sameContent(held.snapshot, approvalSnapshot(c, kind)) && !state.loading && !state.stale && !state.error) return '';
    return approvalBlock(c, kind, false);
  }

  function renderResult(c, kind) {
    var r = state.pressResults[approvalKey(c, kind)];
    var err = state.approvalErrors[approvalKey(c, kind)];
    var out = '';
    if (err) out += '<p class="result is-bad" role="alert">' + esc(err) + '</p>';
    if (r) {
      out += '<p class="result is-' + r.tone + '" role="status">' + esc(r.text) +
        (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">Open in GHL</a>' : '') +
        (r.ref ? '<small>' + esc(r.ref) + '</small>' : '') + '</p>';
    }
    return out;
  }

  function renderSayNo(c, kind) {
    var status = approvalState(c, kind);
    if (['done', 'approved', 'held', 'pending', 'unknown', 'refused'].indexOf(status.state) >= 0) return '';
    var refuseBlocked = approvalBlock(c, kind, true);
    if (refuseBlocked) return '';
    var what = kind === 'calendar' ? 'booking' : 'text';
    return '<details class="sayno"><summary>Say no to this ' + what + '</summary><label>Why not<input name="refuse-' + kind + '" data-refusal-reason="' + kind + '" data-focus-key="refuse-' + kind + '" aria-label="Reason to say no to this ' + what + '"></label>' +
      '<button type="button" data-booking-decision="' + kind + '" data-refuse="1" data-case-id="' + esc(c.id) + '">Say no</button></details>';
  }

  function composeText(c) {
    var d = state.drafts[draftKey(c)];
    if (d && d.humanEdited && typeof d.text === 'string') return d.text;
    var m = decisionModel(c);
    if (m && m.message && typeof m.message.text === 'string') return m.message.text;
    return (c.proposal && c.proposal.draft) || (d && d.text) || '';
  }

  function renderComposeFoot(c) {
    if (messagePath(c) === 'owner') return renderOwnerComposeFoot(c);
    var m = decisionModel(c);
    var msg = selectedMessage(c);
    var route = resolveSender();
    var sender = (msg && msg.sender) || route.number;
    var recipient = msg && msg.recipient;
    var block = pressBlock(c, 'message');
    var edited = editedText(c) != null;
    var key = approvalKey(c, 'message');
    var clash = clashFor(c);
    return '<p class="route">From <b>' + esc(route.resolved && route.number === sender ? route.label : senderShort(sender)) + '</b>' +
      (recipient ? ' to the phone ending <b>' + esc(phoneEnding(recipient)) + '</b>' : ' · customer phone not in this read') + '</p>' +
      (edited ? '<p class="edited">Edited. Your approval will cover these exact words.' + (composeBusy(c) ? '' : ' <button type="button" class="linklike" data-booking-draft-reset>Use the proposed text</button>') + '</p>' : '') +
      (clash ? '<p class="clash">' + esc(clashSentence(clash)) + '</p>' : '') +
      '<div class="actions"><button type="button" class="primary" data-booking-press="message" data-case-id="' + esc(c.id) + '"' + (block ? ' disabled aria-describedby="why-message"' : '') + '>' + icon('send') + (state.pressPending[key] ? 'Sending…' : 'Send this text') + '</button></div>' +
      (block && !state.pressPending[key] && !(state.pressResults[key] && state.pressResults[key].done) ? '<p class="why" id="why-message">' + esc(block) + '</p>' : '') +
      channelLine(c, 'message') + renderResult(c, 'message') + (m ? renderSayNo(c, 'message') : '');
  }

  // Which calendars Book it writes. The read names them when it can; otherwise
  // the GHL calendar on the proposal, plus the owner's Outlook for Stratco
  // (decided 23 Sep: booking writes GHL and the owner's Outlook).
  function bookTargets(m) {
    var preview = m && m.calendar || {};
    if (Array.isArray(preview.targets) && preview.targets.length) {
      var named = preview.targets.map(function (t) { return typeof t === 'string' ? t : (t && (t.label || t.name || t.provider)) || ''; }).filter(Boolean);
      if (named.length) return named;
    }
    var out = [CALENDAR_NAMES[preview.calendar_id] || 'GHL calendar'];
    if (m && m.profile === 'fencing-stratco-marnin') out.push('Marnin\'s Outlook');
    return out;
  }

  function renderVisit(c) {
    if (bookedElsewhere(c)) return '<section class="visit"><h3>' + icon('calendar') + 'Booked visit</h3><p class="when">' + esc(scopeAppointmentWords(c)) + '</p></section>';
    var m = decisionModel(c);
    if (!m && !ownerFlow()) {
      if (c.proposal && c.proposal.start_iso) {
        return '<section class="visit"><h3>' + icon('calendar') + 'Proposed visit</h3><p class="when">' + esc(proposalSlotLabel(c).replace(' · arrive ', ', arrive ')) + '</p>' +
          '<p class="why">No checked proposal for this lead yet, so it cannot be booked from here.</p></section>';
      }
      return '';
    }
    if (calendarPath(c) === 'owner') return renderOwnerVisit(c);
    if (!m.proposal || !m.confident) {
      return '<section class="visit is-needs"><h3>' + icon('calendar') + 'Needs a person</h3><p>' + esc(m.reason || c.reason || 'No confident proposal in this read.') + '</p>' + renderChecks(m, true) + renderPickOther(c) + '</section>';
    }
    var p = m.proposal;
    var when = longDate(String(p.start_iso).slice(0, 10)) + ', arrive ' + timeRange(p.window_start_iso, p.window_end_iso);
    var block = pressBlock(c, 'calendar');
    var key = approvalKey(c, 'calendar');
    var clash = clashFor(c);
    return '<section class="visit"><h3>' + icon('calendar') + 'Proposed visit</h3>' +
      '<p class="when">' + esc(when) + '</p>' +
      '<p class="fine">This is when the AI thinks we should book, from the conversation. On site until ' + esc(clockLabel(hourFromIso(p.end_iso))) + '.</p>' +
      (m.evidence.length ? '<div class="quotes">' + m.evidence.map(function (e) { return '<blockquote>“' + esc(e.quote) + '”</blockquote>'; }).join('') + '</div>' : '') +
      (clash ? '<p class="clash">' + esc(clashSentence(clash)) + '</p>' : '') +
      renderChecks(m, false) +
      '<p class="targets">Book it writes: <b>' + bookTargets(m).map(esc).join('</b> and <b>') + '</b></p>' +
      '<div class="actions"><button type="button" class="secondary" data-booking-press="calendar" data-case-id="' + esc(c.id) + '"' + (block ? ' disabled aria-describedby="why-calendar"' : '') + '>' + icon('calendar') + (state.pressPending[key] ? 'Booking…' : 'Book it') + '</button></div>' +
      (block && !state.pressPending[key] && !clash && !(state.pressResults[key] && state.pressResults[key].done) ? '<p class="why" id="why-calendar">' + esc(block) + '</p>' : '') +
      channelLine(c, 'calendar') + renderResult(c, 'calendar') + renderSayNo(c, 'calendar') + renderPickOther(c) + '</section>';
  }

  function renderChecks(m, open) {
    var checks = m && m.validation || [];
    if (!checks.length) return '<p class="fine">No checks were supplied, so this cannot be booked.</p>';
    var failed = checks.filter(function (v) { return v.passed !== true; }).length;
    return '<details class="checks"' + (open || failed ? ' open' : '') + '><summary>' + (failed ? plural(failed, 'check') + ' did not pass' : 'All ' + plural(checks.length, 'check') + ' passed') + '</summary><ul>' +
      checks.map(function (v) {
        return '<li class="' + (v.passed === true ? 'is-ok' : 'is-bad') + '">' + (v.passed === true ? 'Passed: ' : 'Failed: ') + esc(v.label) + (v.passed === true ? '' : ' · ' + esc(v.reason || 'No reason supplied')) + '</li>';
      }).join('') + '</ul></details>';
  }

  function renderCard() {
    var c = selectedCase();
    if (!c) {
      return '<section class="bk-card is-empty" aria-label="Selected lead"><div class="emptycard"><h2>Pick someone to contact</h2>' +
        '<p>Their last messages, the proposed text and the proposed visit open here. Nothing is sent or booked until you press.</p></div></section>';
    }
    var m = decisionModel(c);
    var stage = stageOf(c);
    var key = approvalKey(c, 'message');
    if (m) state.shownApprovals[key] = approvalSnapshot(c, 'message');
    if (m) state.shownApprovals[approvalKey(c, 'calendar')] = approvalSnapshot(c, 'calendar');
    var text = composeText(c);
    var writable = (m && m.message && m.message.template_locked) || (messagePath(c) === 'owner' && ownerFlow() && ownerBooking(c));
    var bits = [c.address || caseSuburb(c) || 'Address not given yet', jobTypeLabel(c) === 'not given' ? 'job not given' : jobTypeLabel(c)];
    return '<section class="bk-card" aria-label="Selected lead">' +
      '<header class="cardhead"><h2>' + esc(c.display_name || 'Enquiry') + '</h2><p>' + esc(bits.join(' · ')) + '</p>' +
      '<p class="fine">' + esc(enquiryLine(c)) + (stage ? ' · GHL stage: ' + esc(String(stage.name).replace(/^\s+/, '')) : '') + '</p>' +
      (scopeAppointment(c) && !bookedElsewhere(c) ? '<p class="bookednote">' + esc(scopeAppointmentWords(c)) + '</p>' : '') + '</header>' +
      '<section class="msgs"><h3>Latest messages</h3>' + renderThread(c) + '</section>' +
      '<section class="compose"><label for="bk-draft"><h3>Text to send</h3></label>' +
      '<textarea id="bk-draft" data-booking-draft data-focus-key="draft-' + esc(c.id) + '" rows="5" spellcheck="true" placeholder="' + (writable || m ? 'Write the text to send' : 'No proposed text yet') + '"' + (composeBusy(c) ? ' disabled' : (writable ? '' : ' readonly')) + '>' + esc(text) + '</textarea>' +
      '<div data-booking-compose-foot>' + renderComposeFoot(c) + '</div></section>' +
      renderVisit(c) + '</section>';
  }

  // ---- the day -----------------------------------------------------------------
  function defaultDayIndex() {
    var days = deskDays(resource());
    var c = selectedCase();
    var p = c && (decisionModel(c) && decisionModel(c).proposal || c.proposal);
    var mine = p && dayIndexFromIso(p.start_iso, state.weekStart);
    if (mine != null) return mine;
    var withWork = days.filter(function (d) {
      return cases().some(function (row) { return row.proposal && dayIndexFromIso(row.proposal.start_iso, state.weekStart) === d; });
    });
    if (withWork.length) return withWork[0];
    var today = state.weekStart === currentPerthWeek() ? dayIndexFromIso(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), state.weekStart) : null;
    var next = days.filter(function (d) { return today == null || d >= today; });
    return next.length ? next[0] : days[0];
  }

  function dayIndex() {
    return state.dayIndex == null ? defaultDayIndex() : state.dayIndex;
  }

  function dayCards(d) {
    var list = [];
    diary().forEach(function (ev) {
      if (dayIndexFromIso(ev.start_iso, state.weekStart) !== d) return;
      list.push({ block: ev, kind: diaryLayerFor(ev) });
    });
    cases().forEach(function (c) {
      var p = c.proposal;
      if (!p || !p.start_iso || dayIndexFromIso(p.start_iso, state.weekStart) !== d) return;
      if (scopeAppointment(c)) return;
      var kind = caseLayer(c);
      if (kind === 'confirmed' && c.event_id) return;
      list.push({ block: { id: c.id, contact_id: c.contact_id, start_iso: p.start_iso, end_iso: p.end_iso || addHourIso(p.start_iso), display_name: c.display_name, suburb: caseSuburb(c), proposal: true, not_in_this_read: !!c.not_in_this_read }, kind: kind });
    });
    // A proposed slot that runs into occupied time or another customer's hold
    // says which booking, in words, on the slot itself.
    list.forEach(function (card) {
      var b = card.block;
      if (!b.proposal) return;
      var a0 = Date.parse(b.start_iso), a1 = Date.parse(b.end_iso);
      var hit = list.filter(function (other) {
        var o = other.block;
        if (o === b || o.proposal) return false;
        if (o.reservation_state ? o.contact_id === b.contact_id : !diaryOccupiesDay(o)) return false;
        return Date.parse(o.start_iso) < a1 && Date.parse(o.end_iso) > a0;
      })[0];
      if (hit) b.clash = 'Clashes with ' + dayEventTitle(hit.block) + ' at ' + clockLabel(hourFromIso(hit.block.start_iso));
    });
    return packLanes(list);
  }

  function dayEventTitle(b) {
    if (b.proposal) return b.display_name || 'Proposed visit';
    if (b.reservation_state) {
      var holder = cases().filter(function (row) { return row.contact_id && row.contact_id === b.contact_id; })[0];
      return holder && holder.display_name || 'Another customer';
    }
    return eventTitle(b);
  }

  function kindWords(kind, block) {
    if (block.reservation_state) return block.reservation_state === 'agreed' ? 'Customer agreed' : 'Offer out';
    return ({ confirmed: 'Booked visit', blocked: 'Cancelled, still in calendar', offer: block.proposal ? 'Offer out' : 'Offer out', personal: 'Personal', busy: 'Busy', leave: 'Leave', proposal: 'Proposed' })[kind] || 'Busy';
  }

  // The day is a grid of 15-minute rows sized minmax(15px, auto): an entry spans
  // its rows, and when its words need more room the rows grow instead of the
  // words being cut off. Overlapping entries share the width in lanes.
  var SLOTS_PER_HOUR = 4;

  function slotOf(iso, roundUp) {
    var h = hourFromIso(iso);
    if (h == null) return null;
    var slot = (h - DAY_START) * SLOTS_PER_HOUR;
    slot = roundUp ? Math.ceil(slot - 1e-9) : Math.floor(slot + 1e-9);
    return Math.max(0, Math.min((DAY_END - DAY_START) * SLOTS_PER_HOUR, slot));
  }

  function renderDayEvent(card, columns, firstCol) {
    var b = card.block, kind = card.kind;
    var from = slotOf(b.start_iso, false);
    if (from == null) return '';
    var to = Math.max(from + 3, slotOf(b.end_iso, true) || from + 4);
    to = Math.min(to, (DAY_END - DAY_START) * SLOTS_PER_HOUR);
    if (to <= from) { from = Math.max(0, to - 3); }
    var lanes = Math.max(1, b.lanes || 1), lane = b.lane || 0;
    var per = Math.max(1, Math.floor(columns / lanes));
    var colStart = (firstCol == null ? 2 : firstCol) + lane * per;
    var colEnd = lane === lanes - 1 ? -1 : colStart + per;
    var title = dayEventTitle(b);
    var badge = b.proposal || b.reservation_state ? '' : '<span class="src src-' + sourceLabel(b).toLowerCase() + '">' + sourceLabel(b) + '</span>';
    var selected = b.id && b.id === state.selectedId;
    var place = b.suburb && !b.reservation_state ? ', ' + b.suburb : '';
    var cls = 'ev is-' + kind + (b.proposal && kind !== 'proposal' ? ' is-proposal' : '') + (b.clash ? ' is-clash' : '') + (selected ? ' is-sel' : '');
    var at = ' style="grid-row:' + (from + 1) + ' / ' + (to + 1) + ';grid-column:' + colStart + ' / ' + colEnd + '"';
    if (b.proposal) {
      // A lead's proposed visit, as on the 17 Sep week: its stage on a small
      // chip, then who and where, then when. A clash is red and names the
      // booking it runs into.
      return '<button type="button" class="' + cls + '" data-booking-case="' + esc(b.id || '') + '"' + at + (selected ? ' aria-pressed="true"' : '') + '>' +
        '<span class="ev-chip">' + esc(kindWords(kind, b)) + '</span>' +
        '<span class="ev-title">' + esc(title || 'Proposed visit') + '</span>' +
        (b.suburb ? '<span class="ev-place">' + esc(b.suburb) + '</span>' : '') +
        '<span class="ev-time">' + esc(timeRange(b.start_iso, b.end_iso)) + '</span>' +
        (b.not_in_this_read ? '<span class="ev-kind">Not in the GHL list</span>' : '') +
        (b.clash ? '<span class="ev-clash">' + esc(b.clash) + '</span>' : '') + '</button>';
    }
    return '<button type="button" class="' + cls + '" data-booking-case="' + esc(b.id || '') + '"' + at + '>' +
      '<span class="ev-top"><span class="ev-title">' + esc(title || 'Busy') + esc(place) + '</span>' + badge + '</span>' +
      '<span class="ev-time">' + esc(timeRange(b.start_iso, b.end_iso)) + '</span>' +
      '<span class="ev-kind">' + esc(kindWords(kind, b)) + (b.not_in_this_read ? ' · not in GHL list' : '') + '</span>' +
      (b.clash ? '<span class="ev-clash">' + esc(b.clash) + '</span>' : '') + '</button>';
  }

  // Enough grid columns that every lane count on this day divides evenly.
  function dayColumns(cards) {
    var columns = 1;
    cards.forEach(function (card) { columns = Math.max(columns, card.block.lanes || 1); });
    if (columns > 1) {
      var want = columns;
      cards.forEach(function (card) { var l = card.block.lanes || 1; while (want % l) want += columns; });
      columns = want;
    }
    return columns;
  }

  function perthTodayIso() {
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  }

  // One day of the week: its own lanes, on the week's shared 15-minute rows
  // (a CSS subgrid), so a row that grows for one day's words grows for all
  // five and the hours stay level across the week.
  function renderWeekDay(res, i, selected, lane, cards) {
    var columns = dayColumns(cards);
    var span = function (fromHour, toHour) {
      return 'grid-row:' + (Math.round((fromHour - DAY_START) * SLOTS_PER_HOUR) + 1) + ' / ' + (Math.round((toHour - DAY_START) * SLOTS_PER_HOUR) + 1) + ';grid-column:1 / -1';
    };
    var fixed = '';
    if (lane.indexOf(i) < 0) {
      fixed += '<div class="fixed is-off" style="grid-row:1 / -1;grid-column:1 / -1" title="' + esc(res.desk_rules.lane_note || 'No new scopes are offered on this day.') + '"><span>Not a ' + esc(res.name) + ' day</span></div>';
    }
    if (i === 0 && res.desk_rules.monday_from > DAY_START) {
      fixed += '<div class="fixed" style="' + span(DAY_START, res.desk_rules.monday_from) + '"><span>Not available before ' + res.desk_rules.monday_from + ':00</span></div>';
    }
    var band = res.desk_rules.protected_band;
    if (band && band.day === i) {
      fixed += '<div class="fixed is-band" style="' + span(band.from, band.to) + '"><span>' + esc(band.label) + ' · ' + esc(band.note) + '</span></div>';
    }
    return '<div class="wkcol' + (i === selected ? ' is-day' : '') + '" data-week-day="' + i + '" role="group" aria-label="' + esc(longDate(addDays(state.weekStart, i))) + '"' +
      ' style="grid-column:' + (i + 2) + ';grid-template-columns:repeat(' + columns + ',minmax(0,1fr))">' +
      fixed + renderFreeBands(addDays(state.weekStart, i)) + cards.map(function (card) { return renderDayEvent(card, columns, 1); }).join('') + '</div>';
  }

  // The chosen lead's free times on one day, as green bands to tap. Only the
  // server's windows are drawn; a day it sent none for shows none.
  function renderFreeBands(date) {
    var c = selectedCase();
    if (!canTapFreeTime(c)) return '';
    var pick = state.ownerVisits[draftKey(c)];
    var picked = freePickWindow(pick);
    var rows = function (fromIso, toIso) {
      var a = slotOf(fromIso, false), z = slotOf(toIso, true);
      return a == null || z == null || z <= a ? null : 'grid-row:' + (a + 1) + ' / ' + (z + 1) + ';grid-column:1 / -1';
    };
    return freeBands(c, date).map(function (band, bi) {
      var at = rows(band[0].from_iso, band[band.length - 1].end_iso);
      if (!at) return '';
      var first = band[0], last = band[band.length - 1];
      var words = band.length === 1 ? 'Free, arrive ' + timeRange(first.from_iso, first.to_iso) : 'Free, arrive from ' + clockLabel(hourFromIso(first.from_iso)) + ' to ' + clockLabel(hourFromIso(last.from_iso));
      var on = picked && band.some(function (w) { return w.from_iso === picked.from_iso; });
      var mark = on ? '<span class="ev-freepick">Picked: arrive ' + esc(timeRange(picked.from_iso, picked.to_iso)) + '</span>' : '';
      return '<button type="button" class="ev-free' + (on ? ' is-on' : '') + '" data-free-band="' + bi + '" data-case-id="' + esc(c.id) + '" data-date="' + esc(date) + '" style="' + at + '"' +
        ' aria-label="' + esc(words + ' on ' + longDate(date) + '. Tap to pick this time for ' + (c.display_name || 'this lead') + '.') + '">' +
        '<span class="ev-freewords">' + esc(words) + '</span>' + mark + '</button>';
    }).join('');
  }

  // The week sits in the middle, Monday to Friday. On a phone it is one day at
  // a time, chosen from the day strip.
  function renderWeek() {
    if (!state.data) return '<section class="bk-week" aria-label="The week"><div class="weekhead"><h2>The week</h2></div><div class="day-sk" aria-hidden="true"></div></section>';
    var res = resource();
    var d = dayIndex();
    var lane = deskDays(res);
    var today = perthTodayIso();
    var picker = '<div class="daypick" role="group" aria-label="Choose a day">' + DAYS.map(function (name, i) {
      var off = lane.indexOf(i) < 0;
      return '<button type="button" data-booking-day="' + i + '" aria-pressed="' + (i === d) + '"' + (off ? ' class="is-off" title="Not a ' + esc(res.name) + ' day"' : '') + '>' + name.slice(0, 3) + '<b>' + Number(addDays(state.weekStart, i).slice(8, 10)) + '</b></button>';
    }).join('') + '</div>';
    var head = '<div class="weekhead"><h2>Week of ' + esc(shortDate(state.weekStart).replace(/^\w+ /, '')) + '</h2>' +
      '<p class="fine">' + esc(res.name) + ' · ' + esc(res.desk_rules.hours) + '</p>' + picker +
      '<h3 class="dayname">' + esc(longDate(addDays(state.weekStart, d))) + '</h3></div>';
    if (calendarUnread(state.data)) {
      var read = calendarReadState(state.data);
      return '<section class="bk-week" aria-label="The week">' + head + '<div class="dayunread"><h3>' + (read.state === 'not_configured' ? 'Calendar not set up' : 'Could not read calendar') + '</h3><p>' + esc(read.reason || '') + '</p><p>Free times are unknown. A calendar that could not be read is never shown as free.</p></div></section>';
    }
    var slots = (DAY_END - DAY_START) * SLOTS_PER_HOUR;
    var headers = DAYS.map(function (name, i) {
      var iso = addDays(state.weekStart, i);
      var off = lane.indexOf(i) < 0;
      var isToday = iso === today;
      return '<div class="wkday' + (off ? ' is-off' : '') + (isToday ? ' is-today' : '') + '" style="grid-column:' + (i + 2) + '">' +
        '<span>' + name.slice(0, 3) + (isToday ? ' · today' : '') + '</span><b>' + Number(iso.slice(8, 10)) + '</b></div>';
    }).join('');
    var hours = '';
    for (var h = DAY_START; h < DAY_END; h++) {
      var row = (h - DAY_START) * SLOTS_PER_HOUR + 2;
      hours += '<div class="hourline" style="grid-row:' + row + ' / ' + (row + SLOTS_PER_HOUR) + '"></div>' +
        '<div class="hour" style="grid-row:' + row + ' / ' + (row + SLOTS_PER_HOUR) + '"><span>' + clockLabel(h).replace(':00', '') + '</span></div>';
    }
    var perDay = DAYS.map(function (name, i) { return dayCards(i); });
    var days = perDay.map(function (cards, i) { return renderWeekDay(res, i, d, lane, cards); }).join('');
    var empty = perDay.every(function (cards) { return !cards.length; })
      ? '<p class="weekempty">Nothing in the calendar this week.</p>' : '';
    // A day with overlapping entries gets more width so side-by-side entries
    // keep whole words; an empty day that is not a working day gets less.
    var widths = perDay.map(function (cards, i) {
      var lanes = 1;
      cards.forEach(function (card) { lanes = Math.max(lanes, card.block.lanes || 1); });
      var w = (!cards.length && lane.indexOf(i) < 0 ? 0.6 : 1) + 0.6 * (lanes - 1);
      return 'minmax(0,' + Math.min(2.8, w).toFixed(1) + 'fr)';
    });
    return '<section class="bk-week" aria-label="The week">' + head + empty +
      '<div class="weekgrid" style="grid-template-columns:42px ' + widths.join(' ') + ';grid-template-rows:auto repeat(' + slots + ',minmax(15px,auto))">' + headers + hours + days + '</div>' +
      '<p class="daykey"><span class="src src-ghl">GHL</span><span class="src src-outlook">Outlook</span> shows where each entry lives. Dashed means proposed, not booked. Leave is not read, so empty is not the same as free.</p></section>';
  }

  // ---- page --------------------------------------------------------------------
  function renderHead() {
    var res = resource();
    var route = resolveSender(res);
    var scopers = V1_SCOPERS.map(function (id) {
      return '<button type="button" data-booking-resource-btn="' + id + '" aria-pressed="' + (id === state.resourceId) + '">' + esc(RESOURCES[id].name) + '</button>';
    }).join('');
    var atStart = state.weekStart <= currentPerthWeek();
    var refreshed = state.loading ? 'Refreshing…' : state.lastFreshAt ? 'Updated ' + whenWords(state.lastFreshAt).split(', ')[1] : '';
    return '<header class="bk-head"><div class="bk-title"><h1>Build the week</h1>' +
      '<p>' + esc(res.name) + ' · ' + esc(res.lane === 'patio' ? 'patios' : 'fencing') + (res.desk_rules.days ? ' · ' + esc(res.desk_rules.days.map(function (i) { return DAYS[i].slice(0, 3); }).join(' and ')) : '') +
      ' · texts from ' + esc(route.resolved ? phoneEnding(route.number) : 'an unresolved line') + '</p></div>' +
      '<div class="bk-controls"><div class="seg" role="group" aria-label="Whose bookings">' + scopers + '</div>' +
      '<div class="weeknav" role="group" aria-label="Week"><button type="button" class="iconbtn" data-booking-week="-7" aria-label="Previous week"' + (atStart ? ' disabled' : '') + '>' + icon('left') + '</button>' +
      '<span>Week of ' + esc(shortDate(state.weekStart).replace(/^\w+ /, '')) + '</span>' +
      '<button type="button" class="iconbtn" data-booking-week="7" aria-label="Next week">' + icon('right') + '</button></div>' +
      '<button type="button" class="refresh" data-booking-refresh' + (state.loading ? ' aria-busy="true"' : '') + '>' + icon('refresh') + '<span>' + (state.loading ? 'Refreshing' : 'Refresh') + '</span></button>' +
      (refreshed && !state.loading ? '<span class="fresh">' + esc(refreshed) + '</span>' : '') + '</div></header>';
  }

  function renderHTML() {
    if (!state.resourceId) {
      return '<div class="bk"><header class="bk-head"><div class="bk-title"><h1>Booking</h1><p>Your account is not matched to a scoper. Choose whose bookings to open.</p></div>' +
        '<div class="bk-controls"><div class="seg" role="group" aria-label="Whose bookings">' + V1_SCOPERS.map(function (id) { return '<button type="button" data-booking-resource-btn="' + id + '">' + esc(RESOURCES[id].name) + '</button>'; }).join('') + '</div></div></header></div>';
    }
    var problem = readProblem();
    var loadingLine = state.loading && !state.data ? '<p class="bk-loading" role="status">Reading GHL and the calendar. This can take up to a minute.</p>'
      : state.loading && state.stale ? '<p class="bk-loading" role="status">Refreshing. The last good read stays on screen until the new one lands.</p>' : '';
    return '<div class="bk' + (state.selectedId ? ' is-open' : '') + '">' + renderHead() + renderCounts() +
      (problem ? '<p class="bk-alert" role="alert">' + esc(problem) + '</p>' : '') + loadingLine + renderDetails() +
      '<div class="bk-main">' + (state.selectedId ? '<button type="button" class="back" data-booking-back>' + icon('left') + 'All leads</button>' : '') +
      renderList() + renderWeek() + renderCard() + '</div></div>';
  }

  function captureFocus(el) {
    var doc = global.document;
    var active = doc && doc.activeElement;
    if (!active || !el.contains(active) || !active.getAttribute) return null;
    var key = active.getAttribute('data-focus-key');
    if (!key) return null;
    var keep = { key: key, scroll: active.scrollTop };
    try { keep.start = active.selectionStart; keep.end = active.selectionEnd; } catch (e) { /* not a text field */ }
    return keep;
  }

  function restoreFocus(el, keep) {
    if (!keep) return;
    if (keep.key && keep.key.indexOf('draft-') === 0 && composeBusy(selectedCase())) return;
    var next = el.querySelector('[data-focus-key="' + keep.key + '"]');
    if (!next) return;
    try { next.focus({ preventScroll: true }); } catch (e) { next.focus(); }
    try { if (keep.start != null) next.setSelectionRange(keep.start, keep.end); } catch (e) { /* not a text field */ }
    next.scrollTop = keep.scroll || 0;
  }

  function render() {
    var el = root();
    if (!el) return;
    var keep = captureFocus(el);
    try {
      el.innerHTML = renderHTML();
    } catch (err) {
      el.innerHTML = '<p class="bk-alert" role="alert">The booking screen could not be drawn: ' + esc(err && err.message ? err.message : err) + '</p>';
    }
    restoreFocus(el, keep);
    var view = global.document.getElementById('viewSales');
    if (view) {
      view.classList.toggle('sales-sub-booking', state.subtab === 'booking');
      view.classList.toggle('sales-sub-performance', state.subtab === 'performance');
    }
  }

  // Search repaints only the list, so the search box keeps focus and caret.
  function renderListOnly() {
    var el = root();
    var body = el && el.querySelector('[data-booking-list-body]');
    if (!body) return render();
    body.innerHTML = renderListBody();
  }

  // Typing in the text box repaints only its footer, so the caret stays put and
  // the approval on screen always matches the words on screen.
  function renderComposeOnly() {
    var el = root();
    var c = selectedCase();
    var foot = el && el.querySelector('[data-booking-compose-foot]');
    if (!foot || !c) return render();
    if (decisionModel(c)) state.shownApprovals[approvalKey(c, 'message')] = approvalSnapshot(c, 'message');
    foot.innerHTML = renderComposeFoot(c);
  }

  // ---- the owner's own text or visit (owner-authored-v1) --------------------------
  // What the owner wrote, or the day and arrival window he picked, is checked on
  // the server first (dry_run), shown back exactly as the server built it, then
  // approved with that check's prepared_at and content_hash, then sent or booked.
  // Contract: backend docs/sales-booking-confirmation-api.md "Owner-authored
  // approvals". The engine path above is unchanged and still takes its own
  // unedited proposal.
  var OWNER_VERSION = 'owner-authored-v1';
  var OWNER_PREVIEW_MS = 15 * 60000;
  var OWNER_TEXT_MAX = 1600;
  var WEEKDAY_NAMES = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };

  function ownerFlow() {
    var flow = state.data && state.data.booking_flow;
    return flow && flow.owner_approval_write === OWNER_VERSION ? flow : null;
  }

  function ownerBooking(c) {
    var ob = c && c.owner_booking;
    return ob && ob.version === OWNER_VERSION ? ob : null;
  }

  function ownerRulebook(c) {
    var ob = ownerBooking(c), flow = ownerFlow();
    return (ob && ob.rulebook) || (flow && flow.owner_rulebook) || null;
  }

  // The engine's own template, unedited and pressable, stays on the engine path
  // exactly as before. A picked time, or anything else the owner writes, goes
  // the owner's way so a sent text can hold that slot. A read that does not
  // offer the owner's way leaves the screen as it was.
  function messagePath(c) {
    if (!ownerFlow()) return 'engine';
    if (ownerVisit(c)) return 'owner';
    var m = decisionModel(c);
    if (m && editedText(c) == null && m.message && m.message.template_locked && m.message.text && approvalBlock(c, 'message', false, true) === '') return 'engine';
    return 'owner';
  }

  function hasEngineProposal(c) {
    var m = decisionModel(c);
    return !!(m && m.proposal);
  }

  function ownerCanPick(c) {
    var ob = ownerBooking(c);
    return !!(ownerFlow() && ob && ob.eligible === true && ownerRulebook(c));
  }

  // A proposed time stays the default shown first, on the engine path exactly
  // as before. Every Stratco card also offers Pick a different time, so a
  // blocked or unwanted proposal is never the only time on that card.
  function calendarPath(c) {
    if (!ownerFlow()) return 'engine';
    return hasEngineProposal(c) && !state.ownerPickOpen[draftKey(c)] ? 'engine' : 'owner';
  }

  function renderPickOther(c) {
    if (!ownerCanPick(c) || composeBusy(c)) return '';
    return '<p class="pickother"><button type="button" class="linklike" data-owner-pick-open data-case-id="' + esc(c.id) + '">Pick a different time</button></p>';
  }

  function minutesOf(clock) {
    var m = String(clock || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function clockOf(minutes) {
    return pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);
  }

  function weekdayOf(date) {
    var p = String(date || '').split('-').map(Number);
    if (p.length !== 3 || !p[0]) return null;
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }

  // Arrival times the rulebook allows on that day, every 30 minutes: from the
  // day start, the visit over by the day end, clear of a protected band with
  // travel either side. The server checks the same rules again at the press.
  function ownerStarts(rb, date, minutes) {
    var from = minutesOf(rb.day_start), to = minutesOf(rb.day_end);
    var visit = Number(rb.visit_minutes), gap = Number(rb.travel_buffer_minutes) || 0;
    if (from == null || to == null || !(visit > 0) || !(minutes > 0)) return [];
    var day = date ? weekdayOf(date) : null, out = [];
    for (var t = from; t + minutes + visit <= to; t += 30) {
      var end = t + minutes + visit;
      var banned = day && (rb.protected_bands || []).some(function (b) {
        var bs = minutesOf(b.start), be = minutesOf(b.end);
        return b.weekday === day && bs != null && be != null && t - gap < be && bs < end + gap;
      });
      if (!banned) out.push(clockOf(t));
    }
    return out;
  }

  function ownerWindows(rb) {
    var out = [], lo = Number(rb.window_min_minutes), hi = Number(rb.window_max_minutes);
    for (var n = lo; n > 0 && n <= hi; n += 30) out.push(n);
    return out;
  }

  function ownerPick(c) {
    var key = draftKey(c), rb = ownerRulebook(c);
    if (!state.ownerVisits[key]) state.ownerVisits[key] = { date: '', start: '', minutes: rb ? Number(rb.window_max_minutes) : 90 };
    return state.ownerVisits[key];
  }

  // The picked visit as the contract's {window_start_iso, window_end_iso,
  // end_iso} in Perth time, or null until a day and an arrival time are chosen
  // that the rulebook allows. The visit runs visit_minutes past the latest arrival.
  function ownerVisit(c) {
    var rb = ownerRulebook(c), pick = rb && state.ownerVisits[draftKey(c)];
    if (!pick || !pick.date || !pick.start || rb.utc_offset !== '+08:00') return null;
    var minutes = Number(pick.minutes);
    // A tapped free time is the server's own arrival window, used exactly as
    // sent (its end_iso already carries the on-site time). The press checks it again.
    var free = freePickWindow(pick);
    if (free) {
      if ((rb.bookable_dates || []).indexOf(pick.date) < 0 || ownerWindows(rb).indexOf(minutes) < 0) return null;
      return { window_start_iso: free.from_iso, window_end_iso: free.to_iso, end_iso: free.end_iso };
    }
    if ((rb.bookable_dates || []).indexOf(pick.date) < 0 || ownerWindows(rb).indexOf(minutes) < 0 || ownerStarts(rb, pick.date, minutes).indexOf(pick.start) < 0) return null;
    var s = minutesOf(pick.start);
    function at(mins) { return pick.date + 'T' + clockOf(mins) + ':00+08:00'; }
    return { window_start_iso: at(s), window_end_iso: at(s + minutes), end_iso: at(s + minutes + Number(rb.visit_minutes)) };
  }

  // ---- free times: tap one to pick the visit --------------------------------------
  // The server's arrival windows for this lead (case.free_times, backend
  // docs/sales-booking-live-availability.md): 60-minute windows starting on a
  // five-minute grid, each with the end_iso of its 30 minutes on site. The
  // screen never works a time out itself; a tap only chooses one of these.
  function leadFreeWindows(c, date) {
    var ft = c && c.free_times;
    if (!ft || !Array.isArray(ft.days)) return [];
    var day = ft.days.filter(function (d) { return d && d.date === date; })[0];
    if (!day || !Array.isArray(day.arrival_windows)) return [];
    return day.arrival_windows.filter(function (w) {
      return w && String(w.from_iso || '').slice(0, 10) === date && !isNaN(Date.parse(w.from_iso)) && !isNaN(Date.parse(w.to_iso)) && !isNaN(Date.parse(w.end_iso));
    }).sort(function (a, b) { return Date.parse(a.from_iso) - Date.parse(b.from_iso); });
  }

  // Windows five minutes apart are one run of free time, painted as one band.
  function freeBands(c, date) {
    var bands = [], last = null;
    leadFreeWindows(c, date).forEach(function (w) {
      var t = Date.parse(w.from_iso);
      if (last != null && t - last <= 5 * 60000) bands[bands.length - 1].push(w);
      else bands.push([w]);
      last = t;
    });
    return bands;
  }

  // The window a tap chose: the latest one whose arrival starts at or before
  // the tapped point (0 = top of the band, 1 = bottom).
  function freeWindowAt(band, fraction) {
    if (!band || !band.length) return null;
    var a = Date.parse(band[0].from_iso), z = Date.parse(band[band.length - 1].end_iso);
    var t = a + Math.max(0, Math.min(1, Number(fraction) || 0)) * (z - a);
    var best = band[0];
    band.forEach(function (w) { if (Date.parse(w.from_iso) <= t) best = w; });
    return best;
  }

  function windowMinutes(w) {
    return Math.round((Date.parse(w.to_iso) - Date.parse(w.from_iso)) / 60000);
  }

  function freePickWindow(pick) {
    var w = pick && pick.free;
    if (!w) return null;
    return pick.date === String(w.from_iso).slice(0, 10) && pick.start === String(w.from_iso).slice(11, 16) && Number(pick.minutes) === windowMinutes(w) ? w : null;
  }

  function canTapFreeTime(c) {
    return !!(c && ownerCanPick(c) && !pickerBusy(c) && !bookedElsewhere(c));
  }

  function pickFreeWindow(c, w) {
    var key = draftKey(c);
    state.ownerVisits[key] = { date: String(w.from_iso).slice(0, 10), start: String(w.from_iso).slice(11, 16), minutes: windowMinutes(w), free: { from_iso: w.from_iso, to_iso: w.to_iso, end_iso: w.end_iso } };
    state.ownerPickOpen[key] = true;
    delete state.approvalErrors[approvalKey(c, 'calendar')];
    delete state.approvalErrors[approvalKey(c, 'message')];
    rewriteTextForPick(c);
  }

  // The text for a picked visit: the day and the arrival window, in words.
  function pickedVisitText(c, v) {
    var res = resource();
    // The business name the text is signed with is the line it goes from
    // (SecureWorks Group Ops 776 -> SecureWorks Group).
    var line = String(res.sender_label || '').replace(/\s+\d+$/, '').replace(/\s+(Ops|Sales)$/, '');
    var lane = /^SecureWorks /.test(line) ? line : res.lane === 'patio' ? 'SecureWorks Patios' : 'SecureWorks Fencing';
    var first = String(c.display_name || '').trim().split(/\s+/)[0] || 'there';
    var s = hourFromIso(v.window_start_iso), e = hourFromIso(v.window_end_iso);
    var sameHalf = (s >= 12) === (e >= 12);
    return 'Hi ' + first + ', it is ' + res.name + ' from ' + lane + '. I can come out to ' + (caseSuburb(c) || 'your place') +
      ' on ' + longDate(v.window_start_iso) + ', arriving between ' + clockLabel(s, !sameHalf) + ' and ' + clockLabel(e) + ', to measure and quote. Does that suit?';
  }

  // Picking a visit rewrites the text's day and time to match. Words the owner
  // typed himself are never overwritten: he is offered the rewrite instead.
  function rewriteTextForPick(c) {
    var v = ownerVisit(c);
    if (!v) return;
    var d = draftFor(c);
    var next = pickedVisitText(c, v);
    var typed = d.humanEdited && typeof d.text === 'string' && d.text !== d.autoText;
    if (typed && d.text !== next) { d.rewrite = next; return; }
    d.text = next;
    d.autoText = next;
    d.rewrite = null;
    d.humanEdited = true;
    d.revision = (d.revision || 0) + 1;
    d.sender = resolveSender().number;
  }

  function pendingRewrite(c) {
    var d = c && state.drafts[draftKey(c)];
    var v = ownerVisit(c);
    if (!d || !d.rewrite || !v || d.rewrite !== pickedVisitText(c, v) || d.text === d.rewrite) return null;
    return d.rewrite;
  }

  function ownerInput(c, kind) {
    var input = { step: kind, case_id: c.id, contact_id: c.contact_id, week_start: state.weekStart, resource: 'marnin' };
    if (kind === 'message') {
      input.text = composeText(c);
      var offer = ownerVisit(c);
      if (offer) input.offer = offer;
    } else {
      input.visit = ownerVisit(c);
    }
    return input;
  }

  function visitWords(v, long) {
    if (!v || !v.window_start_iso) return '';
    return (long ? longDate(v.window_start_iso) : shortDate(v.window_start_iso)) + ', arrive ' + timeRange(v.window_start_iso, v.window_end_iso);
  }

  function ownerTargets(content) {
    return [CALENDAR_NAMES[content && content.calendar_id] || 'GHL calendar', 'Marnin\'s Outlook'];
  }

  function ownerBlock(c, kind) {
    var verb = kind === 'calendar' ? 'booked' : 'sent';
    if (bookedElsewhere(c)) return bookedElsewhereBlock(c);
    if (state.loading) return 'Reading the latest list. Wait a moment.';
    if (state.stale || state.error) return 'This list may be out of date. Press Refresh first.';
    var ob = ownerBooking(c);
    if (!ownerFlow() || !ob) return kind === 'calendar' ? 'Booking a time you pick is not connected yet, so nothing can be booked from here.' : 'Sending your own text is not connected yet, so nothing can be sent from here.';
    if (!state.data.resource || state.data.resource.id !== state.resourceId || state.data.week_start !== state.weekStart) return 'This list belongs to another person or week. Press Refresh.';
    if (state.resourceId !== 'marnin' || ob.reason === 'stratco_profile_required') return 'Only Marnin\'s Stratco leads can be approved here for now.';
    if (!c.contact_id) return 'This lead has no GHL contact, so nothing can be ' + verb + ' from here.';
    if (ob.eligible !== true) return 'This GHL contact appears more than once. Sort it out in GHL first.';
    if (kind === 'message') {
      var text = composeText(c);
      if (!String(text || '').trim()) return 'Write the text first.';
      if (/[\u2013\u2014]/.test(text)) return 'Take out the long dash. Texts to clients never use one.';
      if (text.length > OWNER_TEXT_MAX) return 'The text is too long. Keep it to ' + OWNER_TEXT_MAX + ' characters.';
      return '';
    }
    if (!ownerRulebook(c)) return 'The booking rules did not come with this list. Press Refresh.';
    var v = ownerVisit(c);
    if (!v) return 'Pick a day and an arrival time first.';
    var clash = clashForSpan(c, v.window_start_iso, v.end_iso, null, true);
    return clash ? clashSentence(clash) : '';
  }

  function ownerPressBlock(c, kind) {
    var key = approvalKey(c, kind);
    if (state.pressPending[key]) return kind === 'calendar' ? 'Booking…' : 'Sending…';
    if (state.approvalPending[key]) return 'Checking with the server…';
    var last = state.pressResults[key];
    if (last && last.uncertain) return 'The last press has no confirmed result. Check GHL, then press Refresh.';
    if (last && last.done && last.input && sameContent(last.input, ownerInput(c, kind))) return kind === 'calendar' ? 'Already booked.' : 'Already sent.';
    return ownerBlock(c, kind);
  }

  // The server's snapshot must be the exact thing the owner asked for, bound by
  // the same content hash the browser computes, before it is shown as checked.
  function ownerSnapshotMatches(snap, input, kind) {
    if (!snap || typeof snap !== 'object' || snap.source !== 'owner' || snap.version !== OWNER_VERSION || snap.step !== kind) return false;
    if (snap.case_id !== input.case_id || snap.contact_id !== input.contact_id || typeof snap.prepared_at !== 'string' || !isFinite(Date.parse(snap.prepared_at))) return false;
    var ct = snap.content;
    if (!ct || typeof ct !== 'object') return false;
    if (kind === 'message') {
      return ct.text === input.text && typeof ct.sender === 'string' && !!ct.sender && typeof ct.recipient === 'string' && !!ct.recipient && sameContent(ct.offer || null, input.offer || null);
    }
    var v = input.visit || {};
    return ct.start_iso === v.window_start_iso && ct.window_start_iso === v.window_start_iso && ct.window_end_iso === v.window_end_iso && ct.end_iso === v.end_iso && !!ct.title && !!ct.address && !!ct.calendar_id;
  }

  function ownerErrorWords(kind, err) {
    var code = String((err && err.message) || err || '');
    var none = 'nothing was ' + (kind === 'calendar' ? 'booked' : 'sent') + '.';
    if (isUnknownAction(err) || code === 'owner_approval_unavailable' || code === 'owner_input_requires_owner_path') {
      return (kind === 'calendar' ? 'Booking a time you pick' : 'Sending your own text') + ' is not connected on the server yet, so ' + none;
    }
    if (/^[a-z0-9_:]+$/.test(code)) return (kind === 'calendar' ? 'Not booked: ' : 'Not sent: ') + refusalWords(code, err && err.detail);
    return code || 'The check did not go through, so ' + none + ' Press Refresh before trying again.';
  }

  // Press one: the server checks the exact text or visit and builds what would
  // be approved. Nothing is recorded, sent or booked.
  async function ownerCheck(id, kind) {
    var c = cases().filter(function (row) { return row.id === id; })[0];
    if (!c || !ACTIONS[kind]) return { ok: false, reason: 'no_case' };
    var key = approvalKey(c, kind);
    var block = ownerPressBlock(c, kind);
    if (block) { state.approvalErrors[key] = block; render(); return { ok: false, reason: block }; }
    var input = ownerInput(c, kind);
    var verb = kind === 'calendar' ? 'booked' : 'sent';
    state.approvalPending[key] = true;
    delete state.approvalErrors[key];
    delete state.pressResults[key];
    delete state.ownerPreviews[key];
    render();
    try {
      if (typeof global.opsPost !== 'function') throw new Error('Unknown action');
      var res = await global.opsPost('sales_booking_approval_write', { owner_input: input, dry_run: true });
      var snap = res && res.snapshot;
      if (!res || res.ok !== true || res.dry_run !== true || !ownerSnapshotMatches(snap, input, kind) || typeof res.content_hash !== 'string' || snap.content_hash !== res.content_hash || bookingContentHash(snap) !== res.content_hash) {
        throw new Error('The server did not confirm the check, so ' + 'nothing was ' + verb + '. Press Refresh before trying again.');
      }
      if (!sameContent(ownerInput(c, kind), input)) throw new Error('This changed while it was being checked. Check it again.');
      state.ownerPreviews[key] = { input: input, snapshot: snap, content_hash: res.content_hash, checks: res.checks || {} };
      return { ok: true, preview: state.ownerPreviews[key] };
    } catch (err) {
      state.approvalErrors[key] = ownerErrorWords(kind, err);
      return { ok: false, reason: state.approvalErrors[key] };
    } finally {
      delete state.approvalPending[key];
      render();
    }
  }

  // Press two: approve exactly what the check showed (its prepared_at and
  // content_hash), then send or book with that approval, then say what happened.
  async function ownerApprove(id, kind) {
    var c = cases().filter(function (row) { return row.id === id; })[0];
    var key = c && approvalKey(c, kind);
    var preview = key && state.ownerPreviews[key];
    if (!c || !preview || !ACTIONS[kind]) return { ok: false, reason: 'no_check' };
    if (state.approvalPending[key] || state.pressPending[key]) return { ok: false, reason: 'pending' };
    var verb = kind === 'calendar' ? 'booked' : 'sent';
    var stop = bookedElsewhere(c) ? bookedElsewhereBlock(c)
      : state.loading ? 'Reading the latest list. Wait a moment.'
      : (state.stale || state.error) ? 'This list may be out of date. Press Refresh first.'
      : !sameContent(ownerInput(c, kind), preview.input) ? 'This changed after it was checked. Check it again.'
      : !(Date.now() - Date.parse(preview.snapshot.prepared_at) < OWNER_PREVIEW_MS) ? 'That check is more than 15 minutes old. Check it again.'
      : '';
    if (stop) {
      if (!state.loading && !state.stale && !state.error) delete state.ownerPreviews[key];
      state.approvalErrors[key] = stop;
      render();
      return { ok: false, reason: stop };
    }
    state.approvalPending[key] = true;
    delete state.approvalErrors[key];
    render();
    var approvalId = null;
    try {
      if (typeof global.opsPost !== 'function') throw new Error('Unknown action');
      var res = await global.opsPost('sales_booking_approval_write', {
        owner_input: Object.assign({}, preview.input, { prepared_at: preview.snapshot.prepared_at }),
        decision: 'approved', reason: null, content_hash: preview.content_hash
      });
      var a = res && res.approval;
      if (!res || res.ok !== true || !a || a.state !== 'approved' || !sameContent(a.snapshot, preview.snapshot)) throw new Error('The server did not confirm your approval, so nothing was ' + verb + '. Press Refresh before trying again.');
      approvalId = res.approval_id || a.binding_hash || a.id || null;
      if (!approvalId) throw new Error('Your approval is recorded, but the server gave it no reference, so nothing was ' + verb + '.');
      if (!sameContent(ownerInput(c, kind), preview.input)) throw new Error('This changed after it was checked. Check it again.');
    } catch (err) {
      delete state.ownerPreviews[key];
      delete state.approvalPending[key];
      state.approvalErrors[key] = ownerErrorWords(kind, err);
      render();
      return { ok: false, reason: state.approvalErrors[key] };
    }
    delete state.approvalPending[key];
    state.approvalIds[key] = { id: approvalId, snapshot: preview.snapshot };
    state.pressPending[key] = true;
    render();
    var result;
    try {
      var out = await global.opsPost(ACTIONS[kind], { approval_id: approvalId });
      result = describeResult(kind, out, c, preview.snapshot);
    } catch (err) {
      result = isUnknownAction(err)
        ? { tone: 'info', snapshot: preview.snapshot, notConnected: true, text: (kind === 'calendar' ? 'Booking' : 'Sending') + ' from this screen is not connected yet. Your approval is recorded; nothing was ' + verb + '.' }
        : { tone: 'bad', uncertain: true, snapshot: preview.snapshot, text: 'No confirmed result: ' + String((err && err.message) || err) + '. Check GHL before pressing again.' };
    } finally {
      delete state.pressPending[key];
    }
    result.input = preview.input;
    delete state.ownerPreviews[key];
    state.pressResults[key] = result;
    if (result.done) rememberOccupancy(c, result);
    render();
    return { ok: !!result.done, result: result };
  }

  function occupancyVisit(result) {
    var ct = result && result.snapshot && result.snapshot.content || {};
    var offer = ct.offer;
    if (offer && offer.window_start_iso && offer.end_iso) return { start: offer.window_start_iso, end: offer.end_iso, title: null, book: false };
    if (ct.window_start_iso && ct.end_iso) return { start: ct.window_start_iso, end: ct.end_iso, title: ct.title || null, book: result.snapshot.step === 'calendar' };
    if (ct.start_iso && ct.end_iso) return { start: ct.start_iso, end: ct.end_iso, title: ct.title || null, book: result.snapshot.step === 'calendar' };
    return null;
  }

  function rememberOccupancy(c, result) {
    if (!result || !result.done || !c || !state.data) return;
    var visit = occupancyVisit(result);
    if (!visit || !(Date.parse(visit.end) > Date.parse(visit.start))) return;
    if (visit.book) rememberBookedVisit(c, visit);
    else rememberOfferedVisit(c, visit);
    state.ownerOccupancy.push({ resource: state.resourceId, at: Date.now(), visit: visit,
      c: { id: c.id, contact_id: c.contact_id, opportunity_id: c.opportunity_id, display_name: c.display_name, suburb: c.suburb } });
    quietReload();
  }

  // A fresh read may not show a booking or offer made seconds ago yet, so what
  // this screen just did stays on the day and in the clash checks until the
  // read carries it (at most 30 minutes). The slot never reads as free.
  function reapplyOwnerOccupancy() {
    var now = Date.now();
    state.ownerOccupancy = state.ownerOccupancy.filter(function (o) { return now - o.at < 30 * 60000; });
    if (!state.data) return;
    state.ownerOccupancy.forEach(function (o) {
      if (o.resource !== state.resourceId) return;
      if (o.visit.book) rememberBookedVisit(o.c, o.visit);
      else rememberOfferedVisit(o.c, o.visit);
    });
  }

  function readParams() {
    return { resource: state.resourceId, week_start: state.weekStart, scoper_user_id: resource().scoper_user_id, visit_outcomes_from: new Date(Date.now() - 7 * 86400000).toISOString(), visit_outcomes_to: new Date().toISOString() };
  }

  // After a book or an offer: read again with no spinner and no locked
  // buttons. A failed or overtaken quiet read changes nothing on screen.
  async function quietReload() {
    var request = state.request, resourceId = state.resourceId, weekStart = state.weekStart;
    if (!resourceId || state.loading) return;
    try {
      var data = await bookingRead(readParams());
      if (request !== state.request || resourceId !== state.resourceId || weekStart !== state.weekStart || state.loading) return;
      if (!data || data.ok === false || data.fixture || !payloadMatchesRequest(data, resourceId, weekStart)) return;
      if (Object.keys(state.approvalPending).length || Object.keys(state.pressPending).length) return;
      state.data = data;
      state.cache[cacheKey(resourceId, weekStart)] = data;
      state.stale = false;
      state.error = null;
      state.lastFreshAt = Date.now();
      state.readKind = 'fresh';
      reapplyOwnerOccupancy();
      applyServerStamp(data);
      applyServerDrafts(data);
      render();
    } catch (e) { /* quiet: the remembered occupancy stays on screen */ }
  }

  function rememberBookedVisit(c, visit) {
    var data = state.data;
    if (!Array.isArray(data.diary)) data.diary = [];
    var title = visit.title && /^scope:\s*/i.test(visit.title) ? visit.title
      : ('Scope: ' + (c.display_name || 'visit') + (c.suburb ? ', ' + c.suburb : ''));
    if (data.diary.some(function (ev) {
      return (ev.contact_id && ev.contact_id === c.contact_id && (ev.start === visit.start || ev.start_iso === visit.start))
        || (ev.start === visit.start && ev.end === visit.end && ev.title === title);
    })) return;
    data.diary.push({
      event_id: 'owner-booked-' + (c.contact_id || c.id) + '-' + visit.start,
      contact_id: c.contact_id,
      opportunity_id: c.opportunity_id || c.id,
      start: visit.start,
      end: visit.end,
      title: title,
      kind: 'busy',
      source: 'ghl_calendar',
      blocks_capacity: true
    });
  }

  function rememberOfferedVisit(c, visit) {
    var flow = state.data.booking_flow;
    if (!flow) return;
    if (!Array.isArray(flow.commitments)) flow.commitments = [];
    if (flow.commitments.some(function (s) {
      return s.contact_id === c.contact_id && s.start_iso === visit.start && s.end_iso === visit.end;
    })) return;
    flow.commitments.push({
      id: 'owner-offer-' + (c.contact_id || c.id) + '-' + visit.start,
      contact_id: c.contact_id,
      state: 'offered',
      start_iso: visit.start,
      end_iso: visit.end
    });
  }

  // Busy while a check is open or anything is in flight, so the words and the
  // picked time on screen stay the ones that were checked.
  function pickerBusy(c) {
    return composeBusy(c) || !!state.ownerPreviews[approvalKey(c, 'calendar')];
  }

  function ownerCheckList(kind, checks, rb) {
    checks = checks || {};
    var ok = [], warn = [];
    if (checks.thread && checks.thread.read) ok.push('Not already in this conversation (' + plural(Number(checks.thread.messages) || 0, 'message') + ' read).');
    if (checks.ghl) ok.push('GHL is clear, with ' + ((checks.occupied && checks.occupied.travel_buffer_minutes) || (rb && rb.travel_buffer_minutes) || 30) + ' minutes travel either side' + (checks.ghl.events_that_day != null ? ' (' + plural(Number(checks.ghl.events_that_day), 'other booking') + ' that day)' : '') + '.');
    if (checks.outlook) ok.push('Outlook is clear' + (checks.outlook.mailbox ? ' (' + checks.outlook.mailbox + ')' : '') + '.');
    if (checks.offer_clashes === 0) ok.push('No other lead has been offered this time.');
    if (checks.day_count_with_this_visit != null) ok.push(checks.day_count_with_this_visit + (rb && rb.max_per_day ? ' of ' + rb.max_per_day : '') + ' visits that day, counting this one.');
    if (checks.address_street_source) ok.push(checks.address_street_source === 'job_site' ? 'Street address taken from the job site on record.' : 'Street address taken from the GHL contact.');
    if (checks.contact_prior_system_bookings) warn.push('This lead already has a visit booked from this screen.');
    var unverified = checks.system_offers && Array.isArray(checks.system_offers.unverified_texts) ? checks.system_offers.unverified_texts.length : 0;
    if (unverified) warn.push(plural(unverified, 'earlier text') + ' from this screen named no time, so ' + (unverified === 1 ? 'its time' : 'their times') + ' could not be checked.');
    var note = checks.hand_sent_texts === 'not_machine_checked' ? (checks.hand_sent_texts_note || 'Texts sent by hand cannot be checked. Read the conversation first.') : '';
    if (!ok.length && !warn.length && !note) return '';
    return '<ul class="oc-checks">' + ok.map(function (t) { return '<li class="is-ok">' + esc(t) + '</li>'; }).join('') +
      warn.map(function (t) { return '<li class="is-warn">' + esc(t) + '</li>'; }).join('') + '</ul>' +
      (note ? '<p class="fine">' + esc(note) + '</p>' : '');
  }

  function renderOwnerPreview(c, kind, preview) {
    var key = approvalKey(c, kind), ct = preview.snapshot.content || {};
    var approving = !!state.approvalPending[key], pressing = !!state.pressPending[key];
    var head, body, label;
    if (kind === 'message') {
      head = 'This exact text goes from ' + senderShort(ct.sender) + ' to the phone ending ' + phoneEnding(ct.recipient) + '.';
      body = '<blockquote class="oc-text">' + esc(ct.text) + '</blockquote>' +
        (ct.offer ? '<p class="oc-line">It holds ' + esc(visitWords(ct.offer)) + ' for them.</p>' : '');
      label = approving ? 'Approving…' : pressing ? 'Sending…' : 'Approve and send';
    } else {
      head = 'This exact visit goes in ' + ownerTargets(ct).join(' and ') + '.';
      body = '<p class="when">' + esc(visitWords(ct, true)) + '</p>' +
        '<p class="oc-line">' + esc(ct.title) + ' · ' + esc(ct.address) + ' · on site until ' + esc(clockLabel(hourFromIso(ct.end_iso))) + '</p>';
      label = approving ? 'Approving…' : pressing ? 'Booking…' : 'Approve and book';
    }
    var busy = approving || pressing ? ' disabled' : '';
    return '<div class="ownercheck" data-owner-preview="' + kind + '"><p class="oc-head"><strong>Checked.</strong> ' + esc(head) + '</p>' + body +
      ownerCheckList(kind, preview.checks, ownerRulebook(c)) +
      '<div class="actions"><button type="button" class="' + (kind === 'calendar' ? 'secondary' : 'primary') + '" data-owner-approve="' + kind + '" data-case-id="' + esc(c.id) + '"' + busy + '>' + icon(kind === 'calendar' ? 'calendar' : 'send') + esc(label) + '</button>' +
      '<button type="button" class="quiet" data-owner-cancel="' + kind + '" data-case-id="' + esc(c.id) + '"' + busy + '>Change it</button></div></div>';
  }

  function renderOwnerComposeFoot(c) {
    var m = decisionModel(c);
    var key = approvalKey(c, 'message');
    var preview = state.ownerPreviews[key];
    var rb = ownerRulebook(c);
    var sender = (rb && rb.sender) || resolveSender().number;
    var recipient = m && m.message && m.message.recipient;
    var block = ownerPressBlock(c, 'message');
    var last = state.pressResults[key];
    var held = ownerVisit(c);
    var clash = held ? clashForSpan(c, held.window_start_iso, held.end_iso, null, true) : clashFor(c);
    var out = '<p class="route">From <b>' + esc(senderShort(sender)) + '</b>' +
      (recipient ? ' to the phone ending <b>' + esc(phoneEnding(recipient)) + '</b>' : ' to the customer\'s mobile in GHL') + '</p>';
    var dft = state.drafts[draftKey(c)];
    var rewrite = pendingRewrite(c);
    if (rewrite) {
      out += '<p class="edited">Your text may not match the time you picked.' + (composeBusy(c) ? '' : ' <button type="button" class="linklike" data-owner-rewrite data-case-id="' + esc(c.id) + '">Rewrite it for ' + esc(visitWords(held)) + '</button>') + '</p>';
    } else if (dft && held && dft.text === dft.autoText) {
      out += '<p class="edited">Rewritten for the time you picked. Your approval will cover these exact words.</p>';
    } else if (m && editedText(c) != null) {
      out += '<p class="edited">Edited. Your approval will cover these exact words.' + (composeBusy(c) ? '' : ' <button type="button" class="linklike" data-booking-draft-reset>Use the proposed text</button>') + '</p>';
    }
    if (held) out += '<p class="fine">This text holds ' + esc(visitWords(held)) + ' for them.</p>';
    if (clash) out += '<p class="clash">' + esc(clashSentence(clash)) + '</p>';
    if (preview) {
      out += renderOwnerPreview(c, 'message', preview);
    } else {
      out += '<div class="actions"><button type="button" class="primary" data-booking-press="message" data-case-id="' + esc(c.id) + '"' + (block ? ' disabled aria-describedby="why-message"' : '') + '>' + icon('send') + (state.approvalPending[key] ? 'Checking…' : state.pressPending[key] ? 'Sending…' : 'Send this text') + '</button></div>' +
        (block && !state.pressPending[key] && !state.approvalPending[key] && !(last && last.done) ? '<p class="why" id="why-message">' + esc(block) + '</p>' : '');
    }
    return out + (m ? channelLine(c, 'message') : '') + renderResult(c, 'message');
  }

  function renderOwnerVisit(c) {
    var m = decisionModel(c);
    var head = '<h3>' + icon('calendar') + 'Pick a visit</h3>';
    var rb = ownerRulebook(c);
    if (!ownerFlow() || !ownerBooking(c)) return '<section class="visit is-pick">' + head + '<p class="why">Booking a time you pick is not connected yet, so nothing can be booked from here.</p></section>';
    if (!rb) return '<section class="visit is-pick">' + head + '<p class="why">The booking rules did not come with this list. Press Refresh.</p></section>';
    var key = approvalKey(c, 'calendar');
    var pick = ownerPick(c);
    var dis = pickerBusy(c) || ownerBooking(c).eligible !== true ? ' disabled' : '';
    var dates = rb.bookable_dates || [];
    var minutes = Number(pick.minutes);
    var starts = ownerStarts(rb, pick.date, minutes);
    if (freePickWindow(pick) && starts.indexOf(pick.start) < 0) starts = starts.concat([pick.start]).sort();
    var v = ownerVisit(c);
    var preview = state.ownerPreviews[key];
    var block = ownerPressBlock(c, 'calendar');
    var last = state.pressResults[key];
    var clash = v && clashForSpan(c, v.window_start_iso, v.end_iso, null, true);
    var days = (rb.days || []).map(function (d) { return WEEKDAY_NAMES[d] || d; });
    var lead = m && m.proposal
      ? 'Pick a different time. Proposed: ' + longDate(String(m.proposal.window_start_iso || m.proposal.start_iso).slice(0, 10)) + ', arrive ' + timeRange(m.proposal.window_start_iso, m.proposal.window_end_iso) + '.'
      : (m && m.reason && m.reason !== 'No validated AI proposal in this read.'
        ? 'No confident proposed time: ' + m.reason
        : 'No proposed time for this lead, so pick one.');
    var rules = days.length ? ' Stratco visits are ' + days.join(' or ') + ', ' + clockLabel(minutesOf(rb.day_start) / 60) + ' to ' + clockLabel(minutesOf(rb.day_end) / 60) + '.' : '';
    function option(value, label, on) { return '<option value="' + esc(value) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    var picker = '<div class="pick">' +
      '<label><span>Day</span><select data-owner-visit="date" aria-label="Visit day" data-focus-key="pick-date-' + esc(c.id) + '"' + dis + '>' + option('', 'Pick a day', !pick.date) +
        dates.map(function (d) { return option(d, shortDate(d), pick.date === d); }).join('') + '</select></label>' +
      '<label><span>Arrive from</span><select data-owner-visit="start" aria-label="Arrive from" data-focus-key="pick-start-' + esc(c.id) + '"' + dis + '>' + option('', 'Pick a time', !pick.start) +
        starts.map(function (t) { return option(t, clockLabel(minutesOf(t) / 60), pick.start === t); }).join('') + '</select></label>' +
      '<label><span>Arrival window</span><select data-owner-visit="minutes" aria-label="Arrival window" data-focus-key="pick-minutes-' + esc(c.id) + '"' + dis + '>' +
        ownerWindows(rb).map(function (n) { return option(String(n), n + ' minutes', minutes === n); }).join('') + '</select></label></div>';
    var back = hasEngineProposal(c) && !pickerBusy(c) ? '<p class="pickother"><button type="button" class="linklike" data-owner-pick-close data-case-id="' + esc(c.id) + '">Use the proposed time</button></p>' : '';
    var out = '<section class="visit is-pick">' + head + '<p class="fine">' + esc(lead + rules) + '</p>' + back + picker;
    if (v) out += '<p class="when">' + esc(visitWords(v, true)) + '</p><p class="fine">On site until ' + esc(clockLabel(hourFromIso(v.end_iso))) + '. The server checks GHL, Outlook and other leads\' offers before anything is booked.</p>';
    if (clash) out += '<p class="clash">' + esc(clashSentence(clash)) + '</p>';
    out += '<p class="targets">Book it writes: <b>' + ownerTargets(rb.calendar).map(esc).join('</b> and <b>') + '</b></p>';
    if (preview) {
      out += renderOwnerPreview(c, 'calendar', preview);
    } else {
      out += '<div class="actions"><button type="button" class="secondary" data-booking-press="calendar" data-case-id="' + esc(c.id) + '"' + (block ? ' disabled aria-describedby="why-calendar"' : '') + '>' + icon('calendar') + (state.approvalPending[key] ? 'Checking…' : state.pressPending[key] ? 'Booking…' : 'Book it') + '</button></div>' +
        (block && !clash && !state.pressPending[key] && !state.approvalPending[key] && !(last && last.done) ? '<p class="why" id="why-calendar">' + esc(block) + '</p>' : '');
    }
    return out + renderResult(c, 'calendar') + '</section>';
  }

  // ---- presses -------------------------------------------------------------------
  function isUnknownAction(err) {
    var msg = String((err && err.message) || err || '');
    return (err && err.status === 404) || /unknown action|not found|no such action|unsupported action/i.test(msg);
  }

  function reasonWords(reason) {
    var raw = String(reason || '').trim();
    if (!raw) return 'no reason given.';
    var known = {
      approval_expired_requires_new_proposal: 'the approval ran out. Press Refresh, then press again.',
      approval_not_found: 'the server could not find your approval. Press Refresh, then press again.',
      approval_snapshot_changed: 'the lead changed since you looked. Check it again.',
      approval_content_hash_mismatch: 'the words did not match what you approved. Check it again.',
      current_person_availability_unavailable: 'the calendar could not be checked just now.',
      prior_offer_conflict: 'that time is already offered to someone else.',
      slot_taken: 'that time is no longer free.',
      send_hold: 'sending is switched off on the server.',
      calendar_write_disabled: 'calendar writing is switched off on the server.',
      // Owner-authored checks (owner-authored-v1) and the executor's press checks.
      owner_visit_not_future: 'that time has already passed.',
      owner_visit_day_not_permitted: 'Stratco visits are Tuesday and Friday only.',
      owner_visit_window_length: 'the arrival window must be 60 to 90 minutes.',
      owner_visit_outside_hours: 'the visit must start at 8:00am or later and finish by 4:30pm.',
      owner_visit_protected_band: 'Tuesday 1:00 to 3:30pm is kept for Stratco in Canning Vale, with 30 minutes travel either side.',
      owner_visit_too_short: 'the visit must run at least an hour past the latest arrival.',
      owner_visit_window_not_inside_visit: 'the visit times do not fit together. Pick the time again.',
      owner_visit_spans_days: 'the visit must start and finish on the same day.',
      owner_visit_times_invalid: 'the visit times could not be read. Pick the time again.',
      owner_visit_required: 'no visit time was picked.',
      contact_already_booked_that_day: 'this customer is already booked that day.',
      ghl_calendar_clash: 'that time clashes with another booking in GHL, counting 30 minutes travel either side.',
      outlook_calendar_clash: 'that time clashes with an Outlook entry, counting 30 minutes travel either side.',
      system_offer_clash: 'that time is already offered to another lead.',
      daily_capacity_reached: 'that day is already full.',
      ghl_calendar_unreadable: 'the GHL calendar could not be read, so the time cannot be checked.',
      outlook_unreadable: 'Outlook could not be read, so the time cannot be checked.',
      owner_calendar_unreadable: 'the Stratco Fencing calendar in GHL could not be read.',
      owner_calendar_unknown: 'the Stratco Fencing calendar in GHL is not set up as expected.',
      system_offers_unreadable: 'earlier offers could not be read, so a double booking cannot be ruled out.',
      booking_step_requires_reconciliation: 'an earlier press for this lead has no settled result. Check GHL, then press Refresh.',
      text_already_in_thread: 'this exact text is already in the conversation.',
      thread_unreadable: 'the conversation could not be read, so a double text cannot be ruled out.',
      owner_message_text_has_dash: 'the text has a long dash. Texts to clients never use one.',
      owner_message_text_required: 'the text is empty or longer than 1600 characters.',
      contact_phone_missing: 'the customer has no mobile number in GHL.',
      contact_name_missing: 'the customer has no name in GHL.',
      contact_street_missing: 'the customer has no street number in GHL, only a suburb. Add it in GHL first.',
      contact_suburb_missing: 'the customer\'s suburb is missing.',
      contact_unreadable: 'the GHL contact could not be read.',
      owner_snapshot_changed: 'the customer\'s phone, name or address changed since the check. Check it again.',
      owner_preview_expired: 'that check is more than 15 minutes old. Check it again.',
      booking_case_identity_ambiguous: 'this GHL contact appears more than once. Sort it out in GHL first.',
      stamp_write_requires_captain: 'only Marnin can approve texts and bookings.',
      approval_actor_required: 'only Marnin can approve texts and bookings.',
      press_requires_captain: 'only Marnin can send or book from here.',
      stratco_profile_required: 'only Marnin\'s Stratco leads can be approved here.',
      approval_decision_already_recorded: 'a different answer is already recorded for this exact content.',
      approval_expired: 'the approval ran out. Check it again.',
      customer_replied_since_approval: 'the customer wrote since you approved. Read their reply first.',
      recipient_changed: 'the customer\'s phone number changed in GHL. Check it again.',
      execution_outcome_unknown: 'an earlier attempt has no clear result, so it is not repeated. Check GHL.',
      send_outcome_unknown: 'the text may or may not have gone, so it is not sent again. Check GHL.'
    };
    if (known[raw]) return known[raw];
    if (/^[a-z0-9_:.-]+$/.test(raw)) raw = raw.replace(/[_:.-]+/g, ' ');
    raw = raw.charAt(0).toLowerCase() + raw.slice(1);
    return /[.!?]$/.test(raw) ? raw : raw + '.';
  }

  // One plain sentence for a named refusal. Where the server names what is in
  // the way, the sentence names it too.
  function refusalWords(reason, detail) {
    var code = String(reason || '').trim();
    detail = detail && typeof detail === 'object' ? detail : null;
    var events = detail && Array.isArray(detail.events) ? detail.events : [];
    var first = events[0];
    var at = function (iso) { return iso ? ' at ' + clockLabel(hourFromIso(iso)) : ''; };
    if (first && code === 'ghl_calendar_clash') return 'that time clashes with ' + (first.title || 'a GHL booking') + at(first.start) + ' in GHL, counting ' + (detail.travel_buffer_minutes || 30) + ' minutes travel either side.';
    if (first && code === 'outlook_calendar_clash') return 'that time clashes with ' + (first.subject || 'an Outlook entry') + at(first.start && (first.start.dateTime || first.start)) + ' in Outlook, counting ' + (detail.travel_buffer_minutes || 30) + ' minutes travel either side.';
    if (first && code === 'contact_already_booked_that_day') return 'this customer is already booked that day' + at(first.start) + '.';
    if (code === 'system_offer_clash' && detail && Array.isArray(detail.offers) && detail.offers[0]) {
      var offer = detail.offers[0];
      var who = cases().filter(function (row) { return row.contact_id === offer.contact_id; })[0];
      return 'that time is already offered to ' + (who && who.display_name ? who.display_name : 'another lead') + at(offer.start_iso) + '.';
    }
    if (code === 'daily_capacity_reached' && detail && detail.max_per_day) return 'that day already has ' + detail.max_per_day + ' visits.';
    if (code === 'booking_step_requires_reconciliation' && detail && detail.reason === 'a_text_to_this_lead_may_or_may_not_have_been_sent') return 'an earlier text to this lead may or may not have gone. Check the conversation in GHL first.';
    if (code === 'booking_step_requires_reconciliation' && detail && detail.reason === 'a_booking_for_this_lead_is_mid_press') return 'a booking for this lead is still going through. Press Refresh in a minute.';
    return reasonWords(code);
  }

  function wouldWords(kind, would) {
    if (!would) return '';
    if (typeof would === 'string') return ' It would have: ' + would;
    if (would.summary || would.description) return ' It would have: ' + (would.summary || would.description);
    if (kind === 'message' && would.text) return ' It would have sent: “' + would.text + '”';
    if (kind === 'calendar' && (would.start || would.start_iso)) return ' It would have booked ' + timeRange(would.start || would.start_iso, would.end || would.end_iso) + ' on ' + longDate(String(would.start || would.start_iso).slice(0, 10)) + '.';
    return '';
  }

  function describeResult(kind, res, c, snap) {
    var status = res && res.status;
    var at = perthClockNow();
    if (kind === 'message') {
      var line = senderShort(snap.content.sender);
      var tail = phoneEnding(snap.content.recipient);
      if (status === 'sent') return { tone: 'ok', done: true, snapshot: snap, text: 'Text sent at ' + at + ' from ' + line + ' to the phone ending ' + tail + '.', ref: res.message_id ? 'GHL message ' + res.message_id : '' };
      if (status === 'dry_run') return { tone: 'info', snapshot: snap, text: 'Checked only, nothing was sent. The server is in trial mode.' + wouldWords(kind, res.would_write) };
      if (status === 'refused') return { tone: 'bad', snapshot: snap, text: 'Not sent: ' + refusalWords(res.reason, res.detail) };
    } else {
      var content = snap && snap.content || {};
      var p = decisionModel(c) && decisionModel(c).proposal;
      var when = content.window_start_iso ? visitWords(content, true)
        : p ? longDate(String(p.start_iso).slice(0, 10)) + ', arrive ' + timeRange(p.window_start_iso, p.window_end_iso) : 'the proposed time';
      var named = Array.isArray(res && res.written) && res.written.length
        ? res.written.map(function (t) { return typeof t === 'string' ? t : t && (t.label || t.provider) || ''; }).filter(Boolean)
        : [];
      var targets = named.length ? named.join(' and ') : (snap && snap.source === 'owner' ? ownerTargets(content) : bookTargets(decisionModel(c))).join(' and ');
      if (status === 'booked') return { tone: 'ok', done: true, snapshot: snap, text: 'Booked ' + when + ' in ' + targets + ' at ' + at + '.', ref: res.appointment_id ? 'GHL appointment ' + res.appointment_id : '', url: res.appointment_url && /^https:\/\//.test(res.appointment_url) ? res.appointment_url : '' };
      if (status === 'dry_run') return { tone: 'info', snapshot: snap, text: 'Checked only, nothing was booked. The server is in trial mode.' + wouldWords(kind, res.would_write) };
      if (status === 'refused') return { tone: 'bad', snapshot: snap, text: 'Not booked: ' + refusalWords(res.reason, res.detail) };
    }
    return { tone: 'bad', uncertain: true, snapshot: snap, text: 'The server answered without a clear result. Check GHL before pressing again.' };
  }

  // One press = the owner's approval of the exact content on screen, then the
  // matching server action with that approval id, then the result in words.
  async function press(id, kind) {
    var c = cases().filter(function (row) { return row.id === id; })[0];
    if (!c || !ACTIONS[kind]) return { ok: false, reason: 'no_case' };
    // The owner's own words or picked time go through the check first.
    if ((kind === 'message' ? messagePath(c) : calendarPath(c)) === 'owner') return ownerCheck(id, kind);
    var key = approvalKey(c, kind);
    if (state.pressPending[key]) return { ok: false, reason: 'pending' };
    var block = pressBlock(c, kind);
    if (block) { state.approvalErrors[key] = block; render(); return { ok: false, reason: block }; }
    var snap = approvalSnapshot(c, kind);
    var held = state.approvalIds[key];
    var approvalId = held && sameContent(held.snapshot, snap) ? held.id : null;
    delete state.pressResults[key];
    if (!approvalId) {
      var rec = await recordApproval(id, kind, 'approved');
      if (!rec.ok) return rec;
      approvalId = rec.approval_id;
      if (!approvalId) {
        state.pressResults[key] = { tone: 'bad', snapshot: snap, text: 'Your approval is recorded, but the server gave it no reference, so nothing was ' + (kind === 'calendar' ? 'booked' : 'sent') + '.' };
        render();
        return { ok: false, reason: 'no_approval_id' };
      }
    }
    state.pressPending[key] = true;
    delete state.approvalErrors[key];
    render();
    if (!sameContent(approvalSnapshot(c, kind), snap)) {
      delete state.pressPending[key];
      state.approvalErrors[key] = 'This changed after it was shown. Check it again before pressing.';
      render();
      return { ok: false, reason: state.approvalErrors[key] };
    }
    var result;
    try {
      if (typeof global.opsPost !== 'function') throw new Error('Unknown action');
      var res = await global.opsPost(ACTIONS[kind], { approval_id: approvalId });
      result = describeResult(kind, res, c, snap);
    } catch (err) {
      result = isUnknownAction(err)
        ? { tone: 'info', snapshot: snap, notConnected: true, text: (kind === 'calendar' ? 'Booking' : 'Sending') + ' from this screen is not connected yet. Your approval is recorded; nothing was ' + (kind === 'calendar' ? 'booked' : 'sent') + '.' }
        : { tone: 'bad', uncertain: true, snapshot: snap, text: 'No confirmed result: ' + String((err && err.message) || err) + '. Check GHL before pressing again.' };
    } finally {
      delete state.pressPending[key];
    }
    state.pressResults[key] = result;
    if (result.done) rememberOccupancy(c, result);
    if (result.done && sameContent(approvalSnapshot(c, kind), snap)) {
      var channel = c.booking_read_model[kind === 'calendar' ? 'calendar_write' : 'message'];
      channel.state = 'succeeded';
    }
    render();
    return { ok: !!result.done, result: result };
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
    if (state.selectedId !== id) { state.dayIndex = null; state.showConversation = false; }
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
    state.dayIndex = null;
    state.pressResults = {};
    state.ownerPreviews = {};
    state.ownerPickOpen = {};
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
    return load(state.resourceId, next < currentPerthWeek() ? currentPerthWeek() : next);
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
    if (state.weekStart < currentPerthWeek()) state.weekStart = currentPerthWeek();
    var request = ++state.request;
    var key = cacheKey(state.resourceId, state.weekStart);
    var cached = state.cache[key];
    state.loading = true;
    state.error = null;
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
    render();
    try {
      var t0 = Date.now();
      var data = await bookingRead(readParams());
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
      reapplyOwnerOccupancy();
      state.visitUncertain = {};
      state.cache[key] = data;
      state.stale = false;
      state.lastReadMs = ms;
      state.lastFreshAt = Date.now();
      state.readKind = 'fresh';
      // A fresh read carries the server's own receipts; an unconfirmed press no
      // longer blocks, and the server's approval-keyed idempotency owns retries.
      Object.keys(state.pressResults).forEach(function (k) {
        if (state.pressResults[k] && state.pressResults[k].uncertain) delete state.pressResults[k];
      });
      applyServerStamp(data);
      applyServerDrafts(data);
    } catch (e) {
      if (request !== state.request) return;
      var info = classifyReadError(e);
      state.error = info.message;
      if (info.keepLastGood && payloadMatchesRequest(state.data, state.resourceId, state.weekStart)) {
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
      state.threads[contactId] = msgs;
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
      if (!state.opened) {
        state.opened = true;
        state.weekStart = currentPerthWeek();
        var cloud = global.SECUREWORKS_CLOUD;
        var user = cloud && cloud.auth && cloud.auth.getUser();
        state.resourceId = signedInResource(user);
      }
      if (state.resourceId) load(state.resourceId, state.weekStart);
      else render();
    }
  }

  function closeCard() {
    state.selectedId = null;
    state.dayIndex = null;
    clearConversation();
    render();
    var el = root();
    if (el && el.scrollIntoView && global.innerWidth && global.innerWidth < 900) el.scrollIntoView({ block: 'start' });
  }

  if (global.document) {
    global.document.addEventListener('click', function (e) {
      var closest = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
      var tab = closest('[data-sales-tab]');
      if (tab) {
        if (typeof global.showView === 'function') global.showView(tab.getAttribute('data-sales-tab'));
        else showSales(tab.getAttribute('data-sales-tab'));
        return;
      }
      if (!root() || !root().contains(e.target)) return;
      var weekNav = closest('[data-booking-week]');
      if (weekNav) {
        e.preventDefault();
        if (weekNav.disabled) return;
        state.dayIndex = null;
        switchWeek(Number(weekNav.getAttribute('data-booking-week')));
        return;
      }
      if (closest('[data-booking-refresh]')) {
        e.preventDefault();
        if (state.resourceId && !state.loading) load(state.resourceId, state.weekStart);
        return;
      }
      if (closest('[data-booking-details]')) {
        e.preventDefault();
        state.showDetails = !state.showDetails;
        render();
        return;
      }
      if (closest('[data-booking-back]')) {
        e.preventDefault();
        closeCard();
        return;
      }
      var day = closest('[data-booking-day]');
      if (day) {
        e.preventDefault();
        state.dayIndex = Number(day.getAttribute('data-booking-day'));
        render();
        return;
      }
      if (closest('[data-booking-thread-all]')) {
        e.preventDefault();
        state.showConversation = !state.showConversation;
        render();
        return;
      }
      if (closest('[data-booking-draft-reset]')) {
        e.preventDefault();
        var sel = selectedCase();
        if (!sel || composeBusy(sel) || !state.drafts[draftKey(sel)]) return;
        var d0 = draftFor(sel);
        d0.humanEdited = false;
        d0.text = composeText(sel);
        d0.revision = (d0.revision || 0) + 1;
        render();
        return;
      }
      var visitNo = closest('[data-visit-no], [data-visit-edit]');
      if (visitNo) {
        var bookingKey = visitNo.getAttribute('data-visit-no') || visitNo.getAttribute('data-visit-edit');
        var visit = bookedVisits().find(function (v) { return v.booking_key === bookingKey; });
        if (visit && !visitNo.disabled) {
          var host = visitNo.closest('[data-visit-row]'), prior = latestVisitOutcome(bookingKey);
          var noteInput = host.querySelector('[data-visit-note]'), quoteInput = host.querySelector('[data-visit-quote]');
          state.visitForms[visitKey(visit)] = {showReasons:visitNo.hasAttribute('data-visit-no'),note:noteInput ? noteInput.value : prior && prior.note || '',quote_owed:quoteInput ? quoteInput.checked : true};
          render();
        }
        return;
      }
      var visitOutcome = closest('[data-visit-outcome]');
      if (visitOutcome) {
        if (visitOutcome.disabled) return;
        var visitHost = visitOutcome.closest('[data-visit-row]');
        recordVisitOutcome(visitOutcome.getAttribute('data-booking-key'), visitOutcome.getAttribute('data-visit-outcome'), visitOutcome.getAttribute('data-visit-reason'), visitHost.querySelector('[data-visit-note]').value, visitHost.querySelector('[data-visit-quote]').checked);
        return;
      }
      var pressBtn = closest('[data-booking-press]');
      if (pressBtn) {
        e.preventDefault();
        if (pressBtn.disabled) return;
        press(pressBtn.getAttribute('data-case-id'), pressBtn.getAttribute('data-booking-press'));
        return;
      }
      var ownerYes = closest('[data-owner-approve]');
      if (ownerYes) {
        e.preventDefault();
        if (ownerYes.disabled) return;
        ownerApprove(ownerYes.getAttribute('data-case-id'), ownerYes.getAttribute('data-owner-approve'));
        return;
      }
      var freeBand = closest('[data-free-band]');
      if (freeBand) {
        e.preventDefault();
        var fcase = cases().filter(function (row) { return row.id === freeBand.getAttribute('data-case-id'); })[0];
        if (!fcase || freeBand.disabled || fcase !== selectedCase() || !canTapFreeTime(fcase)) return;
        var fdate = freeBand.getAttribute('data-date');
        var box = freeBand.getBoundingClientRect ? freeBand.getBoundingClientRect() : null;
        var frac = box && box.height && e.clientY ? (e.clientY - box.top) / box.height : 0;
        var fw = freeWindowAt(freeBands(fcase, fdate)[Number(freeBand.getAttribute('data-free-band'))], frac);
        if (!fw) return;
        pickFreeWindow(fcase, fw);
        state.dayIndex = dayIndexFromIso(fw.from_iso, state.weekStart);
        render();
        return;
      }
      var rewriteBtn = closest('[data-owner-rewrite]');
      if (rewriteBtn) {
        e.preventDefault();
        var rc = selectedCase();
        if (!rc || rewriteBtn.disabled || composeBusy(rc) || !pendingRewrite(rc)) return;
        var rd = draftFor(rc);
        rd.text = rd.rewrite;
        rd.autoText = rd.rewrite;
        rd.rewrite = null;
        rd.humanEdited = true;
        rd.revision = (rd.revision || 0) + 1;
        rd.sender = resolveSender().number;
        render();
        return;
      }
      var pickOpen = closest('[data-owner-pick-open], [data-owner-pick-close]');
      if (pickOpen) {
        e.preventDefault();
        var pcase = cases().filter(function (row) { return row.id === pickOpen.getAttribute('data-case-id'); })[0];
        if (!pcase || pickOpen.disabled || pickerBusy(pcase)) return;
        var pkey = draftKey(pcase);
        if (pickOpen.hasAttribute('data-owner-pick-open')) state.ownerPickOpen[pkey] = true;
        else {
          delete state.ownerPickOpen[pkey];
          delete state.ownerVisits[pkey];
          var pd = state.drafts[pkey];
          if (pd && pd.autoText && pd.text === pd.autoText) delete state.drafts[pkey];
          else if (pd) pd.rewrite = null;
          delete state.approvalErrors[approvalKey(pcase, 'calendar')];
        }
        render();
        return;
      }
      var ownerNo = closest('[data-owner-cancel]');
      if (ownerNo) {
        e.preventDefault();
        var oc = cases().filter(function (row) { return row.id === ownerNo.getAttribute('data-case-id'); })[0];
        var okind = ownerNo.getAttribute('data-owner-cancel');
        if (ownerNo.disabled || !oc) return;
        var okey = approvalKey(oc, okind);
        if (state.approvalPending[okey] || state.pressPending[okey]) return;
        delete state.ownerPreviews[okey];
        render();
        return;
      }
      var decision = closest('[data-booking-decision]');
      if (decision) {
        e.preventDefault();
        if (decision.disabled) return;
        var kind = decision.getAttribute('data-booking-decision');
        var refusal = decision.getAttribute('data-refuse') === '1';
        var reasonInput = root().querySelector('[data-refusal-reason="' + kind + '"]');
        recordApproval(decision.getAttribute('data-case-id'), kind, refusal ? 'refused' : 'approved', reasonInput && reasonInput.value);
        return;
      }
      var fold = closest('[data-booking-fold]');
      if (fold) {
        e.preventDefault();
        state.showArchived = !state.showArchived;
        render();
        return;
      }
      var scoper = closest('[data-booking-resource-btn]');
      if (scoper) {
        e.preventDefault();
        switchResource(scoper.getAttribute('data-booking-resource-btn'));
        return;
      }
      // Legacy approve/confirm hooks are no longer rendered. A stale or scripted
      // click still reaches attemptApprove, which refuses on SEND_HOLD.
      var approve = closest('[data-booking-approve], [data-booking-confirm]');
      if (approve) {
        e.preventDefault();
        attemptApprove();
        render();
        return;
      }
      var lead = closest('[data-booking-case]');
      if (lead) {
        var id = lead.getAttribute('data-booking-case');
        if (!id) return;
        selectCase(id);
        var card = root().querySelector('.bk-card');
        if (card && card.scrollIntoView && global.innerWidth && global.innerWidth < 900) card.scrollIntoView({ block: 'start' });
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
      if (e.target.matches && e.target.matches('[data-owner-visit]')) {
        var pc = selectedCase();
        if (!pc || pickerBusy(pc) || !ownerRulebook(pc)) return render();
        var pick = ownerPick(pc);
        var field = e.target.getAttribute('data-owner-visit');
        if (field === 'minutes') pick.minutes = Number(e.target.value);
        else if (field) pick[field] = e.target.value;
        // A changed pick is no longer the tapped server window.
        if (pick.free && !freePickWindow(pick)) delete pick.free;
        // A start the new day or window no longer allows is cleared, never kept.
        if (pick.start && !pick.free && ownerStarts(ownerRulebook(pc), pick.date, Number(pick.minutes)).indexOf(pick.start) < 0) pick.start = '';
        delete state.approvalErrors[approvalKey(pc, 'calendar')];
        delete state.approvalErrors[approvalKey(pc, 'message')];
        rewriteTextForPick(pc);
        render();
      }
    });
    global.document.addEventListener('input', function (e) {
      if (e.target.matches && e.target.matches('[data-booking-search]')) {
        state.search = e.target.value;
        renderListOnly();
        return;
      }
      if (e.target.matches && e.target.matches('[data-booking-draft]')) {
        var c = selectedCase();
        if (!c || !draftKey(c) || composeBusy(c)) return;
        var d = draftFor(c);
        d.text = e.target.value;
        d.humanEdited = true;
        d.revision = (d.revision || 0) + 1;
        d.sender = resolveSender().number;
        delete state.approvalErrors[approvalKey(c, 'message')];
        renderComposeOnly();
      }
    });
  }


  var api = {
    recordVisitOutcome: recordVisitOutcome,
    latestVisitOutcome: latestVisitOutcome,
    bookedVisits: bookedVisits,
    currentPerthWeek: currentPerthWeek,
    signedInResource: signedInResource,
    decisionModel: decisionModel,
    approvalSnapshot: approvalSnapshot,
    approvalBlock: approvalBlock,
    recordApproval: recordApproval,
    commitmentSlots: commitmentSlots,
    calendarReadState: calendarReadState,
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
    composeText: composeText,
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
    postStamp: postStamp,
    press: press,
    pressBlock: pressBlock,
    ownerCheck: ownerCheck,
    ownerApprove: ownerApprove,
    ownerInput: ownerInput,
    ownerVisit: ownerVisit,
    ownerPick: ownerPick,
    ownerStarts: ownerStarts,
    ownerBlock: ownerBlock,
    messagePath: messagePath,
    calendarPath: calendarPath,
    quietReload: quietReload,
    refusalWords: refusalWords,
    describeResult: describeResult,
    editedText: editedText,
    bookingContentHash: bookingContentHash,
    canonicalJson: canonicalJson,
    sha256Hex: sha256Hex,
    lastWords: lastWords,
    listGroups: listGroups,
    unansweredSince: unansweredSince,
    clashFor: clashFor,
    sourceLabel: sourceLabel,
    bookTargets: bookTargets,
    renderVisitOutcomes: renderVisitOutcomes,
    renderWeek: renderWeek,
    freeBands: freeBands,
    freeWindowAt: freeWindowAt,
    pickFreeWindow: pickFreeWindow,
    pickedVisitText: pickedVisitText,
    renderCard: renderCard,
    timeRange: timeRange
  };
  global.SalesBooking = api;
  global.SalesWorkspace = { show: showSales, subtab: function () { return state.subtab; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
