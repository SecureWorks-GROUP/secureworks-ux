// Split a cost document's lines into parts (P2-03.11). Pure: no page, no request.
// Every amount is whole cents. A typed amount is read from its text, never through a
// float, and a remainder is never rounded away or moved to another part.
(function (root) {
  'use strict';
  // "600", "600.5", "600.50", "$1,240.00" -> cents. Anything else, zero or negative -> null.
  function toCents(text) {
    var s = String(text == null ? '' : text).replace(/[\s$,]/g, '');
    var m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    var cents = Number(m[1]) * 100 + Number(((m[2] || '') + '00').slice(0, 2));
    return cents > 0 ? cents : null;
  }
  // A line amount from the server (dollars, may be negative) -> cents, or null when not read.
  function lineCents(amount) {
    var ok = typeof amount === 'number' || (typeof amount === 'string' && amount.trim() !== '');
    var n = ok ? Number(amount) : NaN;
    return isFinite(n) ? Math.round(n * 100) : null;
  }
  // Cents still to place on a line: its size less the parts. Parts are sizes; a credit's
  // parts carry the credit's sign when they are sent (see partsFor).
  function left(lineAmountCents, partsCents) {
    var total = Math.abs(lineAmountCents);
    (partsCents || []).forEach(function (c) { total -= c || 0; });
    return total;
  }
  // lines: [{line_id, cents, parts: [{target, job_id, text}]}]. True when every line is fully
  // placed and every part has a place and an amount.
  function valid(lines) {
    if (!Array.isArray(lines) || !lines.length) return false;
    return lines.every(function (l) {
      if (l.cents == null || l.cents === 0 || !l.parts || !l.parts.length) return false;
      var ok = l.parts.every(function (p) {
        return toCents(p.text) != null && (p.target === 'overhead' || (p.target === 'job' && !!p.job_id));
      });
      return ok && left(l.cents, l.parts.map(function (p) { return toCents(p.text); })) === 0;
    });
  }
  // The parts reconcile_decide takes for a split: dollars to two places, the line's sign.
  function partsFor(lines) {
    var out = [];
    lines.forEach(function (l) {
      var sign = l.cents < 0 ? -1 : 1;
      l.parts.forEach(function (p) {
        var part = { line_id: l.line_id, target: p.target, amount_ex: sign * toCents(p.text) / 100 };
        if (p.target === 'job') part.job_id = p.job_id;
        out.push(part);
      });
    });
    return out;
  }
  var api = { toCents: toCents, lineCents: lineCents, left: left, valid: valid, partsFor: partsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ReconcileSplit = api;
})(typeof window !== 'undefined' ? window : null);
