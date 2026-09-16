'use strict';

function haystack(ev) {
  return [ev.suburb, ev.subject, ev.display_name, ev.location, ev.title]
    .map(function (s) { return String(s || '').toLowerCase(); })
    .join(' ');
}

function diaryEventForCase(row, events) {
  var suburb = String((row && row.suburb) || '').trim().toLowerCase();
  if (!suburb || !Array.isArray(events)) return null;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev) continue;
    var evSub = String(ev.suburb || '').trim().toLowerCase();
    if (evSub === suburb || haystack(ev).indexOf(suburb) !== -1) return ev;
  }
  return null;
}

function attachDiaryEvent(row, built, events) {
  var next = built || {};
  var ev = diaryEventForCase(row, events);
  if (!ev) {
    if (next.event_id == null) next.event_id = null;
    return next;
  }
  next.event_id = ev.event_id;
  if (row && row.status === 'repair') next.status = 'repair';
  return next;
}

module.exports = {
  diaryEventForCase: diaryEventForCase,
  attachDiaryEvent: attachDiaryEvent
};
