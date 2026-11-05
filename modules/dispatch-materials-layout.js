/* <dispatch-materials-layout>
 * Dispatch v2, the Materials panel's line: where each label goes so no two
 * ever sit on top of each other. Pure functions only (no page, no reads, no
 * writes), so they are tested on their own (tests/unit/dispatch-materials-layout.test.cjs).
 *
 * The panel draws one marker per supplier order at its date, between Today
 * and the Install day. Before this file, every order had its own marker and
 * its own label, and orders on the same date (or close dates) were printed
 * over each other. Now:
 *
 *   1. Orders on the same spot of the line share ONE marker (a group). The
 *      marker's badge speaks for the group: "Pay" for one, "3 to pay" for
 *      three, and its colour is the most urgent order's colour.
 *   2. Under the line, each group gets one label column, a fixed share of the
 *      line wide, centred under its marker (pulled in at the two ends). The
 *      column holds one label block per order, stacked one under the other.
 *   3. Columns are put in lanes. A column that would touch one already in a
 *      lane drops to the next lane down, so labels for nearby dates never
 *      overlap. The page draws each lane as a row in normal flow, so a lane
 *      is exactly as tall as its tallest column and the panel grows to fit.
 *   4. Badges over the line get the same lane treatment, upwards.
 *
 * Positions are percentages of the line's width, the same numbers the panel
 * already uses (Today at 3, the line's end at 76, the "No date yet" bay from
 * 82). Loaded before modules/ops-dispatch.js as window.OpsDispatchLayout (the
 * file name leaves out "ops-dispatch" so the v1/v2 switch's own file checks
 * still see one Dispatch module).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpsDispatchLayout = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // One label column's width, as a percent of the line. The words wrap inside
  // it; a long supplier name is cut at three lines with the full name on hover.
  var LABEL_WIDTH_PCT = 18;

  // The line is never drawn narrower than this (.dpc-mp-rail min-width in
  // modules/ops-dispatch.css). Badge widths are estimated against it, so the
  // estimate is the widest a badge can ever be, as a share of the line.
  var RAIL_MIN_PX = 600;

  // A badge's width in pixels: about 6.6px a letter (10px bold mono,
  // uppercase, a little letter spacing) plus 14px of padding and 2px spare.
  var BADGE_CHAR_PX = 6.6;
  var BADGE_PAD_PX = 16;

  // How far apart two markers can be and still count as the same spot (in
  // percent). Orders on the same date always land on exactly the same spot.
  var SAME_SPOT_PCT = 0.05;

  // Rounding slack when comparing edges, so two columns that only touch
  // (the bay's slots sit edge to edge) stay in the same lane.
  var EDGE_SLACK = 0.001;

  // Most urgent first: not in time, needs us, waiting on the supplier, fine.
  var TONE_RANK = { late: 0, us: 1, sp: 2, ok: 3 };

  // A badge word for more than one order: "3 to pay", "2 confirmed".
  var MANY = {
    Order: 'to order', Sent: 'sent', Quote: 'quotes', Pay: 'to pay', Confirmed: 'confirmed',
    Making: 'making', Ready: 'ready', Delivered: 'delivered', 'Picked up': 'picked up'
  };

  function rank(tone) { return TONE_RANK[tone] == null ? 9 : TONE_RANK[tone]; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // The badge for a group of marks: the most urgent order's word, counted
  // when other orders there carry the same word. '' when none has a badge.
  function groupBadge(marks) {
    var lead = null;
    marks.forEach(function (m) {
      if (m.badge && (!lead || rank(m.tone) < rank(lead.tone))) lead = m;
    });
    if (!lead) return { text: '', tone: '' };
    var n = marks.filter(function (m) { return m.badge === lead.badge; }).length;
    return { text: n > 1 ? n + ' ' + (MANY[lead.badge] || lead.badge.toLowerCase()) : lead.badge, tone: lead.tone };
  }

  // Marks to groups. Each mark: { pct, bay, labLeft, labWidth, tone, solid,
  // asap, badge, ... } (any other fields ride along untouched). Dated marks
  // on the same spot become one group; a mark in the bay is always its own
  // group (it already has its own slot of the bay). Groups come back sorted
  // left to right; marks inside a group keep the order they came in.
  function groupMarks(marks) {
    var groups = [];
    marks.forEach(function (m) {
      var g = m.bay ? null : groups.filter(function (x) { return !x.bay && Math.abs(x.pct - m.pct) <= SAME_SPOT_PCT; })[0];
      if (g) g.marks.push(m);
      else groups.push({ pct: m.pct, bay: !!m.bay, marks: [m], labLeft: m.labLeft, labWidth: m.labWidth });
    });
    groups.forEach(function (g) {
      var top = g.marks.reduce(function (a, m) { return rank(m.tone) < rank(a.tone) ? m : a; }, g.marks[0]);
      g.tone = top.tone;
      // Solid only when every date there is confirmed; dashed when any is ASAP.
      g.solid = g.marks.every(function (m) { return !!m.solid; });
      g.asap = g.marks.some(function (m) { return !!m.asap; });
      var b = groupBadge(g.marks);
      g.badge = b.text;
      g.badgeTone = b.tone;
    });
    // Stable sort: equal spots keep their first-seen order.
    return groups.map(function (g, i) { return { g: g, i: i }; })
      .sort(function (x, y) { return x.g.pct - y.g.pct || x.i - y.i; })
      .map(function (x) { return x.g; });
  }

  // Puts items in lanes, first lane they fit in. Each item has left and
  // right edges (percent); an item fits a lane when it starts at or after the
  // lane's last right edge. Sets item.lane and returns the number of lanes.
  function packLanes(items, leftOf, rightOf, setLane) {
    var ends = [];
    items.slice().sort(function (x, y) { return leftOf(x) - leftOf(y); }).forEach(function (it) {
      var l = 0;
      while (l < ends.length && leftOf(it) < ends[l] - EDGE_SLACK) l++;
      ends[l] = rightOf(it);
      setLane(it, l);
    });
    return ends.length;
  }

  // The estimated width of a badge, as a percent of the narrowest line.
  function badgeWidthPct(word) {
    return (String(word).length * BADGE_CHAR_PX + BADGE_PAD_PX) / RAIL_MIN_PX * 100;
  }

  // The whole layout. Returns:
  //   groups: every group, left to right, each with
  //     colLeft, colWidth  the label column (percent of the line)
  //     pinPct             where the marker sits inside the column (percent of the column)
  //     lane               the label lane, 0 = just under the line
  //     badgeLane          the badge lane, 0 = just over the marker
  //   lanes: the groups lane by lane, each lane left to right, each with
  //     gapPct (the space from the previous column in that lane, or from the
  //     line's left edge), which the page uses as the column's left margin
  //   badgeLanes: how many badge lanes (1 when there are no badges)
  function layout(marks, opts) {
    var width = (opts && opts.labelWidth) || LABEL_WIDTH_PCT;
    var groups = groupMarks(marks || []);
    groups.forEach(function (g) {
      if (g.bay && g.labLeft != null && g.labWidth != null) {
        g.colLeft = g.labLeft;
        g.colWidth = g.labWidth;
      } else {
        g.colWidth = width;
        g.colLeft = clamp(g.pct - width / 2, 0, 100 - width);
      }
      g.pinPct = g.colWidth ? clamp((g.pct - g.colLeft) / g.colWidth * 100, 0, 100) : 50;
    });
    var nLanes = packLanes(groups,
      function (g) { return g.colLeft; },
      function (g) { return g.colLeft + g.colWidth; },
      function (g, l) { g.lane = l; });
    var lanes = [];
    for (var l = 0; l < nLanes; l++) {
      var edge = 0;
      lanes.push(groups.filter(function (g) { return g.lane === l; }).sort(function (x, y) { return x.colLeft - y.colLeft; }).map(function (g) {
        g.gapPct = Math.max(0, g.colLeft - edge);
        edge = g.colLeft + g.colWidth;
        return g;
      }));
    }
    var badged = groups.filter(function (g) { return !!g.badge; });
    groups.forEach(function (g) { g.badgeLane = 0; });
    var nBadge = packLanes(badged,
      function (g) { return g.pct - badgeWidthPct(g.badge) / 2; },
      function (g) { return g.pct + badgeWidthPct(g.badge) / 2; },
      function (g, l) { g.badgeLane = l; });
    return { groups: groups, lanes: lanes, badgeLanes: Math.max(1, nBadge) };
  }

  // True when two label columns (or badges) in one lane would overlap: for
  // tests and for anyone checking a layout by hand.
  function overlaps(a, b) {
    return a.colLeft < b.colLeft + b.colWidth - EDGE_SLACK && b.colLeft < a.colLeft + a.colWidth - EDGE_SLACK;
  }

  return {
    LABEL_WIDTH_PCT: LABEL_WIDTH_PCT,
    RAIL_MIN_PX: RAIL_MIN_PX,
    groupMarks: groupMarks,
    groupBadge: groupBadge,
    badgeWidthPct: badgeWidthPct,
    layout: layout,
    overlaps: overlaps
  };
});
