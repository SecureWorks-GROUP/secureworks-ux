// Team week: who is where and who is free, day by day. No location tracking:
// every status comes from what the server already holds on a booking (clock on
// and off, "on my way", said yes) and from the days people marked off.
import { html, cx, useMemo, useRef, useState } from '../lib/h.js';
import { api } from '../lib/api.js';
import { useQuery, useStore } from '../lib/store.js';
import { useMyBookings, rememberJobStub } from '../lib/data.js';
import { manages } from '../lib/auth.js';
import { go } from '../lib/router.js';
import { todayISO, addDays, mondayOf, weekDays, fmtDow, fmtDom, fmtDowLong, fmtDate, fmtDay, fmtTime, fmtWeek, fmtRelDay, fmtHours, tsToHM, diffDays, firstName } from '../lib/dates.js';
import { jobTitle, jobAddress, jobIsClosed, sortBookings, verticalOf, VERTICAL_LABEL } from '../lib/model.js';
import { useTeam, useUsers, useAvailability, awayIndex, awayWord, fieldCrew, slimJob } from '../lib/roster.js';
import { Icon } from '../ui/icons.js';
import { Page, Tag, Chip, Button, IconButton, Sheet, Avatar, Skel, Empty, LoadError, toast, openOverlay, buzz } from '../ui/kit.js';

const TYPE_ORDER = ['fencing', 'patio', 'makesafe', 'repair', 'decking', 'restoration', 'other'];
const WORKED = ['complete', 'completed', 'submitted', 'verified', 'disputed'];
const RANK = { onsite: 0, travelling: 1, booked: 2, done: 3, free: 4, off: 5 };
const COUNT_WORD = { onsite: 'on site', travelling: 'on the way', booked: 'booked', done: 'done', free: 'free', off: 'off' };
const isDone = (b) => Boolean(b.clockOff) || WORKED.includes(b.status);
const openBooking = (job, vertical, preset) => import('./allocate.js').then((m) => m.openAllocate(job, vertical, preset)).catch(() => toast('Could not open that. Check your signal.', { kind: 'bad' }));

/** One plain status for a person on a day, from their bookings and days off. */
export function statusFor(items, off, day, today) {
  if (!items.length) {
    if (off) return { kind: 'off', text: awayWord(off.status), sub: off.note || '' };
    return { kind: 'free', text: day < today ? 'Nothing booked' : 'Free', sub: '' };
  }
  const hours = Math.round(items.reduce((s, b) => s + (Number(b.hours) || 0), 0) * 100) / 100;
  const where = (b) => jobTitle(b.job);
  if (day === today) {
    const live = items.find((b) => b.clockOn && !b.clockOff && !WORKED.includes(b.status));
    if (live) return { kind: 'onsite', text: `On site at ${where(live)} since ${fmtTime(tsToHM(live.clockOn))}`, sub: '' };
    const moving = items.find((b) => b.phase === 'travelling' && !isDone(b));
    if (moving) return { kind: 'travelling', text: `On the way to ${where(moving)}`, sub: '' };
  }
  if (items.every(isDone)) {
    if (day < today) return { kind: 'done', text: hours ? `Worked ${fmtHours(hours)}` : 'Finished', sub: '' };
    return { kind: 'done', text: `Done for the day${hours ? ', ' + fmtHours(hours) : ''}`, sub: '' };
  }
  const todo = items.filter((b) => !isDone(b));
  const more = todo.length > 1 ? ` +${todo.length - 1} more` : '';
  if (day < today) return { kind: 'booked', text: `Was booked: ${where(todo[0])}${more}`, sub: todo.some((b) => b.clockOn) ? 'Clocked on, never clocked off' : 'No hours on record' };
  const sub = todo.every((b) => b.status === 'confirmed') ? 'Locked in' : todo.some((b) => b.status === 'scheduled') ? 'Waiting on their OK' : '';
  return { kind: 'booked', text: `Booked: ${where(todo[0])}${more}`, sub: off ? `${sub ? sub + ' · ' : ''}Marked ${awayWord(off.status).toLowerCase()}` : sub, clash: Boolean(off) };
}

