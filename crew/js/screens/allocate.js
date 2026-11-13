// Book crew on a job (managers). One sheet: pick people, pick days, book.
// The same sheet shows who is on the job now, sets the lead and takes a day off.
import { html, cx, useMemo, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useStore, invalidate } from '../lib/store.js';
import { useJob } from '../lib/data.js';
import { todayISO, addDays, fmtDay, fmtDow, fmtDom, fmtTime, firstName } from '../lib/dates.js';
import { jobTitle } from '../lib/model.js';
import { useUsers, useAvailability, awayIndex, awayWord, bookable, daysWords } from '../lib/roster.js';
import { Icon } from '../ui/icons.js';
import { Sheet, Button, IconButton, Seg, Picks, Avatar, Chip, Skel, toast, ask, openOverlay, buzz } from '../ui/kit.js';

const WORKED = ['complete', 'completed', 'submitted', 'verified', 'invoiced'];
const TIMES = [['', 'No set time'], ['06:30', '6:30am'], ['07:00', '7am'], ['07:30', '7:30am'], ['other', 'Other']];

/** Open the booking sheet for a job. `vertical` is the job type, as the job page worked it out. */
export function openAllocate(job, vertical) {
  if (!job || !job.id) return;
  openOverlay((close) => html`<${AllocateSheet} job=${job} vertical=${vertical} onClose=${close} />`);
}

function refresh(jobId) { invalidate('job:' + jobId); invalidate('myjobs'); invalidate('team'); invalidate('board'); }

