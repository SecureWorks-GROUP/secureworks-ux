// Booking levels, without location tracking.
//   booked by the office, waiting on the trade's OK  ->  "Can you do this day?"
//   locked in (the trade said yes, or booked themselves)
//   on the way (they tapped Navigate)  ->  on site (clocked on)  ->  done
// Plus a plain list of what the office changed since the trade last looked.
import { html, useEffect, useMemo, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { getState, local, invalidate, useQuery } from '../lib/store.js';
import { queueWrite } from '../lib/outbox.js';
import { todayISO, addDays, fmtDay, fmtTime, fmtRelDay } from '../lib/dates.js';
import { jobTitle, jobAddress, bookingState } from '../lib/model.js';
import { go } from '../lib/router.js';
import { onSilenceChanges } from '../lib/data.js';
import { Icon } from '../ui/icons.js';
import { Button, Sheet, Field, Picks, Toggle, Tag, toast, openOverlay, buzz } from '../ui/kit.js';

/** A booking the office made that the trade has not said yes to yet. */
export function needsOk(b) {
  return Boolean(b && b.mine !== false && b.status === 'scheduled' && b.date && b.date >= todayISO() && !declined().includes(b.id));
}
function declined() { return local.get('declined', []); }
export function wasDeclined(id) { return declined().includes(id); }

export async function lockIn(b) {
  try {
    await api('update_my_assignment', null, { assignmentId: b.assignmentId || b.id, status: 'confirmed' });
    buzz([10, 40, 16]);
    toast(`Locked in: ${jobTitle(b.job)}, ${fmtRelDay(b.date).toLowerCase()}.`, { kind: 'ok' });
  } catch (err) {
    if (err instanceof ApiError && err.refused) { toast(friendly(err), { kind: 'bad' }); return false; }
    queueWrite({ action: 'update_my_assignment', body: { assignmentId: b.assignmentId || b.id, status: 'confirmed' }, jobId: b.jobId, label: 'Locked in ' + jobTitle(b.job) });
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
      <${Toggle} label="I am not working at all that day" hint="Shows you as off on the office calendar." checked=${off} onChange=${setOff} />
    </div>
  <//>`;
}

/** "Can you do this day?" cards for every booking waiting on the trade. */
export function NeedsOk({ bookings }) {
  const waiting = useMemo(() => bookings.filter(needsOk).sort((a, b) => a.date.localeCompare(b.date) || String(a.start || '').localeCompare(String(b.start || ''))), [bookings]);
  const [busy, setBusy] = useState(null);
  if (!waiting.length) return null;
  return html`<section class="needsok">
    <span class="t-label">${waiting.length === 1 ? 'The office booked you. Can you do it?' : `The office booked you on ${waiting.length} days. Can you do them?`}</span>
    ${waiting.slice(0, 6).map((b) => html`<div class="okcard" key=${b.id}>
      <button type="button" class="okwhat" onClick=${() => go('/job/' + b.jobId)}>
        <span class="t-label" style="color:var(--hi)">${fmtRelDay(b.date)}${b.start ? ' · ' + fmtTime(b.start) : ''}</span>
        <b>${jobTitle(b.job)}</b><span class="t-small">${jobAddress(b.job)}</span><${Tag} vertical=${b.vertical} />
      </button>
      <div class="btnrow">
        <${Button} small busy=${busy === b.id} icon="check" onClick=${async () => { setBusy(b.id); await lockIn(b); setBusy(null); }}>Yes, lock it in<//>
        <${Button} kind="soft" small onClick=${() => openCantMakeIt(b)}>Cannot make it<//>
      </div>
    </div>`)}
    ${waiting.length > 6 ? html`<p class="t-small t-mute">And ${waiting.length - 6} more further out.</p>` : null}
  </section>`;
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
export function ChangesBanner({ changes, onDismiss, onPick }) {
  if (!changes.length) return null;
  return html`<section class="changes" role="status">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="t-label" style="color:inherit">${changes.length === 1 ? 'One change to your jobs' : `${changes.length} changes to your jobs`}</span>
      <${Button} kind="quiet" small onClick=${onDismiss}>Got it<//></div>
    <ul>${changes.slice(0, 5).map((c) => html`<li key=${c.id + c.kind}><button type="button" onClick=${() => onPick(c.day)}><${Icon} name=${c.kind === 'gone' ? 'close' : c.kind === 'new' ? 'plus' : 'swap'} size=${16} stroke=${2.4} /><span>${c.text}</span></button></li>`)}</ul>
    ${changes.length > 5 ? html`<p class="t-small">And ${changes.length - 5} more.</p>` : null}
  </section>`;
}

/** The trade's own days off for a week, to mark on the week strip. */
export function useMyDaysOff(monday) {
  const user = getState().user;
  const q = useQuery('avail:mine:' + monday, () => api('get_crew_availability', { start_date: monday, end_date: addDays(monday, 6) }, null, { keepSession: true }), { ttl: 120000 });
  return useMemo(() => {
    const map = new Map();
    for (const r of (q.data && q.data.availability) || []) if (r.user_id === user.id && r.status && r.status !== 'available') map.set((r.date || '').slice(0, 10), r);
    return map;
  }, [q.data, user.id]);
}
