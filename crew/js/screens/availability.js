// Days you cannot work. One calendar shows the three things that matter:
// free, booked and off. Tap a day to change it: working, cannot work, leave.
// The office sees days off when it books crew. Marking a day off never takes
// you off a job by itself, so a booked day asks first and tells the office.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useStore, invalidate, mutateQuery } from '../lib/store.js';
import { useMyBookings } from '../lib/data.js';
import { queueWrite } from '../lib/outbox.js';
import { back } from '../lib/router.js';
import { todayISO, addDays, addMonths, monthStart, monthGrid, dowOf, diffDays, fmtDom, fmtDow, fmtDay, fmtDayLong, fmtDate, fmtMonth, fmtDowLong } from '../lib/dates.js';
import { jobTitle } from '../lib/model.js';
import { useAvailability } from '../lib/roster.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, IconButton, Sheet, Picks, Skel, LoadError, toast, ask, openOverlay, buzz } from '../ui/kit.js';

const AHEAD = 90;          // how far ahead the calendar reaches
const PATTERN_DAYS = 60;   // a weekly day off is written out this far ahead
const PATTERN_NOTE = 'Weekly pattern';
const NEXT = { available: 'unavailable', unavailable: 'leave', leave: 'available' };
const WORD = { available: 'Working', unavailable: 'Cannot work', leave: 'Leave' };
const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const FREE = { status: 'available', note: '' };
const same = (a, b) => a.status === b.status && (a.note || '') === (b.note || '');
const short = (d) => `${fmtDow(d)} ${fmtDom(d)}`;

