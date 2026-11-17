// Clocking on and off. One clock runs at a time. The server stamps the real
// times; at clock off the trade confirms start, finish and break once, and
// those saved times are what fill their timesheet later.
import { html, cx, useEffect, useRef, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { getState, setState, local, invalidate, useStore, peekQuery } from '../lib/store.js';
import { queueWrite } from '../lib/outbox.js';
import { todayISO, tsToDate, tsToHM, nowHM, hoursBetween, elapsedParts, now, mondayOf } from '../lib/dates.js';
import { jobTitle, jobAddress, verticalOf, isReportJob, jobIsClosed } from '../lib/model.js';
import { Sheet, Button, JobLine, BREAKS, toast, openOverlay, buzz, Picks, Field } from '../ui/kit.js';
import { go } from '../lib/router.js';
import { fmtClock, fmtHrs, fmtDayYear, fmtWeekShort, fmtElapsed } from './words.js';

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
// P1-16.2 adds this block only while trade_week_autofill_v1 is on. No
// additional read on a clock press; an absent answer keeps the existing flow.
function clockHours(clock) {
  const week = mondayOf(clock ? tsToDate(clock.since) : todayISO());
  const hours = peekQuery('hours:' + week) || peekQuery('hours:' + mondayOf(todayISO()));
  return hours && hours.week_summary ? hours : null;
}
export function isForgottenClock(clock) {
  return Boolean(clock && tsToDate(clock.since) < todayISO() && clockHours(clock));
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
  if (isForgottenClock(cur)) {
    openClockOff({ onDone: ({ queued }) => {
      if (queued) { toast('The earlier times are saved on this phone. Clock on when they have sent.'); return; }
      clockOn(booking);
    } });
    return false;
  }
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

/** The job a running clock is on, from whatever is already loaded. May be null. */
function clockJob(clock) {
  const detail = peekQuery('job:' + clock.jobId);
  if (detail && detail.job) return detail.job;
  const stub = peekQuery('stub:' + clock.jobId);
  if (stub) return stub;
  const mine = peekQuery('myjobs');
  for (const bucket of ['today', 'thisWeek', 'upcoming', 'recent', 'recentCompleted']) {
    for (const a of (mine && mine[bucket]) || []) { const j = a && (a.jobs || a.job); if (j && j.id === clock.jobId) return j; }
  }
  return null;
}

/** Break taken so far today. Kept on this phone until clock off, when it is sent with the times. */
export function openBreak() {
  const clock = getState().clock;
  if (!clock) return;
  openOverlay((close) => html`<${BreakSheet} clock=${clock} onClose=${close} />`);
}
function BreakSheet({ clock, onClose }) {
  const [brk, setBrk] = useState(clock.breakMin || 0);
  return html`<${Sheet} title="Break" sub="How long have you stopped for today? It comes off your hours when you clock off." onClose=${onClose}
    foot=${(shut) => html`<${Button} kind="line" block onClick=${() => { const cur = getState().clock; if (cur) setClock({ ...cur, breakMin: brk }); shut(); toast(brk ? `Break set: ${brk} min.` : 'No break set.', { kind: 'ok' }); }}>Save break<//>`}>
    <${Field} label="Break so far"><${Picks} value=${brk} options=${BREAKS} onChange=${setBrk} /><//>
  <//>`;
}

/** Open the clock-off sheet for the running clock. `onDone` is for a flow that carries on by itself (finishing a job). */
export function openClockOff(opts = {}) {
  const clock = getState().clock;
  if (!clock) return;
  openOverlay((close) => html`<${ClockOffSheet} clock=${clock} onClose=${close} onDone=${opts.onDone} />`);
}

function ClockOffSheet({ clock, onClose, onDone }) {
  const today = todayISO();
  const sameDay = tsToDate(clock.since) === today;
  const [defaults] = useState(() => {
    const hours = clockHours(clock);
    const forgotten = Boolean(hours && tsToDate(clock.since) < today);
    const card = ((hours && hours.assignments) || []).find((a) => a.id === clock.assignmentId);
    const suggestion = card && card.suggestion;
    const fallbackEnd = new Date(Date.parse(clock.since) + 8 * 60 * 60 * 1000);
    const usual = hours && hours.usual_break_minutes;
    const brk = clock.breakMin > 0 ? clock.breakMin : !hours ? null
      : forgotten && !(suggestion && suggestion.finish_time) ? 30
      : Number.isFinite(usual) && usual >= 0 ? usual
      : now().getTime() - Date.parse(clock.since) > 5 * 60 * 60 * 1000 ? 30 : 0;
    return { enabled: Boolean(hours), forgotten, brk,
      finish: forgotten ? (suggestion && suggestion.finish_time) || (tsToDate(fallbackEnd) === tsToDate(clock.since) ? tsToHM(fallbackEnd) : '23:55') : roundHM(nowHM()) };
  });
  const workDate = defaults.forgotten ? tsToDate(clock.since) : today;
  const day = fmtDayYear(workDate);
  const [start, setStart] = useState(defaults.forgotten ? tsToHM(clock.since) : sameDay ? roundHM(tsToHM(clock.since)) : '');
  const [finish, setFinish] = useState(defaults.finish);
  const [brk, setBrk] = useState(defaults.brk == null ? null : BREAKS.some(([v]) => v === defaults.brk) ? defaults.brk : 'other');
  const [other, setOther] = useState(defaults.brk != null && !BREAKS.some(([v]) => v === defaults.brk) ? String(defaults.brk) : '');
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const clockStopped = useRef(false);
  const [recorded] = useState(() => `${fmtClock(tsToHM(clock.since))} to ${fmtClock(nowHM())}`);
  const breakMin = brk === 'other' ? Number(other) || 0 : brk;
  const hours = brk == null ? NaN : hoursBetween(start, finish, breakMin);
  const ok = !isNaN(hours) && hours > 0 && hours <= 24;
  const job = clockJob(clock);
  const vertical = job ? verticalOf(job) : 'other';
  const report = isReportJob(vertical);
  // Asking "is the job finished?" only makes sense here when nothing else is already finishing it.
  const canFinish = !onDone && Boolean(job) && !jobIsClosed(job.status);

  const save = async (shut, withTimes) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    const body = { assignment_id: clock.assignmentId, event: 'clock_off', timestamp: now().toISOString(), idempotency_key: key(), break_minutes: withTimes ? breakMin : clock.breakMin || 0 };
    const loc = await position(); if (loc) body.location = loc;
    const timesBody = withTimes ? { jobId: clock.jobId, assignmentId: clock.assignmentId, work_date: defaults.forgotten ? workDate : todayISO(), start_time: start, finish_time: finish, break_minutes: breakMin, hours, source: defaults.forgotten ? 'clock_off_suggested' : 'clock_off' } : null;
    let queued = false;
    try {
      const res = clockStopped.current ? null : await api('clock_event', null, body);
      if (res && res.success === false) throw new ApiError(res.error || 'Could not clock off', { status: 409, body: res });
      if (defaults.enabled) clockStopped.current = true;
    } catch (err) {
      if (err instanceof ApiError && err.refused) { saving.current = false; setBusy(false); toast('Not saved: ' + friendly(err) + ' Ask the office to fix this clock.', { kind: 'bad', ms: 7000 }); return; }
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
          if (err instanceof ApiError && err.refused) {
            toast('Clocked off, but your times were not saved: ' + friendly(err) + (defaults.enabled ? ' Check the times and save again.' : ' Add them on your timesheet.'), { kind: 'bad', ms: 7000 });
            if (defaults.enabled) { saving.current = false; setBusy(false); return; }
          }
          else {
            if (defaults.enabled) queued = true;
            queueWrite({ action: 'log_my_job_hours', body: timesBody, jobId: clock.jobId, label: 'Hours for ' + clock.title });
          }
        }
      }
    }
    setClock(null);
    invalidate('myjobs'); invalidate('job:' + clock.jobId); invalidate('hours');
    buzz([10, 40, 10]);
    setBusy(false);
    shut();
    if (onDone) { onDone({ hours: withTimes ? hours : null, queued }); return; }
    toast(withTimes ? `Clocked off. ${fmtHrs(hours)} saved to your timesheet.` : 'Clocked off. Add your times on your timesheet.', { kind: 'ok', action: finished && canFinish ? null : { label: 'Timesheet', run: () => go('/pay/week/' + mondayOf(workDate)) } });
    if (finished && canFinish) setTimeout(() => go(`/job/${clock.jobId}/${report ? 'report' : 'finish'}`), 240);
  };

  return html`<${Sheet} tall title=${defaults.forgotten ? `You did not clock off on ${day}` : 'Clock off'} onClose=${onClose}
    foot=${(shut) => html`
      <${Button} class="big" block busy=${busy} disabled=${!ok} onClick=${() => save(shut, true)}>${defaults.enabled ? `${defaults.forgotten ? 'Save ' + day : 'Clock off'} · ${ok ? fmtHrs(hours) : 'check times'}` : 'Save to timesheet'}<//>
      <p class="t-small clockoff-goes">${ok ? `Goes on your timesheet for pay week ${fmtWeekShort(mondayOf(workDate))}.` : brk == null ? 'Choose your break to save.' : 'Check the start and finish times.'}</p>
      ${defaults.forgotten ? null : html`<button type="button" class="link tap clockoff-later" disabled=${busy} onClick=${() => save(shut, false)}>Clock off now, add times later</button>`}`}>
    <div class="clockoff">
      <div class="card clockoff-job">
        <${JobLine} job=${job || {}} vertical=${job ? vertical : null} />
        <b class="t-head">${job ? jobAddress(job) || jobTitle(job) : clock.title}</b>
      </div>

      <section>
        <h3 class="t-cap">Time worked</h3>
        <div class="card">
          <div class="frow"><span>Date</span><span class="t-value nums">${day}</span></div>
          <label class="frow"><span>Start</span><input class="input" type="time" step="300" value=${start} onInput=${(e) => setStart(e.currentTarget.value)} /></label>
          <label class="frow"><span>Finish</span><input class="input" type="time" step="300" value=${finish} onInput=${(e) => setFinish(e.currentTarget.value)} /></label>
          <label class="frow"><span>Break</span><select class=${cx('input', brk == null && 'unset')} value=${brk == null ? '' : String(brk)} onChange=${(e) => { const v = e.currentTarget.value; setBrk(v === '' ? null : v === 'other' ? 'other' : Number(v)); }}>
            <option value="">Choose</option>${BREAKS.map(([v, label]) => html`<option value=${String(v)}>${label}</option>`)}<option value="other">Other</option>
          </select></label>
          ${brk === 'other' ? html`<label class="frow"><span>Break in minutes</span><input class="input" type="number" inputmode="numeric" min="0" max="600" value=${other} onInput=${(e) => setOther(e.currentTarget.value)} /></label>` : null}
          <div class="frow total"><span>Hours</span><span class=${ok ? 't-figure' : 't-small'}>${ok ? fmtHrs(hours) : brk == null ? 'Choose your break' : 'Check the times'}</span></div>
        </div>
        <p class="t-small clockoff-note">${defaults.forgotten ? 'Suggested finish. Change it if it is wrong.' : sameDay ? `The clock recorded ${recorded}. Check the times before you save.` : 'You clocked on before today. Put in the start time you worked today.'}</p>
      </section>

      ${canFinish ? html`<section>
        <h3 class="t-cap">Is the job finished?</h3>
        <div class="choice2" role="group" aria-label="Is the job finished?">
          <button type="button" aria-pressed=${String(!finished)} onClick=${() => { buzz(6); setFinished(false); }}>More days to go</button>
          <button type="button" aria-pressed=${String(finished)} onClick=${() => { buzz(6); setFinished(true); }}>${report ? 'Finished, send report' : 'Finished, sign off'}</button>
        </div>
        ${finished ? html`<p class="t-small clockoff-note">${report ? 'After you save, the report opens.' : 'After you save, the sign off opens: photos and the customer signature.'}</p>` : null}
      </section>` : null}
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
    <button type="button" class="where" onClick=${() => go('/job/' + clock.jobId)}><b class="clip">${clock.title}</b><span>${clock.pending ? 'On site, waiting for signal' : 'On site'}</span></button>
    <span class="timer">${fmtElapsed(t)}</span>
    <button type="button" class="off" onClick=${() => openClockOff()}>Clock off</button>
  </div>`;
}
