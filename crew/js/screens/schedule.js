// Schedule: the calendar. A trade sees their own bookings as a week of day
// rows or a month grid. Managers and the office can switch to Everyone: who is
// where, day by day, and the jobs still waiting for a crew. No location
// tracking: every status comes from what the server already holds on a booking
// (clock on and off, "on my way", confirmed) and the days people marked off.
import { html, cx, useMemo, useRef, useState } from '../lib/h.js';
import { api } from '../lib/api.js';
import { useQuery, useStore } from '../lib/store.js';
import { useMyBookings, rememberJobStub } from '../lib/data.js';
import { manages } from '../lib/auth.js';
import { go } from '../lib/router.js';
import {
  todayISO, addDays, addMonths, mondayOf, monthStart, weekDays, dowOf, isISODate, fmtDow, fmtDom, fmtDay, fmtDayLong, fmtMonth, fmtRelDay, fmtTime, fmtHours, tsToHM, firstName
} from '../lib/dates.js';
import { jobTitle, jobAddress, jobIsClosed, sortBookings, bookingsByDate, verticalOf, VERTICAL_LABEL } from '../lib/model.js';
import { useTeam, useUsers, useAvailability, awayIndex, awayWord, fieldCrew, slimJob, boardsFor } from '../lib/roster.js';
import { Icon } from '../ui/icons.js';
import { Page, Seg, Section, Button, Sheet, JobLine, StatusBadge, Skel, Empty, LoadError, toast, openOverlay, buzz } from '../ui/kit.js';
import { needsOk, useMyDaysOff, BookingItem } from './bookings.js';
import { fmtWeekYear, fmtHrs, shortName } from './words.js';

const TYPE_ORDER = ['fencing', 'patio', 'makesafe', 'repair', 'decking', 'restoration', 'other'];
const WORKED = ['complete', 'completed', 'submitted', 'verified', 'disputed'];
const isDone = (b) => Boolean(b.clockOff) || WORKED.includes(b.status);
const openAllocateFor = (job, vertical, preset) => import('./allocate.js').then((m) => m.openAllocate(job, vertical, preset)).catch(() => toast('Could not open that. Check your signal.', { kind: 'bad' }));
const openJob = (job) => { rememberJobStub(job); go('/job/' + job.id); };
/** Street and customer under a job's suburb: '64 Coode Street · Tom Okafor'. */
function whereLine(job) {
  const title = jobTitle(job); const addr = jobAddress(job);
  const street = addr && addr !== title ? (addr.endsWith(', ' + title) ? addr.slice(0, -title.length - 2) : addr) : '';
  return [street, job.client_name].filter(Boolean).join(' · ');
}

export function Schedule({ view = 'week', day: dayProp }) {
  const user = useStore((s) => s.user);
  const manager = Boolean(user && user.manager);
  const today = todayISO();
  const day = isISODate(dayProp) ? String(dayProp).slice(0, 10) : today;
  // Everyone is for managers and the office. A trade who lands there sees their own week.
  const shown = view === 'month' ? 'month' : view === 'everyone' && manager ? 'everyone' : 'week';
  const to = (v, d = day) => go((v === 'week' ? '/schedule' : '/schedule/' + v) + (d !== today ? '?day=' + d : ''), { replace: true });
  const monday = mondayOf(day);
  const month = monthStart(day);
  const step = (n) => {
    buzz(6);
    if (shown !== 'month') { to(shown, addDays(day, n * 7)); return; }
    const m = addMonths(month, n);
    to('month', m.slice(0, 7) === today.slice(0, 7) ? today : m);
  };
  const right = shown === 'everyone' ? html`<span>${user.office ? 'Office view' : 'Manager view'}</span>`
    : html`<button type="button" class="sched-avail" onClick=${() => go('/schedule/availability')}>Set availability</button>`;

  return html`<${Page} root flush title="Schedule" right=${right}>
    <div class="sched-band">
      ${manager ? html`<${Seg} value=${shown === 'everyone' ? 'everyone' : 'mine'} options=${[['mine', 'Mine'], ['everyone', 'Everyone']]} onChange=${(v) => to(v === 'everyone' ? 'everyone' : 'week')} />` : null}
      ${shown !== 'everyone' ? html`<${Seg} value=${shown} options=${[['week', 'Week'], ['month', 'Month']]} onChange=${(v) => to(v)} />` : null}
      <div class="sched-nav">
        <button type="button" class="iconbtn" aria-label=${shown === 'month' ? 'Earlier month' : 'Earlier week'} onClick=${() => step(-1)}><${Icon} name="back" size=${20} stroke=${2.2} /></button>
        <span class="t-strong nums">${shown === 'month' ? fmtMonth(month) : fmtWeekYear(monday)}</span>
        <button type="button" class="iconbtn" aria-label=${shown === 'month' ? 'Later month' : 'Later week'} onClick=${() => step(1)}><${Icon} name="right" size=${20} stroke=${2.2} /></button>
      </div>
    </div>
    ${shown === 'everyone' ? html`<${Everyone} user=${user} day=${day} today=${today} monday=${monday} onToday=${() => to('everyone', today)} />`
      : html`<${Mine} shown=${shown} day=${day} today=${today} monday=${monday} month=${month} to=${to} />`}
  <//>`;
}

