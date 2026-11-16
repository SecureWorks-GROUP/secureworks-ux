// Today: only "what do I do now". The next job and Clock on; or, once on
// site, the running clock and the four things done on a job. Under that: what
// needs an answer and this pay week's timesheet. The calendar is in Schedule.
import { html, useMemo, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useStore, useQuery, local } from '../lib/store.js';
import { useMyBookings, rememberJobStub, jobStub } from '../lib/data.js';
import { queueWrite } from '../lib/outbox.js';
import { go } from '../lib/router.js';
import { todayISO, addDays, mondayOf, fmtDay, fmtRelDay, tsToHM, tsToDate } from '../lib/dates.js';
import { bookingsByDate, bookingState, jobTitle, jobAddress, mapsUrl } from '../lib/model.js';
import { buildLines, lineHours } from '../lib/invoice.js';
import { Page, Section, Sheet, Button, Field, Picks, Skel, LoadError, JobLine, StatusBadge, toast, openOverlay } from '../ui/kit.js';
import { clockOn, openClockOff, openBreak, useElapsed } from './clock.js';
import { NeedsOk, needsOk, bookingStatus, useBookingChanges, ChangesBanner, markOnTheWay, useMyDaysOff, useCrewWith, BookingItem, openBooking, openBookingJob } from './bookings.js';
import { fmtClock, fmtHrs, fmtDayYear, fmtWeekShort, fmtElapsed } from './words.js';

export function Today() {
  const user = useStore((s) => s.user);
  const clock = useStore((s) => s.clock);
  const today = todayISO();
  const monday = mondayOf(today);
  const { bookings, loading, error, refetch, refreshing, data } = useMyBookings();
  const byDate = useMemo(() => bookingsByDate(bookings), [bookings]);
  const { changes, dismiss } = useBookingChanges(bookings, Boolean(data) && !refreshing && !error);
  const daysOff = useMyDaysOff(monday);
  const dayOff = daysOff.get(today);
  const list = byDate.get(today) || [];

  const live = clock ? bookings.find((b) => b.id === clock.assignmentId) || null : null;
  const upNext = !clock ? list.find((b) => bookingState(b) === 'booked') || null : null;
  const rest = list.filter((b) => b !== live && b !== upNext);
  const next = useMemo(() => bookings.filter((b) => b.date > today && bookingState(b) !== 'done')
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.start || '99').localeCompare(String(b.start || '99')))[0] || null, [bookings, today]);
  const doneHours = list.filter((b) => bookingState(b) === 'done').reduce((s, b) => s + (Number(b.hours) || 0), 0);
  // The next booking is shown once there is nothing left to start today.
  const showNext = next && (clock || !upNext);

  return html`<${Page} root title="Today" right=${html`<span class="nums">${fmtDayYear(today)}</span>`}>
    ${loading ? html`<div class="block" style="display:grid;gap:12px"><${Skel} h=${236} /><${Skel} w="40%" h=${16} /><${Skel} h=${64} /></div>`
      : error && !bookings.length ? html`<${LoadError} error=${error} onRetry=${refetch} what="your bookings" />`
      : html`<div class="today">
      <${ChangesBanner} changes=${changes} onDismiss=${dismiss} onPick=${(d) => { if (d) go('/schedule?day=' + d); }} />

      ${clock ? html`<${OnSiteCard} clock=${clock} booking=${live} />`
        : upNext ? html`<${NextCard} booking=${upNext} />`
        : list.length ? html`<section class="block card pad nowjob" aria-label="Today">
            <div class="nowjob-top"><span class="t-cap">Today</span><${StatusBadge} status="done" /></div>
            <div><b class="t-head">Done for today</b>
              <p class="nowjob-sub">${doneHours ? `${fmtHrs(doneHours)} worked. ` : ''}Check the times on your timesheet.</p></div>
          </section>`
        : html`<section class="block card pad nowjob" aria-label="Today">
            <div class="nowjob-top"><span class="t-cap">Today</span>${dayOff ? html`<${StatusBadge} status="unavailable" />` : null}</div>
            <div><b class="t-head">Nothing booked today</b>
              <p class="nowjob-sub">${dayOff ? `You marked today as ${dayOff.status === 'leave' ? 'leave' : 'unavailable'}. ` : ''}${next ? `Your next booking is ${fmtDay(next.date)}.` : 'No bookings coming up yet. If you are working somewhere, find the job and add yourself.'}</p></div>
            <${Button} kind="line" block onClick=${() => go('/jobs', { tab: true })}>Find a job<//>
          </section>`}

      ${clock ? html`<${Section} label="On this job">
        <div class="block grid2">
          <${Button} kind="line" onClick=${() => go(`/job/${clock.jobId}?tab=scope`)}>Scope of works<//>
          <${Button} kind="line" onClick=${() => go(`/job/${clock.jobId}?tab=photos`)}>Add photos<//>
          <${Button} kind="line" onClick=${() => go(`/job/${clock.jobId}?tab=notes`)}>Add note<//>
          <${Button} kind="line" onClick=${() => openProblem({ id: clock.jobId, ...(live ? live.job : jobStub(clock.jobId) || {}) }, clock.title)}>Report a problem<//>
        </div>
      <//>` : null}

      ${rest.length ? html`<${Section} label=${clock || upNext ? 'Also today' : 'Today'}>
        <div class="list flat">${rest.map((b) => html`<${BookingItem} key=${b.id} booking=${b} day=${true} />`)}</div>
      <//>` : null}

      ${showNext ? html`<${Section} label=${fmtRelDay(next.date) === 'Tomorrow' ? 'Tomorrow' : 'Next booking'}>
        <div class="block card"><button type="button" class="item" onClick=${() => openBooking(next)}>
          <span class="main"><b class="nums">${fmtDay(next.date)}${next.start ? ' · ' + fmtClock(next.start) : ''}</b>
            <${JobLine} job=${next.job}>${jobTitle(next.job)}<//></span>
          <span class="side"><${StatusBadge} status=${bookingStatus(next)} /></span>
        </button></div>
      <//>` : null}

      <${NeedsOk} bookings=${showNext && needsOk(next) ? bookings.filter((b) => b.id !== next.id) : bookings} />

      <${Section} label=${`Pay week ${fmtWeekShort(monday)}`}>
        <${TimesheetRow} monday=${monday} user=${user} />
      <//>
    </div>`}
    ${refreshing && !loading ? html`<p class="t-small" style="text-align:center;margin-top:16px">Checking for changes</p>` : null}
  <//>`;
}

