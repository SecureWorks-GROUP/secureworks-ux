// Team week: who is where, day by day, for the people a manager looks after.
// One read (everyone's bookings), grouped by person for the day picked.
import { html, cx, useMemo, useRef, useState } from '../lib/h.js';
import { useStore } from '../lib/store.js';
import { useMyBookings, rememberJobStub } from '../lib/data.js';
import { manages } from '../lib/auth.js';
import { go } from '../lib/router.js';
import { todayISO, addDays, mondayOf, weekDays, fmtDow, fmtDom, fmtDowLong, fmtDate, fmtDay, fmtTime, fmtWeek, fmtRelDay, diffDays, firstName } from '../lib/dates.js';
import { bookingState, jobTitle, jobAddress, sortBookings, VERTICAL_LABEL } from '../lib/model.js';
import { useTeam, useUsers, useAvailability, awayIndex, awayWord, fieldCrew } from '../lib/roster.js';
import { Icon } from '../ui/icons.js';
import { Page, Tag, Chip, Button, IconButton, Avatar, Skel, Empty, LoadError, toast, buzz } from '../ui/kit.js';

const TYPE_ORDER = ['fencing', 'patio', 'makesafe', 'repair', 'decking', 'restoration', 'other'];

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
    const mine = own.bookings.filter((b) => b.mine && !seen.has(b.id)).map((b) => ({ ...b, userId: user.id, userName: user.name }));
    return [...list, ...mine];
  }, [team.data, own.bookings, user && user.id]);
  const open = (team.data && team.data.open) || [];
  const types = useMemo(() => {
    const set = new Set([...bookings.map((b) => b.vertical), ...open.map((o) => o.vertical)]);
    return TYPE_ORDER.filter((t) => set.has(t));
  }, [bookings, open]);
  const pick = types.includes(type) ? type : 'all';
  const shown = pick === 'all' ? bookings : bookings.filter((b) => b.vertical === pick);
  const openShown = pick === 'all' ? open : open.filter((o) => o.vertical === pick);
  const awayBy = useMemo(() => awayIndex(away.data), [away.data]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const b of shown) { if (!b.date) continue; if (!map.has(b.date)) map.set(b.date, []); map.get(b.date).push(b); }
    return map;
  }, [shown]);

  if (!manager) {
    return html`<${Page} title="Team week"><${Empty} title="This is for managers" action=${html`<${Button} kind="line" small icon="today" onClick=${() => go('/today', { tab: true })}>Back to your day<//>`}>
      The team week shows who is booked where. Your own jobs are on Today.
    <//><//>`;
  }

  const list = byDay.get(day) || [];
  const rows = groupByPerson(list, user);
  const busyAnyType = new Set(bookings.filter((b) => b.date === day).map((b) => b.userId || b.userName));
  const roster = (people.data && people.data.users) || [];
  const free = fieldCrew(roster).filter((u) => !busyAnyType.has(u.id) && !busyAnyType.has(u.name))
    .map((u) => ({ ...u, away: (awayBy.get(u.id) || new Map()).get(day) || null }))
    .sort((a, b) => Number(Boolean(a.away)) - Number(Boolean(b.away)) || a.name.localeCompare(b.name));
  const isToday = day === today;
  const loading = team.loading;
  const failed = team.error && !team.data;
  const reload = () => { buzz(6); team.refetch(); people.refetch(); away.refetch(); };

  const onTouchStart = (e) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    if (!swipe.current) return; const t = e.changedTouches[0];
    const dx = t.clientX - swipe.current.x; const dy = t.clientY - swipe.current.y; swipe.current = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) { buzz(6); setDay(addDays(day, dx < 0 ? 1 : -1)); }
  };
  const book = (o) => import('./allocate.js').then((m) => m.openAllocate(o.job, o.vertical)).catch(() => toast('Could not open that. Check your signal.', { kind: 'bad' }));
  const openJob = (job) => { rememberJobStub(job); go('/job/' + job.id); };
  const openList = allOpen ? openShown : openShown.slice(0, 3);

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
          const items = byDay.get(d) || [];
          const kinds = TYPE_ORDER.filter((t) => items.some((b) => b.vertical === t)).slice(0, 3);
          return html`<button type="button" key=${d} class=${cx(d === today && 'today')} aria-pressed=${String(d === day)} aria-label=${fmtDay(d) + (items.length ? `, ${items.length} booked` : ', nobody booked')} onClick=${() => { buzz(6); setDay(d); }}>
            <span class="dow">${fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span>
            <span class="pips">${kinds.map((k) => html`<i class=${'jt-' + k} style="background:var(--jt)" />`)}</span>
          </button>`;
        })}
      </div>

      ${types.length > 1 ? html`<div class="typebar" role="group" aria-label="Show one job type">
        ${[['all', 'All'], ...types.map((t) => [t, VERTICAL_LABEL[t] || 'Job'])].map(([v, label]) => html`<button type="button" key=${v} class=${cx('pick', v !== 'all' && 'jt-' + v)} aria-pressed=${String(v === pick)} onClick=${() => { buzz(6); setType(v); }}>${label}</button>`)}
      </div>` : null}

      ${loading ? html`<${TeamSkeleton} />` : failed ? html`<${LoadError} error=${team.error} onRetry=${team.refetch} what="the team's week" />` : html`<div key=${day + pick} class="rise">
        ${openShown.length ? html`<section class="section">
          <span class="t-label t-hi">Needs someone · ${openShown.length}</span>
          <div class="needlist">${openList.map((o) => html`<div class="need" key=${o.jobId}>
            <button type="button" class="needmain" onClick=${() => openJob(o.job)}>
              <b>${jobTitle(o.job)}</b>
              <span>${[jobAddress(o.job) !== jobTitle(o.job) ? jobAddress(o.job) : '', o.job.client_name].filter(Boolean).join(' · ')}</span>
              <span class="meta"><${Tag} vertical=${o.vertical} />${o.job.job_number ? html`<span class="t-small t-mute t-num">${o.job.job_number}</span>` : null}</span>
            </button>
            ${manages(user, o.vertical) ? html`<${Button} kind="soft" small onClick=${() => book(o)}>Book<//>` : null}
          </div>`)}</div>
          ${openShown.length > 3 ? html`<div class="block"><${Button} kind="quiet" small onClick=${() => setAllOpen(!allOpen)}>${allOpen ? 'Show fewer' : `Show all ${openShown.length}`}<//></div>` : null}
        </section>` : null}

        <section class="section">
          <span class="t-label">${rows.length ? `On the job · ${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : 'On the job'}</span>
          ${rows.length ? html`<div class="teamday">${rows.map((p) => {
            const off = p.id ? (awayBy.get(p.id) || new Map()).get(day) : null;
            return html`<div class="teamrow" key=${p.key}>
              <span class="teamwho"><b>${p.me ? 'You' : firstName(p.name) || 'Crew'}</b>${p.me ? null : html`<small>${p.name.split(/\s+/).slice(1).join(' ')}</small>`}</span>
              <span class="teamjobs">
                ${p.items.map((b) => { const st = bookingState(b); return html`<button type="button" key=${b.id} class=${cx('teamjob', 'jt-' + b.vertical, st)} onClick=${() => openJob(b.job)} aria-label=${`${jobTitle(b.job)}, ${VERTICAL_LABEL[b.vertical] || 'job'}${b.start ? ', ' + fmtTime(b.start) : ''}`}>
                  ${jobTitle(b.job)}${st === 'live' ? html`<i class="pulse" />` : st === 'done' ? html`<${Icon} name="check" size=${14} stroke=${2.6} />` : b.start ? html`<small>${fmtTime(b.start)}</small>` : null}
                </button>`; })}
                ${off ? html`<${Chip} kind="warn">${awayWord(off.status)}${off.note ? ' · ' + off.note : ''}<//>` : null}
              </span>
            </div>`;
          })}</div>` : html`<${Empty} title=${isToday ? 'Nobody is booked today' : `Nobody is booked on ${fmtDowLong(day)}`}
              action=${html`<div class="btnrow" style="margin-top:8px"><${Button} kind="line" small icon="board" onClick=${() => go('/board')}>Open the job board<//></div>`}>
            ${pick === 'all' ? 'Pick another day, or book someone from the job board.' : `No ${(VERTICAL_LABEL[pick] || 'job').toLowerCase()} bookings this day. Tap All to see every job type.`}
          <//>`}
        </section>

        ${free.length ? html`<section class="section">
          <span class="t-label">Free · ${free.filter((u) => !u.away).length}</span>
          <div class="freelist">${free.map((u) => html`<span key=${u.id} class=${cx('freeperson', u.away && 'away')}><${Avatar} name=${u.name} /><span><b>${u.name}</b>${u.away ? html`<small>${awayWord(u.away.status)}${u.away.note ? ' · ' + u.away.note : ''}</small>` : null}</span></span>`)}</div>
          ${user.office ? null : html`<p class="t-small t-mute block" style="margin-top:10px">Free means nothing booked on the job types you manage.</p>`}
        </section>` : null}
      </div>`}
      ${team.refreshing && !loading ? html`<p class="t-small t-mute" style="text-align:center;margin-top:18px">Checking for changes</p>` : null}
    </div>
  <//>`;
}

/** One row per person for a day, the signed-in manager first. */
function groupByPerson(list, user) {
  const map = new Map();
  for (const b of sortBookings(list)) {
    const key = b.userId || 'n:' + (b.userName || 'Crew');
    const p = map.get(key) || { key, id: b.userId || null, name: b.userName || 'Crew', me: Boolean(b.userId) && b.userId === user.id, items: [] };
    p.items.push(b); map.set(key, p);
  }
  return [...map.values()].sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
}

function TeamSkeleton() {
  return html`<div class="teamday" style="margin-top:26px">${[0, 1, 2].map(() => html`<div class="teamrow"><${Skel} w=${52} h=${18} /><span class="teamjobs"><${Skel} w=${120} h=${34} r=${10} /><${Skel} w=${92} h=${34} r=${10} /></span></div>`)}</div>`;
}
