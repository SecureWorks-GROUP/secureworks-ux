// Jobs: the job database. My jobs is every job the trade is booked on; All jobs
// is every job the server lets them find. Type a job number, an address, a
// suburb or a client to search. Managers also get the board from here.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api, friendly } from '../lib/api.js';
import { useQuery, useStore, local, peekQuery } from '../lib/store.js';
import { useMyBookings, rememberJobStub } from '../lib/data.js';
import { go } from '../lib/router.js';
import { todayISO, fmtDay, fmtDow, fmtDom, tsToDate } from '../lib/dates.js';
import { jobTitle, jobAddress, verticalOf, jobStageKey, bookingState, VERTICAL_LABEL } from '../lib/model.js';
import { boardsFor, useTeam } from '../lib/roster.js';
import { Icon } from '../ui/icons.js';
import { Page, JobLine, StatusBadge, STATUS, Seg, Sheet, Button, IconButton, Skel, Empty, LoadError, openOverlay, buzz } from '../ui/kit.js';

/** 'swf 26168' -> 'SWF-26168', as the server matches job numbers. */
export function tidyQuery(q) {
  const t = String(q || '').trim();
  const m = /^(SW[A-Z]{0,5})\s*[-_.\/]?\s*(\d{3,})$/i.exec(t);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : t;
}
export const foldText = (s) => String(s || '').toLowerCase().replace(/[\s-]+/g, '');
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}
/** 'Fri 13, Sat 14' for a few days; longer lists are cut short in words. */
export function daysShort(dates, max = 3) {
  const list = [...new Set(dates.filter(Boolean))].sort();
  const shown = list.slice(0, max).map((d) => `${fmtDow(d)} ${fmtDom(d)}`);
  return shown.join(', ') + (list.length > max ? ` and ${list.length - max} more` : '');
}
export const countWords = (n, one = 'job', many = 'jobs') => `${Number(n).toLocaleString('en-AU')} ${n === 1 ? one : many}`;

const TYPES = [['', 'All'], ...['fencing', 'patio', 'makesafe', 'repair', 'decking', 'restoration'].map((v) => [v, VERTICAL_LABEL[v]]), ['other', 'Other']];
const STAGES = [['', 'All'], ...['to_schedule', 'scheduled', 'in_progress', 'on_hold', 'complete', 'closed', 'draft'].map((k) => [k, STATUS[k][1]])];

// ------------------------------------------------------------ shared parts --
/** The search field at the top of the list and the board. */
export function JobSearch({ value, onInput, label = 'Search every job' }) {
  const input = useRef(null);
  return html`<div class="search">
    <${Icon} name="jobs" size=${18} />
    <input ref=${input} class="input jb-search" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck=${false}
      placeholder="Job number, address, suburb or client" value=${value} onInput=${(e) => onInput(e.currentTarget.value)} aria-label=${label} />
    ${value ? html`<span class="clear"><${IconButton} name="close" label="Clear search" size=${18} onClick=${() => { onInput(''); if (input.current) input.current.focus(); }} /></span>` : null}
  </div>`;
}
/** List or Board, for the people who run a board. */
export function ListBoardSwitch({ user, value }) {
  const boards = boardsFor(user);
  if (!boards.length) return null;
  const saved = local.get('jobs:board', '');
  const to = (v) => { if (v === 'list') go('/jobs', { replace: true }); else go('/jobs/board/' + (boards.includes(saved) ? saved : boards[0]), { replace: true }); };
  return html`<${Seg} value=${value} options=${[['list', 'List'], ['board', 'Board']]} onChange=${to} />`;
}
/** A field that opens a short list of choices. */
function FilterField({ name, value, options, onChange }) {
  const label = (options.find((o) => o[0] === value) || options[0])[1];
  const open = () => openOverlay((close) => html`<${Sheet} title=${name} onClose=${close}>
    ${(shut) => html`<div class="picks">${options.map(([v, text]) => html`<button type="button" class="pick" aria-pressed=${String(v === value)} onClick=${() => { buzz(6); onChange(v); shut(); }}>${text}</button>`)}</div>`}
  <//>`);
  return html`<button type="button" class=${cx('jb-filter', value && 'set')} aria-haspopup="dialog" aria-label=${`${name}: ${label}`} onClick=${open}>
    <span>${name}: ${label}</span><${Icon} name="down" size=${16} stroke=${2.2} />
  </button>`;
}
/** One job as a record row: tag and kind, address, who and when, stage. */
export function JobItem({ job, vertical, detail }) {
  const v = vertical || verticalOf(job);
  const addr = jobAddress(job) || jobTitle(job);
  return html`<button type="button" class="item jb-row" onClick=${() => { rememberJobStub(job); go('/job/' + job.id); }}>
    <span class="main">
      <${JobLine} job=${job} vertical=${v} />
      <span class="jb-line1">${addr}</span>
      <span class="jb-line2">${detail || ''}</span>
    </span>
    <span class="side"><${StatusBadge} status=${jobStageKey(job.status)} /></span>
  </button>`;
}
export function RowsSkel({ n = 5 }) {
  return html`<div class="list flat jb-list" aria-hidden="true">${Array.from({ length: n }, () => html`<div class="item">
    <span class="jb-skel"><${Skel} w=${128} h=${16} /><${Skel} w="72%" h=${16} /><${Skel} w="52%" h=${12} /></span><${Skel} w=${76} h=${22} /></div>`)}</div>`;
}

