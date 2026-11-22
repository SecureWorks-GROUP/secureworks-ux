// One job's record: where it is, its details, the scope, photos, notes and
// files. Any trade can open any job. What you can do on it depends on whether
// you are on it yet, and adding yourself is one tap.
import { html, cx, useEffect, useMemo, useState } from '../lib/h.js';
import { api, apiText, ghl, ApiError, friendly } from '../lib/api.js';
import { useQuery, useStore, local, invalidate } from '../lib/store.js';
import { useJob, jobStub, bookMyself, unbookMyself, noteBody, optimisticNote, useMyBookings } from '../lib/data.js';
import { go, back } from '../lib/router.js';
import { todayISO, addDays, mondayOf, fmtDay, fmtDow, fmtDom, fmtDate, fmtTs, fmtRelDay } from '../lib/dates.js';
import {
  verticalOf, isReportJob, jobTitle, jobAddress, mapsUrl, jobStageKey, jobIsClosed, jobNotOpenYet, tradeNotes, noteText, noteAuthor, splitMedia, PHASES, noPrices, VERTICAL_LABEL
} from '../lib/model.js';
import { queueWrite, outboxItems, onOutbox } from '../lib/outbox.js';
import { uploadPhoto, pickPhotos } from '../lib/upload.js';
import {
  Page, Section, KV, JobLine, Badge, StatusBadge, STATUS, Button, Sheet, Skel, Empty, LoadError, PhotoGrid, Avatar, Field, Picks, toast, openOverlay, ask, buzz
} from '../ui/kit.js';
import { clockOn, openClockOff, useElapsed } from './clock.js';
import { markOnTheWay, lockIn, openCantMakeIt, wasDeclined, bookingStatus } from './bookings.js';
import { fmtHrs, shortName } from './words.js';

const TABS = [['overview', 'Overview'], ['scope', 'Scope'], ['photos', 'Photos'], ['notes', 'Notes'], ['files', 'Files']];
const WORKED = ['complete', 'completed', 'submitted', 'verified'];
// The server's invoice mode for the job, in the words the pay screens use. Never worked out here.
const PAY_TYPE = { hourly: 'Hourly', work_order: 'Work order', group_work_order: 'Group work order', commission: 'Commission' };

const liveCrew = (data) => ((data && data.crew) || []).filter((c) => String(c.status).toLowerCase() !== 'cancelled' && c.role !== 'observer');
/** The signed-in trade's own bookings on a job: from the job when it is open to them, else from their own list. */
function myRowsOf(crew, bookings, jobId, userId) {
  const fromCrew = crew.filter((c) => c.user_id === userId).map((c) => ({ id: c.id, date: (c.scheduled_date || '').slice(0, 10), status: String(c.status || '').toLowerCase(), clockOn: c.clocked_on_at, clockOff: c.clocked_off_at, hours: c.hours_worked, start: c.start_time }));
  if (fromCrew.length) return fromCrew;
  return bookings.filter((b) => b.jobId === jobId && b.mine).map((b) => ({ id: b.id, date: b.date, status: b.status, clockOn: b.clockOn, clockOff: b.clockOff, hours: b.hours, start: b.start }));
}
/** Everyone on the job, one entry a person, the lead first. */
function peopleOf(crew, lead, userId) {
  const map = new Map();
  for (const c of crew) {
    const id = c.user_id || c.name;
    const p = map.get(id) || { id, name: c.name || (c.users && c.users.name) || c.crew_name || 'Crew', phone: (c.users && c.users.phone) || c.phone || null, days: [], lead: false };
    p.days.push({ id: c.id, date: (c.scheduled_date || '').slice(0, 10), status: String(c.status || '').toLowerCase() });
    if (c.is_lead || (lead && lead.user_id === c.user_id)) p.lead = true;
    map.set(id, p);
  }
  return [...map.values()].map((p) => ({ ...p, days: p.days.sort((a, b) => a.date.localeCompare(b.date)) })).sort((a, b) => (b.lead - a.lead) || (a.id === userId ? -1 : 1));
}
/** 'Fri 13 Nov' for one day, 'Fri 13 to Sat 14 Nov' for a run of days. */
function spanWords(dates) {
  const list = [...new Set(dates.filter(Boolean))].sort();
  if (!list.length) return '';
  const a = list[0]; const b = list[list.length - 1];
  if (a === b) return fmtDay(a);
  return a.slice(0, 7) === b.slice(0, 7) ? `${fmtDow(a)} ${fmtDom(a)} to ${fmtDay(b)}` : `${fmtDay(a)} to ${fmtDay(b)}`;
}
const DOC_LABEL = { council_plans: 'Council plans', engineering: 'Engineering', work_order: 'Work order', roof_report: 'Roof report', makesafe_report: 'Make safe report', swms: 'Safe work statement', approval: 'Approval', supplier_quote: 'Supplier quote', quote: 'Quote', site_plan: 'Site plan', scope_of_works: 'Scope of works', other: 'Document' };
// Priced paperwork (quotes, invoices, work orders, supplier quotes) is for the office only.
const PRICED_DOCS = ['quote', 'invoice', 'work_order', 'supplier_work_order', 'supplier_quote', 'purchase_order'];
function docUrl(d) { return [d.pdf_url, d.public_url, d.signed_url, d.download_url, d.url, d.file_url, d.storage_url].find((u) => typeof u === 'string' && /^https?:/.test(u)); }
function docName(d) { return d.label || d.file_name || d.name || d.filename || DOC_LABEL[d.type] || 'Document'; }
function visibleDocs(data, user) {
  return ((data && data.documents) || []).filter((d) => d.visible_to_trades !== false && d.type !== 'site_photo' && docUrl(d) && (user.seesMoney || !PRICED_DOCS.includes(String(d.type || '').toLowerCase())));
}

