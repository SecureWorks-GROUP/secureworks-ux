// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 4) — Drive-time estimator
//
// Pure module. Two backends:
//   • staticEstimate(originSuburb, destSuburb, timeBucket)
//       — synchronous lookup against a hand-painted Joondalup-anchored
//         corridor table. Always available. Source for v1 proposer.
//   • routesApiEstimate(originAddress, destAddress, departureIso)
//       — STUB ONLY. The Google Routes API integration is contract-
//         only in Loop 4 (see secureworks-docs/cio/evidence/secure-
//         sale-cockpit-2026-04-30/maps-proxy-contract.md). This stub
//         returns null + safety_notes['routes_api_not_deployed'].
//
// Hard rules:
//   • No fetch / XHR / sendBeacon. The Routes-API path is a stub —
//     it returns a not-deployed marker and never reaches the network.
//   • Static table is canonical for Loop 4. The fallback is the
//     primary backend; Routes API is the future enhancement.
//   • Numbers are AVERAGE driving minutes for typical traffic at
//     the named time bucket. Used as a planning estimate, not a
//     real-time ETA.
//   • South-of-river entries flag `peak_warning` so the proposer
//     can apply the "high-value/urgency only" gate.
//
// Time buckets (matches the Loop 4 research):
//   '7am'  — pre-peak commute window
//   '9am'  — post-peak, fastest
//   '12pm' — midday, light traffic
//   '3pm'  — pre-school-pickup, building
//   '4pm'  — school-pickup peak
//   '5pm'  — return-commute peak
//   '7pm'  — evening, light again
//
// Public API:
//   SALE_DRIVE_TIME.staticEstimate(origin, dest, bucket)
//     → { minutes, source: 'static_table', confidence: 'low',
//         peak_warning?: boolean, fallback_used?: boolean }
//   SALE_DRIVE_TIME.routesApiEstimate(...)
//     → Promise<{ minutes: null,
//                 source: 'routes_api',
//                 confidence: 'high',
//                 safety_notes: ['routes_api_not_deployed'] }>
//   SALE_DRIVE_TIME.bucketForHour(hourOfDay)
//     → '7am' | '9am' | '12pm' | '3pm' | '4pm' | '5pm' | '7pm'
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_DRIVE_TIME = exports;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ── Bucket assignment for an hour-of-day ─────────────────

  var BUCKETS = ['7am', '9am', '12pm', '3pm', '4pm', '5pm', '7pm'];

  function bucketForHour(h) {
    if (typeof h !== 'number' || isNaN(h)) return '12pm';
    if (h < 8)  return '7am';
    if (h < 11) return '9am';
    if (h < 14) return '12pm';
    if (h < 16) return '3pm';
    if (h < 17) return '4pm';
    if (h < 18) return '5pm';
    return '7pm';
  }

  // ── Static fallback table ────────────────────────────────
  //
  // Each row is { origin, dest, minutes_by_bucket }. Painted from
  // local knowledge anchored at Joondalup base. North-corridor
  // entries are short and stable; south-of-river entries carry
  // `peak_warning: true`. Times are AVERAGE driving minutes.
  //
  // To extend: add the symmetric pair (origin↔dest both directions)
  // unless asymmetric traffic patterns warrant different numbers.

  var TABLE = [
    // ── Joondalup anchor (north corridor) ──
    pair('Joondalup',  'Stirling',     {  '7am': 28, '9am': 22, '12pm': 22, '3pm': 26, '4pm': 32, '5pm': 38, '7pm': 22 }),
    pair('Joondalup',  'Hillarys',     {  '7am': 14, '9am': 12, '12pm': 12, '3pm': 14, '4pm': 16, '5pm': 18, '7pm': 12 }),
    pair('Joondalup',  'Mindarie',     {  '7am': 12, '9am': 11, '12pm': 11, '3pm': 12, '4pm': 14, '5pm': 16, '7pm': 11 }),
    pair('Joondalup',  'Currambine',   {  '7am':  6, '9am':  6, '12pm':  6, '3pm':  7, '4pm':  8, '5pm':  9, '7pm':  6 }),
    pair('Joondalup',  'Wanneroo',     {  '7am': 14, '9am': 12, '12pm': 12, '3pm': 14, '4pm': 16, '5pm': 19, '7pm': 12 }),
    pair('Joondalup',  'Burns Beach',  {  '7am': 10, '9am':  9, '12pm':  9, '3pm': 10, '4pm': 12, '5pm': 13, '7pm':  9 }),
    pair('Joondalup',  'Two Rocks',    {  '7am': 32, '9am': 28, '12pm': 28, '3pm': 30, '4pm': 34, '5pm': 38, '7pm': 28 }),
    pair('Joondalup',  'Kingsley',     {  '7am': 12, '9am': 10, '12pm': 10, '3pm': 12, '4pm': 14, '5pm': 16, '7pm': 10 }),
    pair('Joondalup',  'Ocean Reef',   {  '7am': 10, '9am':  8, '12pm':  8, '3pm':  9, '4pm': 11, '5pm': 13, '7pm':  8 }),
    pair('Joondalup',  'Mullaloo',     {  '7am':  9, '9am':  8, '12pm':  8, '3pm':  9, '4pm': 11, '5pm': 13, '7pm':  8 }),

    // ── Inter-corridor (north-corridor cross-links) ──
    pair('Stirling',   'Hillarys',     {  '7am': 18, '9am': 14, '12pm': 14, '3pm': 16, '4pm': 22, '5pm': 26, '7pm': 14 }),
    pair('Stirling',   'Mindarie',     {  '7am': 36, '9am': 28, '12pm': 28, '3pm': 32, '4pm': 38, '5pm': 44, '7pm': 28 }),
    pair('Hillarys',   'Mindarie',     {  '7am':  9, '9am':  8, '12pm':  8, '3pm':  9, '4pm': 11, '5pm': 13, '7pm':  8 }),
    pair('Hillarys',   'Currambine',   {  '7am': 18, '9am': 14, '12pm': 14, '3pm': 16, '4pm': 18, '5pm': 22, '7pm': 14 }),
    pair('Wanneroo',   'Mindarie',     {  '7am': 16, '9am': 14, '12pm': 14, '3pm': 16, '4pm': 18, '5pm': 22, '7pm': 14 }),
    pair('Wanneroo',   'Hillarys',     {  '7am': 18, '9am': 16, '12pm': 16, '3pm': 18, '4pm': 22, '5pm': 26, '7pm': 16 }),

    // ── South-of-river (peak-warning suburbs) ──
    pair('Joondalup',  'Subiaco',      {  '7am': 36, '9am': 28, '12pm': 28, '3pm': 32, '4pm': 42, '5pm': 52, '7pm': 28 }, { peak_warning: true }),
    pair('Joondalup',  'Fremantle',    {  '7am': 56, '9am': 44, '12pm': 44, '3pm': 50, '4pm': 64, '5pm': 78, '7pm': 44 }, { peak_warning: true }),
    pair('Joondalup',  'Cottesloe',    {  '7am': 44, '9am': 36, '12pm': 36, '3pm': 42, '4pm': 56, '5pm': 68, '7pm': 36 }, { peak_warning: true }),
    pair('Joondalup',  'South Perth',  {  '7am': 48, '9am': 38, '12pm': 38, '3pm': 44, '4pm': 58, '5pm': 70, '7pm': 38 }, { peak_warning: true }),
    pair('Joondalup',  'Como',         {  '7am': 50, '9am': 40, '12pm': 40, '3pm': 46, '4pm': 60, '5pm': 72, '7pm': 40 }, { peak_warning: true }),

    // ── Same-suburb (job-to-job nearby) ──
    pair('Joondalup',  'Joondalup',    {  '7am':  5, '9am':  5, '12pm':  5, '3pm':  5, '4pm':  6, '5pm':  6, '7pm':  5 }),
    pair('Stirling',   'Stirling',     {  '7am':  6, '9am':  6, '12pm':  6, '3pm':  7, '4pm':  8, '5pm':  9, '7pm':  6 }),
    pair('Hillarys',   'Hillarys',     {  '7am':  5, '9am':  5, '12pm':  5, '3pm':  5, '4pm':  6, '5pm':  6, '7pm':  5 }),
  ];

  // Build a fast lookup map: 'origin|dest' → { minutes_by_bucket, peak_warning }
  var INDEX = {};
  TABLE.forEach(function (row) {
    INDEX[key(row.origin, row.dest)] = { minutes_by_bucket: row.minutes_by_bucket, peak_warning: !!row.peak_warning };
  });

  function pair(a, b, mins, opts) {
    return { origin: a, dest: b, minutes_by_bucket: mins, peak_warning: !!(opts && opts.peak_warning) };
  }
  function key(a, b) { return String(a).toLowerCase() + '|' + String(b).toLowerCase(); }

  // ── Public: staticEstimate ──

  // Fallback strategy: if exact pair missing, try the symmetric
  // entry (b→a). If still missing, return a generic estimate
  // marked fallback_used=true so the proposer can flag low confidence.
  function staticEstimate(origin, dest, bucket) {
    var b = (bucket && BUCKETS.indexOf(bucket) !== -1) ? bucket : '12pm';
    var direct = INDEX[key(origin, dest)];
    var symmetric = direct ? null : INDEX[key(dest, origin)];
    var hit = direct || symmetric;
    if (hit) {
      var mins = hit.minutes_by_bucket[b];
      if (typeof mins === 'number') {
        return {
          minutes: mins,
          source: 'static_table',
          confidence: 'low',
          peak_warning: !!hit.peak_warning,
          fallback_used: false,
        };
      }
    }
    // Generic fallback when we have no entry. Conservative: 25 min
    // off-peak, 35 min peak. Marked so proposer can de-rank these.
    var generic = (b === '4pm' || b === '5pm') ? 35 : 25;
    return {
      minutes: generic,
      source: 'static_table',
      confidence: 'low',
      peak_warning: false,
      fallback_used: true,
    };
  }

  // ── Public: routesApiEstimate (stub — never reaches network) ──

  function routesApiEstimate(_originAddr, _destAddr, _departureIso) {
    // Loop 4 rule: contract only, no deploy. Returning a Promise that
    // resolves with the not-deployed marker keeps the API shape stable
    // so the proposer can wire to it once the maps-proxy edge function
    // is approved + deployed (separate slice).
    return Promise.resolve({
      minutes: null,
      source: 'routes_api',
      confidence: 'high',
      safety_notes: ['routes_api_not_deployed'],
    });
  }

  // ── Public: lookup helper for proposer ──
  //
  // The proposer hands in an origin suburb (rep starting_location's
  // suburb), a destination suburb (job.site_suburb), and a bucket.
  // This wraps staticEstimate and adds a "drive_buffer_minutes"
  // suggestion (round up to next 5 + 5 contingency).

  function lookup(origin, dest, bucket) {
    var est = staticEstimate(origin, dest, bucket);
    var buffer = Math.ceil(est.minutes / 5) * 5 + 5; // round up to 5, +5
    return Object.assign({}, est, { drive_buffer_minutes: buffer });
  }

  return {
    staticEstimate: staticEstimate,
    routesApiEstimate: routesApiEstimate,
    bucketForHour: bucketForHour,
    lookup: lookup,
    BUCKETS: BUCKETS,
    // Exposed for tests:
    _tableEntries: TABLE.length,
  };
});
