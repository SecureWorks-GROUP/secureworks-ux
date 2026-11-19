// The caller's own office-entered days on a group work order.
// Absent or false stays hidden, so nothing shows while office day entry is off.

export function officeEntryOf(g, meRow) {
  const sources = [meRow, g].filter((s) => s && typeof s === 'object');
  const entered = sources.some((s) => s.office_entered === true);
  if (!entered) return { entered: false, disputed: false, reason: '', at: '', disputeReason: '', dates: [] };
  const pick = (key) => {
    for (const s of sources) {
      if (s[key] != null && s[key] !== '') return s[key];
    }
    return '';
  };
  const dates = [];
  for (const s of sources) {
    if (!Array.isArray(s.office_entered_dates)) continue;
    for (const day of s.office_entered_dates) {
      const iso = String(day || '').slice(0, 10);
      if (iso && !dates.includes(iso)) dates.push(iso);
    }
  }
  return {
    entered: true,
    disputed: sources.some((s) => s.disputed === true),
    reason: String(pick('office_entry_reason') || ''),
    at: String(pick('office_entered_at') || ''),
    disputeReason: String(pick('dispute_reason') || ''),
    dates
  };
}

export function canDisputeOfficeEntry(entry, opts) {
  const o = opts || {};
  if (!entry || entry.entered !== true || entry.disputed === true) return false;
  if (o.submitted || o.frozen) return false;
  if (!o.groupId) return false;
  return true;
}

export function reasonOk(text) {
  const n = String(text || '').trim().length;
  return n >= 3 && n <= 500;
}