export function Job({ jobId, tab: tabParam }) {
  const user = useStore((s) => s.user);
  const clock = useStore((s) => s.clock);
  const q = useJob(jobId);
  const { bookings } = useMyBookings();
  const [tab, setTab] = useState(TABS.some((t) => t[0] === tabParam) ? tabParam : 'overview');
  const data = q.data;
  const stub = jobStub(jobId) || (bookings.find((b) => b.jobId === jobId) || {}).job || null;
  const job = (data && data.job) || stub;

  const vertical = verticalOf(job, data || {});
  const today = todayISO();
  const tier = data ? data.access_tier : null;
  const viewOnly = q.locked || tier === 'company_view';
  const crew = useMemo(() => liveCrew(data), [data]);
  const myRows = useMemo(() => myRowsOf(crew, bookings, jobId, user.id), [crew, bookings, jobId, user.id]);
  const onJob = myRows.length > 0;
  const notOpen = job ? jobNotOpenYet(job.status) : false;
  const closed = job ? jobIsClosed(job.status) || notOpen : false;
  const { photos, videos } = useMemo(() => splitMedia(data && data.media), [data]);
  const notes = useMemo(() => tradeNotes(data && data.notes), [data]);
  const pendingNotes = usePendingNotes(jobId);
  const docs = useMemo(() => visibleDocs(data, user), [data, user]);
  const phone = job && !viewOnly ? job.client_phone : null;
  const canText = Boolean(job && !viewOnly && job.ghl_contact_id && (user.manager || Number(user.trade_tier) >= 2));
  // Pay type is the server's invoice mode for this job, asked only for a job the trade is booked on.
  const modeQ = useQuery(onJob && data && !viewOnly ? 'jobmode:' + jobId : null, () => api('trade_invoice_job_modes', { job_ids: jobId }, null, { keepSession: true }), { ttl: 300000 });
  const modeRow = ((modeQ.data && modeQ.data.jobs) || []).find((r) => r && r.job_id === jobId);
  const payType = modeRow ? PAY_TYPE[String(modeRow.invoice_mode || '')] || '' : '';
  const report = data && data.serviceReport;
  const foot = useFoot({ job, jobId, clock, myRows, today, closed, vertical, viewOnly, reportSent: Boolean(report && ['submitted', 'approved'].includes(String(report.status || '').toLowerCase())) });

  const toJobs = () => back('/jobs');
  if (!job && q.loading) return html`<${Page} title="Job" back="Jobs" onBack=${toJobs}><div class="block" style="display:grid;gap:12px"><${Skel} w="70%" h=${24} /><${Skel} w="45%" h=${14} /><${Skel} h=${44} /><${Skel} h=${180} /></div><//>`;
  if (!job) return html`<${Page} title="Job" back="Jobs" onBack=${toJobs}>${q.locked ? html`<${Empty} title="Job not found">It may have been removed, or the link is old. Search for it by suburb or job number.<//>` : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="this job" />`}<//>`;

  const counts = { photos: photos.length, notes: notes.length + pendingNotes.length, files: docs.length + ((data && data.purchaseOrders) || []).length };
  const live = Boolean(clock && clock.jobId === jobId);

  return html`<${Page} flush title=${job.job_number || 'Job'} back="Jobs" onBack=${toJobs} right=${html`<${StatusBadge} status=${jobStageKey(job.status)} />`} foot=${foot}>
    <div class="jr-band">
      <div class="jr-where">
        <h2 class="jr-addr">${jobAddress(job) || jobTitle(job)}</h2>
        <span class="jr-sub">${[VERTICAL_LABEL[vertical] || 'Job', job.client_name].filter(Boolean).join(' · ')}</span>
      </div>
      <div class="jr-acts">
        <a class="jr-act" href=${mapsUrl(job)} target="_blank" rel="noopener" onClick=${() => { const r = myRows.find((x) => x.date === today); if (r) markOnTheWay({ ...r, jobId, job }); }}>Navigate</a>
        ${phone ? html`<a class="jr-act" href=${'tel:' + phone}>Call</a>` : null}
        ${canText ? html`<button type="button" class="jr-act" onClick=${() => openText(job)}>Message</button>` : null}
        ${viewOnly ? null : html`<button type="button" class="jr-act" onClick=${() => openProblem(job)}>Problem</button>`}
      </div>
    </div>

    <div class="tabs jr-tabs" role="tablist">
      ${TABS.map(([id, label]) => html`<button type="button" role="tab" aria-selected=${String(tab === id)} onClick=${() => { setTab(id); buzz(5); }}>${label}${counts[id] ? html` <span class="n">${counts[id]}</span>` : null}</button>`)}
    </div>

    <div key=${tab} class="jr-body">
      ${viewOnly && !closed ? html`<div class="note-banner plain jr-banner"><span>You are looking at this job. Add yourself to clock on, add photos and notes, and see the customer's number.</span></div>` : null}
      ${q.error && data ? html`<div class="note-banner jr-banner"><span>Showing the last saved copy.${q.error.offline ? ' No signal.' : ''}</span></div>` : null}
      ${q.locked ? (notOpen ? html`<${Empty} title="Not a live job yet">This one is still being quoted. It opens up for the crew once the customer says yes.<//>`
          : closed ? html`<${Empty} title="This job is closed">Ask the office if you need something from it.<//>`
          : html`<${Empty} title="Add yourself to open this job">The scope, photos and notes open up once you are on the job.<//>`)
        : !data ? html`<div class="block" style="display:grid;gap:12px"><${Skel} h=${132} /><${Skel} w="80%" /><${Skel} w="60%" /></div>`
        : tab === 'overview' ? html`<${Overview} jobId=${jobId} job=${job} data=${data} vertical=${vertical} user=${user} crew=${crew} myRows=${myRows} onJob=${onJob} viewOnly=${viewOnly} closed=${closed} payType=${payType} today=${today} live=${live} refreshing=${q.refreshing} onRefresh=${() => { q.refetch(); buzz(6); }} />`
        : tab === 'scope' ? html`<${ScopeTab} data=${data} job=${job} vertical=${vertical} videos=${videos} docs=${docs} user=${user} viewOnly=${viewOnly} onJob=${onJob} />`
        : tab === 'photos' ? html`<${PhotosTab} jobId=${jobId} photos=${photos} viewOnly=${viewOnly} live=${live} started=${myRows.some((r) => r.clockOn)} />`
        : tab === 'notes' ? html`<${NotesTab} jobId=${jobId} job=${job} notes=${notes} pending=${pendingNotes} user=${user} viewOnly=${viewOnly} />`
        : html`<${FilesTab} jobId=${jobId} data=${data} docs=${docs} user=${user} viewOnly=${viewOnly} />`}
    </div>
  <//>`;
}

