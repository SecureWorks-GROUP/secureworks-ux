// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 4) — Rep availability zones
//
// Pure module. Loads a rep's availability JSON (3-zone painted
// calendar: green/orange/red). Exposes lookup + candidate-block
// helpers that the calendar proposer consumes.
//
// Hard rules (Marnin direction §B.2):
//   • green   = preferred / good
//   • orange  = possible if worth it (gated by value/urgency)
//   • red     = never (hard reject)
//   • Reps adjust availability continuously. Phase 1: edit JSON
//     in git. Phase 2 (later slice): cockpit UI saves to Supabase.
//   • No fetch outside same-origin static GET. v9 lock unchanged.
//
// Public API:
//   SALE_AVAILABILITY.load(repFirstName, opts?)
//     → Promise<RepAvailability>
//   SALE_AVAILABILITY.zoneAt(repAvail, dayName, hhmm)
//     → 'green' | 'orange' | 'red'
//   SALE_AVAILABILITY.candidateBlocks(repAvail, fromDate, days, scopeMinutes)
//     → CandidateBlock[]
//
// RepAvailability shape:
//   {
//     rep_first_name:     string,
//     starting_location:  string,
//     max_scopes_per_day: number,
//     availability: [
//       { day: 'Mon'..'Sun',
//         blocks: [ { start: 'HH:MM', end: 'HH:MM', zone: ... } ]
//       }, ...
//     ]
//   }
//
// CandidateBlock shape:
//   {
//     date:        string,    // YYYY-MM-DD
//     day_name:    string,    // 'Tue'
//     start:       string,    // 'HH:MM'
//     end:         string,    // 'HH:MM'
//     zone:        'green' | 'orange',  // red blocks never returned
//     duration_min: number,
//   }
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_AVAILABILITY = exports;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Zone priority — lower index = stronger. Red is exclusive (cannot
  // be overlapped by a softer zone in the same time range).
  var ZONE_PRIORITY = { red: 0, green: 1, orange: 2 };

  // ── Helpers ────────────────────────────────────────────────

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function hhmmToMinutes(hhmm) {
    if (typeof hhmm !== 'string') return null;
    var m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var mn = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
    return h * 60 + mn;
  }

  function minutesToHhmm(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    return pad2(h) + ':' + pad2(m);
  }

  function dayNameOfDate(date) {
    return DAY_NAMES[date.getDay()];
  }

  function dateOnlyIso(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function dayBlocksFor(repAvail, dayName) {
    if (!repAvail || !Array.isArray(repAvail.availability)) return [];
    var entry = repAvail.availability.find(function (e) { return e && e.day === dayName; });
    return entry && Array.isArray(entry.blocks) ? entry.blocks : [];
  }

  // ── Public: load (fixture-only in Loop 4; same-origin static GET) ──

  function load(repFirstName, opts) {
    opts = opts || {};
    var name = String(repFirstName || '').toLowerCase();
    // Allow direct injection for tests + Node.
    if (opts.injected && typeof opts.injected === 'object') {
      return Promise.resolve(opts.injected);
    }
    // Some-origin static GET. The path is relative to wherever this
    // module is loaded from (cockpit page is at securedash/sale-preview.html
    // and availability/ sits beside it).
    var url = (opts.basePath || './availability/') + name + '.json';
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('sale-availability: fetch not available'));
    }
    return fetch(url, { credentials: 'omit', cache: 'no-cache' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('availability load ' + resp.status + ' for ' + url);
        return resp.json();
      });
  }

  // ── Public: zoneAt (point lookup) ──

  function zoneAt(repAvail, dayName, hhmm) {
    var blocks = dayBlocksFor(repAvail, dayName);
    var t = hhmmToMinutes(hhmm);
    if (t === null) return 'red';
    // If multiple blocks overlap (shouldn't happen but defensive),
    // the strongest zone (red > green > orange) wins.
    var winner = null;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var s = hhmmToMinutes(b.start);
      var e = hhmmToMinutes(b.end);
      if (s === null || e === null) continue;
      if (t < s || t >= e) continue;
      if (!winner || ZONE_PRIORITY[b.zone] < ZONE_PRIORITY[winner]) winner = b.zone;
    }
    return winner || 'red';
  }

  // ── Public: candidateBlocks ──
  //
  // Walks the next `days` days from `fromDate`. For each, expands
  // green and orange blocks into contiguous candidate ranges of at
  // least `scopeMinutes`. Red blocks are skipped entirely. Returns
  // a flat array sorted by (date asc, start asc).

  function candidateBlocks(repAvail, fromDate, days, scopeMinutes) {
    if (!repAvail || !(fromDate instanceof Date)) return [];
    var n = (typeof days === 'number' && days > 0) ? days : 7;
    var minDuration = (typeof scopeMinutes === 'number' && scopeMinutes > 0) ? scopeMinutes : 30;
    var out = [];
    for (var d = 0; d < n; d++) {
      var cursor = new Date(fromDate.getTime());
      cursor.setDate(cursor.getDate() + d);
      cursor.setHours(0, 0, 0, 0);
      var dayName = dayNameOfDate(cursor);
      var dateIso = dateOnlyIso(cursor);
      var blocks = dayBlocksFor(repAvail, dayName);
      blocks.forEach(function (b) {
        if (!b || (b.zone !== 'green' && b.zone !== 'orange')) return;
        var s = hhmmToMinutes(b.start);
        var e = hhmmToMinutes(b.end);
        if (s === null || e === null || e - s < minDuration) return;
        out.push({
          date: dateIso,
          day_name: dayName,
          start: minutesToHhmm(s),
          end: minutesToHhmm(e),
          zone: b.zone,
          duration_min: e - s,
        });
      });
    }
    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.start < b.start ? -1 : 1;
    });
    return out;
  }

  // ── Public: sub-divide a candidate block into placement slots ──
  //
  // Given a block + a needed scope duration + drive-time-in/out,
  // return placement options at safe step intervals (default 30 min
  // alignment). Used by the proposer to fit a card into a block.

  function placementSlotsInBlock(block, scopeMinutes, driveInMin, driveOutMin, stepMinutes) {
    var step = (typeof stepMinutes === 'number' && stepMinutes > 0) ? stepMinutes : 30;
    var startMin = hhmmToMinutes(block.start);
    var endMin = hhmmToMinutes(block.end);
    if (startMin === null || endMin === null) return [];
    var totalNeed = (driveInMin || 0) + (scopeMinutes || 30) + (driveOutMin || 0);
    var out = [];
    for (var t = startMin; t + totalNeed <= endMin; t += step) {
      var visitStart = t + (driveInMin || 0);
      var visitEnd = visitStart + (scopeMinutes || 30);
      out.push({
        date: block.date,
        day_name: block.day_name,
        zone: block.zone,
        start: minutesToHhmm(visitStart),
        end: minutesToHhmm(visitEnd),
        leave_origin_at: minutesToHhmm(t),
        return_origin_at: minutesToHhmm(visitEnd + (driveOutMin || 0)),
        drive_minutes_in: driveInMin || 0,
        drive_minutes_out: driveOutMin || 0,
      });
    }
    return out;
  }

  // ── Public: validate config shape ──

  function validate(repAvail) {
    var errors = [];
    if (!repAvail || typeof repAvail !== 'object') {
      errors.push({ field: 'root', error: 'not_object' });
      return { ok: false, errors: errors };
    }
    if (typeof repAvail.rep_first_name !== 'string' || !repAvail.rep_first_name) {
      errors.push({ field: 'rep_first_name', error: 'missing_or_empty' });
    }
    if (typeof repAvail.starting_location !== 'string' || !repAvail.starting_location) {
      errors.push({ field: 'starting_location', error: 'missing_or_empty' });
    }
    if (typeof repAvail.max_scopes_per_day !== 'number' || repAvail.max_scopes_per_day <= 0) {
      errors.push({ field: 'max_scopes_per_day', error: 'must_be_positive_number' });
    }
    if (!Array.isArray(repAvail.availability)) {
      errors.push({ field: 'availability', error: 'not_array' });
    } else {
      repAvail.availability.forEach(function (entry, idx) {
        if (!entry || DAY_NAMES.indexOf(entry.day) === -1) {
          errors.push({ field: 'availability[' + idx + '].day', error: 'invalid_day_name' });
        }
        if (!Array.isArray(entry.blocks)) {
          errors.push({ field: 'availability[' + idx + '].blocks', error: 'not_array' });
          return;
        }
        entry.blocks.forEach(function (b, bIdx) {
          var prefix = 'availability[' + idx + '].blocks[' + bIdx + ']';
          if (!b || hhmmToMinutes(b.start) === null) errors.push({ field: prefix + '.start', error: 'invalid_hhmm' });
          if (!b || hhmmToMinutes(b.end) === null)   errors.push({ field: prefix + '.end',   error: 'invalid_hhmm' });
          if (!b || ['green', 'orange', 'red'].indexOf(b.zone) === -1) errors.push({ field: prefix + '.zone', error: 'invalid_zone' });
        });
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  return {
    load: load,
    zoneAt: zoneAt,
    candidateBlocks: candidateBlocks,
    placementSlotsInBlock: placementSlotsInBlock,
    validate: validate,
    DAY_NAMES: DAY_NAMES,
    // exposed for tests:
    _hhmmToMinutes: hhmmToMinutes,
    _minutesToHhmm: minutesToHhmm,
  };
});
