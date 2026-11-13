// Today: what am I doing, where, and the one thing to press next.
// The week strip is the calendar. Tap a day, swipe a week, open the month.
import { html, cx, useMemo, useRef, useState } from '../lib/h.js';
import { useStore } from '../lib/store.js';
import { useMyBookings, rememberJobStub } from '../lib/data.js';
import { go } from '../lib/router.js';
import {
  todayISO, addDays, mondayOf, weekDays, fmtDow, fmtDom, fmtDowLong, fmtDate, fmtTime, fmtMonth, fmtRelDay, fmtHours, fmtDay,
  monthGrid, addMonths, monthStart, firstName, diffDays
} from '../lib/dates.js';
import { bookingsByDate, bookingState, jobTitle, jobAddress, mapsUrl } from '../lib/model.js';
import { Icon } from '../ui/icons.js';
import { Tag, Chip, Sheet, Button, IconButton, SkelRows, Empty, LoadError, Slide, openOverlay, Avatar, buzz } from '../ui/kit.js';
import { clockOn, openClockOff, useElapsed } from './clock.js';

export function Today({ day: dayParam }) {
  const user = useStore((s) => s.user);
  const clock = useStore((s) => s.clock);
  const today = todayISO();
  const [day, setDay] = useState(dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : today);
  const { bookings, loading, error, refetch, refreshing } = useMyBookings();
  const byDate = useMemo(() => bookingsByDate(bookings), [bookings]);
  const monday = mondayOf(day);
  const list = byDate.get(day) || [];
  const isToday = day === today;

  // Swipe the content sideways to change day.
  const swipe = useRef(null);
  const onTouchStart = (e) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    if (!swipe.current) return; const t = e.changedTouches[0];
    const dx = t.clientX - swipe.current.x; const dy = t.clientY - swipe.current.y; swipe.current = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) { buzz(6); setDay(addDays(day, dx < 0 ? 1 : -1)); }
  };

  const next = useMemo(() => bookings.filter((b) => b.date > day && bookingState(b) !== 'done').sort((a, b) => a.date.localeCompare(b.date))[0], [bookings, day]);
  const live = isToday && clock ? list.find((b) => b.id === clock.assignmentId) || bookings.find((b) => b.id === clock.assignmentId) : null;
  const upNext = isToday && !live ? list.find((b) => bookingState(b) === 'booked') : null;
  const rest = list.filter((b) => b !== live && b !== upNext);

  return html`<main class="page enter-tab" onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
    <header class="dayhead">
      <div>
        <span class="t-label">${isToday ? 'Today' : fmtRelDay(day) === fmtDay(day) ? (diffDays(day, today) > 0 ? 'Coming up' : 'Earlier') : fmtRelDay(day)} · ${fmtDate(day)}</span>
        <h1 class="t-display" style="margin-top:4px">${fmtDowLong(day)}</h1>
      </div>
      <button type="button" class="who" aria-label="Your profile" onClick=${() => go('/me', { tab: true })}><${Avatar} name=${user.name} me lg /></button>
    </header>

    <div class="weeknav">
      <button type="button" class="t-label" onClick=${() => openMonth(day, byDate, setDay)}>${fmtMonth(day)} <${Icon} name="down" size=${14} stroke=${2.6} /></button>
      <span style="display:flex;align-items:center">
        ${!isToday ? html`<${Button} kind="quiet" small onClick=${() => setDay(today)}>Today<//>` : null}
        <${IconButton} name="back" label="Earlier week" size=${20} onClick=${() => setDay(addDays(day, -7))} />
        <${IconButton} name="right" label="Later week" size=${20} onClick=${() => setDay(addDays(day, 7))} />
      </span>
    </div>
    <div class="week" role="group" aria-label="Pick a day">
      ${weekDays(monday).map((d) => {
        const items = byDate.get(d) || [];
        return html`<button type="button" key=${d} class=${cx(d === today && 'today')} aria-pressed=${String(d === day)} aria-label=${fmtDay(d) + (items.length ? `, ${items.length} booked` : '')} onClick=${() => { buzz(6); setDay(d); }}>
          <span class="dow">${fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span>
          <span class="pips">${items.slice(0, 3).map((b) => html`<i class=${'jt-' + b.vertical} style="background:var(--jt)" />`)}</span>
        </button>`;
      })}
    </div>

    ${loading ? html`<${SkelRows} n=${2} />` : error && !bookings.length ? html`<${LoadError} error=${error} onRetry=${refetch} what="your jobs" />` : html`<div key=${day} class="rise">
      ${live ? html`<${LiveCard} booking=${live} clock=${clock} />` : null}
      ${upNext ? html`<${NextCard} booking=${upNext} />` : null}
      ${rest.length ? html`<div class="list ruled" style="margin-top:6px">${rest.map((b) => html`<${BookingRow} key=${b.id} booking=${b} />`)}</div>` : null}
      ${!list.length ? html`<${Empty} title=${isToday ? `Nothing booked today, ${firstName(user.name)}` : 'Nothing booked'}
          action=${html`<div class="btnrow" style="margin-top:8px"><${Button} kind="line" small icon="jobs" onClick=${() => go('/jobs', { tab: true })}>Find a job<//></div>`}>
        ${next ? html`Next up is ${jobTitle(next.job)} on ${fmtDay(next.date)}.` : 'No jobs coming up yet. If you are working somewhere, find the job and add yourself.'}
      <//>` : null}
      ${next && list.length ? html`<button type="button" class="row" style="margin-top:18px" onClick=${() => setDay(next.date)}>
        <span class="lead t-label">Next</span><span class="main"><b>${jobTitle(next.job)}</b><span>${fmtDay(next.date)}${next.start ? ' at ' + fmtTime(next.start) : ''}</span></span><span class="trail"><${Icon} name="right" size=${18} /></span>
      </button>` : null}
    </div>`}
    ${refreshing && !loading ? html`<p class="t-small t-mute" style="text-align:center;margin-top:18px">Checking for changes</p>` : null}
  </main>`;
}

