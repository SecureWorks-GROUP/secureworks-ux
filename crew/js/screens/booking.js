// One booking: which job, when, who with, and where it is up to in five steps
// (allocated, confirmed, on site, done, on timesheet). The foot holds the one
// thing to do next: confirm it, clock on, or clock off.
import { html, cx, useState } from '../lib/h.js';
import { useStore } from '../lib/store.js';
import { useMyBookings, useJob, unbookMyself } from '../lib/data.js';
import { go, back } from '../lib/router.js';
import { todayISO, mondayOf, tsToHM, tsToDate, fmtDay } from '../lib/dates.js';
import { jobTitle, jobAddress, bookingState, noPrices } from '../lib/model.js';
import { Page, Section, Button, JobLine, StatusBadge, KV, Skel, Empty, LoadError, toast, ask } from '../ui/kit.js';
import { clockOn, openClockOff } from './clock.js';
import { bookingStatus, lockIn, openCantMakeIt, openBookingJob } from './bookings.js';
import { fmtClock, fmtHrs, fmtDayYear, fmtWeekShort, shortName } from './words.js';

const BUCKETS = ['today', 'thisWeek', 'upcoming', 'recent', 'recentCompleted', 'unscheduled'];
/** The server's own row for a booking, for the two facts the booking model does not carry. */
function rawRow(data, id) {
  for (const k of BUCKETS) for (const a of (data && data[k]) || []) if (a && a.id === id) return a;
  return null;
}

export function Booking({ bookingId }) {
  const user = useStore((s) => s.user);
  const clock = useStore((s) => s.clock);
  const { bookings, loading, error, refetch, data } = useMyBookings();
  const b = bookings.find((x) => x.id === bookingId) || null;
  const toSchedule = () => back('/schedule');

  if (!b && loading) return html`<${Page} title="Booking" back="Schedule" onBack=${toSchedule}><div class="block" style="display:grid;gap:12px"><${Skel} h=${150} /><${Skel} w="30%" h=${16} /><${Skel} h=${230} /></div><//>`;
  if (!b && error) return html`<${Page} title="Booking" back="Schedule" onBack=${toSchedule}><${LoadError} error=${error} onRetry=${refetch} what="this booking" /><//>`;
  if (!b) {
    return html`<${Page} title="Booking" back="Schedule" onBack=${toSchedule}>
      <${Empty} title="Booking not found" action=${html`<${Button} kind="line" onClick=${() => go('/schedule', { replace: true })}>Open Schedule<//>`}>
        It may have been moved or taken off your list. Your current bookings are in Schedule.<//><//>`;
  }
  return html`<${BookingView} b=${b} raw=${rawRow(data, b.id)} user=${user} clock=${clock} onBack=${toSchedule} />`;
}

