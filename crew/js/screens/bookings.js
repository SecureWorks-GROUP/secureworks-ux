// Booking levels, without location tracking.
//   booked by the office, waiting on the trade's OK  ->  "To confirm"
//   confirmed (the trade said yes, or booked themselves)
//   on the way (they tapped Navigate)  ->  on site (clocked on)  ->  done
// Plus a plain list of what the office changed since the trade last looked,
// and the booking row every schedule screen draws.
import { html, cx, useEffect, useMemo, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { getState, local, invalidate, useQuery } from '../lib/store.js';
import { queueWrite } from '../lib/outbox.js';
import { todayISO, addDays, fmtDay, fmtTime, fmtRelDay, fmtDow, fmtDom, tsToHM, firstName } from '../lib/dates.js';
import { jobTitle, jobAddress, bookingState, VERTICAL_LABEL } from '../lib/model.js';
import { go } from '../lib/router.js';
import { onSilenceChanges, useJob, rememberJobStub } from '../lib/data.js';
import { Button, Sheet, Field, Picks, Toggle, JobLine, StatusBadge, Section, toast, openOverlay, buzz } from '../ui/kit.js';

// ---------------------------------------------------------------- words
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
/** 'Henry Fence' -> 'Henry F.' */
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

// ---------------------------------------------------------------- status
/** A booking the office made that the trade has not said yes to yet. */
export function needsOk(b) {
  return Boolean(b && b.mine !== false && b.status === 'scheduled' && b.date && b.date >= todayISO() && !declined().includes(b.id));
}
function declined() { return local.get('declined', []); }
export function wasDeclined(id) { return declined().includes(id); }
/** One word for where a booking is at, for StatusBadge: to_confirm | confirmed | on_site | done | cannot. */
export function bookingStatus(b) {
  const st = bookingState(b);
  if (st === 'live') return 'on_site';
  if (st === 'done') return 'done';
  if (wasDeclined(b.id)) return 'cannot';
  return needsOk(b) ? 'to_confirm' : 'confirmed';
}

export function openBookingJob(b) { rememberJobStub(b.job); go('/job/' + b.jobId); }
export function openBooking(b) { rememberJobStub(b.job); go('/schedule/booking/' + encodeURIComponent(b.id)); }

/** Who else is booked on the same job that day. Reads the job once it is asked for; empty until it lands. */
export function useCrewWith(b, on = true) {
  const user = getState().user;
  const q = useJob(on && b ? b.jobId : null);
  return useMemo(() => {
    if (!b || !q.data) return [];
    const seen = new Set(); const out = [];
    for (const c of q.data.crew || []) {
      if (String(c.status || '').toLowerCase() === 'cancelled' || c.role === 'observer') continue;
      if (String(c.scheduled_date || '').slice(0, 10) !== b.date) continue;
      if (!c.user_id || c.user_id === user.id || seen.has(c.user_id)) continue;
      seen.add(c.user_id);
      out.push(shortName(c.name || (c.users && c.users.name) || c.crew_name || 'Crew'));
    }
    return out;
  }, [q.data, b && b.id, b && b.date, user.id]);
}
/** The small line under a booking: what was worked, or when it starts and who with. */
export function bookingDetail(b, mates = []) {
  const st = bookingState(b);
  if (st === 'done') {
    const span = b.clockOn && b.clockOff ? `${fmtClock(tsToHM(b.clockOn))} to ${fmtClock(tsToHM(b.clockOff))}` : '';
    return [span, b.hours ? fmtHrs(b.hours) : span ? '' : 'Worked'].filter(Boolean).join(' · ');
  }
  const first = st === 'live' ? `Clocked on ${fmtClock(tsToHM(b.clockOn))}` : b.start ? `Starts ${fmtClock(b.start)}` : 'No start time set';
  return [first, mates.length ? 'with ' + mates.slice(0, 2).join(', ') + (mates.length > 2 ? ` +${mates.length - 2}` : '') : ''].filter(Boolean).join(' · ');
}

/**
 * One booking as a record row: [day] job tag and kind, suburb, detail, status.
 * `day` shows the day cell (pass false for the second booking of a day).
 */
export function BookingItem({ booking: b, day = null, today, onOpen }) {
  const done = bookingState(b) === 'done';
  const mates = useCrewWith(b, !done && b.date >= todayISO());
  return html`<button type="button" class=${cx('item', day != null && 'day', today && 'today')} onClick=${() => (onOpen ? onOpen(b) : openBooking(b))}>
    ${day != null ? html`<span class="daycell">${day ? html`<span class="dow">${fmtDow(b.date)}</span><span class="dom">${fmtDom(b.date)}</span>` : null}</span>` : null}
    <span class="main">
      <${JobLine} job=${b.job} vertical=${b.vertical} />
      <b>${jobTitle(b.job)}</b>
      <span class="sub t-nums">${bookingDetail(b, mates)}</span>
    </span>
    <span class="side"><${StatusBadge} status=${bookingStatus(b)} /></span>
  </button>`;
}

// ---------------------------------------------------------------- confirm, cannot
export async function lockIn(b) {
  try {
    await api('update_my_assignment', null, { assignmentId: b.assignmentId || b.id, status: 'confirmed' });
    buzz([10, 40, 16]);
    toast(`Confirmed: ${jobTitle(b.job)}, ${fmtRelDay(b.date).toLowerCase()}.`, { kind: 'ok' });
  } catch (err) {
    if (err instanceof ApiError && err.refused) { toast(friendly(err), { kind: 'bad' }); return false; }
    queueWrite({ action: 'update_my_assignment', body: { assignmentId: b.assignmentId || b.id, status: 'confirmed' }, jobId: b.jobId, label: 'Confirmed ' + jobTitle(b.job) });
    toast('Saved. It will reach the office when you have signal.');
  }
  silenceNextChanges();
  invalidate('myjobs'); invalidate('job:' + b.jobId); invalidate('team');
  return true;
}

export function openCantMakeIt(b) { openOverlay((close) => html`<${CantSheet} b=${b} onClose=${close} />`); }
const REASONS = ['On another job', 'Sick', 'Day off', 'Too far', 'Something else'];
function CantSheet({ b, onClose }) {
  const [reason, setReason] = useState(null); const [more, setMore] = useState(''); const [off, setOff] = useState(false); const [busy, setBusy] = useState(false);
  const send = async (shut) => {
    setBusy(true);
    const user = getState().user;
    const detail = `${user.name} cannot do ${fmtDay(b.date)}: ${reason}${more.trim() ? '. ' + more.trim() : ''}`;
    const body = { jobId: b.jobId, issueType: 'Cannot do this day', detail, notify_telegram: true };
    try { await api('create_trade_alert', null, body); } catch (err) {
      if (err instanceof ApiError && err.refused) { toast(friendly(err), { kind: 'bad' }); setBusy(false); return; }
      queueWrite({ action: 'create_trade_alert', body, jobId: b.jobId, label: 'Cannot do ' + fmtDay(b.date) });
    }
    if (off) {
      const avail = { user_id: user.id, dates: [{ date: b.date, status: 'unavailable', note: reason }] };
      try { await api('set_availability', null, avail); } catch (err) { if (!(err instanceof ApiError && err.refused)) queueWrite({ action: 'set_availability', body: avail, label: 'Day off ' + fmtDay(b.date) }); }
      invalidate('avail');
    }
    local.set('declined', [...declined().filter((x) => x !== b.id), b.id].slice(-60));
    invalidate('myjobs');
    setBusy(false); shut();
    toast('The office knows. They will move it or call you.', { kind: 'ok', ms: 4500 });
  };
  return html`<${Sheet} title="Cannot make it" sub=${`${jobTitle(b.job)}, ${fmtDay(b.date)}. The office is told straight away so they can rebook it.`} onClose=${onClose}
    foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!reason} onClick=${() => send(shut)}>Tell the office<//>`}>
    <div class="stack">
      <${Field} label="Why not?"><${Picks} value=${reason} options=${REASONS.map((r) => [r, r])} onChange=${setReason} /><//>
      <${Field} label="Anything to add? (optional)"><input class="input" value=${more} onInput=${(e) => setMore(e.currentTarget.value)} /><//>
      <${Toggle} label="I am not working at all that day" hint="Shows you as unavailable on the office calendar." checked=${off} onChange=${setOff} />
    </div>
  <//>`;
}

