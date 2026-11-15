// Job board for managers: the Jobs tab with Board chosen. Stage tiles with
// counts across the top, then the chosen stage's jobs as rows, each with
// Allocate where this manager may book its crew.
// Make safe comes from the server's own board, with the stages exactly as it
// sends them. Every other job type a manager looks after is built from
// everyone's bookings: waiting for a crew first, then the chosen week.
import { html, useEffect, useMemo, useState } from '../lib/h.js';
import { api, ApiError } from '../lib/api.js';
import { useQuery, useStore, local } from '../lib/store.js';
import { rememberJobStub } from '../lib/data.js';
import { manages } from '../lib/auth.js';
import { go } from '../lib/router.js';
import { todayISO, addDays, mondayOf, fmtTime, fmtWeek, fmtRelDay, firstName, tsToDate } from '../lib/dates.js';
import { jobTitle, jobAddress, VERTICAL_LABEL } from '../lib/model.js';
import { useTeam, boardsFor } from '../lib/roster.js';
import { Page, JobLine, Badge, Button, IconButton, Seg, Skel, Empty, LoadError, toast, buzz } from '../ui/kit.js';
import { JobSearch, ListBoardSwitch, RowsSkel, foldText as fold, daysShort } from './jobs.js';

const PAGE = 8;
const book = (job, vertical) => import('./allocate.js').then((m) => m.openAllocate(job, vertical)).catch(() => toast('Could not open that. Check your signal.', { kind: 'bad' }));
const openJob = (job) => { rememberJobStub(job); go('/job/' + job.id); };
const names = (people) => (people.length === 1 ? people[0] : people.length === 2 ? people.map(firstName).join(' and ') : `${firstName(people[0])} and ${people.length - 1} more`);

export function Board({ vertical }) {
  const user = useStore((s) => s.user);
  const boards = boardsFor(user);
  const [q, setQ] = useState('');
  const current = boards.includes(vertical) ? vertical : boards[0];
  useEffect(() => { if (current) local.set('jobs:board', current); }, [current]);

  if (!boards.length) {
    return html`<${Page} title="Board" back="Jobs" onBack=${() => go('/jobs', { replace: true })}><${Empty} title="This is for managers" action=${html`<${Button} kind="line" small onClick=${() => go('/jobs', { replace: true })}>Back to Jobs<//>`}>
      The board is where managers book crew onto jobs. You can find any job from Jobs.
    <//><//>`;
  }
  return html`<${Page} root flush title="Jobs" right=${html`<span>Manager view</span>`}>
    <div class="jb-top">
      <${JobSearch} value=${q} onInput=${setQ} label="Search the board" />
      <${ListBoardSwitch} user=${user} value="board" />
      ${boards.length > 1 ? html`<${Seg} value=${current} options=${boards.map((v) => [v, VERTICAL_LABEL[v] || 'Jobs'])} onChange=${(v) => go('/jobs/board/' + v, { replace: true })} />` : null}
    </div>
    ${current === 'makesafe' ? html`<${MakesafeBoard} key="makesafe" q=${q} />` : html`<${WeekBoard} key=${current} vertical=${current} user=${user} q=${q} />`}
  <//>`;
}