function BookingView({ b, raw, user, clock, onBack }) {
  const [busy, setBusy] = useState('');
  const today = todayISO();
  const job = b.job;
  const q = useJob(b.jobId);
  const status = bookingStatus(b);            // to_confirm | confirmed | on_site | done | cannot
  const state = bookingState(b);              // booked | live | done
  const liveHere = Boolean(clock && clock.assignmentId === (b.assignmentId || b.id));
  const selfMade = Boolean(raw && raw.self_made === true) || /^added themselves/i.test(b.note || '');

  // Everyone booked on this job that day, you first.
  const crew = [];
  const seen = new Set([user.id]);
  for (const c of (q.data && q.data.crew) || []) {
    if (String(c.status || '').toLowerCase() === 'cancelled' || c.role === 'observer') continue;
    if (String(c.scheduled_date || '').slice(0, 10) !== b.date || !c.user_id || seen.has(c.user_id)) continue;
    seen.add(c.user_id);
    crew.push(shortName(c.name || (c.users && c.users.name) || c.crew_name || 'Crew'));
  }
  const crewWords = ['You', ...crew].join(', ');

  const made = raw && raw.created_at ? ' · ' + fmtDay(tsToDate(raw.created_at)) : '';
  const reached = { to_confirm: 1, cannot: 1, confirmed: 2, on_site: 3, done: 5 }[status];
  const week = fmtWeekShort(mondayOf(b.date));
  const steps = [
    ['Allocated', (selfMade ? 'You added yourself to this job' : 'The office booked you') + made],
    ['Confirmed', status === 'to_confirm' ? 'Waiting for you to confirm' : status === 'cannot' ? 'You told the office you cannot make it' : selfMade ? 'Confirmed when you added yourself' : 'You are confirmed for this day'],
    ['On site', b.clockOn ? `Clocked on ${fmtClock(tsToHM(b.clockOn))}` : 'Set when you clock on'],
    ['Done', state === 'done' ? [b.clockOff ? `Clocked off ${fmtClock(tsToHM(b.clockOff))}` : 'Finished', b.hours ? fmtHrs(b.hours) : ''].filter(Boolean).join(' · ') : 'Set when you clock off'],
    ['On timesheet', state === 'done' ? `On your timesheet for pay week ${week}` : `Hours go to pay week ${week}`]
  ];
  const time = state === 'done' && b.clockOn && b.clockOff && Date.parse(b.clockOff) - Date.parse(b.clockOn) >= 300000 ? `${fmtClock(tsToHM(b.clockOn))} to ${fmtClock(tsToHM(b.clockOff))}` : b.start ? `${state === 'done' ? 'Booked for' : 'Starts'} ${fmtClock(b.start)}` : 'No start time set';

  const confirm = async () => { setBusy('confirm'); await lockIn(b); setBusy(''); };
  const start = async () => { setBusy('clock'); await clockOn(b); setBusy(''); };
  const takeOff = async () => {
    if (!(await ask({ title: `Take yourself off ${fmtDay(b.date)}?`, body: 'The office will see you are no longer booked that day.', yes: 'Take me off', danger: true }))) return;
    setBusy('off');
    const r = await unbookMyself(b.assignmentId || b.id, b.jobId);
    setBusy('');
    if (r.ok) { toast('Done. You are off that day.', { kind: 'ok' }); onBack(); } else toast(r.message, { kind: 'bad', ms: 6000 });
  };

  const upcoming = state === 'booked' && b.date >= today;
  let foot = null;
  if (liveHere) foot = html`<${Button} class="big" block onClick=${() => openClockOff()}>Clock off<//>`;
  else if (status === 'to_confirm') {
    foot = html`<${Button} class="big" block busy=${busy === 'confirm'} onClick=${confirm}>Confirm booking<//>
      <${Button} kind="line" block onClick=${() => openCantMakeIt(b)}>Cannot make it<//>`;
  } else if (status === 'confirmed' && upcoming) {
    foot = html`${b.date === today ? html`<${Button} class="big" block busy=${busy === 'clock'} onClick=${start}>Clock on<//>` : null}
      ${selfMade ? html`<${Button} kind="line" block busy=${busy === 'off'} onClick=${takeOff}>Take me off this day<//>`
        : html`<${Button} kind="line" block onClick=${() => openCantMakeIt(b)}>Cannot make it<//>`}`;
  } else if (state === 'done') {
    foot = html`<${Button} kind="line" block onClick=${() => go('/pay/week/' + mondayOf(b.date))}>Open timesheet<//>`;
  }

  return html`<${Page} title="Booking" back="Schedule" onBack=${onBack} foot=${foot}>
    <section class="block card" aria-label="Booking details">
      <button type="button" class="bk-head" onClick=${() => openBookingJob(b)} aria-label=${`Open the job at ${jobAddress(job) || jobTitle(job)}`}>
        <span class="bk-top"><${JobLine} job=${job} vertical=${b.vertical} /><${StatusBadge} status=${status} /></span>
        <b class="t-head">${jobAddress(job) || jobTitle(job)}</b>
      </button>
      <${KV} k="Date" v=${fmtDayYear(b.date)} />
      <${KV} k="Time" v=${time} />
      <${KV} k="Crew" v=${crewWords} />
    </section>

    <${Section} label="Status">
      <ol class="block card steps5">
        ${steps.map(([label, detail], i) => {
          const at = i + 1 <= reached ? 'done' : i + 1 === reached + 1 ? 'now' : 'next';
          return html`<li key=${label} class=${at} aria-current=${at === 'now' ? 'step' : null}>
            <span class="n" aria-hidden="true">${i + 1}</span>
            <span class="what"><b>${label}</b><span class=${cx('sub nums', status === 'cannot' && i === 1 && 't-bad')}>${detail}</span></span>
          </li>`;
        })}
      </ol>
    <//>
    ${b.note && !selfMade ? html`<${Section} label="Note on the booking"><p class="block card pad prose">${noPrices(b.note, user.seesMoney)}</p><//>` : null}
  <//>`;
}