export function Availability() {
  const user = useStore((s) => s.user);
  const today = todayISO();
  const last = addDays(today, AHEAD);
  const q = useAvailability(today, last);
  const { bookings } = useMyBookings();
  const [edits, setEdits] = useState({});
  const [tell, setTell] = useState({});     // booked days marked off: the office is told on save
  const [touched, setTouched] = useState(null);
  const [month, setMonth] = useState(monthStart(today));
  const [busy, setBusy] = useState(false);
  const [carried, setCarried] = useState(0);
  const toppedUp = useRef(false);
  const hold = useRef({ timer: null, fired: false });

  const saved = useMemo(() => {
    const map = {};
    for (const r of q.data || []) if (r.user_id === user.id && r.status !== 'available') map[r.date] = { status: r.status, note: r.note || '' };
    return map;
  }, [q.data, user.id]);
  const at = (d) => edits[d] || saved[d] || FREE;
  const patternDates = (dow) => Array.from({ length: PATTERN_DAYS + 1 }, (_, i) => addDays(today, i)).filter((d) => dowOf(d) === dow);
  const isPattern = (r) => r.status === 'unavailable' && r.note === PATTERN_NOTE;

  // Days the trade is already booked, from their own jobs.
  const bookedOn = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      if (!b.mine || !b.date || b.date < today || ['complete', 'completed', 'submitted', 'verified'].includes(b.status)) continue;
      if (!map.has(b.date)) map.set(b.date, []);
      if (!map.get(b.date).some((x) => x.jobId === b.jobId)) map.get(b.date).push(b);
    }
    return map;
  }, [bookings, today]);

  // A weekly day off only reaches two months ahead, so carry it on when this screen is opened.
  useEffect(() => {
    if (!q.data || toppedUp.current) return;
    toppedUp.current = true;
    const add = {};
    for (const [dow] of WEEK) {
      const dates = patternDates(dow);
      if (dates.filter((d) => saved[d] && isPattern(saved[d])).length < 2) continue;
      for (const d of dates) if (!saved[d] && !bookedOn.has(d)) add[d] = { status: 'unavailable', note: PATTERN_NOTE };
    }
    const n = Object.keys(add).length;
    if (n) { setEdits((e) => ({ ...add, ...e })); setCarried(n); }
  }, [q.data]);

  const stage = (d, next) => {
    setEdits((e) => { const out = { ...e }; if (same(next, saved[d] || FREE)) delete out[d]; else out[d] = next; return out; });
    if (next.status === 'available') setTell((t) => { if (!t[d]) return t; const out = { ...t }; delete out[d]; return out; });
  };
  /** Change one day. A booked day asks before it is marked off. */
  const change = async (d, next) => {
    const cur = at(d);
    const jobs = bookedOn.get(d) || [];
    if (next.status !== 'available' && cur.status === 'available' && jobs.length) {
      const where = jobs.map((b) => jobTitle(b.job)).join(' and ');
      const yes = await ask({ title: `You are booked at ${where} that day`, body: `Mark ${fmtDayLong(d)} off and tell the office? You stay on the job until they move it, so they will be in touch.`, yes: 'Mark it off and tell the office', no: 'Leave it' });
      if (!yes) return false;
      setTell((t) => ({ ...t, [d]: true }));
    }
    stage(d, next); setTouched(d);
    return true;
  };
  const tapDay = (d) => { buzz(6); const cur = at(d); change(d, { status: NEXT[cur.status] || 'unavailable', note: cur.status === 'leave' || cur.note === PATTERN_NOTE ? '' : cur.note }); };
  const openReason = (dates) => {
    const cur = at(dates[0]);
    openOverlay((close) => html`<${ReasonSheet} dates=${dates} status=${cur.status === 'available' ? 'unavailable' : cur.status} note=${cur.note === PATTERN_NOTE ? '' : cur.note} onClose=${close}
      onSave=${async (status, note) => { for (const d of dates) await change(d, status === 'available' ? FREE : { status, note }); }} />`);
  };
  // Press and hold a day to add a reason.
  const holdStart = (d) => { hold.current.fired = false; clearTimeout(hold.current.timer); hold.current.timer = setTimeout(() => { hold.current.fired = true; buzz(14); openReason([d]); }, 480); };
  const holdEnd = () => clearTimeout(hold.current.timer);
  const onDay = (d) => { if (hold.current.fired) { hold.current.fired = false; return; } tapDay(d); };

  const weeklyOn = (dow) => patternDates(dow).filter((d) => isPattern(at(d))).length >= 2;
  const toggleWeekly = (dow) => {
    buzz(6);
    const on = weeklyOn(dow); let skipped = 0;
    for (const d of patternDates(dow)) {
      const cur = at(d);
      if (on && isPattern(cur)) stage(d, FREE);
      if (!on && cur.status === 'available') { if (bookedOn.has(d)) skipped += 1; else stage(d, { status: 'unavailable', note: PATTERN_NOTE }); }
    }
    if (skipped) toast(`${skipped === 1 ? 'One day is' : `${skipped} days are`} left alone because you are booked. Tap ${skipped === 1 ? 'it' : 'them'} on the calendar to mark ${skipped === 1 ? 'it' : 'them'} off.`, { ms: 6000 });
  };

  const changed = Object.keys(edits).length;
  const telling = Object.keys(tell).filter((d) => edits[d] && edits[d].status !== 'available').sort();

  // The next two weeks as one sentence.
  const fortnight = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d) => ({ d, state: at(d).status !== 'available' ? at(d).status : bookedOn.has(d) ? 'booked' : 'free' }));
    return { days, free: days.filter((x) => x.state === 'free').length, booked: days.filter((x) => x.state === 'booked').length, off: days.filter((x) => x.state === 'unavailable' || x.state === 'leave').map((x) => x.d) };
  }, [saved, edits, bookedOn, today]);

  // What is coming up, grouped so a week away reads as one line.
  const upcoming = useMemo(() => {
    const dates = [...new Set([...Object.keys(saved), ...Object.keys(edits)])].filter((d) => d >= today && at(d).status !== 'available').sort();
    const weekly = new Map(); const runs = [];
    for (const d of dates) {
      const r = at(d);
      if (isPattern(r)) { const k = dowOf(d); if (!weekly.has(k)) weekly.set(k, []); weekly.get(k).push(d); continue; }
      const prev = runs[runs.length - 1];
      if (prev && diffDays(d, prev.dates[prev.dates.length - 1]) === 1 && same(prev, r)) prev.dates.push(d);
      else runs.push({ status: r.status, note: r.note || '', dates: [d] });
    }
    return { runs, weekly: [...weekly.entries()].map(([dow, list]) => ({ dow, dates: list })) };
  }, [saved, edits, today]);

  const save = async () => {
    setBusy(true);
    const dates = Object.keys(edits).sort().map((d) => ({ date: d, status: edits[d].status, note: edits[d].note || '' }));
    try {
      await api('set_availability', null, { user_id: user.id, dates });
    } catch (err) {
      toast(err.offline ? 'Not saved. You need signal for this, so try again in range.' : friendly(err), { kind: 'bad', ms: 6000 });
      setBusy(false);
      return;
    }
    // Saved. Now tell the office about each booked day that was marked off.
    let told = 0; let waiting = 0; const missed = [];
    for (const d of telling) {
      for (const b of bookedOn.get(d) || []) {
        const r = edits[d];
        const body = { jobId: b.jobId, issueType: 'Cannot do this day', detail: `${user.name} is booked on this job on ${fmtDayLong(d)} and has marked that day as ${r.status === 'leave' ? 'leave' : 'cannot work'} in the app.${r.note && r.note !== PATTERN_NOTE ? ' Reason: ' + r.note + '.' : ''}` };
        try { await api('create_trade_alert', null, body); told += 1; } catch (err) {
          if (err instanceof ApiError && err.refused) missed.push(jobTitle(b.job));
          else { queueWrite({ action: 'create_trade_alert', body, jobId: b.jobId, label: `Cannot do ${short(d)} at ${jobTitle(b.job)}` }); waiting += 1; }
        }
      }
    }
    const key = `avail:${today}:${last}`;
    mutateQuery(key, (rows) => [...(rows || []).filter((r) => !(r.user_id === user.id && edits[r.date])), ...dates.map((d) => ({ user_id: user.id, ...d }))]);
    setEdits({}); setTell({}); setCarried(0); setTouched(null);
    buzz([12, 40, 20]);
    if (missed.length) toast(`Saved, but the office was not told about ${missed.join(' and ')}. Give them a call.`, { kind: 'bad', ms: 7000 });
    else toast(`${dates.length === 1 ? 'Saved.' : `Saved ${dates.length} days.`} ${told ? 'The office has been told about your booking.' : waiting ? 'The office is told as soon as you have signal.' : 'The office can see it.'}`, { kind: 'ok', ms: 4500 });
    invalidate('avail');
    setBusy(false);
  };
  const leave = async () => {
    const real = changed - (carried && changed >= carried ? carried : 0);
    if (real > 0 && !(await ask({ title: 'Leave without saving?', body: `${real === 1 ? 'One day you changed has' : `${real} days you changed have`} not been saved.`, yes: 'Leave', no: 'Keep editing', danger: true }))) return;
    back('/me');
  };

  const firstMonth = monthStart(today);
  const lastMonth = monthStart(last);
  const touchedRow = touched && at(touched).status !== 'available' ? at(touched) : null;

  return html`<${Page} title="Days you cannot work" onBack=${leave}>
    <header class="page-pad" style="padding-top:2px"><h1 class="t-display">Days you cannot work</h1></header>

    ${q.loading ? html`<div class="page-pad" style="margin-top:22px;display:grid;gap:12px"><${Skel} h=${92} r=${14} /><${Skel} w="46%" h=${22} /><${Skel} h=${320} r=${16} /></div>`
      : q.error && !q.data ? html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="your days off" />`
      : html`<div class="rise">
      <section class="block inset fortnight" style="margin-top:18px" aria-label="The next 14 days">
        <p class="t-head">You are free ${fortnight.free} of the next 14 days.</p>
        <p class="t-small" style="margin-top:3px">${fortnight.booked ? `Booked: ${fortnight.booked} ${fortnight.booked === 1 ? 'day' : 'days'}. ` : ''}${fortnight.off.length ? `Off: ${fortnight.off.slice(0, 5).map(short).join(', ')}${fortnight.off.length > 5 ? ` and ${fortnight.off.length - 5} more` : ''}.` : 'No days off.'}</p>
        <div class="strip14" aria-hidden="true">${fortnight.days.map((x) => html`<span key=${x.d} class=${cx(x.state, x.d === today && 'today')}><small>${fmtDow(x.d)[0]}</small><i /></span>`)}</div>
      </section>

      <section class="page-pad" style="margin-top:22px">
        <div class="monthnav">
          <${IconButton} name="back" label="Earlier month" disabled=${month <= firstMonth} onClick=${() => setMonth(addMonths(month, -1))} />
          <span class="t-head">${fmtMonth(month)}</span>
          <${IconButton} name="right" label="Later month" disabled=${month >= lastMonth} onClick=${() => setMonth(addMonths(month, 1))} />
        </div>
        <div class="month avail" role="group" aria-label=${fmtMonth(month)}>
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<span class="mh">${d}</span>`)}
          ${monthGrid(month).map((d) => {
            if (d.slice(0, 7) !== month.slice(0, 7)) return html`<span key=${d} />`;
            const r = at(d);
            const openDay = d >= today && d <= last;
            const jobs = bookedOn.get(d) || [];
            const state = r.status === 'unavailable' ? 'offday' : r.status === 'leave' ? 'leave' : jobs.length ? 'booked' : '';
            return html`<button type="button" key=${d} disabled=${!openDay} class=${cx(d === today && 'today', state, edits[d] && 'changed')}
                aria-label=${`${fmtDay(d)}, ${r.status === 'available' ? (jobs.length ? 'booked at ' + jobs.map((b) => jobTitle(b.job)).join(' and ') : 'working, nothing booked') : WORD[r.status].toLowerCase() + (jobs.length ? ', and booked' : '')}`}
                onClick=${() => onDay(d)} onPointerDown=${() => holdStart(d)} onPointerUp=${holdEnd} onPointerLeave=${holdEnd} onPointerCancel=${holdEnd} onContextMenu=${(e) => e.preventDefault()}>
              ${fmtDom(d)}<span class="pips">${jobs.slice(0, 3).map((b) => html`<i class=${'jt-' + b.vertical} style="background:var(--jt)" />`)}</span>
            </button>`;
          })}
        </div>
        <div class="daylegend"><span><i />Free</span><span><i class="booked" />Booked</span><span><i class="offday" />Cannot work</span><span><i class="leave" />Leave</span></div>
        ${touchedRow ? html`<button type="button" class="reasonbar" onClick=${() => openReason([touched])}>
          <span><b>${fmtDay(touched)}</b> · ${WORD[touchedRow.status]}${touchedRow.note && touchedRow.note !== PATTERN_NOTE ? ' · ' + touchedRow.note : ''}</span><u>${touchedRow.note && touchedRow.note !== PATTERN_NOTE ? 'Change the reason' : 'Add a reason'}</u>
        </button>` : html`<p class="t-small t-mute" style="margin-top:12px">Tap a day: cannot work, then leave, then back to working. Hold a day to add a reason. A dot means you are booked that day.</p>`}
      </section>

      ${telling.length ? html`<div class="block note-banner" style="margin-top:16px"><${Icon} name="alert" size=${18} /><span>You are booked on ${telling.slice(0, 3).map((d) => `${short(d)} (${(bookedOn.get(d) || []).map((b) => jobTitle(b.job)).join(', ')})`).join(', ')}${telling.length > 3 ? ` and ${telling.length - 3} more` : ''}. Press Save and the office is told.</span></div>` : null}
      ${carried && changed >= carried ? html`<div class="block note-banner plain" style="margin-top:16px"><${Icon} name="info" size=${18} /><span>Your weekly days off were about to run out. Save to carry them on.</span></div>` : null}

      <section class="section">
        <span class="t-label">Every week</span>
        <div class="block">
          <div class="weekdays" role="group" aria-label="Days you never work">
            ${WEEK.map(([dow, label]) => html`<button type="button" key=${dow} class="pick" aria-pressed=${String(weeklyOn(dow))} aria-label=${`Never work ${fmtDowLong(patternDates(dow)[0])}s`} onClick=${() => toggleWeekly(dow)}>${label}</button>`)}
          </div>
          <p class="t-small t-mute" style="margin-top:8px">Pick the days you never work. They are marked off for the next two months, so open this now and then to carry them on.</p>
        </div>
      </section>

      <section class="section">
        <span class="t-label">Days off coming up</span>
        ${upcoming.runs.length || upcoming.weekly.length ? html`<div class="list ruled">
          ${upcoming.weekly.map((w) => html`<div class="row" key=${'w' + w.dow}>
            <span class="lead offlead"><${Icon} name="refresh" size=${20} /></span>
            <span class="main"><b>Every ${fmtDowLong(w.dates[0])}</b><span>Until ${fmtDate(w.dates[w.dates.length - 1])}${w.dates.some((d) => edits[d]) ? ' · not saved yet' : ''}</span></span>
            <span class="trail" />
          </div>`)}
          ${upcoming.runs.map((run) => html`<button type="button" class="row" key=${run.dates[0]} onClick=${() => openReason(run.dates)}>
            <span class=${cx('lead offlead', run.status)}><b>${fmtDom(run.dates[0])}</b><small>${fmtDate(run.dates[0]).replace(/^\d+\s/, '').slice(0, 3)}</small></span>
            <span class="main"><b>${run.dates.length === 1 ? fmtDay(run.dates[0]) : `${fmtDay(run.dates[0])} to ${fmtDay(run.dates[run.dates.length - 1])}`}</b>
              <span>${WORD[run.status]}${run.dates.length > 1 ? ` · ${run.dates.length} days` : ''}${run.note ? ' · ' + run.note : ''}${run.dates.some((d) => edits[d]) ? ' · not saved yet' : ''}</span></span>
            <span class="trail"><${Icon} name="note" size=${18} /></span>
          </button>`)}
        </div>` : html`<p class="block t-small" style="margin-top:6px;max-width:34ch">No days off coming up. Tap a day on the calendar if you cannot work it.</p>`}
      </section>
    </div>`}

    ${changed ? html`<div class="dock savedock">
      <${Button} block busy=${busy} onClick=${save}>Save ${changed} ${changed === 1 ? 'day' : 'days'}${telling.length ? ' and tell the office' : ''}<//>
    </div>` : null}
  <//>`;
}