// ---------------------------------------------------------------- shared ----
/** The tiles: one a stage, its count on top. The chosen one is slate. */
function Stages({ stages, value, onChange }) {
  return html`<div class="jb-stages" role="group" aria-label="Stage">
    ${stages.map((s) => html`<button type="button" class="jb-stage" key=${s.key} aria-pressed=${String(s.key === value)} aria-label=${`${s.name}, ${s.count}`} onClick=${() => { if (s.key !== value) { buzz(6); onChange(s.key); } }}>
      <b>${s.count}</b><span>${s.name}</span></button>`)}
  </div>`;
}
/** One job on the board. Tapping the words opens the job; Allocate books its crew. */
function BoardRow({ job, vertical, kind, detail, sub, badge, warn, onAllocate }) {
  return html`<div class="jb-brow jb-row">
    <button type="button" class="jb-open" onClick=${() => openJob(job)}>
      <${JobLine} job=${job} vertical=${vertical}>${kind || null}<//>
      <span class="jb-line1">${jobAddress(job) || jobTitle(job)}</span>
      <span class="jb-line2">${detail}</span>
      ${sub ? html`<span class="jb-line2">${sub}</span>` : null}
      ${warn ? html`<span class="jb-warn">${warn}</span>` : null}
    </button>
    <span class="jb-side">
      ${badge || null}
      ${onAllocate ? html`<${Button} kind="line" small onClick=${onAllocate}>Allocate<//>` : null}
    </span>
  </div>`;
}
function StageList({ rows, render, empty }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, PAGE);
  if (!rows.length) return html`<div class="jb-blist"><p class="jb-none">${empty}</p></div>`;
  return html`<div class="jb-blist">${shown.map(render)}</div>
    ${rows.length > PAGE ? html`<div class="jb-foot"><${Button} kind="line" small onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show ${rows.length - PAGE} more`}<//></div>` : null}`;
}
function BoardSkeleton() {
  return html`<div class="jb-stages" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<${Skel} h=${60} />`)}</div><${RowsSkel} n=${4} />`;
}
function BoardFoot({ words, refreshing, onRefresh }) {
  return html`<div class="jb-foot"><span>${words}</span>
    <${Button} kind="line" small busy=${refreshing} onClick=${() => { buzz(6); onRefresh(); }}>Refresh<//></div>`;
}

// ------------------------------------------------------------ make safe ----
const KNOWN = ['New', 'Allocated', 'Complete', 'Archive'];
function suburbOf(address) {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  const last = (parts[parts.length - 1] || '').replace(/\b(WA|Western Australia|Australia)\b/gi, '').replace(/\b\d{4}\b/g, '').trim();
  return last || (parts.length > 1 ? parts[parts.length - 2] : '') || parts[0] || '';
}
/** Check the answer is the board we know, then keep only what a row shows. */
function readBoard(res) {
  const wrong = () => new ApiError('The board came back in a shape this app does not know. Try again, and tell the office if it keeps happening.', { status: 0 });
  if (!res || res.projection !== 'trade' || !/^makesafe-board\.v1(\.|$)/.test(String(res.contract_version || ''))) throw wrong();
  if (!res.parity || res.parity.ok !== true || !res.columns || typeof res.columns !== 'object') throw wrong();
  const colNames = [...KNOWN.filter((k) => k in res.columns), ...Object.keys(res.columns).filter((k) => !KNOWN.includes(k))];
  const columns = colNames.map((name) => {
    if (!Array.isArray(res.columns[name])) throw wrong();
    return { name, cards: res.columns[name].filter((r) => r && r.id).map((r) => {
      const c = r.contact || {}; const b = r.builder || {}; const rep = r.report || {}; const age = r.age || {}; const lin = r.lineage || {};
      return {
        id: r.id, column: r.column || name, number: r.job_number || '', family: r.ses_family_label || r.makesafe_type || '', kind: r.makesafe_type || '',
        suburb: suburbOf(c.address), address: c.address || '', client: c.client_name || '',
        builder: b.name || '', ref: b.external_ref || lin.builder_work_order_number || '', po: lin.builder_po_number || '',
        crew: (Array.isArray(r.assignments) ? r.assignments : []).map((a) => ({ id: a.assignment_id, userId: a.user_id, name: a.name || a.crew_name || 'Crew', date: String(a.scheduled_date || '').slice(0, 10), start: a.start_time || null }))
          .sort((x, y) => (x.date || '9').localeCompare(y.date || '9') || String(x.start || '99').localeCompare(String(y.start || '99'))),
        reportAt: rep.submitted_at || null, photos: Number(rep.photo_count) || 0,
        ageHours: age.age_hours == null ? null : Number(age.age_hours), ageDays: age.age_days == null ? null : Number(age.age_days),
        warning: r.projection_warning ? String(r.projection_warning) : ''
      };
    }) };
  });
  const p = res.permissions || {};
  return { columns, canBook: p.can_allocate === true, seesAll: p.sees_all_makesafes === true, unmapped: Array.isArray(res.unmapped_stage_job_ids) ? res.unmapped_stage_job_ids.length : 0 };
}

