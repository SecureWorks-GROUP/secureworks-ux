// Small wording helpers the schedule and clock screens share: times with a
// space before am or pm, hours with their unit, dates with their year.
// No screen code and no reads in here, so anything may import it.
import { addDays, fmtDay } from '../lib/dates.js';

/** '07:00' -> '7:00 am' */
export function fmtClock(hm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || ''));
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'pm' : 'am'}`;
}
/** 8 -> '8.0 h'; 6.5 -> '6.5 h'; 2.58 -> '2.58 h' */
export function fmtHrs(h) {
  if (h == null || h === '' || isNaN(Number(h))) return '';
  const r = Math.round(Number(h) * 100) / 100;
  return `${Math.abs(r * 10 - Math.round(r * 10)) < 0.001 ? r.toFixed(1) : r.toFixed(2)} h`;
}
/** 'Fri 13 Nov 2026' */
export function fmtDayYear(iso) { return iso ? `${fmtDay(iso)} ${String(iso).slice(0, 4)}` : ''; }
/** '9 to 15 Nov 2026' */
export function fmtWeekYear(monday) {
  const sunday = addDays(monday, 6);
  const a = fmtDay(monday).split(' '); const b = fmtDay(sunday).split(' ');
  return `${a[1]}${a[2] === b[2] ? '' : ' ' + a[2]} to ${b[1]} ${b[2]} ${sunday.slice(0, 4)}`;
}
/** '9 to 15 Nov' */
export function fmtWeekShort(monday) { return fmtWeekYear(monday).replace(/ \d{4}$/, ''); }
/** 'Henry Fence' -> 'Henry F.' */
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}
/** { h: 3, m: '41' } -> '3 h 41 min' */
export function fmtElapsed(t) { return t.h > 0 ? `${t.h} h ${Number(t.m)} min` : `${Number(t.m)} min`; }