// ================================================================== mine
function Mine({ shown, day, today, monday, month, to }) {
  const { bookings, loading, error, refetch, refreshing } = useMyBookings();
  const mine = useMemo(() => bookings.filter((b) => b.mine !== false), [bookings]);
  const byDate = useMemo(() => bookingsByDate(mine), [mine]);
  if (loading) return html`<div class="sched-load"><${Skel} w="60%" h=${16} />${[0, 1, 2, 3, 4].map(() => html`<${Skel} h=${56} />`)}</div>`;
  if (error && !bookings.length) return html`<${LoadError} error=${error} onRetry=${refetch} what="your bookings" />`;
  return html`
    ${shown === 'month' ? html`<${MonthView} day=${day} today=${today} month=${month} byDate=${byDate} to=${to} />`
      : html`<${WeekView} day=${day} today=${today} monday=${monday} byDate=${byDate} to=${to} />`}
    ${error ? html`<p class="block t-small" style="margin-top:12px">Showing the last saved copy. ${error.offline ? 'No signal.' : ''}</p>` : null}
    ${refreshing ? html`<p class="t-small" style="text-align:center;margin-top:12px">Checking for changes</p>` : null}`;
}

function DayCell({ d }) { return html`<span class="daycell"><span class="dow">${fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span></span>`; }
const offWord = (off) => (off.status === 'leave' ? 'Leave' : 'Day off');

/** A day with no booking: unavailable, available (with a way to find a job), or a past day with nothing on it. */
function EmptyDay({ d, today, off, cell = true }) {
  const cls = cx('item', cell && 'day', d === today && 'today');
  const lead = cell ? html`<${DayCell} d=${d} />` : null;
  if (off) {
    return html`<button type="button" class=${cls} onClick=${() => go('/schedule/availability')}>${lead}
      <span class="main"><span class="sub">No booking</span><b>${offWord(off)}</b><span class="sub">${off.note && off.note !== 'Weekly pattern' ? off.note : 'You marked this day unavailable'}</span></span>
      <span class="side"><${StatusBadge} status="unavailable" /></span></button>`;
  }
  if (d < today) return html`<div class=${cls}>${lead}<span class="main"><span class="sub">No booking</span></span><span /></div>`;
  return html`<button type="button" class=${cls} onClick=${() => go('/jobs', { tab: true })}>${lead}
    <span class="main"><span class="sub">No booking</span><span class="link">Find a job</span></span>
    <span class="side"><span class="badge freeday">Available</span></span></button>`;
}

function WeekView({ day, today, monday, byDate, to }) {
  const daysOff = useMyDaysOff(monday);
  const days = weekDays(monday);
  const booked = days.filter((d) => (byDate.get(d) || []).length).length;
  const confirm = days.reduce((n, d) => n + (byDate.get(d) || []).filter(needsOk).length, 0);
  const off = days.filter((d) => daysOff.has(d)).length;
  const summary = [booked ? `${booked} ${booked === 1 ? 'day' : 'days'} booked` : 'No days booked', confirm ? `${confirm} to confirm` : '', off ? `${off} unavailable` : ''].filter(Boolean).join(' · ');
  return html`
    <div class="sched-sum"><span class="nums">${summary}</span>${monday !== mondayOf(today) ? html`<button type="button" class="link tap" onClick=${() => to('week', today)}>This week</button>` : null}</div>
    <div class="list flat sched-week" key=${monday}>
      ${days.map((d) => {
        const items = byDate.get(d) || [];
        if (!items.length) return html`<${EmptyDay} key=${d} d=${d} today=${today} off=${daysOff.get(d)} />`;
        return items.map((b, i) => html`<${BookingItem} key=${b.id} booking=${b} day=${i === 0} today=${d === today} />`);
      })}
    </div>`;
}

