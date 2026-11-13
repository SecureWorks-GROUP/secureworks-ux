// Pieces shared by the finish, report, roof report and service report screens:
// the signature pad, star rating, tick rows, counters, the hours row, a small
// store for photos that must outlive a refresh, and plain words for refusals.
import { html, cx, useEffect, useLayoutEffect, useRef, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { local, invalidate } from '../lib/store.js';
import { todayISO, addDays, fmtDay, fmtRelDay, fmtHours, hoursBetween, hmToMinutes, tsToDate, tsToHM, isISODate } from '../lib/dates.js';
import { compressImage } from '../lib/upload.js';
import { Icon } from './icons.js';
import { Button, Field, Picks, TimeInput, BREAKS, toast, buzz } from './kit.js';

// ---------------------------------------------------------------- words ----
const SWAPS = [
  [/makesafe report needs at least 5( current-visit)? photos \(found (\d+)\)/i, (m, cur, n) => `The report needs at least 5 photos${cur ? ' from this visit' : ''}. The office system has ${n} so far.`],
  [/report already submitted/i, () => 'This report has already been sent.'],
  [/report already approved|has been approved and cannot be modified/i, () => 'The office has approved this report, so it can no longer be changed.'],
  [/cannot submit a final makesafe report for an? (\w+) job/i, (m, s) => `This job is ${s}, so a report cannot be sent for it. Call the office.`],
  [/cannot re-?attend an? (\w+)/i, (m, s) => `This job is ${s}, so a new visit cannot be started. Call the office.`],
  [/no submitted report to re-?attend/i, () => 'There is no sent report on this job yet, so there is no new visit to start.'],
  [/not authorized to (re-?attend|cancel|reopen)/i, (m, what) => `You cannot ${/re-?attend/i.test(what) ? 'start a new visit on' : what.toLowerCase()} this job. Ask the office.`],
  [/live[_ ]?invoice/i, () => 'This job has a live invoice. Talk to the office.'],
  [/cannot cancel an? (\w+)/i, (m, s) => `This job is already ${s}.`],
  [/cannot complete a job with status "?(\w+)"?/i, (m, s) => `This job is marked ${s.replace(/_/g, ' ')} at the office, so it cannot be finished from here. Call the office.`],
  [/roof report incomplete:?\s*(.*)/i, (m, rest) => `The roof report is missing something${rest ? ': ' + rest : '.'}`],
  [/no current attendance cycle/i, () => 'The office has not set this visit up yet, so it cannot be marked from here. Tell the office the report is done.'],
  [/more than one roof report link/i, () => 'This job has more than one roof report link, so the office has to say which one counts. Tell them the report is done.'],
  [/no builder roof report link/i, () => 'This job has no link to the builder\'s roof report yet. Ask the office to chase the builder for it.'],
  [/only a trade assigned to this job/i, () => 'Only someone booked on this job can say its roof report is done. Add yourself to the job first.'],
  [/makesafe job required/i, () => 'This is not a make safe job, so it has no report like this.'],
  [/time_entry_required/i, () => 'Put in the day you worked, a start time and a finish time.']
];
/** Words for a failure, with the office system's jargon taken out. */
export function plain(err) {
  let msg = friendly(err);
  for (const [re, fn] of SWAPS) { const m = re.exec(msg); if (m) { msg = fn(...m); break; } }
  return String(msg)
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/attendance cycles?/gi, 'visit')
    .replace(/sub-?status/gi, 'status')
    .replace(/builder portal|portal/gi, "builder's website")
    .replace(/make-?safe/gi, 'make safe')
    .replace(/\bthis card\b/gi, 'this job');
}
/** True when the server understood and said no (including its plain-Error 500s). */
export function isRefusal(err) {
  if (!(err instanceof ApiError) || err.offline) return false;
  if (err.refused) return true;
  return err.status === 500 && /already submitted|already approved|cannot complete a job|makesafe job required|cannot be modified/i.test(err.message || '');
}

