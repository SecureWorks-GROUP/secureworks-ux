// The Materials panel's label layout (modules/dispatch-materials-layout.js):
// orders on one date share a marker, labels never overlap, badges count.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../modules/dispatch-materials-layout.js');

// A dated mark at pct, or a bay mark in its slot.
const mark = (name, pct, extra = {}) => ({ name, pct, bay: false, labLeft: null, labWidth: null, tone: 'sp', solid: false, asap: false, badge: '', ...extra });
const bayMark = (name, i, n, extra = {}) => {
  const w = (100 - 82) / n;
  return mark(name, 82 + (i + 0.5) * w, { bay: true, labLeft: 82 + i * w, labWidth: w, ...extra });
};
const names = (g) => g.marks.map((m) => m.name);

// No two columns in one lane overlap, and every lane's margins add up to
// where each column really is.
function assertClean(lay) {
  lay.lanes.forEach((lane) => {
    for (let i = 0; i < lane.length; i++) {
      for (let j = i + 1; j < lane.length; j++) assert.equal(L.overlaps(lane[i], lane[j]), false, 'lane columns overlap');
    }
    let edge = 0;
    lane.forEach((g) => {
      assert.ok(g.gapPct >= 0);
      assert.ok(Math.abs(edge + g.gapPct - g.colLeft) < 1e-9);
      edge = g.colLeft + g.colWidth;
      assert.ok(edge <= 100 + 1e-9, 'column runs past the line');
    });
  });
}

test('SWP-261293: three orders on Tue 10/11 share one marker, one column, three label blocks', () => {
  const lay = L.layout([
    mark('AMPELITE AUSTRALIA PTY LTD', 12.1, { tone: 'us', badge: 'Pay' }),
    mark('CMI', 12.1, { tone: 'us', badge: 'Pay' }),
    mark('Metroll', 12.1, { tone: 'sp', badge: 'Sent' }),
  ]);
  assert.equal(lay.groups.length, 1);
  const g = lay.groups[0];
  assert.deepEqual(names(g), ['AMPELITE AUSTRALIA PTY LTD', 'CMI', 'Metroll']);
  assert.equal(g.tone, 'us');
  assert.equal(g.badge, '2 to pay');
  assert.equal(g.badgeTone, 'us');
  assert.equal(g.solid, false);
  assert.equal(lay.lanes.length, 1);
  assert.equal(lay.badgeLanes, 1);
  assertClean(lay);
});

test('one order keeps its own badge word', () => {
  assert.deepEqual(L.groupBadge([mark('A', 10, { tone: 'us', badge: 'Pay' })]), { text: 'Pay', tone: 'us' });
  assert.deepEqual(L.groupBadge([mark('A', 10, { tone: 'ok', badge: 'Confirmed' }), mark('B', 10, { tone: 'ok', badge: 'Confirmed' })]), { text: '2 confirmed', tone: 'ok' });
  assert.deepEqual(L.groupBadge([mark('A', 10)]), { text: '', tone: '' });
});

test('the most urgent order leads the badge: not in time over pay over the rest', () => {
  const b = L.groupBadge([mark('A', 10, { tone: 'ok', badge: 'Confirmed' }), mark('B', 10, { tone: 'late', badge: 'Sent' }), mark('C', 10, { tone: 'us', badge: 'Pay' })]);
  assert.deepEqual(b, { text: 'Sent', tone: 'late' });
});

test('a group is solid only when every date there is confirmed, dashed when any is ASAP', () => {
  const [all] = L.groupMarks([mark('A', 20, { solid: true }), mark('B', 20, { solid: true })]);
  assert.equal(all.solid, true);
  const [mixed] = L.groupMarks([mark('A', 20, { solid: true }), mark('B', 20, { asap: true })]);
  assert.equal(mixed.solid, false);
  assert.equal(mixed.asap, true);
});

test('close dates get their own markers and their labels drop to another lane', () => {
  const lay = L.layout([mark('A', 40), mark('B', 44), mark('C', 48), mark('D', 70)]);
  assert.equal(lay.groups.length, 4);
  assert.deepEqual(lay.groups.map((g) => g.lane), [0, 1, 2, 0]);
  assertClean(lay);
});

test('dates far enough apart stay in one lane, in left to right order', () => {
  const lay = L.layout([mark('Later', 60), mark('Soon', 20)]);
  assert.equal(lay.lanes.length, 1);
  assert.deepEqual(lay.lanes[0].map((g) => g.marks[0].name), ['Soon', 'Later']);
  assertClean(lay);
});

test('a column at either end is pulled in so it stays on the line, its tick still under the marker', () => {
  const lay = L.layout([mark('Today', 3), mark('End', 99)]);
  const [a, b] = lay.groups;
  assert.equal(a.colLeft, 0);
  assert.ok(Math.abs(a.pinPct - 3 / L.LABEL_WIDTH_PCT * 100) < 1e-9);
  assert.equal(b.colLeft + b.colWidth, 100);
  assertClean(lay);
});

test('bay orders keep their own slots edge to edge in one lane, never grouped', () => {
  const lay = L.layout([bayMark('X', 0, 3), bayMark('Y', 1, 3), bayMark('Z', 2, 3)]);
  assert.equal(lay.groups.length, 3);
  assert.deepEqual(lay.groups.map((g) => g.lane), [0, 0, 0]);
  assert.ok(Math.abs(lay.groups[1].colLeft - 88) < 1e-9);
  assert.ok(Math.abs(lay.groups[1].colWidth - 6) < 1e-9);
  assertClean(lay);
});

test('a dated label next to the bay drops a lane rather than run into a bay label', () => {
  const lay = L.layout([mark('Late one', 76), bayMark('X', 0, 1)]);
  assert.notEqual(lay.groups[0].lane, lay.groups[1].lane);
  assertClean(lay);
});

test("the panel's own example (Mon, Wed, the bay) stays one lane with one badge lane", () => {
  const lay = L.layout([mark('Lysaght', 44.7, { badge: 'Pay', tone: 'us' }), mark('Stratco WA', 65.6, { badge: 'Confirmed', tone: 'ok' }), bayMark('Twinside Retaining', 0, 1, { badge: 'Pay', tone: 'us' })]);
  assert.equal(lay.lanes.length, 1);
  assert.equal(lay.badgeLanes, 1);
  assert.deepEqual(lay.lanes[0].map((g) => g.marks[0].name), ['Lysaght', 'Stratco WA', 'Twinside Retaining']);
});

test('badges that would touch go up a lane', () => {
  const lay = L.layout([mark('A', 30, { badge: 'Confirmed' }), mark('B', 33, { badge: 'Pay' }), mark('C', 60, { badge: 'Pay' })]);
  assert.equal(lay.badgeLanes, 2);
  assert.deepEqual(lay.groups.map((g) => g.badgeLane), [0, 1, 0]);
});

test('no marks, no lanes', () => {
  const lay = L.layout([]);
  assert.deepEqual(lay.groups, []);
  assert.deepEqual(lay.lanes, []);
  assert.equal(lay.badgeLanes, 1);
});

test('many orders on many close dates never overlap', () => {
  const marks = [];
  for (let i = 0; i < 30; i++) marks.push(mark('S' + i, 3 + ((i * 37) % 73), { badge: i % 2 ? 'Pay' : 'Sent' }));
  const lay = L.layout(marks);
  assertClean(lay);
  assert.equal(lay.groups.reduce((n, g) => n + g.marks.length, 0), 30);
});