function MonthView({ day, today, month, byDate, to }) {
  const first = month;
  const last = addDays(addMonths(month, 1), -1);
  const daysOff = useMyDaysOff(first, last);
  const days = Array.from({ length: Number(last.slice(8)) }, (_, i) => addDays(first, i));
  const lead = (dowOf(first) + 6) % 7;
  const kindOf = (d) => {
    const items = byDate.get(d) || [];
    if (items.some(needsOk)) return 'tent';
    if (items.length) return 'booked';
    return daysOff.has(d) ? 'off' : 'free';
  };
  const count = { booked: 0, tent: 0, off: 0, free: 0 };
  for (const d of days) {
    const k = kindOf(d);
    if (k === 'free') { if (dowOf(d) >= 1 && dowOf(d) <= 5) count.free += 1; } else count[k] += 1;
  }
  const chosen = day.slice(0, 7) === month.slice(0, 7) ? day : first;
  const items = byDate.get(chosen) || [];
  const word = { booked: 'booked', tent: 'to confirm', off: 'unavailable', free: 'no booking' };
  return html`
    <div class="sched-month">
      <div class="mhead" aria-hidden="true">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<span>${d}</span>`)}</div>
      <div class="mgrid" role="group" aria-label=${fmtMonth(month)}>
        ${Array.from({ length: lead }, () => html`<span />`)}
        ${days.map((d) => {
          const k = kindOf(d);
          return html`<button type="button" key=${d} class=${cx('mday', k, daysOff.has(d) && 'isoff', d === today && 'today')} aria-pressed=${String(d === chosen)} aria-label=${`${fmtDay(d)}, ${word[k]}`} onClick=${() => { buzz(6); to('month', d); }}>
            <span class="num">${fmtDom(d)}</span><i class="mark" />
          </button>`;
        })}
      </div>
    </div>
    <div class="block sched-under">
      <div class="stats sched-stats">
        <div><b>${count.booked}</b><span><i class="mk booked" />Booked</span></div>
        <div><b>${count.tent}</b><span><i class="mk tent" />To confirm</span></div>
        <div><b>${count.off}</b><span><i class="mk off" />Off</span></div>
        <div><b>${count.free}</b><span>Free weekdays</span></div>
      </div>
    </div>
    <${Section} label=${fmtDay(chosen)} class="sched-day">
      <div class="block card">
        ${items.length ? items.map((b) => html`<${BookingItem} key=${b.id} booking=${b} />`)
          : html`<${EmptyDay} d=${chosen} today=${today} off=${daysOff.get(chosen)} cell=${false} />`}
      </div>
    <//>
    <div class="block" style="margin-top:16px"><${Button} kind="line" block onClick=${() => go('/schedule/availability')}>Mark days unavailable<//></div>`;
}

// ============================================================== everyone
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
  const sub = todo.every((b) => b.status === 'confirmed') ? 'Confirmed' : todo.some((b) => b.status === 'scheduled') ? 'Waiting for them to confirm' : '';
  return { kind: 'booked', text: `Booked: ${where(todo[0])}${more}`, sub: off ? `${sub ? sub + ' · ' : ''}Marked ${awayWord(off.status).toLowerCase()}` : sub, clash: Boolean(off) };
}

