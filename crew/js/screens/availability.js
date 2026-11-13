// Days you cannot work. Tap a day on the calendar: can work, cannot work, on
// leave. The office sees these when it books crew. Nothing here cancels a
// booking; it only tells the office ahead of time.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api, friendly } from '../lib/api.js';
import { useStore, invalidate, mutateQuery } from '../lib/store.js';
import { useMyBookings } from '../lib/data.js';
import { back } from '../lib/router.js';
import { todayISO, addDays, addMonths, monthStart, monthGrid, dowOf, diffDays, fmtDom, fmtDay, fmtDate, fmtMonth, fmtDowLong } from '../lib/dates.js';
import { jobTitle } from '../lib/model.js';
import { useAvailability, awayWord } from '../lib/roster.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, IconButton, Sheet, Picks, Skel, LoadError, toast, ask, openOverlay, buzz } from '../ui/kit.js';

const AHEAD = 90;          // how far ahead the calendar reaches
const PATTERN_DAYS = 60;   // a weekly day off is written out this far ahead
const PATTERN_NOTE = 'Weekly pattern';
const NEXT = { available: 'unavailable', unavailable: 'leave', leave: 'available' };
const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const FREE = { status: 'available', note: '' };
const same = (a, b) => a.status === b.status && (a.note || '') === (b.note || '');