export function Team() {
  const user = useStore((s) => s.user);
  const manager = Boolean(user && user.manager);
  const today = todayISO();
  const [day, setDay] = useState(today);
  const [type, setType] = useState('all');
  const [allOpen, setAllOpen] = useState(false);
  const monday = mondayOf(day);
  const team = useTeam(manager ? user : null);
  const own = useMyBookings();
  const people = useUsers(manager);
  const away = useAvailability(monday, addDays(monday, 6), manager);
  const swipe = useRef(null);

  // Everyone's bookings, plus the manager's own on job types outside the ones they manage.
  const bookings = useMemo(() => {
    const list = (team.data && team.data.bookings) || [];
    const seen = new Set(list.map((b) => b.id));
    const mine = own.bookings.filter((b) => b.mine && !seen.has(b.id)).map((b) => ({ ...b, userId: user.id, userName: user.name, phase: '' }));
    return [...list, ...mine];
  }, [team.data, own.bookings, user && user.id]);
  const open = (team.data && team.data.open) || [];
  const types = useMemo(() => {
    const set = new Set([...bookings.map((b) => b.vertical), ...open.map((o) => o.vertical)]);
    return TYPE_ORDER.filter((t) => set.has(t));
  }, [bookings, open]);
  const pick = types.includes(type) ? type : 'all';
  const openShown = pick === 'all' ? open : open.filter((o) => o.vertical === pick);
  const awayBy = useMemo(() => awayIndex(away.data), [away.data]);
  const roster = (people.data && people.data.users) || [];

  const byDay = useMemo(() => {
    const map = new Map();
    for (const b of bookings) { if (!b.date) continue; if (!map.has(b.date)) map.set(b.date, []); map.get(b.date).push(b); }
    return map;
  }, [bookings]);

  // One row per person for the day picked: everyone booked, then the rest of the crew as free or off.
  const rows = useMemo(() => {
    const map = new Map();
    for (const b of sortBookings(byDay.get(day) || [])) {
      const key = b.userId || 'n:' + (b.userName || 'Crew');
      const p = map.get(key) || { key, id: b.userId || null, name: b.userName || 'Crew', items: [] };
      p.items.push(b); map.set(key, p);
    }
    for (const u of fieldCrew(roster)) if (!map.has(u.id)) map.set(u.id, { key: u.id, id: u.id, name: u.name, items: [] });
    const phones = new Map(roster.map((u) => [u.id, u.phone]));
    return [...map.values()].map((p) => {
      const off = p.id ? (awayBy.get(p.id) || new Map()).get(day) || null : null;
      return { ...p, me: p.id === user.id, phone: phones.get(p.id) || null, status: statusFor(p.items, off, day, today) };
    }).filter((p) => pick === 'all' || p.items.some((b) => b.vertical === pick))
      .sort((a, b) => RANK[a.status.kind] - RANK[b.status.kind] || Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
  }, [byDay, day, roster, awayBy, pick, today, user && user.id]);

  if (!manager) {
    return html`<${Page} title="Team week"><${Empty} title="This is for managers" action=${html`<${Button} kind="line" small icon="today" onClick=${() => go('/today', { tab: true })}>Back to your day<//>`}>
      The team week shows who is booked where. Your own jobs are on Today.
    <//><//>`;
  }

  const isToday = day === today;
  const loading = team.loading;
  const failed = team.error && !team.data;
  const reload = () => { buzz(6); team.refetch(); people.refetch(); away.refetch(); };
  const counts = rows.reduce((m, p) => { m[p.status.kind] = (m[p.status.kind] || 0) + 1; return m; }, {});
  const summary = Object.keys(RANK).filter((k) => counts[k]).map((k) => `${counts[k]} ${k === 'free' && day < today ? 'not booked' : COUNT_WORD[k]}`);
  const listKnown = Boolean(people.data) && !people.data.refused;

  const onTouchStart = (e) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    if (!swipe.current) return; const t = e.changedTouches[0];
    const dx = t.clientX - swipe.current.x; const dy = t.clientY - swipe.current.y; swipe.current = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) { buzz(6); setDay(addDays(day, dx < 0 ? 1 : -1)); }
  };
  const openJob = (job) => { rememberJobStub(job); go('/job/' + job.id); };
  const bookPerson = (p) => openOverlay((close) => html`<${JobPickSheet} person=${p} day=${day} user=${user} bookings=${bookings} open=${open} onClose=${close} />`);
  const openPerson = (p) => openOverlay((close) => html`<${PersonSheet} person=${p} day=${day} today=${today} onBook=${day >= today ? () => bookPerson(p) : null} onClose=${close} />`);

  return html`<${Page} title="Team week" right=${html`<button type="button" class="iconbtn" aria-label="Refresh" onClick=${reload}><${Icon} name="refresh" size=${20} class=${team.refreshing ? 'spin-slow' : ''} /></button>`}>
    <div onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
      <header class="dayhead">
        <div>
          <span class="t-label">Team · ${isToday ? 'Today' : fmtRelDay(day) === fmtDay(day) ? (diffDays(day, today) > 0 ? 'Coming up' : 'Earlier') : fmtRelDay(day)} · ${fmtDate(day)}</span>
          <h1 class="t-display" style="margin-top:4px">${fmtDowLong(day)}</h1>
        </div>
      </header>

      <div class="weeknav">
        <span class="t-label">${fmtWeek(monday)}</span>
        <span style="display:flex;align-items:center">
          ${!isToday ? html`<${Button} kind="quiet" small onClick=${() => setDay(today)}>Today<//>` : null}
          <${IconButton} name="back" label="Earlier week" size=${20} onClick=${() => setDay(addDays(day, -7))} />
          <${IconButton} name="right" label="Later week" size=${20} onClick=${() => setDay(addDays(day, 7))} />
        </span>
      </div>
      <div class="week" role="group" aria-label="Pick a day">
        ${weekDays(monday).map((d) => {
          const items = (byDay.get(d) || []).filter((b) => pick === 'all' || b.vertical === pick);
          const kinds = TYPE_ORDER.filter((t) => items.some((b) => b.vertical === t)).slice(0, 3);
          const n = new Set(items.map((b) => b.userId || b.userName)).size;
          return html`<button type="button" key=${d} class=${cx(d === today && 'today')} aria-pressed=${String(d === day)} aria-label=${fmtDay(d) + (n ? `, ${n} booked` : ', nobody booked')} onClick=${() => { buzz(6); setDay(d); }}>
            <span class="dow">${fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span>
            <span class="pips">${kinds.map((k) => html`<i class=${'jt-' + k} style="background:var(--jt)" />`)}</span>
          </button>`;
        })}
      </div>

      ${types.length > 1 ? html`<div class="typebar" role="group" aria-label="Show one job type">
        ${[['all', 'All'], ...types.map((t) => [t, VERTICAL_LABEL[t] || 'Job'])].map(([v, label]) => html`<button type="button" key=${v} class=${cx('pick', v !== 'all' && 'jt-' + v)} aria-pressed=${String(v === pick)} onClick=${() => { buzz(6); setType(v); }}>${label}</button>`)}
      </div>` : null}

      ${loading ? html`<${TeamSkeleton} />` : failed ? html`<${LoadError} error=${team.error} onRetry=${team.refetch} what="the team's week" />` : html`<div key=${day + pick} class="rise">
        ${summary.length ? html`<p class="teamsum" aria-live="polite">${summary.map((t, i) => html`<span>${t}${i < summary.length - 1 ? ',' : ''}</span> `)}</p>` : null}

        ${openShown.length ? html`<section class="block" style="margin-top:14px">
          <button type="button" class="openbar" aria-expanded=${String(allOpen)} onClick=${() => { buzz(6); setAllOpen(!allOpen); }}>
            <span><b>${openShown.length === 1 ? 'One job needs someone' : `${openShown.length} jobs need someone`}</b><small>${openShown.slice(0, 3).map((o) => jobTitle(o.job)).join(', ')}${openShown.length > 3 ? ` and ${openShown.length - 3} more` : ''}</small></span>
            <${Icon} name=${allOpen ? 'up' : 'down'} size=${20} />
          </button>
          ${allOpen ? html`<div class="openlist">${openShown.map((o) => html`<div class="openjob" key=${o.jobId}>
            <button type="button" class="openmain" onClick=${() => openJob(o.job)}>
              <b>${jobTitle(o.job)}</b>
              <span>${[jobAddress(o.job) !== jobTitle(o.job) ? jobAddress(o.job).replace(new RegExp(',\\s*' + jobTitle(o.job) + '$'), '') : '', o.job.client_name].filter(Boolean).join(' · ')}</span>
              <span class="meta"><${Tag} vertical=${o.vertical} />${o.job.job_number ? html`<span class="t-small t-mute t-num">${o.job.job_number}</span>` : null}</span>
            </button>
            ${manages(user, o.vertical) ? html`<${Button} kind="soft" small onClick=${() => openBooking(o.job, o.vertical, { days: day >= today ? [day] : [] })}>Book<//>` : null}
          </div>`)}</div>` : null}
        </section>` : null}

        <section class="section" style="margin-top:18px">
          <span class="t-label">${isToday ? 'Right now' : day < today ? 'What happened' : 'The plan'}</span>
          ${rows.length ? html`<div class="teamlist">${rows.map((p) => html`<div class=${cx('tp', p.status.kind)} key=${p.key}>
            <button type="button" class="tpmain" onClick=${() => openPerson(p)} aria-label=${`${p.name}. ${p.status.text}${p.status.sub ? '. ' + p.status.sub : ''}`}>
              <${Avatar} name=${p.name} me=${p.me} lg />
              <span class="tpbody"><b>${p.me ? 'You' : p.name}</b>
                <span class="tpstatus"><${StatusMark} kind=${p.status.kind} />${p.status.text}</span>
                ${p.status.sub ? html`<small class=${cx(p.status.clash && 't-hi')}>${p.status.sub}</small>` : null}</span>
            </button>
            ${p.status.kind === 'free' && day >= today ? html`<${Button} kind="soft" small onClick=${() => bookPerson(p)}>Book<//>` : null}
            ${p.items.length ? html`<span class="teamjobs">${p.items.map((b) => html`<button type="button" key=${b.id} class=${cx('teamjob', 'jt-' + b.vertical, isDone(b) && 'done')} onClick=${() => openJob(b.job)} aria-label=${`Open ${jobTitle(b.job)}`}>
              ${jobTitle(b.job)}${isDone(b) ? html`<small>${b.hours ? fmtHours(b.hours) : 'done'}</small>` : b.start ? html`<small>${fmtTime(b.start)}</small>` : null}
            </button>`)}</span>` : null}
          </div>`)}</div>` : html`<${Empty} title=${isToday ? 'Nobody is booked today' : `Nobody is booked on ${fmtDowLong(day)}`}
              action=${html`<div class="btnrow" style="margin-top:8px"><${Button} kind="line" small icon="board" onClick=${() => go('/board')}>Open the job board<//></div>`}>
            ${pick === 'all' ? 'Pick another day, or book someone from the job board.' : `No ${(VERTICAL_LABEL[pick] || 'job').toLowerCase()} bookings this day. Tap All to see every job type.`}
          <//>`}
          ${rows.length ? html`<p class="t-small t-mute block" style="margin-top:14px">${!listKnown ? 'Only people with a booking are shown. The full team list is for the office.' : user.office ? 'This comes from clock on, clock off and the days people marked off. Nobody is tracked.' : 'Free means nothing booked on the job types you manage. Nobody is tracked.'}</p>` : null}
        </section>
      </div>`}
      ${team.refreshing && !loading ? html`<p class="t-small t-mute" style="text-align:center;margin-top:18px">Checking for changes</p>` : null}
    </div>
  <//>`;
}

function StatusMark({ kind }) {
  if (kind === 'onsite') return html`<i class="pulse" />`;
  if (kind === 'travelling') return html`<${Icon} name="navigate" size=${14} stroke=${2.4} />`;
  if (kind === 'done') return html`<${Icon} name="check" size=${14} stroke=${2.8} />`;
  return html`<i class="mark" />`;
}

/** One person, one day: their status, a way to call them, and their jobs. */
function PersonSheet({ person, day, today, onBook, onClose }) {
  const p = person;
  const hasFoot = Boolean(onBook) || Boolean(p.phone && !p.me);
  return html`<${Sheet} title=${p.me ? 'You' : p.name} sub=${`${fmtRelDay(day) === fmtDay(day) ? fmtDay(day) : fmtRelDay(day) + ', ' + fmtDay(day)}`} onClose=${onClose}
    foot=${!hasFoot ? null : (shut) => html`
      ${onBook ? html`<${Button} kind=${p.items.length ? 'soft' : 'primary'} block icon="plus" onClick=${() => { shut(); setTimeout(onBook, 220); }}>${p.items.length ? 'Book on another job' : `Book ${p.me ? 'myself' : firstName(p.name)} on a job`}<//>` : null}
      ${p.phone && !p.me ? html`<a class="btn line block" href=${'tel:' + p.phone}><${Icon} name="phone" size=${20} />Call ${firstName(p.name)}</a>` : null}`}>
    ${(shut) => html`<div class="stack">
      <div class=${cx('tp solo', p.status.kind)}><span class="tpbody"><span class="tpstatus"><${StatusMark} kind=${p.status.kind} />${p.status.text}</span>${p.status.sub ? html`<small>${p.status.sub}</small>` : null}</span></div>
      ${p.items.length ? html`<div class="list ruled" style="margin:0 calc(-1 * var(--gut))">${p.items.map((b) => html`<button type="button" class="row" key=${b.id} onClick=${() => { shut(); rememberJobStub(b.job); go('/job/' + b.job.id); }}>
        <span class="main" style="grid-column:1 / span 2"><b>${jobTitle(b.job)}</b>
          <span>${[jobAddress(b.job) !== jobTitle(b.job) ? jobAddress(b.job) : '', b.job.client_name].filter(Boolean).join(' · ')}</span>
          <span style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-top:7px"><${Tag} vertical=${b.vertical} />
            ${isDone(b) ? html`<${Chip} kind="ok" icon="check">${b.hours ? fmtHours(b.hours) : 'Done'}<//>` : b.clockOn && day === today ? html`<${Chip} kind="hi">On the clock<//>` : b.start ? html`<span class="t-small">Start ${fmtTime(b.start)}</span>` : null}
            ${!isDone(b) && !b.clockOn && day >= today ? html`<span class="t-small t-mute">${b.status === 'confirmed' ? 'Locked in' : b.status === 'scheduled' ? 'Waiting on their OK' : ''}</span>` : null}</span></span>
        <span class="trail"><${Icon} name="right" size=${18} /></span>
      </button>`)}</div>` : html`<p class="t-small" style="max-width:34ch">${p.status.kind === 'off' ? 'They marked this day off, so check with them before you book it.' : day < today ? 'Nothing was booked this day.' : 'Nothing booked this day.'}</p>`}
    </div>`}
  <//>`;
}

/** Pick the job to book a person on: jobs waiting for a crew first, then a search. */
function JobPickSheet({ person, day, user, bookings, open, onClose }) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const timer = useRef(null);
  const today = todayISO();
  const onInput = (v) => { setText(v); clearTimeout(timer.current); timer.current = setTimeout(() => setTerm(v.trim()), 280); };
  const searching = term.length >= 2;
  const search = useQuery(searching ? 'search:' + term.toLowerCase() : null, () => api('search_all_jobs', { q: term }), { ttl: 60000 });
  const may = (v) => manages(user, v);
  const preset = { people: person.id ? [person.id] : [], names: person.id ? [{ id: person.id, name: person.name }] : [], days: day >= today ? [day] : [] };
  const choose = (job, vertical, shut) => { shut(); setTimeout(() => openBooking(job, vertical, preset), 220); };

  const suggestions = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const o of open) if (may(o.vertical) && !seen.has(o.jobId)) { seen.add(o.jobId); out.push({ job: o.job, vertical: o.vertical, hint: 'Needs someone' }); }
    const soon = bookings.filter((b) => b.date >= today && b.date <= addDays(today, 13) && may(b.vertical) && !jobIsClosed(b.job.status)).sort((a, b) => a.date.localeCompare(b.date));
    for (const b of soon) if (!seen.has(b.jobId)) { seen.add(b.jobId); out.push({ job: b.job, vertical: b.vertical, hint: `Crew on it ${fmtRelDay(b.date).toLowerCase()}` }); }
    return out.slice(0, 12);
  }, [open, bookings, today]);
  const results = searching && search.data ? ((search.data.jobs) || []).map((j) => ({ job: slimJob(j), vertical: verticalOf(j) })).filter((r) => may(r.vertical) && !jobIsClosed(r.job.status)) : [];
  const hidden = searching && search.data ? ((search.data.jobs) || []).length - results.length : 0;
  const list = searching ? results : suggestions;

  return html`<${Sheet} tall title=${`Book ${person.me ? 'yourself' : firstName(person.name)}`} sub=${day >= today ? `Which job, for ${fmtRelDay(day) === fmtDay(day) ? fmtDay(day) : fmtRelDay(day).toLowerCase()}? You can change the day next.` : 'Which job? You pick the days next.'} onClose=${onClose}>
    ${(shut) => html`<div class="stack">
      <div class="search">
        <${Icon} name="jobs" size=${20} />
        <input class="input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck=${false} placeholder="Suburb, name or job number" value=${text} onInput=${(e) => onInput(e.currentTarget.value)} aria-label="Find a job" />
      </div>
      ${searching && search.loading ? html`<div class="stack tight"><${Skel} h=${58} r=${14} /><${Skel} h=${58} r=${14} /></div>`
        : searching && search.error ? html`<${LoadError} error=${search.error} onRetry=${search.refetch} what="the search" />`
        : list.length ? html`<div><span class="t-label">${searching ? `${list.length} found` : 'Jobs coming up'}</span>
          <div class="list ruled" style="margin:6px calc(-1 * var(--gut)) 0">${list.map((r) => html`<button type="button" class="row" key=${r.job.id} onClick=${() => choose(r.job, r.vertical, shut)}>
            <span class="main" style="grid-column:1 / span 2"><b>${jobTitle(r.job)}</b>
              <span>${[jobAddress(r.job) !== jobTitle(r.job) ? jobAddress(r.job) : '', r.job.client_name].filter(Boolean).join(' · ')}</span>
              <span style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-top:7px"><${Tag} vertical=${r.vertical} />${r.job.job_number ? html`<span class="t-small t-mute t-num">${r.job.job_number}</span>` : null}${r.hint ? html`<span class=${cx('t-small', r.hint === 'Needs someone' && 't-hi')}>${r.hint}</span>` : null}</span></span>
            <span class="trail"><${Icon} name="right" size=${18} /></span>
          </button>`)}</div></div>`
        : html`<p class="t-small" style="max-width:34ch">${searching ? (hidden ? `"${term}" matches ${hidden === 1 ? 'a job' : 'jobs'} you cannot book crew on. You can book on the job types you manage.` : `Nothing matches "${term}". Try the suburb or the job number.`) : 'Type a suburb, a customer name or a job number to find the job.'}</p>`}
    </div>`}
  <//>`;
}

function TeamSkeleton() {
  return html`<div class="teamlist" style="margin-top:26px">${[0, 1, 2, 3].map(() => html`<div class="tp"><div class="tpmain"><${Skel} w=${44} h=${44} r=${22} /><span class="tpbody" style="display:grid;gap:7px"><${Skel} w="42%" h=${18} /><${Skel} w="70%" h=${13} /></span></div></div>`)}</div>`;
}