/** A short code for a suburb: 'South Perth' -> 'SPER', 'Joondalup' -> 'JOON'. */
function placeCode(title) {
  const words = String(title || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'JOB';
  return words.length === 1 ? words[0].slice(0, 4) : words[0][0] + words[words.length - 1].slice(0, 3);
}
/** What one grid cell shows: done | conf | tent | onsite | off | free | none. */
function cellFor(items, off, d, today) {
  if (items.length) {
    const live = d === today ? items.find((b) => b.clockOn && !b.clockOff && !WORKED.includes(b.status)) : null;
    const b = live || items.find((x) => !isDone(x)) || items[0];
    const kind = live ? 'onsite' : items.every(isDone) || d < today ? 'done' : items.some((x) => !isDone(x) && x.status === 'scheduled') ? 'tent' : 'conf';
    return { kind, text: placeCode(jobTitle(b.job)), more: items.length - 1, job: b.job };
  }
  if (off) return { kind: 'off', text: 'Off' };
  return d >= today ? { kind: 'free', text: 'Free' } : { kind: 'none', text: '' };
}
const CELL_WORD = { done: 'done', conf: 'confirmed', tent: 'to confirm', onsite: 'on site now', off: 'off', free: 'free', none: 'nothing booked' };

function Everyone({ user, day, today, monday, onToday }) {
  const [type, setType] = useState('all');
  const team = useTeam(user);
  const own = useMyBookings();
  const people = useUsers(true);
  const away = useAvailability(monday, addDays(monday, 6), true);

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
    // Only the kinds of job this person manages (the office manages them all).
    return TYPE_ORDER.filter((t) => set.has(t) && manages(user, t));
  }, [bookings, open, user]);
  const pick = types.includes(type) ? type : 'all';
  const openShown = pick === 'all' ? open : open.filter((o) => o.vertical === pick);
  const awayBy = useMemo(() => awayIndex(away.data), [away.data]);
  const roster = (people.data && people.data.users) || [];
  const week = weekDays(monday);
  const sunday = week[6];

  // One row per person: everyone booked this week, then the rest of the crew as free or off.
  const rows = useMemo(() => {
    const map = new Map();
    for (const b of sortBookings(bookings)) {
      if (!b.date || b.date < monday || b.date > sunday) continue;
      const key = b.userId || 'n:' + (b.userName || 'Crew');
      const p = map.get(key) || { key, id: b.userId || null, name: b.userName || 'Crew', days: new Map() };
      if (!p.days.has(b.date)) p.days.set(b.date, []);
      p.days.get(b.date).push(b); map.set(key, p);
    }
    for (const u of fieldCrew(roster)) if (!map.has(u.id)) map.set(u.id, { key: u.id, id: u.id, name: u.name, days: new Map() });
    const phones = new Map(roster.map((u) => [u.id, u.phone]));
    return [...map.values()].map((p) => ({ ...p, me: p.id === user.id, phone: phones.get(p.id) || null, off: (p.id && awayBy.get(p.id)) || new Map() }))
      .filter((p) => pick === 'all' || [...p.days.values()].some((items) => items.some((b) => b.vertical === pick)))
      .sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
  }, [bookings, monday, roster, awayBy, pick, user && user.id]);
  const cols = rows.some((p) => (p.days.get(sunday) || []).length) ? week : week.slice(0, 6);

  const listKnown = Boolean(people.data) && !people.data.refused;
  const boards = boardsFor(user);
  const bookPerson = (p, d) => openOverlay((close) => html`<${JobPickSheet} person=${p} day=${d} user=${user} bookings=${bookings} open=${open} onClose=${close} />`);
  const openPerson = (p, d) => openOverlay((close) => html`<${PersonSheet} person=${{ ...p, items: p.days.get(d) || [], status: statusFor(p.days.get(d) || [], p.off.get(d) || null, d, today) }} day=${d} today=${today} onBook=${d >= today ? () => bookPerson(p, d) : null} onClose=${close} />`);
  const tapCell = (p, d, cell) => {
    const items = p.days.get(d) || [];
    if (cell.kind === 'free') bookPerson(p, d);
    else if (cell.kind === 'off' || items.length > 1) openPerson(p, d);
    else if (cell.job) openJob(cell.job);
  };

  return html`
    ${types.length > 1 ? html`<div class="sched-band tight"><div class="typepicks" role="group" aria-label="Show one kind of job">
      ${[...types.map((t) => [t, VERTICAL_LABEL[t] || 'Job']), ['all', 'All']].map(([v, label]) => html`<button type="button" key=${v} class="pick" aria-pressed=${String(v === pick)} onClick=${() => { buzz(6); setType(v); }}>${label}</button>`)}
    </div></div>` : null}

    ${team.loading ? html`<div class="sched-load">${[0, 1, 2, 3, 4].map(() => html`<${Skel} h=${44} />`)}</div>`
      : team.error && !team.data ? html`<${LoadError} error=${team.error} onRetry=${team.refetch} what="everyone's week" />`
      : html`<div class="everyone" key=${monday + pick}>
      ${monday !== mondayOf(today) ? html`<div class="sched-sum"><span>${monday < mondayOf(today) ? 'An earlier week' : 'A later week'}</span><button type="button" class="link tap" onClick=${onToday}>This week</button></div>` : null}
      ${rows.length ? html`<div class=${cx('whogrid', cols.length > 6 && 'seven')} role="group" aria-label="Who is where this week" style=${`grid-template-columns:78px repeat(${cols.length}, minmax(0, 1fr))`}>
        <span class="wh" />
        ${cols.map((d) => html`<span key=${d} class=${cx('wh', d === today && 'today')}><span>${fmtDow(d)}</span><span>${fmtDom(d)}</span></span>`)}
        ${rows.map((p) => html`
          <button type="button" key=${p.key} class="wname" onClick=${() => openPerson(p, cols.includes(today) ? today : cols[0])} aria-label=${`${p.name}, open their day`}><span class="clip">${p.me ? 'You' : shortName(p.name)}</span></button>
          ${cols.map((d) => {
            const cell = cellFor(p.days.get(d) || [], p.off.get(d) || null, d, today);
            if (cell.kind === 'none') return html`<span key=${p.key + d} class="wcell none" aria-label=${`${p.name}, ${fmtDay(d)}: nothing booked`} />`;
            return html`<button type="button" key=${p.key + d} class=${cx('wcell', cell.kind)} onClick=${() => tapCell(p, d, cell)} aria-label=${`${p.name}, ${fmtDay(d)}: ${cell.kind === 'off' || cell.kind === 'free' ? '' : jobTitle(cell.job) + ', '}${CELL_WORD[cell.kind]}${cell.more ? `, and ${cell.more} more` : ''}`}><span>${cell.text}</span>${cell.more ? html`<small>+${cell.more}</small>` : null}</button>`;
          })}`)}
      </div>
      <div class="wlegend" aria-hidden="true">
        <span><i class="done" />Done</span><span><i class="conf" />Confirmed</span><span><i class="tent" />To confirm</span><span><i class="onsite" />On site</span><span><i class="free" />Free</span><span><i class="off" />Off</span>
      </div>
      <p class="t-small wnote">${!listKnown ? 'Only people with a booking are shown. The full team list is for the office.' : user.office ? 'Tap a booking to open the job, a free day to book someone. Nobody is tracked.' : 'Free means nothing booked on the kinds of job you manage. Nobody is tracked.'}</p>`
        : html`<${Empty} title="Nobody is booked this week">${pick === 'all' ? 'Pick another week, or book someone from a job below.' : `No ${(VERTICAL_LABEL[pick] || 'job').toLowerCase()} bookings this week. Tap All to see every kind of job.`}<//>`}

      <${Section} label=${`To schedule · ${openShown.length}${pick !== 'all' ? ' ' + (VERTICAL_LABEL[pick] || '').toLowerCase() : ''}`}
          right=${html`<button type="button" class="link tap" onClick=${() => go(boards.length ? '/jobs/board/' + (boards.includes(pick) ? pick : boards[0]) : '/jobs')}>All in Jobs</button>`}>
        ${openShown.length ? html`<div class="block card">${openShown.map((o) => html`<div class="item tosched" key=${o.jobId}>
          <button type="button" class="main" onClick=${() => openJob(o.job)}>
            <${JobLine} job=${o.job} vertical=${o.vertical} />
            <b>${jobTitle(o.job)}</b>
            <span class="sub">${whereLine(o.job)}</span>
          </button>
          ${manages(user, o.vertical) ? html`<${Button} kind="line" small onClick=${() => openAllocateFor(o.job, o.vertical, { days: [] })}>Allocate<//>` : html`<span />`}
        </div>`)}</div>` : html`<p class="block t-small" style="padding:0 4px">Nothing is waiting for a crew.</p>`}
      <//>
    </div>`}
    ${team.refreshing && !team.loading ? html`<p class="t-small" style="text-align:center;margin-top:12px">Checking for changes</p>` : null}`;
}