export function Availability() {
  const user = useStore((s) => s.user);
  const today = todayISO();
  const last = addDays(today, AHEAD);
  const q = useAvailability(today, last);
  const { bookings } = useMyBookings();
  const [edits, setEdits] = useState({});
  const [month, setMonth] = useState(monthStart(today));
  const [busy, setBusy] = useState(false);
  const toppedUp = useRef(false);
  const [carried, setCarried] = useState(0);

  const saved = useMemo(() => {
    const map = {};
    for (const r of q.data || []) if (r.user_id === user.id && r.status !== 'available') map[r.date] = { status: r.status, note: r.note || '' };
    return map;
  }, [q.data, user.id]);
  const at = (d) => edits[d] || saved[d] || FREE;
  const patternDates = (dow) => Array.from({ length: PATTERN_DAYS + 1 }, (_, i) => addDays(today, i)).filter((d) => dowOf(d) === dow);
  const isPattern = (r) => r.status === 'unavailable' && r.note === PATTERN_NOTE;

  // A weekly day off only reaches two months ahead, so carry it on when this screen is opened.
  useEffect(() => {
    if (!q.data || toppedUp.current) return;
    toppedUp.current = true;
    const add = {};
    for (const [dow] of WEEK) {
      const dates = patternDates(dow);
      if (dates.filter((d) => saved[d] && isPattern(saved[d])).length < 2) continue;
      for (const d of dates) if (!saved[d]) add[d] = { status: 'unavailable', note: PATTERN_NOTE };
    }
    const n = Object.keys(add).length;
    if (n) { setEdits((e) => ({ ...add, ...e })); setCarried(n); }
  }, [q.data]);

  const stage = (d, next) => setEdits((e) => {
    const out = { ...e };
    if (same(next, saved[d] || FREE)) delete out[d]; else out[d] = next;
    return out;
  });
  const tapDay = (d) => { buzz(6); const cur = at(d); stage(d, { status: NEXT[cur.status] || 'unavailable', note: cur.status === 'leave' ? '' : cur.note === PATTERN_NOTE ? '' : cur.note }); };
  const weeklyOn = (dow) => patternDates(dow).filter((d) => isPattern(at(d))).length >= 2;
  const toggleWeekly = (dow) => {
    buzz(6);
    const on = weeklyOn(dow);
    for (const d of patternDates(dow)) {
      const cur = at(d);
      if (on && isPattern(cur)) stage(d, FREE);
      if (!on && cur.status === 'available') stage(d, { status: 'unavailable', note: PATTERN_NOTE });
    }
  };

  const changed = Object.keys(edits).length;
  const bookedOn = useMemo(() => {
    const map = new Map();
    for (const b of bookings) if (b.mine && b.date >= today && !['complete', 'completed', 'submitted', 'verified'].includes(b.status)) { if (!map.has(b.date)) map.set(b.date, []); map.get(b.date).push(b); }
    return map;
  }, [bookings, today]);
  const clashes = Object.keys(edits).filter((d) => edits[d].status !== 'available' && bookedOn.has(d)).sort();

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
      const key = `avail:${today}:${last}`;
      mutateQuery(key, (rows) => [...(rows || []).filter((r) => !(r.user_id === user.id && edits[r.date])), ...dates.map((d) => ({ user_id: user.id, ...d }))]);
      setEdits({}); setCarried(0);
      buzz([12, 40, 20]);
      toast(dates.length === 1 ? 'Saved. The office can see it.' : `Saved ${dates.length} days. The office can see them.`, { kind: 'ok' });
      invalidate('avail');
    } catch (err) {
      toast(err.offline ? 'Not saved. You need signal for this, so try again in range.' : friendly(err), { kind: 'bad', ms: 6000 });
    }
    setBusy(false);
  };
  const leave = async () => {
    const real = changed - (carried && changed >= carried ? carried : 0);
    if (real > 0 && !(await ask({ title: 'Leave without saving?', body: `${changed === 1 ? 'One day you changed has' : `${changed} days you changed have`} not been saved.`, yes: 'Leave', no: 'Keep editing', danger: true }))) return;
    back('/me');
  };
  const editRun = (run) => openOverlay((close) => html`<${RunSheet} run=${run} onClose=${close} onSave=${(status, note) => run.dates.forEach((d) => stage(d, status === 'available' ? FREE : { status, note }))} />`);

  const firstMonth = monthStart(today);
  const lastMonth = monthStart(last);

  return html`<${Page} title="Days you cannot work" onBack=${leave}>
    <header class="page-pad" style="padding-top:2px"><h1 class="t-display">Days you cannot work</h1>
      <p class="t-small" style="margin-top:8px;max-width:36ch">Tell the office ahead of time. They see this when they book the crew.</p></header>

    ${q.loading ? html`<div class="page-pad" style="margin-top:22px;display:grid;gap:12px"><${Skel} w="46%" h=${22} /><${Skel} h=${300} r=${16} /><${Skel} w="70%" /></div>`
      : q.error && !q.data ? html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="your days off" />`
      : html`<div class="rise">
      <section class="page-pad" style="margin-top:20px">
        <div class="monthnav">
          <${IconButton} name="back" label="Earlier month" disabled=${month <= firstMonth} onClick=${() => setMonth(addMonths(month, -1))} />
          <span class="t-head">${fmtMonth(month)}</span>
          <${IconButton} name="right" label="Later month" disabled=${month >= lastMonth} onClick=${() => setMonth(addMonths(month, 1))} />
        </div>
        <div class="month avail" role="group" aria-label=${fmtMonth(month)}>
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<span class="mh">${d}</span>`)}
          ${monthGrid(month).map((d) => {
            const inMonth = d.slice(0, 7) === month.slice(0, 7);
            if (!inMonth) return html`<span key=${d} />`;
            const r = at(d);
            const open = d >= today && d <= last;
            const jobs = bookedOn.get(d) || [];
            return html`<button type="button" key=${d} disabled=${!open} class=${cx(d === today && 'today', r.status === 'unavailable' && 'offday', r.status === 'leave' && 'leave', edits[d] && 'changed')}
                aria-label=${`${fmtDay(d)}, ${r.status === 'available' ? 'can work' : awayWord(r.status).toLowerCase()}${jobs.length ? ', you are booked' : ''}`} onClick=${() => tapDay(d)}>
              ${fmtDom(d)}<span class="pips">${jobs.slice(0, 3).map((b) => html`<i class=${'jt-' + b.vertical} style="background:var(--jt)" />`)}</span>
            </button>`;
          })}
        </div>
        <div class="legend"><span><i />Can work</span><span><i class="offday" />Cannot work</span><span><i class="leave" />On leave</span></div>
        <p class="t-small t-mute" style="margin-top:8px">Tap a day to mark it. Tap again for leave, and once more to clear it. A dot means you are booked that day.</p>
      </section>

      ${clashes.length ? html`<div class="block note-banner" style="margin-top:16px"><${Icon} name="alert" size=${18} /><span>You are booked on ${clashes.slice(0, 3).map((d) => `${fmtDay(d)} (${jobTitle(bookedOn.get(d)[0].job)})`).join(', ')}${clashes.length > 3 ? ` and ${clashes.length - 3} more` : ''}. Marking a day off does not take you off the job, so call the office as well.</span></div>` : null}
      ${carried && changed >= carried ? html`<div class="block note-banner plain" style="margin-top:16px"><${Icon} name="info" size=${18} /><span>Your weekly days off were about to run out. Save to carry them on.</span></div>` : null}

      <section class="section">
        <span class="t-label">Every week</span>
        <div class="block">
          <div class="weekdays" role="group" aria-label="Days you never work">
            ${WEEK.map(([dow, label]) => html`<button type="button" key=${dow} class="pick" aria-pressed=${String(weeklyOn(dow))} aria-label=${`Never work ${fmtDowLong(patternDates(dow)[0])}s`} onClick=${() => toggleWeekly(dow)}>${label}</button>`)}
          </div>
          <p class="t-small t-mute" style="margin-top:8px">Pick the days you never work. They are marked off for the next two months, so open this again now and then to carry them on.</p>
        </div>
      </section>

      <section class="section">
        <span class="t-label">Days off coming up</span>
        ${upcoming.runs.length || upcoming.weekly.length ? html`<div class="list ruled">
          ${upcoming.weekly.map((w) => html`<div class="row" key=${'w' + w.dow}>
            <span class="lead offlead"><${Icon} name="refresh" size=${20} /></span>
            <span class="main"><b>Every ${fmtDowLong(w.dates[0])}</b><span>Until ${fmtDate(w.dates[w.dates.length - 1])}</span></span>
            <span class="trail" />
          </div>`)}
          ${upcoming.runs.map((run) => html`<button type="button" class="row" key=${run.dates[0]} onClick=${() => editRun(run)}>
            <span class=${cx('lead offlead', run.status)}><b>${fmtDom(run.dates[0])}</b><small>${fmtDate(run.dates[0]).replace(/^\d+\s/, '')}</small></span>
            <span class="main"><b>${run.dates.length === 1 ? fmtDay(run.dates[0]) : `${fmtDay(run.dates[0])} to ${fmtDay(run.dates[run.dates.length - 1])}`}</b>
              <span>${awayWord(run.status)}${run.dates.length > 1 ? ` · ${run.dates.length} days` : ''}${run.note ? ' · ' + run.note : ''}${run.dates.some((d) => edits[d]) ? ' · not saved yet' : ''}</span></span>
            <span class="trail"><${Icon} name="note" size=${18} /></span>
          </button>`)}
        </div>` : html`<p class="block t-small" style="margin-top:6px;max-width:34ch">No days off coming up. Tap a day on the calendar if you cannot work it.</p>`}
      </section>
    </div>`}

    <div class="dock">
      <${Button} block busy=${busy} disabled=${!changed} onClick=${save}>${changed ? `Save ${changed} ${changed === 1 ? 'day' : 'days'}` : 'Nothing to save'}<//>
    </div>
  <//>`;
}

/** Change a day off, or a run of them: what kind, and a short note for the office. */
function RunSheet({ run, onSave, onClose }) {
  const [status, setStatus] = useState(run.status);
  const [note, setNote] = useState(run.note || '');
  const title = run.dates.length === 1 ? fmtDay(run.dates[0]) : `${fmtDay(run.dates[0])} to ${fmtDay(run.dates[run.dates.length - 1])}`;
  return html`<${Sheet} title=${title} sub=${run.dates.length > 1 ? `${run.dates.length} days` : ''} onClose=${onClose}
    foot=${(shut) => html`<${Button} block onClick=${() => { onSave(status, note.trim()); shut(); }}>Done<//>`}>
    <div class="stack">
      <div class="field"><span>These days I</span>
        <${Picks} value=${status} options=${[['unavailable', 'Cannot work'], ['leave', 'Am on leave'], ['available', 'Can work after all']]} onChange=${setStatus} /></div>
      ${status === 'available' ? null : html`<label class="field"><span>Note for the office (optional)</span>
        <input class="input" type="text" maxlength="80" placeholder="e.g. Family trip, back Thursday" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} /></label>`}
      <p class="t-small t-mute">Press Save on the page after this to send it to the office.</p>
    </div>
  <//>`;
}