// ---------------------------------------------------------------- foot ----
/** The one strong button for this job right now, with a line of words above it when they help. */
function useFoot({ job, jobId, clock, myRows, today, closed, vertical, viewOnly, reportSent }) {
  const [busy, setBusy] = useState(false);
  const liveHere = Boolean(clock && clock.jobId === jobId);
  const t = useElapsed(liveHere ? clock.since : null, liveHere ? clock.breakMin : 0);
  if (!job) return null;
  const todayRow = myRows.find((r) => r.date === today);
  const doneToday = todayRow && (todayRow.clockOff || WORKED.includes(todayRow.status));
  const ahead = myRows.filter((r) => r.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const reportJob = isReportJob(vertical);
  const canFinish = !closed && !reportJob;
  const reportDue = reportJob && !closed && !viewOnly && myRows.length > 0 && !reportSent;
  const strong = (label, onClick, extra = {}) => html`<${Button} block class="big" busy=${busy} onClick=${onClick} ...${extra}>${label}<//>`;
  const toFinish = () => go(`/job/${jobId}/finish`);
  const toReport = () => go(`/job/${jobId}/report`);
  const addMe = () => openBook(jobId, job, myRows);

  if (liveHere) {
    const second = canFinish ? html`<${Button} kind="line" onClick=${toFinish}>Start sign-off<//>` : reportDue ? html`<${Button} kind="line" onClick=${toReport}>Fill in the report<//>` : null;
    return html`<div class="jr-footline"><span class="jr-live"><i />On site</span><span class="jr-timer">${t.h}:${t.m}<span class="t-small">:${t.s}</span></span></div>
      <div class=${cx('jr-footbtns', !second && 'one')}>${second}<${Button} onClick=${() => openClockOff()}>Clock off<//></div>`;
  }
  if (closed && !myRows.length) return null;
  if (todayRow && !doneToday && !closed) return strong('Clock on', async () => { setBusy(true); await clockOn({ id: todayRow.id, jobId, job }); setBusy(false); });
  if (doneToday) {
    return html`<div class="jr-footline"><b>Done for today</b>${todayRow.hours ? html`<span class="t-num">${fmtHrs(Number(todayRow.hours))} recorded</span>` : null}</div>
      ${canFinish ? strong('Start sign-off', toFinish) : reportDue ? strong('Fill in the report', toReport) : null}`;
  }
  if (closed) return null;
  if (ahead && ahead.status === 'scheduled' && !wasDeclined(ahead.id)) {
    const b = { ...ahead, jobId, job, mine: true };
    return html`<div class="jr-footline"><span><b>The office booked you for ${fmtDay(ahead.date)}.</b> Can you do it?</span></div>
      <div class="jr-footbtns"><${Button} kind="line" onClick=${() => openCantMakeIt(b)}>Cannot make it<//><${Button} busy=${busy} onClick=${async () => { setBusy(true); await lockIn(b); setBusy(false); }}>Confirm<//></div>`;
  }
  if (ahead) {
    return html`<div class="jr-footline"><span><b>Booked for ${fmtRelDay(ahead.date) === 'Tomorrow' ? 'tomorrow' : fmtDay(ahead.date)}.</b> Here today instead?</span></div>
      ${strong('Add me for today', async () => { setBusy(true); const r = await bookMyself(jobId, [today]); setBusy(false); if (!r.ok) toast(r.message, { kind: 'bad' }); else buzz(12); })}`;
  }
  if (myRows.length && (canFinish || reportDue)) {
    return html`<div class="jr-footbtns"><${Button} kind="line" onClick=${addMe}>Add another day<//>${canFinish ? html`<${Button} onClick=${toFinish}>Start sign-off<//>` : html`<${Button} onClick=${toReport}>Fill in the report<//>`}</div>`;
  }
  return strong(myRows.length ? 'Add another day' : 'Add me to this job', addMe);
}

// ------------------------------------------------------------- booking ----
export function openBook(jobId, job, myRows = []) {
  openOverlay((close) => html`<${BookSheet} jobId=${jobId} job=${job} taken=${new Set(myRows.map((r) => r.date))} onClose=${close} />`);
}
function BookSheet({ jobId, job, taken, onClose }) {
  const today = todayISO();
  const [picked, setPicked] = useState(() => (taken.has(today) ? [] : [today]));
  const [past, setPast] = useState(false);
  const [busy, setBusy] = useState(false);
  const days = past ? Array.from({ length: 14 }, (_, i) => addDays(today, -(i + 1))) : Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const toggle = (d) => { buzz(6); setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d])); };
  const save = async (shut) => {
    setBusy(true);
    const r = await bookMyself(jobId, picked);
    setBusy(false);
    if (r.message) toast(r.message, { kind: r.ok ? '' : 'bad', ms: 6000 });
    if (r.ok) { if (!r.message) toast(picked.length === 1 ? `You are on ${jobTitle(job)}, ${fmtRelDay(picked[0]).toLowerCase()}.` : `You are on ${jobTitle(job)} for ${picked.length} days.`, { kind: 'ok' }); buzz([12, 40, 20]); shut(); }
  };
  return html`<${Sheet} title="Which days?" sub=${`${jobTitle(job)}. It goes on the office calendar. The customer is not texted.`} onClose=${onClose}
    foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!picked.length} onClick=${() => save(shut)}>${picked.length > 1 ? `Add me for ${picked.length} days` : 'Add me'}<//>`}>
    <div class="stack">
      <div class="daypicks">
        ${days.map((d) => html`<button type="button" key=${d} class=${cx('daypick', d === today && 'today')} aria-pressed=${String(picked.includes(d))} disabled=${taken.has(d)} onClick=${() => toggle(d)}>
          <span class="dow">${d === today ? 'Today' : fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span>${taken.has(d) ? html`<span class="t-small">On it</span>` : null}
        </button>`)}
      </div>
      <${Button} kind="quiet" onClick=${() => { setPast(!past); setPicked([]); }}>${past ? 'Pick days coming up' : 'I already worked on this job'}<//>
    </div>
  <//>`;
}