/** What kind of day off, and a short reason for the office. For one day or a run of days. */
function ReasonSheet({ dates, status: status0, note: note0, onSave, onClose }) {
  const [status, setStatus] = useState(status0);
  const [note, setNote] = useState(note0 || '');
  const title = dates.length === 1 ? fmtDay(dates[0]) : `${fmtDay(dates[0])} to ${fmtDay(dates[dates.length - 1])}`;
  return html`<${Sheet} title=${title} sub=${dates.length > 1 ? `${dates.length} days` : ''} onClose=${onClose}
    foot=${(shut) => html`<${Button} block onClick=${() => { shut(); setTimeout(() => onSave(status, note.trim()), 220); }}>Done<//>`}>
    <div class="stack">
      <div class="field"><span>${dates.length > 1 ? 'These days I' : 'This day I'}</span>
        <${Picks} value=${status} options=${[['unavailable', 'Cannot work'], ['leave', 'Am on leave'], ['available', 'Can work']]} onChange=${setStatus} /></div>
      ${status === 'available' ? null : html`<label class="field"><span>Reason for the office (optional)</span>
        <input class="input" type="text" maxlength="80" placeholder="e.g. Family trip, back Thursday" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} /></label>`}
      <p class="t-small t-mute">Press Save on the page after this to send it to the office.</p>
    </div>
  <//>`;
}
