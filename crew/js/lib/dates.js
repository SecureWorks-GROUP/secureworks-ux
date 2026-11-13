// Dates, times and money. Everything a trade sees is Perth time (UTC+8, no
// daylight saving), whatever the phone's own clock zone says.

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let clockSkew = 0; // demo and tests can pin "now"
export function setNow(date) { clockSkew = date ? date.getTime() - Date.now() : 0; }
export function now() { return new Date(Date.now() + clockSkew); }

function perthParts(date) {
  const p = new Date(date.getTime() + PERTH_OFFSET_MS);
  return { y: p.getUTCFullYear(), m: p.getUTCMonth(), d: p.getUTCDate(), hh: p.getUTCHours(), mm: p.getUTCMinutes(), dow: p.getUTCDay() };
}
const pad = (n) => String(n).padStart(2, '0');

/** Today's date in Perth, 'YYYY-MM-DD'. */
export function todayISO() { return tsToDate(now()); }
/** Perth date of a timestamp (Date or ISO string). */
export function tsToDate(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d)) return '';
  const p = perthParts(d);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
}
/** Perth 'HH:MM' of a timestamp. */
export function tsToHM(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d)) return '';
  const p = perthParts(d);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}
export function nowHM() { return tsToHM(now()); }

function utc(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
export function isISODate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10)) && !isNaN(utc(v)); }
export function addDays(iso, n) {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a, b) { return Math.round((utc(a) - utc(b)) / 86400000); }
export function dowOf(iso) { return utc(iso).getUTCDay(); }
export function mondayOf(iso) {
  const dow = dowOf(iso);
  return addDays(iso, -(dow === 0 ? 6 : dow - 1));
}
export function sundayOf(iso) { return addDays(mondayOf(iso), 6); }
export function weekDays(monday) { return [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n)); }
export function monthStart(iso) { return iso.slice(0, 8) + '01'; }
export function addMonths(iso, n) {
  const d = utc(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
/** 6 rows x 7 days starting on the Monday on or before the 1st. */
export function monthGrid(iso) {
  const first = monthStart(iso);
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function fmtDow(iso) { return DOW[dowOf(iso)]; }
export function fmtDom(iso) { return utc(iso).getUTCDate(); }
/** 'Fri 13 Nov' */
export function fmtDay(iso) { const d = utc(iso); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; }
/** 'Friday 13 November' */
export function fmtDayLong(iso) { const d = utc(iso); return `${DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MON_LONG[d.getUTCMonth()]}`; }
/** '13 Nov' (adds the year when it is not this year) */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = utc(iso);
  const y = d.getUTCFullYear();
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${y !== utc(todayISO()).getUTCFullYear() ? ' ' + y : ''}`;
}
export function fmtMonth(iso) { const d = utc(iso); return `${MON_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export function fmtDowLong(iso) { return DOW_LONG[dowOf(iso)]; }
/** 'Today', 'Tomorrow', 'Yesterday', else 'Fri 13 Nov' */
export function fmtRelDay(iso) {
  const n = diffDays(iso, todayISO());
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return fmtDay(iso);
}
/** 'Mon 9 to Sun 15 Nov' */
export function fmtWeek(monday) {
  const a = utc(monday); const b = utc(addDays(monday, 6));
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  return `${a.getUTCDate()}${sameMonth ? '' : ' ' + MON[a.getUTCMonth()]} to ${b.getUTCDate()} ${MON[b.getUTCMonth()]}`;
}
/** '07:30' or '07:30:00' -> '7:30am' */
export function fmtTime(hm) {
  if (!hm) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm));
  if (!m) return '';
  let h = Number(m[1]); const min = m[2];
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return min === '00' ? `${h}${ap}` : `${h}:${min}${ap}`;
}
export function fmtTs(ts) { return ts ? `${fmtRelDay(tsToDate(ts))}, ${fmtTime(tsToHM(ts))}` : ''; }
export function hmToMinutes(hm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
/** Hours worked from start, finish and break. NaN when not a real span. */
export function hoursBetween(start, finish, breakMinutes = 0) {
  const a = hmToMinutes(start); const b = hmToMinutes(finish);
  if (isNaN(a) || isNaN(b) || b <= a) return NaN;
  const mins = b - a - (Number(breakMinutes) || 0);
  return mins > 0 ? Math.round((mins / 60) * 100) / 100 : NaN;
}
/** 7.5 -> '7.5 h'; 7.25 -> '7.25 h'; 8 -> '8 h' */
export function fmtHours(h) {
  if (h == null || isNaN(h)) return '';
  const r = Math.round(Number(h) * 100) / 100;
  return `${String(r)} h`;
}
/** Running timer text from a start timestamp: '2:07' (h:mm) and seconds. */
export function elapsedParts(ts, breakMinutes = 0) {
  const ms = Math.max(0, now().getTime() - new Date(ts).getTime() - (breakMinutes || 0) * 60000);
  const total = Math.floor(ms / 1000);
  return { h: Math.floor(total / 3600), m: pad(Math.floor((total % 3600) / 60)), s: pad(total % 60) };
}

/** '$1,234.50'; whole dollars drop the cents unless asked. null -> '' */
export function fmtMoney(n, { cents = 'auto' } = {}) {
  if (n == null || n === '' || isNaN(Number(n))) return '';
  const v = Number(n);
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  const digits = cents === true || (cents === 'auto' && !whole) ? 2 : 0;
  const s = Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? '-' : ''}$${s}`;
}
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
export function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