// ------------------------------------------------------------- the screen ---
export function Jobs() {
  const user = useStore((s) => s.user);
  const [q, setQ] = useState(() => local.get('jobs:q', ''));
  const [view, setView] = useState(() => { const v = local.get('jobs:view', ''); return v === 'all' || v === 'mine' ? v : user.office ? 'all' : 'mine'; });
  const [type, setType] = useState('');
  const [stage, setStage] = useState('');
  const term = useDebounced(tidyQuery(q), 280);
  const searching = term.length >= 2;
  useEffect(() => { local.set('jobs:q', q); }, [q]);
  useEffect(() => { local.set('jobs:view', view); }, [view]);

  const { bookings, loading, error, refetch } = useMyBookings();
  const team = useTeam(user);
  const today = todayISO();

  // My jobs: one entry a job, with the days I am on it.
  const mine = useMemo(() => {
    const byJob = new Map();
    for (const b of bookings) {
      if (!b.jobId) continue;
      const cur = byJob.get(b.jobId) || { job: b.job, vertical: b.vertical, jobId: b.jobId, dates: [], live: false };
      if (b.date) cur.dates.push(b.date);
      if (bookingState(b) === 'live') cur.live = true;
      byJob.set(b.jobId, cur);
    }
    const all = [...byJob.values()].map((j) => {
      const ahead = j.dates.filter((d) => d >= today).sort();
      const behind = j.dates.filter((d) => d < today).sort();
      return { ...j, ahead, next: ahead[0] || null, last: behind[behind.length - 1] || null };
    });
    return [
      ...all.filter((j) => j.next).sort((a, b) => a.next.localeCompare(b.next)),
      ...all.filter((j) => !j.next).sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 30)
    ];
  }, [bookings, today]);
  const mineById = useMemo(() => new Map(mine.map((j) => [j.jobId, j])), [mine]);
  const crewCount = useMemo(() => {
    const m = new Map();
    for (const b of (team.data && team.data.bookings) || []) { if (!m.has(b.jobId)) m.set(b.jobId, new Set()); m.get(b.jobId).add(b.userId || b.userName); }
    return m;
  }, [team.data]);

  const ownHits = useMemo(() => {
    if (!searching) return mine;
    const t = foldText(term);
    return mine.filter((j) => [j.job.job_number, j.job.client_name, j.job.site_suburb, j.job.site_address].some((v) => foldText(v).includes(t)));
  }, [mine, term, searching]);

  // All jobs: the server's search. In My jobs it is only asked when nothing of mine matches.
  const askAll = view === 'all' || (searching && !loading && !ownHits.length);
  const allKey = askAll ? 'search:' + (searching ? term.toLowerCase() : '*') : null;
  const search = useQuery(allKey, () => api('search_all_jobs', searching ? { q: term } : {}), { ttl: 60000 });
  const [extra, setExtra] = useState({ key: null, jobs: [], next: null, busy: false, error: '' });
  const more = extra.key === allKey ? extra : { key: allKey, jobs: [], next: search.data ? search.data.next_offset : null, busy: false, error: '' };
  const loadMore = async () => {
    if (more.busy || more.next == null) return;
    setExtra({ ...more, busy: true, error: '' });
    try {
      const res = await api('search_all_jobs', searching ? { q: term, offset: more.next } : { offset: more.next });
      setExtra({ key: allKey, jobs: [...more.jobs, ...((res && res.jobs) || [])], next: res ? res.next_offset : null, busy: false, error: '' });
    } catch (err) { setExtra({ ...more, busy: false, error: friendly(err) }); }
  };
  const found = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const j of [...((search.data && search.data.jobs) || []), ...more.jobs]) { if (j && j.id && !seen.has(j.id)) { seen.add(j.id); out.push(j); } }
    return out;
  }, [search.data, more.jobs]);
  // The server says when a plain trade's list is only their own jobs (opening other jobs is not switched on).
  const browse = peekQuery('search:*');
  const ownOnly = Boolean(!user.manager && ((search.data && search.data.lens === 'assigned') || (browse && browse.lens === 'assigned')));

  const pass = (job, v) => (!type || (v || verticalOf(job)) === type) && (!stage || jobStageKey(job.status) === stage);
  const words = (job) => {
    const me = mineById.get(job.id);
    const closed = jobStageKey(job.status) === 'complete';
    let link = '';
    if (me && me.ahead.length) link = 'You: ' + daysShort(me.ahead);
    else if (me && me.last) link = closed ? 'Finished ' + fmtDay(me.last) : 'You: last there ' + fmtDay(me.last);
    else if (job.assigned_to_me === true) link = 'You are booked on it';
    else if (closed) link = job.completed_at ? 'Finished ' + fmtDay(tsToDate(job.completed_at)) : 'Finished';
    else if (crewCount.has(job.id)) link = crewCount.get(job.id).size === 1 ? 'Crew of 1' : `Crew of ${crewCount.get(job.id).size}`;
    else if (jobStageKey(job.status) === 'to_schedule') link = 'Not booked yet';
    return [job.client_name, link].filter(Boolean).join(' · ');
  };

  const showAll = view === 'all';
  const fallback = !showAll && askAll; // typed in My jobs, nothing of mine matched
  const mineRows = ownHits.filter((j) => pass(j.job, j.vertical));
  const allRows = found.filter((j) => pass(j));
  const filtered = Boolean(type || stage);
  const moreToLoad = more.next != null;
  let count = null;
  if (!showAll && !fallback) { if (!loading && !(error && !bookings.length)) count = mineRows.length; }
  else if (search.data) count = !moreToLoad ? allRows.length : !filtered && search.data.total != null ? search.data.total : null;

  const clearFilters = () => { setType(''); setStage(''); };
  const filterNote = filtered ? html`<${Button} kind="line" small onClick=${clearFilters}>Show every type and stage<//>` : null;

  let body;
  if (!showAll && !fallback) {
    body = loading ? html`<${RowsSkel} n=${4} />`
      : error && !bookings.length ? html`<${LoadError} error=${error} onRetry=${refetch} what="your jobs" />`
      : !mine.length ? html`<${Empty} title="You are not booked on a job yet" action=${html`<${Button} kind="line" small onClick=${() => setView('all')}>Show all jobs<//>`}>Jobs you are booked on show here. Look in All jobs to find one and add yourself to it.<//>`
      : !mineRows.length ? html`<${Empty} title="None of your jobs match" action=${filterNote}>${filtered ? 'Nothing of yours is that type and stage.' : ''}<//>`
      : html`<div class="list flat jb-list">${mineRows.map((j) => html`<${JobItem} key=${j.jobId} job=${j.job} vertical=${j.vertical} detail=${words(j.job)} />`)}</div>`;
  } else {
    body = search.loading ? html`${fallback ? html`<div class="jb-caption"><span>None of your jobs match. Looking in all jobs.</span></div>` : null}<${RowsSkel} n=${5} />`
      : search.error && !search.data ? html`<${LoadError} error=${search.error} onRetry=${search.refetch} what=${searching ? 'the search' : 'the job list'} />`
      : !found.length ? (searching
        ? html`<${Empty} title="No job found">Nothing matches "${term}". Try the suburb or the job number. If it is a brand new job the office may not have set it up yet.${ownOnly ? ' You can only find the jobs you are booked on.' : ''}<//>`
        : html`<${Empty} title="No jobs to show">${ownOnly ? 'You can only see the jobs you are booked on, and you are not booked on one yet.' : 'There are no jobs in the list yet.'}<//>`)
      : html`
        ${fallback ? html`<div class="jb-caption"><span>None of your jobs match. Found in all jobs:</span></div>` : null}
        ${ownOnly && !searching ? html`<div class="jb-caption"><span>These are the jobs you are booked on. Other jobs are not open to you yet.</span></div>` : null}
        ${allRows.length ? html`<div class="list flat jb-list">${allRows.map((job) => html`<${JobItem} key=${job.id} job=${job} detail=${words(job)} />`)}</div>`
          : html`<${Empty} title="No job of that type and stage" action=${filterNote}>${moreToLoad ? 'Only the jobs loaded so far were checked.' : ''}<//>`}
        ${moreToLoad || more.error ? html`<div class="jb-foot">
          ${more.error ? html`<span class="t-bad">${more.error}</span>` : html`<span>Showing the newest ${countWords(found.length)}${search.data.total != null ? ` of ${Number(search.data.total).toLocaleString('en-AU')}` : ''}. Search to narrow it down.</span>`}
          <${Button} kind="line" small busy=${more.busy} onClick=${loadMore}>Load more jobs<//>
        </div>` : null}`;
  }

  return html`<${Page} root flush title="Jobs" right=${count != null ? html`<span class="jb-count">${countWords(count)}</span>` : null}>
    <div class="jb-top">
      <${JobSearch} value=${q} onInput=${setQ} />
      <${ListBoardSwitch} user=${user} value="list" />
      <${Seg} value=${view} options=${[['mine', 'My jobs'], ['all', 'All jobs']]} onChange=${setView} />
      <div class="jb-filters">
        <${FilterField} name="Type" value=${type} options=${TYPES} onChange=${setType} />
        <${FilterField} name="Stage" value=${stage} options=${STAGES} onChange=${setStage} />
      </div>
    </div>
    ${body}
  <//>`;
}