// ------------------------------------------------------------ overview ----
function Overview({ jobId, job, data, vertical, user, crew, myRows, onJob, viewOnly, closed, payType, today, live, refreshing, onRefresh }) {
  const money = user.seesMoney;
  const people = useMemo(() => peopleOf(crew, data.leadInstaller, user.id), [crew, data.leadInstaller, user.id]);
  const booked = spanWords(crew.map((c) => (c.scheduled_date || '').slice(0, 10)));
  const crewWords = people.map((p) => (p.id === user.id ? 'You' : shortName(p.name)) + (p.lead ? ' (lead)' : '')).join(', ');
  const siteNotes = noPrices(job.notes || (typeof data.scopeSummary === 'string' ? data.scopeSummary : '') || '', money).trim();
  const stage = STATUS[jobStageKey(job.status)] || ['', ''];
  // Who the client is, in words, and the builder's work order as the server
  // sends it with every money line taken out (work_order_briefs). The priced
  // PDF stays office-only. Owner, 22 Nov 2026.
  const clientName = String(job.client_name || '').trim();
  const clientPhone = viewOnly ? '' : String(job.client_phone || '').trim();
  const briefs = (Array.isArray(data.work_order_briefs) ? data.work_order_briefs : [])
    .map((b) => noPrices(String((b && b.text) || ''), money).trim()).filter(Boolean);

  // Sign-off, or the report on a make safe.
  const reportJob = isReportJob(vertical);
  const report = data.serviceReport;
  const reportStatus = report ? String(report.status || '').toLowerCase() : '';
  const reportLabel = vertical === 'restoration' ? 'Restoration report' : (data.makesafe_details || {}).report_type ? 'Builder report' : 'Make safe report';
  const reportWords = reportStatus === 'approved' ? 'Approved' : reportStatus === 'submitted' ? 'Sent' : report ? 'Draft saved' : 'Not started';
  const saved = local.get('finish:' + jobId);
  const signoffWords = jobIsClosed(job.status) ? 'Done' : saved && (saved.step || (saved.photos || []).length) ? 'Started' : 'Not started';
  const canSignOff = onJob && !viewOnly && !closed && !reportJob;

  // My own bookings on it: today's first, then what is coming, then the last one worked.
  const mine = [...myRows].sort((a, b) => a.date.localeCompare(b.date));
  const key = mine.find((r) => r.date === today) || mine.find((r) => r.date > today) || mine[mine.length - 1] || null;
  const also = mine.filter((r) => r !== key && r.date >= today).slice(0, 3);
  const hours = mine.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
  const bookingRow = (r, label) => html`<${KV} key=${r.id} k=${label} onClick=${() => go('/schedule/booking/' + encodeURIComponent(r.id))}
    v=${html`<span class="jr-val"><span>${r.date ? fmtDay(r.date) : 'No day set'}</span><${StatusBadge} status=${live && r === key ? 'on_site' : bookingStatus({ ...r, mine: true })} /></span>`} />`;

  return html`
    <${Section} label="Details" right=${html`<button type="button" class="link jr-call" onClick=${onRefresh}>${refreshing ? 'Checking' : 'Refresh'}</button>`}>
      <div class="block card">
        ${clientName ? (clientName.length > 34 ? html`<div class="jr-stack" data-job-client><span class="k">Client</span><span class="v">${clientName}</span></div>` : html`<${KV} k="Client" v=${clientName} />`) : null}
        ${clientPhone ? html`<${KV} k="Client phone" v=${html`<a class="link" data-job-client-phone href=${'tel:' + clientPhone.replace(/[^0-9+]/g, '')}>${clientPhone}</a>`} />` : null}
        <${KV} k="Stage" v=${stage[1] || 'Not set'} />
        <${KV} k="Booked" v=${booked || 'Not booked yet'} />
        <${KV} k="Crew" v=${crewWords || 'Nobody yet'} onClick=${() => openCrew(jobId)} />
        ${siteNotes ? (siteNotes.length > 34 ? html`<div class="jr-stack"><span class="k">Site notes</span><span class="v">${siteNotes}</span></div>` : html`<${KV} k="Site notes" v=${siteNotes} />`) : null}
        ${reportJob
          ? html`<${KV} k=${reportLabel} v=${reportWords} onClick=${viewOnly ? null : () => go(`/job/${jobId}/report`)} />`
          : html`<${KV} k="Sign-off" v=${signoffWords} onClick=${canSignOff ? () => go(`/job/${jobId}/finish`) : null} />`}
      </div>
    <//>

    ${briefs.length && !viewOnly ? html`<${Section} label="Work order details">
      <div class="block card">
        ${briefs.map((text, i) => html`<div class="jr-stack" key=${i} data-job-wo-brief><span class="v" style="white-space:pre-wrap">${text}</span></div>`)}
      </div>
    <//>` : null}

    ${onJob && key ? html`<${Section} label="Your work on this job">
      <div class="block card">
        ${bookingRow(key, 'Booking')}
        ${also.map((r) => bookingRow(r, 'Also booked'))}
        <${KV} k="Time recorded" v=${fmtHrs(hours)} onClick=${() => go('/pay/week/' + mondayOf(key.date && key.date <= today ? key.date : today))} />
        ${payType ? html`<${KV} k="Pay type" v=${payType} />` : null}
      </div>
    <//>` : null}`;
}

// ---------------------------------------------------------------- crew ----
function openCrew(jobId) { openOverlay((close) => html`<${CrewSheet} jobId=${jobId} onClose=${close} />`); }
function CrewSheet({ jobId, onClose }) {
  const user = useStore((s) => s.user);
  const q = useJob(jobId);
  const { bookings } = useMyBookings();
  const data = q.data || {};
  const job = data.job || jobStub(jobId) || {};
  const vertical = verticalOf(job, data);
  const today = todayISO();
  const crew = useMemo(() => liveCrew(data), [q.data]);
  const people = useMemo(() => peopleOf(crew, data.leadInstaller, user.id), [crew, data.leadInstaller, user.id]);
  const myRows = myRowsOf(crew, bookings, jobId, user.id);
  const closed = jobIsClosed(job.status) || jobNotOpenYet(job.status);
  const canAllocate = !closed && (user.office || user.managed.includes(vertical));
  const remove = async (day) => {
    if (!(await ask({ title: `Take yourself off ${fmtDay(day.date)}?`, body: 'The office will see you are no longer booked that day.', yes: 'Take me off', danger: true }))) return;
    const r = await unbookMyself(day.id, jobId);
    if (r.ok) toast('Done. You are off that day.', { kind: 'ok' }); else toast(r.message, { kind: 'bad' });
  };
  const after = (shut, fn) => { shut(); setTimeout(fn, 220); };
  return html`<${Sheet} title="Crew on this job" sub=${jobAddress(job) || jobTitle(job)} onClose=${onClose}
    foot=${closed ? null : (shut) => html`
      <${Button} kind="line" block onClick=${() => after(shut, () => openBook(jobId, job, myRows))}>${myRows.length ? 'Add another day for me' : 'Add me to this job'}<//>
      ${canAllocate ? html`<${Button} kind="line" block onClick=${() => after(shut, () => import('./allocate.js').then((m) => m.openAllocate(job, vertical)).catch(() => toast('Could not open that. Check your signal.', { kind: 'bad' })))}>Allocate crew<//>` : null}`}>
    ${people.length ? html`<div>${people.map((p) => html`<div class="jr-person" key=${p.id}>
      <${Avatar} name=${p.name} me=${p.id === user.id} />
      <div style="min-width:0">
        <div class="jr-name"><span>${p.id === user.id ? 'You' : p.name}</span>${p.lead ? html`<${Badge} kind="live">Lead<//>` : null}</div>
        <div class="jr-days">${p.days.map((d) => { const done = WORKED.includes(d.status); const removable = p.id === user.id && !done && d.date >= today && d.status !== 'in_progress';
          return html`<div class=${cx('jr-day', removable && 'mine')} key=${d.id}><span>${d.date ? fmtDay(d.date) : 'No day set'}${done ? ', done' : d.date === today ? ', today' : ''}</span>
            ${removable ? html`<button type="button" class="link jr-call" onClick=${() => remove(d)}>Take me off</button>` : null}</div>`; })}</div>
      </div>
      ${p.phone && p.id !== user.id ? html`<a class="link jr-call" href=${'tel:' + p.phone} aria-label=${'Call ' + p.name}>Call</a>` : html`<span />`}
    </div>`)}</div>` : html`<${Empty} title="Nobody is booked yet">Be the first. Add yourself and it shows on the office calendar.<//>`}
  <//>`;
}

// --------------------------------------------------------------- scope ----
function ScopeTab({ data, job, vertical, videos, docs, user, viewOnly, onJob }) {
  const money = user.seesMoney;
  const eligible = (vertical === 'fencing' || vertical === 'patio');
  const jwo = useQuery(eligible ? 'jwo:' + job.id : null, () => api('my_job_work_order', { job_id: job.id }, null, { keepSession: true }), { ttl: 120000 });
  const wo = jwo.data && jwo.data.work_order;
  const legacyWo = data.workOrder || data.work_order || null;
  const packs = data.quote_packs || data.quotePacks || [];
  const mainPack = packs.find((p) => p.status === 'accepted' || p.accepted === true) || packs[0] || null;
  const otherPacks = packs.filter((p) => p !== mainPack);
  const scope = job.scope_json || {};
  const sealed = data.crew_scope_of_works || null;
  const instructions = (wo && wo.special_instructions) || (legacyWo && legacyWo.special_instructions) || (scope.notes && scope.notes.noteWorkOrder) || '';
  const spec = sealed || scope.tool === 'patio-scoper' ? [] : buildSpec(scope, vertical);
  const scoperNotes = vertical === 'fencing' && scope.job ? [scope.job.siteNotes, scope.job.checklist && scope.job.checklist.finalNotes, scope.job.removal && scope.job.removal.notes].filter(Boolean) : [];
  const clientNote = scope.client && scope.client.notes;
  const tasks = wo && wo.scope_items && wo.scope_items.length ? wo.scope_items.map(taskFromItem)
    : mainPack && mainPack.quote_lines && mainPack.quote_lines.length ? mainPack.quote_lines.map(taskFromItem)
    : legacyWo && legacyWo.scope_items && legacyWo.scope_items.length ? legacyWo.scope_items.map(taskFromItem)
    : mainPack && mainPack.items ? mainPack.items.filter((i) => i.kind !== 'note').map(taskFromItem) : [];
  const quoteNotes = mainPack ? [...(mainPack.quote_notes || []), ...(mainPack.items || []).filter((i) => i.kind === 'note').map((i) => i.description), mainPack.notes].filter(Boolean) : [];
  const extract = (data.quote_extracts || data.quoteExtracts || []).find((x) => x.action === 'trade_quote_extract' && x.quote_number);
  const summary = data.scopeSummary || job.notes || '';
  const plans = docs.filter((d) => ['council_plans', 'engineering', 'site_plan', 'scope_of_works', 'approval'].includes(String(d.type || '').toLowerCase()));
  const nothing = !instructions && !tasks.length && !spec.length && !sealed && !scoperNotes.length && !quoteNotes.length && !summary && !videos.length;
  const allNotes = [...scoperNotes, clientNote].filter(Boolean);
  const taskRow = (t, flagged) => html`<div class=${cx('jr-row', (flagged || t.variation) && 'var')}>
    <span class="jr-what">${noPrices(t.text, money)}${t.variation ? html`<span class="jr-kind">Variation${t.variation === true ? '' : ' ' + t.variation}</span>` : null}</span>
    ${t.qty ? html`<span class="jr-qty">${t.qty}</span>` : null}</div>`;

  return html`
    ${instructions ? html`<${Section} label="From the office"><p class="block card pad jr-para">${noPrices(instructions, money)}</p><//>` : null}

    ${tasks.length ? html`<${Section} label="What to do" right=${wo && wo.wo_number ? html`<span class="t-small t-num">${wo.wo_number}</span>` : mainPack && mainPack.quote_number ? html`<span class="t-small t-num">Quote ${mainPack.quote_number}</span>` : null}>
      <div class="block card">${tasks.map((t) => taskRow(t))}</div>
    <//>` : null}
    ${wo ? (wo.addenda || []).map((ad) => html`<${Section} label=${ad.label || 'Variation ' + (ad.variation_number || '')}>
      <div class="block card">
        ${ad.description ? html`<div class="jr-row var"><span class="jr-what">${noPrices(ad.description, money)}</span></div>` : null}
        ${(ad.scope_items || ad.lines || []).map(taskFromItem).map((t) => taskRow(t, true))}
      </div>
    <//>`) : null}

    ${sealed ? html`<${SealedScope} sealed=${sealed} />` : null}

    ${spec.length ? html`<${Section} label="Build details">
      <div class="block card">${spec.map(([k, v, wide]) => (wide
        ? html`<div class="jr-stack"><span class="k">${k}</span><span class="v">${v}</span></div>`
        : html`<div class="jr-row"><span class="jr-what">${k}</span><span class="jr-qty">${v}</span></div>`))}</div>
    <//>` : null}

    ${allNotes.length ? html`<${Section} label="Scoper's notes">
      <div class="block card pad">${allNotes.map((n) => html`<p class="jr-para">${noPrices(n, money)}</p>`)}</div>
    <//>` : null}

    ${quoteNotes.length ? html`<${Section} label="From the quote">
      <div class="block card pad">${quoteNotes.map((n) => html`<p class="jr-para">${noPrices(n, money)}</p>`)}</div>
    <//>` : null}

    ${!tasks.length && summary ? html`<${Section} label="About this job"><p class="block card pad jr-para">${noPrices(typeof summary === 'string' ? summary : '', money)}</p><//>` : null}

    ${videos.length ? html`<${Section} label=${videos.length > 1 ? 'Site videos' : 'Site video'}>
      <div class="block stack tight">${videos.map((v) => html`<div><video class="jr-video" controls playsinline preload="metadata" src=${v.url} />${v.label ? html`<p class="t-small" style="margin-top:4px">${v.label}</p>` : null}</div>`)}</div>
    <//>` : null}

    ${extract || plans.length ? html`<${Section} label="Documents">
      <div class="block card">
        ${extract ? html`<button type="button" class="jr-row link" onClick=${() => openQuote(job.id, extract)}><b>Quote ${extract.quote_number}<span class="jr-kind">Prices left out</span></b><span class="jr-open">Open</span></button>` : null}
        ${plans.map((d) => html`<a class="jr-row link" href=${docUrl(d)} target="_blank" rel="noopener"><b>${docName(d)}<span class="jr-kind">${DOC_LABEL[d.type] || 'Document'}</span></b><span class="jr-open">Open</span></a>`)}
      </div>
      ${otherPacks.length ? html`<p class="block t-small" style="margin-top:6px">${otherPacks.length} earlier quote${otherPacks.length > 1 ? 's' : ''} on this job. This shows the ${mainPack && (mainPack.status === 'accepted' || mainPack.accepted) ? 'accepted' : 'latest'} one.</p>` : null}
    <//>` : null}

    ${nothing ? html`<${Empty} title="No scope on this job yet">The office has not attached a scope of works. Check the notes and files, or call the office.<//>` : null}

    ${onJob && !viewOnly ? html`<div class="block" style="margin-top:24px"><${Button} kind="line" block onClick=${() => openVariation(job)}>Extra work? Ask for a variation<//></div>` : null}`;
}
function taskFromItem(item) {
  if (typeof item === 'string') return { text: item, qty: '' };
  const text = item.description || item.item || item.name || '';
  const unit = item.unit || '';
  const n = item.qty != null ? item.qty : item.quantity;
  let qty = '';
  if (item.hours != null && item.hours !== '') qty = `${item.hours} h`;
  else if (n != null && n !== '' && !(Number(n) === 1 && !unit)) qty = `${n}${unit ? ' ' + unit : ''}`;
  return { text, qty, variation: item.is_variation || item.variation_number ? (item.variation_label || item.variation_number || true) : false };
}
function num(v) { const n = Number(v); return v != null && v !== '' && !isNaN(n) ? n : null; }
function buildSpec(scope, vertical) {
  const cfg = scope.config || scope; const j = scope.job || {};
  const rows = [];
  const add = (k, v, wide) => { if (v != null && v !== '' && v !== false) rows.push([k, String(v), wide]); };
  if (vertical === 'fencing') {
    const runs = Array.isArray(j.runs) ? j.runs : [];
    const total = runs.reduce((s, r) => s + (num(r.length) || num(r.lengthM) || num(r.totalLength) || 0), 0) || num(cfg.totalLength) || num(cfg.length);
    add('Length', total ? `${Math.round(total * 10) / 10} m` : null);
    const h = num(j.sheetHeight) || num(cfg.height); add('Height', h ? `${h} mm` : null);
    add('Material', j.profile || j.material || cfg.material);
    add('Colour', j.colour || j.color || cfg.colour || cfg.color);
    const gates = Array.isArray(j.gates) ? j.gates : [];
    add('Gates', gates.length ? gates.map((g) => [g.type, g.width ? g.width + ' mm' : ''].filter(Boolean).join(' ')).join(', ') : num(cfg.gateCount), gates.length > 0);
    add('Plinths', cfg.plinths === true ? 'Yes' : cfg.plinths); add('Retaining', cfg.retaining === true ? 'Yes' : cfg.retaining);
    if (runs.length > 1) add('Runs', runs.map((r, i) => `${r.name || r.label || 'Run ' + (i + 1)}: ${num(r.length) || num(r.lengthM) || num(r.totalLength) || '?'} m`).join('\n'), true);
  } else {
    const l = num(cfg.length); const p = num(cfg.projection);
    add('Size', l && p ? `${l} x ${p} m` : null); add('Height', num(cfg.height) ? `${cfg.height} m` : cfg.height);
    add('Roof style', cfg.roofStyle); add('Roofing', cfg.roofing); add('Sheet colour', cfg.sheetColor || cfg.colour); add('Steel colour', cfg.steelColor);
    add('Fixing', cfg.connection); add('Posts', [cfg.posts, cfg.postSize].filter(Boolean).join(' x ')); add('Beams', [cfg.beams, cfg.beamSize].filter(Boolean).join(' x '));
  }
  return rows;
}
function SealedScope({ sealed }) {
  const [state, setState] = useState('checking');
  useEffect(() => {
    let on = true;
    if (sealed.status !== 'accepted' || !sealed.page) { setState('not-proved'); return undefined; }
    const text = JSON.stringify(String(sealed.page));
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then((buf) => {
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (on) setState(hex === sealed.content_hash ? 'ok' : 'differs');
    }).catch(() => on && setState('differs'));
    return () => { on = false; };
  }, [sealed]);
  if (state === 'checking') return html`<${Section} label="Scope of works"><div class="block"><${Skel} h=${220} /></div><//>`;
  if (state !== 'ok') return html`<${Section} label="Scope of works"><div class="block note-banner"><span>${state === 'not-proved' ? (sealed.reason || 'Which version the customer accepted could not be confirmed.') : 'The scope page on this phone does not match the sealed one.'} So it is not shown here. Ask the office for it.</span></div><//>`;
  return html`<${Section} label="Scope of works">
    <div class="block card"><iframe class="jr-frame" title="Scope of works" sandbox="" srcdoc=${sealed.page} /></div>
    <p class="block t-small" style="margin-top:6px">The version the customer accepted. Same page the office sees.</p>
  <//>`;
}
function openQuote(jobId, extract) {
  openOverlay((close) => html`<${QuoteSheet} jobId=${jobId} extract=${extract} onClose=${close} />`);
}
function QuoteSheet({ jobId, extract, onClose }) {
  const [page, setPage] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { apiText('trade_quote_extract', { format: 'html', jobId, document_id: extract.job_document_id }).then(setPage).catch(setErr); }, []);
  return html`<${Sheet} title=${'Quote ' + extract.quote_number} sub="Prices are left out." onClose=${onClose} tall>
    ${err ? html`<${Empty} title="Could not open the quote">${friendly(err)}<//>` : page == null ? html`<${Skel} h=${300} />` : html`<iframe class="jr-frame" title="Quote" sandbox="" srcdoc=${page} style="height:100%;min-height:60vh" />`}
  <//>`;
}