function open(booking) { rememberJobStub(booking.job); go('/job/' + booking.jobId); }

function LiveCard({ booking, clock }) {
  const t = useElapsed(clock.since, clock.breakMin);
  return html`<section class="nowcard">
    <div style="display:flex;justify-content:space-between;align-items:center"><span class="t-label" style="display:flex;gap:8px;align-items:center;color:var(--hi)"><i class="pulse" />On the clock</span><${Tag} vertical=${booking.vertical} /></div>
    <button type="button" class="where" onClick=${() => open(booking)}><b>${jobTitle(booking.job)}</b><span>${jobAddress(booking.job)}</span></button>
    <div class="bigtimer" aria-label="Time on the clock">${t.h}:${t.m}<small>${t.s}</small></div>
    <div class="btnrow">
      <${Button} onClick=${() => openClockOff()}>Clock off<//>
      <${Button} kind="soft" class="on-night" onClick=${() => open(booking)}>Open job<//>
    </div>
  </section>`;
}

function NextCard({ booking }) {
  const [busy, setBusy] = useState(false);
  const job = booking.job;
  return html`<section class="nowcard">
    <div style="display:flex;justify-content:space-between;align-items:center"><span class="t-label">${booking.start ? 'Start ' + fmtTime(booking.start) : 'Up next'}</span><${Tag} vertical=${booking.vertical} /></div>
    <button type="button" class="where" onClick=${() => open(booking)}><b>${jobTitle(job)}</b><span>${jobAddress(job)}${job.client_name ? ' · ' + job.client_name : ''}</span></button>
    <div class="actions">
      <a class="action" href=${mapsUrl(job)} target="_blank" rel="noopener"><${Icon} name="navigate" size=${22} />Navigate</a>
      ${job.client_phone ? html`<a class="action" href=${'tel:' + job.client_phone}><${Icon} name="phone" size=${22} />Call</a>` : null}
      <button type="button" class="action" onClick=${() => open(booking)}><${Icon} name="file" size=${22} />Job details</button>
    </div>
    <${Slide} label="Slide to clock on" busy=${busy} onConfirm=${async () => { setBusy(true); await clockOn(booking); setBusy(false); }} />
  </section>`;
}

export function BookingRow({ booking, showDate, showWho }) {
  const state = bookingState(booking);
  const job = booking.job;
  return html`<button type="button" class=${cx('booking', state)} onClick=${() => open(booking)}>
    <span class="when">${showDate ? html`${fmtDom(booking.date)}<small>${fmtDow(booking.date)}</small>` : booking.start ? html`${fmtTime(booking.start).replace(/[ap]m$/, '')}<small>${/pm$/.test(fmtTime(booking.start)) ? 'pm' : 'am'}</small>` : html`<${Icon} name="clock" size=${20} />`}</span>
    <span class="what">
      <b>${jobTitle(job)}</b>
      <span class="addr">${jobAddress(job) || job.client_name || ''}</span>
      <span class="meta"><${Tag} vertical=${booking.vertical} />
        ${job.job_number ? html`<span class="t-small t-mute t-num">${job.job_number}</span>` : null}
        ${showWho && booking.userName ? html`<span class="t-small">${booking.userName}</span>` : null}
        ${state === 'live' ? html`<${Chip} kind="hi">On the clock<//>` : state === 'done' ? html`<${Chip} kind="ok" icon="check">${booking.hours ? fmtHours(booking.hours) : 'Done'}<//>` : null}
      </span>
    </span>
    <span class="t-mute" style="align-self:center"><${Icon} name="right" size=${18} /></span>
  </button>`;
}

function openMonth(day, byDate, setDay) {
  openOverlay((close) => html`<${MonthSheet} day=${day} byDate=${byDate} onPick=${(d) => { setDay(d); }} onClose=${close} />`);
}
function MonthSheet({ day, byDate, onPick, onClose }) {
  const [month, setMonth] = useState(monthStart(day));
  const today = todayISO();
  return html`<${Sheet} title=${fmtMonth(month)} onClose=${onClose}>
    ${(shut) => html`<div class="stack">
      <div style="display:flex;justify-content:space-between;margin:-8px -8px 0">
        <${IconButton} name="back" label="Earlier month" onClick=${() => setMonth(addMonths(month, -1))} />
        <${Button} kind="quiet" small onClick=${() => { setMonth(monthStart(today)); }}>This month<//>
        <${IconButton} name="right" label="Later month" onClick=${() => setMonth(addMonths(month, 1))} />
      </div>
      <div class="month">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<span class="mh">${d}</span>`)}
        ${monthGrid(month).map((d) => {
          const items = byDate.get(d) || [];
          return html`<button type="button" key=${d} class=${cx(d.slice(0, 7) !== month.slice(0, 7) && 'out', d === today && 'today')} aria-pressed=${String(d === day)} onClick=${() => { onPick(d); shut(); }}>
            ${fmtDom(d)}<span class="pips">${items.slice(0, 3).map((b) => html`<i class=${'jt-' + b.vertical} style="background:var(--jt)" />`)}</span>
          </button>`;
        })}
      </div>
    </div>`}
  <//>`;
}