function AllocateSheet({ job, onClose }) {
  const user = useStore((s) => s.user);
  const today = todayISO();
  const q = useJob(job.id);
  const users = useUsers(true);
  const away = useAvailability(today, addDays(today, 13));
  const [mode, setMode] = useState('book');
  const [people, setPeople] = useState([]);
  const [days, setDays] = useState([]);
  const [page, setPage] = useState(0);
  const [time, setTime] = useState('');
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [failed, setFailed] = useState([]);

  const data = q.data;
  const crew = useMemo(() => ((data && data.crew) || []).filter((c) => String(c.status || '').toLowerCase() !== 'cancelled' && c.role !== 'observer'), [data]);
  const lead = data && data.leadInstaller;
  const leadKnown = Boolean(data) && ('leadInstaller' in data || crew.some((c) => 'is_lead' in c));

  // Who is on the job now, one entry per person.
  const onJob = useMemo(() => {
    const map = new Map();
    for (const c of crew) {
      const key = c.user_id || 'n:' + (c.name || c.crew_name || c.id);
      const p = map.get(key) || { key, id: c.user_id || null, name: c.name || (c.users && c.users.name) || c.crew_name || 'Crew', rows: [], lead: false };
      p.rows.push({ id: c.id, date: String(c.scheduled_date || '').slice(0, 10), start: c.start_time || null, status: String(c.status || '').toLowerCase() });
      if (c.is_lead === true || (lead && lead.user_id && lead.user_id === c.user_id)) p.lead = true;
      map.set(key, p);
    }
    return [...map.values()].map((p) => ({ ...p, rows: p.rows.sort((a, b) => (a.date || '9').localeCompare(b.date || '9')) }))
      .sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name));
  }, [crew, lead]);
  const onJobById = useMemo(() => new Map(onJob.filter((p) => p.id).map((p) => [p.id, p])), [onJob]);
  const countByDay = useMemo(() => {
    const m = new Map();
    for (const p of onJob) for (const r of p.rows) if (r.date) m.set(r.date, (m.get(r.date) || 0) + 1);
    return m;
  }, [onJob]);

  // Who can be picked: the people list when the server lets us read it, always
  // with the signed-in manager and anyone already on the job.
  const listRefused = Boolean(users.data && users.data.refused) || Boolean(users.error);
  const roster = useMemo(() => {
    const map = new Map();
    for (const u of bookable(users.data && users.data.users, user.id)) map.set(u.id, { id: u.id, name: u.name });
    for (const p of onJob) if (p.id && !map.has(p.id)) map.set(p.id, { id: p.id, name: p.name });
    if (!map.has(user.id)) map.set(user.id, { id: user.id, name: user.name });
    return [...map.values()].sort((a, b) => Number(b.id === user.id) - Number(a.id === user.id) || Number(onJobById.has(b.id)) - Number(onJobById.has(a.id)) || a.name.localeCompare(b.name));
  }, [users.data, onJob, user.id]);
  const awayBy = useMemo(() => awayIndex(away.data), [away.data]);
  const nameOf = (id) => (id === user.id ? 'You' : (roster.find((u) => u.id === id) || {}).name || 'Crew');
  const term = find.trim().toLowerCase();
  const shownRoster = term ? roster.filter((u) => u.name.toLowerCase().includes(term) || people.includes(u.id)) : roster;

  const window14 = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const pageDays = window14.slice(page * 7, page * 7 + 7);
  const start = time === 'other' ? other : time;
  const togglePerson = (id) => { buzz(6); setFailed([]); setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const toggleDay = (d) => { buzz(6); setFailed([]); setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort())); };
  const awayDays = (id, list) => { const m = awayBy.get(id); return m ? list.filter((d) => m.has(d)).map((d) => m.get(d)) : []; };

  const submit = async (shut) => {
    const clashes = people.flatMap((id) => awayDays(id, days).map((r) => `${nameOf(id)} ${r.status === 'leave' ? 'is on leave' : 'cannot work'} ${fmtDay(r.date)}`));
    if (clashes.length && !(await ask({ title: 'Book them anyway?', body: clashes.slice(0, 4).join('. ') + (clashes.length > 4 ? `, and ${clashes.length - 4} more.` : '.'), yes: 'Book anyway', no: 'Go back' }))) return;
    setBusy(true); setFailed([]);
    const jobs = people.flatMap((id) => days.map((d) => ({ id, d })));
    let made = 0; let already = 0; const bad = []; let stopped = false;
    for (let i = 0; i < jobs.length; i++) {
      const { id, d } = jobs[i];
      setStep(`Booking ${i + 1} of ${jobs.length}`);
      const body = { jobId: job.id, userId: id, scheduledDate: d };
      if (start) body.startTime = start;
      if (note.trim()) body.notes = note.trim();
      try {
        const res = await api('allocate_job', null, body);
        const ok = res && (res.ok === true || ['create', 'reassign', 'idempotent'].includes(res.mode));
        if (!ok) throw new ApiError((res && (res.error || res.message)) || 'That booking was not saved.', { status: 409, body: res });
        if (res.deduped || res.mode === 'idempotent') already += 1; else made += 1;
      } catch (err) {
        bad.push({ id, d, message: friendly(err) });
        if (err.offline) { stopped = true; break; }
      }
    }
    setBusy(false); setStep('');
    if (made || already) refresh(job.id);
    const who = people.length === 1 ? nameOf(people[0]) : `${people.length} people`;
    if (!bad.length) {
      buzz([12, 40, 20]);
      toast(made ? `Booked. ${who} ${people.length === 1 && people[0] !== user.id ? 'is' : 'are'} on ${jobTitle(job)}, ${daysWords(days)}.${already ? ` ${already} ${already === 1 ? 'was' : 'were'} already booked.` : ''}`
        : `Already booked. Nothing changed.`, { kind: 'ok', ms: 5000 });
      shut();
      return;
    }
    setFailed(bad);
    toast(stopped ? 'No signal. Some bookings were not sent.' : made || already ? `Booked ${made + already} of ${jobs.length}. See what was not booked.` : 'Not booked. See why below.', { kind: 'bad', ms: 5000 });
  };

  const removeDay = async (p, r) => {
    if (!(await ask({ title: `Take ${p.id === user.id ? 'yourself' : firstName(p.name)} off ${fmtDay(r.date)}?`, body: `${p.id === user.id ? 'You come' : p.name + ' comes'} off ${jobTitle(job)} for that day. Nobody is texted, so let them know.`, yes: 'Take off', danger: true }))) return;
    setStep('remove:' + r.id);
    try {
      await api('delete_assignment', null, { assignmentId: r.id });
      toast(`Done. ${p.id === user.id ? 'You are' : firstName(p.name) + ' is'} off ${fmtDay(r.date)}.`, { kind: 'ok' });
      refresh(job.id);
    } catch (err) { toast(friendly(err), { kind: 'bad', ms: 7000 }); }
    setStep('');
  };
  const setLead = async (p, clear) => {
    const row = p.rows.find((r) => !WORKED.includes(r.status)) || p.rows[0];
    setStep('lead:' + p.key);
    try {
      const res = await api('set_job_lead', null, clear ? { jobId: job.id, clear: true } : { jobId: job.id, assignmentId: row.id });
      toast(res && res.lead ? `${p.id === user.id ? 'You are' : firstName(p.name) + ' is'} the lead on this job.` : 'No lead on this job now.', { kind: 'ok' });
      refresh(job.id);
    } catch (err) { toast(friendly(err), { kind: 'bad', ms: 6000 }); }
    setStep('');
  };

  const n = people.length * days.length;
  const label = !people.length ? 'Pick who is going' : !days.length ? 'Pick the days' : people.length === 1 ? `Book ${people[0] === user.id ? 'myself' : firstName(nameOf(people[0]))} for ${days.length} ${days.length === 1 ? 'day' : 'days'}` : `Book ${people.length} people for ${days.length} ${days.length === 1 ? 'day' : 'days'}`;
  const textsOthers = people.some((id) => id !== user.id);

  return html`<${Sheet} tall title="Book crew" sub=${[jobTitle(job), job.job_number].filter(Boolean).join(' · ')} onClose=${onClose}
    foot=${mode === 'book' ? (shut) => html`<${Button} block busy=${busy} disabled=${!n} onClick=${() => submit(shut)}>${busy ? step : label}<//>` : null}>
    <div class="stack">
      ${onJob.length ? html`<${Seg} value=${mode} options=${[['book', 'Book'], ['crew', `On the job · ${onJob.length}`]]} onChange=${setMode} />` : null}

      ${mode === 'crew' ? html`<div class="stack">
        ${onJob.map((p) => html`<div class="crewcard" key=${p.key}>
          <div class="crewhead"><${Avatar} name=${p.name} me=${p.id === user.id} lg />
            <span class="grow"><b>${p.id === user.id ? 'You' : p.name}</b>${p.lead ? html`<${Chip} kind="solid">Lead<//>` : null}</span>
            ${leadKnown && p.id ? html`<${Button} kind="quiet" small busy=${step === 'lead:' + p.key} onClick=${() => setLead(p, p.lead)}>${p.lead ? 'Clear lead' : 'Make lead'}<//>` : null}
          </div>
          <div class="crewdays">${p.rows.map((r) => {
            const worked = WORKED.includes(r.status);
            return html`<span key=${r.id} class=${cx('chip', worked && 'ok', r.date === today && !worked && 'hi')}>
              ${worked ? html`<${Icon} name="check" size=${13} stroke=${2.6} />` : null}${r.date ? fmtDay(r.date) : 'No day set'}${r.start && !worked ? ' · ' + fmtTime(r.start) : ''}
              ${worked ? null : step === 'remove:' + r.id ? html`<i class="minispin" />` : html`<button type="button" class="chipx" aria-label=${`Take ${p.name} off ${r.date ? fmtDay(r.date) : 'this job'}`} onClick=${() => removeDay(p, r)}><${Icon} name="close" size=${14} stroke=${2.6} /></button>`}
            </span>`;
          })}</div>
          ${p.rows.some((r) => WORKED.includes(r.status)) ? html`<p class="t-small t-mute">Days already worked stay. The office changes those.</p>` : null}
        </div>`)}
        <p class="t-small t-mute">Tap the cross on a day to take that person off it.</p>
      </div>` : html`<div class="stack loose">
        <div class="field"><span>Who is going</span>
          ${roster.length > 8 ? html`<input class="input" type="search" placeholder="Find a person" value=${find} onInput=${(e) => setFind(e.currentTarget.value)} aria-label="Find a person" />` : null}
          ${users.loading && q.loading ? html`<div class="stack tight"><${Skel} h=${48} r=${14} /><${Skel} h=${48} r=${14} /><${Skel} h=${48} r=${14} /></div>` : html`<div>
            ${shownRoster.map((u) => {
              const on = onJobById.get(u.id);
              const offDays = awayDays(u.id, days.length ? days : window14);
              const picked = people.includes(u.id);
              return html`<button type="button" class="person" key=${u.id} aria-pressed=${String(picked)} onClick=${() => togglePerson(u.id)}>
                <${Avatar} name=${u.name} me=${u.id === user.id} lg />
                <span style="min-width:0"><b class="t-strong">${u.id === user.id ? 'You' : u.name}</b>
                  ${on ? html`<span class="t-small" style="display:block">On this job ${daysWords(on.rows.map((r) => r.date).filter(Boolean), 2)}</span>` : null}
                  ${offDays.length ? html`<span class=${cx('t-small', days.length ? 't-bad' : 't-mute')} style="display:block;font-weight:${days.length ? 620 : 440}">${awayWord(offDays[0].status)} ${daysWords(offDays.map((r) => r.date), 2)}</span>` : null}
                </span>
                <span class=${cx('tick', picked && 'on')}><${Icon} name="check" size=${16} stroke=${3} /></span>
              </button>`;
            })}
            ${term && !shownRoster.length ? html`<p class="t-small t-mute" style="padding:10px 0">Nobody by that name.</p>` : null}
          </div>`}
          ${listRefused ? html`<p class="t-small t-mute">${users.error ? 'Could not load the full team list. ' : 'The full team list is for the office. '}You can book yourself and anyone already on this job.${users.error ? html` <button type="button" class="linkbtn" onClick=${() => users.refetch()}>Try again</button>` : null}</p>` : null}
        </div>

        <div class="field"><span style="display:flex;justify-content:space-between;align-items:center">Which days
          <span style="display:flex;margin:-10px -8px -10px 0"><${IconButton} name="back" label="This week" size=${18} disabled=${page === 0} onClick=${() => setPage(0)} /><${IconButton} name="right" label="Next week" size=${18} disabled=${page === 1} onClick=${() => setPage(1)} /></span></span>
          <div class="daypicks">
            ${pageDays.map((d) => html`<button type="button" key=${d} class=${cx('daypick', d === today && 'today')} aria-pressed=${String(days.includes(d))} aria-label=${fmtDay(d) + (countByDay.get(d) ? `, ${countByDay.get(d)} on the job` : '')} onClick=${() => toggleDay(d)}>
              <span class="dow">${d === today ? 'Today' : fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span>${countByDay.get(d) ? html`<span class="t-small">${countByDay.get(d)} on</span>` : null}
            </button>`)}
          </div>
          ${days.some((d) => !pageDays.includes(d)) ? html`<p class="t-small">Also picked: ${daysWords(days.filter((d) => !pageDays.includes(d)), 4)}</p>` : null}
        </div>

        <div class="field"><span>Start time (optional)</span>
          <${Picks} value=${time} options=${TIMES} onChange=${setTime} />
          ${time === 'other' ? html`<input class="input big" type="time" step="300" value=${other} onInput=${(e) => setOther(e.currentTarget.value)} aria-label="Start time" />` : null}
        </div>

        <label class="field"><span>Note on the booking (optional)</span>
          <textarea class="input" rows="2" style="min-height:72px" placeholder="e.g. Bring the auger. Park on the verge." value=${note} onInput=${(e) => setNote(e.currentTarget.value)} /></label>

        <div class="note-banner plain"><${Icon} name="message" size=${18} /><span>${textsOthers || !people.length ? 'Each person gets a text for every day you book them. ' : ''}Booking yourself sends no text. The customer is not texted.</span></div>

        ${failed.length ? html`<div class="note-banner bad" role="alert"><${Icon} name="alert" size=${18} /><span><b class="t-strong">Not booked</b>
          ${failed.slice(0, 5).map((f) => html`<span style="display:block;margin-top:4px">${nameOf(f.id)}, ${fmtDay(f.d)}: ${f.message}</span>`)}
          ${failed.length > 5 ? html`<span style="display:block;margin-top:4px">And ${failed.length - 5} more.</span>` : null}</span></div>` : null}
      </div>`}
    </div>
  <//>`;
}
