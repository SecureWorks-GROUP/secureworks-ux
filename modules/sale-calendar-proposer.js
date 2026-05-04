// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 4) — Calendar Proposer
//
// Pure module. Takes a Loop-2 SalesActionCard (book_scope or
// appointment_confirm) + matching JobBrain + the rep's availability
// (3-zone painted calendar) + drive-time lookup + existing calendar
// slots. Returns ranked candidate windows for the rep to approve.
//
// Hard rules (Marnin direction §B.4):
//   • No fetch, no XHR, no sendBeacon. Pure derivation.
//   • Approval-gated. Loop 4 NEVER writes a real booking. The
//     output is a list of candidates the rep approves manually.
//   • 70-80% of bookings should land on main scope days (Tue/Thu).
//     The ranker weights `day_is_main` heaviest.
//   • Same-day candidate fires only when card.priority >= 90 AND
//     today has a green/orange block of >= scope_minutes_same_day_reserve
//     + 2 * drive_buffer.
//   • Orange zones gate on (value_inc_gst >= 15000) OR (priority >= 75).
//   • Red zones never appear (filtered upstream by SALE_AVAILABILITY).
//   • South-of-river afternoon blocks gate on the same orange-style
//     "worth it" rule, regardless of zone.
//   • Sender identity stays type-based (decking/general → Nithin per
//     Loop 4 direction). Reject upstream if rep doesn't own job.type.
//
// Scope minutes (resolved per playbook constraints, with fallbacks):
//   Patio/combo/decking/general — 45 min normal
//   Fencing                     — 30 min normal
//   Same-day                    — 60 min reserve
//
// Public API:
//   SALE_CALENDAR_PROPOSER.propose({
//     card,
//     job_brain,
//     rep_availability,         // RepAvailability (sale-availability.js)
//     existing_calendar,        // Array of { day, rep, start, end, kind, job_id, ... }
//     drive_time,               // module ref OR { lookup(o,d,bucket) → result }
//     playbook?,                // ParsedPlaybook (sale-playbook-loader.js)
//     config?,                  // overrides
//     now?,
//   })
//   → { candidates: [...], rationale, evidence_refs } | null
//
// Candidate shape:
//   {
//     date:        'YYYY-MM-DD',
//     day_name:    'Tue',
//     start:       'HH:MM',
//     end:         'HH:MM',
//     zone:        'green' | 'orange',
//     same_day:    boolean,
//     drive_minutes_in:   number,
//     drive_minutes_out:  number,
//     leave_origin_at:    'HH:MM',
//     return_origin_at:   'HH:MM',
//     why:         string,
//     rank_score:  number,
//     score_components: { day_is_main, cluster, recency, value, zone },
//   }
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_CALENDAR_PROPOSER = exports;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ── Defaults (overridable via input.config or playbook constraints) ──

  var DEFAULTS = Object.freeze({
    days_lookahead:                 7,
    main_days:                      ['Tue', 'Thu'],
    scope_minutes_patio:            45,
    scope_minutes_fencing:          30,
    scope_minutes_same_day_reserve: 60,
    same_day_priority_threshold:    90,
    orange_zone_value_gate:         15000,
    orange_zone_priority_gate:      75,
    south_of_river_value_gate:      20000,
    south_of_river_priority_gate:   90,
    south_of_river_peak_after_hour: 15,    // 3pm
    max_scopes_per_day:             4,
    drive_buffer_default_minutes:   20,
    placement_step_minutes:         30,
    max_candidates:                 3,
    // Composite ranker weights (sum = 1.0).
    weight_day_is_main: 0.45,
    weight_cluster:     0.20,
    weight_recency:     0.15,
    weight_value:       0.10,
    weight_zone:        0.10,
  });

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var SOUTH_OF_RIVER_SUBURBS = [
    'subiaco', 'fremantle', 'cottesloe', 'south perth', 'como',
    'east victoria park', 'south fremantle', 'east perth',
    'mosman park', 'applecross', 'leeming', 'rockingham',
  ];

  // ── Helpers ────────────────────────────────────────────────

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'string' || typeof v === 'number') {
      var d = new Date(v); return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  function hhmmToMinutes(s) {
    if (typeof s !== 'string') return null;
    var m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  function minutesToHhmm(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    return pad2(h) + ':' + pad2(m);
  }
  function dateOnlyIso(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }
  function dayNameOf(date) { return DAY_NAMES[date.getDay()]; }
  function isSouthOfRiver(suburb) {
    var s = String(suburb || '').toLowerCase();
    return SOUTH_OF_RIVER_SUBURBS.some(function (sw) { return s.indexOf(sw) !== -1; });
  }
  function bucketForHourLocal(h) {
    if (h < 8)  return '7am';
    if (h < 11) return '9am';
    if (h < 14) return '12pm';
    if (h < 16) return '3pm';
    if (h < 17) return '4pm';
    if (h < 18) return '5pm';
    return '7pm';
  }

  // Resolve scope minutes from the playbook's constraints if present,
  // else from job type defaults.
  function resolveScopeMinutes(card, playbook, defaults) {
    if (playbook && playbook.constraints && typeof playbook.constraints.scope_minutes_normal === 'number') {
      return playbook.constraints.scope_minutes_normal;
    }
    var jt = String(card.job_type || '').toLowerCase();
    if (jt === 'fencing') return defaults.scope_minutes_fencing;
    return defaults.scope_minutes_patio;
  }

  function resolveMaxScopes(playbook, repAvail, defaults) {
    if (playbook && playbook.constraints && typeof playbook.constraints.max_scopes_per_day === 'number') {
      return playbook.constraints.max_scopes_per_day;
    }
    if (repAvail && typeof repAvail.max_scopes_per_day === 'number') {
      return repAvail.max_scopes_per_day;
    }
    return defaults.max_scopes_per_day;
  }

  function resolveSameDayReserve(playbook, defaults) {
    if (playbook && playbook.constraints && typeof playbook.constraints.scope_minutes_same_day_reserve === 'number') {
      return playbook.constraints.scope_minutes_same_day_reserve;
    }
    return defaults.scope_minutes_same_day_reserve;
  }

  function resolveOrangeGates(playbook, defaults) {
    var c = playbook && playbook.constraints || {};
    return {
      value:    typeof c.orange_zone_value_gate === 'number' ? c.orange_zone_value_gate : defaults.orange_zone_value_gate,
      priority: typeof c.orange_zone_priority_gate === 'number' ? c.orange_zone_priority_gate : defaults.orange_zone_priority_gate,
    };
  }

  // Origin suburb extraction (rep starting_location string like
  // "Joondalup, WA 6027" → "Joondalup").
  function suburbFromLocation(loc) {
    if (typeof loc !== 'string') return '';
    return loc.split(',')[0].trim();
  }

  // ── Calendar lookups ───────────────────────────────────────

  function rebuildCalendarIndex(existingCalendar, repFirstName) {
    // Map: 'YYYY-MM-DD' → array of slots for this rep on that date.
    var index = {};
    if (!existingCalendar || !Array.isArray(existingCalendar)) return index;
    existingCalendar.forEach(function (s) {
      if (!s || !s.day || !s.start || !s.end) return;
      if (s.rep && repFirstName && s.rep !== repFirstName) return;
      // s.day may be 'Today'/'Tomorrow' or a YYYY-MM-DD string.
      var key = s.day;
      if (!index[key]) index[key] = [];
      index[key].push(s);
    });
    return index;
  }

  function countScopesOnDate(calIndex, dateIso) {
    var slots = calIndex[dateIso] || [];
    return slots.filter(function (s) {
      return s.kind === 'booked' || s.kind === 'proposed';
    }).length;
  }

  function clusterBonusFor(calIndex, dateIso, suburb) {
    if (!suburb) return 0;
    var slots = calIndex[dateIso] || [];
    var same = slots.some(function (s) {
      return String(s.suburb || '').toLowerCase() === String(suburb).toLowerCase();
    });
    if (same) return 1.0;
    // Adjacent corridor bonus would go here if we had drive-time
    // distance per pair. v1: binary same-suburb-only.
    return 0;
  }

  function overlapsExisting(calIndex, dateIso, startMin, endMin) {
    var slots = calIndex[dateIso] || [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      var ss = hhmmToMinutes(s.start);
      var se = hhmmToMinutes(s.end);
      if (ss === null || se === null) continue;
      // Overlap if startMin < se && endMin > ss
      if (startMin < se && endMin > ss) return true;
    }
    return false;
  }

  // ── Main: propose ──────────────────────────────────────────

  function propose(input) {
    if (!input || !input.card) return null;
    var card = input.card;
    if (card.action_type !== 'book_scope' && card.action_type !== 'appointment_confirm') {
      return null;
    }
    var repAvail = input.rep_availability;
    if (!repAvail) return null;

    var playbook = input.playbook || null;
    var config = Object.assign({}, DEFAULTS, input.config || {});
    var now = toDate(input.now) || new Date();

    var driveModule = input.drive_time;
    if (!driveModule || typeof driveModule.lookup !== 'function') {
      // Tests can stub this; in the cockpit window.SALE_DRIVE_TIME is wired.
      return null;
    }

    var scopeMinutes = resolveScopeMinutes(card, playbook, config);
    var sameDayReserve = resolveSameDayReserve(playbook, config);
    var maxScopes = resolveMaxScopes(playbook, repAvail, config);
    var orangeGates = resolveOrangeGates(playbook, config);
    var driveBufferDefault = (playbook && playbook.constraints && typeof playbook.constraints.drive_buffer_default_minutes === 'number')
      ? playbook.constraints.drive_buffer_default_minutes
      : config.drive_buffer_default_minutes;

    var origin = suburbFromLocation(repAvail.starting_location);
    var dest = card.suburb || '';
    var calIndex = rebuildCalendarIndex(input.existing_calendar, repAvail.rep_first_name);

    // Card-level priority + value (Loop 2 generator output).
    var priority = typeof card.priority === 'number' ? card.priority : 0;
    var value = typeof card.value_inc_gst === 'number' ? card.value_inc_gst : 0;
    var cardSouth = isSouthOfRiver(dest);

    var candidates = [];
    var diagnostics = {
      origin: origin, dest: dest, scope_minutes: scopeMinutes,
      max_scopes: maxScopes, days_lookahead: config.days_lookahead,
      filtered: { red: 0, max_scopes: 0, overlap: 0, south_peak: 0, orange_gate: 0, no_fit: 0 },
      same_day_attempted: false, same_day_emitted: false,
    };

    // For d=0 (today), placements must leave the origin AFTER `now`
    // (plus a small grace window). For d>0 the whole block is in
    // the future so any start time is valid.
    var nowMinutesOfDay = now.getHours() * 60 + now.getMinutes();
    var sameDayGraceMinutes = 30;

    // Walk the next N days.
    for (var d = 0; d < config.days_lookahead; d++) {
      var cursor = new Date(now.getTime());
      cursor.setDate(cursor.getDate() + d);
      cursor.setHours(0, 0, 0, 0);
      var dateIso = dateOnlyIso(cursor);
      var dayName = dayNameOf(cursor);

      // Day cap.
      if (countScopesOnDate(calIndex, dateIso) >= maxScopes) {
        diagnostics.filtered.max_scopes++;
        continue;
      }

      var dayBlocks = (repAvail.availability || []).filter(function (e) {
        return e && e.day === dayName;
      });
      if (!dayBlocks.length) continue;

      dayBlocks[0].blocks.forEach(function (block) {
        if (!block) return;
        if (block.zone === 'red') { diagnostics.filtered.red++; return; }
        if (block.zone !== 'green' && block.zone !== 'orange') return;

        // Orange-zone gate: need value or priority justification.
        if (block.zone === 'orange' && value < orangeGates.value && priority < orangeGates.priority) {
          diagnostics.filtered.orange_gate++;
          return;
        }

        var blockStart = hhmmToMinutes(block.start);
        var blockEnd = hhmmToMinutes(block.end);
        if (blockStart === null || blockEnd === null) return;

        // Same-day: clamp the start to be at least now + grace, so we
        // don't propose a leave time that's already in the past.
        var effectiveStart = blockStart;
        if (d === 0) {
          effectiveStart = Math.max(blockStart, nowMinutesOfDay + sameDayGraceMinutes);
          // Round up to next placement step boundary.
          if (effectiveStart % config.placement_step_minutes !== 0) {
            effectiveStart = Math.ceil(effectiveStart / config.placement_step_minutes) * config.placement_step_minutes;
          }
        }

        // Same-day visits reserve more on-site time than the normal
        // scope duration. Marnin's rule: a same-day proposal must
        // include >= 1 hour on-site plus drive buffer. For d > 0 we
        // use the rep's normal scope time (45 patio / 30 fencing).
        var visitMinutes = (d === 0) ? Math.max(sameDayReserve, scopeMinutes) : scopeMinutes;

        // Walk placement slots inside the block at config.placement_step_minutes.
        for (var t = effectiveStart; t + (driveBufferDefault * 2 + visitMinutes) <= blockEnd; t += config.placement_step_minutes) {
          // For the drive lookup we use the START hour of the leave time.
          var leaveHour = Math.floor(t / 60);
          var bucket = bucketForHourLocal(leaveHour);
          var driveLook = driveModule.lookup(origin, dest, bucket);
          var driveIn = driveLook.minutes;
          var driveOutBucket = bucketForHourLocal(Math.floor((t + driveBufferDefault + visitMinutes) / 60));
          var driveOutLook = driveModule.lookup(dest, origin, driveOutBucket);
          var driveOut = driveOutLook.minutes;

          var visitStart = t + driveIn;
          var visitEnd = visitStart + visitMinutes;
          var returnEnd = visitEnd + driveOut;
          if (returnEnd > blockEnd) {
            diagnostics.filtered.no_fit++;
            continue;
          }
          if (overlapsExisting(calIndex, dateIso, visitStart, visitEnd)) {
            diagnostics.filtered.overlap++;
            continue;
          }

          // South-of-river afternoon gate.
          var visitHour = Math.floor(visitStart / 60);
          if (cardSouth && visitHour >= config.south_of_river_peak_after_hour
              && value < config.south_of_river_value_gate
              && priority < config.south_of_river_priority_gate) {
            diagnostics.filtered.south_peak++;
            continue;
          }

          // Score components (each 0..1).
          var dayIsMain = config.main_days.indexOf(dayName) !== -1 ? 1 : 0;
          var cluster = clusterBonusFor(calIndex, dateIso, dest);
          // Recency bonus: today=1, +1 day = 0.85, ... linear taper.
          var recency = Math.max(0, 1 - 0.15 * d);
          // Value bonus: linear up to $20k.
          var valueBonus = Math.min(1, value / 20000);
          // Zone bonus: green=1, orange=0.5.
          var zoneBonus = block.zone === 'green' ? 1 : 0.5;

          var score =
            config.weight_day_is_main * dayIsMain
            + config.weight_cluster   * cluster
            + config.weight_recency   * recency
            + config.weight_value     * valueBonus
            + config.weight_zone      * zoneBonus;

          var why = [];
          if (dayIsMain) why.push('main scope day');
          if (cluster > 0) why.push('clusters with ' + dest + ' job that day');
          if (block.zone === 'orange') why.push('orange zone (justified by value/priority)');
          if (cardSouth) why.push('south-of-river — peak window cleared');
          if (!why.length) why.push('next available window');

          candidates.push({
            date: dateIso,
            day_name: dayName,
            start: minutesToHhmm(visitStart),
            end: minutesToHhmm(visitEnd),
            zone: block.zone,
            same_day: d === 0,
            drive_minutes_in: driveIn,
            drive_minutes_out: driveOut,
            leave_origin_at: minutesToHhmm(t),
            return_origin_at: minutesToHhmm(returnEnd),
            why: why.join(' · '),
            rank_score: round3(score),
            score_components: {
              day_is_main: dayIsMain,
              cluster: round3(cluster),
              recency: round3(recency),
              value: round3(valueBonus),
              zone: round3(zoneBonus),
            },
          });
          // One placement per block is enough for the proposer; the
          // ranker will prefer earlier-in-block by recency anyway.
          break;
        }
      });
    }

    // Same-day exception: even if we already added a same-day candidate
    // by walking the loop, ensure it surfaces only when priority gate
    // passes. If priority < threshold, drop all `same_day` candidates.
    if (priority < config.same_day_priority_threshold) {
      var before = candidates.length;
      candidates = candidates.filter(function (c) { return !c.same_day; });
      if (before !== candidates.length) diagnostics.same_day_attempted = true;
    } else {
      diagnostics.same_day_emitted = candidates.some(function (c) { return c.same_day; });
    }

    // Sort by rank desc, take top N.
    candidates.sort(function (a, b) {
      if (b.rank_score !== a.rank_score) return b.rank_score - a.rank_score;
      // Tie-break: earlier date, then earlier start.
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.start < b.start ? -1 : 1;
    });
    var top = candidates.slice(0, config.max_candidates);

    if (!top.length) {
      return {
        candidates: [],
        rationale: 'No availability windows fit within the next ' + config.days_lookahead + ' days for ' + (repAvail.rep_first_name || 'rep') + ' that pass the orange-zone / south-of-river / overlap filters.',
        evidence_refs: passEvidence(card),
        diagnostics: diagnostics,
      };
    }

    var rationale = (top.length === 1 ? '1 candidate window' : top.length + ' candidate windows')
      + ' for ' + repAvail.rep_first_name
      + ' (' + scopeMinutes + 'min scope). '
      + 'Main-day weight 0.45 — ' + (top.filter(function (c) { return config.main_days.indexOf(c.day_name) !== -1; }).length) + '/' + top.length + ' on Tue/Thu.';

    return {
      candidates: top,
      rationale: rationale,
      evidence_refs: passEvidence(card),
      diagnostics: diagnostics,
    };
  }

  function passEvidence(card) {
    var refs = (card.evidence_refs || []).slice();
    refs.push({
      type: 'computed', source_table: null, id: null,
      reason: 'calendar_proposer.v1 ranked candidates from rep_availability + drive-time + cluster/recency/value/zone',
    });
    return refs;
  }

  function round3(n) { return Math.round(n * 1000) / 1000; }

  return {
    propose: propose,
    DEFAULTS: DEFAULTS,
    DAY_NAMES: DAY_NAMES,
    SOUTH_OF_RIVER_SUBURBS: SOUTH_OF_RIVER_SUBURBS,
    // Exposed for tests:
    _resolveScopeMinutes: resolveScopeMinutes,
    _isSouthOfRiver: isSouthOfRiver,
    _suburbFromLocation: suburbFromLocation,
    _bucketForHourLocal: bucketForHourLocal,
  };
});
