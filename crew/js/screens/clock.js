// Clocking on and off. One clock runs at a time. The server stamps the real
// times; at clock off the trade confirms start, finish and break once, and
// those saved times are what fill their invoice later.
import { html, useEffect, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { getState, setState, local, invalidate, useStore } from '../lib/store.js';
import { queueWrite } from '../lib/outbox.js';
import { todayISO, tsToDate, tsToHM, nowHM, hoursBetween, fmtHours, elapsedParts, now } from '../lib/dates.js';
import { jobTitle } from '../lib/model.js';
import { Sheet, Button, Picks, TimeInput, BREAKS, toast, openOverlay, buzz, Field } from '../ui/kit.js';
import { go } from '../lib/router.js';

function key() { return crypto.randomUUID ? crypto.randomUUID() : 'ik-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
function position() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const t = setTimeout(() => resolve(null), 2500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }); },
      () => { clearTimeout(t); resolve(null); },
      { timeout: 2400, maximumAge: 60000 }
    );
  });
}

function setClock(clock) {
  if (clock) local.set('clock', clock); else local.del('clock');
  setState({ clock });
}
/** Adopt what the server says is running (called after every jobs load). */
export function syncClock(running) {
  const cur = getState().clock;
  if (running) {
    if (!cur || cur.assignmentId !== running.id || cur.pending) setClock({ assignmentId: running.id, jobId: running.jobId, since: running.clockOn, title: jobTitle(running.job), breakMin: running.breakMin || 0 });
  } else if (cur && !cur.pending) setClock(null);
}
export function restoreClock() { const saved = local.get('clock'); if (saved) setState({ clock: saved }); }

/** Clock on to a booking. Resolves true when the clock is running (or queued). */
export async function clockOn(booking) {
  const cur = getState().clock;
  if (cur && cur.assignmentId !== booking.id) { toast(`You are still clocked on at ${cur.title}. Clock off there first.`, { kind: 'bad' }); return false; }
  const body = { assignment_id: booking.assignmentId || booking.id, event: 'clock_on', timestamp: now().toISOString(), idempotency_key: key(), break_minutes: 0 };
  const loc = await position(); if (loc) body.location = loc;
  const local_ = { assignmentId: body.assignment_id, jobId: booking.jobId, since: body.timestamp, title: jobTitle(booking.job), breakMin: 0 };
  try {
    const res = await api('clock_event', null, body);
    if (res && res.success === false) throw new ApiError(res.error || 'Could not clock on', { status: 409, body: res });
    const a = (res && res.assignment) || {};
    setClock({ ...local_, since: a.clocked_on_at || body.timestamp });
    buzz([14, 50, 30]);
    toast('Clocked on. Have a good one.', { kind: 'ok' });
  } catch (err) {
    if (err instanceof ApiError && err.refused) { toast(clockRefusal(err), { kind: 'bad', ms: 6000 }); return false; }
    queueWrite({ action: 'clock_event', body, jobId: booking.jobId, label: 'Clock on' });
    setClock({ ...local_, pending: true });
    toast('Clocked on. No signal, so it will send when you are back in range.');
  }
  invalidate('myjobs'); invalidate('job:' + booking.jobId); invalidate('hours');
  return true;
}
function clockRefusal(err) {
  const code = err.body && err.body.code;
  if (code === 'job_deposits_unpaid') return 'This job cannot start yet: the customer deposit is not paid. Call the office.';
  if (code === 'job_not_accepted' || code === 'job_not_yet_accepted') return 'This job cannot start yet: the quote is not accepted. Call the office.';
  return friendly(err);
}

/** Open the clock-off sheet for the running clock (or a given booking). */
export function openClockOff(opts = {}) {
  const clock = getState().clock;
  if (!clock) return;
  openOverlay((close) => html`<${ClockOffSheet} clock=${clock} onClose=${close} onDone=${opts.onDone} />`);
}