// -------------------------------------------------------------- photos ----
function PhotosTab({ jobId, photos, viewOnly, live, started }) {
  const [pending, setPending] = useState([]);
  const defaultPhase = live ? 'in_progress' : started ? 'completion' : 'scope';
  const add = async (phase) => {
    const files = await pickPhotos({ multiple: true });
    if (!files.length) return;
    const batch = files.map((f, i) => ({ key: Date.now() + '-' + i, file: f, preview: URL.createObjectURL(f), phase, state: 'sending' }));
    setPending((p) => [...batch, ...p]);
    let queued = 0; let failed = 0;
    for (const item of batch) {
      try {
        const r = await uploadPhoto(jobId, item.file, { phase });
        if (r.queued) { queued += 1; setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'queued' } : x))); } else setPending((p) => p.filter((x) => x.key !== item.key));
      } catch (err) { failed += 1; setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'failed' } : x))); toast(friendly(err), { kind: 'bad' }); }
    }
    invalidate('job:' + jobId);
    if (queued) toast(`${queued} photo${queued > 1 ? 's' : ''} saved on your phone. They will send when you have signal.`);
    else if (!failed) { toast(`${batch.length} photo${batch.length > 1 ? 's' : ''} added.`, { kind: 'ok' }); buzz(10); }
  };
  const groups = PHASES.map(([phase, label]) => ({ phase, label, items: photos.filter((p) => (p.phase || 'scope') === phase), pend: pending.filter((p) => p.phase === phase) }));
  const other = photos.filter((p) => !PHASES.some(([ph]) => ph === (p.phase || 'scope')));
  return html`
    ${viewOnly ? null : html`<div class="block"><${Button} kind="line" block icon="camera" onClick=${() => add(defaultPhase)}>Add ${defaultPhase === 'scope' ? 'before' : defaultPhase === 'in_progress' ? 'progress' : 'finished'} photos<//></div>`}
    ${groups.map((g) => (g.items.length || g.pend.length || !viewOnly) ? html`<${Section} key=${g.phase} label=${g.label} right=${g.items.length ? html`<span class="t-small t-num">${g.items.length} ${g.items.length === 1 ? 'photo' : 'photos'}</span>` : null}>
      <div class="block"><${PhotoGrid} photos=${g.items} pending=${g.pend} onAdd=${viewOnly ? null : () => add(g.phase)} addLabel="Add" /></div>
    <//>` : null)}
    ${other.length ? html`<${Section} label="Other"><div class="block"><${PhotoGrid} photos=${other} /></div><//>` : null}
    ${viewOnly && !photos.length ? html`<${Empty} title="No photos yet">Photos of this job show here once somebody adds them.<//>` : null}`;
}

// --------------------------------------------------------------- notes ----
function usePendingNotes(jobId) {
  const read = () => outboxItems().filter((i) => i.kind === 'api' && i.action === 'add_note' && i.jobId === jobId);
  const [items, setItems] = useState(read);
  useEffect(() => onOutbox(() => setItems(read())), [jobId]);
  return items;
}
function NotesTab({ jobId, job, notes, pending, user, viewOnly }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim(); if (!t) return;
    setBusy(true);
    const body = noteBody(jobId, t, user);
    try {
      await api('add_note', null, body);
      optimisticNote(jobId, t, user);
      invalidate('job:' + jobId);
      setText(''); buzz(8);
    } catch (err) {
      if (err instanceof ApiError && err.refused) toast(friendly(err), { kind: 'bad' });
      else { queueWrite({ action: 'add_note', body, jobId, label: 'Note on ' + jobTitle(job) }); setText(''); toast('Note saved on your phone. It will send when you have signal.'); }
    }
    setBusy(false);
  };
  return html`
    ${viewOnly ? null : html`<div class="block jr-compose">
      <textarea class="input" rows="1" aria-label="Note" placeholder="Write a note for the office and crew" value=${text} onInput=${(e) => { setText(e.currentTarget.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(140, e.currentTarget.scrollHeight) + 'px'; }} />
      <div class="jr-composefoot">
        <span class="t-small">Notes go to the office and crew. The customer does not see them.</span>
        <${Button} kind="line" aria-label="Send note" busy=${busy} disabled=${!text.trim()} onClick=${send}>Send<//>
      </div>
    </div>`}
    ${notes.length || pending.length ? html`<${Section} label="Notes, newest first">
      <div class="block card">
        ${[...pending].reverse().map((p) => html`<div class="jr-note pending" key=${p.id}><span class="jr-who"><b>You</b> · waiting for signal</span><span class="jr-para">${p.body.text}</span></div>`)}
        ${[...notes].reverse().map((n) => { const who = noteAuthor(n); const mine = n._mine || (n.users && n.users.name === user.name); return html`<div class=${cx('jr-note', who === 'Office' && 'office')} key=${n.id}>
          <span class="jr-who"><b>${mine ? 'You' : who}</b> · ${fmtTs(n.created_at)}</span><span class="jr-para">${noPrices(noteText(n), user.seesMoney)}</span></div>`; })}
      </div>
    <//>` : html`<${Empty} title="No notes yet">${viewOnly ? 'Notes from the office and crew show here.' : 'Anything the next person should know? Gate codes, dogs, where the materials are.'}<//>`}`;
}

// --------------------------------------------------------------- files ----
function FilesTab({ jobId, data, docs, user, viewOnly }) {
  const pos = data.purchaseOrders || [];
  const receipts = (data.media || []).filter((m) => m.phase === 'receipt');
  const [busyPo, setBusyPo] = useState(null);
  const addReceipt = async (po) => {
    const files = await pickPhotos({ multiple: false, camera: true });
    if (!files.length) return;
    setBusyPo(po.id);
    try {
      const r = await uploadPhoto(jobId, files[0], { phase: 'receipt', poId: po.id, label: 'Receipt - ' + (po.supplier_name || po.contact_name || 'supplier') });
      toast(r.queued ? 'Receipt saved on your phone. It will send when you have signal.' : 'Receipt added.', { kind: r.queued ? '' : 'ok' });
      invalidate('job:' + jobId);
    } catch (err) { toast(friendly(err), { kind: 'bad' }); }
    setBusyPo(null);
  };
  return html`
    ${pos.length ? html`<${Section} label="Materials"><div class="block stack tight">
      ${pos.map((po) => { const approved = ['authorised', 'billed', 'sent', 'confirmed', 'delivered', 'submitted'].includes(String(po.status).toLowerCase()); const mine = receipts.filter((r) => r.po_id === po.id); const when = po.confirmed_delivery_date || po.delivery_date;
        return html`<div class="card jr-po" key=${po.id}>
          <div class="jr-pohead"><span><b class="t-strong">${po.supplier_name || po.contact_name || 'Supplier'}</b><span class="t-small t-num" style="display:block">${po.po_number || ''}</span></span>
            ${!approved ? html`<${Badge} kind="warn">Not approved yet<//>` : when ? html`<${Badge} kind="ok">Delivery ${fmtDate(when)}<//>` : html`<${Badge}>Pick up<//>`}</div>
          ${(po.line_items || []).length ? html`<ul>${po.line_items.map((li) => html`<li>${li.quantity || li.Quantity ? (li.quantity || li.Quantity) + ' x ' : ''}${noPrices(li.description || li.Description || '', user.seesMoney)}</li>`)}</ul>` : null}
          ${!approved ? html`<p class="t-small">Do not buy against this order until the office approves it.</p>` : null}
          ${mine.length ? html`<${PhotoGrid} four photos=${mine.map((m) => ({ ...m, url: m.storage_url, thumb: m.thumbnail_url || m.storage_url }))} />` : null}
          ${approved && !viewOnly ? html`<${Button} kind="line" busy=${busyPo === po.id} onClick=${() => addReceipt(po)}>Add receipt photo<//>` : null}
        </div>`; })}
    </div><//>` : null}
    ${docs.length ? html`<${Section} label="Documents"><div class="block card">
      ${docs.map((d) => html`<a class="jr-row link" href=${docUrl(d)} target="_blank" rel="noopener"><b>${docName(d)}<span class="jr-kind">${DOC_LABEL[d.type] || 'Document'}</span></b><span class="jr-open">Open</span></a>`)}
    </div><//>` : null}
    ${!pos.length && !docs.length ? html`<${Empty} title="No files on this job">Plans, approvals and material orders show here when the office adds them.<//>` : null}
    ${viewOnly ? null : html`<div class="block stack tight" style="margin-top:24px">
      <${Button} kind="line" block onClick=${() => go('/pay/receipt?job=' + jobId)}>Add a receipt for this job<//>
      ${isReportJob(verticalOf(data.job, data)) ? null : html`<${Button} kind="line" block onClick=${() => go(`/job/${jobId}/service`)}>Service report for the customer<//>`}
    </div>`}`;
}