/** One person, one day: their status, a way to call them, and their jobs. */
function PersonSheet({ person, day, today, onBook, onClose }) {
  const p = person;
  const hasFoot = Boolean(onBook) || Boolean(p.phone && !p.me);
  return html`<${Sheet} title=${p.me ? 'You' : p.name} sub=${`${fmtRelDay(day) === fmtDay(day) ? fmtDay(day) : fmtRelDay(day) + ', ' + fmtDay(day)}`} onClose=${onClose}
    foot=${!hasFoot ? null : (shut) => html`
      ${onBook ? html`<${Button} kind="line" block onClick=${() => { shut(); setTimeout(onBook, 220); }}>${p.items.length ? 'Book on another job' : `Book ${p.me ? 'myself' : firstName(p.name)} on a job`}<//>` : null}
      ${p.phone && !p.me ? html`<a class="btn line block" href=${'tel:' + p.phone}>Call ${firstName(p.name)}</a>` : null}`}>
    ${(shut) => html`<div class="stack">
      <div class="pstatus"><b>${p.status.text}</b>${p.status.sub ? html`<span class=${cx('t-small', p.status.clash && 't-bad')}>${p.status.sub}</span>` : null}</div>
      ${p.items.length ? html`<div class="card">${p.items.map((b) => html`<button type="button" class="item" key=${b.id} onClick=${() => { shut(); openJob(b.job); }}>
        <span class="main"><${JobLine} job=${b.job} vertical=${b.vertical} /><b>${jobTitle(b.job)}</b>
          <span class="sub">${whereLine(b.job)}</span></span>
        <span class="side">${isDone(b) ? html`<${StatusBadge} status="done" label=${b.hours ? fmtHrs(b.hours) : 'Done'} />` : b.clockOn && day === today ? html`<${StatusBadge} status="on_site" />`
          : day >= today ? html`<${StatusBadge} status=${b.status === 'scheduled' ? 'to_confirm' : 'confirmed'} />` : null}</span>
      </button>`)}</div>` : html`<p class="t-small">${p.status.kind === 'off' ? 'They marked this day off, so check with them before you book it.' : day < today ? 'Nothing was booked this day.' : 'Nothing booked this day.'}</p>`}
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
  const choose = (job, vertical, shut) => { shut(); setTimeout(() => openAllocateFor(job, vertical, preset), 220); };

  const suggestions = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const o of open) if (may(o.vertical) && !seen.has(o.jobId)) { seen.add(o.jobId); out.push({ job: o.job, vertical: o.vertical, hint: 'To schedule' }); }
    const soon = bookings.filter((b) => b.date >= today && b.date <= addDays(today, 13) && may(b.vertical) && !jobIsClosed(b.job.status)).sort((a, b) => a.date.localeCompare(b.date));
    for (const b of soon) if (!seen.has(b.jobId)) { seen.add(b.jobId); out.push({ job: b.job, vertical: b.vertical, hint: `Crew on it ${fmtRelDay(b.date).toLowerCase()}` }); }
    return out.slice(0, 12);
  }, [open, bookings, today]);
  const results = searching && search.data ? ((search.data.jobs) || []).map((j) => ({ job: slimJob(j), vertical: verticalOf(j) })).filter((r) => may(r.vertical) && !jobIsClosed(r.job.status)) : [];
  const hidden = searching && search.data ? ((search.data.jobs) || []).length - results.length : 0;
  const list = searching ? results : suggestions;

  return html`<${Sheet} tall title=${`Book ${person.me ? 'yourself' : firstName(person.name)}`} sub=${day >= today ? `Which job, for ${fmtRelDay(day) === fmtDay(day) ? fmtDayLong(day) : fmtRelDay(day).toLowerCase()}? You can change the day next.` : 'Which job? You pick the days next.'} onClose=${onClose}>
    ${(shut) => html`<div class="stack">
      <div class="search">
        <${Icon} name="jobs" size=${20} />
        <input class="input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck=${false} placeholder="Suburb, name or job number" value=${text} onInput=${(e) => onInput(e.currentTarget.value)} aria-label="Find a job" />
      </div>
      ${searching && search.loading ? html`<div class="stack tight"><${Skel} h=${58} /><${Skel} h=${58} /></div>`
        : searching && search.error ? html`<${LoadError} error=${search.error} onRetry=${search.refetch} what="the search" />`
        : list.length ? html`<div><h3 class="t-cap" style="padding:0 4px 8px">${searching ? `${list.length} found` : 'Jobs coming up'}</h3>
          <div class="card">${list.map((r) => html`<button type="button" class="item" key=${r.job.id} onClick=${() => choose(r.job, r.vertical, shut)}>
            <span class="main"><${JobLine} job=${r.job} vertical=${r.vertical} /><b>${jobTitle(r.job)}</b>
              <span class="sub">${whereLine(r.job)}</span></span>
            <span class="side">${r.hint === 'To schedule' ? html`<${StatusBadge} status="to_schedule" />` : r.hint ? html`<span class="t-small">${r.hint}</span>` : null}</span>
          </button>`)}</div></div>`
        : html`<p class="t-small">${searching ? (hidden ? `"${term}" matches ${hidden === 1 ? 'a job' : 'jobs'} you cannot book crew on. You can book on the kinds of job you manage.` : `Nothing matches "${term}". Try the suburb or the job number.`) : 'Type a suburb, a customer name or a job number to find the job.'}</p>`}
    </div>`}
  <//>`;
}