/** "Bookings to confirm": every booking waiting on the trade, each opening its booking screen. */
export function NeedsOk({ bookings, skip }) {
  const waiting = useMemo(() => bookings.filter((b) => needsOk(b) && b !== skip && (!skip || b.id !== skip.id))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.start || '').localeCompare(String(b.start || ''))), [bookings, skip && skip.id]);
  if (!waiting.length) return null;
  return html`<${Section} label="Bookings to confirm" right=${html`<span class="t-small t-strong t-nums">${waiting.length}</span>`}>
    <div class="block card">
      ${waiting.slice(0, 6).map((b) => html`<button type="button" class="item" key=${b.id} onClick=${() => openBooking(b)}>
        <span class="main">
          <b class="t-nums">${fmtDay(b.date)}${b.start ? ' · ' + fmtClock(b.start) : ''}</b>
          <${JobLine} job=${b.job}>${[VERTICAL_LABEL[b.vertical], jobTitle(b.job)].filter(Boolean).join(' · ')}<//>
        </span>
        <span class="side"><${StatusBadge} status="to_confirm" /></span>
      </button>`)}
    </div>
    ${waiting.length > 6 ? html`<p class="block t-small" style="margin-top:8px;padding:0 4px">And ${waiting.length - 6} more further out. They are all in Schedule.</p>` : null}
  <//>`;
}