function NextCard({ booking }) {
  const [busy, setBusy] = useState(false);
  const job = booking.job;
  const mates = useCrewWith(booking);
  const who = [job.client_name, mates.length ? 'with ' + mates.slice(0, 2).join(', ') + (mates.length > 2 ? ` +${mates.length - 2}` : '') : ''].filter(Boolean).join(' · ');
  return html`<section class="block card pad nowjob" aria-label="Next job">
    <div class="nowjob-top"><span class="t-cap nums">Next job${booking.start ? ' · ' + fmtClock(booking.start) : ''}</span><${StatusBadge} status=${bookingStatus(booking)} /></div>
    <div class="nowjob-where">
      <${JobLine} job=${job} vertical=${booking.vertical} />
      <b class="t-head">${jobAddress(job) || jobTitle(job)}</b>
      ${who ? html`<span class="nowjob-sub">${who}</span>` : null}
    </div>
    <div class="actions">
      <a class="action" href=${mapsUrl(job)} target="_blank" rel="noopener" onClick=${() => markOnTheWay(booking)}>Navigate</a>
      ${job.client_phone ? html`<a class="action" href=${'tel:' + job.client_phone}>Call</a>` : null}
      <button type="button" class="action" onClick=${() => openBookingJob(booking)}>Open job</button>
    </div>
    <${Button} class="big" block busy=${busy} onClick=${async () => { setBusy(true); await clockOn(booking); setBusy(false); }}>Clock on<//>
  </section>`;
}

function OnSiteCard({ clock, booking }) {
  const t = useElapsed(clock.since);
  const job = booking ? booking.job : jobStub(clock.jobId);
  const sameDay = tsToDate(clock.since) === todayISO();
  const open = () => { if (job) rememberJobStub(job); go('/job/' + clock.jobId); };
  return html`<section class="block card pad nowjob" aria-label="On site">
    <div class="nowjob-top"><span class="t-cap nums">Clocked on ${sameDay ? '' : fmtDay(tsToDate(clock.since)) + ', '}${fmtClock(tsToHM(clock.since))}${clock.pending ? ' · waiting for signal' : ''}</span><${StatusBadge} status="on_site" /></div>
    <button type="button" class="nowjob-where" onClick=${open}>
      <${JobLine} job=${job || {}} vertical=${booking ? booking.vertical : null} />
      <b class="t-head">${job ? jobAddress(job) || jobTitle(job) : clock.title}</b>
    </button>
    <div class="nowjob-time"><span class="t-cap">Time on site${clock.breakMin ? ` · ${clock.breakMin} min break` : ''}</span><span class="t-title nums" aria-live="off">${fmtElapsed(t)}</span></div>
    <div class="nowjob-go">
      <${Button} kind="line" class="tall" onClick=${() => openBreak()}>Break<//>
      <${Button} class="big tall" onClick=${() => openClockOff()}>Clock off<//>
    </div>
  </section>`;
}