// --------------------------------------------- blobs that outlive refresh --
const DB_NAME = 'crew-reports';
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const memory = new Map(); // also held in memory, so a blocked IndexedDB only costs the refresh safety
export const stash = {
  async put(key, blob) {
    memory.set(key, blob);
    try { const d = await db(); await new Promise((res, rej) => { const tx = d.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); return true; } catch { return false; }
  },
  async get(key) {
    if (memory.has(key)) return memory.get(key);
    try { const d = await db(); const blob = await new Promise((res, rej) => { const rq = d.transaction('blobs').objectStore('blobs').get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); }); if (blob) memory.set(key, blob); return blob; } catch { return null; }
  },
  async del(key) {
    memory.delete(key);
    try { const d = await db(); d.transaction('blobs', 'readwrite').objectStore('blobs').delete(key); } catch { /* gone */ }
  }
};
/** A picture straight from a blob held on this phone. */
export function BlobImg({ blob, alt = '', ...rest }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return undefined; }
    const u = URL.createObjectURL(blob); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? html`<img src=${url} alt=${alt} ...${rest} />` : null;
}
/** Shrink a photo and keep it under `key`. Resolves the kept blob. */
export async function keepPhoto(key, file) {
  const small = await compressImage(file);
  await stash.put(key, small);
  return small;
}

/** State that is also written to this phone, so a refresh loses nothing. */
export function useSaved(key, make) {
  const [value, setValue] = useState(() => { const saved = local.get(key); return saved && typeof saved === 'object' ? { ...make(), ...saved } : make(); });
  const set = (change) => setValue((cur) => { const next = typeof change === 'function' ? change(cur) : { ...cur, ...change }; local.set(key, next); return next; });
  const clear = () => { local.del(key); };
  return [value, set, clear];
}

// --------------------------------------------------------- signature pad ---
const INK = '#16222c';
/**
 * Finger signature. Smooth strokes, a clear button, and a PNG out.
 * `onChange(blob | null)` fires a moment after each stroke. `initial` is a
 * blob from an earlier sitting, drawn back in.
 */
export function SignaturePad({ initial, onChange, hint = 'Sign here with your finger' }) {
  const canvas = useRef(null);
  const st = useRef({ strokes: [], cur: null, img: null, w: 0, h: 0, raf: 0, timer: 0 });
  const [empty, setEmpty] = useState(!initial);

  const paint = () => {
    const el = canvas.current; if (!el) return;
    const s = st.current; const ctx = el.getContext('2d'); const dpr = el.width / (s.w || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, s.w, s.h);
    if (s.img) {
      const k = Math.min(s.w / s.img.width, s.h / s.img.height);
      ctx.drawImage(s.img, (s.w - s.img.width * k) / 2, (s.h - s.img.height * k) / 2, s.img.width * k, s.img.height * k);
    }
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.6;
    for (const stroke of s.cur ? [...s.strokes, s.cur] : s.strokes) {
      const pts = stroke.map(([x, y]) => [x * s.w, y * s.h]);
      if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 1.6, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.stroke();
    }
  };
  const queue = () => { const s = st.current; if (s.raf) return; s.raf = requestAnimationFrame(() => { s.raf = 0; paint(); }); };
  const size = () => {
    const el = canvas.current; if (!el) return;
    const box = el.getBoundingClientRect(); if (!box.width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    st.current.w = box.width; st.current.h = box.height;
    el.width = Math.round(box.width * dpr); el.height = Math.round(box.height * dpr);
    paint();
  };
  useLayoutEffect(() => {
    size();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size);
    if (ro) ro.observe(canvas.current);
    return () => { if (ro) ro.disconnect(); cancelAnimationFrame(st.current.raf); clearTimeout(st.current.timer); };
  }, []);
  useEffect(() => {
    if (!initial) return undefined;
    let on = true; const url = URL.createObjectURL(initial); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); if (!on) return; st.current.img = img; paint(); };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
    return () => { on = false; };
  }, []);

  const emit = () => {
    const s = st.current; clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      const el = canvas.current; if (!el) return;
      if (!s.strokes.length && !s.img) { onChange(null); return; }
      paint();
      el.toBlob((blob) => { if (blob) onChange(blob); }, 'image/png');
    }, 260);
  };
  const point = (e) => { const box = canvas.current.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))]; };
  const down = (e) => {
    if (e.button != null && e.button > 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    clearTimeout(st.current.timer);
    st.current.cur = [point(e)];
    if (empty) setEmpty(false);
    queue();
  };
  const move = (e) => {
    const s = st.current; if (!s.cur) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    for (const ev of events && events.length ? events : [e]) {
      const p = point(ev); const last = s.cur[s.cur.length - 1];
      if (Math.abs(p[0] - last[0]) * s.w + Math.abs(p[1] - last[1]) * s.h >= 1.2) s.cur.push(p);
    }
    queue();
  };
  const up = () => { const s = st.current; if (!s.cur) return; s.strokes.push(s.cur); s.cur = null; queue(); emit(); };
  const clear = () => { const s = st.current; s.strokes = []; s.cur = null; s.img = null; clearTimeout(s.timer); paint(); setEmpty(true); onChange(null); buzz(6); };

  return html`<div class="sigwrap">
    <canvas ref=${canvas} class="sigpad" aria-label="Signature" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} />
    <span class="sigline" />
    ${empty ? html`<span class="sighint">${hint}</span>` : html`<button type="button" class="sigclear" onClick=${clear}><${Icon} name="refresh" size=${16} />Clear</button>`}
  </div>`;
}