function ClockOffSheet({ clock, onClose, onDone }) {
  const sameDay = tsToDate(clock.since) === todayISO();
  const [start, setStart] = useState(sameDay ? roundHM(tsToHM(clock.since)) : '');
  const [finish, setFinish] = useState(roundHM(nowHM()));
  const [brk, setBrk] = useState(clock.breakMin > 0 ? clock.breakMin : null);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const breakMin = brk === 'other' ? Number(other) || 0 : brk;
  const hours = brk == null ? NaN : hoursBetween(start, finish, breakMin);
  const ok = !isNaN(hours) && hours > 0 && hours <= 24;

  const save = async (shut, withTimes) => {
    setBusy(true);
    const body = { assignment_id: clock.assignmentId, event: 'clock_off', timestamp: now().toISOString(), idempotency_key: key(), break_minutes: withTimes ? breakMin : clock.breakMin || 0 };
    const loc = await position(); if (loc) body.location = loc;
    const timesBody = withTimes ? { jobId: clock.jobId, assignmentId: clock.assignmentId, work_date: todayISO(), start_time: start, finish_time: finish, break_minutes: breakMin, hours, source: 'clock_off' } : null;
    let queued = false;
    try {
      const res = await api('clock_event', null, body);
      if (res && res.success === false) throw new ApiError(res.error || 'Could not clock off', { status: 409, body: res });
    } catch (err) {
      if (err instanceof ApiError && err.refused) { setBusy(false); toast('Not saved: ' + friendly(err) + ' Ask the office to fix this clock.', { kind: 'bad', ms: 7000 }); return; }
      queueWrite({ action: 'clock_event', body, jobId: clock.jobId, label: 'Clock off' });
      queued = true;
    }
    if (timesBody) {
      if (queued) queueWrite({ action: 'log_my_job_hours', body: timesBody, jobId: clock.jobId, label: 'Hours for ' + clock.title });
      else {
        try {
          const r = await api('log_my_job_hours', null, timesBody);
          if (r && r.ok === false) throw new ApiError(r.error || r.message || 'Times not saved', { status: 409, body: r });
        } catch (err) {
          if (err instanceof ApiError && err.refused) toast('Clocked off, but your times were not saved: ' + friendly(err) + ' Add them on your invoice.', { kind: 'bad', ms: 7000 });
          else queueWrite({ action: 'log_my_job_hours', body: timesBody, jobId: clock.jobId, label: 'Hours for ' + clock.title });
        }
      }
    }
    setClock(null);
    invalidate('myjobs'); invalidate('job:' + clock.jobId); invalidate('hours');
    buzz([10, 40, 10]);
    setBusy(false);
    shut();
    if (onDone) onDone({ hours: withTimes ? hours : null, queued });
    else toast(withTimes ? `Clocked off. ${fmtHours(hours)} saved for your invoice.` : 'Clocked off.', { kind: 'ok', action: { label: 'Pay', run: () => go('/pay') } });
  };

  return html`<${Sheet} title="Clock off" sub=${clock.title} onClose=${onClose}
    foot=${(shut) => html`
      <${Button} block busy=${busy} disabled=${!ok} onClick=${() => save(shut, true)}>${ok ? `Clock off, save ${fmtHours(hours)}` : 'Clock off'}<//>
      <${Button} kind="quiet" block disabled=${busy} onClick=${() => save(shut, false)}>Clock off, I will add times later<//>`}>
    <div class="stack">
      ${sameDay ? null : html`<div class="note-banner">You clocked on before today. Put in the start time you worked today.</div>`}
      <div class="timegrid">
        <${TimeInput} label="Started" value=${start} onInput=${setStart} />
        <${TimeInput} label="Finished" value=${finish} onInput=${setFinish} />
      </div>
      <${Field} label="Break">
        <${Picks} value=${brk} options=${[...BREAKS, ['other', 'Other']]} onChange=${setBrk} />
      <//>
      ${brk === 'other' ? html`<${Field} label="Break in minutes"><input class="input" type="number" inputmode="numeric" min="0" max="600" value=${other} onInput=${(e) => setOther(e.currentTarget.value)} /><//>` : null}
      <div class="hoursout"><span class="t-label">Hours today</span><b class=${ok ? '' : 'words'}>${ok ? fmtHours(hours) : brk == null ? 'Pick a break' : 'Check the times'}</b></div>
    </div>
  <//>`;
}
/** Round to the nearest 5 minutes, which is how trades give times. */
function roundHM(hm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hm || ''); if (!m) return '';
  let mins = Math.round((Number(m[1]) * 60 + Number(m[2])) / 5) * 5;
  mins = Math.min(mins, 23 * 60 + 55);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** Live "h:mm" (and seconds) since a timestamp, repainting each second. */
export function useElapsed(since, breakMin = 0) {
  const [, tick] = useState(0);
  useEffect(() => { if (!since) return undefined; const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, [since]);
  return since ? elapsedParts(since, breakMin) : { h: 0, m: '00', s: '00' };
}

/** The bar above the tabs while a clock is running. */
export function ClockBar() {
  const clock = useStore((s) => s.clock);
  const t = useElapsed(clock && clock.since);
  if (!clock) return null;
  return html`<div class="clockbar">
    <i class="pulse" />
    <button type="button" class="where" onClick=${() => go('/job/' + clock.jobId)}><b class="clip">${clock.title}</b><span>${clock.pending ? 'On the clock, waiting for signal' : 'On the clock'}</span></button>
    <span class="timer">${t.h}:${t.m}</span>
    <button type="button" class="off" onClick=${() => openClockOff()}>Clock off</button>
  </div>`;
}