/** Tell the office the trade is heading to site. No location is read or sent. */
export function markOnTheWay(b) {
  if (!b || b.date !== todayISO() || bookingState(b) !== 'booked') return;
  const id = b.assignmentId || b.id;
  const sent = local.get('ontheway', {});
  if (sent[id] === todayISO()) return;
  local.set('ontheway', { [id]: todayISO() });
  api('update_job_phase', null, { assignmentId: id, phase: 'travelling' }).then(() => { invalidate('team'); }).catch(() => {});
}

// ---------------------------------------------------------------- changes
let silent = false;
/** The trade just changed their own bookings: do not report that back to them as news. */
export function silenceNextChanges() { silent = true; }
onSilenceChanges(silenceNextChanges);
function snapshotOf(bookings) {
  const today = todayISO(); const out = {};
  for (const b of bookings) if (b.mine !== false && b.date >= today) out[b.id] = { d: b.date, s: b.start || '', t: jobTitle(b.job), j: b.jobId };
  return out;
}
/** What the office changed since the trade last looked: new, moved and removed bookings. */
export function useBookingChanges(bookings, fresh) {
  const [changes, setChanges] = useState([]);
  useEffect(() => {
    if (!fresh) return;
    const now = snapshotOf(bookings);
    const seen = local.get('seen', null);
    if (!seen || silent) { silent = false; local.set('seen', now); setChanges([]); return; }
    const today = todayISO(); const list = [];
    for (const [id, b] of Object.entries(now)) {
      const was = seen[id];
      if (!was) list.push({ id, kind: 'new', text: `New: ${b.t}, ${fmtDay(b.d)}${b.s ? ' at ' + fmtTime(b.s) : ''}`, day: b.d });
      else if (was.d !== b.d) list.push({ id, kind: 'moved', text: `${b.t} moved from ${fmtDay(was.d)} to ${fmtDay(b.d)}`, day: b.d });
      else if (was.s !== b.s && b.s) list.push({ id, kind: 'time', text: `${b.t} on ${fmtDay(b.d)} now starts ${fmtTime(b.s)}`, day: b.d });
    }
    for (const [id, was] of Object.entries(seen)) if (!now[id] && was.d >= today) list.push({ id, kind: 'gone', text: `${was.t} on ${fmtDay(was.d)} is off your list`, day: was.d });
    setChanges(list);
  }, [bookings, fresh]);
  const dismiss = () => { local.set('seen', snapshotOf(bookings)); setChanges([]); };
  return { changes, dismiss };
}
const CHANGE_WORD = { new: 'New', moved: 'Moved', time: 'Time', gone: 'Removed' };
export function ChangesBanner({ changes, onDismiss, onPick }) {
  if (!changes.length) return null;
  return html`<section class="block changes" role="status">
    <div class="changes-h"><span class="t-strong">${changes.length === 1 ? 'The office changed 1 booking' : `The office changed ${changes.length} bookings`}</span>
      <button type="button" class="link tap" onClick=${onDismiss}>Got it</button></div>
    <ul>${changes.slice(0, 5).map((c) => html`<li key=${c.id + c.kind}><button type="button" onClick=${() => onPick(c.day)}><span class="badge">${CHANGE_WORD[c.kind]}</span><span>${c.text.replace(/^New: /, '')}</span></button></li>`)}</ul>
    ${changes.length > 5 ? html`<p class="t-small">And ${changes.length - 5} more.</p>` : null}
  </section>`;
}

/** The trade's own days off from `from` (a Monday by default: that week) to `to`, keyed by date. */
export function useMyDaysOff(from, to) {
  const user = getState().user;
  const end = to || addDays(from, 6);
  const q = useQuery('avail:mine:' + from + (to ? ':' + to : ''), () => api('get_crew_availability', { start_date: from, end_date: end }, null, { keepSession: true }), { ttl: 120000 });
  return useMemo(() => {
    const map = new Map();
    for (const r of (q.data && q.data.availability) || []) if (r.user_id === user.id && r.status && r.status !== 'available') map.set((r.date || '').slice(0, 10), r);
    return map;
  }, [q.data, user.id]);
}
export { firstName };