// ------------------------------------------------------------ small parts --
const STAR_WORD = ['', 'Not happy', 'Could be better', 'It is okay', 'Happy', 'Very happy'];
export function Stars({ value, onChange, big }) {
  return html`<div><div class=${cx('stars', big && 'big')} role="radiogroup" aria-label="Rating out of 5">
    ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" role="radio" aria-checked=${String(value === n)} aria-label=${n + (n === 1 ? ' star' : ' stars')} class=${n <= value ? 'on' : ''} onClick=${() => { buzz(8); onChange(n); }}>
      <${Icon} name="star" size=${big ? 44 : 34} fill=${n <= value} stroke=${1.6} /></button>`)}
  </div>${big ? html`<p class="starword">${STAR_WORD[value] || ''}</p>` : null}</div>`;
}
export function CheckRow({ checked, onChange, label, sub, disabled }) {
  return html`<button type="button" class="check" role="checkbox" aria-checked=${String(Boolean(checked))} disabled=${disabled} onClick=${() => { buzz(6); onChange(!checked); }}>
    <span class="box"><${Icon} name="check" size=${18} stroke=${3} /></span><span><b>${label}</b>${sub ? html`<span class="sub">${sub}</span>` : null}</span>
  </button>`;
}
/** Plus and minus around a number. `null` shows as blank until the first tap. */
export function Counter({ value, onChange, min = 0, max = 99, label, blank = '' }) {
  const n = value == null ? null : Number(value);
  return html`<div class="counter" role="group" aria-label=${label}>
    <button type="button" aria-label="One less" disabled=${n == null || n <= min} onClick=${() => { buzz(5); onChange(n - 1 < min ? min : n - 1); }}><${Icon} name="minus" size=${22} /></button>
    <b>${n == null ? html`<span class="t-mute" style="font-size:15px;font-weight:560;font-stretch:100%">${blank}</span>` : n}</b>
    <button type="button" aria-label="One more" disabled=${n != null && n >= max} onClick=${() => { buzz(5); onChange(n == null ? Math.max(min, 1) : n + 1); }}><${Icon} name="plus" size=${22} /></button>
  </div>`;
}
/** Choose several from a short list. */
export function MultiPicks({ value, options, onChange }) {
  const has = (v) => value.includes(v);
  return html`<div class="picks">${options.map((opt) => { const [v, label] = Array.isArray(opt) ? opt : [opt, opt]; return html`<button type="button" class="pick" aria-pressed=${String(has(v))} onClick=${() => { buzz(6); onChange(has(v) ? value.filter((x) => x !== v) : [...value, v]); }}>${label}</button>`; })}</div>`;
}
/** Today, yesterday or another day. Never later than today. */
export function DayPick({ value, onChange, label = 'Day' }) {
  const today = todayISO(); const yesterday = addDays(today, -1);
  const [other, setOther] = useState(Boolean(value) && value !== today && value !== yesterday);
  return html`<${Field} label=${label}>
    <${Picks} value=${other ? 'other' : value} options=${[[today, 'Today'], [yesterday, 'Yesterday'], ['other', 'Another day']]} onChange=${(v) => { if (v === 'other') { setOther(true); if (value === today || value === yesterday) onChange(''); } else { setOther(false); onChange(v); } }} />
    ${other ? html`<input class="input" type="date" max=${today} min=${addDays(today, -365)} value=${value || ''} aria-label="Date" onInput=${(e) => onChange(e.currentTarget.value)} />` : null}
  <//>`;
}
export function StepBar({ index, total }) {
  return html`<div class="steps" role="progressbar" aria-valuemin="1" aria-valuemax=${total} aria-valuenow=${index + 1} aria-label=${`Step ${index + 1} of ${total}`}>
    ${Array.from({ length: total }, (_, i) => html`<i class=${i < index ? 'done' : i === index ? 'on' : ''} />`)}
  </div>`;
}
export function StepHead({ kicker, title, children }) {
  return html`<header class="stephead">${kicker ? html`<span class="t-label">${kicker}</span>` : null}<h1 class="t-title">${title}</h1>${children ? html`<p>${children}</p>` : null}</header>`;
}

