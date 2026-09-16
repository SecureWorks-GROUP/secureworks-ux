'use strict';

function isRepairDiaryEvent(ev) {
  return !!(ev && /jason|marangaroo/i.test(ev.subject || ''));
}

function findRepairDiaryEvent(events) {
  if (!Array.isArray(events)) return null;
  for (var i = 0; i < events.length; i++) {
    if (isRepairDiaryEvent(events[i])) return events[i];
  }
  return null;
}

function attachCancelledEnquiry(row, built, events) {
  var next = built || {};
  var ev = row && row.status === 'repair' ? findRepairDiaryEvent(events) : null;
  if (!ev) {
    if (next.event_id == null) next.event_id = null;
    return next;
  }
  next.event_id = ev.event_id;
  next.status = 'repair';
  return next;
}

module.exports = {
  isRepairDiaryEvent: isRepairDiaryEvent,
  attachCancelledEnquiry: attachCancelledEnquiry
};