// ------------------------------------------------- problem, text, variation
const PROBLEMS = ['Materials missing', 'Site access issue', 'Client not home', 'Damage found', 'Other'];
function openProblem(job) { openOverlay((close) => html`<${ProblemSheet} job=${job} onClose=${close} />`); }
function ProblemSheet({ job, onClose }) {
  const [type, setType] = useState(null); const [detail, setDetail] = useState(''); const [busy, setBusy] = useState(false);
  const send = async (shut) => {
    setBusy(true);
    const body = { jobId: job.id, issueType: type, detail: detail.trim() || null, notify_telegram: true };
    try { await api('create_trade_alert', null, body); toast('Sent to the office.', { kind: 'ok' }); } catch (err) {
      if (err instanceof ApiError && err.refused) { toast(friendly(err), { kind: 'bad' }); setBusy(false); return; }
      queueWrite({ action: 'create_trade_alert', body, jobId: job.id, label: 'Problem on ' + jobTitle(job) });
      toast('Saved. It will reach the office when you have signal. If it is urgent, call them.');
    }
    setBusy(false); shut();
  };
  return html`<${Sheet} title="Tell the office" sub=${jobTitle(job)} onClose=${onClose} foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!type} onClick=${() => send(shut)}>Send to the office<//>`}>
    <div class="stack">
      <${Field} label="What is wrong?"><${Picks} value=${type} options=${PROBLEMS.map((p) => [p, p])} onChange=${setType} /><//>
      <${Field} label="Anything to add?"><textarea class="input" placeholder="What you can see, what you need" value=${detail} onInput=${(e) => setDetail(e.currentTarget.value)} /><//>
    </div>
  <//>`;
}
function openText(job) { openOverlay((close) => html`<${TextSheet} job=${job} onClose=${close} />`); }
function TextSheet({ job, onClose }) {
  const first = String(job.client_name || '').split(' ')[0] || 'there';
  const quick = [`Hi ${first}, it is SecureWorks. I am on my way to you now.`, `Hi ${first}, it is SecureWorks. I am running a bit late, sorry. I will be there soon.`, `Hi ${first}, SecureWorks here. We are finished for today and will be back to carry on.`];
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const send = async (shut) => {
    setBusy(true);
    try { await ghl('send_sms', null, { contactId: job.ghl_contact_id, message: msg.trim(), jobId: job.id }); toast('Text sent to the customer.', { kind: 'ok' }); shut(); } catch (err) { toast(friendly(err), { kind: 'bad' }); }
    setBusy(false);
  };
  return html`<${Sheet} title="Message the customer" sub="A text sent from the SecureWorks number, so replies go to the office." onClose=${onClose} foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!msg.trim()} onClick=${() => send(shut)}>Send text<//>`}>
    <div class="stack">
      <div class="stack tight">${quick.map((qm) => html`<button type="button" class="jr-quick" onClick=${() => { setMsg(qm); buzz(6); }}>${qm}</button>`)}</div>
      <${Field} label="Your message"><textarea class="input" value=${msg} onInput=${(e) => setMsg(e.currentTarget.value)} placeholder="Pick one above or write your own" /><//>
    </div>
  <//>`;
}
function openVariation(job) { openOverlay((close) => html`<${VariationSheet} job=${job} onClose=${close} />`); }
function VariationSheet({ job, onClose }) {
  const [desc, setDesc] = useState(''); const [cost, setCost] = useState(''); const [photo, setPhoto] = useState(null); const [busy, setBusy] = useState(false);
  const send = async (shut) => {
    setBusy(true);
    try {
      let photoUrl;
      if (photo) { const r = await uploadPhoto(job.id, photo, { phase: 'in_progress', label: 'Variation request photo' }); photoUrl = r.media && (r.media.url || r.media.publicUrl); }
      const body = { job_id: job.id, description: desc.trim() };
      if (cost !== '' && Number(cost) >= 0) body.estimated_cost = Number(cost);
      if (photoUrl) body.photo_url = photoUrl;
      const res = await api('create_variation', null, body);
      if (!res || res.success !== true) throw new ApiError((res && res.error) || 'The request was not saved.', { status: 409, body: res });
      toast(res.auto_approved ? (res.message || 'Variation approved.') : 'Sent. The office will approve it before the extra work goes ahead.', { kind: 'ok', ms: 5000 });
      invalidate('job:' + job.id); shut();
    } catch (err) {
      toast(err.offline ? 'No signal. A variation needs a connection, try again in range.' : (err.body && err.body.code) === 'variation_requires_assignment' ? 'Add yourself to this job first.' : friendly(err), { kind: 'bad', ms: 6000 });
    }
    setBusy(false);
  };
  return html`<${Sheet} title="Ask for a variation" sub="Extra work the customer wants, or something the scope missed. The office approves it first." onClose=${onClose}
    foot=${(shut) => html`<${Button} block busy=${busy} disabled=${desc.trim().length < 4} onClick=${() => send(shut)}>Send to the office<//>`}>
    <div class="stack">
      <${Field} label="What is the extra work?"><textarea class="input" value=${desc} onInput=${(e) => setDesc(e.currentTarget.value)} placeholder="e.g. Extra 3 m of fence down the left side, customer asked on site" /><//>
      <${Field} label="Your guess at the cost (optional)"><input class="input" type="number" inputmode="decimal" min="0" value=${cost} onInput=${(e) => setCost(e.currentTarget.value)} placeholder="Dollars" /><//>
      <${Button} kind="line" icon="camera" onClick=${async () => { const f = await pickPhotos({ multiple: false }); if (f[0]) setPhoto(f[0]); }}>${photo ? 'Photo added. Change it' : 'Add a photo'}<//>
    </div>
  <//>`;
}