/** Round to the nearest 5 minutes, which is how trades give times. */
export function roundHM(hm) {
  const mins = hmToMinutes(hm); if (isNaN(mins)) return '';
  const r = Math.min(Math.round(mins / 5) * 5, 23 * 60 + 55);
  return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
}
/** What is wrong with a day, start, finish and break, in words. '' when fine. */
export function timesProblem({ date, start, finish, breakMin }) {
  const today = todayISO();
  if (!date || !isISODate(date)) return 'Pick the day';
  if (date > today) return 'The day cannot be after today';
  if (date < addDays(today, -365)) return 'That day is more than a year ago';
  if (!start) return 'Add a start time';
  if (!finish) return 'Add a finish time';
  const a = hmToMinutes(start); const b = hmToMinutes(finish);
  if (isNaN(a) || isNaN(b) || b <= a) return 'Finish must be after start';
  if (breakMin == null) return 'Pick a break';
  if (!(Number(breakMin) >= 0) || Number(breakMin) >= b - a) return 'The break is longer than the day';
  return '';
}
/** Start, finish and break, with the hours worked out underneath. */
export function TimesBlock({ value, onChange, outLabel = 'Hours' }) {
  const [otherBrk, setOtherBrk] = useState(value.breakMin != null && !BREAKS.some(([v]) => v === value.breakMin));
  const hours = value.breakMin == null ? NaN : hoursBetween(value.start, value.finish, value.breakMin);
  return html`<div class="stack">
    <div class="timegrid">
      <${TimeInput} label="Started" value=${value.start} onInput=${(v) => onChange({ start: v })} />
      <${TimeInput} label="Finished" value=${value.finish} onInput=${(v) => onChange({ finish: v })} />
    </div>
    <${Field} label="Break"><${Picks} value=${otherBrk ? 'other' : value.breakMin} options=${[...BREAKS, ['other', 'Other']]} onChange=${(v) => { if (v === 'other') { setOtherBrk(true); onChange({ breakMin: null }); } else { setOtherBrk(false); onChange({ breakMin: v }); } }} /><//>
    ${otherBrk ? html`<${Field} label="Break in minutes"><input class="input" type="number" inputmode="numeric" min="0" max="600" value=${value.breakMin == null ? '' : value.breakMin} onInput=${(e) => onChange({ breakMin: e.currentTarget.value === '' ? null : Math.max(0, Math.round(Number(e.currentTarget.value))) })} /><//>` : null}
    <div class="hoursout"><span class="t-label">${outLabel}</span><b>${isNaN(hours) ? '' : fmtHours(hours)}</b></div>
  </div>`;
}

// -------------------------------------------------------------- hours row --
/**
 * The trade's own hours for a job, once its report is done. Times are given as
 * start, finish and break; hours are worked out, never typed.
 * `seed` = { date, start, finish, breakMin, from } offers times already on record.
 */
export function HoursCard({ jobId, crew, userId, title = 'Your hours for this job', seed }) {
  const mine = (crew || []).filter((c) => c.user_id === userId && String(c.status).toLowerCase() !== 'cancelled');
  const saved = mine.filter((c) => c.hours_worked != null && Number(c.hours_worked) > 0).sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)));
  const clocked = mine.filter((c) => c.clocked_on_at && c.clocked_off_at).sort((a, b) => String(b.clocked_on_at).localeCompare(String(a.clocked_on_at)))[0];
  const offered = seed && seed.start ? seed
    : clocked ? { date: tsToDate(clocked.clocked_on_at), start: roundHM(tsToHM(clocked.clocked_on_at)), finish: roundHM(tsToHM(clocked.clocked_off_at)), breakMin: Number(clocked.break_minutes) || 0, from: 'From your clock' }
    : null;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(() => (offered ? { date: offered.date || '', start: offered.start || '', finish: offered.finish || '', breakMin: offered.breakMin == null ? null : offered.breakMin } : { date: '', start: '', finish: '', breakMin: null }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const problem = timesProblem(f);
  const hours = hoursBetween(f.start, f.finish, f.breakMin || 0);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api('log_my_job_hours', null, { job_id: jobId, hours, work_date: f.date, start_time: f.start, finish_time: f.finish, break_minutes: Number(f.breakMin) || 0, source: 'job_view' });
      if (!res || res.ok !== true) throw new ApiError((res && (res.error || res.message || res.code)) || 'Your hours were not saved.', { status: 409, code: res && res.code, body: res });
      setDone({ hours: res.hours != null ? Number(res.hours) : hours, date: f.date });
      setOpen(false); buzz([10, 40, 10]);
      toast(`${fmtHours(res.hours != null ? Number(res.hours) : hours)} saved for your invoice.`, { kind: 'ok' });
      invalidate('job:' + jobId); invalidate('myjobs'); invalidate('hours');
    } catch (err) { toast(plain(err), { kind: 'bad', ms: 6000 }); }
    setBusy(false);
  };

  const last = done || (saved[0] ? { hours: Number(saved[0].hours_worked), date: String(saved[0].scheduled_date || '').slice(0, 10) } : null);
  if (last && !open) {
    return html`<section class="inset hourscard">
      <div><span class="t-label">${title}</span><p class="t-head" style="margin-top:4px">${fmtHours(last.hours)} saved${last.date ? ` for ${fmtRelDay(last.date).toLowerCase() === 'today' ? 'today' : fmtDay(last.date)}` : ''}</p>
        <p class="t-small" style="margin-top:2px">They are on that week's invoice, ready to send.</p></div>
      <${Button} kind="line" small onClick=${() => setOpen(true)}>Change<//>
    </section>`;
  }
  return html`<section class="hoursform">
    <div><h2 class="t-head">${title}</h2><p class="t-small" style="margin-top:3px">So this job is on your invoice. Give the times you worked, the hours are worked out for you.</p></div>
    ${offered && !touched ? html`<div class="note-banner plain"><${Icon} name="clock" size=${18} /><span>${offered.from || 'Saved times'}${offered.date ? `, ${fmtDay(offered.date)}` : ''}. Change them if they are not right.</span></div>` : null}
    <${DayPick} label="Day you worked" value=${f.date} onChange=${(v) => { setTouched(true); setF((p) => ({ ...p, date: v })); }} />
    <${TimesBlock} value=${f} onChange=${(c) => { setTouched(true); setF((p) => ({ ...p, ...c })); }} />
    <${Button} block busy=${busy} disabled=${Boolean(problem)} onClick=${save}>${problem ? problem : `Save ${fmtHours(hours)} for my invoice`}<//>
    ${last ? html`<${Button} kind="quiet" block onClick=${() => setOpen(false)}>Leave them as they are<//>` : null}
  </section>`;
}