/** This pay week's timesheet in one row: how many worked days have their times, and the hours so far. */
function TimesheetRow({ monday, user }) {
  const q = useQuery('hours:' + monday, () => api('my_hours', { week_ending: addDays(monday, 6) }), { persist: true, ttl: 45000 });
  const words = useMemo(() => {
    if (!q.data) return q.error ? 'Could not load your hours. Open it to try again.' : 'Loading';
    if (q.data.already_submitted) return 'Invoice sent for this week';
    const today = todayISO();
    const draft = local.get('week:' + monday, { edits: {}, added: [], gst: null, notes: '' });
    const lines = buildLines(q.data, draft, { perMetre: user.perMetre }).filter((l) => !l.off);
    const days = new Map(); let total = 0;
    for (const l of lines) {
      if (l.kind !== 'hours' || l.ahead || !l.date || l.date > today) continue;
      const h = lineHours(l);
      const good = !isNaN(h) && l.breakMin != null;
      if (good) total += h;
      days.set(l.date, (days.has(l.date) ? days.get(l.date) : true) && good);
    }
    const complete = [...days.values()].filter(Boolean).length;
    const orders = lines.filter((l) => l.kind === 'work_order').length;
    const parts = [];
    if (days.size) parts.push(`${complete} of ${days.size} ${days.size === 1 ? 'day' : 'days'} complete`, fmtHrs(total));
    if (orders) parts.push(`${orders} work order ${orders === 1 ? 'job' : 'jobs'}`);
    return parts.length ? parts.join(' · ') : 'Nothing on it yet';
  }, [q.data, q.error, monday]);
  return html`<div class="block card"><button type="button" class="item" onClick=${() => go('/pay/week/' + monday)}>
    <span class="main"><b>Timesheet</b><span class="sub nums">${words}</span></span>
    <span class="link">Open</span>
  </button></div>`;
}

// The same message the job page sends for "Problem", so it can be raised without leaving Today.
const PROBLEMS = ['Materials missing', 'Site access issue', 'Client not home', 'Damage found', 'Other'];
function openProblem(job, title) { openOverlay((close) => html`<${ProblemSheet} job=${job} title=${title} onClose=${close} />`); }
function ProblemSheet({ job, title, onClose }) {
  const [type, setType] = useState(null); const [detail, setDetail] = useState(''); const [busy, setBusy] = useState(false);
  const name = job.site_suburb || job.site_address || job.client_name ? jobTitle(job) : title || 'this job';
  const send = async (shut) => {
    setBusy(true);
    const body = { jobId: job.id, issueType: type, detail: detail.trim() || null, notify_telegram: true };
    try { await api('create_trade_alert', null, body); toast('Sent to the office.', { kind: 'ok' }); } catch (err) {
      if (err instanceof ApiError && err.refused) { toast(friendly(err), { kind: 'bad' }); setBusy(false); return; }
      queueWrite({ action: 'create_trade_alert', body, jobId: job.id, label: 'Problem on ' + name });
      toast('Saved. It will reach the office when you have signal. If it is urgent, call them.');
    }
    setBusy(false); shut();
  };
  return html`<${Sheet} title="Report a problem" sub=${name} onClose=${onClose} foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!type} onClick=${() => send(shut)}>Send to the office<//>`}>
    <div class="stack">
      <${Field} label="What is wrong?"><${Picks} value=${type} options=${PROBLEMS.map((p) => [p, p])} onChange=${setType} /><//>
      <${Field} label="Anything to add?"><textarea class="input" placeholder="What you can see, what you need" value=${detail} onInput=${(e) => setDetail(e.currentTarget.value)} /><//>
    </div>
  <//>`;
}

/** Kept for older callers: a booking as a row. */
export const BookingRow = BookingItem;