function MakesafeBoard({ q }) {
  const board = useQuery('board:makesafe', () => api('makesafe_board', { projection: 'trade' }, null, { keepSession: true }).then(readBoard), { ttl: 90000 });
  const [stage, setStage] = useState('');
  const term = fold(q);
  const columns = useMemo(() => {
    if (!board.data) return [];
    if (!term) return board.data.columns;
    return board.data.columns.map((c) => ({ ...c, cards: c.cards.filter((k) => [k.number, k.suburb, k.address, k.client, k.builder, k.ref, k.po, k.family, k.kind, ...k.crew.map((p) => p.name)].some((v) => fold(v).includes(term))) }));
  }, [board.data, term]);

  if (board.loading) return html`<${BoardSkeleton} />`;
  if (board.error && !board.data) {
    const e = board.error;
    if (e.status === 403) return html`<${Empty} title="This board is not open to you">${e.message || 'Ask the office to check your access.'}<//>`;
    return html`<${LoadError} error=${e} onRetry=${board.refetch} what="the make safe board" />`;
  }
  const { canBook, seesAll, unmapped } = board.data;
  const total = board.data.columns.reduce((n, c) => n + c.cards.length, 0);
  const found = columns.reduce((n, c) => n + c.cards.length, 0);
  if (!total) return html`<${Empty} title="No make safe jobs yet">${seesAll ? 'New make safes show here as soon as they come in.' : 'Make safes you are booked on show here.'}<//>`;
  const cur = columns.find((c) => c.name === stage) || columns.find((c) => c.cards.length) || columns[0];

  return html`
    ${unmapped ? html`<div class="note-banner jr-banner" style="margin-top:12px"><span>${unmapped === 1 ? 'One job came through without a clear stage.' : `${unmapped} jobs came through without a clear stage.`} Let the office know.</span></div>` : null}
    <${Stages} stages=${columns.map((c) => ({ key: c.name, name: c.name, count: c.cards.length }))} value=${cur.name} onChange=${setStage} />
    ${term && !found ? html`<${Empty} title="Nothing on the board matches">Nothing matches "${q.trim()}". Check the spelling, or look it up in the list.<//>`
      : html`<${StageList} key=${cur.name} rows=${cur.cards} empty=${term ? 'No match in this stage.' : 'Nothing in this stage.'}
        render=${(k) => html`<${MakesafeRow} key=${k.id} card=${k} canBook=${canBook && (k.column === 'New' || k.column === 'Allocated')} />`} />`}
    <${BoardFoot} words=${canBook ? 'The stage of each job is set by the office system.' : 'You can look at these jobs. The office books the crew.'} refreshing=${board.refreshing} onRefresh=${board.refetch} />`;
}

function ageWords(card) {
  if (card.ageHours == null) return '';
  if (card.ageHours < 1) return 'Just in';
  if (card.ageHours < 24) return `${Math.round(card.ageHours)} h ago`;
  const d = card.ageDays != null ? card.ageDays : Math.floor(card.ageHours / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
function MakesafeRow({ card, canBook }) {
  const job = { id: card.id, type: 'makesafe', job_number: card.number, site_suburb: card.suburb, site_address: card.address.split(',')[0] || '', client_name: card.client };
  const first = card.crew[0];
  const people = [...new Set(card.crew.map((p) => p.name))];
  const isNew = card.column === 'New';
  const open = card.column === 'New' || card.column === 'Allocated';
  const who = people.length ? `${names(people)}${first && first.date ? `, ${fmtRelDay(first.date).toLowerCase()}${first.start ? ' at ' + fmtTime(first.start) : ''}` : ''}` : open ? 'Nobody booked yet' : '';
  const report = card.reportAt ? `Report in ${fmtRelDay(tsToDate(card.reportAt)).toLowerCase()}${card.photos ? `, ${card.photos} ${card.photos === 1 ? 'photo' : 'photos'}` : ''}` : '';
  return html`<${BoardRow} job=${job} vertical="makesafe" kind=${card.family || 'Make safe'} detail=${[report || who, card.client].filter(Boolean).join(' · ')} sub=${[card.builder, card.ref].filter(Boolean).join(' ')}
    badge=${isNew && card.ageHours != null ? html`<${Badge} kind=${card.ageHours >= 24 ? 'warn' : ''}>${ageWords(card)}<//>` : null}
    warn=${card.warning ? 'The office system could not place this job. It may be in the wrong stage.' : ''}
    onAllocate=${canBook ? () => book(job, 'makesafe') : null} />`;
}

// ------------------------------------------- every other managed job type ----
const DONE_JOB = ['complete', 'completed', 'invoiced', 'paid', 'closed', 'archived', 'final_payment', 'get_review'];
const DEAD_JOB = ['cancelled', 'lost', 'deleted', 'duplicate', 'duplicated', 'void', 'voided'];
const RANK = { in_progress: 6, disputed: 5, submitted: 4, verified: 4, confirmed: 3, scheduled: 3, draft: 2, complete: 2 };
function columnOf(status, jobStatus) {
  const js = String(jobStatus || '').toLowerCase();
  if (DEAD_JOB.includes(js)) return 'cancelled';
  if (DONE_JOB.includes(js)) return 'done';
  if (['scheduled', 'confirmed', 'draft'].includes(status)) return 'scheduled';
  if (status === 'in_progress') return 'onsite';
  if (['complete', 'completed', 'submitted', 'verified'].includes(status)) return 'done';
  if (status === 'cancelled') return 'cancelled';
  return 'attention';
}
const COLS = [['ready', 'To schedule'], ['scheduled', 'Scheduled'], ['onsite', 'In progress'], ['done', 'Complete'], ['attention', 'To check'], ['cancelled', 'Cancelled']];
const EMPTY_WORDS = { ready: 'Every job has a crew.', scheduled: 'Nothing booked this week.', onsite: 'Nobody on site right now.', done: 'Nothing finished yet this week.', attention: 'Nothing to check.', cancelled: 'Nothing cancelled this week.' };

function WeekBoard({ vertical, user, q }) {
  const team = useTeam(user);
  const today = todayISO();
  const [monday, setMonday] = useState(mondayOf(today));
  const [stage, setStage] = useState('ready');
  const sunday = addDays(monday, 6);
  const canBook = manages(user, vertical);
  const label = (VERTICAL_LABEL[vertical] || 'job').toLowerCase();
  const term = fold(q);

  const cols = useMemo(() => {
    const out = { ready: [], scheduled: [], onsite: [], done: [], attention: [], cancelled: [] };
    if (!team.data) return out;
    const rows = team.data.bookings.filter((b) => b.vertical === vertical);
    const card = (job, list, extra) => ({ id: job.id, job, days: [...new Set(list.map((b) => b.date).filter(Boolean))].sort(), people: [...new Set(list.map((b) => b.userName).filter(Boolean))], ...extra });
    const group = (list) => { const m = new Map(); for (const b of list) { if (!m.has(b.jobId)) m.set(b.jobId, []); m.get(b.jobId).push(b); } return m; };
    // No day yet: jobs waiting for a crew, and bookings with no date.
    for (const o of team.data.open.filter((x) => x.vertical === vertical)) out.ready.push(card(o.job, [], { waiting: true }));
    group(rows.filter((b) => !b.date)).forEach((list) => out.ready.push(card(list[0].job, list, { noDay: true })));
    // The chosen week: one row per job, placed by its most telling booking.
    group(rows.filter((b) => b.date >= monday && b.date <= sunday)).forEach((list) => {
      const top = [...list].sort((a, b) => (RANK[b.status] || 1) - (RANK[a.status] || 1))[0];
      out[columnOf(top.status, top.job.status)].push(card(top.job, list, {}));
    });
    const hit = (k) => !term || [k.job.job_number, k.job.client_name, k.job.site_suburb, k.job.site_address, ...k.people].some((v) => fold(v).includes(term));
    for (const key of Object.keys(out)) out[key] = out[key].filter(hit).sort((a, b) => (a.days[0] || '').localeCompare(b.days[0] || '') || jobTitle(a.job).localeCompare(jobTitle(b.job)));
    return out;
  }, [team.data, vertical, monday, term]);

  if (team.loading) return html`<${BoardSkeleton} />`;
  if (team.error && !team.data) return html`<${LoadError} error=${team.error} onRetry=${team.refetch} what=${`the ${label} board`} />`;
  const any = team.data.bookings.some((b) => b.vertical === vertical) || team.data.open.some((o) => o.vertical === vertical);
  const found = Object.values(cols).reduce((n, l) => n + l.length, 0);
  const shownCols = COLS.filter(([key]) => !['attention', 'cancelled'].includes(key) || cols[key].length);
  const thisWeek = monday === mondayOf(today);
  const cur = shownCols.some(([key]) => key === stage) ? stage : 'ready';
  const weekWord = thisWeek ? 'This week' : monday === addDays(mondayOf(today), 7) ? 'Next week' : monday === addDays(mondayOf(today), -7) ? 'Last week' : 'Week';

  return html`
    <${Stages} stages=${shownCols.map(([key, name]) => ({ key, name, count: cols[key].length }))} value=${cur} onChange=${setStage} />
    <div class="jb-week">
      <span class="t-cap">${weekWord}, ${fmtWeek(monday)}</span>
      <span class="jb-weekbtns">
        ${!thisWeek ? html`<${Button} kind="quiet" small onClick=${() => setMonday(mondayOf(today))}>This week<//>` : null}
        <${IconButton} name="back" label="Earlier week" size=${20} onClick=${() => setMonday(addDays(monday, -7))} />
        <${IconButton} name="right" label="Later week" size=${20} onClick=${() => setMonday(addDays(monday, 7))} />
      </span>
    </div>
    ${!any ? html`<${Empty} title=${`No ${label} jobs to show`}>Jobs show here once they are ready for a crew or somebody is booked on them.<//>`
      : term && !found ? html`<${Empty} title="Nothing on the board matches">Nothing matches "${q.trim()}" this week. Try another week, or look it up in the list.<//>`
      : html`<${StageList} key=${cur} rows=${cols[cur]} empty=${term ? 'No match in this stage.' : EMPTY_WORDS[cur]}
        render=${(k) => html`<${WeekRow} key=${k.id + cur} card=${k} vertical=${vertical} today=${today} canBook=${canBook && (cur === 'ready' || cur === 'scheduled' || cur === 'onsite')} />`} />`}
    <${BoardFoot} words=${`To schedule is every ${label} job still waiting for a crew or a day. The other stages are the week above.`} refreshing=${team.refreshing} onRefresh=${team.refetch} />`;
}

function WeekRow({ card, vertical, today, canBook }) {
  const job = card.job;
  const days = card.days.length ? (card.days.includes(today) ? 'Today' + (card.days.length > 1 ? ', ' + daysShort(card.days.filter((d) => d !== today)) : '') : daysShort(card.days)) : card.noDay ? 'Booked, no day set' : '';
  const who = card.people.length ? names(card.people) : 'Nobody booked yet';
  return html`<${BoardRow} job=${job} vertical=${vertical} detail=${[days, who, job.client_name].filter(Boolean).join(' · ')} onAllocate=${canBook ? () => book(job, vertical) : null} />`;
}
